import type { LueckenfuellerPlugin } from "./native";

// Share and calendar file: inside the Android app they go through the app, in a browser as before.

export interface NativeShareEnv {
  isApp: boolean;
  app: Pick<LueckenfuellerPlugin, "share">;
  /** `navigator.share`, where the browser has it. */
  browserShare?: ((data: { title: string; text: string; url?: string }) => Promise<void>) | undefined;
}

export function canShare(env: NativeShareEnv): boolean {
  return env.isApp || typeof env.browserShare === "function";
}

/** `url` may be empty when the text already holds the link; the browser would otherwise add this page's address. */
export async function shareLink(env: NativeShareEnv, data: { title: string; text: string; url: string }): Promise<void> {
  if (env.isApp) await env.app.share(data);
  else await env.browserShare?.(data.url ? data : { title: data.title, text: data.text });
}

export interface IcsEnv {
  isApp: boolean;
  app: Pick<LueckenfuellerPlugin, "openFile">;
  /** The browser's download. */
  download(text: string): void;
}

export const ICS_NAME = "termin.ics";
export const ICS_TYPE = "text/calendar";

/** The text as base64 of its UTF-8 bytes. */
export function toBase64(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function deliverIcs(env: IcsEnv, text: string): Promise<void> {
  if (env.isApp) await env.app.openFile({ name: ICS_NAME, mimeType: ICS_TYPE, base64: toBase64(text) });
  else env.download(text);
}
