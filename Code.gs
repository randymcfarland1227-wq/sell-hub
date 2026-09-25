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
 *   GET  ?action=postingQueue  -> [{listingId, itemId, platform, postingOrder, status, listingUrl, datePosted}]
 *   GET  ?action=metrics       -> [{date, listingId, itemId, platform, impressions, views,
 *                                   watchers, clicks, price, source}]
 *   GET  ?action=acquire       -> [{id, brand, itemType, size, color, condition, targetPrice,
 *                                   bestPlatform, priority, notes, dateAdded, ebayAvgPrice,
 *                                   ebaySalesFound, poshmarkAvgPrice, poshmarkSalesFound, lastChecked,
 *                                   ebaySellThrough}]
 *   GET  ?action=photos        -> [{itemId, platform, photoUrl}]
 *   GET  ?action=trends        -> [{searchTerm, platform, avgSoldPrice, recentSalesFound, sellThrough, lastChecked}]
 *   GET  ?action=itemActions   -> [{date, itemId, action, detail}] — log of price drops/offers sent/ignored recommendations
 *   GET  ?action=bootBundle    -> { inventory, descriptions, postingQueue, metrics, photos,
 *                                   itemActions, localDeals, generatedAt } — first-page datasets
 *                                   in one cold start instead of seven parallel GETs
 *   POST {action:'addMetricEntry', listingId, itemId, platform, impressions, views, watchers, clicks, price}
 *   POST {action:'addMetricEntries', date, rows:[...]}   — the same, in bulk
 *   POST {action:'syncEbayMetrics'} / GET ?action=syncEbayMetrics -> eBay Traffic Report sync
 *        (Script Properties; see SETUP.md); returns {ok,synced,skipped,errors}; GET also includes metrics[]
 *   GET  ?action=localDeals / POST {action:'setLocalDeal', itemId, platform, status, buyer, when, where, note}
 *   GET  ?action=platformTrends / POST {action:'setPlatformTrends', date, platform, rows:[{term, searches, searchDelta, url}]}
 *   POST {action:'addAcquireItem', brand, itemType, size, color, condition, targetPrice, bestPlatform, priority, notes} -> the new row
 *   POST {action:'updateAcquireItem', id, brand, itemType, size, color, condition, targetPrice, bestPlatform, priority, notes}
 *   POST {action:'deleteAcquireItem', id}
 *   POST {action:'markSold', itemId, sourceTab, soldPrice, buyer} -> writes Status=Sold back
 *        into the correct source tab (Clothing/Non Clothing Sell Inventory), located via
 *        Listing Hub's unnamed row-number column (the one right after "Source tab"). See
 *        markSold() below if your Listing Hub is laid out differently.
 *   POST {action:'setPhoto', itemId, platform, photoUrl} -> upserts one item's cover photo
 *   POST {action:'setAcquireEbayData', id, avgPrice, salesFound, sellThrough} -> manual eBay/Terapeak pull for one watchlist item
 *   POST {action:'setTrendEbayData', searchTerm, avgPrice, salesFound, sellThrough} -> manual eBay/Terapeak pull for one trend row
 *   POST {action:'dropListingPrice', itemId, sourceTab, newPrice} -> writes the new List price
 *        back into the source tab (same row-lookup as markSold) and logs it to Item Actions
 *   POST {action:'logItemAction', itemId, itemAction, detail} -> logs 'Offer Sent' or 'Ignored'
 *        against an item, with no price change (used by the Stats tab's pricing actions)
 *   POST {action:'clearItemActions', itemId} -> removes all logged actions for one item
 *   POST {action:'setListingLink', itemId, platform, listingId, url, status, listPrice} ->
 *        upserts a Platform Posting Queue row by Listing ID (e.g. "CLO-027-EBAY") with the
 *        live URL/status/today's date — used to record a listing as actually posted
 *   POST {action:'setListingStatus', itemId, sourceTab, status} -> writes Status back into
 *        the source tab (same row-lookup as markSold), e.g. "Photograph" -> "Listed"
 *
 *   GET  ?action=stocking      -> [{stockingId, itemId, stage, created, updated, product, brand,
 *                                   model, version, notes, sourceTab, analysisSummary, error,
 *                                   rawEntry}]
 *   GET  ?action=listingQuestions&itemId=CLO-001 -> questions rows for one item (or all if omitted)
 *   POST {action:'addStockingPaste', text} -> parks pasted text as a Stocking row (stage pasted).
 *        Nothing is parsed or sent anywhere: it waits until someone processes it.
 *   POST {action:'createStocking', product, brand, model, version, notes, category, clothingType,
 *        size, condition, platforms, listPrice, estValue, floorPrice, isClothing, addIntakeRow,
 *        pastedId} -> creates inventory row (Status=Identify) + Listing Hub formulas + Stocking row
 *        (stage needs_analysis) + optional Adding to Selling Inventory row + Item Action log.
 *        With pastedId, the parked paste row becomes the Stocking row instead of a new one.
 *   POST {action:'updateStocking', stockingId|itemId, stage, product, brand, model, version, notes,
 *        analysisSummary, error, answers:[{row|question, answer}]} -> updates Stocking + optional
 *        Listing Questions answers
 *   POST {action:'deleteStocking', stockingId} -> removes one Stocking row (used to bin a paste)
 *   POST {action:'upsertDescription', itemId, platform, listingId, suggestedTitle, description,
 *        listPrice, floorPrice, listingStatus, ...} -> upsert Listing Descriptions by Item ID + Platform
 *   POST {action:'upsertQueue', itemId, platform, listingId, status, suggestedTitle, listPrice, ...}
 *        -> upsert Platform Posting Queue (same shape as setListingLink, status defaults Draft)
 *   POST {action:'createInventoryItem', ...} -> shared helper used by createStocking
 *
 * Poshmark's side of market data (Acquire Watchlist comps + Market Trends tab)
 * refreshes itself daily via a time trigger — run setupMarketDataTrigger() once
 * from this editor's Run menu to turn it on. eBay's side is NOT automatic (eBay
 * blocks server-side requests) — it's pushed in manually via the two POST
 * actions above, using a live logged-in browser session. See the "Market data"
 * section below for the full explanation.
 */

var LISTING_HUB_SHEET = 'Listing Hub';
var DESCRIPTIONS_SHEET = 'Listing Descriptions';
var POSTING_QUEUE_SHEET = 'Platform Posting Queue';
var METRICS_SHEET_NAME = 'Metrics';
var ACQUIRE_SHEET_NAME = 'Acquire Watchlist';
var PHOTOS_SHEET_NAME = 'Photos';
var ITEM_ACTIONS_SHEET_NAME = 'Item Actions';

function doGet(e) {
  var action = e.parameter.action;
  if (action === 'inventory') return jsonOut(getInventory());
  if (action === 'descriptions') return jsonOut(getDescriptions());
  if (action === 'postingQueue') return jsonOut(getPostingQueue());
  if (action === 'metrics') return jsonOut(getMetrics());
  if (action === 'acquire') return jsonOut(getAcquire());
  if (action === 'photos') return jsonOut(getPhotos());
  if (action === 'trends') return jsonOut(getTrends());
  if (action === 'marketHistory') return jsonOut(getMarketHistory());
  if (action === 'sourcingIntel') return jsonOut(getSourcingIntel());
  if (action === 'acquireBundle') return jsonOut(getAcquireBundle());
  if (action === 'salesBundle') return jsonOut(getSalesBundle());
  if (action === 'bootBundle') return jsonOut(getBootBundle());
  if (action === 'localDeals') return jsonOut(getLocalDeals());
  if (action === 'platformTrends') return jsonOut(getPlatformTrends());
  if (action === 'savedItems') return jsonOut(getSavedItems());
  if (action === 'itemActions') return jsonOut(getItemActions());
  if (action === 'debugHeaders') return jsonOut(debugHeaders());
  if (action === 'debugFormulas') return jsonOut(debugFormulas(e.parameter.sheet, Number(e.parameter.start) || 1, Number(e.parameter.n) || 5));
  if (action === 'debugRows') return jsonOut(debugRows(e.parameter.sheet, Number(e.parameter.start) || 1, Number(e.parameter.n) || 20));
  if (action === 'ebayAuthCheck') return jsonOut(ebayAuthCheck());
  if (action === 'ebayExchangeCode') return jsonOut(ebayExchangeCode());
  if (action === 'stocking') return jsonOut(getStocking());
  if (action === 'listingQuestions') return jsonOut(getListingQuestions(e.parameter.itemId));
  if (action === 'syncEbayMetrics') {
    var syncResult = syncEbayMetrics();
    return jsonOut({ sync: syncResult, metrics: getMetrics() });
  }
  return jsonOut({ error: 'unknown action' });
}

// Emergency restore helper — writes an exact row of values back verbatim.
// Used once to undo an accidental overwrite from an appendRow bug; not part
// of normal operation.
function debugRestoreRow(sheetName, rowNum, values) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return { ok: false, error: 'not found' };
  sheet.getRange(rowNum, 1, 1, values.length).setValues([values]);
  return { ok: true };
}

// Read-only: formulas (not values) for a row range, to see how a tab is built
// before writing row-level changes to it.
function debugFormulas(sheetName, startRow, n) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return { error: 'not found' };
  var lastCol = sheet.getLastColumn();
  var range = sheet.getRange(startRow, 1, n, lastCol);
  return { formulas: range.getFormulas(), lastRow: sheet.getLastRow(), lastCol: lastCol, frozen: sheet.getFrozenRows() };
}

// Dumps a raw row range (1-indexed, sheet row numbers) from any named sheet
// for inspection — same temporary-debug spirit as debugHeaders above.
function debugRows(sheetName, startRow, n) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return { error: 'not found' };
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var endRow = Math.min(lastRow, startRow + n - 1);
  if (startRow > lastRow) return { rows: [], lastRow: lastRow };
  var vals = sheet.getRange(startRow, 1, endRow - startRow + 1, lastCol).getValues();
  return { rows: vals, lastRow: lastRow };
}

// Temporary inspection helper — dumps the header row (and first data row)
// of every sheet that matters for the link/status backfill work, so we're
// not guessing at real column names before writing to them.
function debugHeaders() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var names = ['Clothing Sell Inventory', 'Non Clothing Sell Inventory', 'Listing Hub', 'Platform Posting Queue'];
  var out = {};
  names.forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) { out[name] = { error: 'not found' }; return; }
    var header = findHeaderRow(sheet, ['Status', 'Item ID', 'Listing ID']);
    var headerRowIndex = header ? header.rowIndex : 0;
    var lastCol = sheet.getLastColumn();
    var headerRowVals = sheet.getRange(headerRowIndex + 1, 1, 1, lastCol).getValues()[0];
    var firstDataRow = sheet.getLastRow() > headerRowIndex + 1
      ? sheet.getRange(headerRowIndex + 2, 1, 1, lastCol).getValues()[0]
      : [];
    out[name] = { headerRowIndex: headerRowIndex, headers: headerRowVals, firstDataRow: firstDataRow, lastRow: sheet.getLastRow(), lastCol: lastCol };
  });
  return out;
}

function doPost(e) {
  var body = JSON.parse(e.postData.contents);
  var action = body.action;

  if (action === 'addMetricEntry') return jsonOut(addMetricEntry(body));
  if (action === 'addMetricEntries') return jsonOut(addMetricEntries(body));
  if (action === 'setLocalDeal') return jsonOut(setLocalDeal(body));
  if (action === 'setPlatformTrends') return jsonOut(setPlatformTrends(body));
  if (action === 'addAcquireItem') return jsonOut(addAcquireItem(body));
  if (action === 'updateAcquireItem') return jsonOut(updateAcquireItem(body));
  if (action === 'deleteAcquireItem') return jsonOut(deleteAcquireItem(body.id));
  if (action === 'markSold') return jsonOut(markSold(body));
  if (action === 'setPhoto') return jsonOut(setPhoto(body));
  if (action === 'setAcquireEbayData') return jsonOut(setAcquireEbayData(body));
  if (action === 'setTrendEbayData') return jsonOut(setTrendEbayData(body));
  if (action === 'setMarketObservations') return jsonOut(setMarketObservations(body));
  if (action === 'upsertSourcingIntel') return jsonOut(upsertSourcingIntel(body));
  if (action === 'upsertSales') return jsonOut(upsertSales(body));
  if (action === 'setBalances') return jsonOut(setBalances(body));
  if (action === 'removeItem') return jsonOut(removeItem(body));
  if (action === 'restoreItem') return jsonOut(restoreItem(body));
  if (action === 'runMaintenance') return jsonOut(runMaintenance(body.task));
  if (action === 'debugPoshmark') return jsonOut(debugPoshmark(body.query));
  if (action === 'dropListingPrice') return jsonOut(dropListingPrice(body));
  if (action === 'logItemAction') return jsonOut(logItemAction(body.itemId, body.itemAction, body.detail));
  if (action === 'clearItemActions') return jsonOut(clearItemActions(body.itemId));
  if (action === 'setListingLink') return jsonOut(setListingLink(body));
  if (action === 'setListingStatus') return jsonOut(setListingStatus(body));
  if (action === 'setDescription') return jsonOut(setDescription(body));
  if (action === 'cancelSale') return jsonOut(cancelSale(body));
  if (action === 'updateItem') return jsonOut(updateItem(body));
  if (action === 'setQueueStatus') return jsonOut(setQueueStatus(body));
  if (action === 'debugRestoreRow') return jsonOut(debugRestoreRow(body.sheet, body.row, body.values));
  if (action === 'addStockingPaste') return jsonOut(addStockingPaste(body));
  if (action === 'createStocking') return jsonOut(createStocking(body));
  if (action === 'deleteStocking') return jsonOut(deleteStocking(body));
  if (action === 'updateStocking') return jsonOut(updateStocking(body));
  if (action === 'upsertDescription') return jsonOut(upsertDescription(body));
  if (action === 'upsertQueue') return jsonOut(upsertQueue(body));
  if (action === 'createInventoryItem') return jsonOut(createInventoryItem(body));
  if (action === 'saveListingAnswers') return jsonOut(saveListingAnswers(body));
  if (action === 'syncEbayMetrics') return jsonOut(syncEbayMetrics());

  return jsonOut({ error: 'unknown action' });
}

