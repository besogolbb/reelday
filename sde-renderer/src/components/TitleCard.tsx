import { useCurrentFrame, interpolate, Img, Audio } from "remotion";
import { BokehParticles } from "./overlays/BokehParticles";
import { FilmGrain } from "./overlays/FilmGrain";

interface Props {
  title: string | null;
  subtitle: string | null;
  coverImageSrc: string | null;
  voiceoverSrc: string | null;
  durationInFrames: number;
}

export const TitleCard: React.FC<Props> = ({
  title,
  subtitle,
  coverImageSrc,
  voiceoverSrc,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();

  // Stagger: title words fade up
  const titleWords = (title ?? "").split(" ");
  const subtitleOpacity = interpolate(frame, [30, 50], [0, 1], { extrapolateRight: "clamp" });
  const subtitleY = interpolate(frame, [30, 50], [16, 0], { extrapolateRight: "clamp" });

  // Divider line draws left to right
  const dividerScale = interpolate(frame, [20, 40], [0, 1], { extrapolateRight: "clamp" });

  // Overall fade out near end
  const fadeOut = interpolate(frame, [durationInFrames - 15, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: "hidden",
        opacity: fadeOut,
      }}
    >
      {/* Blurred cover photo background */}
      {coverImageSrc ? (
        <Img
          src={coverImageSrc}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: "blur(40px) brightness(0.45)",
            transform: "scale(1.1)",
          }}
        />
      ) : (
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, #0d1b2a, #1a2f4a)" }} />
      )}

      {/* Warm overlay tint */}
      <div style={{ position: "absolute", inset: 0, background: "rgba(30, 15, 5, 0.4)" }} />

      <BokehParticles />

      {/* Centered text block */}
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
        {/* Couple name — word-by-word stagger */}
        {title && (
          <div style={{ display: "flex", gap: 24, marginBottom: 20 }}>
            {titleWords.map((word, i) => {
              const wordOpacity = interpolate(frame, [i * 6, i * 6 + 14], [0, 1], { extrapolateRight: "clamp" });
              const wordY = interpolate(frame, [i * 6, i * 6 + 14], [20, 0], { extrapolateRight: "clamp" });
              return (
                <div
                  key={i}
                  style={{
                    fontFamily: "'Cormorant Garamond', 'Georgia', serif",
                    fontSize: 96,
                    fontWeight: 600,
                    color: "#fff",
                    letterSpacing: "0.04em",
                    opacity: wordOpacity,
                    transform: `translateY(${wordY}px)`,
                    lineHeight: 1,
                    textShadow: "0 2px 24px rgba(0,0,0,0.5)",
                  }}
                >
                  {word}
                </div>
              );
            })}
          </div>
        )}

        {/* Animated divider */}
        <div
          style={{
            width: 280,
            height: 1,
            background: "rgba(255,220,160,0.7)",
            transformOrigin: "left center",
            transform: `scaleX(${dividerScale})`,
            marginBottom: 20,
          }}
        />

        {/* Subtitle */}
        {subtitle && (
          <div
            style={{
              fontFamily: "'Lato', 'Helvetica Neue', sans-serif",
              fontWeight: 300,
              fontSize: 36,
              color: "rgba(255,240,220,0.85)",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              opacity: subtitleOpacity,
              transform: `translateY(${subtitleY}px)`,
              textShadow: "0 1px 12px rgba(0,0,0,0.4)",
            }}
          >
            {subtitle}
          </div>
        )}
      </div>

      {voiceoverSrc && (
        <Audio src={voiceoverSrc} startFrom={0} />
      )}

      <FilmGrain />
    </div>
  );
};
