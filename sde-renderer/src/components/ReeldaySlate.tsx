import { useCurrentFrame, interpolate } from "remotion";

interface Props {
  durationInFrames: number; // SLATE_FRAMES = 60
}

export const ReeldaySlate: React.FC<Props> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();

  const logoOpacity = interpolate(frame, [0, 15, durationInFrames - 20, durationInFrames - 5], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Iris close: CSS clip-path circle shrinks to 0
  const irisRadius = interpolate(
    frame,
    [durationInFrames - 25, durationInFrames],
    [150, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        background: "#000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        clipPath: `circle(${irisRadius}% at center)`,
      }}
    >
      <div
        style={{
          opacity: logoOpacity,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
        }}
      >
        {/* Reelday wordmark */}
        <div
          style={{
            fontFamily: "'Cormorant Garamond', 'Georgia', serif",
            fontSize: 64,
            fontWeight: 600,
            color: "#fff",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
          }}
        >
          Reelday
        </div>
        <div
          style={{
            fontFamily: "'Lato', 'Helvetica Neue', sans-serif",
            fontWeight: 300,
            fontSize: 22,
            color: "rgba(255,220,160,0.7)",
            letterSpacing: "0.3em",
            textTransform: "uppercase",
          }}
        >
          reelday.ph
        </div>
      </div>
    </div>
  );
};
