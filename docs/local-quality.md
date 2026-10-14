# Local quality checks

Run `npm run build:sync:low` for routine verification and Obsidian testing. It runs the local checks and synchronizes the resulting build to the configured plugin directories. Run `npm run verify` for the same checks without synchronization.

Both commands check the official Obsidian lint rules, the additional review parity rules, API types, CSS, behavior regressions, and the production build. `npm run verify:behavior` runs the behavior checks separately:

- Configuration import, read-only browsing, failed-import recovery, temporary filter creation, reuse, deletion and explicit saving in table and gallery scopes.
- Save races, backups, text conversion, column layout, row interactions and lifecycle behavior.
- CSV export, links and slide image URI handling.

The temporary-filter tests exercise production controllers, including the tag-group callbacks that can trigger additional saves. They check that browsing avoids the note-edit and backup paths, and that explicit saving retains them. Configuration persistence tests separately check unchanged note bytes and absence of Vault writes.

To check tool freshness, query the published versions of `eslint-plugin-obsidianmd`, `obsidian`, `typescript-eslint`, `@typescript-eslint/parser`, and `@typescript-eslint/eslint-plugin`. Update the TypeScript ESLint packages together, retain the repository's release-age policy, and run `npm run deps:hardening:check` after updating the lockfile. Do not bypass peer dependency failures.

On 2026-10-14, the official lint plugin remained at 0.4.2. The TypeScript ESLint packages were updated together to 8.71.1. API types remain at 1.13.1 because 1.14.4 had not passed the configured seven-day release age; TypeScript ESLint 8.71.2 was also too recent. This limits claims of parity with newer API checks.

Local checks catch covered behavior regressions before remote review. They do not certify the remote review service or replace final Obsidian UI acceptance. In a disposable Vault, repeatedly switch filters and tag groups, create a filter through the row context menu, reuse it, and delete it. Confirm that note bytes and modification time remain unchanged. Explicitly saving the temporary filter must still persist the definition under the configured note-block policy.
