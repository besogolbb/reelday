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
export const SLIDE_FRAMES = Math.round(6.5 * FPS); // 195 — matches DURATION 6500ms

export const SLIDES = [
  { img: "01-first-dance.png",   uploader: "— Tita Marivic · 8:42 pm",  quote: "“First dance after 38 years — still got it.”" },
  { img: "02-whole-family.png",  uploader: "— Kuya Mike · 9:01 pm",     quote: "“The whole family finally in one frame.”" },
  { img: "03-garden-hour.png",   uploader: "— Ate Karen · 9:18 pm",     quote: "“Garden hour. No filter needed.”" },
  { img: "04-best-night.png",    uploader: "— Kuya Vince · 9:35 pm",    quote: "“Best night of the year, hands down.”" },
  { img: "05-first-kiss.png",    uploader: "— JM · 9:52 pm",            quote: "“The moment everyone was waiting for.”" },
  { img: "06-dancing-tatay.png", uploader: "— Andrea · 10:08 pm",       quote: "“Dancing with Tatay. I will never forget this.”" },
];

const FONT_DISPLAY = "'Fraunces', 'Playfair Display', Georgia, serif";
const FONT_MONO    = "'JetBrains Mono', ui-monospace, monospace";
const ACCENT_SOFT  = "#f0a37a";

