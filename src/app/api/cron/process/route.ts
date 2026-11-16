import { NextRequest, NextResponse } from "next/server";
import { connection } from "next/server";
import { processPendingChunks } from "@/lib/processor";

export const maxDuration = 300;

/**
 * Vercel Cron safety net: retries chunks that were left pending when the
 * background instance from an upload was terminated. Vercel automatically
 * sends `Authorization: Bearer ${CRON_SECRET}` when CRON_SECRET is set.
 */
export async function GET(req: NextRequest) {
  await connection(); // never prerender this route at build time
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  await processPendingChunks();
  return NextResponse.json({ ok: true, resumed: true });
}
