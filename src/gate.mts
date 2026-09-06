/**
 * The gate — which browser runs the spec.
 *
 * Two gates ship with the product: `solari` (Outside — the session runs remotely and
 * the backend records it server-side) and `local` (Inside — the session runs on this
 * machine and rrweb is injected into the page). The rules are the product:
 *
 *   - `E2E_DOCTOR_GATE` names the gate explicitly and always wins. A typo is refused,
 *     never silently local: a CI run meant to produce a cloud recording would
 *     otherwise pass green with no recording at all.
 *   - Unset, solari is chosen when its key resolves, else local.
 *   - Whatever was chosen is announced in one line before anything runs.
 *
 * A platform layer can offer more gates by handing `replaySpec` a driver of its own;
 * this file is the product's own default, not a registry.
 */
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import type { Driver } from "./driver/types.mts";
import {
  CdpDriver,
  handshakeForUrl,
  type CdpHandshake,
} from "./driver/cdp.mts";
import { LocalPlaywrightDriver } from "./driver/local-playwright.mts";
import { SolariDriver } from "./driver/solari.mts";
import type { Spec } from "./spec/types.mts";
import { envVar, readEnv } from "./env.mts";

export const GATE_VAR = envVar("GATE");

export type GateName = "solari" | "local" | "cdp";
/** Outside gates run remotely; Inside gates run on this machine. */
export type GateKind = "Outside" | "Inside";

export interface Presence {
  ready: boolean;
  /** Human-readable, printed verbatim in the announcement or the refusal. */
  reason: string;
}

/** Facts about this machine the presence checks need; injectable for tests. */
export interface GateProbes {
  localBrowserInstalled(): boolean;
}

export interface Gate {
  readonly name: GateName;
  /** The kind this gate is when nothing about the environment can change it. */
  readonly kind: GateKind;
  /** Overrides `kind` for a gate whose reachability depends on configuration — the
   *  generic remote gate is Inside when it points at this machine's own browser and
   *  Outside when it points anywhere else. */
  kindFor?(env: NodeJS.ProcessEnv): GateKind;
  presence(env: NodeJS.ProcessEnv, probes: GateProbes): Presence;
  open(env: NodeJS.ProcessEnv): Driver;
}

const solariGate: Gate = {
  name: "solari",
  kind: "Outside",
  presence(env) {
    return env.SOLARI_API_KEY
      ? { ready: true, reason: "SOLARI_API_KEY resolves" }
      : { ready: false, reason: "SOLARI_API_KEY is not set" };
  },
  open(env) {
    return new SolariDriver({ apiKey: env.SOLARI_API_KEY as string });
  },
};

const localGate: Gate = {
  name: "local",
  kind: "Inside",
  presence(_env, probes) {
    return probes.localBrowserInstalled()
      ? { ready: true, reason: "Chromium is installed" }
      : {
          ready: false,
          reason:
            "Chromium is not installed for playwright-core (run: npx playwright install chromium)",
        };
  },
  open(env) {
    // Headless by default — a replay wants no window. `E2E_DOCTOR_HEADED=1` is what
    // the `record` command sets: a human cannot click a browser they cannot see.
    return new LocalPlaywrightDriver({
      headless: readEnv("HEADED", env) === "1" ? false : undefined,
    });
  },
};

/** `E2E_DOCTOR_CDP_HEADERS` is a JSON object of header name → value; anything else is
 *  refused by name rather than silently dropped, because a missing auth header shows up
 *  as an opaque vendor rejection minutes later. */
