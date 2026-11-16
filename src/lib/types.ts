// Shapes returned by the JSON API (serialized — dates arrive as strings).

export type ProjectSummary = {
  id: string;
  name: string;
  created_at: string;
  document_count: number;
  chunk_count: number;
  processing_count: number;
  failed_count: number;
};

export type DocumentWithProgress = {
  id: string;
  project_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  chunk_count: number;
  status: "pending" | "processing" | "completed" | "failed";
  error: string | null;
  created_at: string;
  processed_at: string | null;
  chunks_done: number;
};

export const ACTIVE_STATUSES = ["pending", "processing"] as const;

export function isDocumentActive(doc: DocumentWithProgress): boolean {
  return (
    (doc.status === "pending" || doc.status === "processing") &&
    doc.chunks_done < doc.chunk_count
  );
}
