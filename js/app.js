const state = {
  showSold: false,        // category drill-down view
  listShowSold: false,    // list mode
  listActiveCats: new Set(),
  zoom: 1,
  listSort: 'views',
  listGroup: 'category',  // 'category' = collapsible sections, 'ranked' = one sorted list
  expandedCats: new Set(),   // category sections open in list view (default: none)
  expandedSizes: new Set(),  // size-band rows open in By size view (default: none)
  expandedRanked: new Set(), // ranked item rows open in By views view (default: none)
  expandedWheelItems: new Set(), // wheel category drill-down item rows (default: none)
  showCompletedActions: true,
  showSkippedListings: false,
  inventory: [],          // from Listing Hub (read-only, sourced from the Sheet)
  descriptions: [],       // from Listing Descriptions
  postingQueue: [],       // from Platform Posting Queue
  metrics: [],            // from Metrics tab (auto eBay + manual entries)
  acquire: [],            // from Acquire Watchlist tab
  editingPostingNote: null, // "<itemId>|<site>" of the Still-to-list card whose note is being edited
  sales: [],              // from Sales tab (one row per sale: price, fees, label, net cash, site)
  balances: [],           // from Platform Balances tab (available / pending cash per site, by date)
  photos: [],             // from Photos tab (cover photo per item x platform)
  itemActions: [],        // from Item Actions tab (price drops/offers sent/ignored, logged from pricing actions)
  localDeals: [],         // from Local Deals tab (meetups/pending on face-to-face sales)
  editingLocalDeal: null, // "<itemId>|<platform label>" of the local deal being edited
  featuredActions: new Set(),
  loadedAt: '',
  expandedItems: new Set(),
  picked: new Set(),      // items ticked for the Selected items panel / bundling
};

const ZOOM_MIN = 0.7, ZOOM_MAX = 1.6, ZOOM_STEP = 0.1, ZOOM_BASE = 380;

const connected = () => !!APPS_SCRIPT_URL;

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Compact inventory label used on collapsed ranked rows (brand + item, no em dash).
function itemShortName(item) {
  return [item && item.brand, item && item.item].filter(Boolean).join(' ') || String((item && item.itemId) || 'Item');
}

// ---------------------------------------------------------------------
// Category + platform helpers — derived from whatever's actually in the
// synced data rather than a hardcoded list, since the Sheet's Category
// column isn't a fixed taxonomy.
// ---------------------------------------------------------------------
function categoryId(label) {
  return String(label || 'other').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'other';
}
function titleCase(s) {
  return String(s || '').replace(/\w\S*/g, t => t[0].toUpperCase() + t.slice(1));
}
function paletteColorFor(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return CATEGORY_PALETTE[hash % CATEGORY_PALETTE.length];
}
function categoryMeta(label) {
  const id = categoryId(label);
  const meta = CATEGORY_META[id];
  if (meta) return { id, label: titleCase(label || id), icon: meta.icon, color: meta.color };
  return { id, label: titleCase(label || 'Other'), icon: DEFAULT_CATEGORY_META.icon, color: paletteColorFor(id) };
}
function activeCategories() {
  const seen = new Map();
  state.inventory.forEach(it => {
    const meta = categoryMeta(it.category || 'Other');
    if (!seen.has(meta.id)) seen.set(meta.id, meta);
  });
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function platformId(name) {
  const s = String(name || '').toLowerCase();
  if (s.includes('ebay')) return 'ebay';
  if (s.includes('poshmark')) return 'poshmark';
  if (s.includes('depop')) return 'depop';
  if (s.includes('facebook') || s.includes('fb market')) return 'facebook';
  if (s.includes('mercari')) return 'mercari';
  if (s.includes('grailed')) return 'grailed';
  return null;
}
function platformMeta(name) {
  const id = platformId(name);
  if (id && PLATFORM_META[id]) return { id, ...PLATFORM_META[id] };
  return { id: id || categoryId(name) || 'other', label: name || DEFAULT_PLATFORM_META.label, color: DEFAULT_PLATFORM_META.color };
}
function splitPlatforms(field) {
  return String(field || '').split(/[,/]/).map(s => s.trim()).filter(function (value) {
    return value && !/^\d+(?:\.\d+)?$/.test(value);
  });
}
function platformRank(id) {
  const i = PLATFORM_ORDER.indexOf(id);
  return i === -1 ? PLATFORM_ORDER.length : i;
}
function platformOptionsHTML(selected) {
  return Object.keys(PLATFORM_META).map(id => `<option value="${id}"${id === selected ? ' selected' : ''}>${PLATFORM_META[id].label}</option>`).join('');
}

// Impressions/views/watchers/clicks from eBay and Poshmark are rolling-window
// snapshots (e.g. "last 30/60 days"), not ever-growing counters — they can go
// down as well as up between checks. So the right way to read a history of
// logged entries is "use the most recent snapshot," never "sum every entry
// ever logged" (summing would double-count the same rolling window repeatedly
// every time stats get refreshed).
function latestMetricsByItemPlatform() {
  const latest = new Map();
  state.metrics.forEach(m => {
    if (!m.itemId) return;
    const key = m.itemId + '|' + platformMeta(m.platform).id;
    const existing = latest.get(key);
    if (!existing || (m.date || '') >= (existing.date || '')) latest.set(key, m);
  });
  return latest;
}

function isSold(item) { return String(item.sourceStatus || '').toLowerCase() === 'sold'; }
function isRealItem(it) { return !!(it.item || it.brand) && String(it.sourceStatus || '').toLowerCase() !== 'blank'; }
function statusClass(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'sold') return 'status-sold';
  if (s === 'listed') return 'status-listed';
  return 'status-other';
}
function parseMoney(v) {
  // Takes the first number found, so a range like "$50–65" (est. value fields
  // are often ranges) reads as its low end rather than "50" and "65" getting
  // concatenated when the separating dash gets stripped.
  const m = String(v || '').match(/[\d,]+\.?\d*/);
  if (!m) return 0;
  const n = parseFloat(m[0].replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}
function fmtMoney(n) { return '$' + Math.round(n).toLocaleString(); }

// ---------------------------------------------------------------------
// Backend helper (Apps Script Web App, or localStorage fallback) —
// same contract as routine-hub/goals-hub.
// ---------------------------------------------------------------------
async function apiGet(action) {
  if (!connected()) return null;
  const res = await fetch(`${APPS_SCRIPT_URL}?action=${action}`);
  if (!res.ok) throw new Error('Request failed');
  return res.json();
}
// Apps Script occasionally never answers one of several requests fired at page
// load (the same call made again returns in seconds), so this gives each
// attempt a deadline and tries again instead of waiting forever.
async function apiGetWithRetry(action, { timeoutMs = 30000, attempts = 3, onRetry } = {}) {
  if (!connected()) return null;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${APPS_SCRIPT_URL}?action=${action}`, { signal: ctrl.signal });
      if (!res.ok) throw new Error('Request failed');
      return await res.json();
    } catch (err) {
      lastError = err;
      if (attempt < attempts && onRetry) onRetry(attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}
async function apiPost(action, payload, { timeoutMs } = {}) {
  if (!connected()) return null;
  const ctrl = timeoutMs ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...payload }),
      signal: ctrl ? ctrl.signal : undefined,
    });
    if (!res.ok) throw new Error('Request failed');
    return await res.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function localGet(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
}
function localSet(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

const WORKROOM_ORIGINS = [
  'https://randymcfarland1227-wq.github.io',
  'https://frontier-work-room.randymcfarland1227.workers.dev',
];
const WORKROOM_ORIGIN = WORKROOM_ORIGINS[0];
const LIFE_HUB_PAGES_URL = 'https://randymcfarland1227-wq.github.io/frontier/';
const RESALE_ORIGIN_URL = 'https://randymcfarland1227-wq.github.io/sell-hub/';
function isWorkroomOrigin(origin) { return WORKROOM_ORIGINS.includes(origin); }
// Posting tasks are starred per site, separately from the item's pricing/shipping star.
function postingTaskKey(itemId, platformIdValue) { return `list:${itemId}:${platformIdValue}`; }
function isFeaturedAction(itemId) { return state.featuredActions.has(String(itemId)); }
function setFeaturedAction(id, starred) {
  const key = String(id);
  if (starred) state.featuredActions.add(key); else state.featuredActions.delete(key);
  localSet('sellHub.featuredActions', [...state.featuredActions]);
}
function actionStarHTML(itemId, label) {
  const starred = isFeaturedAction(itemId);
  return `<button class="action-star${starred ? ' starred' : ''}" data-feature-action="${escapeHtml(itemId)}" aria-label="${starred ? 'Remove' : 'Feature'} ${escapeHtml(label)} in Randy's Life Hub" title="${starred ? 'Featured in Life Hub' : 'Feature in Life Hub'}">${starred ? '★' : '☆'}</button>`;
}
function wireActionStars(root) {
  root.querySelectorAll('[data-feature-action]').forEach(btn => btn.addEventListener('click', () => {
    const id = String(btn.dataset.featureAction);
    setFeaturedAction(id, !state.featuredActions.has(id));
    renderAction();
    syncWorkroomFromStar();
  }));
}
function itemTitle(item) {
  return [item.brand, item.item].filter(Boolean).join(' — ') || String(item.itemId);
}
/** All open Resale actions for Life Hub tasks[] (+ starred featured strip). */
function collectResaleActions() {
  const active = state.inventory.filter(it => !isSold(it));
  const sold = state.inventory.filter(isSold);
  const actions = [];
  sold.filter(it => !hasShipped(it.itemId) && !soldInPerson(it)).forEach(item => {
    actions.push({
      id: String(item.itemId),
      title: itemTitle(item),
      detail: 'Ship this sold item.',
      meta: item.soldPrice ? `Sold for ${item.soldPrice}` : 'Sold',
      kind: 'ship',
      completable: true,
    });
  });
  soldElsewhereTasks().forEach(t => {
    actions.push({
      id: endTaskKey(t.item.itemId, t.meta.id),
      title: itemTitle(t.item),
      detail: `It sold — take the ${t.meta.label} listing down.`,
      meta: t.item.soldPrice ? `Sold for ${t.item.soldPrice}` : 'Sold',
      kind: 'end',
      platformLabel: t.meta.label,
      listingId: (t.entry && t.entry.listingId) || '',
      itemId: t.item.itemId,
      completable: true,
    });
  });
  active.forEach(item => {
    platformsStatusFor(item).missing.forEach(m => {
      actions.push({
        id: postingTaskKey(item.itemId, m.meta.id),
        title: itemTitle(item),
        detail: `Post it on ${m.meta.label}.`,
        meta: item.listPrice ? `List price ${fmtMoney(parseMoney(item.listPrice))}` : 'No list price yet',
        kind: 'list',
        platformLabel: m.meta.label,
        itemId: item.itemId,
        completable: true,
      });
    });
  });
  active.forEach(item => {
    const action = pricingActionFor(item);
    if (!action || action.severity === 'ok' || action.severity === 'dismissed' || action.severity === 'handled') return;
    // Skip if this itemId is already a ship task (sold items are filtered out of active).
    actions.push({
      id: String(item.itemId),
      title: itemTitle(item),
      detail: `${action.label}: ${action.reason}`,
      meta: `${action.views || 0} views · ${action.clicks || 0} clicks`,
      kind: 'pricing',
      actionLabel: action.label,
      completable: true,
    });
  });
  openLocalDeals().forEach(deal => {
    const item = state.inventory.find(it => String(it.itemId) === String(deal.itemId));
    const title = item ? itemTitle(item) : String(deal.itemId);
    const meta = localDealStatusMeta(deal.status);
    actions.push({
      id: `deal:${deal.itemId}`,
      title,
      detail: deal.note || `${meta.label}${deal.when ? ` · ${deal.when}` : ''}`,
      meta: platformMeta(deal.platform).label,
      kind: 'deal',
      completable: false,
    });
  });
  return actions;
}
// Actions that count as finished work on Life Hub: marking a listing posted, deploying a
// pricing suggestion (price drop, offer, completed), and moving items along (shipped, ended
// elsewhere). Sent to Life Hub as done tasks for the last 7 days; it records each once.
const LIFE_HUB_DONE_ACTIONS = {
  'Listing Posted': 'Listed',
  'Price Drop': 'Price dropped',
  'Offer Sent': 'Offer sent',
  'Completed': 'Suggestion done',
  'Shipped': 'Shipped',
  'Listing Ended': 'Listing ended',
};
function resaleDoneTasks() {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - 6);
  const seen = new Set();
  return (state.itemActions || [])
    .filter(a => LIFE_HUB_DONE_ACTIONS[a.action])
    .map(a => {
      const m = String(a.date || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      return m ? { a, when: new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) } : null;
    })
    .filter(x => x && x.when >= cutoff)
    .map(({ a, when }) => {
      const item = state.inventory.find(it => String(it.itemId) === String(a.itemId));
      const id = `done:${a.itemId}:${a.action}:${a.detail || ''}:${a.date}`;
      if (seen.has(id)) return null;
      seen.add(id);
      return {
        id,
        title: `${LIFE_HUB_DONE_ACTIONS[a.action]} — ${item ? itemTitle(item) : a.itemId}`,
        detail: a.detail || '',
        status: 'done',
        completedAt: when.toISOString(),
        originUrl: RESALE_ORIGIN_URL,
      };
    })
    .filter(Boolean);
}
function resaleWorkroomSnapshot() {
  const active = state.inventory.filter(it => !isSold(it));
  const sold = state.inventory.filter(isSold);
  const latest = latestMetricsByItemPlatform();
  let listingViews = 0;
  latest.forEach(metric => { listingViews += Number(metric.views || metric.impressions) || 0; });
  const actions = collectResaleActions();
  const tasks = actions.map(a => ({
    id: a.id,
    title: a.title,
    detail: a.detail,
    status: 'open',
    starred: isFeaturedAction(a.id),
    originUrl: RESALE_ORIGIN_URL,
  }));
  const featured = actions.filter(a => isFeaturedAction(a.id)).map(a => ({
    id: a.id,
    title: a.title,
    detail: a.detail,
    meta: a.meta,
    originUrl: RESALE_ORIGIN_URL,
    completable: a.completable !== false,
  }));
  return {
    source: 'resale',
    metrics: {
      listed: active.length,
      sold: sold.length,
      activeListings: active.reduce((count, item) => count + Math.max(1, splitPlatforms(item.platform).length), 0),
      listingViews,
    },
    featured,
    tasks: [...tasks, ...resaleDoneTasks()],
    refreshedAt: state.loadedAt || new Date().toISOString(),
  };
}
function notifyWorkroom() {
  const message = { type: 'randys-workroom:snapshot', payload: resaleWorkroomSnapshot() };
  for (const origin of WORKROOM_ORIGINS) {
    try { if (window.opener && !window.opener.closed) window.opener.postMessage(message, origin); } catch {}
    try { if (window.parent !== window) window.parent.postMessage(message, origin); } catch {}
  }
}
function syncWorkroomFromStar() {
  notifyWorkroom();
  const encoded = btoa(encodeURIComponent(JSON.stringify(resaleWorkroomSnapshot())));
  // Prefer Life Hub window name; keep legacy name as fallback for older tabs.
  window.open(`${LIFE_HUB_PAGES_URL}#sync=${encoded}`, 'randys-life-hub');
}
async function completeResaleWorkroomItem(id) {
  const key = String(id || '');
  if (!key) return;
  if (key.startsWith('end:')) {
    const parts = key.split(':');
    const itemId = parts[1];
    const platformIdValue = parts.slice(2).join(':');
    const task = soldElsewhereTasks().find(t => endTaskKey(t.item.itemId, t.meta.id) === key);
    const platformLabel = task ? task.meta.label : (platformMeta(platformIdValue).label || platformIdValue);
    const listingId = task && task.entry ? task.entry.listingId : '';
    await endListingElsewhere(itemId, platformLabel, listingId);
  } else if (key.startsWith('list:')) {
    const parts = key.split(':');
    const itemId = parts[1];
    const platformIdValue = parts.slice(2).join(':');
    const platformLabel = platformMeta(platformIdValue).label || platformIdValue;
    await recordItemAction(itemId, 'Listing Posted', platformLabel);
    renderAction();
  } else if (key.startsWith('deal:')) {
    // Local deals need a meetup status change in-app; unstar only from hub complete.
    setFeaturedAction(key, false);
  } else {
    const item = state.inventory.find(it => String(it.itemId) === key);
    if (item && isSold(item) && !hasShipped(item.itemId) && !soldInPerson(item)) {
      await markShipped(key);
    } else if (item && !isSold(item)) {
      const action = pricingActionFor(item);
      await toggleActionComplete(key, false, action.label || 'Action');
    }
  }
  setFeaturedAction(key, false);
  renderAction();
  notifyWorkroom();
}
function starResaleWorkroomItem(id, starred) {
  const key = String(id || '');
  if (!key) return;
  const next = typeof starred === 'boolean' ? starred : !isFeaturedAction(key);
  setFeaturedAction(key, next);
  renderAction();
  notifyWorkroom();
}
window.addEventListener('message', event => {
  if (!isWorkroomOrigin(event.origin)) return;
  const type = event.data?.type;
  if (type === 'randys-workroom:request') {
    event.source?.postMessage({ type: 'randys-workroom:snapshot', payload: resaleWorkroomSnapshot() }, event.origin);
    return;
  }
  const payload = event.data?.payload || {};
  if (payload.source && payload.source !== 'resale') return;
  if (type === 'randys-workroom:complete') {
    completeResaleWorkroomItem(payload.id);
    return;
  }
  if (type === 'randys-workroom:star') {
    starResaleWorkroomItem(payload.id, payload.starred);
  }
});

// ---------------------------------------------------------------------
// Loading synced data — inventory/descriptions/postingQueue/metrics are
// read-only reflections of the Sheet (no local fallback data to show);
// only Acquire is a site-created CRUD domain with an offline path.
// ---------------------------------------------------------------------
async function loadInventory() {
  document.getElementById('inventorySetupNote').style.display = connected() ? 'none' : 'block';
  if (!connected()) { state.inventory = []; return; }
  try { state.inventory = ((await apiGetWithRetry('inventory', { timeoutMs: 45000 })) || []).filter(isRealItem); }
  catch { state.inventory = []; }
}
async function loadDescriptionsData() {
  if (!connected()) { state.descriptions = []; return; }
  try { state.descriptions = (await apiGetWithRetry('descriptions', { timeoutMs: 45000 })) || []; }
  catch { state.descriptions = []; }
}
async function loadPostingQueueData() {
  if (!connected()) { state.postingQueue = []; return; }
  try { state.postingQueue = (await apiGetWithRetry('postingQueue', { timeoutMs: 45000 })) || []; }
  catch { state.postingQueue = []; }
}
async function loadMetricsData() {
  if (!connected()) { state.metrics = []; return; }
  try { state.metrics = (await apiGetWithRetry('metrics', { timeoutMs: 45000 })) || []; }
  catch { state.metrics = []; }
}
async function loadPhotosData() {
  if (!connected()) { state.photos = []; return; }
  try { state.photos = (await apiGetWithRetry('photos', { timeoutMs: 45000 })) || []; }
  catch { state.photos = []; }
}
function photoForItem(itemId) {
  const key = String(itemId || '').trim().toUpperCase();
  const matches = state.photos.filter(p => String(p.itemId || '').trim().toUpperCase() === key && p.photoUrl);
  const match = matches.find(p => platformId(p.platform) === 'ebay') || matches[0];
  return match ? match.photoUrl : null;
}
async function loadItemActionsData() {
  if (!connected()) { state.itemActions = []; return; }
  try { state.itemActions = (await apiGetWithRetry('itemActions', { timeoutMs: 45000 })) || []; }
  catch { state.itemActions = []; }
}
async function loadLocalDealsData() {
  if (!connected()) { state.localDeals = []; return; }
  try { state.localDeals = (await apiGetWithRetry('localDeals', { timeoutMs: 45000 })) || []; }
  catch { state.localDeals = []; }
}

// Item Actions rows are appended in chronological order, so the last match
// for an item is its most recent logged action.
function latestActionFor(itemId) {
  const matches = state.itemActions.filter(a => String(a.itemId) === String(itemId));
  return matches.length ? matches[matches.length - 1] : null;
}
// Same, but scoped to one action type — so an unrelated later log entry
// (a Correction note, a Sold/Shipped row) can't mask a still-relevant
// Price Drop or Offer Sent from an earlier date.
function latestActionOfType(itemId, actionType) {
  const matches = state.itemActions.filter(a => String(a.itemId) === String(itemId) && a.action === actionType);
  return matches.length ? matches[matches.length - 1] : null;
}
// dropListingPrice logs detail as "oldPrice->newPrice" when the old price
// was available server-side, or a bare newPrice for older log rows / cases
// where it wasn't. Returns null only when detail can't be read as a price
// at all.
function parsePriceDropDetail(detail) {
  const s = String(detail == null ? '' : detail).trim();
  if (!s) return null;
  const m = s.match(/^([\d.]+)\s*->\s*([\d.]+)$/);
  if (m) return { from: Number(m[1]), to: Number(m[2]) };
  const n = Number(s);
  return isFinite(n) ? { from: null, to: n } : null;
}
// How long a deployed price drop / sent offer keeps a pricing suggestion
// marked "handled" before it's allowed to resurface. Long enough that
// yesterday's work doesn't immediately look unfinished again, short enough
// that a listing that's genuinely still stuck gets re-flagged rather than
// going silent forever.
const HANDLED_SUPPRESS_DAYS = 7;
// Dates are compared against the Sheet's own "yyyy-MM-dd" stamps, which the
// Apps Script writes in local time — so "today" has to be local too, or an
// evening action reads as tomorrow everywhere east of UTC's date line.
function todayStr() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function daysSince(dateStr) {
  const then = new Date(dateStr + 'T00:00:00');
  const now = new Date(todayStr() + 'T00:00:00');
  return Math.round((now - then) / 86400000);
}
// "List price" text for a card: if the most recent Price Drop's logged
// new price matches what's on the item right now, show the old price
// struck through next to the current one instead of just the bare number
// — makes a deployed price change visible at a glance, not just in the log.
function priceLineHTML(item) {
  const current = parseMoney(item.listPrice);
  const drop = latestActionOfType(item.itemId, 'Price Drop');
  const parsed = drop ? parsePriceDropDetail(drop.detail) : null;
  if (parsed && parsed.from && current && Math.round(parsed.to) === Math.round(current)) {
    return `<s class="price-was">${fmtMoney(parsed.from)}</s> ${fmtMoney(current)}`;
  }
  return item.listPrice ? escapeHtml(item.listPrice) : '—';
}
// Small badges surfacing "something was already done about this" directly
// on the Inventory cards, not just in the Action tab — a price drop and/or
// an offer sent, whichever have happened for this item.
function actionBadgesHTML(itemId) {
  const badges = [];
  const offer = latestActionOfType(itemId, 'Offer Sent');
  if (offer) badges.push(`<span class="action-badge offer">Offer sent ${escapeHtml(offer.date)}</span>`);
  const drop = latestActionOfType(itemId, 'Price Drop');
  if (drop) {
    const parsed = parsePriceDropDetail(drop.detail);
    const txt = parsed && parsed.from ? `Price dropped ${fmtMoney(parsed.from)}→${fmtMoney(parsed.to)}` : 'Price dropped';
    badges.push(`<span class="action-badge drop">${txt} ${escapeHtml(drop.date)}</span>`);
  }
  const note = postingNoteFor(itemId);
  if (note) badges.push(`<span class="action-badge hold">⏸ ${escapeHtml(note)}</span>`);
  return badges.length ? `<div class="action-badges">${badges.join('')}</div>` : '';
}

function latestActionStateFor(itemId) {
  const stateActions = state.itemActions.filter(a =>
    String(a.itemId) === String(itemId) && ['Completed', 'Reopened', 'Deleted'].includes(a.action)
  );
  return stateActions.length ? stateActions[stateActions.length - 1] : null;
}

// ---------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------
function showView(view) {
  const btn = document.querySelector(`nav.tabs button[data-view="${view}"]`);
  if (!btn) return;
  const changed = !btn.classList.contains('active');
  document.querySelectorAll('nav.tabs button').forEach(b => {
    b.classList.toggle('active', b === btn);
    b.setAttribute('aria-selected', String(b === btn));
  });
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === view));
  // The wheel sizes itself from its container, which measures 0 while hidden.
  if (view === 'inventory') {
    syncInventoryToolbar();
    requestAnimationFrame(() => applyZoom());
  }
  if (view === 'stocking' && typeof refreshStocking === 'function') {
    refreshStocking();
  }
  if (changed) window.scrollTo({ top: 0, behavior: 'smooth' });
}
document.querySelectorAll('nav.tabs button').forEach(btn => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});

