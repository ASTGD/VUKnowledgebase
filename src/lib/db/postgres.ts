import postgres from "postgres";
import type {
  ChunkBatchRow,
  ChunkCounts,
  DbDriver,
  DocumentRow,
  DocumentWithProgress,
  InsertDocumentInput,
  ProjectRow,
  ProjectSummary,
} from "./types";

// Lazy Postgres client so importing route modules at build time never fails
// when DATABASE_URL is not present in the build environment.
let _sql: postgres.Sql | null = null;

function getSql(): postgres.Sql {
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

function pgVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

export function createPostgresDriver(): DbDriver {
  return {
    kind: "postgres",

    async listProjects(): Promise<ProjectSummary[]> {
      return getSql()<ProjectSummary[]>`
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
    },

    async getProject(id: string): Promise<ProjectRow | null> {
      const rows = await getSql()<ProjectRow[]>`
        SELECT id, name, created_at
        FROM projects
        WHERE id = ${id}
        LIMIT 1
      `;
      return rows[0] ?? null;
    },

    async createProject(name: string): Promise<ProjectRow | null> {
      const rows = await getSql()<ProjectRow[]>`
        INSERT INTO projects (name)
        VALUES (${name})
        ON CONFLICT (name) DO NOTHING
        RETURNING id, name, created_at
      `;
      return rows[0] ?? null;
    },

    async deleteProject(id: string): Promise<number> {
      const result = await getSql()`
        DELETE FROM projects WHERE id = ${id}
      `;
      return result.count;
    },

    async listDocuments(projectId: string): Promise<DocumentWithProgress[]> {
      const rows = await getSql()<
        (Omit<DocumentRow, "status"> & { status: string; chunks_done: number })[]
      >`
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
      return rows.map((r) => ({
        ...r,
        status: r.status as DocumentRow["status"],
      }));
    },

    async insertDocument(input: InsertDocumentInput): Promise<string> {
      const sql = getSql();
      const inserted = await sql<{ id: string }[]>`
        INSERT INTO documents (project_id, filename, mime_type, size_bytes, chunk_count, status)
        VALUES (${input.projectId}, ${input.filename}, ${input.mimeType}, ${input.sizeBytes}, ${input.chunks.length}, 'pending')
        RETURNING id
      `;
      const documentId = inserted[0].id;

      await sql`
        INSERT INTO chunks ${sql(
          input.chunks.map((content, seq) => ({
            document_id: documentId,
            project_id: input.projectId,
            seq,
            content,
          })),
        )}
      `;
      return documentId;
    },

    async deleteDocument(id: string): Promise<number> {
      const result = await getSql()`
        DELETE FROM documents WHERE id = ${id}
      `;
      return result.count;
    },

    async pendingDocumentIds(opts): Promise<string[]> {
      const sql = getSql();
      const rows = await sql<{ document_id: string }[]>`
        SELECT DISTINCT d.id AS document_id
        FROM documents d
        JOIN chunks c ON c.document_id = d.id
        WHERE c.status = 'pending'
          AND c.attempts < ${opts.maxAttempts}
          ${opts.projectId ? sql`AND d.project_id = ${opts.projectId}` : sql``}
          ${opts.documentId ? sql`AND d.id = ${opts.documentId}` : sql``}
        ORDER BY document_id
        LIMIT ${opts.limit}
      `;
      return rows.map((r) => r.document_id);
    },

    async claimDocument(documentId: string, staleMinutes: number): Promise<boolean> {
      const rows = await getSql()<{ id: string }[]>`
        UPDATE documents
        SET status = 'processing',
            updated_at = now()
        WHERE id = ${documentId}
          AND status <> 'completed'
          AND (
            status <> 'processing'
            OR updated_at < now() - make_interval(mins => ${staleMinutes})
          )
        RETURNING id
      `;
      return rows.length > 0;
    },

    async nextChunkBatch(
      documentId: string,
      limit: number,
      maxAttempts: number,
    ): Promise<ChunkBatchRow[]> {
      return getSql()`
        SELECT id, content
        FROM chunks
        WHERE document_id = ${documentId}
          AND status = 'pending'
          AND attempts < ${maxAttempts}
        ORDER BY seq
        LIMIT ${limit}
      `;
    },

    async saveEmbeddedChunk(chunkId: string, vector: number[]): Promise<void> {
      await getSql()`
        UPDATE chunks
        SET status = 'done',
            embedding = ${pgVectorLiteral(vector)}::vector,
            attempts = attempts + 1,
            updated_at = now()
        WHERE id = ${chunkId}
      `;
    },

    async bumpChunkAttempts(chunkId: string, maxAttempts: number): Promise<boolean> {
      const rows = await getSql()<{ exhausted: boolean }[]>`
        UPDATE chunks
        SET attempts = attempts + 1
        WHERE id = ${chunkId}
          AND attempts < ${maxAttempts}
        RETURNING (attempts >= ${maxAttempts}) AS exhausted
      `;
      if (rows.length > 0 && rows[0].exhausted) {
        await getSql()`
          UPDATE chunks SET status = 'failed' WHERE id = ${chunkId}
        `;
        return true;
      }
      return false;
    },

    async touchDocument(documentId: string): Promise<void> {
      await getSql()`
        UPDATE documents SET updated_at = now() WHERE id = ${documentId}
      `;
    },

    async setDocumentError(documentId: string, error: string | null): Promise<void> {
      await getSql()`
        UPDATE documents SET error = ${error}, updated_at = now() WHERE id = ${documentId}
      `;
    },

    async chunkCounts(documentId: string): Promise<ChunkCounts> {
      const rows = await getSql()<ChunkCounts[]>`
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
          COUNT(*) FILTER (WHERE status = 'done')::int AS done,
          COUNT(*)::int AS total
        FROM chunks
        WHERE document_id = ${documentId}
      `;
      return rows[0];
    },

    async setDocumentFinalStatus(documentId, status, error): Promise<void> {
      if (status === "completed") {
        await getSql()`
          UPDATE documents
          SET status = 'completed',
              processed_at = now(),
              error = NULL
          WHERE id = ${documentId}
        `;
      } else if (status === "failed") {
        await getSql()`
          UPDATE documents
          SET status = 'failed',
              processed_at = now(),
              error = ${error}
          WHERE id = ${documentId}
        `;
      } else {
        await getSql()`
          UPDATE documents
          SET status = 'processing',
              updated_at = now(),
              error = ${error}
          WHERE id = ${documentId}
        `;
      }
    },
  };
}
