// Cloudflare Turnstile, the anti-spam check of the report form. Its script is loaded only
// when a report form opens, never for an analysis; the check itself runs on "Send report".

/** The parts of window.turnstile used here (render=explicit). */
export interface Turnstile {
  render(container: HTMLElement, params: Record<string, unknown>): string | undefined;
  execute(widgetId: string): void;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

/** Called by Turnstile once it is ready (its `onload` parameter). */
const READY_CALLBACK = 'aiprescreenTurnstileReady';
const SCRIPT_URL = `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=${READY_CALLBACK}`;
const LOAD_TIMEOUT_MS = 15_000;

/** The widget for aiprescreen.fyi; Turnstile's documented always-pass test key in development. */
export const TURNSTILE_SITE_KEY = import.meta.env.DEV ? '1x00000000000000000000AA' : '0x4AAAAAAFsznr_touzwKysw';

let loading: Promise<Turnstile> | null = null;

/**
 * Loads Turnstile once. The script at SCRIPT_URL is a loader that fetches the current
 * version, so window.turnstile exists only when Turnstile calls READY_CALLBACK, not at the
 * script's load event.
 */
export function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement('script');
    const fail = (reason: string) => {
      // A later report form tries again.
      clearTimeout(timer);
      loading = null;
      script.remove();
      reject(new Error(reason));
    };
    const timer = setTimeout(() => fail('Turnstile did not start'), LOAD_TIMEOUT_MS);
    (window as unknown as Record<string, () => void>)[READY_CALLBACK] = () => {
      clearTimeout(timer);
      if (window.turnstile) resolve(window.turnstile);
      else fail('Turnstile did not start');
    };
    script.src = SCRIPT_URL;
    script.async = true;
    script.addEventListener('error', () => fail('Turnstile could not be loaded'));
    document.head.append(script);
  });
  return loading;
}
