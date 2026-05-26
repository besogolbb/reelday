import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  Easing,
} from "remotion";

export const FPS = 30;
export const SLIDE_FRAMES = 7 * FPS; // 7s per step

const FONT_DISPLAY = "'Fraunces', 'Playfair Display', Georgia, serif";
const FONT_MONO    = "'JetBrains Mono', ui-monospace, monospace";
const FONT_SANS    = "'Inter', system-ui, sans-serif";
const ACCENT       = "#b85230";
const ACCENT_SOFT  = "#f0a37a";
const INK          = "#2a1a14";
const INK_SOFT     = "#5a443a";
const PAPER        = "#fbf5ec";
const PAPER_2      = "#f4ead9";
const LINE         = "rgba(42,26,20,.12)";

type Step = {
  num: string;
  title: string;
  blurb: string;
  visual: "create" | "qr" | "scan" | "tv";
};

export const STEPS: Step[] = [
  { num: "01", title: "Create your event",     blurb: "30 seconds. Pick a theme, set a date, name your wall.", visual: "create" },
  { num: "02", title: "Print the QR card",     blurb: "We send a print-ready PDF. Tape it to every table.",    visual: "qr"     },
  { num: "03", title: "Guests scan & upload",  blurb: "No app. No login. Just photos straight from the phone.", visual: "scan"   },
  { num: "04", title: "Wall goes live on TV",  blurb: "Every photo appears in real time on the big screen.",   visual: "tv"     },
];

export const TOTAL_FRAMES = SLIDE_FRAMES * STEPS.length;

// ─── Visual blocks ──────────────────────────────────────────

const PhoneFrame: React.FC<{ children: React.ReactNode; tilt?: number }> = ({ children, tilt = -4 }) => (
  <div
    style={{
      width: 360,
      height: 720,
      borderRadius: 48,
      background: "#111",
      padding: 14,
      boxShadow: "0 30px 80px rgba(42,26,20,.25), 0 8px 24px rgba(42,26,20,.15)",
      transform: `rotate(${tilt}deg)`,
    }}
  >
    <div style={{ width: "100%", height: "100%", borderRadius: 36, background: PAPER, overflow: "hidden", position: "relative" }}>
      {children}
    </div>
  </div>
);

const VisualCreate: React.FC = () => (
  <PhoneFrame tilt={-4}>
    <div style={{ padding: "28px 22px", fontFamily: FONT_SANS }}>
      <div style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: ".24em", color: ACCENT, textTransform: "uppercase", marginBottom: 10 }}>New event</div>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 28, color: INK, fontStyle: "italic", marginBottom: 28, lineHeight: 1.1 }}>
        Maria &amp; Jaime
      </div>

      <Field label="Date"    value="May 30, 2026" />
      <Field label="Venue"   value="Tagaytay Highlands" />
      <Field label="Theme"   value="Wedding · Sunlit" />
      <Field label="Wall name" value="reelday.ph/maria-jaime" />

      <div
        style={{
          marginTop: 22,
          background: ACCENT,
          color: "#fff",
          fontFamily: FONT_MONO,
          fontSize: 12,
          letterSpacing: ".18em",
          textTransform: "uppercase",
          padding: "16px",
          borderRadius: 14,
          textAlign: "center",
          fontWeight: 600,
        }}
      >
        Create event
      </div>
    </div>
  </PhoneFrame>
);

const Field: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={{ marginBottom: 14 }}>
    <div style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: ".2em", color: INK_SOFT, textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
    <div style={{ fontFamily: FONT_SANS, fontSize: 14, color: INK, paddingBottom: 8, borderBottom: `1px solid ${LINE}` }}>{value}</div>
  </div>
);

// Stylized QR (decorative — not scannable)
const StylizedQR: React.FC<{ size: number }> = ({ size }) => {
  const grid = 11;
  const cell = size / grid;
  // Deterministic pseudo-random pattern
  const cells: boolean[][] = Array.from({ length: grid }, (_, r) =>
    Array.from({ length: grid }, (_, c) => ((r * 31 + c * 17 + r * c * 7) % 7) > 3)
  );
  // Force three finder markers (top-left, top-right, bottom-left)
  const finders: [number, number][] = [[0,0],[0,grid-3],[grid-3,0]];
  finders.forEach(([fr,fc]) => {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cells[fr+r][fc+c] = true;
  });
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }}>
      <rect width={size} height={size} fill="#fff" />
      {cells.map((row, r) =>
        row.map((on, c) =>
          on ? <rect key={`${r}-${c}`} x={c * cell + 1} y={r * cell + 1} width={cell - 2} height={cell - 2} fill={INK} /> : null
        )
      )}
      {/* white centers of finder markers */}
      {finders.map(([fr,fc], i) => (
        <rect key={i} x={fc * cell + cell + 1} y={fr * cell + cell + 1} width={cell - 2} height={cell - 2} fill="#fff" />
      ))}
    </svg>
  );
};

