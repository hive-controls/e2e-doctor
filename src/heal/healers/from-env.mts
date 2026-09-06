/**
 * Healer selection by environment — the user's choice of model fit and cost per run.
 *
 *   E2E_DOCTOR_HEALER            openai-compatible (default) | agent:claude |
 *                                agent:custom
 *   E2E_DOCTOR_HEALER_BASE_URL   OpenAI-compatible base, e.g. https://openrouter.ai/api/v1,
 *                                http://qwen-box:11434/v1. Default: Anthropic's compatible
 *                                endpoint (⚠️ ASSUMED https://api.anthropic.com/v1 —
 *                                verified by the first live run, not by this file).
 *   E2E_DOCTOR_HEALER_MODEL      default claude-sonnet-5 (2026-09-01)
 *   E2E_DOCTOR_HEALER_API_KEY    bearer for the endpoint; optional for local servers
 *   E2E_DOCTOR_HEALER_AGENT_CMD  for agent:custom — "mycli --flag {prompt}"
 *   E2E_DOCTOR_HEALER_TIMEOUT_MS per proposal
 *
 * Every name above also answers to its `FORMIC_` twin for one release (env.mts).
 * `adapters` lets a caller offer named agents this package does not ship — a platform
 * layer's own presets — without the engine carrying vendor argv it has not exercised.
 */
import { readEnvValue, envVar } from "../../env.mts";
import type { Healer } from "../types.mts";
import {
  adapterFromCommand,
  ADAPTERS,
  agentCliHealer,
  type AgentCliAdapter,
} from "./agent-cli.mts";
import { openAiCompatibleHealer } from "./openai-compatible.mts";

export const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
export const DEFAULT_MODEL = "claude-sonnet-5";

export interface HealerFromEnvOptions {
  /** Named agent adapters to resolve `agent:<name>` against. Defaults to this
   *  package's own table. */
  adapters?: Record<string, AgentCliAdapter>;
}

export function healerFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: HealerFromEnvOptions = {},
): Healer {
  const adapters = options.adapters ?? ADAPTERS;
  const healerVar = envVar("HEALER");
  const choice = readEnvValue("HEALER", env) || "openai-compatible";
  const timeoutRaw = readEnvValue("HEALER_TIMEOUT_MS", env);
  const timeoutMs = timeoutRaw ? Number(timeoutRaw) : undefined;

  if (choice === "openai-compatible") {
    return openAiCompatibleHealer({
      baseUrl: readEnvValue("HEALER_BASE_URL", env) || DEFAULT_BASE_URL,
      model: readEnvValue("HEALER_MODEL", env) || DEFAULT_MODEL,
      apiKey: readEnvValue("HEALER_API_KEY", env) || undefined,
      timeoutMs,
    });
  }
  if (choice.startsWith("agent:")) {
    const name = choice.slice("agent:".length);
    const adapter =
      name === "custom"
        ? adapterFromCommand(agentCommandTemplate(env))
        : adapters[name];
    if (!adapter) {
      throw new Error(
        `unsupported ${healerVar} "${choice}" (expected agent:${Object.keys(adapters).join(" | agent:")} | agent:custom)`,
      );
    }
    return agentCliHealer({
      adapter,
      workspaceRoot: readEnvValue("HEAL_WORKSPACES", env) || undefined,
      timeoutMs,
      env,
    });
  }
  throw new Error(
    `unsupported ${healerVar} "${choice}" (expected openai-compatible or agent:<name>)`,
  );
}

function agentCommandTemplate(env: NodeJS.ProcessEnv): string {
  return readEnvValue("HEALER_AGENT_CMD", env) ?? "";
}
