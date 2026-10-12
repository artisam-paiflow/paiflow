"use client";
import { useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { GoogleUsernameSchema } from "@/lib/auth/google-username";
import { googleStartUrl } from "@/lib/auth/google-navigation";
import { safeReturnPath } from "@/lib/safe-return-path";
import { cn } from "@/lib/utils";
import styles from "./google-button.module.css";

export default function GoogleButton({
  from,
  link = false,
  authOrigin,
  signup = false,
  compact = false,
  codeScreen = false,
  suggestedUsername = "",
}: {
  from?: string;
  link?: boolean;
  authOrigin?: string;
  signup?: boolean;
  compact?: boolean;
  codeScreen?: boolean;
  suggestedUsername?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [username, setUsername] = useState(suggestedUsername);
  const [code, setCode] = useState("");
  useEffect(() => {
    if (signup && new URL(window.location.href).searchParams.get("googleSignup") === "1") {
      dialog.current?.showModal();
      const url = new URL(window.location.href);
      url.searchParams.delete("googleSignup");
      window.history.replaceState(null, "", url.toString());
    }
  }, [signup]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  function returnFrom() {
    return (
      from ??
      (signup ? (new URL(window.location.href).searchParams.get("from") ?? undefined) : undefined)
    );
  }
  async function start() {
    setBusy(true);
    setError(undefined);
    try {
      // OAuth state cookies must live on the same host as the fixed callback.
      // Move the browser first when an environment also answers on aliases.
      const canonicalStart = googleStartUrl(
        authOrigin,
        window.location.origin,
        link,
        returnFrom(),
        signup,
      );
      if (canonicalStart) {
        window.location.assign(canonicalStart);
        return;
      }
      if (signup) {
        if (username && !GoogleUsernameSchema.safeParse(username).success)
          throw new Error(
            "Use 3–32 letters, numbers, dots, underscores or hyphens for your username.",
          );
        const response = await fetch("/api/auth/google/signup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code, ...(username.trim() ? { username: username.trim() } : {}) }),
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.error?.fields?.username?.[0] ??
              result.error?.fields?.code?.[0] ??
              result.error?.message ??
              "Could not validate this code.",
          );
      }
      if (link) {
        const response = await fetch("/api/account/google/link", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error?.message ?? "Could not start Google linking");
      }
      await signIn("google", {
        redirectTo: safeReturnPath(
          link ? "/account?googleLinked=1" : returnFrom(),
          window.location.origin,
        ),
      });
    } catch (cause) {
      setError(
        (link || signup) && cause instanceof Error
          ? cause.message
          : "Could not start Google sign-in. Please try again.",
      );
      setBusy(false);
    }
  }
  const signupForm = (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void start();
      }}
      className="grid gap-4"
    >
      {!codeScreen ? (
        <h2 id="google-signup-title" className="font-display text-2xl">
          Enter signup code
        </h2>
      ) : null}
      <p className="text-on-surface-variant">
        Enter the access code from your organizer to create your account with Google.
      </p>
      <label className="grid gap-2">
        Access code
        <input
          autoFocus
          required
          maxLength={128}
          autoComplete="off"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          disabled={busy}
          className="border-outline-variant rounded-lg border bg-transparent p-3"
        />
      </label>
      <label className="grid gap-2">
        Username
        <input
          minLength={3}
          maxLength={32}
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          disabled={busy}
          pattern={"[a-zA-Z0-9_.\\-]+"}
          aria-describedby="google-username-help"
          className="border-outline-variant rounded-lg border bg-transparent p-3"
        />
      </label>
      <span id="google-username-help" className="text-on-surface-variant text-body-sm">
        Choose what appears in Paiflow. Leave blank to use your email prefix. If taken, we’ll add a
        short suffix.
      </span>
      {error ? (
        <p role="alert" className="text-error">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={busy} className={styles.googleButton}>
        <GoogleButtonLabel busy={busy} />
      </button>
      {!codeScreen ? (
        <button type="button" disabled={busy} onClick={() => dialog.current?.close()}>
          Cancel
        </button>
      ) : null}
    </form>
  );
  if (codeScreen) return <div className="glass-panel mt-md p-md rounded-xl">{signupForm}</div>;
  return (
    <div className={cn("grid gap-3", !compact && "mt-md")}>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (!signup) {
            void start();
            return;
          }
          const canonicalStart = googleStartUrl(
            authOrigin,
            window.location.origin,
            false,
            returnFrom(),
            true,
          );
          if (canonicalStart) {
            window.location.assign(canonicalStart);
            return;
          }
          setError(undefined);
          dialog.current?.showModal();
        }}
        className={
          link
            ? "border-outline-variant text-on-surface rounded-lg border px-4 py-3 disabled:opacity-50"
            : styles.googleButton
        }
      >
        {link ? busy ? "Connecting…" : "Link Google" : <GoogleButtonLabel busy={busy} />}
      </button>
      {signup ? (
        <dialog
          ref={dialog}
          aria-labelledby="google-signup-title"
          onClose={() => {
            setCode("");
            setError(undefined);
          }}
          onCancel={(event) => {
            if (busy) event.preventDefault();
          }}
          className="bg-surface-container text-on-surface m-auto w-[calc(100%_-_2rem)] max-w-md rounded-xl p-6 backdrop:bg-black/60"
        >
          {signupForm}
        </dialog>
      ) : null}
      {!signup && error ? (
        <p role="alert" className="text-error text-body-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function GoogleButtonLabel({ busy }: { busy: boolean }) {
  return (
    <>
      {/* Official Google brand asset; fixed dimensions preserve its proportions. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/google-g.png" alt="" width={20} height={20} className="shrink-0" />
      <span>{busy ? "Connecting…" : "Continue with Google"}</span>
    </>
  );
}
