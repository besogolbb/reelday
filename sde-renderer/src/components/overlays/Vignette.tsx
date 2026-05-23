interface Props {
  audioAmplitude?: number; // 0–1, drives depth
}

export const Vignette: React.FC<Props> = ({ audioAmplitude = 0 }) => {
  const opacity = 0.3 + 0.1 * audioAmplitude;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background:
          "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,VAL) 100%)".replace(
            "VAL",
            String(opacity)
          ),
        pointerEvents: "none",
      }}
    />
  );
};
