# VU Knowledgebase

Admin panel for ingesting documents into a pgvector-backed knowledge base.
Uploads (PDF / DOCX / TXT) are split into chunks and converted to vectors with
**gemini-embedding-001** by a background job — conversion continues even if the
browser is closed, and unfinished work is automatically resumed and reported
the next time the admin logs in.

## Stack

- **Next.js 16** (App Router, Node runtime on Fluid Compute)
- **Postgres + pgvector** — stores projects, documents, chunks, job status and the embeddings themselves
- **Google Generative Language API** — `gemini-embedding-001` via REST (no lock-in)
- Session auth — JWT cookie signed with `AUTH_SECRET`; admin credentials come from env

## Environment variables

Copy `.env.example` to `.env` (local) or set them in Vercel (Project → Settings → Environment Variables, or `vercel env add`):

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string. The database needs the **pgvector** extension (Neon and Supabase have it built in). |
| `GOOGLE_API_KEY` | yes | API key for gemini-embedding-001 (https://aistudio.google.com/apikey). |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | yes | The single admin login. |
| `AUTH_SECRET` | yes | Random string used to sign the session JWT. |
| `EMBEDDING_MODEL` | no | Defaults to `gemini-embedding-001`. |
| `EMBEDDING_DIMS` | no | Embedding dimension; default `3072` (model supports 768–3072). |
| `CRON_SECRET` | no | If set, Vercel Cron gets authorized automatically on `/api/cron/process`. |

## Setup

```bash
npm install
npm run db:init     # creates the schema (projects, documents, chunks) — run once per database
npm run dev
```

Open http://localhost:3000 → log in with your admin credentials → create a project → upload files.

## Deploying to Vercel

1. Push this repo to GitHub, then create the project in Vercel (or run `vercel` from this directory).
2. Add the env variables above to Production (and Preview if you want).
3. Run `DATABASE_URL=... npm run db:init` from your machine against the **production** database (it only creates tables — it is safe to re-run).
4. Deploy.

## How background conversion works

1. On upload, text is extracted synchronously (unpdf for PDF, mammoth for DOCX) and split into ~1,200-char overlapping chunks which are stored as `pending` rows in Postgres.
2. The HTTP response is returned immediately; embedding continues in the same function instance after the response via Fluid Compute `waitUntil`.
3. All queue state lives in the database, never in memory. Three things resume interrupted work:
   - Every dashboard/project load calls `/api/jobs/resume`, which reclaims documents left `pending`/stale from a previous session and reports final status to the admin.
   - A Vercel Cron job (`/api/cron/process`, hourly, configured in `vercel.json`) retries anything left over.
   - If the API rate-limits (429), the job backs off and retries; each chunk keeps an attempt counter (5 max) so permanently broken files fail loudly while transient failures stay retryable.

Notes:

- Vercel caps the request body at 4.5 MB, so the upload endpoint enforces a 4 MB per-file limit. For larger PDFs, add [Vercel Blob client uploads](https://vercel.com/docs/storage/vercel-blob) and point the processor at the blob URL.
- Scanned/image-only PDFs contain no extractable text and will fail with a clear error.
- `pgvector`'s HNSW/IVFFlat indexes are not created automatically — add one (`CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)`) once you exceed ~100k vectors, or query via `ORDER BY embedding <=> $vec LIMIT k`.
