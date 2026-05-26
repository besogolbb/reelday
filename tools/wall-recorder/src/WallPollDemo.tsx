import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  Easing,
  spring,
  useVideoConfig,
} from "remotion";

export const FPS = 30;

const FONT_DISPLAY = "'Fraunces', 'Playfair Display', Georgia, serif";
const FONT_MONO    = "'JetBrains Mono', ui-monospace, monospace";
const ACCENT       = "#c45a3a";
const ACCENT_SOFT  = "#f0a37a";
const GOLD         = "#d8a05a";

// ─── Timeline (in seconds) ────────────────────────────────
// 0.0  → 5.5  slideshow (2 photos)
// 5.5  → 6.2  poll overlay zooms in
// 6.2  → 10.5 poll LIVE (countdown ticking)
// 10.5 → 14.5 poll RESULTS reveal + fastest correct
// 14.5 → 15.2 poll fades out
// 15.2 → 19.5 slideshow (2 photos)
// 19.5 → 20.2 question overlay zooms in
// 20.2 → 23.5 question LIVE
// 23.5 → 27.5 question RESULTS (correct answer reveal)
// 27.5 → 28.5 question fades out, outro card fades in
// 28.5 → 31.0 outro card

const sec = (s: number) => Math.round(s * FPS);
export const TOTAL_FRAMES = sec(31);

const SLIDES = [
  { img: "01-first-dance.png",   uploader: "— Tita Marivic · 8:42 pm",  quote: "“First dance after 38 years — still got it.”" },
  { img: "02-whole-family.png",  uploader: "— Kuya Mike · 9:01 pm",     quote: "“The whole family finally in one frame.”" },
  { img: "04-best-night.png",    uploader: "— Kuya Vince · 9:35 pm",    quote: "“Best night of the year, hands down.”" },
  { img: "06-dancing-tatay.png", uploader: "— Andrea · 10:08 pm",       quote: "“Dancing with Tatay. I will never forget this.”" },
];

type SlideShot = {
  img: string;
  uploader: string;
  quote: string;
  start: number;   // frame this slide begins (in its phase)
  duration: number;
};

const POLL = {
  kind: "poll" as const,
  tag: "Live poll",
  question: "Best dance move of the night?",
  options: [
    { label: "Tita Marivic's Tinikling", votes: 18 },
    { label: "Lolo's Twist",             votes: 27 },
    { label: "The couple's first dance", votes: 41 },
  ],
  fastest: null as string | null,
};

const QUESTION = {
  kind: "question" as const,
  tag: "Trivia question",
  question: "Where did Andrea & JM first meet?",
  options: [
    { label: "UP Diliman library",       votes: 14, correct: false },
    { label: "A friend's birthday party", votes: 39, correct: true  },
    { label: "Boracay, summer 2019",     votes: 21, correct: false },
  ],
  fastest: "Kuya Vince — 2.3s",
};

// ─── Orientation helper ───────────────────────────────────
// Returns layout knobs scaled for landscape (1920x1080) or vertical
// (1080x1920) so the same composition renders well for both YT-style
// and IG/TikTok-style posts.
type Layout = {
  vertical: boolean;
  quoteFs: number;
  uploaderFs: number;
  coupleFs: number;
  coupleSubFs: number;
  captionPad: string;
  titleBarH: number;
  titleFs: number;
  pollTagFs: number;
  pollQFs: number;
  pollQMaxCh: number;
  pollBarFs: number;
  pollBarPad: string;
  pollStatsFs: number;
  pollBarsWidth: string;
  fastestFs: number;
  footFs: number;
  countFs: number;
  outroEyebrowFs: number;
  outroTitleFs: number;
  outroTagFs: number;
  tickerH: number;
  tickerFs: number;
};

