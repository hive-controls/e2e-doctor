/**
 * The generic remote backend: connect to a browser someone else is running.
 *
 * `E2E_DOCTOR_GATE=cdp` plus `E2E_DOCTOR_CDP_URL` is the whole contract. It is what a
 * cloud-grid vendor, a colleague's debug browser, or a CI container full of Chromium
 * looks like from here — a URL, optional headers, and a page we own once connected.
 * Because the page is ours, recording is the same injected rrweb the local backend
 * uses; nothing about this backend knows a vendor's name, which is exactly why a
 * configurator can point it anywhere without the product learning new vendors.
 *
 * TWO HANDSHAKES, because the ecosystem has two. A raw DevTools endpoint (what
 * `chromium --remote-debugging-port` prints, `ws://…/devtools/browser/<id>`) speaks
 * CDP and needs `connectOverCDP`. A vendor's Playwright-server endpoint (BrowserStack's
 * `wss://cdp.browserstack.com/playwright?caps=…` is the documented example) speaks
 * Playwright's own protocol and needs `connect`. They are not interchangeable, and
 * nothing in the URL is required to say which — so the scheme is the default signal
 * (`ws://`/`http://` → CDP, `wss://`/`https://` → Playwright server, matching how each
 * is served in practice) and `E2E_DOCTOR_CDP_MODE=cdp|playwright` overrides it for the
 * case the default reads wrong. A wrong guess fails at connect time with the vendor's
 * own error, never silently.
 *
 * UNVERIFIED against any cloud vendor: exercised in this repo only against a locally
 * launched Chromium's own DevTools endpoint (driver/cdp.test.mts), which is the
 * `connectOverCDP` half.
 */
import { chromium, type Browser } from "playwright-core";
import type { Driver, DriverSession } from "./types.mts";
import { attachRrwebRecorder } from "./rrweb-recorder.mts";
import { flushRecorder } from "./recorder-flush.mts";

export type CdpHandshake = "cdp" | "playwright";

export interface CdpDriverOptions {
  url: string;
  headers?: Record<string, string>;
  /** Overrides the scheme-derived default. */
  handshake?: CdpHandshake;
  /** Test seam; defaults to Playwright's own two connect calls. */
  connect?: (
    url: string,
    handshake: CdpHandshake,
    headers?: Record<string, string>,
  ) => Promise<Browser>;
}

/** `ws://`/`http://` is a raw DevTools endpoint; a TLS scheme is a hosted Playwright
 *  server. A URL with neither is refused rather than guessed at. */
export function handshakeForUrl(url: string): CdpHandshake {
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    throw new Error(`E2E_DOCTOR_CDP_URL is not a URL: "${url}"`);
  }
  if (protocol === "ws:" || protocol === "http:") return "cdp";
  if (protocol === "wss:" || protocol === "https:") return "playwright";
  throw new Error(
    `E2E_DOCTOR_CDP_URL has an unsupported scheme "${protocol}" (expected ws, wss, http or https)`,
  );
}

function defaultConnect(
  url: string,
  handshake: CdpHandshake,
  headers?: Record<string, string>,
): Promise<Browser> {
  return handshake === "cdp"
    ? chromium.connectOverCDP(url, headers ? { headers } : {})
    : chromium.connect(url, headers ? { headers } : {});
}

export class CdpDriver implements Driver {
  readonly name = "cdp";
  readonly canRecord = true;

  constructor(private readonly options: CdpDriverOptions) {}

  async open(): Promise<DriverSession> {
    const handshake =
      this.options.handshake ?? handshakeForUrl(this.options.url);
    const connect = this.options.connect ?? defaultConnect;
    const browser = await connect(
      this.options.url,
      handshake,
      this.options.headers,
    );
    // Before the first page exists, so the init script covers every document — the
    // same ordering constraint the local backend has.
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const recorder = await attachRrwebRecorder(context);
    const page = context.pages()[0] ?? (await context.newPage());

    return {
      sessionId: `cdp-${Date.now()}`,
      page,
      async fetchReplay() {
        if (!page.isClosed()) await flushRecorder(page);
        return recorder.events();
      },
      async close() {
        await browser.close();
      },
    };
  }
}
