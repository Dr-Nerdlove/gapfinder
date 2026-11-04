import type { PollPerson, PollView, VoteView } from "@lueckenfueller/shared";
import { describe, expect, it } from "vitest";
import { reminderResultText, reminderState } from "./reminder";

const person = (id: number, username: string): PollPerson => ({ id, username, seedColor: null });
const anna = person(1, "Anna");
const ben = person(2, "Ben");
const cora = person(3, "Cora");
const vote = (personId: number): VoteView => ({ id: personId, name: "x", personId, answers: [], updatedAt: "2026-11-01T10:00:00.000Z" });

function poll(changes: Partial<PollView> = {}): PollView {
  return {
    id: 7,
    title: "Grillen",
    creator: anna,
    participants: [anna, ben, cora],
    votes: [vote(1)],
    proposals: [{ id: 1, start: "2026-12-12T13:00:00.000Z", end: "2026-12-12T16:00:00.000Z" }],
    closed: false,
    open: true,
    fixedProposalId: null,
    lastReminderAt: null,
    ...changes,
  } as unknown as PollView;
}

// 2026-11-04 15:00 Berlin (CET, UTC+1)
const NOW = new Date("2026-11-04T14:00:00.000Z");
const at = (iso: string) => poll({ lastReminderAt: iso });

describe("reminderState: who sees the card", () => {
  it("shows it to the creator while someone has not voted", () => {
    expect(reminderState(poll(), 1, NOW)).toEqual({ show: true, canSend: true, sentText: null, nextText: null });
  });

  it("hides it when everyone has voted", () => {
    expect(reminderState(poll({ votes: [vote(1), vote(2), vote(3)] }), 1, NOW)).toEqual({ show: false });
  });

  it("does not count the creator as someone who still has to vote", () => {
    expect(reminderState(poll({ votes: [vote(2), vote(3)] }), 1, NOW)).toEqual({ show: false });
  });

  it("hides it for everyone but the creator, an admin included", () => {
    expect(reminderState(poll(), 2, NOW)).toEqual({ show: false });
    expect(reminderState(poll(), 99, NOW)).toEqual({ show: false });
    expect(reminderState(poll(), null, NOW)).toEqual({ show: false });
    expect(reminderState(poll({ creator: null }), 1, NOW)).toEqual({ show: false });
  });

  it("hides it for a fixed, closed or expired poll", () => {
    expect(reminderState(poll({ fixedProposalId: 1, open: false }), 1, NOW)).toEqual({ show: false });
    expect(reminderState(poll({ closed: true, open: false }), 1, NOW)).toEqual({ show: false });
    expect(reminderState(poll({ open: false }), 1, NOW)).toEqual({ show: false });
  });

  it("hides it on an older server that does not send the field", () => {
    const old = poll();
    delete old.lastReminderAt;
    expect(reminderState(old, 1, NOW)).toEqual({ show: false });
  });
});

describe("reminderState: the 24 hour limit", () => {
  it("blocks sending within 24 hours and says when it is possible again", () => {
    expect(reminderState(at("2026-11-04T13:05:00.000Z"), 1, NOW)).toEqual({
      show: true,
      canSend: false,
      sentText: "Erinnerung gesendet heute um 14:05",
      nextText: "Die nächste geht ab morgen 14:05.",
    });
    expect(reminderState(at("2026-11-03T15:30:00.000Z"), 1, NOW)).toEqual({
      show: true,
      canSend: false,
      sentText: "Erinnerung gesendet gestern um 16:30",
      nextText: "Die nächste geht ab heute 16:30.",
    });
  });

  it("allows sending exactly 24 hours later and after", () => {
    const edge = reminderState(at("2026-11-03T14:00:00.000Z"), 1, NOW);
    expect(edge).toMatchObject({ show: true, canSend: true, nextText: null });
    const justBefore = reminderState(at("2026-11-03T14:00:01.000Z"), 1, NOW);
    expect(justBefore).toMatchObject({ show: true, canSend: false });
  });

  it("allows sending again after a longer time and names the day", () => {
    const state = reminderState(at("2026-11-02T13:05:00.000Z"), 1, NOW);
    expect(state).toEqual({ show: true, canSend: true, sentText: "Zuletzt erinnert am 2.11. um 14:05", nextText: null });
  });

  it("allows sending when no reminder was sent", () => {
    expect(reminderState(poll({ lastReminderAt: null }), 1, NOW)).toMatchObject({ canSend: true, sentText: null });
  });
});

describe("reminderResultText", () => {
  it("says who got the reminder", () => {
    expect(reminderResultText({ sentAt: "x", recipients: 0 })).toBe(
      "Niemand hat die Erinnerung bekommen: Wer noch nicht abgestimmt hat, hat Erinnerungen ausgeschaltet.",
    );
    expect(reminderResultText({ sentAt: "x", recipients: 1 })).toBe("Erinnerung an 1 Person gesendet.");
    expect(reminderResultText({ sentAt: "x", recipients: 3 })).toBe("Erinnerung an 3 Personen gesendet.");
  });
});
