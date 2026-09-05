# self-healing-e2e (flagship — use case B)

E2E tests that record, run, and repair themselves, all while providing you the visual proof along the way.

1. **Record once**: demonstrate the flow in a Solari cloud browser (or let the agent
   explore it); the harness captures the trajectory + session recording.
2. **Compile**: the trajectory becomes a readable, editable test spec.
3. **Replay in CI**: deterministic, fast, token-free while the UI is stable.
4. **Heal on drift**: when the UI changes and a step breaks, the agent repairs the spec —
   and opens a PR whose review artifact is the **before/after replay of that step**, not
   a diff you have to simulate in your head. You watch what changed; you don't simulate
   it. (The artifact is an rrweb DOM replay segment, sliced deterministically from the
   session recording: the step log's timestamps address the recording directly, and the
   slice is the same every time — no model in that path.)

What makes it different: the healer runs unattended in CI, works from a demonstration
capture rather than hand-written selectors, produces an evidence artifact for every repair,
and never skips a test it cannot fix — a step it cannot repair becomes a needs-human PR
carrying the BEFORE frame, not a `test.fixme()`. The spec stays editable YAML throughout,
so a repair is a one-line diff you can read.

Demo target: a bundled public-safe sample app served inside a Solari sandbox (never an
internal surface).

## Record a flow

Step 1 is a command. Point it at your app, click the flow the way a user would, and press
any key when you are done:

```bash
e2e-doctor record approve-an-order --url http://localhost:5173/
```

A browser opens on whichever gate is selected — your machine, or a cloud session. Every
click, every field you type into, and every navigation is captured; when you stop, the
recording is offered back to you one assertion at a time:

```
approve-an-order: 7 step(s) on local-playwright
  1 goto   http://localhost:5173/       29ms ok
  2 fill   #email                       300ms ok
  3 fill   #password                    129ms ok
  ...
  warning: step 2 (#email) holds email data — the spec references env.APPROVE_AN_ORDER_EMAIL instead of the value
  warning: step 3 (#password) holds password data — the spec references env.APPROVE_AN_ORDER_PASSWORD instead of the value
  replay needs these environment variables: APPROVE_AN_ORDER_EMAIL, APPROVE_AN_ORDER_PASSWORD
  assert: [data-testid="current-user"] is visible and reads "ops@example.test"
    accept? [y/N]
```

The spec is written to `specs/<name>.yaml` (or `--out <file>`) once you have answered.
Then run it exactly like any other spec:

```bash
e2e-doctor replay specs/approve-an-order.yaml --app sample-app
```

Four things about that flow are worth knowing, because they are the reason a recording is
worth replaying:

- **The locators are derived, proven, and never guessed.** Your click reports what the
  element IS — its test id, a stable id, a unique data attribute — and every one of those
  is checked, in the page, to resolve to exactly one element and to the element you
  actually clicked before it is reported at all. An id that appears twice is not an
  address, so it is not used. The role and accessible name come from Playwright's own
  model rather than a second one, and they are proven to resolve the same element too.
  The recorder picks between them in the order the replay runner resolves one, so the
  locator in the file is the locator the runner will use. When nothing about an element
  can be proven, the step is **refused and named** rather than written down as a
  positional path that resolves something else on the next run — a recording that is
  short and says so beats one that is complete and wrong.
- **The assertions are proposals, and each one says exactly what it checks.** The recorder
  never adopts an expectation on its own. It watches what changed on screen and offers it;
  only `y` or `yes` adopts one. The line you are shown is written from the assertion
  itself, so it can never promise something the replay will not check. Skip one on a step
  that changed state and the spec is refused rather than written, because a step with
  nothing to assert is a step that cannot catch anything. `--yes` accepts every proposal,
  for scripted and CI use.
- **Personal data is not written down.** A spec is committed to your repository, read in
  pull requests and attached to evidence — so what you type into a sensitive field never
  leaves the browser. The step names the environment variable the value will be read
  back from (`valueFrom: env.APPROVE_AN_ORDER_PASSWORD`), and the recording names every
  step it withheld, why, and which variables replay will need. See **Secrets in specs**
  below. Seven categories are recognised — passwords,
  payment and card data, usernames, email addresses, phone numbers, postal addresses and
  identification documents — classified by the input's `type`, then its `autocomplete`
  token, then the words in its name, id, label and placeholder. Put the real values in
  your environment before the replay, or pass `--include-secrets` to record them
  verbatim — a deliberate choice, never the default.
