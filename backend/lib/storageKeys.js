// Maps a stored media URL back to its R2 object key. Used both by the
// per-upload deleter (routes/uploads.js) and the event-wipe reaper
// (routes/admin.js) — keep it here so the two can never drift apart and
// leave orphaned objects behind.
//
// Primary path: parse as a URL and take the (decoded) pathname. Fallback
// (for already-relative or malformed values): grab everything from the
// last `uploads/` segment onward.
export function extractStorageKey(fileUrl) {
  if (!fileUrl) return null;

  try {
    const parsed = new URL(fileUrl);
    return decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  } catch {
    const match = String(fileUrl).match(/(?:^|\/)(uploads\/.+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  }
}