document.getElementById('todayLabel').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

// ---------------------------------------------------------------------
// Theme — Auto (follows the device), Dark, or Light. Saved per browser; the
// inline script in <head> applies it before first paint.
// ---------------------------------------------------------------------
const THEME_STEPS = [
  { id: 'auto', icon: '🌓', label: 'Auto', next: 'dark', describe: 'follows your device' },
  { id: 'dark', icon: '🌙', label: 'Dark', next: 'light', describe: 'dark' },
  { id: 'light', icon: '☀️', label: 'Light', next: 'auto', describe: 'light' },
];
function currentTheme() {
  const t = document.documentElement.dataset.theme;
  return t === 'dark' || t === 'light' ? t : 'auto';
}
function applyTheme(id) {
  if (id === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = id;
  try { if (id === 'auto') localStorage.removeItem('sellHub.theme'); else localStorage.setItem('sellHub.theme', id); } catch { /* per-browser preference only */ }
  const step = THEME_STEPS.find(s => s.id === id);
  const next = THEME_STEPS.find(s => s.id === step.next);
  const btn = document.getElementById('themeToggle');
  if (!btn) return;
  btn.querySelector('.theme-icon').textContent = step.icon;
  btn.querySelector('.theme-label').textContent = step.label;
  btn.setAttribute('aria-label', `Theme: ${step.describe}. Switch to ${next.label.toLowerCase()}.`);
}
document.getElementById('themeToggle').addEventListener('click', () => {
  applyTheme(THEME_STEPS.find(s => s.id === currentTheme()).next);
});
applyTheme(currentTheme());

// ---------------------------------------------------------------------
// Inventory — mode switch (wheel vs list)
// ---------------------------------------------------------------------
document.querySelectorAll('#modeSwitch button').forEach(btn => {
  btn.addEventListener('click', () => setMode(btn.dataset.mode, true));
});

document.querySelectorAll('#groupSwitch button').forEach(btn => {
  btn.addEventListener('click', () => setListGroup(btn.dataset.group));
});

function setListGroup(group) {
  state.listGroup = group;
  localSet('sellHub.listGroup', group);
  document.querySelectorAll('#groupSwitch button').forEach(b => b.classList.toggle('active', b.dataset.group === group));
  renderList();
}

// Expand / Collapse all — acts on whichever Inventory collapse set is on screen
// (list by category / size / views, or wheel category drill-down item rows).
function inventoryListModeActive() {
  const el = document.getElementById('listMode');
  return !!(el && el.style.display !== 'none');
}
function inventoryWheelCategoryActive() {
  const wheel = document.getElementById('wheelMode');
  const cat = document.getElementById('categoryView');
  return !!(wheel && wheel.style.display !== 'none' && cat && cat.style.display !== 'none');
}
function setInventoryExpandedAll(expand) {
  if (inventoryWheelCategoryActive()) {
    if (expand) {
      const ids = [...document.querySelectorAll('#categoryCards details.ranked-row[data-wheel-id]')]
        .map(el => el.dataset.wheelId).filter(Boolean);
      state.expandedWheelItems = new Set(ids);
    } else {
      state.expandedWheelItems = new Set();
    }
    const catId = (location.hash.match(/^#\/category\/(.+)$/) || [])[1];
    const cat = activeCategories().find(c => c.id === catId);
    if (cat) renderCategoryCards(cat);
    return;
  }
  if (!inventoryListModeActive()) return;

  if (state.listGroup === 'size') {
    if (expand) {
      const keys = [...document.querySelectorAll('#catSections details.size-row[data-size-key]')]
        .map(el => el.dataset.sizeKey).filter(Boolean);
      state.expandedSizes = new Set(keys);
    } else {
      state.expandedSizes = new Set();
    }
  } else if (state.listGroup === 'ranked') {
    if (expand) {
      const ids = [...document.querySelectorAll('#catSections details.ranked-row[data-rank-id]')]
        .map(el => el.dataset.rankId).filter(Boolean);
      state.expandedRanked = new Set(ids);
    } else {
      state.expandedRanked = new Set();
    }
  } else if (expand) {
    state.expandedCats = new Set(
      activeCategories().filter(c => state.listActiveCats.has(c.id)).map(c => c.id)
    );
  } else {
    state.expandedCats = new Set();
  }
  renderList();
}

function setMode(mode, resetHash) {
  document.querySelectorAll('#modeSwitch button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  document.getElementById('wheelMode').style.display = mode === 'wheel' ? '' : 'none';
  document.getElementById('listMode').style.display = mode === 'list' ? '' : 'none';
  localSet('sellHub.mode', mode);
  if (mode === 'wheel' && resetHash) location.hash = '';
  syncInventoryToolbar();
  // Wheel wrap measures 0 while #wheelMode is display:none (default List).
  // Re-measure after it becomes visible so aspect-ratio height is not stuck at 0.
  if (mode === 'wheel') {
    requestAnimationFrame(() => applyZoom());
  }
}

function syncInventoryToolbar() {
  const inv = document.getElementById('inventory');
  if (!inv) return;
  const wheel = document.getElementById('wheelMode');
  const list = document.getElementById('listMode');
  const inWheel = !!(wheel && wheel.style.display !== 'none');
  const inList = !!(list && list.style.display !== 'none');
  const inWheelCat = inventoryWheelCategoryActive();
  inv.classList.toggle('mode-wheel', inWheel);
  inv.classList.toggle('mode-list', inList);
  inv.classList.toggle('wheel-overview', inWheel && !inWheelCat);
  inv.classList.toggle('wheel-category', inWheelCat);
  const group = document.getElementById('groupSwitch');
  const sort = document.querySelector('#inventory .sort-control');
  const expand = document.querySelector('#inventory .inventory-expand');
  if (group) group.hidden = !inList;
  if (sort) sort.hidden = !inList;
  // Expand/Collapse apply to list sections or wheel category drill-down rows.
  if (expand) expand.hidden = !(inList || inWheelCat);
}

// ---------------------------------------------------------------------
// Inventory — wheel of categories, drilling into one at a time
// ---------------------------------------------------------------------
function renderWheel() {
  const nodesEl = document.getElementById('wheelNodes');
  const spokesEl = document.getElementById('wheelSpokes');
  nodesEl.innerHTML = '';
  spokesEl.innerHTML = '';

  const cats = activeCategories();
  const n = cats.length;
  const R = 38;
  const cx = 50, cy = 50;

  cats.forEach((cat, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    const x = cx + R * Math.cos(angle);
    const y = cy + R * Math.sin(angle);
    const count = state.inventory.filter(it => categoryMeta(it.category).id === cat.id && !isSold(it)).length;

    const spoke = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    spoke.setAttribute('x1', cx); spoke.setAttribute('y1', cy);
    spoke.setAttribute('x2', x); spoke.setAttribute('y2', y);
    spoke.setAttribute('class', 'spoke-line');
    spokesEl.appendChild(spoke);

    const node = document.createElement('button');
    node.className = 'wheel-node';
    node.style.left = x + '%';
    node.style.top = y + '%';
    node.style.setProperty('--dot', cat.color);
    node.innerHTML = `
      <span class="bubble">${cat.icon}</span>
      <span class="label">${cat.label}</span>
      <span class="count">${count}</span>
    `;
    node.addEventListener('click', () => { location.hash = `#/category/${cat.id}`; });
    nodesEl.appendChild(node);
  });

  document.getElementById('wheelCount').textContent = state.inventory.filter(it => !isSold(it)).length;
}

function applyZoom() {
  const wrap = document.getElementById('wheelWrap');
  const scroll = document.getElementById('wheelScroll');
  if (!wrap || !scroll) return;
  // Skip while the wheel host is hidden — writing width:0px permanently
  // collapses aspect-ratio height and .wheel-scroll clips to a thin sliver.
  const host = document.getElementById('wheelMode');
  if (host && host.style.display === 'none') return;
  const inv = document.getElementById('inventory');
  if (inv && !inv.classList.contains('active')) return;
  const avail = scroll.clientWidth;
  if (avail <= 0) return;
  const base = Math.min(avail, ZOOM_BASE);
  const px = Math.round(base * state.zoom);
  wrap.style.width = px + 'px';
  wrap.style.height = px + 'px'; // explicit height so overflow clip cannot zero the canvas
  document.getElementById('zoomPct').textContent = Math.round(state.zoom * 100) + '%';
  document.getElementById('zoomOut').disabled = state.zoom <= ZOOM_MIN;
  document.getElementById('zoomIn').disabled = state.zoom >= ZOOM_MAX;
  void wrap.offsetWidth;
  scroll.scrollLeft = (px - scroll.clientWidth) / 2;
}
document.getElementById('zoomIn').addEventListener('click', () => {
  state.zoom = Math.min(ZOOM_MAX, +(state.zoom + ZOOM_STEP).toFixed(2));
  applyZoom();
});
document.getElementById('zoomOut').addEventListener('click', () => {
  state.zoom = Math.max(ZOOM_MIN, +(state.zoom - ZOOM_STEP).toFixed(2));
  applyZoom();
});
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(applyZoom, 150); });

function showWheel() {
  document.getElementById('wheelView').style.display = '';
  document.getElementById('categoryView').style.display = 'none';
  syncInventoryToolbar();
  requestAnimationFrame(() => applyZoom());
}

function showCategory(catId) {
  const cat = activeCategories().find(c => c.id === catId);
  if (!cat) { showWheel(); return; }

  document.getElementById('wheelView').style.display = 'none';
  const view = document.getElementById('categoryView');
  view.style.display = '';
  view.style.setProperty('--cat', cat.color);
  syncInventoryToolbar();

  document.getElementById('catIcon').textContent = cat.icon;
  document.getElementById('catLabel').textContent = cat.label;
  const count = state.inventory.filter(it => categoryMeta(it.category).id === catId).length;
  document.getElementById('catBlurb').textContent = `${count} item${count === 1 ? '' : 's'} in this category`;

  // Fresh entry into a category always starts collapsed; in-session toggles
  // (show sold, mark sold) keep expand choices via renderCategoryCards alone.
  state.expandedWheelItems = new Set();
  renderCategoryCards(cat);
}

// Item-level list price plus per-platform views/clicks — the numbers a
// seller actually checks day to day — shown directly on the card instead
// of behind a click, per platform since views/clicks are platform-specific.
function platformStatsHTML(item) {
  const platforms = splitPlatforms(item.platform);
  if (!platforms.length) return '';
  const latestByPlatform = latestMetricsByItemPlatform();
  const price = priceLineHTML(item);
  const rows = platforms.map(p => {
    const m = platformMeta(p);
    const snap = latestByPlatform.get(item.itemId + '|' + m.id);
    const views = Number(snap && (snap.views || snap.impressions)) || 0;
    const clicks = Number(snap && snap.clicks) || 0;
    return `
      <div class="ps-row">
        <span class="ps-plat" style="background:${m.color}">${escapeHtml(m.label)}</span>
        <span class="ps-metric"><b>${price}</b><i>price</i></span>
        <span class="ps-metric"><b>${views}</b><i>views</i></span>
        <span class="ps-metric"><b>${clicks}</b><i>clicks</i></span>
      </div>
    `;
  }).join('');
  return `<div class="platform-stats">${rows}</div>`;
}

// Per-site state on an inventory card: where this item is live versus still
// waiting to be posted, so the card answers "where is this up right now?"
// without opening the Actions page.
function siteStatusChipsHTML(item) {
  const status = platformsStatusFor(item);
  const sold = isSold(item);
  const chip = (row, cls, text, title) =>
    `<span class="stl-chip ${cls}" style="--plat:${row.meta.color}" title="${escapeHtml(title)}">${escapeHtml(text)}</span>`;
  const chips = status.done
    .map(d => chip(d, 'stl-done', '✓ ' + d.meta.label, sold ? 'Still live on ' + d.meta.label + ' — needs ending' : 'Live on ' + d.meta.label))
    .concat(status.ended.map(e => chip(e, 'stl-skipped', 'Ended · ' + e.meta.label, 'Listing ended on ' + e.meta.label)))
    .concat(sold ? [] : status.missing.map(m => chip(m, 'stl-missing', m.meta.label, 'Still to post on ' + m.meta.label)))
    .concat(sold ? [] : status.skipped.map(s => chip(s, 'stl-skipped', 'Not posting · ' + s.meta.label, 'Not posting on ' + s.meta.label)));
  return chips.length ? `<div class="site-chips">${chips.join('')}</div>` : '';
}

// Cover photos are pulled from the live listings, so an item that isn't up
// anywhere yet has no image to pull — say which of the two it is rather than
// leaving every empty card reading the same thing.
function photoPendingLabel(item) {
  const status = String(item.sourceStatus || '').trim().toLowerCase();
  return ['photograph', 'identify', 'blank', ''].includes(status) ? 'Needs photos' : 'Photo pending';
}

// A booked meetup or a pending hand-off belongs on the item itself, not
// only on the Actions board.
function localDealBadgesHTML(itemId) {
  const deals = localDealsForItem(itemId);
  if (!deals.length) return '';
  return `<div class="ld-badges">${deals.map(d => {
    const meta = localDealStatusMeta(d.status);
    const when = d.when ? ` — ${d.when}` : '';
    return `<span class="ld-badge" style="--plat:${meta.color}"><span aria-hidden="true">${meta.icon}</span> ${escapeHtml(meta.label + when)}</span>`;
  }).join('')}</div>`;
}

function itemCardHTML(item, cat) {
  const sold = isSold(item);
  const expanded = state.expandedItems.has(item.itemId);
  const titleParts = [item.brand, item.item].filter(Boolean);
  const photo = photoForItem(item.itemId);
  const title = titleParts.join(' — ') || item.itemId;
  return `
    <div class="card${sold ? ' sold' : ''}" style="--cat:${cat.color}">
      <div class="card-media${photo ? '' : ' photo-pending'}">
        ${photo ? `<img class="card-photo" src="${escapeHtml(photo)}" alt="${escapeHtml(title)}" loading="lazy" onerror="this.closest('.card-media').classList.add('photo-pending');this.remove()">` : ''}
        <span>${photoPendingLabel(item)}</span>
      </div>
      <div class="card-top">
        <label class="pick-box" title="Select this item"><input type="checkbox" data-pick="${escapeHtml(item.itemId)}"${state.picked.has(String(item.itemId)) ? ' checked' : ''}><span></span></label>
        <h3>${escapeHtml(title)}</h3>
        <span class="status-badge ${statusClass(item.sourceStatus)}">${escapeHtml(item.sourceStatus || '—')}</span>
      </div>
      ${actionBadgesHTML(item.itemId)}
      ${localDealBadgesHTML(item.itemId)}
      ${siteStatusChipsHTML(item)}
      <div class="meta">
        ${item.size ? `<span><b>Size —</b> ${escapeHtml(item.size)}</span>` : ''}
        ${item.condition ? `<span><b>Condition —</b> ${escapeHtml(item.condition)}</span>` : ''}
        <span><b>List price —</b> ${priceLineHTML(item)}${item.floorPrice ? ` (floor ${escapeHtml(item.floorPrice)})` : ''}</span>
        ${sold ? `<span><b>Sold —</b> ${escapeHtml(item.soldPrice || '—')}</span>` : ''}
      </div>
      ${platformStatsHTML(item)}
      <button class="card-expand-toggle" data-id="${item.itemId}">${expanded ? '− Hide' : '+ Description & mark sold'}</button>
      ${expanded ? itemDetailHTML(item) : ''}
    </div>
  `;
}

function itemDetailHTML(item) {
  const descs = state.descriptions.filter(d => d.itemId === item.itemId);
  const platforms = splitPlatforms(item.platform);

  const blocks = platforms.map(p => {
    const m = platformMeta(p);
    const desc = descs.find(d => platformId(d.platform) === m.id);
    return `
      <div class="listing-block">
        <div class="lb-head"><span class="platform-tag" style="background:${m.color}">${escapeHtml(m.label)}</span></div>
        ${desc ? `<div class="lb-title">${escapeHtml(desc.suggestedTitle || '')}</div><p class="lb-desc">${escapeHtml(desc.description || '')}</p>` : '<p class="lb-desc">No saved title/description for this platform yet.</p>'}
      </div>
    `;
  }).join('') || '<p class="status-msg" style="margin:0">No platform listings recorded for this item yet.</p>';

  const soldForm = !isSold(item) ? `
    <div class="mark-sold-row">
      <input type="text" class="ms-price" placeholder="Sold price" aria-label="Sold price" inputmode="decimal">
      <select class="ms-platform" aria-label="Sold on">
        <option value="">Sold on…</option>
        ${soldOnOptionsHTML(item)}
      </select>
      <input type="text" class="ms-net" placeholder="You kept (optional)" aria-label="Net cash you kept, after fees and shipping" inputmode="decimal">
      <input type="text" class="ms-buyer" placeholder="Buyer (optional)" aria-label="Buyer">
      <button class="btn secondary ms-submit" data-id="${item.itemId}" data-source="${escapeHtml(item.sourceTab || '')}">Mark sold</button>
    </div>
    <div class="status-msg ms-status"></div>
  ` : '';

  const removeRow = `
    <div class="remove-item-row">
      <button type="button" class="icon-btn remove-item-btn" data-id="${escapeHtml(item.itemId)}">Remove item…</button>
    </div>`;
  return `<div class="item-detail">${blocks}${soldForm}${removeRow}</div>`;
}

function wireItemCards(container, onChange) {
  container.querySelectorAll('input[data-pick]').forEach(box => box.addEventListener('change', () => {
    const id = String(box.dataset.pick);
    if (box.checked) state.picked.add(id); else state.picked.delete(id);
    persistPicked();
    renderPickPanel();
  }));
  container.querySelectorAll('.size-pick-all').forEach(btn => btn.addEventListener('click', ev => {
    ev.preventDefault();
    ev.stopPropagation();
    String(btn.dataset.ids || '').split(',').filter(Boolean).forEach(id => state.picked.add(id));
    persistPicked();
    onChange();
    renderPickPanel();
  }));
  container.querySelectorAll('.card-expand-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (state.expandedItems.has(id)) state.expandedItems.delete(id); else state.expandedItems.add(id);
      onChange();
    });
  });
  container.querySelectorAll('.ms-submit').forEach(btn => {
    btn.addEventListener('click', () => markSold(btn, onChange));
  });
  container.querySelectorAll('.remove-item-btn').forEach(btn => {
    btn.addEventListener('click', () => openRemoveDialog(btn.dataset.id, btn));
  });
}

async function markSold(btn, onChange) {
  const card = btn.closest('.item-detail');
  const status = card.querySelector('.ms-status');
  const price = card.querySelector('.ms-price').value.trim();
  const buyer = card.querySelector('.ms-buyer').value.trim();
  const platformLabel = card.querySelector('.ms-platform').value;
  const netRaw = card.querySelector('.ms-net').value.trim();
  const itemId = btn.dataset.id;
  const sourceTab = btn.dataset.source;
  if (!price) { status.textContent = 'Enter a sold price.'; return; }
  if (!platformLabel) { status.textContent = 'Pick the site it sold on, so Stats can total it.'; return; }
  if (!connected()) { status.textContent = 'Connect your Sheet to mark items sold — see SETUP.md.'; return; }

  status.textContent = 'Saving...';
  try {
    const netCash = netRaw ? parseMoney(netRaw) : '';
    const res = await apiPost('markSold', { itemId, sourceTab, soldPrice: parseMoney(price), buyer, platform: platformLabel, netCash, dateSold: todayStr() });
    if (!res || !res.ok) { status.textContent = (res && res.error) || 'Could not find that row in the Sheet.'; return; }
    const item = state.inventory.find(i => i.itemId === itemId);
    if (item) { item.sourceStatus = 'Sold'; item.soldPrice = parseMoney(price); item.buyer = buyer; if (netCash !== '') item.netCash = netCash; }
    const saleId = `${platformId(platformLabel) || 'other'}-${itemId}`;
    state.sales = state.sales.filter(sl => sl.saleId !== saleId).concat([{
      saleId, itemId, item: item ? [item.brand, item.item].filter(Boolean).join(' ') : itemId, platform: platformLabel,
      salePrice: parseMoney(price), netCash, dateSold: todayStr(), source: 'Marked sold on site',
    }]);
    await recordItemAction(itemId, 'Sold', price);
    status.textContent = 'Marked sold.';
    onChange();
    renderWheel();
    renderStats();
    renderAction();
  } catch {
    status.textContent = 'Could not save to your Sheet.';
  }
}

