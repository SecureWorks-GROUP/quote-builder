# Quote builder

SecureWorks Group quote builder: Hugo scopes repair and miscellaneous jobs on his iPad, recording internal costs and photos, and issues a branded client quote PDF and variations, all saved against the job in Supabase.

Backend contract: secureworks-backend `docs/quote-builder-contract.md` (ops-api `quote_builder_*` actions).

## For Hugo

1. Open the link on the iPad in Safari. Tip: Share, then Add to Home Screen.
2. Sign in with your normal SecureWorks email and password (same as the fence and patio tools).
3. **Insurance repairs** lists repair jobs at Work order in or Scoping, grouped by builder. Search by job number, client, address, builder or work order.
4. Open a job:
   - **What it costs us** (top, internal only): description, qty, unit, unit cost, supplier or trade. Never printed on the quote.
   - **Site photos**: Take photo or choose from the library, add a caption. Ticked photos go on the client quote.
   - **What we charge the client** (bottom): quote title, scope of works, charge lines with GST. "Fill from costs + markup" gives a starting point.
5. Everything saves to the office by itself as you type. If a save fails (no signal), the draft is kept on the iPad and the screen says so; it saves when signal is back. Opening jobs and adding photos need signal.
6. **Issue client quote** freezes that version, saves the PDF on the job and moves the Repairs board card to Quoted. Nothing is emailed or texted.
7. Changes after issuing: **Start a revision** (becomes version 2). Extra work: **Variations** tab, **New variation**, then record approved or rejected.
8. **History** shows every version: what was allowed (cost) against what was quoted.
9. Work with no insurance job: **New private quote** makes a new SWM job with the client details.

## Running and testing

Plain HTML/CSS/JS, no build step. `npm install`, then `npm run serve` (http://localhost:4517) or `npm test` (unit tests plus Playwright against a fake ops-api, in Playwright's own Chrome for Testing).

Config (Supabase URL and public anon key) is in `js/config.js`. Never add a service key or other secret: the site is public.

## Hosting

`.github/workflows/pages.yml` deploys `main` to GitHub Pages. Pages from a private repo needs a paid GitHub plan, so it starts serving once the organisation plan is upgraded.