// Records a newly-live listing's URL against Platform Posting Queue —
// updates the row if one already exists for this Listing ID (e.g. a Draft
// row from planning), otherwise appends a new one. Existing rows in this
// sheet have gaps between them (spacing, not reserved slots for a specific
// item/platform), so we never guess-fill a blank row by position.
function setListingLink(body) {
  var itemId = body.itemId;
  var platform = body.platform;
  var listingId = body.listingId;
  var url = body.url;
  if (!itemId || !platform || !listingId || !url) {
    return { ok: false, error: 'Missing itemId, platform, listingId, or url.' };
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(POSTING_QUEUE_SHEET);
  if (!sheet) return { ok: false, error: 'Could not find "' + POSTING_QUEUE_SHEET + '" tab.' };
  var header = findHeaderRow(sheet, ['Listing ID']);
  if (!header) return { ok: false, error: 'Could not find a header row in ' + POSTING_QUEUE_SHEET + '.' };
  var colMap = header.colMap;
  var listingIdCol = colIndex(colMap, 'Listing ID');
  if (listingIdCol === -1) return { ok: false, error: 'Could not find a "Listing ID" column.' };

  var startRow = header.rowIndex + 2;
  var lastRow = sheet.getLastRow();
  var numCols = sheet.getLastColumn();
  var targetRow = -1;
  var trueLastContentRow = header.rowIndex + 1; // fallback: just the header
  if (lastRow >= startRow) {
    var idsRange = sheet.getRange(startRow, 1, lastRow - startRow + 1, numCols).getValues();
    for (var i = 0; i < idsRange.length; i++) {
      var rowIsBlank = idsRange[i].every(function (c) { return c === '' || c === null; });
      if (!rowIsBlank) trueLastContentRow = startRow + i;
      if (String(idsRange[i][listingIdCol] || '') === listingId) targetRow = startRow + i;
    }
  }
  // Never rely on appendRow here — on this Table-formatted sheet it can land
  // on an already-occupied row instead of past the real last content (this
  // overwrote MISC-022's row once; fixed by writing explicitly past the
  // last row that actually has any content, found above by scanning).
  if (targetRow === -1) targetRow = trueLastContentRow + 1;

  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var itemIdCol = colIndex(colMap, 'Item ID');
  var platformCol = colIndex(colMap, 'Platform');
  var statusCol = colIndex(colMap, 'Status');
  var urlCol = colIndex(colMap, 'Listing URL');
  var datePostedCol = colIndex(colMap, 'Date posted');
  var listPriceCol = colIndex(colMap, 'List price');
  var titleCol = colIndex(colMap, 'Suggested title');

  sheet.getRange(targetRow, listingIdCol + 1).setValue(listingId);
  if (itemIdCol !== -1) sheet.getRange(targetRow, itemIdCol + 1).setValue(itemId);
  if (platformCol !== -1) sheet.getRange(targetRow, platformCol + 1).setValue(platform);
  if (statusCol !== -1) sheet.getRange(targetRow, statusCol + 1).setValue(body.status || 'Active');
  if (urlCol !== -1) sheet.getRange(targetRow, urlCol + 1).setValue(url);
  // body.datePosted keeps a restored row's original date instead of stamping today.
  if (datePostedCol !== -1) sheet.getRange(targetRow, datePostedCol + 1).setValue(body.datePosted || today);
  if (body.listPrice && listPriceCol !== -1) sheet.getRange(targetRow, listPriceCol + 1).setValue(Number(body.listPrice));
  if (body.title && titleCol !== -1) sheet.getRange(targetRow, titleCol + 1).setValue(body.title);

  invalidateBootCache();
  return { ok: true, row: targetRow, updatedExisting: targetRow <= trueLastContentRow };
}

// Flips one Platform Posting Queue row's Status — e.g. to "Ended" when the
// item sold somewhere else and that listing came down. Matched by Listing ID,
// or by Item ID + Platform when the site doesn't know the Listing ID.
function setQueueStatus(body) {
  var status = body.status;
  if (!status || (!body.listingId && !(body.itemId && body.platform))) {
    return { ok: false, error: 'Missing status, and listingId or itemId+platform.' };
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(POSTING_QUEUE_SHEET);
  if (!sheet) return { ok: false, error: 'Could not find "' + POSTING_QUEUE_SHEET + '" tab.' };
  var header = findHeaderRow(sheet, ['Listing ID']);
  if (!header) return { ok: false, error: 'Could not find a header row in ' + POSTING_QUEUE_SHEET + '.' };
  var colMap = header.colMap;
  var statusCol = colIndex(colMap, 'Status');
  if (statusCol === -1) return { ok: false, error: 'Could not find a "Status" column in ' + POSTING_QUEUE_SHEET + '.' };
  var listingIdCol = colIndex(colMap, 'Listing ID');
  var itemIdCol = colIndex(colMap, 'Item ID');
  var platformCol = colIndex(colMap, 'Platform');

  var startRow = header.rowIndex + 2;
  var lastRow = sheet.getLastRow();
  if (lastRow < startRow) return { ok: false, error: 'No rows in ' + POSTING_QUEUE_SHEET + ' yet.' };
  var values = sheet.getRange(startRow, 1, lastRow - startRow + 1, sheet.getLastColumn()).getValues();
  var wantPlatform = String(body.platform || '').trim().toLowerCase();
  var updated = 0;
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var match = body.listingId
      ? (listingIdCol !== -1 && String(row[listingIdCol] || '') === String(body.listingId))
      : (itemIdCol !== -1 && platformCol !== -1 &&
         String(row[itemIdCol] || '') === String(body.itemId) &&
         String(row[platformCol] || '').trim().toLowerCase() === wantPlatform);
    if (match) { sheet.getRange(startRow + i, statusCol + 1).setValue(status); updated++; }
  }
  invalidateBootCache();
  return { ok: true, updated: updated };
}

// Generic status-only writer for the source tabs — same row-lookup as
// markSold/dropListingPrice, but just flips Status (e.g. "Photograph" ->
// "Listed") without touching price or sold fields.
function setListingStatus(body) {
  var itemId = body.itemId;
  var sourceTabName = body.sourceTab;
  var status = body.status;
  if (!itemId || !sourceTabName || !status) return { ok: false, error: 'Missing itemId, sourceTab, or status.' };

  var located = findSourceRow(itemId, sourceTabName);
  if (located.error) return { ok: false, error: located.error };
  var sourceSheet = located.sourceSheet, row = located.row;

  var srcHeader = findHeaderRow(sourceSheet, ['Status']);
  if (!srcHeader) return { ok: false, error: 'Could not find a "Status" column header in ' + sourceTabName + '.' };
  var statusCol = colIndex(srcHeader.colMap, 'Status');
  if (statusCol === -1) return { ok: false, error: 'Could not find a "Status" column in ' + sourceTabName + '.' };

  sourceSheet.getRange(row, statusCol + 1).setValue(status);
  invalidateBootCache();
  return { ok: true };
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
    if (header) {
      header.sheet = srcSheet;
      // One sheet read per source tab (not per inventory row) — inventory alone
      // used to be ~78 getRange round trips and ~15s; getDataRange once is enough.
      header.allValues = srcSheet.getDataRange().getValues();
    }
    cache[sourceTabName] = header;
  }
  if (!header) return empty;

  var rowIdx = Number(sourceRowNum) - 1; // sheet row N -> 0-based index
  if (isNaN(rowIdx) || rowIdx < 0 || rowIdx >= header.allValues.length) return empty;
  var rowVals = header.allValues[rowIdx];
  if (!rowVals) return empty;
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

// Overwrites the Description (and optionally Suggested title) for one
// (itemId, platform) row in Listing Descriptions — matched by exact Item ID
// and case-insensitive Platform text. Used to strip seller-facing to-do
// notes ("confirm measurements before posting") that leaked into what's
// supposed to be customer-facing copy.
function setDescription(body) {
  var itemId = body.itemId;
  var platform = String(body.platform || '').trim().toLowerCase();
  var description = body.description;
  if (!itemId || !platform || description == null) {
    return { ok: false, error: 'Missing itemId, platform, or description.' };
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DESCRIPTIONS_SHEET);
  if (!sheet) return { ok: false, error: 'Could not find "' + DESCRIPTIONS_SHEET + '" tab.' };
  var t = readTable(sheet, ['Suggested title', 'Platform']);
  var descCol = colIndex(t.colMap, 'Description');
  var titleCol = colIndex(t.colMap, 'Suggested title');
  if (descCol === -1) return { ok: false, error: 'Could not find a "Description" column in ' + DESCRIPTIONS_SHEET + '.' };

  var startRow = t.headerSheetRow + 1;
  var updated = 0;
  for (var i = 0; i < t.rows.length; i++) {
    var row = t.rows[i];
    var rowItemId = String(val(row, t.colMap, 'Item ID') || '');
    var rowPlatform = String(val(row, t.colMap, 'Platform') || '').trim().toLowerCase();
    if (rowItemId === String(itemId) && rowPlatform === platform) {
      var sheetRow = startRow + i;
      sheet.getRange(sheetRow, descCol + 1).setValue(description);
      if (body.title && titleCol !== -1) sheet.getRange(sheetRow, titleCol + 1).setValue(body.title);
      updated++;
    }
  }
  invalidateBootCache();
  return { ok: true, updated: updated };
}

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
      status: val(row, t.colMap, 'Status'),
      listingUrl: val(row, t.colMap, 'Listing URL'),
      datePosted: formatDate(val(row, t.colMap, 'Date posted')),
    });
  });
  return out;
}

// ---------------------------------------------------------------------
// Metrics — new tab, auto-created. Rows come from the site's manual
// "Log a stat update" form (source:'manual') and, once configured, the
// optional eBay auto-sync below (source:'ebay-api').
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
  invalidateBootCache();
  return { ok: true, date: date };
}

// ---------------------------------------------------------------------
// Acquire Watchlist — new tab, auto-created. Full CRUD from the site.
// ---------------------------------------------------------------------

// Columns after Image URL were added for the Hunt List; older rows simply
// have them blank. Apparel fields (Size, Color) stay but are optional now.
var ACQUIRE_HEADERS = [
  'ID', 'Brand', 'Item Type', 'Size', 'Color', 'Condition', 'Target Price', 'Best Platform', 'Priority', 'Notes', 'Date Added',
  'eBay Avg Price', 'eBay Sales Found', 'Poshmark Avg Price', 'Poshmark Sales Found', 'Last Checked',
  'eBay Sell-Through %', 'Image URL',
  'Category', 'Subcategory', 'Model', 'Target Variant', 'Desired Profit', 'Where To Find', 'Inspection Notes',
  'Opportunity ID',
];

// Hunt List fields as the site sends them -> sheet header.
var ACQUIRE_FIELD_HEADERS = {
  brand: 'Brand', itemType: 'Item Type', size: 'Size', color: 'Color', condition: 'Condition',
  targetPrice: 'Target Price', bestPlatform: 'Best Platform', priority: 'Priority', notes: 'Notes',
  category: 'Category', subcategory: 'Subcategory', model: 'Model', targetVariant: 'Target Variant',
  desiredProfit: 'Desired Profit', whereToFind: 'Where To Find', inspectionNotes: 'Inspection Notes',
  opportunityId: 'Opportunity ID',
};

// Poshmark only has meaningful sold comps for fashion, so a Hunt List entry for
// a camcorder or a drill doesn't get a (misleading) Poshmark lookup.
var FASHION_CATEGORIES = ['fashion', 'outerwear', 'shirts', 'pants', 'shoes', 'bags', 'accessories', 'designer', 'vintage clothing'];
function isFashionCategory(category, subcategory) {
  var c = String(category || '').trim().toLowerCase();
  var sub = String(subcategory || '').trim().toLowerCase();
  if (!c && !sub) return true; // entries from before categories existed were all apparel
  return FASHION_CATEGORIES.indexOf(c) !== -1 || FASHION_CATEGORIES.indexOf(sub) !== -1;
}

function getAcquireSheet() {
  return getOrCreateSheet(ACQUIRE_SHEET_NAME, ACQUIRE_HEADERS);
}

function getAcquire() {
  return readRecords(getAcquireSheet()).filter(function (r) { return r['ID']; }).map(function (r) {
    return {
      id: r['ID'],
      brand: r['Brand'],
      itemType: r['Item Type'],
      size: r['Size'],
      color: r['Color'],
      condition: r['Condition'],
      targetPrice: r['Target Price'],
      bestPlatform: r['Best Platform'],
      priority: r['Priority'],
      notes: r['Notes'],
      dateAdded: r['Date Added'],
      ebayAvgPrice: r['eBay Avg Price'] || '',
      ebaySalesFound: r['eBay Sales Found'] || '',
      poshmarkAvgPrice: r['Poshmark Avg Price'] || '',
      poshmarkSalesFound: r['Poshmark Sales Found'] || '',
      lastChecked: r['Last Checked'] || '',
      ebaySellThrough: r['eBay Sell-Through %'] || '',
      imageUrl: r['Image URL'] || '',
      category: r['Category'] || '',
      subcategory: r['Subcategory'] || '',
      model: r['Model'] || '',
      targetVariant: r['Target Variant'] || '',
      desiredProfit: r['Desired Profit'] || '',
      whereToFind: r['Where To Find'] || '',
      inspectionNotes: r['Inspection Notes'] || '',
      opportunityId: r['Opportunity ID'] || '',
    };
  });
}

// Builds a sheet record from a Hunt List payload. Fields the payload doesn't
// carry are left out, so an older client can't blank the newer columns.
function acquireRecordFrom(body) {
  var rec = {};
  Object.keys(ACQUIRE_FIELD_HEADERS).forEach(function (k) {
    if (Object.prototype.hasOwnProperty.call(body, k)) rec[ACQUIRE_FIELD_HEADERS[k]] = body[k] === null ? '' : body[k];
  });
  return rec;
}

// Looks up a Poshmark comp + a real reference photo for this row right away
// (instead of waiting for tomorrow's automatic refresh) and writes both in,
// so a newly added/edited watchlist card isn't blank until the next day.
function refreshAcquireRow(sheet, row, brand, itemType, size, color) {
  var query = [brand, itemType, size, color].filter(String).join(' ').trim();
  if (!query) return null;
  var poshResult = searchPoshmarkSold(query);
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  sheet.getRange(row, 14, 1, 2).setValues([[poshResult.avgPrice || '', poshResult.count || '']]);
  sheet.getRange(row, 16).setValue(today);
  if (poshResult.imageUrl) sheet.getRange(row, 18).setValue(poshResult.imageUrl);
  return {
    poshmarkAvgPrice: poshResult.avgPrice || '', poshmarkSalesFound: poshResult.count || '',
    lastChecked: today, imageUrl: poshResult.imageUrl || '',
  };
}

function findAcquireRowNumber(sheet, id) {
  var ids = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues() : [];
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return -1;
}

function addAcquireItem(body) {
  var sheet = getAcquireSheet();
  var id = 'acq-' + new Date().getTime();
  var dateAdded = todayIso();
  var rec = acquireRecordFrom(body);
  rec['ID'] = id;
  rec['Date Added'] = dateAdded;
  if (!rec['Priority']) rec['Priority'] = 'Medium';
  upsertRecords(sheet, ACQUIRE_HEADERS, [rec], function (get) { return String(get('ID') || ''); });
  var out = { id: id, dateAdded: dateAdded };
  if (isFashionCategory(body.category, body.subcategory)) {
    var refreshed = refreshAcquireRow(sheet, findAcquireRowNumber(sheet, id), body.brand, body.itemType, body.size, body.color);
    if (refreshed) for (var k in refreshed) out[k] = refreshed[k];
  }
  return out;
}

function updateAcquireItem(body) {
  var sheet = getAcquireSheet();
  var row = findAcquireRowNumber(sheet, body.id);
  if (row === -1) return { ok: false };
  var rec = acquireRecordFrom(body);
  rec['ID'] = body.id;
  if (Object.prototype.hasOwnProperty.call(rec, 'Priority') && !rec['Priority']) rec['Priority'] = 'Medium';
  upsertRecords(sheet, ACQUIRE_HEADERS, [rec], function (get) { return String(get('ID') || ''); });
  var out = { ok: true };
  if (isFashionCategory(body.category, body.subcategory)) {
    var refreshed = refreshAcquireRow(sheet, row, body.brand, body.itemType, body.size, body.color);
    if (refreshed) for (var k in refreshed) out[k] = refreshed[k];
  }
  return out;
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

// Shared by markSold/dropListingPrice: Listing Hub's row-number column
// (positional, no header text of its own — sits right after "Source tab")
// points back at the real row in whichever source tab this item lives in.
// Returns { sourceSheet, row } on success or { error } on failure.
function findSourceRow(itemId, sourceTabName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hubSheet = ss.getSheetByName(LISTING_HUB_SHEET);
  var sourceSheet = ss.getSheetByName(sourceTabName);
  if (!hubSheet || !sourceSheet) return { error: 'Could not find the Listing Hub or "' + sourceTabName + '" tab.' };

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
      error: 'Could not locate the source row for ' + itemId + ' — expected a row-number column immediately ' +
        'after "Source tab" in Listing Hub. Update findSourceRow() (Code.gs) if your columns are laid out differently, then redeploy.',
    };
  }
  return { sourceSheet: sourceSheet, row: Number(sourceRowNum) };
}

function markSold(body) {
  var itemId = body.itemId;
  var sourceTabName = body.sourceTab;
  if (!itemId || !sourceTabName) return { ok: false, error: 'Missing itemId or sourceTab.' };

  var located = findSourceRow(itemId, sourceTabName);
  if (located.error) return { ok: false, error: located.error };
  var sourceSheet = located.sourceSheet, row = located.row;

  var srcHeader = findHeaderRow(sourceSheet, ['Status']);
  if (!srcHeader) return { ok: false, error: 'Could not find a "Status" column header in ' + sourceTabName + '.' };

  var statusCol = colIndex(srcHeader.colMap, 'Status');
  var soldPriceCol = colIndex(srcHeader.colMap, 'Sold price');
  var buyerCol = colIndex(srcHeader.colMap, 'Buyer');

  if (statusCol !== -1) sourceSheet.getRange(row, statusCol + 1).setValue('Sold');
  if (soldPriceCol !== -1) sourceSheet.getRange(row, soldPriceCol + 1).setValue(body.soldPrice || '');
  if (buyerCol !== -1 && body.buyer) sourceSheet.getRange(row, buyerCol + 1).setValue(body.buyer);
  var netCashCol = colIndex(srcHeader.colMap, 'Net cash');
  if (netCashCol !== -1 && body.netCash !== undefined && body.netCash !== '') sourceSheet.getRange(row, netCashCol + 1).setValue(Number(body.netCash));

  // Where it sold goes to the Sales sheet, so Stats can total each site.
  if (body.platform) {
    upsertSales({ rows: [{
      itemId: itemId, platform: body.platform, salePrice: body.soldPrice,
      netCash: body.netCash === undefined ? '' : body.netCash, dateSold: body.dateSold || todayIso(),
      source: 'Marked sold on site',
    }] });
  }
  invalidateBootCache();
  return { ok: true };
}

// Reverses markSold — a buyer-cancelled order, not just an unshipped one.
// Clears Sold price/Buyer/Net cash and writes Status back (defaults to
// "Listed" since the item is available again).
function cancelSale(body) {
  var itemId = body.itemId;
  var sourceTabName = body.sourceTab;
  if (!itemId || !sourceTabName) return { ok: false, error: 'Missing itemId or sourceTab.' };

  var located = findSourceRow(itemId, sourceTabName);
  if (located.error) return { ok: false, error: located.error };
  var sourceSheet = located.sourceSheet, row = located.row;

  var srcHeader = findHeaderRow(sourceSheet, ['Status']);
  if (!srcHeader) return { ok: false, error: 'Could not find a "Status" column header in ' + sourceTabName + '.' };

  var statusCol = colIndex(srcHeader.colMap, 'Status');
  var soldPriceCol = colIndex(srcHeader.colMap, 'Sold price');
  var buyerCol = colIndex(srcHeader.colMap, 'Buyer');
  var netCashCol = colIndex(srcHeader.colMap, 'Net cash');

  if (statusCol !== -1) sourceSheet.getRange(row, statusCol + 1).setValue(body.status || 'Listed');
  if (soldPriceCol !== -1) sourceSheet.getRange(row, soldPriceCol + 1).setValue('');
  if (buyerCol !== -1) sourceSheet.getRange(row, buyerCol + 1).setValue('');
  if (netCashCol !== -1) sourceSheet.getRange(row, netCashCol + 1).setValue('');

  invalidateBootCache();
  return { ok: true };
}

