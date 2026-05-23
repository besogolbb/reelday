import { useCurrentFrame, interpolate, Img } from "remotion";

interface Props {
  srcs: string[]; // 6–8 photo URLs
}

// Each photo gets 3 frames + 1 white flash frame = 4 frames per photo
const FRAMES_PER_PHOTO = 3;
const FLASH_FRAMES = 1;
const SLOT = FRAMES_PER_PHOTO + FLASH_FRAMES;

export const FlashCutSequence: React.FC<Props> = ({ srcs }) => {
  const frame = useCurrentFrame();

  const slot = Math.floor(frame / SLOT);
  const slotFrame = frame % SLOT;
  const src = srcs[Math.min(slot, srcs.length - 1)];

  const isFlash = slotFrame >= FRAMES_PER_PHOTO;

  // Slight alternating rotation per slot
  const rotation = slot % 2 === 0 ? 3 : -3;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: "hidden",
        background: "#000",
      }}
    >
      {!isFlash && src && (
        <Img
          src={src}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `rotate(${rotation}deg) scale(1.08)`,
            filter: "saturate(1.2) contrast(1.1)",
          }}
        />
      )}
      {/* White flash between photos */}
      {isFlash && (
        <div style={{ position: "absolute", inset: 0, background: "#fff" }} />
      )}
    </div>
  );
};

export function flashCutTotalFrames(count: number): number {
  return count * SLOT;
}
