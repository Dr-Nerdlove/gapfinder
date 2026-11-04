export type Route =
  | { name: "start" }
  | { name: "login" }
  | { name: "invite"; token: string }
  | { name: "password-reset"; token: string }
  | { name: "profile" }
  | { name: "calendars" }
  | { name: "search" }
  | { name: "polls" }
  | { name: "poll-new" }
  | { name: "poll"; token: string }
  | { name: "admin" }
  | { name: "privacy" }
  | { name: "not-found" };

/** Invite and reset tokens are base64url: letters, digits, "-" and "_". */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,512}$/;

/** Turns a location hash like `#/` into a route. Anything unknown is "not-found". */
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, "").replace(/[?].*$/, "");
  const normalized = path === "" ? "/" : path.length > 1 ? path.replace(/\/+$/, "") : path;
  switch (normalized) {
    case "/":
      return { name: "start" };
    case "/anmelden":
      return { name: "login" };
    case "/profil":
      return { name: "profile" };
    case "/kalender":
      return { name: "calendars" };
    case "/suche":
      return { name: "search" };
    case "/abstimmungen":
      return { name: "polls" };
    case "/abstimmung-neu":
      return { name: "poll-new" };
    case "/verwaltung":
      return { name: "admin" };
    case "/privatsphaere":
      return { name: "privacy" };
  }
  const parts = normalized.split("/");
  // "/einladung/<token>" splits into ["", "einladung", "<token>"].
  if (parts.length === 3 && parts[0] === "" && parts[2] !== undefined && TOKEN_PATTERN.test(parts[2])) {
    if (parts[1] === "einladung") return { name: "invite", token: parts[2] };
    if (parts[1] === "abstimmung") return { name: "poll", token: parts[2] };
    if (parts[1] === "passwort") return { name: "password-reset", token: parts[2] };
  }
  return { name: "not-found" };
}

/** Steps back to the nearest start page entry of the app, kept in each history entry's state. */
type HistoryMark = { toStart: number | null };

/** Set by `navigate(..., { replace: true })` until the resulting hash change has been handled. */
let pendingReplace = false;
/** The value of the entry we are on now (`null` = unknown). */
let current: number | null = null;

function readMark(target: Window): number | null | undefined {
  const state: unknown = target.history.state;
  if (typeof state !== "object" || state === null || !("toStart" in state)) return undefined;
  const value = (state as HistoryMark).toStart;
  return value === null || typeof value === "number" ? value : undefined;
}

/**
 * Goes to another page, e.g. `navigate("#/")`. With `replace` the current history entry is replaced, so a
 * redirect does not leave an extra step for the Back button.
 */
export function navigate(hash: string, options: { replace?: boolean } = {}, target: Window = window): void {
  if (options.replace && target.location.hash !== hash) {
    pendingReplace = true;
    const href = target.location.href;
    const at = href.indexOf("#");
    target.location.replace((at === -1 ? href : href.slice(0, at)) + hash);
    return;
  }
  target.location.hash = hash;
}

/**
 * Goes back to the start page by stepping back in the history, so Back on the start page leaves the app.
 * Without a start page in the history it replaces the current entry with the start page.
 */
export function goToStart(target: Window = window): void {
  const toStart = readMark(target);
  if (typeof toStart === "number") {
    if (toStart >= 1) target.history.go(-toStart);
    return;
  }
  navigate("#/", { replace: true }, target);
}

/** Calls `onChange` with the current route now and on every hash change. Returns a function that stops it. */
export function watchRoute(onChange: (route: Route) => void, target: Window = window): () => void {
  let first = true;
  const update = (): void => {
    const route = parseRoute(target.location.hash);
    const known = readMark(target);
    let value: number | null;
    if (known !== undefined) {
      value = known;
    } else {
      if (route.name === "start") value = 0;
      else if (first) value = null;
      else if (pendingReplace) value = current === 0 ? null : current;
      else value = current === null ? null : current + 1;
      const existing: unknown = target.history.state;
      const base = typeof existing === "object" && existing !== null ? existing : {};
      target.history.replaceState({ ...base, toStart: value }, "");
    }
    pendingReplace = false;
    current = value;
    first = false;
    onChange(route);
  };
  target.addEventListener("hashchange", update);
  update();
  return () => target.removeEventListener("hashchange", update);
}
