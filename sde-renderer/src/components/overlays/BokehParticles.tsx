import { useCurrentFrame, interpolate } from "remotion";
import { FPS } from "../../types";

interface Particle {
  x: number;
  y: number;
  r: number;
  opacity: number;
  driftX: number;
  driftY: number;
  phase: number;
}

// Seeded pseudo-random so particles are deterministic across frames
function seededRand(seed: number): number {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

const PARTICLES: Particle[] = Array.from({ length: 12 }, (_, i) => ({
  x: seededRand(i * 7) * 1920,
  y: seededRand(i * 13) * 1080,
  r: 30 + seededRand(i * 3) * 80,
  opacity: 0.05 + seededRand(i * 11) * 0.12,
  driftX: (seededRand(i * 5) - 0.5) * 40,
  driftY: (seededRand(i * 9) - 0.5) * 40,
  phase: seededRand(i * 17) * Math.PI * 2,
}));

export const BokehParticles: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {PARTICLES.map((p, i) => {
        const wobbleX = Math.sin(t * 0.4 + p.phase) * p.driftX;
        const wobbleY = Math.cos(t * 0.3 + p.phase) * p.driftY;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: p.x + wobbleX,
              top: p.y + wobbleY,
              width: p.r * 2,
              height: p.r * 2,
              borderRadius: "50%",
              background: "rgba(255, 220, 160, VAL)".replace(
                "VAL",
                String(p.opacity)
              ),
              filter: `blur(${p.r * 0.6}px)`,
              transform: "translate(-50%, -50%)",
            }}
          />
        );
      })}
    </div>
  );
};
