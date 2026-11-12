import type { PollView } from "@lueckenfueller/shared";
import { describe, expect, it, vi } from "vitest";
import type { ApiResult, CallOptions } from "./api";
import { guestVoteFor, rememberGuestVote } from "./guest-votes";
import { INCOMPLETE_ANSWERS_TEXT, loadPoll, submitVote, withdrawVote, type VoteDeps } from "./poll-actions";
import { MemoryStorage } from "./test-storage";

const poll = {
  id: 7,
  shareToken: "tok",
  proposals: [
    { id: 1, start: "2026-12-12T13:00:00.000Z", end: "2026-12-12T16:00:00.000Z" },
    { id: 2, start: "2026-12-19T09:00:00.000Z", end: "2026-12-19T12:00:00.000Z" },
  ],
  votes: [{ id: 5, name: "Tobi", personId: null, answers: [], updatedAt: "" }],
} as unknown as PollView;
const after = { ...poll, title: "after" } as PollView;
type Api = NonNullable<VoteDeps["api"]>;
const answers = { 1: "yes", 2: "no" } as const;
const body = {
  answers: [
    { proposalId: 1, answer: "yes" },
    { proposalId: 2, answer: "no" },
  ],
};
const ok = <T>(data: T): ApiResult<T> => ({ ok: true, data });
const fail = (code: "not_found" | "poll_closed" | "vote_name_taken", status = 409): ApiResult<never> => ({ ok: false, kind: "error", status, code });
const offline: ApiResult<never> = { ok: false, kind: "offline" };

function deps(over: Partial<Api> = {}) {
  const storage = new MemoryStorage();
  const api = {
    castAccountVote: vi.fn(async () => ok(after)),
    withdrawAccountVote: vi.fn(async () => ok(after)),
    castGuestVote: vi.fn(async () => ok({ voteId: 9, voteKey: "KEY", poll: after })),
    changeGuestVote: vi.fn(async () => ok(after)),
    withdrawGuestVote: vi.fn(async () => ok(after)),
    ...over,
  };
  const run: VoteDeps["run"] = (call) => call({} as CallOptions);
  return { storage, api, deps: { run, api: api as unknown as Api, storage } satisfies VoteDeps };
}

describe("submitVote", () => {
  it("sends nothing while an answer is missing", async () => {
    const d = deps();
    const out = await submitVote(poll, { loggedIn: true, name: "", answers: { 1: "yes" }, stored: null }, d.deps);
    expect(out).toEqual({ kind: "problem", text: INCOMPLETE_ANSWERS_TEXT });
    expect(d.api.castAccountVote).not.toHaveBeenCalled();
  });

  it("votes as the account when logged in, without a name", async () => {
    const d = deps();
    const out = await submitVote(poll, { loggedIn: true, name: "", answers, stored: null }, d.deps);
    expect(out).toEqual({ kind: "done", poll: after });
    expect(d.api.castAccountVote).toHaveBeenCalledWith("tok", body, expect.anything());
    expect(d.api.castGuestVote).not.toHaveBeenCalled();
  });

  it("needs a name from a guest", async () => {
    const d = deps();
    const out = await submitVote(poll, { loggedIn: false, name: "  ", answers, stored: null }, d.deps);
    expect(out).toMatchObject({ kind: "problem", text: "Bitte gib deinen Namen ein." });
    expect(d.api.castGuestVote).not.toHaveBeenCalled();
  });

  it("casts a new guest vote and keeps the key on the device", async () => {
    const d = deps();
    const out = await submitVote(poll, { loggedIn: false, name: " Tobi  K. ", answers, stored: null }, d.deps);
    expect(out).toEqual({ kind: "done", poll: after });
    expect(d.api.castGuestVote).toHaveBeenCalledWith("tok", { name: "Tobi K.", ...body }, expect.anything());
    expect(guestVoteFor("tok", d.storage)).toEqual({ voteId: 9, voteKey: "KEY", name: "Tobi K." });
  });

  it("changes the vote with the kept key instead of casting a second one", async () => {
    const d = deps();
    const stored = { voteId: 5, voteKey: "OLD", name: "Tobi" };
    const out = await submitVote(poll, { loggedIn: false, name: "Tobias", answers, stored }, d.deps);
    expect(out).toEqual({ kind: "done", poll: after });
    expect(d.api.changeGuestVote).toHaveBeenCalledWith("tok", 5, { name: "Tobias", ...body }, expect.objectContaining({ voteKey: "OLD" }));
    expect(d.api.castGuestVote).not.toHaveBeenCalled();
    expect(guestVoteFor("tok", d.storage)).toEqual({ voteId: 5, voteKey: "OLD", name: "Tobias" });
  });

  it("casts a new vote when the creator removed the old one", async () => {
    const d = deps();
    const stored = { voteId: 99, voteKey: "OLD", name: "Tobi" };
    const out = await submitVote(poll, { loggedIn: false, name: "Tobi", answers, stored }, d.deps);
    expect(out.kind).toBe("done");
    expect(d.api.changeGuestVote).not.toHaveBeenCalled();
    expect(guestVoteFor("tok", d.storage)?.voteKey).toBe("KEY");
  });

  it("casts a new vote when the server says the old one is gone", async () => {
    const d = deps({ changeGuestVote: vi.fn(async () => fail("not_found", 404)) });
    const stored = { voteId: 5, voteKey: "OLD", name: "Tobi" };
    const out = await submitVote(poll, { loggedIn: false, name: "Tobi", answers, stored }, d.deps);
    expect(out.kind).toBe("done");
    expect(d.api.castGuestVote).toHaveBeenCalled();
  });

  it("keeps the key when the change fails for another reason", async () => {
    for (const failure of [fail("poll_closed"), offline]) {
      const d = deps({ changeGuestVote: vi.fn(async () => failure) });
      const stored = { voteId: 5, voteKey: "OLD", name: "Tobi" };
      rememberGuestVote("tok", stored, d.storage);
      const out = await submitVote(poll, { loggedIn: false, name: "Tobi", answers, stored }, d.deps);
      expect(out).toEqual({ kind: "failed", failure });
      expect(d.api.castGuestVote).not.toHaveBeenCalled();
      expect(guestVoteFor("tok", d.storage)).toEqual(stored);
    }
  });

  it("stores nothing when casting fails", async () => {
    const d = deps({ castGuestVote: vi.fn(async () => fail("vote_name_taken")) });
    const out = await submitVote(poll, { loggedIn: false, name: "Anna", answers, stored: null }, d.deps);
    expect(out).toMatchObject({ kind: "failed", failure: { code: "vote_name_taken" } });
    expect(guestVoteFor("tok", d.storage)).toBeNull();
  });

  it("reports a sleeping server", async () => {
    const d = deps({ castAccountVote: vi.fn(async () => offline) });
    expect(await submitVote(poll, { loggedIn: true, name: "", answers, stored: null }, d.deps)).toEqual({ kind: "failed", failure: offline });
  });
});

