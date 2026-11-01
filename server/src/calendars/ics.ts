// Turns the text of an iCalendar subscription feed (Google, Apple iCloud, Outlook) into busy/free time
// ranges. Only what the gap search and the owner's preview need is kept: start, end, all-day, busy, title.
//
// Time zones: ical.js finds a VTIMEZONE of the same file by itself (via the TZID of the property), so nothing
// is registered in its global TimezoneService and nothing can leak from one feed into the next. Every other
// wall-clock time (floating, or a TZID without VTIMEZONE) is converted here, with Intl for names it knows and
// Europe/Berlin otherwise.
import ICAL from "ical.js";

export interface CalendarEvent {
  /** Milliseconds since the epoch, UTC. */
  start: number;
  /** Milliseconds, exclusive, never before `start`. */
  end: number;
  allDay: boolean;
  /** False only for TRANSP:TRANSPARENT ("free"). */
  busy: boolean;
  /** SUMMARY, trimmed, "" when missing, at most 200 characters. For the owner's preview only, never stored. */
  title: string;
}

export interface ParsedCalendar {
  /** X-WR-CALNAME, trimmed, at most 100 characters. */
  name: string | null;
  /** Events overlapping the window, sorted by start, then end. */
  events: CalendarEvent[];
  /** True when a limit stopped the expansion: the list may be incomplete. */
  truncated: boolean;
}

/** Limits against feeds that would take forever to expand (e.g. FREQ=MINUTELY from the year 2000). */
const MAX_ITERATOR_STEPS = 100_000;
const MAX_EVENTS = 20_000;
const MAX_TITLE = 200;
const MAX_NAME = 100;

const DAY_MS = 86_400_000;
/** The users live here: all-day events, floating times and unknown zones count as this zone. */
const HOME_ZONE = "Europe/Berlin";

// --- Wall-clock time <-> UTC -------------------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat | null>();

/** Formatter for an IANA zone name, or null when Intl does not know the name (Windows names, nonsense). */
function formatterFor(zone: string): Intl.DateTimeFormat | null {
  const known = formatters.get(zone);
  if (known !== undefined) {
    return known;
  }
  let formatter: Intl.DateTimeFormat | null = null;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
  } catch {
    // RangeError: unknown time zone
  }
  // A hostile feed can name thousands of zones: do not let the cache grow without limit.
  if (formatters.size >= 500) {
    formatters.clear();
  }
  formatters.set(zone, formatter);
  return formatter;
}

/** Milliseconds for the given calendar fields read as UTC (`Date.UTC` would turn years 0-99 into 19xx). */
function utcFromFields(year: number, month: number, day: number, hour: number, minute: number, second: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getTime();
}

/** Wall-clock fields of an ical.js time, as if they were UTC. */
function wallMsOf(time: ICAL.Time): number {
  return utcFromFields(time.year, time.month, time.day, time.hour, time.minute, time.second);
}

/** How many milliseconds the zone is ahead of UTC at the given instant. */
function offsetAt(formatter: Intl.DateTimeFormat, utcMs: number): number {
  const fields: Record<string, number> = {};
  for (const part of formatter.formatToParts(utcMs)) {
    fields[part.type] = Number(part.value);
  }
  const wall = utcFromFields(
    fields.year ?? 1970,
    fields.month ?? 1,
    fields.day ?? 1,
    (fields.hour ?? 0) % 24,
    fields.minute ?? 0,
    fields.second ?? 0,
  );
  return wall - Math.floor(utcMs / 1000) * 1000;
}

/**
 * The instant at which the zone's clock shows the given wall time (`wallMs`: the fields read as UTC).
 * An ambiguous time (clocks go back) takes the first of the two; a time that does not exist (clocks jump
 * forward) moves forward by the length of the jump.
 */
