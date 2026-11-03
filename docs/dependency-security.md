# Dependency security review

Reviewed on 2026-11-03. Owner: repository maintainer, through the dependency maintenance workflow.

## Release decision

No plugin release is required for this maintenance batch. The changed dependencies are used by lint and CSS tooling, not the plugin runtime. Production dependencies remain AG Grid, monkey-around and SortableJS. Keep development on `dev`; include these maintenance changes in the next ordinary release integration into `main`.

## GitHub alert dispositions

- Alerts 54–57 refer to obsolete Moment and brace-expansion versions. Both `main` at `315b0fa` and the development lockfile already contain Moment 2.31.0 and brace-expansion 1.1.21, 2.1.7 and 5.0.12. These alerts are inaccurate for the checked-in dependency tree.
- Alerts 60–64 cover source-map-js and fast-uri. The development lockfile updates source-map-js 1.2.1 to 1.2.2 and fast-uri 3.1.7 to 3.1.9, matching the reviewed fixes in PRs 18 and 20. The release branch retains the older development-tool versions until the next release integration. Accept that limited residual development-tool risk; dismissing these alerts does not claim that `main` was patched.
- Reopen alerts 60–64 if either package becomes a runtime dependency or processes untrusted input in a hosted tool. At the next release preparation, verify both patched versions in `main` and recheck GitHub alerts. Do not disable future alerts or add package ignore rules.

## Deferred minimatch update

The full npm audit reports [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), with 21 affected development packages through one minimatch advisory. The patched target is minimatch 11.0.1; installed versions span 3.1.5, 8.0.7, 9.0.9 and 10.2.6. npm reports no automatic compatible fix. Forcing version 11 across these consumers would override their major-version constraints and can break their APIs.

The advisory describes attacker-controlled glob patterns with optimizationLevel >= 2. Current checks use repository-owned patterns and this package is absent from production dependencies. Retain the existing graph pending compatible upstream updates; do not treat the full audit as clean. Recheck at every dependency maintenance batch, at release preparation, or when ESLint, its plugins, TypeScript ESLint or minimatch publishes a compatible fix. Run `npm audit --json`, `npm explain minimatch`, `npm run deps:hardening:check` and `npm run build:sync:low` before adopting a replacement. Expand validation if glob inputs become externally controlled.

## Tooling compatibility

npm 12 returns `npm view <package> time --json` as a single-element array. The hardening check accepts this shape as well as the earlier object shape, while rejecting ambiguous arrays. The release-age probe must still demonstrate that a version younger than seven days is rejected and an older version is accepted.
