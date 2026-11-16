import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { processPendingChunks, runBackground } from "@/lib/processor";


/**
 * Manual resume endpoint. Called by the admin dashboard when it loads, so any
 * conversion work that outlived a previous browser session is picked up and
 * reported on next login.
 */
export async function POST(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let projectId: string | undefined;
  try {
    const body = (await req.json()) as { projectId?: string } | null;
    if (typeof body?.projectId === "string") projectId = body.projectId;
  } catch {
    // no body — that's fine
  }

  runBackground(() => processPendingChunks({ projectId }));

  return NextResponse.json({ started: true });
}
