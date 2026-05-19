"use client";

/**
 * The HTML-level fallback when the root layout itself fails. Inlines all
 * styles because Tailwind/CSS may not have loaded — keep the look on-brand
 * (BRAND.md: dark surface, pink primary, mono labels).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: '"Geist", ui-sans-serif, system-ui, sans-serif',
          background: "#0e0e0e",
          color: "#e5e2e1",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          margin: 0,
          backgroundImage:
            "radial-gradient(circle at 50% 50%, rgba(255,0,127,0.04) 0%, transparent 100%)",
        }}
      >
        <div
          style={{
            textAlign: "center",
            padding: "32px",
            border: "1px solid rgba(92,63,70,0.3)",
            background: "rgba(14,14,14,0.8)",
            backdropFilter: "blur(12px)",
            borderRadius: "12px",
            maxWidth: "420px",
          }}
        >
          <div
            style={{
              color: "#ffb4ab",
              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
              fontSize: 12,
              letterSpacing: "0.08em",
            }}
          >
            / ERROR
          </div>
          <h1
            style={{
              marginTop: 12,
              fontFamily: '"Space Grotesk", sans-serif',
              fontSize: 32,
              fontWeight: 600,
              letterSpacing: "-0.01em",
            }}
          >
            Something went wrong.
          </h1>
          {error.digest ? (
            <code
              style={{
                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                fontSize: 12,
                color: "#e5bcc5",
              }}
            >
              {error.digest}
            </code>
          ) : null}
          <div style={{ marginTop: 24 }}>
            <button
              onClick={reset}
              style={{
                background: "#ffb1c4",
                color: "#65002e",
                padding: "10px 20px",
                border: 0,
                borderRadius: 4,
                cursor: "pointer",
                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: "0.05em",
              }}
            >
              TRY AGAIN
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
