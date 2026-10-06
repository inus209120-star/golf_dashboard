import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/collections";
import type { PushSubscriptionDoc } from "@/types/firestore";

// 대시보드 링크 소지 = 대표님 신뢰 모델(그린피 승인 API와 동일한 근거) - 알림
// 구독도 PIN 없이 받는다. 구독 자체는 악용돼봐야 "자기 기기가 알림을 받는다"
// 정도라 민감한 쓰기 작업이 아님.
export async function POST(req: Request) {
  const body = await req.json();
  const sub = body?.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return NextResponse.json({ ok: false, error: "잘못된 구독 정보입니다" }, { status: 400 });
  }

  const id = crypto.createHash("sha256").update(sub.endpoint).digest("hex");
  const doc: PushSubscriptionDoc = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    subscribedAt: new Date().toISOString(),
  };
  await adminDb.collection(COLLECTIONS.pushSubscriptions).doc(id).set(doc);

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const body = await req.json();
  const endpoint = body?.endpoint;
  if (typeof endpoint !== "string") {
    return NextResponse.json({ ok: false, error: "endpoint가 필요합니다" }, { status: 400 });
  }
  const id = crypto.createHash("sha256").update(endpoint).digest("hex");
  await adminDb.collection(COLLECTIONS.pushSubscriptions).doc(id).delete();
  return NextResponse.json({ ok: true });
}
