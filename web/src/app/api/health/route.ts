import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";

// Temporary connectivity check for initial Firebase setup.
// Writes and reads back one throwaway doc via the Admin SDK.
export async function GET() {
  try {
    const ref = adminDb.collection("_health").doc("check");
    await ref.set({ checkedAt: new Date().toISOString() });
    const snap = await ref.get();
    return NextResponse.json({ ok: true, data: snap.data() });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
