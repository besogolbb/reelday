import { useCurrentFrame, AbsoluteFill, Sequence, Audio } from "remotion";
import type { SdeInputProps, Clip } from "./types";
import {
  FPS,
  FILM_LEADER_FRAMES,
  TITLE_FRAMES,
  CHAPTER_MARKER_FRAMES,
  END_CARD_FRAMES,
  SLATE_FRAMES,
  LETTERBOX_ANIM_FRAMES,
  DEFAULT_PHOTO_FRAMES,
  HERO_FRAMES,
  COLLAGE_FRAMES,
  TRANSITION_FRAMES,
} from "./types";
import { FilmLeader } from "./components/FilmLeader";
import { TitleCard } from "./components/TitleCard";
import { ChapterMarker } from "./components/ChapterMarker";
import { PhotoClip } from "./components/PhotoClip";
import { VideoClip } from "./components/VideoClip";
import { HeroMoment } from "./components/HeroMoment";
import { FlashCutSequence, flashCutTotalFrames } from "./components/FlashCutSequence";
import { Collage } from "./components/Collage";
import { EndCard } from "./components/EndCard";
import { ReeldaySlate } from "./components/ReeldaySlate";
import { LetterboxBars } from "./components/overlays/LetterboxBars";

// Transition types cycle across clips
type TransitionType = "crossfade" | "dip" | "zoompush";
function transitionAt(index: number): TransitionType {
  return (["crossfade", "dip", "zoompush"] as TransitionType[])[index % 3];
}

// Flatten chapters into a single clip list with flat index
function flattenClips(chapters: SdeInputProps["chapters"]): Clip[] {
  return chapters.flatMap((ch) => ch.clips);
}

// Build a sequence of { clip, startFrame, durationInFrames, anchorIndex, chapterLabel } entries
interface ClipEntry {
  clip: Clip;
  startFrame: number;
  durationInFrames: number;
  anchorIndex: number;
  flatIndex: number;
  chapterLabel?: string;   // set on first clip of each chapter
  isFlashCut: boolean;
  flashCutSrcs?: string[]; // populated when isFlashCut
  isCollage: boolean;
  collageSrcs?: string[];
}

function buildTimeline(
  props: SdeInputProps
): { entries: ClipEntry[]; totalClipFrames: number } {
  const allClips = flattenClips(props.chapters);
  const entries: ClipEntry[] = [];
  let cursor = 0;
  let anchorIndex = 0;
  let flatIndex = 0;
  let flashCutInserted = false;

  for (let ci = 0; ci < props.chapters.length; ci++) {
    const chapter = props.chapters[ci];

    for (let i = 0; i < chapter.clips.length; i++) {
      const clip = chapter.clips[i];
      const isFirst = i === 0;
      const isHero = flatIndex === props.heroClipIndex;
      const chapterLabel = isFirst ? chapter.label : undefined;

      // Insert collage at chapter boundary (≥3 chapters, first clip of chapter 1+)
      const doCollage =
        ci > 0 && isFirst && props.chapters.length >= 3 && chapter.clips.length >= 2;

      // Insert flash cut sequence before hero (only once)
      const doFlash = isHero && !flashCutInserted && flatIndex > 0;

      if (doCollage) {
        const collageSrcs = chapter.clips
          .filter((c) => c.type === "photo")
          .slice(0, 4)
          .map((c) => c.src);
        if (collageSrcs.length >= 2) {
          entries.push({
            clip,
            startFrame: cursor,
            durationInFrames: COLLAGE_FRAMES,
            anchorIndex,
            flatIndex,
            chapterLabel,
            isFlashCut: false,
            isCollage: true,
            collageSrcs,
          });
          cursor += COLLAGE_FRAMES;
        }
      }

      if (doFlash) {
        // Grab 6 nearby clips for flash cut
        const flashSrcs = allClips
          .slice(Math.max(0, flatIndex - 3), flatIndex + 3)
          .filter((c) => c.type === "photo")
          .slice(0, 8)
          .map((c) => c.src);
        if (flashSrcs.length >= 4) {
          entries.push({
            clip,
            startFrame: cursor,
            durationInFrames: flashCutTotalFrames(flashSrcs.length),
            anchorIndex,
            flatIndex,
            isFlashCut: true,
            flashCutSrcs: flashSrcs,
            isCollage: false,
          });
          cursor += flashCutTotalFrames(flashSrcs.length);
          flashCutInserted = true;
        }
      }

      const clipFrames = isHero
        ? HERO_FRAMES
        : clip.type === "photo"
        ? DEFAULT_PHOTO_FRAMES
        : Math.round(clip.dur * FPS);

      entries.push({
        clip,
        startFrame: cursor,
        durationInFrames: clipFrames,
        anchorIndex,
        flatIndex,
        chapterLabel: doCollage ? undefined : chapterLabel,
        isFlashCut: false,
        isCollage: false,
      });

      cursor += clipFrames - (isHero ? 0 : TRANSITION_FRAMES);
      anchorIndex++;
      flatIndex++;
    }
  }

  return { entries, totalClipFrames: cursor + TRANSITION_FRAMES };
}

export function calculateDuration(props: SdeInputProps): number {
  const { totalClipFrames } = buildTimeline(props);
  return (
    FILM_LEADER_FRAMES +
    TITLE_FRAMES +
    LETTERBOX_ANIM_FRAMES + // bars animate in
    totalClipFrames +
    LETTERBOX_ANIM_FRAMES + // bars animate out
    END_CARD_FRAMES +
    SLATE_FRAMES
  );
}

