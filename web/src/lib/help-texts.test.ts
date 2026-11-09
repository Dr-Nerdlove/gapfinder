import {
  CALENDAR_CACHE_MINUTES,
  DAYS_SEARCH_MIN_EVENT_HOURS,
  NEAR_MISS_MIN_PEOPLE,
  SEARCH_DEFAULT_WINDOW,
  SEARCH_MAX_BUFFER_MINUTES,
} from "@lueckenfueller/shared";
import { describe, expect, it } from "vitest";
import { HELP_TEXTS, helpSegments, type HelpTopic } from "./help-texts";

const topics = Object.keys(HELP_TEXTS) as HelpTopic[];
const all = (topic: HelpTopic) => HELP_TEXTS[topic].paragraphs.join(" ");

describe("HELP_TEXTS", () => {
  it("has 11 topics, each with a title and paragraphs", () => {
    expect(topics).toHaveLength(11);
    for (const topic of topics) {
      expect(HELP_TEXTS[topic].title.trim()).not.toBe("");
      expect(HELP_TEXTS[topic].paragraphs.length).toBeGreaterThan(0);
      for (const paragraph of HELP_TEXTS[topic].paragraphs) expect(paragraph.trim()).not.toBe("");
    }
  });

  it("leaves no ** after segmenting", () => {
    for (const topic of topics) {
      for (const paragraph of HELP_TEXTS[topic].paragraphs) {
        expect(helpSegments(paragraph).some((s) => s.text.includes("**"))).toBe(false);
      }
    }
  });

  it("takes its numbers from the constants", () => {
    expect(all("calendarBusy")).toContain(`ab ${DAYS_SEARCH_MIN_EVENT_HOURS} Stunden`);
    expect(all("searchKind")).toContain(`${DAYS_SEARCH_MIN_EVENT_HOURS} Stunden oder länger`);
    expect(all("searchBuffer")).toContain(`bis zu ${SEARCH_MAX_BUFFER_MINUTES / 60} Stunden`);
    expect(all("searchWindow")).toContain(
      `${Number(SEARCH_DEFAULT_WINDOW.start.slice(0, 2))} bis ${Number(SEARCH_DEFAULT_WINDOW.end.slice(0, 2))} Uhr`,
    );
    expect(all("resultsPartial")).toContain(`ab ${NEAR_MISS_MIN_PEOPLE} Personen`);
    expect(all("calendarPreview")).toContain(`${CALENDAR_CACHE_MINUTES} Minuten`);
  });
});

describe("helpSegments", () => {
  it("returns plain text as one segment", () => {
    expect(helpSegments("Nur Text.")).toEqual([{ text: "Nur Text.", strong: false }]);
  });

  it("splits bold in the middle", () => {
    expect(helpSegments("a **b** c")).toEqual([
      { text: "a ", strong: false },
      { text: "b", strong: true },
      { text: " c", strong: false },
    ]);
  });

  it("handles bold at the start and at the end", () => {
    expect(helpSegments("**a** b")).toEqual([
      { text: "a", strong: true },
      { text: " b", strong: false },
    ]);
    expect(helpSegments("a **b**")).toEqual([
      { text: "a ", strong: false },
      { text: "b", strong: true },
    ]);
  });

  it("handles several bold parts", () => {
    expect(helpSegments("**a** und **b**").map((s) => s.strong)).toEqual([true, false, true]);
  });

  it("keeps an unmatched ** literal", () => {
    expect(helpSegments("a ** b")).toEqual([{ text: "a ** b", strong: false }]);
    expect(helpSegments("**a** b ** c")).toEqual([
      { text: "a", strong: true },
      { text: " b ** c", strong: false },
    ]);
  });
});
