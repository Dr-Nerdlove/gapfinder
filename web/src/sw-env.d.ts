// Types for type-checking the service worker (tsconfig.sw.json has no DOM library). The worker never calls
// these parts; they are only imported along with the shared text helpers.
interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
interface ImportMeta {
  readonly env: Record<string, string | undefined>;
}
declare const __APP_RELEASE__: string;
declare const __APP_BUILD__: string;
declare var localStorage: Storage | undefined;
