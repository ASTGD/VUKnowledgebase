import { NextRequest, NextResponse } from "next/server";
import { setSessionCookie, verifyCredentials, getAdminSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { username, password } = (body ?? {}) as Record<string, unknown>;

  let authenticated: string | null = null;
  try {
    authenticated = await verifyCredentials(username, password);
  } catch (err) {
    console.error("[login] server misconfigured:", err);
    return NextResponse.json(
      { error: "Server is misconfigured: ADMIN_USERNAME/ADMIN_PASSWORD/AUTH_SECRET must be set" },
      { status: 500 },
    );
  }

  if (!authenticated) {
    return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
  }

  await setSessionCookie(authenticated);
  return NextResponse.json({ ok: true, username: authenticated });
}

export async function GET() {
  const session = await getAdminSession();
  return NextResponse.json({ authenticated: session !== null });
}
