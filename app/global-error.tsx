"use client";

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
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          background: "#0b0a10",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          margin: 0,
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{ color: "#fb7196", fontSize: 12, letterSpacing: 4, textTransform: "uppercase" }}
          >
            Error
          </div>
          <h1 style={{ marginTop: 12, fontSize: 32 }}>Something went wrong</h1>
          {error.digest ? (
            <code style={{ fontSize: 12, color: "#a1a1aa" }}>{error.digest}</code>
          ) : null}
          <div style={{ marginTop: 24 }}>
            <button
              onClick={reset}
              style={{
                background: "#e11d58",
                color: "#fff",
                padding: "8px 16px",
                border: 0,
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
