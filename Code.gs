/**
 * Backend for the Resale Hub site. Paste this into Extensions > Apps Script on the
 * "selling_inventory_updated" spreadsheet, then deploy as a Web App (see SETUP.md).
 *
 * Reads live from your existing tabs (Listing Hub, Listing Descriptions, Platform
 * Posting Queue) by matching column HEADER NAMES rather than fixed column letters,
 * so it keeps working if you reorder/insert columns. Two new tabs are auto-created
 * on first use: "Metrics" (impressions/views/clicks, manual + optional eBay API) and
 * "Acquire Watchlist" (full CRUD from the site).
 *
 * Endpoints (all on the same Web App URL):
 *   GET  ?action=inventory     -> [{itemId, sourceTab, sourceStatus, category, brand, size,
 *                                   item, condition, estValue, listPrice, floorPrice,
 *                                   platform, dateListed, buyer, soldPrice, netCash}]
 *   GET  ?action=descriptions  -> [{itemId, item, platform, suggestedTitle, description}]
 *   GET  ?action=postingQueue  -> [{listingId, itemId, platform, postingOrder}]
 *   GET  ?action=metrics       -> [{date, listingId, itemId, platform, impressions, views,
 *                                   watchers, clicks, price, source}]
 *   GET  ?action=acquire       -> [{id, brand, itemType, size, condition, targetPrice,
 *                                   bestPlatform, priority, notes, dateAdded, avgSoldPrice,
 *                                   recentSalesFound, lastChecked}]
 *   GET  ?action=photos        -> [{itemId, platform, photoUrl}]
 *   GET  ?action=trends        -> [{searchTerm, avgSoldPrice, recentSalesFound, lastChecked}]
 *   POST {action:'addMetricEntry', listingId, itemId, platform, impressions, views, watchers, clicks, price}
 *   POST {action:'addAcquireItem', brand, itemType, size, condition, targetPrice, bestPlatform, priority, notes} -> the new row
 *   POST {action:'updateAcquireItem', id, brand, itemType, size, condition, targetPrice, bestPlatform, priority, notes}
 *   POST {action:'deleteAcquireItem', id}
 *   POST {action:'markSold', itemId, sourceTab, soldPrice, buyer} -> writes Status=Sold back
 *        into the correct source tab (Clothing/Non Clothing Sell Inventory), located via
 *        Listing Hub's unnamed row-number column (the one right after "Source tab"). See
 *        markSold() below if your Listing Hub is laid out differently.
 *   POST {action:'setPhoto', itemId, platform, photoUrl} -> upserts one item's cover photo
 *
 * Market data (Acquire Watchlist comps + Market Trends tab) is NOT driven by a POST —
 * it refreshes itself daily via a time trigger. Run setupMarketDataTrigger() once from
 * this editor's Run menu to turn it on (see SETUP.md).
 */

var LISTING_HUB_SHEET = 'Listing Hub';
var DESCRIPTIONS_SHEET = 'Listing Descriptions';
var POSTING_QUEUE_SHEET = 'Platform Posting Queue';
var METRICS_SHEET_NAME = 'Metrics';
var ACQUIRE_SHEET_NAME = 'Acquire Watchlist';
var PHOTOS_SHEET_NAME = 'Photos';

function doGet(e) {
  var action = e.parameter.action;
  if (action === 'inventory') return jsonOut(getInventory());
  if (action === 'descriptions') return jsonOut(getDescriptions());
  if (action === 'postingQueue') return jsonOut(getPostingQueue());
  if (action === 'metrics') return jsonOut(getMetrics());
  if (action === 'acquire') return jsonOut(getAcquire());
  if (action === 'photos') return jsonOut(getPhotos());
  if (action === 'trends') return jsonOut(getTrends());
  return jsonOut({ error: 'unknown action' });
}

