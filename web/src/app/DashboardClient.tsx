"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ReservationDoc,
  DailyVisitorDoc,
  DailySalesDoc,
  CashFlowDoc,
  GreenFeeRatesDoc,
  WeatherCacheDoc,
} from "@/types/firestore";

interface Props {
  reservations: ReservationDoc[];
  reservationsForMonth: ReservationDoc[];
  reservationMonth: string | null;
  dailyVisitors: DailyVisitorDoc[];
  dailySales: DailySalesDoc[];
  latestDailySales: DailySalesDoc | null;
  cashFlows: CashFlowDoc[];
  latestCashFlow: CashFlowDoc | null;
  greenFeeAll: GreenFeeRatesDoc[];
  greenFeeCurrentYm: string;
  greenFeeNextYm: string;
  weather: WeatherCacheDoc | null;
}

type View = "dashboard" | "sales" | "reservation" | "cash" | "greenfee" | "weather";

const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)", "var(--series-6)"];

function fmtWon(n: number): string {
  const neg = n < 0;
  return (neg ? "-" : "") + "₩" + Math.round(Math.abs(n)).toLocaleString("ko-KR");
}
function fmtCompact(n: number): string {
  if (n >= 100000000) return (n / 100000000).toFixed(1) + "억";
  if (n >= 10000) return Math.round(n / 10000).toLocaleString("ko-KR") + "만";
  return String(Math.round(n));
}
function fmtWrnTime(tm: string): string {
  // "YYYYMMDDHHmm" -> "MM/DD HH:mm"
  if (!/^\d{12}$/.test(tm)) return tm;
  return `${tm.slice(4, 6)}/${tm.slice(6, 8)} ${tm.slice(8, 10)}:${tm.slice(10, 12)}`;
}
function fmtShare(value: number, total: number): string {
  if (total <= 0) return "0%";
  const pct = (value / total) * 100;
  const rounded = Math.round(pct);
  return (rounded === 0 && pct > 0 ? "<1" : String(rounded)) + "%";
}

