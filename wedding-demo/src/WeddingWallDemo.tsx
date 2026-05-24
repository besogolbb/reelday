import React from "react";
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Video,
  staticFile,
  OffthreadVideo,
} from "remotion";

// ── Timeline (frames @ 30fps) ─────────────────────────────────────────────────
//  Clip 1  Establishing shot       0  → 120  (4s)
//  Clip 2  Guest discovers         120 → 240  (4s)
//  Clip 3  Close-up phone upload   240 → 390  (5s)  ← capcut1 composited
//  Clip 4  Couple reacts           390 → 480  (3s)
//  Clip 5  Wall reveal             480 → 720  (8s)  ← capcut2 composited
//  Clip 6  CTA celebration         720 → 840  (4s)
const C1 = 0,   D1 = 120;
const C2 = 120, D2 = 120;
const C3 = 240, D3 = 150;
const C4 = 390, D4 = 90;
const C5 = 480, D5 = 240;
const C6 = 720, D6 = 120;
const TOTAL = 840;

// ── Palette ───────────────────────────────────────────────────────────────────
const GOLD = "#C9A84C";
const CREAM = "#FDF6EC";
const BLUSH = "#F2D5C8";
const DARK = "#1A0E08";
const SAGE = "#8A9E7C";
const NEON_PINK = "#FF2D78";
const TT_WHITE = "#FFFFFF";

