import { waitUntil } from "@vercel/functions";
import { getDb } from "./db";
import { embedTexts } from "./embed";

/**
 * Durable background embedding pipeline.
 *
 * How conversion continues after the admin closes the browser:
 *  1. Upload responses hand off to Fluid Compute `waitUntil`, which keeps the
 *     function instance working after the HTTP response is sent.
 *  2. Queue state lives in the database (chunks.status = 'pending'), never
 *     only in memory — if an instance dies mid-document, nothing is lost.
 *  3. Every dashboard load and every cron tick calls processPendingChunks(),
 *     which reclaims stale 'processing' documents and resumes where the
 *     previous instance left off. The admin sees the final report on next login.
 */

const BATCH_SIZE = 16;
const MAX_ATTEMPTS_PER_CHUNK = 5;
const STALE_PROCESSING_MINUTES = 10;
const MAX_DOCS_PER_RUN = 50;

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

/**
 * Processes every chunk still pending in the database, document by document.
 * Returns when the queue is empty or only exhausted chunks remain.
 */
export async function processPendingChunks(
  options: ProcessOptions = {},
): Promise<void> {
  const db = getDb();
  const documentIds = await db.pendingDocumentIds({
    projectId: options.projectId,
    documentId: options.documentId,
    limit: MAX_DOCS_PER_RUN,
    maxAttempts: MAX_ATTEMPTS_PER_CHUNK,
  });

  for (const documentId of documentIds) {
    await processDocument(documentId);
  }
}

export async function processDocument(documentId: string): Promise<void> {
  if (inFlight.has(documentId)) return;
  inFlight.add(documentId);

  try {
    const db = getDb();

    // Claim the document. A crashed instance's claim expires after the stale
    // window, so the next resume attempt takes over automatically.
    const claimed = await db.claimDocument(
      documentId,
      STALE_PROCESSING_MINUTES,
    );
    if (!claimed) return;

    let lastError: string | null = null;

    for (;;) {
      const batch = await db.nextChunkBatch(
        documentId,
        BATCH_SIZE,
        MAX_ATTEMPTS_PER_CHUNK,
      );
      if (batch.length === 0) break;

      try {
        const vectors = await embedTexts(batch.map((c) => c.content));

        for (let i = 0; i < batch.length; i++) {
          await db.saveEmbeddedChunk(batch[i].id, vectors[i]);
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        console.error(
          `[processor] embedding failed for ${documentId}: ${lastError}`,
        );

        // Consume an attempt per chunk; exhaust them so permanently broken
        // docs stop retrying, while transient failures stay retryable.
        for (const chunk of batch) {
          await db.bumpChunkAttempts(chunk.id, MAX_ATTEMPTS_PER_CHUNK);
        }
        await db.setDocumentError(documentId, lastError);
        break; // Stop hammering the API this tick; a later resume takes over.
      }

      await db.touchDocument(documentId);
    }

    const counts = await db.chunkCounts(documentId);

    if (counts.pending > 0) {
      await db.setDocumentFinalStatus(documentId, "processing", lastError);
    } else if (counts.failed > 0) {
      await db.setDocumentFinalStatus(
        documentId,
        "failed",
        lastError ??
          `${counts.failed}/${counts.total} chunks exhausted the maximum number of embedding attempts.`,
      );
    } else {
      await db.setDocumentFinalStatus(documentId, "completed", null);
    }
  } finally {
    inFlight.delete(documentId);
  }
}
