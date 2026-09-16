"use client";

import { useState } from "react";
import { parseReservationFile } from "@/lib/parsers/reservation";
import { parseCashFlowFile } from "@/lib/parsers/cashFlow";
import { parseDailySalesFile } from "@/lib/parsers/dailySales";
import { parseDailyVisitorFile } from "@/lib/parsers/dailyVisitors";
import type { DailyVisitorDoc, GreenFeeRatesDoc, GreenFeeSession1Row, GreenFeeSession3Row, GreenFeeException } from "@/types/firestore";

// Functional-first UI - no styling pass yet (matches the design canvas
// prototype's look). This page proves the parse -> PIN check -> Firestore
// write pipeline end to end; visual polish comes later per plan.

type Status =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "error"; message: string }
  | { kind: "success"; message: string };

function StatusLine({ status }: { status: Status }) {
  if (status.kind === "idle") return null;
  if (status.kind === "working") return <p>처리 중...</p>;
  if (status.kind === "error") return <p style={{ color: "crimson" }}>{status.message}</p>;
  return <p style={{ color: "green" }}>{status.message}</p>;
}

function ReservationUploader({ pin }: { pin: string }) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus({ kind: "working" });
    try {
      const buf = await file.arrayBuffer();
      const result = parseReservationFile(buf);
      if (result.docs.length === 0) {
        setStatus({ kind: "error", message: `인식된 데이터가 없습니다. ${result.skipped.join(", ")}` });
        return;
      }
      const res = await fetch("/api/upload/reservation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, docs: result.docs, skipped: result.skipped, total: result.total, fileName: file.name }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setStatus({ kind: "error", message: json.error ?? "업로드 실패" });
        return;
      }
      const skipNote = result.skipped.length ? ` (인식 안 됨: ${result.skipped.join(", ")})` : "";
      setStatus({ kind: "success", message: `${result.total}일 중 ${result.docs.length}일 저장 완료${skipNote}` });
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      e.target.value = "";
    }
  }

  return (
    <section style={{ marginBottom: 24 }}>
      <h3>예약현황 (일별집계)</h3>
      <input type="file" accept=".xls,.xlsx" onChange={onFile} />
      <StatusLine status={status} />
    </section>
  );
}

function CashFlowUploader({ pin }: { pin: string }) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus({ kind: "working" });
    try {
      const buf = await file.arrayBuffer();
      const result = parseCashFlowFile(buf);
      if (result.docs.length === 0) {
        setStatus({ kind: "error", message: `인식된 데이터가 없습니다. ${result.skipped.join(", ")}` });
        return;
      }
      const res = await fetch("/api/upload/cashflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, docs: result.docs, skipped: result.skipped, total: result.total, fileName: file.name }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setStatus({ kind: "error", message: json.error ?? "업로드 실패" });
        return;
      }
      const skipNote = result.skipped.length ? ` (인식 안 됨: ${result.skipped.join(", ")})` : "";
      setStatus({ kind: "success", message: `${result.total}개 시트 중 ${result.docs.length}일 저장 완료${skipNote}` });
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      e.target.value = "";
    }
  }

  return (
    <section style={{ marginBottom: 24 }}>
      <h3>자금일보</h3>
      <input type="file" accept=".xls,.xlsx" onChange={onFile} />
      <StatusLine status={status} />
    </section>
  );
}

function SalesUploader({ pin }: { pin: string }) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus({ kind: "working" });
    try {
      const buf = await file.arrayBuffer();
      const result = parseDailySalesFile(buf);
      if (result.isMultiDay) {
        setStatus({
          kind: "error",
          message: `이 파일은 ${result.rangeStart} ~ ${result.rangeEnd} 범위를 담고 있습니다. 무노스에서 조회 기간을 "하루"로 지정해 다시 추출해주세요.`,
        });
        return;
      }
      if (!result.doc) {
        setStatus({ kind: "error", message: result.error ?? "인식 실패" });
        return;
      }
      const res = await fetch("/api/upload/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, doc: result.doc, fileName: file.name }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setStatus({ kind: "error", message: json.error ?? "업로드 실패" });
        return;
      }
      setStatus({ kind: "success", message: `${result.doc.date} 매출 저장 완료 (매출합계 ${result.doc.total.toLocaleString("ko-KR")}원)` });
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      e.target.value = "";
    }
  }

  return (
    <section style={{ marginBottom: 24 }}>
      <h3>일일영업집계 (매출)</h3>
      <input type="file" accept=".xls,.xlsx" onChange={onFile} />
      <StatusLine status={status} />
    </section>
  );
}