function salesCategories(doc: DailySalesDoc | null) {
  if (!doc) return [];
  return [
    { name: "그린피", value: doc.greenFee, color: SERIES[0] },
    { name: "카트료", value: doc.cartFee, color: SERIES[1] },
    { name: "식음매출", value: doc.foodBeverage, color: SERIES[3] },
    { name: "상품매출", value: doc.proShop, color: SERIES[4] },
    { name: "기타매출", value: doc.other, color: SERIES[5] },
  ];
}
function sumSales(docs: DailySalesDoc[]): DailySalesDoc | null {
  if (docs.length === 0) return null;
  return docs.reduce((acc, d) => ({
    date: acc.date,
    greenFee: acc.greenFee + d.greenFee,
    cartFee: acc.cartFee + d.cartFee,
    foodBeverage: acc.foodBeverage + d.foodBeverage,
    proShop: acc.proShop + d.proShop,
    other: acc.other + d.other,
    total: acc.total + d.total,
    uploadedAt: acc.uploadedAt,
  }));
}
function donutGradient(cats: { value: number; color: string }[], total: number): string {
  if (total <= 0) return "conic-gradient(var(--pill-bg) 0% 100%)";
  let cum = 0;
  const stops = cats.map((c) => {
    const start = (cum / total) * 100;
    cum += c.value;
    const end = (cum / total) * 100;
    return `${c.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
  });
  return `conic-gradient(${stops.join(", ")})`;
}

function seqBucket(pct: number): { bg: string; dark: boolean } {
  if (pct < 15) return { bg: "var(--seq-0)", dark: false };
  if (pct < 30) return { bg: "var(--seq-1)", dark: false };
  if (pct < 45) return { bg: "var(--seq-2)", dark: false };
  if (pct < 60) return { bg: "var(--seq-3)", dark: false };
  if (pct < 75) return { bg: "var(--seq-4)", dark: true };
  if (pct < 90) return { bg: "var(--seq-5)", dark: true };
  return { bg: "var(--seq-6)", dark: true };
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function shiftDay(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

const SideIcon = {
  dashboard: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.8"/><rect x="13" y="3" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.8"/><rect x="3" y="13" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.8"/><rect x="13" y="13" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.8"/></svg>
  ),
  sales: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M5 20V10M12 20V4M19 20v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
  ),
  reservation: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><rect x="4" y="5" width="16" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.8"/><path d="M4 9.5h16M8 3v3.4M16 3v3.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
  ),
  cash: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><rect x="3" y="7" width="18" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.8"/><path d="M3 10h18" stroke="currentColor" strokeWidth="1.8"/><circle cx="16.5" cy="14.5" r="1.3" fill="currentColor"/></svg>
  ),
  greenfee: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M6 21V4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M6 5h12l-3 3.4L18 11.8H6" fill="currentColor"/></svg>
  ),
  weather: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.5" fill="currentColor"/><g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M12 2v2.5"/><path d="M12 19.5V22"/><path d="M4.9 4.9l1.8 1.8"/><path d="M17.3 17.3l1.8 1.8"/><path d="M2 12h2.5"/><path d="M19.5 12H22"/><path d="M4.9 19.1l1.8-1.8"/><path d="M17.3 6.7l1.8-1.8"/></g></svg>
  ),
};

export default function DashboardClient(props: Props) {
  const {
    reservations, reservationsForMonth, reservationMonth, dailyVisitors, dailySales, latestDailySales,
    cashFlows, latestCashFlow, greenFeeAll, greenFeeCurrentYm, greenFeeNextYm, weather,
  } = props;

  const [view, setView] = useState<View>("dashboard");
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const [rangeEnd, setRangeEnd] = useState<string | null>(null);
  const [selectedYm, setSelectedYm] = useState(greenFeeCurrentYm);
  const [gfYear, setGfYear] = useState(greenFeeCurrentYm.slice(0, 4));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [adj, setAdj] = useState({ p1: 0, p2: 0, p3: 0 });
  const [roundsOverride, setRoundsOverride] = useState<{ p1: number | null; p2: number | null; p3: number | null }>({ p1: null, p2: null, p3: null });
  const [approving, setApproving] = useState(false);
  const [textScale, setTextScale] = useState<"base" | "lg" | "xl">("base");
  const [dashDate, setDashDate] = useState(() => todayStr());

  // 노안 등 시력이 안 좋은 사용자를 위한 글자 크게 보기 - 기기별로 기억되도록 localStorage에 저장.
  // localStorage는 서버에 없으므로 초기 렌더는 항상 "base"로 서버/클라이언트를 일치시키고,
  // 하이드레이션 이후에만 저장된 값으로 갱신한다(그래서 setState-in-effect 룰은 여기선 의도된 예외).
  useEffect(() => {
    const saved = localStorage.getItem("textScale");
    if (saved === "lg" || saved === "xl") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- post-hydration localStorage sync, not a derived-state anti-pattern
      setTextScale(saved);
    }
  }, []);
  function cycleTextScale() {
    setTextScale((s) => {
      const next = s === "base" ? "lg" : s === "lg" ? "xl" : "base";
      localStorage.setItem("textScale", next);
      return next;
    });
  }
  const router = useRouter();

  async function approveGreenFee(ym: string) {
    setApproving(true);
    try {
      await fetch("/api/greenfee/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yearMonth: ym }),
      });
      router.refresh();
    } finally {
      setApproving(false);
    }
  }

  function go(v: View) {
    setView(v);
    setSelectedDay(null);
  }

  // Detail screens never change the URL, so the phone's hardware/gesture
  // back button had nothing to "undo" and just left the whole site instead
  // of returning to the summary screen. Fix: push exactly one history entry
  // when entering any detail screen (kept at depth 1 even when hopping
  // between detail screens via the tab bar), and treat a browser-back
  // (popstate) the same as tapping the in-app back button.
  const pushedHistoryRef = useRef(false);
  useEffect(() => {
    function onPopState() {
      pushedHistoryRef.current = false;
      setView("dashboard");
      setSelectedDay(null);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => {
    if (view === "dashboard") {
      if (pushedHistoryRef.current) {
        pushedHistoryRef.current = false;
        window.history.back();
      }
    } else if (!pushedHistoryRef.current) {
      window.history.pushState({ dashboardDetail: true }, "");
      pushedHistoryRef.current = true;
    }
  }, [view]);

  const today = todayStr();
  const reservationByDate = useMemo(() => new Map(reservations.map((r) => [r.date, r])), [reservations]);
  const visitorByDate = useMemo(() => new Map(dailyVisitors.map((v) => [v.date, v])), [dailyVisitors]);

  // ---- reservation calendar ----
  const calendarDays = useMemo(() => {
    if (!reservationMonth) return [];
    const [y, m] = reservationMonth.split("-").map(Number);
    const byDate = new Map(reservationsForMonth.map((r) => [r.date, r]));
    const firstDow = new Date(y, m - 1, 1).getDay();
    const daysInMonth = new Date(y, m, 0).getDate();
    const cells: { date: string | null; label: string; other: boolean; doc?: ReservationDoc }[] = [];
    for (let i = 0; i < firstDow; i++) cells.push({ date: null, label: "", other: true });
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells.push({ date, label: String(d), other: false, doc: byDate.get(date) });
    }
    return cells;
  }, [reservationMonth, reservationsForMonth]);

  const selectedReservation = selectedDay ? reservationsForMonth.find((r) => r.date === selectedDay) ?? null : null;
  const selectedVisitor = selectedDay ? visitorByDate.get(selectedDay) ?? null : null;

  const maxSlots = Math.max(1, ...reservationsForMonth.map((r) => r.totalSlots));
  const channelTotals = useMemo(() => {
    const totals = reservationsForMonth.reduce(
      (a, r) => ({
        internet: a.internet + r.internetBookings,
        mobile: a.mobile + r.mobileBookings,
        phone: a.phone + r.phoneBookings,
        other: a.other + r.otherBookings,
      }),
      { internet: 0, mobile: 0, phone: 0, other: 0 }
    );
    const total = totals.internet + totals.mobile + totals.phone + totals.other;
    return [
      { name: "인터넷", value: totals.internet, color: SERIES[0] },
      { name: "모바일", value: totals.mobile, color: SERIES[2] },
      { name: "전화", value: totals.phone, color: SERIES[3] },
      { name: "기타", value: totals.other, color: SERIES[4] },
    ].map((c) => ({ ...c, total }));
  }, [reservationsForMonth]);
  const channelTotal = channelTotals[0]?.total ?? 0;

  // ---- sales periods ----
  const latestSalesDate = latestDailySales?.date ?? null;
  const effectiveRangeEnd = rangeEnd ?? latestSalesDate;
  const effectiveRangeStart = rangeStart ?? (effectiveRangeEnd ? shiftDay(effectiveRangeEnd, -6) : null);
  const periodDocs = useMemo(() => {
    if (!effectiveRangeStart || !effectiveRangeEnd) return [];
    const [lo, hi] = effectiveRangeStart <= effectiveRangeEnd ? [effectiveRangeStart, effectiveRangeEnd] : [effectiveRangeEnd, effectiveRangeStart];
    return dailySales.filter((d) => d.date >= lo && d.date <= hi);
  }, [dailySales, effectiveRangeStart, effectiveRangeEnd]);
  const periodSum = sumSales(periodDocs);
  const periodLabel = "기간";
  const periodCats = salesCategories(periodSum);

  // KPI: 예약팀수 합계/가동률 평균 and 객단가(RevPAR) - joined against reservations by
  // date, since sales and reservation data don't necessarily share one "current month".
  const periodReservations = periodDocs.map((d) => reservationByDate.get(d.date)).filter((r): r is ReservationDoc => !!r);
  const periodRounds = periodReservations.reduce((a, r) => a + r.totalBookings, 0);
  const periodSlots = periodReservations.reduce((a, r) => a + r.totalSlots, 0);
  const periodOccPct = periodSlots > 0 ? Math.round((periodRounds / periodSlots) * 100) : null;
  const revpar = periodSum && periodRounds > 0
    ? (periodSum.greenFee + periodSum.foodBeverage + periodSum.cartFee) / periodRounds
    : null;

  const recentSalesRows = dailySales.slice(-10).reverse().map((d) => ({
    doc: d,
    resv: reservationByDate.get(d.date) ?? null,
  }));

  const monthlyTrend = useMemo(() => {
    const byMonth = new Map<string, number>();
    for (const d of dailySales) {
      const ym = d.date.slice(0, 7);
      byMonth.set(ym, (byMonth.get(ym) ?? 0) + d.total);
    }
    return Array.from(byMonth.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [dailySales]);
  const maxTrend = Math.max(1, ...monthlyTrend.map(([, v]) => v));

  // ---- greenfee simulation base rounds (avg of available reservation days) ----
  const avgRounds = useMemo(() => {
    const n = reservationsForMonth.length || 1;
    const s1 = reservationsForMonth.reduce((a, r) => a + r.session1Bookings, 0) / n;
    const s2 = reservationsForMonth.reduce((a, r) => a + r.session2Bookings, 0) / n;
    const s3 = reservationsForMonth.reduce((a, r) => a + r.session3Bookings, 0) / n;
    return { p1: Math.round(s1), p2: Math.round(s2), p3: Math.round(s3) };
  }, [reservationsForMonth]);
  const rounds = {
    p1: roundsOverride.p1 ?? avgRounds.p1,
    p2: roundsOverride.p2 ?? avgRounds.p2,
    p3: roundsOverride.p3 ?? avgRounds.p3,
  };
  const impacts = {
    p1: adj.p1 * rounds.p1,
    p2: adj.p2 * rounds.p2,
    p3: adj.p3 * rounds.p3,
  };
  const totalImpact = impacts.p1 + impacts.p2 + impacts.p3;
  const maxAbsImpact = Math.max(1, Math.abs(impacts.p1), Math.abs(impacts.p2), Math.abs(impacts.p3));

  const greenFeeMap = useMemo(() => new Map(greenFeeAll.map((g) => [g.yearMonth, g])), [greenFeeAll]);
  const gf = greenFeeMap.get(selectedYm) ?? null;
  const gfYm = selectedYm;
  const gfYearsWithData = useMemo(() => {
    const years = new Set(greenFeeAll.map((g) => g.yearMonth.slice(0, 4)));
    years.add(greenFeeCurrentYm.slice(0, 4));
    return Array.from(years).sort();
  }, [greenFeeAll, greenFeeCurrentYm]);


  // ---- dashboard overview data ----
  // 5-day strip ending today (no future dates - this is a past-performance
  // dashboard, not a schedule), oldest first so "today" lands on the right.
  // Fixed at 5 slots sized to fill the row exactly (flex:1 each, no
  // scrolling) so "today" is always visible without swiping - an earlier
  // 14-day scrollable version auto-scrolled to the end on mount, but that
  // didn't reliably land on a real phone.
  const dashDays = useMemo(() => {
    const [ty, tm, td] = today.split("-").map(Number);
    const base = new Date(ty, tm - 1, td);
    const weekdayNames = ["일", "월", "화", "수", "목", "금", "토"];
    const days: { date: string; day: number; weekday: string }[] = [];
    for (let i = 4; i >= 0; i--) {
      const d = new Date(base);
      d.setDate(base.getDate() - i);
      days.push({
        date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
        day: d.getDate(),
        weekday: weekdayNames[d.getDay()],
      });
    }
    return days;
  }, [today]);

  const dashDailySales = dailySales.find((d) => d.date === dashDate) ?? null;
  const dashReservation = reservationByDate.get(dashDate) ?? null;
  const dashCashFlow = cashFlows.find((c) => c.date === dashDate) ?? null;
  const dashGreenFee = greenFeeMap.get(dashDate.slice(0, 7)) ?? null;
  const overviewCats = salesCategories(dashDailySales).sort((a, b) => b.value - a.value).slice(0, 3);
  const overviewTotal = dashDailySales?.total ?? 0;
  const occPct = dashReservation ? (dashReservation.totalBookings / (dashReservation.totalSlots || 1)) * 100 : null;
  const topBanks = (dashCashFlow?.banks ?? []).slice().sort((a, b) => b.todayBalance - a.todayBalance).slice(0, 2);
  const maxBank = Math.max(1, ...(dashCashFlow?.banks.map((b) => b.todayBalance) ?? [1]));

  return (
    <div className="app-shell" data-text-scale={textScale}>
      <div className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M6 3v18" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round"/><path d="M6 4h11l-3 3.2L17 10.4H6" fill="#ffffff"/></svg>
          </div>
          <div><div className="sidebar-brand-name">스톤게이트CC</div><div className="sidebar-brand-sub">대표 대시보드</div></div>
        </div>
        <button className={`side-item ${view === "dashboard" ? "active" : ""}`} onClick={() => go("dashboard")}>{SideIcon.dashboard}Dashboard</button>
        <button className={`side-item ${view === "sales" ? "active" : ""}`} onClick={() => go("sales")}>{SideIcon.sales}매출현황</button>
        <button className={`side-item ${view === "reservation" ? "active" : ""}`} onClick={() => go("reservation")}>{SideIcon.reservation}예약현황</button>
        <button className={`side-item ${view === "cash" ? "active" : ""}`} onClick={() => go("cash")}>{SideIcon.cash}자금현황</button>
        <button className={`side-item ${view === "greenfee" ? "active" : ""}`} onClick={() => go("greenfee")}>{SideIcon.greenfee}그린피 현황</button>
        <button className={`side-item ${view === "weather" ? "active" : ""}`} onClick={() => go("weather")}>{SideIcon.weather}날씨 현황</button>
      </div>

      <nav className="tabbar">
        <button className={`tab-item ${view === "sales" ? "active" : ""}`} onClick={() => go("sales")}><span className="tab-icon-badge" style={{ background: "var(--series-1)" }}>{SideIcon.sales}</span><span>매출</span></button>
        <button className={`tab-item ${view === "reservation" ? "active" : ""}`} onClick={() => go("reservation")}><span className="tab-icon-badge" style={{ background: "var(--series-3)" }}>{SideIcon.reservation}</span><span>예약</span></button>
        <button className={`tab-item ${view === "cash" ? "active" : ""}`} onClick={() => go("cash")}><span className="tab-icon-badge" style={{ background: "var(--navy)" }}>{SideIcon.cash}</span><span>자금</span></button>
        <button className={`tab-item ${view === "greenfee" ? "active" : ""}`} onClick={() => go("greenfee")}><span className="tab-icon-badge" style={{ background: "var(--green)" }}>{SideIcon.greenfee}</span><span>그린피</span></button>
        <button className={`tab-item ${view === "weather" ? "active" : ""}`} onClick={() => go("weather")}><span className="tab-icon-badge" style={{ background: "var(--series-4)" }}>{SideIcon.weather}</span><span>날씨</span></button>
      </nav>

      <div className="main-area">
        <div className="utility-bar">
          <div className="search-pill">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8"/><path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
            예약자 · 거래처 검색
          </div>
          <div className="util-right">
            <div className="today-label">{today}<br/>실시간 기준</div>
            <div className="util-icons">
              <button
                className={`icon-btn text-scale-btn ${textScale !== "base" ? "active" : ""}`}
                onClick={cycleTextScale}
                title="글자 크게 보기"
                aria-label="글자 크게 보기"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8"/><path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><path d="M11 8v6M8 11h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
              </button>
              <div className="icon-btn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 5h16v11H8l-4 4V5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg></div>
              <div className="avatar">대표</div>
            </div>
          </div>
        </div>

        {view === "dashboard" && (
          <>
            <div className="title-row">
              <div className="page-title">스톤게이트CC</div>
            </div>
            <div className="date-strip">
              {dashDays.map((d) => (
                <button
                  key={d.date}
                  className={`date-chip ${d.date === dashDate ? "active" : ""}`}
                  onClick={() => setDashDate(d.date)}
                >
                  <span className="date-chip-dow">{d.weekday}</span>
                  <span className="date-chip-day">{d.day}</span>
                </button>
              ))}
            </div>
            <div className="dash-grid">
              <button className="mini-card" onClick={() => go("sales")}>
                <div className="mini-card-head"><div className="mini-card-title">매출현황</div><div className="mini-chevron">›</div></div>
                {dashDailySales ? (
                  <div className="mini-donut-row">
                    <div className="mini-donut-wrap">
                      <div className="mini-donut" style={{ background: donutGradient(salesCategories(dashDailySales), overviewTotal) }} />
                      <div className="mini-donut-hole"><div className="mini-donut-total">{fmtCompact(overviewTotal)}</div></div>
                    </div>
                    <div className="mini-legend">
                      {overviewCats.map((c) => (
                        <div className="mini-legend-item" key={c.name}>
                          <span className="mini-legend-dot" style={{ background: c.color }} />
                          <span className="mini-legend-name">{c.name}</span>
                          <span className="mini-legend-value">{fmtShare(c.value, overviewTotal)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : <div className="day-detail-empty">아직 업로드된 매출 데이터가 없습니다</div>}
              </button>

              <button className="mini-card" onClick={() => go("reservation")}>
                <div className="mini-card-head"><div className="mini-card-title">예약현황</div><div className="mini-chevron">›</div></div>
                {dashReservation ? (
                  <div className="mini-resv-stat">
                    <div className="mini-resv-frac">{dashReservation.totalBookings}/{dashReservation.totalSlots}</div>
                    <div className="mini-resv-pct">{occPct!.toFixed(1)}%</div>
                  </div>
                ) : <div className="day-detail-empty">아직 업로드된 예약 데이터가 없습니다</div>}
              </button>

              <button className="mini-card" onClick={() => go("cash")}>
                <div className="mini-card-head"><div className="mini-card-title">자금현황</div><div className="mini-chevron">›</div></div>
                {dashCashFlow ? (
                  <>
                    <div className="mini-flow-row">
                      <div className="mini-line"><span>전일</span><b>{fmtCompact(dashCashFlow.prevBalance)}</b></div>
                      <div className="mini-line"><span>금일</span><b>{fmtCompact(dashCashFlow.todayBalance)}</b></div>
                    </div>
                    {topBanks.map((b) => (
                      <div className="bank-row" key={b.name}>
                        <div className="bank-name">{b.name}</div>
                        <div className="bank-track"><div className="bank-fill" style={{ width: `${Math.round((b.todayBalance / maxBank) * 100)}%` }} /></div>
                        <div className="bank-amt">{fmtCompact(b.todayBalance)}</div>
                      </div>
                    ))}
                  </>
                ) : <div className="day-detail-empty">아직 업로드된 자금 데이터가 없습니다</div>}
              </button>

              <button className="mini-card" onClick={() => go("greenfee")}>
                <div className="mini-card-head">
                  <div className="mini-card-title">그린피 현황</div>
                  <span className={`badge ${dashGreenFee?.status === "approved" ? "badge-good" : "badge-warning"}`}>
                    {dashGreenFee ? (dashGreenFee.status === "approved" ? "승인됨" : "승인 대기") : "미입력"}
                  </span>
                </div>
                {dashGreenFee ? (
                  <>
                    <div className="mini-line"><span>카트료 (팀당)</span><b>{dashGreenFee.cartFee.toLocaleString("ko-KR")}원</b></div>
                    <div className="mini-line"><span>캐디피 (전 부)</span><b>{dashGreenFee.caddieFee.toLocaleString("ko-KR")}원</b></div>
                  </>
                ) : <div className="day-detail-empty">{dashDate.slice(0, 7)} 요금표가 아직 없습니다</div>}
              </button>

              <button className="mini-card mini-card-wide" onClick={() => go("weather")}>
                <div className="mini-card-head"><div className="mini-card-title">날씨 현황</div><div className="mini-chevron">›</div></div>
                {weather ? (
                  <>
                    <div className="mini-weather-row">
                      <svg width="34" height="34" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="5" fill="var(--series-4)"/></svg>
                      <div><div className="mini-weather-temp">{weather.temp}°C</div><div className="weather-desc">{weather.desc}</div></div>
                    </div>
                    {weather.warnings.length > 0 && (
                      <div className="stat-delta" style={{ color: "var(--status-critical)", marginTop: 10 }}>⚠ {weather.warnings[0].regionName} {weather.warnings[0].type}{weather.warnings[0].level}</div>
                    )}
                  </>
                ) : <div className="day-detail-empty">날씨 연동이 아직 설정되지 않았습니다</div>}
              </button>
            </div>
          </>
        )}

        {view === "sales" && (
          <>
            <button className="back-btn" onClick={() => go("dashboard")}>‹ 스톤게이트CC</button>
            <div className="subheader"><div className="subheader-title">매출현황</div><div className="subheader-sub">무노스 종합영업일보 · 영업현황 매출 기준</div></div>
            <div className="card">
              {effectiveRangeStart && effectiveRangeEnd && (
                <div className="range-search-row">
                  <input
                    type="date"
                    className="day-search-input"
                    value={effectiveRangeStart}
                    max={todayStr()}
                    onChange={(e) => e.target.value && setRangeStart(e.target.value)}
                  />
                  <span className="range-search-sep">~</span>
                  <input
                    type="date"
                    className="day-search-input"
                    value={effectiveRangeEnd}
                    max={todayStr()}
                    onChange={(e) => e.target.value && setRangeEnd(e.target.value)}
                  />
                </div>
              )}
              {periodSum ? (
                <>
                  <div className="hero">{fmtWon(periodSum.total)}</div>
                  <div className="hero-delta">{periodDocs.length}일 합계 기준 ({periodDocs[0]?.date} ~ {periodDocs[periodDocs.length - 1]?.date})</div>
                </>
              ) : <div className="day-detail-empty">아직 업로드된 매출 데이터가 없습니다. /upload에서 종합영업일보를 업로드해주세요.</div>}
            </div>

            {periodSum && (
              <div className="kpi-row">
                <div className="kpi-card">
                  <div className="kpi-label">매출액</div>
                  <div className="kpi-value">{fmtCompact(periodSum.total)}</div>
                  <div className="kpi-sub">{periodLabel} 합계</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">객단가 (RevPAR)</div>
                  <div className="kpi-value">{revpar !== null ? fmtCompact(revpar) : "-"}</div>
                  <div className="kpi-sub">그린피+식음+카트료 ÷ 예약팀수</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">예약팀수 · 가동률</div>
                  <div className="kpi-value">{periodRounds.toLocaleString("ko-KR")}팀</div>
                  <div className="kpi-sub">{periodOccPct !== null ? `가동률 ${periodOccPct}%` : "예약 데이터 없음"}</div>
                </div>
              </div>
            )}

            {periodSum && (
              <div className="card">
                <div className="card-title">품목별 매출</div>
                <div className="card-sub">{periodLabel} 기준 비중</div>
                <div className="donut-row">
                  <div className="donut-wrap">
                    <div className="donut" style={{ background: donutGradient(periodCats, periodSum.total) }} />
                    <div className="donut-hole"><div className="donut-total">{fmtCompact(periodSum.total)}</div><div className="donut-sub">{periodLabel} 매출</div></div>
                  </div>
                  <div className="legend-list">
                    {periodCats.map((c) => (
                      <div className="legend-item" key={c.name}>
                        <span className="legend-dot" style={{ background: c.color }} />
                        <span className="legend-name">{c.name}</span>
                        <span className="legend-value">{fmtCompact(c.value)}</span>
                        <span className="legend-share">{fmtShare(c.value, periodSum.total)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="card">
              <div className="card-title">월간 매출 추이</div>
              <div className="card-sub">월별 매출 합계 (데이터가 쌓일수록 채워집니다)</div>
              {monthlyTrend.length ? (
                <div className="trend-bar-row">
                  {monthlyTrend.map(([ym, total]) => (
                    <div className="trend-bar-col" key={ym}>
                      <div className="trend-bar-value">{fmtCompact(total)}</div>
                      <div className="trend-bar" style={{ height: `${Math.max(2, (total / maxTrend) * 100)}%` }} />
                      <div className="trend-bar-label">{ym}</div>
                    </div>
                  ))}
                </div>
              ) : <div className="day-detail-empty">아직 데이터가 없습니다</div>}
            </div>

            <div className="card">
              <div className="card-title">최근 영업일 상세</div>
              <div className="card-sub">최근 업로드된 일자 기준</div>
              {recentSalesRows.length ? (
                <div className="table-scroll">
                <table className="cash-table">
                  <tbody>
                    <tr><th>일자</th><th>매출</th><th>예약팀수</th><th>가동률</th></tr>
                    {recentSalesRows.map(({ doc, resv }) => (
                      <tr key={doc.date}>
                        <td>{doc.date}</td>
                        <td>{doc.total.toLocaleString("ko-KR")}</td>
                        <td>{resv ? `${resv.totalBookings}팀` : "-"}</td>
                        <td>{resv ? `${Math.round((resv.totalBookings / (resv.totalSlots || 1)) * 100)}%` : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              ) : <div className="day-detail-empty">아직 업로드된 매출 데이터가 없습니다</div>}
            </div>
          </>
        )}

        {view === "reservation" && (
          <>
            <button className="back-btn" onClick={() => go("dashboard")}>‹ 스톤게이트CC</button>
            <div className="subheader">
              <div className="subheader-title">예약현황</div>
              <div className="subheader-sub">{reservationMonth ? `${reservationMonth} · 무노스 예약현황(일별집계)` : "데이터 없음"} · 날짜를 눌러 상세 확인</div>
            </div>
            <div className="card">
              {calendarDays.length ? (
                <>
                  <div className="dow-row">
                    <div className="dow-cell" style={{ color: "var(--status-critical)" }}>SUN</div>
                    <div className="dow-cell">MON</div><div className="dow-cell">TUE</div><div className="dow-cell">WED</div><div className="dow-cell">THU</div><div className="dow-cell">FRI</div>
                    <div className="dow-cell" style={{ color: "var(--series-1)" }}>SAT</div>
                  </div>
                  <div className="cal-grid">
                    {calendarDays.map((c, i) => {
                      if (c.other || !c.date) return <div className="cal-cell other-month" key={`o${i}`} />;
                      if (!c.doc) {
                        return (
                          <div className="cal-cell" style={{ background: "var(--pill-bg)" }} key={c.date}>
                            <div className="cal-day ink-text">{c.label}</div>
                            <div><div className="cal-pct ink-text">-</div></div>
                          </div>
                        );
                      }
                      const pct = Math.round((c.doc.totalBookings / (c.doc.totalSlots || 1)) * 100);
                      const { bg, dark } = seqBucket(pct);
                      const textClass = dark ? "white-text" : "ink-text";
                      const isToday = c.date === today;
                      const isSel = c.date === selectedDay;
                      return (
                        <button
                          className={`cal-cell ${isToday ? "is-today" : ""} ${isSel ? "is-selected" : ""}`}
                          style={{ background: bg }}
                          key={c.date}
                          onClick={() => setSelectedDay(c.date!)}
                        >
                          <div className={`cal-day ${textClass}`}>{c.label}</div>
                          <div>
                            <div className={`cal-frac ${textClass}`}>{c.doc.totalBookings}/{c.doc.totalSlots}</div>
                            <div className={`cal-pct ${textClass}`}>{pct}%</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : <div className="day-detail-empty">아직 업로드된 예약 데이터가 없습니다. /upload에서 예약현황(일별집계)를 업로드해주세요.</div>}
            </div>

            {reservationsForMonth.length > 0 && (
              <div className="card">
                <div className="card-title">일별 예약수 vs 잔여수</div>
                <div className="card-sub">{reservationMonth} · 전체타임 대비 비중</div>
                <div className="resv-chart-legend">
                  <div className="chart-legend-item" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-secondary)" }}><span style={{ width: 10, height: 10, borderRadius: 3, background: "var(--series-1)", display: "inline-block" }} />예약</div>
                  <div className="chart-legend-item" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-secondary)" }}><span style={{ width: 10, height: 10, borderRadius: 3, background: "var(--pill-bg)", border: "1px solid var(--divider)", display: "inline-block" }} />잔여</div>
                </div>
                <div className="resv-chart-row">
                  {reservationsForMonth.map((r) => {
                    const heightPct = Math.max(2, (r.totalSlots / maxSlots) * 100);
                    const bookedPct = r.totalSlots > 0 ? (r.totalBookings / r.totalSlots) * 100 : 0;
                    return (
                      <div className="resv-chart-col" key={r.date} title={`${r.date}: 예약 ${r.totalBookings} / 전체 ${r.totalSlots}`}>
                        <div className="resv-chart-stack" style={{ height: `${heightPct}%` }}>
                          <div className="resv-chart-remain" style={{ height: `${100 - bookedPct}%` }} />
                          <div className="resv-chart-booked" style={{ height: `${bookedPct}%` }} />
                        </div>
                        <div className="resv-chart-label">{r.date.slice(-2)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {channelTotal > 0 && (
              <div className="card">
                <div className="card-title">예약 채널별 비중</div>
                <div className="card-sub">{reservationMonth} 합계</div>
                <div className="donut-row">
                  <div className="donut-wrap">
                    <div className="donut" style={{ background: donutGradient(channelTotals, channelTotal) }} />
                    <div className="donut-hole"><div className="donut-total">{channelTotal.toLocaleString("ko-KR")}팀</div><div className="donut-sub">전체 예약</div></div>
                  </div>
                  <div className="legend-list">
                    {channelTotals.map((c) => (
                      <div className="legend-item" key={c.name}>
                        <span className="legend-dot" style={{ background: c.color }} />
                        <span className="legend-name">{c.name}</span>
                        <span className="legend-value">{c.value.toLocaleString("ko-KR")}팀</span>
                        <span className="legend-share">{fmtShare(c.value, channelTotal)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {dailyVisitors.length > 0 && (
              <div className="card">
                <div className="card-title">실제 내장 현황 (팀수/인원)</div>
                <div className="card-sub">종합영업일보 기준 · 최근 {Math.min(dailyVisitors.length, 14)}일</div>
                <div className="table-scroll">
                <table className="cash-table">
                  <tbody>
                    <tr><th>일자</th><th>요일</th><th>팀수</th><th>인원</th><th>팀당인원</th></tr>
                    {dailyVisitors.slice(-14).reverse().map((v) => (
                      <tr key={v.date}>
                        <td>{v.date}</td>
                        <td>{v.dayOfWeek}</td>
                        <td>{v.teams}팀</td>
                        <td>{v.persons}명</td>
                        <td>{v.avgPersonsPerTeam.toFixed(2)}명</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            )}

            <div className="card">
              {!selectedReservation ? (
                <div className="day-detail-empty">날짜를 선택하면 상세 예약 정보를 볼 수 있어요</div>
              ) : (
                <>
                  <div className="day-detail-head">
                    <div className="day-detail-title">{selectedReservation.date} 상세</div>
                    <div className="card-sub" style={{ margin: 0 }}>{selectedReservation.dayOfWeek}요일</div>
                  </div>
                  <div className="modal-stat-row">
                    <div className="modal-stat"><div className="modal-stat-k">예약</div><div className="modal-stat-v">{selectedReservation.totalBookings}팀</div></div>
                    <div className="modal-stat"><div className="modal-stat-k">잔여</div><div className="modal-stat-v">{selectedReservation.totalRemaining}팀</div></div>
                    <div className="modal-stat"><div className="modal-stat-k">가동률</div><div className="modal-stat-v">{Math.round((selectedReservation.totalBookings / (selectedReservation.totalSlots || 1)) * 100)}%</div></div>
                    {selectedVisitor && (
                      <div className="modal-stat"><div className="modal-stat-k">실제 내장 인원</div><div className="modal-stat-v">{selectedVisitor.persons}명</div></div>
                    )}
                  </div>
                  <div className="detail-row"><span className="detail-name">1부 예약</span><span className="detail-value">{selectedReservation.session1Bookings}팀</span></div>
                  <div className="detail-row"><span className="detail-name">2부 예약</span><span className="detail-value">{selectedReservation.session2Bookings}팀</span></div>
                  <div className="detail-row"><span className="detail-name">3부 예약</span><span className="detail-value">{selectedReservation.session3Bookings}팀</span></div>
                  <div className="detail-section-label">예약 채널</div>
                  <div className="detail-row"><span className="detail-dot" style={{ background: SERIES[0] }} /><span className="detail-name">인터넷</span><span className="detail-value">{selectedReservation.internetBookings}팀</span></div>
                  <div className="detail-row"><span className="detail-dot" style={{ background: SERIES[2] }} /><span className="detail-name">모바일</span><span className="detail-value">{selectedReservation.mobileBookings}팀</span></div>
                  <div className="detail-row"><span className="detail-dot" style={{ background: SERIES[3] }} /><span className="detail-name">전화</span><span className="detail-value">{selectedReservation.phoneBookings}팀</span></div>
                  <div className="detail-row"><span className="detail-dot" style={{ background: SERIES[4] }} /><span className="detail-name">기타</span><span className="detail-value">{selectedReservation.otherBookings}팀</span></div>
                </>
              )}
            </div>
          </>
        )}

        {view === "cash" && (
          <>
            <button className="back-btn" onClick={() => go("dashboard")}>‹ 스톤게이트CC</button>
            <div className="subheader"><div className="subheader-title">자금현황</div><div className="subheader-sub">더존 자금일보 {latestCashFlow ? `· ${latestCashFlow.date} 기준` : ""}</div></div>
            {latestCashFlow ? (
              <>
                <div className="card">
                  <div className="flow-row">
                    <div className="flow-item"><div className="flow-k">전일</div><div className="flow-v">{fmtCompact(latestCashFlow.prevBalance)}</div></div>
                    <div className="flow-item"><div className="flow-k">입금</div><div className="flow-v">{fmtCompact(latestCashFlow.deposit)}</div></div>
                    <div className="flow-item"><div className="flow-k">출금</div><div className="flow-v">{fmtCompact(latestCashFlow.withdrawal)}</div></div>
                    <div className="flow-item"><div className="flow-k">금일</div><div className="flow-v">{fmtCompact(latestCashFlow.todayBalance)}</div></div>
                  </div>
                  {latestCashFlow.banks.map((b) => (
                    <div className="bank-row" key={b.name}>
                      <div className="bank-name">{b.name}</div>
                      <div className="bank-track"><div className="bank-fill" style={{ width: `${Math.round((b.todayBalance / maxBank) * 100)}%` }} /></div>
                      <div className="bank-amt">{fmtCompact(b.todayBalance)}</div>
                    </div>
                  ))}
                </div>
                <div className="card">
                  <div className="card-title">은행별 자금 흐름</div>
                  <div className="card-sub">전일 → 입금/출금 → 금일</div>
                  <div className="table-scroll">
                  <table className="cash-table">
                    <tbody>
                      <tr><th>은행</th><th>전일</th><th>입금</th><th>출금</th><th>금일</th></tr>
                      {latestCashFlow.banks.map((b) => (
                        <tr key={b.name}>
                          <td>{b.name}</td>
                          <td>{fmtCompact(b.prevBalance)}</td>
                          <td>{fmtCompact(b.deposit)}</td>
                          <td>{fmtCompact(b.withdrawal)}</td>
                          <td>{fmtCompact(b.todayBalance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </div>
              </>
            ) : <div className="card"><div className="day-detail-empty">아직 업로드된 자금 데이터가 없습니다. /upload에서 자금일보를 업로드해주세요.</div></div>}
          </>
        )}

        {view === "greenfee" && (
          <>
            <button className="back-btn" onClick={() => go("dashboard")}>‹ 스톤게이트CC</button>
            <div className="subheader"><div className="subheader-title">그린피 현황</div><div className="subheader-sub">회원 기준 · 1단계 관리 범위</div></div>
            <div className="card">
              <div className="card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                단가표
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className={`badge ${gf?.status === "approved" ? "badge-good" : "badge-warning"}`}>
                    {gf ? (gf.status === "approved" ? "승인됨" : "승인 대기") : "미입력"}
                  </span>
                  {gf && gf.status !== "approved" && (
                    <button className="toggle-btn active" disabled={approving} onClick={() => approveGreenFee(gfYm)}>
                      {approving ? "처리중..." : "승인하기"}
                    </button>
                  )}
                </span>
              </div>
              <div className="month-toggle">
                <button className={`toggle-btn ${selectedYm === greenFeeCurrentYm ? "active" : ""}`} onClick={() => setSelectedYm(greenFeeCurrentYm)}>{greenFeeCurrentYm} (이번달)</button>
                <button className={`toggle-btn ${selectedYm === greenFeeNextYm ? "active" : ""}`} onClick={() => setSelectedYm(greenFeeNextYm)}>{greenFeeNextYm} (익월 확인)</button>
              </div>

              <div className="gf-section-label" style={{ marginTop: 14 }}>연도별 조회</div>
              <div className="year-row">
                {gfYearsWithData.map((y) => (
                  <button key={y} className="year-btn" style={gfYear === y ? { background: "var(--navy)", color: "#fff" } : undefined} onClick={() => setGfYear(y)}>{y}년</button>
                ))}
              </div>
              <div className="month-grid">
                {Array.from({ length: 12 }, (_, i) => {
                  const mm = String(i + 1).padStart(2, "0");
                  const ym = `${gfYear}-${mm}`;
                  const hasData = greenFeeMap.has(ym);
                  return (
                    <button
                      key={ym}
                      className={`month-cell ${hasData ? "has-data" : ""} ${selectedYm === ym ? "selected" : ""}`}
                      onClick={() => setSelectedYm(ym)}
                    >
                      {i + 1}월
                    </button>
                  );
                })}
              </div>
              {gf ? (
                <>
                  <div className="gf-section-label">1부 · 2부</div>
                  <div className="table-scroll">
                  <table className="gf-table">
                    <tbody>
                      <tr><th>구분</th><th>주중</th><th>토</th><th>일·공휴일</th></tr>
                      {gf.session1.map((r) => (
                        <tr key={r.timeLabel}><td>1부 · {r.timeLabel}</td><td>{r.weekday.toLocaleString("ko-KR")}</td><td>{r.saturday.toLocaleString("ko-KR")}</td><td>{r.sundayHoliday.toLocaleString("ko-KR")}</td></tr>
                      ))}
                      <tr><td>2부 · 전타임</td><td>{gf.session2.weekday.toLocaleString("ko-KR")}</td><td>{gf.session2.saturday.toLocaleString("ko-KR")}</td><td>{gf.session2.sundayHoliday.toLocaleString("ko-KR")}</td></tr>
                    </tbody>
                  </table>
                  </div>
                  <div className="gf-section-label">3부 (월~목 / 금·토 / 일·공휴일)</div>
                  <div className="table-scroll">
                  <table className="gf-table">
                    <tbody>
                      <tr><th>구분</th><th>월~목</th><th>금·토</th><th>일·공휴일</th></tr>
                      {gf.session3.map((r) => (
                        <tr key={r.timeLabel}><td>3부 · {r.timeLabel}</td><td>{r.monThu.toLocaleString("ko-KR")}</td><td>{r.friSat.toLocaleString("ko-KR")}</td><td>{r.sundayHoliday.toLocaleString("ko-KR")}</td></tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                  <div className="flat-fees">
                    <div className="flat-chip">카트료 (팀당)<b>{gf.cartFee.toLocaleString("ko-KR")}원</b></div>
                    <div className="flat-chip">캐디피 (전 부)<b>{gf.caddieFee.toLocaleString("ko-KR")}원</b></div>
                  </div>
                  {gf.exceptions.length > 0 && (
                    <div className="exceptions">
                      <div className="gf-section-label" style={{ marginTop: 0 }}>날짜별 예외</div>
                      {gf.exceptions.map((e) => (
                        <div className="exception-row" key={e.date}><span><span className="exception-date">{e.date}</span>{e.note}</span></div>
                      ))}
                    </div>
                  )}
                </>
              ) : <div className="empty-note">{gfYm} 요금표가 아직 제출되지 않았습니다.<br/>현장 업로드 페이지(/upload)에서 제출 시 이 화면에 표시됩니다.</div>}
            </div>

            <div className="sim-card">
              <div className="sim-header-strip">
                <div>
                  <div className="sim-title">그린피 조정 시뮬레이션</div>
                  <div className="sim-sub">부별 그린피를 조정하면 예약현황 데이터 기준 평균 라운드 수로 예상 매출 영향을 즉시 계산합니다.</div>
                </div>
                <button className="sim-reset" onClick={() => { setAdj({ p1: 0, p2: 0, p3: 0 }); setRoundsOverride({ p1: null, p2: null, p3: null }); }}>전체 초기화</button>
              </div>
              <div className="sim-body">
                <div className="sim-grid">
                  {(["p1", "p2", "p3"] as const).map((key, i) => {
                    const name = ["1부", "2부", "3부"][i];
                    const impact = impacts[key];
                    return (
                      <div className="sim-session" key={key}>
                        <div className="sim-session-name">{name}</div>
                        <div className="sim-field">
                          <div className="sim-field-label">그린피 조정 (원)</div>
                          <div className="sim-stepper">
                            <button className="step-btn" onClick={() => setAdj((a) => ({ ...a, [key]: a[key] - 5000 }))}>−</button>
                            <div className="sim-input">{adj[key] >= 0 ? "+" : "-"}{Math.abs(adj[key]).toLocaleString("ko-KR")}</div>
                            <button className="step-btn" onClick={() => setAdj((a) => ({ ...a, [key]: a[key] + 5000 }))}>+</button>
                          </div>
                        </div>
                        <div className="sim-field">
                          <div className="sim-field-label">예상 라운드 수 (예약 데이터 평균)</div>
                          <input
                            className="sim-rounds-input"
                            type="text"
                            value={rounds[key]}
                            onChange={(e) => {
                              const n = parseInt(e.target.value.replace(/[^0-9]/g, ""), 10);
                              setRoundsOverride((r) => ({ ...r, [key]: isNaN(n) ? 0 : n }));
                            }}
                          />
                        </div>
                        <div className={`sim-impact ${impact >= 0 ? "imp-pos" : "imp-neg"}`}>예상 매출 영향 {fmtWon(impact)}</div>
                      </div>
                    );
                  })}
                  <div className="sim-total">
                    <div className="sim-total-label">전체 예상 매출 영향</div>
                    <div className={`sim-total-value ${totalImpact >= 0 ? "imp-pos" : "imp-neg"}`}>{fmtWon(totalImpact)}</div>
                    <div className="sim-total-sub">예약현황 데이터 기준 평균 라운드 수 추정치</div>
                    <div className="divbars">
                      {(["p1", "p2", "p3"] as const).map((key, i) => {
                        const impact = impacts[key];
                        const barPct = (Math.abs(impact) / maxAbsImpact) * 50;
                        return (
                          <div className="divbar-row" key={key}>
                            <div className="divbar-name">{["1부", "2부", "3부"][i]}</div>
                            <div className="divbar-axis">
                              <div className="divbar-zero" />
                              <div className="divbar-fill" style={{
                                left: impact >= 0 ? "50%" : `${50 - barPct}%`,
                                width: `${barPct}%`,
                                background: impact >= 0 ? "var(--div-pos)" : "var(--div-neg)",
                              }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {view === "weather" && (
          <>
            <button className="back-btn" onClick={() => go("dashboard")}>‹ 스톤게이트CC</button>
            <div className="subheader"><div className="subheader-title">날씨 현황</div><div className="subheader-sub">기상청 단기예보 · 부산 기장군 · 3시간 주기 자동 갱신</div></div>
            <div className="card">
              {weather ? (
                <>
                  {weather.warnings.length > 0 && (
                    <div className="warning-banner">
                      {weather.warnings.map((w, i) => (
                        <div className="warning-banner-item" key={i}>
                          <span className="warning-banner-icon">⚠</span>
                          <span className="warning-banner-text">{w.regionName} {w.type}{w.level}</span>
                          <span className="warning-banner-time">{fmtWrnTime(w.effectiveFrom)} 발표</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="weather-main">
                    <svg width="52" height="52" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="5" fill="var(--series-4)"/></svg>
                    <div><div className="weather-temp">{weather.temp}°C</div><div className="weather-desc">{weather.desc} · 강수확률 {weather.pop}%</div></div>
                  </div>
                  <div className="forecast-row">
                    {weather.forecast.map((f) => (
                      <div className="forecast-item" key={f.day}>
                        <div className="forecast-day">{f.day}</div>
                        <div className="forecast-t">{f.tempHigh}° / {f.tempLow}°</div>
                        <div className="forecast-pop">☔ {f.pop}%</div>
                      </div>
                    ))}
                  </div>
                  <div className="detail-section-label">현재 기상 상세</div>
                  <div className="modal-stat-row">
                    <div className="modal-stat"><div className="modal-stat-k">풍속</div><div className="modal-stat-v">{weather.windSpeed}m/s</div></div>
                    <div className="modal-stat"><div className="modal-stat-k">풍향</div><div className="modal-stat-v">{weather.windDir}</div></div>
                    <div className="modal-stat"><div className="modal-stat-k">습도</div><div className="modal-stat-v">{weather.humidity}%</div></div>
                  </div>
                </>
              ) : <div className="day-detail-empty">날씨 연동이 아직 설정되지 않았습니다.</div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
