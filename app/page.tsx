import Link from "next/link";
import Logo from "@/components/app/logo";

const features = [
  {
    eyebrow: "Trigger",
    icon: "toll",
    accent: "secondary",
    title: "On receive. On schedule.",
    body: "USDC inbound, every hour, or any Soroban event. Pick one block to listen.",
  },
  {
    eyebrow: "Action",
    icon: "payments",
    accent: "primary",
    title: "Pay. Split. Stream.",
    body: "One address or many. Percentages, fixed amounts, conditional gates — composed visually.",
  },
  {
    eyebrow: "Deploy",
    icon: "rocket_launch",
    accent: "tertiary",
    title: "Soroban contracts.",
    body: "Splitter, Streamer, and Conditional templates ship to Stellar.",
  },
] as const;

type Accent = (typeof features)[number]["accent"];

const accentClasses: Record<Accent, { dot: string; eyebrow: string; hover: string; icon: string }> =
  {
    primary: {
      dot: "bg-primary",
      eyebrow: "text-primary",
      hover: "hover:border-primary/50 hover:shadow-[0_0_24px_-8px_rgba(255,177,196,0.6)]",
      icon: "text-primary",
    },
    secondary: {
      dot: "bg-secondary",
      eyebrow: "text-secondary",
      hover: "hover:border-secondary/50 hover:shadow-[0_0_24px_-8px_rgba(152,203,255,0.6)]",
      icon: "text-secondary",
    },
    tertiary: {
      dot: "bg-tertiary",
      eyebrow: "text-tertiary",
      hover: "hover:border-tertiary/50 hover:shadow-[0_0_24px_-8px_rgba(255,186,32,0.6)]",
      icon: "text-tertiary",
    },
  };

