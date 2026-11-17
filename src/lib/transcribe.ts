/**
 * Speech-to-text via Groq's Whisper API (OpenAI-compatible endpoint):
 *   POST https://api.groq.com/openai/v1/audio/transcriptions
 * multipart/form-data with the recorded audio and model whisper-large-v3.
 *
 * Configured via env: GROQ_API_KEY, GROQ_STT_MODEL (optional override).
 */

const API_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
export const GROQ_STT_MODEL = process.env.GROQ_STT_MODEL || "whisper-large-v3";
const MAX_RETRIES = 2;

/** Transcribes an audio file to plain text. Returns "" when no speech. */
export async function transcribeAudio(audio: File): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set");
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // FormData is consumed by each fetch attempt, so rebuild it per try.
    const form = new FormData();
    form.append("file", audio, audio.name || "recording.webm");
    form.append("model", GROQ_STT_MODEL);
    form.append("response_format", "json");
    form.append("temperature", "0");

    const res = await fetch(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        lastError = new Error(
          `Groq transcribe API ${res.status}: ${errorText.slice(0, 300)}`,
        );
        await sleep(Math.min(1000 * 2 ** attempt, 8_000));
        continue;
      }
      throw new Error(`Groq transcribe API ${res.status}: ${errorText.slice(0, 300)}`);
    }

    const json = (await res.json()) as { text?: string };
    return (json.text ?? "").trim();
  }

  throw lastError ?? new Error("Groq transcribe request failed");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