// Per-slide kenburns: scale 1 → 1.14, drift (-2%, -1.5%) over 14s
const Slide: React.FC<{ src: string; local: number }> = ({ src, local }) => {
  const dur14s = 14 * FPS;
  const scale  = interpolate(local, [0, dur14s], [1, 1.14], { extrapolateRight: "clamp" });
  const tx     = interpolate(local, [0, dur14s], [0, -2],   { extrapolateRight: "clamp" });
  const ty     = interpolate(local, [0, dur14s], [0, -1.5], { extrapolateRight: "clamp" });
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

export const DemoWall: React.FC = () => {
  const frame = useCurrentFrame();
  const idx   = Math.min(Math.floor(frame / SLIDE_FRAMES), SLIDES.length - 1);
  const prev  = (idx - 1 + SLIDES.length) % SLIDES.length;
  const local = frame - idx * SLIDE_FRAMES;

  // 1.6s crossfade in
  const FADE = Math.round(1.6 * FPS);
  const xfade = interpolate(local, [0, FADE], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.ease),
  });

  // Caption fade: out in last .5s of prev slide, back in .5s into new one
  const CAP_FADE = Math.round(0.5 * FPS);
  const captionOpacity = interpolate(local, [0, CAP_FADE], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Title fade-in over first 1s
  const titleOpacity = interpolate(frame, [0, FPS], [0, 1], { extrapolateRight: "clamp" });

  // Progress bar (per slide)
  const progress = (local / SLIDE_FRAMES) * 100;

  // "Moments" counter ticks up slowly
  const moments = 247 + Math.floor(frame / (FPS * 2));

  const cur  = SLIDES[idx];
  const back = SLIDES[prev];

  const BAR_H = 120; // sticky top caption bar height

  return (
    <AbsoluteFill style={{ background: "#1a0f0a" }}>
      <Audio src={staticFile("ceremony.mp3")} volume={0.8} />

      {/* ── Sticky top bar — full width, sits above the wall, never blocks it ── */}
      <div
        style={{
          position: "absolute",
          top: 0, left: 0, right: 0,
          height: BAR_H,
          background: "linear-gradient(180deg, #1a0f0a 0%, #2a1a14 100%)",
          borderBottom: `2px solid ${ACCENT_SOFT}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 48px",
          zIndex: 20,
          opacity: titleOpacity,
        }}
      >
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 46,
            fontStyle: "italic",
            fontWeight: 400,
            color: "#fff",
            letterSpacing: "-.01em",
            textAlign: "center",
            lineHeight: 1.1,
          }}
        >
          Introducing <span style={{ color: ACCENT_SOFT, fontWeight: 500 }}>Reelday.ph</span>
          <span style={{ opacity: .55 }}>  —  </span>
          live photo wall for Filipino celebrations.
        </div>
      </div>

      {/* ── Wall area (everything below the bar) ─────────────── */}
      <div style={{ position: "absolute", top: BAR_H, left: 0, right: 0, bottom: 0, overflow: "hidden" }}>
        {/* Previous slide as backdrop (so crossfades read) */}
        {frame >= SLIDE_FRAMES && (
          <div style={{ position: "absolute", inset: 0 }}>
            <Slide src={back.img} local={local + SLIDE_FRAMES} />
          </div>
        )}

        {/* Current slide fading in */}
        <div style={{ position: "absolute", inset: 0, opacity: frame < SLIDE_FRAMES ? 1 : xfade }}>
          <Slide src={cur.img} local={local} />
        </div>

        {/* Vignette */}
        <div
          style={{
            position: "absolute", inset: 0,
            background:
              "radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,.55) 100%), " +
              "linear-gradient(180deg, rgba(0,0,0,.55) 0%, transparent 25%, transparent 45%, rgba(0,0,0,.92) 100%)",
          }}
        />

        {/* LIVE + stats ticker (on the wall, unchanged) */}
        <div
          style={{
            position: "absolute",
            top: 0, left: 0, right: 0,
            height: 84,
            background: "linear-gradient(180deg, rgba(0,0,0,.55), transparent)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "0 48px",
            zIndex: 5,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, fontFamily: FONT_MONO, fontSize: 18, letterSpacing: ".18em", textTransform: "uppercase", color: "rgba(255,255,255,.9)" }}>
            <div style={{ width: 13, height: 13, borderRadius: "50%", background: ACCENT_SOFT, boxShadow: "0 0 0 5px rgba(240,163,122,.3)" }} />
            Live now
          </div>
          <div style={{ display: "flex", gap: 32, fontFamily: FONT_MONO, fontSize: 18, letterSpacing: ".14em", textTransform: "uppercase", color: "rgba(255,255,255,.55)" }}>
            <span><em style={{ color: ACCENT_SOFT, fontStyle: "normal" }}>{moments}</em>&nbsp; moments</span>
            <span><em style={{ color: ACCENT_SOFT, fontStyle: "normal" }}>42</em>&nbsp; guests</span>
          </div>
        </div>

      {/* Bottom caption — uploader + quote */}
      <div
        style={{
          position: "absolute",
          bottom: 0, left: 0, right: 0,
          padding: "0 56px 56px",
          display: "flex", justifyContent: "space-between", alignItems: "flex-end",
          gap: 32,
          zIndex: 5,
        }}
      >
        <div style={{ maxWidth: "62%", opacity: captionOpacity }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: 18, letterSpacing: ".18em", textTransform: "uppercase", color: "rgba(255,255,255,.78)", marginBottom: 18 }}>
            {cur.uploader}
          </div>
          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontStyle: "italic",
              fontWeight: 400,
              fontSize: 60,
              lineHeight: 1.1,
              letterSpacing: "-.01em",
              color: "#fff",
              textShadow: "0 2px 12px rgba(0,0,0,.8), 0 8px 32px rgba(0,0,0,.6)",
            }}
          >
            {cur.quote}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontStyle: "italic", fontSize: 54, color: "rgba(255,255,255,.92)", marginBottom: 10, letterSpacing: "-.01em" }}>
            Maria &amp; Jaime
          </div>
          <div style={{ fontFamily: FONT_MONO, fontSize: 22, letterSpacing: ".18em", textTransform: "uppercase", color: "rgba(255,255,255,.55)" }}>
            Wedding · Tagaytay
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 4, background: "rgba(255,255,255,.08)", zIndex: 6 }}>
        <div style={{ width: `${progress}%`, height: "100%", background: ACCENT_SOFT }} />
      </div>
      </div>
    </AbsoluteFill>
  );
};
