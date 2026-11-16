import mammoth from "mammoth";

export type SupportedType = "pdf" | "docx" | "text";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "csv",
  "json",
  "log",
  "rtf",
  "html",
]);

function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx + 1).toLowerCase();
}

export function detectKind(filename: string, mimeType: string): SupportedType | null {
  const ext = extensionOf(filename);
  const mime = (mimeType || "").toLowerCase();

  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (mime === DOCX_MIME || ext === "docx") return "docx";
  if (
    mime.startsWith("text/") ||
    ext === "txt" ||
    TEXT_EXTENSIONS.has(ext)
  ) {
    return "text";
  }
  // Legacy .doc (binary) is not supported by mammoth.
  if (ext === "doc") return null;
  return null;
}

/**
 * Extracts plain text from an uploaded file buffer.
 * PDFs are parsed server-side with unpdf (pdf.js based, serverless friendly),
 * .docx with mammoth, and everything else is treated as UTF-8 text.
 */
export async function extractText(
  kind: SupportedType,
  buffer: Buffer,
): Promise<string> {
  if (kind === "pdf") {
    const { extractText: extractPdfText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text, totalPages } = await extractPdfText(pdf, { mergePages: true });
    if (!text || text.trim().length === 0) {
      throw new Error(
        `No extractable text found in PDF (${totalPages} page(s)). The file may be a scanned image.`,
      );
    }
    return text;
  }

  if (kind === "docx") {
    const { value } = await mammoth.extractRawText({ buffer });
    if (!value || value.trim().length === 0) {
      throw new Error("No extractable text found in document.");
    }
    return value;
  }

  const text = buffer.toString("utf8");
  if (text.trim().length === 0) {
    throw new Error("File is empty.");
  }
  return text;
}
