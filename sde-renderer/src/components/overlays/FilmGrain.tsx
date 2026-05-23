import { useCurrentFrame, interpolate } from "remotion";
import { noise2D } from "@remotion/noise";

interface Props {
  audioAmplitude?: number; // 0–1, drives intensity
}

export const FilmGrain: React.FC<Props> = ({ audioAmplitude = 0 }) => {
  const frame = useCurrentFrame();
  const intensity = 0.04 + 0.02 * audioAmplitude;

  // Generate a grid of noise pixels via SVG feTurbulence seeded per frame
  const seed = frame % 60;

  return (
    <svg
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        opacity: intensity * 6,
        mixBlendMode: "overlay",
        pointerEvents: "none",
      }}
    >
      <filter id={`grain-${seed}`}>
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.65"
          numOctaves="3"
          seed={seed}
          stitchTiles="stitch"
        />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect
        width="100%"
        height="100%"
        filter={`url(#grain-${seed})`}
      />
    </svg>
  );
};
