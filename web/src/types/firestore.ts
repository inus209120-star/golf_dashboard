// Firestore document shapes. One file per PRD.md §4 collection so the
// upload parser, the API routes, and the dashboard all agree on the
// same shape. Every collection is keyed by a human-readable date-based
// doc id (not auto-ids) so re-uploads overwrite the same day cleanly.

/** reservations/{date} — date = "YYYY-MM-DD". Source: 무노스 예약현황(일별집계). */
export interface ReservationDoc {
  date: string;
  dayOfWeek: string; // 요일, e.g. "화"
  totalSlots: number; // 전체타임
  session1Bookings: number; // 1부예약수
  session2Bookings: number; // 2부예약수
  session3Bookings: number; // 3부예약수
  totalBookings: number; // 예약합계
  session1Remaining: number; // 1부잔여수
  session2Remaining: number; // 2부잔여수
  session3Remaining: number; // 3부잔여수
  totalRemaining: number; // 잔여합계
  internetBookings: number;
  mobileBookings: number;
  phoneBookings: number;
  otherBookings: number;
  memberCount0900: number; // 09:00 회원수 (누적)
  memberCount1700: number; // 17:00 회원수 (누적)
  memberIncrease: number; // 회원증가수
  uploadedAt: string; // ISO timestamp
}

/** dailySales/{date} — date = "YYYY-MM-DD". Source: 무노스 일일영업집계 (매출집계 6항목만). */
export interface DailySalesDoc {
  date: string;
  greenFee: number; // 그린피
  cartFee: number; // 카트료
  rentalFee: number; // 대여료
  foodBeverage: number; // 식음매출
  proShop: number; // 상품매출
  other: number; // 기타매출
  total: number; // 매출합계 (합산값, 검증용으로도 저장)
  uploadedAt: string;
}

/** cashFlow/{date} — date = "YYYY-MM-DD", 영업일만 존재 (주말은 문서 자체가 없음). Source: 더존 자금일보. */
export interface CashFlowBank {
  name: string; // 은행명 (계좌번호는 저장하지 않음 - 민감정보 최소화)
  prevBalance: number;
  deposit: number;
  withdrawal: number;
  todayBalance: number;
}

export interface CashFlowLineItem {
  description: string;
  amount: number;
}

export interface CashFlowDoc {
  date: string;
  prevBalance: number; // 전일 총합계
  deposit: number; // 입금 총합계
  withdrawal: number; // 출금 총합계
  todayBalance: number; // 금일 총합계
  banks: CashFlowBank[];
  depositDetails: CashFlowLineItem[]; // 입금 상세
  withdrawalDetails: CashFlowLineItem[]; // 출금 상세
  uploadedAt: string;
}

/** greenFeeRates/{yearMonth} — yearMonth = "YYYY-MM". 현장 수기 입력 + 대표님 승인. */
export interface GreenFeeSession1Row {
  timeLabel: string; // e.g. "첫팀~06:22"
  weekday: number;
  saturday: number;
  sundayHoliday: number;
}

export interface GreenFeeSession3Row {
  timeLabel: string; // e.g. "16:15~17:39"
  monThu: number; // 3부만 요일군이 다름: 월~목
  friSat: number; // 금·토
  sundayHoliday: number;
}

export interface GreenFeeException {
  date: string; // "YYYY-MM-DD"
  note: string; // e.g. "추석당일 휴장", "주중요금 적용"
  closed: boolean;
}

export type GreenFeeStatus = "draft" | "pending" | "approved";

export interface GreenFeeRatesDoc {
  yearMonth: string;
  session1: GreenFeeSession1Row[]; // 3개 시간대
  session2: { weekday: number; saturday: number; sundayHoliday: number }; // 전타임 1개
  session3: GreenFeeSession3Row[]; // 2개 시간대, 요일군 다름
  cartFee: number; // 팀당 정액
  caddieFee: number; // 전 부 공통 정액
  exceptions: GreenFeeException[];
  status: GreenFeeStatus;
  submittedAt: string | null;
  approvedAt: string | null;
}

/** greenFeeApprovals/{autoId} — append-only 제출/승인 이력 (전자결재 로그). */
export interface GreenFeeApprovalDoc {
  yearMonth: string;
  submittedAt: string;
  status: "pending" | "approved" | "rejected";
  approvedAt: string | null;
  note: string | null;
}

/** weatherCache/current — 기상청 단기예보 API 응답 캐시, 단일 문서. */
export interface WeatherForecastItem {
  day: string;
  tempLow: number;
  tempHigh: number;
  pop: number; // 강수확률 %
}

export interface WeatherCacheDoc {
  fetchedAt: string;
  temp: number;
  desc: string;
  pop: number;
  forecast: WeatherForecastItem[];
}

/** Upload result summary written alongside each parsed upload, so the
 * upload page can show "N개 시트 중 M개 인식됨" without re-parsing. */
export interface UploadLogDoc {
  kind: "cashFlow" | "dailySales" | "reservation";
  uploadedAt: string;
  fileName: string;
  recognized: number;
  total: number;
  skipped: string[]; // e.g. sheet names that didn't match the expected pattern
}
