# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Static site, no build step: `index.html` loads `js/config.js`, `lib.js` (pure logic, also run by `node --test`), `store.js`, `api.js`, `pdf.js`, `app.js`. CDN scripts are pinned with SRI hashes; the npm devDependencies are the same files, used only by tests.
- Backend is ops-api `quote_builder_*` actions; the contract is secureworks-backend `docs/quote-builder-contract.md`. The browser never reads tables directly and holds only the user's session plus the public anon key. Never add a service key or shared API key.
- Internal cost lines must never reach the client PDF; `tests/e2e/app.spec.js` checks the uncompressed PDF text (`window.QB_PDF_PLAIN`).
- Tests: `npm test` (`PORT=<free port> npm test` when 4517 is taken; the tests never reuse a running server). E2E uses Playwright's own Chrome for Testing against `tests/e2e/fake-backend.js` (keep it in step with the contract). Never point tests or rendering at the everyday Chrome app.
- Brand: the business name is SecureWorks Group. `assets/logo-white.png` has the old "WA" mark cropped off; "Group" is drawn as text beside it.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