const VisualQR: React.FC = () => (
  <div
    style={{
      transform: "rotate(3deg)",
      borderRadius: 14,
      overflow: "hidden",
      boxShadow: "0 30px 80px rgba(42,26,20,.22), 0 8px 24px rgba(42,26,20,.12)",
      border: `1px solid ${LINE}`,
    }}
  >
    <Img src={staticFile("qr-poster.png")} style={{ display: "block", width: 480, height: "auto" }} />
  </div>
);

const VisualScan: React.FC = () => (
  <div style={{ position: "relative", width: 560, height: 700 }}>
    {/* QR poster in the background (tilted away) */}
    <div
      style={{
        position: "absolute", left: -20, top: 70,
        transform: "rotate(-8deg)",
        boxShadow: "0 16px 40px rgba(42,26,20,.18)",
        borderRadius: 12,
        overflow: "hidden",
        border: `1px solid ${LINE}`,
      }}
    >
      <Img src={staticFile("qr-poster.png")} style={{ display: "block", width: 280, height: "auto" }} />
    </div>

    {/* Phone scanning */}
    <div style={{ position: "absolute", right: 0, top: 0 }}>
      <PhoneFrame tilt={6}>
        <div style={{ position: "absolute", inset: 0, background: "#0a0a0a" }}>
          {/* Simulated camera view: zoomed-in QR poster */}
          <Img
            src={staticFile("qr-poster.png")}
            style={{
              position: "absolute",
              top: "50%", left: "50%",
              width: 520, height: "auto",
              transform: "translate(-50%, -50%)",
              opacity: 0.7,
              filter: "brightness(.85) contrast(1.05)",
            }}
          />
          {/* viewfinder corners */}
          <Corner pos={{ top: 220, left: 60 }}  rot={0}   />
          <Corner pos={{ top: 220, right: 60 }} rot={90}  />
          <Corner pos={{ bottom: 220, left: 60 }} rot={270} />
          <Corner pos={{ bottom: 220, right: 60 }} rot={180} />
          <div style={{
            position: "absolute", bottom: 32, left: 0, right: 0, textAlign: "center",
            fontFamily: FONT_MONO, fontSize: 12, letterSpacing: ".2em", color: ACCENT_SOFT, textTransform: "uppercase",
          }}>
            ● Detected
          </div>
        </div>
      </PhoneFrame>
    </div>
  </div>
);

const Corner: React.FC<{ pos: React.CSSProperties; rot: number }> = ({ pos, rot }) => (
  <div style={{ position: "absolute", width: 32, height: 32, transform: `rotate(${rot}deg)`, ...pos }}>
    <div style={{ position: "absolute", top: 0, left: 0, width: 24, height: 4, background: ACCENT_SOFT, borderRadius: 2 }} />
    <div style={{ position: "absolute", top: 0, left: 0, width: 4, height: 24, background: ACCENT_SOFT, borderRadius: 2 }} />
  </div>
);

const VisualTV: React.FC = () => {
  // Cycles through the same demo wall photos
  const photos = ["01-first-dance.png", "02-whole-family.png", "03-garden-hour.png", "04-best-night.png"];
  const frame = useCurrentFrame();
  // Within the TV slide window, cycle every 1.6s
  const localFrame = Math.max(0, frame - 3 * SLIDE_FRAMES);
  const ph = photos[Math.floor(localFrame / (1.6 * FPS)) % photos.length];
  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
      {/* TV bezel */}
      <div style={{
        width: 720, height: 405,
        borderRadius: 16,
        background: "#1a1a1a",
        padding: 18,
        boxShadow: "0 30px 80px rgba(42,26,20,.28), 0 8px 24px rgba(42,26,20,.14)",
      }}>
        <div style={{ width: "100%", height: "100%", borderRadius: 6, overflow: "hidden", background: "#000", position: "relative" }}>
          <Img src={staticFile(ph)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          <div style={{
            position: "absolute", inset: 0,
            background: "linear-gradient(180deg, rgba(0,0,0,.4) 0%, transparent 25%, transparent 60%, rgba(0,0,0,.85) 100%)",
          }} />
          <div style={{
            position: "absolute", top: 14, left: 18, display: "flex", alignItems: "center", gap: 8,
            fontFamily: FONT_MONO, fontSize: 10, letterSpacing: ".2em", color: "rgba(255,255,255,.85)", textTransform: "uppercase",
          }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: ACCENT_SOFT, boxShadow: "0 0 0 3px rgba(240,163,122,.3)" }} />
            Live
          </div>
          <div style={{
            position: "absolute", bottom: 16, left: 18, right: 18,
            fontFamily: FONT_DISPLAY, fontStyle: "italic", fontSize: 22, color: "#fff",
            textShadow: "0 2px 8px rgba(0,0,0,.8)",
          }}>
            “Best night of the year.”
          </div>
        </div>
      </div>
      {/* TV stand */}
      <div style={{ width: 220, height: 14, background: "#2a2a2a", borderRadius: 6 }} />
      <div style={{ width: 320, height: 6, background: "#1a1a1a", borderRadius: 3, marginTop: -10 }} />
    </div>
  );
};