function wallToUtc(wallMs: number, zone: string): number {
  const formatter = formatterFor(zone) ?? formatterFor(HOME_ZONE);
  const year = new Date(wallMs).getUTCFullYear();
  if (!formatter || year < 1 || year > 9999) {
    return wallMs;
  }
  // A day either side is far enough from the wall time to be on the other side of any nearby change.
  const before = offsetAt(formatter, wallMs - DAY_MS);
  const after = offsetAt(formatter, wallMs + DAY_MS);
  let best: number | null = null;
  for (const offset of before === after ? [before] : [before, after]) {
    const utc = wallMs - offset;
    if (offsetAt(formatter, utc) === offset && (best === null || utc < best)) {
      best = utc;
    }
  }
  return best ?? wallMs - before;
}

/** The wall time of the zone at the given instant, as fields read as UTC. */
function utcToWall(utcMs: number, zone: string): number {
  const formatter = formatterFor(zone) ?? formatterFor(HOME_ZONE);
  return formatter ? utcMs + offsetAt(formatter, utcMs) : utcMs;
}

/** True for a time that ical.js reads in a zone it cannot convert itself (floating, unknown TZID). */
function isWallTime(time: ICAL.Time): boolean {
  if (time.isDate || time.zone === ICAL.Timezone.utcTimezone) {
    return false;
  }
  if (time.zone === ICAL.Timezone.localTimezone) {
    return true;
  }
  // A VTIMEZONE without a usable STANDARD/DAYLIGHT part has no changes and would count as UTC. ical.js
  // fills `changes` lazily, so ask it for an offset first.
  time.zone.utcOffset(time);
  return time.zone.changes.length === 0;
}

type ToMs = (time: ICAL.Time) => number;

/** Converter for the times of one property (`DTSTART`, ...): its TZID decides how a wall time is read. */
function resolverFor(property: ICAL.Property): ToMs {
  const tzid = property.getParameter("tzid");
  const zone = typeof tzid === "string" && formatterFor(tzid) ? tzid : HOME_ZONE;
  return (time) => {
    if (time.isDate) {
      return wallToUtc(utcFromFields(time.year, time.month, time.day, 0, 0, 0), HOME_ZONE);
    }
    if (time.zone === ICAL.Timezone.utcTimezone) {
      return wallMsOf(time);
    }
    if (!isWallTime(time)) {
      return time.toUnixTime() * 1000;
    }
    return wallToUtc(wallMsOf(time), zone);
  };
}

// --- One event -----------------------------------------------------------------------------------------------

/** What is needed to place and describe every occurrence of one VEVENT (a series or an override). */
interface EventSpec {
  toMs: ToMs;
  allDay: boolean;
  /** Length of a timed event. */
  durationMs: number;
  /** Length of an all-day event. */
  days: number;
  busy: boolean;
  cancelled: boolean;
  title: string;
  /** Zone name that reads this event's wall times (for aligning UNTIL), or null when not a wall time. */
  wallZone: string | null;
}

