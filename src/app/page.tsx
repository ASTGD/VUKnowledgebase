import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";

// Session-dependent redirect — this route must render per request.
export const instant = false;


export default async function Home() {
  const session = await getAdminSession();
  redirect(session ? "/admin" : "/login");
}
