import type { PollSummary, PollView, Proposal, VoteView } from "@lueckenfueller/shared";
import { describe, expect, it } from "vitest";
import type { ApiResult } from "./api";
import {
  answerOf,
  answersInput,
  answersOfVote,
  bestProposalIds,
  checkGuestName,
  formatInstant,
  highlightedProposalIds,
  needsVote,
  nextScreen,
  notVotedYet,
  proposalHeading,
  proposalLabel,
  statusText,
  summaryLine,
  tallies,
  tallyText,
  unanswered,
  updatedText,
  type PollScreen,
} from "./poll-view";

const P1: Proposal = { id: 1, start: "2026-12-12T13:00:00.000Z", end: "2026-12-12T16:00:00.000Z" };
const P2: Proposal = { id: 2, start: "2026-12-19T09:00:00.000Z", end: "2026-12-19T12:00:00.000Z" };
const vote = (id: number, name: string, personId: number | null, a1: "yes" | "maybe" | "no", a2: "yes" | "maybe" | "no"): VoteView => ({
  id,
  name,
  personId,
  answers: [
    { proposalId: 1, answer: a1 },
    { proposalId: 2, answer: a2 },
  ],
  updatedAt: "2026-11-02T10:00:00.000Z",
});
const person = (id: number, username: string) => ({ id, username, seedColor: null });

const poll: PollView = {
  id: 7,
  shareToken: "tok",
  title: "Spieleabend",
  note: "",
  kind: "timed",
  proposals: [P1, P2],
  creator: person(1, "Vincent"),
  participants: [person(2, "Anna"), person(3, "Lena"), person(1, "Vincent")],
  votes: [vote(10, "Anna", 2, "yes", "maybe"), vote(11, "Tobi", null, "yes", "no"), vote(12, "Max", null, "no", "maybe")],
  deadline: "2026-12-02T19:00:00.000Z",
  closed: false,
  open: true,
  fixedProposalId: null,
  fixedAt: null,
  createdAt: "2026-11-02T10:00:00.000Z",
  expiresAt: "2027-01-18T00:00:00.000Z",
  myVoteId: null,
  canManage: false,
};

describe("texts", () => {
  it("writes the day and time of a proposal in German time", () => {
    expect(formatInstant("2026-12-02T19:00:00.000Z")).toBe("Mi 2.12., 20:00");
    expect(proposalLabel(P1)).toBe("Sa 12.12., 14:00–17:00");
    expect(proposalHeading(P1)).toEqual({ top: "Sa 12.12.", bottom: "14:00–17:00" });
  });

  it("names the end day when a proposal crosses midnight", () => {
    const night: Proposal = { id: 3, start: "2026-12-12T21:00:00.000Z", end: "2026-12-13T01:00:00.000Z" };
    expect(proposalLabel(night)).toBe("Sa 12.12., 22:00–So 13.12., 02:00");
    expect(proposalHeading(night).bottom).toBe("22:00–02:00 (bis So 13.12.)");
  });

  it("writes runs of days", () => {
    const run: Proposal = { id: 4, first: "2026-08-14", last: "2026-08-28" };
    expect(proposalLabel(run)).toBe("14.–28. Aug.");
    expect(proposalHeading(run)).toEqual({ top: "14.–28. Aug.", bottom: "" });
  });

  it("says whether and until when one can vote", () => {
    expect(statusText(poll)).toBe("Abstimmen möglich bis Mi 2.12., 20:00");
    expect(statusText({ ...poll, deadline: null })).toBe("Abstimmen ohne Frist");
    expect(statusText({ ...poll, closed: true, open: false })).toBe("Beendet (von Hand geschlossen)");
    expect(statusText({ ...poll, open: false })).toBe("Beendet (Frist am Mi 2.12., 20:00 abgelaufen)");
  });

  it("says the date stands, never 'deadline passed', once a date is fixed", () => {
    const fixed = { ...poll, open: false, fixedProposalId: 1 };
    expect(statusText(fixed)).toBe("Der Termin steht");
    // Also when the poll was closed by hand, and when the deadline lies in the past.
    expect(statusText({ ...fixed, closed: true })).toBe("Der Termin steht");
    expect(statusText({ ...fixed, deadline: "2020-01-01T10:00:00.000Z" })).toBe("Der Termin steht");
    // An older server sends no field at all: the poll is simply not fixed.
    const { fixedProposalId: _omit, ...old } = { ...poll, open: false };
    expect(statusText(old)).toBe("Beendet (Frist am Mi 2.12., 20:00 abgelaufen)");
  });

  it("highlights the fixed date instead of the best one", () => {
    expect(highlightedProposalIds(poll)).toEqual([1]);
    expect(highlightedProposalIds({ ...poll, fixedProposalId: 2 })).toEqual([2]);
  });

  it("sums up a poll for the list", () => {
    const s: PollSummary = {
      id: 1,
      shareToken: "t",
      title: "x",
      kind: "timed",
      creator: null,
      proposalCount: 2,
      voteCount: 3,
      deadline: "2026-12-02T19:00:00.000Z",
      open: true,
      fixedProposalId: null,
      createdAt: "",
      expiresAt: "",
      voted: false,
    };
    expect(summaryLine(s)).toBe("2 Termine · 3 Stimmen · offen bis Mi 2.12., 20:00");
    expect(summaryLine({ ...s, proposalCount: 1, voteCount: 1, deadline: null })).toBe("1 Termin · 1 Stimme · offen");
    expect(summaryLine({ ...s, open: false })).toBe("2 Termine · 3 Stimmen · beendet");
    expect(needsVote(s)).toBe(true);
    expect(needsVote({ ...s, voted: true })).toBe(false);
    expect(needsVote({ ...s, open: false })).toBe(false);
  });

  it("shows the time of the last refresh in German time", () => {
    expect(updatedText(new Date("2026-11-02T19:14:00.000Z"))).toBe("20:14");
  });
});

