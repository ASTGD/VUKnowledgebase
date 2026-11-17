// Storage driver interface. Two implementations:
//  - postgres.ts: Postgres + pgvector (Neon/Supabase/self-hosted) — used on Vercel
//  - sqlite.ts:   local-file SQLite for local development/testing
//
// Selected at runtime by DB_DRIVER env ("sqlite" | "postgres"); defaults to
// postgres when DATABASE_URL is set, sqlite when SQLITE_FILE is set.
//
// Note: SQLite stores embeddings as JSON (this app never queries them yet);
// Postgres stores them as pgvector columns. Both satisfy the same interface.

import type { DocumentRow, ProjectRow, ProjectSummary } from "../domain-types";

export type { DocumentRow, ProjectRow, ProjectSummary };

export type DocumentStatus = "pending" | "processing" | "completed" | "failed";

export type DocumentWithProgress = DocumentRow & {
  chunks_done: number;
};

export type InsertDocumentInput = {
  projectId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  chunks: string[];
};

export type ChunkBatchRow = { id: string; content: string };

export type ChunkCounts = {
  pending: number;
  failed: number;
  done: number;
  total: number;
};

export type SearchHit = {
  chunkId: string;
  documentId: string;
  filename: string;
  content: string;
  /** Cosine similarity in [0, 1]; 1 = identical direction. */
  similarity: number;
};

export type DbDriver = {
  kind: "postgres" | "sqlite";

  // Projects
  listProjects(): Promise<ProjectSummary[]>;
  getProject(id: string): Promise<ProjectRow | null>;
  /** Returns null when the name already exists (unique constraint). */
  createProject(name: string): Promise<ProjectRow | null>;
  /** Returns the number of deleted rows. */
  deleteProject(id: string): Promise<number>;

  // Documents
  listDocuments(projectId: string): Promise<DocumentWithProgress[]>;
  /** Inserts the document and all its (pending) chunks in one transaction. */
  insertDocument(input: InsertDocumentInput): Promise<string>;
  deleteDocument(id: string): Promise<number>;

  // Background processor queue operations
  pendingDocumentIds(opts: {
    projectId?: string;
    documentId?: string;
    limit: number;
    maxAttempts: number;
  }): Promise<string[]>;
  /**
   * Moves a document into 'processing' unless it is completed, or is being
   * processed by another worker whose claim is still fresh. Returns true when
   * the claim was taken.
   */
  claimDocument(documentId: string, staleMinutes: number): Promise<boolean>;
  nextChunkBatch(
    documentId: string,
    limit: number,
    maxAttempts: number,
  ): Promise<ChunkBatchRow[]>;
  /** Marks a chunk done and stores its embedding. */
  saveEmbeddedChunk(chunkId: string, vector: number[]): Promise<void>;
  /**
   * Consumes one attempt. Returns true when the chunk has exhausted its
   * attempts (in which case the driver marks it 'failed').
   */
  bumpChunkAttempts(chunkId: string, maxAttempts: number): Promise<boolean>;
  touchDocument(documentId: string): Promise<void>;
  setDocumentError(documentId: string, error: string | null): Promise<void>;
  chunkCounts(documentId: string): Promise<ChunkCounts>;
  setDocumentFinalStatus(
    documentId: string,
    status: "processing" | "completed" | "failed",
    error: string | null,
  ): Promise<void>;

  // Retrieval
  /**
   * Cosine-similarity search over embedded chunks, best-first.
   * `minSimilarity` is optional; when given, weaker hits are dropped.
   */
  searchSimilarChunks(
    vector: number[],
    opts: { limit: number; minSimilarity?: number },
  ): Promise<SearchHit[]>;
};