const getLayout = (w: number, h: number): Layout => {
  const vertical = h > w;
  if (vertical) {
    return {
      vertical: true,
      quoteFs: 44,
      uploaderFs: 16,
      coupleFs: 38,
      coupleSubFs: 18,
      captionPad: "0 40px 56px",
      titleBarH: 130,
      titleFs: 30,
      pollTagFs: 18,
      pollQFs: 64,
      pollQMaxCh: 14,
      pollBarFs: 34,
      pollBarPad: "22px 26px",
      pollStatsFs: 32,
      pollBarsWidth: "92%",
      fastestFs: 28,
      footFs: 20,
      countFs: 38,
      outroEyebrowFs: 18,
      outroTitleFs: 96,
      outroTagFs: 32,
      tickerH: 72,
      tickerFs: 15,
    };
  }
  return {
    vertical: false,
    quoteFs: 60,
    uploaderFs: 18,
    coupleFs: 54,
    coupleSubFs: 22,
    captionPad: "0 56px 64px",
    titleBarH: 110,
    titleFs: 42,
    pollTagFs: 22,
    pollQFs: 96,
    pollQMaxCh: 20,
    pollBarFs: 48,
    pollBarPad: "32px 36px",
    pollStatsFs: 44,
    pollBarsWidth: "min(1300px, 80%)",
    fastestFs: 38,
    footFs: 26,
    countFs: 46,
    outroEyebrowFs: 22,
    outroTitleFs: 120,
    outroTagFs: 44,
    tickerH: 84,
    tickerFs: 18,
  };
};

// ─── Kenburns slide ───────────────────────────────────────
const KenBurns: React.FC<{ src: string; local: number; duration: number }> = ({
  src,
  local,
  duration,
}) => {
  const scale = interpolate(local, [0, duration], [1.02, 1.14], {
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

// ─── Slideshow phase (renders the current slide for a [startFrame, endFrame] window) ─
const Slideshow: React.FC<{
  shots: SlideShot[];
  frame: number;
  phaseStart: number;
  L: Layout;
}> = ({ shots, frame, phaseStart, L }) => {
  const phaseFrame = frame - phaseStart;
  const cur = shots.find((s) => phaseFrame >= s.start && phaseFrame < s.start + s.duration) ?? shots[shots.length - 1];
  const local = phaseFrame - cur.start;

  const FADE = sec(0.8);
  const intro = interpolate(local, [0, FADE], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.ease),
  });
  const outro = interpolate(local, [cur.duration - FADE, cur.duration], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.ease),
  });

  return (
    <div style={{ position: "absolute", inset: 0, opacity: intro * outro }}>
      <KenBurns src={cur.img} local={local} duration={cur.duration} />

      {/* Vignette + bottom darken */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,.55) 100%), " +
            "linear-gradient(180deg, rgba(0,0,0,.55) 0%, transparent 25%, transparent 45%, rgba(0,0,0,.92) 100%)",
        }}
      />

      {/* Bottom caption */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          padding: L.captionPad,
          display: "flex",
          flexDirection: L.vertical ? "column" : "row",
          justifyContent: "space-between",
          alignItems: L.vertical ? "flex-start" : "flex-end",
          gap: L.vertical ? 18 : 32,
          zIndex: 5,
        }}
      >
        <div style={{ maxWidth: L.vertical ? "100%" : "62%" }}>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: L.uploaderFs,
              letterSpacing: ".18em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,.78)",
              marginBottom: 18,
            }}
          >
            {cur.uploader}
          </div>
          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontStyle: "italic",
              fontWeight: 400,
              fontSize: L.quoteFs,
              lineHeight: 1.1,
              letterSpacing: "-.01em",
              color: "#fff",
              textShadow: "0 2px 12px rgba(0,0,0,.8), 0 8px 32px rgba(0,0,0,.6)",
            }}
          >
            {cur.quote}
          </div>
        </div>
        <div style={{ textAlign: L.vertical ? "left" : "right", flexShrink: 0 }}>
          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontStyle: "italic",
              fontSize: L.coupleFs,
              color: "rgba(255,255,255,.92)",
              marginBottom: 10,
              letterSpacing: "-.01em",
            }}
          >
            Andrea &amp; JM
          </div>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: L.coupleSubFs,
              letterSpacing: ".18em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,.55)",
            }}
          >
            Wedding · Tagaytay
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── LIVE ticker (always-on top corner bits) ──────────────
const TopTicker: React.FC<{ frame: number; L: Layout }> = ({ frame, L }) => {
  const moments = 247 + Math.floor(frame / (FPS * 2));
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: L.tickerH,
        background: "linear-gradient(180deg, rgba(0,0,0,.55), transparent)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: L.vertical ? "0 28px" : "0 48px",
        zIndex: 6,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontFamily: FONT_MONO,
          fontSize: L.tickerFs,
          letterSpacing: ".18em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,.9)",
        }}
      >
        <div
          style={{
            width: 13,
            height: 13,
            borderRadius: "50%",
            background: ACCENT_SOFT,
            boxShadow: "0 0 0 5px rgba(240,163,122,.3)",
          }}
        />
        Live now
      </div>
      <div
        style={{
          display: "flex",
          gap: 32,
          fontFamily: FONT_MONO,
          fontSize: L.tickerFs,
          letterSpacing: ".14em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,.55)",
        }}
      >
        <span>
          <em style={{ color: ACCENT_SOFT, fontStyle: "normal" }}>{moments}</em>
          &nbsp; moments
        </span>
        <span>
          <em style={{ color: ACCENT_SOFT, fontStyle: "normal" }}>42</em>
          &nbsp; guests
        </span>
      </div>
    </div>
  );
};

