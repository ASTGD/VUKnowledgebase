import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { processPendingChunks, runBackground } from "@/lib/processor";

export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projects = await getDb().listProjects();

  // Kick off resume of anything left over from previous sessions
  // (e.g. while the admin was away). Fire and forget.
  if (projects.some((p) => p.processing_count > 0)) {
    runBackground(() => processPendingChunks());
  }

  return NextResponse.json({ projects, username: session });
}

export async function POST(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const rawName = (body as { name?: unknown } | null)?.name;
  const name = typeof rawName === "string" ? rawName.trim() : "";

  if (!name || name.length > 120) {
    return NextResponse.json(
      { error: "Project name must be between 1 and 120 characters" },
      { status: 400 },
    );
  }

  const project = await getDb().createProject(name);
  if (!project) {
    return NextResponse.json(
      { error: `A project named "${name}" already exists` },
      { status: 409 },
    );
  }

  return NextResponse.json({ project }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing project id" }, { status: 400 });
  }
  const deletedCount = await getDb().deleteProject(id);
  if (deletedCount === 0) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
