// Shared helpers of shoot.cjs: a phone-sized browser, logged in with a made-up account.
const { chromium } = require("playwright");
const BASE = "http://localhost:5173/"; // not 127.0.0.1: the server's CORS default names localhost

async function open(user, { dark = false, password } = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "de-DE", timezoneId: "Europe/Berlin", colorScheme: dark ? "dark" : "light" });
  // The development build has no service worker, so its notification card would say "gesperrt": pretend "not asked yet".
  await context.addInitScript(() => Object.defineProperty(Notification, "permission", { get: () => "default" }));
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log("page error:", error.message));
  if (user) {
    await page.goto(BASE + "#/anmelden");
    await page.getByLabel(/Benutzername/i).fill(user);
    await page.getByLabel(/Passwort/i).fill(password);
    await page.getByRole("button", { name: /anmelden/i }).click();
    await page.waitForTimeout(1500);
  }
  return { browser, page };
}

/** Top of the card (or block) that contains this heading, in page pixels. */
const cardTop = (page, name) => page.getByRole("heading", { name }).evaluate((e) => e.closest("section,div").getBoundingClientRect().top + scrollY);

/** Bottom of that card, in page pixels. */
const cardBottom = (page, name) => page.getByRole("heading", { name }).evaluate((e) => e.closest("section,div").getBoundingClientRect().bottom + scrollY);

module.exports = { open, cardTop, cardBottom, BASE };
