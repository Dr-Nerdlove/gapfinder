import { defaultStorage } from "./session-storage";

/** Where this device remembers for which users the tour was shown: a JSON list of user ids. */
export const TOUR_KEY = "lueckenfueller.tour-seen";

function readList(storage: Storage | null): number[] | null {
  try {
    const raw = storage?.getItem(TOUR_KEY);
    if (raw === null || raw === undefined) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === "number")) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Whether the tour was already shown to this user on this device. Without working storage (missing, blocked or
 * garbage) this is true: better no tour than a tour on every visit.
 */
export function tourSeen(userId: number, storage: Storage | null = defaultStorage()): boolean {
  if (!storage) return true;
  const list = readList(storage);
  return list === null || list.includes(userId);
}

/** Remembers that the tour was shown to this user. Never throws. */
export function markTourSeen(userId: number, storage: Storage | null = defaultStorage()): void {
  try {
    if (!storage) return;
    const list = readList(storage) ?? [];
    if (!list.includes(userId)) list.push(userId);
    storage.setItem(TOUR_KEY, JSON.stringify(list));
  } catch {
    // Without storage the tour is simply not shown again (see tourSeen).
  }
}