// ---------------------------------------------------------------------
// Removing items — "Save for later" moves an item out of the inventory into
// the Saved for Later tab (restorable); "Delete for good" removes it and its
// queue rows, descriptions, photos and stats. Sales and the action log stay.
// ---------------------------------------------------------------------
// Manual Refresh — re-fetches live Sheet data without a browser reload.
// Uses the individual (uncached) endpoints instead of bootBundle so Sheet
// edits aren't hidden behind the 2-minute ScriptCache on bootBundle.
// Fetches into locals first so a failed request never blanks the current UI.
async function reloadLiveData() {
  document.getElementById('inventorySetupNote').style.display = connected() ? 'none' : 'block';
  if (!connected()) {
    const err = new Error('Not connected to your Sheet.');
    err.code = 'offline';
    throw err;
  }
  // Best-effort eBay traffic sync first so the metrics fetch below sees fresh
  // rows. Missing credentials / API errors must not fail the whole Refresh.
  let ebaySyncNote = '';
  try {
    const syncRes = await apiPost('syncEbayMetrics', {}, { timeoutMs: 90000 });
    if (!syncRes) {
      ebaySyncNote = 'eBay sync skipped (no token)';
    } else if (syncRes.ok === false) {
      const err0 = (syncRes.errors && syncRes.errors[0]) || '';
      ebaySyncNote = /no token/i.test(String(err0))
        ? 'eBay sync skipped (no token)'
        : 'eBay sync skipped';
    } else if (Number(syncRes.synced) > 0) {
      const n = Number(syncRes.synced);
      ebaySyncNote = `eBay: ${n} listing${n === 1 ? '' : 's'} updated`;
    } else {
      ebaySyncNote = 'eBay: no listings updated';
    }
  } catch {
    ebaySyncNote = 'eBay sync skipped';
  }
  // Inventory is required; companion datasets are best-effort so one flaky
  // secondary call doesn't block the refresh Randy actually cares about.
  // Kick everything off together; only inventory must succeed.
  const inventoryPromise = apiGetWithRetry('inventory', { timeoutMs: 45000 });
  const settledPromise = Promise.allSettled([
    apiGetWithRetry('descriptions', { timeoutMs: 45000 }),
    apiGetWithRetry('postingQueue', { timeoutMs: 45000 }),
    apiGetWithRetry('metrics', { timeoutMs: 45000 }),
    apiGetWithRetry('photos', { timeoutMs: 45000 }),
    apiGetWithRetry('itemActions', { timeoutMs: 45000 }),
    apiGetWithRetry('localDeals', { timeoutMs: 45000 }),
    apiGetWithRetry('savedItems', { timeoutMs: 45000 }),
    apiGetWithRetry('salesBundle', { timeoutMs: 45000 }),
  ]);
  const inventory = await inventoryPromise;
  if (!Array.isArray(inventory)) throw new Error('inventory refresh failed');
  const settled = await settledPromise;
  const val = (i) => settled[i].status === 'fulfilled' ? settled[i].value : null;
  state.inventory = inventory.filter(isRealItem);
  const descriptions = val(0);
  const postingQueue = val(1);
  const metrics = val(2);
  const photos = val(3);
  const itemActions = val(4);
  const localDeals = val(5);
  const savedItems = val(6);
  const salesBundle = val(7);
  if (Array.isArray(descriptions)) state.descriptions = descriptions;
  if (Array.isArray(postingQueue)) state.postingQueue = postingQueue;
  if (Array.isArray(metrics)) state.metrics = metrics;
  if (Array.isArray(photos)) state.photos = photos;
  if (Array.isArray(itemActions)) state.itemActions = itemActions;
  if (Array.isArray(localDeals)) state.localDeals = localDeals;
  if (Array.isArray(savedItems)) state.savedItems = savedItems;
  if (salesBundle && typeof salesBundle === 'object') {
    if (Array.isArray(salesBundle.sales)) state.sales = salesBundle.sales;
    if (Array.isArray(salesBundle.balances)) state.balances = salesBundle.balances;
  }
  state.loadedAt = new Date().toISOString();
  // Keep in-session collapse choices; do not auto-expand sections.
  renderSavedItems();
  refreshInventoryViews();
  populateMetricForm();
  notifyWorkroom();
  return { ebaySyncNote };
}

function refreshInventoryViews() {
  renderWheel();
  routeOverview();
  renderListChips();
  renderList();
  renderPickPanel();
  renderStats();
  renderAction();
}

function openRemoveDialog(itemId, opener) {
  const dialog = document.getElementById('removeItemDialog');
  const item = state.inventory.find(i => i.itemId === itemId);
  if (!dialog || !item) return;
  const title = [item.brand, item.item].filter(Boolean).join(' — ') || item.itemId;
  const live = platformsStatusFor(item).done.map(d => d.meta.label);
  const sold = isSold(item);
  dialog.dataset.itemId = itemId;
  dialog.innerHTML = `
    <form method="dialog" class="remove-form">
      <h3 id="removeItemTitle">Remove ${escapeHtml(title)}?</h3>
      ${live.length ? `<p class="remove-warning">Still live on ${escapeHtml(live.join(', '))}. Removing it here won't end those listings — take them down on each site too.</p>` : ''}
      ${sold ? '<p class="remove-note">This item is sold. Its sale stays in the Sales tab either way.</p>' : ''}
      <div class="remove-step" data-step="choose">
        <div class="remove-option">
          <h4>Save for later</h4>
          <p>Moves it out of the inventory into the "Saved for Later" tab of your Sheet, with everything needed to bring it back.</p>
          <label class="remove-reason"><span>Why? <small>optional</small></span><input type="text" name="reason" maxlength="120" placeholder="e.g. keeping it for now"></label>
          <button type="button" class="btn remove-save-btn">Save for later</button>
        </div>
        <div class="remove-option danger">
          <h4>Delete for good</h4>
          <p>Removes it from the Sheet, along with its posting queue rows, listing descriptions, photos and stats.</p>
          <button type="button" class="btn secondary remove-delete-btn">Delete for good…</button>
        </div>
      </div>
      <div class="remove-step" data-step="confirm" hidden>
        <p class="remove-warning"><b>This can't be undone.</b> ${escapeHtml(title)} will be removed from your Sheet. Sales and the action log are kept.</p>
        <div class="remove-actions">
          <button type="button" class="btn danger remove-confirm-btn">Yes, delete permanently</button>
          <button type="button" class="btn secondary remove-back-btn">Back</button>
        </div>
      </div>
      <p class="status-msg remove-status" role="status"></p>
      <button type="button" class="icon-btn remove-cancel-btn">Cancel</button>
    </form>`;

  const status = dialog.querySelector('.remove-status');
  const setBusy = busy => dialog.querySelectorAll('button, input').forEach(el => { el.disabled = busy; });
  const close = () => { dialog.close(); if (opener && document.contains(opener)) opener.focus(); };
  const run = async mode => {
    if (!connected()) { status.textContent = 'Connect your Sheet to remove items — see SETUP.md.'; return; }
    const reason = (dialog.querySelector('input[name="reason"]') || {}).value || '';
    setBusy(true);
    status.textContent = (mode === 'delete' ? 'Deleting…' : 'Saving for later…') + ' this can take up to a minute.';
    let res = null;
    try { res = await apiPost('removeItem', { itemId, mode, reason: reason.trim() }); } catch { res = null; }
    if (!res || !res.ok) {
      // Google sometimes garbles the reply after the write lands — check before calling it a failure.
      const landed = await removalLanded(itemId);
      if (!landed) {
        setBusy(false);
        status.textContent = (res && res.error) || "Couldn't confirm with your Sheet. Nothing is shown as removed — reload to check.";
        return;
      }
    }
    state.inventory = state.inventory.filter(i => i.itemId !== itemId);
    if (mode === 'delete') state.postingQueue = state.postingQueue.filter(r => r.itemId !== itemId);
    else state.postingQueue.forEach(r => { if (r.itemId === itemId) r.status = 'Saved for later'; });
    close();
    refreshInventoryViews();
    if (mode === 'saveForLater') loadSavedItems();
  };

  dialog.querySelector('.remove-save-btn').addEventListener('click', () => run('saveForLater'));
  dialog.querySelector('.remove-delete-btn').addEventListener('click', () => {
    dialog.querySelector('[data-step="choose"]').hidden = true;
    dialog.querySelector('[data-step="confirm"]').hidden = false;
    dialog.querySelector('.remove-back-btn').focus();
  });
  dialog.querySelector('.remove-back-btn').addEventListener('click', () => {
    dialog.querySelector('[data-step="confirm"]').hidden = true;
    dialog.querySelector('[data-step="choose"]').hidden = false;
    dialog.querySelector('.remove-delete-btn').focus();
  });
  dialog.querySelector('.remove-confirm-btn').addEventListener('click', () => run('delete'));
  dialog.querySelector('.remove-cancel-btn').addEventListener('click', close);
  dialog.showModal();
  dialog.querySelector('.remove-save-btn').focus();
}

async function removalLanded(itemId) {
  try {
    const inventory = await apiGetWithRetry('inventory', { timeoutMs: 45000, attempts: 1 });
    return Array.isArray(inventory) && !inventory.some(i => i.itemId === itemId);
  } catch { return false; }
}

state.savedItems = [];
async function loadSavedItems() {
  if (!connected()) return;
  try { state.savedItems = (await apiGetWithRetry('savedItems')) || []; }
  catch { state.savedItems = []; }
  renderSavedItems();
}

function renderSavedItems() {
  const list = document.getElementById('savedList');
  const count = document.getElementById('savedCount');
  if (!list) return;
  count.textContent = state.savedItems.length ? `(${state.savedItems.length})` : '';
  if (!state.savedItems.length) {
    list.innerHTML = '<div class="empty-state">Nothing saved for later. Use "Remove item…" on an inventory card to move something here.</div>';
    return;
  }
  list.innerHTML = `<div class="saved-grid">${state.savedItems.map(s => `
    <div class="saved-card">
      <h4>${escapeHtml([s.brand, s.item].filter(Boolean).join(' — ') || s.itemId)}</h4>
      <div class="meta">
        <span><b>Saved —</b> ${escapeHtml(String(s.dateSaved || '').slice(0, 10))}</span>
        ${s.reason ? `<span><b>Why —</b> ${escapeHtml(s.reason)}</span>` : ''}
        ${s.listPrice ? `<span><b>List price —</b> ${escapeHtml(String(s.listPrice))}</span>` : ''}
        ${s.liveWhenSaved ? `<span class="saved-live"><b>Was live on —</b> ${escapeHtml(s.liveWhenSaved)}</span>` : ''}
      </div>
      <button type="button" class="btn secondary restore-item-btn" data-id="${escapeHtml(s.itemId)}">Restore to inventory</button>
      <p class="status-msg restore-status" role="status"></p>
    </div>`).join('')}</div>`;
  list.querySelectorAll('.restore-item-btn').forEach(btn => btn.addEventListener('click', () => restoreSavedItem(btn)));
}

async function restoreSavedItem(btn) {
  const status = btn.parentElement.querySelector('.restore-status');
  const itemId = btn.dataset.id;
  btn.disabled = true;
  status.textContent = 'Restoring… this can take up to a minute.';
  let res = null;
  try { res = await apiPost('restoreItem', { itemId }); } catch { res = null; }
  await Promise.all([loadInventory(), loadPostingQueueData()]);
  const back = state.inventory.some(i => i.itemId === itemId);
  if (!back) {
    btn.disabled = false;
    status.textContent = (res && res.error) || "Couldn't confirm the restore — reload to check.";
    return;
  }
  refreshInventoryViews();
  loadSavedItems();
}

function renderCategoryCards(cat) {
  const grid = document.getElementById('categoryCards');
  let items = state.inventory.filter(it => categoryMeta(it.category).id === cat.id);
  if (!state.showSold) items = items.filter(it => !isSold(it));
  items = items.slice().sort((a, b) => (a.item || a.brand || '').localeCompare(b.item || b.brand || ''));

  if (!items.length) {
    grid.className = 'card-grid';
    grid.innerHTML = '<div class="empty-state">Nothing here yet.</div>';
    return;
  }

  // Same compact header pattern as By views: short name (+ size when present);
  // full card only after expand. Uses ranked-row styles for visual consistency.
  grid.className = 'ranked-list';
  grid.innerHTML = items.map(it => {
    const id = String(it.itemId);
    const open = state.expandedWheelItems.has(id) ? ' open' : '';
    const label = itemShortName(it) + (it.size ? ` · ${it.size}` : '');
    return `
    <details class="ranked-row" data-wheel-id="${escapeHtml(id)}"${open}>
      <summary class="ranked-row-head">
        <span class="ranked-row-title">${escapeHtml(label)}</span>
      </summary>
      <div class="card-grid ranked-card">${itemCardHTML(it, cat)}</div>
    </details>`;
  }).join('');
  grid.querySelectorAll('details.ranked-row').forEach(row => {
    row.addEventListener('toggle', () => {
      const id = row.dataset.wheelId;
      if (!id) return;
      if (row.open) state.expandedWheelItems.add(id); else state.expandedWheelItems.delete(id);
    });
  });
  wireItemCards(grid, () => renderCategoryCards(cat));
}

document.getElementById('backToWheel').addEventListener('click', () => { location.hash = ''; });

document.getElementById('showSoldCategory').addEventListener('change', e => {
  state.showSold = e.target.checked;
  const catId = (location.hash.match(/^#\/category\/(.+)$/) || [])[1];
  const cat = activeCategories().find(c => c.id === catId);
  if (cat) renderCategoryCards(cat);
});

function routeOverview() {
  const match = location.hash.match(/^#\/category\/(.+)$/);
  if (match) showCategory(match[1]); else showWheel();
}
window.addEventListener('hashchange', routeOverview);

// ---------------------------------------------------------------------
// Inventory — List mode (every category, stacked, filterable)
// ---------------------------------------------------------------------
function renderListChips() {
  const row = document.getElementById('chipRow');
  const toggle = row.querySelector('.chip-toggle');
  row.querySelectorAll('.chip').forEach(c => c.remove());

  activeCategories().forEach(cat => {
    if (!state.listActiveCats.has(cat.id)) state.listActiveCats.add(cat.id);
    const chip = document.createElement('div');
    chip.className = 'chip active';
    chip.style.setProperty('--dot', cat.color);
    chip.innerHTML = `<span class="dot"></span>${cat.icon} ${cat.label}`;
    chip.addEventListener('click', () => {
      if (state.listActiveCats.has(cat.id)) { state.listActiveCats.delete(cat.id); chip.classList.remove('active'); }
      else { state.listActiveCats.add(cat.id); chip.classList.add('active'); }
      renderList();
    });
    row.insertBefore(chip, toggle);
  });
}
document.getElementById('showSoldList').addEventListener('change', e => {
  state.listShowSold = e.target.checked;
  renderList();
});
document.getElementById('listSortSelect').addEventListener('change', e => {
  state.listSort = e.target.value;
  setMode('list', true);
  renderList();
});

// Aggregates views/clicks across all of an item's platforms — used for
// sorting the list view; wheel/category views stay alphabetical since
// they're a browse-by-category tool, not a ranked list.
function itemSortStats(item, latestByPlatform) {
  const platforms = splitPlatforms(item.platform);
  let views = 0, clicks = 0;
  platforms.forEach(p => {
    const m = platformMeta(p);
    const snap = latestByPlatform.get(item.itemId + '|' + m.id);
    views += snapshotViews(snap, m.id);
    clicks += Number(snap && snap.clicks) || 0;
  });
  return { views, clicks, ctr: views ? clicks / views : 0, price: parseMoney(item.listPrice) };
}

// ---------------------------------------------------------------------
// Sizes — the Size view groups inventory the way you'd actually shop it:
// shoes by men's/women's/youth number, tops by letter, bottoms by waist.
// The sheet's Size column is free text (and holds things like "Queen" or
// "32 oz" for non-apparel), so anything unrecognised lands in "No size".
// ---------------------------------------------------------------------
const LETTER_SIZES = { xs: 'XS', s: 'S', sm: 'S', small: 'S', m: 'M', med: 'M', medium: 'M', l: 'L', lg: 'L', large: 'L', xl: 'XL', xxl: '2XL', '2xl': '2XL', xxxl: '3XL', '3xl': '3XL' };
function sizeBucket(item) {
  const raw = String(item.size || '').trim();
  if (!raw) return { group: 'No size', label: 'No size', order: 9, sort: 0 };
  const low = raw.toLowerCase();
  const shoe = low.match(/(men|women|youth|kid|big boy|us)\D{0,4}(\d+(?:\.\d)?)/);
  if (shoe) {
    const who = /women/.test(shoe[1]) ? "Women's" : /youth|kid|boy/.test(shoe[1]) ? 'Youth' : "Men's";
    return { group: `Shoes — ${who}`, label: `${who} ${shoe[2]}`, order: who === "Men's" ? 0 : who === "Women's" ? 1 : 2, sort: Number(shoe[2]) };
  }
  const waist = low.match(/^(\d{2})\s*[\/x]\s*(\d{2}|\?)$/) || low.match(/^(\d{2})$/);
  if (waist && Number(waist[1]) >= 24 && Number(waist[1]) <= 48) {
    return { group: 'Bottoms — waist', label: `W${waist[1]}${waist[2] && waist[2] !== '?' ? ` / L${waist[2]}` : ''}`, order: 4, sort: Number(waist[1]) };
  }
  const lead = low.match(/^(xxxl|xxl|3xl|2xl|xl|xs|small|sm|s|medium|med|m|large|lg|l)\b/);
  const letter = lead ? LETTER_SIZES[lead[1]] : null;
  if (letter) {
    const order = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'].indexOf(letter);
    return { group: 'Tops & outerwear', label: letter, order: 3, sort: order };
  }
  const womens = low.match(/^(\d{1,2})$/);
  if (womens && Number(womens[1]) <= 20) return { group: "Women's numeric", label: `Size ${womens[1]}`, order: 5, sort: Number(womens[1]) };
  if (/one size/.test(low)) return { group: 'One size', label: 'One size', order: 6, sort: 0 };
  // Non-apparel ("Queen", "32 oz", "5-DVD lot") all share one row.
  return { group: 'No size', label: 'No size', order: 9, sort: 0 };
}

function renderSizeView(container, latestByPlatform, compareItems) {
  let items = state.inventory.filter(it => state.listActiveCats.has(categoryMeta(it.category).id));
  if (!state.listShowSold) items = items.filter(it => !isSold(it));
  const buckets = new Map();
  items.forEach(it => {
    const b = sizeBucket(it);
    const key = `${b.order}|${b.group}|${String(Math.round(b.sort * 10)).padStart(5, '0')}|${b.label}`;
    if (!buckets.has(key)) buckets.set(key, { ...b, key, items: [] });
    buckets.get(key).items.push(it);
  });
  if (!buckets.size) { container.innerHTML = '<div class="empty-state">No inventory matches these filters.</div>'; return; }
  const groups = new Map();
  [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([, b]) => {
    if (!groups.has(b.group)) groups.set(b.group, []);
    groups.get(b.group).push(b);
  });
  container.innerHTML = [...groups.entries()].map(([group, sizes]) => `
    <section class="size-group">
      <div class="size-group-head"><h2>${escapeHtml(group)}</h2><span class="count">${sizes.reduce((n, s) => n + s.items.length, 0)} items</span></div>
      ${sizes.map(s => {
        const sorted = s.items.map(it => ({ it, stats: itemSortStats(it, latestByPlatform) })).sort(compareItems).map(x => x.it);
        const open = state.expandedSizes.has(s.key) ? ' open' : '';
        return `
        <details class="size-row" data-size-key="${escapeHtml(s.key)}"${open}>
          <summary>
            <span class="size-tag">${escapeHtml(s.label)}</span>
            <span class="size-count">${sorted.length}</span>
            <span class="size-names">${escapeHtml(sorted.map(it => itemShortName(it)).join(' · ').slice(0, 90))}</span>
            <button type="button" class="btn secondary size-pick-all" data-ids="${escapeHtml(sorted.map(it => it.itemId).join(','))}">Select these ${sorted.length}</button>
          </summary>
          <div class="card-grid">${sorted.map(it => itemCardHTML(it, categoryMeta(it.category))).join('')}</div>
        </details>`;
      }).join('')}
    </section>`).join('');
  container.querySelectorAll('details.size-row').forEach(row => {
    row.addEventListener('toggle', () => {
      const key = row.dataset.sizeKey;
      if (!key) return;
      if (row.open) state.expandedSizes.add(key); else state.expandedSizes.delete(key);
    });
  });
}

// ---------------------------------------------------------------------
// Selected items — tick any cards and this panel shows only those, with
// the numbers you need to price a bundle.
// ---------------------------------------------------------------------
function pickedItems() {
  return state.inventory.filter(it => state.picked.has(String(it.itemId)));
}
function bundlePrice(total) {
  if (!total) return 0;
  const cut = Math.round(total * 0.85);
  return Math.max(1, cut) - 0.01;
}
function renderPickPanel() {
  const el = document.getElementById('pickPanel');
  if (!el) return;
  const items = pickedItems();
  if (!items.length) { el.innerHTML = ''; el.hidden = true; return; }
  el.hidden = false;
  const latestByPlatform = latestMetricsByItemPlatform();
  const total = items.reduce((n, it) => n + parseMoney(it.listPrice), 0);
  const floor = items.reduce((n, it) => n + parseMoney(it.floorPrice), 0);
  const rows = items.map(it => {
    const b = sizeBucket(it);
    const stats = itemSortStats(it, latestByPlatform);
    const photo = photoForItem(it.itemId);
    const sites = splitPlatforms(it.platform).map(p => platformMeta(p).label).join(', ');
    return `
      <li class="pick-row">
        <span class="pick-thumb">${photo ? `<img src="${escapeHtml(photo)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>
        <span class="pick-main">
          <b>${escapeHtml([it.brand, it.item].filter(Boolean).join(' — ') || it.itemId)}</b>
          <small>${escapeHtml(b.label)} · ${escapeHtml(it.condition || '—')} · ${escapeHtml(sites || 'not listed')}</small>
        </span>
        <span class="pick-stats"><b>${fmtMoney(parseMoney(it.listPrice))}</b><small>${stats.views} views · ${stats.clicks} clicks</small></span>
        <button type="button" class="icon-btn pick-drop" data-id="${escapeHtml(it.itemId)}" aria-label="Remove from selection">✕</button>
      </li>`;
  }).join('');
  const summary = items.map(it => `${[it.brand, it.item].filter(Boolean).join(' ')} (${sizeBucket(it).label}, ${it.condition || 'used'})`).join('\n');
  el.innerHTML = `
    <div class="pick-head">
      <h3>Selected items <span class="pick-count">${items.length}</span></h3>
      <div class="pick-actions">
        <button type="button" class="btn secondary" id="pickCopy">Copy bundle list</button>
        <button type="button" class="icon-btn" id="pickClear">Clear</button>
      </div>
    </div>
    <div class="stat-tiles pick-tiles">
      <div class="stat-tile"><div class="num">${fmtMoney(total)}</div><div class="lbl">Sold separately</div></div>
      <div class="stat-tile"><div class="num">${fmtMoney(bundlePrice(total))}</div><div class="lbl">Bundle at 15% off</div></div>
      <div class="stat-tile"><div class="num">${fmtMoney(floor)}</div><div class="lbl">Floor total</div></div>
    </div>
    <ul class="pick-list">${rows}</ul>
    <textarea class="pick-summary" id="pickSummary" rows="${Math.min(items.length + 1, 8)}" readonly>${escapeHtml(summary)}</textarea>`;
  el.querySelector('#pickClear').addEventListener('click', () => { state.picked.clear(); persistPicked(); renderList(); renderPickPanel(); });
  el.querySelector('#pickCopy').addEventListener('click', () => {
    // Same belt-and-braces copy as the listing fields: select the text so it's
    // ready for Cmd-C even when the clipboard API is blocked.
    const box = el.querySelector('#pickSummary');
    box.focus(); box.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    const btn = el.querySelector('#pickCopy');
    btn.textContent = ok ? 'Copied' : 'Selected — press Cmd-C';
    setTimeout(() => { btn.textContent = 'Copy bundle list'; }, 1800);
  });
  el.querySelectorAll('.pick-drop').forEach(b => b.addEventListener('click', () => {
    state.picked.delete(String(b.dataset.id)); persistPicked(); renderList(); renderPickPanel();
  }));
}
function persistPicked() { localSet('sellHub.picked', [...state.picked]); }

