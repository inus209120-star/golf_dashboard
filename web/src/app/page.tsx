import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/collections";
import type {
  ReservationDoc,
  DailyVisitorDoc,
  DailySalesDoc,
  MonthlySalesDoc,
  CashFlowDoc,
  GreenFeeRatesDoc,
  WeatherCacheDoc,
} from "@/types/firestore";
import DashboardClient from "./DashboardClient";
import { fetchAndCacheWeather } from "@/lib/weather";

const WEATHER_STALE_MS = 3 * 60 * 60 * 1000; // KMA 단기예보 재발표 주기(3시간)

// This page must never be statically prerendered at build time - it reads
// live Firestore data (uploaded on a schedule the build has no knowledge
// of), so every request needs a fresh fetch.
export const dynamic = "force-dynamic";

function ymFromDate(date: string): string {
  return date.slice(0, 7); // "YYYY-MM-DD" -> "YYYY-MM"
}
function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function loadData() {
  const [reservationsSnap, cashFlowSnap, dailySalesSnap, dailyVisitorsSnap, monthlySalesSnap] = await Promise.all([
    adminDb.collection(COLLECTIONS.reservations).get(),
    adminDb.collection(COLLECTIONS.cashFlow).get(),
    adminDb.collection(COLLECTIONS.dailySales).get(),
    adminDb.collection(COLLECTIONS.dailyVisitors).get(),
    adminDb.collection(COLLECTIONS.monthlySales).get(),
  ]);

  const reservations = reservationsSnap.docs.map((d) => d.data() as ReservationDoc).sort((a, b) => a.date.localeCompare(b.date));
  const cashFlows = cashFlowSnap.docs.map((d) => d.data() as CashFlowDoc).sort((a, b) => a.date.localeCompare(b.date));
  // A handful of dailySales docs predate the 2026-09-16 switch to 종합영업일보
  // (old 일일영업집계 parser) and still carry its since-removed "rentalFee"
  // field - drop those rather than let them masquerade as real single-day
  // figures (one such doc, 2026-08-31, actually holds that whole month's
  // total under one date, which corrupts both the 최근 영업일 상세 table and
  // the 기간 검색's "is this month already covered by daily data" check).
  const dailySales = dailySalesSnap.docs
    .map((d) => d.data())
    .filter((d) => !("rentalFee" in d))
    .map((d) => d as DailySalesDoc)
    .sort((a, b) => a.date.localeCompare(b.date));
  const dailyVisitors = dailyVisitorsSnap.docs.map((d) => d.data() as DailyVisitorDoc).sort((a, b) => a.date.localeCompare(b.date));
  const monthlySales = monthlySalesSnap.docs.map((d) => d.data() as MonthlySalesDoc).sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));

  // Show whichever month actually has reservation data, most recent first -
  // real deployments won't always have "this month" uploaded yet.
  const latestReservationMonth = reservations.length ? ymFromDate(reservations[reservations.length - 1].date) : null;
  const reservationsForMonth = latestReservationMonth
    ? reservations.filter((r) => ymFromDate(r.date) === latestReservationMonth)
    : [];

  const latestCashFlow = cashFlows.length ? cashFlows[cashFlows.length - 1] : null;
  const latestDailySales = dailySales.length ? dailySales[dailySales.length - 1] : null;

  const todayYm = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const nextYm = shiftMonth(todayYm, 1);
  const [greenFeeAllSnap, weatherSnap] = await Promise.all([
    adminDb.collection(COLLECTIONS.greenFeeRates).get(),
    adminDb.collection(COLLECTIONS.weatherCache).doc("current").get(),
  ]);
  const greenFeeAll = greenFeeAllSnap.docs
    .map((d) => d.data() as GreenFeeRatesDoc)
    .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));

  let weather = weatherSnap.exists ? (weatherSnap.data() as WeatherCacheDoc) : null;
  const isStale = !weather || Date.now() - new Date(weather.fetchedAt).getTime() > WEATHER_STALE_MS;
  if (isStale) {
    try {
      weather = await fetchAndCacheWeather();
    } catch (err) {
      // Keep serving whatever's cached (possibly null) rather than fail the whole
      // dashboard load over a transient KMA API hiccup - log for now, surface a
      // proper "연동 오류" status to the UI later if this keeps happening.
      console.error("weather refresh failed:", err);
    }
  }

  return {
    reservations, // full history - used for cross-collection joins (RevPAR, recent-days table)
    reservationsForMonth,
    reservationMonth: latestReservationMonth,
    dailyVisitors,
    dailySales,
    latestDailySales,
    monthlySales, // 일별 데이터가 없는 과거 월(예: 2026년 1~8월) 백필용 - monthlyTrend 참고
    cashFlows, // full history - lets the Dashboard overview's date strip look up any past day
    latestCashFlow,
    greenFeeAll,
    greenFeeCurrentYm: todayYm,
    greenFeeNextYm: nextYm,
    weather,
  };
}

export default async function Home() {
  const data = await loadData();
  return <DashboardClient {...data} />;
}
