import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  Easing,
  spring,
} from "remotion";

// ─── Brand constants (must match §Brand Identity in MARKETING.md) ──
const C = {
  BG:         "#1a0f0a",
  ACCENT:     "#c45a3a",
  SOFT:       "#f0a37a",
  GOLD:       "#d8a05a",
  SUCCESS:    "#2d7a4a",
  TEXT:       "#ffffff",
  TEXT_MUTED: "rgba(255,255,255,.55)",
};
const FONT_DISPLAY = "'Fraunces', 'Playfair Display', Georgia, serif";
const FONT_MONO    = "'JetBrains Mono', ui-monospace, monospace";

// ─── Platform variants ────────────────────────────────────
export type Platform = "tiktok" | "ig";

type PlatformConfig = {
  fps: number;
  totalFrames: number;
  // Hook (POV) timing & sizing
  hookSize: number;        // base font px
  hookStartsAlone: boolean; // TikTok: hook 0–2s with no wall behind it
  wallStartFrame: number;  // when wall appears
  // Slideshow → poll → results milestones (frames)
  slideEndFrame: number;
  pollEnterFrame: number;
  pollResultsFrame: number;
  pollExitFrame: number;
  outroStartFrame: number;
};

const CONFIG: Record<Platform, PlatformConfig> = {
  tiktok: {
    fps: 30,
    totalFrames: 360, // 12s
    hookSize: 96,
    hookStartsAlone: true,
    wallStartFrame: 60,       // 2s
    slideEndFrame: 150,       // 5s
    pollEnterFrame: 150,      // 5s
    pollResultsFrame: 225,    // 7.5s
    pollExitFrame: 315,       // 10.5s
    outroStartFrame: 315,
  },
  ig: {
    fps: 30,
    totalFrames: 540, // 18s
    hookSize: 72,
    hookStartsAlone: false,   // hook over wall from t=0
    wallStartFrame: 0,
    slideEndFrame: 165,       // 5.5s
    pollEnterFrame: 165,
    pollResultsFrame: 270,    // 9s
    pollExitFrame: 465,       // 15.5s
    outroStartFrame: 465,
  },
};

// ─── POV hook copy ─────────────────────────────────────────
const HOOK: Record<Platform, string[]> = {
  tiktok: [
    "POV: may live poll",
    "sa wedding 🗳️😂",
  ],
  ig: [
    "Nag-set up sila ng",
    "live poll sa wedding wall.",
    "Sabay-sabay bumoto ang lahat.",
  ],
};

// ─── Wall data ─────────────────────────────────────────────
const SLIDES = [
  { img: "01-first-dance.png",   uploader: "— Tita Marivic · 8:42 pm",  quote: "“First dance after 38 years — still got it.”" },
  { img: "02-whole-family.png",  uploader: "— Kuya Mike · 9:01 pm",     quote: "“The whole family finally in one frame.”" },
];

const POLL = {
  question: "Best dance move ng gabi?",
  options: [
    { label: "Tita's Tinikling",        votes: 18 },
    { label: "Lolo's Twist",            votes: 27 },
    { label: "The couple's first dance", votes: 41 },
  ],
};

// ─── Ken Burns slide ───────────────────────────────────────
const KenBurns: React.FC<{ src: string; local: number; duration: number }> = ({
  src,
  local,
  duration,
}) => {
  const scale = interpolate(local, [0, duration], [1.04, 1.18], {
    extrapolateRight: "clamp",
  });
  const tx = interpolate(local, [0, duration], [0, -2], { extrapolateRight: "clamp" });
  const ty = interpolate(local, [0, duration], [0, -1.5], { extrapolateRight: "clamp" });
  return (
    <Img
      src={staticFile(src)}
      style={{
        position: "absolute",
        inset: "-8%",
        width: "116%",
        height: "116%",
        objectFit: "cover",
        transform: `scale(${scale}) translate(${tx}%, ${ty}%)`,
      }}
    />
  );
};