// Writes a real price change back into the source tab (same row-lookup as
// markSold) and logs it to Item Actions, so acting on a pricing-action
// recommendation actually updates the price everywhere the site reads it
// from — not just a note that you meant to.
function dropListingPrice(body) {
  var itemId = body.itemId;
  var sourceTabName = body.sourceTab;
  var newPrice = body.newPrice;
  if (!itemId || !sourceTabName || !newPrice) return { ok: false, error: 'Missing itemId, sourceTab, or newPrice.' };

  var located = findSourceRow(itemId, sourceTabName);
  if (located.error) return { ok: false, error: located.error };
  var sourceSheet = located.sourceSheet, row = located.row;

  var srcHeader = findHeaderRow(sourceSheet, ['List price']);
  if (!srcHeader) return { ok: false, error: 'Could not find a "List price" column header in ' + sourceTabName + '.' };
  var listPriceCol = colIndex(srcHeader.colMap, 'List price');
  if (listPriceCol === -1) return { ok: false, error: 'Could not find a "List price" column in ' + sourceTabName + '.' };

  // Captured before overwriting so the log (and the site's "was $X now $Y"
  // display) can show the actual before/after, not just the new number.
  var oldPrice = sourceSheet.getRange(row, listPriceCol + 1).getValue();
  sourceSheet.getRange(row, listPriceCol + 1).setValue(Number(newPrice));
  var detail = (oldPrice !== '' && oldPrice != null && !isNaN(oldPrice) && Number(oldPrice) !== Number(newPrice))
    ? (Number(oldPrice) + '->' + Number(newPrice))
    : String(newPrice);
  var logged = logItemAction(itemId, 'Price Drop', detail);
  invalidateBootCache();
  return { ok: true, date: logged.date };
}

// Saves the Actions-tab item editor. Only keys present in the body are
// written (a blank price clears the cell), and each change is logged to
// Item Actions; the logged rows are returned so the site can mirror them.
// Listing Hub carries a couple of fields the source tabs don't — Brand exists
// on Clothing Sell Inventory but not on Non Clothing, for instance — so an edit
// to one of those writes the hub row itself instead of failing.
function findHubRow(itemId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hubSheet = ss.getSheetByName(LISTING_HUB_SHEET);
  if (!hubSheet) return { error: 'Could not find the Listing Hub tab.' };
  var t = readTable(hubSheet, ['Item ID']);
  for (var i = 0; i < t.rows.length; i++) {
    if (String(val(t.rows[i], t.colMap, 'Item ID')) === String(itemId)) {
      return { sheet: hubSheet, row: t.headerSheetRow + 1 + i, colMap: t.colMap };
    }
  }
  return { error: 'Could not find ' + itemId + ' in Listing Hub.' };
}

function updateItem(body) {
  var itemId = body.itemId;
  var sourceTabName = body.sourceTab;
  if (!itemId || !sourceTabName) return { ok: false, error: 'Missing itemId or sourceTab.' };

  var fields = [
    { key: 'listPrice', column: 'List price', numeric: true },
    { key: 'floorPrice', column: 'Floor price', numeric: true },
    { key: 'platform', column: 'Platform', numeric: false },
    { key: 'brand', column: 'Brand', numeric: false },
    { key: 'item', column: 'Item', numeric: false },
  ].filter(function (f) { return Object.prototype.hasOwnProperty.call(body, f.key); });

  var logged = [];
  function log(action, detail) {
    var res = logItemAction(itemId, action, detail);
    logged.push({ date: res.date, itemId: itemId, action: action, detail: detail });
  }

  if (fields.length) {
    var located = findSourceRow(itemId, sourceTabName);
    if (located.error) return { ok: false, error: located.error };
    var sheet = located.sourceSheet, row = located.row;
    var header = findHeaderRow(sheet, ['List price']);
    if (!header) return { ok: false, error: 'Could not find the header row in ' + sourceTabName + '.' };

    // Validate everything before writing anything, so a bad value or a
    // missing column can't leave the row half-edited.
    var hub = null;
    for (var i = 0; i < fields.length; i++) {
      var field = fields[i];
      field.col = colIndex(header.colMap, field.column);
      if (field.col === -1) {
        if (!hub) hub = findHubRow(itemId);
        if (hub.error) return { ok: false, error: hub.error };
        var hubCol = colIndex(hub.colMap, field.column);
        if (hubCol === -1) {
          return { ok: false, error: 'Could not find a "' + field.column + '" column in ' + sourceTabName + ' or Listing Hub.' };
        }
        // A formula there is pulling the value from somewhere else — overwriting
        // it with a literal would quietly break that link.
        if (String(hub.sheet.getRange(hub.row, hubCol + 1).getFormula() || '')) {
          return { ok: false, error: '"' + field.column + '" is a formula in Listing Hub for ' + itemId + ' — change it at the source instead.' };
        }
        field.sheet = hub.sheet;
        field.row = hub.row;
        field.col = hubCol;
      }
      var raw = body[field.key];
      field.value = field.numeric ? (raw === '' || raw === null ? '' : Number(raw)) : String(raw || '');
      if (field.numeric && field.value !== '' && (isNaN(field.value) || field.value < 0)) {
        return { ok: false, error: field.column + ' must be a positive number or blank.' };
      }
    }

    fields.forEach(function (f) {
      var cell = (f.sheet || sheet).getRange(f.row || row, f.col + 1);
      var oldVal = cell.getValue();
      cell.setValue(f.value);
      var oldTxt = oldVal === '' || oldVal === null ? 'none' : String(oldVal);
      var newTxt = f.value === '' ? 'none' : String(f.value);
      if (f.key === 'listPrice') {
        // Same "old->new" Price Drop format dropListingPrice logs, so a lower
        // price saved here marks the pricing suggestion as handled.
        if (f.value !== '' && oldVal !== '' && !isNaN(oldVal) && f.value < Number(oldVal)) log('Price Drop', Number(oldVal) + '->' + f.value);
        else log('Price Edit', oldTxt + ' -> ' + newTxt);
      } else if (f.key === 'floorPrice') {
        log('Floor Edit', oldTxt + ' -> ' + newTxt);
      } else if (f.key === 'platform') {
        log('Platforms Updated', oldTxt + ' -> ' + newTxt);
      } else {
        log('Renamed', f.column + ': ' + oldTxt + ' -> ' + newTxt);
      }
    });
  }
  if (body.nextAction) log('Action Set', String(body.nextAction));
  if (body.reopen) log('Reopened', 'Action changed');

  // Listing Hub mostly mirrors the source tabs by formula, but some of its cells
  // were typed in (Platforms on a few rows), and the site reads the hub — so an
  // edit saved only to the source tab never showed up. Bring a typed-in hub cell
  // along; formula cells already follow the source and are left alone.
  var hubSynced = [];
  if (fields.length) {
    var hubRow = findHubRow(itemId);
    if (!hubRow.error) {
      fields.forEach(function (f) {
        if (f.sheet) return; // this field was already written to the hub itself
        var hubCol = colIndex(hubRow.colMap, f.column);
        if (hubCol === -1) return;
        var cell = hubRow.sheet.getRange(hubRow.row, hubCol + 1);
        if (String(cell.getFormula() || '')) return;
        if (String(cell.getValue()) === String(f.value)) return;
        cell.setValue(f.value);
        hubSynced.push(f.column);
      });
    }
  }
  invalidateBootCache();
  return { ok: true, logged: logged, hubSynced: hubSynced };
}

function getItemActionsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(ITEM_ACTIONS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(ITEM_ACTIONS_SHEET_NAME);
    sheet.appendRow(['Date', 'Item ID', 'Action', 'Detail']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Logs a non-price action taken on a pricing recommendation — 'Offer Sent'
// (detail = platform) or 'Ignored' (detail = the recommendation label that
// was dismissed, so the site knows what to keep suppressing). Price drops
// log through here too, via dropListingPrice above.
function logItemAction(itemId, action, detail) {
  if (!itemId || !action) return { ok: false, error: 'Missing itemId or action.' };
  var sheet = getItemActionsSheet();
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  sheet.appendRow([today, itemId, action, detail || '']);
  invalidateBootCache();
  return { ok: true, date: today };
}

// Removes all logged actions for one item — for correcting a mis-click
// (wrong item, fat-fingered price) rather than living with a bad log entry.
function clearItemActions(itemId) {
  if (!itemId) return { ok: false, error: 'Missing itemId.' };
  var sheet = getItemActionsSheet();
  var data = sheet.getDataRange().getValues();
  var removed = 0;
  for (var r = data.length - 1; r >= 1; r--) {
    if (String(data[r][1]) === String(itemId)) { sheet.deleteRow(r + 1); removed++; }
  }
  invalidateBootCache();
  return { ok: true, removed: removed };
}

function getItemActions() {
  var sheet = getItemActionsSheet();
  var data = sheet.getDataRange().getValues();
  var out = [];
  for (var r = 1; r < data.length; r++) {
    if (!data[r][1]) continue;
    out.push({ date: formatDate(data[r][0]), itemId: data[r][1], action: data[r][2], detail: data[r][3] || '' });
  }
  return out;
}

// ---------------------------------------------------------------------
// Optional: eBay live stats via Sell Analytics traffic_report.
// Prefers refresh-token OAuth (EBAY_CLIENT_ID + EBAY_CLIENT_SECRET +
// EBAY_REFRESH_TOKEN) so access tokens stay fresh; falls back to a
// short-lived EBAY_OAUTH_TOKEN alone. See SETUP.md "Optional: eBay live
// stats". Run setupEbayTrigger() once to install a 6-hour timer; Inventory
// Refresh also POSTs action:syncEbayMetrics before reloading metrics.
// ---------------------------------------------------------------------

function setupEbayTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncEbayMetrics') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncEbayMetrics').timeBased().everyHours(6).create();
}

/** Pull a usable access token; cache refreshed tokens in EBAY_OAUTH_TOKEN. */
function getEbayAccessToken_() {
  var props = PropertiesService.getScriptProperties();
  var clientId = props.getProperty('EBAY_CLIENT_ID');
  var clientSecret = props.getProperty('EBAY_CLIENT_SECRET');
  var refreshToken = props.getProperty('EBAY_REFRESH_TOKEN');
  if (clientId && clientSecret && refreshToken) {
    try {
      var basic = Utilities.base64Encode(clientId + ':' + clientSecret);
      var scope = 'https://api.ebay.com/oauth/api_scope/sell.analytics.readonly';
      var resp = UrlFetchApp.fetch('https://api.ebay.com/identity/v1/oauth2/token', {
        method: 'post',
        contentType: 'application/x-www-form-urlencoded',
        headers: { Authorization: 'Basic ' + basic },
        payload: {
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          scope: scope,
        },
        muteHttpExceptions: true,
      });
      if (resp.getResponseCode() === 200) {
        var data = JSON.parse(resp.getContentText());
        if (data.access_token) {
          props.setProperty('EBAY_OAUTH_TOKEN', data.access_token);
          return data.access_token;
        }
      }
    } catch (err) {
      // Fall through to any cached access token below.
    }
  }
  return props.getProperty('EBAY_OAUTH_TOKEN') || '';
}

/** eBay listing id from a live URL (or a bare numeric id). Hub ids like CLO-001-EBAY are not valid. */
function extractEbayListingId_(urlOrId) {
  var s = String(urlOrId || '').trim();
  if (/^\d{9,}$/.test(s)) return s;
  var m = s.match(/\/itm\/(?:[^\/?#]+\/)?(\d{9,})/i)
    || s.match(/[?&]item=(\d{9,})/i)
    || s.match(/\/(\d{9,})(?:[\/?#]|$)/);
  return m ? m[1] : '';
}

/** Unwrap eBay Value / nested {value:{value}} shapes to a primitive. */
function ebayPrimitive_(cell) {
  if (cell === null || cell === undefined) return '';
  var v = cell;
  // Record cells are often { value: <primitive>, applicable: true }
  if (typeof v === 'object' && v.value !== undefined) v = v.value;
  if (typeof v === 'object' && v !== null && v.value !== undefined) v = v.value;
  return v;
}

function ebayYmdPacific_(d) {
  return Utilities.formatDate(d, 'America/Los_Angeles', 'yyyyMMdd');
}

/**
 * Sync Active eBay queue rows into Metrics via traffic_report.
 * Returns { ok, synced, skipped, errors: [...] } for the client / Refresh UI.
 */
/**
 * Diagnose the eBay OAuth setup without revealing any secret: reports which
 * properties exist (length only) and what eBay says about the refresh call.
 */
/**
 * One-time: swap the authorization code from the consent redirect for a
 * long-lived refresh token, and store it. Reads EBAY_AUTH_CODE and
 * EBAY_RUNAME from Script Properties so no secret ever travels in a URL,
 * and clears the code afterwards since it is single-use.
 */
function ebayExchangeCode() {
  var props = PropertiesService.getScriptProperties();
  var code = props.getProperty('EBAY_AUTH_CODE');
  var ru = props.getProperty('EBAY_RUNAME');
  var id = props.getProperty('EBAY_CLIENT_ID');
  var secret = props.getProperty('EBAY_CLIENT_SECRET');
  if (!code) return { ok: false, error: 'Add EBAY_AUTH_CODE (the code= value from the redirect URL) first.' };
  if (!ru) return { ok: false, error: 'Add EBAY_RUNAME (your RuName) first.' };
  if (!id || !secret) return { ok: false, error: 'EBAY_CLIENT_ID / EBAY_CLIENT_SECRET are missing.' };
  code = String(code).trim();
  // The address bar hands it over percent-encoded; eBay wants it decoded.
  if (code.indexOf('%') !== -1) {
    try { code = decodeURIComponent(code); } catch (err) { /* use as-is */ }
  }
  var resp = UrlFetchApp.fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(String(id).trim() + ':' + String(secret).trim()) },
    payload: { grant_type: 'authorization_code', code: code, redirect_uri: String(ru).trim() },
    muteHttpExceptions: true,
  });
  var status = resp.getResponseCode();
  var body = resp.getContentText();
  if (status !== 200) {
    return { ok: false, status: status, body: body.slice(0, 400) };
  }
  var data = JSON.parse(body);
  if (!data.refresh_token) return { ok: false, status: status, error: 'No refresh_token in the response.' };
  props.setProperty('EBAY_REFRESH_TOKEN', data.refresh_token);
  if (data.access_token) props.setProperty('EBAY_OAUTH_TOKEN', data.access_token);
  props.deleteProperty('EBAY_AUTH_CODE');
  return {
    ok: true,
    refreshTokenLength: String(data.refresh_token).length,
    refreshTokenExpiresInDays: data.refresh_token_expires_in ? Math.round(data.refresh_token_expires_in / 86400) : null,
  };
}

function ebayAuthCheck() {
  var props = PropertiesService.getScriptProperties();
  var names = ['EBAY_CLIENT_ID', 'EBAY_CLIENT_SECRET', 'EBAY_REFRESH_TOKEN', 'EBAY_OAUTH_TOKEN'];
  var present = {};
  names.forEach(function (n) {
    var v = props.getProperty(n);
    present[n] = v ? { set: true, length: String(v).length, trimmedDiffers: String(v) !== String(v).trim() } : { set: false };
  });
  var out = { properties: present, allNames: props.getKeys().sort() };
  var id = props.getProperty('EBAY_CLIENT_ID');
  var secret = props.getProperty('EBAY_CLIENT_SECRET');
  var refresh = props.getProperty('EBAY_REFRESH_TOKEN');
  if (!(id && secret && refresh)) {
    out.tokenCall = 'skipped - one of the three is missing';
    return out;
  }
  var resp = UrlFetchApp.fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(String(id).trim() + ':' + String(secret).trim()) },
    payload: {
      grant_type: 'refresh_token',
      refresh_token: String(refresh).trim(),
      scope: 'https://api.ebay.com/oauth/api_scope/sell.analytics.readonly',
    },
    muteHttpExceptions: true,
  });
  var body = resp.getContentText();
  out.tokenCall = { status: resp.getResponseCode(), body: body.slice(0, 400).replace(/"access_token":"[^"]*"/, '"access_token":"<hidden>"') };
  return out;
}

// eBay's traffic report has no watcher count, so a synced row would wipe the
// last hand-entered one. Carry the most recent known watchers forward instead.
// The trigger runs every 6 hours, so today's synced rows get replaced rather
// than stacked up - otherwise Metrics grows by 240 rows a day.
function clearTodaysEbayApiRows_() {
  var sheet = getMetricsSheet();
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return 0;
  var headers = data[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var dateCol = headers.indexOf('date');
  var srcCol = headers.indexOf('source');
  if (dateCol === -1 || srcCol === -1) return 0;
  var today = todayIso();
  var doomed = [];
  for (var r = 1; r < data.length; r++) {
    var d = data[r][dateCol];
    if (Object.prototype.toString.call(d) === '[object Date]') d = formatDate(d);
    if (String(d).slice(0, 10) !== today) continue;
    if (String(data[r][srcCol]).trim().toLowerCase() !== 'ebay-api') continue;
    doomed.push(r + 1);
  }
  for (var i = doomed.length - 1; i >= 0; i--) sheet.deleteRow(doomed[i]);
  return doomed.length;
}

// eBay's traffic report carries no watcher count, so a synced row would wipe
// the hand-entered one. Carry the most recent MANUAL value forward: api rows
// are skipped so the number can't echo itself, and a zero counts, otherwise a
// listing that lost its last watcher would keep showing the old count.
function lastKnownWatchersByListing_() {
  var out = {};
  getMetrics().forEach(function (m) {
    var id = String(m.listingId || '');
    if (!id) return;
    if (String(m.source || '').toLowerCase() === 'ebay-api') return;
    var d = String(m.date || '');
    if (!out[id] || d >= out[id].date) out[id] = { date: d, watchers: Number(m.watchers || 0) };
  });
  return out;
}

function syncEbayMetrics() {
  var errors = [];
  var knownWatchers = lastKnownWatchersByListing_();
  var token = getEbayAccessToken_();
  if (!token) {
    return {
      ok: false,
      synced: 0,
      skipped: 0,
      errors: ['no token — set EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_REFRESH_TOKEN (or EBAY_OAUTH_TOKEN)'],
    };
  }

  var queue = getPostingQueue().filter(function (row) {
    var plat = String(row.platform || '').toLowerCase();
    if (plat.indexOf('ebay') === -1) return false;
    var st = String(row.status || '').toLowerCase();
    return st === 'active' || !!String(row.listingUrl || '').trim();
  });

  var byEbayId = {};
  var skipped = 0;
  queue.forEach(function (row) {
    var ebayId = extractEbayListingId_(row.listingUrl) || extractEbayListingId_(row.listingId);
    if (!ebayId) {
      skipped++;
      return;
    }
    var existing = byEbayId[ebayId];
    if (!existing || String(row.status || '').toLowerCase() === 'active') {
      byEbayId[ebayId] = row;
    }
  });

  var ids = Object.keys(byEbayId);
  if (!ids.length) {
    return {
      ok: true,
      synced: 0,
      skipped: skipped,
      errors: ['no Active eBay listings with extractable item IDs in Listing URL'],
    };
  }

  var end = new Date();
  var start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  var dateRange = '[' + ebayYmdPacific_(start) + '..' + ebayYmdPacific_(end) + ']';
  var metricList = 'LISTING_IMPRESSION_TOTAL,LISTING_VIEWS_TOTAL,LISTING_VIEWS_SOURCE_DIRECT,CLICK_THROUGH_RATE';
  var batchSize = 100;
  var metricRows = [];

  for (var i = 0; i < ids.length; i += batchSize) {
    var batch = ids.slice(i, i + batchSize);
    var filter = 'marketplace_ids:{EBAY_US},date_range:' + dateRange + ',listing_ids:{' + batch.join('|') + '}';
    var url = 'https://api.ebay.com/sell/analytics/v1/traffic_report'
      + '?dimension=LISTING'
      + '&metric=' + encodeURIComponent(metricList)
      + '&filter=' + encodeURIComponent(filter);
    try {
      var resp = UrlFetchApp.fetch(url, {
        headers: {
          Authorization: 'Bearer ' + token,
          Accept: 'application/json',
        },
        muteHttpExceptions: true,
      });
      var code = resp.getResponseCode();
      var bodyText = resp.getContentText();
      if (code !== 200) {
        errors.push('traffic_report HTTP ' + code + ': ' + String(bodyText).slice(0, 240));
        continue;
      }
      var report = JSON.parse(bodyText);
      var headerMetrics = (report.header && report.header.metrics) || [];
      var metricKeys = headerMetrics.map(function (m) {
        return String(m.key || '').toUpperCase();
      });
      (report.records || []).forEach(function (rec) {
        var dimCell = (rec.dimensionValues && rec.dimensionValues[0]) || null;
        var ebayId = String(ebayPrimitive_(dimCell) || '');
        var row = byEbayId[ebayId];
        if (!row) return;

        var values = rec.metricValues || [];
        var map = {};
        for (var mi = 0; mi < metricKeys.length; mi++) {
          map[metricKeys[mi]] = Number(ebayPrimitive_(values[mi])) || 0;
        }
        var impressions = map.LISTING_IMPRESSION_TOTAL || 0;
        var views = map.LISTING_VIEWS_TOTAL || 0;
        var directViews = map.LISTING_VIEWS_SOURCE_DIRECT || 0;
        if (!views && directViews) views = directViews;
        var ctr = map.CLICK_THROUGH_RATE || 0;
        var clicks = 0;
        if (ctr > 0 && impressions > 0) {
          clicks = ctr <= 1
            ? Math.round(ctr * impressions)
            : Math.round(impressions * ctr / 100);
        }

        metricRows.push({
          listingId: row.listingId,
          itemId: row.itemId,
          platform: 'eBay',
          impressions: impressions,
          views: views,
          watchers: knownWatchers[row.listingId] ? knownWatchers[row.listingId].watchers : 0,
          clicks: clicks,
          source: 'ebay-api',
        });
      });
    } catch (err) {
      errors.push(String(err && err.message ? err.message : err));
    }
  }

  if (metricRows.length) {
    clearTodaysEbayApiRows_();
    addMetricEntries({ rows: metricRows, source: 'ebay-api' });
  } else {
    invalidateBootCache();
  }

  return {
    ok: errors.length === 0,
    synced: metricRows.length,
    skipped: skipped,
    errors: errors,
  };
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
      invalidateBootCache();
      return { ok: true, updated: true };
    }
  }
  sheet.appendRow([body.itemId || '', body.platform || '', body.photoUrl || '']);
  invalidateBootCache();
  return { ok: true, updated: false };
}

