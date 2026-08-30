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

Poshmark and Depop have no public API, so their stats are always logged manually from the Stats tab's "Log a stat update" form — that works today with no setup. eBay *can* sync automatically instead, but needs your own developer credentials since eBay doesn't hand out API access per-site:

1. Create a free account at **developer.ebay.com** and register an application to get an **App ID** and generate a **User Access Token** (OAuth) with the `sell.analytics` scope. eBay's own docs walk through this — it involves a one-time authorization flow in your eBay seller account.
2. In the Apps Script editor (Extensions → Apps Script, same project as above): **Project Settings** (gear icon) → **Script Properties** → **Add script property**. Add:
   - `EBAY_OAUTH_TOKEN` = the access token from step 1.
3. Back in the editor's **Run** menu, select the `setupEbayTrigger` function and run it once (authorize if prompted). This installs a timer that calls `syncEbayMetrics` every 6 hours from then on — nothing further to click.
4. **Note on data availability:** eBay's per-listing view/impression numbers depend on your account tier — some data (like detailed traffic reports) may require an eBay Store subscription. `syncEbayMetrics()` in `Code.gs` is written as a starting point against eBay's Traffic Report API; you may need to adjust the response field names once you see what your account actually returns.
5. OAuth tokens expire — when eBay stops returning data, generate a fresh token and update the Script Property. (A refresh-token flow can be added to `Code.gs` later if this becomes annoying enough to automate.)

Until this is set up, log eBay stats manually from the Stats tab — the same form used for Poshmark/Depop.

## 4. Acquire market data (real sold-comps, auto-refreshing — no account needed)

The Acquire tab's "Trending to look for" section and each watchlist item's sold-price comps come from eBay's **public** completed/sold-listings search — no login, no API key, nothing to sign up for. It just needs to be turned on once:

1. In the Apps Script editor's **Run** menu, select the `setupMarketDataTrigger` function and run it once (authorize if prompted).
2. This does two things: installs a daily timer that keeps everything fresh automatically, and runs one refresh immediately so you're not staring at empty data until tomorrow.
3. That's it — no further clicking. Watchlist cards will show avg sold price + recent sales found once refreshed; the trending section fills in the same way.

**Editing the trending categories:** open `Code.gs` and edit the `TREND_CANDIDATES` array near the top of the "Market data" section — it's a plain list of search terms (e.g. `'Carhartt jacket'`). Add, remove, or change entries, then redeploy (New version).

**A note on this one:** unlike the eBay/Poshmark stats and cover photos (which were one-time pulls I ran manually through your logged-in accounts), this runs unattended forever once turned on, since it only reads eBay's public search page. That's still automated access to eBay's site, which its terms of service don't strictly permit — low-risk since it's just public listing data at a light daily frequency, but worth knowing it's there.

## Editing categories/platforms

`js/data.js` holds icon/color lookups for categories and platforms (`CATEGORY_META`, `PLATFORM_META`) — edit directly to add a brand-new platform or give a category a specific icon. Categories you never add there still work; they just get an automatically-assigned color and a generic 📦 icon. Everything else (actual inventory, descriptions, stats, acquire list) lives in the Sheet, not in this file.
