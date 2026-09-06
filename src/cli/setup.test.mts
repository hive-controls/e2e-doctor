/**
 * `e2e-doctor setup` writing a real `.env` into a scratch directory — no prompts (every
 * case here is non-interactive), no network, no browser.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { runSetup, upsertEnvText, type SetupDeps } from "./setup.mts";

function makeDeps(cwd: string, env: NodeJS.ProcessEnv = {}): SetupDeps {
  return {
    cwd,
    env,
    io: { input: new PassThrough(), output: new PassThrough(), isTty: false },
    log: () => {},
    error: () => {},
  };
}

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "e2e-doctor-setup-"));
}

test("--gate local --healer none writes a mode-600 .env with just the gate", async () => {
  const cwd = scratch();
  try {
    const code = await runSetup(
      ["--non-interactive", "--gate", "local", "--healer", "none"],
      makeDeps(cwd),
    );
    assert.equal(code, 0);
    const path = join(cwd, ".env");
    assert.equal(readFileSync(path, "utf8"), "E2E_DOCTOR_GATE=local\n");
    assert.equal(statSync(path).mode & 0o777, 0o600);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("the solari gate takes the key from the environment, and refuses without one", async () => {
  const cwd = scratch();
  try {
    const errors: string[] = [];
    const refused = await runSetup(["--non-interactive", "--gate", "solari"], {
      ...makeDeps(cwd),
      error: (line) => errors.push(line),
    });
    assert.equal(refused, 2);
    assert.match(errors.join("\n"), /needs SOLARI_API_KEY/);

    const code = await runSetup(
      ["--non-interactive", "--gate", "solari", "--healer", "claude"],
      makeDeps(cwd, { SOLARI_API_KEY: "slr_live" }),
    );
    assert.equal(code, 0);
    const written = readFileSync(join(cwd, ".env"), "utf8");
    assert.match(written, /^E2E_DOCTOR_GATE=solari$/m);
    assert.match(written, /^SOLARI_API_KEY=slr_live$/m);
    assert.match(written, /^E2E_DOCTOR_HEALER=agent:claude$/m);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("the openai healer writes base URL and model, and the key only when there is one", async () => {
  const cwd = scratch();
  try {
    await runSetup(
      [
        "--non-interactive",
        "--healer",
        "openai",
        "--base-url",
        "http://127.0.0.1:11434/v1",
        "--model",
        "llama3",
      ],
      makeDeps(cwd),
    );
    const written = readFileSync(join(cwd, ".env"), "utf8");
    assert.match(written, /^E2E_DOCTOR_HEALER=openai-compatible$/m);
    assert.match(
      written,
      /^E2E_DOCTOR_HEALER_BASE_URL=http:\/\/127.0.0.1:11434\/v1$/m,
    );
    assert.match(written, /^E2E_DOCTOR_HEALER_MODEL=llama3$/m);
    assert.equal(written.includes("HEALER_API_KEY"), false);

    await runSetup(
      ["--non-interactive", "--healer", "openai"],
      makeDeps(cwd, { E2E_DOCTOR_HEALER_API_KEY: "sk-1" }),
    );
    assert.match(
      readFileSync(join(cwd, ".env"), "utf8"),
      /^E2E_DOCTOR_HEALER_API_KEY=sk-1$/m,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a bad flag value is refused by name, and nothing is written", async () => {
  const cwd = scratch();
  try {
    const errors: string[] = [];
    const code = await runSetup(["--non-interactive", "--healer", "gpt"], {
      ...makeDeps(cwd),
      error: (line) => errors.push(line),
    });
    assert.equal(code, 2);
    assert.match(
      errors.join("\n"),
      /--healer must be "claude", "openai" or "none"/,
    );
    assert.throws(() => readFileSync(join(cwd, ".env"), "utf8"));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("an existing .env keeps its other variables; a rerun replaces only what it sets", () => {
  const existing = "OTHER=keepme\nE2E_DOCTOR_GATE=solari\n";
  assert.equal(
    upsertEnvText(existing, { E2E_DOCTOR_GATE: "local", NEW: "1" }),
    "OTHER=keepme\nE2E_DOCTOR_GATE=local\nNEW=1\n",
  );
});

test("a .env not covered by .gitignore is warned about, and still written", async () => {
  const cwd = scratch();
  try {
    const errors: string[] = [];
    await runSetup(["--non-interactive"], {
      ...makeDeps(cwd),
      error: (line) => errors.push(line),
    });
    assert.match(errors.join("\n"), /not listed in a .gitignore/);

    writeFileSync(join(cwd, ".gitignore"), "node_modules\n.env\n");
    const quiet: string[] = [];
    await runSetup(["--non-interactive"], {
      ...makeDeps(cwd),
      error: (line) => quiet.push(line),
    });
    assert.deepEqual(quiet, []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