// ---------------------------------------------------------------------
// Market data — comps for Acquire Watchlist items, plus a "Market Trends"
// tab of curated resale categories. Two different data paths feed this,
// on purpose:
//
// POSHMARK — its public sold-listings search (availability=sold_out) has
// no login wall, so UrlFetchApp can hit it directly from a server-side
// trigger. This runs automatically on a daily timer (setupMarketDataTrigger).
//
// EBAY — eBay actively blocks server-side/bot requests to its public
// search (confirmed: 403 on the sold-listings search, and even the plain
// search page redirects non-browser requests to sign-in). eBay's own
// Seller Hub "Research" tool (Terapeak, free — no Store subscription
// needed) has the real data, including actual sell-through rate, but it's
// only reachable while logged into a real eBay session — Apps Script has
// no way to authenticate as you. So eBay numbers come from a manual pull
// run through a live browser session (same one-time-pull pattern as the
// per-listing stats and cover photos elsewhere in this project), written
// in via the setAcquireEbayData / setTrendEbayData POST actions below.
// Nothing here auto-refreshes eBay's numbers — ask for a fresh pull
// whenever you want current ones.
//
// One-time setup for the automatic Poshmark side: run
// setupMarketDataTrigger() once from this editor's Run menu (authorize
// when prompted). After that it updates itself daily — see SETUP.md.
// ---------------------------------------------------------------------

var TRENDS_SHEET_NAME = 'Market Trends';
// The first eight columns are the original layout and stay where they are;
// everything after them was added for Acquire V2 and is read by header name,
// so rows written before those columns existed still load (blank = unknown).
var TRENDS_HEADERS = [
  'Search Term', 'Platform', 'Avg Sold Price', 'Recent Sales Found', 'Sell-Through %', 'Last Checked', 'Image URL', 'Category',
  'Opportunity ID', 'Median Sold Price', 'Low Sold Price', 'High Sold Price', 'Sample Size', 'Active Listings',
  'Avg Shipping', 'Source',
];

// Append-only log of every market observation. Market Trends only ever holds
// the latest snapshot, so this is what makes a real trend direction possible
// later instead of just today's number. One row per day per opportunity x
// platform x source — a same-day re-pull replaces that day's row rather than
// stacking duplicates.
var MARKET_HISTORY_SHEET_NAME = 'Market History';
var MARKET_HISTORY_HEADERS = [
  'Date', 'Opportunity ID', 'Search Term', 'Platform', 'Avg Sold Price', 'Median Sold Price', 'Low Sold Price',
  'High Sold Price', 'Sales Found', 'Sample Size', 'Active Listings', 'Sell Through', 'Avg Shipping', 'Source',
];

// Sourcing intelligence — what to research and how to judge it in the store:
// risks, shipping class, typical buy cost, inspection checklist, recognition
// clues. This is knowledge, not market data, so it lives apart from the
// marketplace numbers and never overwrites them. Adding a row here (any
// category, including new ones) adds a research target with no code change.
var SOURCING_INTEL_SHEET_NAME = 'Sourcing Intel';
var SOURCING_INTEL_HEADERS = [
  'Opportunity ID', 'Search Term', 'eBay Query', 'Poshmark Query', 'Brand', 'Model', 'Category', 'Subcategory',
  'Keywords', 'Shipping Class', 'Testing Risk', 'Counterfeit Risk', 'Shipping Difficulty', 'Fragility', 'Return Risk',
  'Knowledge Level', 'Condition Requirement', 'Typical Cost Low', 'Typical Cost High', 'Sourcing Locations',
  'Inspection Notes', 'Recognition Notes', 'Platform Notes', 'Active', 'Last Updated',
  'Thrift Frequency',
];

// Category display order for the Acquire tab's "Trending to look for"
// section — anything with a category not in this list falls under "Other"
// at the end. Edit TREND_CATEGORY_ORDER to reorder sections on the site.
var TREND_CATEGORY_ORDER = ['Outerwear', 'Shirts', 'Pants', 'Shoes', 'Accessories', 'Other'];

// General thrift/yard-sale sourcing targets — brands and categories with a
// well-established track record of reselling well, so this is a "what
// should I keep an eye out for while I'm digging through racks/bins" list,
// not a mirror of what's already in the Sheet. (An earlier version of this
// list *was* built from this seller's own inventory — Timberland, Ralph
// Lauren, Calvin Klein, etc. — which meant Acquire only ever showed trends
// for stuff already owned, defeating its purpose as a sourcing tool. A few
// of those categories are kept below since they're also broadly well-known
// resale picks, not because they're already owned.)
// Each entry has a `category` (Outerwear/Shirts/Pants/Shoes/Accessories) so
// the site can group cards instead of showing one flat list. Edit this
// directly to add/remove categories/terms as trends shift.
var TREND_CANDIDATES = [
  { term: 'Carhartt jacket', category: 'Outerwear' },
  { term: 'Patagonia fleece', category: 'Outerwear' },
  { term: 'Patagonia jacket', category: 'Outerwear' },
  { term: 'The North Face jacket', category: 'Outerwear' },
  { term: 'The North Face fleece vest', category: 'Outerwear' },
  { term: "Levi's denim jacket", category: 'Outerwear' },
  { term: 'Nike windbreaker', category: 'Outerwear' },
  { term: 'Adidas track jacket', category: 'Outerwear' },
  { term: 'Columbia fleece jacket', category: 'Outerwear' },

  { term: 'Champion hoodie', category: 'Shirts' },
  { term: 'Vintage band t-shirt', category: 'Shirts' },
  { term: 'Vintage flannel shirt', category: 'Shirts' },
  { term: 'Ralph Lauren polo', category: 'Shirts' },

  { term: 'Carhartt overalls', category: 'Pants' },
  { term: "Levi's 501 jeans", category: 'Pants' },
  { term: 'Wrangler jeans', category: 'Pants' },
  { term: 'Dickies pants', category: 'Pants' },
  { term: 'Lululemon leggings', category: 'Pants' },
  { term: 'Calvin Klein jeans', category: 'Pants' },

  { term: 'Nike Jordan sneakers', category: 'Shoes' },
  { term: 'New Balance sneakers', category: 'Shoes' },
  { term: 'Vans Old Skool', category: 'Shoes' },
  { term: 'Doc Martens boots', category: 'Shoes' },
  { term: 'Timberland boots', category: 'Shoes' },
  { term: 'Ugg boots', category: 'Shoes' },
  { term: 'Vans shoes', category: 'Shoes' },

  { term: 'Coach bag', category: 'Accessories' },
  { term: 'Ray-Ban sunglasses', category: 'Accessories' },
  { term: 'Burberry scarf', category: 'Accessories' },
  { term: 'Stanley tumbler', category: 'Accessories' },
  { term: 'Yeti tumbler', category: 'Accessories' },
];

function trendCategoryFor(searchTerm) {
  var found = TREND_CANDIDATES.filter(function (c) { return c.term === searchTerm; })[0];
  return found ? found.category : '';
}

// Depop has no public "sold items" filter (checked directly — its search
// results are always active listings, and there's no equivalent of eBay's
// LH_Sold or Poshmark's availability=sold_out), so it's not included here.

// Searches eBay's public sold/completed listings for `query`. No login
// required — this is the same search anyone can run at ebay.com with the
// "Sold Items" filter checked.
function searchEbaySold(query, debug) {
  var url = 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent(query) + '&LH_Sold=1&LH_Complete=1&_ipg=60';
  try {
    var resp = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    var code = resp.getResponseCode();
    var html = resp.getContentText();
    if (debug) {
      Logger.log('[eBay] query=%s status=%s length=%s hasPriceClass=%s hasCaptcha=%s title=%s',
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
    if (debug) Logger.log('[eBay] query=%s EXCEPTION %s', query, err);
    return { avgPrice: 0, count: 0 };
  }
}

// Searches Poshmark's public marketplace search filtered to sold items.
// No login required — same search anyone can run at poshmark.com with the
// "Sold Items" availability filter.
function searchPoshmarkSold(query, debug) {
  var url = 'https://poshmark.com/search?query=' + encodeURIComponent(query) + '&availability=sold_out';
  try {
    var resp = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    var code = resp.getResponseCode();
    var html = resp.getContentText();
    var prices = [];
    var imageUrl = '';
    var parseError = null;
    if (code === 200) {
      var jsonStr = extractInitialStateJson(html);
      if (jsonStr) {
        try {
          var state = JSON.parse(jsonStr);
          var items = state && state['$_search'] && state['$_search'].gridData && state['$_search'].gridData.data;
          if (items && items.length) {
            items.forEach(function (it) {
              if (it && it.inventory && it.inventory.status === 'sold_out' && typeof it.price === 'number' && it.price > 0) {
                prices.push(it.price);
                if (!imageUrl && it.picture_url) imageUrl = it.picture_url;
              }
            });
          }
        } catch (e) {
          parseError = String(e);
        }
      }
    }
    var debugInfo = null;
    if (debug) {
      debugInfo = {
        query: query, status: code, length: html.length, soldItemsFound: prices.length,
        parseError: parseError,
        title: (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || ''
      };
      Logger.log('[Poshmark] query=%s status=%s length=%s soldItemsFound=%s parseError=%s title=%s',
        query, code, html.length, prices.length, parseError, debugInfo.title);
    }
    if (code !== 200) return { avgPrice: 0, count: 0, imageUrl: '', debug: debugInfo };
    if (!prices.length) return { avgPrice: 0, count: 0, imageUrl: '', debug: debugInfo };
    var sum = prices.reduce(function (a, b) { return a + b; }, 0);
    var sorted = prices.slice().sort(function (a, b) { return a - b; });
    return {
      avgPrice: Math.round((sum / prices.length) * 100) / 100, count: prices.length, imageUrl: imageUrl, debug: debugInfo,
      medianPrice: percentile(sorted, 0.5), lowPrice: percentile(sorted, 0.25), highPrice: percentile(sorted, 0.75),
    };
  } catch (err) {
    if (debug) Logger.log('[Poshmark] query=%s EXCEPTION %s', query, err);
    return { avgPrice: 0, count: 0, imageUrl: '', debug: debug ? { exception: String(err) } : null };
  }
}

// Linear-interpolated percentile of an ascending array, to the cent. Low/High
// Sold Price are the 25th/75th percentiles — the typical range, not the
// extremes, so one outlier sale can't stretch it.
function percentile(sorted, q) {
  if (!sorted.length) return '';
  var pos = (sorted.length - 1) * q;
  var lo = Math.floor(pos), hi = Math.ceil(pos);
  var v = sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  return Math.round(v * 100) / 100;
}

// Diagnostic helper — run this directly from the Run menu and check the
// execution log to see exactly what each site is sending back.
function debugSearchSoldListings() {
  searchEbaySold('Carhartt jacket', true);
  searchPoshmarkSold('Carhartt jacket', true);
}

// Adds any header in `headers` that the sheet doesn't have yet, at the end of
// row 1. Never reorders or renames existing columns, so hand-added columns and
// existing data stay put.
function ensureHeaderColumns(sheet, headers) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var current = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var have = {};
  current.forEach(function (h) { if (String(h).trim()) have[String(h).trim().toLowerCase()] = true; });
  var missing = headers.filter(function (h) { return !have[h.toLowerCase()]; });
  if (!missing.length) return;
  var start = current.some(function (h) { return String(h).trim(); }) ? lastCol + 1 : 1;
  sheet.getRange(1, start, 1, missing.length).setValues([missing]);
}

function getOrCreateSheet(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    return sheet;
  }
  ensureHeaderColumns(sheet, headers);
  return sheet;
}

function getTrendsSheet() {
  return getOrCreateSheet(TRENDS_SHEET_NAME, TRENDS_HEADERS);
}

// Same slug rule as opportunityIdFor() in js/acquire-model.js — the two must
// agree, since it's how a Market Trends row finds its Sourcing Intel row.
function opportunityIdFor(searchTerm) {
  return String(searchTerm || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function todayIso() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

// Reads a header-row table into plain objects keyed by the header text.
function readRecords(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var rec = {};
    var any = false;
    headers.forEach(function (h, c) {
      if (!h) return;
      var v = values[r][c];
      if (Object.prototype.toString.call(v) === '[object Date]') v = formatDate(v);
      rec[h] = v;
      if (v !== '' && v !== null) any = true;
    });
    if (any) out.push(rec);
  }
  return out;
}

// Upserts records (objects keyed by header text) in one read and one write.
// Only keys present on a record are written, so a partial update never blanks
// the columns it didn't mention. `keyOf(get)` builds the match key from a
// getter, used for both existing rows and incoming records.
function upsertRecords(sheet, headers, records, keyOf) {
  ensureHeaderColumns(sheet, headers);
  var lastCol = sheet.getLastColumn();
  var headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var colOf = {};
  headerRow.forEach(function (h, c) { if (String(h).trim()) colOf[String(h).trim().toLowerCase()] = c; });
  var lastRow = sheet.getLastRow();
  var data = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
  var index = {};
  data.forEach(function (row, i) {
    var k = keyOf(function (name) { var c = colOf[name.toLowerCase()]; return c === undefined ? '' : row[c]; });
    if (k) index[k] = i;
  });
  var updated = 0, added = 0;
  records.forEach(function (rec) {
    var k = keyOf(function (name) { return rec[name]; });
    if (!k) return;
    var row;
    if (Object.prototype.hasOwnProperty.call(index, k)) { row = data[index[k]]; updated++; }
    else { row = new Array(lastCol).fill(''); data.push(row); index[k] = data.length - 1; added++; }
    Object.keys(rec).forEach(function (name) {
      var c = colOf[name.toLowerCase()];
      if (c === undefined || rec[name] === undefined) return;
      row[c] = rec[name] === null ? '' : rec[name];
    });
  });
  if (data.length) sheet.getRange(2, 1, data.length, lastCol).setValues(data);
  return { updated: updated, added: added };
}

function getTrends() {
  return readRecords(getTrendsSheet()).filter(function (r) { return r['Search Term']; }).map(function (r) {
    return {
      searchTerm: r['Search Term'],
      platform: r['Platform'],
      avgSoldPrice: r['Avg Sold Price'] || '',
      recentSalesFound: r['Recent Sales Found'] || '',
      sellThrough: r['Sell-Through %'] || '',
      lastChecked: r['Last Checked'] || '',
      imageUrl: r['Image URL'] || '',
      category: r['Category'] || '',
      opportunityId: r['Opportunity ID'] || opportunityIdFor(r['Search Term']),
      medianSoldPrice: r['Median Sold Price'] || '',
      lowSoldPrice: r['Low Sold Price'] || '',
      highSoldPrice: r['High Sold Price'] || '',
      sampleSize: r['Sample Size'] || '',
      activeListings: r['Active Listings'] || '',
      avgShipping: r['Avg Shipping'] === 0 ? 0 : (r['Avg Shipping'] || ''),
      source: r['Source'] || '',
    };
  });
}

function getMarketHistorySheet() {
  return getOrCreateSheet(MARKET_HISTORY_SHEET_NAME, MARKET_HISTORY_HEADERS);
}

function getMarketHistory() {
  return readRecords(getMarketHistorySheet()).filter(function (r) { return r['Opportunity ID']; }).map(function (r) {
    return {
      date: r['Date'], opportunityId: r['Opportunity ID'], searchTerm: r['Search Term'], platform: r['Platform'],
      avgSoldPrice: r['Avg Sold Price'], medianSoldPrice: r['Median Sold Price'], lowSoldPrice: r['Low Sold Price'],
      highSoldPrice: r['High Sold Price'], salesFound: r['Sales Found'], sampleSize: r['Sample Size'],
      activeListings: r['Active Listings'], sellThrough: r['Sell Through'], avgShipping: r['Avg Shipping'], source: r['Source'],
    };
  });
}

function getSourcingIntelSheet() {
  return getOrCreateSheet(SOURCING_INTEL_SHEET_NAME, SOURCING_INTEL_HEADERS);
}

function getSourcingIntel() {
  return readRecords(getSourcingIntelSheet()).filter(function (r) { return r['Search Term'] || r['Opportunity ID']; }).map(function (r) {
    return {
      opportunityId: r['Opportunity ID'] || opportunityIdFor(r['Search Term']),
      searchTerm: r['Search Term'], ebayQuery: r['eBay Query'], poshmarkQuery: r['Poshmark Query'],
      brand: r['Brand'], model: r['Model'], category: r['Category'], subcategory: r['Subcategory'], keywords: r['Keywords'],
      shippingClass: r['Shipping Class'], testingRisk: r['Testing Risk'], counterfeitRisk: r['Counterfeit Risk'],
      shippingDifficulty: r['Shipping Difficulty'], fragility: r['Fragility'], returnRisk: r['Return Risk'],
      knowledgeLevel: r['Knowledge Level'], conditionRequirement: r['Condition Requirement'],
      typicalCostLow: r['Typical Cost Low'], typicalCostHigh: r['Typical Cost High'],
      sourcingLocations: r['Sourcing Locations'], inspectionNotes: r['Inspection Notes'],
      recognitionNotes: r['Recognition Notes'], platformNotes: r['Platform Notes'],
      active: r['Active'], lastUpdated: r['Last Updated'],
      thriftFrequency: r['Thrift Frequency'],
    };
  });
}

// Maps the camelCase shape the site and pull scripts use onto sheet headers.
var INTEL_FIELD_HEADERS = {
  opportunityId: 'Opportunity ID', searchTerm: 'Search Term', ebayQuery: 'eBay Query', poshmarkQuery: 'Poshmark Query',
  brand: 'Brand', model: 'Model', category: 'Category', subcategory: 'Subcategory', keywords: 'Keywords',
  shippingClass: 'Shipping Class', testingRisk: 'Testing Risk', counterfeitRisk: 'Counterfeit Risk',
  shippingDifficulty: 'Shipping Difficulty', fragility: 'Fragility', returnRisk: 'Return Risk',
  knowledgeLevel: 'Knowledge Level', conditionRequirement: 'Condition Requirement',
  typicalCostLow: 'Typical Cost Low', typicalCostHigh: 'Typical Cost High', sourcingLocations: 'Sourcing Locations',
  inspectionNotes: 'Inspection Notes', recognitionNotes: 'Recognition Notes', platformNotes: 'Platform Notes',
  active: 'Active',
  // How often it actually turns up on a thrift/bins/yard-sale run: Common,
  // Occasional or Rare. A sourcing estimate, like Typical Cost.
  thriftFrequency: 'Thrift Frequency',
};

function upsertSourcingIntel(body) {
  var rows = (body.rows || [body]).map(function (row) {
    var rec = {};
    Object.keys(INTEL_FIELD_HEADERS).forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(row, k)) rec[INTEL_FIELD_HEADERS[k]] = row[k];
    });
    if (!rec['Opportunity ID']) rec['Opportunity ID'] = opportunityIdFor(row.searchTerm);
    rec['Last Updated'] = todayIso();
    return rec;
  }).filter(function (rec) { return rec['Opportunity ID']; });
  if (!rows.length) return { ok: false, error: 'No rows with a search term or opportunity ID.' };
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var res = upsertRecords(getSourcingIntelSheet(), SOURCING_INTEL_HEADERS, rows, function (get) {
      return String(get('Opportunity ID') || '').trim();
    });
    return { ok: true, updated: res.updated, added: res.added };
  } finally {
    lock.releaseLock();
  }
}

