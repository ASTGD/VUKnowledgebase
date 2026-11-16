"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import StatusBadge from "../../status-badge";
import {
  isDocumentActive,
  type DocumentWithProgress,
  type ProjectSummary,
} from "@/lib/types";

type UploadResult = {
  ok: boolean;
  filename: string;
  error?: string;
  chunks?: number;
};

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const ACCEPT =
  ".pdf,.docx,.txt,.md,.markdown,.csv,.json,.log,.rtf,.html,text/*,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [documents, setDocuments] = useState<DocumentWithProgress[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResults, setUploadResults] = useState<UploadResult[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${id}`, { cache: "no-store" });
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to load project");
        return;
      }
      setProject(data.project);
      setDocuments(data.documents);
    } catch {
      // retried by polling
    }
  }, [id, router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch of external data
    void load();
  }, [load]);

  const anyActive = documents.some(isDocumentActive);
  useEffect(() => {
    const interval = setInterval(load, anyActive ? 3000 : 15000);
    return () => clearInterval(interval);
  }, [anyActive, load]);

  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    const oversized = list.filter((f) => f.size > MAX_FILE_BYTES);
    if (oversized.length > 0) {
      setError(
        `${oversized.map((f) => f.name).join(", ")} exceeds the 4 MB per-file limit.`,
      );
      return;
    }

    setUploading(true);
    setError(null);
    setUploadResults(null);
    try {
      const formData = new FormData();
      for (const file of list) formData.append("files", file);

      const res = await fetch(`/api/projects/${id}/documents`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Upload failed");
        return;
      }
      setUploadResults(data.results);
      if (data.documents) setDocuments(data.documents);
    } catch (err) {
      setError(
        err instanceof Error && err.message.includes("413")
          ? "Upload too large — the request body limit is 4.5 MB."
          : "Upload failed",
      );
    } finally {
      setUploading(false);
    }
  }

  async function deleteDocument(doc: DocumentWithProgress) {
    if (!confirm(`Delete "${doc.filename}" and its embeddings?`)) return;
    await fetch(`/api/projects/${id}/documents/${doc.id}`, { method: "DELETE" });
    load();
  }

  if (error && !project) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin"
          className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
        >
          ← All projects
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          {project?.name ?? "…"}
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Upload PDF, DOCX or text files. Each file is split into chunks and
          converted to vectors with gemini-embedding-001 in the background.
        </p>
      </div>

      <label
        htmlFor="file-upload"
        className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-neutral-300 bg-white/50 px-6 py-10 text-center transition hover:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
      >
        <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {uploading ? "Uploading & extracting text…" : "Click to choose files, or drag & drop"}
        </span>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          PDF, DOCX, TXT/MD/CSV · up to 4 MB per file
        </span>
        <input
          id="file-upload"
          type="file"
          multiple
          accept={ACCEPT}
          disabled={uploading}
          className="sr-only"
          onChange={(e) => {
            if (e.target.files?.length) upload(e.target.files);
            e.target.value = "";
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files?.length && !uploading) upload(e.dataTransfer.files);
          }}
        />
      </label>

      {uploadResults && (
        <ul className="space-y-1 text-sm">
          {uploadResults.map((r) => (
            <li
              key={r.filename}
              className={
                r.ok
                  ? "text-green-700 dark:text-green-400"
                  : "text-red-600 dark:text-red-400"
              }
            >
              {r.ok
                ? `✓ ${r.filename} — ${r.chunks} chunks queued for embedding`
                : `✗ ${r.filename} — ${r.error}`}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
        {documents.length === 0 ? (
          <p className="p-8 text-center text-sm text-neutral-500">
            No documents uploaded yet.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
              <tr>
                <th className="px-4 py-2 font-medium">File</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Chunks</th>
                <th className="px-4 py-2 font-medium">Uploaded</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {documents.map((doc) => {
                const pct =
                  doc.chunk_count > 0
                    ? Math.round((doc.chunks_done / doc.chunk_count) * 100)
                    : 0;
                return (
                  <tr key={doc.id} className="align-top">
                    <td className="max-w-xs px-4 py-3">
                      <p className="truncate font-medium text-neutral-900 dark:text-neutral-100">
                        {doc.filename}
                      </p>
                      {doc.error && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-red-600 dark:text-red-400">
                          {doc.error}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={doc.status} /></td>
                    <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">
                      {doc.chunks_done}/{doc.chunk_count}
                      {pct > 0 && pct < 100 && (
                        <span className="ml-2 text-xs">{pct}%</span>
                      )}
                      {pct === 100 && <span className="ml-2 text-xs">✓</span>}
                    </td>
                    <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">
                      {new Date(doc.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => deleteDocument(doc)}
                        className="text-xs text-neutral-400 hover:text-red-600"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
