import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  random,
  staticFile,
  useCurrentFrame,
  Easing,
} from "remotion";

export const FPS = 30;
export const DURATION_S = 22;
export const TOTAL_FRAMES = FPS * DURATION_S;

const FONT_DISPLAY = "'Fraunces', 'Playfair Display', Georgia, serif";
const FONT_MONO    = "'JetBrains Mono', ui-monospace, monospace";
const FONT_SANS    = "'Inter', system-ui, sans-serif";
const ACCENT       = "#b85230";
const ACCENT_SOFT  = "#f0a37a";
const INK          = "#2a1a14";

const SLIDE_FRAMES = Math.round(5.5 * FPS); // 5.5s per photo

// Mirrors the actual wedding-theme emoji set on the live wall
// (frontend/wall.html → wedding: ['💗','🎉','✨','🥂','💍','🌸','💒'])
const EMOJI = ["💗", "🎉", "✨", "🥂", "💍", "🌸", "💒", "❤️"];

const PHOTOS = [
  "01-first-dance.png",
  "02-whole-family.png",
  "03-garden-hour.png",
  "04-best-night.png",
  "05-first-kiss.png",
  "06-dancing-tatay.png",
];

const QUOTES = [
  '"First dance after 38 years."',
  '"The whole family in one frame."',
  '"Garden hour. No filter."',
  '"Best night of the year."',
  '"The moment everyone was waiting for."',
  '"Dancing with Tatay."',
];

// ── Floating emoji ───────────────────────────────────────────
type EmojiSpawn = {
  id: number;
  emoji: string;
  startFrame: number;
  durationFrames: number; // travel time
  startX: number;         // px
  drift: number;          // px sideways
  size: number;           // px
  rotate: number;         // deg
};

const buildSpawns = (count: number, canvasW: number, totalFrames: number): EmojiSpawn[] => {
  const spawns: EmojiSpawn[] = [];
  for (let i = 0; i < count; i++) {
    const seed = i * 7 + 13;
    spawns.push({
      id: i,
      emoji: EMOJI[Math.floor(random(`em-${seed}`) * EMOJI.length)],
      startFrame: Math.floor(random(`sf-${seed}`) * (totalFrames - FPS * 4)),
      durationFrames: Math.round((3.2 + random(`du-${seed}`) * 1.8) * FPS),
      // Bias spawns toward the phone position (right side) but spread across
      startX: random(`sx-${seed}`) < 0.55
        ? canvasW * 0.62 + random(`px-${seed}`) * canvasW * 0.32
        : random(`sx-${seed}`) * canvasW,
      drift: (random(`dr-${seed}`) - 0.5) * 220,
      size: 56 + Math.floor(random(`sz-${seed}`) * 44),
      rotate: (random(`rt-${seed}`) - 0.5) * 50,
    });
  }
  return spawns;
};

const FloatingEmoji: React.FC<{ spawn: EmojiSpawn; canvasH: number; barH: number }> = ({ spawn, canvasH, barH }) => {
  const frame = useCurrentFrame();
  const t = (frame - spawn.startFrame) / spawn.durationFrames;
  if (t < 0 || t > 1) return null;

  // Float from near phone (low in canvas) up to near top bar, scale 1 → 1.6,
  // fade out at end (matches frontend/wall.html keyframes)
  const startY = canvasH - 220;
  const endY   = barH + 60;
  const y = interpolate(t, [0, 1], [startY, endY], { easing: Easing.out(Easing.cubic) });
  const x = spawn.startX + interpolate(t, [0, 1], [0, spawn.drift], { easing: Easing.inOut(Easing.ease) });
  const scale = interpolate(t, [0, 1], [1, 1.6]);
  const opacity = interpolate(t, [0, 0.7, 1], [1, 1, 0]);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        fontSize: spawn.size,
        transform: `translate(-50%, -50%) scale(${scale}) rotate(${spawn.rotate}deg)`,
        opacity,
        filter: "drop-shadow(0 4px 10px rgba(0,0,0,.45))",
        lineHeight: 1,
        userSelect: "none",
      }}
    >
      {spawn.emoji}
    </div>
  );
};