// Writes marketplace observations: the latest snapshot into Market Trends
// (one row per search term x platform) and the same numbers into Market
// History (one row per day x opportunity x platform x source).
function upsertMarketObservations(observations) {
  var today = todayIso();
  var trendRows = [], historyRows = [];
  observations.forEach(function (o) {
    if (!o.searchTerm || !o.platform) return;
    var id = o.opportunityId || opportunityIdFor(o.searchTerm);
    var cat = o.category || trendCategoryFor(o.searchTerm);
    var trend = {
      'Search Term': o.searchTerm, 'Platform': o.platform, 'Opportunity ID': id, 'Last Checked': today,
      'Avg Sold Price': o.avgPrice, 'Recent Sales Found': o.salesFound, 'Sell-Through %': o.sellThrough,
      'Median Sold Price': o.medianPrice, 'Low Sold Price': o.lowPrice, 'High Sold Price': o.highPrice,
      'Sample Size': o.sampleSize, 'Active Listings': o.activeListings, 'Avg Shipping': o.avgShipping, 'Source': o.source,
    };
    if (o.imageUrl) trend['Image URL'] = o.imageUrl;
    if (cat) trend['Category'] = cat;
    trendRows.push(trend);
    historyRows.push({
      'Date': today, 'Opportunity ID': id, 'Search Term': o.searchTerm, 'Platform': o.platform,
      'Avg Sold Price': o.avgPrice, 'Median Sold Price': o.medianPrice, 'Low Sold Price': o.lowPrice,
      'High Sold Price': o.highPrice, 'Sales Found': o.salesFound, 'Sample Size': o.sampleSize,
      'Active Listings': o.activeListings, 'Sell Through': o.sellThrough, 'Avg Shipping': o.avgShipping,
      'Source': o.source || '',
    });
  });
  if (!trendRows.length) return { ok: false, error: 'No observations with a search term and platform.' };
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var t = upsertRecords(getTrendsSheet(), TRENDS_HEADERS, trendRows, function (get) {
      return get('Search Term') && get('Platform') ? String(get('Search Term')) + '|' + String(get('Platform')) : '';
    });
    var h = upsertRecords(getMarketHistorySheet(), MARKET_HISTORY_HEADERS, historyRows, function (get) {
      var d = get('Date');
      if (Object.prototype.toString.call(d) === '[object Date]') d = formatDate(d);
      return get('Opportunity ID') ? [d, get('Opportunity ID'), get('Platform'), get('Source')].join('|') : '';
    });
    return { ok: true, trends: t, history: h };
  } finally {
    lock.releaseLock();
  }
}

function setMarketObservations(body) {
  return upsertMarketObservations(body.observations || [body]);
}

// ---------------------------------------------------------------------
// Removing items — "delete for good" or "save for later".
//
// Listing Hub mirrors the source tabs with formulas that point at fixed
// source rows, and its "Source row" column is a stored number the site uses
// to find an item's row. Deleting a source row would shift every item below
// it and send edits to the wrong item, so a removed item's source row is
// cleared (left blank) instead, and only its Listing Hub row is deleted —
// nothing refers to hub rows by position.
//
// Save for later copies the item, including every cell of both rows
// (formulas kept as formulas), into the Saved for Later tab, so restoreItem
// can put it back exactly where it was.
// ---------------------------------------------------------------------

var SAVED_SHEET_NAME = 'Saved for Later';
var SAVED_HEADERS = [
  'Item ID', 'Date Saved', 'Reason', 'Category', 'Brand', 'Size', 'Item', 'Condition', 'Est. value',
  'List price', 'Floor price', 'Platforms', 'Live Listings When Saved', 'Source Tab', 'Source Row',
  'Original Source Row (JSON)', 'Original Hub Row (JSON)', 'Queue Statuses (JSON)',
];

function getSavedSheet() { return getOrCreateSheet(SAVED_SHEET_NAME, SAVED_HEADERS); }

function getSavedItems() {
  return readRecords(getSavedSheet()).filter(function (r) { return r['Item ID']; }).map(function (r) {
    return {
      itemId: r['Item ID'], dateSaved: r['Date Saved'], reason: r['Reason'], category: r['Category'], brand: r['Brand'],
      size: r['Size'], item: r['Item'], condition: r['Condition'], estValue: r['Est. value'], listPrice: r['List price'],
      floorPrice: r['Floor price'], platforms: r['Platforms'], liveWhenSaved: r['Live Listings When Saved'],
      sourceTab: r['Source Tab'],
    };
  });
}

// Cell snapshot that survives JSON: formulas stay formulas, dates stay dates.
function snapshotRow(range) {
  var values = range.getValues()[0];
  var formulas = range.getFormulas()[0];
  return values.map(function (v, i) {
    if (formulas[i]) return ['f', formulas[i]];
    if (Object.prototype.toString.call(v) === '[object Date]') return ['d', v.getTime()];
    return ['v', v];
  });
}
function snapshotToCells(snapshot) {
  return snapshot.map(function (c) { return c[0] === 'd' ? new Date(c[1]) : c[1]; });
}

function tableRowsForItem(sheetName, anchors, itemId) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return { sheet: null, rows: [] };
  var t = readTable(sheet, anchors);
  var col = colIndex(t.colMap, 'Item ID');
  if (col === -1) return { sheet: sheet, rows: [], colMap: t.colMap };
  var rows = [];
  t.rows.forEach(function (r, i) {
    if (String(r[col]).trim() === String(itemId)) rows.push({ row: t.headerSheetRow + 1 + i, values: r });
  });
  return { sheet: sheet, rows: rows, colMap: t.colMap };
}

function locateItem(itemId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hub = findHubRow(itemId);
  if (hub.error) return hub;
  var hubLastCol = hub.sheet.getLastColumn();
  var hubRange = hub.sheet.getRange(hub.row, 1, 1, hubLastCol);
  var hubValues = hubRange.getValues()[0];
  var sourceTab = String(hubValues[colIndex(hub.colMap, 'Source tab')] || '');
  var sourceRow = Number(hubValues[colIndex(hub.colMap, 'Source row')]);
  var sourceSheet = ss.getSheetByName(sourceTab);
  if (!sourceSheet || !sourceRow) return { error: 'Could not find the source row for ' + itemId + '.' };
  var sourceHeader = findHeaderRow(sourceSheet, ['Status']);
  if (!sourceHeader) return { error: 'Could not find the header row in ' + sourceTab + '.' };
  var sourceLastCol = sourceSheet.getLastColumn();
  var sourceRange = sourceSheet.getRange(sourceRow, 1, 1, sourceLastCol);
  // Sanity check before touching anything: the hub row's Item must be the
  // source row's Item, or the stored row number has drifted.
  var hubItem = String(hubValues[colIndex(hub.colMap, 'Item')] || '').trim();
  var sourceItemCol = colIndex(sourceHeader.colMap, 'Item');
  var sourceItem = sourceItemCol === -1 ? '' : String(sourceRange.getValues()[0][sourceItemCol] || '').trim();
  if (!hubItem || hubItem !== sourceItem) {
    return { error: 'Listing Hub and ' + sourceTab + ' row ' + sourceRow + ' disagree about ' + itemId + ' ("' + hubItem + '" vs "' + sourceItem + '"). Nothing was changed.' };
  }
  var field = function (name) { var i = colIndex(hub.colMap, name); return i === -1 ? '' : hubValues[i]; };
  return {
    hub: hub, hubRange: hubRange, sourceSheet: sourceSheet, sourceTab: sourceTab, sourceRow: sourceRow,
    sourceRange: sourceRange, field: field,
  };
}

function removeItem(body) {
  var itemId = String(body.itemId || '').trim();
  var mode = body.mode;
  if (!itemId || (mode !== 'delete' && mode !== 'saveForLater')) return { ok: false, error: 'Missing itemId, or mode is not delete/saveForLater.' };

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var loc = locateItem(itemId);
    if (loc.error) return { ok: false, error: loc.error };

    var queue = tableRowsForItem(POSTING_QUEUE_SHEET, ['Listing ID'], itemId);
    var qStatus = colIndex(queue.colMap || {}, 'Status');
    var qUrl = colIndex(queue.colMap || {}, 'Listing URL');
    var qPlatform = colIndex(queue.colMap || {}, 'Platform');
    var qListing = colIndex(queue.colMap || {}, 'Listing ID');
    var live = queue.rows.filter(function (r) {
      return qStatus !== -1 && String(r.values[qStatus]) === 'Active' && qUrl !== -1 && String(r.values[qUrl] || '').trim();
    }).map(function (r) { return r.values[qPlatform]; });

    var related = mode === 'delete' ? {
      queue: queue,
      descriptions: tableRowsForItem(DESCRIPTIONS_SHEET, ['Item ID', 'Listing ID'], itemId),
      photos: tableRowsForItem(PHOTOS_SHEET_NAME, ['Item ID'], itemId),
      metrics: tableRowsForItem(METRICS_SHEET_NAME, ['Item ID'], itemId),
    } : null;

    var summary = {
      itemId: itemId, mode: mode, sourceTab: loc.sourceTab, sourceRow: loc.sourceRow, hubRow: loc.hub.row,
      item: loc.field('Item'), liveListings: live, queueRows: queue.rows.length,
    };
    if (related) {
      summary.descriptionRows = related.descriptions.rows.length;
      summary.photoRows = related.photos.rows.length;
      summary.metricRows = related.metrics.rows.length;
    }
    if (body.dryRun) return { ok: true, dryRun: true, summary: summary };

    if (mode === 'saveForLater') {
      var statuses = {};
      queue.rows.forEach(function (r) { statuses[r.values[qListing]] = r.values[qStatus]; });
      upsertRecords(getSavedSheet(), SAVED_HEADERS, [{
        'Item ID': itemId, 'Date Saved': todayIso(), 'Reason': body.reason || '',
        'Category': loc.field('Category'), 'Brand': loc.field('Brand'), 'Size': loc.field('Size'), 'Item': loc.field('Item'),
        'Condition': loc.field('Condition'), 'Est. value': loc.field('Est. value'), 'List price': loc.field('List price'),
        'Floor price': loc.field('Floor price'), 'Platforms': loc.field('Platforms'),
        'Live Listings When Saved': live.join(', '), 'Source Tab': loc.sourceTab, 'Source Row': loc.sourceRow,
        'Original Source Row (JSON)': JSON.stringify(snapshotRow(loc.sourceRange)),
        'Original Hub Row (JSON)': JSON.stringify({ row: loc.hub.row, cells: snapshotRow(loc.hubRange) }),
        'Queue Statuses (JSON)': JSON.stringify(statuses),
      }], function (get) { return String(get('Item ID') || ''); });
    }

    loc.sourceRange.clearContent();
    loc.hub.sheet.deleteRow(loc.hub.row);

    if (mode === 'saveForLater') {
      queue.rows.forEach(function (r) { if (qStatus !== -1) queue.sheet.getRange(r.row, qStatus + 1).setValue('Saved for later'); });
    } else {
      // Bottom-up so earlier deletions don't shift the rows still to delete.
      ['queue', 'descriptions', 'photos', 'metrics'].forEach(function (key) {
        var set = related[key];
        set.rows.map(function (r) { return r.row; }).sort(function (a, b) { return b - a; })
          .forEach(function (row) { set.sheet.deleteRow(row); });
      });
    }

    logItemAction(itemId, mode === 'delete' ? 'Deleted Item' : 'Saved for Later',
      [loc.field('Item'), body.reason || ''].filter(String).join(' — '));
    invalidateBootCache();
    return { ok: true, summary: summary };
  } finally {
    lock.releaseLock();
  }
}