export const SdeComposition: React.FC<SdeInputProps> = (props) => {
  const { chapters, title, subtitle, endcardText, coverImageSrc,
    audioSrc, voiceoverSrc, qrCodeDataUrl, eventSlug,
    totalClips, totalReactions, heroClipIndex, flashCutFrame } = props;

  const { entries, totalClipFrames } = buildTimeline(props);
  const totalFrames = calculateDuration(props);

  // Timeline offsets
  const leaderStart = 0;
  const titleStart = FILM_LEADER_FRAMES;
  const clipsStart = titleStart + TITLE_FRAMES + LETTERBOX_ANIM_FRAMES;
  const endCardStart = clipsStart + totalClipFrames + LETTERBOX_ANIM_FRAMES;
  const slateStart = endCardStart + END_CARD_FRAMES;
  const barsStart = titleStart + TITLE_FRAMES;
  const barsEnd = clipsStart + totalClipFrames;

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {/* Film leader */}
      <Sequence from={leaderStart} durationInFrames={FILM_LEADER_FRAMES}>
        <FilmLeader />
      </Sequence>

      {/* Title card */}
      <Sequence from={titleStart} durationInFrames={TITLE_FRAMES}>
        <TitleCard
          title={title}
          subtitle={subtitle}
          coverImageSrc={coverImageSrc}
          voiceoverSrc={voiceoverSrc}
          durationInFrames={TITLE_FRAMES}
        />
      </Sequence>

      {/* Guest clips */}
      {entries.map((entry, i) => {
        const from = clipsStart + entry.startFrame;

        if (entry.isFlashCut && entry.flashCutSrcs) {
          return (
            <Sequence key={`flash-${i}`} from={from} durationInFrames={entry.durationInFrames}>
              <FlashCutSequence srcs={entry.flashCutSrcs} />
            </Sequence>
          );
        }

        if (entry.isCollage && entry.collageSrcs) {
          return (
            <Sequence key={`collage-${i}`} from={from} durationInFrames={entry.durationInFrames}>
              {entry.chapterLabel && (
                <ChapterMarker label={entry.chapterLabel} durationInFrames={entry.durationInFrames} />
              )}
              <Collage srcs={entry.collageSrcs} durationInFrames={entry.durationInFrames} />
            </Sequence>
          );
        }

        const isHero = entry.flatIndex === heroClipIndex;

        if (isHero) {
          return (
            <Sequence key={`hero-${i}`} from={from} durationInFrames={entry.durationInFrames}>
              <HeroMoment
                src={entry.clip.src}
                type={entry.clip.type}
                posterSrc={entry.clip.posterSrc}
                isLandscape={entry.clip.isLandscape ?? false}
                durationInFrames={entry.durationInFrames}
              />
            </Sequence>
          );
        }

        return (
          <Sequence key={`clip-${i}`} from={from} durationInFrames={entry.durationInFrames}>
            {entry.chapterLabel && (
              <ChapterMarker
                label={entry.chapterLabel}
                durationInFrames={CHAPTER_MARKER_FRAMES}
              />
            )}
            {entry.clip.type === "photo" ? (
              <PhotoClip
                src={entry.clip.src}
                blurSrc={entry.clip.blurSrc}
                durationInFrames={entry.durationInFrames}
                isLandscape={entry.clip.isLandscape ?? false}
                anchorIndex={entry.anchorIndex}
                clipIndex={entry.flatIndex}
                totalClips={totalClips}
              />
            ) : (
              <VideoClip
                src={entry.clip.src}
                posterSrc={entry.clip.posterSrc}
                durationInFrames={entry.durationInFrames}
                isPinned={entry.clip.isPinned}
                ambientSrc={entry.clip.ambientSrc}
                clipIndex={entry.flatIndex}
                totalClips={totalClips}
              />
            )}
          </Sequence>
        );
      })}

      {/* Letterbox bars over clip section */}
      <Sequence from={barsStart} durationInFrames={barsEnd - barsStart + LETTERBOX_ANIM_FRAMES}>
        <LetterboxBars
          totalFrames={barsEnd - barsStart + LETTERBOX_ANIM_FRAMES}
          animInFrames={LETTERBOX_ANIM_FRAMES}
          animOutFrames={LETTERBOX_ANIM_FRAMES}
        />
      </Sequence>

      {/* End card */}
      <Sequence from={endCardStart} durationInFrames={END_CARD_FRAMES}>
        <EndCard
          endcardText={endcardText}
          coverImageSrc={coverImageSrc}
          totalClips={totalClips}
          totalReactions={totalReactions}
          qrCodeDataUrl={qrCodeDataUrl}
          eventSlug={eventSlug}
          durationInFrames={END_CARD_FRAMES}
        />
      </Sequence>

      {/* Reelday slate */}
      <Sequence from={slateStart} durationInFrames={SLATE_FRAMES}>
        <ReeldaySlate durationInFrames={SLATE_FRAMES} />
      </Sequence>

      {/* Music bed — full duration, duck under voice over */}
      {audioSrc && (
        <Audio
          src={audioSrc}
          volume={(f) => {
            // Fade in over first 45f, fade out over last 45f
            const fadeIn = Math.min(1, f / 45);
            const fadeOut = Math.min(1, (totalFrames - f) / 45);
            // Duck to 0.4 during voice over (title + first 150f of clips)
            const voiceDuck =
              voiceoverSrc && f >= titleStart && f < clipsStart + 150 ? 0.4 : 1.0;
            return Math.min(fadeIn, fadeOut) * voiceDuck;
          }}
        />
      )}
    </AbsoluteFill>
  );
};
