// The pictures of phase 10d (docs/screenshots/cinema): the cinema entry and what follows from it, a real round trip
// through the throw-away server (poll made in the app, votes through the API, date fixed in the app). Called by
// shoot.cjs; the circle and the evening come from cinema.mjs (calendars) and state.json.
const fs = require("fs");
const { cardTop } = require("./lib.cjs");
const { BASE } = require("./lib.cjs");

const API = "http://localhost:8080";
const TEAL = "#00796B"; // the seed colour of the approved mock-up: not the default, so another colour is checked too
const CIRCLE = ["Anna", "Tobi", "Emil", "Berta"]; // with Vincent, who searches

module.exports = async function cinema({ state, out, login }) {
  fs.mkdirSync(`${out}/cinema`, { recursive: true });
  const shot = (page, name, options = {}) => page.screenshot({ path: `${out}/cinema/${name}`, fullPage: true, ...options });
  const call = async (method, path, token, body) => {
    const response = await fetch(API + path, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw new Error(`${method} ${path} ${response.status}`);
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  };
  const vincent = state.tokens.Vincent;
  await call("PATCH", "/api/me", vincent, { seedColor: TEAL });

  /** Hours search of the circle on the cinema day: 2 hours at least, 17:00 to 23:00. */
  async function search(page) {
    await page.goto(BASE + "#/suche");
    await page.waitForTimeout(1200);
    for (const name of CIRCLE) await page.getByRole("checkbox", { name, exact: true }).check();
    const select = page.locator("select"); // duration, buffer, window from, window to
    await select.nth(0).selectOption("120");
    await select.nth(2).selectOption("17:00");
    await select.nth(3).selectOption("23:00");
    await page.getByRole("button", { name: "Lücken suchen" }).click();
    await page.getByRole("button", { name: "Kinoabend planen" }).waitFor();
    await page.waitForTimeout(1500);
  }

  /** The entry, filled in as in the mock-up: Kino am Markt, the day, pasted times, 130 minutes, 20 minutes of adverts. */
  async function fillEntry(page) {
    await page.getByRole("button", { name: "Kinoabend planen" }).click();
    await page.getByLabel("Titel").waitFor();
    await page.getByLabel("Titel").fill("Kinoabend");
    await page.getByLabel("Kino (Ort)").fill("Kino am Markt");
    await page.locator("input[id^=day-]").first().fill(state.cinemaDay);
    await page.getByLabel("Zeiten einfügen").fill("17:30 20:10 20:15 22:45");
    await page.getByLabel("Filmlänge").selectOption("130");
    await page.getByLabel("Werbepuffer").selectOption("20");
    await page.waitForTimeout(600);
  }

  // 1 and 2 (light): the button under the search, then the entry.
  let b = await login("Vincent");
  let page = b.page;
  await search(page);
  const button = page.getByRole("button", { name: "Kinoabend planen" });
  const top = await button.evaluate((e) => e.getBoundingClientRect().top + scrollY);
  await shot(page, "1-search-button.png", { clip: { x: 0, y: top - 24, width: 390, height: 560 } });
  await fillEntry(page);
  await shot(page, "2-entry.png");

  // For me only: a showing left out by a tap, and a second block.
  await page.getByRole("button", { name: /20:15/ }).click();
  await page.getByRole("button", { name: "Weiteres Kino oder weiterer Tag" }).click();
  await page.waitForTimeout(400);
  await shot(page, "scratch-left-out-and-second-block.png");
  await page.getByRole("button", { name: /20:15/ }).click(); // back in
  await page.getByRole("button", { name: "Entfernen" }).click();
  await page.waitForTimeout(400);

  // Create the poll.
  await page.getByLabel("Notiz (optional)").fill("Danach noch ein Bier?");
  await page.getByRole("button", { name: "Abstimmung mit 2 Terminen erstellen" }).click();
  await page.waitForURL(/#\/abstimmung\/[\w-]+/);
  await page.waitForTimeout(2000);
  const shareToken = /#\/abstimmung\/([\w-]+)/.exec(page.url())[1];
  const view = await call("GET", `/api/poll-links/${shareToken}`, vincent);
  const votes = {
    Vincent: ["yes", "yes"],
    Anna: ["yes", "maybe"],
    Tobi: ["yes", "yes"],
    Berta: ["yes", "no"],
    Emil: ["maybe", "yes"],
  };
  for (const [name, list] of Object.entries(votes)) {
    await call("PUT", `/api/poll-links/${shareToken}/my-vote`, state.tokens[name], { answers: view.proposals.map((p, i) => ({ proposalId: p.id, answer: list[i] })) });
  }
  await page.reload();
  await page.waitForTimeout(2500);
  const tableBottom = await page.getByRole("heading", { name: "Stand der Abstimmung" }).evaluate((e) => e.closest("section,div").getBoundingClientRect().bottom + scrollY);
  await shot(page, "3-poll.png", { clip: { x: 0, y: 0, width: 390, height: tableBottom + 16 } });

  // 4 and 5: fix the date (the creator picks the first showing).
  await page.locator("input[type=radio]").first().check();
  const fix = page.getByRole("button", { name: "Kalender prüfen und festlegen" });
  await fix.scrollIntoViewIfNeeded();
  await fix.click();
  await page.waitForTimeout(2500);
  await shot(page, "4-fix.png", { fullPage: false });
  await page.locator("dialog").getByRole("button", { name: /^(Trotzdem festlegen|Festlegen)$/ }).click();
  await page.waitForTimeout(2500);
  await shot(page, "5-fixed.png");
  await b.browser.close();

  // 6: a normal poll with a place for one proposal (two times picked in the search result).
  b = await login("Vincent");
  page = b.page;
  await page.goto(BASE + "#/suche");
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Alle", exact: true }).click();
  const select = page.locator("select");
  await select.nth(0).selectOption("300");
  await select.nth(2).selectOption("18:00");
  await select.nth(3).selectOption("23:00");
  await page.getByRole("button", { name: "Lücken suchen" }).click();
  await page.waitForTimeout(3500);
  const picks = page.locator(".picks button");
  await picks.nth(0).click();
  await picks.nth(1).click();
  await page.getByRole("button", { name: "Abstimmung anlegen" }).click();
  await page.getByLabel("Titel").waitFor();
  await page.getByLabel("Titel").fill("Spieleabend");
  await page.getByLabel("Notiz (optional)").fill("Ich koche.");
  await page.getByLabel("Ort (optional)").first().fill("bei Tom");
  await page.waitForTimeout(500);
  await shot(page, "6-normal-place.png");
  await b.browser.close();

  // The entry in dark mode.
  b = await login("Vincent", { dark: true });
  page = b.page;
  await search(page);
  await fillEntry(page);
  await shot(page, "2-entry-dark.png");
  await b.browser.close();

  await call("PATCH", "/api/me", vincent, { seedColor: null });
};
