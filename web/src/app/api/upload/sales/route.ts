import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/collections";
import { checkPin } from "@/lib/upload-auth";
import type { DailySalesDoc, UploadLogDoc } from "@/types/firestore";

export async function POST(req: Request) {
  const body = await req.json();
  const pinError = checkPin(body?.pin);
  if (pinError) return pinError;

  const doc: DailySalesDoc | null = body?.doc ?? null;
  const fileName: string = typeof body?.fileName === "string" ? body.fileName : "";

  if (!doc || !doc.date) {
    return NextResponse.json({ ok: false, error: "저장할 데이터가 없습니다" }, { status: 400 });
  }

  await adminDb.collection(COLLECTIONS.dailySales).doc(doc.date).set(doc);

  const log: UploadLogDoc = {
    kind: "dailySales",
    uploadedAt: new Date().toISOString(),
    fileName,
    recognized: 1,
    total: 1,
    skipped: [],
  };
  await adminDb.collection(COLLECTIONS.uploadLog).add(log);

  return NextResponse.json({ ok: true, date: doc.date });
}