- **A consequence is not a step, and the clock never decides which.** A navigation your
  click caused folds into that click however long it takes to arrive — a redirect chain
  that lands three seconds later is still that click's consequence. A page you navigated
  to yourself becomes its own `goto` however soon it follows one, because the browser
  says who initiated it. Moving between screens inside a single-page application is a
  step too. One gesture is one step: clicking a checkbox's label is one click, not the
  two the browser dispatches, and choosing from a `<select>` is one `select`, not a click
  and a choice. A form you submitted with the Enter key becomes a `press`.
- **An interaction inside an iframe is recorded, addressed to that frame.** The recorder
  names the chain from the page down to the frame — the owning `<iframe>`'s own id or
  test id or name, proven where it lives, then the frame's `name`, then its document URL
  — and the step carries it. A frame that none of those can address (a `srcdoc` frame
  with no attributes) is still dropped and named, rather than folded into a page it is
  not part of.
- **Stopping stops.** The last thing you did lands even if you press a key immediately
  after it, and nothing you do afterwards is recorded: the recording waits for what the
  page already sent and then takes itself off the page entirely.

Everything downstream is unchanged: the step log a recording produces is timed by the
same clock a scripted capture uses, so per-step evidence slices identically and a
recorded spec heals like any other.

## Steps inside a frame

A step says WHERE its locator is resolved as well as WHAT it resolves. `frame` is a chain
of frame references, outermost first; no `frame` means the top-level page, which is what
every step without one has always meant.

```yaml
- id: st_c41a90d2
  index: 4
  action: fill
  target: "#card-number"
  frame:
    - selector: "#checkout"
    - name: payment
  assert:
    selector: "#card-number"
    visible: true
```

Each link names exactly one frame, exactly one way:

| key         | means                                                                 |
| ----------- | --------------------------------------------------------------------- |
| `selector`  | the owning `<iframe>` element, addressed **in the document above it** |
| `name`      | the frame's `name`                                                    |
| `url`       | the frame's own document URL, matched whole                           |
| `urlPrefix` | the same, matched as a prefix                                         |

`selector` is the strongest form and the one a recording prefers, because the element is
proven where it lives — exactly as a step's own target is. The other two are for a frame
whose owning element the recorder could not prove, and they are answered by the frame
itself.

Three rules the format enforces rather than trusting:

- **A link names its frame one way.** Two keys in one link is a spec that reads one way
  and resolves another, so it is a load error — the same rule `url`/`urlPrefix`/
  `urlPattern` already obey in an assertion.
- **An empty chain is refused.** Absent is how you say "the top-level page"; `frame: []`
  is somebody who meant to name a frame and named none.
- **A url assertion never carries a frame, and neither does a `goto`.** There is one
  address bar however many frames are open, and this grammar has no frame-scoped
  navigation. Either would read as if it meant something and quietly mean something else.

An assertion is checked in its step's frame unless it names one of its own — the common
case is that the consequence of an action renders in the document the action happened in.
Spell out an `assert.frame` for the case that is not: a click inside a payment iframe
whose receipt renders in a sibling frame.

The one thing an assertion cannot say is "the top-level page" on a step that is inside a
frame — absence means "the step's frame", and there is no spelling for the page. An
imported script that checks a host-page element after a framed action is reported at that
line rather than quietly re-scoped, and a recording reads its end state from the step's
own document, so neither path can produce one. Adding an explicit page scope is a grammar
change, tracked separately; until then this is a refusal, not a silent re-scoping.

Cypress has no first-party way to address a frame, so a spec with a chain is refused for
that target by name rather than approximated — see the export section below.

