import { useCurrentFrame, interpolate, Img, OffthreadVideo } from "remotion";
import { FilmGrain } from "./overlays/FilmGrain";
import { Vignette } from "./overlays/Vignette";
import type { ClipType } from "../types";

interface Props {
  src: string;
  type: ClipType;
  posterSrc?: string;        // video: poster JPEG for blur bg AND freeze frame
  isLandscape: boolean;
  durationInFrames: number;  // now HERO_FRAMES = 150 (5s)
}

// 5s hero. Video plays at constant 0.5x throughout (no variable rate — that
// forced ffmpeg to re-seek per frame). Freeze frame is rendered from the
// static poster Img (frames 60-89) rather than seeking video to playbackRate=0.
const FREEZE_START = 60;
const FREEZE_END = 90;

export const HeroMoment: React.FC<Props> = ({
  src,
  type,
  posterSrc,
  isLandscape,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();

  // Slow Ken Burns across the full hero
  const scale = interpolate(frame, [0, durationInFrames], [1.0, 1.05], {});

  const fadeIn = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [durationInFrames - 3, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = Math.min(fadeIn, fadeOut);

  // Warm glow border fades in during freeze frame
  const glowOpacity = interpolate(frame, [FREEZE_START, FREEZE_START + 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const isVideo = type === "video";
  const inFreezeWindow = isVideo && posterSrc && frame >= FREEZE_START && frame < FREEZE_END;
  // Static photo or video freeze frame both render from a still Img.
  const stillSrc = isVideo ? posterSrc : src;

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden", opacity }}>
      {/* Blurred background — always static Img (poster for video, source for photo) */}
      {stillSrc && (
        <Img
          src={stillSrc}
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

      {/* Sharp foreground — photo stays Img; video uses OffthreadVideo except during freeze */}
      {!isVideo && stillSrc && (
        <Img
          src={stillSrc}
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
      )}

      {isVideo && inFreezeWindow && (
        <Img
          src={stillSrc!}
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

      {isVideo && !inFreezeWindow && (
        <OffthreadVideo
          src={src}
          playbackRate={0.5}
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
