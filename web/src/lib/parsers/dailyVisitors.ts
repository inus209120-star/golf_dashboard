import * as XLSX from "xlsx";
import type { DailyVisitorDoc } from "@/types/firestore";

export interface VisitorParseResult {
  doc: DailyVisitorDoc | null;
  error: string | null;
}

function mergedGrid(sheet: XLSX.WorkSheet) {
  const merges = sheet["!merges"] ?? [];
  return function get(r: number, c: number): unknown {
    for (const m of merges) {
      if (r >= m.s.r && r <= m.e.r && c >= m.s.c && c <= m.e.c) {
        const cell = sheet[XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c })];
        return cell?.v ?? null;
      }
    }
    const cell = sheet[XLSX.utils.encode_cell({ r, c })];
    return cell?.v ?? null;
  };
}

function txt(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, "");
}
function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0) || 0;
}

const DATE_RE = /영업일자\s*:?\s*(\d{4})년\s*(\d{2})월\s*(\d{2})일\s*\[(.+?)\]/;

/**
 * Parses 무노스 "종합영업일보" .xls exports - one file per single day
 * (unlike 일일영업집계/예약현황, there's no date-range ambiguity here since
 * the report is always for exactly one 영업일자).
 *
 * We only pull the "팀수 및 객단가" sub-table's "당 일" row (실제 내장 팀수/
 * 인원/팀당인원) - this is a real headcount independent of the booking-
 * pipeline data in the 예약현황(일별집계) export (reservations collection),
 * so it's stored separately (dailyVisitors) rather than merged into
 * ReservationDoc, which would otherwise leave a half-populated reservation
 * document with the rest of its required fields undefined.
 *
 * The sheet has two side-by-side sub-tables sharing header text ("구분") -
 * this one and 영업일수 (구분/평일/주말/휴장) further down - so the header
 * is located by requiring "팀수" immediately right of "구분" and "인원"
 * shortly after, rather than matching "구분" alone.
 */
export function parseDailyVisitorFile(buffer: ArrayBuffer): VisitorParseResult {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:A1");
  const get = mergedGrid(sheet);

  let date: string | null = null;
  let dayOfWeek = "";
  for (let r = range.s.r; r <= Math.min(range.e.r, 5); r++) {
    const v = String(get(r, 0) ?? "");
    const m = v.match(DATE_RE);
    if (m) {
      date = `${m[1]}-${m[2]}-${m[3]}`;
      dayOfWeek = m[4];
      break;
    }
  }
  if (!date) {
    return { doc: null, error: "영업일자를 찾을 수 없음 - 파일 형식을 확인하세요" };
  }

  let hdrRow = -1;
  let guCol = -1;
  let teamCol = -1;
  let personCol = -1;
  let perTeamCol = -1;
  for (let r = range.s.r; r <= range.e.r && hdrRow === -1; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      if (txt(get(r, c)) !== "구분") continue;
      let tCol = -1;
      for (let cc = c + 1; cc <= Math.min(c + 4, range.e.c); cc++) {
        if (txt(get(r, cc)) === "팀수") { tCol = cc; break; }
      }
      if (tCol === -1) continue;
      let pCol = -1;
      for (let cc = tCol + 1; cc <= Math.min(tCol + 4, range.e.c); cc++) {
        if (txt(get(r, cc)) === "인원") { pCol = cc; break; }
      }
      if (pCol === -1) continue;
      hdrRow = r;
      guCol = c;
      teamCol = tCol;
      personCol = pCol;
      for (let cc = pCol + 1; cc <= Math.min(pCol + 4, range.e.c); cc++) {
        if (txt(get(r, cc)) === "팀당인원") { perTeamCol = cc; break; }
      }
      break;
    }
  }
  if (hdrRow === -1) {
    return { doc: null, error: '"팀수 및 객단가" 표(구분/팀수/인원)를 찾을 수 없음 - 파일 형식을 확인하세요' };
  }

  let dataRow = -1;
  for (let r = hdrRow + 1; r <= Math.min(hdrRow + 6, range.e.r); r++) {
    if (txt(get(r, guCol)) === "당일") { dataRow = r; break; }
  }
  if (dataRow === -1) {
    return { doc: null, error: '"당 일" 행을 찾을 수 없음 - 파일 형식을 확인하세요' };
  }

  const teams = num(get(dataRow, teamCol));
  const persons = num(get(dataRow, personCol));
  const avgPersonsPerTeam = perTeamCol !== -1 ? num(get(dataRow, perTeamCol)) : teams > 0 ? persons / teams : 0;

  return {
    doc: { date, dayOfWeek, teams, persons, avgPersonsPerTeam, uploadedAt: new Date().toISOString() },
    error: null,
  };
}
