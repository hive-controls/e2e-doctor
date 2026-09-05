#!/usr/bin/env bash
# Skill-callable heal: 0 passed/verified repair, 1 needs-human/unhealed,
# 2 harness/configuration failure, 3 preview unavailable (retry after restoring it).
# A verified proposal is saved in the bundle; this script does not edit the spec.
# Run from your project root. FORMIC_GATE is inherited, including CLI .env loading.
# Override E2E_DOCTOR_SPEC, E2E_DOCTOR_APP, E2E_DOCTOR_BUNDLE, or E2E_DOCTOR_BIN.
set -u

PATH="$PWD/node_modules/.bin:$PATH"
export PATH
doctor="${E2E_DOCTOR_BIN:-e2e-doctor}"
spec="${E2E_DOCTOR_SPEC:-specs/approve-an-order.yaml}"
app="${E2E_DOCTOR_APP:-sample-app}"
bundle="${E2E_DOCTOR_BUNDLE:-evidence/pre-push}"

"$doctor" heal "$spec" --app "$app" --bundle "$bundle" "$@"
result=$?
case "$result" in
  0) echo "E2E Doctor: passed or verified repair; review $bundle." ;;
  1) echo "E2E Doctor: needs human review; inspect $bundle." >&2 ;;
  2) echo "E2E Doctor: harness failed; fix configuration before retrying." >&2 ;;
  3) echo "E2E Doctor: preview unavailable; restore it before retrying." >&2 ;;
  *) echo "E2E Doctor: unexpected exit $result; treating as harness failure." >&2; result=2 ;;
esac
exit "$result"
