import { NextResponse } from "next/server";

/** Server-only PIN check for the /upload write path. This is the entire
 * security boundary for writes (Firestore rules deny client writes
 * outright - see firestore.rules and PRD.md §3.2), so it must run here,
 * never trust a client-side "unlocked" flag alone. */
export function checkPin(pin: unknown): NextResponse | null {
  const expected = process.env.UPLOAD_PIN;
  if (!expected) {
    return NextResponse.json({ ok: false, error: "서버에 UPLOAD_PIN이 설정되어 있지 않습니다" }, { status: 500 });
  }
  if (typeof pin !== "string" || pin !== expected) {
    return NextResponse.json({ ok: false, error: "PIN이 올바르지 않습니다" }, { status: 401 });
  }
  return null;
}