function renderList() {
  const container = document.getElementById('catSections');
  container.innerHTML = '';
  const latestByPlatform = latestMetricsByItemPlatform();

  const compareItems = (a, b) => {
    if (state.listSort === 'views') return b.stats.views - a.stats.views;
    if (state.listSort === 'clicks') return b.stats.clicks - a.stats.clicks;
    if (state.listSort === 'ctr') return b.stats.ctr - a.stats.ctr;
    if (state.listSort === 'price') return b.stats.price - a.stats.price;
    return (a.it.item || a.it.brand || '').localeCompare(b.it.item || b.it.brand || '');
  };

  if (state.listGroup === 'size') {
    renderSizeView(container, latestByPlatform, compareItems);
    wireItemCards(container, renderList);
    return;
  }

  if (state.listGroup === 'ranked') {
    let items = state.inventory.filter(it => state.listActiveCats.has(categoryMeta(it.category).id));
    if (!state.listShowSold) items = items.filter(it => !isSold(it));
    const ranked = items.map(it => ({ it, stats: itemSortStats(it, latestByPlatform) })).sort(compareItems);
    const labels = { views: 'Most views', clicks: 'Most clicks', ctr: 'Highest click rate', price: 'Highest price', name: 'By name' };
    container.innerHTML = ranked.length ? `
      <div class="cat-section ranked-section">
        <div class="cat-heading"><span class="rank-mark">#</span><h2>${labels[state.listSort]}</h2><span class="count">${ranked.length} items</span></div>
        <div class="ranked-list">
          ${ranked.map(({ it }, i) => {
            const rank = i + 1;
            const id = String(it.itemId);
            const open = state.expandedRanked.has(id) ? ' open' : '';
            return `
            <details class="ranked-row" data-rank-id="${escapeHtml(id)}"${open}>
              <summary class="ranked-row-head">
                <span class="ranked-row-title">${escapeHtml(itemShortName(it))} / ${rank}</span>
              </summary>
              <div class="card-grid ranked-card">${itemCardHTML(it, categoryMeta(it.category))}</div>
            </details>`;
          }).join('')}
        </div>
      </div>
    ` : '<div class="empty-state">No inventory matches these filters.</div>';
    container.querySelectorAll('details.ranked-row').forEach(row => {
      row.addEventListener('toggle', () => {
        const id = row.dataset.rankId;
        if (!id) return;
        if (row.open) state.expandedRanked.add(id); else state.expandedRanked.delete(id);
      });
    });
    wireItemCards(container, renderList);
    return;
  }

  activeCategories().filter(c => state.listActiveCats.has(c.id)).forEach(cat => {
    let items = state.inventory.filter(it => categoryMeta(it.category).id === cat.id);
    if (!state.listShowSold) items = items.filter(it => !isSold(it));
    const withStats = items.map(it => ({ it, stats: itemSortStats(it, latestByPlatform) }));
    withStats.sort(compareItems);
    items = withStats.map(x => x.it);

    // <details> default-collapsed; expanded category ids remembered for the session.
    const section = document.createElement('details');
    section.className = 'cat-section';
    section.open = state.expandedCats.has(cat.id);
    section.style.setProperty('--cat', cat.color);
    section.innerHTML = `
      <summary class="cat-heading">
        <span class="icon">${cat.icon}</span>
        <h2>${cat.label}</h2>
        <span class="count">${items.length}</span>
      </summary>
      ${items.length ? `<div class="card-grid">${items.map(it => itemCardHTML(it, cat)).join('')}</div>` : '<div class="empty-state">Nothing here yet.</div>'}
    `;
    section.addEventListener('toggle', () => {
      if (section.open) state.expandedCats.add(cat.id); else state.expandedCats.delete(cat.id);
    });
    wireItemCards(section, renderList);
    container.appendChild(section);
  });

  if (!activeCategories().length) container.innerHTML = '<div class="empty-state">No inventory synced yet.</div>';
}

// ---------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------
function renderStats() {
  document.getElementById('statsSetupNote').style.display = connected() ? 'none' : 'block';
  renderPulseBar();
  renderOverallTiles();
  renderSoldShare();
  renderSalesBySite();
  renderCashFlow();
  renderPlatformCards();
}

// ---------------------------------------------------------------------
// Sales by site — sale amount, what was kept, and the cash each site holds.
// Sales rows are the source of truth; a sold item with no Sales row still
// shows up (as "not recorded by site") so nothing silently drops out.
// ---------------------------------------------------------------------
async function loadSalesData() {
  if (!connected()) { state.sales = []; state.balances = []; return; }
  try {
    const bundle = await apiGetWithRetry('salesBundle');
    state.sales = (bundle && bundle.sales) || [];
    state.balances = (bundle && bundle.balances) || [];
  } catch {
    state.sales = [];
    state.balances = [];
  }
}

function soldOnOptionsHTML(item) {
  const ids = new Set(splitPlatforms(item.platform).map(platformId).filter(Boolean));
  const ordered = PLATFORM_ORDER.filter(id => ids.has(id)).concat(PLATFORM_ORDER.filter(id => !ids.has(id)));
  return ordered.map(id => `<option value="${escapeHtml(PLATFORM_META[id].label)}">${escapeHtml(PLATFORM_META[id].label)}</option>`).join('');
}

