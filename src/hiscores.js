// @ts-check

/** @typedef {{name: string, score: number}} Entry */

const STORAGE_KEY = 'brix.hiscores';
const SIZE = 10;
export const DEFAULT_NAME = 'MR. NOBODY';

/** @returns {Entry[]} */
function defaults() {
  return Array.from({ length: SIZE }, (_, i) => ({ name: DEFAULT_NAME, score: (SIZE - i) * 2000 }));
}

/** @returns {Entry[]} */
export function loadHiscores() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (Array.isArray(stored) && stored.length === SIZE) {
      return stored.map((entry) => ({ name: String(entry.name), score: Number(entry.score) }));
    }
  } catch {
    // Unavailable or corrupted storage just means a fresh table.
  }
  return defaults();
}

/** @param {Entry[]} entries */
function saveHiscores(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Private browsing: the scores only last for this session.
  }
}

/**
 * @param {Entry[]} entries
 * @param {number} score
 * @returns {number} 0-based place the score would take, or -1
 */
export function placeFor(entries, score) {
  return entries.findIndex((entry) => score > entry.score);
}

/**
 * @param {Entry[]} entries
 * @param {Entry} entry
 * @returns {Entry[]}
 */
export function insertHiscore(entries, entry) {
  const place = placeFor(entries, entry.score);
  if (place < 0) {
    return entries;
  }
  const updated = [...entries.slice(0, place), entry, ...entries.slice(place)].slice(0, SIZE);
  saveHiscores(updated);
  return updated;
}
