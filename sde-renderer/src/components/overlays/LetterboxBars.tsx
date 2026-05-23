import { useCurrentFrame, interpolate } from "remotion";

const BAR_HEIGHT = 60;

interface Props {
  totalFrames: number;
  animInFrames?: number;
  animOutFrames?: number;
  animOutStartFrame?: number;
}

export const LetterboxBars: React.FC<Props> = ({
  totalFrames,
  animInFrames = 30,
  animOutFrames = 30,
  animOutStartFrame,
}) => {
  const frame = useCurrentFrame();
  const outStart = animOutStartFrame ?? totalFrames - animOutFrames;

  const translateIn = interpolate(frame, [0, animInFrames], [BAR_HEIGHT, 0], {
    extrapolateRight: "clamp",
  });

  const translateOut = interpolate(
    frame,
    [outStart, outStart + animOutFrames],
    [0, BAR_HEIGHT],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const translateY = frame < outStart ? translateIn : translateOut;

  return (
    <>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: BAR_HEIGHT,
          background: "#000",
          transform: `translateY(-${translateY}px)`,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: BAR_HEIGHT,
          background: "#000",
          transform: `translateY(${translateY}px)`,
          pointerEvents: "none",
        }}
      />
    </>
  );
};
