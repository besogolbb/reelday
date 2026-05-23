import { useCurrentFrame, interpolate, Img } from "remotion";
import { FilmGrain } from "./overlays/FilmGrain";
import { Vignette } from "./overlays/Vignette";
import { ClipCounter } from "./overlays/ClipCounter";

const ANCHORS = [
  { x: 1, y: 1 },   // zoom toward bottom-right
  { x: -1, y: 1 },  // zoom toward bottom-left
  { x: 1, y: -1 },  // zoom toward top-right
  { x: -1, y: -1 }, // zoom toward top-left
] as const;

interface Props {
  src: string;
  durationInFrames: number;
  isLandscape: boolean;
  anchorIndex: number; // cycles 0-3
  clipIndex: number;
  totalClips: number;
  audioAmplitude?: number;
}

export const PhotoClip: React.FC<Props> = ({
  src,
  durationInFrames,
  isLandscape,
  anchorIndex,
  clipIndex,
  totalClips,
  audioAmplitude = 0,
}) => {
  const frame = useCurrentFrame();
  const anchor = ANCHORS[anchorIndex % 4];

  // Photo flash — white spike on frame 0–3
  const flashOpacity = interpolate(frame, [0, 2, 5], [0.7, 0.2, 0], {
    extrapolateRight: "clamp",
  });

  // Fade in/out
  const fadeIn = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = Math.min(fadeIn, fadeOut);

  // Lower third — timestamp or simple clip info (just fade, no text data here)
  const lowerOpacity = interpolate(frame, [10, 20, durationInFrames - 15, durationInFrames - 8], [0, 0.7, 0.7, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  if (isLandscape) {
    // Horizontal pan for landscape/group shots
    const panX = interpolate(frame, [0, durationInFrames], [0, anchor.x * 40], {});
    return (
      <div style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden", opacity }}>
        {/* Blurred fill background */}
        <Img
          src={src}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: "blur(28px) brightness(0.6)",
            transform: "scale(1.08)",
          }}
        />
        {/* Sharp foreground with pan */}
        <Img
          src={src}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `translateX(${panX}px)`,
            filter: "saturate(1.15) contrast(1.05) brightness(1.02) sepia(0.08)",
          }}
        />
        <div style={{ position: "absolute", inset: 0, background: `rgba(255,255,255,${flashOpacity})` }} />
        <Vignette audioAmplitude={audioAmplitude} />
        <FilmGrain audioAmplitude={audioAmplitude} />
        <ClipCounter current={clipIndex + 1} total={totalClips} />
      </div>
    );
  }

  // Portrait — Ken Burns with parallax blur-fill background
  const scale = interpolate(frame, [0, durationInFrames], [1.0, 1.08], {});
  const tx = interpolate(frame, [0, durationInFrames], [0, anchor.x * 20], {});
  const ty = interpolate(frame, [0, durationInFrames], [0, anchor.y * 20], {});
  // Background drifts opposite for parallax depth
  const bgTx = interpolate(frame, [0, durationInFrames], [0, -anchor.x * 12], {});
  const bgTy = interpolate(frame, [0, durationInFrames], [0, -anchor.y * 12], {});

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden", opacity }}>
      {/* Blurred parallax background */}
      <Img
        src={src}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          filter: "blur(30px) brightness(0.55)",
          transform: `scale(1.1) translate(${bgTx}px, ${bgTy}px)`,
        }}
      />
      {/* Sharp foreground — Ken Burns */}
      <Img
        src={src}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "contain",
          transform: `scale(${scale}) translate(${tx}px, ${ty}px)`,
          filter: "saturate(1.15) contrast(1.05) brightness(1.02) sepia(0.08)",
        }}
      />
      <div style={{ position: "absolute", inset: 0, background: `rgba(255,255,255,${flashOpacity})` }} />
      <Vignette audioAmplitude={audioAmplitude} />
      <FilmGrain audioAmplitude={audioAmplitude} />
      <ClipCounter current={clipIndex + 1} total={totalClips} />
    </div>
  );
};