function doPost(e) {
  var body = JSON.parse(e.postData.contents);
  var action = body.action;

  if (action === 'addMetricEntry') return jsonOut(addMetricEntry(body));
  if (action === 'addAcquireItem') return jsonOut(addAcquireItem(body));
  if (action === 'updateAcquireItem') return jsonOut(updateAcquireItem(body));
  if (action === 'deleteAcquireItem') return jsonOut(deleteAcquireItem(body.id));
  if (action === 'markSold') return jsonOut(markSold(body));
  if (action === 'setPhoto') return jsonOut(setPhoto(body));

  return jsonOut({ error: 'unknown action' });
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------
// Generic header-name-based table reading — scans the first 15 rows for
// a row containing one of `anchorHeaders` (case-insensitive) to locate
// the real header row, since these tabs use Google Sheets' "Table"
// feature with a title/description above the header, not a plain
// row-1 header. Column lookup falls back to a substring match if an
// exact header name isn't found, so small wording differences (e.g.
// "Buyer" vs "Buyer / lead") still resolve.
// ---------------------------------------------------------------------

function findHeaderRow(sheet, anchorHeaders) {
  var lastCol = sheet.getLastColumn();
  var scanRows = Math.min(sheet.getLastRow(), 15);
  if (scanRows < 1 || lastCol < 1) return null;
  var data = sheet.getRange(1, 1, scanRows, lastCol).getValues();
  for (var r = 0; r < data.length; r++) {
    var lowerRow = data[r].map(function (v) { return String(v).trim().toLowerCase(); });
    for (var a = 0; a < anchorHeaders.length; a++) {
      if (lowerRow.indexOf(anchorHeaders[a].toLowerCase()) !== -1) {
        return { rowIndex: r, colMap: buildColMap(data[r]) };
      }
    }
  }
  return null;
}

function buildColMap(headerVals) {
  var map = {};
  for (var c = 0; c < headerVals.length; c++) {
    var name = String(headerVals[c]).trim();
    if (name) map[name.toLowerCase()] = c;
  }
  return map;
}

function colIndex(colMap, name) {
  var key = name.toLowerCase();
  if (colMap.hasOwnProperty(key)) return colMap[key];
  // Fallback: header contains the search term (e.g. searching "Item #" finds
  // "item # (if possible)"). Deliberately one-directional — the reverse (search
  // term contains a short header, e.g. "item #" containing "item") caused the
  // plain "Item" column to steal matches meant for "Item #".
  for (var k in colMap) {
    if (colMap.hasOwnProperty(k) && k.indexOf(key) !== -1) return colMap[k];
  }
  return -1;
}

function val(row, colMap, name) {
  var idx = colIndex(colMap, name);
  return idx === -1 ? '' : row[idx];
}

function readTable(sheet, anchorHeaders) {
  var header = findHeaderRow(sheet, anchorHeaders);
  if (!header) return { rows: [], colMap: {}, headerSheetRow: -1 };
  var headerSheetRow = header.rowIndex + 1; // 1-indexed sheet row
  var startRow = headerSheetRow + 1;
  var lastRow = sheet.getLastRow();
  var numCols = sheet.getLastColumn();
  if (startRow > lastRow) return { rows: [], colMap: header.colMap, headerSheetRow: headerSheetRow };
  var values = sheet.getRange(startRow, 1, lastRow - startRow + 1, numCols).getValues();
  return { rows: values, colMap: header.colMap, headerSheetRow: headerSheetRow };
}

function formatDate(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return v;
}

// ---------------------------------------------------------------------
// Inventory — read-only, sourced from your pre-built "Listing Hub" tab
// (which already unifies Clothing + Non Clothing Sell Inventory).
// ---------------------------------------------------------------------

// Listing Hub doesn't carry Date listed/Buyer/Sold price/Net cash at all (it only
// pulls the fields needed for browsing) — those live solely in the source tabs, so
// they're read directly from there, at the row Listing Hub points to (the unnamed
// column right after "Source tab" — see markSold() for the same technique).
function getSourceRowExtras(ss, cache, sourceTabName, sourceRowNum) {
  var empty = { dateListed: '', buyer: '', soldPrice: '', netCash: '' };
  if (!sourceTabName || !sourceRowNum) return empty;

  var header = cache[sourceTabName];
  if (header === undefined) {
    var srcSheet = ss.getSheetByName(sourceTabName);
    header = srcSheet ? findHeaderRow(srcSheet, ['Status']) : null;
    if (header) header.sheet = srcSheet;
    cache[sourceTabName] = header;
  }
  if (!header) return empty;

  var rowVals = header.sheet.getRange(Number(sourceRowNum), 1, 1, header.sheet.getLastColumn()).getValues()[0];
  return {
    dateListed: formatDate(val(rowVals, header.colMap, 'Date listed')),
    buyer: val(rowVals, header.colMap, 'Buyer'),
    soldPrice: val(rowVals, header.colMap, 'Sold price'),
    netCash: val(rowVals, header.colMap, 'Net cash'),
  };
}

function getInventory() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(LISTING_HUB_SHEET);
  if (!sheet) return [];
  var t = readTable(sheet, ['Item ID']);
  var sourceTabCol = colIndex(t.colMap, 'Source tab');
  var sourceRowCol = sourceTabCol !== -1 ? sourceTabCol + 1 : -1;
  var sourceHeaderCache = {};

  var out = [];
  t.rows.forEach(function (row) {
    var itemId = val(row, t.colMap, 'Item ID');
    if (!itemId) return;
    var sourceTab = val(row, t.colMap, 'Source tab');
    var sourceRowNum = sourceRowCol !== -1 ? row[sourceRowCol] : null;
    var extras = getSourceRowExtras(ss, sourceHeaderCache, sourceTab, sourceRowNum);

    out.push({
      itemId: String(itemId),
      sourceTab: sourceTab,
      sourceStatus: val(row, t.colMap, 'Source status'),
      category: val(row, t.colMap, 'Category'),
      clothingType: val(row, t.colMap, 'Clothing Type'),
      brand: val(row, t.colMap, 'Brand'),
      size: val(row, t.colMap, 'Size'),
      item: val(row, t.colMap, 'Item'),
      itemNumber: val(row, t.colMap, 'Item number'),
      condition: val(row, t.colMap, 'Condition'),
      estValue: val(row, t.colMap, 'Est. value'),
      listPrice: val(row, t.colMap, 'List price'),
      floorPrice: val(row, t.colMap, 'Floor price'),
      platform: val(row, t.colMap, 'Platform'),
      dateListed: extras.dateListed,
      buyer: extras.buyer,
      soldPrice: extras.soldPrice,
      netCash: extras.netCash,
    });
  });
  return out;
}

