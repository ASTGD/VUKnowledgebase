import { NextRequest, NextResponse } from "next/server";
import { connection } from "next/server";
import { transcribeAudio } from "@/lib/transcribe";

export const maxDuration = 120;

const MAX_AUDIO_BYTES = 20 * 1024 * 1024; // Gemini inline_data limit

export async function POST(req: NextRequest) {
  await connection(); // never prerender this route at build time

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const audio = form.get("audio");
  if (!(audio instanceof File) || audio.size === 0) {
    return NextResponse.json({ error: "No audio received." }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "Recording too long." }, { status: 413 });
  }

  // Keep only the base type — Chrome's "audio/webm;codecs=opus" stays valid.
  const mimeType = (audio.type || "audio/webm").split(";")[0];

  try {
    const buffer = Buffer.from(await audio.arrayBuffer());
    const text = await transcribeAudio(buffer, mimeType);
    if (!text) {
      return NextResponse.json(
        { error: "Could not hear any speech in that recording." },
        { status: 422 },
      );
    }
    return NextResponse.json({ text });
  } catch (err) {
    console.error("[transcribe] failed:", err);
    const message = err instanceof Error ? err.message : "transcription failed";
    const status = message.includes("GOOGLE_API_KEY") ? 503 : 502;
    return NextResponse.json(
      { error: "Voice transcription failed. You can type your question instead." },
      { status },
    );
  }
}
