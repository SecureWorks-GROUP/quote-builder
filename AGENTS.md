# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Static site, no build step: `index.html` loads `js/config.js`, `lib.js` (pure logic, also run by `node --test`), `store.js`, `api.js`, `pdf.js`, `app.js`. CDN scripts are pinned with SRI hashes; the npm devDependencies are the same files plus `pdfjs-dist` (the tests' PDF reader), used only by tests.
- Backend is ops-api `quote_builder_*` actions; the contract is secureworks-backend `docs/quote-builder-contract.md`. The browser never reads tables directly and holds only the user's session plus the public anon key. Never add a service key or shared API key.
- Pricing settings (labour rate, materials multiplier, target margin) and cost line types arrive from the server on `quote_builder_get_job` `settings` and are read-only in the app (no in-app editor). Never write a real pricing number anywhere in this repo, tests included: the site is public, so tests use made-up values. No `settings` key means an older server, and the app must then behave as it did before line types. What the app calls and what the back end still owes: `docs/backend-needed.md`.
- Internal cost lines and any figure from the cost table (the Labour allowed total included) must never reach the client PDF or the scope of works PDF (`renderScope` strips the cost lines). The scope of works prints the client lines with quantity and unit as the client quote does, hours included; Hugo edits a client line to hide them. The material order list is the one internal document. The PDF tests read the real file back with pdf.js (`tests/e2e/pdf-text.js`): the leak checks are in `tests/e2e/app.spec.js`, content and page breaks in `tests/e2e/pdf-layout.spec.js`.
- Tests: `npm test` (`PORT=<free port> npm test` when 4517 is taken; the tests never reuse a running server). E2E uses Playwright's own Chrome for Testing against `tests/e2e/fake-backend.js` (keep it in step with the contract). Never point tests or rendering at the everyday Chrome app.
- Brand: the business name is SecureWorks Group. `assets/logo-white.png` has the old "WA" mark cropped off; "Group" is drawn as text beside it.
- The three PDFs follow the fence and patio quote template: source, stills and the template blocks left out are in `docs/quote-template/README.md`. Its typeface ships in `assets/fonts` (no PDF is made if it does not load). The small capital labels are the document's own fixed words: never upper-case what a person typed, and never add a template block this tool has no data for.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