// ---------------------------------------------------------------------
// Listing Descriptions — read-only, per (item x platform) title/description.
// ---------------------------------------------------------------------

function getDescriptions() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DESCRIPTIONS_SHEET);
  if (!sheet) return [];
  var t = readTable(sheet, ['Suggested title', 'Platform']);
  var out = [];
  t.rows.forEach(function (row) {
    var platform = val(row, t.colMap, 'Platform');
    var title = val(row, t.colMap, 'Suggested title');
    var description = val(row, t.colMap, 'Description');
    if (!platform && !title && !description) return;
    out.push({
      itemId: String(val(row, t.colMap, 'Item ID') || ''),
      item: val(row, t.colMap, 'Item'),
      platform: platform,
      suggestedTitle: title,
      description: description,
    });
  });
  return out;
}

// ---------------------------------------------------------------------
// Platform Posting Queue — read-only, per (item x platform) Listing ID.
// ---------------------------------------------------------------------

function getPostingQueue() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(POSTING_QUEUE_SHEET);
  if (!sheet) return [];
  var t = readTable(sheet, ['Listing ID']);
  var out = [];
  t.rows.forEach(function (row) {
    var listingId = val(row, t.colMap, 'Listing ID');
    if (!listingId) return;
    out.push({
      listingId: String(listingId),
      itemId: String(val(row, t.colMap, 'Item ID') || ''),
      platform: val(row, t.colMap, 'Platform'),
      postingOrder: val(row, t.colMap, 'Posting order'),
    });
  });
  return out;
}

