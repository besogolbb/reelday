import { useCurrentFrame, interpolate, Img } from "remotion";
import { BokehParticles } from "./overlays/BokehParticles";
import { FilmGrain } from "./overlays/FilmGrain";

interface Props {
  endcardText: string | null;
  coverImageSrc: string | null;
  totalClips: number;
  totalReactions: number;
  qrCodeDataUrl: string | null;
  eventSlug: string;
  durationInFrames: number;
}

function AnimatedCounter({ target, frame, startFrame }: { target: number; frame: number; startFrame: number }) {
  const value = Math.round(
    interpolate(frame, [startFrame, startFrame + 40], [0, target], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
  );
  return <>{value.toLocaleString()}</>;
}

export const EndCard: React.FC<Props> = ({
  endcardText,
  coverImageSrc,
  totalClips,
  totalReactions,
  qrCodeDataUrl,
  eventSlug,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();

  const fadeIn = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [durationInFrames - 15, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = Math.min(fadeIn, fadeOut);

  // Text stagger
  const textOpacity = interpolate(frame, [15, 35], [0, 1], { extrapolateRight: "clamp" });
  const textY = interpolate(frame, [15, 35], [20, 0], { extrapolateRight: "clamp" });

  const statsOpacity = interpolate(frame, [30, 50], [0, 1], { extrapolateRight: "clamp" });
  const qrOpacity = interpolate(frame, [50, 65], [0, 1], { extrapolateRight: "clamp" });

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden", opacity }}>
      {/* Blurred background */}
      {coverImageSrc ? (
        <Img
          src={coverImageSrc}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: "blur(40px) brightness(0.4)",
            transform: "scale(1.1)",
          }}
        />
      ) : (
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, #0d1b2a, #1a2f4a)" }} />
      )}

      <div style={{ position: "absolute", inset: 0, background: "rgba(20, 8, 0, 0.45)" }} />
      <BokehParticles />

      {/* Center content */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 0,
        }}
      >
        {endcardText && (
          <div
            style={{
              fontFamily: "'Cormorant Garamond', 'Georgia', serif",
              fontSize: 64,
              fontWeight: 400,
              color: "#fff",
              textAlign: "center",
              letterSpacing: "0.03em",
              opacity: textOpacity,
              transform: `translateY(${textY}px)`,
              textShadow: "0 2px 24px rgba(0,0,0,0.5)",
              maxWidth: 1200,
              lineHeight: 1.3,
              marginBottom: 48,
            }}
          >
            {endcardText}
          </div>
        )}

        {/* Divider */}
        <div
          style={{
            width: 200,
            height: 1,
            background: "rgba(255,220,160,0.6)",
            marginBottom: 40,
            opacity: statsOpacity,
          }}
        />

        {/* Animated stats */}
        <div
          style={{
            display: "flex",
            gap: 80,
            opacity: statsOpacity,
            fontFamily: "'Lato', 'Helvetica Neue', sans-serif",
            fontWeight: 300,
            color: "rgba(255,240,220,0.85)",
            letterSpacing: "0.12em",
            fontSize: 28,
          }}
        >
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 52, fontWeight: 600, color: "#fff", fontFamily: "'Cormorant Garamond', serif" }}>
              <AnimatedCounter target={totalClips} frame={frame} startFrame={30} />
            </div>
            <div style={{ marginTop: 6, textTransform: "uppercase", fontSize: 22 }}>moments</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 52, fontWeight: 600, color: "#fff", fontFamily: "'Cormorant Garamond', serif" }}>
              <AnimatedCounter target={totalReactions} frame={frame} startFrame={38} />
            </div>
            <div style={{ marginTop: 6, textTransform: "uppercase", fontSize: 22 }}>reactions</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 52, fontWeight: 600, color: "#fff", fontFamily: "'Cormorant Garamond', serif" }}>
              1
            </div>
            <div style={{ marginTop: 6, textTransform: "uppercase", fontSize: 22 }}>perfect day</div>
          </div>
        </div>

        {/* QR code */}
        {qrCodeDataUrl && (
          <div
            style={{
              marginTop: 56,
              opacity: qrOpacity,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
            }}
          >
            <img
              src={qrCodeDataUrl}
              style={{ width: 120, height: 120, borderRadius: 8, background: "#fff", padding: 6 }}
            />
            <div
              style={{
                fontFamily: "'Lato', sans-serif",
                fontSize: 20,
                color: "rgba(255,240,220,0.6)",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
              }}
            >
              Scan to see all moments
            </div>
          </div>
        )}
      </div>

      <FilmGrain />
    </div>
  );
};
