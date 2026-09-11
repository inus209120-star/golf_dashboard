import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/collections";
import type { GreenFeeApprovalDoc } from "@/types/firestore";

// No PIN here on purpose: this lives on the public dashboard (no login),
// where PRD.md's whole access model is "possession of this link = 대표님".
// The PIN in /upload only ever protected the *submit* step (현장 직원).
export async function POST(req: Request) {
  const body = await req.json();
  const yearMonth: string | undefined = body?.yearMonth;
  if (!yearMonth) {
    return NextResponse.json({ ok: false, error: "yearMonth가 필요합니다" }, { status: 400 });
  }

  const ref = adminDb.collection(COLLECTIONS.greenFeeRates).doc(yearMonth);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ ok: false, error: "해당 월의 그린피 단가표가 없습니다" }, { status: 404 });
  }

  const approvedAt = new Date().toISOString();
  await ref.update({ status: "approved", approvedAt });

  const log: GreenFeeApprovalDoc = { yearMonth, submittedAt: approvedAt, status: "approved", approvedAt, note: "대표님 승인" };
  await adminDb.collection(COLLECTIONS.greenFeeApprovals).add(log);

  return NextResponse.json({ ok: true });
}
