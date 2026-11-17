/**
 * Gemini embeddings client (REST, no SDK lock-in).
 *
 * Uses the Google Generative Language API endpoint:
 *   POST /v1beta/models/gemini-embedding-001:batchEmbedContents
 *
 * Configured via env: GOOGLE_API_KEY, EMBEDDING_MODEL (optional),
 * EMBEDDING_DIMS (optional; gemini-embedding-001 supports 768–3072).
 */

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const MAX_BATCH = 16;

export function embeddingConfig() {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY is not set");
  }
  const model = process.env.EMBEDDING_MODEL || "gemini-embedding-001";
  const dims = Number(process.env.EMBEDDING_DIMS || 3072);
  return { apiKey, model, dims };
}

type EmbedTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

type EmbedBatchOptions = {
  maxRetries?: number;
  taskType?: EmbedTaskType;
};

/** Embeds a single query text with the RETRIEVAL_QUERY task type. */
export async function embedQuery(text: string): Promise<number[]> {
  const vectors = await embedTexts([text], { taskType: "RETRIEVAL_QUERY" });
  return vectors[0];
}

/** Embeds a batch of texts (max 16) and returns vectors in the same order. */
export async function embedTexts(
  texts: string[],
  options: EmbedBatchOptions = {},
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const { apiKey, model, dims } = embeddingConfig();
  if (texts.length > MAX_BATCH) {
    throw new Error(`Batch size ${texts.length} exceeds max ${MAX_BATCH}`);
  }

  const body = {
    requests: texts.map((text) => ({
      model: `models/${model}`,
      content: { parts: [{ text }] },
      taskType: options.taskType ?? "RETRIEVAL_DOCUMENT",
      outputDimensionality: dims,
    })),
  };

  const url = `${API_BASE}/models/${model}:batchEmbedContents?key=${apiKey}`;
  const maxRetries = options.maxRetries ?? 4;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        // Rate limits and transient server errors are retried with backoff.
        if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
          lastError = new Error(
            `Gemini API ${res.status}: ${errorText.slice(0, 300)}`,
          );
          await sleep(backoffDelay(attempt));
          continue;
        }
        throw new Error(`Gemini API ${res.status}: ${errorText.slice(0, 300)}`);
      }

      const json = (await res.json()) as {
        embeddings?: { values: number[] }[];
      };
      const vectors = json.embeddings?.map((e) => e.values);
      if (!vectors || vectors.length !== texts.length) {
        throw new Error(
          `Gemini API returned ${vectors?.length ?? 0} embeddings for ${texts.length} texts`,
        );
      }
      return vectors;
    } catch (err) {
      // Network failures are retried too.
      if (attempt < maxRetries && err instanceof TypeError) {
        lastError = err;
        await sleep(backoffDelay(attempt));
        continue;
      }
      throw err;
    }
  }

  throw lastError ?? new Error("Embedding request failed");
}

function backoffDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 20_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
