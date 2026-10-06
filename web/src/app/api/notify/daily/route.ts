import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/collections";
import { sendPushToAll } from "@/lib/push";

// Vercel Cron automatically sends "Authorization: Bearer $CRON_SECRET" to
// routes it invokes when that env var is set - this keeps the endpoint from
// being hit by anyone else to spam the one subscribed device.
function checkCronSecret(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

function yesterdayYmd(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function GET(req: Request) {
  if (!checkCronSecret(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const date = yesterdayYmd();
  const doc = await adminDb.collection(COLLECTIONS.dailySales).doc(date).get();
  if (!doc.exists) {
    return NextResponse.json({ ok: true, date, dataReady: false, sent: 0 });
  }

  const { sent, pruned } = await sendPushToAll({
    title: "스톤게이트CC",
    body: `${date} 실적이 들어왔습니다 - 확인해보세요`,
    url: "/",
  });

  return NextResponse.json({ ok: true, date, dataReady: true, sent, pruned });
}
