import { useCurrentFrame, interpolate } from "remotion";

interface Props {
  current: number;
  total: number;
}

export const ClipCounter: React.FC<Props> = ({ current, total }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 8], [0, 0.6], {
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        bottom: 32,
        right: 48,
        opacity,
        fontFamily: "monospace",
        fontSize: 22,
        color: "rgba(255,255,255,0.7)",
        letterSpacing: "0.1em",
        pointerEvents: "none",
      }}
    >
      {String(current).padStart(2, "0")} / {String(total).padStart(2, "0")}
    </div>
  );
};
