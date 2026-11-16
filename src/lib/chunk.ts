/**
 * Overlapping character-window chunker.
 *
 * Text is split into chunks of roughly CHUNK_TARGET chars, sliding forward with
 * CHUNK_OVERLAP so that sentences spanning chunk boundaries are never lost.
 */
const CHUNK_TARGET = 1200;
const CHUNK_OVERLAP = 150;

export function chunkText(text: string): string[] {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .trim();
  if (!normalized) return [];

  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < normalized.length) {
    const window = normalized.slice(cursor, cursor + CHUNK_TARGET);

    if (cursor + CHUNK_TARGET >= normalized.length) {
      chunks.push(window.trim());
      break;
    }

    // Prefer breaking at a sentence/paragraph boundary inside the tail half
    // of the window so chunks stay semantically coherent.
    const tail = window.slice(Math.floor(CHUNK_TARGET * 0.55));
    const breakMatch = findLastBreak(tail);
    const sliceLength =
      breakMatch !== -1 ? Math.floor(CHUNK_TARGET * 0.55) + breakMatch + 1 : CHUNK_TARGET;

    chunks.push(window.slice(0, sliceLength).trim());
    cursor += Math.max(sliceLength - CHUNK_OVERLAP, 1);
  }

  return chunks.filter((c) => c.length > 0);
}

function findLastBreak(text: string): number {
  const candidates = [
    text.lastIndexOf("\n\n"),
    text.lastIndexOf(". "),
    text.lastIndexOf("\n"),
    text.lastIndexOf("! "),
    text.lastIndexOf("? "),
  ];
  return candidates.reduce((best, current) => (current > best ? current : best));
}
