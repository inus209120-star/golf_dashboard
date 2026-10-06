import https from "node:https";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/collections";
import type { WeatherCacheDoc, WeatherForecastItem, WeatherWarningItem } from "@/types/firestore";

/**
 * Next.js's `next start` runtime patches the global `fetch` for its Data
 * Cache integration, and calls to apihub.kma.go.kr's legacy typ01 endpoints
 * through that patched fetch intermittently hang until a 504 - reproduced
 * repeatedly even with retries, while a plain `node -e` script hitting the
 * exact same URL (bypassing Next's patch) and a bare `curl` both succeed
 * instantly every time. Using Node's `https` module directly sidesteps
 * whatever Next's wrapper is doing, for this one call site.
 */
function httpsGetBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          res.resume();
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

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

// 중기예보(4~10일차) 전용 지역코드 - 단기예보(getVilageFcst)의 nx/ny 격자나
// 특보의 L-코드와는 다른, 이 레거시 API 계열만의 코드 체계. 지점번호 159(부산)가
// 찍히는 행을 기준으로 실측 확인함: 하늘상태/강수확률(fct_afs_wl)은 광역 코드
// 11H20000, 기온(fct_afs_wc)은 도시 단위 코드 11H20201을 쓴다 - 같은 "부산"이라도
// 두 API가 서로 다른 세분화 코드를 쓰므로 하나로 통일하면 안 됨.
const MID_TERM_LAND_REG = "11H20000";
const MID_TERM_TEMP_REG = "11H20201";

interface MidTermDay {
  tempLow: number;
  tempHigh: number;
  pop: number;
}

/**
 * Fetches the 중기예보(day+4 ~ day+10) from KMA's legacy text API - the
 * modern JSON MidFcstInfoService (getMidLandFcst/getMidTa) needs its own
 * apihub 활용신청 approval that's still pending, but this older text-based
 * pair (기상자료개방포털 since ~2013) already works with our existing
 * authKey. Two separate calls: fct_afs_wl for sky/precip, fct_afs_wc for
 * min/max temp - same EUC-KR CSV format as the 특보 API above.
 */
async function fetchMidTermForecast(authKey: string): Promise<Map<string, MidTermDay>> {
  // apihub's legacy typ01 endpoints intermittently 504 under this server's
  // real traffic pattern (reproducible even via node:https, not just the
  // Next-patched fetch) - a few retries with backoff clears it in practice.
  async function fetchRows(path: string, reg: string): Promise<string[][]> {
    const url = `https://apihub.kma.go.kr/api/typ01/url/${path}?reg=${reg}&tmfc1=0&tmfc2=0&disp=1&help=0&authKey=${authKey}`;
    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * attempt));
      try {
        const buf = await httpsGetBuffer(url);
        const text = new TextDecoder("euc-kr").decode(buf);
        return text
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("#"))
          .map((l) => l.replace(/,=$/, "").split(","));
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  // fct_afs_wl: REG_ID,TM_FC,TM_EF,MOD,STN,C,SKY,PRE,CONF,WF,RN_ST
  // Near days are split into two 12-hour (AM/PM) rows per date - take the
  // max rain-probability row per date, matching how the short-term forecast
  // above already collapses multiple slots into one daily max POP.
  const popByDate = new Map<string, number>();
  for (const cols of await fetchRows("fct_afs_wl.php", MID_TERM_LAND_REG)) {
    const date = cols[2]?.slice(0, 8);
    const rnSt = Number(cols[10]);
    if (!date || Number.isNaN(rnSt)) continue;
    popByDate.set(date, Math.max(popByDate.get(date) ?? 0, rnSt));
  }

  // fct_afs_wc: REG_ID,TM_FC,TM_EF,MOD,STN,C,MIN,MAX,MIN_L,MIN_H,MAX_L,MAX_H
  // One row per date already (daily resolution throughout this range).
  const result = new Map<string, MidTermDay>();
  for (const cols of await fetchRows("fct_afs_wc.php", MID_TERM_TEMP_REG)) {
    const date = cols[2]?.slice(0, 8);
    const tempLow = Number(cols[6]);
    const tempHigh = Number(cols[7]);
    if (!date || Number.isNaN(tempLow) || Number.isNaN(tempHigh)) continue;
    result.set(date, { tempLow, tempHigh, pop: popByDate.get(date) ?? 0 });
  }
  return result;
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
  const shortTermDates = Array.from(byDate.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  // 단기예보(위 getVilageFcst)는 최대 "그글피"까지(오늘 포함 5일)만 주므로,
  // 그 이후(6~10일차)는 중기예보로 이어붙인다 - 겹치는 날짜는 더 정밀한
  // 단기예보 쪽을 그대로 쓰고, 단기예보가 못 미친 날짜만 중기예보로 채움.
  let midTerm = new Map<string, MidTermDay>();
  try {
    midTerm = await fetchMidTermForecast(authKey);
  } catch (err) {
    // 중기예보 API 한 쪽이 삐끗해도 이미 성공한 단기예보(1~5일차)까지는
    // 살리는 게 낫다 - 아래 warnings와 동일한 방어 패턴.
    console.error("mid-term forecast fetch failed:", err);
  }
  const lastShortTermDate = shortTermDates.length ? shortTermDates[shortTermDates.length - 1][0] : todayYmd;
  const midTermDates = Array.from(midTerm.entries())
    .filter(([date]) => date > lastShortTermDate)
    .sort((a, b) => a[0].localeCompare(b[0]));

  const forecast: WeatherForecastItem[] = [
    ...shortTermDates.map(([date, v]) => ({
      day: dayLabel(date, todayYmd),
      tempLow: v.tmn ?? temp,
      tempHigh: v.tmx ?? temp,
      pop: v.pops.length ? Math.max(...v.pops) : pop,
    })),
    ...midTermDates.map(([date, v]) => ({
      day: dayLabel(date, todayYmd),
      tempLow: v.tempLow,
      tempHigh: v.tempHigh,
      pop: v.pop,
    })),
  ].slice(0, 10);

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
