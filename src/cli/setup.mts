/**
 * `e2e-doctor setup` — the smallest wizard that gets a first run working: which gate,
 * which healer, written to a mode-600 `.env` in the directory the tool runs from.
 *
 * It asks two questions because there are only two the tool cannot answer for itself:
 * where the browser runs (a Solari key, or this machine) and who proposes repairs. Rich
 * configuration — saved profiles, agent detection, cloud vendors, CI snippets — belongs
 * to the optional platform layer's own wizard; this one exists so the product is
 * standalone, and stays small enough to read in one sitting.
 *
 * Nothing here reads or writes a profiles file, and nothing here is imported from the
 * platform: a recipe that needed the platform to be configurable would not be
 * standalone.
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { envVar } from "../env.mts";
import type { ExitCode } from "../replay/cli.mts";
import { ask, askSecret, choose, type PromptIo } from "./prompts.mts";

export interface SetupDeps {
  cwd: string;
  env: NodeJS.ProcessEnv;
  io: PromptIo;
  log: (line: string) => void;
  error: (line: string) => void;
}

const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_MODEL = "claude-sonnet-5";

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

/** Upsert into an existing `.env` rather than replacing it: a user's other variables
 *  are not ours to delete, and a wizard that silently dropped them would be worse than
 *  one that never wrote a file. */
export function upsertEnvText(
  existing: string,
  values: Record<string, string>,
): string {
  // Only the file's own trailing newline is dropped, so a new variable lands on the
  // last line rather than after a blank one; blank lines the user wrote stay.
  const lines = existing === "" ? [] : existing.replace(/\n+$/, "").split("\n");
  for (const [name, value] of Object.entries(values)) {
    const index = lines.findIndex((line) => line.startsWith(`${name}=`));
    if (index >= 0) lines[index] = `${name}=${value}`;
    else lines.push(`${name}=${value}`);
  }
  return `${lines.join("\n")}\n`;
}

function writeEnvFile(cwd: string, values: Record<string, string>): string {
  const path = join(cwd, ".env");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  writeFileSync(path, upsertEnvText(existing, values), { mode: 0o600 });
  // writeFileSync's mode applies only when it CREATES the file; an existing `.env`
  // keeps whatever mode it had, so the permission is set explicitly either way.
  chmodSync(path, 0o600);
  return path;
}

async function resolveGate(
  argv: string[],
  deps: SetupDeps,
  interactive: boolean,
): Promise<Record<string, string> | null> {
  const flag = option(argv, "--gate");
  const gate =
    flag ??
    (interactive
      ? await choose(deps.io, "Where should the browser run?", [
          { label: "on this machine (no key needed)", value: "local" },
          { label: "on Solari (needs SOLARI_API_KEY)", value: "solari" },
        ])
      : "local");
  if (gate === "local") return { [envVar("GATE")]: "local" };
  if (gate !== "solari") {
    deps.error(`--gate must be "local" or "solari", got "${gate}"`);
    return null;
  }
  const key =
    deps.env.SOLARI_API_KEY ??
    (interactive
      ? await askSecret(deps.io, "Paste your Solari API key (input hidden): ")
      : "");
  if (!key) {
    deps.error(
      "the solari gate needs SOLARI_API_KEY — export it before --non-interactive, or run setup interactively",
    );
    return null;
  }
  return { [envVar("GATE")]: "solari", SOLARI_API_KEY: key };
}

async function resolveOpenAiHealer(
  argv: string[],
  deps: SetupDeps,
  interactive: boolean,
): Promise<Record<string, string> | null> {
  const baseUrl =
    option(argv, "--base-url") ??
    (interactive
      ? await ask(deps.io, "Base URL: ", { default: DEFAULT_BASE_URL })
      : DEFAULT_BASE_URL);
  const model =
    option(argv, "--model") ??
    (interactive
      ? await ask(deps.io, "Model: ", { default: DEFAULT_MODEL })
      : DEFAULT_MODEL);
  const key =
    deps.env[envVar("HEALER_API_KEY")] ??
    (interactive
      ? await askSecret(deps.io, "API key (blank for a local server): ")
      : "");
  const values: Record<string, string> = {
    [envVar("HEALER")]: "openai-compatible",
    [envVar("HEALER_BASE_URL")]: baseUrl,
    [envVar("HEALER_MODEL")]: model,
  };
  if (key) values[envVar("HEALER_API_KEY")] = key;
  return values;
}

async function resolveHealer(
  argv: string[],
  deps: SetupDeps,
  interactive: boolean,
): Promise<Record<string, string> | null> {
  const flag = option(argv, "--healer");
  const healer =
    flag ??
    (interactive
      ? await choose(deps.io, "Who proposes repairs?", [
          {
            label: "claude — the Claude Code CLI on your subscription",
            value: "claude",
          },
          { label: "openai — any OpenAI-compatible endpoint", value: "openai" },
          { label: "none — decide later", value: "none" },
        ])
      : "none");
  if (healer === "none") return {};
  if (healer === "claude") return { [envVar("HEALER")]: "agent:claude" };
  if (healer === "openai") return resolveOpenAiHealer(argv, deps, interactive);
  deps.error(`--healer must be "claude", "openai" or "none", got "${healer}"`);
  return null;
}

function warnIfNotIgnored(deps: SetupDeps): void {
  const gitignore = join(deps.cwd, ".gitignore");
  const ignored =
    existsSync(gitignore) &&
    readFileSync(gitignore, "utf8")
      .split("\n")
      .some((line) => line.trim() === ".env");
  if (!ignored) {
    deps.error(
      "warning: .env is not listed in a .gitignore here — add it before committing, it can hold a key",
    );
  }
}

export async function runSetup(
  argv: string[],
  deps: SetupDeps,
): Promise<ExitCode> {
  const interactive = !argv.includes("--non-interactive") && deps.io.isTty;
  if (!interactive && !argv.includes("--non-interactive")) {
    deps.error(
      "not a TTY — pass --non-interactive [--gate local|solari] [--healer claude|openai|none] [--base-url <url>] [--model <name>]",
    );
    return 2;
  }
  const gate = await resolveGate(argv, deps, interactive);
  if (!gate) return 2;
  const healer = await resolveHealer(argv, deps, interactive);
  if (!healer) return 2;

  warnIfNotIgnored(deps);
  const path = writeEnvFile(deps.cwd, { ...gate, ...healer });
  deps.log(`wrote ${path} (mode 600)`);
  deps.log(
    `next: e2e-doctor replay <spec.yaml> --app <dir>, then e2e-doctor heal <spec.yaml> --app <dir>${
      healer[envVar("HEALER")] ? "" : " once a healer is set"
    }`,
  );
  return 0;
}