const Visual: React.FC<{ kind: Step["visual"] }> = ({ kind }) => {
  if (kind === "create") return <VisualCreate />;
  if (kind === "qr")     return <VisualQR />;
  if (kind === "scan")   return <VisualScan />;
  return <VisualTV />;
};

// ─── Main composition ───────────────────────────────────────

export const HowItWorks: React.FC = () => {
  const frame = useCurrentFrame();
  const BAR_H = 110;

  // Sticky-bar fade-in
  const titleOpacity = interpolate(frame, [0, FPS], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: PAPER }}>
      <Audio src={staticFile("ceremony.mp3")} volume={0.65} />

      {/* Sticky top bar */}
      <div
        style={{
          position: "absolute", top: 0, left: 0, right: 0, height: BAR_H,
          background: "linear-gradient(180deg, #1a0f0a 0%, #2a1a14 100%)",
          borderBottom: `2px solid ${ACCENT_SOFT}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "0 48px", zIndex: 20, opacity: titleOpacity,
        }}
      >
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 34, fontStyle: "italic", color: "#fff", letterSpacing: "-.01em", textAlign: "center", lineHeight: 1.15, padding: "0 24px" }}>
          How <span style={{ color: ACCENT_SOFT, fontWeight: 500 }}>Reelday.ph</span> works — four steps, one wall.
        </div>
      </div>

      {/* Slide area */}
      <div style={{ position: "absolute", top: BAR_H, left: 0, right: 0, bottom: 0, overflow: "hidden" }}>
        {/* Subtle paper texture / motif */}
        <div style={{
          position: "absolute", inset: 0,
          background: `radial-gradient(ellipse at top right, ${PAPER_2} 0%, ${PAPER} 60%)`,
        }} />

        {STEPS.map((step, i) => {
          const start = i * SLIDE_FRAMES;
          const end   = start + SLIDE_FRAMES;
          if (frame < start - FPS || frame > end + FPS) return null;
          const local = frame - start;

          // Slide-in from right + fade in over first 0.6s, fade out last 0.4s
          const inP  = interpolate(local, [0, 0.6 * FPS], [60, 0],  { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
          const opIn = interpolate(local, [0, 0.6 * FPS], [0, 1],   { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const opOut= interpolate(local, [SLIDE_FRAMES - 0.4 * FPS, SLIDE_FRAMES], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const opacity = Math.min(opIn, opOut);

          return (
            <div
              key={i}
              style={{
                position: "absolute", inset: 0,
                padding: "40px 60px 90px",
                display: "grid", gridTemplateRows: "1fr auto", gap: 24, alignItems: "stretch",
                opacity,
                transform: `translateY(${inP}px)`,
              }}
            >
              {/* Top: visual */}
              <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 0, overflow: "hidden" }}>
                <div style={{ transform: "scale(0.78)", transformOrigin: "center" }}>
                  <Visual kind={step.visual} />
                </div>
              </div>

              {/* Bottom: text */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
                <div style={{ fontFamily: FONT_MONO, fontSize: 20, letterSpacing: ".3em", color: ACCENT, textTransform: "uppercase", marginBottom: 14 }}>
                  Step {step.num}
                </div>
                <div style={{ fontFamily: FONT_DISPLAY, fontSize: 64, fontStyle: "italic", color: INK, lineHeight: 1.02, letterSpacing: "-.02em", marginBottom: 16 }}>
                  {step.title}.
                </div>
                <div style={{ fontFamily: FONT_SANS, fontSize: 22, color: INK_SOFT, lineHeight: 1.45, maxWidth: 760 }}>
                  {step.blurb}
                </div>

                {/* Step pips */}
                <div style={{ display: "flex", gap: 10, marginTop: 26 }}>
                  {STEPS.map((_, j) => (
                    <div
                      key={j}
                      style={{
                        width: j === i ? 40 : 10,
                        height: 6,
                        borderRadius: 999,
                        background: j === i ? ACCENT : "rgba(42,26,20,.18)",
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          );
        })}

        {/* Footer wordmark */}
        <div style={{
          position: "absolute", bottom: 26, left: 0, right: 0,
          textAlign: "center",
          fontFamily: FONT_MONO, fontSize: 13, letterSpacing: ".3em", color: INK_SOFT, textTransform: "uppercase",
        }}>
          reelday.ph
        </div>
      </div>
    </AbsoluteFill>
  );
};
