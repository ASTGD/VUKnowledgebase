/**
 * Speech-to-text via Gemini's native audio input — no separate STT API
 * needed. The same GOOGLE_API_KEY used for embeddings/answers transcribes
 * audio through generateContent with an inline_data audio part.
 *
 * Configured via env: GOOGLE_API_KEY (shared), TRANSCRIBE_MODEL (optional).
 */

import { sleep } from "./answer";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
export const TRANSCRIBE_MODEL = process.env.TRANSCRIBE_MODEL || "gemini-3.8-flash";

const TRANSCRIBE_PROMPT =
  "Transcribe the spoken words in this audio recording exactly and completely, " +
  "in the language that was spoken. Output only the transcript text with no " +
  "commentary, labels or formatting. If there is no speech at all, output nothing.";

export async function transcribeAudio(
  data: Buffer,
  mimeType: string,
): Promise<string> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY is not set");
  }

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: TRANSCRIBE_PROMPT },
          { inline_data: { mimeType, data: data.toString("base64") } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 1024,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  const maxRetries = 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const url = `${API_BASE}/models/${TRANSCRIBE_MODEL}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        lastError = new Error(
          `Gemini transcribe API ${res.status}: ${errorText.slice(0, 300)}`,
        );
        await sleep(Math.min(1000 * 2 ** attempt, 8_000));
        continue;
      }
      throw new Error(`Gemini transcribe API ${res.status}: ${errorText.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = json.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("") ?? ""
    return text.trim();
  }

  throw lastError ?? new Error("Gemini transcribe request failed");
}
