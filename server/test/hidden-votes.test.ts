import type { ApiErrorBody, GuestVoteCreated, NotificationItem, NotificationList, PollList, PollView, VoteAnswer } from "@lueckenfueller/shared";
import { afterEach, describe, expect, it } from "vitest";
import { addUserWithSession, call, createTestEnv, type TestEnv } from "./helpers.js";

let env: TestEnv | undefined;
afterEach(async () => {
  await env?.app.close();
  env = undefined;
});

const SLOT_A = { start: "2026-11-07T17:00:00.000Z", end: "2026-11-07T19:00:00.000Z" };
const SLOT_B = { start: "2026-11-08T17:00:00.000Z", end: "2026-11-08T19:00:00.000Z" };

async function setup() {
  env = await createTestEnv();
  const owner = await addUserWithSession(env, "Olga O.");
  const anna = await addUserWithSession(env, "Anna K.");
  const ben = await addUserWithSession(env, "ben m.");
  const cara = await addUserWithSession(env, "Cara C.");
  const admin = await addUserWithSession(env, "Admin A.", { isAdmin: true });
  return { ...env, owner, anna, ben, cara, admin };
}
type Setup = Awaited<ReturnType<typeof setup>>;
type User = { id: number; token: string };

const code = (r: { json: <T>() => T }) => r.json<ApiErrorBody>().code;
const field = (r: { json: <T>() => T }) => r.json<ApiErrorBody>().field;
const link = (poll: PollView) => `/api/poll-links/${poll.shareToken}`;
const answersFor = (poll: PollView, answer: VoteAnswer | VoteAnswer[]) =>
  poll.proposals.map((p, i) => ({ proposalId: p.id, answer: Array.isArray(answer) ? answer[i]! : answer }));

