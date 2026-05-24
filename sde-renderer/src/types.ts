export type ClipType = "photo" | "video";

export interface Clip {
  key: string;
  type: ClipType;
  dur: number;           // seconds
  src: string;           // sharp source — CDN-resized 1920px photo OR presigned video URL
  blurSrc?: string;      // photo only: low-res (480px) variant for blurred background
  posterSrc?: string;    // video only: CDN-resized poster JPEG for blur-bg + freeze frame
  frameBaseUrl?: string; // video only: HTTP base URL for pre-extracted JPEG frames (http://127.0.0.1:3500/v-3)
  frameCount?: number;   // video only: number of pre-extracted frames available
  createdAt: string;     // ISO timestamp — used for chapter grouping
  reactionCount: number; // for hero moment detection
  isPinned: boolean;     // for slow-motion treatment on videos
  ambientSrc?: string;   // presigned URL for extracted ambient audio (-18dB)
  isLandscape?: boolean; // true = horizontal pan instead of Ken Burns
}

export interface Chapter {
  label: string;
  clips: Clip[];
}

export interface SdeInputProps {
  // Clip data
  chapters: Chapter[];
  totalClips: number;
  totalReactions: number;
  heroClipIndex: number;       // index in flat clip list — highest reaction_count
  flashCutFrame: number;       // frame number of audio amplitude peak

  // Cards
  title: string | null;
  subtitle: string | null;
  endcardText: string | null;
  coverImageSrc: string | null; // public URL for blurred bg

  // Audio
  audioSrc: string | null;      // presigned URL for music bed
  voiceoverSrc: string | null;  // local /tmp path or presigned URL

  // End card extras
  qrCodeDataUrl: string | null;
  eventSlug: string;
}

// 24fps — cinema standard. Cuts ~20% off render time vs 30fps for the same
// wall-clock content and looks more filmic, not less. All frame-count
// constants below derive from FPS so changing fps doesn't change timings.
export const FPS = 24;
export const WIDTH = 1920;
export const HEIGHT = 1080;

// Section durations in seconds. Frame counts derived below.
export const FILM_LEADER_SEC = 3;
export const TITLE_SEC = 5;
export const CHAPTER_MARKER_SEC = 1;
export const END_CARD_SEC = 5;
export const SLATE_SEC = 2;
export const LETTERBOX_ANIM_SEC = 1;
export const DEFAULT_PHOTO_SEC = 3;
export const HERO_SEC = 5;
export const COLLAGE_SEC = 2;
export const TRANSITION_SEC = 0.5;

export const FILM_LEADER_FRAMES    = Math.round(FILM_LEADER_SEC * FPS);
export const TITLE_FRAMES          = Math.round(TITLE_SEC * FPS);
export const CHAPTER_MARKER_FRAMES = Math.round(CHAPTER_MARKER_SEC * FPS);
export const END_CARD_FRAMES       = Math.round(END_CARD_SEC * FPS);
export const SLATE_FRAMES          = Math.round(SLATE_SEC * FPS);
export const LETTERBOX_ANIM_FRAMES = Math.round(LETTERBOX_ANIM_SEC * FPS);
export const DEFAULT_PHOTO_FRAMES  = Math.round(DEFAULT_PHOTO_SEC * FPS);
export const HERO_FRAMES           = Math.round(HERO_SEC * FPS);
export const COLLAGE_FRAMES        = Math.round(COLLAGE_SEC * FPS);
export const TRANSITION_FRAMES     = Math.round(TRANSITION_SEC * FPS);

// Flash cut: kept at 3 source frames per photo. At 24fps that's 0.125s per
// photo — slightly faster than the previous 0.1s at 30fps, still readable.
export const FLASH_CUT_FRAMES_PER_PHOTO = 3;