function money2(n) {
  if (n === null || n === undefined || n === '' || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  return (v < 0 ? '−$' : '$') + Math.abs(v).toFixed(2);
}
// A deduction: "−$6.11", or plain "$0.00" when nothing was taken out.
function minusMoney(n) {
  const v = Math.abs(Number(n) || 0);
  return v ? '−$' + v.toFixed(2) : '$0.00';
}
function saleNumber(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// Latest balance snapshot per site.
function latestBalancesBySite() {
  const latest = new Map();
  state.balances.forEach(b => {
    const id = platformId(b.platform) || String(b.platform || '').toLowerCase();
    const date = String(b.date || '').slice(0, 10);
    if (!latest.has(id) || date >= latest.get(id).date) latest.set(id, { ...b, date });
  });
  return latest;
}

function salesBySite() {
  const sites = new Map();
  const ensure = label => {
    const meta = platformMeta(label);
    if (!sites.has(meta.id)) sites.set(meta.id, { meta, sales: [], salePrice: 0, shippingCharged: 0, fees: 0, labels: 0, net: 0, netKnown: 0, inPerson: 0 });
    return sites.get(meta.id);
  };
  state.sales.forEach(sale => {
    const site = ensure(sale.platform);
    site.sales.push(sale);
    site.salePrice += saleNumber(sale.salePrice) || 0;
    site.shippingCharged += saleNumber(sale.shippingCharged) || 0;
    site.fees += saleNumber(sale.platformFees) || 0;
    site.labels += saleNumber(sale.shippingLabel) || 0;
    const net = saleNumber(sale.netCash);
    if (net !== null) { site.net += net; site.netKnown++; }
    if (/in person/i.test(String(sale.fundsStatus || '')) && net !== null) site.inPerson += net;
  });
  const balances = latestBalancesBySite();
  balances.forEach((b, id) => { if (!sites.has(id)) ensure(b.platform); });
  sites.forEach((site, id) => { site.balance = balances.get(id) || null; });
  return [...sites.values()].sort((a, b) => platformRank(a.meta.id) - platformRank(b.meta.id) || a.meta.label.localeCompare(b.meta.label));
}

function renderSalesBySite() {
  const totalsEl = document.getElementById('salesTotals');
  const cardsEl = document.getElementById('salesCards');
  if (!totalsEl || !cardsEl) return;
  const sites = salesBySite();
  const recordedIds = new Set(state.sales.map(sl => String(sl.itemId)));
  const unrecorded = state.inventory.filter(it => isSold(it) && !recordedIds.has(String(it.itemId)));

  const sum = key => sites.reduce((acc, site) => acc + site[key], 0);
  const saleAmount = sum('salePrice');
  const shipping = sum('shippingCharged');
  const costs = sum('fees') + sum('labels');
  const net = sum('net');
  const inPerson = sum('inPerson');
  const withBalance = sites.filter(site => site.balance);
  const available = withBalance.reduce((acc, site) => acc + (saleNumber(site.balance.available) || 0), 0);
  const pending = withBalance.reduce((acc, site) => acc + (saleNumber(site.balance.pending) || 0), 0);
  const orderTotal = saleAmount + shipping;

  const tiles = [
    { num: state.sales.length, lbl: 'Sales recorded', sub: unrecorded.length ? `${unrecorded.length} sold item${unrecorded.length === 1 ? '' : 's'} not recorded` : '' },
    { num: money2(saleAmount), lbl: 'Sale amount', sub: shipping ? `+ ${money2(shipping)} shipping charged` : '' },
    { num: minusMoney(costs), lbl: 'Fees & labels' },
    { num: money2(net), lbl: 'Net cash kept', sub: orderTotal ? `${Math.round((net / orderTotal) * 100)}% of what buyers paid` : '' },
    { num: withBalance.length ? money2(available) : '—', lbl: 'Available on sites', sub: inPerson ? `+ ${money2(inPerson)} paid in person` : '', negative: available < 0 },
    { num: withBalance.length ? money2(pending) : '—', lbl: 'Pending / on hold' },
  ];
  totalsEl.innerHTML = tiles.map(t => `
    <div class="stat-tile${t.negative ? ' negative' : ''}"><div class="num">${t.num}</div><div class="lbl">${t.lbl}</div>${t.sub ? `<div class="sub">${escapeHtml(t.sub)}</div>` : ''}</div>
  `).join('');

  if (!sites.length && !unrecorded.length) {
    cardsEl.innerHTML = '<div class="empty-state">No sales yet.</div>';
    return;
  }

  const saleLine = sale => {
    const netVal = saleNumber(sale.netCash);
    return `
      <li>
        <b title="${escapeHtml(saleItemName(sale))}">${escapeHtml(saleItemName(sale))}</b>
        <span class="sl-money">${money2(saleNumber(sale.salePrice))} → ${netVal === null ? '<span title="Net not recorded">—</span>' : money2(netVal)}</span>
        <small${sale.notes ? ' class="flag"' : ''}>${escapeHtml([String(sale.dateSold || '').slice(0, 10), sale.fundsStatus, sale.notes].filter(Boolean).join(' · '))} <span class="cf-chip" style="--cash:${cashStatusOf(sale).color}">${escapeHtml(cashStatusOf(sale).label)}</span></small>
      </li>`;
  };

  const cards = sites.map(site => {
    const orderPaid = site.salePrice + site.shippingCharged;
    const b = site.balance;
    const availableVal = b ? saleNumber(b.available) : null;
    const cash = b ? `
      <div class="sales-cash">
        <div class="prow avail${availableVal !== null && availableVal < 0 ? ' negative' : ''}"><span>Available cash</span><b>${money2(availableVal)}</b></div>
        <div class="prow"><span>Pending / on hold</span><b>${money2(saleNumber(b.pending))}</b></div>
        <div class="sales-cash-note">As of ${escapeHtml(String(b.date).slice(0, 10))}${b.notes ? ' · ' + escapeHtml(b.notes) : ''}</div>
      </div>` : site.inPerson ? `
      <div class="sales-cash">
        <div class="prow avail"><span>Cash in hand</span><b>${money2(site.inPerson)}</b></div>
        <div class="sales-cash-note">Paid in person — no site balance to withdraw.</div>
      </div>` : `
      <div class="sales-cash">
        <div class="prow avail"><span>Available cash</span><b>—</b></div>
        <div class="sales-cash-note">Not checked yet — use “Update available cash” below.</div>
      </div>`;
    return `
      <div class="platform-card sales-card" style="--plat:${site.meta.color}">
        <h4>${escapeHtml(site.meta.label)}<span class="sales-count">${site.sales.length} sold</span></h4>
        <div class="prow"><span>Sale amount</span><b>${money2(site.salePrice)}</b></div>
        ${site.shippingCharged ? `<div class="prow"><span>Shipping charged to buyers</span><b>${money2(site.shippingCharged)}</b></div>` : ''}
        <div class="prow minus"><span>Platform fees</span><b>${minusMoney(site.fees)}</b></div>
        <div class="prow minus"><span>Shipping labels</span><b>${minusMoney(site.labels)}</b></div>
        <div class="prow net"><span>Net cash kept</span><b>${site.netKnown ? money2(site.net) : '—'}</b></div>
        ${site.netKnown && orderPaid ? `<div class="sales-keep">${Math.round((site.net / orderPaid) * 100)}% of what buyers paid${site.netKnown < site.sales.length ? ` · ${site.sales.length - site.netKnown} without a net amount` : ''}</div>` : ''}
        ${cash}
        ${site.sales.length ? `<ul class="sales-list">${site.sales.slice().sort((a, b) => String(b.dateSold).localeCompare(String(a.dateSold))).map(saleLine).join('')}</ul>` : ''}
      </div>`;
  });
  if (unrecorded.length) {
    cards.push(`
      <div class="platform-card sales-card unrecorded">
        <h4>Not recorded by site<span class="sales-count">${unrecorded.length}</span></h4>
        <div class="sales-cash-note">Marked sold in the inventory, but there's no Sales row saying which site it sold on, so it isn't in the totals above.</div>
        <ul class="sales-list">${unrecorded.map(it => `
          <li><b>${escapeHtml([it.brand, it.item].filter(Boolean).join(' ') || it.itemId)}</b><span class="sl-money">${money2(saleNumber(it.soldPrice))}</span></li>`).join('')}</ul>
      </div>`);
  }
  cardsEl.innerHTML = cards.join('');
}

async function saveBalance() {
  const status = document.getElementById('balanceStatus');
  const platform = document.getElementById('balancePlatform').value;
  const available = document.getElementById('balanceAvailable').value.trim();
  const pending = document.getElementById('balancePending').value.trim();
  const notes = document.getElementById('balanceNotes').value.trim();
  if (available === '') { status.textContent = 'Enter the available amount (0 is fine).'; return; }
  if (!connected()) { status.textContent = 'Connect your Sheet to save cash balances — see SETUP.md.'; return; }
  const row = { date: todayStr(), platform, available: Number(available), pending: pending === '' ? '' : Number(pending), notes, source: 'Entered on site' };
  status.textContent = 'Saving…';
  try {
    const res = await apiPost('setBalances', { rows: [row] });
    if (!res || !res.ok) throw new Error('not saved');
  } catch {
    status.textContent = "Couldn't confirm the save — it may still have landed. Reload to check.";
    return;
  }
  state.balances = state.balances.filter(b => !(String(b.date).slice(0, 10) === row.date && platformId(b.platform) === platformId(platform))).concat([row]);
  ['balanceAvailable', 'balancePending', 'balanceNotes'].forEach(id => { document.getElementById(id).value = ''; });
  status.textContent = 'Saved.';
  setTimeout(() => { status.textContent = ''; }, 1500);
  renderSalesBySite();
}


// ---------------------------------------------------------------------
// Where the sales come from — one pie of sold listings per site. Built
// from the Sales tab (one row per sale), which is the only place that
// knows which site a sale actually happened on; an item marked sold with
// no Sales row yet is counted as unassigned rather than guessed at.
// ---------------------------------------------------------------------
function soldShareBySite() {
  const sites = new Map();
  state.sales.forEach(sale => {
    const meta = platformMeta(sale.platform);
    if (!sites.has(meta.id)) sites.set(meta.id, { meta, count: 0, salePrice: 0, net: 0 });
    const site = sites.get(meta.id);
    site.count++;
    site.salePrice += saleNumber(sale.salePrice) || 0;
    site.net += saleNumber(sale.netCash) || 0;
  });
  const rows = [...sites.values()].sort((a, b) => b.count - a.count || a.meta.label.localeCompare(b.meta.label));
  const total = rows.reduce((n, r) => n + r.count, 0);
  rows.forEach(r => { r.share = total ? r.count / total : 0; });
  const soldItems = state.inventory.filter(isSold).length;
  const logged = new Set(state.sales.map(sl => String(sl.itemId))).size;
  return { rows, total, unlogged: Math.max(0, soldItems - logged) };
}

// Plain SVG donut — no chart library, same as the rest of the site's visuals.
function donutHTML(rows, total) {
  const R = 60, C = 2 * Math.PI * R;
  let offset = 0;
  const arcs = rows.map(r => {
    const len = r.share * C;
    const seg = `<circle class="donut-seg" r="${R}" cx="80" cy="80" fill="none"
      stroke="${r.meta.color}" stroke-width="28"
      stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}"
      stroke-dashoffset="${(-offset).toFixed(2)}"
      transform="rotate(-90 80 80)"><title>${escapeHtml(r.meta.label)}: ${r.count} of ${total} (${Math.round(r.share * 100)}%)</title></circle>`;
    offset += len;
    return seg;
  }).join('');
  return `
    <svg class="donut" viewBox="0 0 160 160" role="img" aria-label="Sold listings by site: ${escapeHtml(rows.map(r => `${r.meta.label} ${r.count}`).join(', '))}">
      <circle r="${R}" cx="80" cy="80" fill="none" stroke="var(--border)" stroke-width="28"></circle>
      ${arcs}
      <text class="donut-num" x="80" y="76" text-anchor="middle">${total}</text>
      <text class="donut-lbl" x="80" y="94" text-anchor="middle">sold</text>
    </svg>`;
}

function renderSoldShare() {
  const el = document.getElementById('soldShare');
  if (!el) return;
  const { rows, total, unlogged } = soldShareBySite();
  if (!total) {
    el.innerHTML = '<div class="empty-state">No sales logged yet — once one lands, this shows how your sales split across sites.</div>';
    return;
  }
  el.innerHTML = `
    ${donutHTML(rows, total)}
    <ul class="donut-legend">
      ${rows.map(r => `
        <li>
          <span class="dot" style="background:${r.meta.color}"></span>
          <span class="dl-site">${escapeHtml(r.meta.label)}</span>
          <span class="dl-pct">${Math.round(r.share * 100)}%</span>
          <span class="dl-sub">${r.count} sold · ${fmtMoney(r.salePrice)} in · ${fmtMoney(r.net)} kept</span>
        </li>`).join('')}
      ${unlogged ? `<li class="dl-note">${unlogged} sold item${unlogged > 1 ? 's aren\'t' : " isn't"} logged in Sales yet, so ${unlogged > 1 ? 'they are' : 'it is'} not counted here.</li>` : ''}
    </ul>`;
}

// ---------------------------------------------------------------------
// Cash flow — Randy's own plan for each sale's money, separate from what
// the sites report. Stored on the sale's row in the Sales tab (Cash Status,
// Cash Status Date, Cash Note), so the sale figures themselves never move.
//   ''          -> Not planned: money exists (pending or available) but
//                  nothing is counting on it yet
//   Accounted   -> planned around, still on the site / pending
//   Cashed out  -> withdrawn from the site and used
// ---------------------------------------------------------------------
const CASH_STATUSES = [
  { id: '',           label: 'Not planned', short: 'Not planned', color: '#a1752e' },
  { id: 'Accounted',  label: 'Accounted',   short: 'Accounted',   color: '#1f3a5c' },
  { id: 'Cashed out', label: 'Cashed out',  short: 'Cashed out',  color: '#16836a' },
];
function cashStatusOf(sale) {
  const v = String(sale.cashStatus || '').trim().toLowerCase();
  return CASH_STATUSES.find(c => c.id.toLowerCase() === v) || CASH_STATUSES[0];
}
// A sale's money is still clearing when the site says so — useful next to
// "Accounted", since that's exactly the money you've planned on but can't
// withdraw yet.
function saleStillClearing(sale) {
  return /pending|hold|awaiting/i.test(String(sale.fundsStatus || ''));
}
// Sales logged from the site's mark-sold form can lack an item name; fall
// back to the inventory so the list never shows a bare Item ID.
function saleItemName(sale) {
  if (sale.item) return sale.item;
  const it = state.inventory.find(i => String(i.itemId) === String(sale.itemId));
  return it ? ([it.brand, it.item].filter(Boolean).join(' — ') || sale.itemId) : sale.itemId;
}
function saleCashAmount(sale) {
  const net = saleNumber(sale.netCash);
  return net !== null ? net : (saleNumber(sale.salePrice) || 0);
}

function renderCashFlow() {
  const tilesEl = document.getElementById('cashFlowTiles');
  const listEl = document.getElementById('cashFlowList');
  if (!tilesEl || !listEl) return;
  if (!state.sales.length) {
    tilesEl.innerHTML = '';
    listEl.innerHTML = '<div class="empty-state">No sales recorded yet.</div>';
    return;
  }
  const groups = CASH_STATUSES.map(c => ({ ...c, sales: state.sales.filter(sl => cashStatusOf(sl).id === c.id) }));
  groups.forEach(g => { g.total = g.sales.reduce((n, sl) => n + saleCashAmount(sl), 0); });
  const clearingAccounted = groups[1].sales.filter(saleStillClearing).reduce((n, sl) => n + saleCashAmount(sl), 0);

  tilesEl.innerHTML = groups.map(g => {
    const sub = g.id === 'Accounted' && clearingAccounted
      ? `${money2(clearingAccounted)} of it still clearing`
      : `${g.sales.length} sale${g.sales.length === 1 ? '' : 's'}`;
    return `<div class="stat-tile cash-tile" style="--cash:${g.color}"><div class="num">${money2(g.total)}</div><div class="lbl">${g.label}</div><div class="sub">${escapeHtml(sub)}</div></div>`;
  }).join('');

  const row = sale => {
    const cur = cashStatusOf(sale);
    const meta = platformMeta(sale.platform);
    const when = sale.cashStatus && sale.cashStatusDate ? ` · ${String(sale.cashStatusDate).slice(0, 10)}` : '';
    return `
      <li class="cf-row" data-sale="${escapeHtml(sale.saleId)}">
        <div class="cf-main">
          <b>${escapeHtml(saleItemName(sale))}</b>
          <span class="cf-money">${money2(saleCashAmount(sale))}</span>
        </div>
        <small class="cf-meta"><span class="cf-site" style="--plat:${meta.color}">${escapeHtml(meta.label)}</span> ${escapeHtml([String(sale.dateSold || '').slice(0, 10), sale.fundsStatus].filter(Boolean).join(' · '))}${escapeHtml(when)}</small>
        <div class="cf-seg" role="group" aria-label="Cash status for ${escapeHtml(saleItemName(sale))}">
          ${CASH_STATUSES.map(c => `<button type="button" class="cf-btn${c.id === cur.id ? ' on' : ''}" style="--cash:${c.color}" data-status="${escapeHtml(c.id)}" aria-pressed="${c.id === cur.id}">${escapeHtml(c.short)}</button>`).join('')}
        </div>
        ${sale.cashNote ? `<small class="cf-note">${escapeHtml(sale.cashNote)}</small>` : ''}
      </li>`;
  };
  listEl.innerHTML = groups.filter(g => g.sales.length).map(g => `
    <details class="action-group cf-group" style="--plat:${g.color}"${g.id === 'Cashed out' ? '' : ' open'}>
      <summary><span class="ag-title">${escapeHtml(g.label)}</span><span class="ag-count">${g.sales.length}</span><span class="ag-blurb">${money2(g.total)}</span></summary>
      <ul class="cf-list">${g.sales.slice().sort((a, b) => String(b.dateSold).localeCompare(String(a.dateSold))).map(row).join('')}</ul>
    </details>`).join('');

  listEl.querySelectorAll('.cf-btn').forEach(btn => btn.addEventListener('click', () => {
    const li = btn.closest('.cf-row');
    setSaleCashStatus(li.dataset.sale, btn.dataset.status, btn);
  }));
}

async function setSaleCashStatus(saleId, status, btn) {
  const sale = state.sales.find(sl => String(sl.saleId) === String(saleId));
  if (!sale || cashStatusOf(sale).id === status) return;
  if (!connected()) return;
  const li = btn.closest('.cf-row');
  li.querySelectorAll('.cf-btn').forEach(b => { b.disabled = true; });
  const cashStatusDate = status ? todayStr() : '';
  try {
    await apiPost('upsertSales', { rows: [{ saleId, platform: sale.platform, cashStatus: status, cashStatusDate }] });
  } catch {
    // Apps Script sometimes garbles its reply after the write has landed;
    // re-read before calling it a failure.
    await loadSalesData();
    const fresh = state.sales.find(sl => String(sl.saleId) === String(saleId));
    if (!fresh || cashStatusOf(fresh).id !== status) {
      li.querySelectorAll('.cf-btn').forEach(b => { b.disabled = false; });
      li.insertAdjacentHTML('beforeend', '<small class="cf-note">Could not save to your Sheet — try again.</small>');
      return;
    }
    renderStats();
    return;
  }
  sale.cashStatus = status;
  sale.cashStatusDate = cashStatusDate;
  renderStats();
}

// ---------------------------------------------------------------------
// Pulse bar — the headline numbers, on every tab, right under the header:
// how many listings are live, how they're being seen, what's sold and what
// cash is sitting where. Deltas compare the latest stats pull with the one
// before it, so "+22" means "since the last time the numbers were pulled".
// ---------------------------------------------------------------------
// Headline totals from each unsold listing's latest snapshot, and the change
// from that same listing's previous snapshot. Comparing per listing keeps a
// site that simply wasn't pulled today (Facebook, say) from reading as a drop.
function pulseTotals() {
  const unsold = new Set(state.inventory.filter(it => !isSold(it)).map(it => String(it.itemId)));
  const byKey = new Map();
  state.metrics.forEach(m => {
    if (!unsold.has(String(m.itemId))) return;
    const key = `${m.itemId}|${platformId(m.platform)}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(m);
  });
  const latestDate = state.metrics.map(m => String(m.date || '').slice(0, 10)).sort().pop() || null;
  const now = { views: 0, clicks: 0, watchers: 0 }, delta = { views: 0, clicks: 0, watchers: 0 };
  let compared = 0;
  const val = (m, pid) => ({ views: snapshotViews(m, pid), clicks: pid === 'facebook' ? 0 : (Number(m.clicks) || 0), watchers: Number(m.watchers) || 0 });
  byKey.forEach((rows, key) => {
    const pid = key.split('|')[1];
    rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const last = rows[rows.length - 1];
    const v = val(last, pid);
    Object.keys(now).forEach(k => { now[k] += v[k]; });
    // Only listings pulled on the latest date, against their own previous pull.
    const prevRow = [...rows].reverse().find(r => String(r.date).slice(0, 10) < String(last.date).slice(0, 10));
    if (prevRow && String(last.date).slice(0, 10) === latestDate) {
      const p = val(prevRow, pid);
      Object.keys(delta).forEach(k => { delta[k] += v[k] - p[k]; });
      compared++;
    }
  });
  return { latestDate, now, delta: compared ? delta : null };
}
function pulseDelta(d) {
  if (d === null || d === undefined) return '';
  d = Math.round(d);
  if (!d) return '<span class="pb-delta flat">no change</span>';
  return `<span class="pb-delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d).toLocaleString()}</span>`;
}
function renderPulseBar() {
  const el = document.getElementById('pulseBar');
  if (!el) return;
  if (connected() && !state.loadedAt) {
    el.innerHTML = Array.from({ length: 6 }, () => '<div class="pb-tile skeleton"><span></span><span></span></div>').join('');
    el.setAttribute('aria-busy', 'true');
    return;
  }
  el.removeAttribute('aria-busy');
  const { latestDate, now: latest, delta } = pulseTotals();
  const hasStats = !!latestDate;
  const live = state.inventory.filter(it => !isSold(it)).reduce((n, it) => n + platformsStatusFor(it).done.length, 0);
  const itemsLive = state.inventory.filter(it => !isSold(it) && platformsStatusFor(it).done.length).length;
  const soldCount = state.sales.length;
  const kept = state.sales.reduce((n, sl) => n + (saleNumber(sl.netCash) || 0), 0);
  const balances = latestBalancesBySite();
  let available = 0, pending = 0;
  balances.forEach(b => { available += saleNumber(b.available) || 0; pending += saleNumber(b.pending) || 0; });
  const when = latestDate ? new Date(latestDate + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
  const tiles = [
    { num: live.toLocaleString(), lbl: 'Live listings', sub: `${itemsLive} items`, view: 'inventory' },
    { num: hasStats ? latest.views.toLocaleString() : '—', lbl: 'Views', sub: delta ? pulseDelta(delta.views) : '', view: 'stats', target: 'sec-platforms' },
    { num: hasStats ? latest.clicks.toLocaleString() : '—', lbl: 'Clicks', sub: delta ? pulseDelta(delta.clicks) : '', view: 'stats', target: 'sec-platforms' },
    { num: hasStats ? latest.watchers.toLocaleString() : '—', lbl: 'Watchers & likes', sub: delta ? pulseDelta(delta.watchers) : '', view: 'action', target: pricingGroupId('Send an offer') },
    { num: soldCount, lbl: 'Sold', sub: `${money2(kept)} kept`, view: 'stats', target: 'sec-sales' },
    { num: money2(available), lbl: 'Cash on sites', sub: pending ? `+ ${money2(pending)} pending` : 'nothing pending', view: 'stats', target: 'sec-cashflow', negative: available < 0 },
  ];
  el.innerHTML = tiles.map(t => `
    <button type="button" class="pb-tile${t.negative ? ' negative' : ''}" data-view-go="${t.view}"${t.target ? ` data-target="${t.target}"` : ''}>
      <span class="pb-num">${t.num}</span>
      <span class="pb-lbl">${t.lbl}</span>
      ${t.sub ? `<span class="pb-sub">${t.sub}</span>` : ''}
    </button>`).join('') + (when ? `<p class="pb-asof">Latest listing stats ${escapeHtml(when)} · changes compare each listing with its previous pull</p>` : '');
  el.querySelectorAll('.pb-tile[data-view-go]').forEach(tile => tile.addEventListener('click', () => {
    showView(tile.dataset.viewGo);
    const target = tile.dataset.target && document.getElementById(tile.dataset.target);
    if (target) {
      if (target.tagName === 'DETAILS') target.open = true;
      setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    }
  }));
}

function renderOverallTiles() {
  if (connected() && !state.loadedAt) {
    document.getElementById('overallTiles').innerHTML = Array.from({ length: 5 }, () => '<div class="stat-tile skeleton"><span></span><span></span></div>').join('');
    return;
  }
  const items = state.inventory;
  const listed = items.filter(it => !isSold(it)).length;
  const sold = items.filter(isSold).length;
  const estValue = items.filter(it => !isSold(it)).reduce((s, it) => s + parseMoney(it.estValue), 0);
  // Prefer what the site actually paid out (Sales tab) over the inventory's Net cash column.
  const netBySale = new Map(state.sales.filter(sl => saleNumber(sl.netCash) !== null).map(sl => [String(sl.itemId), saleNumber(sl.netCash)]));
  const netCash = items.filter(isSold).reduce((s, it) => s + (netBySale.has(String(it.itemId)) ? netBySale.get(String(it.itemId)) : parseMoney(it.netCash || it.soldPrice)), 0);
  const tiles = [
    { num: items.length, lbl: 'Total items' },
    { num: listed, lbl: 'Listed' },
    { num: sold, lbl: 'Sold' },
    { num: fmtMoney(estValue), lbl: 'Est. value (active)' },
    { num: fmtMoney(netCash), lbl: 'Net cash (sold)' },
  ];
  document.getElementById('overallTiles').innerHTML = tiles.map(t => `
    <div class="stat-tile"><div class="num">${t.num}</div><div class="lbl">${t.lbl}</div></div>
  `).join('');
}

function renderPlatformCards() {
  const totals = {};
  const ensure = (name) => {
    const meta = platformMeta(name);
    return totals[meta.id] || (totals[meta.id] = { meta, impressions: 0, views: 0, watchers: 0, clicks: 0, items: new Set() });
  };

  latestMetricsByItemPlatform().forEach(m => {
    const t = ensure(m.platform);
    t.impressions += Number(m.impressions) || 0;
    t.views += Number(m.views) || 0;
    t.watchers += Number(m.watchers) || 0;
    t.clicks += Number(m.clicks) || 0;
    if (m.itemId) t.items.add(m.itemId);
  });
  state.inventory.forEach(it => {
    if (isSold(it)) return;
    splitPlatforms(it.platform).forEach(p => ensure(p).items.add(it.itemId));
  });

  // Different platforms report reach under different names — eBay only ever
  // gives "views", Poshmark only ever gives "impressions". Treat whichever is
  // present as this platform's reach number rather than showing a blank 0.
  const cards = Object.values(totals).map(c => ({ ...c, reach: c.impressions || c.views, reachLabel: c.impressions ? 'Impressions' : 'Views' }))
    .sort((a, b) => platformRank(a.meta.id) - platformRank(b.meta.id) || a.meta.label.localeCompare(b.meta.label));
  const container = document.getElementById('platformCards');
  if (!cards.length) { container.innerHTML = '<div class="empty-state">No platform activity yet.</div>'; return; }

  const maxReach = Math.max(1, ...cards.map(c => c.reach));
  container.innerHTML = cards.map(c => {
    const ctr = c.reach ? ((c.clicks / c.reach) * 100).toFixed(1) + '%' : '—';
    return `
      <div class="platform-card" style="--plat:${c.meta.color}">
        <h4>${escapeHtml(c.meta.label)}</h4>
        <div class="prow"><span>Active listings</span><b>${c.items.size}</b></div>
        <div class="prow"><span>${c.reachLabel}</span><b>${c.reach}</b></div>
        <div class="prow"><span>Clicks</span><b>${c.clicks}</b></div>
        ${c.watchers ? `<div class="prow"><span>Watchers/Likes</span><b>${c.watchers}</b></div>` : ''}
        <div class="prow"><span>Click rate</span><b>${ctr}</b></div>
        <div class="platform-bar"><div class="platform-bar-fill" style="width:${((c.reach / maxReach) * 100).toFixed(0)}%"></div></div>
        <div class="platform-bar-label">of ${maxReach} ${c.reachLabel.toLowerCase()} (top platform)</div>
      </div>
    `;
  }).join('');
}

// ---------------------------------------------------------------------
// Action — everything needing a next step: items to ship, plus pricing
// suggestions (below). Shares state.itemActions with the pricing-action
// suppression logic, so "Sold" and "Shipped" live in the same log as
// "Price Drop"/"Offer Sent"/"Ignored".
// ---------------------------------------------------------------------
// Which site an item sold on. The Sales tab records it directly; the
// inventory's Buyer field only sometimes names the platform.
function soldOnPlatformId(item) {
  const sale = state.sales.find(sl => String(sl.itemId) === String(item.itemId));
  return (sale && platformId(sale.platform)) || platformId(item.buyer);
}
// A local sale (Marketplace, paid at the hand-off) has nothing to ship.
function soldInPerson(item) {
  const sale = state.sales.find(sl => String(sl.itemId) === String(item.itemId));
  if (sale && /in person/i.test(String(sale.fundsStatus || ''))) return true;
  const where = soldOnPlatformId(item);
  return !!where && LOCAL_PLATFORM_IDS.includes(where);
}
function hasShipped(itemId) {
  return state.itemActions.some(a => String(a.itemId) === String(itemId) && a.action === 'Shipped');
}
function soldDateFor(itemId) {
  const entry = state.itemActions.find(a => String(a.itemId) === String(itemId) && a.action === 'Sold');
  return entry ? entry.date : '';
}
async function markShipped(itemId) {
  await recordItemAction(itemId, 'Shipped', '');
  renderToShip();
  renderActionSummary();
}
function setActionSectionVisible(sectionId, visible) {
  const section = document.getElementById(sectionId);
  if (section) section.hidden = !visible;
}

function renderToShip() {
  const container = document.getElementById('toShipList');
  if (!container) return;
  const items = state.inventory.filter(it => isSold(it) && !hasShipped(it.itemId) && !soldInPerson(it));
  setActionSectionVisible('section-ship', items.length > 0);
  if (!items.length) { container.innerHTML = ''; return; }

  const sorted = items.slice().sort((a, b) => (soldDateFor(a.itemId) || '').localeCompare(soldDateFor(b.itemId) || ''));
  container.innerHTML = sorted.map(it => {
    const soldDate = soldDateFor(it.itemId);
    const title = [it.brand, it.item].filter(Boolean).join(' — ') || it.itemId;
    const metaBits = [
      it.soldPrice ? `Sold ${escapeHtml(it.soldPrice)}` : '',
      it.buyer ? escapeHtml(it.buyer) : '',
      soldDate ? escapeHtml(soldDate) : '',
    ].filter(Boolean);
    return `
      <div class="card to-ship-card action-row" style="--cat:#1f5c46">
        <div class="ar-title-row">
          <h3>${escapeHtml(title)}</h3>
          ${actionStarHTML(it.itemId, [it.brand, it.item].filter(Boolean).join(' ') || it.itemId)}
        </div>
        ${metaBits.length ? `<div class="ar-meta-line">${metaBits.join(' · ')}</div>` : ''}
        <div class="ar-actions">
          <button class="btn ar-primary ts-ship-btn" data-id="${escapeHtml(it.itemId)}">Mark shipped</button>
        </div>
      </div>
    `;
  }).join('');
  wireActionStars(container);
  container.querySelectorAll('.ts-ship-btn').forEach(btn => btn.addEventListener('click', () => markShipped(btn.dataset.id)));
}

// Selling on one site leaves the same item live on the others, so each still-live
// site becomes its own task until that listing is taken down.
function soldElsewhereTasks() {
  const tasks = [];
  state.inventory.filter(isSold).forEach(item => {
    const soldOn = soldOnPlatformId(item);
    platformsStatusFor(item).done.forEach(row => {
      if (row.meta.id === soldOn) return;
      tasks.push({ item, meta: row.meta, entry: row.entry, soldOn });
    });
  });
  return tasks;
}
function endTaskKey(itemId, platformIdValue) { return `end:${itemId}:${platformIdValue}`; }

async function endListingElsewhere(itemId, platformLabel, listingId) {
  await recordItemAction(itemId, 'Listing Ended', platformLabel);
  if (connected()) {
    try { await apiPost('setQueueStatus', { listingId, itemId, platform: platformLabel, status: 'Ended' }); }
    catch { /* Item Actions already records it; the queue row just stays as it was */ }
  }
  renderAction();
  renderList();
}

function renderSoldElsewhere() {
  const container = document.getElementById('soldElsewhereList');
  if (!container) return;
  const tasks = soldElsewhereTasks();
  setActionSectionVisible('section-end', tasks.length > 0);
  if (!tasks.length) { container.innerHTML = ''; return; }

  container.innerHTML = tasks.map(({ item, meta, entry, soldOn }) => {
    const title = [item.brand, item.item].filter(Boolean).join(' — ') || item.itemId;
    const soldWhere = soldOn ? platformMeta(item.buyer).label : (item.buyer || '');
    const metaBits = [
      item.soldPrice ? `Sold ${escapeHtml(item.soldPrice)}` : '',
      soldWhere ? `via ${escapeHtml(soldWhere)}` : '',
      `Still up on ${escapeHtml(meta.label)}`,
    ].filter(Boolean);
    return `
      <div class="card end-card action-row">
        <div class="ar-title-row">
          <h3>${escapeHtml(title)}</h3>
          <div class="card-top-actions">${actionStarHTML(endTaskKey(item.itemId, meta.id), `${title} on ${meta.label}`)}<span class="stl-chip stl-done" style="--plat:${meta.color}">${escapeHtml(meta.label)}</span></div>
        </div>
        <div class="ar-meta-line">${metaBits.join(' · ')}</div>
        <div class="ar-actions">
          <button class="btn ar-primary end-btn" data-id="${escapeHtml(item.itemId)}" data-platform="${escapeHtml(meta.label)}" data-listing="${escapeHtml((entry && entry.listingId) || '')}">Mark ended</button>
          <div class="ar-secondary">
            ${entry && entry.listingUrl ? `<a class="icon-btn" href="${escapeHtml(entry.listingUrl)}" target="_blank" rel="noopener">Open listing</a>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');

  wireActionStars(container);
  container.querySelectorAll('.end-btn').forEach(btn => btn.addEventListener('click', () => {
    btn.disabled = true;
    endListingElsewhere(btn.dataset.id, btn.dataset.platform, btn.dataset.listing);
  }));
}

// ---------------------------------------------------------------------
// Local deals — the face-to-face half of selling. A Marketplace listing
// can be "someone's coming Friday at 9" or "marked pending" long before
// it's a sale, and neither is a listing status. Those live in the Local
// Deals tab, one row per item x platform, and show up here as their own
// board so nothing agreed in a chat thread gets forgotten.
// ---------------------------------------------------------------------
const LOCAL_DEAL_STATUSES = [
  { id: 'interest', label: 'Interest', icon: '💬', color: '#a1752e', blurb: 'People are asking — nothing agreed yet.' },
  { id: 'meeting',  label: 'Meeting set', icon: '🤝', color: '#1f3a5c', blurb: 'A time and place are set.' },
  { id: 'pending',  label: 'Pending', icon: '⏳', color: '#7a2038', blurb: 'Deal agreed, waiting on hand-off.' },
];
// Platforms where a sale normally happens in person. Everything else ships,
// so it has no meetup to track.
const LOCAL_PLATFORM_IDS = ['facebook'];

function localDealStatusMeta(status) {
  const key = String(status || '').trim().toLowerCase();
  return LOCAL_DEAL_STATUSES.find(s => s.id === key || s.label.toLowerCase() === key)
    || { id: 'other', label: status || 'Set', icon: '•', color: '#56657a', blurb: '' };
}
function localDealsForItem(itemId) {
  return state.localDeals.filter(d => String(d.itemId) === String(itemId) && d.status);
}
function localDealFor(itemId, platformLabel) {
  return localDealsForItem(itemId).find(d => platformId(d.platform) === platformId(platformLabel)) || null;
}
// Sorted so what's booked soonest reads first; items with no time sink below.
function openLocalDeals() {
  const order = { meeting: 0, pending: 1, interest: 2 };
  return state.localDeals
    .filter(d => d.status && state.inventory.some(it => String(it.itemId) === String(d.itemId) && !isSold(it)))
    .slice()
    .sort((a, b) => {
      const oa = order[localDealStatusMeta(a.status).id] ?? 3;
      const ob = order[localDealStatusMeta(b.status).id] ?? 3;
      return oa - ob || String(a.when || '~').localeCompare(String(b.when || '~'));
    });
}
function localDealKey(deal) { return `${deal.itemId}|${deal.platform}`; }
// Short sub-label for the summary tile: whatever is actually booked beats a
// count of people who have only messaged.
function localDealsDueLabel() {
  const deals = openLocalDeals();
  const meetings = deals.filter(d => localDealStatusMeta(d.status).id === 'meeting');
  if (meetings.length) return meetings[0].when ? `next ${meetings[0].when}` : `${meetings.length} meeting${meetings.length > 1 ? 's' : ''} set`;
  const pending = deals.filter(d => localDealStatusMeta(d.status).id === 'pending').length;
  return pending ? `${pending} pending` : '';
}

function localDealFormHTML(deal) {
  const meta = localDealStatusMeta(deal.status);
  return `
    <form class="ld-form" data-id="${escapeHtml(deal.itemId)}" data-platform="${escapeHtml(deal.platform)}">
      <div class="field-row">
        <div class="field">
          <label>Status</label>
          <select class="ld-status">
            ${LOCAL_DEAL_STATUSES.map(s => `<option value="${s.label}"${s.label === meta.label ? ' selected' : ''}>${s.icon} ${escapeHtml(s.label)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>When <span class="optional">optional</span></label>
          <input type="text" class="ld-when" value="${escapeHtml(deal.when || '')}" placeholder="e.g. Fri Sep 18, 9:00 AM">
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Who <span class="optional">optional</span></label>
          <input type="text" class="ld-buyer" value="${escapeHtml(deal.buyer || '')}" placeholder="buyer's name">
        </div>
        <div class="field">
          <label>Where <span class="optional">optional</span></label>
          <input type="text" class="ld-where" value="${escapeHtml(deal.where || '')}" placeholder="e.g. my driveway">
        </div>
      </div>
      <div class="field">
        <label>Note <span class="optional">optional</span></label>
        <input type="text" class="ld-note" maxlength="200" value="${escapeHtml(deal.note || '')}" placeholder="anything you need to remember">
      </div>
      <div class="ld-form-actions">
        <button type="submit" class="btn secondary">Save</button>
        <button type="button" class="icon-btn ld-cancel">Cancel</button>
        ${deal.itemId ? '<button type="button" class="icon-btn ld-clear">Clear this deal</button>' : ''}
      </div>
      <div class="status-msg ld-status-msg" role="status"></div>
    </form>`;
}

function renderLocalDeals() {
  const container = document.getElementById('localDealsList');
  if (!container) return;
  const deals = openLocalDeals();
  const editingNew = state.editingLocalDeal && state.editingLocalDeal.startsWith('new|');
  // Keep Local deals visible so meetup tracking stays one tap away even when empty.
  setActionSectionVisible('section-local', true);

  if (!deals.length && !editingNew) {
    container.innerHTML = `
      <div class="ld-add-row ld-empty-add"><button type="button" class="btn secondary ld-add-btn">＋ Track a meetup or pending sale</button></div>`;
  } else {
    const cards = deals.map(deal => {
      const item = state.inventory.find(it => String(it.itemId) === String(deal.itemId));
      const title = item ? ([item.brand, item.item].filter(Boolean).join(' — ') || item.itemId) : deal.itemId;
      const meta = localDealStatusMeta(deal.status);
      const pmeta = platformMeta(deal.platform);
      const editing = state.editingLocalDeal === localDealKey(deal);
      const metaBits = [
        escapeHtml(pmeta.label),
        item ? priceLineHTML(item) : '',
        deal.when ? escapeHtml(deal.when) : '',
        deal.buyer ? escapeHtml(deal.buyer) : '',
        deal.where ? `@ ${escapeHtml(deal.where)}` : '',
      ].filter(Boolean);
      return `
        <div class="card ld-card ld-${meta.id} action-row" style="--cat:${meta.color}">
          <div class="ar-title-row">
            <h3>${escapeHtml(title)}</h3>
            <div class="card-top-actions">${actionStarHTML(`deal:${deal.itemId}`, `${title} — ${meta.label}`)}<span class="ld-chip" style="--plat:${meta.color}"><span aria-hidden="true">${meta.icon}</span> ${escapeHtml(meta.label)}</span></div>
          </div>
          ${metaBits.length ? `<div class="ar-meta-line">${metaBits.join(' · ')}</div>` : ''}
          ${deal.note ? `<p class="ld-note-text">${escapeHtml(deal.note)}</p>` : ''}
          ${editing ? localDealFormHTML(deal) : `
            <div class="ar-actions">
              <button type="button" class="btn ar-primary ld-edit" data-key="${escapeHtml(localDealKey(deal))}">Update</button>
              <div class="ar-secondary">
                <button type="button" class="icon-btn ld-clear-btn" data-id="${escapeHtml(deal.itemId)}" data-platform="${escapeHtml(deal.platform)}">Clear</button>
              </div>
            </div>`}
        </div>`;
    }).join('');
    const newForm = editingNew ? `
      <div class="card ld-card ld-new action-row" style="--cat:#1f3a5c">
        <div class="ar-title-row"><h3>Track a meetup or pending sale</h3></div>
        <form class="ld-form ld-new-form">
          <div class="field">
            <label>Item</label>
            <select class="ld-item">${localDealItemOptionsHTML()}</select>
          </div>
          ${localDealFormHTML({ itemId: '', platform: '', status: 'Meeting set' }).replace(/^\s*<form[^>]*>|<\/form>\s*$/g, '')}
        </form>
      </div>` : '';
    container.innerHTML = cards + newForm + (editingNew ? '' : `
      <div class="ld-add-row"><button type="button" class="btn secondary ld-add-btn">＋ Track a meetup or pending sale</button></div>`);
  }

  wireActionStars(container);
  container.querySelectorAll('.ld-add-btn').forEach(btn => btn.addEventListener('click', () => {
    state.editingLocalDeal = 'new|';
    renderLocalDeals();
  }));
  container.querySelectorAll('.ld-edit').forEach(btn => btn.addEventListener('click', () => {
    state.editingLocalDeal = btn.dataset.key;
    renderLocalDeals();
  }));
  container.querySelectorAll('.ld-cancel').forEach(btn => btn.addEventListener('click', () => {
    state.editingLocalDeal = null;
    renderLocalDeals();
  }));
  container.querySelectorAll('.ld-clear-btn, .ld-clear').forEach(btn => btn.addEventListener('click', () => {
    const form = btn.closest('.ld-form');
    const id = btn.dataset.id || (form && form.dataset.id);
    const platform = btn.dataset.platform || (form && form.dataset.platform);
    if (id && platform) saveLocalDeal({ itemId: id, platform, status: '' }, btn);
  }));
  container.querySelectorAll('.ld-form').forEach(form => form.addEventListener('submit', event => {
    event.preventDefault();
    const isNew = form.classList.contains('ld-new-form');
    const chosen = isNew ? form.querySelector('.ld-item').value : '';
    const itemId = isNew ? chosen.split('|')[0] : form.dataset.id;
    const platform = isNew ? chosen.split('|')[1] : form.dataset.platform;
    if (!itemId || !platform) return;
    saveLocalDeal({
      itemId, platform,
      status: form.querySelector('.ld-status').value,
      when: form.querySelector('.ld-when').value.trim(),
      buyer: form.querySelector('.ld-buyer').value.trim(),
      where: form.querySelector('.ld-where').value.trim(),
      note: form.querySelector('.ld-note').value.trim(),
    }, form.querySelector('button[type="submit"]'));
  }));
}

// Every item x local platform pair that could have a meetup, minus the ones
// already on the board.
function localDealItemOptionsHTML() {
  const options = [];
  state.inventory.filter(it => !isSold(it)).forEach(it => {
    splitPlatforms(it.platform).forEach(p => {
      const meta = platformMeta(p);
      if (!LOCAL_PLATFORM_IDS.includes(meta.id)) return;
      if (localDealFor(it.itemId, meta.label)) return;
      const title = [it.brand, it.item].filter(Boolean).join(' — ') || it.itemId;
      options.push(`<option value="${escapeHtml(it.itemId)}|${escapeHtml(meta.label)}">${escapeHtml(title)} — ${escapeHtml(meta.label)}</option>`);
    });
  });
  return options.length ? options.join('') : '<option value="">Nothing listed locally right now</option>';
}

async function saveLocalDeal(body, btn) {
  const statusEl = btn && btn.closest('.card') ? btn.closest('.card').querySelector('.ld-status-msg') : null;
  if (!connected()) { if (statusEl) statusEl.textContent = 'Connect your Sheet to save deals — see SETUP.md.'; return; }
  if (btn) btn.disabled = true;
  if (statusEl) statusEl.textContent = 'Saving...';
  try {
    await apiPost('setLocalDeal', { ...body, platform: platformMeta(body.platform).label });
  } catch {
    if (statusEl) statusEl.textContent = 'Could not save to your Sheet.';
    if (btn) btn.disabled = false;
    return;
  }
  const label = platformMeta(body.platform).label;
  state.localDeals = state.localDeals.filter(d => !(String(d.itemId) === String(body.itemId) && platformId(d.platform) === platformId(label)));
  if (body.status) state.localDeals.push({ ...body, platform: label, updated: todayStr() });
  state.editingLocalDeal = null;
  renderLocalDeals();
  renderActionSummary();
  renderList();
}


function renderAction() {
  renderToShip();
  renderLocalDeals();
  renderSoldElsewhere();
  renderStillToList();
  renderPricingActions();
  renderActionSummary();
}

function renderActionSummary() {
  const container = document.getElementById('actionSummary');
  if (!container) return;
  // Before the Sheet answers, every count is 0 — show that it's loading
  // instead of a row of zeros that reads as "nothing to do".
  if (connected() && !state.loadedAt) {
    container.innerHTML = Array.from({ length: 7 }, () => '<div class="as-tile skeleton"><span></span><span></span></div>').join('');
    return;
  }
  const toShip = state.inventory.filter(it => isSold(it) && !hasShipped(it.itemId) && !soldInPerson(it)).length;
  const listRows = stillToListRows();
  const toList = listRows.reduce((n, r) => n + r.status.missing.length, 0);
  const toListHeld = listRows.filter(r => postingNoteFor(r.item.itemId)).reduce((n, r) => n + r.status.missing.length, 0);
  const counts = {};
  state.inventory.filter(it => !isSold(it)).forEach(it => {
    const a = pricingActionFor(it);
    if (!a.hidden) counts[a.label] = (counts[a.label] || 0) + 1;
  });
  const visibility = (counts['Boost visibility'] || 0) + (counts['Refresh listing'] || 0);
  const tiles = [
    { num: toShip, lbl: 'To ship', target: 'sec-ship' },
    { num: openLocalDeals().length, lbl: 'Local deals', target: 'sec-local', sub: localDealsDueLabel() },
    { num: soldElsewhereTasks().length, lbl: 'Listings to end', target: 'sec-end' },
    { num: toList, lbl: 'Posts to make', target: 'sec-list', sub: toListHeld ? `${toListHeld} on hold` : '' },
    { num: counts['Send an offer'] || 0, lbl: 'Offers to send', target: pricingGroupId('Send an offer') },
    { num: counts['Try a price drop'] || 0, lbl: 'Price drops', target: pricingGroupId('Try a price drop') },
    { num: visibility, lbl: 'Need visibility', target: pricingGroupId(counts['Boost visibility'] ? 'Boost visibility' : 'Refresh listing') },
  ];
  container.innerHTML = tiles.map(t => `<button class="as-tile${t.num ? '' : ' as-zero'}" data-target="${t.target}"><span class="num">${t.num}</span><span class="lbl">${t.lbl}</span>${t.sub ? `<span class="sub">${t.sub}</span>` : ''}</button>`).join('');
  container.querySelectorAll('.as-tile').forEach(tile => tile.addEventListener('click', () => {
    const el = document.getElementById(tile.dataset.target);
    if (!el) return;
    if (el.tagName === 'DETAILS') el.open = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}

// ---------------------------------------------------------------------
// Still to list — items that aren't live everywhere their Platform field
// says they should be. A platform counts as "done" once its Platform
// Posting Queue row is Active (or just has a Listing URL, in case status
// wasn't set) — otherwise (Draft, Paused, or no row at all) it's still
// outstanding. Photographed-but-unlisted items end up with everything
// outstanding, same as a partially cross-listed item missing just one site.
// ---------------------------------------------------------------------
function postingQueueEntry(itemId, platformIdWanted) {
  return state.postingQueue.find(function (row) {
    return String(row.itemId) === String(itemId) && platformId(row.platform) === platformIdWanted;
  });
}
// A queue row keeps its listing URL after the listing comes down, so the URL
// alone can't mean "live" — a status of Ended/Sold/Removed wins over it.
function queueStatusEnded(entry) {
  return ['ended', 'sold', 'removed'].includes(String(entry && entry.status || '').toLowerCase());
}
function isPlatformLive(entry) {
  if (!entry || queueStatusEnded(entry)) return false;
  return String(entry.status || '').toLowerCase() === 'active' || !!String(entry.listingUrl || '').trim();
}
function latestListingDecision(itemId, platformIdWanted) {
  const matches = state.itemActions.filter(function (a) {
    return String(a.itemId) === String(itemId) &&
      ['Listing Posted', 'Not Posting', 'Reopened Listing'].includes(a.action) &&
      platformId(a.detail) === platformIdWanted;
  });
  return matches.length ? matches[matches.length - 1] : null;
}
// A listing taken down after the item sold elsewhere, logged per platform so
// it stops counting as live without waiting for the queue row to be re-read.
function listingEndedFor(itemId, platformIdWanted) {
  if (queueStatusEnded(postingQueueEntry(itemId, platformIdWanted))) return true;
  return state.itemActions.some(function (a) {
    return String(a.itemId) === String(itemId) && a.action === 'Listing Ended' && platformId(a.detail) === platformIdWanted;
  });
}
function platformsStatusFor(item) {
  const platforms = splitPlatforms(item.platform);
  const done = [], missing = [], skipped = [], ended = [];
  platforms.forEach(function (p) {
    const meta = platformMeta(p);
    const entry = postingQueueEntry(item.itemId, meta.id);
    const decision = latestListingDecision(item.itemId, meta.id);
    const row = { meta: meta, entry: entry || null, decision: decision };
    const live = isPlatformLive(entry) || (decision && decision.action === 'Listing Posted');
    if (listingEndedFor(item.itemId, meta.id)) ended.push(row);
    else if (live) done.push(row);
    else if (decision && decision.action === 'Not Posting') skipped.push(row);
    else missing.push(row);
  });
  return { done: done, missing: missing, skipped: skipped, ended: ended };
}
// Posting notes — why an item can't be posted yet ("waiting on the charger",
// "taking photos"). Logged to Item Actions as "Posting Note"; the latest one
// wins and an empty note clears it, so the Sheet keeps the full history.
const POSTING_NOTE_PRESETS = ['Waiting on ', 'Taking photos', 'Need supplies: ', 'Need to test it', 'Need to identify model / details'];
function postingNoteFor(itemId) {
  const latest = latestActionOfType(itemId, 'Posting Note');
  return latest ? String(latest.detail || '').trim() : '';
}
function postingNoteHTML(item, groupId) {
  const note = postingNoteFor(item.itemId);
  const key = `${item.itemId}|${groupId}`;
  if (state.editingPostingNote === key) {
    return `
      <form class="stl-note-editor" data-id="${escapeHtml(item.itemId)}">
        <label class="stl-note-label" for="stlNote-${escapeHtml(key)}">What's holding this up?</label>
        <input type="text" id="stlNote-${escapeHtml(key)}" class="stl-note-input" maxlength="160" value="${escapeHtml(note)}" placeholder="e.g. waiting on the charger">
        <div class="stl-note-presets">${POSTING_NOTE_PRESETS.map(p => `<button type="button" class="stl-note-preset" data-preset="${escapeHtml(p)}">${escapeHtml(p.replace(/[: ]+$/, ''))}</button>`).join('')}</div>
        <div class="stl-note-actions">
          <button type="submit" class="btn secondary">Save note</button>
          <button type="button" class="icon-btn stl-note-cancel">Cancel</button>
        </div>
      </form>`;
  }
  if (!note) return '';
  return `
    <div class="stl-hold">
      <span class="stl-hold-tag">⏸ On hold</span>
      <p>${escapeHtml(note)}</p>
      <div class="stl-hold-actions">
        <button type="button" class="icon-btn stl-note-edit" data-key="${escapeHtml(key)}">Edit</button>
        <button type="button" class="icon-btn stl-note-clear" data-id="${escapeHtml(item.itemId)}">Ready — clear note</button>
      </div>
    </div>`;
}

// Price holds — "I know it's slow, the price stays." Logged to Item Actions
// as "Price Hold" (with the reason) and cleared with "Price Released", so the
// Sheet keeps the history and the latest of the two wins. A hold only silences
// suggestions that would lower the price; offers and visibility still surface,
// since neither costs anything off the asking price.
function priceHoldFor(itemId) {
  const hold = latestActionOfType(itemId, 'Price Hold');
  if (!hold) return null;
  const released = latestActionOfType(itemId, 'Price Released');
  if (released && released.date >= hold.date && state.itemActions.indexOf(released) > state.itemActions.indexOf(hold)) return null;
  return hold;
}
const PRICE_HOLD_LABELS = ['Try a price drop', 'Refresh listing'];

function stillToListRows() {
  return state.inventory
    .filter(function (it) { return !isSold(it); })
    .map(function (it) { return { item: it, status: platformsStatusFor(it) }; })
    .filter(function (r) { return r.status.missing.length > 0 || (state.showSkippedListings && r.status.skipped.length > 0); });
}
function populateStillToListSiteOptions(rows) {
  const select = document.getElementById('stillToListSite');
  if (!select) return;
  const prev = select.value;
  const seen = new Map();
  rows.forEach(function (r) {
    r.status.missing.concat(state.showSkippedListings ? r.status.skipped : []).forEach(function (m) { seen.set(m.meta.id, m.meta.label); });
  });
  const options = Array.from(seen.entries()).sort(function (a, b) { return platformRank(a[0]) - platformRank(b[0]) || a[1].localeCompare(b[1]); });
  select.innerHTML = '<option value="">All platforms</option>' +
    options.map(function (o) { return `<option value="${escapeHtml(o[0])}">${escapeHtml(o[1])}</option>`; }).join('');
  if (options.some(function (o) { return o[0] === prev; })) select.value = prev;
}
// Everything needed to actually make the post, behind a dropdown at the bottom
// of the card: the spec line, the saved title and description for this site
// (falling back to another site's copy when this one has none), and links to
// the listings already up elsewhere to copy from. It renders closed every time
// the list re-renders, so only the posting being worked on is open.
// The copy buttons sit next to the value they copy, so they read it straight
// out of the DOM rather than carrying a second escaped copy in an attribute.
// Selecting the text first means the worst case is still a usable one: if
// neither copy path works, it's sitting there highlighted ready for Cmd-C.
// execCommand goes first because it's synchronous — navigator.clipboard can
// sit pending forever behind a permission prompt, which would leave the button
// silent, so its promise is raced against a timeout.
async function copyListingField(btn, value) {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(value);
  selection.removeAllRanges();
  selection.addRange(range);

  let copied = false;
  try { copied = document.execCommand('copy'); } catch { copied = false; }
  if (!copied && navigator.clipboard) {
    try {
      await Promise.race([
        navigator.clipboard.writeText(value.innerText),
        new Promise(function (_, reject) { setTimeout(function () { reject(new Error('timeout')); }, 1200); }),
      ]);
      copied = true;
    } catch { copied = false; }
  }
  if (copied) selection.removeAllRanges();
  btn.textContent = copied ? 'Copied' : 'Selected — press Cmd-C';
  setTimeout(function () { btn.textContent = 'Copy'; }, 1800);
}

function wireCopyButtons(container) {
  container.querySelectorAll('.ld-copy').forEach(function (btn) {
    btn.addEventListener('click', function (event) {
      event.preventDefault();
      const value = btn.closest('.ld-field').querySelector('.ld-value');
      if (value) copyListingField(btn, value);
    });
  });
}

function stlListingDetailsHTML(item, meta) {
  const descs = state.descriptions.filter(function (d) {
    return String(d.itemId || '').trim().toUpperCase() === String(item.itemId).trim().toUpperCase();
  });
  const own = descs.find(function (d) { return platformId(d.platform) === meta.id; });
  const borrowed = own ? null : descs.find(function (d) { return d.suggestedTitle || d.description; });
  const copy = own || borrowed;
  const photo = photoForItem(item.itemId);

  const specs = [
    ['Category', item.category], ['Brand', item.brand], ['Item', item.item],
    ['Size', item.size], ['Condition', item.condition], ['Item #', item.itemNumber],
    ['Est. value', item.estValue], ['List price', item.listPrice], ['Floor', item.floorPrice],
  ].filter(function (pair) { return String(pair[1] == null ? '' : pair[1]).trim(); });

  const liveElsewhere = splitPlatforms(item.platform)
    .map(function (p) { const m = platformMeta(p); return { meta: m, entry: postingQueueEntry(item.itemId, m.id) }; })
    .filter(function (x) {
      return x.meta.id !== meta.id && x.entry && String(x.entry.listingUrl || '').trim() && !queueStatusEnded(x.entry);
    });

  const copyBlock = copy ? `
      ${copy.suggestedTitle ? `
        <div class="ld-field">
          <div class="ld-label">Title${borrowed ? ` <span class="ld-borrowed">from your ${escapeHtml(platformMeta(borrowed.platform).label)} copy</span>` : ''}<button class="btn secondary ld-copy" type="button">Copy</button></div>
          <div class="ld-value ld-title">${escapeHtml(copy.suggestedTitle)}</div>
        </div>` : ''}
      ${copy.description ? `
        <div class="ld-field">
          <div class="ld-label">Description<button class="btn secondary ld-copy" type="button">Copy</button></div>
          <div class="ld-value ld-desc">${escapeHtml(copy.description)}</div>
        </div>` : ''}`
    : `<p class="ld-empty">No saved title or description for this item yet.</p>`;

  return `
    <details class="stl-details">
      <summary>Details &amp; copy</summary>
      <div class="ld-body">
        ${photo ? `<img class="ld-photo" src="${escapeHtml(photo)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
        ${specs.length ? `<dl class="ld-specs">${specs.map(function (pair) {
          return `<div><dt>${escapeHtml(pair[0])}</dt><dd>${escapeHtml(String(pair[1]))}</dd></div>`;
        }).join('')}</dl>` : ''}
        ${copyBlock}
        ${liveElsewhere.length ? `<div class="ld-links">${liveElsewhere.map(function (x) {
          return `<a class="btn secondary" href="${escapeHtml(x.entry.listingUrl)}" target="_blank" rel="noopener">Open ${escapeHtml(x.meta.label)} listing</a>`;
        }).join('')}</div>` : ''}
      </div>
    </details>`;
}

function renderStillToList() {
  const container = document.getElementById('stillToListList');
  if (!container) return;
  const rows = stillToListRows();
  populateStillToListSiteOptions(rows);

  const siteFilter = document.getElementById('stillToListSite').value;
  const groups = new Map();
  rows.forEach(function (r) {
    r.status.missing.forEach(function (m) {
      if (siteFilter && m.meta.id !== siteFilter) return;
      if (!groups.has(m.meta.id)) groups.set(m.meta.id, { meta: m.meta, rows: [] });
      groups.get(m.meta.id).rows.push(r);
    });
  });
  const skippedRows = state.showSkippedListings
    ? rows.filter(function (r) { return r.status.skipped.some(function (s) { return !siteFilter || s.meta.id === siteFilter; }); })
    : [];

  const hasWork = groups.size > 0 || skippedRows.length > 0;
  setActionSectionVisible('section-list', hasWork || !!siteFilter || state.showSkippedListings);
  if (!hasWork) {
    container.innerHTML = siteFilter || state.showSkippedListings
      ? `<div class="empty-state">${siteFilter ? 'Nothing outstanding for that platform.' : 'Nothing marked not posting.'}</div>`
      : '';
    if (!siteFilter && !state.showSkippedListings) setActionSectionVisible('section-list', false);
    return;
  }
  setActionSectionVisible('section-list', true);

  const byName = function (a, b) { return (a.item.item || a.item.brand || '').localeCompare(b.item.item || b.item.brand || ''); };
  const itemTitle = function (item) { return [item.brand, item.item].filter(Boolean).join(' — ') || item.itemId; };

  const groupHTML = Array.from(groups.values())
    .sort(function (a, b) { return platformRank(a.meta.id) - platformRank(b.meta.id) || a.meta.label.localeCompare(b.meta.label); })
    .map(function (g) {
      // Items that are on hold sink below the ones ready to post.
      const onHold = g.rows.filter(function (r) { return postingNoteFor(r.item.itemId); }).length;
      const cards = g.rows.slice().sort(function (a, b) {
        return (postingNoteFor(a.item.itemId) ? 1 : 0) - (postingNoteFor(b.item.itemId) ? 1 : 0) || byName(a, b);
      }).map(function ({ item, status }) {
        const live = status.done.map(function (d) { return d.meta.label; });
        const elsewhere = status.missing.filter(function (m) { return m.meta.id !== g.meta.id; }).map(function (m) { return m.meta.label; });
        const metaBits = [
          priceLineHTML(item),
          item.floorPrice ? `floor ${escapeHtml(item.floorPrice)}` : '',
          live.length ? `Live: ${escapeHtml(live.join(', '))}` : '',
          elsewhere.length ? `Also needs: ${escapeHtml(elsewhere.join(', '))}` : '',
        ].filter(Boolean);
        return `
          <div class="card stl-card action-row${postingNoteFor(item.itemId) ? ' stl-on-hold' : ''}" style="--cat:${g.meta.color}">
            <div class="ar-title-row">
              <h3>${escapeHtml(itemTitle(item))}</h3>
              ${actionStarHTML(postingTaskKey(item.itemId, g.meta.id), `${itemTitle(item)} on ${g.meta.label}`)}
            </div>
            ${postingNoteHTML(item, g.meta.id)}
            ${metaBits.length ? `<div class="ar-meta-line">${metaBits.join(' · ')}</div>` : ''}
            <div class="ar-actions">
              <button class="btn ar-primary stl-listed-btn" data-id="${escapeHtml(item.itemId)}" data-platform="${escapeHtml(g.meta.label)}">Mark listed</button>
              <div class="ar-secondary">
                <button class="icon-btn stl-skip-btn" data-id="${escapeHtml(item.itemId)}" data-platform="${escapeHtml(g.meta.label)}">Not posting</button>
                ${editToggleHTML(item).replace('btn secondary ie-toggle', 'icon-btn ie-toggle')}
                ${postingNoteFor(item.itemId) || state.editingPostingNote === `${item.itemId}|${g.meta.id}` ? '' : `<button class="icon-btn stl-note-add" data-key="${escapeHtml(`${item.itemId}|${g.meta.id}`)}">+ Note</button>`}
              </div>
            </div>
            ${itemEditPanelHTML(item)}
            ${stlListingDetailsHTML(item, g.meta)}
          </div>`;
      }).join('');
      return `
        <details class="action-group stl-group" id="stl-group-${escapeHtml(g.meta.id)}" style="--plat:${g.meta.color}" open>
          <summary><span class="ag-title">${escapeHtml(g.meta.label)}</span><span class="ag-count">${g.rows.length}</span>${onHold ? `<span class="ag-hold">${onHold} on hold</span>` : ''}</summary>
          <div class="card-grid">${cards}</div>
        </details>`;
    }).join('');

  const skippedHTML = skippedRows.length ? `
    <details class="action-group stl-group">
      <summary><span class="ag-title">Not posting</span><span class="ag-count">${skippedRows.length}</span></summary>
      <div class="card-grid">${skippedRows.slice().sort(byName).map(function ({ item, status }) {
        const skipped = status.skipped.filter(function (s) { return !siteFilter || s.meta.id === siteFilter; });
        return `
          <div class="card stl-card action-row">
            <div class="ar-title-row"><h3>${escapeHtml(itemTitle(item))}</h3></div>
            <div class="stl-chips">${skipped.map(function (s) {
              return `<div class="ar-actions"><span class="stl-chip stl-skipped" style="--plat:${s.meta.color}">${escapeHtml(s.meta.label)}</span><button class="btn ar-primary stl-reopen-btn" data-id="${escapeHtml(item.itemId)}" data-platform="${escapeHtml(s.meta.label)}">Post after all</button></div>`;
            }).join('')}</div>
          </div>`;
      }).join('')}</div>
    </details>` : '';

  container.innerHTML = groupHTML + skippedHTML;
  wireActionStars(container);
  wireItemEditors(container);
  wireCopyButtons(container);
  container.querySelectorAll('.stl-listed-btn').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      await recordItemAction(btn.dataset.id, 'Listing Posted', btn.dataset.platform);
      renderStillToList();
      renderActionSummary();
    });
  });
  container.querySelectorAll('.stl-skip-btn').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      await recordItemAction(btn.dataset.id, 'Not Posting', btn.dataset.platform);
      renderStillToList();
      renderActionSummary();
    });
  });
  container.querySelectorAll('.stl-note-add, .stl-note-edit').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.editingPostingNote = btn.dataset.key;
      renderStillToList();
      const input = container.querySelector('.stl-note-editor .stl-note-input');
      if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    });
  });
  container.querySelectorAll('.stl-note-editor').forEach(function (form) {
    const input = form.querySelector('.stl-note-input');
    form.querySelectorAll('.stl-note-preset').forEach(function (chip) {
      chip.addEventListener('click', function () {
        input.value = chip.dataset.preset;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      });
    });
    form.querySelector('.stl-note-cancel').addEventListener('click', function () {
      state.editingPostingNote = null;
      renderStillToList();
    });
    form.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { state.editingPostingNote = null; renderStillToList(); }
    });
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      const text = input.value.trim().replace(/[:\s]+$/, '');
      state.editingPostingNote = null;
      if (text !== postingNoteFor(form.dataset.id)) await recordItemAction(form.dataset.id, 'Posting Note', text);
      renderStillToList();
      renderActionSummary();
    });
  });
  container.querySelectorAll('.stl-note-clear').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      await recordItemAction(btn.dataset.id, 'Posting Note', '');
      renderStillToList();
      renderActionSummary();
    });
  });
  container.querySelectorAll('.stl-reopen-btn').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      await recordItemAction(btn.dataset.id, 'Reopened Listing', btn.dataset.platform);
      renderStillToList();
      renderActionSummary();
    });
  });
}
document.getElementById('stillToListSite').addEventListener('change', renderStillToList);
document.getElementById('showSkippedListings').addEventListener('change', function (event) {
  state.showSkippedListings = event.target.checked;
  renderStillToList();
});

