// Shared domain types used by both storage drivers.

export type ProjectRow = {
  id: string;
  name: string;
  created_at: Date;
};

export type ProjectSummary = ProjectRow & {
  document_count: number;
  chunk_count: number;
  processing_count: number;
  failed_count: number;
};

export type DocumentRow = {
  id: string;
  project_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  chunk_count: number;
  status: "pending" | "processing" | "completed" | "failed";
  error: string | null;
  created_at: Date;
  processed_at: Date | null;
};