Chains resolve the same way everywhere. Replay walks the chain and runs the step against
the frame it names, failing the step in the **action** phase and naming the link when it
resolves nothing — the step could not be run at the address it gave, which is a repair a
healer can make, not a stale expectation. A repair moves a step between frames through
`rewrite-target`, the one proposal kind that reaches a step's address at all. The export
compiles the chain to `frameLocator` (Playwright, when every link is a selector) or to a
small named helper in the generated file (Playwright otherwise, and Puppeteer always);
Cypress refuses it by name. And `e2e-doctor import codegen` reads
`page.frameLocator('#child').getByTestId('card')` back into a chain — `page.frame({name})`
is refused instead, because it searches every frame in the page at any depth while a chain
link names a direct child, and importing one as the other could address a different frame
than the script did.

## Secrets in specs

A spec is committed, read in a pull request and attached to an evidence bundle. A
credential typed during a recording would travel all three ways, so it is never written
down. The step names where the value comes from instead:

```yaml
- id: st_b1f495b5
  index: 3
  action: fill
  target: "#password"
  valueFrom: env.APPROVE_AN_ORDER_PASSWORD
  assert:
    selector: "#password"
    visible: true
```

`env.<NAME>` is the only source. Everything that runs a test already knows how to put a
variable in the environment, and a vault or a keychain would be a dependency and a
network call in the middle of a step.

- **Recording** derives the name from the flow, the field and the category, so recording
  the same flow twice asks for the same variable rather than orphaning the value you
  already supplied. The last line of a recording lists every variable the spec expects.
- **Replay** resolves each reference from the environment at the moment the step runs. A
  variable that is not set fails that step by name — never with the value, and never as a
  puzzling locator failure. The CLI loads a `.env` from the working directory on start
  (the same file the setup command writes a healer key into), so a git-ignored `.env`
  next to your specs is the convention; in CI, set the variables from your own secret
  store instead.
- **Nothing downstream ever sees the resolved value.** The run carries the values it
  resolved as ONE list, and every writer applies it: the step log, the failure text, the
  accessibility snapshots, the evidence JSON, the rendered evidence page, the heal
  bundle, the repair PR body and the Playwright test attachments. Replay also marks a
  referenced field page-side before typing into it, so the replay video masks it whatever
  the field looks like — an unlabelled `<input type="text">` included. What a reviewer
  sees is the reference that names the source. An error is an artifact too: whatever
  escapes a run or gets printed by the CLI — message and stack — goes through the same
  pass, so a backend failing on the page it was reading cannot report it verbatim.
