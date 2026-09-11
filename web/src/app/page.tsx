import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/collections";
import type {
  ReservationDoc,
  DailySalesDoc,
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
  const [reservationsSnap, cashFlowSnap, dailySalesSnap] = await Promise.all([
    adminDb.collection(COLLECTIONS.reservations).get(),
    adminDb.collection(COLLECTIONS.cashFlow).get(),
    adminDb.collection(COLLECTIONS.dailySales).get(),
  ]);

  const reservations = reservationsSnap.docs.map((d) => d.data() as ReservationDoc).sort((a, b) => a.date.localeCompare(b.date));
  const cashFlows = cashFlowSnap.docs.map((d) => d.data() as CashFlowDoc).sort((a, b) => a.date.localeCompare(b.date));
  const dailySales = dailySalesSnap.docs.map((d) => d.data() as DailySalesDoc).sort((a, b) => a.date.localeCompare(b.date));

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
    dailySales,
    latestDailySales,
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