// Puts a Saved for Later item back: its source row (if that row is still
// blank), a Listing Hub row with its formulas, and its posting-queue statuses.
function restoreItem(body) {
  var itemId = String(body.itemId || '').trim();
  if (!itemId) return { ok: false, error: 'Missing itemId.' };
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var saved = getSavedSheet();
    var t = readTable(saved, ['Item ID']);
    var idx = -1;
    t.rows.forEach(function (r, i) { if (String(val(r, t.colMap, 'Item ID')) === itemId) idx = i; });
    if (idx === -1) return { ok: false, error: itemId + ' is not in Saved for Later.' };
    var rec = t.rows[idx];
    if (!findHubRow(itemId).error) return { ok: false, error: itemId + ' is already in the inventory.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sourceSheet = ss.getSheetByName(String(val(rec, t.colMap, 'Source Tab')));
    var sourceRow = Number(val(rec, t.colMap, 'Source Row'));
    var sourceCells = snapshotToCells(JSON.parse(val(rec, t.colMap, 'Original Source Row (JSON)')));
    var hubSnap = JSON.parse(val(rec, t.colMap, 'Original Hub Row (JSON)'));
    if (!sourceSheet || !sourceRow) return { ok: false, error: 'The saved record is missing its source tab or row.' };
    var target = sourceSheet.getRange(sourceRow, 1, 1, sourceCells.length);
    var occupied = target.getValues()[0].some(function (v) { return v !== '' && v !== null; });
    if (occupied) return { ok: false, error: sourceSheet.getName() + ' row ' + sourceRow + ' has been reused, so it cannot be restored there. Nothing was changed.' };

    // New hub row goes after the last row that has an Item ID. Formulas that
    // refer to their own hub row (A5, V5…) move with it; references into the
    // source tabs ('Tab'!A5) and absolute ranges ($B$2:$B$166) stay as saved.
    var hubSheet = ss.getSheetByName(LISTING_HUB_SHEET);
    var hubTable = readTable(hubSheet, ['Item ID']);
    var idCol = colIndex(hubTable.colMap, 'Item ID');
    var lastWithId = hubTable.headerSheetRow;
    hubTable.rows.forEach(function (r, i) { if (String(r[idCol]).trim()) lastWithId = hubTable.headerSheetRow + 1 + i; });
    var newHubRow = lastWithId + 1;
    if (newHubRow <= hubSheet.getLastRow()) hubSheet.insertRowAfter(lastWithId);
    var oldHubRow = Number(hubSnap.row);
    var selfRef = new RegExp("(^|[^!$A-Za-z0-9_'])(\\$?[A-Z]{1,3})" + oldHubRow + "(?![0-9])", 'g');
    var hubCells = snapshotToCells(hubSnap.cells).map(function (c, i) {
      return hubSnap.cells[i][0] === 'f' ? String(c).replace(selfRef, function (m, pre, col) { return pre + col + newHubRow; }) : c;
    });

    target.setValues([sourceCells]);
    hubSheet.getRange(newHubRow, 1, 1, hubCells.length).setValues([hubCells]);

    var statuses = JSON.parse(val(rec, t.colMap, 'Queue Statuses (JSON)') || '{}');
    var queue = tableRowsForItem(POSTING_QUEUE_SHEET, ['Listing ID'], itemId);
    var qStatus = colIndex(queue.colMap || {}, 'Status');
    var qListing = colIndex(queue.colMap || {}, 'Listing ID');
    queue.rows.forEach(function (r) {
      var prev = statuses[r.values[qListing]];
      if (qStatus !== -1 && prev !== undefined && String(r.values[qStatus]) === 'Saved for later') queue.sheet.getRange(r.row, qStatus + 1).setValue(prev);
    });

    saved.deleteRow(t.headerSheetRow + 1 + idx);
    logItemAction(itemId, 'Restored from Saved for Later', '');
    invalidateBootCache();
    return { ok: true, hubRow: newHubRow, sourceRow: sourceRow };
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------
// Sales and platform balances — what each site sold for, what you kept,
// and the cash each site is holding. Sales: one row per sale. Platform
// Balances: one snapshot per day per site (available vs. pending), so the
// Stats tab shows the latest and older ones stay as a record.
// ---------------------------------------------------------------------

var SALES_SHEET_NAME = 'Sales';
var SALES_HEADERS = [
  'Sale ID', 'Date Sold', 'Item ID', 'Item', 'Platform', 'Sale Price', 'Shipping Charged', 'Order Total',
  'Platform Fees', 'Shipping Label', 'Net Cash', 'Funds Status', 'Order ID', 'Source', 'Notes', 'Last Updated',
  'Cash Status', 'Cash Status Date', 'Cash Note',
];
var SALES_FIELD_HEADERS = {
  saleId: 'Sale ID', dateSold: 'Date Sold', itemId: 'Item ID', item: 'Item', platform: 'Platform',
  salePrice: 'Sale Price', shippingCharged: 'Shipping Charged', orderTotal: 'Order Total', platformFees: 'Platform Fees',
  shippingLabel: 'Shipping Label', netCash: 'Net Cash', fundsStatus: 'Funds Status', orderId: 'Order ID',
  source: 'Source', notes: 'Notes',
  // Cash flow, set by Randy rather than read off a site: blank = not planned
  // for yet, "Accounted" = budgeted around but still on the site, "Cashed out"
  // = withdrawn and used.
  cashStatus: 'Cash Status', cashStatusDate: 'Cash Status Date', cashNote: 'Cash Note',
};

var BALANCES_SHEET_NAME = 'Platform Balances';
var BALANCES_HEADERS = ['Date', 'Platform', 'Available', 'Pending', 'Source', 'Notes'];

function salesPlatformKey(platform) {
  var p = String(platform || '').toLowerCase();
  if (p.indexOf('ebay') !== -1) return 'ebay';
  if (p.indexOf('posh') !== -1) return 'poshmark';
  if (p.indexOf('facebook') !== -1 || p.indexOf('marketplace') !== -1) return 'facebook';
  if (p.indexOf('depop') !== -1) return 'depop';
  if (p.indexOf('grailed') !== -1) return 'grailed';
  if (p.indexOf('mercari') !== -1) return 'mercari';
  return opportunityIdFor(p);
}

function getSalesSheet() { return getOrCreateSheet(SALES_SHEET_NAME, SALES_HEADERS); }
function getBalancesSheet() { return getOrCreateSheet(BALANCES_SHEET_NAME, BALANCES_HEADERS); }

function numOrBlank(v) {
  if (v === '' || v === null || v === undefined) return '';
  var n = Number(String(v).replace(/[$,]/g, ''));
  return isNaN(n) ? '' : n;
}

function getSales() {
  return readRecords(getSalesSheet()).filter(function (r) { return r['Sale ID']; }).map(function (r) {
    var out = {};
    Object.keys(SALES_FIELD_HEADERS).forEach(function (k) { out[k] = r[SALES_FIELD_HEADERS[k]]; });
    out.lastUpdated = r['Last Updated'];
    return out;
  });
}

function getBalances() {
  return readRecords(getBalancesSheet()).filter(function (r) { return r['Platform']; }).map(function (r) {
    return { date: r['Date'], platform: r['Platform'], available: r['Available'], pending: r['Pending'], source: r['Source'], notes: r['Notes'] };
  });
}

function getSalesBundle() {
  return { sales: getSales(), balances: getBalances() };
}

// Upserts sales by Sale ID (defaults to "<site>-<order id>" or "<site>-<item id>",
// so marking the same item sold twice on the same site never double-counts).
// syncInventory: also writes Sold price and Net cash back to the item's row in
// its source tab, keeping the inventory in step with what the site paid out.
function upsertSales(body) {
  var today = todayIso();
  var records = (body.rows || []).map(function (row) {
    var key = salesPlatformKey(row.platform);
    var rec = {};
    Object.keys(SALES_FIELD_HEADERS).forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(row, k)) return;
      var money = ['salePrice', 'shippingCharged', 'orderTotal', 'platformFees', 'shippingLabel', 'netCash'].indexOf(k) !== -1;
      rec[SALES_FIELD_HEADERS[k]] = money ? numOrBlank(row[k]) : row[k];
    });
    rec['Sale ID'] = row.saleId || (key + '-' + (row.orderId || row.itemId || ''));
    rec['Last Updated'] = today;
    return rec;
  }).filter(function (rec) { return rec['Sale ID'] && !/-$/.test(rec['Sale ID']); });
  if (!records.length) return { ok: false, error: 'No sales with a platform and an item or order ID.' };

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var res;
  try {
    res = upsertRecords(getSalesSheet(), SALES_HEADERS, records, function (get) { return String(get('Sale ID') || ''); });
  } finally {
    lock.releaseLock();
  }

  var synced = [];
  if (body.syncInventory) {
    var hub = readTable(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LISTING_HUB_SHEET), ['Item ID']);
    (body.rows || []).forEach(function (row) {
      if (!row.itemId) return;
      var hubRow = hub.rows.filter(function (r) { return String(val(r, hub.colMap, 'Item ID')) === String(row.itemId); })[0];
      if (!hubRow) return;
      var located = findSourceRow(row.itemId, val(hubRow, hub.colMap, 'Source tab'));
      if (located.error) return;
      var header = findHeaderRow(located.sourceSheet, ['Status']);
      if (!header) return;
      var soldCol = colIndex(header.colMap, 'Sold price');
      var netCol = colIndex(header.colMap, 'Net cash');
      if (soldCol !== -1 && numOrBlank(row.salePrice) !== '') located.sourceSheet.getRange(located.row, soldCol + 1).setValue(numOrBlank(row.salePrice));
      if (netCol !== -1 && numOrBlank(row.netCash) !== '') located.sourceSheet.getRange(located.row, netCol + 1).setValue(numOrBlank(row.netCash));
      synced.push(row.itemId);
    });
  }
  invalidateBootCache();
  return { ok: true, updated: res.updated, added: res.added, syncedInventory: synced };
}

// One snapshot per day per site; re-sending the same day replaces it.
function setBalances(body) {
  var today = todayIso();
  var records = (body.rows || [body]).filter(function (row) { return row.platform; }).map(function (row) {
    return {
      'Date': row.date || today, 'Platform': row.platform,
      'Available': numOrBlank(row.available), 'Pending': numOrBlank(row.pending),
      'Source': row.source || 'Entered on site', 'Notes': row.notes || '',
    };
  });
  if (!records.length) return { ok: false, error: 'No balance rows with a platform.' };
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var res = upsertRecords(getBalancesSheet(), BALANCES_HEADERS, records, function (get) {
      var d = get('Date');
      if (Object.prototype.toString.call(d) === '[object Date]') d = formatDate(d);
      return get('Platform') ? d + '|' + salesPlatformKey(get('Platform')) : '';
    });
    invalidateBootCache();
    return { ok: true, updated: res.updated, added: res.added };
  } finally {
    lock.releaseLock();
  }
}

// Kept for the original manual eBay pull, which sends one term at a time.
function upsertTrendRow(searchTerm, platform, avgPrice, salesFound, sellThrough, imageUrl, category) {
  upsertMarketObservations([{
    searchTerm: searchTerm, platform: platform, avgPrice: avgPrice, salesFound: salesFound,
    sellThrough: sellThrough, imageUrl: imageUrl, category: category,
  }]);
}

// Everything Acquire needs in one request. Apps Script GETs are slow and
// flaky when several run at once, so the tab loads this instead of four calls.
function getAcquireBundle() {
  return {
    watchlist: getAcquire(),
    trends: getTrends(),
    history: getMarketHistory(),
    intel: getSourcingIntel(),
    platformTrends: getPlatformTrends(),
    generatedAt: new Date().toISOString(),
  };
}

// CacheService caps each key at 100KB; bootBundle JSON is ~360KB, so store it
// in chunks of ≤90KB under key__0..key__(n-1) with key__n = chunk count.
var BOOT_BUNDLE_CACHE_KEY = 'bootBundle_v1';
var BOOT_BUNDLE_CACHE_TTL = 120; // seconds
var CACHE_CHUNK_MAX = 90000; // leave headroom under the 100KB per-key limit

function cachePutChunked(cache, key, str, ttlSeconds) {
  var n = Math.ceil(str.length / CACHE_CHUNK_MAX) || 1;
  cache.put(key + '__n', String(n), ttlSeconds);
  for (var i = 0; i < n; i++) {
    cache.put(key + '__' + i, str.substring(i * CACHE_CHUNK_MAX, (i + 1) * CACHE_CHUNK_MAX), ttlSeconds);
  }
}

function cacheGetChunked(cache, key) {
  var nStr = cache.get(key + '__n');
  if (nStr === null || nStr === undefined) return null;
  var n = Number(nStr);
  if (!n || isNaN(n)) return null;
  var parts = [];
  for (var i = 0; i < n; i++) {
    var part = cache.get(key + '__' + i);
    if (part === null || part === undefined) return null;
    parts.push(part);
  }
  return parts.join('');
}

function invalidateBootCache() {
  var cache = CacheService.getScriptCache();
  var key = BOOT_BUNDLE_CACHE_KEY;
  var nStr = cache.get(key + '__n');
  if (nStr === null || nStr === undefined) return;
  var n = Number(nStr);
  if (n && !isNaN(n)) {
    for (var i = 0; i < n; i++) cache.remove(key + '__' + i);
  }
  cache.remove(key + '__n');
}

// First-page datasets in one request. Apps Script cold starts are slow when the
// site fires ~7 parallel GETs on load, so boot uses this instead (with a
// fallback to the individual actions if an older deployment is still live).
// Served from a 2-minute chunked ScriptCache when warm.
function getBootBundle() {
  var cache = CacheService.getScriptCache();
  var cached = cacheGetChunked(cache, BOOT_BUNDLE_CACHE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {
      // Corrupt/incomplete cache — rebuild below.
    }
  }
  var payload = {
    inventory: getInventory(),
    descriptions: getDescriptions(),
    postingQueue: getPostingQueue(),
    metrics: getMetrics(),
    photos: getPhotos(),
    itemActions: getItemActions(),
    localDeals: getLocalDeals(),
    generatedAt: new Date().toISOString(),
  };
  try {
    cachePutChunked(cache, BOOT_BUNDLE_CACHE_KEY, JSON.stringify(payload), BOOT_BUNDLE_CACHE_TTL);
  } catch (e) {
    // Cache write can fail on size/quota; still return the fresh payload.
  }
  return payload;
}

// Refreshes the Poshmark side of both the Acquire Watchlist comps and the
// Market Trends tab. Called automatically by the daily trigger
// (setupMarketDataTrigger) — can also be run manually to force an update.
// Does NOT touch eBay columns/rows — those come from a separate manual
// Terapeak pull (see setAcquireEbayData / setTrendEbayData) since eBay
// blocks this kind of automated request (see the header comment above).
function refreshMarketData() {
  var acqSheet = getAcquireSheet();
  var acqData = acqSheet.getDataRange().getValues();
  var acqCategory = colIndex(buildColMap(acqData[0] || []), 'Category');
  var acqSubcategory = colIndex(buildColMap(acqData[0] || []), 'Subcategory');
  for (var r = 1; r < acqData.length; r++) {
    if (!acqData[r][0]) continue;
    if (!isFashionCategory(acqCategory === -1 ? '' : acqData[r][acqCategory], acqSubcategory === -1 ? '' : acqData[r][acqSubcategory])) continue;
    // Brand + Item Type + Size + Color, so the comp matches what you'd
    // actually be looking for at the thrift, not just the broad category.
    refreshAcquireRow(acqSheet, r + 1, acqData[r][1], acqData[r][2], acqData[r][3], acqData[r][4]);
    Utilities.sleep(1500);
  }

  // The original candidate list plus any Sourcing Intel row that names a
  // Poshmark query — Poshmark only has meaningful comps for fashion-type
  // items, so intel rows opt in rather than every research target being searched.
  var terms = {};
  TREND_CANDIDATES.forEach(function (c) { terms[c.term] = { term: c.term, query: c.term, category: c.category }; });
  getSourcingIntel().forEach(function (row) {
    var active = String(row.active === '' || row.active === undefined ? 'Y' : row.active).toUpperCase();
    if (!row.poshmarkQuery || active === 'N' || active === 'NO' || active === 'FALSE') return;
    terms[row.searchTerm] = { term: row.searchTerm, query: row.poshmarkQuery, category: row.subcategory || row.category, opportunityId: row.opportunityId };
  });

  var observations = [];
  Object.keys(terms).forEach(function (key) {
    var t = terms[key];
    var r = searchPoshmarkSold(t.query);
    if (r.count) {
      // Poshmark's search shows sold listings only, with no active-supply count
      // or sell-through, so those stay blank rather than being guessed.
      observations.push({
        searchTerm: t.term, opportunityId: t.opportunityId, platform: 'Poshmark', category: t.category,
        avgPrice: r.avgPrice, medianPrice: r.medianPrice, lowPrice: r.lowPrice, highPrice: r.highPrice,
        salesFound: r.count, sampleSize: r.count, imageUrl: r.imageUrl, source: 'Poshmark sold search',
      });
    }
    Utilities.sleep(1500);
  });
  if (observations.length) upsertMarketObservations(observations);
}

// Manual write paths for eBay/Terapeak data, pulled through a live browser
// session and pushed in via POST (see the header comment above for why
// this can't be automated the way Poshmark's refresh is).
function setAcquireEbayData(body) {
  var sheet = getAcquireSheet();
  var data = sheet.getDataRange().getValues();
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][0]) === String(body.id)) {
      sheet.getRange(r + 1, 12, 1, 2).setValues([[body.avgPrice || '', body.salesFound || '']]);
      sheet.getRange(r + 1, 16).setValue(today);
      sheet.getRange(r + 1, 17).setValue(body.sellThrough || '');
      return { ok: true };
    }
  }
  return { ok: false, error: 'Acquire item not found: ' + body.id };
}

function setTrendEbayData(body) {
  upsertMarketObservations([{
    searchTerm: body.searchTerm, platform: 'eBay', avgPrice: body.avgPrice, salesFound: body.salesFound,
    sellThrough: body.sellThrough, source: body.source || 'eBay sold search',
  }]);
  return { ok: true };
}

