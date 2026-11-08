import { describe, expect, it, vi } from "vitest";
import { canShare, deliverIcs, shareLink, toBase64 } from "./native-actions";

const data = { title: "Lückenfüller", text: "Komm", url: "https://x/#/a" };

describe("share", () => {
  it("uses the app inside the app, even without navigator.share", async () => {
    const share = vi.fn(async () => undefined);
    const env = { isApp: true, app: { share } };
    expect(canShare(env)).toBe(true);
    await shareLink(env, data);
    expect(share).toHaveBeenCalledWith(data);
  });

  it("uses the browser's share outside the app and never the app", async () => {
    const share = vi.fn(async () => undefined);
    const browserShare = vi.fn(async () => undefined);
    const env = { isApp: false, app: { share }, browserShare };
    expect(canShare(env)).toBe(true);
    await shareLink(env, data);
    expect(browserShare).toHaveBeenCalledWith(data);
    expect(share).not.toHaveBeenCalled();
  });

  it("leaves the address out of the browser's share when it is empty", async () => {
    const browserShare = vi.fn(async () => undefined);
    await shareLink({ isApp: false, app: { share: vi.fn() }, browserShare }, { ...data, url: "" });
    expect(browserShare).toHaveBeenCalledWith({ title: data.title, text: data.text });
  });

  it("offers no share button in a browser without navigator.share", () => {
    expect(canShare({ isApp: false, app: { share: async () => undefined } })).toBe(false);
  });
});

describe("deliverIcs", () => {
  const ics = "BEGIN:VCALENDAR\r\nSUMMARY:Grillen für Äpfel\r\nEND:VCALENDAR\r\n";

  it("hands the file to the app as base64 inside the app", async () => {
    const openFile = vi.fn(async () => undefined);
    const download = vi.fn();
    await deliverIcs({ isApp: true, app: { openFile }, download }, ics);
    expect(openFile).toHaveBeenCalledWith({ name: "termin.ics", mimeType: "text/calendar", base64: toBase64(ics) });
    expect(download).not.toHaveBeenCalled();
    expect(Buffer.from(toBase64(ics), "base64").toString("utf8")).toBe(ics);
  });

  it("downloads in a browser and never calls the app", async () => {
    const openFile = vi.fn(async () => undefined);
    const download = vi.fn();
    await deliverIcs({ isApp: false, app: { openFile }, download }, ics);
    expect(download).toHaveBeenCalledWith(ics);
    expect(openFile).not.toHaveBeenCalled();
  });
});
