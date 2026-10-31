import { describe, expect, it } from "vitest";
import { parseRoute } from "./router";

describe("parseRoute", () => {
  it.each(["", "#", "#/", "#/?utm=1"])("maps %j to the start page", (hash) => {
    expect(parseRoute(hash)).toEqual({ name: "start" });
  });

  it.each(["#/gibt-es-nicht", "#/start/extra", "#nonsense"])("maps %j to not-found", (hash) => {
    expect(parseRoute(hash)).toEqual({ name: "not-found" });
  });
});
