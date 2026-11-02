"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="narrow">
      <h1>Something went wrong</h1>
      <p>We could not load this page. Please try again in a moment.</p>
      <button type="button" className="button primary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
