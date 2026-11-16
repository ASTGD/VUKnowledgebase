import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { getDb, getProject, listDocuments } from "@/lib/db";
import { detectKind, extractText } from "@/lib/extract";
import { chunkText } from "@/lib/chunk";
import { processPendingChunks, runBackground } from "@/lib/processor";

export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

// Vercel Functions cap request bodies at 4.5 MB — keep a small safety margin.
const MAX_FILE_BYTES = 4 * 1024 * 1024;

type UploadResult = {
  ok: boolean;
  filename: string;
  documentId?: string;
  chunks?: number;
  error?: string;
};

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const documents = await listDocuments(id);
  return NextResponse.json({ documents });
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId } = await params;
  const project = await getProject(projectId);
  if (project.length === 0) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Upload too large or malformed (limit is 4 MB per file)" },
      { status: 413 },
    );
  }

  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
  }

  const db = getDb();
  const results: UploadResult[] = [];
  const createdDocumentIds: string[] = [];

  for (const file of files) {
    try {
      if (file.size > MAX_FILE_BYTES) {
        results.push({
          ok: false,
          filename: file.name,
          error: `File is ${Math.round(file.size / 1024)} KB — the limit is 4 MB per file.`,
        });
        continue;
      }

      const kind = detectKind(file.name, file.type);
      if (!kind) {
        results.push({
          ok: false,
          filename: file.name,
          error: "Unsupported file type. Supported: PDF, DOCX, TXT/MD/CSV and other plain text.",
        });
        continue;
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const text = await extractText(kind, buffer);
      const chunks = chunkText(text);

      if (chunks.length === 0) {
        results.push({ ok: false, filename: file.name, error: "No text content found." });
        continue;
      }

      const insertedDoc = await db`
        INSERT INTO documents (project_id, filename, mime_type, size_bytes, chunk_count, status)
        VALUES (${projectId}, ${file.name}, ${file.type || kind}, ${file.size}, ${chunks.length}, 'pending')
        RETURNING id
      `;
      const documentId = insertedDoc[0].id as string;

      const chunkValues = chunks.map((content, seq) => ({
        document_id: documentId,
        project_id: projectId,
        seq,
        content,
      }));

      await db`
        INSERT INTO chunks ${db(chunkValues)}
      `;

      createdDocumentIds.push(documentId);
      results.push({ ok: true, filename: file.name, documentId, chunks: chunks.length });
    } catch (err) {
      results.push({
        ok: false,
        filename: file.name,
        error: err instanceof Error ? err.message : "Failed to process file",
      });
    }
  }

  // Start embedding in the background — continues even after the admin
  // closes the browser (see lib/processor.ts).
  for (const documentId of createdDocumentIds) {
    runBackground(() => processPendingChunks({ projectId, documentId }));
  }

  return NextResponse.json({ results, documents: await listDocuments(projectId) });
}