function DailyVisitorsUploader({ pin }: { pin: string }) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setStatus({ kind: "working" });
    try {
      const docs: DailyVisitorDoc[] = [];
      const skipped: string[] = [];
      for (const file of files) {
        const buf = await file.arrayBuffer();
        const result = parseDailyVisitorFile(buf);
        if (result.doc) {
          docs.push(result.doc);
        } else {
          skipped.push(`${file.name}: ${result.error ?? "인식 실패"}`);
        }
      }
      if (docs.length === 0) {
        setStatus({ kind: "error", message: `인식된 데이터가 없습니다. ${skipped.join(", ")}` });
        return;
      }
      const res = await fetch("/api/upload/daily-visitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, docs, skipped, total: files.length, fileName: files.map((f) => f.name).join(", ") }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setStatus({ kind: "error", message: json.error ?? "업로드 실패" });
        return;
      }
      const skipNote = skipped.length ? ` (인식 안 됨: ${skipped.join(", ")})` : "";
      setStatus({ kind: "success", message: `${files.length}개 파일 중 ${docs.length}일 저장 완료${skipNote}` });
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      e.target.value = "";
    }
  }

  return (
    <section style={{ marginBottom: 24 }}>
      <h3>종합영업일보 (실제 내장 팀수/인원)</h3>
      <p style={{ fontSize: 13, color: "#666" }}>하루에 한 파일씩 나오는 리포트라, 여러 날짜 파일을 한 번에 선택해 올릴 수 있습니다.</p>
      <input type="file" accept=".xls,.xlsx" multiple onChange={onFiles} />
      <StatusLine status={status} />
    </section>
  );
}

function nextYearMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Defaults pre-filled from the real September rate notice (PRD.md §9.2) -
// a reasonable starting point for the first-ever submission; from the
// second month on, field staff would want this pre-filled from last
// month's saved rates instead (not built yet - see PROGRESS.md).
const DEFAULT_SESSION1: GreenFeeSession1Row[] = [
  { timeLabel: "첫팀~06:22", weekday: 130000, saturday: 160000, sundayHoliday: 160000 },
  { timeLabel: "06:30~06:52", weekday: 140000, saturday: 170000, sundayHoliday: 170000 },
  { timeLabel: "07:00~막팀", weekday: 150000, saturday: 180000, sundayHoliday: 180000 },
];
const DEFAULT_SESSION3: GreenFeeSession3Row[] = [
  { timeLabel: "16:15~17:39", monThu: 130000, friSat: 150000, sundayHoliday: 140000 },
  { timeLabel: "17:46~18:35", monThu: 120000, friSat: 140000, sundayHoliday: 130000 },
];

function NumberCell({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <input
      type="text"
      value={value.toLocaleString("ko-KR")}
      onChange={(e) => {
        const n = parseInt(e.target.value.replace(/[^0-9]/g, ""), 10);
        onChange(isNaN(n) ? 0 : n);
      }}
      style={{ width: 90, textAlign: "right", padding: 4 }}
    />
  );
}

