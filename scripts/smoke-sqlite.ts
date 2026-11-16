/**
 * Scratch smoke test for the SQLite driver (not part of the app).
 * Exercises the full queue lifecycle without calling the Gemini API.
 * Run: npx tsx scripts/smoke-sqlite.ts
 */
process.env.DB_DRIVER = "sqlite";
process.env.SQLITE_FILE = "smoke-test.db";

import { rmSync } from "node:fs";
import { getDb } from "../src/lib/db";
import { chunkText } from "../src/lib/chunk";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
  console.log(`ok: ${msg}`);
}

async function main() {
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`smoke-test.db${suffix}`, { force: true });
  }

  const db = getDb();
  assert(db.kind === "sqlite", "driver is sqlite");

  // Project lifecycle
  const project = await db.createProject("Smoke Project");
  assert(project !== null, "project created");
  assert((await db.createProject("Smoke Project")) === null, "duplicate name rejected");
  assert((await db.listProjects()).length === 1, "one project listed");

  // Document insertion with real chunker output
  const chunks = chunkText("Sentence one. ".repeat(400));
  assert(chunks.length >= 4, `chunker yielded ${chunks.length} chunks`);
  const docId = await db.insertDocument({
    projectId: project!.id,
    filename: "test.txt",
    mimeType: "text/plain",
    sizeBytes: 1234,
    chunks,
  });

  let docs = await db.listDocuments(project!.id);
  assert(docs[0].chunk_count === chunks.length, "chunk count stored");
  assert(docs[0].chunks_done === 0 && docs[0].status === "pending", "doc starts pending");

  const pendingIds = await db.pendingDocumentIds({ limit: 50, maxAttempts: 5 });
  assert(
    pendingIds.length === 1 && pendingIds[0] === docId,
    "pending document discovered",
  );

  // Claim semantics
  assert(await db.claimDocument(docId, 10), "claim succeeds");
  assert(!(await db.claimDocument(docId, 10)), "fresh claim is rejected");
  assert(await db.claimDocument(docId, 0), "stale claim (0 min) is reclaimed");

  // Embed two chunks
  const batch = await db.nextChunkBatch(docId, 2, 5);
  assert(batch.length === 2, "batch of 2 chunks");
  const fakeVector = Array.from({ length: 8 }, (_, i) => i / 8);
  await db.saveEmbeddedChunk(batch[0].id, fakeVector);
  await db.saveEmbeddedChunk(batch[1].id, fakeVector);
  await db.touchDocument(docId);

  let counts = await db.chunkCounts(docId);
  assert(counts.done === 2 && counts.pending === chunks.length - 2, "counts after 2 done");

  // Exhaust the remaining chunks' attempts -> they become 'failed'
  for (;;) {
    const next = await db.nextChunkBatch(docId, 100, 5);
    if (next.length === 0) break;
    await db.bumpChunkAttempts(next[0].id, 5);
    if (!(await db.nextChunkBatch(docId, 100, 5)).some((c) => c.id === next[0].id)) {
      break;
    }
    // keep bumping this chunk until exhausted (5 attempts)
    for (let i = 0; i < 4; i++) await db.bumpChunkAttempts(next[0].id, 5);
  }
  counts = await db.chunkCounts(docId);
  assert(
    counts.pending === 0 && counts.failed === chunks.length - 2,
    `remaining chunks exhausted: ${JSON.stringify(counts)}`,
  );

  await db.setDocumentFinalStatus(docId, "failed", "test failure message");
  docs = await db.listDocuments(project!.id);
  assert(docs[0].status === "failed", "doc marked failed");
  assert(docs[0].error === "test failure message", "error stored");
  assert(docs[0].chunks_done === 2, "progress shows done chunks");

  // Deletion cascades
  assert((await db.deleteProject(project!.id)) === 1, "project deleted");
  assert((await db.listProjects()).length === 0, "no projects left");
  assert(
    (await db.pendingDocumentIds({ limit: 50, maxAttempts: 5 })).length === 0,
    "chunks cascaded away with the project",
  );
  const orphanCounts = await db.chunkCounts(docId);
  assert(orphanCounts.total === 0, "orphan chunks gone");

  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      rmSync(`smoke-test.db${suffix}`, { force: true });
    } catch {
      // Windows may still hold the file open — harmless leftover.
    }
  }
  console.log("\nSQLite smoke test passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