async function create(e: Setup, extra: Record<string, unknown> = {}, participants: User[] = [e.anna, e.ben]): Promise<PollView> {
  const response = await call(e, "POST", "/api/polls", {
    token: e.owner.token,
    body: { title: "Spieleabend", kind: "timed", proposals: [SLOT_A, SLOT_B], participants: participants.map((p) => p.id), ...extra },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<PollView>();
}

async function accountVote(e: Setup, poll: PollView, user: User, answer: VoteAnswer | VoteAnswer[] = "yes") {
  const r = await call(e, "PUT", `${link(poll)}/my-vote`, { token: user.token, body: { answers: answersFor(poll, answer) } });
  expect(r.statusCode, r.body).toBe(200);
  return r.json<PollView>();
}

async function guestVote(e: Setup, poll: PollView, name: string, answer: VoteAnswer | VoteAnswer[] = "yes") {
  const r = await call(e, "POST", `${link(poll)}/votes`, { body: { name, answers: answersFor(poll, answer) } });
  expect(r.statusCode, r.body).toBe(201);
  return r.json<GuestVoteCreated>();
}

const view = async (e: Setup, poll: PollView, token?: string, key?: string) =>
  (await call(e, "GET", link(poll), { ...(token ? { token } : {}), ...(key ? { headers: { "x-vote-key": key } } : {}) })).json<PollView>();

describe("creating a poll with hidden votes", () => {
  it("is open by default and hidden when asked", async () => {
    const e = await setup();
    const open = await create(e);
    expect(open.hidden).toBe(false);
    expect(open.tally).toBeUndefined();
    expect(open.votedParticipantIds).toBeUndefined();
    expect((await create(e, { hidden: false })).hidden).toBe(false);
    const hidden = await create(e, { hidden: true });
    expect(hidden.hidden).toBe(true);
    // The creator manages it: unfiltered.
    expect(hidden.tally).toBeUndefined();
  });

  it("refuses a field it does not know, naming it", async () => {
    const e = await setup();
    const r = await call(e, "POST", "/api/polls", {
      token: e.owner.token,
      body: { title: "x", kind: "timed", proposals: [SLOT_A], participants: [], secretVotes: true },
    });
    expect(r.statusCode).toBe(400);
    expect(code(r)).toBe("validation");
    expect(field(r)).toBe("secretVotes");
    const list = (await call(e, "GET", "/api/polls", { token: e.owner.token })).json<PollList>();
    expect(list.polls).toHaveLength(0);
  });

  it("rejects a hidden that is not a boolean", async () => {
    const e = await setup();
    const r = await call(e, "POST", "/api/polls", {
      token: e.owner.token,
      body: { title: "x", kind: "timed", proposals: [SLOT_A], participants: [], hidden: "yes" },
    });
    expect(r.statusCode).toBe(400);
  });
});

describe("the view of a hidden poll", () => {
  async function filled(e: Setup) {
    const poll = await create(e, { hidden: true });
    await accountVote(e, poll, e.anna, ["yes", "no"]);
    await accountVote(e, poll, e.owner, ["maybe", "yes"]);
    const guest = await guestVote(e, poll, "Gast G.", ["yes", "yes"]);
    return { poll, guest };
  }

  it("shows another account only its own vote, the sums and who voted", async () => {
    const e = await setup();
    const { poll } = await filled(e);
    const v = await view(e, poll, e.anna.token);
    expect(v.hidden).toBe(true);
    expect(v.canManage).toBe(false);
    expect(v.votes.map((x) => x.name)).toEqual(["Anna K."]);
    expect(v.votes[0]!.answers.map((a) => a.answer)).toEqual(["yes", "no"]);
    expect(v.myVoteId).toBe(v.votes[0]!.id);
    expect(v.tally).toEqual([
      { proposalId: poll.proposals[0]!.id, yes: 2, maybe: 1, no: 0 },
      { proposalId: poll.proposals[1]!.id, yes: 2, maybe: 0, no: 1 },
    ]);
    expect(v.votedParticipantIds).toEqual([e.owner.id, e.anna.id].sort((a, b) => a - b));
  });

  it("shows an account that has not voted no votes but the sums", async () => {
    const e = await setup();
    const { poll } = await filled(e);
    const v = await view(e, poll, e.ben.token);
    expect(v.votes).toEqual([]);
    expect(v.tally).toHaveLength(2);
    expect(JSON.stringify(v)).not.toContain("Gast G.");
  });

  it("shows a guest without a key no votes, and with the key only their own", async () => {
    const e = await setup();
    const { poll, guest } = await filled(e);
    const anonymous = await view(e, poll);
    expect(anonymous.votes).toEqual([]);
    expect(anonymous.tally).toBeDefined();
    const own = await view(e, poll, undefined, guest.voteKey);
    expect(own.votes.map((x) => x.name)).toEqual(["Gast G."]);
    expect(own.myVoteId).toBeNull();
    const wrong = await call(e, "GET", link(poll), { headers: { "x-vote-key": "nope" } });
    expect(wrong.statusCode).toBe(200);
    expect(wrong.json<PollView>().votes).toEqual([]);
  });

  it("gives a guest their own vote (and only it) when voting and changing the vote", async () => {
    const e = await setup();
    const poll = await create(e, { hidden: true });
    await accountVote(e, poll, e.anna);
    const created = await guestVote(e, poll, "Gast G.", ["no", "no"]);
    expect(created.poll.votes.map((x) => x.name)).toEqual(["Gast G."]);
    expect(created.poll.tally).toBeDefined();
    const put = await call(e, "PUT", `${link(poll)}/votes/${created.voteId}`, {
      headers: { "x-vote-key": created.voteKey },
      body: { name: "Gast G.", answers: answersFor(poll, ["yes", "no"]) },
    });
    expect(put.statusCode, put.body).toBe(200);
    const updated = put.json<PollView>();
    expect(updated.votes.map((x) => x.name)).toEqual(["Gast G."]);
    expect(updated.tally![0]).toMatchObject({ yes: 2, no: 0 });
  });

  it("is unfiltered for the creator and for an admin", async () => {
    const e = await setup();
    const { poll } = await filled(e);
    for (const token of [e.owner.token, e.admin.token]) {
      const v = await view(e, poll, token);
      expect(v.hidden).toBe(true);
      expect(v.canManage).toBe(true);
      expect(v.votes.map((x) => x.name)).toEqual(["Anna K.", "Olga O.", "Gast G."]);
      expect(v.tally).toBeUndefined();
      expect(v.votedParticipantIds).toBeUndefined();
    }
  });

  it("does not filter an open poll", async () => {
    const e = await setup();
    const poll = await create(e);
    await accountVote(e, poll, e.anna);
    const v = await view(e, poll, e.ben.token);
    expect(v.hidden).toBe(false);
    expect(v.votes).toHaveLength(1);
    expect(v.tally).toBeUndefined();
  });

  it("filters the answers of the account vote routes too", async () => {
    const e = await setup();
    const { poll } = await filled(e);
    const put = await accountVote(e, poll, e.ben);
    expect(put.votes.map((x) => x.name)).toEqual(["ben m."]);
    const del = await call(e, "DELETE", `${link(poll)}/my-vote`, { token: e.ben.token });
    expect(del.json<PollView>().votes).toEqual([]);
  });

  it("marks the poll in the list", async () => {
    const e = await setup();
    const hidden = await create(e, { hidden: true });
    const open = await create(e);
    const list = (await call(e, "GET", "/api/polls", { token: e.anna.token })).json<PollList>();
    expect(list.polls.find((p) => p.id === hidden.id)!.hidden).toBe(true);
    expect(list.polls.find((p) => p.id === open.id)!.hidden).toBe(false);
  });
});

describe("revealing", () => {
  const patch = (e: Setup, poll: PollView, body: unknown, token = e.owner.token) =>
    call(e, "PATCH", `/api/polls/${poll.id}`, { token, body });

  it("false reveals for everybody and cannot be undone", async () => {
    const e = await setup();
    const poll = await create(e, { hidden: true });
    await accountVote(e, poll, e.anna);
    const r = await patch(e, poll, { hidden: false });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json<PollView>().hidden).toBe(false);
    const v = await view(e, poll, e.ben.token);
    expect(v.votes.map((x) => x.name)).toEqual(["Anna K."]);
    expect(v.tally).toBeUndefined();
    const again = await patch(e, poll, { hidden: true });
    expect(again.statusCode).toBe(400);
    expect(code(again)).toBe("validation");
    expect(field(again)).toBe("hidden");
    expect((await view(e, poll, e.ben.token)).hidden).toBe(false);
  });

  it("true on a hidden poll changes nothing, other fields still apply", async () => {
    const e = await setup();
    const poll = await create(e, { hidden: true });
    const r = await patch(e, poll, { hidden: true, title: "Neu" });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json<PollView>()).toMatchObject({ hidden: true, title: "Neu" });
  });

  it("true on an open poll is refused", async () => {
    const e = await setup();
    const poll = await create(e);
    const r = await patch(e, poll, { hidden: true });
    expect(r.statusCode).toBe(400);
    expect(field(r)).toBe("hidden");
  });

  it("an update without hidden keeps it hidden; an admin may reveal", async () => {
    const e = await setup();
    const poll = await create(e, { hidden: true });
    expect((await patch(e, poll, { closed: true })).json<PollView>().hidden).toBe(true);
    expect((await patch(e, poll, { hidden: false }, e.admin.token)).json<PollView>().hidden).toBe(false);
  });

  it("only the creator or an admin may reveal", async () => {
    const e = await setup();
    const poll = await create(e, { hidden: true });
    expect((await patch(e, poll, { hidden: false }, e.anna.token)).statusCode).toBe(403);
  });
});

