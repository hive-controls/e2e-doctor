import { test } from "node:test";
import assert from "node:assert/strict";
import {
  envVar,
  legacyEnvVar,
  readEnv,
  readEnvValue,
  resetEnvDeprecationNotices,
  setEnv,
} from "./env.mts";

test("the canonical name is read, and it wins over the legacy twin", () => {
  resetEnvDeprecationNotices();
  const notices: string[] = [];
  const env = { E2E_DOCTOR_GATE: "local", FORMIC_GATE: "solari" };
  assert.equal(readEnv("GATE", env, { warn: (m) => notices.push(m) }), "local");
  assert.deepEqual(
    notices,
    [],
    "the legacy name was never consulted, so nothing is deprecated",
  );
});

test("the legacy name still works and says so exactly once per process", () => {
  // The demo tape has `FORMIC_GATE=solari npm run e2e-doctor -- replay …` on screen.
  // That command must keep working; a deprecation nobody can see is a trap, and one
  // printed on every read is noise.
  resetEnvDeprecationNotices();
  const notices: string[] = [];
  const env = { FORMIC_GATE: "solari" };
  const warn = (message: string) => notices.push(message);
  assert.equal(readEnv("GATE", env, { warn }), "solari");
  assert.equal(readEnv("GATE", env, { warn }), "solari");
  assert.deepEqual(notices, ["FORMIC_GATE is deprecated; use E2E_DOCTOR_GATE"]);
});

test("neither name set reads undefined, and says nothing", () => {
  resetEnvDeprecationNotices();
  const notices: string[] = [];
  assert.equal(
    readEnv("GATE", {}, { warn: (m) => notices.push(m) }),
    undefined,
  );
  assert.deepEqual(notices, []);
});

test("readEnvValue treats empty and whitespace-only as unset", () => {
  resetEnvDeprecationNotices();
  assert.equal(readEnvValue("HEALER", { E2E_DOCTOR_HEALER: "" }), undefined);
  assert.equal(readEnvValue("HEALER", { E2E_DOCTOR_HEALER: "  " }), undefined);
  assert.equal(
    readEnvValue("HEALER", { E2E_DOCTOR_HEALER: "agent:claude" }),
    "agent:claude",
  );
});

test("setEnv writes the canonical name and clears the legacy twin", () => {
  // `--gate local` must not be outvoted by a stale FORMIC_GATE export further down the
  // same process: the flag wrote the canonical name, so the alias has to go.
  const env: NodeJS.ProcessEnv = { FORMIC_GATE: "solari" };
  setEnv("GATE", "local", env);
  assert.equal(env[envVar("GATE")], "local");
  assert.equal(env[legacyEnvVar("GATE")], undefined);
  assert.equal(readEnv("GATE", env), "local");
});