describe("sums", () => {
  it("counts yes, maybe and no per proposal", () => {
    expect(tallies(poll)).toEqual([
      { proposalId: 1, yes: 2, maybe: 0, no: 1 },
      { proposalId: 2, yes: 0, maybe: 2, no: 1 },
    ]);
    expect(tallyText({ proposalId: 1, yes: 2, maybe: 0, no: 1 })).toBe("2 Ja · 1 Nein");
    expect(tallyText({ proposalId: 1, yes: 0, maybe: 0, no: 0 })).toBe("–");
  });

  it("marks the proposal with the most yes, the fewest no breaking a tie", () => {
    expect(bestProposalIds(poll)).toEqual([1]);
    const tie = { ...poll, votes: [vote(1, "A", 2, "yes", "yes"), vote(2, "B", null, "no", "maybe")] };
    expect(bestProposalIds(tie)).toEqual([2]);
    const same = { ...poll, votes: [vote(1, "A", 2, "yes", "yes")] };
    expect(bestProposalIds(same)).toEqual([1, 2]);
  });

  it("marks nothing while nobody said yes", () => {
    expect(bestProposalIds({ ...poll, votes: [] })).toEqual([]);
    expect(bestProposalIds({ ...poll, votes: [vote(1, "A", 2, "maybe", "no")] })).toEqual([]);
  });

  it("lists the people of the search who have not voted with an account", () => {
    expect(notVotedYet(poll).map((p) => p.username)).toEqual(["Lena", "Vincent"]);
    // A guest with the same name does not count as the person.
    expect(notVotedYet({ ...poll, votes: [vote(1, "Lena", null, "yes", "yes")] }).map((p) => p.id)).toEqual([2, 3, 1]);
    expect(notVotedYet({ ...poll, votes: [] })).toHaveLength(3);
  });

  it("reads one answer", () => {
    expect(answerOf(poll.votes[0]!, 2)).toBe("maybe");
    expect(answerOf(poll.votes[0]!, 99)).toBeNull();
  });
});

describe("the vote about to be sent", () => {
  it("fills the form from an existing vote", () => {
    expect(answersOfVote(poll, 10)).toEqual({ 1: "yes", 2: "maybe" });
    expect(answersOfVote(poll, null)).toEqual({});
    expect(answersOfVote(poll, 99)).toEqual({});
  });

  it("needs one answer for every proposal, in the order of the proposals", () => {
    expect(unanswered(poll, { 2: "no" }).map((p) => p.id)).toEqual([1]);
    expect(answersInput(poll, { 1: "yes" })).toBeNull();
    expect(answersInput(poll, { 2: "no", 1: "yes" })).toEqual({
      answers: [
        { proposalId: 1, answer: "yes" },
        { proposalId: 2, answer: "no" },
      ],
    });
  });

  it("checks the name of a guest", () => {
    expect(checkGuestName("  Tobi   K.  ")).toEqual({ ok: true, name: "Tobi K." });
    expect(checkGuestName("   ")).toEqual({ ok: false, problem: "empty" });
    expect(checkGuestName("x".repeat(41))).toEqual({ ok: false, problem: "long" });
    expect(checkGuestName("ä".repeat(40)).ok).toBe(true);
  });
});

describe("nextScreen", () => {
  const NOW = new Date("2026-11-02T10:00:00.000Z");
  const offline: ApiResult<PollView> = { ok: false, kind: "offline" };
  const failure = (code: "poll_invalid" | "rate_limited" | "error", status = 500): ApiResult<PollView> => ({ ok: false, kind: "error", status, code });
  const ready: PollScreen = { phase: "ready", poll, updatedAt: new Date("2026-11-02T09:00:00.000Z"), offline: false, problem: "" };

  it("shows the poll after an answer", () => {
    expect(nextScreen({ phase: "loading" }, { ok: true, data: poll }, NOW)).toEqual({ phase: "ready", poll, updatedAt: NOW, offline: false, problem: "" });
  });

  it("clears the offline note when the server is back", () => {
    const older: PollScreen = { ...ready, phase: "ready", offline: true, problem: "x" } as PollScreen;
    expect(nextScreen(older, { ok: true, data: poll }, NOW)).toMatchObject({ offline: false, problem: "", updatedAt: NOW });
  });

  it("keeps the last state while the server sleeps", () => {
    const next = nextScreen(ready, offline, NOW);
    expect(next).toEqual({ ...ready, offline: true });
    expect(next.phase === "ready" && next.updatedAt).toEqual(new Date("2026-11-02T09:00:00.000Z"));
  });

  it("waits when the server sleeps and nothing has been loaded yet", () => {
    expect(nextScreen({ phase: "loading" }, offline, NOW)).toEqual({ phase: "waiting" });
    expect(nextScreen({ phase: "waiting" }, offline, NOW)).toEqual({ phase: "waiting" });
  });

  it("says the poll is gone for an unknown or renewed link, also when one was shown before", () => {
    expect(nextScreen({ phase: "loading" }, failure("poll_invalid", 404), NOW)).toEqual({ phase: "gone" });
    expect(nextScreen(ready, failure("poll_invalid", 404), NOW)).toEqual({ phase: "gone" });
  });

  it("keeps the state and names the problem for other errors", () => {
    expect(nextScreen(ready, failure("rate_limited", 429), NOW)).toEqual({ ...ready, problem: "Zu viele Versuche. Bitte warte einen Moment." });
    expect(nextScreen({ phase: "loading" }, failure("error"), NOW)).toEqual({
      phase: "failed",
      message: "Das hat nicht geklappt. Bitte versuche es noch einmal.",
    });
  });
});