export default function Landing() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Fixed translucent top nav */}
      <header className="glass-panel-nav fixed inset-x-0 top-0 z-50 h-16">
        <div className="px-margin mx-auto flex h-full max-w-7xl items-center">
          <Link href="/" className="group flex items-center" aria-label="Pink Raft home">
            <Logo size={24} />
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="px-margin pb-xl relative pt-[160px]">
        <div className="gap-lg mx-auto grid max-w-7xl items-center lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <div
              className="reveal border-outline-variant/40 bg-surface-container-low/60 text-label-sm text-on-surface-variant inline-flex items-center gap-2 rounded border px-3 py-1.5 font-mono"
              style={{ ["--reveal-delay" as string]: "60ms" }}
            >
              <span className="material-symbols-outlined text-primary text-[14px]">bolt</span>
              <span>ZAP FOR PAYMENTS · POWERED BY STELLAR</span>
            </div>

            <h1
              className="reveal font-display text-on-surface mt-8 text-[56px] leading-[1.05] font-bold tracking-[-0.02em] md:text-[72px]"
              style={{ ["--reveal-delay" as string]: "140ms" }}
            >
              Drag. Drop.{" "}
              <span className="text-primary relative inline-block">
                Deploy.
                <span className="bg-primary/15 absolute inset-x-0 bottom-1 -z-10 block h-3 blur-md" />
              </span>
            </h1>

            <p
              className="reveal text-body-lg font-body text-on-surface-variant mt-6 max-w-xl"
              style={{ ["--reveal-delay" as string]: "240ms" }}
            >
              Pink Raft turns triggers and actions into real Soroban contracts on Stellar.
              Non-custodial. Real money, real chain, ninety seconds end-to-end.
            </p>

            {/* CTAs */}
            <div
              className="reveal mt-10 flex flex-wrap items-center gap-3"
              style={{ ["--reveal-delay" as string]: "400ms" }}
            >
              <Link
                href="/login"
                className="group bg-primary text-label-md text-on-primary inline-flex items-center gap-2 rounded-lg px-6 py-3 font-mono font-bold transition-all duration-200 hover:-translate-y-px hover:shadow-[0_0_28px_rgba(255,177,196,0.55)] active:scale-95"
              >
                Build a flow
                <span className="material-symbols-outlined text-[18px] transition-transform group-hover:translate-x-0.5">
                  arrow_forward
                </span>
              </Link>
            </div>
          </div>

          {/* Canvas preview */}
          <div className="reveal relative" style={{ ["--reveal-delay" as string]: "200ms" }}>
            <div className="glass-panel-hero canvas-grid p-md md:p-lg relative overflow-hidden rounded-full">
              {/* corner ticks */}
              <CornerTicks />

              <div className="mb-md flex items-center justify-between">
                <div className="text-label-sm text-on-surface-variant flex items-center gap-2 font-mono">
                  <span className="material-symbols-outlined text-primary text-[14px]">
                    account_tree
                  </span>
                  FLOW: USDC_AUTO_SPLIT.RAFT
                </div>
                <div className="border-primary/20 bg-primary/10 text-label-sm text-primary flex items-center gap-1.5 rounded border px-2 py-1 font-mono">
                  <span className="status-dot-live h-1.5 w-1.5" />
                  LIVE
                </div>
              </div>

              <CanvasPreview />

              <div className="mt-md border-outline-variant/15 pt-sm text-label-sm text-on-surface-variant flex items-center justify-between border-t font-mono">
                <span>3 NODES · 2 EDGES</span>
                <span>
                  GAS EST: <span className="text-on-surface">0.0001 XLM</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature bento */}
      <section id="how" className="px-margin pb-xl relative">
        <div className="mx-auto max-w-7xl">
          <div className="scroll-reveal mb-lg gap-md flex items-end justify-between">
            <div>
              <p className="text-label-sm text-on-surface-variant font-mono">§ 01 · WORKFLOW</p>
              <h2 className="font-display text-on-surface mt-2 text-[40px] leading-[1.1] font-semibold tracking-[-0.01em]">
                Three blocks. <span className="text-on-surface-variant">One canvas.</span>
              </h2>
            </div>
            <p className="text-body-md text-on-surface-variant hidden max-w-sm md:block">
              Every pipeline is a directed graph of trigger → logic → action, compiled to a single
              Soroban contract.
            </p>
          </div>

          <div className="gap-md grid grid-cols-1 md:grid-cols-3">
            {features.map((f) => {
              const a = accentClasses[f.accent];
              return (
                <article
                  key={f.eyebrow}
                  className={`scroll-reveal glass-panel group gap-md p-md relative flex flex-col rounded-xl transition-all duration-300 ${a.hover}`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-label-sm inline-flex items-center gap-2 font-mono ${a.eyebrow}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${a.dot}`} />
                      {f.eyebrow.toUpperCase()}
                    </span>
                    <span
                      className={`material-symbols-outlined text-[20px] ${a.icon} opacity-80 transition-opacity group-hover:opacity-100`}
                    >
                      {f.icon}
                    </span>
                  </div>
                  <h3 className="text-headline-sm text-on-surface">{f.title}</h3>
                  <p className="text-body-md text-on-surface-variant">{f.body}</p>
                  <div className="text-label-sm text-on-surface-variant mt-auto flex items-center gap-2 font-mono">
                    <span className="material-symbols-outlined text-[14px]">tag</span>
                    {f.eyebrow.toLowerCase()}.raft
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* Contracts strip */}
      <section id="contracts" className="px-margin pb-xl relative">
        <div className="mx-auto max-w-7xl">
          <div className="scroll-reveal glass-panel p-lg rounded-xl">
            <div className="gap-md flex flex-wrap items-end justify-between">
              <div>
                <p className="text-label-sm text-on-surface-variant font-mono">§ 02 · CONTRACTS</p>
                <h2 className="font-display text-on-surface mt-2 text-[32px] font-semibold tracking-[-0.01em]">
                  Three templates.
                </h2>
              </div>
            </div>

            <div className="mt-md border-outline-variant/20 grid grid-cols-1 gap-px overflow-hidden rounded-xl border md:grid-cols-3">
              {[
                { name: "Splitter", tag: "DISTRIBUTE" },
                { name: "Streamer", tag: "SCHEDULE" },
                { name: "Conditional", tag: "GATE" },
              ].map((c) => (
                <div
                  key={c.name}
                  className="bg-surface-container-low/60 p-md hover:bg-surface-container-high/40 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-label-sm text-primary font-mono">{c.tag}</span>
                    <span className="material-symbols-outlined text-on-surface-variant text-[16px]">
                      verified
                    </span>
                  </div>
                  <h3 className="text-headline-sm text-on-surface mt-3">{c.name}</h3>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="px-margin pb-xl relative">
        <div className="mx-auto max-w-7xl">
          <div className="scroll-reveal glass-panel-hero p-lg md:p-xl relative overflow-hidden rounded-full">
            <div className="bg-primary/10 pointer-events-none absolute -top-20 -right-20 h-72 w-72 rounded-full blur-3xl" />
            <div className="bg-secondary/10 pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full blur-3xl" />
            <div className="gap-md relative flex flex-wrap items-center justify-between">
              <div>
                <p className="text-label-sm text-primary font-mono">/ BEGIN</p>
                <h2 className="font-display text-on-surface mt-2 text-[40px] leading-[1.1] font-semibold tracking-[-0.02em] md:text-[56px]">
                  Ship your first pipeline.
                </h2>
                <p className="text-body-md text-on-surface-variant mt-3 max-w-md">
                  Non-custodial. Pink Raft never holds your keys.
                </p>
              </div>
              <Link
                href="/login"
                className="group bg-primary text-label-md text-on-primary inline-flex items-center gap-2 rounded-lg px-6 py-3 font-mono font-bold transition-all duration-200 hover:-translate-y-px hover:shadow-[0_0_28px_rgba(255,177,196,0.6)] active:scale-95"
              >
                Build a flow
                <span className="material-symbols-outlined text-[18px] transition-transform group-hover:translate-x-0.5">
                  arrow_forward
                </span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-outline-variant/15 px-margin py-md border-t">
        <div className="text-label-sm text-on-surface-variant mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 font-mono">
          <span>© PINK RAFT · BUILT FOR ANYONE</span>
        </div>
      </footer>
    </div>
  );
}

function CornerTicks() {
  return (
    <>
      <span className="border-primary/40 pointer-events-none absolute top-2 left-2 h-3 w-3 border-t border-l" />
      <span className="border-primary/40 pointer-events-none absolute top-2 right-2 h-3 w-3 border-t border-r" />
      <span className="border-primary/40 pointer-events-none absolute bottom-2 left-2 h-3 w-3 border-b border-l" />
      <span className="border-primary/40 pointer-events-none absolute right-2 bottom-2 h-3 w-3 border-r border-b" />
    </>
  );
}

function CanvasPreview() {
  return (
    <div className="relative h-[280px]">
      {/* preserveAspectRatio="none" lets us route paths in % space so they
       * land in the visible gaps between the absolutely-positioned cards. */}
      <svg
        className="absolute inset-0 h-full w-full overflow-visible"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        fill="none"
      >
        <defs>
          <path id="hero-edge-1" d="M 30 30 C 32 32, 33 38, 35 41" />
          <path id="hero-edge-2" d="M 61 52 C 63 56, 64 62, 66 64" />
          <radialGradient id="particle-blue">
            <stop offset="0%" stopColor="#98cbff" stopOpacity="1" />
            <stop offset="100%" stopColor="#98cbff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="particle-pink">
            <stop offset="0%" stopColor="#ffb1c4" stopOpacity="1" />
            <stop offset="100%" stopColor="#ffb1c4" stopOpacity="0" />
          </radialGradient>

          {/* Arrowheads. markerUnits="strokeWidth" keeps them proportional to
           * the stroke, and the marker's own viewBox is square so the
           * preserveAspectRatio="none" on the parent doesn't skew it. */}
          <marker
            id="arrow-blue"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#98cbff" />
          </marker>
          <marker
            id="arrow-pink"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#ffb1c4" />
          </marker>
        </defs>

        {/* Edge strokes — bright, slightly glowing */}
        <use
          href="#hero-edge-1"
          stroke="#98cbff"
          strokeWidth="1"
          strokeDasharray="2.5 1.5"
          strokeLinecap="round"
          markerEnd="url(#arrow-blue)"
          style={{ filter: "drop-shadow(0 0 4px rgba(152, 203, 255, 0.7))" }}
        >
          <animate
            attributeName="stroke-dashoffset"
            from="0"
            to="-100"
            dur="14s"
            repeatCount="indefinite"
          />
        </use>
        <use
          href="#hero-edge-2"
          stroke="#ffb1c4"
          strokeWidth="1"
          strokeDasharray="2.5 1.5"
          strokeLinecap="round"
          markerEnd="url(#arrow-pink)"
          style={{ filter: "drop-shadow(0 0 4px rgba(255, 177, 196, 0.7))" }}
        >
          <animate
            attributeName="stroke-dashoffset"
            from="0"
            to="-100"
            dur="14s"
            repeatCount="indefinite"
          />
        </use>

        {/* Money particles travelling along the edges */}
        <circle r="1.4" fill="url(#particle-blue)">
          <animateMotion dur="3.2s" repeatCount="indefinite" rotate="auto">
            <mpath href="#hero-edge-1" />
          </animateMotion>
        </circle>
        <circle r="1" fill="url(#particle-blue)" opacity="0.7">
          <animateMotion dur="3.2s" begin="1.4s" repeatCount="indefinite" rotate="auto">
            <mpath href="#hero-edge-1" />
          </animateMotion>
        </circle>
        <circle r="1.4" fill="url(#particle-pink)">
          <animateMotion dur="2.6s" begin="0.4s" repeatCount="indefinite" rotate="auto">
            <mpath href="#hero-edge-2" />
          </animateMotion>
        </circle>
        <circle r="1" fill="url(#particle-pink)" opacity="0.7">
          <animateMotion dur="2.6s" begin="1.7s" repeatCount="indefinite" rotate="auto">
            <mpath href="#hero-edge-2" />
          </animateMotion>
        </circle>
      </svg>

      {/* Trigger node */}
      <div className="absolute top-4 left-2 w-[180px]">
        <div className="glass-panel rounded-lg p-3">
          <div className="text-label-sm text-secondary flex items-center gap-2 font-mono">
            <span className="material-symbols-outlined text-[14px]">toll</span>
            TRIGGER
          </div>
          <p className="font-display text-on-surface mt-2 text-[14px] font-semibold">
            On Receive USDC
          </p>
          <p className="text-on-surface-variant mt-1 font-mono text-[11px]">G ABC1...XYZ4</p>
        </div>
      </div>

      {/* Logic node */}
      <div className="absolute top-[40%] left-[36%] w-[150px]">
        <div className="glass-panel rounded-lg p-2.5">
          <div className="text-label-sm text-tertiary flex items-center gap-2 font-mono">
            <span className="material-symbols-outlined text-[14px]">rule</span>
            LOGIC
          </div>
          <p className="font-display text-on-surface mt-1.5 text-[13px] font-semibold">
            If amount &gt; 100
          </p>
        </div>
      </div>

      {/* Action node */}
      <div className="absolute right-2 bottom-2 w-[180px]">
        <div className="glass-panel border-primary/40 rounded-lg p-3 shadow-[0_0_18px_-8px_rgba(255,177,196,0.6)]">
          <div className="flex items-center justify-between">
            <span className="text-label-sm text-primary flex items-center gap-2 font-mono">
              <span className="material-symbols-outlined text-[14px]">call_split</span>
              ACTION
            </span>
            <span className="status-dot-live h-1.5 w-1.5" />
          </div>
          <p className="font-display text-on-surface mt-2 text-[14px] font-semibold">
            Split 60 / 30 / 10
          </p>
          <p className="text-on-surface-variant mt-1 font-mono text-[11px]">3 recipients</p>
        </div>
      </div>
    </div>
  );
}
