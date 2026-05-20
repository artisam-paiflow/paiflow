"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Ship,
  Send,
  Loader2,
  Wand2,
  CheckCircle2,
  X,
  AlertTriangle,
  Mic,
  Square,
} from "lucide-react";
import { StrKey } from "@stellar/stellar-sdk";
import { toast } from "sonner";

export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "raft"; content: string; patch?: unknown[] };

interface RaftLogProps {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  loading?: boolean;
  pendingAddresses?: string[];
  onResolveAddress?: (addresses: Record<string, string>) => Promise<void>;
  onSkipAddresses?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

const SUGGESTIONS_ROWS = [
  [
    "Add a recipient",
    "Change asset to XLM",
    "Make Alice 55%",
    "Set payment amount",
    "Add a co-signer",
  ],
  ["Add a time lock", "Swap to USDC", "Set minimum 100 XLM", "Remove last node", "Add a deadline"],
  ["Add a memo", "Make it periodic", "Require approval", "Increase share to 1%", "Add a condition"],
];

function patchSummary(patch: unknown[]): string {
  if (!patch.length) return "No changes needed.";
  const counts = new Map<string, number>();
  for (const op of patch) {
    if (typeof op === "object" && op !== null && "op" in op) {
      const key = String((op as Record<string, unknown>).op);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const labels: Record<string, string> = {
    updateNode: "updated",
    addNode: "added",
    removeNode: "removed",
    addEdge: "connected",
    removeEdge: "disconnected",
  };
  const parts = Array.from(counts.entries()).map(([op, n]) => {
    const label = labels[op] ?? op;
    return `${n} ${label} ${n === 1 ? "node" : "nodes"}`;
  });
  return `Applied ${parts.join(", ")}.`;
}

function MissingAddressPrompt({
  labels,
  onResolve,
  onSkip,
  loading,
}: {
  labels: string[];
  onResolve: (addresses: Record<string, string>) => void;
  onSkip?: () => void;
  loading: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(labels.map((l) => [l, ""])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate(label: string, addr: string): string | null {
    if (!addr.trim()) return "Required";
    if (!StrKey.isValidEd25519PublicKey(addr.trim())) return "Invalid Stellar address";
    return null;
  }

  function handleChange(label: string, value: string) {
    setValues((prev) => ({ ...prev, [label]: value }));
    const err = validate(label, value);
    setErrors((prev) => {
      const next = { ...prev };
      if (err) next[label] = err;
      else delete next[label];
      return next;
    });
  }

  function handleSubmit() {
    const newErrors: Record<string, string> = {};
    for (const l of labels) {
      const err = validate(l, values[l] ?? "");
      if (err) newErrors[l] = err;
    }
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;
    onResolve(values);
  }

  const allValid = labels.every((l) => !validate(l, values[l] ?? ""));

  return (
    <div className="rounded-xl border border-amber-800/50 bg-amber-950/20 p-3">
      <div className="flex items-center gap-2 text-amber-400">
        <AlertTriangle className="h-4 w-4" />
        <span className="text-xs font-semibold">
          {labels.length} recipient{labels.length > 1 ? "s" : ""} need Stellar addresses
        </span>
      </div>
      <div className="mt-2 space-y-2">
        {labels.map((label) => (
          <div key={label}>
            <div className="mb-0.5 text-[11px] font-medium text-zinc-300 capitalize">{label}</div>
            <input
              className={`w-full rounded-md bg-zinc-900 px-2.5 py-1.5 font-mono text-xs text-zinc-100 ring-1 transition-all outline-none placeholder:text-zinc-600 focus:ring-2 ${
                errors[label]
                  ? "ring-red-700 focus:ring-red-500"
                  : "focus:ring-brand-500 ring-zinc-700"
              }`}
              placeholder="G..."
              value={values[label]}
              onChange={(e) => handleChange(label, e.target.value)}
              disabled={loading}
            />
            {errors[label] && (
              <div className="mt-0.5 text-[10px] text-red-400">{errors[label]}</div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => onSkip?.()}
          disabled={loading}
          className="rounded-md px-3 py-1.5 text-xs text-zinc-400 ring-1 ring-zinc-700 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
        >
          Skip for now
        </button>
        <button
          onClick={handleSubmit}
          disabled={loading || !allValid}
          className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-500 disabled:opacity-40"
        >
          {loading ? "Resolving..." : "Apply Addresses"}
        </button>
      </div>
    </div>
  );
}

export default function RaftLog({
  messages,
  onSend,
  loading,
  pendingAddresses,
  onResolveAddress,
  onSkipAddresses,
  collapsed = false,
  onToggleCollapse,
}: RaftLogProps) {
  const [input, setInput] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [audioLevel, setAudioLevel] = useState(0);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);
  const animationFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (audioContextRef.current) audioContextRef.current.close();
      if (timerRef.current) clearInterval(timerRef.current);
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.code !== "Space" || collapsed || loading) return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;

      const target = e.target as HTMLElement | null;
      const activeElement = document.activeElement as HTMLElement | null;
      const focusedElement = activeElement ?? target;

      if (!focusedElement) return;
      if (focusedElement === document.body) {
        e.preventDefault();
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
          stopRecording();
        } else {
          startRecording();
        }
        return;
      }

      const tag = focusedElement.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        tag === "BUTTON" ||
        tag === "A"
      ) {
        return;
      }
      if (focusedElement.isContentEditable) return;

      const role = focusedElement.getAttribute("role");
      if (
        role === "button" ||
        role === "link" ||
        role === "checkbox" ||
        role === "radio" ||
        role === "switch" ||
        role === "tab" ||
        role === "menuitem" ||
        role === "option"
      ) {
        return;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [collapsed, loading]);

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  async function startRecording() {
    try {
      setLiveTranscript("");
      setAudioLevel(0);

      // Start browser SpeechRecognition FIRST, before getUserMedia.
      // On many browsers getUserMedia claims the mic exclusively and
      // prevents SpeechRecognition from receiving any audio.
      const SpeechRecognitionClass =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (SpeechRecognitionClass) {
        const logDiag =
          process.env.NODE_ENV !== "production"
            ? (...args: any[]) => console.debug("[DIAG]", ...args)
            : () => {};

        const recognition = new SpeechRecognitionClass();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "en-US";

        recognition.onstart = () => logDiag("SpeechRecognition: onstart fired");
        recognition.onaudiostart = () =>
          logDiag("SpeechRecognition: onaudiostart - audio capture began");
        recognition.onaudioend = () =>
          logDiag("SpeechRecognition: onaudioend - audio capture ended");
        recognition.onsoundstart = () =>
          logDiag("SpeechRecognition: onsoundstart - sound detected");
        recognition.onspeechend = () => logDiag("SpeechRecognition: onspeechend - speech ended");

        recognition.onresult = (event: any) => {
          const isFinal = event.results[event.results.length - 1]?.isFinal;
          logDiag(
            "SpeechRecognition: onresult",
            `interim=${!isFinal} results=${event.results.length}`,
            event.results[event.results.length - 1]?.[0]?.transcript,
          );
          let transcript = "";
          for (let i = event.resultIndex; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
          }
          setLiveTranscript(transcript);
        };

        recognition.onerror = (event: any) => {
          logDiag("SpeechRecognition: onerror", event.error);
          if (event.error === "not-allowed" || event.error === "service-not-allowed") {
            setLiveTranscript("");
          }
        };

        recognition.onend = () => {
          logDiag("SpeechRecognition: onend");
          if (
            recognitionRef.current === recognition &&
            mediaRecorderRef.current &&
            mediaRecorderRef.current.state !== "inactive"
          ) {
            try {
              recognition.start();
            } catch {
              // ignore restart failures
            }
          }
        };

        recognition.start();
        recognitionRef.current = recognition;
        logDiag("SpeechRecognition: .start() called");

        await new Promise((r) => setTimeout(r, 200));
      } else {
        const logDiag =
          process.env.NODE_ENV !== "production"
            ? (...args: any[]) => console.debug("[DIAG]", ...args)
            : () => {};
        logDiag("SpeechRecognition: NOT AVAILABLE in this browser");
      }

      // Acquire the microphone for MediaRecorder (audio file → Groq whisper)
      // Use raw audio constraints so we don't accidentally claim exclusive
      // audio processing that could starve SpeechRecognition.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      streamRef.current = stream;

      // Set up audio level meter using Web Audio API
      // This provides visual feedback that the mic is live, even if
      // SpeechRecognition isn't producing interim results.
      try {
        const actx = new AudioContext();
        const source = actx.createMediaStreamSource(stream);
        const analyser = actx.createAnalyser();
        analyser.fftSize = 128;
        source.connect(analyser);
        audioContextRef.current = actx;
        analyserRef.current = analyser;

        const buf = new Uint8Array(analyser.frequencyBinCount);
        const meterUpdateIntervalMs = 1000 / 15;
        let lastMeterUpdate = 0;
        let lastRenderedLevel = 0;

        function tick(now: number) {
          if (now - lastMeterUpdate >= meterUpdateIntervalMs) {
            analyser.getByteFrequencyData(buf);
            const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
            const nextLevel = Math.min(avg / 128, 1);

            if (Math.abs(nextLevel - lastRenderedLevel) >= 0.02) {
              setAudioLevel(nextLevel);
              lastRenderedLevel = nextLevel;
            }

            lastMeterUpdate = now;
          }

          animationFrameRef.current = requestAnimationFrame(tick);
        }

        animationFrameRef.current = requestAnimationFrame(tick);
      } catch {
        // audio level meter not available — non-critical
      }

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/mp4";

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const rec = mediaRecorderRef.current;
        if (!rec) return;

        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
        if (audioContextRef.current) {
          audioContextRef.current.close();
          audioContextRef.current = null;
        }
        analyserRef.current = null;

        const blob = new Blob(chunksRef.current, { type: rec.mimeType || mimeType });
        chunksRef.current = [];
        setIsRecording(false);
        setRecordingSeconds(0);
        setLiveTranscript("");
        setAudioLevel(0);

        if (recognitionRef.current) {
          recognitionRef.current.stop();
          recognitionRef.current = null;
        }
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }

        if (blob.size === 0) return;

        const ext = mimeType.startsWith("audio/mp4") ? "mp4" : "webm";
        const formData = new FormData();
        formData.append("file", blob, `recording.${ext}`);

        fetch("/api/transcribe", { method: "POST", body: formData })
          .then(async (res) => {
            const json = await res.json();
            if (!res.ok) {
              toast.error(json?.error?.message ?? "Transcription failed");
              return;
            }
            onSend(json.data.text);
            setInput("");
          })
          .catch(() => {
            toast.error("Network error while transcribing audio");
          });
      };

      recorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);

      let seconds = 0;
      timerRef.current = setInterval(() => {
        seconds++;
        setRecordingSeconds(seconds);
        if (seconds >= 60) {
          stopRecording();
        }
      }, 1000);
    } catch (err) {
      console.error("startRecording error:", err);
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        const perm = await navigator.permissions
          .query({ name: "microphone" as PermissionName })
          .catch(() => null);
        if (perm?.state === "denied") {
          toast.error(
            "Microphone is blocked for this site. Click the lock icon left of the URL bar → Site Settings → Microphone → select Allow, then reload.",
          );
        } else if (perm?.state === "granted") {
          toast.error(
            "Browser permission is allowed, but macOS is blocking access. Go to System Settings → Privacy & Security → Microphone → toggle Google Chrome (or your browser) ON.",
          );
        } else {
          toast.error(
            "Microphone access denied. Check System Settings → Privacy & Security → Microphone and ensure your browser is allowed.",
          );
        }
      } else if (err instanceof DOMException && err.name === "NotFoundError") {
        toast.error("No microphone found on this device.");
      } else {
        toast.error("Failed to start recording.");
      }
    }
  }

  function stopRecording() {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    onSend(text);
    setInput("");
  }

  function handleSuggestion(text: string) {
    if (loading) return;
    onSend(text);
    inputRef.current?.focus();
  }

  const isEmpty = messages.length === 0;
  const hasPending = pendingAddresses && pendingAddresses.length > 0;

  return (
    <>
      <style>{`
        @keyframes marquee-right {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        @keyframes marquee-left {
          0% { transform: translateX(-50%); }
          100% { transform: translateX(0); }
        }
        .marquee-row { animation: marquee-right 25s linear infinite; }
        .marquee-row:nth-child(2) { animation-name: marquee-left; animation-duration: 22s; }
        .marquee-row:nth-child(3) { animation-name: marquee-right; animation-duration: 28s; }
        .marquee-row:hover { animation-play-state: paused !important; }
      `}</style>
      {/* Collapsed tab — Railway-style floating pill on right edge */}
      {collapsed && (
        <button
          onClick={onToggleCollapse}
          className="fixed top-20 right-0 z-40 flex items-center gap-2 rounded-l-lg border-y border-l border-zinc-800 bg-zinc-900 px-3 py-2.5 shadow-lg transition-all hover:bg-zinc-800 hover:pr-4"
          title="Open AI chat"
        >
          <div className="bg-brand-500/20 flex h-6 w-6 items-center justify-center rounded-full">
            <Ship className="text-brand-400 h-3.5 w-3.5" />
          </div>
          <span className="text-sm font-medium text-zinc-300">AI</span>
          {hasPending && (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-900 text-xs text-amber-400">
              {pendingAddresses!.length}
            </span>
          )}
        </button>
      )}

      {/* Expanded slide-in panel */}
      <div
        className={`fixed top-[49px] right-0 z-40 h-[calc(100vh-49px)] w-[360px] transform border-l border-zinc-800 bg-zinc-950 shadow-2xl transition-transform duration-300 ease-out ${
          collapsed ? "translate-x-full" : "translate-x-0"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <div className="bg-brand-500/20 flex h-6 w-6 items-center justify-center rounded-full">
              <Ship className="text-brand-400 h-3.5 w-3.5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-zinc-100">Raft Log</div>
              <div className="text-xs text-zinc-500">Ask AI to edit your flow</div>
            </div>
            {hasPending && (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-900 text-xs text-amber-400">
                {pendingAddresses!.length}
              </span>
            )}
          </div>
          <button
            onClick={onToggleCollapse}
            className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
            title="Close chat"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Messages */}
        <div className="h-[calc(100%-130px)] space-y-3 overflow-y-auto px-3 py-3">
          {isEmpty && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <div className="bg-brand-500/10 flex h-10 w-10 items-center justify-center rounded-full">
                <Wand2 className="text-brand-400 h-5 w-5" />
              </div>
              <div>
                <div className="text-base font-medium text-zinc-200">
                  What would you like to change?
                </div>
                <div className="mt-1 max-w-[240px] text-sm leading-relaxed text-zinc-500">
                  Describe edits in plain English. The AI will update your flow automatically.
                </div>
              </div>
              <div
                className="mt-1 w-full overflow-hidden"
                style={{
                  mask: "linear-gradient(to right, transparent 0%, black 12%, black 88%, transparent 100%)",
                  WebkitMask:
                    "linear-gradient(to right, transparent 0%, black 12%, black 88%, transparent 100%)",
                }}
              >
                {SUGGESTIONS_ROWS.map((row, rowIdx) => (
                  <div
                    key={rowIdx}
                    className={`marquee-row flex gap-2 ${rowIdx > 0 ? "mt-2" : ""}`}
                  >
                    {[...row, ...row].map((s, i) => (
                      <button
                        key={`${s}-${i}`}
                        onClick={() => handleSuggestion(s)}
                        className="shrink-0 cursor-pointer rounded-full bg-zinc-900 px-3 py-1.5 text-sm whitespace-nowrap text-zinc-400 ring-1 ring-zinc-800 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="bg-brand-600 max-w-[85%] rounded-2xl rounded-br-sm px-3.5 py-2 text-base text-white shadow-sm">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={i} className="flex gap-2">
                <div className="bg-brand-500/20 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full">
                  <Ship className="text-brand-400 h-2.5 w-2.5" />
                </div>
                <div className="max-w-[85%]">
                  <div className="rounded-2xl rounded-tl-sm bg-zinc-900 px-3.5 py-2 text-base text-zinc-200 shadow-sm">
                    {m.content}
                  </div>
                  {m.patch && m.patch.length > 0 && (
                    <div className="mt-1 flex items-center gap-1 text-xs text-emerald-400">
                      <CheckCircle2 className="h-3 w-3" />
                      {patchSummary(m.patch)}
                    </div>
                  )}
                </div>
              </div>
            ),
          )}

          {loading && (
            <div className="flex gap-2">
              <div className="bg-brand-500/20 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full">
                <Ship className="text-brand-400 h-2.5 w-2.5" />
              </div>
              <div className="rounded-2xl rounded-tl-sm bg-zinc-900 px-3.5 py-2 text-base text-zinc-400 shadow-sm">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span className="text-sm">Thinking…</span>
                </div>
              </div>
            </div>
          )}

          {hasPending && onResolveAddress && (
            <MissingAddressPrompt
              labels={pendingAddresses!}
              onResolve={onResolveAddress}
              onSkip={onSkipAddresses}
              loading={loading ?? false}
            />
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <form
          onSubmit={handleSubmit}
          className="absolute right-0 bottom-0 left-0 border-t border-zinc-800 bg-zinc-950 px-3 py-3"
        >
          <AnimatePresence mode="wait">
            {isRecording ? (
              <motion.div
                key="recording"
                initial={{ opacity: 0, y: 8, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.97 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="relative"
              >
                <div className="pointer-events-none absolute -inset-1 rounded-xl bg-red-500/10 blur-xl" />
                <div className="relative flex flex-col rounded-xl bg-zinc-900/80 px-3.5 py-3 shadow-lg ring-1 shadow-black/30 ring-red-500/20 backdrop-blur-xl">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-500" />
                      <span className="text-sm font-medium text-red-400">
                        Recording… {formatTime(recordingSeconds)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={stopRecording}
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-red-600/20 text-red-400 transition-colors hover:bg-red-600/30"
                    >
                      <Square className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {liveTranscript ? (
                    <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-zinc-300">
                      {liveTranscript}
                    </p>
                  ) : (
                    <div className="mt-1.5 flex items-center gap-1.5">
                      {[0.25, 0.5, 0.75, 1, 0.75, 0.5, 0.25].map((scale, i) => (
                        <span
                          key={i}
                          className="w-0.5 rounded-full bg-red-400/60 transition-all duration-75"
                          style={{
                            height: `${Math.max(3, audioLevel * 20 * scale)}px`,
                            opacity: Math.max(0.3, audioLevel),
                          }}
                        />
                      ))}
                      <span className="ml-1 text-sm text-zinc-500 italic">Listening…</span>
                    </div>
                  )}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="idle"
                initial={{ opacity: 0, y: 8, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.97 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
              >
                <div className="group focus-within:ring-brand-500/40 focus-within:shadow-brand-500/5 relative flex items-center rounded-xl bg-zinc-900/80 shadow-lg ring-1 shadow-black/30 ring-zinc-700/50 backdrop-blur-xl transition-all duration-300">
                  <div className="flex items-center pr-2 pl-3.5 text-zinc-500">
                    <Ship className="h-4 w-4" />
                  </div>
                  <input
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask to edit your flow…"
                    disabled={loading}
                    className="min-w-0 flex-1 bg-transparent py-2.5 text-base text-zinc-100 outline-none placeholder:text-zinc-600"
                  />
                  <button
                    type="button"
                    onClick={startRecording}
                    disabled={loading}
                    className="p-2 text-zinc-500 transition-colors hover:text-zinc-300 disabled:opacity-40"
                    title="Record voice"
                    aria-label="Record voice"
                  >
                    <Mic className="h-4 w-4" />
                  </button>
                  <div className="h-5 w-px bg-zinc-700/50" />
                  <button
                    type="submit"
                    disabled={loading || !input.trim()}
                    title="Send message"
                    aria-label="Send message"
                    className="text-brand-400 hover:text-brand-300 p-2 pr-3.5 transition-colors disabled:text-zinc-600"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </form>
      </div>
    </>
  );
}
