/**
 * The one place environment variables are read.
 *
 * E2E Doctor's canonical prefix is `E2E_DOCTOR_`. The tool shipped its first release
 * under a platform prefix, and commands carrying the old names are on record — in a
 * recorded demo, in CI files, in people's shells — so every canonical name also
 * answers to its legacy twin for one release. The canonical name always wins when
 * both are set; when only the legacy one is set the run works and says so, once per
 * variable per process, on stderr. A deprecation nobody can see is a trap, and a
 * deprecation printed on every read is noise.
 *
 * Variables owned by someone else keep their own names and are read directly:
 * `SOLARI_API_KEY`, `SOLARI_BASE_URL`, `HIVEDECK_STATUS_FILE`, `SOURCE_DATE_EPOCH`,
 * and every `valueFrom: env.NAME` secret a spec declares.
 */

export const ENV_PREFIX = "E2E_DOCTOR_";
export const LEGACY_ENV_PREFIX = "FORMIC_";

/** Suffixes this tool owns. `envVar("GATE")` is `E2E_DOCTOR_GATE`. */
export const ENV_SUFFIXES = [
  "GATE",
  "HOST",
  "HEADED",
  "CDP_URL",
  "CDP_HEADERS",
  "CDP_MODE",
  "EVIDENCE_DIR",
  "HEALER",
  "HEALER_MODEL",
  "HEALER_BASE_URL",
  "HEALER_API_KEY",
  "HEALER_AGENT_CMD",
  "HEALER_TIMEOUT_MS",
  "HEALER_MAX_ATTEMPTS",
  "HEAL_WORKSPACES",
  "GIT_SHA",
  "APP_DIR",
  "BASE_URL",
  "LIVE_SANDBOX",
] as const;

export type EnvSuffix = (typeof ENV_SUFFIXES)[number];

/** The canonical variable name for a suffix. */
export function envVar(suffix: EnvSuffix | string): string {
  return `${ENV_PREFIX}${suffix}`;
}

/** The legacy variable name still honoured for a suffix. */
export function legacyEnvVar(suffix: EnvSuffix | string): string {
  return `${LEGACY_ENV_PREFIX}${suffix}`;
}

const warned = new Set<string>();

/** Reset the once-per-process deprecation bookkeeping. Tests only. */
export function resetEnvDeprecationNotices(): void {
  warned.clear();
}

export interface ReadEnvOptions {
  /** Where the notice goes. Injectable so tests can read it back. */
  warn?: (message: string) => void;
}

/**
 * Read one of this tool's variables: canonical first, legacy second. Returns the
 * raw string exactly as the environment holds it (callers decide about trimming),
 * or `undefined` when neither name is set.
 */
export function readEnv(
  suffix: EnvSuffix | string,
  env: NodeJS.ProcessEnv = process.env,
  options: ReadEnvOptions = {},
): string | undefined {
  const canonical = env[envVar(suffix)];
  if (canonical !== undefined) return canonical;
  const legacyName = legacyEnvVar(suffix);
  const legacy = env[legacyName];
  if (legacy === undefined) return undefined;
  if (!warned.has(legacyName)) {
    warned.add(legacyName);
    const warn = options.warn ?? ((message: string) => console.error(message));
    warn(`${legacyName} is deprecated; use ${envVar(suffix)}`);
  }
  return legacy;
}

/** `readEnv` with empty and whitespace-only values treated as unset. */
export function readEnvValue(
  suffix: EnvSuffix | string,
  env: NodeJS.ProcessEnv = process.env,
  options: ReadEnvOptions = {},
): string | undefined {
  const value = readEnv(suffix, env, options);
  if (value === undefined) return undefined;
  return value.trim() === "" ? undefined : value;
}

/**
 * Write a canonical value into an environment object AND clear the legacy twin, so a
 * flag that overrides a variable is not silently outvoted by a stale legacy export
 * further down the same process.
 */
export function setEnv(
  suffix: EnvSuffix | string,
  value: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  env[envVar(suffix)] = value;
  delete env[legacyEnvVar(suffix)];
}
