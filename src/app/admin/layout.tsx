import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import LogoutButton from "./logout-button";

// Auth guard reads session cookies — render per request, never prerender.
export const instant = false;


export default async function AdminLayout({
  children,
}: LayoutProps<"/admin">) {
  const session = await getAdminSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            VU Knowledgebase
          </span>
          <div className="flex items-center gap-3 text-sm text-neutral-500 dark:text-neutral-400">
            <span>{session}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
