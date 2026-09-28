import * as XLSX from "xlsx";
import type { MonthlySalesDoc } from "@/types/firestore";

export interface MonthlySalesParseResult {
  doc: MonthlySalesDoc | null;
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
 * Parses a 무노스 "종합영업일보" export the same as businessDailySales.ts /
 * dailyVisitors.ts, but reads the "월계" row of the 매출 표 and the "당 월"
 * row of the 팀수 및 객단가 표 instead of "일계"/"당 일" - i.e. this file is
 * expected to be the LAST business day of the target month, so 월계 already
 * equals that whole month's total (the report always carries 일계/월계/년계
 * side by side). Used to backfill months that predate day-by-day uploads
 * (2026년 1~8월) without needing one file per day.
 */
export function parseMonthlySalesFile(buffer: ArrayBuffer): MonthlySalesParseResult {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:A1");
  const get = mergedGrid(sheet);

  let asOfDate: string | null = null;
  for (let r = range.s.r; r <= Math.min(range.e.r, 5); r++) {
    const m = String(get(r, 0) ?? "").match(DATE_RE);
    if (m) {
      asOfDate = `${m[1]}-${m[2]}-${m[3]}`;
      break;
    }
  }
  if (!asOfDate) {
    return { doc: null, error: "영업일자를 찾을 수 없음 - 파일 형식을 확인하세요" };
  }
  const yearMonth = asOfDate.slice(0, 7);

  // 매출 표: 입장료/카트료/프로샵/식음료/기타/총매출, "월계" 행.
  let muHdrRow = -1;
  let muCol = -1;
  for (let r = range.s.r; r <= range.e.r && muHdrRow === -1; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      if (txt(get(r, c)) !== "매출") continue;
      let hasEntry = false;
      let hasCart = false;
      for (let cc = c + 1; cc <= Math.min(c + 20, range.e.c); cc++) {
        const v = txt(get(r, cc));
        if (v === "입장료") hasEntry = true;
        if (v === "카트료") hasCart = true;
      }
      if (hasEntry && hasCart) {
        muHdrRow = r;
        muCol = c;
        break;
      }
    }
  }
  if (muHdrRow === -1) {
    return { doc: null, error: '"매출"(입장료/카트료/...) 표를 찾을 수 없음 - 파일 형식을 확인하세요' };
  }

  function findSalesCol(label: string): number {
    for (let cc = muCol + 1; cc <= Math.min(muCol + 20, range.e.c); cc++) {
      if (txt(get(muHdrRow, cc)) === label) return cc;
    }
    return -1;
  }
  const salesCols = {
    entry: findSalesCol("입장료"),
    cart: findSalesCol("카트료"),
    proshop: findSalesCol("프로샵"),
    food: findSalesCol("식음료"),
    etc: findSalesCol("기타"),
    total: findSalesCol("총매출"),
  };
  for (const [label, col] of Object.entries(salesCols)) {
    if (col === -1) {
      return { doc: null, error: `"${label}" 열을 찾을 수 없음 - 파일 형식을 확인하세요` };
    }
  }

  let salesRow = -1;
  for (let r = muHdrRow + 1; r <= Math.min(muHdrRow + 4, range.e.r); r++) {
    if (txt(get(r, muCol)) === "월계") {
      salesRow = r;
      break;
    }
  }
  if (salesRow === -1) {
    return { doc: null, error: '"월계" 행을 찾을 수 없음 - 파일 형식을 확인하세요' };
  }

  // 팀수 및 객단가 표: 구분/팀수/인원/팀당인원, "당 월" 행.
  let vHdrRow = -1;
  let guCol = -1;
  let teamCol = -1;
  let personCol = -1;
  let perTeamCol = -1;
  for (let r = range.s.r; r <= range.e.r && vHdrRow === -1; r++) {
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
      vHdrRow = r;
      guCol = c;
      teamCol = tCol;
      personCol = pCol;
      for (let cc = pCol + 1; cc <= Math.min(pCol + 4, range.e.c); cc++) {
        if (txt(get(r, cc)) === "팀당인원") { perTeamCol = cc; break; }
      }
      break;
    }
  }
  if (vHdrRow === -1) {
    return { doc: null, error: '"팀수 및 객단가" 표(구분/팀수/인원)를 찾을 수 없음 - 파일 형식을 확인하세요' };
  }

  let visitorRow = -1;
  for (let r = vHdrRow + 1; r <= Math.min(vHdrRow + 6, range.e.r); r++) {
    if (txt(get(r, guCol)) === "당월") { visitorRow = r; break; }
  }
  if (visitorRow === -1) {
    return { doc: null, error: '"당 월" 행을 찾을 수 없음 - 파일 형식을 확인하세요' };
  }

  const teams = num(get(visitorRow, teamCol));
  const persons = num(get(visitorRow, personCol));
  const avgPersonsPerTeam = perTeamCol !== -1 ? num(get(visitorRow, perTeamCol)) : teams > 0 ? persons / teams : 0;

  return {
    doc: {
      yearMonth,
      asOfDate,
      greenFee: num(get(salesRow, salesCols.entry)),
      cartFee: num(get(salesRow, salesCols.cart)),
      proShop: num(get(salesRow, salesCols.proshop)),
      foodBeverage: num(get(salesRow, salesCols.food)),
      other: num(get(salesRow, salesCols.etc)),
      total: num(get(salesRow, salesCols.total)),
      teams,
      persons,
      avgPersonsPerTeam,
      uploadedAt: new Date().toISOString(),
    },
    error: null,
  };
}
