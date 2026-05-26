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
  BG:    "#1a0f0a",
  SOFT:  "#f0a37a",
  GOLD:  "#d8a05a",
  TEXT:  "#ffffff",
};
const FONT_DISPLAY = "'Fraunces', 'Playfair Display', Georgia, serif";
const FONT_MONO    = "'JetBrains Mono', ui-monospace, monospace";

export type Platform = "tiktok" | "ig";

type PlatformConfig = {
  totalFrames: number;
  hookSize: number;
  hookStartsAlone: boolean;
  wallStartFrame: number;
  outroStartFrame: number;
  slidePhotos: { img: string; uploader: string; quote: string }[];
};

const SLIDES = [
  { img: "01-first-dance.png",   uploader: "— Tita Marivic · 8:42 pm",  quote: "“First dance after 38 years — still got it.”" },
  { img: "02-whole-family.png",  uploader: "— Kuya Mike · 9:01 pm",     quote: "“The whole family finally in one frame.”" },
  { img: "03-garden-hour.png",   uploader: "— Ate Karen · 9:18 pm",     quote: "“Garden hour. No filter needed.”" },
  { img: "04-best-night.png",    uploader: "— Kuya Vince · 9:35 pm",    quote: "“Best night of the year, hands down.”" },
  { img: "05-first-kiss.png",    uploader: "— JM · 9:52 pm",            quote: "“The moment everyone was waiting for.”" },
  { img: "06-dancing-tatay.png", uploader: "— Andrea · 10:08 pm",       quote: "“Dancing with Tatay. I will never forget this.”" },
];

const CONFIG: Record<Platform, PlatformConfig> = {
  tiktok: {
    totalFrames: 360, // 12s
    hookSize: 96,
    hookStartsAlone: true,
    wallStartFrame: 60,        // 2s hook only
    outroStartFrame: 300,      // 10s — 2s outro
    // 4 photos × ~2s each across frames 60..300
    slidePhotos: [SLIDES[0], SLIDES[1], SLIDES[3], SLIDES[5]],
  },
  ig: {
    totalFrames: 540, // 18s
    hookSize: 64,
    hookStartsAlone: false,
    wallStartFrame: 0,
    outroStartFrame: 450,      // 15s — 3s outro
    // 5 photos × ~3s each across frames 0..450
    slidePhotos: [SLIDES[0], SLIDES[1], SLIDES[2], SLIDES[3], SLIDES[5]],
  },
};

const HOOK: Record<Platform, string[]> = {
  tiktok: [
    "POV: every guest",
    "is your wedding",
    "photographer 📸",
  ],
  ig: [
    "Every guest with a phone",
    "becomes a wedding photographer.",
    "Real-time. Sa isang screen.",
  ],
};

// ─── Ken Burns ────────────────────────────────────────────
const KenBurns: React.FC<{ src: string; local: number; duration: number }> = ({
  src,
  local,
  duration,
}) => {
  const scale = interpolate(local, [0, duration], [1.05, 1.2], {
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

// ─── Wall slideshow (middle zone) ─────────────────────────
const WallSlideshow: React.FC<{ frame: number; cfg: PlatformConfig }> = ({ frame, cfg }) => {
  const start = cfg.wallStartFrame;
  const end = cfg.outroStartFrame;
  const local = frame - start;
  const span = end - start;
  const photos = cfg.slidePhotos;
  const perSlide = Math.floor(span / photos.length);

  const idx = Math.min(Math.floor(local / perSlide), photos.length - 1);
  const cur = photos[idx];
  const slideLocal = local - idx * perSlide;

  // Cross-fade between slides (last 12 frames out, first 12 in handled by next)
  const FADE = 14;
  const slideOpacity = interpolate(
    slideLocal,
    [0, FADE, perSlide - FADE, perSlide],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: C.BG }}>
      <div style={{ position: "absolute", inset: 0, opacity: slideOpacity }}>
        <KenBurns src={cur.img} local={slideLocal} duration={perSlide} />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,.55) 100%), " +
              "linear-gradient(180deg, rgba(0,0,0,.65) 0%, transparent 22%, transparent 55%, rgba(0,0,0,.95) 100%)",
          }}
        />
      </div>

      {/* Bottom caption */}
      <div
        style={{
          position: "absolute",
          bottom: 180,
          left: 40,
          right: 40,
          opacity: slideOpacity,
        }}
      >
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 16,
            letterSpacing: ".18em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,.78)",
            marginBottom: 10,
          }}
        >
          {cur.uploader}
        </div>
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontStyle: "italic",
            fontWeight: 400,
            fontSize: 40,
            lineHeight: 1.1,
            color: C.TEXT,
            textShadow: "0 2px 12px rgba(0,0,0,.8)",
          }}
        >
          {cur.quote}
        </div>
      </div>

      {/* Live ticker */}
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
          {247 + idx * 7} moments · 42 guests
        </div>
      </div>
    </div>
  );
};