// ── Placeholder fill shown until an AI clip file is dropped in ────────────────
const CLIPS: Record<string, boolean> = {
  "ai_clip1.mp4": false,
  "ai_clip2.mp4": false,
  "ai_clip3.mp4": false,
  "ai_clip4.mp4": false,
  "ai_clip5.mp4": false,
  "ai_clip6.mp4": false,
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const FairyLights: React.FC<{ count?: number; opacity?: number }> = ({ count = 30, opacity = 1 }) => (
  <>
    {[...Array(count)].map((_, i) => {
      const size = 3 + (i % 5) * 3;
      return (
        <div key={i} style={{
          position: "absolute",
          width: size, height: size, borderRadius: "50%",
          background: i % 4 === 0 ? BLUSH : i % 3 === 0 ? GOLD : CREAM,
          opacity: (0.1 + (i % 6) * 0.05) * opacity,
          left: `${(i * 11 + 3) % 92}%`,
          top: `${(i * 7 + 5) % 90}%`,
          filter: `blur(${2 + (i % 4)}px)`,
          boxShadow: `0 0 ${size * 2}px ${size}px ${i % 4 === 0 ? BLUSH : GOLD}33`,
        }} />
      );
    })}
  </>
);

const FloralCorner: React.FC<{ style?: React.CSSProperties }> = ({ style }) => (
  <svg width="160" height="160" viewBox="0 0 180 180" style={{ position: "absolute", opacity: 0.45, ...style }} fill="none">
    <path d="M10 170 Q30 120 80 80 Q120 40 170 10" stroke={GOLD} strokeWidth="1.5" />
    <ellipse cx="55" cy="105" rx="22" ry="10" transform="rotate(-40 55 105)" fill={SAGE} opacity="0.6" />
    <ellipse cx="95" cy="65" rx="20" ry="9" transform="rotate(-50 95 65)" fill={SAGE} opacity="0.5" />
    {[{ cx: 40, cy: 130, r: 10 }, { cx: 80, cy: 88, r: 12 }, { cx: 128, cy: 46, r: 9 }].map((f, i) => (
      <g key={i}>
        {[0, 72, 144, 216, 288].map((deg) => (
          <ellipse key={deg}
            cx={f.cx + Math.cos(deg * Math.PI / 180) * (f.r * 0.7)}
            cy={f.cy + Math.sin(deg * Math.PI / 180) * (f.r * 0.7)}
            rx={f.r * 0.55} ry={f.r * 0.35}
            transform={`rotate(${deg} ${f.cx + Math.cos(deg * Math.PI / 180) * (f.r * 0.7)} ${f.cy + Math.sin(deg * Math.PI / 180) * (f.r * 0.7)})`}
            fill={i % 2 === 0 ? BLUSH : CREAM} opacity="0.85"
          />
        ))}
        <circle cx={f.cx} cy={f.cy} r={f.r * 0.3} fill={GOLD} opacity="0.9" />
      </g>
    ))}
  </svg>
);

/** Bold TikTok caption with thick stroke */
const Cap: React.FC<{ text: string; size?: number; color?: string; stroke?: string; sw?: number; style?: React.CSSProperties }> = ({
  text, size = 52, color = TT_WHITE, stroke = DARK, sw = 8, style,
}) => (
  <div style={{
    fontFamily: "'Arial Black', Impact, sans-serif",
    fontWeight: 900, fontSize: size, color,
    textAlign: "center", lineHeight: 1.15,
    WebkitTextStroke: `${sw}px ${stroke}`,
    paintOrder: "stroke fill",
    textShadow: "0 4px 20px rgba(0,0,0,0.7)",
    ...style,
  }}>{text}</div>
);

/** Clip background — uses AI file when available, else shows cinematic placeholder */
const ClipBg: React.FC<{ file: string; label: string; startFrom?: number }> = ({ file, label, startFrom = 0 }) => {
  const ready = CLIPS[file];
  if (ready) {
    return (
      <AbsoluteFill>
        <OffthreadVideo src={staticFile(file)} startFrom={startFrom} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{
      background: "linear-gradient(160deg, #2a1506 0%, #1a0e06 60%, #0d0804 100%)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <FairyLights count={40} opacity={0.6} />
      <div style={{
        border: `2px dashed ${GOLD}55`,
        borderRadius: 20,
        padding: "32px 48px",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
        background: `${GOLD}08`,
      }}>
        <div style={{ fontSize: 48 }}>🎬</div>
        <div style={{ fontFamily: "sans-serif", fontWeight: 700, fontSize: 18, color: GOLD, textAlign: "center", letterSpacing: 1 }}>
          DROP AI CLIP HERE
        </div>
        <div style={{ fontFamily: "sans-serif", fontSize: 14, color: `${CREAM}66`, textAlign: "center" }}>
          {file}
        </div>
        <div style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 13, color: `${CREAM}44`, textAlign: "center", maxWidth: 300 }}>
          {label}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** Vignette overlay */
const Vignette: React.FC = () => (
  <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)", pointerEvents: "none" }} />
);

/** TikTok right sidebar */
const Sidebar: React.FC<{ opacity?: number }> = ({ opacity = 1 }) => (
  <div style={{
    position: "absolute", right: 22, bottom: 230,
    display: "flex", flexDirection: "column", alignItems: "center", gap: 26,
    opacity, zIndex: 50,
  }}>
    <div style={{ position: "relative" }}>
      <div style={{
        width: 54, height: 54, borderRadius: "50%",
        background: `linear-gradient(135deg, ${GOLD}, ${BLUSH})`,
        border: `2px solid ${TT_WHITE}`,
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22,
      }}>💒</div>
      <div style={{
        position: "absolute", bottom: -10, left: "50%", transform: "translateX(-50%)",
        width: 20, height: 20, borderRadius: "50%",
        background: NEON_PINK, border: `2px solid ${TT_WHITE}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, color: TT_WHITE, fontWeight: 900,
      }}>+</div>
    </div>
    {[{ icon: "❤️", count: "248K" }, { icon: "💬", count: "3.2K" }, { icon: "➡️", count: "Share" }].map((item) => (
      <div key={item.icon} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
        <div style={{ fontSize: 36 }}>{item.icon}</div>
        <span style={{ fontFamily: "sans-serif", fontSize: 12, color: TT_WHITE, fontWeight: 700 }}>{item.count}</span>
      </div>
    ))}
    <div style={{
      width: 46, height: 46, borderRadius: "50%",
      background: `conic-gradient(${GOLD}, #3a1f0c, ${GOLD})`,
      border: "3px solid #333",
      display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
    }}>🎵</div>
  </div>
);

/** TikTok bottom username / caption / hashtags strip */
const BottomStrip: React.FC<{ caption: string; opacity?: number }> = ({ caption, opacity = 1 }) => (
  <div style={{
    position: "absolute", bottom: 55, left: 22, right: 110,
    display: "flex", flexDirection: "column", gap: 6,
    opacity, zIndex: 50,
  }}>
    <span style={{ fontFamily: "sans-serif", fontWeight: 800, fontSize: 17, color: TT_WHITE, textShadow: "0 1px 6px rgba(0,0,0,0.9)" }}>
      @reelday.ph
    </span>
    <span style={{ fontFamily: "sans-serif", fontSize: 15, color: TT_WHITE, textShadow: "0 1px 6px rgba(0,0,0,0.9)", lineHeight: 1.4 }}>
      {caption}
    </span>
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 13 }}>🎵</span>
      <span style={{ fontFamily: "sans-serif", fontSize: 13, color: TT_WHITE, opacity: 0.8 }}>Original sound — reelday.ph</span>
    </div>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {["#filipinowedding", "#reeldaywedding", "#weddingwall", "#weddingph"].map((t) => (
        <span key={t} style={{ fontFamily: "sans-serif", fontSize: 14, color: TT_WHITE, fontWeight: 700, opacity: 0.9 }}>{t}</span>
      ))}
    </div>
  </div>
);

/** Global progress bar */
const ProgressBar: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "rgba(255,255,255,0.2)", zIndex: 999 }}>
      <div style={{ width: `${interpolate(frame, [0, TOTAL], [0, 100])}%`, height: "100%", background: TT_WHITE }} />
    </div>
  );
};

