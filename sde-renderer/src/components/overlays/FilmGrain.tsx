import { useCurrentFrame } from "remotion";

interface Props {
  audioAmplitude?: number; // 0–1, drives intensity
}

// Pre-baked 256×256 SVG noise tile encoded as a data URL. Generated ONCE
// at module load; reused as a CSS background-image so Chrome rasterizes
// the noise a single time instead of running <feTurbulence> per frame
// (which was costing ~5-15ms per frame across every clip).
const NOISE_DATA_URL = `url("data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'>
  <filter id='n'>
    <feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/>
    <feColorMatrix type='saturate' values='0'/>
  </filter>
  <rect width='100%' height='100%' filter='url(#n)' opacity='0.5'/>
</svg>`)}")`;

export const FilmGrain: React.FC<Props> = ({ audioAmplitude = 0 }) => {
  const frame = useCurrentFrame();
  const intensity = 0.04 + 0.02 * audioAmplitude;

  // Animate background position to give the impression of moving grain
  // without re-rasterizing the noise tile each frame.
  const offsetX = (frame * 17) % 256;
  const offsetY = (frame * 23) % 256;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundImage: NOISE_DATA_URL,
        backgroundRepeat: "repeat",
        backgroundPosition: `${offsetX}px ${offsetY}px`,
        opacity: intensity * 6,
        mixBlendMode: "overlay",
        pointerEvents: "none",
      }}
    />
  );
};
