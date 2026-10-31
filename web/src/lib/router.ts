export type Route = { name: "start" } | { name: "not-found" };

/** Turns a location hash like `#/` into a route. Anything unknown is "not-found". */
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, "").replace(/[?].*$/, "");
  const normalized = path === "" ? "/" : path.length > 1 ? path.replace(/\/+$/, "") : path;
  switch (normalized) {
    case "/":
      return { name: "start" };
    default:
      return { name: "not-found" };
  }
}

/** Calls `onChange` with the current route now and on every hash change. Returns a function that stops it. */
export function watchRoute(onChange: (route: Route) => void, target: Window = window): () => void {
  const update = (): void => onChange(parseRoute(target.location.hash));
  target.addEventListener("hashchange", update);
  update();
  return () => target.removeEventListener("hashchange", update);
}