/** Floating emoji drifts upward */
const Emoji: React.FC<{ e: string; frame: number; at: number; x: number; fps: number }> = ({ e, frame, at, x, fps }) => {
  const f = Math.max(0, frame - at);
  if (f > 70) return null;
  const op = interpolate(f, [0, 8, 55, 70], [0, 1, 1, 0]);
  const y = interpolate(f, [0, 70], [0, -150]);
  const sc = spring({ frame: f, fps, config: { damping: 8, stiffness: 200 } });
  return <div style={{ position: "absolute", left: x, bottom: 320, fontSize: 44, transform: `translateY(${y}px) scale(${sc})`, opacity: op, pointerEvents: "none", zIndex: 60 }}>{e}</div>;
};

/** Cross-scene fade transition */
const FadeBetween: React.FC<{ children: React.ReactNode; enter?: number; exit?: number; duration: number }> = ({
  children, enter = 15, exit = 15, duration,
}) => {
  const frame = useCurrentFrame();
  const op = interpolate(frame, [0, enter, duration - exit, duration], [0, 1, 1, 0]);
  return <AbsoluteFill style={{ opacity: op }}>{children}</AbsoluteFill>;
};

// ─────────────────────────────────────────────────────────────────────────────
// CLIP 1 — Establishing venue shot
// ─────────────────────────────────────────────────────────────────────────────
const Clip1: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 22, stiffness: 70 } });

  return (
    <FadeBetween duration={D1}>
      <ClipBg file="ai_clip1.mp4" label="Cinematic establishing shot of Filipino wedding reception hall — fairy lights, floral arches, golden guests" />
      <Vignette />
      <FloralCorner style={{ top: 0, left: 0 }} />
      <FloralCorner style={{ top: 0, right: 0, transform: "scaleX(-1)" }} />

      {/* POV opener */}
      <div style={{
        position: "absolute", top: 180, left: 0, right: 0,
        display: "flex", flexDirection: "column", alignItems: "center", gap: 14,
        opacity: interpolate(enter, [0, 1], [0, 1]),
        transform: `translateY(${interpolate(enter, [0, 1], [-30, 0])}px)`,
      }}>
        <div style={{
          background: NEON_PINK, borderRadius: 10,
          padding: "10px 32px",
          fontFamily: "'Arial Black', sans-serif", fontWeight: 900, fontSize: 24,
          color: TT_WHITE, letterSpacing: 3, textTransform: "uppercase",
          boxShadow: `0 0 30px ${NEON_PINK}88`,
        }}>POV 👀</div>
        <Cap text="You're at a Filipino" size={56} color={CREAM} sw={6} />
        <Cap text="Wedding Reception 💒" size={60} color={GOLD} sw={7} />
      </div>

      <div style={{
        position: "absolute", bottom: 260, left: 0, right: 0,
        display: "flex", justifyContent: "center",
        opacity: interpolate(frame, [60, 80], [0, 1], { extrapolateRight: "clamp" }),
      }}>
        <div style={{
          background: `${GOLD}22`, border: `1.5px solid ${GOLD}`,
          borderRadius: 20, padding: "10px 28px",
          fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 22, color: CREAM,
          textShadow: "0 2px 10px rgba(0,0,0,0.9)",
        }}>
          "...and the couple is using something AMAZING" 🤯
        </div>
      </div>

      <BottomStrip caption="Wait until you see what this wedding has 👀🔥" opacity={interpolate(frame, [40, 65], [0, 1], { extrapolateRight: "clamp" })} />
    </FadeBetween>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// CLIP 2 — Guest discovers the Wall feature on her phone
// ─────────────────────────────────────────────────────────────────────────────
const Clip2: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 20, stiffness: 75 } });
  const textEnter = spring({ frame: Math.max(0, frame - 14), fps, config: { damping: 18, stiffness: 70 } });

  return (
    <FadeBetween duration={D2}>
      <ClipBg file="ai_clip2.mp4" label="Over-the-shoulder: Filipina guest in sage gown holds iPhone at reception, opens Reelday app" />
      <Vignette />

      <div style={{
        position: "absolute", top: 160, left: 0, right: 0,
        display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
        opacity: interpolate(enter, [0, 1], [0, 1]),
        transform: `scale(${interpolate(enter, [0, 1], [0.9, 1])}) translateY(${interpolate(enter, [0, 1], [-24, 0])}px)`,
      }}>
        <Cap text="📸 A guest just snapped" size={48} color={TT_WHITE} sw={7} />
        <Cap text="the PERFECT shot" size={56} color={GOLD} sw={7} />
      </div>

      <div style={{
        position: "absolute", top: 380, left: 0, right: 0,
        display: "flex", justifyContent: "center",
        opacity: interpolate(textEnter, [0, 1], [0, 1]),
        transform: `translateY(${interpolate(textEnter, [0, 1], [20, 0])}px)`,
      }}>
        <div style={{
          background: `${NEON_PINK}22`, border: `2px solid ${NEON_PINK}`,
          borderRadius: 28, padding: "10px 32px",
          fontFamily: "sans-serif", fontWeight: 800, fontSize: 20, color: NEON_PINK,
        }}>
          Now she's uploading it to the Wall →
        </div>
      </div>

      <Emoji e="📸" frame={frame} at={20} x={80} fps={fps} />
      <Emoji e="✨" frame={frame} at={40} x={680} fps={fps} />
      <Sidebar opacity={0.85} />
      <BottomStrip caption="Guests can share moments directly to the Wall 📲" opacity={interpolate(frame, [30, 55], [0, 1], { extrapolateRight: "clamp" })} />
    </FadeBetween>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// CLIP 3 — Close-up phone upload (capcut1.mp4 composited on screen)
// ─────────────────────────────────────────────────────────────────────────────
const Clip3: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const floatY = interpolate(Math.sin((frame / 55) * Math.PI * 2), [-1, 1], [-5, 5]);
  const badgeIn = interpolate(frame, [45, 65], [0, 1], { extrapolateRight: "clamp" });
  const enter = spring({ frame, fps, config: { damping: 20, stiffness: 70 } });

  return (
    <FadeBetween duration={D3}>
      <ClipBg file="ai_clip3.mp4" label="Extreme close-up of hands holding iPhone at wedding — fingers tap upload button, warm bokeh" />
      <Vignette />

      {/* Phone screen composite — centered over the AI shot */}
      <div style={{
        position: "absolute",
        top: "50%", left: "50%",
        transform: `translate(-50%, -50%) scale(${interpolate(enter, [0, 1], [0.9, 1])}) translateY(${floatY}px)`,
        width: 290, height: 580,
        borderRadius: 40,
        background: "#0d0d0d",
        border: "3px solid #2a2a2a",
        boxShadow: `0 40px 100px rgba(0,0,0,0.8), 0 0 60px ${GOLD}22`,
        overflow: "hidden",
        display: "flex", flexDirection: "column",
      }}>
        <div style={{ width: "100%", height: 32, background: "#0d0d0d", display: "flex", justifyContent: "center", alignItems: "center", flexShrink: 0 }}>
          <div style={{ width: 100, height: 26, borderRadius: 18, background: "#000", border: "1px solid #1a1a1a" }} />
        </div>
        <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
          <Video src={staticFile("capcut1.mp4")} style={{ width: "100%", height: "100%", objectFit: "cover" }} startFrom={0} volume={0} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, rgba(255,255,255,0.05) 0%, transparent 50%)", pointerEvents: "none" }} />
        </div>
        <div style={{ width: "100%", height: 24, background: "#0d0d0d", display: "flex", justifyContent: "center", alignItems: "center", flexShrink: 0 }}>
          <div style={{ width: 110, height: 4, borderRadius: 2, background: "#2a2a2a" }} />
        </div>
      </div>

      {/* Top label */}
      <div style={{
        position: "absolute", top: 150, left: 0, right: 0,
        display: "flex", justifyContent: "center",
        opacity: interpolate(enter, [0, 1], [0, 1]),
        transform: `translateY(${interpolate(enter, [0, 1], [-20, 0])}px)`,
      }}>
        <Cap text="Step 1 — Open Reelday 📲" size={40} color={TT_WHITE} sw={6} />
      </div>

      {/* Upload badge */}
      <div style={{
        position: "absolute", bottom: 235, left: 0, right: 0,
        display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
        opacity: badgeIn,
        transform: `translateY(${interpolate(badgeIn, [0, 1], [20, 0])}px)`,
      }}>
        <div style={{
          background: `${GOLD}22`, border: `2px solid ${GOLD}`,
          borderRadius: 30, padding: "12px 36px",
          display: "flex", alignItems: "center", gap: 10,
          boxShadow: `0 0 30px ${GOLD}44`,
        }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: GOLD, opacity: frame % 20 < 10 ? 1 : 0.3 }} />
          <span style={{ fontFamily: "'Arial Black', sans-serif", fontWeight: 900, fontSize: 17, color: GOLD }}>
            Uploading to Wall...
          </span>
        </div>
        <Cap text="It's that easy! 🤯" size={40} color={TT_WHITE} sw={6} />
      </div>

      <Emoji e="🔥" frame={frame} at={55} x={90} fps={fps} />
      <Emoji e="💍" frame={frame} at={80} x={660} fps={fps} />
      <Sidebar opacity={0.85} />
      <BottomStrip caption="One tap → appears live on the Wedding Wall ✨" opacity={badgeIn} />
    </FadeBetween>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// CLIP 4 — Couple reacts / "Wait for it" moment
