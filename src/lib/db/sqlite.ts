import { randomUUID } from "crypto";
import { DatabaseSync } from "node:sqlite";
import path from "path";
import type {
  ChunkBatchRow,
  ChunkCounts,
  DbDriver,
  DocumentWithProgress,
  ProjectRow,
  ProjectSummary,
  SearchHit,
} from "./types";

/**
 * Local development driver backed by node:sqlite (bundled with Node 24, no
 * native dependencies). Embeddings are stored as JSON — this app has no
 * vector-similarity queries yet, and when the app is deployed it runs against
 * Postgres/pgvector, where the embeddings become real vector columns.
 */

let _db: DatabaseSync | null = null;
let _schemaReady = false;

function getDb(): DatabaseSync {
  if (!_db) {
    const file = process.env.SQLITE_FILE || "local.db";
    _db = new DatabaseSync(path.resolve(process.cwd(), file));
    _db.exec("PRAGMA journal_mode = WAL");
    ensureSchema();
  }
  return _db;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  processed_at INTEGER
);
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'done', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  embedding TEXT,
  updated_at INTEGER NOT NULL,
  UNIQUE (document_id, seq)
);
CREATE INDEX IF NOT EXISTS chunks_pending_idx ON chunks (document_id, seq) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS chunks_project_idx ON chunks (project_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS documents_project_idx ON documents (project_id, created_at DESC);
`;

function ensureSchema(): void {
  if (_schemaReady) return;
  getDb().exec(SCHEMA);
  _schemaReady = true;
}

function now(): number {
  return Date.now();
}

function dateOf(ms: number | null): Date | null {
  return ms === null ? null : new Date(ms);
}

function inTransaction<T>(fn: () => T): T {
  const db = getDb();
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function createSqliteDriver(): DbDriver {
  return {
    kind: "sqlite",

    async listProjects(): Promise<ProjectSummary[]> {
      const rows = getDb()
        .prepare(
          `SELECT
             p.id, p.name, p.created_at,
             COUNT(d.id) AS document_count,
             COALESCE(SUM(d.chunk_count), 0) AS chunk_count,
             COALESCE(SUM(CASE WHEN d.status = 'processing' THEN 1 ELSE 0 END), 0) AS processing_count,
             COALESCE(SUM(CASE WHEN d.status = 'failed' THEN 1 ELSE 0 END), 0) AS failed_count
           FROM projects p
           LEFT JOIN documents d ON d.project_id = p.id
           GROUP BY p.id
           ORDER BY p.created_at DESC`,
        )
        .all() as unknown as Array<{
        id: string;
        name: string;
        created_at: number;
        document_count: number;
        chunk_count: number;
        processing_count: number;
        failed_count: number;
      }>;
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        created_at: new Date(r.created_at),
        document_count: r.document_count,
        chunk_count: r.chunk_count,
        processing_count: r.processing_count,
        failed_count: r.failed_count,
      }));
    },

    async getProject(id): Promise<ProjectRow | null> {
      const row = getDb()
        .prepare("SELECT id, name, created_at FROM projects WHERE id = ?")
        .get(id) as { id: string; name: string; created_at: number } | undefined;
      if (!row) return null;
      return { id: row.id, name: row.name, created_at: dateOf(row.created_at)! };
    },

    async createProject(name): Promise<ProjectRow | null> {
      const ts = now();
      const id = randomUUID();
      try {
        getDb()
          .prepare("INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)")
          .run(id, name, ts);
        return { id, name, created_at: dateOf(ts)! };
      } catch (err) {
        if (err instanceof Error && err.message.includes("UNIQUE")) return null;
        throw err;
      }
    },

    async deleteProject(id): Promise<number> {
      const info = getDb().prepare("DELETE FROM projects WHERE id = ?").run(id);
      return Number(info.changes);
    },

    async listDocuments(projectId): Promise<DocumentWithProgress[]> {
      const rows = getDb()
        .prepare(
          `SELECT
             id, project_id, filename, mime_type, size_bytes, chunk_count,
             status, error, created_at, processed_at,
             (SELECT COUNT(*) FROM chunks c WHERE c.document_id = documents.id AND c.status = 'done') AS chunks_done
           FROM documents
           WHERE project_id = ?
           ORDER BY created_at DESC`,
        )
        .all(projectId) as unknown as Array<{
        id: string;
        project_id: string;
        filename: string;
        mime_type: string;
        size_bytes: number;
        chunk_count: number;
        status: string;
        error: string | null;
        created_at: number;
        processed_at: number | null;
        chunks_done: number;
      }>;
      return rows.map((r) => ({
        id: r.id,
        project_id: r.project_id,
        filename: r.filename,
        mime_type: r.mime_type,
        size_bytes: r.size_bytes,
        chunk_count: r.chunk_count,
        status: r.status as DocumentWithProgress["status"],
        error: r.error,
        created_at: dateOf(r.created_at)!,
        processed_at: dateOf(r.processed_at),
        chunks_done: r.chunks_done,
      }));
    },

    async insertDocument(input): Promise<string> {
      const documentId = randomUUID();
      const ts = now();
      inTransaction(() => {
        getDb()
          .prepare(
            `INSERT INTO documents
               (id, project_id, filename, mime_type, size_bytes, chunk_count, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
          )
          .run(
            documentId,
            input.projectId,
            input.filename,
            input.mimeType,
            input.sizeBytes,
            input.chunks.length,
            ts,
            ts,
          );

        const stmt = getDb().prepare(
          `INSERT INTO chunks (id, document_id, project_id, seq, content, status, updated_at)
           VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
        );
        input.chunks.forEach((content, seq) => {
          stmt.run(randomUUID(), documentId, input.projectId, seq, content, ts);
        });
      });
      return documentId;
    },

    async deleteDocument(id): Promise<number> {
      const info = getDb().prepare("DELETE FROM documents WHERE id = ?").run(id);
      return Number(info.changes);
    },

    async pendingDocumentIds(opts): Promise<string[]> {
      const clauses = [
        "SELECT DISTINCT d.id AS document_id FROM documents d JOIN chunks c ON c.document_id = d.id",
        "WHERE c.status = 'pending' AND c.attempts < ?",
      ];
      const params: (string | number)[] = [opts.maxAttempts];
      if (opts.projectId) {
        clauses.push("AND d.project_id = ?");
        params.push(opts.projectId);
      }
      if (opts.documentId) {
        clauses.push("AND d.id = ?");
        params.push(opts.documentId);
      }
      clauses.push("ORDER BY d.id LIMIT ?");
      params.push(opts.limit);
      const rows = getDb()
        .prepare(clauses.join(" "))
        .all(...params) as unknown as Array<{ document_id: string }>;
      return rows.map((r) => r.document_id);
    },

    async claimDocument(documentId, staleMinutes): Promise<boolean> {
      const cutoff = now() - staleMinutes * 60_000;
      const info = getDb()
        .prepare(
          `UPDATE documents
           SET status = 'processing', updated_at = ?
           WHERE id = ?
             AND status <> 'completed'
             AND (status <> 'processing' OR updated_at < ?)`,
        )
        .run(now(), documentId, cutoff);
      return info.changes > 0;
    },

    async nextChunkBatch(documentId, limit, maxAttempts): Promise<ChunkBatchRow[]> {
      const rows = getDb()
        .prepare(
          `SELECT id, content FROM chunks
           WHERE document_id = ? AND status = 'pending' AND attempts < ?
           ORDER BY seq LIMIT ?`,
        )
        .all(documentId, maxAttempts, limit) as unknown as ChunkBatchRow[];
      return rows;
    },

    async saveEmbeddedChunk(chunkId, vector): Promise<void> {
      getDb()
        .prepare(
          `UPDATE chunks
           SET status = 'done', embedding = ?, attempts = attempts + 1, updated_at = ?
           WHERE id = ?`,
        )
        .run(JSON.stringify(vector), now(), chunkId);
    },

    async bumpChunkAttempts(chunkId, maxAttempts): Promise<boolean> {
      const info = getDb()
        .prepare("UPDATE chunks SET attempts = attempts + 1 WHERE id = ? AND attempts < ?")
        .run(chunkId, maxAttempts);
      if (info.changes === 0) return false;
      const row = getDb()
        .prepare("SELECT attempts FROM chunks WHERE id = ?")
        .get(chunkId) as { attempts: number } | undefined;
      if (row && row.attempts >= maxAttempts) {
        getDb().prepare("UPDATE chunks SET status = 'failed' WHERE id = ?").run(chunkId);
        return true;
      }
      return false;
    },

    async touchDocument(documentId): Promise<void> {
      getDb()
        .prepare("UPDATE documents SET updated_at = ? WHERE id = ?")
        .run(now(), documentId);
    },

    async setDocumentError(documentId, error): Promise<void> {
      getDb()
        .prepare("UPDATE documents SET error = ?, updated_at = ? WHERE id = ?")
        .run(error, now(), documentId);
    },

    async chunkCounts(documentId): Promise<ChunkCounts> {
      const row = getDb()
        .prepare(
          `SELECT
             SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
             SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
             SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
             COUNT(*) AS total
           FROM chunks WHERE document_id = ?`,
        )
        .get(documentId) as {
        pending: number | null;
        failed: number | null;
        done: number | null;
        total: number;
      };
      return {
        pending: row.pending ?? 0,
        failed: row.failed ?? 0,
        done: row.done ?? 0,
        total: row.total ?? 0,
      };
    },

    async setDocumentFinalStatus(documentId, status, error): Promise<void> {
      const ts = now();
      if (status === "completed") {
        getDb()
          .prepare(
            "UPDATE documents SET status = 'completed', processed_at = ?, error = NULL WHERE id = ?",
          )
          .run(ts, documentId);
      } else if (status === "failed") {
        getDb()
          .prepare(
            "UPDATE documents SET status = 'failed', processed_at = ?, error = ? WHERE id = ?",
          )
          .run(ts, error, documentId);
      } else {
        getDb()
          .prepare("UPDATE documents SET status = 'processing', updated_at = ?, error = ? WHERE id = ?")
          .run(ts, error, documentId);
      }
    },

    async searchSimilarChunks(vector, opts): Promise<SearchHit[]> {
      const min = opts.minSimilarity ?? 0;
      // Brute-force cosine similarity in JS; SQLite is the local-testing
      // driver only, so a full scan is fine here.
      const rows = getDb()
        .prepare(
          `SELECT c.id, c.document_id, d.filename, c.content, c.embedding
           FROM chunks c
           JOIN documents d ON d.id = c.document_id
           WHERE c.status = 'done' AND c.embedding IS NOT NULL`,
        )
        .all() as unknown as Array<{
        id: string;
        document_id: string;
        filename: string;
        content: string;
        embedding: string;
      }>;

      let sumSq = 0;
      for (const v of vector) sumSq += v * v;
      const queryNorm = Math.sqrt(sumSq) || 1;

      return rows
        .map((row) => {
          const stored = JSON.parse(row.embedding) as number[];
          let dot = 0;
          let storedNorm = 0;
          for (let i = 0; i < vector.length; i++) {
            dot += vector[i] * (stored[i] ?? 0);
            storedNorm += (stored[i] ?? 0) ** 2;
          }
          const similarity = dot / (queryNorm * (Math.sqrt(storedNorm) || 1));
          return {
            chunkId: row.id,
            documentId: row.document_id,
            filename: row.filename,
            content: row.content,
            similarity,
          };
        })
        .filter((hit) => hit.similarity >= min)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, opts.limit);
    },
  };
}