// ── Wall slide with Ken Burns ────────────────────────────────
const WallSlide: React.FC<{ src: string; local: number }> = ({ src, local }) => {
  const dur = 12 * FPS;
  const scale = interpolate(local, [0, dur], [1, 1.14], { extrapolateRight: "clamp" });
  const tx    = interpolate(local, [0, dur], [0, -2],   { extrapolateRight: "clamp" });
  const ty    = interpolate(local, [0, dur], [0, -1.5], { extrapolateRight: "clamp" });
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

// ── Phone mockup (upload + react UI) ─────────────────────────
const PhoneMockup: React.FC<{ photoSrc: string; pulseFrame: number }> = ({ photoSrc, pulseFrame }) => {
  const frame = useCurrentFrame();
  // Heart button pulses on every emoji spawn cycle (~1.4s)
  const sincePulse = (frame - pulseFrame) % Math.round(1.4 * FPS);
  const pulseScale = interpolate(sincePulse, [0, 6, 14], [1, 1.18, 1], { extrapolateRight: "clamp" });

  const W = 270;
  const H = 540;

  return (
    <div
      style={{
        width: W, height: H,
        background: "#111",
        borderRadius: 36,
        padding: 10,
        boxShadow: "0 30px 80px rgba(0,0,0,.55), 0 12px 28px rgba(0,0,0,.4)",
        transform: "rotate(-4deg)",
      }}
    >
      <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: 28, overflow: "hidden", background: "#000" }}>
        {/* Camera notch */}
        <div style={{
          position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)",
          width: 90, height: 22, background: "#000", borderRadius: 999, zIndex: 5,
        }} />

        {/* Live wall feed inside the phone */}
        <Img
          src={staticFile(photoSrc)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%", height: "100%",
            objectFit: "cover",
          }}
        />
        {/* Vignette */}
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(180deg, rgba(0,0,0,.5) 0%, transparent 18%, transparent 55%, rgba(0,0,0,.95) 100%)",
        }} />

        {/* Top: event name + live dot */}
        <div style={{
          position: "absolute", top: 42, left: 16, right: 16,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          fontFamily: FONT_MONO, fontSize: 9, letterSpacing: ".22em", color: "#fff", textTransform: "uppercase",
        }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: ACCENT_SOFT, boxShadow: "0 0 0 3px rgba(240,163,122,.3)" }} />
            Live wall
          </span>
          <span style={{ opacity: 0.7 }}>Maria &amp; JM</span>
        </div>

        {/* Bottom: upload + react bar */}
        <div style={{
          position: "absolute", bottom: 22, left: 12, right: 12,
          display: "flex", flexDirection: "column", gap: 10,
        }}>
          {/* Upload button row */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            background: "rgba(20,12,10,.7)",
            backdropFilter: "blur(10px)",
            border: "1px solid rgba(255,255,255,.12)",
            borderRadius: 999,
            padding: "8px 10px 8px 14px",
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: 999,
              background: ACCENT,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 14, color: "#fff",
            }}>＋</div>
            <span style={{ fontFamily: FONT_SANS, fontSize: 11, color: "#fff", fontWeight: 500 }}>
              Add a photo
            </span>
            <span style={{ flex: 1 }} />
            <span style={{ fontFamily: FONT_MONO, fontSize: 8, letterSpacing: ".18em", color: "rgba(255,255,255,.55)", textTransform: "uppercase" }}>
              ✓ Sent
            </span>
          </div>

          {/* React row */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-around",
            background: "rgba(20,12,10,.7)",
            backdropFilter: "blur(10px)",
            border: "1px solid rgba(255,255,255,.12)",
            borderRadius: 999,
            padding: "6px 10px",
          }}>
            {EMOJI.slice(0, 6).map((e, i) => {
              const isPulse = i === 0;
              return (
                <div
                  key={i}
                  style={{
                    fontSize: 22,
                    lineHeight: 1,
                    transform: isPulse ? `scale(${pulseScale})` : "scale(1)",
                    transformOrigin: "center",
                    filter: isPulse ? "drop-shadow(0 0 8px rgba(240,163,122,.6))" : "none",
                  }}
                >
                  {e}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Main composition ─────────────────────────────────────────
export const WallReactions: React.FC = () => {
  const frame = useCurrentFrame();
  const BAR_H = 110;
  const CANVAS_W = 1080;
  const CANVAS_H = 1350;

  const idx   = Math.min(Math.floor(frame / SLIDE_FRAMES), PHOTOS.length - 1);
  const prev  = (idx - 1 + PHOTOS.length) % PHOTOS.length;
  const local = frame - idx * SLIDE_FRAMES;

  const FADE = Math.round(1.4 * FPS);
  const xfade = interpolate(local, [0, FADE], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.ease),
  });

  const capFade = Math.round(0.5 * FPS);
  const captionOpacity = interpolate(local, [0, capFade], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const titleOpacity   = interpolate(frame, [0, FPS], [0, 1], { extrapolateRight: "clamp" });

  // Reaction counter ticks up faster than the demo wall (more activity)
  const reactionCount = 124 + Math.floor(frame / 4);

  const spawns = buildSpawns(70, CANVAS_W, TOTAL_FRAMES);

  return (
    <AbsoluteFill style={{ background: "#1a0f0a" }}>
      <Audio src={staticFile("ceremony.mp3")} volume={0.75} />

      {/* Sticky top bar */}
      <div
        style={{
          position: "absolute", top: 0, left: 0, right: 0, height: BAR_H,
          background: "linear-gradient(180deg, #1a0f0a 0%, #2a1a14 100%)",
          borderBottom: `2px solid ${ACCENT_SOFT}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "0 36px", zIndex: 30, opacity: titleOpacity,
        }}
      >
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 32, fontStyle: "italic", color: "#fff", letterSpacing: "-.01em", textAlign: "center", lineHeight: 1.15 }}>
          Tap to react. <span style={{ color: ACCENT_SOFT }}>Watch the wall light up.</span>
        </div>
      </div>

      {/* Wall area */}
      <div style={{ position: "absolute", top: BAR_H, left: 0, right: 0, bottom: 0, overflow: "hidden" }}>
        {/* Previous slide backdrop */}
        {frame >= SLIDE_FRAMES && (
          <div style={{ position: "absolute", inset: 0 }}>
            <WallSlide src={PHOTOS[prev]} local={local + SLIDE_FRAMES} />
          </div>
        )}
        {/* Current slide fading in */}
        <div style={{ position: "absolute", inset: 0, opacity: frame < SLIDE_FRAMES ? 1 : xfade }}>
          <WallSlide src={PHOTOS[idx]} local={local} />
        </div>

        {/* Vignette */}
        <div style={{
          position: "absolute", inset: 0,
          background:
            "radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,.55) 100%), " +
            "linear-gradient(180deg, rgba(0,0,0,.4) 0%, transparent 18%, transparent 55%, rgba(0,0,0,.85) 100%)",
        }} />

        {/* Reaction counter — top-right */}
        <div style={{
          position: "absolute", top: 26, right: 26,
          display: "flex", alignItems: "center", gap: 10,
          background: "rgba(0,0,0,.5)",
          backdropFilter: "blur(8px)",
          border: "1px solid rgba(255,255,255,.14)",
          padding: "10px 18px",
          borderRadius: 999,
          zIndex: 10,
        }}>
          <span style={{ fontSize: 22, lineHeight: 1 }}>💗</span>
          <span style={{ fontFamily: FONT_MONO, fontSize: 16, fontWeight: 600, color: "#fff", letterSpacing: ".06em" }}>
            {reactionCount.toLocaleString()}
          </span>
          <span style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: ".22em", color: ACCENT_SOFT, textTransform: "uppercase" }}>
            reactions
          </span>
        </div>

        {/* Quote caption — bottom-left */}
        <div style={{
          position: "absolute", bottom: 36, left: 32, right: 360,
          opacity: captionOpacity, zIndex: 4,
        }}>
          <div style={{
            fontFamily: FONT_DISPLAY, fontStyle: "italic", fontSize: 38,
            color: "#fff", lineHeight: 1.1, letterSpacing: "-.01em",
            textShadow: "0 2px 12px rgba(0,0,0,.8), 0 8px 32px rgba(0,0,0,.6)",
          }}>
            {QUOTES[idx]}
          </div>
        </div>

        {/* Floating emoji layer */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          {spawns.map((s) => (
            <FloatingEmoji key={s.id} spawn={s} canvasH={CANVAS_H} barH={BAR_H} />
          ))}
        </div>

        {/* Phone mockup — bottom-right */}
        <div style={{ position: "absolute", bottom: 30, right: 24, zIndex: 5 }}>
          <PhoneMockup photoSrc={PHOTOS[idx]} pulseFrame={0} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