describe("notifications of a hidden poll", () => {
  async function items(e: Setup, user: User): Promise<NotificationItem[]> {
    return (await call(e, "GET", "/api/notifications", { token: user.token })).json<NotificationList>().items;
  }
  /** The others' settings are off by default; switch them on so the name rule is what decides. */
  async function allOn(e: Setup) {
    for (const user of [e.anna, e.ben, e.cara, e.admin]) {
      const r = await call(e, "PUT", "/api/me/notification-settings", {
        token: user.token,
        body: { pollCreated: true, voteOwn: true, voteOthers: true, allVotedOwn: true, allVotedOthers: true, dateFixed: true, reminder: true },
      });
      expect(r.statusCode, r.body).toBe(200);
    }
  }
  const votes = async (e: Setup, user: User, kind: string) => (await items(e, user)).filter((i) => i.data.kind === kind);

  it("names the voter only for the creator and admins", async () => {
    const e = await setup();
    await allOn(e);
    // Admin and Cara take part; Anna votes.
    const poll = await create(e, { hidden: true }, [e.anna, e.ben, e.cara, e.admin]);
    await accountVote(e, poll, e.anna);
    const toOwner = await votes(e, e.owner, "vote");
    expect(toOwner).toHaveLength(1);
    expect(toOwner[0]!.data).toMatchObject({ kind: "vote", actorName: "Anna K." });
    const toAdmin = await votes(e, e.admin, "vote");
    expect(toAdmin[0]!.data).toMatchObject({ actorName: "Anna K." });
    for (const user of [e.ben, e.cara]) {
      const got = await votes(e, user, "vote");
      expect(got).toHaveLength(1);
      expect(got[0]!.data).not.toHaveProperty("actorName");
      expect(got[0]!.data).toMatchObject({ kind: "vote", pollTitle: "Spieleabend" });
    }
  });

  it("does the same for all_voted and never sends both kinds to one account", async () => {
    const e = await setup();
    await allOn(e);
    const poll = await create(e, { hidden: true }, [e.anna, e.ben, e.admin]);
    await accountVote(e, poll, e.owner);
    await accountVote(e, poll, e.anna);
    await accountVote(e, poll, e.admin);
    await accountVote(e, poll, e.ben);
    const kindsOf = async (u: User) => (await items(e, u)).map((i) => i.data.kind);
    expect(await kindsOf(e.owner)).toEqual(["vote", "vote", "all_voted"]);
    expect((await votes(e, e.owner, "all_voted"))[0]!.data).toMatchObject({ actorName: "ben m." });
    expect((await votes(e, e.admin, "all_voted"))[0]!.data).toMatchObject({ actorName: "ben m." });
    expect(await kindsOf(e.anna)).toEqual(["poll_created", "vote", "vote", "all_voted"]);
    const annaAll = (await votes(e, e.anna, "all_voted"))[0]!;
    expect(annaAll.data).not.toHaveProperty("actorName");
  });

  it("keeps the name for everybody in an open poll", async () => {
    const e = await setup();
    await allOn(e);
    const poll = await create(e);
    await accountVote(e, poll, e.anna);
    expect((await votes(e, e.ben, "vote"))[0]!.data).toMatchObject({ actorName: "Anna K." });
  });

  it("holds for a guest vote too", async () => {
    const e = await setup();
    await allOn(e);
    const poll = await create(e, { hidden: true });
    await guestVote(e, poll, "Gast G.");
    expect((await votes(e, e.owner, "vote"))[0]!.data).toMatchObject({ actorName: "Gast G." });
    expect((await votes(e, e.ben, "vote"))[0]!.data).not.toHaveProperty("actorName");
  });
});
