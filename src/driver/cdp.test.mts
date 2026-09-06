/**
 * The generic remote backend, exercised against a REAL browser: a Chromium launched
 * here with `--remote-debugging-port`, connected to over its own DevTools endpoint
 * exactly as a remote one would be. The vendor half (a hosted Playwright server over
 * wss) has no account to run against, so only its handshake selection is pinned.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser } from "playwright-core";
import { CdpDriver, handshakeForUrl } from "./cdp.mts";

test("the handshake follows the URL scheme, and an unusable URL is refused by name", () => {
  assert.equal(
    handshakeForUrl("ws://127.0.0.1:9222/devtools/browser/x"),
    "cdp",
  );
  assert.equal(handshakeForUrl("http://127.0.0.1:9222"), "cdp");
  assert.equal(
    handshakeForUrl("wss://cdp.browserstack.com/playwright?caps=%7B%7D"),
    "playwright",
  );
  assert.throws(() => handshakeForUrl("not a url"), /is not a URL/);
  assert.throws(() => handshakeForUrl("ftp://x/"), /unsupported scheme/);
});

test("headers and the chosen handshake reach the connect call untouched", async () => {
  const seen: { url: string; handshake: string; headers?: unknown }[] = [];
  const driver = new CdpDriver({
    url: "wss://vendor.example/playwright",
    headers: { authorization: "Bearer t" },
    connect: async (url, handshake, headers) => {
      seen.push({ url, handshake, headers });
      throw new Error("stop here — the connect arguments are the assertion");
    },
  });
  await assert.rejects(() => driver.open(), /stop here/);
  assert.deepEqual(seen, [
    {
      url: "wss://vendor.example/playwright",
      handshake: "playwright",
      headers: { authorization: "Bearer t" },
    },
  ]);
});

/** A port nothing is listening on right now. Racy in principle, fine in a test: the
 *  browser claims it milliseconds later, and a clash surfaces as a launch failure. */
async function freePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => resolve(port));
    });
  });
}

/** Chromium serves its DevTools endpoint a moment after the process starts. */
async function devtoolsEndpoint(port: number): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      const body = (await response.json()) as { webSocketDebuggerUrl: string };
      if (body.webSocketDebuggerUrl) return body.webSocketDebuggerUrl;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`no DevTools endpoint on 127.0.0.1:${port}`);
}

test("connects to a locally launched Chromium over its own DevTools endpoint and records the page", async () => {
  const port = await freePort();
  let browser: Browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [`--remote-debugging-port=${port}`],
    });
  } catch (error) {
    // No Chromium installed for playwright-core: the suite's other files report that
    // far more clearly than a confusing failure here would.
    assert.match((error as Error).message, /Executable doesn't exist|ENOENT/);
    return;
  }
  try {
    const endpoint = await devtoolsEndpoint(port);
    assert.equal(handshakeForUrl(endpoint), "cdp");
    const driver = new CdpDriver({ url: endpoint });
    const session = await driver.open();
    try {
      await session.page.goto("data:text/html,<h1>cdp gate</h1>");
      assert.equal(await session.page.textContent("h1"), "cdp gate");
      const events = await session.fetchReplay();
      assert.equal(Array.isArray(events), true);
    } finally {
      await session.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
  }
});