// One-time cleanup: removes leftover rows from before the Platform column
// existed in Market Trends (they have a blank Platform and garbage in the
// other columns from the old 4-column layout). Safe to run more than once —
// it only ever removes rows with a blank Platform. Run this once from the
// Run menu, then it's done for good; no need to keep it around after.
function cleanupOldTrendRows() {
  var sheet = getTrendsSheet();
  var data = sheet.getDataRange().getValues();
  var current = {};
  TREND_CANDIDATES.forEach(function (c) { current[c.term] = true; });
  // Research targets added through Sourcing Intel are current too — without
  // this, running the cleanup would delete every non-apparel opportunity.
  getSourcingIntel().forEach(function (row) { if (row.searchTerm) current[row.searchTerm] = true; });
  var removed = 0;
  for (var r = data.length - 1; r >= 1; r--) {
    var isBlankPlatform = data[r][0] && !data[r][1];
    var isStaleTerm = data[r][0] && !current[data[r][0]];
    if (isBlankPlatform || isStaleTerm) {
      sheet.deleteRow(r + 1);
      removed++;
    }
  }
  Logger.log('Removed %s stale row(s) from Market Trends.', removed);
  return { removed: removed };
}

// Lets maintenance functions be triggered over HTTP (from clasp/curl) instead
// of needing the Apps Script editor's Run menu. Whitelisted by name on purpose.
function runMaintenance(task) {
  var allowed = {
    cleanupOldTrendRows: cleanupOldTrendRows,
    refreshMarketData: refreshMarketData,
    setupMarketDataTrigger: setupMarketDataTrigger
  };
  var fn = allowed[task];
  if (!fn) return { error: 'unknown task: ' + task };
  var result = fn();
  return { ok: true, task: task, result: result || null };
}

function debugPoshmark(query) {
  return searchPoshmarkSold(query || 'Timberland pants', true);
}

// Extracts the exact JSON substring for window.__INITIAL_STATE__={...} by
// walking brace depth (safer than regex for a multi-MB minified blob).
function extractInitialStateJson(html) {
  var marker = 'window.__INITIAL_STATE__=';
  var start = html.indexOf(marker);
  if (start === -1) return null;
  var i = start + marker.length;
  if (html.charAt(i) !== '{') return null;
  var depth = 0, inStr = false, strCh = '', esc = false;
  for (var j = i; j < html.length; j++) {
    var c = html.charAt(j);
    if (inStr) {
      if (esc) { esc = false; }
      else if (c === '\\') { esc = true; }
      else if (c === strCh) { inStr = false; }
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; strCh = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return html.slice(i, j + 1);
    }
  }
  return null;
}

function setupMarketDataTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'refreshMarketData') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('refreshMarketData').timeBased().everyDays(1).create();
  refreshMarketData(); // run once immediately so there's data right away, not just after tomorrow's trigger
}

// ---------------------------------------------------------------------
// Local Deals — the in-person side of selling (Facebook Marketplace and
// anything else handed over face to face). A listing being "Pending" or
// having a meetup booked isn't a listing status and isn't a sale yet, so
// it lives in its own tab rather than being squeezed into the posting
// queue. One row per item x platform; setting the status to "" clears it.
// ---------------------------------------------------------------------
var LOCAL_DEALS_SHEET_NAME = 'Local Deals';
var LOCAL_DEALS_HEADERS = ['Item ID', 'Platform', 'Status', 'Buyer', 'When', 'Where', 'Note', 'Updated'];

function getLocalDealsSheet() { return getOrCreateSheet(LOCAL_DEALS_SHEET_NAME, LOCAL_DEALS_HEADERS); }

function getLocalDeals() {
  return readRecords(getLocalDealsSheet())
    .filter(function (r) { return String(r['Item ID'] || '').trim(); })
    .map(function (r) {
      return {
        itemId: String(r['Item ID'] || '').trim(),
        platform: String(r['Platform'] || '').trim(),
        status: String(r['Status'] || '').trim(),
        buyer: String(r['Buyer'] || '').trim(),
        when: String(r['When'] || '').trim(),
        where: String(r['Where'] || '').trim(),
        note: String(r['Note'] || '').trim(),
        updated: String(r['Updated'] || '').trim(),
      };
    });
}

// Upsert by Item ID + Platform. A blank status deletes the row, so
// "nothing going on with this one" leaves no stale meetup behind.
function setLocalDeal(body) {
  var itemId = String(body.itemId || '').trim();
  var platform = String(body.platform || '').trim();
  if (!itemId || !platform) return { ok: false, error: 'Missing itemId or platform.' };

  var sheet = getLocalDealsSheet();
  var lastCol = sheet.getLastColumn();
  var headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var colOf = {};
  headerRow.forEach(function (h, c) { if (String(h).trim()) colOf[String(h).trim().toLowerCase()] = c; });
  var lastRow = sheet.getLastRow();
  var values = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
  var target = -1;
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][colOf['item id']] || '').trim() === itemId &&
        String(values[i][colOf['platform']] || '').trim().toLowerCase() === platform.toLowerCase()) { target = i; break; }
  }

  var status = String(body.status || '').trim();
  if (!status) {
    if (target === -1) return { ok: true, cleared: 0 };
    sheet.deleteRow(target + 2);
    invalidateBootCache();
    return { ok: true, cleared: 1 };
  }

  var row = target === -1 ? new Array(lastCol).fill('') : values[target];
  var set = function (name, value) { var c = colOf[name]; if (c !== undefined) row[c] = value; };
  set('item id', itemId);
  set('platform', platform);
  set('status', status);
  set('buyer', String(body.buyer || ''));
  set('when', String(body.when || ''));
  set('where', String(body.where || ''));
  set('note', String(body.note || ''));
  set('updated', todayIso());
  var rowIndex = target === -1 ? sheet.getLastRow() + 1 : target + 2;
  // "Fri Sep 18, 9:00 AM" is a note to a human, not a date — without a plain-text
  // format Sheets parses it and the time is lost.
  if (colOf['when'] !== undefined) {
    sheet.getRange(rowIndex, colOf['when'] + 1).setNumberFormat('@');
    SpreadsheetApp.flush(); // the format has to land before the value, or Sheets parses it first
  }
  sheet.getRange(rowIndex, 1, 1, lastCol).setValues([row]);
  invalidateBootCache();
  return { ok: true, saved: 1, row: rowIndex };
}

// ---------------------------------------------------------------------
// Platform Trends — what a selling platform itself says is being searched
// for right now (Depop's "Popular this week" is the first source). This is
// demand the market data can't see: search interest, not completed sales.
// One row per date x platform x term, so repeat pulls are idempotent and
// the week-over-week shape is kept.
// ---------------------------------------------------------------------
var PLATFORM_TRENDS_SHEET_NAME = 'Platform Trends';
var PLATFORM_TRENDS_HEADERS = ['Date', 'Platform', 'Term', 'Searches', 'Search Delta', 'Rank', 'URL', 'Source'];

function getPlatformTrendsSheet() { return getOrCreateSheet(PLATFORM_TRENDS_SHEET_NAME, PLATFORM_TRENDS_HEADERS); }

function getPlatformTrends() {
  return readRecords(getPlatformTrendsSheet())
    .filter(function (r) { return String(r['Term'] || '').trim(); })
    .map(function (r) {
      return {
        date: String(r['Date'] || '').trim(),
        platform: String(r['Platform'] || '').trim(),
        term: String(r['Term'] || '').trim(),
        searches: r['Searches'] === '' ? null : Number(r['Searches']),
        searchDelta: String(r['Search Delta'] || '').trim(),
        rank: r['Rank'] === '' ? null : Number(r['Rank']),
        url: String(r['URL'] || '').trim(),
        source: String(r['Source'] || '').trim(),
      };
    });
}

function setPlatformTrends(body) {
  var rows = body.rows || [];
  if (!rows.length) return { ok: false, error: 'No rows given.' };
  var date = String(body.date || todayIso());
  var records = rows.map(function (r, i) {
    return {
      'Date': String(r.date || date),
      'Platform': String(r.platform || body.platform || ''),
      'Term': String(r.term || ''),
      'Searches': r.searches === undefined || r.searches === null || r.searches === '' ? '' : Number(r.searches),
      'Search Delta': String(r.searchDelta || ''),
      'Rank': r.rank === undefined || r.rank === null || r.rank === '' ? (i + 1) : Number(r.rank),
      'URL': String(r.url || ''),
      'Source': String(r.source || body.source || ''),
    };
  }).filter(function (r) { return r['Term'] && r['Platform']; });
  var res = upsertRecords(getPlatformTrendsSheet(), PLATFORM_TRENDS_HEADERS, records, function (get) {
    var term = String(get('Term') || '').trim().toLowerCase();
    if (!term) return '';
    return [String(get('Date') || '').slice(0, 10), String(get('Platform') || '').trim().toLowerCase(), term].join('|');
  });
  return { ok: true, updated: res.updated, added: res.added };
}

// Several metric rows in one request. The daily stats pull writes ~100 rows;
// one POST per row spends most of its time on round trips.
function addMetricEntries(body) {
  var rows = body.rows || [];
  if (!rows.length) return { ok: false, error: 'No rows given.' };
  var date = String(body.date || '').trim() || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var sheet = getMetricsSheet();
  var values = rows.map(function (r) {
    return [
      String(r.date || date), r.listingId || '', r.itemId || '', r.platform || '',
      r.impressions || 0, r.views || 0, r.watchers || 0, r.clicks || 0,
      r.price === undefined || r.price === null ? '' : r.price, r.source || body.source || 'manual',
    ];
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, values[0].length).setValues(values);
  invalidateBootCache();
  return { ok: true, added: values.length, date: date };
}



// ---------------------------------------------------------------------
// Stocking — intake front door into the existing sell pipeline.
// Data lives ONLY in this workbook (getActiveSpreadsheet), and nothing here
// calls out to an AI or anywhere else. A pasted entry is parked as-is in the
// 'pasted' stage until someone works through it; processing is always a
// deliberate step, never a side effect of saving.
// ---------------------------------------------------------------------

var STOCKING_SHEET_NAME = 'Stocking';
var STOCKING_HEADERS = [
  'Stocking ID', 'Item ID', 'Stage', 'Created', 'Updated', 'Product', 'Brand', 'Model',
  'Version', 'Notes', 'Source Tab', 'Analysis Summary', 'Error', 'Raw Entry'
];
var STOCKING_STAGES = {
  PASTED: 'pasted',
  NEEDS_ANALYSIS: 'needs_analysis',
  DETAILS_NEEDED: 'details_needed',
  READY_FOR_DRAFTS: 'ready_for_drafts',
  READY_TO_POST: 'ready_to_post',
  DONE: 'done'
};
var CLOTHING_INVENTORY_SHEET = 'Clothing Sell Inventory';
var NON_CLOTHING_INVENTORY_SHEET = 'Non Clothing Sell Inventory';
var LISTING_QUESTIONS_ALIASES = ['Listing Questions', 'Listing Questions'];
var ADDING_INVENTORY_ALIASES = ['Adding to Selling Inventory', 'Adding to Selling Inventory'];

function findSheetByAliases_(aliases) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var i, s, sheets, want;
  for (i = 0; i < aliases.length; i++) {
    s = ss.getSheetByName(aliases[i]);
    if (s) return s;
  }
  want = aliases.map(function (a) { return String(a).toLowerCase(); });
  sheets = ss.getSheets();
  for (i = 0; i < sheets.length; i++) {
    if (want.indexOf(String(sheets[i].getName()).toLowerCase()) !== -1) return sheets[i];
  }
  return null;
}

function getStockingSheet() {
  return getOrCreateSheet(STOCKING_SHEET_NAME, STOCKING_HEADERS);
}

function getListingQuestionsSheet_() {
  return findSheetByAliases_(LISTING_QUESTIONS_ALIASES);
}

function getAddingInventorySheet_() {
  return findSheetByAliases_(ADDING_INVENTORY_ALIASES);
}

function nowStamp_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

