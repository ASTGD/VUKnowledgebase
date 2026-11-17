import { NextRequest, NextResponse } from "next/server";
import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { embedQuery } from "@/lib/embed";
import { generateAnswer } from "@/lib/answer";

export const maxDuration = 120;

const MAX_QUESTION_CHARS = 1_000;
const TOP_K = 8;
const MIN_SIMILARITY = 0.55;

type Source = { filename: string; similarity: number; snippet: string };

export async function POST(req: NextRequest) {
  await connection(); // never prerender this route at build time

  let body: { question?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) {
    return NextResponse.json({ error: "Please type a question first." }, { status: 400 });
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return NextResponse.json(
      { error: `Question is too long (max ${MAX_QUESTION_CHARS} characters).` },
      { status: 400 },
    );
  }

  // 1) Embed the question with the RETRIEVAL_QUERY task type.
  let vector: number[];
  try {
    vector = await embedQuery(question);
  } catch (err) {
    const message = err instanceof Error ? err.message : "question embedding failed";
    if (message.includes("GOOGLE_API_KEY")) {
      return NextResponse.json(
        { error: "Search is not configured. Ask the administrator to set GOOGLE_API_KEY." },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: "Could not embed the question. Please try again." },
      { status: 502 },
    );
  }

  // 2) Cosine-similarity search over the indexed chunks.
  const hits = await getDb().searchSimilarChunks(vector, {
    limit: TOP_K,
    minSimilarity: MIN_SIMILARITY,
  });

  const sources: Source[] = hits.map((hit) => ({
    filename: hit.filename,
    similarity: hit.similarity,
    snippet: hit.content.length > 200 ? `${hit.content.slice(0, 200)}…` : hit.content,
  }));

  if (hits.length === 0) {
    return NextResponse.json({
      answer:
        "I do not have any indexed knowledge that matches this question yet. " +
        "Please try rephrasing, or ask the administrator to upload relevant documents.",
      sources: [],
      noMatch: true,
    });
  }

  // 3) Tune the answer with Gemini, grounded in the retrieved chunks.
  try {
    const answer = await generateAnswer(
      question,
      hits.map((hit) => ({ filename: hit.filename, content: hit.content })),
    );
    return NextResponse.json({ answer, sources });
  } catch (err) {
    console.error("[ask] answer generation failed:", err);
    // Retrieval still worked — return the top chunk as a fallback answer.
    const best = hits[0];
    return NextResponse.json({
      answer: `Best matching excerpt from "${best.filename}":\n\n${best.content}`,
      sources,
    });
  }
}