describe("withdrawVote", () => {
  const stored = { voteId: 5, voteKey: "OLD", name: "Tobi" };

  it("withdraws the account's vote", async () => {
    const d = deps();
    expect(await withdrawVote(poll, { loggedIn: true, stored: null }, d.deps)).toEqual({ kind: "done", poll: after });
    expect(d.api.withdrawAccountVote).toHaveBeenCalledWith("tok", expect.anything());
  });

  it("withdraws a guest vote with the key and forgets the key", async () => {
    const d = deps();
    rememberGuestVote("tok", stored, d.storage);
    expect(await withdrawVote(poll, { loggedIn: false, stored }, d.deps)).toEqual({ kind: "done", poll: after });
    expect(d.api.withdrawGuestVote).toHaveBeenCalledWith("tok", 5, expect.objectContaining({ voteKey: "OLD" }));
    expect(guestVoteFor("tok", d.storage)).toBeNull();
  });

  it("keeps the key when the server cannot be reached", async () => {
    const d = deps({ withdrawGuestVote: vi.fn(async () => offline) });
    rememberGuestVote("tok", stored, d.storage);
    expect(await withdrawVote(poll, { loggedIn: false, stored }, d.deps)).toEqual({ kind: "failed", failure: offline });
    expect(guestVoteFor("tok", d.storage)).toEqual(stored);
  });

  it("treats a vote that is already gone as withdrawn", async () => {
    const d = deps({ withdrawGuestVote: vi.fn(async () => fail("not_found", 404)) });
    rememberGuestVote("tok", stored, d.storage);
    const out = await withdrawVote(poll, { loggedIn: false, stored }, d.deps);
    expect(out.kind === "done" && out.poll.votes).toEqual([]);
    expect(guestVoteFor("tok", d.storage)).toBeNull();
  });

  it("sends nothing for a guest without a vote", async () => {
    const d = deps();
    expect(await withdrawVote(poll, { loggedIn: false, stored: null }, d.deps)).toEqual({ kind: "done", poll });
    expect(d.api.withdrawGuestVote).not.toHaveBeenCalled();
  });
});

describe("loadPoll", () => {
  it("sends the key of the stored guest vote with the GET", async () => {
    const storage = new MemoryStorage();
    rememberGuestVote("tok", { voteId: 5, voteKey: "KEY", name: "Tobi" }, storage);
    const getPollByLink = vi.fn(async () => ok(poll));
    await loadPoll("tok", { run: (call) => call({} as CallOptions), storage, api: { getPollByLink } });
    expect(getPollByLink).toHaveBeenCalledWith("tok", expect.objectContaining({ voteKey: "KEY" }));
  });

  it("sends no key when the device has none for this poll", async () => {
    const storage = new MemoryStorage();
    rememberGuestVote("other", { voteId: 5, voteKey: "KEY", name: "Tobi" }, storage);
    const getPollByLink = vi.fn(async (_token: string, _options?: CallOptions) => ok(poll));
    await loadPoll("tok", { run: (call) => call({} as CallOptions), storage, api: { getPollByLink } });
    expect(getPollByLink.mock.calls[0]![1]).not.toHaveProperty("voteKey");
  });
});
