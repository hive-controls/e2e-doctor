import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeSelection,
  GATE_VAR,
  parseCdpHeaders,
  selectGate,
} from "./gate.mts";

const installed = { localBrowserInstalled: () => true };
const missing = { localBrowserInstalled: () => false };

test("the gate variable is the canonical name", () => {
  assert.equal(GATE_VAR, "E2E_DOCTOR_GATE");
});

test("no key and no request: local, announced", () => {
  const selection = selectGate({}, installed);
  assert.equal(selection.gate.name, "local");
  assert.equal(selection.how, "default");
  assert.equal(
    describeSelection(selection),
    "gate: local (Inside) — default: Chromium is installed (solari: SOLARI_API_KEY is not set)",
  );
});

test("a key present and nothing requested: solari, first-party but never load-bearing", () => {
  const selection = selectGate({ SOLARI_API_KEY: "k" }, installed);
  assert.equal(selection.gate.name, "solari");
  assert.equal(selection.reason, "default: SOLARI_API_KEY resolves");
});

test("an explicit gate wins over the default search", () => {
  const selection = selectGate(
    { E2E_DOCTOR_GATE: "local", SOLARI_API_KEY: "k" },
    installed,
  );
  assert.equal(selection.gate.name, "local");
  assert.equal(selection.reason, "E2E_DOCTOR_GATE=local");
});

test("the legacy FORMIC_GATE still selects the gate the demo shows", () => {
  const selection = selectGate({ FORMIC_GATE: "local" }, installed);
  assert.equal(selection.gate.name, "local");
  assert.equal(selection.reason, "E2E_DOCTOR_GATE=local");
});

test("a typo is refused, never silently local", () => {
  // A CI run meant to produce a cloud recording would otherwise pass green with no
  // recording at all.
  assert.throws(
    () => selectGate({ E2E_DOCTOR_GATE: "solar" }, installed),
    /^Error: unsupported E2E_DOCTOR_GATE "solar" \(expected "solari" or "local" or "cdp"\)$/,
  );
});

test("an explicit gate that is not ready refuses, naming what is missing", () => {
  assert.throws(
    () => selectGate({ E2E_DOCTOR_GATE: "solari" }, installed),
    /^Error: E2E_DOCTOR_GATE=solari but SOLARI_API_KEY is not set$/,
  );
});

test("no gate ready at all reports every reason", () => {
  assert.throws(
    () => selectGate({}, missing),
    /no gate is ready — solari: SOLARI_API_KEY is not set; local: Chromium is not installed/,
  );
});

test("the cdp gate needs its endpoint, and is never chosen by default", () => {
  assert.equal(
    selectGate({ E2E_DOCTOR_CDP_URL: "ws://x/" }, installed).gate.name,
    "local",
  );
  assert.throws(
    () => selectGate({ [GATE_VAR]: "cdp" }, installed),
    /E2E_DOCTOR_GATE=cdp but E2E_DOCTOR_CDP_URL is not set/,
  );
});

test("a cdp endpoint on this machine is Inside; anywhere else is Outside", () => {
  const inside = selectGate(
    {
      [GATE_VAR]: "cdp",
      E2E_DOCTOR_CDP_URL: "ws://127.0.0.1:9222/devtools/browser/x",
    },
    installed,
  );
  assert.equal(inside.kind, "Inside");
  assert.equal(
    describeSelection(inside),
    "gate: cdp (Inside) — E2E_DOCTOR_GATE=cdp",
  );
  const outside = selectGate(
    {
      [GATE_VAR]: "cdp",
      E2E_DOCTOR_CDP_URL: "wss://cdp.vendor.example/playwright",
    },
    installed,
  );
  assert.equal(outside.kind, "Outside");
});

test("a bad CDP_MODE and a bad CDP_HEADERS are both refused by name", () => {
  assert.throws(
    () =>
      selectGate(
        {
          [GATE_VAR]: "cdp",
          E2E_DOCTOR_CDP_URL: "ws://127.0.0.1:1/x",
          E2E_DOCTOR_CDP_MODE: "grpc",
        },
        installed,
      ),
    /unsupported E2E_DOCTOR_CDP_MODE "grpc"/,
  );
  assert.throws(
    () =>
      selectGate(
        {
          [GATE_VAR]: "cdp",
          E2E_DOCTOR_CDP_URL: "ws://127.0.0.1:1/x",
          E2E_DOCTOR_CDP_HEADERS: "[1]",
        },
        installed,
      ),
    /must be a JSON object/,
  );
});

test("parseCdpHeaders stringifies values and treats an empty variable as unset", () => {
  assert.equal(parseCdpHeaders(undefined), undefined);
  assert.equal(parseCdpHeaders("  "), undefined);
  assert.deepEqual(parseCdpHeaders('{"a":1,"b":"two"}'), { a: "1", b: "two" });
  assert.throws(() => parseCdpHeaders("{oops"), /not valid JSON/);
});
