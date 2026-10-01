# Handoff — item-card-unify (WIP, not on main)

Branch off main @ cfe75df. Syntax-checked (`node --check js/app.js`) but NOT yet visually verified in a browser.

## What Randy asked (2026-10-01)
1. Replace the gradient square next to the title with something personal. Done: "RM" monogram + "Randy's / Resale Desk" (index.html `h1.brand`, CSS "Brand" block). Name is a guess; Randy floated "Randy's Resale Hub" / "Resale Deck". Easy to change.
2. Items look inconsistent across views (Item prep, Focus, Performance, Inventory, Still to list, Optimize cards): different fonts, sizes, colours and spacing, and price/floor wrapping differently card to card. **Keep each view's content exactly as it is; only unify how it's laid out and styled** (he said this explicitly, twice).

## What's done on this branch
- `itemCard(item, opts)` in js/app.js: one anatomy (photo · title · details line · fixed price column with price over floor), then tags, then optional stats / pace line / per-site rows / callout / body / foot. Helpers: `priceShortFor`, `itemPriceColHTML`, `itemDetailsLine`, `tag()`, `siteTagsHTML`, `expectTagHTML`, `paceTagHTML`, `itemStatRowHTML`, `itemSiteStatsHTML`.
- Moved onto it: Inventory (`inventoryCardHTML`), Focus (`renderFocusView`), Item prep (`renderItemPrep`), Still to list by-item and by-site (`renderReadyToList`), and the pricing cards in `renderPricingInto` (Optimize suggestions and Performance status).
- Content kept per view: Focus keeps per-site rows, pace line, local deals and price log; Item prep keeps live/missing sites, draft badge and note; Still to list keeps the "N sites to post" count, posted date and every button; pricing cards keep the label, "you" marker, hold lock, date added, views/clicks/watchers line and all actions.
- CSS: "Item card (.ic)" block at the end of css/styles.css. Tag class `.tg-*`.
- `draftBadgeHTML` fix: was indexing the `platformMeta` function; now uses `PLATFORM_META[id]`.

## To do next
1. Preview it: serve a copy with `python3 -m http.server` (preview_start is blocked in scheduled sessions), then check every tab in light AND dark mode, at desktop and 375px. Watch for:
   - the pick/focus tools (absolute, `right: 92px`) colliding with long titles
   - pricing-card buttons still working: handlers use `.closest('.pricing-card')`, `.pa-status`, `data-item-id`
   - the Still-to-list note editor (`state.editingPostingNote` keys `<id>|<site>` / `<id>|prep`)
   - Mark listed, Draft, and Not posting buttons
2. Consider moving To ship, Local deals and End-listings cards onto `itemCard`, keeping their content.
3. Optionally line Performance rows (`perfRowHTML`) up with the same title, price and floor styling.
4. Merge to main, push, and confirm the GitHub Pages build (`gh api repos/randymcfarland1227-wq/sell-hub/pages/builds/latest`).

## Standing rules (also in memory)
- The live listing price is final. Never report or "fix" sheet-vs-listing drift.
- Offers are prepared, never sent without Randy's approval (`Offer Prepared` / `Offer Approved`).
- Never log `Task` actions from the daily run.
- Edit from a GitHub clone; Documents/Claude/sell-hub is stale.
