# Setup

Two one-time steps: connect the Sheet, then put the site online. A third, optional step wires up automatic eBay stats.

## 1. Connect the Google Sheet

1. Open the "selling_inventory_updated" Google Sheet.
2. **Extensions → Apps Script**.
3. Delete anything in the editor, then paste in the contents of `Code.gs` from this folder.
4. **Deploy → New deployment**.
5. Click the gear next to "Select type" → **Web app**.
6. Set "Execute as" = **Me**, "Who has access" = **Anyone**.
7. Click **Deploy**, authorize when prompted (it's your own script on your own Sheet).
8. Copy the **Web app URL** it gives you.
9. Open `js/config.js` in this folder and paste it in:
   ```js
   const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/xxxxxxx/exec';
   ```

That's it — Inventory, Stats, and Acquire will now read and write directly to your Sheet. Every time you edit `Code.gs` in the Apps Script editor, use **Deploy → Manage deployments → edit (pencil) → New version** to push the change live (the URL stays the same).

If you skip this step, the site still loads but Inventory/Stats show nothing (there's no local copy of your Sheet data to fall back to) and Acquire saves to that browser's local storage instead.

**If "Mark sold" fails** with an error about a missing row-number column: `markSold()` in `Code.gs` expects Listing Hub's row-number column (the one that stores which row to update back in Clothing/Non Clothing Sell Inventory) to sit immediately after "Source tab" — since that column has no header text of its own on this sheet. If you ever reorder Listing Hub's columns, update the `sourceTabCol + 1` line in `markSold()` to match, then redeploy (New version, same URL).

## 2. Put it online with GitHub Pages (free)

This is a one-time setup. The push needs your own GitHub login, so it has to happen from your Terminal, not from Claude.

1. Go to **https://github.com/new** and create a repo (e.g. `sell-hub`). Leave it **public** (GitHub Pages needs that on a free account) and don't add a README/gitignore/license — keep it empty.
2. Open **Terminal** and run, replacing `YOUR-USERNAME` with your GitHub username:
   ```bash
   cd "/Users/randymcfarland/Documents/Claude/sell-hub"
   git init
   git config user.name "Your Name"
   git config user.email "you@example.com"
   git add .
   git commit -m "Initial resale hub site"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/sell-hub.git
   git push -u origin main
   ```
   The first push will pop up a browser window to log in to GitHub — that's expected and normal.
3. On GitHub, go to the repo's **Settings → Pages**. Under "Build and deployment", set Source to **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
4. Wait about a minute, then your site is live at `https://YOUR-USERNAME.github.io/sell-hub/`.

**Future edits:** once this is set up, tell Claude what to change. Claude can edit the files and commit locally; you (or Claude, if `git push` is already authenticated on this machine after step 2) run `git push` to publish the update — GitHub Pages picks it up automatically within a minute or two.

## 3. Optional: eBay live stats (no eBay account needed to skip this)

Poshmark and Depop have no public metrics API, so their stats stay manual from the Stats tab's "Log a stat update" form. eBay *can* pull live stats into Metrics — **impressions, views and clicks** (Sell Analytics traffic report, last 30 days) plus **watchers and current price** (from your active listings) — and the Inventory **Refresh** button does that first. It needs your own developer credentials; eBay does not hand out API access per-site.

**A. On developer.ebay.com** (one time)

1. **Application Keys** → create a **Production** keyset (not Sandbox — sandbox has none of your real listings). Note the **App ID (Client ID)** and **Cert ID (Client Secret)**. If eBay asks about Marketplace Account Deletion notifications, choose the exemption ("I do not persist eBay user data") — this site only stores your own listing stats.
2. **User Tokens** (next to the Production keyset) → **Get a Token from eBay via Your Application** → **Add eBay Redirect URL**. Fill in:
   - **Your auth accepted URL**: your Apps Script **Web app URL** (the `…/exec` URL in `js/config.js`)
   - **Your auth declined URL** and **Privacy policy URL**: your site URL is fine (e.g. `https://YOUR-USERNAME.github.io/sell-hub/`)
   - Tick **OAuth Enabled**, save.
3. Copy the **RuName** it shows (looks like `Your_Name-YourApp-PRD-abc123-defgh`). That — not the URL — is what eBay calls the redirect URI.

**B. In Apps Script** (Extensions → Apps Script, same project as step 1)

1. Paste in the latest `Code.gs` and **Deploy → Manage deployments → edit → New version** (URL stays the same).
2. **Project Settings** (gear) → **Script Properties** → add:
   - `EBAY_CLIENT_ID` = App ID
   - `EBAY_CLIENT_SECRET` = Cert ID
   - `EBAY_RUNAME` = the RuName from A3
3. Back in the editor, pick **startEbayConnect** in the function dropdown → **Run**. Open the link it prints in the execution log (valid 30 minutes), sign in to eBay as your seller account and **Agree**.
4. eBay sends you back to the Web App, which saves your refresh token (`EBAY_REFRESH_TOKEN`, good for ~18 months) and runs a first sync. You'll see "eBay connected — N listings updated".
5. Pick **setupEbayTrigger** → **Run** once. That keeps stats fresh every 6 hours even when the site is closed.

**Using it:** **Inventory → Refresh** syncs eBay first (up to ~90s), then reloads everything. The status reads e.g. `Updated · eBay: 12 listings updated` or `Updated · eBay sync skipped (no token)` — a missing/failed eBay sync never blocks the rest of Refresh. Stats and Actions recommendations use the same numbers. Re-syncing on the same day updates that day's row rather than adding another.

**What gets matched:** a listing syncs when its Platform Posting Queue row is eBay and its **Listing URL** has the eBay item number (`ebay.com/itm/1234567890…`). Rows without one are counted as skipped.

**Checking it:** open `YOUR-WEB-APP-URL?action=ebayStatus` — it shows which settings are present, whether you're connected, when the refresh token expires and when it last synced (never the secrets themselves). When the refresh token expires, or you change scopes, just run **startEbayConnect** again.

Notes: which traffic metrics eBay returns can depend on your seller tier or Store subscription. If you connected before watchers were supported, watchers stay 0 until you re-run **startEbayConnect** once. Never commit secrets to the repo; Script Properties only.

## 4. Acquire — sourcing intelligence

Acquire is built from four Sheet tabs, each holding a different kind of information so the site never mixes up what a marketplace reported with what's an estimate:

| Tab | What it holds | Who writes it |
|---|---|---|
| **Sourcing Intel** | One row per research target: search term, eBay/Poshmark queries, category, risks, shipping class, typical buy cost, inspection checklist, recognition clues | You (or Claude). Add a row here — any category — to add a research target; no code change needed. Set **Active** to `N` to hide one. |
| **Market Trends** | The latest market snapshot per research target × platform: median, 25th–75th percentile sold range, sample size, sold count, active listings, sell-through, buyer-paid shipping | Poshmark refresh (automatic) and eBay pull (manual) |
| **Market History** | The same numbers appended every day they're pulled, never overwritten | Same as above. Trend direction (↑ rising / ↓ cooling) appears once there's about a week of history. |
| **Platform Trends** | What a selling platform itself says is being searched for right now — one row per day × platform × term, with the weekly change in searches | Pulled from the platform (Depop's "Popular this week" is the first source) |
| **Acquire Watchlist** | Your Hunt List | The site |

**Poshmark** — its public sold-listings search works from an automated script. Turn it on once: in the Apps Script editor, **Run → setupMarketDataTrigger** (authorize when prompted). It refreshes daily for every Sourcing Intel row with a *Poshmark Query* (fashion items — Poshmark has no useful comps for electronics or tools).

**eBay** — its search blocks automated requests, so eBay numbers are pulled through a real browser session (`tools/ebay_comps_pull.js`, run from a tab on ebay.com) and written in with the `setMarketObservations` action. Ask Claude to refresh eBay comps whenever you want current numbers; the header on the Acquire tab shows how old each source is.

**Where to look first** — the shelves above the explorer are cut from the same research, each with its bar printed on it:

- **Everyday thrift finds** — only targets rated *Common* in Sourcing Intel's **Thrift Frequency** column (Common / Occasional / Rare — how often it really turns up on a thrift, bins or yard-sale run; an estimate like Typical Cost). They still need $10+ expected profit, to double your money at the usual shelf price, 18%+ sell-through and 500+ recent sales. Every card shows its frequency, and the explorer has a "How often you'll see it" filter.
- **Strong buys** — score 70+, at least $15 expected profit, roughly doubles your money, and a max buy that beats what the thing usually costs on a shelf.
- **Reliable quick sales** — 55%+ sell-through, 50+ recent sales, medium-or-better confidence, low/medium risk, ships easily. Smaller wins that don't sit.
- **Emerging trends** — targets whose price is actually rising in **Market History** (needs two snapshots at least 6 days apart, so it fills in as you keep pulling), plus the platform trending searches from **Platform Trends**. It never guesses a direction it can't measure: if there isn't enough history it says so and shows how many days it has.

The thresholds are in `lanes` in `js/acquire-config.js`; the selection is `buildLanes()` in `js/acquire-model.js`.

**Depop** has no seller stats at all on the web — no views, no likes, no impressions on a listing you own — so Depop rows in the Stats tab stay at zero. What Depop does publish is its "Popular this week" searches, and those go into **Platform Trends** and show up in the Emerging trends shelf.

**Shipping in the profit math:** on eBay the model charges the label for the item's shipping class, then credits back the average shipping buyers paid in the sold comps (free-shipping sales count as $0), less eBay's cut of it. Your own eBay sales show buyers covering most of the label.

**How the numbers are made:** every fee, shipping estimate, minimum profit, risk reserve, score weight and threshold lives in `js/acquire-config.js`. The calculations (Opportunity Score, max buy, profit, confidence, trend) are in `js/acquire-model.js`. Change an assumption in the config and every card, filter and the deal calculator follow it. Missing data stays missing — the site shows "—" or "Not enough data" rather than a guess.

**eBay query tip:** eBay treats every bare word as required, so `-box only` means "exclude box, and require the word *only*". Write exclusions as separate `-words`, and don't exclude words that normal complete listings contain (`-shaft` on golf drivers, `-lid` on Dutch ovens).

## Editing categories/platforms

`js/data.js` holds icon/color lookups for categories and platforms (`CATEGORY_META`, `PLATFORM_META`) — edit directly to add a brand-new platform or give a category a specific icon. Categories you never add there still work; they just get an automatically-assigned color and a generic 📦 icon. Everything else (actual inventory, descriptions, stats, acquire list) lives in the Sheet, not in this file.

## 5. Sales by site (Stats tab)

Two Sheet tabs, both created automatically:

- **Sales** — one row per sale: site, sale price, shipping charged, platform fees, shipping label, **net cash** (what you kept) and funds status. Marking an item sold on the site asks where it sold and (optionally) what you kept, and writes this row. Real fees and earnings come from each site's order page (eBay: Seller Hub → Orders → order details; Poshmark: My Sales), so ask Claude to pull them when you want exact numbers.
- **Platform Balances** — one snapshot per day per site of **available** cash (ready to withdraw) and **pending / on hold**. Update it from Stats → "Update available cash", or ask Claude to read eBay's financial summary and Poshmark's My Balance.

A sold item with no Sales row shows under "Not recorded by site" instead of disappearing from the totals.

**Cash flow** (below the site cards) is your own plan for each sale's money, stored in three columns on the sale's row in the Sales tab (*Cash Status*, *Cash Status Date*, *Cash Note*). **Not planned** (blank) = you haven't counted on it yet; **Accounted** = you've budgeted around it but it's still on the site or pending; **Cashed out** = withdrawn and used. Set it per sale with the buttons; the sale figures and every other total stay exactly as they are.

**Where the sales come from** (the pie at the top of Stats) is built from the Sales tab only — that's the one place that records which site a sale actually happened on. Sold items without a Sales row are counted as unlogged under the legend rather than guessed at.

## 6. Removing items (Inventory tab)

Open an inventory card and choose **Remove item…**:

- **Save for later** moves the item into the **Saved for Later** tab (created automatically) with an optional reason. It keeps a full copy of the item's source row and Listing Hub row — formulas included — plus its posting-queue statuses, so **Restore to inventory** (bottom of the Inventory tab) puts it back exactly as it was. Its queue rows are marked "Saved for later" meanwhile.
- **Delete for good** removes the item plus its posting queue rows, listing descriptions, photos and stats. Sales and the Item Actions log are kept. There's a second confirmation step.

Either way the item's row in its source tab is **cleared, not deleted**: Listing Hub finds each item by a stored source row number, so deleting a row would shift every item below it. Removing an item never ends its live listings — the dialog warns when it's still live somewhere.

## 7. Local deals (Actions tab)

Face-to-face selling doesn't fit a listing status: "someone's coming Friday at 9" and "marked pending on Marketplace" are neither live nor sold. Those live in the **Local Deals** tab (created automatically), one row per item × platform, with a status of **Interest**, **Meeting set** or **Pending**, plus who, when, where and a note.

Add or change one from Actions → Local deals; clearing a deal deletes the row so nothing stale is left behind. Booked meetups also show as a badge on the item's Inventory card, and the summary tile at the top of Actions shows the next one. Only platforms sold in person (Facebook Marketplace today, set by `LOCAL_PLATFORM_IDS` in `js/app.js`) are offered.

## 8. Holding a price

When you know a listing is priced right and just needs time — lots of interest, no rush — hit **Hold this price** on its pricing card. Suggestions that would lower the price ("Try a price drop", "Refresh listing") stop for that item and it moves to **On hold** with your reason; offers and visibility suggestions keep coming, since neither costs you anything off the asking price. **Release price** puts it back on automatic. Both are logged to Item Actions, so the Sheet keeps the history.


## 9. Stocking (intake → drafts → ready to post)

Stocking is the front door for new inventory. It writes **only** into the existing workbook `selling_inventory_updated` (never a new spreadsheet), and it never calls out to anything — no AI, no webhook. Pasting parks the text; turning it into an item is always a deliberate step.

- **Stocking** tab — stage board (`pasted` → `needs_analysis` → `details_needed` → `ready_for_drafts` → `ready_to_post` → `done`). A `pasted` row holds the raw text in **Raw Entry** and has no Item ID yet.
- **Clothing Sell Inventory** / **Non Clothing Sell Inventory** — new rows with Status `Identify`
- **Listing Hub** — formula row linked to the source row
- **Listing Questions** — reused for the details-needed Q&A (answered from the Stocking page)
- **Listing Descriptions** / **Platform Posting Queue** — draft upserts
- **Item Actions** — audit log
- Optional row on **Adding to Selling Inventory**

### Deploy Apps Script

1. Open the spreadsheet → **Extensions → Apps Script**.
2. Replace `Code.gs` with this repo’s `Code.gs` (or paste from `sell-hub-code-paste.html`).
3. **Deploy → Manage deployments → Edit (pencil) → New version → Deploy**. URL stays the same; `js/config.js` needs no change if it’s already set.
No script properties are needed for Stocking. (An old `STOCKING_WEBHOOK_URL` property is ignored now — safe to delete.)

### Working a paste

**Park it** saves whatever you paste as a `pasted` row: first line becomes the card title, the whole text goes in Raw Entry. Nothing else happens until either:

- **Fill in myself** on the card — loads the raw text into the detail form, and saving turns *that* row into the item (`pastedId` in the POST), or
- you ask Claude to process the parked entries — same path, filled in for you.

**Bin it** deletes the Stocking row only; anything already created from it stays.

### Site

After GitHub Pages picks up `main`, open **Stocking** in the nav. Cache-bust query is `?v=20260923-stock`.
