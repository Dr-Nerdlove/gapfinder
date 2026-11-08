import type { ApiErrorBody, Group, GroupList } from "@lueckenfueller/shared";
import { afterEach, describe, expect, it } from "vitest";
import { addUser, addUserWithSession, call, createTestEnv, type TestEnv } from "./helpers.js";

let env: TestEnv | undefined;
afterEach(async () => {
  await env?.app.close();
  env = undefined;
});

async function setup() {
  env = await createTestEnv();
  const me = await addUserWithSession(env, "Vincent R.");
  const anna = await addUserWithSession(env, "Anna K.");
  const ben = await addUserWithSession(env, "ben m.");
  return { env, me, anna, ben };
}

const create = (e: TestEnv, token: string, body: unknown) => call(e, "POST", "/api/groups", { token, body });
const list = async (e: TestEnv, token: string) =>
  (await call(e, "GET", "/api/groups", { token })).json<GroupList>().groups;
const field = (response: { json: <T>() => T }) => response.json<ApiErrorBody>().field;

describe("groups", () => {
  it("needs a login", async () => {
    const { env: e } = await setup();
    expect((await call(e, "GET", "/api/groups")).statusCode).toBe(401);
  });

  it("creates, lists, renames, changes and deletes a group", async () => {
    const { env: e, me, anna, ben } = await setup();
    const made = await create(e, me.token, { name: "  Spieleabend ", members: [anna.id, ben.id, anna.id] });
    expect(made.statusCode).toBe(201);
    const group = made.json<Group>();
    expect(group).toEqual({ id: group.id, name: "Spieleabend", members: [anna.id, ben.id] });
    expect(await list(e, me.token)).toEqual([group]);

    const changed = await call(e, "PATCH", `/api/groups/${group.id}`, {
      token: me.token,
      body: { name: "Uni-Leute", members: [ben.id] },
    });
    expect(changed.json<Group>()).toEqual({ id: group.id, name: "Uni-Leute", members: [ben.id] });

    expect((await call(e, "DELETE", `/api/groups/${group.id}`, { token: me.token })).statusCode).toBe(204);
    expect(await list(e, me.token)).toEqual([]);
  });

  it("keeps groups private to their owner", async () => {
    const { env: e, me, anna } = await setup();
    const group = (await create(e, me.token, { name: "Privat", members: [anna.id] })).json<Group>();
    expect(await list(e, anna.token)).toEqual([]);
    expect((await call(e, "PATCH", `/api/groups/${group.id}`, { token: anna.token, body: { name: "x" } })).statusCode).toBe(404);
    expect((await call(e, "DELETE", `/api/groups/${group.id}`, { token: anna.token })).statusCode).toBe(404);
    expect(await list(e, me.token)).toHaveLength(1);
  });

  it("never puts the owner into their own group", async () => {
    const { env: e, me, anna } = await setup();
    const group = (await create(e, me.token, { name: "Alle", members: [me.id, anna.id] })).json<Group>();
    expect(group.members).toEqual([anna.id]);
  });

  it("refuses unknown people, bad names and a repeated name", async () => {
    const { env: e, me, anna } = await setup();
    const unknown = await create(e, me.token, { name: "A", members: [9999] });
    expect(unknown.statusCode).toBe(400);
    expect(field(unknown)).toBe("members");
    for (const name of ["", "   ", "x".repeat(41)]) {
      const bad = await create(e, me.token, { name, members: [] });
      expect([bad.statusCode, field(bad)], name).toEqual([400, "name"]);
    }
    expect((await create(e, me.token, { name: "x".repeat(40), members: [] })).statusCode).toBe(201);
    expect((await create(e, me.token, { name: "Team", members: [anna.id] })).statusCode).toBe(201);
    const twice = await create(e, me.token, { name: "  TEAM ", members: [] });
    expect([twice.statusCode, field(twice)]).toEqual([400, "name"]);
    // Another person may use the same name.
    expect((await create(e, anna.token, { name: "Team", members: [] })).statusCode).toBe(201);
  });

  it("allows 20 groups and no more", async () => {
    const { env: e, me } = await setup();
    for (let i = 1; i <= 20; i++) expect((await create(e, me.token, { name: `G${i}`, members: [] })).statusCode).toBe(201);
    const over = await create(e, me.token, { name: "G21", members: [] });
    expect([over.statusCode, over.json<ApiErrorBody>().code]).toEqual([409, "group_limit"]);
  });

  it("limits a group to 49 other people", async () => {
    const { env: e, me } = await setup();
    const ids: number[] = [];
    for (let i = 0; i < 50; i++) ids.push((await addUser(e, `Person ${i}`)).id);
    const tooMany = await create(e, me.token, { name: "Alle", members: ids });
    expect([tooMany.statusCode, field(tooMany)]).toEqual([400, "members"]);
    expect((await create(e, me.token, { name: "Fast alle", members: ids.slice(0, 49) })).statusCode).toBe(201);
  });

  it("lets a deleted person drop out quietly and takes the groups of a deleted owner along", async () => {
    const { env: e, me, anna, ben } = await setup();
    await create(e, me.token, { name: "Team", members: [anna.id, ben.id] });
    await create(e, anna.token, { name: "Meine", members: [me.id] });
    e.db.prepare("DELETE FROM users WHERE id = ?").run(anna.id);
    expect((await list(e, me.token))[0]!.members).toEqual([ben.id]);
    expect(e.db.prepare("SELECT COUNT(*) AS n FROM people_groups").get()).toEqual({ n: 1 });
  });
});