// ─── POV Caption (top zone, line by line) ─────────────────
const POVCaption: React.FC<{
  lines: string[];
  size: number;
  startFrame: number;
  frame: number;
}> = ({ lines, size, startFrame, frame }) => {
  return (
    <div
      style={{
        position: "absolute",
        top: 110,
        left: 40,
        right: 40,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      {lines.map((line, i) => {
        const lineStart = startFrame + i * 8;
        const local = frame - lineStart;
        const op = interpolate(local, [0, 12], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const ty = interpolate(local, [0, 18], [22, 0], {
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
              textShadow: "0 4px 18px rgba(0,0,0,.9), 0 1px 4px rgba(0,0,0,.95)",
              opacity: op,
              transform: `translateY(${ty}px)`,
            }}
          >
            {line}
          </div>
        );
      })}
    </div>
  );
};

// ─── Brand Footer ─────────────────────────────────────────
const BrandFooter: React.FC = () => {
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
      }}
    >
      <div
        style={{
          fontFamily: FONT_DISPLAY,
          fontStyle: "italic",
          fontWeight: 500,
          fontSize: 44,
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

// ─── Hook intro (TikTok only) ─────────────────────────────
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

// ─── Outro ────────────────────────────────────────────────
const Outro: React.FC<{ frame: number; outroStart: number; fps: number }> = ({
  frame,
  outroStart,
  fps,
}) => {
  const local = frame - outroStart;
  const op = interpolate(local, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const titleSp = spring({ frame: local, fps, config: { damping: 14 } });
  const ty = interpolate(titleSp, [0, 1], [20, 0]);
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
        opacity: op,
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

// ─── Main composition ─────────────────────────────────────
export const Post1_DemoWall: React.FC<{ platform: Platform }> = ({ platform }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cfg = CONFIG[platform];
  const lines = HOOK[platform];

  const inHookOnly = cfg.hookStartsAlone && frame < cfg.wallStartFrame;
  const inWall     = frame >= cfg.wallStartFrame && frame < cfg.outroStartFrame;
  const inOutro    = frame >= cfg.outroStartFrame;

  const musicVol = interpolate(
    frame,
    [0, 24, cfg.totalFrames - 36, cfg.totalFrames],
    [0, 0.65, 0.65, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const wallHookStart = cfg.hookStartsAlone ? cfg.wallStartFrame : 0;
  const wallHookSize  = cfg.hookStartsAlone ? 38 : cfg.hookSize;
  const wallHookLines = cfg.hookStartsAlone
    ? ["Live photo wall. Sa wedding. ✨"]
    : lines;

  return (
    <AbsoluteFill style={{ background: C.BG }}>
      <Audio src={staticFile("party.mp3")} volume={musicVol} />

      {inHookOnly && <HookIntro lines={lines} size={cfg.hookSize} frame={frame} fps={fps} />}

      {inWall && (
        <>
          <WallSlideshow frame={frame} cfg={cfg} />
          <POVCaption
            lines={wallHookLines}
            size={wallHookSize}
            startFrame={wallHookStart}
            frame={frame}
          />
          <BrandFooter />
        </>
      )}

      {inOutro && (
        <Outro frame={frame} outroStart={cfg.outroStartFrame} fps={fps} />
      )}
    </AbsoluteFill>
  );
};

export const POST1_TIKTOK_FRAMES = CONFIG.tiktok.totalFrames;
export const POST1_IG_FRAMES = CONFIG.ig.totalFrames;
export const POST1_FPS = 30;
