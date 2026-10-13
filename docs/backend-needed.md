# What the quote builder needs from the back end

Written 13 Oct 2026 with the app change that added line types, pricing from settings, labour allowed, the margin target, the scope of works and the material order list. For the builder of `secureworks-backend` `ops-api`. It follows the ops desk build note of the same day (slices 1 to 4); where this file and that note differ, section 6 says so.

No pricing number is written in this repo, and none may be: the site and its code are public. The owner's two starting values go in the server seed only.

## 1. How the app copes until the server changes

The switch is one field: `settings` on the `quote_builder_get_job` response.

| Server sends | The app does |
|---|---|
| No `settings` key (today's server) | Works exactly as before: no Type column, no pricing bar, no Labour allowed, one markup question, red below 15 percent, no Material order list button. Only the "Scope of works (no prices)" button is new. |
| `settings` present | Line types, the read-only pricing bar, Labour allowed, pricing from the settings, the margin target (section 2f) and the Material order list all turn on. |

So the server must ship `settings` and line type storage (section 2) in the same deploy. If `settings` arrives while `line_type` is still dropped on save, every line reads back as Other after a reload.

The app sends `line_type` on every cost line today. Today's server ignores it, which is fine.

## 2. Slice 1: what the app calls and expects

### 2a. `GET quote_builder_get_job`: one new field

```json
{
  "settings": { "labour_rate_ex_gst": 0, "materials_multiplier": 0, "target_margin_pct": null }
}
```

- Each setting is a number, or `null` when it has no row or is not a number. No fallback numbers on the server either.
- The app treats a value that is not above zero as not set. `target_margin_pct` must be above 0 and below 100 to count.
- The app only reads the settings. It shows the rate and the multiplier on the quote screen and never writes them (section 2c).
- A rate or multiplier that is `null` is not an error. The app prices that line type through the old markup question and tells the user which setting is missing.

### 2b. Cost lines: `line_type`

Sent on every cost line in `quote_builder_save`, and expected back on every cost line of a version:

```json
{ "line_id": "c-6f1c", "line_type": "labour", "description": "Carpenter on site", "qty": 8, "unit": "hr", "unit_cost_ex_gst": 50, "supplier_or_trade": "Dave" }
```

- Values: `material`, `labour`, `other`. Keep it when it is one of those. Anything else or missing: store the line with no `line_type` key. Never refuse a line for its type.
- A line read back with no `line_type` is shown as Other. It is only sent back as `other` if the user edits and saves that draft. Issued versions are never rewritten.
- A Labour line always arrives with `unit: "hr"`; its `qty` is the hours allowed and `unit_cost_ex_gst` is what an hour costs us.
- Totals do not change. Labour allowed is worked out in the app when shown: hours and cost from lines with `line_type = labour`.

### 2c. Changing the settings: nothing in the app

The app has no settings page and calls no settings save action. The numbers are set on the server (the seed in section 2d, then `org_config`) and the app shows them read-only.

- The app does not call `quote_builder_settings_save` and does not read `can_edit_settings`. Neither is needed for this app.
- Who may change the numbers is owner question Q3 (section 7), still open. An in-app editor, if the owner wants one, is a later change on both sides.
- A changed number reaches the app the next time a job is opened. It applies the next time Fill from costs is used; quotes already filled or issued keep their prices.

### 2d. Storage and seed

As the build note sets out: `org_config` keys `quote_builder_insurance_labour_rate_ex_gst`, `quote_builder_insurance_materials_multiplier` and `quote_builder_target_margin_pct`, each `{"amount": n}`. Seed the first two with the owner's starting values of 13 Oct 2026 (they are in the build note, not here). No row for the target until the owner gives one.

### 2e. How the app prices with them

Fill from costs on a repair job makes one client line per cost line:

| Line type | Client unit price |
|---|---|
| Labour | the labour rate (quantity stays the hours) |
| Material | our unit cost times the multiplier, rounded to cents |
| Other, or a type whose setting is `null` | our unit cost plus the markup percent the user types |

Private quotes ignore the settings and use the one markup percent for every line.

### 2f. The margin warning

| `target_margin_pct` | The Margin tile |
|---|---|
| A number above 0 and below 100 | Red below the target, with what to charge to reach it. At or above it: "On the N% target". |
| `null` | Red below 15 percent, as before, with the note "No target margin set". |
| No `settings` key | Red below 15 percent, as before, with no note. |

A loss is red in every case. The app never invents a target: the only target is the one the server sends.

## 3. Slice 3: the job value on issue

All back end. The app reads nothing about the job value and shows no job value message: it ignores any `job_value` field on the replies of `quote_builder_issue` and `quote_builder_decide_variation`. A message on issue is a later app change, once the server sends the field.

The value is a calculated column, so the server writes `jobs.pricing_json` behind the guard in the build note (only when it is empty or already carries `"source": "quote_builder"`). None of that is in this repo.

## 4. Slice 4: work order and purchase orders from an issued quote

Not built in the app. This repo alone cannot do it safely: the existing `create_work_order` takes whatever lines the caller sends, a priced line on a crew work order feeds the trade's invoice, and nothing ties the work order to the version it came from or stops a second press making a second one. It needs the two new actions in the build note:

| Action | Body | Makes |
|---|---|---|
| `POST quote_builder_make_work_order` | `{ "version_id": "uuid of an issued version" }` | One draft crew work order on the version's job. `scope_items`: the scope of works text, then one item per Labour line as description and hours. No dollar figure. |
| `POST quote_builder_make_purchase_orders` | `{ "version_id": "uuid of an issued version" }` | One draft purchase order per supplier from the Material lines, with quantity and our unit cost. |

For the app side to be built next, it needs:

- Both actions to take the job from the version, never from the request.
- A second call to return what the first made, not make another.
- `quote_builder_get_job` to say, per version, what was already made. Proposed: on each version object, `work_order: { "id", "wo_number", "status" } | null` and `purchase_orders: [{ "id", "po_number", "supplier_name", "status" }]`.
- The same shape back from each action: `{ "work_order": {...} }` and `{ "purchase_orders": [...] }`.

Everything the work order needs is already saved on the job by this change, once section 2b is live: the scope text, the Labour lines with hours, and the Material lines with supplier, quantity and cost.

## 5. Not covered by the build note: filing the two new documents on the job

The owner's words ask that the quote, the scope of works and the material order list all land on the correct job. Today:

| Thing | On the job? |
|---|---|
| Client quote PDF | Yes, as its own job document (unchanged). |
| Scope text, cost lines with type and supplier, labour hours | Yes, in the saved version (types and hours once section 2b is live). |
| Scope of works PDF, material order list PDF | No. They are made on the iPad from the open scope or variation, on demand, from the quote screen only. |

Filing those two PDFs as job documents needs the back end, because the server hands out one upload slot per version and files one document on issue. If the owner wants them filed, a proposal:

- `quote_builder_pdf_upload_url` accepts `document`: `quote` (default), `scope_of_works` or `material_order_list`, and returns a slot for each.
- `quote_builder_issue` accepts `extra_documents: [{ "document": "...", "pdf_path": "..." }]` and files each as its own `job_documents` row, not visible to trades, under the same `qb:<chain_id>` run label rules so a re-issue retires the earlier one.

This is a proposal, not something the app calls today.

## 6. Where the app differs from the build note, and why

| Build note | App | Why |
|---|---|---|
| Material order list prints no costs | It prints our unit cost and line cost, and is marked internal, not for the client | The task brief lists the list's columns as item, quantity, supplier, cost. |
| Labour allowed shows hours and our cost | It shows hours, our cost, and on a repair job what the hours are charged at | The task brief asks for the labour amount allowed at the hourly rate. |
| Settings page and a settings save action | Neither. The rate and the multiplier show read-only on the quote screen | The numbers are set on the server. Who may change them is owner question Q3, still open. |
| Issuing and deciding a variation say what happened to the job value | The app says nothing about the job value | The server does not send it yet (section 3). |
| Material list says "N cost lines have no type" | It says how many cost lines are not marked Material because they are Other or have no type | An untyped line becomes Other the moment its draft opens, so the two cannot be told apart on screen. |

## 7. Owner questions the app did not answer

Built on the build note's own defaults; none blocks the app.

| Question | What the app does until answered |
|---|---|
| Q1 target margin | Keeps the red warning below 15 percent and says "No target margin set". Uses a target the moment the server sends one. |
| Q2 cost of an hour of labour | Hugo types it per Labour line. With it blank, the margin reads high. |
| Q3 who may change the settings | Open. Nobody can change them in the app: there is no in-app editor. They are set on the server. |
| Q4 one pair of numbers or one per builder | One pair, whatever the server sends for the job. A per-builder pair would be a server change to what `settings` returns for that job. |
| Q5 job values for quotes issued earlier | Nothing. Back end and owner. |
| Q6 may a trade see labour dollars | Open, for the later crew work order (section 4). The scope of works can go to a builder or a trade: it has no Labour allowed section, no dollar amount and no figure from the internal cost table. Client line quantities and units print on it as they do on the client quote, so a client line in hours shows its hours; Hugo edits the client line if he does not want them shown. The Labour allowed total stays on the quote screen and in History. |
| Q7 rule for Other lines | The old markup question. |
