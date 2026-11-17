"use client";

import { useRef, useState } from "react";

type Source = {
  filename: string;
  similarity: number;
  snippet: string;
};

type AskResponse = {
  answer?: string;
  sources?: Source[];
  noMatch?: boolean;
  error?: string;
};

const EXAMPLES = [
  "What are the admission requirements?",
  "What is the tuition fee for B.Sc. in CSE?",
  "How can I pay my tuition fee?",
  "What scholarships are available?",
];

const MAX_RECORDING_MS = 60_000;

export function AskBox() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function handleSubmit(q: string) {
    const trimmed = q.trim();
    if (!trimmed || loading) return;

    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const data = (await res.json()) as AskResponse;
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      setResult(data);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  function cleanupRecording() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    setRecording(false);
  }

  async function transcribe(blob: Blob) {
    setTranscribing(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("audio", blob, "recording.webm");
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = (await res.json()) as { text?: string; error?: string };
      if (!res.ok || !data.text) {
        setError(data.error ?? "Voice transcription failed. Please type instead.");
        return;
      }
      setQuestion(data.text.trim());
    } catch {
      setError("Network error during transcription — please type instead.");
    } finally {
      setTranscribing(false);
    }
  }

  // Click to start recording, click again to stop and transcribe. The
  // transcript lands in the input box; the search only runs on "Ask".
  async function toggleRecording() {
    if (recording) {
      mediaRecorderRef.current?.stop();
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Microphone access was denied. Please type your question.");
      return;
    }

    streamRef.current = stream;
    audioChunksRef.current = [];
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : undefined;
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) audioChunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      cleanupRecording();
      const blob = new Blob(audioChunksRef.current, {
        type: recorder.mimeType || "audio/webm",
      });
      if (blob.size > 0) void transcribe(blob);
    };

    mediaRecorderRef.current = recorder;
    recorder.start();
    setRecording(true);

    // Safety stop after 60 s so a forgotten second click cannot balloon
    // past the 20 MB inline audio limit.
    stopTimerRef.current = setTimeout(() => {
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    }, MAX_RECORDING_MS);
  }

  const micLabel = transcribing ? "Transcribing…" : recording ? "Stop" : "Voice";

  return (
    <div className="mt-8">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit(question);
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. What are the tuition fees for CSE?"
          maxLength={1000}
          disabled={loading}
          required
          className="flex-1 rounded-xl border border-neutral-300 bg-white px-4 py-3 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-100"
        />
        <button
          type="button"
          onClick={toggleRecording}
          disabled={loading || transcribing}
          title={
            recording
              ? "Stop recording and transcribe"
              : "Ask your question with the microphone"
          }
          aria-label={micLabel}
          className={`flex w-12 items-center justify-center rounded-xl border transition disabled:cursor-not-allowed disabled:opacity-50 ${
            recording
              ? "border-red-500 bg-red-500/10 text-red-600 dark:text-red-400"
              : "border-neutral-300 bg-white text-neutral-600 hover:border-neutral-500 hover:text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:border-neutral-500 dark:hover:text-neutral-100"
          }`}
        >
          <svg
            className="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {recording ? (
              <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" />
            ) : (
              <>
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
                <path d="M12 19v3" />
              </>
            )}
          </svg>
        </button>
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="rounded-xl bg-neutral-900 px-5 py-3 text-sm font-medium text-neutral-100 transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {loading ? "Searching…" : "Ask"}
        </button>
      </form>

      {(recording || transcribing) && (
        <p
          className={`mt-2 text-xs ${
            recording
              ? "animate-pulse text-red-600 dark:text-red-400"
              : "text-neutral-500 dark:text-neutral-400"
          }`}
        >
          {recording
            ? "Recording… click the mic icon again to stop (max 60 s), then your speech becomes text."
            : "Transcribing your recording…"}
        </p>
      )}

      {!result && !loading && !error && (
        <div className="mt-4 flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => {
                setQuestion(example);
                handleSubmit(example);
              }}
              className="rounded-full border border-neutral-200 px-3 py-1.5 text-xs text-neutral-600 transition hover:border-neutral-400 hover:text-neutral-900 dark:border-neutral-800 dark:text-neutral-400 dark:hover:border-neutral-600 dark:hover:text-neutral-200"
            >
              {example}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="mt-6 rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <p className="animate-pulse text-sm text-neutral-500 dark:text-neutral-400">
            Converting your question to embeddings, searching the knowledgebase…
          </p>
        </div>
      )}

      {error && (
        <p className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      {result?.answer && (
        <div className="mt-6 space-y-4">
          <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
              Answer
            </h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-800 dark:text-neutral-200">
              {result.answer}
            </p>
          </div>

          {!result.noMatch && (result.sources?.length ?? 0) > 0 && (
            <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                Sources ({result.sources!.length} best matches)
              </h2>
              <ol className="space-y-3">
                {result.sources!.map((source, i) => (
                  <li key={i} className="space-y-1">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="font-medium text-neutral-700 dark:text-neutral-300">
                        {source.filename}
                      </span>
                      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                        {(source.similarity * 100).toFixed(1)}% match
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
                      {source.snippet}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
