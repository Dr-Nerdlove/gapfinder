// Its own file, so that it runs in a fresh worker: the heap of a worker that ran other tests before is not a
// reliable measure.
import v8 from "node:v8";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { parseCalendar } from "../src/calendars/ics.js";

const WIDE = { start: new Date("2025-01-01T00:00:00Z"), end: new Date("2029-01-01T00:00:00Z") };
const cal = (body: string): string => `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//test//EN\n${body}\nEND:VCALENDAR\n`;

describe("memory", () => {
  it("keeps no part of the feed text alive through the parsed calendar (it stays in the cache)", async () => {
    // `gc` is only there with --expose-gc; a new context made after setting the flag has it.
    v8.setFlagsFromString("--expose-gc");
    const gc = runInNewContext("gc") as () => void;
    const heapUsed = async (): Promise<number> => {
      // The last string a regular expression ran on stays reachable (RegExp.input); point it at a short one.
      /x/.exec("x");
      // Node 24 still holds the feed for a moment right after the parse: measure on a later turn, twice.
      for (let round = 0; round < 2; round++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        for (let i = 0; i < 4; i++) gc();
      }
      return process.memoryUsage().heapUsed;
    };
    const parse = (): ReturnType<typeof parseCalendar> => {
      // About 8 MB of text, but only 300 events with a title each: what has to stay is far below 1 MB.
      const body = Array.from({ length: 300 }, (_, i) => {
        const day = String(1 + (i % 28)).padStart(2, "0");
        return `BEGIN:VEVENT\nUID:${i}@test\nDTSTAMP:20260101T000000Z\nDTSTART:202607${day}T100000Z\nDTEND:202607${day}T110000Z\nSUMMARY:  Ein ziemlich langer Titel Nummer ${i}  \nDESCRIPTION:${"x".repeat(27_000)}\nEND:VEVENT`;
      }).join("\n");
      return parseCalendar(cal(body), WIDE);
    };
    const before = await heapUsed();
    const parsed = parse();
    const kept = (await heapUsed()) - before;

    expect(parsed?.events).toHaveLength(300);
    expect(parsed?.events[0]?.title).toBe("Ein ziemlich langer Titel Nummer 0");
    expect(kept).toBeLessThan(2 * 1024 * 1024);
  });
});
