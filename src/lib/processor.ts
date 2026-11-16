import { waitUntil } from "@vercel/functions";
import { getDb } from "./db";
import { embedTexts, pgVectorLiteral } from "./embed";

/**
 * Durable background embedding pipeline.
 *
 * How conversion continues after the admin closes the browser:
 *  1. Upload responses hand off to Fluid Compute `waitUntil`, which keeps the
 *     function instance working after the HTTP response is sent.
 *  2. Queue state lives in Postgres (chunks.status = 'pending'), never only in
 *     memory — if an instance dies mid-document, nothing is lost.
 *  3. Every dashboard load and every cron tick calls processPendingChunks(),
 *     which reclaims stale 'processing' documents and resumes where the
 *     previous instance left off. The admin sees the final report on next login.
 */

const BATCH_SIZE = 16;
const MAX_ATTEMPTS_PER_CHUNK = 5;
const STALE_PROCESSING_MINUTES = 10;

const inFlight = new Set<string>();

export function runBackground(work: () => Promise<void>): void {
  const promise = work().catch((err) => {
    console.error("[background] job failed:", err);
  });
  if (process.env.VERCEL) {
    waitUntil(promise);
  } else {
    void promise;
  }
}

type ProcessOptions = {
  projectId?: string;
  documentId?: string;
};

type PendingDoc = { document_id: string };
type ChunkRow = { id: string; content: string };
type ChunkCounts = {
  pending: number;
  failed: number;
  done: number;
  total: number;
};

/**
 * Processes every chunk still pending in the database, document by document.
 * Returns when the queue is empty or only exhausted chunks remain.
 */
export async function processPendingChunks(
  options: ProcessOptions = {},
): Promise<void> {
  const db = getDb();

  const docs = await db<PendingDoc[]>`
    SELECT DISTINCT d.id AS document_id
    FROM documents d
    JOIN chunks c ON c.document_id = d.id
    WHERE c.status = 'pending'
      AND c.attempts < ${MAX_ATTEMPTS_PER_CHUNK}
      ${options.projectId ? db`AND d.project_id = ${options.projectId}` : db``}
      ${options.documentId ? db`AND d.id = ${options.documentId}` : db``}
    ORDER BY document_id
    LIMIT 50
  `;

  for (const doc of docs) {
    await processDocument(doc.document_id);
  }
}

export async function processDocument(documentId: string): Promise<void> {
  if (inFlight.has(documentId)) return;
  inFlight.add(documentId);

  try {
    const db = getDb();

    // Claim the document. A crashed instance's claim expires after the stale
    // window, so the next resume attempt takes over automatically.
    const claimed = await db<{ id: string }[]>`
      UPDATE documents
      SET status = 'processing',
          updated_at = now()
      WHERE id = ${documentId}
        AND status <> 'completed'
        AND (
          status <> 'processing'
          OR updated_at < now() - make_interval(mins => ${STALE_PROCESSING_MINUTES})
        )
      RETURNING id
    `;
    if (claimed.length === 0) return;

    let lastError: string | null = null;

    for (;;) {
      const batch = await db<ChunkRow[]>`
        SELECT id, content
        FROM chunks
        WHERE document_id = ${documentId}
          AND status = 'pending'
          AND attempts < ${MAX_ATTEMPTS_PER_CHUNK}
        ORDER BY seq
        LIMIT ${BATCH_SIZE}
      `;
      if (batch.length === 0) break;

      try {
        const vectors = await embedTexts(batch.map((c) => c.content));

        for (let i = 0; i < batch.length; i++) {
          await db`
            UPDATE chunks
            SET status = 'done',
                embedding = ${pgVectorLiteral(vectors[i])}::vector,
                attempts = attempts + 1,
                updated_at = now()
            WHERE id = ${batch[i].id}
          `;
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        console.error(`[processor] embedding failed for ${documentId}: ${lastError}`);

        // Consume an attempt per chunk; exhaust them so permanently broken
        // docs stop retrying, while transient failures stay retryable.
        for (const chunk of batch) {
          const rows = await db<{ exhausted: boolean }[]>`
            UPDATE chunks
            SET attempts = attempts + 1
            WHERE id = ${chunk.id}
              AND attempts < ${MAX_ATTEMPTS_PER_CHUNK}
            RETURNING (attempts >= ${MAX_ATTEMPTS_PER_CHUNK}) AS exhausted
          `;
          if (rows.length > 0 && rows[0].exhausted) {
            await db`UPDATE chunks SET status = 'failed' WHERE id = ${chunk.id}`;
          }
        }
        break; // Stop hammering the API this tick; a later resume takes over.
      }

      await db`
        UPDATE documents
        SET updated_at = now()
        WHERE id = ${documentId}
      `;
    }

    const counts = await db<ChunkCounts[]>`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
        COUNT(*) FILTER (WHERE status = 'done')::int AS done,
        COUNT(*)::int AS total
      FROM chunks
      WHERE document_id = ${documentId}
    `;
    const { pending, failed, total } = counts[0];

    if (pending > 0) {
      await db`
        UPDATE documents
        SET status = 'processing',
            updated_at = now(),
            error = ${lastError}
        WHERE id = ${documentId}
      `;
    } else if (failed > 0) {
      await db`
        UPDATE documents
        SET status = 'failed',
            processed_at = now(),
            error = COALESCE(${lastError}, ${`${failed}/${total} chunks exhausted the maximum number of embedding attempts.`})
        WHERE id = ${documentId}
      `;
    } else {
      await db`
        UPDATE documents
        SET status = 'completed',
            processed_at = now(),
            error = NULL
        WHERE id = ${documentId}
      `;
    }
  } finally {
    inFlight.delete(documentId);
  }
}
