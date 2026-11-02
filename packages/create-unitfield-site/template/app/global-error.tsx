"use client";

// Shown when the root layout itself fails, for example when the Unitfield API cannot be reached and nothing is cached.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: "3rem auto", maxWidth: "32rem", padding: "0 1rem" }}>
        <h1>We are having trouble right now</h1>
        <p>Please try again in a moment.</p>
        <button type="button" onClick={reset}>
          Try again
        </button>
      </body>
    </html>
  );
}