// ---------------------------------------------------------------------
// Metrics — new tab, auto-created. Rows come from the site's manual
// "Log a stat update" form (source:'manual') and, once configured, the
// optional eBay auto-sync below (source:'api').
// ---------------------------------------------------------------------

var METRICS_HEADERS = ['Date', 'Listing ID', 'Item ID', 'Platform', 'Impressions', 'Views', 'Watchers', 'Clicks', 'Price', 'Source'];

function getMetricsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(METRICS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(METRICS_SHEET_NAME);
    sheet.appendRow(METRICS_HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getMetrics() {
  var sheet = getMetricsSheet();
  var data = sheet.getDataRange().getValues();
  var out = [];
  for (var r = 1; r < data.length; r++) {
    if (!data[r][1] && !data[r][2]) continue;
    out.push({
      date: formatDate(data[r][0]),
      listingId: data[r][1],
      itemId: String(data[r][2] || ''),
      platform: data[r][3],
      impressions: data[r][4],
      views: data[r][5],
      watchers: data[r][6],
      clicks: data[r][7],
      price: data[r][8],
      source: data[r][9],
    });
  }
  return out;
}

function addMetricEntry(body) {
  var sheet = getMetricsSheet();
  var date = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  sheet.appendRow([
    date, body.listingId || '', body.itemId || '', body.platform || '',
    body.impressions || 0, body.views || 0, body.watchers || 0, body.clicks || 0,
    body.price || '', body.source || 'manual',
  ]);
  return { ok: true, date: date };
}

// ---------------------------------------------------------------------
// Acquire Watchlist — new tab, auto-created. Full CRUD from the site.
// ---------------------------------------------------------------------

var ACQUIRE_HEADERS = [
  'ID', 'Brand', 'Item Type', 'Size', 'Condition', 'Target Price', 'Best Platform', 'Priority', 'Notes', 'Date Added',
  'Avg Sold Price', 'Recent Sales Found', 'Last Checked',
];

function getAcquireSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(ACQUIRE_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(ACQUIRE_SHEET_NAME);
    sheet.appendRow(ACQUIRE_HEADERS);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastColumn() < ACQUIRE_HEADERS.length) {
    // Upgrade older sheets created before market-data columns existed.
    sheet.getRange(1, sheet.getLastColumn() + 1, 1, ACQUIRE_HEADERS.length - sheet.getLastColumn())
      .setValues([ACQUIRE_HEADERS.slice(sheet.getLastColumn())]);
  }
  return sheet;
}

function getAcquire() {
  var sheet = getAcquireSheet();
  var data = sheet.getDataRange().getValues();
  var out = [];
  for (var r = 1; r < data.length; r++) {
    if (!data[r][0]) continue;
    out.push({
      id: data[r][0],
      brand: data[r][1],
      itemType: data[r][2],
      size: data[r][3],
      condition: data[r][4],
      targetPrice: data[r][5],
      bestPlatform: data[r][6],
      priority: data[r][7],
      notes: data[r][8],
      dateAdded: formatDate(data[r][9]),
      avgSoldPrice: data[r][10] || '',
      recentSalesFound: data[r][11] || '',
      lastChecked: formatDate(data[r][12]),
    });
  }
  return out;
}

function addAcquireItem(body) {
  var sheet = getAcquireSheet();
  var id = 'acq-' + new Date().getTime();
  var dateAdded = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  sheet.appendRow([
    id, body.brand || '', body.itemType || '', body.size || '', body.condition || '',
    body.targetPrice || '', body.bestPlatform || '', body.priority || 'Medium', body.notes || '', dateAdded,
  ]);
  return { id: id, dateAdded: dateAdded };
}

function updateAcquireItem(body) {
  var sheet = getAcquireSheet();
  var data = sheet.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][0]) === String(body.id)) {
      sheet.getRange(r + 1, 2, 1, 8).setValues([[
        body.brand || '', body.itemType || '', body.size || '', body.condition || '',
        body.targetPrice || '', body.bestPlatform || '', body.priority || 'Medium', body.notes || '',
      ]]);
      return { ok: true };
    }
  }
  return { ok: false };
}

