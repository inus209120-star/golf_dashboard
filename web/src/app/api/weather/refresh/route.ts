import { NextResponse } from "next/server";
import { fetchAndCacheWeather } from "@/lib/weather";

// Manual/on-demand refresh (also reusable later as a Vercel Cron target once deployed).
export async function GET() {
  try {
    const doc = await fetchAndCacheWeather();
    return NextResponse.json({ ok: true, doc });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