// ─── Wall content (slideshow → poll) ───────────────────────
const WallContent: React.FC<{ frame: number; cfg: PlatformConfig }> = ({ frame, cfg }) => {
  // Slideshow phase
  const inSlideshow = frame < cfg.slideEndFrame;
  const inPoll      = frame >= cfg.pollEnterFrame && frame < cfg.pollExitFrame;

  // Two slides over slide phase
  const slideDur = Math.floor(cfg.slideEndFrame / SLIDES.length);

  // For poll, freeze on the LAST slide as backdrop
  const slideIdx = inSlideshow
    ? Math.min(Math.floor(frame / slideDur), SLIDES.length - 1)
    : SLIDES.length - 1;
  const cur = SLIDES[slideIdx];
  const slideLocal = inSlideshow ? frame - slideIdx * slideDur : slideDur - 1;

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: C.BG }}>
      {/* Slideshow */}
      <div style={{ position: "absolute", inset: 0 }}>
        <KenBurns src={cur.img} local={slideLocal} duration={slideDur} />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,.55) 100%), " +
              "linear-gradient(180deg, rgba(0,0,0,.6) 0%, transparent 25%, transparent 55%, rgba(0,0,0,.92) 100%)",
          }}
        />

        {/* Bottom caption (only during slideshow) */}
        {inSlideshow && (
          <div
            style={{
              position: "absolute",
              bottom: 32,
              left: 40,
              right: 40,
              opacity: interpolate(slideLocal, [0, 12, slideDur - 12, slideDur], [0, 1, 1, 0], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          >
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 18,
                letterSpacing: ".18em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,.78)",
                marginBottom: 12,
              }}
            >
              {cur.uploader}
            </div>
            <div
              style={{
                fontFamily: FONT_DISPLAY,
                fontStyle: "italic",
                fontWeight: 400,
                fontSize: 44,
                lineHeight: 1.1,
                color: C.TEXT,
                textShadow: "0 2px 12px rgba(0,0,0,.8)",
              }}
            >
              {cur.quote}
            </div>
          </div>
        )}
      </div>

      {/* Live ticker */}
      {!inPoll && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 64,
            background: "linear-gradient(180deg, rgba(0,0,0,.55), transparent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 24px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontFamily: FONT_MONO,
              fontSize: 13,
              letterSpacing: ".22em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,.9)",
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: C.SOFT,
                boxShadow: "0 0 0 4px rgba(240,163,122,.3)",
              }}
            />
            Live now
          </div>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 13,
              letterSpacing: ".16em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,.55)",
            }}
          >
            42 guests
          </div>
        </div>
      )}

      {/* Poll overlay */}
      {inPoll && <PollOverlay frame={frame} cfg={cfg} />}
    </div>
  );
};

