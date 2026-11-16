import postgres from "postgres";

let _sql: postgres.Sql | null = null;

/**
 * Lazy Postgres client so that importing route modules at build time
 * never fails when DATABASE_URL is not present in the build environment.
 * Works with any Postgres that has the pgvector extension (Neon, Supabase, RDS, self-hosted).
 */
export function getDb(): postgres.Sql {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set");
    }
    _sql = postgres(url, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 15,
    });
  }
  return _sql;
}

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

export type DocumentWithProgress = DocumentRow & {
  chunks_done: number;
};

export function listProjects() {
  return getDb()<ProjectSummary[]>`
    SELECT
      p.id,
      p.name,
      p.created_at,
      COUNT(d.id)::int AS document_count,
      COALESCE(SUM(d.chunk_count), 0)::int AS chunk_count,
      COALESCE(SUM(CASE WHEN d.status = 'processing' THEN 1 ELSE 0 END), 0)::int AS processing_count,
      COALESCE(SUM(CASE WHEN d.status = 'failed' THEN 1 ELSE 0 END), 0)::int AS failed_count
    FROM projects p
    LEFT JOIN documents d ON d.project_id = p.id
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `;
}

export function getProject(id: string) {
  return getDb()<ProjectRow[]>`
    SELECT id, name, created_at
    FROM projects
    WHERE id = ${id}
    LIMIT 1
  `;
}

export function listDocuments(projectId: string) {
  return getDb()<DocumentWithProgress[]>`
    SELECT
      d.id,
      d.project_id,
      d.filename,
      d.mime_type,
      d.size_bytes,
      d.chunk_count,
      d.status,
      d.error,
      d.created_at,
      d.processed_at,
      (SELECT COUNT(*) FROM chunks c WHERE c.document_id = d.id AND c.status = 'done')::int AS chunks_done
    FROM documents d
    WHERE d.project_id = ${projectId}
    ORDER BY d.created_at DESC
  `;
}

export function deleteProject(id: string) {
  return getDb()`
    DELETE FROM projects WHERE id = ${id}
  `;
}

export function deleteDocument(id: string) {
  return getDb()`
    DELETE FROM documents WHERE id = ${id}
  `;
}
