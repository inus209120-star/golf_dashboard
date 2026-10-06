"use client";

import { useState } from "react";
import Image from "next/image";
import { parseReservationFile } from "@/lib/parsers/reservation";
import { parseCashFlowFile } from "@/lib/parsers/cashFlow";
import { parseBusinessDailySalesFile } from "@/lib/parsers/businessDailySales";
import { parseDailyVisitorFile } from "@/lib/parsers/dailyVisitors";
import { parseMonthlySalesFile } from "@/lib/parsers/monthlySales";
import type { ReservationDoc, CashFlowDoc, DailySalesDoc, DailyVisitorDoc, MonthlySalesDoc, GreenFeeRatesDoc, GreenFeeSession1Row, GreenFeeSession3Row, GreenFeeException } from "@/types/firestore";

type Status =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "error"; message: string }
  | { kind: "success"; message: string };

function StatusLine({ status }: { status: Status }) {
  if (status.kind === "idle") return null;
  if (status.kind === "working") return <div className="upload-alert upload-alert-working"><span className="spinner" />처리 중...</div>;
  if (status.kind === "error") return <div className="upload-alert upload-alert-error">{status.message}</div>;
  return <div className="upload-alert upload-alert-success">{status.message}</div>;
}

// 실제 파일 입력은 시각적으로 숨기고, 터치하기 쉬운 큰 버튼 라벨로 감싼다.
function FilePickerButton({
  label,
  multiple,
  onChange,
}: {
  label: string;
  multiple?: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="upload-filebtn">
      {label}
      <input type="file" accept=".xls,.xlsx" multiple={multiple} onChange={onChange} />
    </label>
  );
}

// 자금일보가 엉뚱한 날짜로 저장된 실제 사고(조회 기준일을 잘못 잡고 뽑은
// 파일을 그대로 올림) 이후 추가된 안전장치 - 파일 내용에서 인식한 날짜를
// 저장 직전에 한 번 더 보여줘서, 직원이 실제 날짜와 다르면 취소할 수 있게 함.
function DateConfirmPanel({
  dates,
  skipped,
  onConfirm,
  onCancel,
}: {
  dates: string[];
  skipped: string[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="upload-confirm">
      <div className="upload-confirm-title">이 파일, 아래 날짜가 맞습니까?</div>
      <div className="upload-confirm-dates">{dates.join(", ")}</div>
      {skipped.length > 0 && <div className="upload-confirm-skip">인식 제외: {skipped.join(", ")}</div>}
      <div className="upload-confirm-actions">
        <button className="upload-confirm-cancel" onClick={onCancel}>취소</button>
        <button className="upload-primary-btn" onClick={onConfirm}>맞습니다 - 저장</button>
      </div>
    </div>
  );
}

function ReservationUploader({ pin }: { pin: string }) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [pending, setPending] = useState<{ docs: ReservationDoc[]; skipped: string[]; total: number; fileName: string } | null>(null);

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
      setPending({ docs: result.docs, skipped: result.skipped, total: result.total, fileName: file.name });
      setStatus({ kind: "idle" });
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      e.target.value = "";
    }
  }

  async function confirmUpload() {
    if (!pending) return;
    setStatus({ kind: "working" });
    try {
      const res = await fetch("/api/upload/reservation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, docs: pending.docs, skipped: pending.skipped, total: pending.total, fileName: pending.fileName }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setStatus({ kind: "error", message: json.error ?? "업로드 실패" });
        return;
      }
      const skipNote = pending.skipped.length ? ` (인식 안 됨: ${pending.skipped.join(", ")})` : "";
      setStatus({ kind: "success", message: `${pending.total}일 중 ${pending.docs.length}일 저장 완료${skipNote}` });
      setPending(null);
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="card">
      <div className="upload-card-title">예약현황 (일별집계)</div>
      <FilePickerButton label="파일 선택" onChange={onFile} />
      {pending && (
        <DateConfirmPanel
          dates={(() => {
            const sorted = pending.docs.map((d) => d.date).sort();
            return [`${sorted[0]} ~ ${sorted[sorted.length - 1]} (${sorted.length}일)`];
          })()}
          skipped={pending.skipped}
          onConfirm={confirmUpload}
          onCancel={() => setPending(null)}
        />
      )}
      <StatusLine status={status} />
    </div>
  );
}