function nextPrefixedId_(prefix) {
  var hub = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LISTING_HUB_SHEET);
  var max = 0;
  var t, i, id, m, records;
  if (hub) {
    t = readTable(hub, ['Item ID']);
    for (i = 0; i < t.rows.length; i++) {
      id = String(val(t.rows[i], t.colMap, 'Item ID') || '');
      m = id.match(new RegExp('^' + prefix + '-(\\d+)$', 'i'));
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  records = readRecords(getStockingSheet());
  records.forEach(function (r) {
    id = String(r['Item ID'] || '');
    m = id.match(new RegExp('^' + prefix + '-(\\d+)$', 'i'));
    if (m) max = Math.max(max, Number(m[1]));
  });
  return prefix + '-' + ('000' + (max + 1)).slice(-3);
}

function nextStockingId_() {
  var records = readRecords(getStockingSheet());
  var max = 0;
  records.forEach(function (r) {
    var m = String(r['Stocking ID'] || '').match(/^STK-(\d+)$/i);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return 'STK-' + ('000' + (max + 1)).slice(-3);
}

function getStocking() {
  return readRecords(getStockingSheet()).filter(function (r) {
    return r['Stocking ID'] || r['Item ID'];
  }).map(function (r) {
    return {
      stockingId: String(r['Stocking ID'] || ''),
      itemId: String(r['Item ID'] || ''),
      stage: String(r['Stage'] || ''),
      created: String(r['Created'] || ''),
      updated: String(r['Updated'] || ''),
      product: String(r['Product'] || ''),
      brand: String(r['Brand'] || ''),
      model: String(r['Model'] || ''),
      version: String(r['Version'] || ''),
      notes: String(r['Notes'] || ''),
      sourceTab: String(r['Source Tab'] || ''),
      analysisSummary: String(r['Analysis Summary'] || ''),
      error: String(r['Error'] || ''),
      rawEntry: String(r['Raw Entry'] || '')
    };
  });
}

function findStockingRow_(stockingId, itemId) {
  var sheet = getStockingSheet();
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return null;
  var headers = data[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var idCol = headers.indexOf('stocking id');
  var itemCol = headers.indexOf('item id');
  var r;
  for (r = 1; r < data.length; r++) {
    if (stockingId && idCol !== -1 && String(data[r][idCol]) === String(stockingId)) {
      return { sheet: sheet, row: r + 1, headers: headers, values: data[r] };
    }
    if (itemId && itemCol !== -1 && String(data[r][itemCol]) === String(itemId)) {
      return { sheet: sheet, row: r + 1, headers: headers, values: data[r] };
    }
  }
  return null;
}

function setStockingCell_(located, headerName, value) {
  var col = located.headers.indexOf(String(headerName).toLowerCase());
  if (col === -1) return;
  located.sheet.getRange(located.row, col + 1).setValue(value);
}

function appendInventoryRow_(isClothing, body) {
  var tabName = isClothing ? CLOTHING_INVENTORY_SHEET : NON_CLOTHING_INVENTORY_SHEET;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tabName);
  if (!sheet) return { error: 'Could not find "' + tabName + '" tab.' };
  var header = findHeaderRow(sheet, ['Status']);
  if (!header) return { error: 'Could not find Status header in ' + tabName + '.' };
  var headerRow = header.rowIndex + 1;
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0];
  var colMap = buildColMap(headers);
  var targetRow = Math.max(sheet.getLastRow() + 1, headerRow + 1);
  var rowVals = [];
  var c;
  for (c = 0; c < lastCol; c++) rowVals.push('');
  function set(name, value) {
    var idx = colIndex(colMap, name);
    if (idx !== -1) rowVals[idx] = value;
  }
  set('Status', 'Identify');
  set('Category', body.category || (isClothing ? 'Clothing' : ''));
  if (isClothing) {
    set('Clothing Type', body.clothingType || body.type || '');
    set('Brand', body.brand || '');
    set('Size', body.size || '');
    set('Item # (if possible)', body.itemNumber || body.model || '');
  }
  set('Item', body.product || body.item || '');
  set('Condition', body.condition || '');
  set('Est. value', body.estValue || '');
  set('List price', body.listPrice || '');
  set('Floor price', body.floorPrice || '');
  set('Platform / venue', body.platforms || body.platform || '');
  sheet.getRange(targetRow, 1, 1, lastCol).setValues([rowVals]);
  return { tabName: tabName, row: targetRow, sheet: sheet };
}

function hubIfFormula_(tabName, colLetter, sourceRow) {
  return "=IF('" + tabName + "'!" + colLetter + sourceRow + '="","",\'' + tabName + "'!" + colLetter + sourceRow + ')';
}

function buildHubRowValues_(itemId, tabName, sourceRow, hubRow) {
  var row = [];
  var i;
  for (i = 0; i < 25; i++) row.push('');
  row[0] = itemId;
  row[1] = tabName;
  row[2] = sourceRow;
  var isClothing = tabName === CLOTHING_INVENTORY_SHEET;
  if (isClothing) {
    [[3,'A'],[4,'B'],[5,'C'],[6,'D'],[7,'E'],[8,'F'],[9,'G'],[10,'H'],[11,'I'],[12,'J'],[13,'K'],[14,'L'],[17,'M'],[18,'N'],[19,'O'],[20,'P']].forEach(function (pair) {
      row[pair[0]] = hubIfFormula_(tabName, pair[1], sourceRow);
    });
  } else {
    row[3] = hubIfFormula_(tabName, 'A', sourceRow);
    row[4] = hubIfFormula_(tabName, 'B', sourceRow);
    row[8] = hubIfFormula_(tabName, 'C', sourceRow);
    row[10] = hubIfFormula_(tabName, 'D', sourceRow);
    row[11] = hubIfFormula_(tabName, 'E', sourceRow);
    row[12] = hubIfFormula_(tabName, 'F', sourceRow);
    row[13] = hubIfFormula_(tabName, 'G', sourceRow);
    row[14] = hubIfFormula_(tabName, 'H', sourceRow);
    row[17] = hubIfFormula_(tabName, 'I', sourceRow);
    row[18] = hubIfFormula_(tabName, 'J', sourceRow);
    row[19] = hubIfFormula_(tabName, 'K', sourceRow);
    row[20] = hubIfFormula_(tabName, 'L', sourceRow);
  }
  row[15] = "=COUNTIF('Listing Descriptions'!$B$2:$B$500,A" + hubRow + ')';
  row[16] = "=COUNTIFS('Listing Descriptions'!$B$2:$B$500,A" + hubRow +
    ",'Listing Descriptions'!$T$2:$T$500,\"Listed\",'Listing Descriptions'!$V$2:$V$500,\"<>\")";
  row[22] = '=IF(OR(LEFT(V' + hubRow + ',7)="REVIEW:",COUNTIFS(\'Listing Descriptions\'!$B$2:$B$500,A' + hubRow +
    ',\'Listing Descriptions\'!$W$2:$W$500,"DUPLICATE:*")>0,X' + hubRow + '="Review",Y' + hubRow +
    '="Review"),"Review","OK")';
  row[23] = '=IF(P' + hubRow + '=0,IF(AND(D' + hubRow + '="Listed",OR(ISNUMBER(SEARCH("eBay",O' + hubRow +
    ')),ISNUMBER(SEARCH("Poshmark",O' + hubRow + ')),ISNUMBER(SEARCH("Depop",O' + hubRow +
    ')))),"Review","N/A"),IF(Q' + hubRow + '=P' + hubRow + ',"Confirmed","Review"))';
  row[24] = '=IF(P' + hubRow + '=0,"N/A",IF(COUNTIFS(\'Listing Descriptions\'!$B$2:$B$500,A' + hubRow +
    ',\'Listing Descriptions\'!$W$2:$W$500,"REVIEW:*")>0,"Review","Confirmed"))';
  return row;
}

function appendListingHubRow_(itemId, tabName, sourceRow) {
  var hub = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LISTING_HUB_SHEET);
  if (!hub) return { error: 'Could not find "' + LISTING_HUB_SHEET + '" tab.' };
  var t = readTable(hub, ['Item ID']);
  var idCol = colIndex(t.colMap, 'Item ID');
  var lastWithId = t.headerSheetRow;
  var i;
  for (i = 0; i < t.rows.length; i++) {
    if (String(t.rows[i][idCol] || '').trim()) lastWithId = t.headerSheetRow + 1 + i;
  }
  var newHubRow = lastWithId + 1;
  if (newHubRow <= hub.getLastRow()) hub.insertRowAfter(lastWithId);
  var values = buildHubRowValues_(itemId, tabName, sourceRow, newHubRow);
  hub.getRange(newHubRow, 1, 1, values.length).setValues([values]);
  return { hubRow: newHubRow };
}

function appendAddingInventoryRow_(body) {
  var sheet = getAddingInventorySheet_();
  if (!sheet) return { skipped: true };
  var header = findHeaderRow(sheet, ['Category', 'Item']);
  var startRow = header ? header.rowIndex + 2 : 2;
  var target = Math.max(sheet.getLastRow() + 1, startRow);
  var details = [body.brand, body.model, body.version, body.itemNumber].filter(function (x) {
    return String(x || '').trim();
  }).join('; ');
  var sizeCond = [body.size, body.condition].filter(function (x) {
    return String(x || '').trim();
  }).join(' / ');
  sheet.getRange(target, 1, 1, 7).setValues([[
    body.category || (body.isClothing === false ? '' : 'Clothing'),
    body.clothingType || body.subcategory || '',
    body.product || body.item || '',
    details || body.notes || '',
    sizeCond,
    body.listPrice || '',
    body.estValue || body.realisticSale || ''
  ]]);
  return { row: target };
}

function createInventoryItem(body) {
  body = body || {};
  var isClothing = true;
  if (Object.prototype.hasOwnProperty.call(body, 'isClothing')) isClothing = !!body.isClothing;
  var cat = String(body.category || '').toLowerCase();
  if (cat.indexOf('non') !== -1 || cat === 'electronics' || cat === 'other') isClothing = false;
  if (String(body.inventoryTab || '').toLowerCase().indexOf('non') !== -1) isClothing = false;

  var prefix = isClothing ? 'CLO' : 'MISC';
  var itemId = String(body.itemId || '').trim() || nextPrefixedId_(prefix);
  var inv = appendInventoryRow_(isClothing, body);
  if (inv.error) return { ok: false, error: inv.error };
  var hub = appendListingHubRow_(itemId, inv.tabName, inv.row);
  if (hub.error) return { ok: false, error: hub.error };
  return {
    ok: true,
    itemId: itemId,
    sourceTab: inv.tabName,
    sourceRow: inv.row,
    hubRow: hub.hubRow,
    isClothing: isClothing
  };
}

// A paste is stored verbatim. The first line becomes the card title so the
// board reads sensibly, but nothing else is parsed until someone processes it.
function addStockingPaste(body) {
  body = body || {};
  var text = String(body.text || '').trim();
  if (!text) return { ok: false, error: 'Nothing pasted.' };
  var firstLine = text.split(/\r?\n/)[0].trim();
  if (firstLine.length > 80) firstLine = firstLine.slice(0, 77) + '...';
  var stockingId = nextStockingId_();
  var stamp = nowStamp_();
  getStockingSheet().appendRow([
    stockingId, '', STOCKING_STAGES.PASTED, stamp, stamp,
    firstLine, '', '', '', '', '', '', '', text
  ]);
  invalidateBootCache();
  return { ok: true, stockingId: stockingId, stage: STOCKING_STAGES.PASTED, product: firstLine };
}

// Only removes the Stocking row — an item already created from it stays put.
function deleteStocking(body) {
  body = body || {};
  var stockingId = String((body && body.stockingId) || '').trim();
  if (!stockingId) return { ok: false, error: 'stockingId is required.' };
  var located = findStockingRow_(stockingId, '');
  if (!located) return { ok: false, error: 'Stocking row not found.' };
  located.sheet.deleteRow(located.row);
  invalidateBootCache();
  return { ok: true, stockingId: stockingId };
}

function createStocking(body) {
  body = body || {};
  if (!String(body.product || body.item || '').trim()) {
    return { ok: false, error: 'Product / item name is required.' };
  }
  var created = createInventoryItem(body);
  if (!created.ok) return created;

  var stamp = nowStamp_();
  var stage = STOCKING_STAGES.NEEDS_ANALYSIS;
  var stockingId;
  // Processing a parked paste reuses its row, so the raw text stays attached
  // to the item it turned into instead of being orphaned.
  var parked = body.pastedId ? findStockingRow_(body.pastedId, '') : null;
  if (parked) {
    stockingId = String(body.pastedId);
    setStockingCell_(parked, 'Item ID', created.itemId);
    setStockingCell_(parked, 'Stage', stage);
    setStockingCell_(parked, 'Updated', stamp);
    setStockingCell_(parked, 'Product', body.product || body.item || '');
    setStockingCell_(parked, 'Brand', body.brand || '');
    setStockingCell_(parked, 'Model', body.model || '');
    setStockingCell_(parked, 'Version', body.version || '');
    setStockingCell_(parked, 'Notes', body.notes || '');
    setStockingCell_(parked, 'Source Tab', created.sourceTab);
  } else {
    stockingId = nextStockingId_();
    getStockingSheet().appendRow([
      stockingId, created.itemId, stage, stamp, stamp,
      body.product || body.item || '', body.brand || '', body.model || '', body.version || '',
      body.notes || '', created.sourceTab, '', '', body.rawEntry || ''
    ]);
  }

  var intake = { skipped: true };
  if (body.addIntakeRow !== false) {
    intake = appendAddingInventoryRow_({
      category: body.category,
      clothingType: body.clothingType || body.subcategory,
      subcategory: body.subcategory,
      product: body.product || body.item,
      brand: body.brand,
      model: body.model,
      version: body.version,
      itemNumber: body.itemNumber,
      notes: body.notes,
      size: body.size,
      condition: body.condition,
      listPrice: body.listPrice,
      estValue: body.estValue,
      realisticSale: body.realisticSale,
      isClothing: created.isClothing
    });
  }

  logItemAction(created.itemId, 'Stocking Intake', stockingId + ' -> ' + stage);
  invalidateBootCache();

  return {
    ok: true,
    stockingId: stockingId,
    itemId: created.itemId,
    stage: stage,
    sourceTab: created.sourceTab,
    sourceRow: created.sourceRow,
    hubRow: created.hubRow,
    intakeRow: intake.row || null
  };
}

function updateStocking(body) {
  body = body || {};
  var located = findStockingRow_(body.stockingId, body.itemId);
  if (!located) return { ok: false, error: 'Stocking row not found.' };

  var fields = {
    stage: 'Stage', product: 'Product', brand: 'Brand', model: 'Model', version: 'Version',
    notes: 'Notes', analysisSummary: 'Analysis Summary', error: 'Error',
    sourceTab: 'Source Tab', itemId: 'Item ID'
  };
  Object.keys(fields).forEach(function (key) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      setStockingCell_(located, fields[key], body[key]);
    }
  });
  setStockingCell_(located, 'Updated', nowStamp_());

  var itemIdCol = located.headers.indexOf('item id');
  var stockingIdCol = located.headers.indexOf('stocking id');
  var itemId = body.itemId || (itemIdCol === -1 ? '' : located.values[itemIdCol]);
  var stockingId = body.stockingId || (stockingIdCol === -1 ? '' : located.values[stockingIdCol]);
  var stage = body.stage || '';

  var answersSaved = null;
  if (body.answers && body.answers.length) {
    answersSaved = saveListingAnswers({ itemId: itemId, answers: body.answers });
  }
  if (stage) logItemAction(itemId, 'Stocking Stage', stage);

  if (body.promoteIfDrafts && itemId) {
    var descs = getDescriptions().filter(function (d) {
      return String(d.itemId) === String(itemId) && String(d.suggestedTitle || d.description || '').trim();
    });
    if (descs.length) {
      setStockingCell_(located, 'Stage', STOCKING_STAGES.READY_TO_POST);
      setStockingCell_(located, 'Updated', nowStamp_());
      stage = STOCKING_STAGES.READY_TO_POST;
    }
  }

  invalidateBootCache();
  return {
    ok: true, stockingId: String(stockingId), itemId: String(itemId),
    stage: stage || undefined, answersSaved: answersSaved
  };
}

function getListingQuestions(itemId) {
  var sheet = getListingQuestionsSheet_();
  if (!sheet) return [];
  var t = readTable(sheet, ['Item ID', 'Item']);
  if (!t.rows.length) return [];
  var out = [];
  var i;
  for (i = 0; i < t.rows.length; i++) {
    var row = t.rows[i];
    var id = String(val(row, t.colMap, 'Item ID') || '');
    if (!id) continue;
    if (itemId && String(itemId) !== id) continue;
    out.push({
      sheetRow: t.headerSheetRow + 1 + i,
      itemId: id,
      item: String(val(row, t.colMap, 'Item') || ''),
      questions: String(val(row, t.colMap, 'Questions / missing details') || val(row, t.colMap, 'Questions') || ''),
      answer: String(val(row, t.colMap, 'Your Answer(s)') || val(row, t.colMap, 'Your Answer') || ''),
      draftPlaceholder: String(val(row, t.colMap, 'Draft placeholder currently used') || val(row, t.colMap, 'Draft placeholder') || ''),
      status: String(val(row, t.colMap, 'Status') || '')
    });
  }
  return out;
}

function saveListingAnswers(body) {
  body = body || {};
  var itemId = String(body.itemId || '').trim();
  var answers = body.answers || [];
  if (!itemId || !answers.length) return { ok: false, error: 'Missing itemId or answers.' };
  var sheet = getListingQuestionsSheet_();
  if (!sheet) return { ok: false, error: 'Listing Questions tab not found.' };
  var t = readTable(sheet, ['Item ID']);
  var answerCol = colIndex(t.colMap, 'Your Answer(s)');
  if (answerCol === -1) answerCol = colIndex(t.colMap, 'Your Answer');
  if (answerCol === -1) return { ok: false, error: 'Could not find Your Answer(s) column.' };
  var updated = 0;
  var a, i, ans, targetRow, id, q;
  for (a = 0; a < answers.length; a++) {
    ans = answers[a];
    targetRow = Number(ans.row || ans.sheetRow || 0);
    if (!targetRow) {
      for (i = 0; i < t.rows.length; i++) {
        id = String(val(t.rows[i], t.colMap, 'Item ID') || '');
        q = String(val(t.rows[i], t.colMap, 'Questions / missing details') || val(t.rows[i], t.colMap, 'Questions') || '');
        if (id === itemId && (!ans.question || q === ans.question)) {
          targetRow = t.headerSheetRow + 1 + i;
          break;
        }
      }
    }
    if (!targetRow) continue;
    sheet.getRange(targetRow, answerCol + 1).setValue(ans.answer || '');
    updated++;
  }
  if (updated) {
    logItemAction(itemId, 'Listing Answers Saved', updated + ' answer(s)');
    invalidateBootCache();
  }
  return { ok: true, updated: updated };
}

function upsertDescription(body) {
  body = body || {};
  var itemId = String(body.itemId || '').trim();
  var platform = String(body.platform || '').trim();
  if (!itemId || !platform) return { ok: false, error: 'Missing itemId or platform.' };

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DESCRIPTIONS_SHEET);
  if (!sheet) return { ok: false, error: 'Could not find "' + DESCRIPTIONS_SHEET + '" tab.' };
  var t = readTable(sheet, ['Item ID', 'Platform', 'Suggested title']);
  var startRow = t.headerSheetRow + 1;
  var target = -1;
  var platLc = platform.toLowerCase();
  var i, rowItem, rowPlat;
  for (i = 0; i < t.rows.length; i++) {
    rowItem = String(val(t.rows[i], t.colMap, 'Item ID') || '');
    rowPlat = String(val(t.rows[i], t.colMap, 'Platform') || '').trim().toLowerCase();
    if (rowItem === itemId && rowPlat === platLc) { target = startRow + i; break; }
  }

  var listingId = body.listingId || (itemId + '-' + platform.replace(/[^A-Za-z0-9]+/g, '').slice(0, 6).toUpperCase());
  if (target === -1) {
    target = Math.max(sheet.getLastRow() + 1, startRow);
    var width = Math.max(sheet.getLastColumn(), 23);
    var blank = [];
    for (i = 0; i < width; i++) blank.push('');
    sheet.getRange(target, 1, 1, width).setValues([blank]);
  }

  function write(headerNames, value) {
    if (value === undefined) return;
    var h, c;
    for (h = 0; h < headerNames.length; h++) {
      c = colIndex(t.colMap, headerNames[h]);
      if (c !== -1) { sheet.getRange(target, c + 1).setValue(value); return; }
    }
  }

  write(['Listing ID'], listingId);
  write(['Item ID'], itemId);
  write(['Platform'], platform);
  write(['Suggested title'], body.suggestedTitle || body.title);
  write(['Listing description', 'Description'], body.description);
  write(['List price'], body.listPrice);
  write(['Floor price'], body.floorPrice);
  write(['Listing status', 'Status'], body.listingStatus || body.status || 'Draft');
  write(['Brand'], body.brand);
  write(['Size'], body.size);
  write(['Item number'], body.itemNumber);
  write(['Condition statement'], body.conditionStatement);
  write(['Suggested category'], body.suggestedCategory);
  write(['Tags / keywords'], body.tags);
  write(['Notes'], body.notes);
  write(['Posting priority'], body.postingPriority);
  write(['Readiness'], body.readiness || 'Needs review');

  invalidateBootCache();
  return { ok: true, row: target, listingId: listingId };
}

function upsertQueue(body) {
  body = body || {};
  var itemId = String(body.itemId || '').trim();
  var platform = String(body.platform || '').trim();
  if (!itemId || !platform) return { ok: false, error: 'Missing itemId or platform.' };
  var listingId = body.listingId || (itemId + '-' + platform.replace(/[^A-Za-z0-9]+/g, '').slice(0, 6).toUpperCase());

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(POSTING_QUEUE_SHEET);
  if (!sheet) return { ok: false, error: 'Could not find "' + POSTING_QUEUE_SHEET + '" tab.' };
  var header = findHeaderRow(sheet, ['Listing ID']);
  if (!header) return { ok: false, error: 'Could not find a header row in ' + POSTING_QUEUE_SHEET + '.' };
  var colMap = header.colMap;
  var listingIdCol = colIndex(colMap, 'Listing ID');
  if (listingIdCol === -1) return { ok: false, error: 'Could not find a "Listing ID" column.' };

  var startRow = header.rowIndex + 2;
  var lastRow = sheet.getLastRow();
  var numCols = sheet.getLastColumn();
  var targetRow = -1;
  var trueLastContentRow = header.rowIndex + 1;
  var i, idsRange, rowIsBlank;
  if (lastRow >= startRow) {
    idsRange = sheet.getRange(startRow, 1, lastRow - startRow + 1, numCols).getValues();
    for (i = 0; i < idsRange.length; i++) {
      rowIsBlank = idsRange[i].every(function (c) { return c === '' || c === null; });
      if (!rowIsBlank) trueLastContentRow = startRow + i;
      if (String(idsRange[i][listingIdCol] || '') === listingId) targetRow = startRow + i;
    }
  }
  if (targetRow === -1) targetRow = trueLastContentRow + 1;

  function setCol(name, value) {
    if (value === undefined || value === null) return;
    var c = colIndex(colMap, name);
    if (c !== -1) sheet.getRange(targetRow, c + 1).setValue(value);
  }

  setCol('Listing ID', listingId);
  setCol('Item ID', itemId);
  setCol('Platform', platform);
  setCol('Status', body.status || 'Draft');
  setCol('Suggested title', body.suggestedTitle || body.title);
  setCol('List price', body.listPrice);
  setCol('Listing description', body.description);
  setCol('Listing URL', body.url || body.listingUrl);
  setCol('Notes', body.notes);
  setCol('Posting order', body.postingOrder);
  setCol('Readiness', body.readiness);
  setCol('Photo checklist', body.photoChecklist);

  invalidateBootCache();
  return { ok: true, row: targetRow, listingId: listingId };
}
