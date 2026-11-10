import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { type Migration, migrations, openDatabase, runMigrations } from "../src/db.js";

function appliedIds(db: DatabaseSync): number[] {
  const rows = db.prepare("SELECT id FROM schema_migrations ORDER BY id").all() as { id: number }[];
  return rows.map((row) => row.id);
}

describe("migrations", () => {
  it("applies every migration once and is idempotent", () => {
    const db = new DatabaseSync(":memory:");
    runMigrations(db);
    runMigrations(db);

    expect(appliedIds(db)).toEqual(migrations.map((m) => m.id));
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain("meta");
  });

  it("applies only the missing migrations when new ones are added", () => {
    const db = new DatabaseSync(":memory:");
    const first: Migration = { id: 1, name: "one", sql: "CREATE TABLE one (x INTEGER);" };
    const second: Migration = { id: 2, name: "two", sql: "CREATE TABLE two (x INTEGER);" };
    runMigrations(db, [first]);
    runMigrations(db, [first, second]);
    runMigrations(db, [first, second]);
    expect(appliedIds(db)).toEqual([1, 2]);
  });

  it("rolls back a failing migration completely", () => {
    const db = new DatabaseSync(":memory:");
    const broken: Migration = {
      id: 1,
      name: "broken",
      sql: "CREATE TABLE half (x INTEGER); INSERT INTO does_not_exist VALUES (1);",
    };
    expect(() => runMigrations(db, [broken])).toThrow(/Migration 1 \(broken\) failed/);
    expect(appliedIds(db)).toEqual([]);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE name = 'half'").all();
    expect(tables).toEqual([]);
  });

  it("migration 2 adds the account tables without touching the first migration's table", () => {
    const db = new DatabaseSync(":memory:");
    runMigrations(db, migrations.slice(0, 1));
    db.prepare("INSERT INTO meta (key, value) VALUES ('keep', 'me')").run();
    runMigrations(db);

    expect(appliedIds(db)).toEqual(migrations.map((m) => m.id));
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
      (t) => t.name,
    );
    expect(tables).toEqual(expect.arrayContaining(["meta", "users", "sessions", "invites", "password_resets"]));
    expect(db.prepare("SELECT value FROM meta WHERE key = 'keep'").get()).toEqual({ value: "me" });
  });

  it("migration 2 enforces unique usernames and cascades deletes", () => {
    const db = openDatabase(":memory:");
    const insert = db.prepare(
      "INSERT INTO users (username, username_key, password_hash, created_at) VALUES (?, ?, 'h', '2026-01-01T00:00:00.000Z')",
    );
    insert.run("Anna", "anna");
    expect(() => insert.run("ANNA", "anna")).toThrow(/UNIQUE/);

    db.prepare(
      "INSERT INTO sessions (token_hash, user_id, created_at, last_used_at, expires_at) VALUES ('t', 1, 'a', 'a', 'a')",
    ).run();
    db.prepare(
      "INSERT INTO invites (token_hash, suggested_username, created_by, created_at, expires_at) VALUES ('i', 'X', 1, 'a', 'a')",
    ).run();
    db.prepare("DELETE FROM users WHERE id = 1").run();
    expect(db.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT created_by FROM invites").get()).toEqual({ created_by: null });
  });

  it("migration 3 adds the calendars table to a database at migration 2 and keeps its data", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    runMigrations(db, migrations.slice(0, 2));
    db.prepare(
      "INSERT INTO users (username, username_key, password_hash, created_at) VALUES ('Anna', 'anna', 'h', '2026-01-01T00:00:00.000Z')",
    ).run();
    db.prepare("INSERT INTO meta (key, value) VALUES ('keep', 'me')").run();
    expect(appliedIds(db)).toEqual([1, 2]);

    runMigrations(db, migrations.slice(0, 3));

    expect(appliedIds(db)).toEqual([1, 2, 3]);
    expect(db.prepare("SELECT username FROM users").all()).toEqual([{ username: "Anna" }]);
    expect(db.prepare("SELECT value FROM meta WHERE key = 'keep'").get()).toEqual({ value: "me" });
    const columns = (db.prepare("PRAGMA table_info(calendars)").all() as { name: string }[]).map((c) => c.name);
    expect(columns).toEqual([
      "id",
      "user_id",
      "name",
      "provider",
      "link_encrypted",
      "counts_busy",
      "is_default",
      "status",
      "created_at",
      "updated_at",
    ]);
    const indexes = (db.prepare("PRAGMA index_list(calendars)").all() as { name: string }[]).map((i) => i.name);
    expect(indexes).toContain("calendars_user_id");
  });

  it("migration 6 copies the old busy setting to the days setting and keeps new calendars on", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    runMigrations(db, migrations.slice(0, 5));
    db.prepare(
      "INSERT INTO users (username, username_key, password_hash, created_at) VALUES ('Anna', 'anna', 'h', 'a')",
    ).run();
    const insert = db.prepare(
      "INSERT INTO calendars (user_id, name, provider, link_encrypted, counts_busy, created_at, updated_at) VALUES (1, ?, 'google', 'v1.x', ?, 'a', 'a')",
    );
    insert.run("on", 1);
    insert.run("off", 0);

    runMigrations(db);

    expect(db.prepare("SELECT name, counts_busy, counts_busy_days FROM calendars ORDER BY id").all()).toEqual([
      { name: "on", counts_busy: 1, counts_busy_days: 1 },
      { name: "off", counts_busy: 0, counts_busy_days: 0 },
    ]);
    db.prepare(
      "INSERT INTO calendars (user_id, name, provider, link_encrypted, created_at, updated_at) VALUES (1, 'new', 'google', 'v1.x', 'a', 'a')",
    ).run();
    expect(db.prepare("SELECT counts_busy_days FROM calendars WHERE name = 'new'").get()).toEqual({ counts_busy_days: 1 });
  });

  it("migration 3: calendars belong to a user, keep an empty name, accept only ok/broken and go with the user", () => {
    const db = openDatabase(":memory:");
    db.prepare(
      "INSERT INTO users (username, username_key, password_hash, created_at) VALUES ('Anna', 'anna', 'h', 'a')",
    ).run();
    const insert = db.prepare(
      "INSERT INTO calendars (user_id, name, provider, link_encrypted, created_at, updated_at) VALUES (?, '', 'google', 'v1.x', 'a', 'a')",
    );
    insert.run(1);
    expect(db.prepare("SELECT name, counts_busy, is_default, status FROM calendars").get()).toEqual({
      name: "",
      counts_busy: 1,
      is_default: 0,
      status: "ok",
    });
    expect(() => insert.run(999)).toThrow(/FOREIGN KEY/);
    expect(() => db.prepare("UPDATE calendars SET status = 'weird'").run()).toThrow(/CHECK/);
    db.prepare("DELETE FROM users WHERE id = 1").run();
    expect(db.prepare("SELECT COUNT(*) AS n FROM calendars").get()).toEqual({ n: 0 });
  });

  it("migration 4 adds the poll tables to a database at migration 3 and keeps its data", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    runMigrations(db, migrations.slice(0, 3));
    db.prepare(
      "INSERT INTO users (username, username_key, password_hash, created_at) VALUES ('Anna', 'anna', 'h', 'a')",
    ).run();
    const before = db.prepare("SELECT sql FROM sqlite_master WHERE name IN ('users', 'calendars') ORDER BY name").all();

    runMigrations(db, migrations.slice(0, 4));

    expect(appliedIds(db)).toEqual([1, 2, 3, 4]);
    expect(db.prepare("SELECT sql FROM sqlite_master WHERE name IN ('users', 'calendars') ORDER BY name").all()).toEqual(
      before,
    );
    expect(db.prepare("SELECT username FROM users").all()).toEqual([{ username: "Anna" }]);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
      (t) => t.name,
    );
    expect(tables).toEqual(
      expect.arrayContaining(["polls", "poll_proposals", "poll_participants", "poll_votes", "poll_vote_answers"]),
    );
  });

  it("migration 4: a vote is either an account vote or a guest vote, once per account and per guest name", () => {
    const db = openDatabase(":memory:");
    db.prepare(
      "INSERT INTO users (username, username_key, password_hash, created_at) VALUES ('Anna', 'anna', 'h', 'a')",
    ).run();
    db.prepare(
      "INSERT INTO polls (share_token, creator_id, title, kind, created_at, updated_at, expires_at) VALUES ('t', 1, 'x', 'days', 'a', 'a', 'z')",
    ).run();
    const account = db.prepare("INSERT INTO poll_votes (poll_id, user_id, created_at, updated_at) VALUES (1, ?, 'a', 'a')");
    const guest = db.prepare(
      "INSERT INTO poll_votes (poll_id, guest_name, guest_name_key, key_hash, created_at, updated_at) VALUES (1, ?, ?, 'h', 'a', 'a')",
    );
    expect(() => db.prepare("INSERT INTO poll_votes (poll_id, created_at, updated_at) VALUES (1, 'a', 'a')").run()).toThrow(
      /CHECK/,
    );
    account.run(1);
    expect(() => account.run(1)).toThrow(/UNIQUE/);
    guest.run("Mia", "mia");
    expect(() => guest.run("MIA", "mia")).toThrow(/UNIQUE/);
    expect(() =>
      db
        .prepare(
          "INSERT INTO poll_votes (poll_id, user_id, guest_name, guest_name_key, key_hash, created_at, updated_at) VALUES (1, 1, 'x', 'x', 'h', 'a', 'a')",
        )
        .run(),
    ).toThrow(/CHECK/);

    // The account's vote goes with the account, the poll stays without a creator.
    db.prepare("DELETE FROM users WHERE id = 1").run();
    expect(db.prepare("SELECT COUNT(*) AS n FROM poll_votes").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT creator_id FROM polls").get()).toEqual({ creator_id: null });
    db.prepare("DELETE FROM polls").run();
    expect(db.prepare("SELECT COUNT(*) AS n FROM poll_votes").get()).toEqual({ n: 0 });
  });

  it("migration 5 adds the fixed-date columns and the feed table to a database at migration 4 and keeps its data", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    runMigrations(db, migrations.slice(0, 4));
    db.prepare(
      "INSERT INTO users (username, username_key, password_hash, created_at) VALUES ('Anna', 'anna', 'h', 'a')",
    ).run();
    db.prepare(
      "INSERT INTO polls (share_token, creator_id, title, kind, created_at, updated_at, expires_at) VALUES ('t', 1, 'x', 'days', 'a', 'a', 'z')",
    ).run();

    runMigrations(db);

    expect(appliedIds(db)).toEqual(migrations.map((m) => m.id));
    expect(migrations.map((m) => m.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    // The old poll is not fixed and still readable.
    expect(db.prepare("SELECT title, fixed_proposal_id, fixed_at, fixed_sequence FROM polls").get()).toEqual({
      title: "x",
      fixed_proposal_id: null,
      fixed_at: null,
      fixed_sequence: 0,
    });
    db.prepare("INSERT INTO calendar_feeds (user_id, token, created_at) VALUES (1, 'tok', 'a')").run();
    expect(() => db.prepare("INSERT INTO calendar_feeds (user_id, token, created_at) VALUES (1, 'other', 'a')").run()).toThrow(
      /UNIQUE|PRIMARY/,
    );
  });

  it("migration 5: the fixed proposal is forgotten with the proposal, the feed goes with the account", () => {
    const db = openDatabase(":memory:");
    db.prepare(
      "INSERT INTO users (username, username_key, password_hash, created_at) VALUES ('Anna', 'anna', 'h', 'a')",
    ).run();
    db.prepare(
      "INSERT INTO polls (share_token, creator_id, title, kind, created_at, updated_at, expires_at) VALUES ('t', 1, 'x', 'days', 'a', 'a', 'z')",
    ).run();
    db.prepare("INSERT INTO poll_proposals (poll_id, position, first_date, last_date) VALUES (1, 0, 'a', 'b')").run();
    expect(() => db.prepare("UPDATE polls SET fixed_proposal_id = 99").run()).toThrow(/FOREIGN KEY/);
    db.prepare("UPDATE polls SET fixed_proposal_id = 1").run();
    db.prepare("DELETE FROM poll_proposals WHERE id = 1").run();
    expect(db.prepare("SELECT fixed_proposal_id FROM polls").get()).toEqual({ fixed_proposal_id: null });

    db.prepare("INSERT INTO calendar_feeds (user_id, token, created_at) VALUES (1, 'tok', 'a')").run();
    db.prepare("DELETE FROM users WHERE id = 1").run();
    expect(db.prepare("SELECT COUNT(*) AS n FROM calendar_feeds").get()).toEqual({ n: 0 });
  });

  it("migration 7 adds the notification tables to a database at migration 6 and keeps its data", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    runMigrations(db, migrations.slice(0, 6));
    db.prepare(
      "INSERT INTO users (username, username_key, password_hash, created_at) VALUES ('Anna', 'anna', 'h', 'a')",
    ).run();
    db.prepare(
      "INSERT INTO polls (share_token, creator_id, title, kind, created_at, updated_at, expires_at) VALUES ('t', 1, 'x', 'days', 'a', 'a', 'z')",
    ).run();

    runMigrations(db);

    expect(db.prepare("SELECT title, last_reminder_at FROM polls").get()).toEqual({ title: "x", last_reminder_at: null });
    db.prepare("INSERT INTO notification_prefs (user_id) VALUES (1)").run();
    expect(db.prepare("SELECT * FROM notification_prefs").get()).toMatchObject({ poll_created: 1, vote_own: 1, vote_others: 0 });
    db.prepare("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (1, 'e', 'p', 'a', 'a')").run();
    db.prepare("INSERT INTO notifications (user_id, poll_id, data, created_at) VALUES (1, 1, '{}', 'a')").run();
    // Deleting the poll takes its notifications, deleting the user everything else.
    db.prepare("DELETE FROM polls WHERE id = 1").run();
    expect(db.prepare("SELECT COUNT(*) AS n FROM notifications").get()).toEqual({ n: 0 });
    db.prepare("DELETE FROM users WHERE id = 1").run();
    expect(db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM notification_prefs").get()).toEqual({ n: 0 });
  });

  it("migration 11 makes notifications.poll_id nullable, keeps rows and ids and never reuses an id", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    runMigrations(db, migrations.slice(0, 10));
    db.prepare(
      "INSERT INTO users (username, username_key, password_hash, created_at) VALUES ('Anna', 'anna', 'h', 'a')",
    ).run();
    db.prepare(
      "INSERT INTO polls (share_token, creator_id, title, kind, created_at, updated_at, expires_at) VALUES ('t', 1, 'x', 'days', 'a', 'a', 'z')",
    ).run();
    const insert = db.prepare("INSERT INTO notifications (user_id, poll_id, data, created_at) VALUES (1, 1, ?, 'a')");
    for (const data of ["one", "two", "three", "four", "five"]) insert.run(data);
    // The newest rows are gone before the migration: the counter stays at 5.
    db.prepare("DELETE FROM notifications WHERE id > 3").run();
    expect(db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'notifications'").get()).toEqual({ seq: 5 });

    runMigrations(db);

    expect(db.prepare("SELECT id, user_id, poll_id, data, created_at FROM notifications ORDER BY id").all()).toEqual([
      { id: 1, user_id: 1, poll_id: 1, data: "one", created_at: "a" },
      { id: 2, user_id: 1, poll_id: 1, data: "two", created_at: "a" },
      { id: 3, user_id: 1, poll_id: 1, data: "three", created_at: "a" },
    ]);
    const columns = db.prepare("PRAGMA table_info(notifications)").all() as { name: string; notnull: number }[];
    expect(columns.map((c) => c.name)).toEqual(["id", "user_id", "poll_id", "data", "created_at"]);
    expect(columns.find((c) => c.name === "poll_id")?.notnull).toBe(0);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'notifications_user_id_id'").get()).toBeDefined();

    const next = db.prepare("INSERT INTO notifications (user_id, poll_id, data, created_at) VALUES (1, NULL, 'x', 'a')").run();
    expect(Number(next.lastInsertRowid)).toBe(6);
    // The foreign keys are still there: with the poll or the user, the rows go.
    db.prepare("DELETE FROM polls WHERE id = 1").run();
    expect(db.prepare("SELECT id FROM notifications").all()).toEqual([{ id: 6 }]);
    db.prepare("DELETE FROM users WHERE id = 1").run();
    expect(db.prepare("SELECT COUNT(*) AS n FROM notifications").get()).toEqual({ n: 0 });
  });

  it("migration 11 works on a database that never stored a notification", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    runMigrations(db, migrations.slice(0, 10));
    runMigrations(db);
    db.prepare(
      "INSERT INTO users (username, username_key, password_hash, created_at) VALUES ('Anna', 'anna', 'h', 'a')",
    ).run();
    const result = db.prepare("INSERT INTO notifications (user_id, poll_id, data, created_at) VALUES (1, NULL, 'x', 'a')").run();
    expect(Number(result.lastInsertRowid)).toBe(1);
  });

  it("waits for a locked database instead of failing at once", () => {
    const db = openDatabase(":memory:");
    expect(db.prepare("PRAGMA busy_timeout").get()).toEqual({ timeout: 5000 });
  });
});