function cut(text: string, max: number): string {
  const trimmed = text.trim();
  // Cut by characters, not UTF-16 units, so an emoji is never split in half.
  return trimmed.length > max ? Array.from(trimmed).slice(0, max).join("").trimEnd() : trimmed;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function specOf(event: ICAL.Event): EventSpec | null {
  const component = event.component;
  const startProperty = component.getFirstProperty("dtstart");
  const start = startProperty?.getFirstValue();
  if (!startProperty || !(start instanceof ICAL.Time)) {
    return null;
  }
  const toMs = resolverFor(startProperty);
  const allDay = start.isDate;
  const endProperty = component.getFirstProperty("dtend");
  const end = endProperty?.getFirstValue();
  const duration = component.getFirstPropertyValue("duration");

  let durationMs = 0;
  let days = 0;
  if (endProperty && end instanceof ICAL.Time) {
    if (allDay) {
      const diff = utcFromFields(end.year, end.month, end.day, 0, 0, 0) - utcFromFields(start.year, start.month, start.day, 0, 0, 0);
      days = Math.max(0, Math.round(diff / DAY_MS));
    } else {
      durationMs = Math.max(0, resolverFor(endProperty)(end) - toMs(start));
    }
  } else if (duration instanceof ICAL.Duration) {
    const seconds = Math.max(0, duration.toSeconds());
    durationMs = seconds * 1000;
    days = Math.ceil(seconds / 86_400);
  } else if (allDay) {
    days = 1;
  }

  const tzid = startProperty.getParameter("tzid");
  return {
    toMs,
    allDay,
    durationMs,
    days,
    busy: textOf(component.getFirstPropertyValue("transp")).toUpperCase() !== "TRANSPARENT",
    cancelled: textOf(component.getFirstPropertyValue("status")).toUpperCase() === "CANCELLED",
    title: cut(textOf(component.getFirstPropertyValue("summary")), MAX_TITLE),
    wallZone: isWallTime(start) ? (typeof tzid === "string" && formatterFor(tzid) ? tzid : HOME_ZONE) : null,
  };
}

/**
 * ical.js compares UNTIL with the occurrences as plain numbers, which is only right when both are in the same
 * kind of time. UNTIL is in UTC, but an occurrence read as a wall time carries the clock of the event's zone:
 * without a conversion the last occurrence of a series would be lost whenever the zone is ahead of UTC. A
 * plain date as UNTIL of a timed event (some producers write that) means the whole day.
 */
function alignUntil(event: ICAL.Event, start: ICAL.Time, wallZone: string | null): void {
  if (start.isDate) {
    return;
  }
  for (const property of event.component.getAllProperties("rrule")) {
    const rule = property.getFirstValue();
    if (!(rule instanceof ICAL.Recur) || !rule.until) {
      continue;
    }
    const until = rule.until;
    if (until.isDate) {
      rule.until = new ICAL.Time(
        { year: until.year, month: until.month, day: until.day, hour: 23, minute: 59, second: 59 },
        start.zone,
      );
    } else if (wallZone && until.zone === ICAL.Timezone.utcTimezone) {
      const wall = new Date(utcToWall(wallMsOf(until), wallZone));
      rule.until = new ICAL.Time(
        {
          year: wall.getUTCFullYear(),
          month: wall.getUTCMonth() + 1,
          day: wall.getUTCDate(),
          hour: wall.getUTCHours(),
          minute: wall.getUTCMinutes(),
          second: wall.getUTCSeconds(),
        },
        ICAL.Timezone.localTimezone,
      );
    }
  }
}

// --- The whole feed --------------------------------------------------------------------------------------------

export function parseCalendar(text: string, window: { start: Date; end: Date }): ParsedCalendar | null {
  try {
    const jcal: unknown = ICAL.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    // One VCALENDAR is `["vcalendar", ...]`; several would come back as a list of those.
    if (!Array.isArray(jcal) || jcal[0] !== "vcalendar") {
      return null;
    }
    return collect(new ICAL.Component(jcal), window.start.getTime(), window.end.getTime());
  } catch {
    return null;
  }
}

function collect(root: ICAL.Component, windowStart: number, windowEnd: number): ParsedCalendar {
  const events: CalendarEvent[] = [];
  let truncated = false;
  const specs = new Map<ICAL.Event, EventSpec | null>();

  const specFor = (event: ICAL.Event): EventSpec | null => {
    if (!specs.has(event)) {
      specs.set(event, specOf(event));
    }
    return specs.get(event) ?? null;
  };

  /** Adds one occurrence if it is not cancelled and overlaps the window. */
  const emit = (event: ICAL.Event, start: ICAL.Time): void => {
    const spec = specFor(event);
    if (!spec || spec.cancelled) {
      return;
    }
    const startMs = spec.toMs(start);
    const endMs = spec.allDay
      ? wallToUtc(utcFromFields(start.year, start.month, start.day + spec.days, 0, 0, 0), HOME_ZONE)
      : startMs + spec.durationMs;
    // A zero-length event counts when its instant lies inside the window.
    if (Number.isNaN(startMs) || startMs >= windowEnd || (endMs <= windowStart && startMs < windowStart)) {
      return;
    }
    if (events.length >= MAX_EVENTS) {
      truncated = true;
      return;
    }
    events.push({ start: startMs, end: Math.max(startMs, endMs), allDay: spec.allDay, busy: spec.busy, title: spec.title });
  };

  /** Walks the occurrences of one event up to the end of the window. True when a limit stopped it. */
  const expand = (event: ICAL.Event): boolean => {
    const spec = specFor(event);
    const consumed = new Set<ICAL.Event>();
    // The overrides that relateException accepted (it keeps the last one per RECURRENCE-ID).
    const related = Object.values(event.exceptions) as ICAL.Event[];
    let limited = false;
    const start = event.startDate;
    if (spec && !spec.cancelled && start instanceof ICAL.Time) {
      let next: () => ICAL.Time | undefined;
      // With a rule the occurrences come in ascending order; RDATEs alone are not sorted against DTSTART.
      let ordered = false;
      if (event.isRecurring()) {
        alignUntil(event, start, spec.wallZone);
        const iterator = event.iterator();
        ordered = event.component.hasProperty("rrule");
        // DTSTART is the first occurrence, but ical.js only yields it when a rule produces it.
        let first: ICAL.Time | undefined = ordered ? undefined : start;
        next = () => {
          const time = first ?? iterator.next();
          first = undefined;
          return time;
        };
      } else {
        let single: ICAL.Time | undefined = start;
        next = () => {
          const time = single;
          single = undefined;
          return time;
        };
      }
      for (let steps = 0; !truncated; steps++) {
        if (steps >= MAX_ITERATOR_STEPS) {
          limited = true;
          break;
        }
        const occurrence = next();
        // Nothing after the end of the window can matter.
        if (!occurrence || (ordered && spec.toMs(occurrence) >= windowEnd)) {
          break;
        }
        if (related.length === 0) {
          emit(event, occurrence);
          continue;
        }
        const details = event.getOccurrenceDetails(occurrence);
        const owner = details.item as ICAL.Event;
        if (owner !== event) {
          consumed.add(owner);
        }
        emit(owner, details.startDate);
      }
    }
    // An override whose original date was not walked (after the window, or the series is cancelled or
    // over) is moved into the window on its own: it counts on its own date.
    for (const override of related) {
      const overrideStart = override.startDate;
      if (!consumed.has(override) && overrideStart instanceof ICAL.Time) {
        emit(override, overrideStart);
      }
    }
    return limited;
  };

  // Series, single events and overrides (RECURRENCE-ID) belong together by UID.
  const masters = new Map<string, ICAL.Component[]>();
  const overrides = new Map<string, ICAL.Component[]>();
  const loose: ICAL.Component[] = [];
  for (const component of root.getAllSubcomponents("vevent")) {
    const uid = textOf(component.getFirstPropertyValue("uid"));
    if (!uid) {
      loose.push(component);
    } else {
      const target = component.hasProperty("recurrence-id") ? overrides : masters;
      target.set(uid, [...(target.get(uid) ?? []), component]);
    }
  }

  const work: { component: ICAL.Component; overrides: ICAL.Component[] }[] = loose.map((component) => ({ component, overrides: [] }));
  for (const [uid, list] of masters) {
    // A second VEVENT with the same UID is a duplicate, not a second owner of the overrides.
    list.forEach((component, index) => work.push({ component, overrides: index === 0 ? (overrides.get(uid) ?? []) : [] }));
  }
  for (const [uid, list] of overrides) {
    if (!masters.has(uid)) {
      // Only an instance of a series was shared with us: it is an ordinary event.
      list.forEach((component) => work.push({ component, overrides: [] }));
    }
  }

  for (const item of work) {
    if (truncated) {
      break;
    }
    try {
      // `exceptions` is given explicitly: otherwise ical.js relates every override of the whole file.
      const event = new ICAL.Event(item.component, { exceptions: [] });
      for (const override of item.overrides) {
        try {
          event.relateException(override);
        } catch {
          // an override without a usable RECURRENCE-ID is skipped
        }
      }
      if (expand(event)) {
        truncated = true;
      }
    } catch {
      // a broken VEVENT is skipped, the others still count
    }
  }

  events.sort((a, b) => a.start - b.start || a.end - b.end);
  // ical.js does not know X-WR-CALNAME as text, so the escapes (`\,` `\;` `\n` `\\`) are still in it.
  const rawName = textOf(root.getFirstPropertyValue("x-wr-calname")).replace(/\\([nN,;\\])/g, (_m, c: string) =>
    c === "n" || c === "N" ? " " : c,
  );
  const name = cut(rawName, MAX_NAME);
  return { name: name || null, events, truncated };
}
