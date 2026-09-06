/**
 * `--healer` resolution — precedence flag > E2E_DOCTOR_HEALER > the grammar's own
 * default (openai-compatible). A flag value is handed to `healerFromEnv` untouched, so
 * its existing typo/refusal messages hold verbatim.
 *
 * Mirrors the gate's and the host's selection grammar (`gate.mts:describeSelection`,
 * `host.mts:describeHostSelection`): one line, printed before anything runs, naming
 * what was chosen and why.
 */
import { envVar, readEnvValue } from "../env.mts";
import { healerFromEnv } from "./healers/from-env.mts";
import type { Healer } from "./types.mts";

export interface HealerSelection {
  healer: Healer;
  name: string;
  kind: "agent" | "api";
  how: "flag" | "env" | "default";
  reason: string;
}

function kindFor(healerName: string): "agent" | "api" {
  return healerName.startsWith("agent:") ? "agent" : "api";
}

export function resolveHealer(
  flagValue: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): HealerSelection {
  const healerVar = envVar("HEALER");
  if (flagValue) {
    const healer = healerFromEnv({ ...env, [healerVar]: flagValue });
    return {
      healer,
      name: flagValue,
      kind: kindFor(healer.name),
      how: "flag",
      reason: `--healer ${flagValue}`,
    };
  }
  const fromEnv = readEnvValue("HEALER", env);
  const healer = healerFromEnv(env);
  if (fromEnv) {
    return {
      healer,
      name: fromEnv,
      kind: kindFor(healer.name),
      how: "env",
      reason: `${healerVar}=${fromEnv}`,
    };
  }
  return {
    healer,
    name: healer.name,
    kind: kindFor(healer.name),
    how: "default",
    reason: `default: no ${healerVar}`,
  };
}

/** The model segment of an agent-kind label: the resolved model when one was passed,
 *  "agent default" when none was requested, or an explicit "not passed" refusal when
 *  one was requested but the adapter exposes no route — never a name the run did not
 *  actually pass. */
function modelSegment(healer: Healer): string {
  if (!healer.modelRequested) return "model: agent default";
  if (healer.modelPassed) return healer.modelVersion;
  return `model: ${healer.modelRequested} (not passed — this agent exposes no model selector)`;
}

export function describeHealerSelection(selection: HealerSelection): string {
  if (selection.kind === "agent") {
    return `healer: ${selection.name} (${selection.healer.name} · ${modelSegment(selection.healer)}) — ${selection.reason}`;
  }
  return `healer: ${selection.name} (${selection.kind}) — ${selection.reason}`;
}
