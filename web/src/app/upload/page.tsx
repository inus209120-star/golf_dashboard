"use client";

import { useState } from "react";
import { parseReservationFile } from "@/lib/parsers/reservation";
import { parseCashFlowFile } from "@/lib/parsers/cashFlow";
import { parseDailySalesFile } from "@/lib/parsers/dailySales";

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
    <main style={{ maxWidth: 480, margin: "40px auto", fontFamily: "system-ui" }}>
      <h2>현장 업로드</h2>
      <p style={{ color: "#666", fontSize: 13 }}>
        파일을 선택하면 자동으로 파싱되어 저장됩니다. PIN은 서버에서도 다시 검증되므로, 틀리면 저장 단계에서 오류가 표시됩니다.
      </p>
      <ReservationUploader pin={unlockedPin} />
      <CashFlowUploader pin={unlockedPin} />
      <SalesUploader pin={unlockedPin} />
    </main>
  );
}
