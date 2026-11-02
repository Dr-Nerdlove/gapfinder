// Before a date is fixed: who would be busy during the proposal. Pure functions; the route reads the calendars.
import type { Interval } from "../gaps/search.js";
import { berlinWallToUtc, parseDateParts } from "../time.js";
import type { PollKind } from "@lueckenfueller/shared";
import type { ProposalRow } from "./store.js";

/**
 * The time a proposal covers, UTC milliseconds, end exclusive. A timed proposal is exactly its start and end; a
 * proposal of days runs from German midnight of the first day to German midnight after the last day.
 */
export function proposalSpan(kind: PollKind, proposal: ProposalRow): Interval {
  if (kind === "timed") return { start: Date.parse(proposal.starts_at!), end: Date.parse(proposal.ends_at!) };
  const first = parseDateParts(proposal.first_date!)!;
  const last = parseDateParts(proposal.last_date!)!;
  return {
    start: berlinWallToUtc(first.year, first.month, first.day, 0).getTime(),
    // 1440 minutes after 00:00 of the last day is 00:00 of the day after it.
    end: berlinWallToUtc(last.year, last.month, last.day, 1440).getTime(),
  };
}

/** True when any non-empty busy interval overlaps the span (touching at an end does not count). */
export function isBusyDuring(busy: readonly Interval[], span: Interval): boolean {
  return busy.some((interval) => interval.end > interval.start && interval.start < span.end && interval.end > span.start);
}
