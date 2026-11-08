// Makes the made-up circle of friends for the screenshots through the real API: 14 accounts (Vincent is the admin),
// a calendar for everybody but Lena, two groups, a poll with two proposals and one open invite for "Ben M.".
// Writes state.json (tokens, ids, poll) into SHOTS_DIR for shoot.cjs.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dir = process.env.SHOTS_DIR;
if (!dir) throw new Error("SHOTS_DIR is not set (run.sh sets it)");
const API = "http://localhost:8080";
export const PASSWORD = "Test-Passwort-123";

async function call(method, path, body, token) {
  const response = await fetch(API + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

// The first admin comes from the command line tool, like on the real server.
const cli = execFileSync("node", ["dist/cli.js", "admin-link", "Vincent"], { cwd: `${root}/server`, env: process.env, encoding: "utf8" });
const adminInvite = /#\/einladung\/([\w-]+)/.exec(cli)?.[1];
if (!adminInvite) throw new Error(`no admin link in: ${cli}`);
const admin = await call("POST", `/api/invites/${adminInvite}/accept`, { password: PASSWORD });
const tokens = { Vincent: admin.token };

const names = ["Anna", "Anna K.", "Max", "Lena", "Tobi", "Berta", "Tobias", "Clara", "Jonas", "Sophie", "Emil", "Mia", "Paul"];
for (const name of names) {
  const invite = await call("POST", "/api/admin/invites", { username: name }, admin.token);
  tokens[name] = (await call("POST", `/api/invites/${invite.token}/accept`, { password: PASSWORD })).token;
}
for (const [name, token] of Object.entries(tokens)) {
  if (name === "Lena") continue; // Lena has no calendar: "kein Kalender verknüpft"
  await call("POST", "/api/calendars", { link: `https://cal.example/${encodeURIComponent(name)}.ics`, name: "Privat" }, token);
}
const ids = Object.fromEntries((await call("GET", "/api/people", null, admin.token)).people.map((p) => [p.username, p.id]));
const ofNames = (list) => list.map((n) => ids[n]);
await call("POST", "/api/groups", { name: "Spieleabend", members: ofNames(["Anna", "Max", "Tobi", "Berta", "Tobias"]) }, admin.token);
await call("POST", "/api/groups", { name: "Uni-Leute", members: ofNames(["Clara", "Jonas", "Sophie", "Emil"]) }, admin.token);

// The poll: the first two Saturdays at least a week ahead, 18:00 to 23:00 Berlin time. Sophie's made-up calendar is
// busy on one of them and free on the other (see fake-server.mts).
const berlinHour = (d) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hourCycle: "h23" }).format(d));
const saturdays = [];
for (let days = 7; saturdays.length < 2; days++) {
  const day = new Date(Date.now() + days * 86400000);
  if (day.getUTCDay() !== 6) continue;
  day.setUTCHours(0, 0, 0, 0);
  const start = [16, 17].map((h) => new Date(day.getTime() + h * 3600000)).find((d) => berlinHour(d) === 18);
  saturdays.push({ day, start, end: new Date(start.getTime() + 5 * 3600000) });
}
const poll = await call("POST", "/api/polls", {
  kind: "timed", title: "Spieleabend", note: "Bei mir, ich koche",
  participants: ofNames(["Anna", "Max", "Tobi", "Berta", "Sophie", "Lena"]),
  deadline: new Date(Math.floor((Date.now() + 5 * 86400000) / 60000) * 60000).toISOString(), // whole minutes only
  proposals: saturdays.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })),
}, admin.token);
const answers = { Anna: ["yes", "yes"], Tobi: ["yes", "yes"], Berta: ["no", "yes"], Vincent: ["yes", "yes"] };
for (const [name, list] of Object.entries(answers)) {
  await call("PUT", `/api/poll-links/${poll.shareToken}/my-vote`, { answers: poll.proposals.map((p, i) => ({ proposalId: p.id, answer: list[i] })) }, tokens[name]);
}
// Which of the two proposals (in the order of the page) is the one where Sophie is busy: the even week.
const busyIndex = saturdays.findIndex((s) => Math.floor(s.day.getTime() / 86400000 / 7) % 2 === 0);

const invite = await call("POST", "/api/admin/invites", { username: "Ben M." }, admin.token);
writeFileSync(`${dir}/state.json`, JSON.stringify({ tokens, ids, poll: { id: poll.id, shareToken: poll.shareToken, busyIndex }, benInvite: invite.token, password: PASSWORD }, null, 1));
console.log(`seeded ${Object.keys(tokens).length} accounts, a poll and an invite`);