function deleteAcquireItem(id) {
  var sheet = getAcquireSheet();
  var data = sheet.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][0]) === String(id)) {
      sheet.deleteRow(r + 1);
      return { ok: true };
    }
  }
  return { ok: false };
}

// ---------------------------------------------------------------------
// Mark Sold — writes back into whichever source tab (Clothing/Non
// Clothing Sell Inventory) the item came from. Listing Hub's row-number
// column (the row it came from in the source tab) has no header text of
// its own on this sheet, so it's addressed positionally — the column
// immediately after "Source tab" — rather than by name.
// ---------------------------------------------------------------------

function markSold(body) {
  var itemId = body.itemId;
  var sourceTabName = body.sourceTab;
  if (!itemId || !sourceTabName) return { ok: false, error: 'Missing itemId or sourceTab.' };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hubSheet = ss.getSheetByName(LISTING_HUB_SHEET);
  var sourceSheet = ss.getSheetByName(sourceTabName);
  if (!hubSheet || !sourceSheet) return { ok: false, error: 'Could not find the Listing Hub or "' + sourceTabName + '" tab.' };

  var t = readTable(hubSheet, ['Item ID']);
  var sourceTabCol = colIndex(t.colMap, 'Source tab');
  var sourceRowCol = sourceTabCol !== -1 ? sourceTabCol + 1 : -1;
  var sourceRowNum = null;
  for (var i = 0; i < t.rows.length; i++) {
    if (String(val(t.rows[i], t.colMap, 'Item ID')) === String(itemId)) {
      sourceRowNum = sourceRowCol !== -1 ? t.rows[i][sourceRowCol] : null;
      break;
    }
  }
  if (!sourceRowNum) {
    return {
      ok: false,
      error: 'Could not locate the source row for ' + itemId + ' — expected a row-number column immediately ' +
        'after "Source tab" in Listing Hub. Update markSold() (Code.gs) if your columns are laid out differently, then redeploy.',
    };
  }

  var srcHeader = findHeaderRow(sourceSheet, ['Status']);
  if (!srcHeader) return { ok: false, error: 'Could not find a "Status" column header in ' + sourceTabName + '.' };

  var row = Number(sourceRowNum);
  var statusCol = colIndex(srcHeader.colMap, 'Status');
  var soldPriceCol = colIndex(srcHeader.colMap, 'Sold price');
  var buyerCol = colIndex(srcHeader.colMap, 'Buyer');

  if (statusCol !== -1) sourceSheet.getRange(row, statusCol + 1).setValue('Sold');
  if (soldPriceCol !== -1) sourceSheet.getRange(row, soldPriceCol + 1).setValue(body.soldPrice || '');
  if (buyerCol !== -1 && body.buyer) sourceSheet.getRange(row, buyerCol + 1).setValue(body.buyer);

  return { ok: true };
}

// ---------------------------------------------------------------------
// Optional: eBay auto-sync. Inert until EBAY_OAUTH_TOKEN is set in this
// project's Script Properties (Project Settings > Script Properties) —
// see SETUP.md's "Optional: eBay live stats" section for how to get one.
// Once set, run setupEbayTrigger() ONCE from this editor (Run menu) to
// install a recurring 6-hour timer — after that it updates on its own,
// no manual site interaction needed.
// ---------------------------------------------------------------------

function setupEbayTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncEbayMetrics') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncEbayMetrics').timeBased().everyHours(6).create();
}

