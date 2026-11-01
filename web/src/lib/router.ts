export type Route =
  | { name: "start" }
  | { name: "login" }
  | { name: "invite"; token: string }
  | { name: "password-reset"; token: string }
  | { name: "profile" }
  | { name: "admin" }
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
    case "/verwaltung":
      return { name: "admin" };
  }
  const parts = normalized.split("/");
  // "/einladung/<token>" splits into ["", "einladung", "<token>"].
  if (parts.length === 3 && parts[0] === "" && parts[2] !== undefined && TOKEN_PATTERN.test(parts[2])) {
    if (parts[1] === "einladung") return { name: "invite", token: parts[2] };
    if (parts[1] === "passwort") return { name: "password-reset", token: parts[2] };
  }
  return { name: "not-found" };
}

/** Goes to another page, e.g. `navigate("#/")`. */
export function navigate(hash: string, target: Window = window): void {
  target.location.hash = hash;
}

/** Calls `onChange` with the current route now and on every hash change. Returns a function that stops it. */
export function watchRoute(onChange: (route: Route) => void, target: Window = window): () => void {
  const update = (): void => onChange(parseRoute(target.location.hash));
  target.addEventListener("hashchange", update);
  update();
  return () => target.removeEventListener("hashchange", update);
}
