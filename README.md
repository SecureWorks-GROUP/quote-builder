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
   - **Insurance pricing** (repair jobs): the bar shows the labour rate and the materials multiplier the office has set. They are the same on every iPad. Only the owner or an admin sees **Change**.
   - **The dark strip** shows what the job costs us, **Labour allowed** (your hours, what they cost us, what they are charged at), what is quoted, and the **Margin**. With a target margin set it goes red below the target and tells you what to charge to hit it. With no target set it says so and marks nothing.
   - **What we charge the client** (bottom): quote title, scope of works, charge lines with GST.
   - **Fill from costs** makes one client line per cost line. On a repair job: Labour lines are your hours at the labour rate, Material lines are our cost times the multiplier. It only asks for a markup % for Other lines, or when the office has not set a rate yet (it says which). On a private quote it asks for one markup % for everything, as before. Tap it once: tapping again adds the lines a second time.
5. Three documents come from the one scope, from the buttons at the bottom:
   - **Preview client PDF**: the quote the client gets.
   - **Scope of works (no prices)**: the write-up, the client lines without prices, the hours of labour allowed and the ticked photos. No dollar figure anywhere, so it can go to a trade or the builder.
   - **Material order list**: Material lines grouped by supplier with our costs. Internal, not for the client. Labour and Other lines are not on it, so mark each line with the right type.
   The scope of works and the material order list open on the iPad to view, save or share. They also open from any saved version under **History**. They are not filed on the job as documents yet; the scope, hours and materials they are made from are saved on the job with the quote.
6. Everything saves to the office by itself as you type. If a save fails (no signal), the draft is kept on the iPad and the screen says so; it saves when signal is back. Opening jobs and adding photos need signal.
7. **Issue client quote** freezes that version, saves the PDF on the job and moves the Repairs board card to Quoted. Nothing is emailed or texted.
8. Changes after issuing: **Start a revision** (becomes version 2). Extra work: **Variations** tab, **New variation**, then record approved or rejected.
9. **History** shows every version: what was allowed (cost and labour hours) against what was quoted.
10. Work with no insurance job: **New private quote** makes a new SWM job with the client details.

If the Type column, the Insurance pricing bar and the Material order list button are not there, the office system has not been updated yet: the tool works as it did before, with one markup % for every line.

## Pricing settings and the back end

The labour rate, the materials multiplier and the target margin are held on the server and arrive with each job. No pricing number is ever written in this repo: the site and its code are public. Until the server sends them the app behaves as it did before line types. What the app calls and expects, and what the back end still has to build (settings, line types, the job value, work orders and purchase orders), is in `docs/backend-needed.md`.

## Running and testing

Plain HTML/CSS/JS, no build step. `npm install`, then `npm run serve` (http://localhost:4517) or `npm test` (unit tests plus Playwright against a fake ops-api, in Playwright's own Chrome for Testing).

Config (Supabase URL and public anon key) is in `js/config.js`. Never add a service key or other secret: the site is public.

## Hosting

`.github/workflows/pages.yml` deploys `main` to GitHub Pages. Pages from a private repo needs a paid GitHub plan, so it starts serving once the organisation plan is upgraded.
