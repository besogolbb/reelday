import { Composition } from "remotion";
import { SdeComposition, calculateDuration } from "./SdeComposition";
import type { SdeInputProps } from "./types";
import { FPS, WIDTH, HEIGHT } from "./types";

const defaultProps: SdeInputProps = {
  chapters: [
    {
      label: "Ceremony",
      clips: [
        {
          key: "test/photo.jpg",
          type: "photo",
          dur: 3,
          src: "https://via.placeholder.com/1080x1350",
          createdAt: new Date().toISOString(),
          reactionCount: 10,
          isPinned: false,
          isLandscape: false,
        },
        {
          key: "test/photo2.jpg",
          type: "photo",
          dur: 3,
          src: "https://via.placeholder.com/1920x1080",
          createdAt: new Date().toISOString(),
          reactionCount: 5,
          isPinned: false,
          isLandscape: true,
        },
      ],
    },
  ],
  totalClips: 2,
  totalReactions: 15,
  heroClipIndex: 0,
  flashCutFrame: 300,
  title: "Maria & Juan",
  subtitle: "May 18, 2026 · Tagaytay",
  endcardText: "Thank you for celebrating with us.",
  coverImageSrc: "https://via.placeholder.com/1920x1080",
  audioSrc: null,
  voiceoverSrc: null,
  qrCodeDataUrl: null,
  eventSlug: "test-event",
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="SdeComposition"
      component={SdeComposition}
      durationInFrames={calculateDuration(defaultProps)}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={defaultProps}
      calculateMetadata={({ props }) => ({
        durationInFrames: calculateDuration(props),
      })}
    />
  );
};
