import { useCurrentFrame, interpolate } from "remotion";

interface Props {
  label: string;
  durationInFrames: number;
}

export const ChapterMarker: React.FC<Props> = ({ label, durationInFrames }) => {
  const frame = useCurrentFrame();

  const opacity = interpolate(
    frame,
    [0, 8, durationInFrames - 8, durationInFrames],
    [0, 0.85, 0.85, 0],
    { extrapolateRight: "clamp" }
  );

  const x = interpolate(frame, [0, 12], [-30, 0], { extrapolateRight: "clamp" });

  return (
    <div
      style={{
        position: "absolute",
        top: 80,
        left: 72,
        opacity,
        transform: `translateX(${x}px)`,
        display: "flex",
        alignItems: "center",
        gap: 14,
        pointerEvents: "none",
      }}
    >
      {/* Accent line */}
      <div style={{ width: 32, height: 1, background: "rgba(255,220,160,0.8)" }} />
      <div
        style={{
          fontFamily: "'Cormorant Garamond', 'Georgia', serif",
          fontSize: 28,
          fontWeight: 400,
          color: "rgba(255,240,220,0.9)",
          letterSpacing: "0.22em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
    </div>
  );
};
