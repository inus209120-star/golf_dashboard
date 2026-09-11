import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/collections";
import { checkPin } from "@/lib/upload-auth";
import type { ReservationDoc, UploadLogDoc } from "@/types/firestore";

export async function POST(req: Request) {
  const body = await req.json();
  const pinError = checkPin(body?.pin);
  if (pinError) return pinError;

  const docs: ReservationDoc[] = Array.isArray(body?.docs) ? body.docs : [];
  const skipped: string[] = Array.isArray(body?.skipped) ? body.skipped : [];
  const fileName: string = typeof body?.fileName === "string" ? body.fileName : "";
  const total: number = typeof body?.total === "number" ? body.total : docs.length;

  if (docs.length === 0) {
    return NextResponse.json({ ok: false, error: "저장할 데이터가 없습니다" }, { status: 400 });
  }

  const batch = adminDb.batch();
  for (const doc of docs) {
    batch.set(adminDb.collection(COLLECTIONS.reservations).doc(doc.date), doc);
  }
  await batch.commit();

  const log: UploadLogDoc = {
    kind: "reservation",
    uploadedAt: new Date().toISOString(),
    fileName,
    recognized: docs.length,
    total,
    skipped,
  };
  await adminDb.collection(COLLECTIONS.uploadLog).add(log);

  return NextResponse.json({ ok: true, recognized: docs.length, total, skipped });
}
