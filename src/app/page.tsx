import { AskBox } from "./ask-box";

/**
 * Public landing page. Visitors land here and ask questions — no admin
 * session involved. The admin panel remains at /login → /admin.
 */
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center px-4 pb-10 pt-20">
      <div className="w-full max-w-2xl">
        <div className="text-center">
          <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-900 dark:bg-neutral-100">
            <span className="text-lg font-bold text-neutral-100 dark:text-neutral-900">
              VU
            </span>
          </div>
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100 sm:text-3xl">
            Varendra University Knowledge Base
          </h1>
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400 sm:text-base">
            Ask anything about admissions, programs, tuition fees, payment
            terms, facilities or campus life — answers come straight from the
            university&apos;s indexed documents.
          </p>
        </div>

        <AskBox />

        <p className="mt-10 text-center text-xs text-neutral-400 dark:text-neutral-600">
          Answers are grounded in uploaded university documents — figures and
          dates are shown as indexed.{" "}
          <a
            href="/login"
            className="underline hover:text-neutral-600 dark:hover:text-neutral-400"
          >
            Admin login
          </a>
        </p>
      </div>
    </main>
  );
}