function GreenfeeUploader({ pin }: { pin: string }) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [yearMonth, setYearMonth] = useState(nextYearMonth());
  const [session1, setSession1] = useState(DEFAULT_SESSION1);
  const [session2, setSession2] = useState({ weekday: 180000, saturday: 200000, sundayHoliday: 190000 });
  const [session3, setSession3] = useState(DEFAULT_SESSION3);
  const [cartFee, setCartFee] = useState(100000);
  const [caddieFee, setCaddieFee] = useState(150000);
  const [exceptions, setExceptions] = useState<GreenFeeException[]>([]);

  function updateS1(i: number, field: keyof GreenFeeSession1Row, value: number) {
    setSession1((rows) => rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }
  function updateS3(i: number, field: keyof GreenFeeSession3Row, value: number) {
    setSession3((rows) => rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }

  async function onSubmit() {
    setStatus({ kind: "working" });
    const doc: GreenFeeRatesDoc = {
      yearMonth, session1, session2, session3, cartFee, caddieFee, exceptions,
      status: "pending", submittedAt: null, approvedAt: null,
    };
    try {
      const res = await fetch("/api/upload/greenfee", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, doc }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setStatus({ kind: "error", message: json.error ?? "제출 실패" });
        return;
      }
      setStatus({ kind: "success", message: `${yearMonth} 그린피 단가표 제출 완료 - 대표님 승인 대기중` });
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <section style={{ marginBottom: 24 }}>
      <h3>그린피 단가 입력</h3>
      <p style={{ fontSize: 13, color: "#666" }}>
        대상 월:{" "}
        <input type="text" value={yearMonth} onChange={(e) => setYearMonth(e.target.value)} placeholder="YYYY-MM" style={{ padding: 4, width: 90 }} />
      </p>

      <table style={{ borderCollapse: "collapse", marginBottom: 12 }}>
        <tbody>
          <tr><th></th><th style={{ padding: "2px 8px" }}>주중</th><th style={{ padding: "2px 8px" }}>토</th><th style={{ padding: "2px 8px" }}>일·공휴일</th></tr>
          {session1.map((r, i) => (
            <tr key={r.timeLabel}>
              <td style={{ fontSize: 12, paddingRight: 8 }}>1부 · {r.timeLabel}</td>
              <td><NumberCell value={r.weekday} onChange={(n) => updateS1(i, "weekday", n)} /></td>
              <td><NumberCell value={r.saturday} onChange={(n) => updateS1(i, "saturday", n)} /></td>
              <td><NumberCell value={r.sundayHoliday} onChange={(n) => updateS1(i, "sundayHoliday", n)} /></td>
            </tr>
          ))}
          <tr>
            <td style={{ fontSize: 12, paddingRight: 8 }}>2부 · 전타임</td>
            <td><NumberCell value={session2.weekday} onChange={(n) => setSession2((s) => ({ ...s, weekday: n }))} /></td>
            <td><NumberCell value={session2.saturday} onChange={(n) => setSession2((s) => ({ ...s, saturday: n }))} /></td>
            <td><NumberCell value={session2.sundayHoliday} onChange={(n) => setSession2((s) => ({ ...s, sundayHoliday: n }))} /></td>
          </tr>
        </tbody>
      </table>

      <p style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>3부는 요일군이 다름 (월~목 / 금·토 / 일·공휴일)</p>
      <table style={{ borderCollapse: "collapse", marginBottom: 12 }}>
        <tbody>
          <tr><th></th><th style={{ padding: "2px 8px" }}>월~목</th><th style={{ padding: "2px 8px" }}>금·토</th><th style={{ padding: "2px 8px" }}>일·공휴일</th></tr>
          {session3.map((r, i) => (
            <tr key={r.timeLabel}>
              <td style={{ fontSize: 12, paddingRight: 8 }}>3부 · {r.timeLabel}</td>
              <td><NumberCell value={r.monThu} onChange={(n) => updateS3(i, "monThu", n)} /></td>
              <td><NumberCell value={r.friSat} onChange={(n) => updateS3(i, "friSat", n)} /></td>
              <td><NumberCell value={r.sundayHoliday} onChange={(n) => updateS3(i, "sundayHoliday", n)} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      <p style={{ fontSize: 13 }}>
        카트료 (팀당): <NumberCell value={cartFee} onChange={setCartFee} />원 &nbsp;&nbsp;
        캐디피 (전 부): <NumberCell value={caddieFee} onChange={setCaddieFee} />원
      </p>

      <div style={{ marginTop: 12 }}>
        <p style={{ fontSize: 13, fontWeight: 600 }}>날짜별 예외 (휴장 / 요금 조정)</p>
        {exceptions.map((e, i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
            <input type="text" placeholder="YYYY-MM-DD" value={e.date} onChange={(ev) => setExceptions((xs) => xs.map((x, idx) => (idx === i ? { ...x, date: ev.target.value } : x)))} style={{ width: 110, padding: 4 }} />
            <input type="text" placeholder="예: 추석당일 휴장" value={e.note} onChange={(ev) => setExceptions((xs) => xs.map((x, idx) => (idx === i ? { ...x, note: ev.target.value } : x)))} style={{ flex: 1, padding: 4 }} />
            <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
              <input type="checkbox" checked={e.closed} onChange={(ev) => setExceptions((xs) => xs.map((x, idx) => (idx === i ? { ...x, closed: ev.target.checked } : x)))} />
              휴장
            </label>
            <button onClick={() => setExceptions((xs) => xs.filter((_, idx) => idx !== i))}>삭제</button>
          </div>
        ))}
        <button onClick={() => setExceptions((xs) => [...xs, { date: "", note: "", closed: false }])}>+ 예외 추가</button>
      </div>

      <div style={{ marginTop: 16 }}>
        <button style={{ padding: "8px 20px", fontWeight: 600 }} onClick={onSubmit}>제출</button>
      </div>
      <StatusLine status={status} />
    </section>
  );
}

export default function UploadPage() {
  const [pinInput, setPinInput] = useState("");
  const [unlockedPin, setUnlockedPin] = useState<string | null>(null);
  const [pinError, setPinError] = useState("");

  if (!unlockedPin) {
    return (
      <main style={{ maxWidth: 360, margin: "80px auto", fontFamily: "system-ui" }}>
        <h2>현장 업로드</h2>
        <p>PIN을 입력하세요</p>
        <input
          type="password"
          value={pinInput}
          onChange={(e) => { setPinInput(e.target.value); setPinError(""); }}
          onKeyDown={(e) => { if (e.key === "Enter") setUnlockedPin(pinInput); }}
          style={{ fontSize: 18, padding: 8, width: "100%" }}
        />
        <button style={{ marginTop: 12, padding: "8px 16px" }} onClick={() => setUnlockedPin(pinInput)}>
          확인
        </button>
        {pinError && <p style={{ color: "crimson" }}>{pinError}</p>}
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 640, margin: "40px auto", fontFamily: "system-ui" }}>
      <h2>현장 업로드</h2>
      <p style={{ color: "#666", fontSize: 13 }}>
        파일을 선택하면 자동으로 파싱되어 저장됩니다. PIN은 서버에서도 다시 검증되므로, 틀리면 저장 단계에서 오류가 표시됩니다.
      </p>
      <ReservationUploader pin={unlockedPin} />
      <CashFlowUploader pin={unlockedPin} />
      <SalesUploader pin={unlockedPin} />
      <DailyVisitorsUploader pin={unlockedPin} />
      <hr style={{ margin: "24px 0" }} />
      <GreenfeeUploader pin={unlockedPin} />
    </main>
  );
}
