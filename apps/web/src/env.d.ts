/// <reference types="vite/client" />

declare const __BUILD_ID__: string;

interface ImportMetaEnv {
  /** Bausteinübersicht `/_bausteine` für Playwright (Theme-, Dichte-, Breiten-, a11y-Tests); nie in prod. */
  readonly VITE_GALLERY?: string;
}
