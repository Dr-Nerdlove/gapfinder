// Takes the pictures of docs/screenshots that show the whole app (see README.md in this folder). Needs the fake
// server, the web app and seed.mjs (run.sh does all of it). Writes into $SHOTS_DIR/out; with --install it copies
// them to docs/screenshots.
const fs = require("fs");
const path = require("path");
const { open, cardTop, cardBottom, BASE } = require("./lib.cjs");

const dir = process.env.SHOTS_DIR;
const out = `${dir}/out`;
const state = JSON.parse(fs.readFileSync(`${dir}/state.json`, "utf8"));
const API = "http://localhost:8080";
const shot = (page, name, options = {}) => page.screenshot({ path: `${out}/${name}`, fullPage: true, ...options });

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const login = (user, options = {}) => open(user, { password: state.password, ...options });

  // Login, invite link and start page (the version line is cropped out: it changes with every release).
  let b = await login(null);
  await b.page.goto(BASE + "#/anmelden");
  await b.page.waitForTimeout(1500);
  await shot(b.page, "login.png");
  await b.page.goto(`${BASE}#/einladung/${state.benInvite}`);
  await b.page.waitForTimeout(1500);
  await shot(b.page, "invite.png");
  await b.browser.close();

  b = await login("Anna");
  await b.page.goto(BASE + "#/");
  await b.page.waitForTimeout(1500);
  const skip = b.page.getByRole("button", { name: "Überspringen" }); // the tour of a new account
  if (await skip.count()) await skip.click();
  await b.page.waitForTimeout(800);
  await shot(b.page, "start-logged-in.png", { clip: { x: 0, y: 0, width: 390, height: (await cardBottom(b.page, "Hallo Anna")) + 16 } });
  // Profile of an ordinary account: the admin cannot delete theirs, so only here "Konto löschen" is complete.
  await b.page.goto(BASE + "#/profil");
  await b.page.reload();
  await b.page.waitForTimeout(2500);
  await shot(b.page, "profile.png");
  // Calendars page: Anna's calendar with its two switches and the preview of the next 4 weeks.
  await b.page.goto(BASE + "#/kalender");
  await b.page.reload();
  await b.page.getByText("Deine nächsten 4 Wochen").waitFor();
  await b.page.waitForTimeout(2500);
  await shot(b.page, "calendars.png");
  await b.browser.close();

  // Admin area in dark mode: a new invite with its "So geht's" text, the open invites and the first accounts.
  b = await login("Vincent", { dark: true });
  for (const invite of await (await fetch(`${API}/api/admin/invites`, { headers: { authorization: `Bearer ${state.tokens.Vincent}` } })).json()) {
    await fetch(`${API}/api/admin/invites/${invite.id}`, { method: "DELETE", headers: { authorization: `Bearer ${state.tokens.Vincent}` } });
  }
  await b.page.goto(BASE + "#/verwaltung");
  await b.page.waitForTimeout(2000);
  await b.page.getByLabel("Benutzername").fill("Samuel Kr.");
  await b.page.getByRole("button", { name: "Einladungslink erstellen" }).click();
  await b.page.waitForTimeout(1500);
  const top = await cardTop(b.page, "Freunde einladen");
  const bottom = await b.page.getByText("Berta", { exact: true }).evaluate((e) => e.getBoundingClientRect().top + scrollY);
  await shot(b.page, "admin.png", { clip: { x: 0, y: top - 6, width: 390, height: bottom - top - 6 } });
  await b.browser.close();

  // Search: the form with a group chosen, then everybody for Saturdays and Sundays, 5 hours, 18:00 to 23:00.
  b = await login("Vincent");
  const page = b.page;
  await page.goto(BASE + "#/suche");
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: /Spieleabend/ }).click();
  await page.waitForTimeout(400);
  await shot(page, "search-form.png");
  await page.getByRole("button", { name: "Alle", exact: true }).click();
  const select = page.locator("select"); // duration, buffer, window from, window to
  await select.nth(0).selectOption("300");
  await select.nth(2).selectOption("18:00");
  await select.nth(3).selectOption("23:00");
  await page.getByRole("button", { name: "Lücken suchen" }).click();
  await page.waitForTimeout(3500);
  const resultTop = await cardTop(page, "Ergebnis");
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await shot(page, "search-results.png", { clip: { x: 0, y: resultTop - 12, width: 390, height: height - resultTop - 0 } });
  // The same answer as a colour grid, the first day with a number opened.
  await page.getByRole("button", { name: "Raster", exact: true }).click();
  await page.waitForTimeout(400);
  await page.locator("table[aria-label='Monatsraster der Suche'] button.cell:not(.empty)").first().click();
  await page.waitForTimeout(400);
  const gridTop = await cardTop(page, "Raster");
  const gridHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  await shot(page, "search-grid.png", { clip: { x: 0, y: gridTop - 12, width: 390, height: gridHeight - gridTop } });
  await b.browser.close();

  // Poll page of Sophie: "Nicht berücksichtigt" and the hints from her own calendar (busy on one proposal, "Ja" chosen).
  b = await login("Sophie");
  await b.page.goto(`${BASE}#/abstimmung/${state.poll.shareToken}`);
  await b.page.waitForTimeout(2500);
  const yes = b.page.getByRole("button", { name: "Ja", exact: true });
  await yes.nth(0).click();
  await yes.nth(1).click();
  await b.page.waitForTimeout(500);
  const pollTop = await cardTop(b.page, "Noch nicht abgestimmt");
  const pollBottom = await b.page.getByRole("button", { name: "Stimme abgeben" }).evaluate((e) => e.getBoundingClientRect().bottom + scrollY);
  await shot(b.page, "poll-calendar-check.png", { clip: { x: 0, y: pollTop - 12, width: 390, height: pollBottom - pollTop + 36 } });
  await b.browser.close();

  // Fixing the date (this changes the poll, so it is the last step): the creator picks the busy proposal, then a guest looks.
  b = await login("Vincent");
  await b.page.goto(`${BASE}#/abstimmung/${state.poll.shareToken}`);
  await b.page.waitForTimeout(2500);
  await b.page.locator("input[type=radio]").nth(state.poll.busyIndex).check();
  const fix = b.page.getByRole("button", { name: "Kalender prüfen und festlegen" });
  await fix.scrollIntoViewIfNeeded();
  await fix.click();
  await b.page.waitForTimeout(2500);
  await shot(b.page, "fix-check.png", { fullPage: false });
  await b.page.getByRole("button", { name: /festlegen$/ }).last().click();
  await b.page.waitForTimeout(2500);
  // The creator's view of the fixed date, scrolled so the "Verwalten" card (close button disabled) ends the picture.
  await b.page.getByRole("button", { name: "Abstimmung löschen" }).scrollIntoViewIfNeeded();
  await b.page.evaluate(() => window.scrollBy(0, 200));
  await shot(b.page, "date-fixed-creator.png", { fullPage: false });
  await b.browser.close();
  b = await login(null);
  await b.page.goto(`${BASE}#/abstimmung/${state.poll.shareToken}`);
  await b.page.waitForTimeout(2500);
  await shot(b.page, "date-fixed-guest.png", { fullPage: false });
  await b.browser.close();

  if (process.argv.includes("--install")) {
    const target = path.resolve(__dirname, "../../docs/screenshots");
    const where = {
      "login.png": "login.png", "invite.png": "invite.png", "start-logged-in.png": "start-logged-in.png", "profile.png": "profile.png",
      "calendars.png": "calendars.png",
      "admin.png": "admin.png", "search-form.png": "search-form.png", "search-results.png": "search-results.png", "search-grid.png": "search-grid.png",
      "poll-calendar-check.png": "polls/7-calendar-check.png", "fix-check.png": "fix-date/2-fix-check.png", "date-fixed-creator.png": "fix-date/3-date-fixed-creator.png",
      "date-fixed-guest.png": "fix-date/4-date-fixed-guest.png",
    };
    for (const [from, to] of Object.entries(where)) fs.copyFileSync(`${out}/${from}`, `${target}/${to}`);
    console.log(`copied ${Object.keys(where).length} pictures to ${target}`);
  } else console.log(`pictures are in ${out} (run with --install to copy them into docs/screenshots)`);
})();