- **A value under six characters is not removed from FREE TEXT**, and the run says so.
  A short value is a substring of ordinary evidence — `1234` is also a port, an id and an
  order number — and substituting it corrupts the record it protects. This is a rule about
  prose only: a field that holds nothing but a typed value (a step's `value`, an audit
  record's `inputs`, a step a healer proposes) is withheld whole, at any length. What
  remains exposed is a short value quoted inside an error message or a snapshot, and the
  warning names the variable so you can decide whether that suits the secret you have.
- **Healing** carries the reference through untouched. A repair may not turn it back into
  a literal, and a proposed step may reference a value of its own but may not quote a
  placeholder back out of the spec.
- **Export** emits `process.env.NAME` (Playwright, Puppeteer) or `Cypress.env("NAME")`
  (Cypress), with the variables the file needs listed in its header comment. The
  guarantee stops at the repository boundary, and each generated file says so: a
  Playwright trace records the arguments of every action, and a screenshot or video shows
  the page a value was typed into. The Cypress emitter passes `{ log: false }` on a
  referenced `.type()`/`.select()` so the value stays out of the command log its
  screenshots and video are rendered from.

A step written with a literal `<secret:...>` placeholder is refused at load: it is not a
value, and replaying it would type the placeholder into the field and report the failure
as a broken locator.

## Gates

Replay and heal run against a browser backend selected by `FORMIC_GATE` (Formic's Fleet
router — see `@hive-controls/formic`'s own README for the full mechanism). Cloud gates
beyond Solari are explicit-only, never the default search, so a third-party trial
credential can never silently steer a run:

| Gate                  | `FORMIC_GATE`                                      | Status                                                                                                                                                   |
| --------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Solari                | `solari` (default when `SOLARI_API_KEY` resolves)  | Exercised — the sample run above                                                                                                                         |
| Local Chromium        | `local` (default fallback)                         | Exercised — rrweb-recorded, no credential needed                                                                                                         |
| BrowserStack Automate | `browserstack` (explicit only — never the default) | VERIFIED against BrowserStack Automate on 2026-09-04 (Playwright connect, page-navigation smoke check, 2 rrweb events captured; session released)        |
| Sauce Labs            | `saucelabs` (explicit only — never the default)    | VERIFIED against Sauce Labs on 2026-09-04 (Playwright connect via Selenium Grid, page-navigation smoke check, 2 rrweb events captured; session released) |

The BrowserStack/Sauce Labs stamp covers a driver-level connect + rrweb-capture smoke
check against a public page only — neither vendor has an `--app <dir>` host yet, so a
full spec replay against this repo's own sample app is not yet exercised on either.
BrowserStack and Sauce Labs need `BROWSERSTACK_USERNAME`/`BROWSERSTACK_ACCESS_KEY` or
`SAUCE_USERNAME`/`SAUCE_ACCESS_KEY` respectively; absent, a run naming either explicitly
refuses cleanly, naming which variable is missing.

## Healer adapters

Verification is version-specific. The [healer verification matrix](healer-verification-matrix.md)
records the four drift classes (`renamed-selector`, `moved-element`, `changed-flow`,
`swapped-data`) against the sample app through `--app`, on `FORMIC_GATE=local` and
`FORMIC_GATE=solari` when its key is available. Missing results make no compatibility claim.

| Adapter        | Verification                                                                      |
| -------------- | --------------------------------------------------------------------------------- |
| `agent:claude` | [Observed matrix](healer-verification-matrix.md)                       |
| `agent:codex`  | [Observed matrix](healer-verification-matrix.md)                       |
| `agent:kimi`   | [Observed matrix](healer-verification-matrix.md)                       |
| `agent:grok`   | [Observed matrix](healer-verification-matrix.md)                       |
| `agent:custom` | [Observed matrix; only when configured](healer-verification-matrix.md) |

## Launcher status

Replay and heal expose an opt-in NDJSON status stream, file-only: set `HIVEDECK_STATUS_FILE`
and every event (`started`, `progress`, a terminal `ok`/`failed`/`needs-human`) is appended
there, one JSON object per line. Unset, nothing is emitted anywhere — stderr always stays
plain human-readable diagnostics. A terminal event includes the evidence artifact when one
was written.

```bash
HIVEDECK_STATUS_FILE=status.ndjson npm run e2e-doctor -- replay packages/harness/fixtures/specs/approve-an-order.yaml evidence.json --app packages/harness/fixtures/sample-app
```

## Automating it (CI and git hooks)

Install the built Formic package to enable the templates (`npm install --save-dev
@hive-controls/formic`, or install its local tarball before publication). They use the
installed `e2e-doctor` executable and inherit `FORMIC_GATE` and the CLI's `.env` loading.
The standalone Playwright test still runs without Formic.

From the exported project's root:

```bash
chmod +x templates/hooks/pre-push templates/scripts/e2e-doctor-heal.sh
git config core.hooksPath templates/hooks
FORMIC_GATE=local bash templates/scripts/e2e-doctor-heal.sh
```

The hook replays first and, on failure, runs `heal --bundle`. Exit `0` allows the push;
`1` (needs human review), `2` (harness failure), and `3` (preview unavailable) refuse it
with a diagnostic. The skill-callable script preserves those same four exit codes.
Healing verifies a proposal and saves it in the evidence bundle; it does not change the
spec on disk. Review and commit desired repairs yourself.

Defaults are `specs/approve-an-order.yaml`, `sample-app`, and `evidence/pre-push`.
Override them with `E2E_DOCTOR_SPEC`, `E2E_DOCTOR_APP`, and `E2E_DOCTOR_BUNDLE`;
`E2E_DOCTOR_BIN` selects an alternate executable. In a workshop clone, invoke the same
scripts under `usecases/self-healing-e2e/templates/` and set spec/app paths relative to
the root; keep the existing repository hooks and call this template from them.

## Author or import a spec

Recording is one way to get a spec; the other is scripted, browser-free authoring — write
or extend a spec from a small YAML DSL, or import an existing Playwright codegen script.
Both paths are deterministic and token-free: no browser session, no healer call.

```
e2e-doctor author flow.yaml --out specs/checkout.yaml
e2e-doctor author --extend specs/checkout.yaml more-steps.yaml --out specs/checkout.yaml
e2e-doctor import codegen recorded.spec.ts --out specs/checkout.yaml
```

The DSL is one step per list entry, keyed by its action:

```yaml
name: sign-in
startUrl: http://app.localhost:4173/
steps:
  - goto: http://app.localhost:4173/
  - fill: "#email"
    value: someone@example.com
    assert:
      selector: "#email"
      visible: true
  - click: "#signin-button"
    assert:
      testId: current-user
      hasText: someone@example.com
```

Extending a spec appends new steps only — every existing step keeps its id and position, so
a repair PR diffing the result never shows an unrelated step moving.

Authoring is reproducible, not merely offline: the same input produces the same bytes, so an
authored spec can be regenerated and diffed against the copy in your repo. Step ids come from
position (`s1`, `s2`, …) unless a step names its own `id`, and `capturedAt` follows
`SOURCE_DATE_EPOCH` when you set it.

Importing a codegen script reports anything it cannot translate instead of dropping it — an
unsupported locator, an action outside click/fill/press/select/goto/expect, an argument that
is not a plain string literal (`page.goto(process.env.URL ?? '…')` and `toHaveText(/…/)` are
reported, never guessed at), a second `expect()` on one step, or an `expect()` separated from
its action by a line the importer could not read. And an import is validated before anything
is written: if codegen recorded a click with no `expect()` after it, the spec would fail the
state-change rule, so the command names the source line, writes no file, and exits 2 rather
than leaving YAML behind that the tooling then refuses.

## Use it from Playwright Test / Jest / Vitest

The fixture, the reporter, and the runner examples all need `@hive-controls/formic`
installed, so they are not part of this repository's standalone export — the sample app,
the specs, the breakage corpus and the baseline Playwright test stand alone without it.

**Playwright Test** — `tests/specs.spec.ts` turns every spec under `specs/` into a
`test()`, evidence bundle attached automatically:

```ts
import { defineSpecTests } from "@hive-controls/formic/playwright";

defineSpecTests("../specs");
```

Heal on a failure is opt-in, from a reporter in `playwright.config.ts` (off by
default; `pr` only matters when `heal` is on and reuses the heal CLI's own PR path):

```ts
reporter: [
  [
    "@hive-controls/formic/playwright/reporter",
    {
      heal: true,
      pr: true,
      app: "sample-app",
      env: { FORMIC_HEALER: "scripted" },
    },
  ],
];
```

It heals on a test's final outcome only, once per spec file per run — a retried attempt
is not yet a failure, and one broken spec costs one healer call and at most one pull
request. `app` is forwarded as the CLI's own `--app <dir>`, so heal replays against the
same application the test ran against; `env` is merged over the environment of the heal
process (gate selection stays with the inherited `FORMIC_GATE`).

**Jest / Vitest** — no fixture, just the plain replay function against the spec you
already have (see `examples/jest/replay.test.js` and `examples/vitest/replay.test.ts`;
neither runner is installed in this repo — install one to run them):

```ts
const spec = loadSpec(readFileSync("specs/approve-an-order.yaml", "utf8"));
const session = await new LocalPlaywrightDriver().open();
const result = await replaySpec(spec, session);
await session.close();
expect(result.outcome).toBe("passed");
```

## Export to Playwright / Puppeteer / Cypress

The spec is data, so it also compiles to a plain test in the framework you already run —
useful when you want the capture and the readable spec but would rather your own runner
drove the browser:

```bash
e2e-doctor export specs/approve-an-order.yaml --target playwright --out tests/approve-an-order.spec.ts
e2e-doctor export specs/approve-an-order.yaml --target puppeteer  # prints to stdout
e2e-doctor export specs/approve-an-order.yaml --target cypress --out cypress/e2e/approve-an-order.cy.js
```

The spec stays the source of truth and the exported file is a build artifact: regenerate
it, never hand-edit it — every generated file says so in its own first two lines.

Each target gets the same meaning, not an approximation. Where a framework genuinely
cannot express something the spec says — an accessible-name locator outside Playwright, a
Playwright-only selector engine, a key Cypress `.type()` has no token for, a frame chain
in Cypress, which has no first-party command for one — the export refuses and names the
construct instead of emitting a test that would pass while checking something else.