function CashFlowUploader({ pin }: { pin: string }) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [pending, setPending] = useState<{ docs: CashFlowDoc[]; skipped: string[]; total: number; fileName: string } | null>(null);

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
      setPending({ docs: result.docs, skipped: result.skipped, total: result.total, fileName: file.name });
      setStatus({ kind: "idle" });
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      e.target.value = "";
    }
  }

  async function confirmUpload() {
    if (!pending) return;
    setStatus({ kind: "working" });
    try {
      const res = await fetch("/api/upload/cashflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, docs: pending.docs, skipped: pending.skipped, total: pending.total, fileName: pending.fileName }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setStatus({ kind: "error", message: json.error ?? "업로드 실패" });
        return;
      }
      const skipNote = pending.skipped.length ? ` (인식 안 됨: ${pending.skipped.join(", ")})` : "";
      setStatus({ kind: "success", message: `${pending.total}개 시트 중 ${pending.docs.length}일 저장 완료${skipNote}` });
      setPending(null);
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="card">
      <div className="upload-card-title">자금일보</div>
      <FilePickerButton label="파일 선택" onChange={onFile} />
      {pending && (
        <DateConfirmPanel
          dates={pending.docs.map((d) => d.date).sort()}
          skipped={pending.skipped}
          onConfirm={confirmUpload}
          onCancel={() => setPending(null)}
        />
      )}
      <StatusLine status={status} />
    </div>
  );
}

// 종합영업일보 한 파일에서 매출(dailySales)과 실제 내장 팀수/인원
// (dailyVisitors)을 동시에 뽑아 각자의 컬렉션에 저장한다. 하루에 한
// 파일씩 나오는 리포트라 여러 날짜 파일을 한 번에 선택해 올릴 수 있다.
function BusinessDailyUploader({ pin }: { pin: string }) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [pending, setPending] = useState<{
    salesDocs: DailySalesDoc[];
    visitorDocs: DailyVisitorDoc[];
    skipped: string[];
    filesCount: number;
    fileName: string;
  } | null>(null);

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setStatus({ kind: "working" });
    try {
      const salesDocs: DailySalesDoc[] = [];
      const visitorDocs: DailyVisitorDoc[] = [];
      const skipped: string[] = [];
      for (const file of files) {
        const buf = await file.arrayBuffer();
        const salesResult = parseBusinessDailySalesFile(buf);
        const visitorResult = parseDailyVisitorFile(buf);
        if (salesResult.doc) salesDocs.push(salesResult.doc);
        else skipped.push(`${file.name} (매출): ${salesResult.error ?? "인식 실패"}`);
        if (visitorResult.doc) visitorDocs.push(visitorResult.doc);
        else skipped.push(`${file.name} (팀수/인원): ${visitorResult.error ?? "인식 실패"}`);
      }
      if (salesDocs.length === 0 && visitorDocs.length === 0) {
        setStatus({ kind: "error", message: `인식된 데이터가 없습니다. ${skipped.join(", ")}` });
        return;
      }
      const fileName = files.map((f) => f.name).join(", ");
      setPending({ salesDocs, visitorDocs, skipped, filesCount: files.length, fileName });
      setStatus({ kind: "idle" });
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      e.target.value = "";
    }
  }

  async function confirmUpload() {
    if (!pending) return;
    setStatus({ kind: "working" });
    try {
      const { salesDocs, visitorDocs, skipped, filesCount, fileName } = pending;
      const [salesRes, visitorRes] = await Promise.all([
        salesDocs.length
          ? fetch("/api/upload/daily-sales", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ pin, docs: salesDocs, skipped, total: filesCount, fileName }),
            })
          : null,
        visitorDocs.length
          ? fetch("/api/upload/daily-visitors", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ pin, docs: visitorDocs, skipped, total: filesCount, fileName }),
            })
          : null,
      ]);
      for (const res of [salesRes, visitorRes]) {
        if (!res) continue;
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setStatus({ kind: "error", message: json.error ?? "업로드 실패" });
          return;
        }
      }
      const skipNote = skipped.length ? ` (인식 안 됨: ${skipped.join(", ")})` : "";
      setStatus({
        kind: "success",
        message: `${filesCount}개 파일 중 매출 ${salesDocs.length}일 · 팀수/인원 ${visitorDocs.length}일 저장 완료${skipNote}`,
      });
      setPending(null);
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="card">
      <div className="upload-card-title">종합영업일보 (매출 · 실제 내장 팀수/인원)</div>
      <div className="upload-card-sub">하루에 한 파일씩 나오는 리포트라, 여러 날짜 파일을 한 번에 선택해 올릴 수 있습니다.</div>
      <FilePickerButton label="여러 날짜 파일 선택" multiple onChange={onFiles} />
      {pending && (
        <DateConfirmPanel
          dates={Array.from(new Set([...pending.salesDocs.map((d) => d.date), ...pending.visitorDocs.map((d) => d.date)])).sort()}
          skipped={pending.skipped}
          onConfirm={confirmUpload}
          onCancel={() => setPending(null)}
        />
      )}
      <StatusLine status={status} />
    </div>
  );
}

