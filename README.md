# Quote builder

SecureWorks Group quote builder: Hugo scopes repair and miscellaneous jobs on his iPad, recording internal costs and photos, and issues a branded client quote PDF and variations, all saved against the job in Supabase.

Backend contract: secureworks-backend `docs/quote-builder-contract.md` (ops-api `quote_builder_*` actions).

## For Hugo

1. Open the link on the iPad in Safari. Tip: Share, then Add to Home Screen.
2. Sign in with your normal SecureWorks email and password (same as the fence and patio tools).
3. **Insurance repairs** opens on **To scope** (repair jobs at Work order in or Scoping), grouped by builder. The **Quoted** and **Approved and on** buttons show jobs further along. Search by job number, client, address, builder or work order.
4. Open a job:
   - **What it costs us** (top, internal only): description, type, qty, unit, unit cost, supplier or trade. Never printed on the quote.
     - **Type** is Material, Labour or Other. A new line starts as Material.
     - **Labour**: the unit locks to hours, so Qty is the hours you expect the job to take. Unit cost is what an hour costs us.
     - **Other** is for things like delivery, hire, a skip bin or a permit.
   - **Site photos**: Take photo or choose from the library, add a caption. Ticked photos go on the client quote.
   - **Pricing goal** (repair jobs): one small line, read only. It shows the labour rate, the materials multiplier and the target margin the office is aiming for. It is a goal, not a rule: a quote under it, or at a loss, still saves and issues. The line has nothing to edit. It is not on a private quote.
   - **The dark strip** shows what the job costs us, **Labour allowed** (your hours, what they cost us, what they are charged at), what is quoted, and the **Margin**. With a target margin set it goes red below the target and tells you what to charge to hit it. With no target set it says so and goes red below 15 percent, as before. A loss is red either way. None of that stops you issuing.
   - **What we charge the client** (bottom): quote title, scope of works, charge lines with GST.
   - **Fill from costs** makes one client line per cost line. On a repair job: Labour lines are your hours at the labour rate, Material lines are our cost times the multiplier. It only asks for a markup % for Other lines, or when the office has not set a rate yet (it says which). On a private quote it asks for one markup % for everything, as before. Tap it once: tapping again adds the lines a second time.
5. Three documents come from the one scope, from the buttons at the bottom:
   - **Preview client PDF**: the quote the client gets.
   - **Scope of works (no prices)**: the write-up, the client lines with their quantity and unit but no prices, and the ticked photos. No dollar figure, no Labour allowed total and nothing from **What it costs us**, so it can go to a trade or the builder. A client line prints its quantity and unit as it does on the client quote, hours included: edit the client line if you do not want the hours shown.
   - **Material order list**: Material lines grouped by supplier with our costs. Internal, not for the client. Labour and Other lines are not on it, so mark each line with the right type.
   The scope of works and the material order list open on the iPad to view, save or share. They are not filed on the job as documents yet; the scope, hours and materials they are made from are saved on the job with the quote.
6. Everything saves to the office by itself as you type. If a save fails (no signal), the draft is kept on the iPad and the screen says so; it saves when signal is back. Opening jobs and adding photos need signal.
7. **Issue client quote** freezes that version, saves the PDF on the job and moves the Repairs board card to Quoted. Nothing is emailed or texted.
8. Changes after issuing: **Start a revision** (becomes version 2). Extra work: **Variations** tab, **New variation**, then record approved or rejected.
9. **History** shows every version: what was allowed (cost and labour hours) against what was quoted.
10. Work with no insurance job: **New private quote** makes a new SWM job with the client details.

If the Type column, the pricing goal line and the Material order list button are not there, the office system has not sent them for this job: the tool works as it did before, with one markup % for every line. A private quote is always that way.

## Pricing settings and the back end

The labour rate, the materials multiplier and the target margin are rows in the server's private `quote_builder_settings` table (not `org_config`) and arrive with an insurance repair job as `settings`, with `can_edit_settings: false`. The app only shows them, as one read-only goal line: there is no settings page. No pricing number is ever written in this repo: the site and its code are public. Until the server sends them, and on every private job, the app behaves as it did before line types. What the app calls and expects, and what the back end still has to build (the job value, work orders and purchase orders), is in `docs/backend-needed.md`.

## Running and testing

Plain HTML/CSS/JS, no build step. `npm install`, then `npm run serve` (http://localhost:4517) or `npm test` (unit tests plus Playwright against a fake ops-api, in Playwright's own Chrome for Testing).

Config (Supabase URL and public anon key) is in `js/config.js`. Never add a service key or other secret: the site is public.

## Hosting

`.github/workflows/pages.yml` deploys `main` to GitHub Pages. Pages from a private repo needs a paid GitHub plan, so it starts serving once the organisation plan is upgraded.
