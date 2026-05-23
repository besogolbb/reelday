import { useCurrentFrame, interpolate } from "remotion";
import { FilmGrain } from "./overlays/FilmGrain";

// 3s = 90 frames: countdown 3 → 2 → 1, each 1s with grain + flicker
export const FilmLeader: React.FC = () => {
  const frame = useCurrentFrame();

  const countdownNumber = frame < 30 ? 3 : frame < 60 ? 2 : 1;

  // Light flicker — random brightness per frame
  const flicker = 0.85 + Math.sin(frame * 7.3) * 0.08 + Math.cos(frame * 13.1) * 0.07;

  // Brief white flash at each second boundary
  const flashOpacity =
    interpolate(frame % 30, [0, 2, 5], [0.4, 0, 0], {
      extrapolateRight: "clamp",
    });

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#111",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        filter: `brightness(${flicker})`,
      }}
    >
      {/* Concentric circles — classic film leader */}
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {[400, 300, 200, 120].map((r, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              width: r * 2,
              height: r * 2,
              borderRadius: "50%",
              border: "2px solid rgba(255,255,255,0.15)",
            }}
          />
        ))}
        {/* Crosshair lines */}
        <div style={{ position: "absolute", width: 900, height: 2, background: "rgba(255,255,255,0.12)" }} />
        <div style={{ position: "absolute", width: 2, height: 600, background: "rgba(255,255,255,0.12)" }} />
      </div>

      {/* Countdown number */}
      <div
        style={{
          fontFamily: "monospace",
          fontSize: 200,
          fontWeight: 700,
          color: "rgba(255,255,255,0.9)",
          lineHeight: 1,
          zIndex: 1,
        }}
      >
        {countdownNumber}
      </div>

      {/* Flash at second boundaries */}
      <div style={{ position: "absolute", inset: 0, background: `rgba(255,255,255,${flashOpacity})` }} />

      <FilmGrain audioAmplitude={0.5} />
    </div>
  );
};
