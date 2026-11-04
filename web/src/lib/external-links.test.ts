import { describe, expect, it, vi } from "vitest";
import { externalLinkTarget, handleLinkClick } from "./external-links";

const PAGE = "https://dr-nerdlove.github.io/gapfinder/#/profil";

describe("externalLinkTarget", () => {
  it("keeps hash links and links to the app's own origin", () => {
    for (const href of ["#/abstimmung/abc", "#", "/gapfinder/", "/gapfinder/icon.png", "https://dr-nerdlove.github.io/gapfinder/#/x", "relative"]) {
      expect(externalLinkTarget(href, PAGE), href).toBeNull();
    }
  });

  it("sends other sites and other schemes out", () => {
    expect(externalLinkTarget("https://calendar.google.com/x?a=1", PAGE)).toBe("https://calendar.google.com/x?a=1");
    expect(externalLinkTarget("http://other.example/", PAGE)).toBe("http://other.example/");
    expect(externalLinkTarget("webcal://api.test/feed.ics", PAGE)).toBe("webcal://api.test/feed.ics");
    expect(externalLinkTarget("mailto:a@b.de", PAGE)).toBe("mailto:a@b.de");
    expect(externalLinkTarget("tel:+49123", PAGE)).toBe("tel:+49123");
  });

  it("sends other projects on the same origin out", () => {
    expect(externalLinkTarget("https://dr-nerdlove.github.io/game-night/", PAGE)).toBe("https://dr-nerdlove.github.io/game-night/");
    expect(externalLinkTarget("/gapfinder-other/", PAGE)).toBe("https://dr-nerdlove.github.io/gapfinder-other/");
    expect(externalLinkTarget("https://dr-nerdlove.github.io/", PAGE)).toBe("https://dr-nerdlove.github.io/");
    expect(externalLinkTarget("/gapfinder/icon.png", "https://dr-nerdlove.github.io/gapfinder/index.html")).toBeNull();
  });

  it("keeps unknown schemes and broken addresses", () => {
    expect(externalLinkTarget("javascript:void(0)", PAGE)).toBeNull();
    expect(externalLinkTarget("blob:https://x/1", PAGE)).toBeNull();
    expect(externalLinkTarget("https://x", "not a url")).toBeNull();
  });
});

describe("handleLinkClick", () => {
  const eventFor = (href: string | null) => ({
    target: { closest: () => (href === null ? null : { getAttribute: () => href }) },
    preventDefault: vi.fn(),
  });

  it("opens an outside link elsewhere and stops the click", () => {
    const open = vi.fn();
    const event = eventFor("https://other.example/");
    handleLinkClick(event, PAGE, open);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith("https://other.example/");
  });

  it("leaves hash links, own links and clicks outside a link alone", () => {
    const open = vi.fn();
    for (const href of ["#/profil", "https://dr-nerdlove.github.io/gapfinder/", null]) {
      const event = eventFor(href);
      handleLinkClick(event, PAGE, open);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    handleLinkClick({ target: null, preventDefault: vi.fn() }, PAGE, open);
    expect(open).not.toHaveBeenCalled();
  });
});
