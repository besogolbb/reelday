export type ClipType = "photo" | "video";

export interface Clip {
  key: string;
  type: ClipType;
  dur: number;           // seconds
  src: string;           // sharp source — CDN-resized 1920px photo OR presigned video URL
  blurSrc?: string;      // photo only: low-res (480px) variant for blurred background
  posterSrc?: string;    // video only: CDN-resized poster JPEG for blur-bg + freeze frame
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

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export const FILM_LEADER_FRAMES = 90;   // 3s
export const TITLE_FRAMES = 150;        // 5s
export const CHAPTER_MARKER_FRAMES = 30; // 1s
export const END_CARD_FRAMES = 150;     // 5s
export const SLATE_FRAMES = 60;        // 2s
export const LETTERBOX_ANIM_FRAMES = 30; // 1s
export const DEFAULT_PHOTO_FRAMES = 90;  // 3s
export const HERO_FRAMES = 150;          // 5s (was 8s — trimmed to halve hero decode work)
export const COLLAGE_FRAMES = 60;        // 2s
export const FLASH_CUT_FRAMES_PER_PHOTO = 3;
export const TRANSITION_FRAMES = 15;    // 0.5s overlap