// ─── Poll overlay (compact for the wall middle zone) ───────
const PollOverlay: React.FC<{ frame: number; cfg: PlatformConfig }> = ({ frame, cfg }) => {
  const { fps } = useVideoConfig();
  const local = frame - cfg.pollEnterFrame;
  const totalDur = cfg.pollExitFrame - cfg.pollEnterFrame;
  const resultsLocal = cfg.pollResultsFrame - cfg.pollEnterFrame;
  const inResults = local >= resultsLocal;

  // Entrance (zoom-in)
  const enter = spring({ frame: local, fps, config: { damping: 18, mass: 0.7 } });
  const opacityIn = interpolate(local, [0, 18], [0, 1], { extrapolateRight: "clamp" });
  const exitFrames = 18;
  const opacityOut = interpolate(local, [totalDur - exitFrames, totalDur], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = Math.min(opacityIn, opacityOut);
  const scale = 0.96 + 0.04 * enter;

  // Countdown 20 → 0 mapped across live phase
  const liveSecs = 20;
  const liveProg = Math.min(local / resultsLocal, 1);
  const countdown = inResults ? 0 : Math.max(0, Math.ceil(liveSecs * (1 - liveProg)));

  const totalVotes = POLL.options.reduce((s, o) => s + o.votes, 0);
  const winningVotes = Math.max(...POLL.options.map((o) => o.votes));

  const fillProg = interpolate(local, [resultsLocal, resultsLocal + 36], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const statsOpacity = interpolate(local, [resultsLocal + 24, resultsLocal + 48], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(circle at 30% 20%, rgba(196,90,58,.28), transparent 60%), " +
          "linear-gradient(180deg, rgba(15,7,3,.95), rgba(15,7,3,.98))",
        opacity,
        transform: `scale(${scale})`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "5vh 5vw",
      }}
    >
      {/* Top sticky bar — bold readable strip */}
      <div
        style={{
          position: "absolute",
          top: 24,
          left: 24,
          right: 24,
          padding: "14px 22px",
          borderRadius: 14,
          background: "rgba(0,0,0,.7)",
          border: `1px solid ${C.ACCENT}`,
          fontFamily: FONT_MONO,
          fontSize: 18,
          letterSpacing: ".18em",
          textTransform: "uppercase",
          textAlign: "center",
          color: C.SOFT,
          fontWeight: 700,
        }}
      >
        🗳️ Live poll — bumoto na! scan ang QR
      </div>

      {/* Tag */}
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 16,
          letterSpacing: ".32em",
          textTransform: "uppercase",
          color: C.SOFT,
          marginBottom: 18,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div
          style={{
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: C.ACCENT,
            boxShadow: `0 0 0 ${4 + 6 * Math.abs(Math.sin(local / 8))}px rgba(196,90,58,${
              0.5 - 0.4 * Math.abs(Math.sin(local / 8))
            })`,
          }}
        />
        Live poll
      </div>

      {/* Question */}
      <h1
        style={{
          fontFamily: FONT_DISPLAY,
          fontStyle: "italic",
          fontWeight: 500,
          fontSize: 60,
          lineHeight: 1.05,
          textAlign: "center",
          maxWidth: "14ch",
          margin: 0,
          marginBottom: 24,
          color: C.TEXT,
          textShadow: "0 6px 24px rgba(0,0,0,.6)",
        }}
      >
        {POLL.question}
      </h1>

      {/* Bars */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14, width: "90%" }}>
        {POLL.options.map((opt, i) => {
          const isLeader = opt.votes === winningVotes;
          const fillWidth = inResults ? (opt.votes / totalVotes) * 100 * fillProg : 0;
          const pct = Math.round((opt.votes / totalVotes) * 100);
          const fillBg =
            isLeader && inResults
              ? `linear-gradient(90deg, ${C.GOLD}, #f5d089)`
              : `linear-gradient(90deg, ${C.ACCENT}, ${C.SOFT})`;
          const borderColor =
            isLeader && inResults ? "rgba(216,160,90,.55)" : "rgba(255,255,255,.14)";
          return (
            <div
              key={i}
              style={{
                position: "relative",
                overflow: "hidden",
                background: "rgba(255,255,255,.08)",
                border: `1px solid ${borderColor}`,
                borderRadius: 16,
                padding: "20px 24px",
                fontSize: 32,
                fontWeight: 500,
                color: C.TEXT,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${fillWidth}%`,
                  background: fillBg,
                  zIndex: 0,
                }}
              />
              <div
                style={{
                  position: "relative",
                  zIndex: 1,
                  display: "flex",
                  justifyContent: inResults ? "space-between" : "center",
                  alignItems: "baseline",
                }}
              >
                <span>{opt.label}</span>
                {inResults && (
                  <span
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 30,
                      fontWeight: 700,
                      letterSpacing: ".06em",
                      fontVariantNumeric: "tabular-nums",
                      opacity: statsOpacity,
                    }}
                  >
                    {pct}%
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Foot */}
      <div
        style={{
          marginTop: 24,
          fontFamily: FONT_MONO,
          fontSize: 18,
          letterSpacing: ".26em",
          textTransform: "uppercase",
          fontWeight: 700,
          color: C.TEXT,
          opacity: 0.9,
        }}
      >
        {inResults ? (
          <span>Results</span>
        ) : (
          <span>
            Voting ends in{" "}
            <span
              style={{
                color: C.GOLD,
                fontSize: 36,
                fontWeight: 800,
                fontVariantNumeric: "tabular-nums",
                marginLeft: 8,
              }}
            >
              {countdown}s
            </span>
          </span>
        )}
      </div>
    </AbsoluteFill>
  );
};

// ─── POV Caption (top zone, line by line) ───────────────────
const POVCaption: React.FC<{
  lines: string[];
  size: number;
  startFrame: number;
  frame: number;
  fps: number;
}> = ({ lines, size, startFrame, frame, fps }) => {
  return (
    <div
      style={{
        position: "absolute",
        top: 40,
        left: 40,
        right: 40,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {lines.map((line, i) => {
        const lineStart = startFrame + i * 8;
        const local = frame - lineStart;
        const op = interpolate(local, [0, 12], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const ty = interpolate(local, [0, 18], [20, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.out(Easing.cubic),
        });
        return (
          <div
            key={i}
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 600,
              fontSize: size,
              lineHeight: 1.05,
              letterSpacing: "-.01em",
              color: C.TEXT,
              textShadow: "0 4px 18px rgba(0,0,0,.85), 0 1px 4px rgba(0,0,0,.9)",
              opacity: op,
              transform: `translateY(${ty}px)`,
            }}
          >
            {line}
          </div>
        );
      })}
      {/* fps unused but accepted to keep signature stable */}
      <span style={{ display: "none" }}>{fps}</span>
    </div>
  );
};

// ─── Brand Footer ─────────────────────────────────────────
const BrandFooter: React.FC<{ frame: number; totalFrames: number }> = ({ frame, totalFrames }) => {
  const inFrames = 30;
  const op = interpolate(frame, [totalFrames - 60, totalFrames - 60 + inFrames], [0.85, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        bottom: 36,
        left: 40,
        right: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        opacity: op,
      }}
    >
      <div
        style={{
          fontFamily: FONT_DISPLAY,
          fontStyle: "italic",
          fontWeight: 500,
          fontSize: 48,
          color: C.TEXT,
          letterSpacing: "-.01em",
        }}
      >
        Reelday<span style={{ color: C.SOFT }}>.ph</span>
      </div>
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 18,
          fontWeight: 700,
          letterSpacing: ".14em",
          textTransform: "uppercase",
          color: C.SOFT,
          padding: "12px 18px",
          borderRadius: 10,
          border: `1.5px solid ${C.SOFT}`,
          background: "rgba(0,0,0,.4)",
        }}
      >
        Try it FREE →
      </div>
    </div>
  );
};

// ─── Outro (final tagline + CTA card) ─────────────────────
const Outro: React.FC<{ frame: number; outroStart: number; totalFrames: number; fps: number }> = ({
  frame,
  outroStart,
  totalFrames,
  fps,
}) => {
  const local = frame - outroStart;
  const op = interpolate(local, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const titleSp = spring({ frame: local, fps, config: { damping: 14 } });
  const ty = interpolate(titleSp, [0, 1], [20, 0]);
  // Hide just before the very end so the BrandFooter resolves clean
  const opOut = interpolate(frame, [totalFrames - 6, totalFrames], [1, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(circle at 50% 35%, rgba(196,90,58,.32), transparent 60%), " +
          "linear-gradient(180deg, #1a0f0a 0%, #2a1a14 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        opacity: op * opOut,
        padding: "0 56px",
      }}
    >
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 18,
          letterSpacing: ".32em",
          textTransform: "uppercase",
          color: C.SOFT,
          marginBottom: 28,
        }}
      >
        Live photo wall
      </div>
      <div
        style={{
          fontFamily: FONT_DISPLAY,
          fontStyle: "italic",
          fontWeight: 600,
          fontSize: 88,
          color: C.TEXT,
          letterSpacing: "-.01em",
          textAlign: "center",
          transform: `translateY(${ty}px)`,
          lineHeight: 1.05,
        }}
      >
        Reelday<span style={{ color: C.SOFT }}>.ph</span>
      </div>
      <div
        style={{
          marginTop: 28,
          fontFamily: FONT_DISPLAY,
          fontStyle: "italic",
          fontWeight: 400,
          fontSize: 34,
          color: "rgba(255,255,255,.86)",
          textAlign: "center",
          maxWidth: "20ch",
          lineHeight: 1.25,
        }}
      >
        Walang app. Walang login.
        <br />
        Kahit si Lola kaya. 🙏
      </div>
      <div
        style={{
          marginTop: 36,
          fontFamily: FONT_MONO,
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: ".18em",
          textTransform: "uppercase",
          color: C.GOLD,
          padding: "16px 28px",
          borderRadius: 12,
          border: `2px solid ${C.GOLD}`,
        }}
      >
        Try it FREE → reelday.ph
      </div>
    </AbsoluteFill>
  );
};

// ─── Hook intro (TikTok only — frames 0..wallStartFrame) ──
const HookIntro: React.FC<{ lines: string[]; size: number; frame: number; fps: number }> = ({
  lines,
  size,
  frame,
  fps,
}) => {
  return (
    <AbsoluteFill
      style={{
        background: C.BG,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 56px",
      }}
    >
      {lines.map((line, i) => {
        const lineStart = i * 10;
        const local = frame - lineStart;
        const op = interpolate(local, [0, 14], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const sp = spring({ frame: local, fps, config: { damping: 12, mass: 0.6 } });
        const ty = interpolate(sp, [0, 1], [40, 0]);
        return (
          <div
            key={i}
            style={{
              fontFamily: FONT_DISPLAY,
              fontStyle: "italic",
              fontWeight: 700,
              fontSize: size,
              lineHeight: 1.05,
              letterSpacing: "-.01em",
              color: C.TEXT,
              textAlign: "center",
              opacity: op,
              transform: `translateY(${ty}px)`,
              marginBottom: 6,
            }}
          >
            {line}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

// ─── Main composition ─────────────────────────────────────
export const Post5_LivePoll: React.FC<{ platform: Platform }> = ({ platform }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cfg = CONFIG[platform];
  const lines = HOOK[platform];

  const inHookOnly = cfg.hookStartsAlone && frame < cfg.wallStartFrame;
  const inWall     = frame >= cfg.wallStartFrame && frame < cfg.outroStartFrame;
  const inOutro    = frame >= cfg.outroStartFrame;

  // Music: fade in/out
  const musicVol = interpolate(
    frame,
    [0, 24, cfg.totalFrames - 36, cfg.totalFrames],
    [0, 0.65, 0.65, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // For IG, the POV caption appears over the wall from t=0; for TikTok the caption stays as a smaller line during the wall phase.
  const wallHookStart = cfg.hookStartsAlone ? cfg.wallStartFrame : 0;
  const wallHookSize = cfg.hookStartsAlone ? 42 : cfg.hookSize;
  // On TikTok, after the hook intro fades, show a tighter restatement during the wall.
  const wallHookLines = cfg.hookStartsAlone
    ? ["Live poll. Sa wedding. ✨"]
    : lines;

  return (
    <AbsoluteFill style={{ background: C.BG }}>
      <Audio src={staticFile("party.mp3")} volume={musicVol} />

      {/* Hook-only intro (TikTok rule: first frames = hook, no product) */}
      {inHookOnly && <HookIntro lines={lines} size={cfg.hookSize} frame={frame} fps={fps} />}

      {/* Wall middle zone */}
      {inWall && (
        <>
          <WallContent frame={frame} cfg={cfg} />
          {/* POV caption overlaid on top zone */}
          <POVCaption
            lines={wallHookLines}
            size={wallHookSize}
            startFrame={wallHookStart}
            frame={frame}
            fps={fps}
          />
          <BrandFooter frame={frame} totalFrames={cfg.totalFrames} />
        </>
      )}

      {/* Outro */}
      {inOutro && (
        <Outro
          frame={frame}
          outroStart={cfg.outroStartFrame}
          totalFrames={cfg.totalFrames}
          fps={fps}
        />
      )}
    </AbsoluteFill>
  );
};

export const TIKTOK_FRAMES = CONFIG.tiktok.totalFrames;
export const IG_FRAMES = CONFIG.ig.totalFrames;
export const POST5_FPS = 30;
