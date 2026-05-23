import { useCurrentFrame, interpolate, Img } from "remotion";

interface Props {
  srcs: string[];          // 2–4 photos
  durationInFrames: number; // COLLAGE_FRAMES = 60
}

// Grid shows for first half, then collapses to first photo (hero transition)
export const Collage: React.FC<Props> = ({ srcs, durationInFrames }) => {
  const frame = useCurrentFrame();
  const photos = srcs.slice(0, 4);
  const collapseStart = Math.floor(durationInFrames * 0.55);

  const collapseProgress = interpolate(
    frame,
    [collapseStart, durationInFrames],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const gridOpacity = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: "clamp" });

  // Grid layouts for 2, 3, or 4 photos
  const layout = photos.length === 2
    ? [
        { x: 0, y: 0, w: "50%", h: "100%" },
        { x: "50%", y: 0, w: "50%", h: "100%" },
      ]
    : photos.length === 3
    ? [
        { x: 0, y: 0, w: "50%", h: "100%" },
        { x: "50%", y: 0, w: "50%", h: "50%" },
        { x: "50%", y: "50%", w: "50%", h: "50%" },
      ]
    : [
        { x: 0, y: 0, w: "50%", h: "50%" },
        { x: "50%", y: 0, w: "50%", h: "50%" },
        { x: 0, y: "50%", w: "50%", h: "50%" },
        { x: "50%", y: "50%", w: "50%", h: "50%" },
      ];

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: "hidden",
        background: "#000",
        opacity: gridOpacity,
      }}
    >
      {photos.map((src, i) => {
        const cell = layout[i];
        // On collapse, all cells scale/move toward center
        const scale = interpolate(collapseProgress, [0, 1], [1, i === 0 ? 1.5 : 0.8], {});
        const cellOpacity = i === 0
          ? 1
          : interpolate(collapseProgress, [0.4, 1], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: cell.x,
              top: cell.y,
              width: cell.w,
              height: cell.h,
              overflow: "hidden",
              border: "2px solid #000",
              opacity: cellOpacity,
              transform: `scale(${scale})`,
              transformOrigin: "center center",
            }}
          >
            <Img
              src={src}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                filter: "saturate(1.1) contrast(1.03)",
              }}
            />
          </div>
        );
      })}
    </div>
  );
};