// Thresholds behind the pricing-action calls below — tune these if the
// recommendations feel too eager or too quiet.
const PRICING_MIN_VIEWS_TO_JUDGE = 10;  // below this, "few clicks" isn't meaningful yet
const PRICING_LOW_CTR = 0.03;           // under 3% clicks-per-view reads as weak interest
const PRICING_NEAR_FLOOR_MARGIN = 0.10; // within 10% of floor price = little room left to drop
const PRICING_DROP_FRACTION = 0.10;     // suggested cut = 10% off list price, floored at the floor price

// Suggests a concrete new list price for a weak-click-through item: a 10%
// cut off the current price, never below the floor. Returns null when
// there's no usable list price or the cut would round back up to it.
function suggestedDropPrice(listPrice, floorPrice) {
  if (!listPrice) return null;
  const cut = Math.round(listPrice * (1 - PRICING_DROP_FRACTION));
  const suggested = floorPrice > 0 ? Math.max(floorPrice, cut) : cut;
  return suggested < listPrice ? suggested : null;
}

// The "natural" recommendation from the raw numbers alone — actual
// suppression based on what's already been done about it lives in
// pricingActionFor below.
// Views in a metrics snapshot. Facebook only reports "clicks on listing"
// (opens of the listing), which is its equivalent of a view — without this
// every Marketplace item reads as "No views yet".
function snapshotViews(snap, platformIdValue) {
  if (!snap) return 0;
  return Number(snap.views || snap.impressions || (platformIdValue === 'facebook' ? snap.clicks : 0)) || 0;
}
function naturalPricingAction(item) {
  const latestByPlatform = latestMetricsByItemPlatform();
  const platforms = splitPlatforms(item.platform);
  let views = 0, clicks = 0, watchers = 0, hasAnyData = false;
  const perPlatform = [];
  platforms.forEach(p => {
    const m = platformMeta(p);
    const snap = latestByPlatform.get(item.itemId + '|' + m.id);
    if (snap) hasAnyData = true;
    const pWatchers = Number(snap && snap.watchers) || 0;
    views += snapshotViews(snap, m.id);
    clicks += Number(snap && snap.clicks) || 0;
    watchers += pWatchers;
    perPlatform.push({ meta: m, watchers: pWatchers });
  });

  if (!hasAnyData) {
    return { severity: 'no-data', label: 'No data yet', reason: 'Log a stat update for this item to get a recommendation.', views, clicks, watchers };
  }
  if (watchers > 0) {
    const withWatchers = perPlatform.filter(p => p.watchers > 0).sort((a, b) => b.watchers - a.watchers);
    const where = withWatchers.map(p => `${p.watchers} on ${p.meta.label}`).join(', ');
    const hint = withWatchers[0].meta.offerHint || DEFAULT_PLATFORM_META.offerHint;
    return {
      severity: 'opportunity', label: 'Send an offer',
      reason: `${where} — send an offer to close the sale instead of waiting.`,
      offerWhere: `${withWatchers[0].meta.label}: ${hint}`,
      offerPlatformLabel: withWatchers[0].meta.label,
      views, clicks, watchers,
    };
  }
  if (views === 0) {
    return { severity: 'attention', label: 'Boost visibility', reason: 'No views yet — refresh the listing, sharpen the title/keywords, or share it for more reach. This is a visibility problem, not a pricing one.', views, clicks, watchers };
  }

  const ctr = clicks / views;
  const weakInterest = views >= PRICING_MIN_VIEWS_TO_JUDGE && ctr < PRICING_LOW_CTR;
  if (weakInterest) {
    const listPrice = parseMoney(item.listPrice);
    const floorPrice = parseMoney(item.floorPrice);
    const nearFloor = floorPrice > 0 && listPrice > 0 && (listPrice - floorPrice) <= floorPrice * PRICING_NEAR_FLOOR_MARGIN;
    if (nearFloor) {
      return { severity: 'attention', label: 'Refresh listing', reason: `Getting views but few clicks, and you're already near your ${fmtMoney(floorPrice)} floor — try new photos or a rewritten description instead of dropping price further.`, views, clicks, watchers };
    }
    const suggested = suggestedDropPrice(listPrice, floorPrice);
    const priceHint = floorPrice > 0 ? ` (you have room down to your ${fmtMoney(floorPrice)} floor)` : '';
    return {
      severity: 'urgent', label: 'Try a price drop',
      reason: `Getting views but few clicks${priceHint} — the price is likely the sticking point.`,
      suggestedPrice: suggested, views, clicks, watchers,
    };
  }
  return { severity: 'ok', label: 'On track', reason: 'Views and clicks look normal — no action needed right now.', views, clicks, watchers };
}

