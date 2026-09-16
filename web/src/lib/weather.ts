import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/collections";
import type { WeatherCacheDoc, WeatherForecastItem, WeatherWarningItem } from "@/types/firestore";

// 특보현황 조회(wrn_now_data.php)에서 우리가 신경 쓰는 지역 코드만 필터링.
// L1082500 = 부산동부(기장군 포함, weather.go.kr 특보구역 안내 기준),
// L1150000 = 부산 전체(폭염/한파/황사처럼 부산 전역에 한 번에 발표되는 특보 대비).
const OUR_REGION_IDS = new Set(["L1082500", "L1150000"]);

// 기상청 API허브 (apihub.kma.go.kr) 단기예보 조회서비스 (VilageFcstInfoService_2.0).
// Issued 8x/day at 02/05/08/11/14/17/20/23, available ~10min after each.
const ISSUE_HOURS = [2, 5, 8, 11, 14, 17, 20, 23];

interface KmaItem {
  category: string; // TMP, TMN, TMX, SKY, PTY, POP, ...
  fcstDate: string; // YYYYMMDD
  fcstTime: string; // HHmm
  fcstValue: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Most recent already-published base_date/base_time, as of `now`. */
function latestBaseDateTime(now: Date): { base_date: string; base_time: string } {
  const hh = now.getHours();
  const mm = now.getMinutes();
  let chosen: number | null = null;
  for (let i = ISSUE_HOURS.length - 1; i >= 0; i--) {
    const t = ISSUE_HOURS[i];
    if (hh > t || (hh === t && mm >= 10)) {
      chosen = t;
      break;
    }
  }
  const base = new Date(now);
  if (chosen === null) {
    chosen = 23;
    base.setDate(base.getDate() - 1);
  }
  const base_date = `${base.getFullYear()}${pad2(base.getMonth() + 1)}${pad2(base.getDate())}`;
  return { base_date, base_time: `${pad2(chosen)}00` };
}

const SKY_DESC: Record<string, string> = { "1": "맑음", "3": "구름많음", "4": "흐림" };
const PTY_DESC: Record<string, string> = { "1": "비", "2": "비/눈", "3": "눈", "4": "소나기", "5": "빗방울", "6": "빗방울눈날림", "7": "눈날림" };

function describe(sky: string | undefined, pty: string | undefined): string {
  if (pty && pty !== "0" && PTY_DESC[pty]) return PTY_DESC[pty];
  return sky ? (SKY_DESC[sky] ?? "-") : "-";
}

const COMPASS_16 = ["북", "북북동", "북동", "동북동", "동", "동남동", "남동", "남남동", "남", "남남서", "남서", "서남서", "서", "서북서", "북서", "북북서"];

/** KMA VEC is wind-origin bearing in degrees (0-360, meteorological convention). */
function windDirLabel(deg: number): string {
  const idx = Math.round(deg / 22.5) % 16;
  return `${COMPASS_16[idx]}풍`;
}

/**
 * Fetches currently-active 기상특보 (강풍/호우/대설/폭염/한파/태풍 등) for our
 * region from the legacy 특보현황 조회 API. Unlike getVilageFcst, this
 * responds in EUC-KR (not UTF-8/JSON) - a plain-text table with '#'
 * comment/header lines and one data row per line, columns separated by
 * commas and terminated with '='. There's no region filter parameter,
 * so we fetch the nationwide list and filter client-side by REG_ID.
 */
async function fetchActiveWarnings(authKey: string): Promise<WeatherWarningItem[]> {
  const res = await fetch(`https://apihub.kma.go.kr/api/typ01/url/wrn_now_data.php?fe=f&authKey=${authKey}`);
  if (!res.ok) throw new Error(`KMA 특보 API HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const text = new TextDecoder("euc-kr").decode(buf);

  const warnings: WeatherWarningItem[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const cols = line.split(",").map((c) => c.trim());
    // REG_UP, REG_UP_KO, REG_ID, REG_KO, TM_FC, TM_EF, WRN, LVL, CMD, ED_TM
    const [, , regId, regKo, tmFc, tmEf, wrn, lvl] = cols;
    if (!regId || !OUR_REGION_IDS.has(regId)) continue;
    warnings.push({ type: wrn ?? "", level: lvl ?? "", regionName: regKo ?? "", effectiveFrom: tmFc ?? "", effectiveTo: tmEf ?? "" });
  }
  return warnings;
}

function dayLabel(fcstDate: string, todayYmd: string): string {
  const toDate = (s: string) => new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
  const diffDays = Math.round((toDate(fcstDate).getTime() - toDate(todayYmd).getTime()) / 86400000);
  if (diffDays === 0) return "오늘";
  if (diffDays === 1) return "내일";
  if (diffDays === 2) return "모레";
  return `${fcstDate.slice(4, 6)}/${fcstDate.slice(6, 8)}`;
}

/** Fetches the latest 단기예보 from KMA, parses it, and writes weatherCache/current. */
export async function fetchAndCacheWeather(): Promise<WeatherCacheDoc> {
  const authKey = process.env.KMA_AUTH_KEY;
  const nx = process.env.KMA_NX;
  const ny = process.env.KMA_NY;
  if (!authKey || !nx || !ny) {
    throw new Error("Missing KMA_AUTH_KEY / KMA_NX / KMA_NY env vars");
  }

  const now = new Date();
  const { base_date, base_time } = latestBaseDateTime(now);
  const url = new URL("https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0/getVilageFcst");
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", "1000");
  url.searchParams.set("dataType", "JSON");
  url.searchParams.set("base_date", base_date);
  url.searchParams.set("base_time", base_time);
  url.searchParams.set("nx", nx);
  url.searchParams.set("ny", ny);
  url.searchParams.set("authKey", authKey);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`KMA API HTTP ${res.status}`);
  const json = await res.json();
  const header = json?.response?.header;
  if (header?.resultCode !== "00") {
    throw new Error(`KMA API error: ${header?.resultCode} ${header?.resultMsg}`);
  }
  const items: KmaItem[] = json?.response?.body?.items?.item ?? [];
  if (items.length === 0) throw new Error("KMA API returned no items");

  // Group by (date,time) so we can read multiple categories per slot.
  const bySlot = new Map<string, Map<string, string>>();
  for (const it of items) {
    const key = `${it.fcstDate}${it.fcstTime}`;
    if (!bySlot.has(key)) bySlot.set(key, new Map());
    bySlot.get(key)!.set(it.category, it.fcstValue);
  }
  const slotKeys = Array.from(bySlot.keys()).sort();

  // "Current" snapshot = the earliest forecast slot (nearest upcoming 3-hourly point).
  const firstSlot = bySlot.get(slotKeys[0])!;
  const temp = Number(firstSlot.get("TMP") ?? "0");
  const pop = Number(firstSlot.get("POP") ?? "0");
  const desc = describe(firstSlot.get("SKY"), firstSlot.get("PTY"));
  const windSpeed = Number(firstSlot.get("WSD") ?? "0");
  const windDir = windDirLabel(Number(firstSlot.get("VEC") ?? "0"));
  const humidity = Number(firstSlot.get("REH") ?? "0");

  // Daily forecast: group slots by date, take min/max temp seen that day (TMN/TMX only
  // appear at specific slots, but every slot also carries TMP - min/max over TMP is a
  // safe fallback when TMN/TMX aren't present for a given day in this base_time's window).
  const byDate = new Map<string, { tmn?: number; tmx?: number; pops: number[] }>();
  for (const key of slotKeys) {
    const date = key.slice(0, 8);
    const slot = bySlot.get(key)!;
    const entry = byDate.get(date) ?? { pops: [] };
    const tmp = slot.has("TMP") ? Number(slot.get("TMP")) : undefined;
    const tmn = slot.has("TMN") ? Number(slot.get("TMN")) : tmp;
    const tmx = slot.has("TMX") ? Number(slot.get("TMX")) : tmp;
    if (tmn !== undefined) entry.tmn = entry.tmn === undefined ? tmn : Math.min(entry.tmn, tmn);
    if (tmx !== undefined) entry.tmx = entry.tmx === undefined ? tmx : Math.max(entry.tmx, tmx);
    if (slot.has("POP")) entry.pops.push(Number(slot.get("POP")));
    byDate.set(date, entry);
  }
  const todayYmd = slotKeys[0].slice(0, 8);
  const forecast: WeatherForecastItem[] = Array.from(byDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([date, v]) => ({
      day: dayLabel(date, todayYmd),
      tempLow: v.tmn ?? temp,
      tempHigh: v.tmx ?? temp,
      pop: v.pops.length ? Math.max(...v.pops) : pop,
    }));

  let warnings: WeatherWarningItem[] = [];
  try {
    warnings = await fetchActiveWarnings(authKey);
  } catch (err) {
    // Same fallback stance as the outer refresh in page.tsx - a warnings-API
    // hiccup shouldn't take down the temp/forecast data that already succeeded.
    console.error("weather warnings fetch failed:", err);
  }

  const doc: WeatherCacheDoc = { fetchedAt: now.toISOString(), temp, desc, pop, windSpeed, windDir, humidity, warnings, forecast };
  await adminDb.collection(COLLECTIONS.weatherCache).doc("current").set(doc);
  return doc;
}