export function parseCdpHeaders(
  raw: string | undefined,
): Record<string, string> | undefined {
  if (!raw || raw.trim() === "") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${envVar("CDP_HEADERS")} is not valid JSON`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `${envVar("CDP_HEADERS")} must be a JSON object of header name to value`,
    );
  }
  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).map(([name, value]) => [
      name,
      String(value),
    ]),
  );
}

/**
 * The generic remote gate: a browser someone else is running, named by URL. It is what
 * a platform layer resolves a cloud-vendor choice into, and what a debug browser on
 * this machine looks like too — which is why its kind is read from the URL rather than
 * fixed: a loopback endpoint is Inside, anything else is Outside.
 */
const cdpGate: Gate = {
  name: "cdp",
  kind: "Outside",
  kindFor(env) {
    const url = readEnv("CDP_URL", env) ?? "";
    try {
      return isPrivateHost(new URL(url).hostname) ? "Inside" : "Outside";
    } catch {
      return "Outside";
    }
  },
  presence(env) {
    const url = readEnv("CDP_URL", env);
    return url
      ? { ready: true, reason: `${envVar("CDP_URL")} resolves` }
      : { ready: false, reason: `${envVar("CDP_URL")} is not set` };
  },
  open(env) {
    const mode = readEnv("CDP_MODE", env);
    const url = readEnv("CDP_URL", env) as string;
    if (mode && mode !== "cdp" && mode !== "playwright") {
      throw new Error(
        `unsupported ${envVar("CDP_MODE")} "${mode}" (expected cdp or playwright)`,
      );
    }
    return new CdpDriver({
      url,
      headers: parseCdpHeaders(readEnv("CDP_HEADERS", env)),
      handshake: (mode as CdpHandshake | undefined) ?? handshakeForUrl(url),
    });
  },
};

/** Preference order for the default search: solari first, local the fallback that
 *  needs no key. `cdp` is explicit-only — it has nothing to auto-select toward, and a
 *  stray endpoint variable must never silently steer a run. */
export const GATES: readonly Gate[] = [solariGate, localGate, cdpGate];

export interface GateSelection {
  gate: Gate;
  /** The gate's kind for THIS environment — `cdp` is Inside or Outside by URL. */
  kind: GateKind;
  driver: Driver;
  how: "explicit" | "default";
  reason: string;
}

export const defaultProbes: GateProbes = {
  localBrowserInstalled: () => existsSync(chromium.executablePath()),
};

export function selectGate(
  env: NodeJS.ProcessEnv = process.env,
  probes: GateProbes = defaultProbes,
): GateSelection {
  const requested = (readEnv("GATE", env) ?? "").trim();
  const names = GATES.map((gate) => `"${gate.name}"`).join(" or ");
  if (requested) {
    const gate = GATES.find((candidate) => candidate.name === requested);
    if (!gate) {
      throw new Error(
        `unsupported ${GATE_VAR} "${requested}" (expected ${names})`,
      );
    }
    const presence = gate.presence(env, probes);
    if (!presence.ready) {
      throw new Error(`${GATE_VAR}=${gate.name} but ${presence.reason}`);
    }
    return {
      gate,
      kind: gate.kindFor?.(env) ?? gate.kind,
      driver: gate.open(env),
      how: "explicit",
      reason: `${GATE_VAR}=${gate.name}`,
    };
  }
  const skipped: string[] = [];
  for (const gate of GATES) {
    const presence = gate.presence(env, probes);
    if (presence.ready) {
      const because = skipped.length > 0 ? ` (${skipped.join("; ")})` : "";
      return {
        gate,
        kind: gate.kindFor?.(env) ?? gate.kind,
        driver: gate.open(env),
        how: "default",
        reason: `default: ${presence.reason}${because}`,
      };
    }
    skipped.push(`${gate.name}: ${presence.reason}`);
  }
  throw new Error(`no gate is ready — ${skipped.join("; ")}`);
}

/** The one line every run prints first, so a run is never silently local. */
export function describeSelection(selection: GateSelection): string {
  return `gate: ${selection.gate.name} (${selection.kind}) — ${selection.reason}`;
}

/** Hosts an Outside gate can never reach: loopback, link-local, RFC 1918, IPv6 ULA,
 *  and the reserved `localhost` / `*.localhost` names. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.includes(":")) {
    return host === "::1" || /^fe[89ab]/.test(host) || /^f[cd]/.test(host);
  }
  const octets = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!octets) return false;
  const a = Number(octets[1]);
  const b = Number(octets[2]);
  return (
    a === 127 ||
    a === 10 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function gotoTargets(spec: Spec): { label: string; url: string }[] {
  const targets = [{ label: "startUrl", url: spec.startUrl }];
  for (const step of spec.steps) {
    if (step.action === "goto" && step.target) {
      targets.push({ label: `step ${step.index} goto`, url: step.target });
    }
  }
  return targets;
}

/**
 * Refuse, BEFORE any session opens, a spec an Outside gate could never reach.
 * Measured: without this the first thing a new user with a Solari key sees is a cloud
 * session spent on ERR_CONNECTION_REFUSED against their own localhost — a product that
 * looks broken from the start. Every goto target is checked, not only startUrl.
 */
export function preflightSpec(spec: Spec, selection: GateSelection): void {
  if (selection.kind !== "Outside") return;
  for (const { label, url } of gotoTargets(spec)) {
    let hostname: string;
    try {
      hostname = new URL(url).hostname;
    } catch {
      continue; // URL shape is the spec validator's job, not the gate's
    }
    if (!isPrivateHost(hostname)) continue;
    throw new Error(
      `${label} ${url} is on a private or loopback host — not reachable from the ${selection.gate.name} gate (${selection.kind}). Host the app where Outside can reach it (--app <dir>, a remote sandbox preview URL, a tunnel) or run it Inside with ${GATE_VAR}=local.`,
    );
  }
}
