# e2e-doctor

> **Retired.** E2E Doctor now ships as a tool of https://github.com/hive-controls/devloop-toolkit,
> launched by Formic. This repository and the `e2e-doctor` npm package are retired.

Self-healing end-to-end tests: **capture → compile → replay → heal → evidence**.

- **capture** — record a browser flow (a human demonstration, or an agent's) with
  session recording on.
- **compile** — turn the recorded trajectory into a human-readable, editable, replayable
  spec (deterministic steps + assertions).
- **replay** — run the spec deterministically (cheap, no model tokens on the happy path).
- **heal** — on failure, an agent inspects live state, proposes a repaired step, and
  re-verifies. Healing is never silent: it pairs with assertions and produces a diff.
- **evidence** — every replay and heal emits an evidence record: replay segments, a step
  log with the audit field list (timestamp, decision id, system/model version, inputs,
  action taken), and lab performance metrics per step — navigation timing, first paint
  and LCP on `goto`, CLS and long tasks everywhere. Track and trend only: no budget, no
  assertion, no failure caused by a metric value; a value the gate could not measure
  reads as "—", never a silent 0.

The engine stands alone — it needs no platform layer.

## Install

```bash
npm i -D e2e-doctor
npx e2e-doctor setup        # a Solari key + a healer choice, no platform layer required
```

Try it against the sample app, from the repo root:

```bash
E2E_DOCTOR_GATE=solari e2e-doctor heal \
  fixtures/specs/approve-an-order.yaml \
  --app fixtures/sample-app
```

Exit code is the contract: 0 passed, 1 the replay failed, 2 the tool could not start,
finish, or clean up.

## Gates — where the browser runs

`E2E_DOCTOR_GATE` names the gate; unset, it picks `solari` when `SOLARI_API_KEY`
resolves, else `local`. The chosen gate is announced in the first line of output, so a
run is never silently local, and a typo is refused rather than falling back. The evidence
record is the same shape either way.

| Gate           | `E2E_DOCTOR_GATE`                                 | Kind    | Recording                                                                                                                                                                               |
| -------------- | ------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Solari         | `solari` (default when `SOLARI_API_KEY` resolves) | Outside | server-side, by the API                                                                                                                                                                 |
| Local Chromium | `local` (default fallback)                        | Inside  | injected rrweb                                                                                                                                                                          |
| Remote CDP     | `cdp` (explicit only)                             | Outside | server-side, by whoever owns `E2E_DOCTOR_CDP_URL` — a raw DevTools endpoint or a hosted Playwright server (`E2E_DOCTOR_CDP_MODE` picks the handshake; unset, it follows the URL scheme) |

An Outside gate refuses a spec whose start URL or any `goto` target is on a loopback or
private host BEFORE it opens a session, naming the three ways out (`--app <dir>` to host
the app for this run, a sandbox preview URL or tunnel you set up yourself, or
`E2E_DOCTOR_GATE=local`). The optional platform layer adds no gate of its own — it
resolves a vendor credential (BrowserStack, Sauce Labs) into `cdp` or `local` config for
you; see "With Formic" below.

## The command line

```bash
e2e-doctor replay fixtures/specs/approve-an-order.yaml
e2e-doctor heal   fixtures/specs/approve-an-order.yaml --pr --base main
```

Both commands take `--app <dir>`: hosts the app under test for this run — the default
host follows the gate (`solari-sandbox` on Outside, `local` on Inside), or
`E2E_DOCTOR_HOST` picks one explicitly. The spec is rebased onto the host for the run;
`heal`'s repaired spec is unrebased before it is written back, so the file on disk always
carries the ORIGINAL captured origin, never the run's host or a live token. The evidence
audit record carries one redacted `app host` row either way.

`heal --pr` replays the spec; on a failure it asks the configured healer for one repair,
verifies it by a full replay, and opens a pull request from a throwaway worktree branched
off `--base`. The PR carries the repaired spec (a step-keyed diff), the healer's reason
verbatim, the failed step's BEFORE frame and the repaired step's AFTER frame inline, and
a self-contained evidence page (`index.html`, the player and the replay segments inlined,
playable offline) committed beside the spec. Nothing in the PR description is written by
a model.

`heal --bundle <dir>` writes the same evidence bundle (page, frames, JSON) to a local
directory without opening a PR — what a CI job uploads as an artifact. Neither `--bundle`
nor `--evidence` touches the spec file: pass `--write` to overwrite it with the repaired
spec (or a recorded assertion proposal); `--pr` writes it into the PR's branch for you.
The bundle's `proposals.json` lists interactive components no step touches and the UI
drift since the previous run — proposed steps, never applied.

The bundle is committed beside the spec: a spec kept under `specs/` gets
`evidence/<decision id>/` next to that directory, any other spec gets `evidence/` next to
the file, and `E2E_DOCTOR_EVIDENCE_DIR=<repo-relative dir>` overrides both. Evidence
bundles are generated artifacts, committed exactly as rendered: add that directory to
your formatter's and linter's ignore files, or a whole-tree pre-commit check will refuse
the repair PR's own commit (measured on the first dogfood run of this repo).

`export <spec.yaml> --target playwright|puppeteer|cypress` compiles the spec into a
runnable test for another framework. The spec stays the source of truth; the emitted file
is a build artifact, regenerated rather than hand-edited. A construct the target cannot
express refuses by name — there is no partial export.

## Healing

Replay the spec; on a failure, ask the healer for ONE proposal, apply it to a copy, and
replay the whole spec again. Only a green replay counts as healed. A healer may rewrite a
step's target or insert a step; it may only _propose_ an assertion change, which lands on
the spec as `proposedAssertChange` for a human to accept. Exit 0 passed/healed, 1
needs-human/unhealed, 2 the tool itself failed.

The healer is chosen by environment:

| `E2E_DOCTOR_HEALER`           | What acts                                                                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `openai-compatible` (default) | Any chat-completions endpoint via `E2E_DOCTOR_HEALER_BASE_URL` + `E2E_DOCTOR_HEALER_MODEL`: a router, a local model server, Anthropic. |
| `agent:claude`                | Claude Code on your own subscription, run inside a sandboxed heal workspace.                                                           |
| `agent:custom`                | Any CLI, via `E2E_DOCTOR_HEALER_AGENT_CMD="mycli --flag {prompt}"` — no code change for a vendor this package does not name.           |

`heal --healer <name>` takes the same grammar directly. Precedence: `--healer` >
`E2E_DOCTOR_HEALER` > the default. Named presets for other agent CLIs (their exact argv,
and the live runs that verified them) are configuration, not engine code: the optional
platform layer carries them, and `agent:custom` covers the same ground here.

**An executable path containing whitespace must be quoted** — whitespace is the token
boundary, and nothing guesses where an unquoted path ends. Double quotes leave
backslashes alone (`\"` is their only escape) and single quotes are fully literal, so a
Windows path never needs doubling. In a `.env` file, wrap the whole value in single
quotes so the double quotes reach the healer intact:

```
E2E_DOCTOR_HEALER_AGENT_CMD='"C:\Program Files\mycli\mycli.exe" --flag {prompt}'
```

The heal workspace is a directory the agent is pointed at: `HEAL.md` (the brief), the
same brief under `CLAUDE.md` and `AGENTS.md`, `context/` (spec, failure, accessibility <!-- export-denylist: ok -->
snapshot), and `PROPOSAL.yaml`, the only file the tool reads back. Workspaces are kept as
audit material. See the [healer verification matrix](healer-verification-matrix.md)
for observed outcomes by CLI version, breakage class, and gate. A configured adapter is
not itself a verification claim.

## Configuration

Every variable is read in one place (`src/env.mts`) and every canonical `E2E_DOCTOR_*`
name still answers to a `FORMIC_*` twin for one release — a command recorded before the
rename keeps working, and says so once on stderr. `SOLARI_*` names belong to the backend
and are unchanged.

| `E2E_DOCTOR_*` (suffix) | Secret | Default                        | What it configures                                                                                                                                               |
| ----------------------- | ------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GATE`                  |        |                                | Which gate replays run through: `solari`, `local`, or `cdp`.                                                                                                     |
| `HOST`                  |        |                                | Where the app under test is served from for `--app`; unset, follows the gate.                                                                                    |
| `CDP_URL`               |        |                                | Endpoint of a browser someone else is running (used by the `cdp` gate).                                                                                          |
| `CDP_HEADERS`           | ✓      |                                | Extra headers sent when connecting to `CDP_URL`, for a header-authenticated endpoint.                                                                            |
| `CDP_MODE`              |        |                                | `cdp` \| `playwright` — the handshake `CDP_URL` speaks; unset, follows the URL scheme.                                                                           |
| `HEADED`                |        |                                | `1` runs the browser headed instead of headless.                                                                                                                 |
| `HEALER`                |        | `openai-compatible`            | `openai-compatible` \| `agent:claude` \| `agent:custom` — other agent CLIs (codex, kimi, grok) run via `agent:custom` + `HEALER_AGENT_CMD`, or a Formic profile. |
| `HEALER_BASE_URL`       |        | `https://api.anthropic.com/v1` | OpenAI-compatible base for the healer request.                                                                                                                   |
| `HEALER_MODEL`          |        | `claude-sonnet-5`              | Model name passed to the healer's OpenAI-compatible endpoint.                                                                                                    |
| `HEALER_API_KEY`        | ✓      |                                | Bearer for the healer's OpenAI-compatible endpoint; optional for local servers.                                                                                  |
| `HEALER_AGENT_CMD`      |        |                                | Command template for `agent:custom`, e.g. `"mycli --headless {prompt}"`.                                                                                         |
| `HEALER_TIMEOUT_MS`     |        | `180000`                       | Per-proposal timeout for the healer request.                                                                                                                     |
| `HEALER_MAX_ATTEMPTS`   |        | `2`                            | How many heal attempts the loop makes before giving up.                                                                                                          |
| `HEAL_WORKSPACES`       |        |                                | Root directory sandboxed heal workspaces are kept under, as audit material.                                                                                      |
| `EVIDENCE_DIR`          |        |                                | Where `heal --pr`/`--bundle` writes evidence, repo-relative; unset, derived from the spec.                                                                       |

Plus `SOLARI_API_KEY` (secret) and `SOLARI_BASE_URL` for the backend, and the launcher-set
`HIVEDECK_STATUS_FILE`. The full list, with each variable's exact wording, is the source
of truth this table is generated against: `e2e-doctor.toolspec.yaml`'s `env[]`.

`e2e-doctor setup [--non-interactive] [--gate local|solari] [--healer
claude|openai|none]` asks only the two questions the tool cannot answer for itself —
where the browser runs, who proposes repairs — and writes a mode-600 `.env` in the
current directory (upserted, never replacing a file's other variables). It reads and
writes nothing of the platform layer's: saved profiles, agent detection, cloud vendors
and CI snippets belong to Formic's own, richer wizard — see "With Formic" below.

## With Formic (optional)

Installing [`@hive-controls/formic`](https://www.npmjs.com/package/@hive-controls/formic)
adds three things this package does not have on its own, without changing anything
about how it runs:

- **`formic run e2e-doctor <args…>`** resolves this package's declared `env[]` from a
  saved profile before running it — the same process a direct `e2e-doctor <args…>` would
  have started, configured.
- **Remote gates** — a BrowserStack or Sauce Labs credential resolves into this
  package's own `cdp` or `local` gate configuration; this package never talks to either
  vendor directly.
- **Launchie**, `formic setup`'s richer wizard: multiple named profiles, agent detection
  on `PATH`, a CI Actions snippet, and a smoke run through `formic run` before anything
  is written.

## Demo

The best way to see it work is a repaired pull request in this repo: open one and watch
the before/after replay inline — the same evidence bundle a CI job would produce for you.

## Automating it (CI and git hooks)

**Exit codes, every command:** `0` passed or healed (nothing left for a human), `1` the
replay failed, needs a human, or could not be healed, `2` the tool itself could not
start, finish, or clean up, `3` the app host stopped serving before healing finished (an
environment fault, not a heal verdict). A hook or a CI job gates on it directly.

**Healers in CI:** an OpenAI-compatible endpoint is the unattended choice — its key is
one repository secret, and a local model server works with no key at all (mind that a
hosted runner cannot reach a LAN host). A headless coding agent runs on your subscription
and needs the vendor's own authentication on the runner; use one for local runs, and for
CI only once you have that set up.

**Credentials in specs:** a captured `fill` keeps the value that was typed, and every
heal hands the spec to the healer inside its brief. Record flows with a test-only account
whose password you would happily commit (the sample spec's `hunter2` is exactly that),
and never a real one. A secret-reference field for specs is planned, not shipped.

**Git hooks:** nothing here installs a hook for you. Configure your repository's
`pre-push` or `pre-commit` hook to replay the spec and, on a failure, run
`heal --bundle` and refuse the push on exit `1` or `2`. Never write into `.git/hooks/`
from a script your teammates will not get.