// Layers "what's already been done about this today" on top of the natural
// recommendation, so acting on a suggestion (or dismissing it) doesn't just
// keep nagging you again the moment the page re-renders. Suppression only
// lasts through the day it was logged — if the underlying numbers still
// warrant it tomorrow, that's a legitimate fresh flag, not a repeat.
// Manual next-action choices from the item editor, logged to Item Actions as
// "Action Set" (latest wins; "Auto" goes back to the computed suggestion).
const ACTION_CHOICES = [
  { label: 'Send an offer', severity: 'opportunity' },
  { label: 'Try a price drop', severity: 'urgent' },
  { label: 'Boost visibility', severity: 'attention' },
  { label: 'Refresh listing', severity: 'attention' },
  { label: 'Hold', severity: 'held' },
];
function actionOverrideFor(itemId) {
  const set = latestActionOfType(itemId, 'Action Set');
  const choice = set && ACTION_CHOICES.find(c => c.label === set.detail);
  return choice ? { ...choice, date: set.date } : null;
}
function applyActionOverride(item, natural, override) {
  const out = {
    ...natural, severity: override.severity, label: override.label, manual: true,
    reason: `You set this to "${override.label}" on ${override.date}. Use Edit to change it or go back to Auto.`,
  };
  if (override.label === 'Send an offer') {
    if (!out.offerWhere) {
      const meta = platformMeta(splitPlatforms(item.platform)[0]);
      out.offerPlatformLabel = meta.label;
      out.offerWhere = `${meta.label}: ${meta.offerHint || DEFAULT_PLATFORM_META.offerHint}`;
    }
  } else {
    delete out.offerWhere;
    delete out.offerPlatformLabel;
  }
  if (override.label === 'Try a price drop') {
    if (!out.suggestedPrice) out.suggestedPrice = suggestedDropPrice(parseMoney(item.listPrice), parseMoney(item.floorPrice));
  } else {
    delete out.suggestedPrice;
  }
  return out;
}

function pricingActionFor(item) {
  let natural = naturalPricingAction(item);
  const override = actionOverrideFor(item.itemId);
  if (override) natural = applyActionOverride(item, natural, override);
  const actionState = latestActionStateFor(item.itemId);
  if (actionState?.action === 'Deleted') return { ...natural, hidden: true };
  if (actionState?.action === 'Completed') {
    return { ...natural, severity: 'complete', label: 'Completed', reason: actionState.detail || `Completed: ${natural.label}` };
  }
  const today = todayStr();

  const hold = priceHoldFor(item.itemId);
  if (hold && PRICE_HOLD_LABELS.includes(natural.label)) {
    const out = { ...natural, severity: 'held', label: 'Hold', held: true, holdReason: hold.detail || '',
      reason: hold.detail ? `Price held since ${hold.date}: ${hold.detail}` : `You put this price on hold on ${hold.date}.` };
    delete out.suggestedPrice;
    return out;
  }

  // Dismissals are deliberately short-lived: ignoring a suggestion today
  // just means "not today," not "never again."
  const ignored = latestActionOfType(item.itemId, 'Ignored');
  if (ignored && ignored.date === today) {
    return { ...natural, severity: 'dismissed', label: 'Dismissed', reason: `You dismissed "${natural.label}" today. It'll resurface if the numbers still call for it tomorrow.` };
  }

  if (natural.severity === 'opportunity') {
    const offer = latestActionOfType(item.itemId, 'Offer Sent');
    if (offer && daysSince(offer.date) <= HANDLED_SUPPRESS_DAYS) {
      const when = offer.date === today ? 'today' : `on ${offer.date}`;
      return { ...natural, severity: 'handled', label: 'Offer sent', reason: `Offer sent ${when} via ${escapeHtml(offer.detail)}. Waiting to hear back.` };
    }
  }
  if (natural.severity === 'urgent' || (natural.severity === 'attention' && natural.label === 'Refresh listing')) {
    const drop = latestActionOfType(item.itemId, 'Price Drop');
    if (drop && daysSince(drop.date) <= HANDLED_SUPPRESS_DAYS) {
      const parsed = parsePriceDropDetail(drop.detail);
      const when = drop.date === today ? 'today' : `on ${drop.date}`;
      const priceText = parsed && parsed.from
        ? `${fmtMoney(parsed.from)} → ${fmtMoney(parsed.to)}`
        : fmtMoney(parsed ? parsed.to : Number(drop.detail));
      return { ...natural, severity: 'handled', label: 'Price dropped', reason: `Dropped ${priceText} ${when} — give it a few days before dropping further.` };
    }
  }
  return natural;
}

async function recordItemAction(itemId, itemAction, detail) {
  state.itemActions.push({ date: todayStr(), itemId, action: itemAction, detail: detail || '' });
  if (LIFE_HUB_DONE_ACTIONS[itemAction]) notifyWorkroom();
  if (connected()) {
    try { await apiPost('logItemAction', { itemId, itemAction, detail }); }
    catch { /* logged locally; will drift from the Sheet until the next successful call */ }
  }
}

// ---------------------------------------------------------------------
// Item editor — change list/floor price, the sites an item goes on, and its
// next action from any Actions card; saved to the source tab via updateItem.
// ---------------------------------------------------------------------
function itemPlatformIds(item) {
  return new Set(splitPlatforms(item.platform).map(platformId).filter(Boolean));
}
// Rebuilds the Platform cell from the checked sites, keeping any entries the
// site doesn't recognize so they aren't silently dropped.
function platformFieldFor(item, ids) {
  const unknown = splitPlatforms(item.platform).filter(p => !platformId(p));
  return PLATFORM_ORDER.filter(id => ids.has(id)).map(id => PLATFORM_META[id].label).concat(unknown).join(', ');
}
function editToggleHTML(item) {
  return `<button class="btn secondary ie-toggle" data-id="${escapeHtml(item.itemId)}">Edit</button>`;
}
// One row per site inside the editor: whether the item belongs on that site at
// all (checkbox, saved to the Platform column) plus where it stands right now,
// with a per-site "not posting" toggle that logs straight to Item Actions.
function siteRowHTML(item, id, current, stateById) {
  const meta = PLATFORM_META[id];
  const state = stateById.get(id) || (current.has(id) ? 'todo' : 'off');
  const stateLabel = { live: 'Live', todo: 'Still to post', skipped: 'Not posting', ended: 'Ended', off: 'Not on this item' }[state];
  const button = state === 'skipped'
    ? `<button class="btn secondary ie-reopen-btn" data-id="${escapeHtml(item.itemId)}" data-platform="${escapeHtml(meta.label)}">Post it after all</button>`
    : state === 'todo'
      ? `<button class="btn secondary ie-skip-btn" data-id="${escapeHtml(item.itemId)}" data-platform="${escapeHtml(meta.label)}">Not posting here</button>`
      : '';
  return `
    <div class="ie-site ie-site-${state}" style="--plat:${meta.color}">
      <label class="ie-plat"><input type="checkbox" value="${id}"${current.has(id) ? ' checked' : ''}> ${escapeHtml(meta.label)}</label>
      <span class="ie-site-state">${stateLabel}</span>
      ${button}
    </div>`;
}