// 일별 업로드가 없는 과거 월(예: dailySales 도입 전인 2026년 1~8월)의 실적을
// 채워 넣기 위한 업로더. 종합영업일보를 "그 달의 마지막 영업일" 기준으로
// 뽑으면 그 안의 "월계"(매출)/"당 월"(팀수·인원) 값이 이미 그 달 전체
// 합계이므로, 그 파일 하나만으로 한 달치를 채운다 - monthlySales.ts 참고.
function MonthlyBackfillUploader({ pin }: { pin: string }) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setStatus({ kind: "working" });
    try {
      const docs: MonthlySalesDoc[] = [];
      const skipped: string[] = [];
      for (const file of files) {
        const buf = await file.arrayBuffer();
        const result = parseMonthlySalesFile(buf);
        if (result.doc) docs.push(result.doc);
        else skipped.push(`${file.name}: ${result.error ?? "인식 실패"}`);
      }
      if (docs.length === 0) {
        setStatus({ kind: "error", message: `인식된 데이터가 없습니다. ${skipped.join(", ")}` });
        return;
      }
      const fileName = files.map((f) => f.name).join(", ");
      const res = await fetch("/api/upload/monthly-sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, docs, skipped, total: files.length, fileName }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setStatus({ kind: "error", message: json.error ?? "업로드 실패" });
        return;
      }
      const skipNote = skipped.length ? ` (인식 안 됨: ${skipped.join(", ")})` : "";
      setStatus({ kind: "success", message: `${files.length}개 파일 중 ${docs.length}개월 저장 완료 (${docs.map((d) => d.yearMonth).join(", ")})${skipNote}` });
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      e.target.value = "";
    }
  }

  return (
    <div className="card" style={{ marginTop: 10 }}>
      <div className="upload-card-title">월별 실적 백필 (일별 데이터 없는 과거 월용)</div>
      <div className="upload-card-sub">
        종합영업일보를 <b>그 달의 마지막 영업일</b> 기준으로 뽑아서 올려주세요 (예: 2월이면 2월 28일치 하루 파일). 그 안의 &ldquo;월계&rdquo;/&ldquo;당 월&rdquo; 값을 그 달 전체 합계로 저장합니다. 여러 달 파일을 한 번에 선택할 수 있습니다.
      </div>
      <FilePickerButton label="여러 달 파일 선택" multiple onChange={onFiles} />
      <StatusLine status={status} />
    </div>
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
      className="upload-numcell"
      value={value.toLocaleString("ko-KR")}
      onChange={(e) => {
        const n = parseInt(e.target.value.replace(/[^0-9]/g, ""), 10);
        onChange(isNaN(n) ? 0 : n);
      }}
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
    <div className="card">
      <div className="upload-card-title">그린피 단가 입력</div>
      <div className="upload-card-sub" style={{ marginBottom: 10 }}>
        대상 월:{" "}
        <input type="text" className="upload-text-input" value={yearMonth} onChange={(e) => setYearMonth(e.target.value)} placeholder="YYYY-MM" style={{ width: 90 }} />
      </div>

      <div className="table-scroll">
      <table className="gf-table">
        <tbody>
          <tr><th></th><th>주중</th><th>토</th><th>일·공휴일</th></tr>
          {session1.map((r, i) => (
            <tr key={r.timeLabel}>
              <td>1부 · {r.timeLabel}</td>
              <td><NumberCell value={r.weekday} onChange={(n) => updateS1(i, "weekday", n)} /></td>
              <td><NumberCell value={r.saturday} onChange={(n) => updateS1(i, "saturday", n)} /></td>
              <td><NumberCell value={r.sundayHoliday} onChange={(n) => updateS1(i, "sundayHoliday", n)} /></td>
            </tr>
          ))}
          <tr>
            <td>2부 · 전타임</td>
            <td><NumberCell value={session2.weekday} onChange={(n) => setSession2((s) => ({ ...s, weekday: n }))} /></td>
            <td><NumberCell value={session2.saturday} onChange={(n) => setSession2((s) => ({ ...s, saturday: n }))} /></td>
            <td><NumberCell value={session2.sundayHoliday} onChange={(n) => setSession2((s) => ({ ...s, sundayHoliday: n }))} /></td>
          </tr>
        </tbody>
      </table>
      </div>

      <div className="gf-section-label">3부는 요일군이 다름 (월~목 / 금·토 / 일·공휴일)</div>
      <div className="table-scroll">
      <table className="gf-table">
        <tbody>
          <tr><th></th><th>월~목</th><th>금·토</th><th>일·공휴일</th></tr>
          {session3.map((r, i) => (
            <tr key={r.timeLabel}>
              <td>3부 · {r.timeLabel}</td>
              <td><NumberCell value={r.monThu} onChange={(n) => updateS3(i, "monThu", n)} /></td>
              <td><NumberCell value={r.friSat} onChange={(n) => updateS3(i, "friSat", n)} /></td>
              <td><NumberCell value={r.sundayHoliday} onChange={(n) => updateS3(i, "sundayHoliday", n)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      <div className="flat-fees">
        <div className="flat-chip">카트료 (팀당)<NumberCell value={cartFee} onChange={setCartFee} />원</div>
        <div className="flat-chip">캐디피 (전 부)<NumberCell value={caddieFee} onChange={setCaddieFee} />원</div>
      </div>

      <div style={{ marginTop: 16 }}>
        <div className="gf-section-label" style={{ margin: "0 0 8px" }}>날짜별 예외 (휴장 / 요금 조정)</div>
        {exceptions.map((e, i) => (
          <div className="upload-exception-row" key={i}>
            <input type="text" className="upload-text-input" placeholder="YYYY-MM-DD" value={e.date} onChange={(ev) => setExceptions((xs) => xs.map((x, idx) => (idx === i ? { ...x, date: ev.target.value } : x)))} style={{ width: 110 }} />
            <input type="text" className="upload-text-input" placeholder="예: 추석당일 휴장" value={e.note} onChange={(ev) => setExceptions((xs) => xs.map((x, idx) => (idx === i ? { ...x, note: ev.target.value } : x)))} style={{ flex: 1, minWidth: 0 }} />
            <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
              <input type="checkbox" checked={e.closed} onChange={(ev) => setExceptions((xs) => xs.map((x, idx) => (idx === i ? { ...x, closed: ev.target.checked } : x)))} />
              휴장
            </label>
            <button className="upload-btn-sm" onClick={() => setExceptions((xs) => xs.filter((_, idx) => idx !== i))}>삭제</button>
          </div>
        ))}
        <button className="upload-btn-sm" onClick={() => setExceptions((xs) => [...xs, { date: "", note: "", closed: false }])}>+ 예외 추가</button>
      </div>

      <button className="upload-primary-btn" style={{ marginTop: 18 }} onClick={onSubmit}>제출</button>
      <StatusLine status={status} />
    </div>
  );
}

export default function UploadPage() {
  const [pinInput, setPinInput] = useState("");
  const [unlockedPin, setUnlockedPin] = useState<string | null>(null);
  const [pinError, setPinError] = useState("");

  if (!unlockedPin) {
    return (
      <main className="upload-pin-bg">
        <Image src="/images/upload-bg.png" alt="" fill priority sizes="100vw" className="upload-pin-bg-img" />
        <div className="upload-pin-overlay" />
        <div className="upload-pin-wrap">
          <div className="upload-brand">SG</div>
          <div className="upload-title">현장 업로드</div>
          <div className="upload-sub">스톤게이트CC · PIN을 입력하세요</div>
          <input
            type="password"
            inputMode="numeric"
            className="upload-pin-input"
            value={pinInput}
            onChange={(e) => { setPinInput(e.target.value); setPinError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") setUnlockedPin(pinInput); }}
          />
          <button className="upload-primary-btn" onClick={() => setUnlockedPin(pinInput)}>
            확인
          </button>
          {pinError && <div className="upload-error-text">{pinError}</div>}
        </div>
      </main>
    );
  }

  return (
    <main className="upload-page">
      <div className="upload-header">
        <div className="upload-header-title">현장 업로드</div>
        <div className="upload-header-sub">파일을 선택하면 자동으로 파싱되어 저장됩니다. PIN은 서버에서도 다시 검증되므로, 틀리면 저장 단계에서 오류가 표시됩니다.</div>
      </div>
      <ReservationUploader pin={unlockedPin} />
      <CashFlowUploader pin={unlockedPin} />
      <BusinessDailyUploader pin={unlockedPin} />
      <hr className="upload-divider" />
      <GreenfeeUploader pin={unlockedPin} />

      <details className="upload-advanced">
        <summary>관리자용 - 월별 실적 백필</summary>
        <MonthlyBackfillUploader pin={unlockedPin} />
      </details>
    </main>
  );
}
