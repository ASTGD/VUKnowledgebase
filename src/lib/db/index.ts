import { createPostgresDriver } from "./postgres";
import { createSqliteDriver } from "./sqlite";
import type { DbDriver } from "./types";

/**
 * Storage driver selection:
 *  - DB_DRIVER=sqlite (or SQLITE_FILE set) → local SQLite file (node:sqlite)
 *  - otherwise → Postgres + pgvector via DATABASE_URL
 *
 * SQLite exists for local testing only; the production database is Postgres
 * with pgvector columns (see README).
 */

let _driver: DbDriver | null = null;

export function getDb(): DbDriver {
  if (!_driver) {
    const wanted = (process.env.DB_DRIVER || "").toLowerCase();
    if (wanted === "sqlite" || process.env.SQLITE_FILE) {
      _driver = createSqliteDriver();
    } else {
      _driver = createPostgresDriver();
    }
  }
  return _driver;
}

export type {
  ChunkBatchRow,
  ChunkCounts,
  DbDriver,
  DocumentRow,
  DocumentWithProgress,
  InsertDocumentInput,
  ProjectRow,
  ProjectSummary,
} from "./types";