// ─── Poll / Question overlay ──────────────────────────────
type PollData = typeof POLL | typeof QUESTION;

const PollOverlay: React.FC<{
  data: PollData;
  frame: number;
  phaseStart: number;
  phaseEnd: number;
  liveSecs: number;
  resultsAt: number; // frame within phase when results begin
  fps: number;
  L: Layout;
}> = ({ data, frame, phaseStart, phaseEnd, liveSecs, resultsAt, fps, L }) => {
  const local = frame - phaseStart;
  const totalDur = phaseEnd - phaseStart;

  // Zoom-in entrance (first 0.7s of the overlay)
  const ENTER = sec(0.7);
  const enter = spring({
    frame: local,
    fps,
    config: { damping: 18, mass: 0.7 },
  });
  const opacityIn = interpolate(local, [0, ENTER * 0.8], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Exit (last 0.7s)
  const EXIT = sec(0.7);
  const opacityOut = interpolate(
    local,
    [totalDur - EXIT, totalDur],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const scaleOut = interpolate(
    local,
    [totalDur - EXIT, totalDur],
    [1, 1.04],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const opacity = Math.min(opacityIn, opacityOut);
  const enterScale = 0.96 + 0.04 * enter;
  const scale = enterScale * scaleOut;

  const inResults = local >= resultsAt;

  // Countdown 30 → 0 across the live phase
  const liveLocal = Math.min(local, resultsAt);
  const countdown = Math.max(
    0,
    Math.ceil(liveSecs - (liveLocal / fps) * (liveSecs / (resultsAt / fps)))
  );

  // Vote counts: in live state hide; in results state animate fills
  const totalVotes = data.options.reduce((s, o) => s + o.votes, 0);
  const winningVotes = Math.max(...data.options.map((o) => o.votes));

  // Results fill progress (0→1 over 1.2s after resultsAt)
  const fillProg = interpolate(
    local,
    [resultsAt, resultsAt + sec(1.2)],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) }
  );

  // Stats fade-in (after fills settle)
  const statsOpacity = interpolate(
    local,
    [resultsAt + sec(1.0), resultsAt + sec(1.6)],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Fastest card slide-in
  const fastestOpacity = interpolate(
    local,
    [resultsAt + sec(1.8), resultsAt + sec(2.3)],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const fastestY = interpolate(
    local,
    [resultsAt + sec(1.8), resultsAt + sec(2.3)],
    [20, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(circle at 30% 20%, rgba(196,90,58,.28), transparent 60%), " +
          "linear-gradient(180deg, rgba(15,7,3,.93), rgba(15,7,3,.97))",
        backdropFilter: "blur(18px)",
        opacity,
        transform: `scale(${scale})`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "6vh 6vw",
        color: "#fff",
        zIndex: 30,
      }}
    >
      {/* Tag */}
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: L.pollTagFs,
          letterSpacing: ".32em",
          textTransform: "uppercase",
          color: ACCENT_SOFT,
          marginBottom: L.vertical ? 22 : 28,
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <div
          style={{
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: ACCENT,
            boxShadow: `0 0 0 ${6 + 6 * Math.abs(Math.sin(local / 8))}px rgba(196,90,58,${0.5 - 0.4 * Math.abs(Math.sin(local / 8))})`,
          }}
        />
        <span>{data.tag}</span>
      </div>

      {/* Question */}
      <h1
        style={{
          fontFamily: FONT_DISPLAY,
          fontStyle: "italic",
          fontWeight: 500,
          fontSize: L.pollQFs,
          lineHeight: 1.08,
          textAlign: "center",
          maxWidth: `${L.pollQMaxCh}ch`,
          margin: 0,
          marginBottom: L.vertical ? 32 : 44,
          textShadow: "0 8px 30px rgba(0,0,0,.6)",
        }}
      >
        {data.question}
      </h1>

      {/* Bars */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          width: L.pollBarsWidth,
        }}
      >
        {data.options.map((opt, i) => {
          const isLeader = opt.votes === winningVotes;
          const isCorrect = "correct" in opt && (opt as { correct: boolean }).correct;
          const fillWidth = inResults
            ? (opt.votes / totalVotes) * 100 * fillProg
            : 0;
          const pct = Math.round((opt.votes / totalVotes) * 100);

          let fillBg = `linear-gradient(90deg, ${ACCENT}, ${ACCENT_SOFT})`;
          if (isLeader && data.kind === "poll") {
            fillBg = `linear-gradient(90deg, ${GOLD}, #f5d089)`;
          }
          if (isCorrect && inResults) {
            fillBg = "linear-gradient(90deg, #2d7a4a, #5fb27a)";
          }

          const borderColor =
            isCorrect && inResults
              ? "rgba(45,122,74,.6)"
              : isLeader && inResults && data.kind === "poll"
              ? "rgba(216,160,90,.55)"
              : "rgba(255,255,255,.14)";

          return (
            <div
              key={i}
              style={{
                position: "relative",
                overflow: "hidden",
                background: "rgba(255,255,255,.08)",
                border: `1px solid ${borderColor}`,
                borderRadius: 18,
                padding: L.pollBarPad,
                fontSize: L.pollBarFs,
                fontWeight: 500,
                backdropFilter: "blur(6px)",
              }}
            >
              {/* fill */}
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
                  gap: 24,
                }}
              >
                <span style={{ letterSpacing: ".01em", display: "flex", alignItems: "center", gap: 14 }}>
                  {isCorrect && inResults && (
                    <span
                      style={{
                        fontFamily: FONT_MONO,
                        fontSize: L.vertical ? 18 : 24,
                        fontWeight: 700,
                        letterSpacing: ".12em",
                        padding: "6px 14px",
                        borderRadius: 999,
                        background: "rgba(45,122,74,.85)",
                        color: "#fff",
                      }}
                    >
                      ✓ CORRECT
                    </span>
                  )}
                  {opt.label}
                </span>
                {inResults && (
                  <span
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: L.pollStatsFs,
                      fontWeight: 700,
                      letterSpacing: ".08em",
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

      {/* Fastest correct (question only) */}
      {data.kind === "question" && data.fastest && inResults && (
        <div
          style={{
            marginTop: 28,
            padding: "18px 32px",
            borderRadius: 20,
            background: "rgba(216,160,90,.14)",
            border: "1px solid rgba(216,160,90,.45)",
            fontFamily: FONT_DISPLAY,
            fontStyle: "italic",
            fontSize: L.fastestFs,
            fontWeight: 500,
            color: "#f5d089",
            textAlign: "center",
            width: L.pollBarsWidth,
            opacity: fastestOpacity,
            transform: `translateY(${fastestY}px)`,
          }}
        >
          Fastest correct: <b style={{ color: "#fff", fontStyle: "normal", fontWeight: 600 }}>{data.fastest}</b>
        </div>
      )}

      {/* Foot — countdown or "Results" */}
      <div
        style={{
          marginTop: L.vertical ? 24 : 32,
          fontFamily: FONT_MONO,
          fontSize: L.footFs,
          letterSpacing: ".26em",
          textTransform: "uppercase",
          opacity: 0.9,
          fontWeight: 700,
        }}
      >
        {inResults ? (
          <span>Results</span>
        ) : (
          <span>
            Voting ends in{" "}
            <span
              style={{
                color: GOLD,
                fontSize: L.countFs,
                fontWeight: 800,
                fontVariantNumeric: "tabular-nums",
                marginLeft: 10,
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

// ─── Outro card ───────────────────────────────────────────
const OutroCard: React.FC<{ frame: number; phaseStart: number; fps: number; L: Layout }> = ({
  frame,
  phaseStart,
  fps,
  L,
}) => {
  const local = frame - phaseStart;
  const fadeIn = interpolate(local, [0, sec(0.8)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const titleSpring = spring({ frame: local, fps, config: { damping: 14 } });
  const ty = interpolate(titleSpring, [0, 1], [20, 0]);

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
        opacity: fadeIn,
        zIndex: 40,
      }}
    >
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: L.outroEyebrowFs,
          letterSpacing: ".32em",
          textTransform: "uppercase",
          color: ACCENT_SOFT,
          marginBottom: 36,
        }}
      >
        Polls · Trivia · Live photo wall
      </div>
      <div
        style={{
          fontFamily: FONT_DISPLAY,
          fontStyle: "italic",
          fontSize: L.outroTitleFs,
          fontWeight: 500,
          color: "#fff",
          letterSpacing: "-.01em",
          transform: `translateY(${ty}px)`,
        }}
      >
        Reelday<span style={{ color: ACCENT_SOFT }}>.ph</span>
      </div>
      <div
        style={{
          marginTop: 32,
          fontFamily: FONT_DISPLAY,
          fontStyle: "italic",
          fontWeight: 400,
          fontSize: L.outroTagFs,
          color: "rgba(255,255,255,.8)",
          textAlign: "center",
          maxWidth: "20ch",
          lineHeight: 1.2,
        }}
      >
        Keep every Filipino celebration alive on the wall.
      </div>
    </AbsoluteFill>
  );
};

// ─── Composition ──────────────────────────────────────────
export const WallPollDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const L = getLayout(width, height);

  // Phase boundaries (frames)
  const SHOW1_START = 0;
  const SHOW1_END   = sec(5.5);
  const POLL_START  = SHOW1_END;
  const POLL_END    = sec(15.2);
  const POLL_RESULTS_AT = sec(4.3 * 1); // results begin 4.3s into poll overlay phase
  const SHOW2_START = POLL_END;
  const SHOW2_END   = sec(19.5);
  const Q_START     = SHOW2_END;
  const Q_END       = sec(28.0);
  const Q_RESULTS_AT = sec(4.0);
  const OUTRO_START = Q_END;
  const OUTRO_END   = TOTAL_FRAMES;

  // Slideshow shots for phase 1: 2 photos × ~2.75s each
  const show1: SlideShot[] = [
    { ...SLIDES[0], start: 0,         duration: sec(2.75) },
    { ...SLIDES[1], start: sec(2.75), duration: sec(2.75) },
  ];

  // Slideshow shots for phase 2: 2 photos × ~2.15s each
  const show2: SlideShot[] = [
    { ...SLIDES[2], start: 0,         duration: sec(2.15) },
    { ...SLIDES[3], start: sec(2.15), duration: sec(2.15) },
  ];

  // Audio: gentle fade in/out for the music
  const musicVol = interpolate(
    frame,
    [0, sec(1), TOTAL_FRAMES - sec(2), TOTAL_FRAMES],
    [0, 0.7, 0.7, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Title bar fade-in at the very start, fade out before outro
  const titleOpacity = interpolate(
    frame,
    [0, sec(0.8), Q_END - sec(0.6), Q_END],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const inShow1 = frame >= SHOW1_START && frame < SHOW1_END;
  const inPoll  = frame >= POLL_START && frame < POLL_END;
  const inShow2 = frame >= SHOW2_START && frame < SHOW2_END;
  const inQ     = frame >= Q_START && frame < Q_END;
  const inOutro = frame >= OUTRO_START;

  const BAR_H = L.titleBarH;

  return (
    <AbsoluteFill style={{ background: "#1a0f0a" }}>
      <Audio src={staticFile("party.mp3")} volume={musicVol} />

      {/* Title bar */}
      {!inOutro && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: BAR_H,
            background: "linear-gradient(180deg, #1a0f0a 0%, #2a1a14 100%)",
            borderBottom: `2px solid ${ACCENT_SOFT}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 48px",
            zIndex: 50,
            opacity: titleOpacity,
          }}
        >
          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: L.titleFs,
              fontStyle: "italic",
              fontWeight: 400,
              color: "#fff",
              letterSpacing: "-.01em",
              textAlign: "center",
              lineHeight: 1.1,
            }}
          >
            <span style={{ color: ACCENT_SOFT, fontWeight: 500 }}>Reelday.ph</span>
            {L.vertical ? <br /> : <span style={{ opacity: 0.55 }}>  —  </span>}
            live polls &amp; trivia on the photo wall.
          </div>
        </div>
      )}

      {/* Wall area beneath title bar */}
      <div
        style={{
          position: "absolute",
          top: inOutro ? 0 : BAR_H,
          left: 0,
          right: 0,
          bottom: 0,
          overflow: "hidden",
        }}
      >
        {/* Always-render slideshow underneath (frozen at last frame during overlays) */}
        {inShow1 && (
          <>
            <Slideshow shots={show1} frame={frame} phaseStart={SHOW1_START} L={L} />
            <TopTicker frame={frame} L={L} />
          </>
        )}

        {inPoll && (
          <>
            {/* Frozen last slide as backdrop */}
            <Slideshow shots={show1} frame={SHOW1_END - 1} phaseStart={SHOW1_START} L={L} />
            <PollOverlay
              data={POLL}
              frame={frame}
              phaseStart={POLL_START}
              phaseEnd={POLL_END}
              liveSecs={30}
              resultsAt={sec(4.3)}
              fps={fps}
              L={L}
            />
          </>
        )}

        {inShow2 && (
          <>
            <Slideshow shots={show2} frame={frame} phaseStart={SHOW2_START} L={L} />
            <TopTicker frame={frame} L={L} />
          </>
        )}

        {inQ && (
          <>
            <Slideshow shots={show2} frame={SHOW2_END - 1} phaseStart={SHOW2_START} L={L} />
            <PollOverlay
              data={QUESTION}
              frame={frame}
              phaseStart={Q_START}
              phaseEnd={Q_END}
              liveSecs={20}
              resultsAt={Q_RESULTS_AT}
              fps={fps}
              L={L}
            />
          </>
        )}

        {inOutro && <OutroCard frame={frame} phaseStart={OUTRO_START} fps={fps} L={L} />}
      </div>
    </AbsoluteFill>
  );
};
