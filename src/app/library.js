import { membershipMap } from '../lib.js';

/**
 * Display rows combine shared video metadata with one user's memberships and notes.
 * They are derived, not persisted, so the same rows serve every screen.
 */
export function buildLibraryRows(library) {
  const membershipByVideo = membershipMap(library.entries, library.playlists);
  const userMetadataByVideo = new Map(library.meta.map((meta) => [meta.video_id, meta]));

  return library.videos.map((video) => ({
    ...video,
    memberships: membershipByVideo.get(video.id) ?? [],
    userMeta: userMetadataByVideo.get(video.id) ?? null,
  }));
}

/**
 * Count only active playlist entries. A video present in three playlists
 * counts once as a duplicated video, but contributes two extra registrations.
 */
export function countLibrary(library) {
  const activeEntries = library.entries.filter((entry) => entry.present !== false);
  const occurrences = new Map();

  for (const entry of activeEntries) {
    occurrences.set(entry.video_id, (occurrences.get(entry.video_id) ?? 0) + 1);
  }

  return {
    videos: library.videos.length,
    entries: activeEntries.length,
    duplicates: [...occurrences.values()].filter((count) => count > 1).length,
    tracked: occurrences.size,
  };
}
