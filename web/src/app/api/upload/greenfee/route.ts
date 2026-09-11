import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/collections";
import { checkPin } from "@/lib/upload-auth";
import type { GreenFeeRatesDoc, GreenFeeApprovalDoc } from "@/types/firestore";

export async function POST(req: Request) {
  const body = await req.json();
  const pinError = checkPin(body?.pin);
  if (pinError) return pinError;

  const doc: GreenFeeRatesDoc | null = body?.doc ?? null;
  if (!doc || !doc.yearMonth) {
    return NextResponse.json({ ok: false, error: "저장할 데이터가 없습니다" }, { status: 400 });
  }

  const submittedAt = new Date().toISOString();
  const toSave: GreenFeeRatesDoc = { ...doc, status: "pending", submittedAt, approvedAt: null };
  await adminDb.collection(COLLECTIONS.greenFeeRates).doc(doc.yearMonth).set(toSave);

  const log: GreenFeeApprovalDoc = {
    yearMonth: doc.yearMonth,
    submittedAt,
    status: "pending",
    approvedAt: null,
    note: null,
  };
  await adminDb.collection(COLLECTIONS.greenFeeApprovals).add(log);

  return NextResponse.json({ ok: true, yearMonth: doc.yearMonth });
}