function itemEditPanelHTML(item) {
  const current = itemPlatformIds(item);
  const override = actionOverrideFor(item.itemId);
  const suggested = naturalPricingAction(item).label;
  const money = v => parseMoney(v) || '';
  const status = platformsStatusFor(item);
  const stateById = new Map();
  status.done.forEach(d => stateById.set(d.meta.id, 'live'));
  status.missing.forEach(m => stateById.set(m.meta.id, 'todo'));
  status.skipped.forEach(s => stateById.set(s.meta.id, 'skipped'));
  status.ended.forEach(e => stateById.set(e.meta.id, 'ended'));
  return `
    <div class="item-edit" hidden>
      <div class="field-row">
        <div class="field"><label>List price</label><input type="number" min="0" step="0.01" class="ie-list" value="${money(item.listPrice)}" placeholder="No price"></div>
        <div class="field"><label>Floor price</label><input type="number" min="0" step="0.01" class="ie-floor" value="${money(item.floorPrice)}" placeholder="No floor"></div>
      </div>
      <div class="field"><label>Sites <span class="optional">tick the sites this item belongs on; mark any one not posting</span></label>
        <div class="ie-platforms">${PLATFORM_ORDER.map(id => siteRowHTML(item, id, current, stateById)).join('')}</div>
      </div>
      <div class="field"><label>Next action</label>
        <select class="ie-action">
          <option value="Auto">Auto — suggested: ${escapeHtml(suggested)}</option>
          ${ACTION_CHOICES.map(c => `<option value="${escapeHtml(c.label)}"${override && override.label === c.label ? ' selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}
        </select>
      </div>
      <div class="ie-buttons">
        <button class="btn ie-save">Save to sheet</button>
        <button class="btn secondary ie-cancel">Cancel</button>
      </div>
      <div class="status-msg ie-status"></div>
    </div>`;
}
function wireItemEditors(container) {
  container.querySelectorAll('.ie-toggle').forEach(btn => btn.addEventListener('click', () => {
    const panel = btn.closest('.card').querySelector('.item-edit');
    panel.hidden = !panel.hidden;
    btn.textContent = panel.hidden ? 'Edit' : 'Close';
  }));
  container.querySelectorAll('.item-edit').forEach(panel => {
    const toggle = panel.closest('.card').querySelector('.ie-toggle');
    panel.querySelector('.ie-cancel').addEventListener('click', () => {
      panel.hidden = true;
      toggle.textContent = 'Edit';
    });
    panel.querySelector('.ie-save').addEventListener('click', () => {
      const item = state.inventory.find(it => String(it.itemId) === String(toggle.dataset.id));
      if (item) saveItemEdit(item, panel);
    });
    // Per-site decisions save on click rather than waiting for Save, matching
    // the same buttons on the Still to list cards.
    panel.querySelectorAll('.ie-skip-btn, .ie-reopen-btn').forEach(btn => btn.addEventListener('click', async () => {
      btn.disabled = true;
      const decision = btn.classList.contains('ie-skip-btn') ? 'Not Posting' : 'Reopened Listing';
      await recordItemAction(btn.dataset.id, decision, btn.dataset.platform);
      renderAction();
    }));
  });
}
async function saveItemEdit(item, panel) {
  const status = panel.querySelector('.ie-status');
  if (!connected()) { status.textContent = 'Connect your Sheet to save edits — see SETUP.md.'; return; }

  const payload = { itemId: item.itemId, sourceTab: item.sourceTab };
  const priceChange = (input, current) => {
    const raw = input.value.trim();
    const next = raw === '' ? '' : Number(raw);
    if (raw !== '' && (!isFinite(next) || next < 0)) return { error: true };
    return next === (parseMoney(current) || '') ? null : { value: next };
  };
  const list = priceChange(panel.querySelector('.ie-list'), item.listPrice);
  const floor = priceChange(panel.querySelector('.ie-floor'), item.floorPrice);
  if ((list && list.error) || (floor && floor.error)) { status.textContent = 'Prices must be positive numbers, or blank to clear.'; return; }
  if (list) payload.listPrice = list.value;
  if (floor) payload.floorPrice = floor.value;

  const picked = new Set(Array.from(panel.querySelectorAll('.ie-platforms input:checked')).map(i => i.value));
  const before = itemPlatformIds(item);
  if (picked.size !== before.size || [...picked].some(id => !before.has(id))) payload.platform = platformFieldFor(item, picked);

  const chosen = panel.querySelector('.ie-action').value;
  const override = actionOverrideFor(item.itemId);
  if (chosen !== (override ? override.label : 'Auto')) {
    payload.nextAction = chosen;
    const actionState = latestActionStateFor(item.itemId);
    if (chosen !== 'Auto' && actionState && ['Completed', 'Deleted'].includes(actionState.action)) payload.reopen = true;
  }
  if (Object.keys(payload).length === 2) { status.textContent = 'No changes to save.'; return; }

  status.textContent = 'Saving to your Sheet…';
  panel.querySelectorAll('button').forEach(b => { b.disabled = true; });
  let res = null;
  try { res = await apiPost('updateItem', payload); } catch { /* confirmed against the Sheet below */ }

  if (res && res.ok) {
    if ('listPrice' in payload) item.listPrice = payload.listPrice;
    if ('floorPrice' in payload) item.floorPrice = payload.floorPrice;
    if ('platform' in payload) item.platform = payload.platform;
    (res.logged || []).forEach(entry => state.itemActions.push(entry));
  } else if (res && res.ok === false) {
    // A real rejection from updateItem (bad value, missing column): nothing was written.
    panel.querySelectorAll('button').forEach(b => { b.disabled = false; });
    status.textContent = res.error || 'Could not save to your Sheet.';
    return;
  } else {
    // Google sometimes garbles the reply after the write already happened, so
    // re-read the Sheet instead of reporting a failure that invites a duplicate retry.
    status.textContent = 'Checking your Sheet to confirm the save…';
    await Promise.all([loadInventory(), loadItemActionsData()]);
    const fresh = state.inventory.find(it => String(it.itemId) === String(item.itemId));
    if (!fresh || !editLanded(fresh, payload)) {
      panel.querySelectorAll('button').forEach(b => { b.disabled = false; });
      status.textContent = "Couldn't confirm the save — refresh the page to check before trying again.";
      return;
    }
  }
  renderAction();
  renderList();
  renderStats();
  notifyWorkroom();
}

function editLanded(item, payload) {
  const sameMoney = (current, wanted) => (parseMoney(current) || '') === (wanted === '' ? '' : Number(wanted));
  if ('listPrice' in payload && !sameMoney(item.listPrice, payload.listPrice)) return false;
  if ('floorPrice' in payload && !sameMoney(item.floorPrice, payload.floorPrice)) return false;
  if ('platform' in payload && String(item.platform || '') !== payload.platform) return false;
  if ('nextAction' in payload) {
    const set = latestActionOfType(item.itemId, 'Action Set');
    if (!set || set.detail !== payload.nextAction) return false;
  }
  return true;
}

async function sendOfferForAction(itemId, platformLabel) {
  await recordItemAction(itemId, 'Offer Sent', platformLabel);
  renderPricingActions();
}

async function ignoreAction(itemId, label) {
  await recordItemAction(itemId, 'Ignored', label);
  renderPricingActions();
}

async function toggleActionComplete(itemId, isCompleted, label) {
  await recordItemAction(itemId, isCompleted ? 'Reopened' : 'Completed', label);
  renderPricingActions();
}

async function deletePricingAction(itemId, label) {
  if (!confirm(`Delete "${label}" from your action list? This will also be recorded in the Item Actions sheet.`)) return;
  await recordItemAction(itemId, 'Deleted', label);
  renderPricingActions();
  notifyWorkroom();
}

async function dropPriceForAction(item, newPrice, btn) {
  const card = btn.closest('.pricing-card');
  const status = card.querySelector('.pa-status');
  if (!newPrice || newPrice <= 0) { status.textContent = 'Enter a valid price.'; return; }
  if (!connected()) { status.textContent = 'Connect your Sheet to update prices — see SETUP.md.'; return; }
  status.textContent = 'Saving...';
  try {
    const res = await apiPost('dropListingPrice', { itemId: item.itemId, sourceTab: item.sourceTab, newPrice });
    if (!res || !res.ok) { status.textContent = (res && res.error) || 'Could not update the price.'; return; }
  } catch { status.textContent = 'Could not save to your Sheet.'; return; }
  item.listPrice = newPrice;
  state.itemActions.push({ date: todayStr(), itemId: item.itemId, action: 'Price Drop', detail: String(newPrice) });
  renderPricingActions();
}


// When a pricing suggestion first shows up on Actions. Sheet fields for
// metrics / Item Actions / Date listed are date-only (yyyy-MM-dd) and do not
// record suggestion onset — so we seed the calendar day from the best
// existing date, then keep a full date+time in localStorage the first time
// this (item, label) appears so the chip can show both.
function latestMetricsDateForItem(itemId) {
  let best = '';
  latestMetricsByItemPlatform().forEach(m => {
    if (String(m.itemId) !== String(itemId)) return;
    const d = String(m.date || '').trim();
    if (d && d >= best) best = d;
  });
  return best;
}
function suggestionSeedDate(item, action) {
  if (action && action.manual) {
    const set = latestActionOfType(item.itemId, 'Action Set');
    if (set && set.date) return String(set.date).trim();
  }
  return latestMetricsDateForItem(item.itemId) || String(item.dateListed || '').trim() || '';
}
function ensureSuggestionAddedAt(itemId, label, seedDateStr) {
  const key = 'sellHub.paAdded.' + String(itemId) + '.' + String(label || '');
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
  } catch { /* private mode */ }
  const seed = String(seedDateStr || '').trim();
  const today = todayStr();
  let iso;
  if (/^\d{4}-\d{2}-\d{2}/.test(seed) && seed.slice(0, 10) !== today) {
    // Prefer the sheet's calendar day; noon local so the displayed date matches.
    const day = seed.slice(0, 10);
    const hasTime = seed.length > 10 && /\d{1,2}:\d{2}/.test(seed);
    iso = hasTime ? new Date(seed.replace(' ', 'T')).toISOString() : new Date(day + 'T12:00:00').toISOString();
  } else {
    iso = new Date().toISOString();
  }
  try { localStorage.setItem(key, iso); } catch { /* ignore */ }
  return iso;
}
function formatSuggestionAddedChip(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const opts = { timeZone: 'America/New_York', month: 'short', day: 'numeric' };
  // Short on the chip, exact in the tooltip: the date is when the suggestion
  // first appeared, not when the stats behind it were pulled.
  const text = d.toLocaleDateString('en-US', opts);
  const full = d.toLocaleString('en-US', { ...opts, hour: 'numeric', minute: '2-digit', hour12: true });
  return `<span class="pa-added-chip" title="Suggestion first appeared ${escapeHtml(full)}">Added ${escapeHtml(text)}</span>`;
}
function suggestionAddedChipHTML(item, action) {
  const iso = ensureSuggestionAddedAt(item.itemId, action.label, suggestionSeedDate(item, action));
  return formatSuggestionAddedChip(iso);
}

// Pricing suggestions are shown in these sections, in this order. Anything
// that needs a move from you is open; waiting/done sections start collapsed.
const PRICING_GROUPS = [
  { key: 'Send an offer', title: 'Send an offer', color: '#1f3a5c' },
  { key: 'Try a price drop', title: 'Try a price drop', color: '#7a2038' },
  { key: 'Boost visibility', title: 'Boost visibility', color: '#a1752e' },
  { key: 'Refresh listing', title: 'Refresh listing', color: '#a1752e' },
  { key: 'Offer sent', title: 'Offer sent — waiting', color: '#1f5c64', collapsed: true },
  { key: 'Price dropped', title: 'Price dropped — waiting', color: '#1f5c64', collapsed: true },
  { key: 'Hold', title: 'On hold', color: '#56657a', collapsed: true },
  { key: 'Dismissed', title: 'Dismissed today', color: '#74849a', collapsed: true },
  { key: 'On track', title: 'On track', color: '#1f5c46', collapsed: true },
  { key: 'No data yet', title: 'No data yet', color: '#74849a', collapsed: true },
  { key: 'Completed', title: 'Completed', color: '#16836a', collapsed: true },
];

function pricingReasonHTML(reason, limit) {
  const text = String(reason || '');
  const max = limit || 96;
  if (text.length <= max) return `<p class="pa-reason">${escapeHtml(text)}</p>`;
  const short = text.slice(0, max).replace(/\s+\S*$/, '').trim() || text.slice(0, max);
  return `<p class="pa-reason"><span class="pa-reason-clip">${escapeHtml(short)}…</span><span class="pa-reason-full" hidden>${escapeHtml(text)}</span> <button type="button" class="pa-reason-toggle">more</button></p>`;
}
function pricingGroupId(label) { return 'pa-group-' + categoryId(label); }

// Says which day's numbers these suggestions were worked out from — the
// per-card chip is the day the suggestion appeared, which reads as stale.
function renderPricingStatsNote() {
  const head = document.getElementById('sec-pricing');
  if (!head) return;
  let note = document.getElementById('pricingStatsNote');
  if (!note) {
    note = document.createElement('p');
    note.id = 'pricingStatsNote';
    note.className = 'subhead-note';
    head.insertAdjacentElement('afterend', note);
  }
  let latest = '';
  (state.metrics || []).forEach(m => {
    const d = String(m.date || '').slice(0, 10);
    if (d && d > latest) latest = d;
  });
  const when = latest
    ? new Date(latest + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : '';
  note.textContent = when
    ? `Worked out from listing stats through ${when}. The date on a card is when that suggestion first appeared.`
    : 'The date on a card is when that suggestion first appeared.';
}

function renderPricingActions() {
  const container = document.getElementById('pricingActions');
  if (!container) return;
  const items = state.inventory.filter(it => !isSold(it));
  setActionSectionVisible('section-pricing', true);
  renderPricingStatsNote();
  if (!items.length) { container.innerHTML = '<div class="empty-state">No active listings yet.</div>'; return; }

  const rows = items.map(it => ({ item: it, action: pricingActionFor(it) }))
    .filter(row => !row.action.hidden && (state.showCompletedActions || row.action.severity !== 'complete'));

  if (!rows.length) {
    container.innerHTML = '<div class="empty-state">No open pricing actions. Turn on “Show completed pricing” to review finished items.</div>';
    return;
  }

  const cardHTML = ({ item, action }) => {
    const isCompleted = action.severity === 'complete';
    const held = !!priceHoldFor(item.itemId);
    const showOfferBtn = action.severity === 'opportunity';
    const showPriceControls = action.severity === 'urgent' || (action.severity === 'attention' && action.label === 'Refresh listing');
    const showIgnore = ['urgent', 'attention', 'opportunity'].includes(action.severity);
    // Only offer the hold where a suggestion could push the price down.
    const showHold = held || PRICE_HOLD_LABELS.includes(action.label);
    const title = [item.brand, item.item].filter(Boolean).join(' — ') || item.itemId;
    const platforms = splitPlatforms(item.platform).map(p => platformMeta(p).label).join(', ') || '—';
    const metaBits = [
      priceLineHTML(item),
      item.floorPrice ? `floor ${escapeHtml(item.floorPrice)}` : '',
      `${action.views}v / ${action.clicks}c${action.watchers ? ` / ${action.watchers}w` : ''}`,
      escapeHtml(platforms),
    ].filter(Boolean);
    const primary = showOfferBtn
      ? `<button class="btn ar-primary pa-offer-btn" data-id="${escapeHtml(item.itemId)}" data-plat="${escapeHtml(action.offerPlatformLabel || '')}">Offer sent</button>`
      : (showPriceControls && action.suggestedPrice)
        ? `<button class="btn ar-primary pa-drop-suggested-btn" data-id="${escapeHtml(item.itemId)}" data-price="${action.suggestedPrice}">Dropped to ${fmtMoney(action.suggestedPrice)}</button>`
        : `<button class="btn ar-primary pa-complete-btn" data-id="${escapeHtml(item.itemId)}" data-completed="${isCompleted}" data-label="${escapeHtml(action.label)}">${isCompleted ? 'Reopen' : 'Mark complete'}</button>`;
    const secondaryComplete = (showOfferBtn || (showPriceControls && action.suggestedPrice))
      ? `<button class="icon-btn pa-complete-btn" data-id="${escapeHtml(item.itemId)}" data-completed="${isCompleted}" data-label="${escapeHtml(action.label)}">${isCompleted ? 'Reopen' : 'Complete'}</button>`
      : '';
    return `
    <div class="card pricing-card action-row pa-${action.severity}" data-item-id="${escapeHtml(item.itemId)}">
      <div class="ar-title-row">
        <h3>${escapeHtml(title)}</h3>
        <div class="card-top-actions">${actionStarHTML(item.itemId, [item.brand, item.item].filter(Boolean).join(' ') || item.itemId)}<span class="pa-badge pa-${action.severity}">${escapeHtml(action.label)}${action.manual ? ' · you' : ''}</span>${held ? '<span class="pa-badge pa-price-held" title="Price drops stay off this one until you release it">🔒</span>' : ''}${suggestionAddedChipHTML(item, action)}</div>
      </div>
      <div class="ar-meta-line">${metaBits.join(' · ')}</div>
      ${action.suggestedPrice ? `<div class="pa-callout"><b>Suggest ${fmtMoney(action.suggestedPrice)}</b></div>` : ''}
      ${action.offerWhere ? `<div class="pa-callout"><b>${escapeHtml(action.offerWhere)}</b></div>` : ''}
      ${pricingReasonHTML(action.reason)}
      <div class="ar-actions pa-actions">
          ${primary}
          <div class="ar-secondary">
            ${showPriceControls ? `
              <span class="pa-custom-price">
                <input type="number" min="0" step="1" class="pa-custom-input" placeholder="$">
                <button class="icon-btn pa-drop-custom-btn" data-id="${escapeHtml(item.itemId)}">Save $</button>
              </span>
            ` : ''}
            ${showIgnore ? `<button class="icon-btn pa-ignore-btn" data-id="${escapeHtml(item.itemId)}" data-label="${escapeHtml(action.label)}">Ignore</button>` : ''}
            ${showHold ? `<button class="icon-btn pa-hold-btn${held ? ' on' : ''}" data-id="${escapeHtml(item.itemId)}" data-held="${held}">${held ? 'Release' : 'Hold'}</button>` : ''}
            ${secondaryComplete}
            ${editToggleHTML(item).replace('btn secondary ie-toggle', 'icon-btn ie-toggle')}
            <button class="icon-btn pa-delete-btn" data-id="${escapeHtml(item.itemId)}" data-label="${escapeHtml(action.label)}" aria-label="Delete action">Delete</button>
          </div>
      </div>
      <div class="status-msg pa-status"></div>
      ${itemEditPanelHTML(item)}
    </div>
  `;
  };

  const byGroup = new Map();
  rows.forEach(row => {
    const key = PRICING_GROUPS.some(g => g.key === row.action.label) ? row.action.label : 'On track';
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(row);
  });
  container.innerHTML = PRICING_GROUPS.filter(g => byGroup.has(g.key)).map(g => {
    const groupRows = byGroup.get(g.key).sort((a, b) => (b.action.watchers - a.action.watchers) || (b.action.views - a.action.views));
    return `
      <details class="action-group pa-group" id="${pricingGroupId(g.key)}" style="--plat:${g.color}"${g.collapsed ? '' : ' open'}>
        <summary><span class="ag-title">${escapeHtml(g.title)}</span><span class="ag-count">${groupRows.length}</span></summary>
        <div class="card-grid">${groupRows.map(cardHTML).join('')}</div>
      </details>`;
  }).join('');

  wireActionStars(container);
  wireItemEditors(container);

  container.querySelectorAll('.pa-reason-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const reason = btn.closest('.pa-reason');
      const clip = reason.querySelector('.pa-reason-clip');
      const full = reason.querySelector('.pa-reason-full');
      const expanding = full.hidden;
      if (clip) clip.hidden = expanding;
      full.hidden = !expanding;
      btn.textContent = expanding ? 'less' : 'more';
    });
  });
  container.querySelectorAll('.pa-offer-btn').forEach(btn => {
    btn.addEventListener('click', () => sendOfferForAction(btn.dataset.id, btn.dataset.plat));
  });
  container.querySelectorAll('.pa-ignore-btn').forEach(btn => {
    btn.addEventListener('click', () => ignoreAction(btn.dataset.id, btn.dataset.label));
  });
  container.querySelectorAll('.pa-hold-btn').forEach(btn => {
    btn.addEventListener('click', () => togglePriceHold(btn.dataset.id, btn.dataset.held === 'true', btn));
  });
  container.querySelectorAll('.pa-complete-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleActionComplete(btn.dataset.id, btn.dataset.completed === 'true', btn.dataset.label));
  });
  container.querySelectorAll('.pa-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deletePricingAction(btn.dataset.id, btn.dataset.label));
  });
  container.querySelectorAll('.pa-drop-suggested-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = rows.find(r => r.item.itemId === btn.dataset.id).item;
      dropPriceForAction(item, Number(btn.dataset.price), btn);
    });
  });
  container.querySelectorAll('.pa-drop-custom-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = rows.find(r => r.item.itemId === btn.dataset.id).item;
      const input = btn.closest('.pa-custom-price').querySelector('.pa-custom-input');
      dropPriceForAction(item, Number(input.value), btn);
    });
  });
}

async function togglePriceHold(itemId, held, btn) {
  if (held) {
    await recordItemAction(itemId, 'Price Released', 'Back to automatic pricing suggestions.');
  } else {
    const reason = (window.prompt('Why is this price staying put? (optional)', '') || '').trim();
    await recordItemAction(itemId, 'Price Hold', reason || 'Holding this price for now.');
  }
  renderPricingActions();
  renderActionSummary();
}

document.getElementById('showCompletedActions').addEventListener('change', event => {
  state.showCompletedActions = event.target.checked;
  renderPricingActions();
});

function populateMetricForm() {
  const itemSel = document.getElementById('metricItemSelect');
  const items = state.inventory.filter(it => !isSold(it)).sort((a, b) => (a.item || a.brand || '').localeCompare(b.item || b.brand || ''));
  itemSel.innerHTML = items.length
    ? items.map(it => `<option value="${it.itemId}">${escapeHtml(it.itemId)} — ${escapeHtml([it.brand, it.item].filter(Boolean).join(' '))}</option>`).join('')
    : '<option value="">No active items</option>';
  document.getElementById('metricPlatformSelect').innerHTML = platformOptionsHTML();
}

document.getElementById('metricAddToggle').addEventListener('click', () => {
  const panel = document.getElementById('metricAddPanel');
  const open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : '';
  document.getElementById('metricAddToggle').textContent = open ? '+ Log a stat update' : '− Close';
});

async function addMetricEntry() {
  const status = document.getElementById('metricStatus');
  const itemId = document.getElementById('metricItemSelect').value;
  const platId = document.getElementById('metricPlatformSelect').value;
  if (!itemId) { status.textContent = 'Pick an item.'; return; }
  if (!connected()) { status.textContent = 'Connect your Sheet to save stat updates — see SETUP.md.'; return; }

  const platLabel = (PLATFORM_META[platId] || DEFAULT_PLATFORM_META).label;
  const listingId = `${itemId}-${platId.toUpperCase()}`;
  const body = {
    listingId, itemId, platform: platLabel,
    impressions: Number(document.getElementById('metricImpressions').value) || 0,
    views: Number(document.getElementById('metricViews').value) || 0,
    watchers: Number(document.getElementById('metricWatchers').value) || 0,
    clicks: Number(document.getElementById('metricClicks').value) || 0,
  };

  status.textContent = 'Saving...';
  try {
    await apiPost('addMetricEntry', body);
    state.metrics.push({ ...body, date: todayStr(), source: 'manual' });
  } catch { status.textContent = 'Could not save to your Sheet.'; return; }

  ['metricImpressions', 'metricViews', 'metricWatchers', 'metricClicks'].forEach(id => document.getElementById(id).value = '');
  status.textContent = 'Saved.';
  renderStats();
  renderAction();
  setTimeout(() => status.textContent = '', 1500);
}
document.getElementById('addMetricBtn').addEventListener('click', addMetricEntry);
document.getElementById('balancePlatform').innerHTML = PLATFORM_ORDER.map(id => `<option value="${escapeHtml(PLATFORM_META[id].label)}">${escapeHtml(PLATFORM_META[id].label)}</option>`).join('');
document.getElementById('balanceAddToggle').addEventListener('click', () => {
  const panel = document.getElementById('balanceAddPanel');
  const open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : '';
  const toggle = document.getElementById('balanceAddToggle');
  toggle.textContent = open ? '+ Update available cash' : '− Close';
  toggle.setAttribute('aria-expanded', String(!open));
});
document.getElementById('saveBalanceBtn').addEventListener('click', saveBalance);

// Acquire (sourcing intelligence, hunt list CRUD) lives in js/acquire.js,
// with its assumptions in js/acquire-config.js and its math in
// js/acquire-model.js.

// ---------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------

state.picked = new Set(localGet('sellHub.picked', []));
state.listGroup = localGet('sellHub.listGroup', 'category');
// Inventory sections always start collapsed; expand choices live only in-session.
state.expandedCats = new Set();
state.expandedSizes = new Set();
state.expandedRanked = new Set();
state.expandedWheelItems = new Set();
document.querySelectorAll('#groupSwitch button').forEach(b => b.classList.toggle('active', b.dataset.group === state.listGroup));

renderWheel();
applyZoom();
routeOverview();
renderListChips();
renderList();
renderPickPanel();
setMode(localGet('sellHub.mode', 'list'));
renderStats();
state.featuredActions = new Set(localGet('sellHub.featuredActions', []));
renderAction();
populateMetricForm();

(function wireInventoryExpandCollapse() {
  const expandBtn = document.getElementById('inventoryExpandAllBtn');
  const collapseBtn = document.getElementById('inventoryCollapseAllBtn');
  if (expandBtn) expandBtn.addEventListener('click', () => setInventoryExpandedAll(true));
  if (collapseBtn) collapseBtn.addEventListener('click', () => setInventoryExpandedAll(false));
})();

(function wireInventoryRefresh() {
  const btn = document.getElementById('inventoryRefreshBtn');
  const status = document.getElementById('inventoryRefreshStatus');
  if (!btn) return;
  let busy = false;
  btn.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    const prev = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Refreshing…';
    if (status) {
      status.textContent = '';
      status.classList.remove('is-error');
    }
    try {
      const result = await reloadLiveData();
      if (status) {
        const ebayNote = result && result.ebaySyncNote ? String(result.ebaySyncNote) : '';
        status.textContent = ebayNote ? `Updated · ${ebayNote}` : 'Updated';
        const shown = status.textContent;
        setTimeout(() => { if (status.textContent === shown) status.textContent = ''; }, 4000);
      }
    } catch (err) {
      const msg = (err && err.code === 'offline')
        ? 'Connect your Sheet first — see SETUP.md.'
        : "Couldn't refresh — try again in a moment.";
      if (status) {
        status.textContent = msg;
        status.classList.add('is-error');
      }
    } finally {
      btn.disabled = false;
      btn.textContent = prev;
      busy = false;
    }
  });
})();

// The Sales tab decides where an item sold (and whether it was handed over in
// person), so Actions re-renders once it arrives too.
loadSalesData().then(() => { renderStats(); renderAction(); });
loadSavedItems();
(async () => {
  // One cold start instead of seven parallel GETs. Fall back to the individual
  // loaders if bootBundle isn't deployed yet (or the request fails).
  document.getElementById('inventorySetupNote').style.display = connected() ? 'none' : 'block';
  try {
    if (!connected()) throw new Error('offline');
    const bundle = await apiGetWithRetry('bootBundle', { timeoutMs: 45000 });
    if (!bundle || bundle.error || !Array.isArray(bundle.inventory)) throw new Error('bootBundle unavailable');
    state.inventory = (bundle.inventory || []).filter(isRealItem);
    state.descriptions = bundle.descriptions || [];
    state.postingQueue = bundle.postingQueue || [];
    state.metrics = bundle.metrics || [];
    state.photos = bundle.photos || [];
    state.itemActions = bundle.itemActions || [];
    state.localDeals = bundle.localDeals || [];
  } catch {
    await Promise.all([loadInventory(), loadDescriptionsData(), loadPostingQueueData(), loadMetricsData(), loadPhotosData(), loadItemActionsData(), loadLocalDealsData()]);
  }
  state.loadedAt = new Date().toISOString();
  renderWheel();
  routeOverview();
  renderListChips();
  renderList();
  renderStats();
  renderAction();
  notifyWorkroom();
  populateMetricForm();
})();