// ─────────────────────────────────────────────────────────────────────────────
const Clip4: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const bounce = spring({ frame, fps, config: { damping: 8, stiffness: 200 } });
  const sub = spring({ frame: Math.max(0, frame - 18), fps, config: { damping: 12, stiffness: 150 } });

  return (
    <FadeBetween duration={D4} enter={10} exit={10}>
      <ClipBg file="ai_clip4.mp4" label="Filipino bride and groom look across room amazed — wide eyes, big smiles, fairy lights bokeh" />
      <Vignette />

      <div style={{
        position: "absolute", top: "50%", left: 0, right: 0,
        transform: `translateY(-50%)`,
        display: "flex", flexDirection: "column", alignItems: "center", gap: 20,
      }}>
        <div style={{ fontSize: 80, transform: `scale(${bounce})` }}>👀</div>
        <Cap text="WAIT FOR IT..." size={76} color={TT_WHITE} sw={9} style={{ transform: `scale(${bounce})` }} />
        <div style={{ opacity: interpolate(sub, [0, 1], [0, 1]), transform: `scale(${sub})`, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <div style={{ width: 300, height: 2, background: `linear-gradient(to right, transparent, ${GOLD}, transparent)` }} />
          <Cap text="The photo just went LIVE 🎊" size={44} color={GOLD} sw={6} />
        </div>
      </div>

      {/* Countdown dots */}
      <div style={{
        position: "absolute", bottom: 270, left: 0, right: 0,
        display: "flex", justifyContent: "center", gap: 14,
        opacity: interpolate(frame, [20, 38], [0, 1], { extrapolateRight: "clamp" }),
      }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{
            width: 16, height: 16, borderRadius: "50%",
            background: frame > 30 + i * 12 ? GOLD : `${GOLD}33`,
          }} />
        ))}
      </div>

      <BottomStrip caption="The couple's reaction says it all 😍💒" opacity={0.9} />
    </FadeBetween>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// CLIP 5 — Wall reveal (capcut2.mp4 composited on TV screen)
