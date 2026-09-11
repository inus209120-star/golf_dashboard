import * as XLSX from "xlsx";
import type { DailySalesDoc } from "@/types/firestore";

export interface SalesParseResult {
  doc: DailySalesDoc | null;
  error: string | null;
  /** true when the file's own "영업일자" range covers more than one day -
   * the report was very likely re-run with the wrong date filter. */
  isMultiDay: boolean;
  rangeStart: string | null;
  rangeEnd: string | null;
}

const LABELS = ["그린피", "카트료", "대여료", "식음매출", "상품매출", "기타매출", "매출합계"] as const;

function mergedGet(sheet: XLSX.WorkSheet, r: number, c: number): unknown {
  const merges = sheet["!merges"] ?? [];
  for (const m of merges) {
    if (r >= m.s.r && r <= m.e.r && c >= m.s.c && c <= m.e.c) {
      const cell = sheet[XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c })];
      return cell?.v ?? null;
    }
  }
  const cell = sheet[XLSX.utils.encode_cell({ r, c })];
  return cell?.v ?? null;
}

function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0) || 0;
}

function findDateRange(sheet: XLSX.WorkSheet, range: XLSX.Range): { start: string | null; end: string | null } {
  const re = /영업일자\s*:?\s*(\d{4})년\s*(\d{2})월\s*(\d{2})일\s*~\s*(\d{4})년\s*(\d{2})월\s*(\d{2})일/;
  for (let r = range.s.r; r <= Math.min(range.e.r, 10); r++) {
    const text = String(mergedGet(sheet, r, 0) ?? "");
    const m = text.match(re);
    if (m) {
      return {
        start: `${m[1]}-${m[2]}-${m[3]}`,
        end: `${m[4]}-${m[5]}-${m[6]}`,
      };
    }
  }
  return { start: null, end: null };
}

/**
 * Parses 무노스 "일일영업집계" .xls exports - specifically only the
 * "매출 집계" sub-table (하루치 그린피/카트료/대여료/식음/상품/기타매출 +
 * 매출합계), per PRD.md §2.2 decision to skip the other 4 sub-tables
 * (그린피 단가별 팀수, 업장별, 부서별, 카드사별) in phase 1.
 *
 * The report packs 5 sub-tables into one sheet with heavy cell merging,
 * and this sub-table's exact row/column position isn't confirmed for a
 * genuine 1-day export (only verified against the whole-month sample in
 * PRD.md §2.2) - so this scans for the header row by text match (그린피 +
 * 카트료 + 대여료 co-occurring, which only that one sub-table has) rather
 * than a fixed cell address, and reads the row directly below it.
 * NEEDS VALIDATION against a real single-day export before going live.
 *
 * The file states its own query range as "영업일자 : YYYY년MM월DD일 ~
 * YYYY년MM월DD일" - when start == end that's used as the date directly;
 * a wider range almost certainly means the field re-ran the report with
 * the wrong filter, so the caller must resolve that (the parser flags it
 * via `isMultiDay` rather than silently guessing a date).
 */
export function parseDailySalesFile(buffer: ArrayBuffer): SalesParseResult {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:A1");

  const { start, end } = findDateRange(sheet, range);
  if (!start || !end) {
    return { doc: null, error: "영업일자 범위를 찾을 수 없음 - 파일 형식을 확인하세요", isMultiDay: false, rangeStart: null, rangeEnd: null };
  }
  if (start !== end) {
    return { doc: null, error: null, isMultiDay: true, rangeStart: start, rangeEnd: end };
  }

  let headerRow = -1;
  for (let r = range.s.r; r <= range.e.r; r++) {
    const rowText = new Set<string>();
    for (let c = range.s.c; c <= range.e.c; c++) {
      const v = String(mergedGet(sheet, r, c) ?? "").trim();
      if (v) rowText.add(v);
    }
    if (rowText.has("그린피") && rowText.has("카트료") && rowText.has("대여료") && rowText.has("매출합계")) {
      headerRow = r;
      break;
    }
  }

  if (headerRow === -1) {
    return { doc: null, error: "매출집계(그린피/카트료/대여료/매출합계) 헤더를 찾을 수 없음 - 파일 형식을 확인하세요", isMultiDay: false, rangeStart: start, rangeEnd: end };
  }

  // "그린피" alone is ambiguous - it's also a column header in the unrelated
  // 그린피 단가별(구간별) 팀수 sub-table earlier in the same row. "카트료" only
  // ever appears in this 매출 집계 sub-table, so anchor on it first and then
  // pick each label's occurrence NEAREST to that anchor column, rather than
  // the first (leftmost) match in the row.
  function allCols(label: string): number[] {
    const cols: number[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      if (String(mergedGet(sheet, headerRow, c) ?? "").trim() === label) cols.push(c);
    }
    return cols;
  }
  const kartCols = allCols("카트료");
  if (kartCols.length === 0) {
    return { doc: null, error: '"카트료" 항목을 헤더 행에서 찾을 수 없음', isMultiDay: false, rangeStart: start, rangeEnd: end };
  }
  const anchorCol = kartCols[0];

  const values: Partial<Record<(typeof LABELS)[number], number>> = {};
  for (const label of LABELS) {
    const cols = allCols(label);
    if (cols.length === 0) {
      return { doc: null, error: `"${label}" 항목을 헤더 행에서 찾을 수 없음`, isMultiDay: false, rangeStart: start, rangeEnd: end };
    }
    const col = cols.reduce((best, c) => (Math.abs(c - anchorCol) < Math.abs(best - anchorCol) ? c : best));
    values[label] = num(mergedGet(sheet, headerRow + 1, col));
  }

  return {
    doc: {
      date: start,
      greenFee: values["그린피"]!,
      cartFee: values["카트료"]!,
      rentalFee: values["대여료"]!,
      foodBeverage: values["식음매출"]!,
      proShop: values["상품매출"]!,
      other: values["기타매출"]!,
      total: values["매출합계"]!,
      uploadedAt: new Date().toISOString(),
    },
    error: null,
    isMultiDay: false,
    rangeStart: start,
    rangeEnd: end,
  };
}
