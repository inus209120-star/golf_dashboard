import * as XLSX from "xlsx";
import type { CashFlowDoc, CashFlowBank, CashFlowLineItem } from "@/types/firestore";
import type { ParseResult } from "./reservation";

// Column layout is fixed by the 더존 자금일보 template (verified identical
// across all 21 real daily sheets in the August sample) - 0-indexed:
// A name-group(merged) | ... | C/D item name | E 전일 | F 입금 | G 대체입 | H 대체출 | I 출금 | J 금일
const COL = { NAME: 2, PREV: 4, DEPOSIT: 5, TRANSFER_IN: 6, TRANSFER_OUT: 7, WITHDRAWAL: 8, TODAY: 9 };
const DETAIL_COL = { LABEL: 11, DESC: 12, AMOUNT: 13 }; // L / M / N

const SUBTOTAL_NAMES = new Set(["보통예금계", "예적금계", "총합계", "구    분"]);

function mergedGrid(sheet: XLSX.WorkSheet) {
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:A1");
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

function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0) || 0;
}

function stripAccountNumber(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/**
 * Parses one sheet of a 더존 "자금일보" .xlsx export (one business day per
 * sheet, sheet name "MMDD"). Skips any sheet whose name isn't a 4-digit
 * MMDD (e.g. an ad-hoc "8월 28일" detail sheet some months carry) - per
 * PRD.md §8.1, those are reported as skipped rather than guessed at.
 */
export function parseCashFlowFile(buffer: ArrayBuffer): ParseResult<CashFlowDoc> {
  const wb = XLSX.read(buffer, { type: "array" });
  const docs: CashFlowDoc[] = [];
  const skipped: string[] = [];
  let total = 0;

  for (const sheetName of wb.SheetNames) {
    if (!/^\d{4}$/.test(sheetName)) {
      skipped.push(`시트 "${sheetName}": MMDD 형식이 아니라 자동 인식 제외 (수동 확인 필요)`);
      continue;
    }
    total++;
    const sheet = wb.Sheets[sheetName];
    const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:A1");
    const get = mergedGrid(sheet);

    // Find the title row ("YYYY년 M월 D일(요일)") to derive the date, the real
    // column-header row (last "전일" in the 전일/입금/.../금일 header, since it's
    // duplicated across two merged rows), and the 총합계 row - all located by
    // scanning rather than assuming fixed row indices, since a wide title merge
    // can otherwise be mistaken for a data row.
    let dateStr: string | null = null;
    let headerRowIdx = -1;
    let totalRowIdx = -1;
    for (let r = range.s.r; r <= range.e.r; r++) {
      const a = String(get(r, 0) ?? "");
      const m = a.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
      if (m) dateStr = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
      if (String(get(r, COL.PREV) ?? "").trim() === "전일") headerRowIdx = r;
      const name = String(get(r, COL.NAME) ?? "").trim();
      if (name === "총합계") totalRowIdx = r;
    }

    if (!dateStr || headerRowIdx === -1 || totalRowIdx === -1) {
      skipped.push(`시트 "${sheetName}": 날짜/헤더/총합계 행을 찾을 수 없음 - 형식 확인 필요`);
      continue;
    }

    const banks: CashFlowBank[] = [];
    for (let r = headerRowIdx + 1; r < totalRowIdx; r++) {
      const rawName = String(get(r, COL.NAME) ?? "").trim();
      if (!rawName || SUBTOTAL_NAMES.has(rawName)) continue;
      const prevBalance = get(r, COL.PREV);
      if (prevBalance === null || prevBalance === undefined) continue; // spacer row, not a real line item
      banks.push({
        name: stripAccountNumber(rawName),
        prevBalance: num(prevBalance),
        deposit: num(get(r, COL.DEPOSIT)) + num(get(r, COL.TRANSFER_IN)),
        withdrawal: num(get(r, COL.WITHDRAWAL)) + num(get(r, COL.TRANSFER_OUT)),
        todayBalance: num(get(r, COL.TODAY)),
      });
    }

    // The 입금상세 panel on the right doesn't share the left bank table's row
    // layout - its own header labels ("전일실적"/"적요"/"기초이월") end and real
    // items start one or two rows earlier, so anchor on the first rotated
    // "입" (입금) label rather than reusing headerRowIdx.
    let firstDetailRowIdx = -1;
    for (let r = range.s.r; r <= range.e.r; r++) {
      if (String(get(r, DETAIL_COL.LABEL) ?? "").trim().startsWith("입")) { firstDetailRowIdx = r; break; }
    }
    const depositDetails: CashFlowLineItem[] = [];
    const withdrawalDetails: CashFlowLineItem[] = [];
    let section: "deposit" | "withdrawal" = "deposit";
    for (let r = firstDetailRowIdx; r >= 0 && r <= range.e.r; r++) {
      const desc = String(get(r, DETAIL_COL.DESC) ?? "").trim();
      if (!desc) continue;
      if (desc.startsWith("ⓐ")) { section = "withdrawal"; continue; }
      if (desc.startsWith("ⓑ") || desc.startsWith("ⓐ-ⓑ") || desc.includes("차액")) break;
      const item = { description: desc, amount: num(get(r, DETAIL_COL.AMOUNT)) };
      (section === "deposit" ? depositDetails : withdrawalDetails).push(item);
    }

    // Unlike individual banks, the grand total never needs 대체입/대체출 folded
    // in: every internal transfer out of one of our own accounts is a transfer
    // into another one, so 대체입 total == 대체출 total by construction and they
    // cancel - "입금"/"출금" alone already match the report's own "ⓐ/ⓑ 소계" and
    // the itemized deposit/withdrawal detail lists below.
    docs.push({
      date: dateStr,
      prevBalance: num(get(totalRowIdx, COL.PREV)),
      deposit: num(get(totalRowIdx, COL.DEPOSIT)),
      withdrawal: num(get(totalRowIdx, COL.WITHDRAWAL)),
      todayBalance: num(get(totalRowIdx, COL.TODAY)),
      banks,
      depositDetails,
      withdrawalDetails,
      uploadedAt: new Date().toISOString(),
    });
  }

  return { docs, recognized: docs.length, total, skipped };
}