function syncEbayMetrics() {
  var token = PropertiesService.getScriptProperties().getProperty('EBAY_OAUTH_TOKEN');
  if (!token) return; // not configured yet — see SETUP.md

  var queue = getPostingQueue().filter(function (row) {
    return String(row.platform || '').toLowerCase().indexOf('ebay') !== -1;
  });

  queue.forEach(function (row) {
    try {
      // eBay's Traffic Report API (Sell > Analytics). The exact response shape and
      // whether view/impression data is even available depends on your eBay account
      // tier (some require an eBay Store subscription) — treat this as a starting
      // point to adjust once you see a real response, not a finished integration.
      var resp = UrlFetchApp.fetch(
        'https://api.ebay.com/sell/analytics/v1/traffic_report?listing_ids=' + encodeURIComponent(row.listingId),
        { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true }
      );
      if (resp.getResponseCode() !== 200) return;
      var data = JSON.parse(resp.getContentText());
      addMetricEntry({
        listingId: row.listingId,
        itemId: row.itemId,
        platform: 'eBay',
        impressions: data.impressions || 0,
        views: data.listingViews || 0,
        watchers: data.watchCount || 0,
        clicks: data.clicks || 0,
        source: 'api',
      });
    } catch (err) {
      // Skip this listing on any API error; the next scheduled run will retry.
    }
  });
}

// ---------------------------------------------------------------------
// Photos — new tab, auto-created. One cover-photo URL per (item x
// platform), populated from each platform's own listing pages (public
// CDN image URLs — no credentials involved). setPhoto() upserts so
// re-running a photo pull doesn't create duplicate rows.
// ---------------------------------------------------------------------

var PHOTOS_HEADERS = ['Item ID', 'Platform', 'Photo URL'];

function getPhotosSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(PHOTOS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(PHOTOS_SHEET_NAME);
    sheet.appendRow(PHOTOS_HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getPhotos() {
  var sheet = getPhotosSheet();
  var data = sheet.getDataRange().getValues();
  var out = [];
  for (var r = 1; r < data.length; r++) {
    if (!data[r][0]) continue;
    out.push({ itemId: String(data[r][0]), platform: data[r][1], photoUrl: data[r][2] });
  }
  return out;
}

function setPhoto(body) {
  var sheet = getPhotosSheet();
  var data = sheet.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][0]) === String(body.itemId) && String(data[r][1]) === String(body.platform)) {
      sheet.getRange(r + 1, 3).setValue(body.photoUrl || '');
      return { ok: true, updated: true };
    }
  }
  sheet.appendRow([body.itemId || '', body.platform || '', body.photoUrl || '']);
  return { ok: true, updated: false };
}

// ---------------------------------------------------------------------
// Market data — real eBay sold-listing comps for Acquire Watchlist items,
// plus a "Market Trends" tab of curated resale categories, both refreshed
// on a daily trigger. Uses eBay's PUBLIC completed/sold-listings search
// (no login, no API key) via UrlFetchApp, so this runs unattended without
// needing anyone's personal eBay session — unlike the per-listing stats
// pull, which was a one-time manual thing tied to a logged-in browser.
//
// One-time setup: run setupMarketDataTrigger() once from this editor's
// Run menu (authorize when prompted). After that it updates itself daily
// with no further action — see SETUP.md.
// ---------------------------------------------------------------------

var TRENDS_SHEET_NAME = 'Market Trends';
var TRENDS_HEADERS = ['Search Term', 'Avg Sold Price', 'Recent Sales Found', 'Last Checked'];

// Curated starting set of well-known thrift/resale categories. Edit this
// list directly in the Apps Script editor to track different categories —
// it's just a plain array, no sheet involved.
var TREND_CANDIDATES = [
  'Carhartt jacket', 'Nike hoodie', 'Levis 501 jeans', 'The North Face jacket',
  'Patagonia fleece', 'Jordan sneakers', 'Dr Martens boots', 'Coach bag',
  'Ralph Lauren polo', 'Lululemon leggings', 'Champion hoodie', 'Vans shoes',
  'Nike Dunk', 'Timberland boots', 'Columbia jacket',
];

