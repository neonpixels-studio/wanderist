#!/usr/bin/env bash
# Dependency vulnerability gate for CI.
# Runs `npm audit`, prints a severity summary, and fails the build when there is
# at least one high or critical *advisory* that is not on the accepted allowlist
# below. Moderate and low are reported but never fail the build.
# Dev dependencies are intentionally in scope: build/test tooling runs in CI
# and on developer machines, so its advisories matter here.
#
# Blocking is measured per distinct advisory (GHSA id), not per affected package.
# npm's package-level counts inflate a single root advisory into every package
# that pulls it in transitively (e.g. one image-size flaw counts image-size,
# @netlify/dev-utils, and @netlify/blobs). Counting advisories keeps the gate
# honest about how many real, un-remediated flaws exist.
#
# ALLOWLIST POLICY: only advisories with no upstream fix belong here, each with a
# justification and a trigger to remove it. This is NOT a way to silence fixable
# findings — prefer an npm `overrides` bump every time one is available.
set -euo pipefail

# High/critical advisories accepted because no patched version exists upstream.
# Remove an entry the moment its package ships a fix and bump via `overrides`.
# Currently empty: the image-size advisories previously allowlisted here
# (GHSA-w3rx-r6r6-pgpr, GHSA-5p2g-fcmc-qvqq) dropped out of `npm audit`'s
# report as of Sep 2026 — image-size is no longer reachable in the dependency
# tree (verified via `npm ls image-size`, which now resolves nothing), most
# likely because an updated @netlify/blobs/@netlify/dev-utils release stopped
# pulling it transitively. Re-add an entry here only if a high/critical
# advisory resurfaces with no upstream fix available.
ALLOWLISTED_ADVISORIES=()

report="$(npm audit --json || true)"

if ! printf '%s' "$report" | jq -e '.metadata.vulnerabilities' >/dev/null 2>&1; then
  echo "npm audit produced no vulnerability metadata (audit failed) — failing the build." >&2
  exit 1
fi

read_count() {
  local severity="$1"
  printf '%s' "$report" | jq -r --arg severity "$severity" \
    '.metadata.vulnerabilities[$severity] // 0'
}

critical="$(read_count critical)"
high="$(read_count high)"
moderate="$(read_count moderate)"
low="$(read_count low)"

{
  echo "## Dependency audit"
  echo ""
  echo "| Severity | Affected packages |"
  echo "| -------- | ----------------- |"
  echo "| Critical | ${critical} |"
  echo "| High     | ${high} |"
  echo "| Moderate | ${moderate} |"
  echo "| Low      | ${low} |"
} | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"

# Reads a JSON string on stdin through jq so each id pipeline is a single call.
jq_on() {
  printf '%s' "$1" | jq "${@:2}"
}

# Build the allowlist as a JSON array — safe even when the array is emptied
# (removing every entry is the documented next step once fixes ship).
allow_json="$(jq -cn '$ARGS.positional' --args ${ALLOWLISTED_ADVISORIES[@]+"${ALLOWLISTED_ADVISORIES[@]}"})"

# Distinct high/critical advisory ids in the report: the GHSA id when the
# advisory carries one, otherwise a source-<n>:<pkg> fallback that stays unique
# so two url-less advisories never collapse. `(.via // [])` tolerates a
# vulnerability object without a `via` array instead of aborting under set -e.
all_ids="$(jq_on "$report" -c '
  [ .vulnerabilities[]
    | (.via // [])[]
    | select(type == "object" and (.severity == "high" or .severity == "critical"))
    | (((.url // "") | capture("(?<id>GHSA-[-0-9a-z]+)").id)? )
      // ("source-" + ((.source // 0) | tostring) + ":" + (.name // .title // "unknown"))
  ] | unique')"

# NOTE on staleness: there is no reliable per-advisory "patched upstream" signal
# in `npm audit --json` — `fixAvailable` is per-package, and its value covers
# breaking tree-surgery (e.g. downgrading a parent) as readily as a clean patch.
# So removal is manual: this gate re-runs `npm audit` every CI run, keeping the
# data fresh; when a maintainer next touches deps and sees image-size (or its
# consumer) ship a real fix, drop the entry above and bump it via `overrides`.
# The warning below flags entries that have already fallen out of the report.
blocking_ids="$(jq_on "$all_ids" -c --argjson allow "$allow_json" 'map(select(IN($allow[]) | not))')"
blocking_count="$(jq_on "$blocking_ids" 'length')"

accepted_ids="$(jq_on "$all_ids" -c --argjson allow "$allow_json" 'map(select(IN($allow[])))')"
accepted_present="$(jq_on "$accepted_ids" 'length')"

stale_ids="$(jq_on "$all_ids" -r --argjson allow "$allow_json" '$allow - . | .[]')"
if [ -n "$stale_ids" ]; then
  echo "Allowlist entries no longer present in the audit — safe to remove from ALLOWLISTED_ADVISORIES:" >&2
  printf '%s\n' "$stale_ids" >&2
fi

if [ "$accepted_present" -gt 0 ]; then
  {
    echo ""
    echo "Accepted (allowlisted, no upstream fix) high/critical advisories:"
    jq_on "$accepted_ids" -r '.[] | "- " + .'
  } | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
fi

if [ "$blocking_count" -gt 0 ]; then
  {
    echo ""
    echo "Found ${blocking_count} un-allowlisted high/critical advisories — failing the build:"
    jq_on "$blocking_ids" -r '.[] | "- " + .'
  } | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}" >&2
  exit 1
fi

echo "No un-allowlisted high or critical advisories found."
