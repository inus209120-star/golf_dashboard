import * as XLSX from "xlsx";
import type { ReservationDoc } from "@/types/firestore";

export interface ParseResult<T> {
  docs: T[];
  recognized: number;
  total: number;
  skipped: string[];
}

/**
 * Parses 무노스 "예약현황(일별집계)" .xls exports.
 *
 * Real sample structure (verified against an actual export): sheet has a
 * title row, a filter-description row, then a real header row starting
 * with "일자" - found by scanning rather than assuming a fixed row index,
 * since a different date-range filter could shift things by a row.
 * 일자 is stored as literal text "YYYYMMDD", not a real date cell.
 */
export function parseReservationFile(buffer: ArrayBuffer): ParseResult<ReservationDoc> {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  const headerRowIndex = rows.findIndex((row) => String(row?.[0] ?? "").trim() === "일자");
  if (headerRowIndex === -1) {
    return { docs: [], recognized: 0, total: 0, skipped: ["헤더 행('일자')을 찾을 수 없음 - 파일 형식을 확인하세요"] };
  }

  const docs: ReservationDoc[] = [];
  const skipped: string[] = [];
  let total = 0;

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    const rawDate = row?.[0];
    if (rawDate === null || rawDate === undefined || String(rawDate).trim() === "") continue; // blank separator row, not an error
    total++;

    const dateStr = String(rawDate).trim();
    if (!/^\d{8}$/.test(dateStr)) {
      skipped.push(`행 ${i + 1}: 일자 형식이 YYYYMMDD가 아님 ("${dateStr}")`);
      continue;
    }
    const date = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
    const n = (v: unknown) => Number(v ?? 0) || 0;

    docs.push({
      date,
      dayOfWeek: String(row[1] ?? ""),
      totalSlots: n(row[2]),
      session1Bookings: n(row[3]),
      session2Bookings: n(row[4]),
      session3Bookings: n(row[5]),
      totalBookings: n(row[6]),
      session1Remaining: n(row[7]),
      session2Remaining: n(row[8]),
      session3Remaining: n(row[9]),
      totalRemaining: n(row[10]),
      internetBookings: n(row[11]),
      mobileBookings: n(row[12]),
      phoneBookings: n(row[13]),
      otherBookings: n(row[14]),
      memberCount0900: n(row[15]),
      memberCount1700: n(row[16]),
      memberIncrease: n(row[17]),
      uploadedAt: new Date().toISOString(),
    });
  }

  return { docs, recognized: docs.length, total, skipped };
}
