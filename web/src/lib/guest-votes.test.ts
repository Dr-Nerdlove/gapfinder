import { describe, expect, it } from "vitest";
import { GUEST_VOTES_KEPT, GUEST_VOTES_KEY, forgetGuestVote, guestVoteFor, lastGuestName, liveGuestVote, rememberGuestVote } from "./guest-votes";
import { MemoryStorage, brokenStorage } from "./test-storage";

const vote = (voteId: number, name = "Tobi") => ({ voteId, voteKey: `key${voteId}`, name });

describe("guest votes on the device", () => {
  it("remembers the key per poll link and the last name", () => {
    const storage = new MemoryStorage();
    rememberGuestVote("tokA", vote(1), storage);
    rememberGuestVote("tokB", vote(2, "Tobi K."), storage);
    expect(guestVoteFor("tokA", storage)).toEqual(vote(1));
    expect(guestVoteFor("tokB", storage)).toEqual(vote(2, "Tobi K."));
    expect(guestVoteFor("other", storage)).toBeNull();
    expect(lastGuestName(storage)).toBe("Tobi K.");
  });

  it("forgets one vote and keeps the rest", () => {
    const storage = new MemoryStorage();
    rememberGuestVote("tokA", vote(1), storage);
    rememberGuestVote("tokB", vote(2), storage);
    forgetGuestVote("tokA", storage);
    expect(guestVoteFor("tokA", storage)).toBeNull();
    expect(guestVoteFor("tokB", storage)).toEqual(vote(2));
    forgetGuestVote("unknown", storage);
  });

  it("forgets the oldest votes beyond the limit", () => {
    const storage = new MemoryStorage();
    for (let i = 0; i < GUEST_VOTES_KEPT + 3; i++) rememberGuestVote(`tok${i}`, vote(i), storage);
    expect(guestVoteFor("tok0", storage)).toBeNull();
    expect(guestVoteFor("tok2", storage)).toBeNull();
    expect(guestVoteFor("tok3", storage)).toEqual(vote(3));
    expect(guestVoteFor(`tok${GUEST_VOTES_KEPT + 2}`, storage)).not.toBeNull();
  });

  it("replaces the vote of the same poll", () => {
    const storage = new MemoryStorage();
    rememberGuestVote("tokA", vote(1), storage);
    rememberGuestVote("tokA", vote(5), storage);
    expect(guestVoteFor("tokA", storage)).toEqual(vote(5));
  });

  it("ignores unreadable and wrong content", () => {
    const storage = new MemoryStorage();
    for (const raw of ["not json", "null", '{"votes":5}', '{"votes":{"t":{"voteId":"x","voteKey":"k","name":"n"}},"name":3}']) {
      storage.setItem(GUEST_VOTES_KEY, raw);
      expect(guestVoteFor("t", storage)).toBeNull();
      expect(lastGuestName(storage)).toBe("");
    }
  });

  it("works without storage", () => {
    expect(() => rememberGuestVote("t", vote(1), brokenStorage)).not.toThrow();
    expect(() => forgetGuestVote("t", brokenStorage)).not.toThrow();
    expect(guestVoteFor("t", brokenStorage)).toBeNull();
    expect(guestVoteFor("t", null)).toBeNull();
    expect(lastGuestName(brokenStorage)).toBe("");
  });

  it("uses the remembered vote only while the poll still has it as a guest vote", () => {
    const poll = { votes: [{ id: 1, personId: null }, { id: 2, personId: 5 }] } as never;
    expect(liveGuestVote(poll, vote(1))).toEqual(vote(1));
    expect(liveGuestVote(poll, vote(2))).toBeNull();
    expect(liveGuestVote(poll, vote(3))).toBeNull();
    expect(liveGuestVote(poll, null)).toBeNull();
  });
});
