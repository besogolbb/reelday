import { useCurrentFrame, interpolate, Img, OffthreadVideo } from "remotion";
import { FilmGrain } from "./overlays/FilmGrain";
import { Vignette } from "./overlays/Vignette";
import type { ClipType } from "../types";

// Highest-reacted clip gets 8s, slowest Ken Burns, freeze frame, warm glow border
interface Props {
  src: string;
  type: ClipType;
  isLandscape: boolean;
  durationInFrames: number; // always HERO_FRAMES = 240
}

export const HeroMoment: React.FC<Props> = ({ src, type, isLandscape, durationInFrames }) => {
  const frame = useCurrentFrame();

  // Slow Ken Burns: 1.0 → 1.05 over full 8s
  const scale = interpolate(frame, [0, durationInFrames], [1.0, 1.05], {});

  // Freeze frame: slow video to 0 at frame 90, hold 30f, then resume
  const playbackRate =
    frame < 85
      ? interpolate(frame, [0, 15], [0.4, 0.5], { extrapolateRight: "clamp" })
      : frame < 120
      ? 0
      : 0.5;

  const fadeIn = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });
  // Hard cut to black at the end (no crossfade — dramatic)
  const fadeOut = interpolate(frame, [durationInFrames - 3, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = Math.min(fadeIn, fadeOut);

  // Warm glow border fades in after freeze frame
  const glowOpacity = interpolate(frame, [90, 110], [0, 1], {
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
        opacity,
      }}
    >
      {/* Blurred background */}
      {type === "photo" ? (
        <Img
          src={src}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: "blur(30px) brightness(0.5)",
            transform: "scale(1.1)",
          }}
        />
      ) : (
        <OffthreadVideo
          src={src}
          playbackRate={playbackRate}
          muted
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: "blur(30px) brightness(0.5)",
            transform: "scale(1.1)",
          }}
        />
      )}

      {/* Sharp foreground */}
      {type === "photo" ? (
        <Img
          src={src}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: isLandscape ? "cover" : "contain",
            transform: `scale(${scale})`,
            filter: "saturate(1.2) contrast(1.05) brightness(1.03) sepia(0.1)",
          }}
        />
      ) : (
        <OffthreadVideo
          src={src}
          playbackRate={playbackRate}
          muted
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
            transform: `scale(${scale})`,
            filter: "saturate(1.2) contrast(1.05) brightness(1.03) sepia(0.1)",
          }}
        />
      )}

      {/* Warm glow border */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          boxShadow: "inset 0 0 80px rgba(255,200,100,0.25)",
          opacity: glowOpacity,
          pointerEvents: "none",
        }}
      />

      <Vignette audioAmplitude={0.3} />
      <FilmGrain audioAmplitude={0.2} />
    </div>
  );
};
