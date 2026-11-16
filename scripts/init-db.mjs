/**
 * Creates the pgvector schema. Run once per database:
 *   npm run db:init
 * Requires a Postgres with the pgvector extension available (Neon, Supabase,
 * RDS, self-hosted with `apt install postgresql-16-pgvector` etc.).
 */

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
  process.exit(1);
}

const { default: postgres } = await import("postgres");
const sql = postgres(DATABASE_URL, { max: 1 });

const DIMS = Number(process.env.EMBEDDING_DIMS || 3072);
if (![768, 1536, 3072].includes(DIMS) && !(DIMS >= 768 && DIMS <= 3072)) {
  console.error(`EMBEDDING_DIMS=${DIMS} is invalid. gemini-embedding-001 supports 768–3072.`);
  process.exit(1);
}

const statements = [
  `CREATE EXTENSION IF NOT EXISTS vector`,

  `CREATE TABLE IF NOT EXISTS projects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    filename text NOT NULL,
    mime_type text NOT NULL DEFAULT '',
    size_bytes bigint NOT NULL DEFAULT 0,
    chunk_count integer NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz
  )`,

  `CREATE TABLE IF NOT EXISTS chunks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    seq integer NOT NULL,
    content text NOT NULL,
    status text NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'done', 'failed')),
    attempts integer NOT NULL DEFAULT 0,
    embedding vector(${DIMS}),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (document_id, seq)
  )`,

  `CREATE INDEX IF NOT EXISTS chunks_pending_idx
    ON chunks (document_id, seq)
    WHERE status = 'pending'`,

  `CREATE INDEX IF NOT EXISTS chunks_project_idx
    ON chunks (project_id) WHERE status = 'pending'`,

  `CREATE INDEX IF NOT EXISTS documents_project_idx
    ON documents (project_id, created_at DESC)`,
];

try {
  for (const statement of statements) {
    await sql.unsafe(statement);
  }
  console.log(`Schema ready. Embedding dimension: ${DIMS}`);
} catch (err) {
  console.error("Schema initialization failed:", err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
