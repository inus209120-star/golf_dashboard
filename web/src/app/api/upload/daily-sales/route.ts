import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/collections";
import { checkPin } from "@/lib/upload-auth";
import type { DailySalesDoc, UploadLogDoc } from "@/types/firestore";

// 종합영업일보 is one file per day, so - like /api/upload/daily-visitors -
// the upload page lets field staff select many files at once and posts
// the resulting docs here as a single batch.
export async function POST(req: Request) {
  const body = await req.json();
  const pinError = checkPin(body?.pin);
  if (pinError) return pinError;

  const docs: DailySalesDoc[] = Array.isArray(body?.docs) ? body.docs : [];
  const skipped: string[] = Array.isArray(body?.skipped) ? body.skipped : [];
  const fileName: string = typeof body?.fileName === "string" ? body.fileName : "";
  const total: number = typeof body?.total === "number" ? body.total : docs.length;

  if (docs.length === 0) {
    return NextResponse.json({ ok: false, error: "저장할 데이터가 없습니다" }, { status: 400 });
  }

  const batch = adminDb.batch();
  for (const doc of docs) {
    batch.set(adminDb.collection(COLLECTIONS.dailySales).doc(doc.date), doc);
  }
  await batch.commit();

  const log: UploadLogDoc = {
    kind: "dailySales",
    uploadedAt: new Date().toISOString(),
    fileName,
    recognized: docs.length,
    total,
    skipped,
  };
  await adminDb.collection(COLLECTIONS.uploadLog).add(log);

  return NextResponse.json({ ok: true, recognized: docs.length, total, skipped });
}