// ─────────────────────────────────────────────────────────────────────────────
const Clip5: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 22, stiffness: 55 } });
  const endFade = interpolate(frame, [200, 240], [1, 0], { extrapolateLeft: "clamp" });
  const floatY = interpolate(Math.sin((frame / 80) * Math.PI * 2), [-1, 1], [-4, 4]);
  const liveBlink = frame % 30 < 15;
  const ctaIn = spring({ frame: Math.max(0, frame - 100), fps, config: { damping: 18, stiffness: 65 } });

  const tvScale = interpolate(enter, [0, 1], [0.88, 1]);
  const tvY = interpolate(enter, [0, 1], [60, 0]);

  return (
    <FadeBetween duration={D5} exit={20}>
      <ClipBg file="ai_clip5.mp4" label="Camera pulls back to reveal large LED wall display in wedding venue — fairy lights frame the screen, guests look up" />
      <Vignette />
      <FloralCorner style={{ bottom: 0, left: 0, transform: "rotate(180deg) scaleX(-1)" }} />
      <FloralCorner style={{ bottom: 0, right: 0, transform: "rotate(180deg)" }} />

      {/* Top headline */}
      <div style={{
        position: "absolute", top: 120, left: 0, right: 0,
        display: "flex", flexDirection: "column", alignItems: "center", gap: 14,
        opacity: interpolate(enter, [0, 1], [0, 1]) * endFade,
        transform: `translateY(${interpolate(enter, [0, 1], [-28, 0])}px)`,
      }}>
        {/* LIVE badge */}
        <div style={{
          background: "#cc2222", borderRadius: 8,
          padding: "6px 22px", display: "flex", alignItems: "center", gap: 8,
          boxShadow: "0 0 20px rgba(204,34,34,0.7)",
        }}>
          <div style={{ width: 9, height: 9, borderRadius: "50%", background: TT_WHITE, opacity: liveBlink ? 1 : 0.15 }} />
          <span style={{ fontFamily: "'Arial Black', sans-serif", fontWeight: 900, fontSize: 16, color: TT_WHITE, letterSpacing: 5 }}>LIVE</span>
        </div>
        <Cap text="🔥 IT'S ON THE WALL!" size={64} color={TT_WHITE} sw={8} />
        <Cap text="Real-time. No delay. 🤯" size={44} color={GOLD} sw={6} />
      </div>

      {/* TV / Wall display composite */}
      <div style={{
        position: "absolute", top: "50%", left: "50%",
        transform: `translate(-50%, -46%) scale(${tvScale}) translateY(${tvY + floatY}px)`,
        width: 820, height: 461,
        background: "#050301", borderRadius: 16,
        border: "8px solid #1a1208",
        boxShadow: `0 80px 160px rgba(0,0,0,0.95), 0 0 0 2px #2a1e0e, 0 0 100px ${GOLD}22`,
        overflow: "hidden",
      }}>
        <Video src={staticFile("capcut2.mp4")} style={{ width: "100%", height: "100%", objectFit: "cover" }} startFrom={0} volume={0} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, rgba(255,255,255,0.04) 0%, transparent 45%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,0.35) 100%)", pointerEvents: "none" }} />
      </div>

      {/* TV stand */}
      <div style={{
        position: "absolute", top: "50%", left: "50%",
        width: 90, height: 65,
        transform: `translate(-50%, calc(-46% + ${461 / 2 + 8}px)) scale(${tvScale}) translateY(${tvY + floatY}px)`,
        background: "linear-gradient(to bottom, #1a1208, #0d0804)",
        borderRadius: "0 0 10px 10px",
      }} />
      <div style={{
        position: "absolute", top: "50%", left: "50%",
        width: 200, height: 12,
        transform: `translate(-50%, calc(-46% + ${461 / 2 + 8 + 65}px)) scale(${tvScale}) translateY(${tvY + floatY}px)`,
        background: "#0d0804", borderRadius: 4,
      }} />

      {/* CTA block */}
      <div style={{
        position: "absolute", bottom: 225, left: 0, right: 110,
        display: "flex", flexDirection: "column", alignItems: "center", gap: 14,
        opacity: interpolate(ctaIn, [0, 1], [0, 1]) * endFade,
        transform: `translateY(${interpolate(ctaIn, [0, 1], [30, 0])}px)`,
      }}>
        <div style={{ display: "flex", gap: 8, fontSize: 34 }}>
          {["😍", "🥹", "💒", "🎊", "✨"].map((e, i) => (
            <span key={i} style={{ opacity: frame > 105 + i * 10 ? 1 : 0 }}>{e}</span>
          ))}
        </div>
        <div style={{
          background: `linear-gradient(135deg, ${NEON_PINK}, #ff6b35)`,
          borderRadius: 18, padding: "16px 44px",
          fontFamily: "'Arial Black', sans-serif", fontWeight: 900,
          fontSize: 26, color: TT_WHITE, textAlign: "center",
          boxShadow: `0 0 40px ${NEON_PINK}77`,
        }}>
          Want this at YOUR wedding? 💍
        </div>
        <div style={{ fontFamily: "sans-serif", fontWeight: 800, fontSize: 20, color: TT_WHITE, opacity: 0.9 }}>
          ⬇️ Link in bio · reelday.ph ⬇️
        </div>
      </div>

      <Emoji e="🔥" frame={frame} at={12} x={80} fps={fps} />
      <Emoji e="😍" frame={frame} at={28} x={680} fps={fps} />
      <Emoji e="💒" frame={frame} at={110} x={110} fps={fps} />
      <Emoji e="🎊" frame={frame} at={145} x={640} fps={fps} />
      <Sidebar opacity={endFade} />
      <BottomStrip caption="Drop a 💍 if you want Reelday Wall at your wedding!" opacity={interpolate(frame, [15, 40], [0, 1], { extrapolateRight: "clamp" }) * endFade} />
    </FadeBetween>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// CLIP 6 — CTA / celebration outro