// Searches eBay's public sold/completed listings for `query` and returns
// aggregate stats. No login required — this is the same search anyone can
// run at ebay.com with the "Sold Items" filter checked.
function searchSoldListings(query, debug) {
  var url = 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent(query) + '&LH_Sold=1&LH_Complete=1&_ipg=60';
  try {
    var resp = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    var code = resp.getResponseCode();
    var html = resp.getContentText();
    if (debug) {
      Logger.log('query=%s status=%s length=%s hasPriceClass=%s hasCaptcha=%s title=%s',
        query, code, html.length, html.indexOf('s-card__price') !== -1,
        /captcha|verify you.?re human|pardon our interruption/i.test(html),
        (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1]);
    }
    if (code !== 200) return { avgPrice: 0, count: 0 };
    var priceRe = /s-card__price">\$([\d,]+\.\d{2})/g;
    var prices = [];
    var m;
    while ((m = priceRe.exec(html)) !== null) {
      prices.push(parseFloat(m[1].replace(/,/g, '')));
    }
    if (!prices.length) return { avgPrice: 0, count: 0 };
    var sum = prices.reduce(function (a, b) { return a + b; }, 0);
    return { avgPrice: Math.round((sum / prices.length) * 100) / 100, count: prices.length };
  } catch (err) {
    if (debug) Logger.log('query=%s EXCEPTION %s', query, err);
    return { avgPrice: 0, count: 0 };
  }
}

// Diagnostic helper — run this directly from the Run menu and check the
// execution log to see exactly what eBay's server is sending back.
function debugSearchSoldListings() {
  searchSoldListings('Carhartt jacket', true);
}

function getTrendsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(TRENDS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(TRENDS_SHEET_NAME);
    sheet.appendRow(TRENDS_HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getTrends() {
  var sheet = getTrendsSheet();
  var data = sheet.getDataRange().getValues();
  var out = [];
  for (var r = 1; r < data.length; r++) {
    if (!data[r][0]) continue;
    out.push({
      searchTerm: data[r][0],
      avgSoldPrice: data[r][1] || '',
      recentSalesFound: data[r][2] || '',
      lastChecked: formatDate(data[r][3]),
    });
  }
  return out;
}

// Refreshes both the Acquire Watchlist's per-item comps and the Market
// Trends tab. Called automatically by the daily trigger (setupMarketDataTrigger)
// — can also be run manually from the Run menu to force an immediate update.
function refreshMarketData() {
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  // Watchlist items
  var acqSheet = getAcquireSheet();
  var acqData = acqSheet.getDataRange().getValues();
  for (var r = 1; r < acqData.length; r++) {
    if (!acqData[r][0]) continue;
    var query = (acqData[r][1] + ' ' + acqData[r][2]).trim();
    if (!query) continue;
    var result = searchSoldListings(query);
    acqSheet.getRange(r + 1, 11, 1, 3).setValues([[result.avgPrice || '', result.count || '', today]]);
    Utilities.sleep(1500);
  }

  // Trending categories — rewrite the whole tab each run, ranked by recent sales found.
  var trendResults = TREND_CANDIDATES.map(function (term) {
    var result = searchSoldListings(term);
    Utilities.sleep(1500);
    return [term, result.avgPrice || '', result.count || '', today];
  });
  trendResults.sort(function (a, b) { return (b[2] || 0) - (a[2] || 0); });

  var trendsSheet = getTrendsSheet();
  trendsSheet.clear();
  trendsSheet.appendRow(TRENDS_HEADERS);
  trendsSheet.setFrozenRows(1);
  if (trendResults.length) {
    trendsSheet.getRange(2, 1, trendResults.length, TRENDS_HEADERS.length).setValues(trendResults);
  }
}

function setupMarketDataTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'refreshMarketData') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('refreshMarketData').timeBased().everyDays(1).create();
  refreshMarketData(); // run once immediately so there's data right away, not just after tomorrow's trigger
}
