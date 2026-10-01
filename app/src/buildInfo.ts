/** The app's build ("2026-10-01 · 85591b8": build date and commit), set by vite.config.ts. */
declare const __APP_BUILD__: string | undefined;

export const APP_BUILD: string = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev';
