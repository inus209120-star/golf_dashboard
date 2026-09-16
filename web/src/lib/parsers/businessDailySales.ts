import * as XLSX from "xlsx";
import type { DailySalesDoc } from "@/types/firestore";

export interface BusinessSalesParseResult {
  doc: DailySalesDoc | null;
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
 * Parses the "영업현황" 매출 sub-table (입장료/카트료/프로샵/식음료/기타/
 * 총매출) "일계" row out of 무노스 "종합영업일보" exports - see dailyVisitors.ts
 * for the sibling parser that reads the same file's 팀수/인원 sub-table.
 *
 * Each file covers exactly one 영업일자, so unlike the old (now removed)
 * 일일영업집계 parser there's no multi-day range to guard against.
 *
 * Category mapping into DailySalesDoc (2026-09-16 decision): this report
 * has no separate 대여료(rental) line - it's a minor category, so by
 * agreement DailySalesDoc dropped the rentalFee field entirely rather than
 * guessing where it's folded in.
 */
export function parseBusinessDailySalesFile(buffer: ArrayBuffer): BusinessSalesParseResult {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:A1");
  const get = mergedGrid(sheet);

  let date: string | null = null;
  for (let r = range.s.r; r <= Math.min(range.e.r, 5); r++) {
    const m = String(get(r, 0) ?? "").match(DATE_RE);
    if (m) {
      date = `${m[1]}-${m[2]}-${m[3]}`;
      break;
    }
  }
  if (!date) {
    return { doc: null, error: "영업일자를 찾을 수 없음 - 파일 형식을 확인하세요" };
  }

  // "매출" section marker cell, disambiguated by requiring 입장료 AND 카트료
  // somewhere later in the same row (the "결제"/현금·신용카드 sub-table
  // right below shares no text with this one, but being explicit here
  // protects against future template changes).
  let hdrRow = -1;
  let muCol = -1;
  for (let r = range.s.r; r <= range.e.r && hdrRow === -1; r++) {
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
        hdrRow = r;
        muCol = c;
        break;
      }
    }
  }
  if (hdrRow === -1) {
    return { doc: null, error: '"매출"(입장료/카트료/...) 표를 찾을 수 없음 - 파일 형식을 확인하세요' };
  }

  function findCol(label: string): number {
    for (let cc = muCol + 1; cc <= Math.min(muCol + 20, range.e.c); cc++) {
      if (txt(get(hdrRow, cc)) === label) return cc;
    }
    return -1;
  }
  const cols = {
    entry: findCol("입장료"),
    cart: findCol("카트료"),
    proshop: findCol("프로샵"),
    food: findCol("식음료"),
    etc: findCol("기타"),
    total: findCol("총매출"),
  };
  for (const [label, col] of Object.entries(cols)) {
    if (col === -1) {
      return { doc: null, error: `"${label}" 열을 찾을 수 없음 - 파일 형식을 확인하세요` };
    }
  }

  let dataRow = -1;
  for (let r = hdrRow + 1; r <= Math.min(hdrRow + 4, range.e.r); r++) {
    if (txt(get(r, muCol)) === "일계") {
      dataRow = r;
      break;
    }
  }
  if (dataRow === -1) {
    return { doc: null, error: '"일계" 행을 찾을 수 없음 - 파일 형식을 확인하세요' };
  }

  return {
    doc: {
      date,
      greenFee: num(get(dataRow, cols.entry)),
      cartFee: num(get(dataRow, cols.cart)),
      proShop: num(get(dataRow, cols.proshop)),
      foodBeverage: num(get(dataRow, cols.food)),
      other: num(get(dataRow, cols.etc)),
      total: num(get(dataRow, cols.total)),
      uploadedAt: new Date().toISOString(),
    },
    error: null,
  };
}