// ─────────────────────────────────────────────────────────────────────────────
const Clip6: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 20, stiffness: 70 } });

  return (
    <FadeBetween duration={D6} enter={12}>
      <ClipBg file="ai_clip6.mp4" label="Wide reception: guests clapping, phones raised, bride and groom at center, confetti, fairy lights glow" />
      <Vignette />
      <FloralCorner style={{ top: 0, left: 0 }} />
      <FloralCorner style={{ top: 0, right: 0, transform: "scaleX(-1)" }} />

      {/* Big brand sign-off */}
      <div style={{
        position: "absolute", top: 0, bottom: 0, left: 0, right: 0,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 20,
        opacity: interpolate(enter, [0, 1], [0, 1]),
      }}>
        <div style={{ fontSize: 64, transform: `scale(${enter})` }}>💍</div>
        <Cap text="YOUR WEDDING." size={68} color={TT_WHITE} sw={8} style={{ transform: `scale(${interpolate(enter, [0, 1], [0.9, 1])})` }} />
        <Cap text="YOUR MOMENTS." size={68} color={GOLD} sw={8} style={{ transform: `scale(${interpolate(enter, [0, 1], [0.9, 1])})` }} />
        <Cap text="LIVE ON THE WALL. ✨" size={52} color={BLUSH} sw={6} />

        <div style={{ width: 320, height: 2, background: `linear-gradient(to right, transparent, ${GOLD}, transparent)` }} />

        <div style={{
          background: `linear-gradient(135deg, ${NEON_PINK}, #ff6b35)`,
          borderRadius: 20, padding: "18px 52px",
          fontFamily: "'Arial Black', sans-serif", fontWeight: 900,
          fontSize: 30, color: TT_WHITE,
          boxShadow: `0 0 50px ${NEON_PINK}88`,
          opacity: interpolate(frame, [25, 45], [0, 1], { extrapolateRight: "clamp" }),
        }}>
          Book at reelday.ph 🔗
        </div>

        <div style={{
          fontFamily: "Georgia, serif", fontStyle: "italic",
          fontSize: 22, color: CREAM, opacity: 0.7, textAlign: "center",
          opacity: interpolate(frame, [40, 65], [0, 0.7], { extrapolateRight: "clamp" }),
        }}>
          Follow for more Filipino wedding inspo 💒
        </div>
      </div>

      <Emoji e="🎊" frame={frame} at={20} x={80} fps={fps} />
      <Emoji e="💍" frame={frame} at={35} x={700} fps={fps} />
      <Emoji e="✨" frame={frame} at={55} x={200} fps={fps} />
      <Emoji e="🥹" frame={frame} at={70} x={620} fps={fps} />
      <Sidebar opacity={0.85} />
      <BottomStrip caption="Follow @reelday.ph for more wedding content 💒✨" opacity={interpolate(frame, [30, 55], [0, 1], { extrapolateRight: "clamp" })} />
    </FadeBetween>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ROOT COMPOSITION
// ─────────────────────────────────────────────────────────────────────────────
export const WeddingWallDemo: React.FC = () => (
  <AbsoluteFill style={{ background: DARK }}>
    <ProgressBar />
    <Sequence from={C1} durationInFrames={D1}><Clip1 /></Sequence>
    <Sequence from={C2} durationInFrames={D2}><Clip2 /></Sequence>
    <Sequence from={C3} durationInFrames={D3}><Clip3 /></Sequence>
    <Sequence from={C4} durationInFrames={D4}><Clip4 /></Sequence>
    <Sequence from={C5} durationInFrames={D5}><Clip5 /></Sequence>
    <Sequence from={C6} durationInFrames={D6}><Clip6 /></Sequence>
  </AbsoluteFill>
);
