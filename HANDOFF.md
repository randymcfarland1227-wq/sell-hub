# Handoff: item card unify (merged to main 2026-10-01)

## What changed
- Header: "RM" monogram plus "Randy's / Resale Desk" (index.html `h1.brand`, CSS "Brand" block).
- One item card, `itemCard(item, opts)` in js/app.js, used by Inventory, Focus, Item prep, Still to list (by site and by item), Optimize and Performance suggestion cards, To ship, Local deals and End listings.
  Anatomy: photo (select/focus tools under it) · title · details line · price column (price over floor), then tags, then optional stats, pace line, per-site rows, callout, body and foot.
- Each view keeps its own content. Only layout and styling are shared. Options: `meta` replaces the details line, `alerts` turns on the "!" button (Inventory only), `noStatus`, `sites`, `expect`, `stats`, `paceLine`, `siteStats`, `callout`, `body`, `foot`, `accent`, `cls`, `attrs`.
- Performance rows (`perfRowHTML`) use the card's title font and price/floor column.
- CSS: "Item card (.ic)" block and the rules after it at the end of css/styles.css. Tags are `.tg-*`. Brand-colour text uses `--plat-ink` (lighter in dark mode).

## Previewing without the Sheet
The Apps Script host is blocked from cloud sessions, so `tools/preview/` mocks it:
- `python3 server.py` serves the site on :8942.
- `node tools/preview/shoot.js` takes full-page screenshots of every tab (light and dark, 1280 and 375 wide) into `$OUT`.
- `node tools/preview/buttons.js` clicks every card button and checks the request it would send (nothing reaches the Sheet).
- `tools/preview/fixture.js` holds the mock data. Set `PLAYWRIGHT` to the playwright module path if it isn't resolvable.

## Standing rules
- The live listing price is final. Never report or "fix" sheet-vs-listing drift.
- Offers are prepared, never sent without Randy's approval (`Offer Prepared` / `Offer Approved`).
- Never log `Task` actions from the daily run.
- Edit from a GitHub clone. Documents/Claude/sell-hub is stale.
- Sheet writes can return 405/302 even when they succeed. Never retry; re-read to verify.
