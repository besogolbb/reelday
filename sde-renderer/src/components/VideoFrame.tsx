import { useCurrentFrame, Img, OffthreadVideo } from "remotion";

interface Props {
  // Pre-extracted path. When set, we render an <Img> per frame and never
  // touch ffmpeg during the render — the killer perf win.
  frameBaseUrl?: string;
  frameCount?: number;

  // Fallback path — used when extraction failed/disabled for this clip.
  src: string;

  // Source-position advance per output frame. 1.0 = real time, 0.5 = slow-mo.
  // For the ramp section in VideoClip we approximate with the running rate;
  // the visual difference vs. true integration is invisible at 15-frame ramps.
  playbackRate: number;

  // Pass-through style + opts so VideoFrame is a drop-in for OffthreadVideo.
  style: React.CSSProperties;
  muted?: boolean;
}

function pad5(n: number) {
  return n.toString().padStart(5, "0");
}

export const VideoFrame: React.FC<Props> = ({
  frameBaseUrl,
  frameCount,
  src,
  playbackRate,
  style,
  muted,
}) => {
  const frame = useCurrentFrame();

  // Fallback to OffthreadVideo when no extracted frames are available.
  // Lets render proceed if one clip's extraction failed without taking
  // down the whole render.
  if (!frameBaseUrl || !frameCount) {
    return (
      <OffthreadVideo src={src} playbackRate={playbackRate} muted={muted} style={style} />
    );
  }

  // Frames were extracted at output FPS, so frame N of output corresponds
  // to source frame floor(N * playbackRate). Clamp to available range.
  const sourceIdx = Math.min(
    Math.max(0, Math.floor(frame * playbackRate)),
    frameCount - 1,
  );

  return (
    <Img
      src={`${frameBaseUrl}/frame_${pad5(sourceIdx + 1)}.jpg`}
      style={style}
    />
  );
};
