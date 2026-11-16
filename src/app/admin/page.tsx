"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectSummary } from "@/lib/types";

export default function AdminDashboardPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasResumedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/projects", { cache: "no-store" });
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      const data = await res.json();
      setProjects(data.projects ?? []);
    } catch {
      // Network hiccup — next poll will recover.
    } finally {
      setLoading(false);
    }
  }, [router]);

  // On first load, ask the server to resume any conversions that were left
  // running from a previous session, then poll for live status.
  useEffect(() => {
    if (!hasResumedRef.current) {
      hasResumedRef.current = true;
      fetch("/api/jobs/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch of external data
    void load();
  }, [load]);

  const anyProcessing = projects.some((p) => p.processing_count > 0);
  useEffect(() => {
    const interval = setInterval(load, anyProcessing ? 3000 : 15000);
    return () => clearInterval(interval);
  }, [anyProcessing, load]);

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not create project");
        return;
      }
      setNewName("");
      await load();
    } catch {
      setError("Network error");
    } finally {
      setCreating(false);
    }
  }

  async function deleteProject(p: ProjectSummary) {
    if (!confirm(`Delete project "${p.name}" and all of its data (documents + embeddings)?`)) {
      return;
    }
    const res = await fetch(`/api/projects?id=${p.id}`, { method: "DELETE" });
    if (res.ok) await load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          Projects
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Documents are embedded with{" "}
          <code className="text-xs">gemini-embedding-001</code> in the background —
          conversion continues even after this browser is closed, and any pending
          work is reported when you log back in.
        </p>
      </div>

      {anyProcessing && (
        <div className="rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:bg-blue-950/50 dark:text-blue-200">
          Background conversion is in progress… status updates every few seconds.
        </div>
      )}

      <form onSubmit={createProject} className="flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New project name"
          className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-100"
        />
        <button
          type="submit"
          disabled={creating || !newName.trim()}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {creating ? "Creating…" : "Create project"}
        </button>
      </form>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-neutral-500">Loading projects…</p>
      ) : projects.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-700">
          No projects yet. Create one above to start uploading documents.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {projects.map((p) => (
            <li
              key={p.id}
              className="group rounded-xl border border-neutral-200 bg-white p-4 transition hover:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-600"
            >
              <div className="flex items-start justify-between gap-2">
                <Link
                  href={`/admin/projects/${p.id}`}
                  className="font-medium text-neutral-900 hover:underline dark:text-neutral-100"
                >
                  {p.name}
                </Link>
                <button
                  onClick={() => deleteProject(p)}
                  className="text-xs text-neutral-400 opacity-0 transition group-hover:opacity-100 hover:text-red-600"
                  aria-label={`Delete project ${p.name}`}
                >
                  Delete
                </button>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                <div>
                  <dt className="font-medium text-neutral-900 dark:text-neutral-200">
                    {p.document_count}
                  </dt>
                  <dd>documents</dd>
                </div>
                <div>
                  <dt className="font-medium text-neutral-900 dark:text-neutral-200">
                    {p.chunk_count}
                  </dt>
                  <dd>chunks embedded</dd>
                </div>
                <div>
                  <dt
                    className={`font-medium ${
                      p.processing_count > 0
                        ? "text-blue-600 dark:text-blue-400"
                        : p.failed_count > 0
                          ? "text-red-600 dark:text-red-400"
                          : "text-neutral-900 dark:text-neutral-200"
                    }`}
                  >
                    {p.processing_count > 0
                      ? `${p.processing_count} processing`
                      : p.failed_count > 0
                        ? `${p.failed_count} failed`
                        : "All done"}
                  </dt>
                  <dd>status</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
