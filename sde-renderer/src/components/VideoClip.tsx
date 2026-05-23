import { useCurrentFrame, interpolate, OffthreadVideo, Audio } from "remotion";
import { FilmGrain } from "./overlays/FilmGrain";
import { Vignette } from "./overlays/Vignette";
import { ClipCounter } from "./overlays/ClipCounter";

interface Props {
  src: string;
  durationInFrames: number;
  isPinned: boolean;        // slow motion if pinned
  ambientSrc?: string;      // ambient audio at -18dB
  clipIndex: number;
  totalClips: number;
  audioAmplitude?: number;
}

export const VideoClip: React.FC<Props> = ({
  src,
  durationInFrames,
  isPinned,
  ambientSrc,
  clipIndex,
  totalClips,
  audioAmplitude = 0,
}) => {
  const frame = useCurrentFrame();

  // Speed ramp: 0.5x → 1.0x over first 15 frames (smooth entry)
  // Pinned clips stay at 0.5x for cinematic slow motion
  const playbackRate = isPinned
    ? 0.5
    : interpolate(frame, [0, 15], [0.5, 1.0], { extrapolateRight: "clamp" });

  // Micro zoom: very subtle 1.0 → 1.03 over clip duration
  const scale = interpolate(frame, [0, durationInFrames], [1.0, 1.03], {});

  const fadeIn = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = Math.min(fadeIn, fadeOut);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden", opacity }}>
      {/* Blurred fill background (handles portrait videos) */}
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
          filter: "blur(30px) brightness(0.55)",
          transform: "scale(1.08)",
        }}
      />
      {/* Sharp foreground */}
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
          filter: "saturate(1.15) contrast(1.05) brightness(1.02) sepia(0.08)",
        }}
      />

      {/* Ambient audio at -18dB */}
      {ambientSrc && (
        <Audio src={ambientSrc} volume={0.25} />
      )}

      <Vignette audioAmplitude={audioAmplitude} />
      <FilmGrain audioAmplitude={audioAmplitude} />
      <ClipCounter current={clipIndex + 1} total={totalClips} />
    </div>
  );
};
