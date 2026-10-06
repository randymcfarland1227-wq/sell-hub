const state = {
  showSold: false,        // category drill-down view
  listShowSold: false,    // list mode
  listActiveCats: new Set(),
  zoom: 1,
  listSort: 'name',
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
  openAlerts: new Set(),  // item ids whose "!" alert list is open
  openOptRows: new Set(), // Underperforming rows opened this session
  perfView: 'status',     // Performance tab grouping
  perfSort: 'views',
  expandedPerf: new Set(),        // Performance rows opened this session
  perfGroupOpen: {},              // Performance group open/closed choices this session
};

const ZOOM_MIN = 0.7, ZOOM_MAX = 1.6, ZOOM_STEP = 0.1, ZOOM_BASE = 380;

const connected = () => !!APPS_SCRIPT_URL;

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Compact inventory label used on collapsed ranked rows (brand + item, no em dash).
// Brand + item, without saying the brand twice when the item name already
// starts with it ("Timberland Timberland Ellendale..." reads as a typo).
// ---------------------------------------------------------------------
// Visual language: one icon + one colour per kind of number, used on every
// tile and section heading, so a glance tells you what a box is about
// before you read it.
// ---------------------------------------------------------------------
const ICON_PATHS = {
  tag: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  pointer: '<path d="M4 4l7 17 2.5-7.5L21 11z"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
  wallet: '<path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/><path d="M3 7l12-4v4"/><circle cx="16.5" cy="13.5" r="1.2"/>',
  truck: '<path d="M2 6h11v10H2z"/><path d="M13 10h4l3 3v3h-7"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  tasks: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M3 6l1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
  xcircle: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0 5 5L21 13l-8 8-3-3 8-8-1.3-1.3a4 4 0 0 0-5-5L14 2z"/><path d="M3 21l6-6"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  zap: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
  down: '<path d="M3 7l6 6 4-4 8 8"/><path d="M15 17h6v-6"/>',
  megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h3l6 5V5L7 10H4a1 1 0 0 0-1 1z"/><path d="M17 8a5 5 0 0 1 0 8"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
  gauge: '<path d="M4 18a9 9 0 1 1 16 0"/><path d="M12 14l4-5"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  box: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  dollar: '<path d="M12 2v20"/><path d="M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  note: '<path d="M4 4h16v12l-4 4H4z"/><path d="M16 20v-4h4"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
};
function icon(name) {
  return `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[name] || ICON_PATHS.target}</svg>`;
}
// kind -> icon; the colour for each kind lives in CSS as .kpi-<kind>.
const KPI_ICONS = {
  listings: 'tag', views: 'eye', clicks: 'pointer', watchers: 'heart', sold: 'check', cash: 'wallet',
  ship: 'truck', tasks: 'tasks', local: 'users', end: 'xcircle', prep: 'wrench', list: 'upload', moves: 'zap',
  offer: 'send', drop: 'down', reach: 'megaphone', out: 'send', behind: 'alert', pace: 'gauge', week: 'activity',
  items: 'box', value: 'dollar', net: 'dollar', focus: 'target',
};
function kpiIcon(kind) { return `<span class="kpi-ico">${icon(KPI_ICONS[kind] || 'target')}</span>`; }
function kpiClass(kind, num) {
  const zero = num === 0 || num === '0' || num === '$0' || num === '—';
  return `kpi kpi-${kind}${zero ? ' is-zero' : ''}`;
}
// Section headings get the same treatment: an icon chip in the section's
// colour, added once at start-up from this map.
const SECTION_KINDS = {
  'sec-ship': 'ship', 'sec-tasks': 'tasks', 'sec-local': 'local', 'sec-end': 'end', 'sec-prep': 'prep', 'sec-list': 'list',
  'sec-pricing': 'moves', 'sec-offers-out': 'out', 'sec-under': 'behind', 'sec-platforms': 'layers', 'sec-listings': 'list',
  'sec-sales': 'sold', 'sec-cashflow': 'cash',
};
function decorateSectionHeadings() {
  document.querySelectorAll('.subhead[id]').forEach(h => {
    const kind = SECTION_KINDS[h.id];
    if (!kind || h.querySelector('.sec-ico')) return;
    h.classList.add('sec-head', 'kpi-' + kind);
    h.insertAdjacentHTML('afterbegin', `<span class="sec-ico">${icon(KPI_ICONS[kind] || kind)}</span>`);
  });
}

function itemDisplayName(item, sep) {
  const brand = String((item && item.brand) || '').trim();
  const name = String((item && item.item) || '').trim();
  if (brand && name.toLowerCase().startsWith(brand.toLowerCase())) return name;
  return [brand, name].filter(Boolean).join(sep || ' ') || String((item && item.itemId) || 'Item');
}
function itemShortName(item) {
  return itemDisplayName(item, ' ');
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
  // short is for chips and buttons where the full name pushes a row onto two
  // lines; it falls back to the full label everywhere it isn't set.
  if (id && PLATFORM_META[id]) {
    const meta = { id, ...PLATFORM_META[id] };
    if (!meta.short) meta.short = meta.label;
    return meta;
  }
  const label = name || DEFAULT_PLATFORM_META.label;
  return { id: id || categoryId(name) || 'other', label, short: label, color: DEFAULT_PLATFORM_META.color };
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
// One listing gets written by more than one source on the same day, and each
// source only measures part of the picture: the eBay API reports impressions
// and clicks (leaving views and watchers at 0), while a manual Seller Hub pull
// reports views, watchers and price (leaving impressions and clicks at 0).
// Taking whichever row happened to be written last threw away the other half -
// on 2026-09-29 a manual pull landing after the API run dropped eBay clicks
// from 567 to 95 overnight, which looked like a collapse in traffic and was
// really just the API's numbers being masked.
//
// So: rows from the newest date are merged field by field, and a field only
// falls back to 0 when every source that day reported 0. Older dates are never
// mixed in - a zero yesterday and a zero today are different facts.
const METRIC_FIELDS = ['impressions', 'views', 'watchers', 'clicks', 'price'];
// asOf (yyyy-mm-dd, optional) reads the numbers as they stood on that day,
// which is how Performance works out a week's trend.
const latestMetricsCache = { src: null, len: -1, map: null };
function latestMetricsByItemPlatform(asOf) {
  // Every card and row asks for this; rebuild only when the metrics change.
  if (!asOf && latestMetricsCache.src === state.metrics && latestMetricsCache.len === state.metrics.length) return latestMetricsCache.map;
  const out = buildLatestMetrics(asOf);
  if (!asOf) Object.assign(latestMetricsCache, { src: state.metrics, len: state.metrics.length, map: out });
  return out;
}
function buildLatestMetrics(asOf) {
  const byKey = new Map();
  state.metrics.forEach(m => {
    if (!m.itemId) return;
    if (asOf && String(m.date || '').slice(0, 10) > asOf) return;
    const key = m.itemId + '|' + platformMeta(m.platform).id;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(m);
  });
  const out = new Map();
  byKey.forEach((rows, key) => {
    let newestDate = '';
    rows.forEach(r => { const d = String(r.date || '').slice(0, 10); if (d > newestDate) newestDate = d; });
    const sameDay = rows.filter(r => String(r.date || '').slice(0, 10) === newestDate);
    const merged = { ...sameDay[sameDay.length - 1] };
    METRIC_FIELDS.forEach(field => {
      for (let i = sameDay.length - 1; i >= 0; i--) {
        const v = sameDay[i][field];
        if (v !== '' && v !== null && v !== undefined && Number(v) !== 0) { merged[field] = v; break; }
      }
    });
    out.set(key, merged);
  });
  return out;
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
// Life Hub gets one List task per item covering every site it still needs posting on.
function listTaskKey(itemId) { return `list:${itemId}`; }
const LIFE_HUB_SHORT_PLATFORM = { facebook: 'FB Mrkplc' };
function shortPlatformLabel(meta) { return LIFE_HUB_SHORT_PLATFORM[meta.id] || meta.label; }
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
  return itemDisplayName(item, ' — ') || String(item.itemId);
}
const LIFE_HUB_TASK_SEVERITIES = new Set(['opportunity', 'urgent', 'attention']);
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
      tag: 'Ship',
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
      tag: `End Listing · ${shortPlatformLabel(t.meta)}`,
      platformLabel: t.meta.label,
      listingId: (t.entry && t.entry.listingId) || '',
      itemId: t.item.itemId,
      completable: true,
    });
  });
  active.forEach(item => {
    const missing = platformsStatusFor(item).missing;
    if (!missing.length) return;
    const key = listTaskKey(item.itemId);
    actions.push({
      id: key,
      title: itemTitle(item),
      detail: `Post it on ${missing.map(m => m.meta.label).join(', ')}.`,
      meta: askFor(item) ? `List price ${fmtMoney(askFor(item))}` : 'No list price yet',
      kind: 'list',
      tag: `List (${missing.map(m => shortPlatformLabel(m.meta)).join(', ')})`,
      itemId: item.itemId,
      // Starred here or on any one site's posting task
      starred: isFeaturedAction(key) || missing.some(m => isFeaturedAction(postingTaskKey(item.itemId, m.meta.id))),
      completable: true,
    });
  });
  active.forEach(item => {
    const action = pricingActionFor(item);
    // Only real to-dos: offer, price drop, boost/refresh. Completed, Hold, No data yet, handled
    // and dismissed are statuses, not tasks. Deleted suggestions are hidden. Same rule as the
    // Moves list on this site, so Life Hub never shows a move this site doesn't.
    if (!action || action.hidden || !LIFE_HUB_TASK_SEVERITIES.has(action.severity)) return;
    if (!MOVE_GROUP_KEYS.includes(pricingGroupKeyFor(action))) return;
    // Skip if this itemId is already a ship task (sold items are filtered out of active).
    actions.push({
      id: String(item.itemId),
      title: itemTitle(item),
      detail: `${action.label}: ${action.reason}`,
      meta: `${action.views || 0} views · ${action.clicks || 0} clicks`,
      kind: 'pricing',
      tag: action.label,
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
      tag: 'Local Deal',
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
    starred: a.starred ?? isFeaturedAction(a.id),
    originUrl: RESALE_ORIGIN_URL,
    // Task type shown before the title on Life Hub ("Ship", "End Listing · Depop", …)
    tag: a.tag,
  }));
  const featured = actions.filter(a => a.starred ?? isFeaturedAction(a.id)).map(a => ({
    id: a.id,
    title: a.title,
    detail: a.detail,
    meta: a.meta,
    originUrl: RESALE_ORIGIN_URL,
    completable: a.completable !== false,
    tag: a.tag,
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
  // Every path (load, storage events from Life Hub on the same origin, edits) goes through here;
  // before the Sheet data loads the snapshot is all zeros, so send nothing until then.
  if (!state.loadedAt) return;
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
  } else if (/^list:[^:]+$/.test(key)) {
    // One List task per item: posted on every site it was still missing.
    const itemId = key.slice('list:'.length);
    const item = state.inventory.find(it => String(it.itemId) === itemId);
    const missing = item ? platformsStatusFor(item).missing : [];
    for (const m of missing) {
      await recordItemAction(itemId, 'Listing Posted', m.meta.label);
      setFeaturedAction(postingTaskKey(itemId, m.meta.id), false);
    }
    renderAction();
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
  // Unstarring an item's List task also clears any per-site posting stars behind it.
  if (!next && /^list:[^:]+$/.test(key)) {
    const itemId = key.slice('list:'.length);
    const item = state.inventory.find(it => String(it.itemId) === itemId);
    (item ? platformsStatusFor(item).missing : []).forEach(m => setFeaturedAction(postingTaskKey(itemId, m.meta.id), false));
  }
  renderAction();
  notifyWorkroom();
}
window.addEventListener('message', event => {
  if (!isWorkroomOrigin(event.origin)) return;
  const type = event.data?.type;
  if (type === 'randys-workroom:request') {
    // Not loaded yet: answer nothing (zeros would wipe Life Hub's numbers); the load sends one.
    if (!state.loadedAt) return;
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
// Just the price it is now. What it used to be, and every offer sent against
// it, lives in priceLogHTML below - a card that shouts its own history at you
// is harder to read than one that answers "what is it today?" in one glance.
function priceLineHTML(item) {
  return priceTextFor(item);
}

// The price on the live listing is the price - Randy sets it there, and the
// sheet's List price is only a fallback for items not live anywhere yet.
// Read per site from the latest stat pull (eBay and Poshmark rows carry it).
function livePricesFor(item) {
  if (!item || isSold(item)) return [];
  const map = latestMetricsByItemPlatform();
  return platformsStatusFor(item).done
    .map(d => {
      const snap = map.get(item.itemId + '|' + d.meta.id);
      return { meta: d.meta, price: snap ? parseMoney(snap.price) : 0 };
    })
    .filter(r => r.price > 0)
    .sort((a, b) => platformRank(a.meta.id) - platformRank(b.meta.id));
}
function askFor(item) {
  const live = livePricesFor(item);
  return live.length ? live[0].price : parseMoney(item && item.listPrice);
}
const moneyText = n => '$' + (Number.isInteger(n) ? n : n.toFixed(2));
// "$49.99", or "$49.99 eBay · $60 Posh" when the sites differ.
function priceTextFor(item) {
  const live = livePricesFor(item);
  if (!live.length) return item && item.listPrice ? escapeHtml(moneyText(parseMoney(item.listPrice))) : '\u2014';
  const distinct = [...new Set(live.map(r => r.price))];
  if (distinct.length === 1) return escapeHtml(moneyText(distinct[0]));
  return live.map(r => `${escapeHtml(moneyText(r.price))} <i class="px-site">${escapeHtml(r.meta.short || r.meta.label)}</i>`).join(' · ');
}
// The full pricing history for one item, collapsed by default: every price
// drop and every offer sent, newest first.
function priceLogHTML(itemId) {
  // Item Actions is append-only and a retried write can land twice, so the
  // same event must not show up twice here. Identical date+action+detail is
  // always a duplicate: two genuine drops on one day differ in their prices.
  const seen = new Set();
  const events = state.itemActions
    .filter(a => String(a.itemId) === String(itemId) && (a.action === 'Offer Sent' || a.action === 'Price Drop'))
    .filter(a => {
      const key = `${a.date}|${a.action}|${String(a.detail || '')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice()
    .reverse();
  if (!events.length) return '';
  const rows = events.map(a => {
    if (a.action === 'Price Drop') {
      const parsed = parsePriceDropDetail(a.detail);
      const val = parsed && parsed.from
        ? `${fmtMoney(parsed.from)} \u2192 ${fmtMoney(parsed.to)}`
        : (parsed ? fmtMoney(parsed.to) : escapeHtml(String(a.detail || '')));
      return `<li class="pl-row pl-drop"><span class="pl-when">${escapeHtml(a.date)}</span><span class="pl-what">Price drop</span><span class="pl-val">${val}</span></li>`;
    }
    return `<li class="pl-row pl-offer"><span class="pl-when">${escapeHtml(a.date)}</span><span class="pl-what">Offer sent</span><span class="pl-val">${escapeHtml(String(a.detail || ''))}</span></li>`;
  }).join('');
  const drops = events.filter(a => a.action === 'Price Drop').length;
  const offers = events.length - drops;
  const label = [
    drops ? `${drops} price drop${drops === 1 ? '' : 's'}` : '',
    offers ? `${offers} offer${offers === 1 ? '' : 's'} sent` : '',
  ].filter(Boolean).join(' \u00b7 ');
  return `<details class="price-log"><summary><span class="pl-summary">${escapeHtml(label)}</span></summary><ul class="pl-list">${rows}</ul></details>`;
}
// Small badges surfacing "something was already done about this" directly
// on the Inventory cards, not just in the Action tab — a price drop and/or
// an offer sent, whichever have happened for this item.
function actionBadgesHTML(itemId) {
  const item = state.inventory.find(it => String(it.itemId) === String(itemId));
  const alerts = item ? itemAlerts(item) : [];
  if (!alerts.length) return '';
  return `<ul class="alert-list">${alerts.map(a => `<li class="alert-${a.kind}"><span>${escapeHtml(a.text)}</span></li>`).join('')}</ul>`;
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
    setInventoryMode(state.inventoryMode);
    requestAnimationFrame(() => applyZoom());
  }
  if (view === 'focus') renderFocusView();
  if (view === 'optimize') { renderOptimizeView(); renderPricingActions(); }
  if (view === 'performance') renderPerformanceView();
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
// The wheel view is gone: List is the only inventory view, and the five
// grouping buttons that sat beside it are now one select, so the toolbar
// reads as two dropdowns instead of a wall of toggles.
const listGroupSelect = document.getElementById('listGroupSelect');
if (listGroupSelect) {
  listGroupSelect.addEventListener('change', () => setListGroup(listGroupSelect.value));
}

function setListGroup(group) {
  state.listGroup = group;
  localSet('sellHub.listGroup', group);
  if (listGroupSelect && listGroupSelect.value !== group) listGroupSelect.value = group;
  renderList();
}

// Expand / Collapse all — acts on whichever Inventory collapse set is on screen
// (list by category / size / views, or wheel category drill-down item rows).
function inventoryListModeActive() {
  const el = document.getElementById('listMode');
  return !!(el && el.style.display !== 'none');
}
function inventoryWheelCategoryActive() {
  return false; // wheel drill-down removed
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
  } else if (expand) {
    state.expandedCats = new Set(
      activeCategories().filter(c => state.listActiveCats.has(c.id)).map(c => c.id)
    );
  } else {
    state.expandedCats = new Set();
  }
  renderList();
}

function setMode() {
  const list = document.getElementById('listMode');
  if (list) list.style.display = '';
  localSet('sellHub.mode', 'list');
  syncInventoryToolbar();
}

function syncInventoryToolbar() {
  const inv = document.getElementById('inventory');
  if (!inv) return;
  inv.classList.remove('mode-wheel', 'wheel-overview', 'wheel-category');
  inv.classList.add('mode-list');
  const group = document.getElementById('groupSwitch');
  const sort = document.querySelector('#inventory .sort-control:not(#groupSwitch)');
  const expand = document.querySelector('#inventory .inventory-expand');
  if (group) group.hidden = false;
  if (sort) sort.hidden = false;
  if (expand) expand.hidden = state.listGroup !== 'size';
}

// ---------------------------------------------------------------------
// Inventory — wheel of categories, drilling into one at a time
// ---------------------------------------------------------------------
function renderWheel() { /* wheel view removed */ }
function applyZoom() { /* wheel view removed */ }
function showWheel() { /* wheel view removed */ }
function showCategory() { /* wheel view removed */ }
function platformStatsHTML(item) {
  const platforms = splitPlatforms(item.platform);
  if (!platforms.length) return '';
  const latestByPlatform = latestMetricsByItemPlatform();
  // One line per site — site, price, views, clicks — so a card with three
  // platforms costs three lines rather than six. The "was" price is left to
  // the List price row above; repeating it here is what broke the line.
  const livePrices = new Map(livePricesFor(item).map(r => [r.meta.id, r.price]));
  const fallback = parseMoney(item.listPrice);
  const rows = platforms.map(p => {
    const m = platformMeta(p);
    const price = livePrices.has(m.id) ? moneyText(livePrices.get(m.id)) : fallback ? moneyText(fallback) : '—';
    const snap = latestByPlatform.get(item.itemId + '|' + m.id);
    const views = Number(snap && (snap.views || snap.impressions)) || 0;
    const clicks = Number(snap && snap.clicks) || 0;
    return `
      <div class="ps-row" title="${escapeHtml(`${m.label} — ${price}, ${views} views, ${clicks} clicks`)}">
        <span class="ps-plat" style="background:${m.color}">${escapeHtml(m.label)}</span>
        <span class="ps-line"><b>${escapeHtml(price)}</b><span class="ps-sep">·</span><b>${views}</b><i>views</i><span class="ps-sep">·</span><b>${clicks}</b><i>clicks</i></span>
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
    .map(d => chip(d, 'stl-done', '✓ ' + d.meta.short, sold ? 'Still live on ' + d.meta.label + ' — needs ending' : 'Live on ' + d.meta.label))
    .concat(status.ended.map(e => chip(e, 'stl-skipped', 'Ended · ' + e.meta.short, 'Listing ended on ' + e.meta.label)))
    .concat(sold ? [] : status.missing.map(m => chip(m, 'stl-missing', m.meta.short, 'Still to post on ' + m.meta.label)))
    .concat(sold ? [] : status.skipped.map(s => chip(s, 'stl-skipped', 'Not posting · ' + s.meta.short, 'Not posting on ' + s.meta.label)));
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

// opts.perf=false leaves off the traffic lines (pace verdict, per-site views
// and clicks) - Inventory shows the stock, Performance shows how it's doing.
function itemCardHTML(item, cat, opts) {
  const perf = !opts || opts.perf !== false;
  const sold = isSold(item);
  const expanded = state.expandedItems.has(item.itemId);
  const titleParts = [item.brand, item.item].filter(Boolean);
  const photo = photoForItem(item.itemId);
  const title = titleParts.join(' — ') || item.itemId;
  const focused = !!focusedFor(item.itemId);
  const posted = postedLabel(item.itemId);
  return `
    <div class="card${sold ? ' sold' : ''}" style="--cat:${cat.color}">
      <div class="card-media${photo ? '' : ' photo-pending'}">
        ${photo ? `<img class="card-photo" src="${escapeHtml(photo)}" alt="${escapeHtml(title)}" loading="lazy" onerror="this.closest('.card-media').classList.add('photo-pending');this.remove()">` : ''}
        <span>${photoPendingLabel(item)}</span>
      </div>
      <div class="card-top">
        <label class="pick-box" title="Select this item"><input type="checkbox" data-pick="${escapeHtml(item.itemId)}"${state.picked.has(String(item.itemId)) ? ' checked' : ''}><span></span></label>
        <h3>${escapeHtml(title)}</h3>
        <button type="button" class="focus-btn${focused ? ' on' : ''}" data-focus="${escapeHtml(item.itemId)}" data-on="${focused ? '1' : ''}" title="${focused ? 'In Focused inventory — click to remove' : 'Add to Focused inventory'}" aria-label="${focused ? 'Remove from Focused inventory' : 'Add to Focused inventory'}">${focused ? '◉' : '◎'}</button>
        <span class="status-badge ${statusClass(item.sourceStatus)}">${escapeHtml(item.sourceStatus || '—')}</span>
      </div>
      ${sold || !perf ? '' : paceRowHTML(item)}
      ${actionBadgesHTML(item.itemId)}
      ${localDealBadgesHTML(item.itemId)}
      ${siteStatusChipsHTML(item)}
      <div class="meta">
        ${item.size ? `<span><b>Size —</b> ${escapeHtml(item.size)}</span>` : ''}
        ${item.condition ? `<span><b>Condition —</b> ${escapeHtml(item.condition)}</span>` : ''}
        <span><b>List price —</b> ${priceLineHTML(item)}${item.floorPrice ? ` (floor ${escapeHtml(item.floorPrice)})` : ''}</span>
        ${priceLogHTML(item.itemId)}
        ${posted ? `<span><b>Posted —</b> ${escapeHtml(posted)}</span>` : ''}
        ${sold ? `<span><b>Sold —</b> ${escapeHtml(item.soldPrice || '—')}</span>` : ''}
      </div>
      ${perf ? platformStatsHTML(item) : ''}
      <button class="card-expand-toggle" data-id="${item.itemId}">${expanded ? '− Hide' : '+ Description & mark sold'}</button>
      ${expanded ? itemDetailHTML(item) : ''}
    </div>
  `;
}

// ---------------------------------------------------------------------
// One item card, used everywhere an item is shown as a card. Every view
// gets the same anatomy, so the same fact always sits in the same place,
// in the same size and colour:
//   head  - photo · title · one details line · price column (price, floor)
//   tags  - status, sites, and whatever state the view cares about
//   then  - an optional stat row, an optional callout, the view's own body
//   foot  - small links/buttons
// Views choose which parts to show; none of them lay out an item by hand.
// ---------------------------------------------------------------------
function priceShortFor(item) {
  const live = livePricesFor(item);
  if (!live.length) return item && item.listPrice ? moneyText(parseMoney(item.listPrice)) : '—';
  const prices = live.map(r => r.price);
  const lo = Math.min(...prices), hi = Math.max(...prices);
  return lo === hi ? moneyText(lo) : `${moneyText(lo)}–${moneyText(hi)}`;
}
function priceTitleFor(item) {
  const live = livePricesFor(item);
  return live.length ? live.map(r => `${r.meta.label} ${moneyText(r.price)}`).join(' · ') : 'Not live yet';
}
function itemPriceColHTML(item) {
  const floor = parseMoney(item.floorPrice);
  const sold = isSold(item);
  return `<div class="ic-price" title="${escapeHtml(sold ? 'Sold' : priceTitleFor(item))}">
    <b>${escapeHtml(sold ? (item.soldPrice ? moneyText(parseMoney(item.soldPrice)) : '—') : priceShortFor(item))}</b>
    <small>${sold ? 'sold' : floor ? 'floor ' + escapeHtml(moneyText(floor)) : 'no floor'}</small>
  </div>`;
}
function itemDetailsLine(item) {
  const posted = postedInfoFor(item.itemId);
  return [
    item.size ? 'Size ' + item.size : '',
    item.condition || '',
    isSold(item) ? 'Sold' : posted ? `Posted ${prettyDay(posted.date)} · day ${posted.days}` : 'Not posted yet',
  ].filter(Boolean).map(escapeHtml).join(' · ');
}
function tag(text, cls, title, style) {
  return `<span class="tg ${cls || ''}"${title ? ` title="${escapeHtml(title)}"` : ''}${style ? ` style="${style}"` : ''}>${text}</span>`;
}
function siteTagsHTML(item, which) {
  const st = platformsStatusFor(item);
  const sold = isSold(item);
  const out = [];
  if (which !== 'missing') {
    st.done.forEach(d => out.push(tag(`<i></i>${escapeHtml(d.meta.short || d.meta.label)}`, 'tg-site tg-live', (sold ? 'Still live on ' : 'Live on ') + d.meta.label, `--plat:${d.meta.color}`)));
    st.ended.forEach(e => out.push(tag(escapeHtml(e.meta.short || e.meta.label), 'tg-site tg-ended', 'Ended on ' + e.meta.label, `--plat:${e.meta.color}`)));
  }
  if (!sold && which !== 'live') {
    st.missing.forEach(m => out.push(tag(`${which === 'missing' ? '' : '+ '}${escapeHtml(m.meta.short || m.meta.label)}`, 'tg-site tg-todo', 'Still to post on ' + m.meta.label, `--plat:${m.meta.color}`)));
    if (which !== 'missing') st.skipped.forEach(k => out.push(tag(escapeHtml(k.meta.short || k.meta.label), 'tg-site tg-ended', 'Not posting on ' + k.meta.label, `--plat:${k.meta.color}`)));
  }
  return out.join('');
}
function statusTagHTML(item) {
  const s = String(item.sourceStatus || '—');
  return tag(escapeHtml(s), 'tg-status tg-' + categoryId(s));
}
function expectTagHTML(item) {
  const e = expectedSaleFor(item);
  return tag(`${escapeHtml(EXPECT_PLAIN[e.id] || e.label)} <em>${escapeHtml(e.days.replace('about ', ''))}</em>`, 'tg-expect tg-x-' + e.id, e.label + ' — ' + e.why);
}
function paceTagHTML(item, map) {
  const sp = saleSpeedFor(item, map);
  const gap = performanceGapFor(item, sp, map);
  if (sp.daysListed === null) return '';
  if (sp.band.id === 'newish') return tag('Too new to tell', 'tg-pace tg-new');
  if (gap.behind) return tag('Behind pace', 'tg-pace tg-behind', gap.why);
  if (sp.band.id === 'nodata') return tag('No stats yet', 'tg-pace tg-new');
  return tag('On pace', 'tg-pace tg-onpace', `Day ${sp.daysListed} of ${sp.expected.days}`);
}
// Per-site lines: site · its live price · views · opens · watching.
function itemSiteStatsHTML(item, map) {
  const live = new Map(livePricesFor(item).map(r => [r.meta.id, r.price]));
  const rows = splitPlatforms(item.platform).map(p => {
    const m = platformMeta(p);
    const snap = map.get(item.itemId + '|' + m.id);
    const price = live.has(m.id) ? moneyText(live.get(m.id)) : '—';
    return `<div class="ic-site" style="--plat:${m.color}"><span class="ic-site-name" title="${escapeHtml(m.label)}"><i></i>${escapeHtml(m.short || m.label)}</span><b>${price}</b><span>${snap ? snapshotViews(snap, m.id).toLocaleString() : 0} views</span><span>${snapOpens(snap, m.id)} opens</span><span>${Number(snap && snap.watchers) || 0} watching</span></div>`;
  }).join('');
  return rows ? `<div class="ic-sites">${rows}</div>` : '';
}
// The pace line in words: "On pace · day 20 of about 3-6 weeks".
function paceTextHTML(item) {
  return paceRowHTML(item);
}
function itemStatRowHTML(item, map) {
  const st = itemSortStats(item, map);
  const opens = listingOpensFor(item, map);
  let watching = 0;
  splitPlatforms(item.platform).forEach(p => { const snap = map.get(item.itemId + '|' + platformMeta(p).id); watching += Number(snap && snap.watchers) || 0; });
  const rate = st.views ? Math.round((opens / st.views) * 1000) / 10 : 0;
  const cell = (n, l) => `<span><b>${n}</b><i>${l}</i></span>`;
  return `<div class="ic-stats">${cell(st.views.toLocaleString(), 'views')}${cell(opens.toLocaleString(), 'opens')}${cell(rate + '%', 'open rate')}${cell(watching, 'watching')}</div>`;
}
// opts: tools (pick/focus), meta (html, replaces the details line), tags
// (extra html), sites ('all' | 'missing' | false), expect, pace, stats,
// callout (html), body (html), foot (html), accent (css colour for the left
// edge), cls, attrs, noStatus, alerts (the "!" button, Inventory only).
function itemCard(item, opts) {
  const o = opts || {};
  const map = latestMetricsByItemPlatform();
  const photo = photoForItem(item.itemId);
  const title = itemDisplayName(item, ' — ') || item.itemId;
  const focused = !!focusedFor(item.itemId);
  const tags = [
    o.noStatus ? '' : statusTagHTML(item),
    o.alerts ? alertButtonHTML(item) : '',
    o.pace ? paceTagHTML(item, map) : '',
    o.expect ? expectTagHTML(item) : '',
    o.tags || '',
    o.sites === false ? '' : siteTagsHTML(item, o.sites || 'all'),
  ].join('').trim();
  return `
    <article class="card ic${isSold(item) ? ' sold' : ''} ${o.cls || ''}" style="--accent:${o.accent || categoryMeta(item.category).color}"${o.attrs || ''}>
      <div class="ic-head">
        <div class="ic-side">
          <div class="ic-thumb${photo ? '' : ' empty'}">${photo ? `<img src="${escapeHtml(photo)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('empty');this.remove()">` : `<span>${escapeHtml(photoPendingLabel(item))}</span>`}</div>
          ${o.tools ? `<div class="ic-tools">
            <label class="pick-box" title="Select this item"><input type="checkbox" data-pick="${escapeHtml(item.itemId)}"${state.picked.has(String(item.itemId)) ? ' checked' : ''}><span></span></label>
            <button type="button" class="focus-btn${focused ? ' on' : ''}" data-focus="${escapeHtml(item.itemId)}" data-on="${focused ? '1' : ''}" title="${focused ? 'In Focus — click to remove' : 'Add to Focus'}" aria-label="${focused ? 'Remove from Focus' : 'Add to Focus'}">${focused ? '◉' : '◎'}</button>
          </div>` : ''}
        </div>
        <div class="ic-main">
          <h3 class="ic-title" title="${escapeHtml(title)}">${itemLink(item, escapeHtml(title))}</h3>
          <div class="ic-meta">${o.meta !== undefined ? o.meta : itemDetailsLine(item)}</div>
        </div>
        ${itemPriceColHTML(item)}
      </div>
      ${tags ? `<div class="ic-tags">${tags}</div>` : ''}
      ${o.alerts ? alertPanelHTML(item) : ''}
      ${o.stats ? itemStatRowHTML(item, map) : ''}
      ${o.paceLine ? paceTextHTML(item) : ''}
      ${o.siteStats ? itemSiteStatsHTML(item, map) : ''}
      ${o.callout || ''}
      ${o.body || ''}
      ${o.foot ? `<div class="ic-foot">${o.foot}</div>` : ''}
    </article>`;
}

// Inventory's card: a row, not a poster. Thumbnail on the left, everything
// that describes the item on the right, alerts folded behind "!".
function inventoryCardHTML(item) {
  const expanded = state.expandedItems.has(item.itemId);
  return itemCard(item, {
    tools: true,
    alerts: true,
    foot: `${priceLogHTML(item.itemId)}<button class="card-expand-toggle" data-id="${escapeHtml(item.itemId)}">${expanded ? 'Hide details' : 'Details & mark sold'}</button>`,
    body: localDealBadgesHTML(item.itemId) + (expanded ? itemDetailHTML(item) : ''),
  });
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
  container.querySelectorAll('button[data-focus]').forEach(btn => btn.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    toggleFocus(btn.dataset.focus, !!btn.dataset.on);
  }));
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
  container.querySelectorAll('.alert-btn').forEach(btn => btn.addEventListener('click', ev => {
    ev.preventDefault();
    ev.stopPropagation();
    const id = String(btn.dataset.alert);
    if (state.openAlerts.has(id)) state.openAlerts.delete(id); else state.openAlerts.add(id);
    onChange();
  }));
  container.querySelectorAll('.alert-clear').forEach(btn => btn.addEventListener('click', async ev => {
    ev.preventDefault();
    btn.disabled = true;
    await recordItemAction(btn.dataset.id, 'Posting Note', '');
    onChange();
    renderStillToList();
    renderActionSummary();
  }));
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
  renderFocusView();
  renderStats();
  renderAction();
}

function openRemoveDialog(itemId, opener) {
  const dialog = document.getElementById('removeItemDialog');
  const item = state.inventory.find(i => i.itemId === itemId);
  if (!dialog || !item) return;
  const title = itemDisplayName(item, ' — ') || item.itemId;
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



function routeOverview() {
  const match = location.hash.match(/^#\/category\/(.+)$/);
  /* wheel view removed - the inventory list is the only view */
}
window.addEventListener('hashchange', routeOverview);

// ---------------------------------------------------------------------
// Inventory — List mode (every category, stacked, filterable)
// ---------------------------------------------------------------------
// Category filter - one dropdown with a checkbox per category instead of a
// wall of chips. "All" is remembered as all, so a new category shows up
// without having to tick it.
function catSelectionAll() {
  const cats = activeCategories();
  return cats.length > 0 && cats.every(c => state.listActiveCats.has(c.id));
}
function persistCatSelection() {
  localSet('sellHub.cats', catSelectionAll() ? 'all' : [...state.listActiveCats]);
}
function renderListChips() {
  const btn = document.getElementById('catPickerBtn');
  const menu = document.getElementById('catPickerMenu');
  if (!btn || !menu) return;
  const cats = activeCategories();
  const saved = localGet('sellHub.cats', 'all');
  if (!state.catSelectionLoaded && cats.length) {
    state.listActiveCats = new Set(saved === 'all' || !Array.isArray(saved) ? cats.map(c => c.id) : saved.filter(id => cats.some(c => c.id === id)));
    if (!state.listActiveCats.size) cats.forEach(c => state.listActiveCats.add(c.id));
    state.catSelectionLoaded = true;
  } else if (saved === 'all') {
    cats.forEach(c => state.listActiveCats.add(c.id));
  }
  const picked = cats.filter(c => state.listActiveCats.has(c.id));
  btn.innerHTML = `<span class="cp-lbl">Categories</span><b>${catSelectionAll() ? 'All' : picked.length === 1 ? escapeHtml(picked[0].label) : picked.length + ' selected'}</b><span class="cp-caret">▾</span>`;
  const counts = {};
  state.inventory.forEach(it => { if (state.listShowSold || !isSold(it)) { const id = categoryMeta(it.category).id; counts[id] = (counts[id] || 0) + 1; } });
  menu.innerHTML = `
    <label class="cp-opt cp-all"><input type="checkbox" data-cat="__all"${catSelectionAll() ? ' checked' : ''}><span>All categories</span></label>
    ${cats.map(c => `<label class="cp-opt" style="--dot:${c.color}"><input type="checkbox" data-cat="${escapeHtml(c.id)}"${state.listActiveCats.has(c.id) ? ' checked' : ''}><span class="dot"></span><span>${c.icon} ${escapeHtml(c.label)}</span><i>${counts[c.id] || 0}</i></label>`).join('')}
    <label class="cp-opt cp-sold"><input type="checkbox" id="showSoldList"${state.listShowSold ? ' checked' : ''}><span>Include sold</span></label>`;
  menu.querySelectorAll('input[data-cat]').forEach(box => box.addEventListener('change', () => {
    const id = box.dataset.cat;
    if (id === '__all') {
      state.listActiveCats = new Set(box.checked || !catSelectionAll() ? cats.map(c => c.id) : []);
      if (!box.checked) state.listActiveCats = new Set();
    } else if (box.checked) state.listActiveCats.add(id);
    else state.listActiveCats.delete(id);
    persistCatSelection();
    renderListChips();
    renderList();
  }));
  menu.querySelector('#showSoldList').addEventListener('change', e => {
    state.listShowSold = e.target.checked;
    renderListChips();
    renderList();
  });
}
(function wireCatPicker() {
  const btn = document.getElementById('catPickerBtn');
  const menu = document.getElementById('catPickerMenu');
  if (!btn || !menu) return;
  btn.addEventListener('click', ev => { ev.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute('aria-expanded', String(!menu.hidden)); });
  menu.addEventListener('click', ev => ev.stopPropagation());
  document.addEventListener('click', () => { if (!menu.hidden) { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
})();
document.getElementById('listSortSelect').addEventListener('change', e => {
  state.listSort = e.target.value;
  setMode();
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
  return { views, clicks, ctr: views ? clicks / views : 0, price: askFor(item) };
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
          <div class="inv-grid ic-grid">${sorted.map(it => inventoryCardHTML(it)).join('')}</div>
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
  const total = items.reduce((n, it) => n + askFor(it), 0);
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
        <span class="pick-stats"><b>${fmtMoney(askFor(it))}</b><small>${stats.views} views · ${stats.clicks} clicks</small></span>
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

// ---------------------------------------------------------------------
// Focused inventory — the shortlist you're actively working. Same cards as
// Inventory, so anything you can do there you can do here.
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// Optimize — the page for making a slow listing move. It gathers the two
// groups worth working (past their window, and whatever you've focused),
// offers the levers that actually shift a listing, and keeps the plan you
// chose on the item so next week you can see what you already tried.
// ---------------------------------------------------------------------
const OPTIMIZE_LEVERS = [
  { id: 'offer', label: 'Send an offer', why: 'Convert existing interest before changing the public price.' },
  { id: 'price', label: 'Test a lower price', why: 'Use when traffic is arriving but buyers are not converting.' },
  { id: 'photos', label: 'Reshoot cover photo', why: 'Use when people see the listing but do not open or watch it.' },
  { id: 'title', label: 'Rewrite title', why: 'Use when the listing is not being discovered.' },
  { id: 'share', label: 'Share listing', why: 'Refresh visibility on platforms where sharing moves listings back up.' },
  { id: 'crosslist', label: 'Cross-list', why: 'Put the item in front of a different buyer pool.' },
  { id: 'bundle', label: 'Bundle it', why: 'Make lower-priced inventory more worthwhile to buy and ship.' },
  { id: 'promote', label: 'Promote listing', why: 'Buy reach only when the margin can support it.' },
];
// A lagger is an item you've looked at and decided to leave alone. It stops
// appearing in Optimize without pretending it's doing fine.
function laggerFor(itemId) {
  const on = latestActionOfType(itemId, 'Lagger');
  if (!on) return null;
  const off = latestActionOfType(itemId, 'Unlagger');
  if (off && off.date >= on.date && state.itemActions.indexOf(off) > state.itemActions.indexOf(on)) return null;
  return on;
}
// Tasks are the chosen levers, written out one per line so the Actions page
// can tick them off individually.
function openTasksFor(itemId) {
  const done = new Set(state.itemActions
    .filter(a => String(a.itemId) === String(itemId) && a.action === 'Task Done')
    .map(a => String(a.detail || '').trim()));
  const seen = new Set();
  return state.itemActions
    .filter(a => String(a.itemId) === String(itemId) && a.action === 'Task')
    .map(a => String(a.detail || '').trim())
    .filter(t => t && !done.has(t) && !seen.has(t) && seen.add(t));
}
function allOpenTasks() {
  const out = [];
  state.inventory.filter(it => !isSold(it)).forEach(it => {
    openTasksFor(it.itemId).forEach(t => out.push({ item: it, task: t }));
  });
  return out;
}

function optimizePlanFor(itemId) {
  const latest = latestActionOfType(itemId, 'Optimize Plan');
  return latest ? String(latest.detail || '') : '';
}
function optimizationFor(item, sp, gap) {
  const action = pricingActionFor(item);
  const ask = askFor(item);
  const floor = parseMoney(item.floorPrice);
  const room = Math.max(0, ask - floor);
  let lever = 'crosslist';
  let label = 'Reach a fresh buyer pool';
  let reason = 'The listing is aging without a strong buyer signal. Cross-list it before sacrificing more margin.';
  let tone = 'reach';
  let target = '';
  let confidence = 'Medium confidence';

  if (action && ['handled', 'complete', 'dismissed', 'held'].includes(action.severity)) {
    lever = 'share'; label = action.label; tone = 'steady'; confidence = 'Recently handled';
    target = 'No new move yet';
    reason = action.reason || 'You already acted on this listing. Give that move time to work.';
  } else if (sp.watchers > 0) {
    lever = 'offer'; label = 'Send an offer now'; tone = 'hot'; confidence = 'Strong signal';
    const offer = Math.max(floor || 0, Math.round(ask * .9));
    target = offer && offer < ask ? `${fmtMoney(offer)} offer target` : 'Use your best profitable offer';
    reason = `${sp.watchers} watcher${sp.watchers === 1 ? '' : 's'} already raised a hand. Convert that interest before cutting the public price.`;
  } else if (action && action.label === 'Try a price drop') {
    lever = 'price'; label = 'Run a price test'; tone = 'price-friction'; confidence = 'Strong signal';
    const suggested = action.suggestedPrice || suggestedDropPrice(ask, floor);
    target = suggested ? `Test ${fmtMoney(suggested)} · floor ${fmtMoney(floor)}` : `Protect the ${fmtMoney(floor)} floor`;
    reason = `${sp.views} views with weak buyer action points to price resistance. You have ${fmtMoney(room)} between ask and floor.`;
  } else if (action && action.label === 'Refresh listing') {
    lever = 'photos'; label = 'Refresh the conversion layer'; tone = 'creative';
    target = 'Keep price unchanged';
    reason = `${sp.views} views but no watcher signal. Change the cover photo and first 60 title characters before lowering the price.`;
  } else if (action && action.label === 'Boost visibility') {
    lever = splitPlatforms(item.platform).some(p => platformMeta(p).id === 'poshmark') ? 'share' : 'title';
    label = 'Fix discoverability'; tone = 'reach';
    target = 'Keep price unchanged';
    reason = 'The listing is not earning views. Improve search terms, share it, or cross-list it before touching the price.';
  } else if (sp.overdue) {
    lever = sp.views >= 10 ? 'photos' : 'crosslist';
    label = sp.views >= 10 ? 'Repackage the listing' : 'Find a new audience';
    tone = sp.views >= 10 ? 'creative' : 'reach';
    target = 'Keep price unchanged first';
    reason = `Day ${sp.daysListed || 0} is beyond the expected ${sp.expected.days}. ${sp.views ? `${sp.views} views have not produced a watcher.` : 'It needs more qualified reach.'}`;
  } else if (gap && gap.behind) {
    // Behind its expected pace without tripping a pricing rule - read which
    // part of the funnel is failing: nobody sees it, people see it but don't
    // open it, or they open it and still don't buy.
    const opens = listingOpensFor(item, latestMetricsByItemPlatform());
    confidence = 'Behind pace';
    if (sp.views < 10) {
      lever = 'title'; label = 'Get it seen'; tone = 'reach';
      target = 'Keep price unchanged';
      reason = `Only ${sp.views} view${sp.views === 1 ? '' : 's'} in ${sp.daysListed} days - buyers aren't finding it. Put the words people search (brand, model, size) at the front of the title, then cross-list it.`;
    } else if (opens === 0) {
      lever = 'photos'; label = 'Fix the first impression'; tone = 'creative';
      target = 'Keep price unchanged';
      reason = `${sp.views} people saw it in search and none opened it. The cover photo, title and price shown in results are all they judge - reshoot the lead photo and tighten the title before cutting price.`;
    } else if (room > 0) {
      lever = 'price'; label = 'Test a lower price'; tone = 'price-friction';
      const suggested = suggestedDropPrice(ask, floor);
      target = suggested ? `Test ${fmtMoney(suggested)} · floor ${fmtMoney(floor)}` : `Protect the ${fmtMoney(floor)} floor`;
      reason = `People open it but it isn't moving at the pace this kind of item should. You have ${fmtMoney(room)} of room above your floor.`;
    } else {
      lever = 'crosslist'; label = 'Find a new audience'; tone = 'reach';
      target = 'Already at the floor';
      reason = 'Opened but not selling, and already at its floor - put it in front of a different buyer pool or bundle it.';
    }
  } else if (action && action.label === 'On track') {
    lever = 'share'; label = 'Maintain momentum'; tone = 'steady'; confidence = 'Lower urgency';
    target = 'No price change';
    reason = 'Traffic is healthy enough to wait. Refresh visibility and preserve your margin.';
  }

  return { action, ask, floor, room, lever, label, reason, tone, target, confidence };
}

// One line per listing: what's wrong and the suggested move, readable at a
// glance. The plan (levers, notes, buttons) opens underneath on tap.
function optimizeRowHTML(item, sp, rank, gap) {
  const plan = optimizePlanFor(item.itemId);
  const chosen = new Set(plan.split('|')[0].split(',').map(x => x.trim()).filter(Boolean));
  const notes = plan.includes('|') ? plan.split('|').slice(1).join('|').trim() : '';
  const rec = optimizationFor(item, sp, gap);
  if (!chosen.size) chosen.add(rec.lever);
  const photo = photoForItem(item.itemId);
  const sites = splitPlatforms(item.platform).map(p => platformMeta(p).short || platformMeta(p).label).join(', ') || 'not listed';
  const opens = listingOpensFor(item, latestMetricsByItemPlatform());
  const open = state.openOptRows.has(String(item.itemId)) ? ' open' : '';
  return `
    <details class="opt-row opt-${rec.tone}" data-opt-id="${escapeHtml(item.itemId)}"${open}>
      <summary class="opt-line">
        <span class="opt-rank">${rank}</span>
        <span class="opt-thumb">${photo ? `<img src="${escapeHtml(photo)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>
        <span class="opt-name">
          <b>${itemLink(item, escapeHtml(itemShortName(item)))}</b>
          <small>${gap && gap.why ? escapeHtml(gap.why) : escapeHtml(rec.reason)}</small>
        </span>
        <span class="opt-nums">
          <span><b>${sp.views}</b> views</span>
          <span><b>${opens}</b> opens</span>
          <span><b>${sp.watchers}</b> watch</span>
          <span><b>${sp.daysListed ?? '—'}</b> days</span>
        </span>
        <span class="opt-ask"><b>${fmtMoney(rec.ask)}</b><small>floor ${fmtMoney(rec.floor)}</small></span>
        <span class="opt-move">${escapeHtml(rec.label)}</span>
      </summary>
      <div class="opt-body">
        <div class="opt-rec-line">
          <span class="opt-signal">${escapeHtml(rec.confidence)}</span>
          <p>${escapeHtml(rec.reason)}</p>
          ${rec.target ? `<strong>${escapeHtml(rec.target)}</strong>` : ''}
        </div>
        <div class="opt-meta">${escapeHtml(sites)} · expected ${escapeHtml(expectedSaleFor(item).label.toLowerCase())}, ${escapeHtml(expectedSaleFor(item).days)} · ${sp.clicks} clicks · ${fmtMoney(rec.room)} above floor</div>
        <div class="opt-levers">
          ${OPTIMIZE_LEVERS.map(l => `<button type="button" class="opt-lever${chosen.has(l.id) ? ' on' : ''}" data-lever="${l.id}" title="${escapeHtml(l.why)}">${escapeHtml(l.label)}</button>`).join('')}
        </div>
        <textarea class="opt-notes" rows="1" placeholder="Detail, deadline or offer amount…">${escapeHtml(notes)}</textarea>
        <div class="opt-actions">
          <button type="button" class="btn small opt-tasks">Put plan in Actions</button>
          <button type="button" class="btn secondary small opt-save">Save plan</button>
          <button type="button" class="icon-btn opt-lagger" title="Not performing, and you don't want to do anything about it">Mark as lagger</button>
          <span class="status-msg opt-status"></span>
        </div>
      </div>
    </details>`;
}
// How far a listing is running behind what its kind of item should do.
// Optimize is for the ones falling short - a listing already pulling
// clicks and watchers faster than expected has nothing to fix, however much
// traffic it gets. Measured three ways: past the expected window, a slower
// traffic band than the item type usually earns, or no clicks at all after
// long enough to have had some.
const PACE_BAND_FOR_EXPECTED = { quick: 'fast', steady: 'medium', slow: 'slow', tail: 'slow' };
const GAP_MIN_DAYS = 7;          // younger than this, pace is still noise
const GAP_ZERO_CLICK_DAYS = 10;  // no clicks by now means nobody is choosing it
// eBay's "views" are visits to the listing page - someone chose to open it -
// while its click count from the API stays at 0, so opens = clicks plus eBay
// page visits. Without this an eBay listing with real visitors reads "no clicks".
// eBay reports the same visits twice - page views from Seller Hub and clicks
// from the API - so its opens are the larger of the two, never the sum.
function snapOpens(snap, platformIdValue) {
  if (!snap) return 0;
  const clicks = Number(snap.clicks) || 0;
  return platformIdValue === 'ebay' ? Math.max(clicks, Number(snap.views) || 0) : clicks;
}
function listingOpensFor(item, map) {
  let opens = 0;
  splitPlatforms(item.platform).forEach(p => {
    const m = platformMeta(p);
    const snap = map.get(item.itemId + '|' + m.id);
    opens += snapOpens(snap, m.id);
  });
  return opens;
}
function performanceGapFor(item, sp, latestByPlatform) {
  const day = sp.daysListed;
  const e = sp.expected || expectedSaleFor(item);
  const out = { behind: false, score: 0, why: '' };
  if (day === null || sp.band.id === 'newish') return out;
  const reasons = [];
  let score = 0;
  if (sp.band.id === 'nodata') {
    if (day < GAP_MIN_DAYS) return out;
    reasons.push(`no traffic logged after ${day} days`);
    score += 2;
  } else {
    const expectedBand = SPEED_BANDS[PACE_BAND_FOR_EXPECTED[e.id] || 'medium'];
    const paceGap = sp.band.order - expectedBand.order;
    if (paceGap > 0 && day >= GAP_MIN_DAYS) {
      reasons.push(`traffic reads ${sp.band.label.toLowerCase()} where a ${e.label.toLowerCase()} usually reads ${expectedBand.label.toLowerCase()}`);
      score += paceGap;
    }
    if (day >= GAP_ZERO_CLICK_DAYS && listingOpensFor(item, latestByPlatform || latestMetricsByItemPlatform()) === 0) {
      reasons.push(`${sp.views} view${sp.views === 1 ? '' : 's'} and nobody has opened it`);
      score += 1;
    }
  }
  if (day > e.maxDays) {
    reasons.unshift(`day ${day}, past the ${e.days} it should take`);
    score += 2 + (day - e.maxDays) / e.maxDays;
  }
  if (!reasons.length) return out;
  score += (day / e.maxDays) * 0.5 - Math.min(sp.watchers, 3) * 0.3;
  const why = reasons.join('; ');
  return { behind: true, score, why: why.charAt(0).toUpperCase() + why.slice(1) + '.' };
}
function underperformers(latestByPlatform) {
  const map = latestByPlatform || latestMetricsByItemPlatform();
  return state.inventory
    .filter(it => !isSold(it) && isRealItem(it) && postedInfoFor(it.itemId))
    .map(it => { const sp = saleSpeedFor(it, map); return { it, sp, gap: performanceGapFor(it, sp, map) }; })
    .filter(r => r.gap.behind);
}

// A live count beside a section heading ("Underperforming 19").
function setSectionCount(headingId, n) {
  const head = document.getElementById(headingId);
  if (!head) return;
  let badge = head.querySelector('.sec-count');
  if (!badge) { badge = document.createElement('span'); badge.className = 'sec-count'; head.appendChild(badge); }
  badge.textContent = n;
  badge.classList.toggle('zero', !n);
}

function renderOptimizeTiles() {
  const tiles = document.getElementById('optimizeTiles');
  if (!tiles) return;
  const counts = {};
  let prepared = 0, approved = 0;
  state.inventory.filter(it => !isSold(it)).forEach(it => {
    const a = pricingActionFor(it);
    if (a.hidden) return;
    counts[a.label] = (counts[a.label] || 0) + 1;
    if (a.prepared) { if (a.prepared.approved) approved++; else prepared++; }
  });
  const behind = underperformers().filter(r => !laggerFor(r.it.itemId)).length;
  const out = recentOffers().filter(o => o.days <= 7).length;
  const offerSub = prepared ? `${prepared} ready for your OK` : approved ? `${approved} approved, sending next run` : 'Watchers & likers';
  tiles.innerHTML = [
    { kind: 'offer', num: counts['Send an offer'] || 0, lbl: 'Offers to make', sub: offerSub, target: 'sec-pricing' },
    { kind: 'drop', num: counts['Try a price drop'] || 0, lbl: 'Price drops', sub: 'Traffic, weak clicks', target: 'sec-pricing' },
    { kind: 'reach', num: (counts['Boost visibility'] || 0) + (counts['Refresh listing'] || 0), lbl: 'Need reach', sub: 'Fix before cutting price', target: 'sec-pricing' },
    { kind: 'out', num: out, lbl: 'Offers out', sub: 'Sent in the last 7 days', target: 'sec-offers-out' },
    { kind: 'behind', num: behind, lbl: 'Behind pace', sub: 'Slower than expected', target: 'sec-under' },
  ].map(t => `<button type="button" class="stat-tile opt-tile ${kpiClass(t.kind, t.num)}" data-target="${t.target}">${kpiIcon(t.kind)}<div class="num">${t.num}</div><div class="lbl">${t.lbl}</div><small>${escapeHtml(t.sub)}</small></button>`).join('');
  tiles.querySelectorAll('[data-target]').forEach(tile => tile.addEventListener('click', () => scrollToSection(tile.dataset.target)));
}

// Today at a glance: what was done (offers, price changes, cleared
// suggestions) and where things stand (offers waiting for an OK, listings
// behind pace, and which of those only fell behind today).
function renderOptimizeToday() {
  const box = document.getElementById('optimizeToday');
  if (!box) return;
  const today = todayStr();
  const nameOf = id => { const it = state.inventory.find(x => String(x.itemId) === String(id)); return it ? itemShortName(it) : id; };
  const seen = new Set();
  const todays = state.itemActions.filter(a => String(a.date).slice(0, 10) === today).filter(a => {
    const key = `${a.itemId}|${a.action}|${a.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const offers = todays.filter(a => a.action === 'Offer Sent');
  const drops = todays.filter(a => a.action === 'Price Drop');
  const cleared = todays.filter(a => a.action === 'Completed');
  const waiting = [];
  state.inventory.filter(it => !isSold(it)).forEach(it => {
    const a = pricingActionFor(it);
    if (a.prepared && !a.prepared.approved) waiting.push({ it, p: a.prepared });
  });
  const map = latestMetricsByItemPlatform();
  const behind = underperformers(map).filter(r => !laggerFor(r.it.itemId)).sort((a, b) => b.gap.score - a.gap.score);
  const yMap = latestMetricsByItemPlatform(addDays(today, -1));
  const newlyBehind = behind.filter(r => {
    const spY = saleSpeedFor(r.it, yMap);
    if (spY.daysListed !== null) spY.daysListed = Math.max(0, spY.daysListed - 1);
    return !performanceGapFor(r.it, spY, yMap).behind;
  });
  const dropText = a => { const p = parsePriceDropDetail(a.detail); return p && p.from ? `${fmtMoney(p.from)} → ${fmtMoney(p.to)}` : p ? `now ${fmtMoney(p.to)}` : String(a.detail || ''); };
  const offerText = a => { const m = String(a.detail || '').match(/(eBay|Poshmark|Depop|Mercari|Facebook)[^$]*\$[\d.]+(?:\s*to\s*\$[\d.]+)?/i); return m ? m[0].replace(/\s+-\s+/, ' ') : String(a.detail || '').slice(0, 60); };
  const blip = (cls, name, detail, id) => `<li class="td-blip ${cls}"${id ? ` data-open-item="${escapeHtml(id)}"` : ''}><b>${escapeHtml(name)}</b><span>${escapeHtml(detail)}</span></li>`;
  const col = (title, n, items, empty, ico) => `
    <div class="td-col">
      <div class="td-head">${icon(ico)}<span>${title}</span><i>${n}</i></div>
      ${items.length ? `<ul>${items.join('')}</ul>` : `<p class="td-empty">${empty}</p>`}
    </div>`;
  const behindItems = behind.slice(0, 4).map(r => blip(newlyBehind.includes(r) ? 'new' : '', itemShortName(r.it), newlyBehind.includes(r) ? 'new today' : r.gap.why.split(/[;.]/)[0], r.it.itemId));
  if (behind.length > 4) behindItems.push(`<li class="td-more"><button type="button" class="linkish" data-go="sec-under">+${behind.length - 4} more</button></li>`);
  box.innerHTML = `
    <div class="td-title"><h3>Today</h3><span>${escapeHtml(new Date(today + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }))}</span></div>
    <div class="td-grid">
      ${col('Offers sent', offers.length, offers.map(a => blip('', nameOf(a.itemId), offerText(a), a.itemId)), 'None sent today', 'send')}
      ${col('Prices changed', drops.length, drops.map(a => blip('', nameOf(a.itemId), dropText(a), a.itemId)), 'No price changes', 'down')}
      ${col('Waiting for your OK', waiting.length, waiting.map(w => blip('ok', itemShortName(w.it), w.p.detail.slice(0, 60), w.it.itemId)), 'Nothing to approve', 'note')}
      ${col('Behind pace', behind.length, behindItems, 'Nothing behind', 'alert')}
    </div>
    ${cleared.length ? `<p class="td-cleared">Cleared today: ${cleared.map(a => `<span class="item-link" data-open-item="${escapeHtml(a.itemId)}">${escapeHtml(nameOf(a.itemId))}</span>`).join(', ')}</p>` : ''}`;
  box.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => scrollToSection(b.dataset.go)));
}

// Every offer sent in the last 30 days, newest first, one row per item, with
// what happened since - so you can see whether offers are closing sales.
function recentOffers() {
  const byItem = new Map();
  state.itemActions.forEach(a => {
    if (a.action !== 'Offer Sent') return;
    const date = String(a.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const days = daysSince(date);
    if (days > 30) return;
    const key = String(a.itemId);
    const prev = byItem.get(key);
    byItem.set(key, { itemId: key, date, days, detail: String(a.detail || ''), count: (prev ? prev.count : 0) + 1 });
  });
  return [...byItem.values()]
    .map(o => ({ ...o, item: state.inventory.find(it => String(it.itemId) === o.itemId) }))
    .filter(o => o.item)
    .sort((a, b) => b.date.localeCompare(a.date));
}
function renderOffersOut() {
  const container = document.getElementById('optimizeOffers');
  if (!container) return;
  const rows = recentOffers();
  setSectionCount('sec-offers-out', rows.length);
  if (!rows.length) { container.innerHTML = '<div class="empty-state">No offers sent in the last 30 days.</div>'; return; }
  const map = latestMetricsByItemPlatform();
  container.innerHTML = `
    <table class="offers-table">
      <thead><tr><th>Item</th><th>Sent</th><th>Offer</th><th>Since then</th></tr></thead>
      <tbody>${rows.map(o => {
        const sold = isSold(o.item);
        const sp = sold ? null : saleSpeedFor(o.item, map);
        const outcome = sold
          ? `<span class="oo-sold">Sold${o.item.soldPrice ? ' · ' + escapeHtml(String(o.item.soldPrice)) : ''}</span>`
          : `${sp.watchers} watching now · ${priceTextFor(o.item)} ask${o.days >= 2 ? ' · <span class="oo-stale">offer has lapsed</span>' : ''}`;
        return `<tr class="${sold ? 'oo-row-sold' : ''}">
          <td class="ot-name"><b>${itemLink(o.item, escapeHtml(itemShortName(o.item)))}</b><small>${o.count > 1 ? `${o.count} offers this month` : ''}</small></td>
          <td>${o.days === 0 ? 'today' : o.days === 1 ? 'yesterday' : o.days + 'd ago'}</td>
          <td>${escapeHtml(o.detail.slice(0, 110))}</td>
          <td>${outcome}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>
    <p class="subhead-note">eBay and Poshmark offers expire after 24-48 hours, so an unsold item past two days can take a fresh, lower offer.</p>`;
}

// eBay sold comps for every live eBay listing, from js/comps.js (a manual pull
// of eBay's sold search, last ~90 days). Shows the live eBay price beside the
// sold median so it's clear which listings sit above or below the market.
function renderSoldComps() {
  const container = document.getElementById('optimizeComps');
  if (!container) return;
  const data = window.SOLD_COMPS || { items: {} };
  const byId = new Map(state.inventory.map(it => [String(it.itemId), it]));
  const rows = Object.entries(data.items || {})
    .map(([id, c]) => {
      const item = byId.get(id);
      if (!item || isSold(item)) return null;
      const ebay = livePricesFor(item).find(r => r.meta.id === 'ebay');
      const price = ebay ? ebay.price : askFor(item);
      const gap = c.median && price ? Math.round(100 * (price - c.median) / c.median) : null;
      return { item, c, price, gap };
    })
    .filter(Boolean)
    .sort((a, b) => (b.gap ?? -1e9) - (a.gap ?? -1e9));
  setSectionCount('sec-comps', rows.length);
  if (!rows.length) { container.innerHTML = '<div class="empty-state">No sold comps pulled yet.</div>'; return; }
  const gapText = r => {
    if (r.gap === null) return '<span class="cmp-none">No sold matches</span>';
    if (Math.abs(r.gap) <= 10) return `<span class="cmp-at">At market (${r.gap > 0 ? '+' : ''}${r.gap}%)</span>`;
    return r.gap > 0 ? `<span class="cmp-over">${r.gap}% above</span>` : `<span class="cmp-under">${-r.gap}% below</span>`;
  };
  container.innerHTML = `
    <p class="subhead-note">eBay sold listings from the last ~90 days, pulled ${escapeHtml(data.pulledAt || '')}. Highest above market first. Range is the middle half of sold prices. Thin samples (under 5 sales) are rough.</p>
    <table class="offers-table comps-table">
      <thead><tr><th>Item</th><th>Your price</th><th>Sold median</th><th>Range</th><th>Sold / active</th><th>vs comps</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td class="ot-name"><b>${itemLink(r.item, escapeHtml(itemShortName(r.item)))}</b><small>${escapeHtml(r.c.query || '')}${r.c.note ? ' · ' + escapeHtml(r.c.note) : ''}</small></td>
        <td>${escapeHtml(moneyText(r.price))}</td>
        <td>${r.c.median ? escapeHtml(moneyText(r.c.median)) : '\u2014'}</td>
        <td>${r.c.low ? escapeHtml(moneyText(r.c.low) + '\u2013' + moneyText(r.c.high)) : '\u2014'}</td>
        <td>${r.c.n ?? 0}${r.c.active != null ? ' / ' + r.c.active : ''}</td>
        <td>${gapText(r)}</td>
      </tr>`).join('')}</tbody>
    </table>`;
}

function renderOptimizeView() {
  const container = document.getElementById('optimizeList');
  if (!container) return;
  renderOptimizeTiles();
  renderOffersOut();
  renderSoldComps();
  renderOptimizeToday();
  const latestByPlatform = latestMetricsByItemPlatform();
  const behind = underperformers(latestByPlatform);
  const laggers = behind.filter(r => laggerFor(r.it.itemId));
  const queue = behind.filter(r => !laggerFor(r.it.itemId)).sort((a, b) => b.gap.score - a.gap.score);

  setSectionCount('sec-under', queue.length);
  container.innerHTML = (queue.length ? `
    <p class="subhead-note">Worst first: listings running furthest behind what their kind of item usually does. Anything selling on pace or better stays off this list. Tap a row for the plan.</p>
    <div class="opt-list">${queue.map((r, i) => optimizeRowHTML(r.it, r.sp, i + 1, r.gap)).join('')}</div>` :
      '<div class="empty-state">Nothing is running behind its expected pace right now.</div>')
    + (laggers.length ? `
      <details class="opt-laggers">
        <summary>Marked as laggers <span class="fi-count">${laggers.length}</span></summary>
        <p class="subhead-note">Left alone on purpose. They still show in Inventory and Performance.</p>
        ${laggers.map(r => `<div class="opt-lagger-row"><b>${escapeHtml(itemShortName(r.it))}</b><small>${escapeHtml(String(r.it.listPrice ?? '—'))} · ${r.sp.views} views · ${r.sp.clicks} clicks</small><button type="button" class="btn secondary small opt-unlagger" data-id="${escapeHtml(r.it.itemId)}">Work on it again</button></div>`).join('')}
      </details>` : '');

  container.querySelectorAll('details.opt-row').forEach(row => row.addEventListener('toggle', () => {
    const id = String(row.dataset.optId);
    if (row.open) state.openOptRows.add(id); else state.openOptRows.delete(id);
  }));
  container.querySelectorAll('.opt-unlagger').forEach(btn => btn.addEventListener('click', async () => {
    await recordItemAction(btn.dataset.id, 'Unlagger', 'Back in the optimize list.');
    renderOptimizeView();
  }));

  container.querySelectorAll('.opt-lever').forEach(btn => btn.addEventListener('click', () => {
    btn.classList.toggle('on');
  }));
  container.querySelectorAll('.opt-tasks').forEach(btn => btn.addEventListener('click', async () => {
    const row = btn.closest('.opt-row');
    const id = row.dataset.optId;
    const chosen = [...row.querySelectorAll('.opt-lever.on')];
    const notes = row.querySelector('.opt-notes').value.trim();
    const status = row.querySelector('.opt-status');
    if (!chosen.length) { status.textContent = 'Pick at least one option first.'; status.classList.add('error'); return; }
    status.classList.remove('error');
    status.textContent = 'Adding…';
    try {
      for (const b of chosen) await recordItemAction(id, 'Task', b.textContent.trim());
      await recordItemAction(id, 'Optimize Plan', chosen.map(b => b.dataset.lever).join(', ') + (notes ? ' | ' + notes : ''));
      status.textContent = `${chosen.length} task${chosen.length === 1 ? '' : 's'} added to Actions.`;
      renderAction();
    } catch (err) {
      status.textContent = err.message || String(err);
      status.classList.add('error');
    }
  }));
  container.querySelectorAll('.opt-lagger').forEach(btn => btn.addEventListener('click', async () => {
    const row = btn.closest('.opt-row');
    const id = row.dataset.optId;
    const status = row.querySelector('.opt-status');
    status.textContent = 'Saving…';
    try {
      await recordItemAction(id, 'Lagger', 'Not performing; deliberately leaving it alone for now.');
      renderOptimizeView();
    } catch (err) {
      status.textContent = err.message || String(err);
      status.classList.add('error');
    }
  }));
  container.querySelectorAll('.opt-save').forEach(btn => btn.addEventListener('click', async () => {
    const row = btn.closest('.opt-row');
    const id = row.dataset.optId;
    const chosen = [...row.querySelectorAll('.opt-lever.on')].map(b => b.dataset.lever);
    const notes = row.querySelector('.opt-notes').value.trim();
    const status = row.querySelector('.opt-status');
    status.textContent = 'Saving…';
    try {
      await recordItemAction(id, 'Optimize Plan', chosen.join(', ') + (notes ? ' | ' + notes : ''));
      status.textContent = 'Saved.';
    } catch (err) {
      status.textContent = err.message || String(err);
      status.classList.add('error');
    }
  }));
}

// ---------------------------------------------------------------------
// Performance - every live listing's numbers in one place: traffic, its
// trend over the last week, pace against what that kind of item usually
// takes, and the status of whatever has been done about it. Inventory is
// just the stock; this is how the stock is doing.
// ---------------------------------------------------------------------
const PERF_TREND_DAYS = 7;
function perfPastDate() {
  const d = new Date(todayStr() + 'T12:00:00');
  d.setDate(d.getDate() - PERF_TREND_DAYS);
  return d.toISOString().slice(0, 10);
}
function itemTrafficFrom(item, map) {
  let views = 0, clicks = 0, watchers = 0;
  splitPlatforms(item.platform).forEach(p => {
    const m = platformMeta(p);
    const snap = map.get(item.itemId + '|' + m.id);
    views += snapshotViews(snap, m.id);
    clicks += Number(snap && snap.clicks) || 0;
    watchers += Number(snap && snap.watchers) || 0;
  });
  return { views, clicks, watchers };
}
function perfRows() {
  const now = latestMetricsByItemPlatform();
  const past = latestMetricsByItemPlatform(perfPastDate());
  return state.inventory
    .filter(it => !isSold(it) && isRealItem(it) && (postedInfoFor(it.itemId) || String(it.sourceStatus || '').toLowerCase() === 'listed'))
    .map(it => {
      const cur = itemTrafficFrom(it, now);
      const was = itemTrafficFrom(it, past);
      const sp = saleSpeedFor(it, now);
      const stats = itemSortStats(it, now);
      return {
        it, sp, stats, gap: performanceGapFor(it, sp, now), opens: listingOpensFor(it, now),
        trend: { views: Math.max(0, cur.views - was.views), clicks: Math.max(0, cur.clicks - was.clicks), watchers: cur.watchers - was.watchers },
        now: cur, was,
      };
    });
}
function paceVerdict(r) {
  if (r.sp.daysListed === null) return { id: 'none', label: 'Not posted', order: 5 };
  if (r.sp.band.id === 'newish') return { id: 'new', label: 'Too new to tell', order: 3 };
  if (r.gap.behind) return { id: 'behind', label: 'Behind pace', order: 1 };
  if (r.sp.band.id === 'nodata') return { id: 'none', label: 'No stats yet', order: 4 };
  return { id: 'onpace', label: 'On pace or better', order: 2 };
}
function perfCompare(a, b) {
  const k = state.perfSort;
  if (k === 'clicks') return b.opens - a.opens;
  if (k === 'ctr') return (b.stats.views ? b.opens / b.stats.views : 0) - (a.stats.views ? a.opens / a.stats.views : 0);
  if (k === 'trend') return b.trend.views - a.trend.views || b.trend.clicks - a.trend.clicks;
  if (k === 'price') return b.stats.price - a.stats.price;
  return b.stats.views - a.stats.views;
}
function signed(n) { return (n > 0 ? '+' : '') + Number(n).toLocaleString(); }
function perfRowHTML(r, rank) {
  const id = String(r.it.itemId);
  const open = state.expandedPerf.has(id) ? ' open' : '';
  const ctr = r.stats.views ? Math.round((r.opens / r.stats.views) * 100) : 0;
  const v = paceVerdict(r);
  const action = pricingActionFor(r.it);
  return `
    <details class="ranked-row perf-row" data-perf-id="${escapeHtml(id)}"${open}>
      <summary class="ranked-row-head">
        <span class="rr-rank">${rank}</span>
        <span class="ranked-row-title">${itemLink(r.it, escapeHtml(itemShortName(r.it)))}<small class="perf-sub"><span class="perf-verdict perf-${v.id}">${escapeHtml(v.label)}</span>${r.sp.daysListed !== null ? ` · day ${r.sp.daysListed}` : ''} · ${escapeHtml(EXPECT_PLAIN[r.sp.expected.id] || r.sp.expected.label)} ${escapeHtml(r.sp.expected.days)}${action && !action.hidden ? ` · ${escapeHtml(action.label)}` : ''}</small></span>
        <span class="rr-quick perf-quick">
          <i>${r.stats.views} views</i>
          <i>${r.opens} open${r.opens === 1 ? '' : 's'} · ${ctr}%</i>
          <i>${r.now.watchers} watching</i>
          <i class="perf-trend${r.trend.views || r.trend.clicks ? ' up' : ''}" title="Change over the last ${PERF_TREND_DAYS} days">${signed(r.trend.views)} views · ${signed(r.trend.clicks)} clicks /wk</i>
        </span>
        ${itemPriceColHTML(r.it)}
      </summary>
      <div class="ranked-detail">
        ${action && action.severity === 'complete' ? `<div class="perf-status-line"><span>${escapeHtml(action.reason || 'Completed')}</span><button type="button" class="icon-btn perf-reopen" data-id="${escapeHtml(id)}" data-label="${escapeHtml(action.label)}">Reopen</button></div>` : ''}
        ${priceHoldFor(r.it.itemId) ? `<div class="perf-status-line"><span>Price on hold${priceHoldFor(r.it.itemId).detail ? ': ' + escapeHtml(priceHoldFor(r.it.itemId).detail) : ''}</span><button type="button" class="icon-btn perf-release" data-id="${escapeHtml(id)}">Release hold</button></div>` : ''}
        ${r.gap.why ? `<div class="opt-gap">${escapeHtml(r.gap.why)}</div>` : ''}
        ${paceRowHTML(r.it)}
        ${rankedDetailHTML(r.it)}
      </div>
    </details>`;
}
function perfGroupHTML(title, rows, extra, cls, defaultClosed) {
  const sorted = rows.slice().sort(perfCompare);
  const key = 'perfgrp:' + title;
  const open = (key in state.perfGroupOpen ? state.perfGroupOpen[key] : !defaultClosed) ? ' open' : '';
  return `
    <details class="cat-section perf-group ${cls || ''}" data-perf-group="${escapeHtml(key)}"${open}>
      <summary class="cat-heading"><h2>${escapeHtml(title)}</h2><span class="count">${rows.length}</span>${extra || ''}</summary>
      <div class="ranked-list">${sorted.map((r, i) => perfRowHTML(r, i + 1)).join('') || '<div class="empty-state">Nothing here.</div>'}</div>
    </details>`;
}
// The header bar already shows totals, so these tiles answer different
// questions: how many listings are keeping pace, and what moved this week.
function renderPerformanceTiles(rows) {
  const tiles = document.getElementById('performanceTiles');
  if (!tiles) return;
  const sum = (f) => rows.reduce((n, r) => n + f(r), 0);
  const behind = rows.filter(r => r.gap.behind).length;
  const onPace = rows.filter(r => paceVerdict(r).id === 'onpace').length;
  const map = latestMetricsByItemPlatform();
  const past = latestMetricsByItemPlatform(perfPastDate());
  const opensNow = sum(r => listingOpensFor(r.it, map));
  const opensWas = sum(r => listingOpensFor(r.it, past));
  const movers = rows.filter(r => r.trend.views || r.trend.clicks).length;
  tiles.innerHTML = `
    <div class="stat-tile kpi kpi-pace">${kpiIcon('pace')}<div class="num">${onPace}<small class="of"> / ${rows.length}</small></div><div class="lbl">On pace or better</div><small>${behind} behind · ${rows.length - onPace - behind} too new or no stats</small></div>
    <div class="stat-tile kpi kpi-views">${kpiIcon('views')}<div class="num">${signed(sum(r => r.trend.views))}</div><div class="lbl">Views this week</div><small>${movers} listings gained traffic</small></div>
    <div class="stat-tile kpi kpi-clicks">${kpiIcon('clicks')}<div class="num">${signed(Math.max(0, opensNow - opensWas))}</div><div class="lbl">Opens this week</div><small>${opensNow.toLocaleString()} opens in total</small></div>
    <div class="stat-tile kpi kpi-watchers">${kpiIcon('watchers')}<div class="num">${signed(sum(r => r.trend.watchers))}</div><div class="lbl">Watchers this week</div><small>${sum(r => r.now.watchers)} watching now</small></div>`;
}
function renderPerformanceView() {
  const container = document.getElementById('performanceList');
  if (!container) return;
  const view = state.perfView;
  const viewSelect = document.getElementById('perfViewSelect');
  if (viewSelect && viewSelect.value !== view) viewSelect.value = view;
  const completedWrap = document.getElementById('perfCompletedWrap');
  if (completedWrap) completedWrap.hidden = view !== 'status';
  const sortWrap = document.getElementById('perfSortWrap');
  if (sortWrap) sortWrap.hidden = view === 'status' || view === 'offers';
  const rows = perfRows();
  renderPerformanceTiles(rows);
  renderPlatformCards();

  if (view === 'status') {
    const groups = new Map();
    rows.forEach(r => {
      const action = pricingActionFor(r.it);
      if (action.hidden) return;
      if (!state.showCompletedActions && action.severity === 'complete') return;
      const key = pricingGroupKeyFor(action);
      const gkey = MOVE_GROUP_KEYS.includes(key) ? '__moves' : key;
      if (!groups.has(gkey)) groups.set(gkey, []);
      groups.get(gkey).push(r);
    });
    const order = ['__moves', ...STATUS_GROUP_KEYS];
    const titleFor = k => k === '__moves' ? 'Needs a move' : (PRICING_GROUPS.find(g => g.key === k) || {}).title || k;
    container.innerHTML = order.filter(k => groups.has(k)).map(k => perfGroupHTML(titleFor(k), groups.get(k),
      k === '__moves' ? '<button type="button" class="linkish perf-go-opt">open Optimize →</button>' : '', 'status-' + categoryId(k), k !== '__moves')).join('')
      || '<div class="empty-state">No live listings yet.</div>';
    container.querySelector('.perf-go-opt')?.addEventListener('click', ev => { ev.preventDefault(); showView('optimize'); });
  } else if (view === 'offers') {
    const offerRows = state.inventory
      .filter(it => !isSold(it))
      .map(it => ({ it, offer: latestActionOfType(it.itemId, 'Offer Sent'), stats: itemSortStats(it, latestMetricsByItemPlatform()) }))
      .filter(r => r.offer)
      .sort((a, b) => String(b.offer.date).localeCompare(String(a.offer.date)));
    container.innerHTML = offerRows.length ? `
      <table class="offers-table">
        <thead><tr><th>Item</th><th>Last offer</th><th>Where</th><th>Traffic now</th></tr></thead>
        <tbody>${offerRows.map(({ it, offer, stats }) => {
          const days = daysSince(String(offer.date).slice(0, 10));
          return `<tr>
            <td class="ot-name"><b>${escapeHtml(itemShortName(it))}</b><small>${escapeHtml(String(it.listPrice ?? '—'))}</small></td>
            <td>${escapeHtml(String(offer.date))}<small class="ot-age">${days === 0 ? 'today' : days + 'd ago'}</small></td>
            <td>${escapeHtml(String(offer.detail || '—').slice(0, 90))}</td>
            <td>${stats.views} views · ${stats.clicks} clicks</td>
          </tr>`;
        }).join('')}</tbody>
      </table>` : '<div class="empty-state">No offers sent yet.</div>';
    return;
  } else if (view === 'ranked') {
    const labels = { views: 'Most views', clicks: 'Most opens', ctr: 'Highest open rate', trend: 'Most views this week', price: 'Highest price' };
    container.innerHTML = perfGroupHTML(labels[state.perfSort] || 'Ranking', rows);
  } else if (view === 'speed') {
    const groups = new Map();
    rows.forEach(r => {
      if (!groups.has(r.sp.band.id)) groups.set(r.sp.band.id, { band: r.sp.band, rows: [] });
      groups.get(r.sp.band.id).rows.push(r);
    });
    container.innerHTML = [...groups.values()].sort((a, b) => a.band.order - b.band.order).map(g => {
      const over = g.rows.filter(r => r.sp.overdue).length;
      return perfGroupHTML(g.band.label, g.rows,
        `<span class="speed-range">pace suggests ${escapeHtml(g.band.days)}</span>${over ? `<span class="speed-over-count">${over} past expected</span>` : ''}`,
        'speed-' + g.band.id);
    }).join('') || '<div class="empty-state">No live listings yet.</div>';
  } else {
    const groups = new Map();
    rows.forEach(r => {
      const v = paceVerdict(r);
      if (!groups.has(v.id)) groups.set(v.id, { v, rows: [] });
      groups.get(v.id).rows.push(r);
    });
    container.innerHTML = [...groups.values()].sort((a, b) => a.v.order - b.v.order)
      .map(g => perfGroupHTML(g.v.label, g.rows, '', 'pace-' + g.v.id)).join('') || '<div class="empty-state">No live listings yet.</div>';
  }
  container.querySelectorAll('details.perf-row').forEach(row => row.addEventListener('toggle', () => {
    const id = row.dataset.perfId;
    if (row.open) state.expandedPerf.add(id); else state.expandedPerf.delete(id);
  }));
  container.querySelectorAll('details.perf-group').forEach(g => g.addEventListener('toggle', () => {
    state.perfGroupOpen[g.dataset.perfGroup] = g.open;
  }));
  container.querySelectorAll('.perf-reopen').forEach(b => b.addEventListener('click', () => toggleActionComplete(b.dataset.id, true, b.dataset.label)));
  container.querySelectorAll('.perf-release').forEach(b => b.addEventListener('click', () => togglePriceHold(b.dataset.id, true, b)));
  wireItemCards(container, renderPerformanceView);
}
document.getElementById('perfViewSelect')?.addEventListener('change', e => {
  state.perfView = e.target.value;
  localSet('sellHub.perfView', state.perfView);
  renderPerformanceView();
});
document.getElementById('perfSortSelect')?.addEventListener('change', e => {
  state.perfSort = e.target.value;
  localSet('sellHub.perfSort', state.perfSort);
  renderPerformanceView();
});

// ---------------------------------------------------------------------
// Item panel - everything known about one item, keyed by its item id and
// built from what is already logged: live prices and stats per site from
// Metrics, and every offer, price change, note and decision from Item
// Actions. Anything with data-open-item="<id>" opens it, so the Today
// digest, Optimize, Performance and Inventory all link to the same record
// instead of restating it.
// ---------------------------------------------------------------------
const ACTIVITY_META = {
  'Offer Sent': { icon: 'send', kind: 'offer', label: 'Offer sent' },
  'Offer Prepared': { icon: 'note', kind: 'prep', label: 'Offer prepared' },
  'Offer Approved': { icon: 'check', kind: 'pace', label: 'Offer approved' },
  'Price Drop': { icon: 'down', kind: 'drop', label: 'Price drop' },
  'Price Edit': { icon: 'dollar', kind: 'value', label: 'Price change' },
  'Completed': { icon: 'check', kind: 'pace', label: 'Cleared' },
  'Reopened': { icon: 'activity', kind: 'week', label: 'Reopened' },
  'Posting Note': { icon: 'note', kind: 'prep', label: 'Note' },
  'Listing Posted': { icon: 'upload', kind: 'list', label: 'Listed' },
  'Draft Created': { icon: 'upload', kind: 'tasks', label: 'Draft made' },
  'Not Posting': { icon: 'xcircle', kind: 'tasks', label: 'Not posting' },
  'Listing Ended': { icon: 'xcircle', kind: 'end', label: 'Listing ended' },
  'Price Hold': { icon: 'clock', kind: 'tasks', label: 'Price held' },
  'Price Released': { icon: 'clock', kind: 'tasks', label: 'Hold released' },
  'Ignored': { icon: 'xcircle', kind: 'tasks', label: 'Dismissed' },
  'Task': { icon: 'tasks', kind: 'tasks', label: 'Task' },
  'Task Done': { icon: 'check', kind: 'tasks', label: 'Task done' },
  'Focus': { icon: 'target', kind: 'focus', label: 'Focused' },
  'Lagger': { icon: 'alert', kind: 'behind', label: 'Marked lagger' },
};
function itemHistorySeries(item) {
  // One cumulative views/opens point per day, carrying each site's last
  // known numbers forward so a site skipped one day doesn't dip the line.
  const byPlat = new Map();
  state.metrics.forEach(m => {
    if (String(m.itemId) !== String(item.itemId)) return;
    const d = String(m.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    const pid = platformMeta(m.platform).id;
    if (!byPlat.has(pid)) byPlat.set(pid, new Map());
    const day = byPlat.get(pid).get(d) || {};
    METRIC_FIELDS.forEach(f => { const v = Number(m[f]) || 0; if (v) day[f] = v; });
    byPlat.get(pid).set(d, day);
  });
  const dates = [...new Set([...byPlat.values()].flatMap(mp => [...mp.keys()]))].sort().slice(-14);
  const last = new Map();
  return dates.map(d => {
    let views = 0, opens = 0, watchers = 0;
    byPlat.forEach((mp, pid) => {
      if (mp.has(d)) last.set(pid, mp.get(d));
      const snap = last.get(pid);
      if (!snap) return;
      views += snapshotViews(snap, pid);
      opens += snapOpens(snap, pid);
      watchers += snap.watchers || 0;
    });
    return { d, views, opens, watchers };
  });
}
function sparkHTML(series, key, label) {
  if (series.length < 2) return '';
  const w = 220, h = 44, vals = series.map(p => p[key]);
  const max = Math.max(1, ...vals), min = Math.min(...vals);
  const x = i => (i / (series.length - 1)) * (w - 8) + 4;
  const y = v => h - 6 - ((v - min) / Math.max(1, max - min)) * (h - 14);
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const change = vals[vals.length - 1] - vals[0];
  return `<div class="dr-spark kpi-${key === 'views' ? 'views' : key === 'opens' ? 'clicks' : 'watchers'}">
    <div class="dr-spark-head"><span>${label}</span><b>${vals[vals.length - 1].toLocaleString()}</b><i>${change >= 0 ? '+' : ''}${change.toLocaleString()} since ${escapeHtml(prettyDay(series[0].d))}</i></div>
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${x(vals.length - 1).toFixed(1)}" cy="${y(vals[vals.length - 1]).toFixed(1)}" r="3" fill="currentColor"/></svg>
  </div>`;
}
function itemDrawerHTML(item) {
  const photo = photoForItem(item.itemId);
  const map = latestMetricsByItemPlatform();
  const sold = isSold(item);
  const sp = sold ? null : saleSpeedFor(item, map);
  const gap = sp ? performanceGapFor(item, sp, map) : null;
  const action = sold ? null : pricingActionFor(item);
  const live = livePricesFor(item);
  const status = platformsStatusFor(item);
  const facts = [categoryMeta(item.category).label, item.size ? 'Size ' + item.size : '', item.condition, item.itemId].filter(Boolean).map(escapeHtml).join(' · ');
  const siteRows = status.done.concat(status.ended).map(d => {
    const snap = map.get(item.itemId + '|' + d.meta.id);
    const price = live.find(r => r.meta.id === d.meta.id);
    const opens = snapOpens(snap, d.meta.id);
    return `<tr style="--plat:${d.meta.color}">
      <td><span class="pt-site"><i></i>${escapeHtml(d.meta.label)}</span>${status.ended.includes(d) ? ' <small>ended</small>' : ''}</td>
      <td>${price ? moneyText(price.price) : '—'}</td>
      <td>${snap ? (Number(snap.impressions) || 0).toLocaleString() : '—'}</td>
      <td>${snap ? snapshotViews(snap, d.meta.id).toLocaleString() : '—'}</td>
      <td>${snap ? opens : '—'}</td>
      <td>${snap ? Number(snap.watchers) || 0 : '—'}</td>
      <td class="dr-asof">${snap ? escapeHtml(prettyDay(String(snap.date).slice(0, 10))) : ''}</td>
    </tr>`;
  }).join('');
  const seen = new Set();
  const activity = state.itemActions
    .filter(a => String(a.itemId) === String(item.itemId))
    .filter(a => { const k = `${a.date}|${a.action}|${a.detail}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .reverse();
  const series = itemHistorySeries(item);
  const floor = parseMoney(item.floorPrice);
  const sale = expectedSaleFor(item);
  return `
    <header class="dr-head">
      <div class="dr-thumb">${photo ? `<img src="${escapeHtml(photo)}" alt="" onerror="this.remove()">` : ''}</div>
      <div class="dr-title">
        <h2>${escapeHtml(itemDisplayName(item, ' — '))}</h2>
        <p>${facts}</p>
        <div class="dr-badges"><span class="status-badge ${statusClass(item.sourceStatus)}">${escapeHtml(item.sourceStatus || '—')}</span>${action && !action.hidden ? `<span class="dr-pill">${escapeHtml(action.label)}</span>` : ''}${gap && gap.behind ? '<span class="dr-pill bad">Behind pace</span>' : ''}</div>
      </div>
      <button type="button" class="dr-close" aria-label="Close">×</button>
    </header>
    <section class="dr-prices">
      <div class="dr-price-main"><span>Price</span><b>${sold ? escapeHtml(String(item.soldPrice || '—')) : priceTextFor(item)}</b>${sold ? '<i>sold</i>' : ''}</div>
      <div><span>Floor</span><b>${floor ? moneyText(floor) : '—'}</b></div>
      ${sold ? '' : `<div><span>Room</span><b>${floor && askFor(item) ? moneyText(Math.max(0, askFor(item) - floor)) : '—'}</b></div>
      <div><span>Expected</span><b>${escapeHtml(EXPECT_PLAIN[sale.id] || sale.label)}</b><i>${escapeHtml(sale.days)}</i></div>
      <div><span>Listed</span><b>${sp && sp.daysListed !== null ? 'day ' + sp.daysListed : '—'}</b></div>`}
    </section>
    ${gap && gap.why ? `<div class="opt-gap dr-gap">${escapeHtml(gap.why)}</div>` : ''}
    ${siteRows ? `<section class="dr-sec"><h3>${icon('layers')} By site</h3><table class="plat-table dr-table"><thead><tr><th>Site</th><th>Price</th><th>Impr.</th><th>Views</th><th>Opens</th><th>Watch</th><th>As of</th></tr></thead><tbody>${siteRows}</tbody></table></section>` : ''}
    ${series.length > 1 ? `<section class="dr-sec"><h3>${icon('activity')} Last ${series.length} pulls</h3><div class="dr-sparks">${sparkHTML(series, 'views', 'Views')}${sparkHTML(series, 'opens', 'Opens')}${sparkHTML(series, 'watchers', 'Watching')}</div></section>` : ''}
    <section class="dr-sec"><h3>${icon('clock')} Activity</h3>
      ${activity.length ? `<ol class="dr-timeline">${activity.map(a => {
        const m = ACTIVITY_META[a.action] || { icon: 'note', kind: 'tasks', label: a.action };
        return `<li class="kpi-${m.kind}"><span class="dr-dot">${icon(m.icon)}</span><div><div class="dr-ev"><b>${escapeHtml(m.label)}</b><time>${escapeHtml(prettyDay(String(a.date).slice(0, 10)))}</time></div>${a.detail ? `<p>${escapeHtml(String(a.detail))}</p>` : ''}</div></li>`;
      }).join('')}</ol>` : '<p class="td-empty">Nothing logged for this item yet.</p>'}
    </section>`;
}
function openItemDrawer(itemId) {
  const item = state.inventory.find(it => String(it.itemId) === String(itemId));
  if (!item) return;
  let back = document.getElementById('itemDrawerBack');
  if (!back) {
    back = document.createElement('div');
    back.id = 'itemDrawerBack';
    back.className = 'drawer-back';
    back.innerHTML = '<aside class="drawer" role="dialog" aria-modal="true" aria-label="Item details"></aside>';
    document.body.appendChild(back);
    back.addEventListener('click', ev => { if (ev.target === back || ev.target.closest('.dr-close')) closeItemDrawer(); });
    document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !back.hidden) closeItemDrawer(); });
  }
  const panel = back.querySelector('.drawer');
  panel.innerHTML = itemDrawerHTML(item);
  panel.scrollTop = 0;
  back.hidden = false;
  document.body.classList.add('drawer-open');
  setTimeout(() => back.classList.add('in'), 10);
  panel.querySelector('.dr-close')?.focus();
}
function closeItemDrawer() {
  const back = document.getElementById('itemDrawerBack');
  if (!back) return;
  back.classList.remove('in');
  document.body.classList.remove('drawer-open');
  setTimeout(() => { back.hidden = true; }, 180);
}
// Delegated, so any link rendered anywhere later works without wiring. It
// also stops a name inside a <summary> from toggling the row open.
document.addEventListener('click', ev => {
  const link = ev.target.closest('[data-open-item]');
  if (!link) return;
  ev.preventDefault();
  ev.stopPropagation();
  openItemDrawer(link.dataset.openItem);
}, true);
document.addEventListener('keydown', ev => {
  if (ev.key !== 'Enter') return;
  const link = ev.target.closest && ev.target.closest('[data-open-item]');
  if (link) { ev.preventDefault(); openItemDrawer(link.dataset.openItem); }
});
function itemLink(item, text) {
  return `<span class="item-link" data-open-item="${escapeHtml(item.itemId)}" role="link" tabindex="0">${text}</span>`;
}

// Scrolls to a heading anywhere in the page, opening every collapsed section
// around it first - a heading inside a closed <details> has no position.
function scrollToSection(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const view = el.closest('.view');
  if (view && !view.classList.contains('active')) showView(view.id);
  let d = el.tagName === 'DETAILS' ? el : el.closest('details');
  while (d) { d.open = true; d = d.parentElement && d.parentElement.closest('details'); }
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderFocusView() {
  const container = document.getElementById('focusList');
  if (!container) return;
  const items = focusedItems();
  const latestByPlatform = latestMetricsByItemPlatform();
  const count = document.getElementById('focusCount');
  if (count) count.textContent = String(items.length);

  const tiles = document.getElementById('focusTiles');
  if (tiles) {
    const stats = items.map(it => itemSortStats(it, latestByPlatform));
    const views = stats.reduce((n, x) => n + x.views, 0);
    const clicks = stats.reduce((n, x) => n + x.clicks, 0);
    const value = items.reduce((n, it) => n + askFor(it), 0);
    const tasks = items.reduce((n, it) => n + itemTasks(it).total, 0);
    tiles.innerHTML = items.length ? `
      <div class="stat-tile kpi kpi-focus">${kpiIcon('focus')}<div class="num">${items.length}</div><div class="lbl">Focused</div></div>
      <div class="stat-tile kpi kpi-value">${kpiIcon('value')}<div class="num">${fmtMoney(value)}</div><div class="lbl">Asking</div></div>
      <div class="stat-tile kpi kpi-views">${kpiIcon('views')}<div class="num">${views.toLocaleString()}</div><div class="lbl">Views</div></div>
      <div class="stat-tile kpi kpi-clicks">${kpiIcon('clicks')}<div class="num">${clicks.toLocaleString()}</div><div class="lbl">Clicks</div></div>
      <div class="stat-tile kpi kpi-tasks">${kpiIcon('tasks')}<div class="num">${tasks}</div><div class="lbl">Open tasks</div></div>` : '';
  }

  // Worth a look: getting clicked but not focused yet.
  const suggestBox = document.getElementById('focusSuggest');
  if (suggestBox) {
    const candidates = state.inventory
      .filter(it => !isSold(it) && !focusedFor(it.itemId))
      .map(it => ({ it, stats: itemSortStats(it, latestByPlatform) }))
      .filter(r => r.stats.clicks > 0)
      .sort((a, b) => b.stats.clicks - a.stats.clicks)
      .slice(0, 5);
    suggestBox.innerHTML = candidates.length ? `
      <span class="fi-suggest-label">Getting interest — add to focus?</span>
      ${candidates.map(({ it, stats }) => `
        <button type="button" class="fi-suggest-chip" data-focus-add="${escapeHtml(it.itemId)}">
          ${escapeHtml(itemShortName(it))} <small>${stats.clicks} clicks</small>
        </button>`).join('')}` : '';
    suggestBox.querySelectorAll('[data-focus-add]').forEach(btn => btn.addEventListener('click', () => {
      toggleFocus(btn.dataset.focusAdd, false);
    }));
  }

  if (!items.length) {
    container.innerHTML = `<div class="empty-state">Nothing focused yet. Tap ◎ on any inventory card to put it here — it stays in Inventory too.</div>`;
    return;
  }
  const ranked = items
    .map(it => ({ it, stats: itemSortStats(it, latestByPlatform) }))
    .sort((a, b) => b.stats.clicks - a.stats.clicks || b.stats.views - a.stats.views);
  container.innerHTML = `<div class="ic-grid">${ranked.map(({ it }) => {
    const expanded = state.expandedItems.has(it.itemId);
    return itemCard(it, {
      tools: true, stats: true, paceLine: true, siteStats: true,
      callout: actionBadgesHTML(it.itemId),
      body: localDealBadgesHTML(it.itemId) + (expanded ? itemDetailHTML(it) : ''),
      foot: `${priceLogHTML(it.itemId)}<button class="card-expand-toggle" data-id="${escapeHtml(it.itemId)}">${expanded ? 'Hide details' : 'Details & mark sold'}</button>`,
    });
  }).join('')}</div>`;
  wireItemCards(container, renderFocusView);
}

// ---------------------------------------------------------------------
// Inventory compilations — pick any items, posted or not, and see them as one
// list with the totals that matter: asking price, views, and what's still owed.
// ---------------------------------------------------------------------
function setInventoryMode(mode) {
  state.inventoryMode = mode === 'compile' ? 'compile' : 'browse';
  localSet('sellHub.inventoryMode', state.inventoryMode);
  const browse = document.getElementById('inventoryBrowse');
  const compile = document.getElementById('inventoryCompile');
  if (browse) browse.hidden = state.inventoryMode === 'compile';
  if (compile) compile.hidden = state.inventoryMode !== 'compile';
  const btn = document.getElementById('compileOpenBtn');
  if (btn) btn.textContent = state.inventoryMode === 'compile' ? '← Back to inventory' : 'Compilations';
  if (state.inventoryMode === 'compile') renderCompilation();
}

function compilationPickerHTML(query) {
  const q = String(query || '').trim().toLowerCase();
  const items = state.inventory
    .filter(it => !isSold(it) || state.picked.has(String(it.itemId)))
    .filter(it => !q || `${it.brand || ''} ${it.item || ''} ${it.itemId} ${it.size || ''}`.toLowerCase().includes(q))
    .sort((a, b) => (a.item || a.brand || '').localeCompare(b.item || b.brand || ''));
  if (!items.length) return '<p class="muted">Nothing matches that.</p>';
  return items.map(it => {
    const on = state.picked.has(String(it.itemId));
    const status = platformsStatusFor(it);
    const where = status.done.length
      ? status.done.map(d => d.meta.label).join(', ')
      : (status.missing.length ? `to post: ${status.missing.map(m => m.meta.label).join(', ')}` : 'not listed');
    const photo = photoForItem(it.itemId);
    return `
      <label class="cp-pick${on ? ' on' : ''}">
        <input type="checkbox" data-compile-pick="${escapeHtml(it.itemId)}"${on ? ' checked' : ''}>
        <span class="cp-thumb">${photo ? `<img src="${escapeHtml(photo)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>
        <span class="cp-pick-main">${escapeHtml(itemShortName(it))}<small>${escapeHtml(where)}</small></span>
        <span class="cp-pick-price">${escapeHtml(String(it.listPrice ?? '—'))}</span>
      </label>`;
  }).join('');
}

function renderCompilation() {
  const wrap = document.getElementById('inventoryCompile');
  if (!wrap || wrap.hidden) return;
  const picker = document.getElementById('compilePicker');
  const search = document.getElementById('compileSearch');
  if (picker) {
    picker.innerHTML = compilationPickerHTML(search ? search.value : '');
    picker.querySelectorAll('input[data-compile-pick]').forEach(box => box.addEventListener('change', () => {
      const id = String(box.dataset.compilePick);
      if (box.checked) state.picked.add(id); else state.picked.delete(id);
      persistPicked();
      renderCompilation();
      renderList();
    }));
  }

  const body = document.getElementById('compileBody');
  if (!body) return;
  const items = pickedItems();
  if (!items.length) {
    body.innerHTML = '<div class="empty-state">Tick items on the left to build a compilation.</div>';
    return;
  }
  const latestByPlatform = latestMetricsByItemPlatform();
  let sumPrice = 0, sumViews = 0, sumClicks = 0, sumPosts = 0, sumSuggest = 0, sumOther = 0;
  const rows = items.map(it => {
    const stats = itemSortStats(it, latestByPlatform);
    const tasks = itemTasks(it);
    const status = platformsStatusFor(it);
    sumPrice += askFor(it);
    sumViews += stats.views;
    sumClicks += stats.clicks;
    sumPosts += tasks.posts;
    if (tasks.suggestion) sumSuggest += 1;
    sumOther += tasks.other.length;
    const live = status.done.map(d => `<span class="cp-site live" style="--plat:${d.meta.color}">${escapeHtml(d.meta.short)}</span>`).join('');
    const todo = status.missing.map(m => `<span class="cp-site" style="--plat:${m.meta.color}">${escapeHtml(m.meta.short)}</span>`).join('');
    const posted = postedLabel(it.itemId);
    const photo = photoForItem(it.itemId);
    const taskBits = [
      tasks.posts ? `${tasks.posts} to post` : '',
      tasks.suggestion,
      ...tasks.other,
    ].filter(Boolean);
    return `
      <tr>
        <td class="cp-name">
          <div class="cp-name-wrap">
            <span class="cp-thumb">${photo ? `<img src="${escapeHtml(photo)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>
            <span>
              <b>${escapeHtml(itemShortName(it))}</b>
              <small>${escapeHtml(it.size || '—')}${posted ? ` · ${escapeHtml(posted)}` : ' · not posted'}</small>
            </span>
          </div>
        </td>
        <td class="cp-price">${escapeHtml(String(it.listPrice ?? '—'))}</td>
        <td class="cp-sites">${live}${todo}</td>
        <td class="cp-stats">${status.done.length ? `${stats.views} views · ${stats.clicks} clicks` : '<span class="muted">not live</span>'}</td>
        <td class="cp-tasks">${taskBits.length ? escapeHtml(taskBits.join(' · ')) : '<span class="muted">clear</span>'}</td>
        <td><button type="button" class="icon-btn cp-drop" data-id="${escapeHtml(it.itemId)}" aria-label="Remove">✕</button></td>
      </tr>`;
  }).join('');

  body.innerHTML = `
    <div class="cp-head">
      <h3>${items.length} item${items.length === 1 ? '' : 's'} selected</h3>
      <button type="button" class="icon-btn" id="compileClear">Clear all</button>
    </div>
    <table class="cp-table">
      <thead><tr><th>Item</th><th>Price</th><th>Sites</th><th>Stats</th><th>Tasks</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <hr class="cp-rule">
    <div class="stat-tiles cp-totals">
      <div class="stat-tile"><div class="num">${fmtMoney(sumPrice)}</div><div class="lbl">Asking total</div></div>
      <div class="stat-tile"><div class="num">${sumViews.toLocaleString()}</div><div class="lbl">Views</div></div>
      <div class="stat-tile"><div class="num">${sumClicks.toLocaleString()}</div><div class="lbl">Clicks</div></div>
      <div class="stat-tile"><div class="num">${sumPosts + sumSuggest + sumOther}</div><div class="lbl">Tasks</div></div>
    </div>
    <p class="cp-task-breakdown">${sumPosts} post${sumPosts === 1 ? '' : 's'} to make · ${sumSuggest} suggestion${sumSuggest === 1 ? '' : 's'} to deploy · ${sumOther} other task${sumOther === 1 ? '' : 's'}</p>`;

  body.querySelector('#compileClear').addEventListener('click', () => {
    state.picked.clear(); persistPicked(); renderCompilation(); renderList();
  });
  body.querySelectorAll('.cp-drop').forEach(b => b.addEventListener('click', () => {
    state.picked.delete(String(b.dataset.id)); persistPicked(); renderCompilation(); renderList();
  }));
}

// The By views list is for scanning, so an opened row shows a compact panel
// rather than the full inventory card — thumbnail, the facts you'd act on, and
// one line per site. The whole card is a click away under By category.
function rankedDetailHTML(item) {
  const photo = photoForItem(item.itemId);
  const posted = postedLabel(item.itemId);
  const focused = !!focusedFor(item.itemId);
  const facts = [
    item.size ? `Size ${escapeHtml(item.size)}` : '',
    item.condition ? escapeHtml(item.condition) : '',
    item.floorPrice ? `floor ${escapeHtml(item.floorPrice)}` : '',
    posted ? escapeHtml(posted) : 'not posted',
  ].filter(Boolean).join(' · ');
  return `
    <div class="rr-detail-grid">
      <div class="rr-thumb">${photo ? `<img src="${escapeHtml(photo)}" alt="" loading="lazy" onerror="this.remove()">` : `<span>${escapeHtml(photoPendingLabel(item))}</span>`}</div>
      <div class="rr-body">
        <div class="rr-controls">
          <label class="pick-box" title="Select this item"><input type="checkbox" data-pick="${escapeHtml(item.itemId)}"${state.picked.has(String(item.itemId)) ? ' checked' : ''}><span></span></label>
          <button type="button" class="focus-btn${focused ? ' on' : ''}" data-focus="${escapeHtml(item.itemId)}" data-on="${focused ? '1' : ''}" title="${focused ? 'In Focused inventory' : 'Add to Focused inventory'}">${focused ? '◉' : '◎'}</button>
          <span class="status-badge ${statusClass(item.sourceStatus)}">${escapeHtml(item.sourceStatus || '—')}</span>
        </div>
        <div class="rr-facts">${facts}</div>
        ${actionBadgesHTML(item.itemId)}
        ${priceLogHTML(item.itemId)}
        ${siteStatusChipsHTML(item)}
        ${platformStatsHTML(item)}
      </div>
    </div>`;
}

function renderList() {
  const container = document.getElementById('catSections');
  container.innerHTML = '';
  const expandGroup = document.querySelector('#inventory .inventory-expand');
  if (expandGroup) expandGroup.hidden = state.listGroup !== 'size';
  const latestByPlatform = latestMetricsByItemPlatform();

  // Inventory sorts by the stock itself; traffic rankings live on Performance.
  const postedDate = it => (postedInfoFor(it.itemId) || {}).date || '';
  const compareItems = (a, b) => {
    if (state.listSort === 'price') return b.stats.price - a.stats.price;
    if (state.listSort === 'newest') return postedDate(b.it).localeCompare(postedDate(a.it));
    return (a.it.item || a.it.brand || '').localeCompare(b.it.item || b.it.brand || '');
  };

  if (state.listGroup === 'size') {
    renderSizeView(container, latestByPlatform, compareItems);
    wireItemCards(container, renderList);
    return;
  }

  // One continuous grid. With every category picked it is a single list;
  // with a few picked, each gets a slim header row inside the same grid so
  // there is no gap between one category and the next.
  const cats = activeCategories().filter(c => state.listActiveCats.has(c.id));
  const itemsFor = pred => {
    let items = state.inventory.filter(pred);
    if (!state.listShowSold) items = items.filter(it => !isSold(it));
    return items.map(it => ({ it, stats: itemSortStats(it, latestByPlatform) })).sort(compareItems).map(x => x.it);
  };
  let html = '';
  let total = 0;
  if (catSelectionAll()) {
    const items = itemsFor(() => true);
    total = items.length;
    html = items.map(inventoryCardHTML).join('');
  } else {
    cats.forEach(cat => {
      const items = itemsFor(it => categoryMeta(it.category).id === cat.id);
      total += items.length;
      html += `<div class="inv-cat-head" style="--cat:${cat.color}"><span class="inv-cat-name">${cat.icon} ${escapeHtml(cat.label)}</span><span class="inv-cat-count">${items.length}</span></div>`
        + items.map(inventoryCardHTML).join('');
    });
  }
  container.innerHTML = cats.length
    ? `<div class="inv-count-line">${total} item${total === 1 ? '' : 's'}${catSelectionAll() ? ' · all categories' : ''}</div><div class="inv-grid ic-grid">${html || '<div class="empty-state">Nothing here yet.</div>'}</div>`
    : '<div class="empty-state">Pick at least one category.</div>';
  wireItemCards(container, renderList);

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
    { kind: 'sold', num: state.sales.length, lbl: 'Sales recorded', sub: unrecorded.length ? `${unrecorded.length} sold item${unrecorded.length === 1 ? '' : 's'} not recorded` : '' },
    { kind: 'value', num: money2(saleAmount), lbl: 'Sale amount', sub: shipping ? `+ ${money2(shipping)} shipping charged` : '' },
    { kind: 'drop', num: minusMoney(costs), lbl: 'Fees & labels' },
    { kind: 'net', num: money2(net), lbl: 'Net cash kept', sub: orderTotal ? `${Math.round((net / orderTotal) * 100)}% of what buyers paid` : '' },
    { kind: 'cash', num: withBalance.length ? money2(available) : '—', lbl: 'Available on sites', sub: inPerson ? `+ ${money2(inPerson)} paid in person` : '', negative: available < 0 },
    { kind: 'prep', num: withBalance.length ? money2(pending) : '—', lbl: 'Pending / on hold' },
  ];
  totalsEl.innerHTML = tiles.map(t => `
    <div class="stat-tile ${kpiClass(t.kind || 'items', t.num)}${t.negative ? ' negative' : ''}">${kpiIcon(t.kind || 'items')}<div class="num">${t.num}</div><div class="lbl">${t.lbl}</div>${t.sub ? `<div class="sub">${escapeHtml(t.sub)}</div>` : ''}</div>
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
    { kind: 'listings', num: live.toLocaleString(), lbl: 'Live listings', sub: `${itemsLive} items`, view: 'inventory' },
    { kind: 'views', num: hasStats ? latest.views.toLocaleString() : '—', lbl: 'Views', sub: delta ? pulseDelta(delta.views) : '', view: 'performance', target: 'sec-platforms' },
    { kind: 'clicks', num: hasStats ? latest.clicks.toLocaleString() : '—', lbl: 'Clicks', sub: delta ? pulseDelta(delta.clicks) : '', view: 'performance', target: 'sec-platforms' },
    { kind: 'watchers', num: hasStats ? latest.watchers.toLocaleString() : '—', lbl: 'Watchers & likes', sub: delta ? pulseDelta(delta.watchers) : '', view: 'optimize', target: 'sec-pricing' },
    { kind: 'sold', num: soldCount, lbl: 'Sold', sub: `${money2(kept)} kept`, view: 'stats', target: 'sec-sales' },
    { kind: 'cash', num: money2(available), lbl: 'Cash on sites', sub: pending ? `+ ${money2(pending)} pending` : 'nothing pending', view: 'stats', target: 'sec-cashflow', negative: available < 0 },
  ];
  el.innerHTML = tiles.map(t => `
    <button type="button" class="pb-tile kpi kpi-${t.kind}${t.negative ? ' negative' : ''}" data-view-go="${t.view}"${t.target ? ` data-target="${t.target}"` : ''}>
      ${kpiIcon(t.kind)}
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
    { kind: 'items', num: items.length, lbl: 'Total items' },
    { kind: 'listings', num: listed, lbl: 'Listed' },
    { kind: 'sold', num: sold, lbl: 'Sold' },
    { kind: 'value', num: fmtMoney(estValue), lbl: 'Est. value (active)' },
    { kind: 'net', num: fmtMoney(netCash), lbl: 'Net cash (sold)' },
  ];
  document.getElementById('overallTiles').innerHTML = tiles.map(t => `
    <div class="stat-tile ${kpiClass(t.kind, t.num)}">${kpiIcon(t.kind)}<div class="num">${t.num}</div><div class="lbl">${t.lbl}</div></div>
  `).join('');
}

// By platform - one row per site for the listings live there now: reach,
// opens (clicks, plus eBay page visits), open rate, watchers, and the change
// over the last week. Lives on Performance; Stats keeps the money side.
function renderPlatformCards() {
  const container = document.getElementById('perfPlatforms');
  if (!container) return;
  const now = latestMetricsByItemPlatform();
  const past = latestMetricsByItemPlatform(perfPastDate());
  const rows = new Map();
  state.inventory.filter(it => !isSold(it)).forEach(it => {
    platformsStatusFor(it).done.forEach(d => {
      const id = d.meta.id;
      if (!rows.has(id)) rows.set(id, { meta: d.meta, live: 0, reach: 0, opens: 0, watchers: 0, opensWas: 0, reachWas: 0 });
      const r = rows.get(id);
      r.live++;
      const read = (map) => {
        const snap = map.get(it.itemId + '|' + id);
        if (!snap) return { reach: 0, opens: 0, watchers: 0 };
        const opens = snapOpens(snap, id);
        return { reach: Number(snap.impressions) || Number(snap.views) || 0, opens, watchers: Number(snap.watchers) || 0 };
      };
      const n = read(now), w = read(past);
      r.reach += n.reach; r.opens += n.opens; r.watchers += n.watchers;
      r.reachWas += w.reach; r.opensWas += w.opens;
    });
  });
  const list = [...rows.values()].sort((a, b) => b.live - a.live || platformRank(a.meta.id) - platformRank(b.meta.id));
  if (!list.length) { container.innerHTML = '<div class="empty-state">No live listings yet.</div>'; return; }
  const maxOpens = Math.max(1, ...list.map(r => r.opens));
  container.innerHTML = `
    <table class="plat-table">
      <thead><tr><th>Site</th><th>Live</th><th>Impressions</th><th>Opens</th><th>Open rate</th><th>Watching</th><th>This week</th><th class="pt-bar-col">Share of opens</th></tr></thead>
      <tbody>${list.map(r => {
        const rate = r.reach ? ((r.opens / r.reach) * 100).toFixed(1) + '%' : '—';
        const dOpens = Math.max(0, r.opens - r.opensWas);
        const dReach = Math.max(0, r.reach - r.reachWas);
        return `<tr style="--plat:${r.meta.color}">
          <td><span class="pt-site"><i></i>${escapeHtml(r.meta.label)}</span></td>
          <td>${r.live}</td>
          <td>${r.reach.toLocaleString()}</td>
          <td>${r.opens.toLocaleString()}</td>
          <td>${rate}</td>
          <td>${r.watchers || '—'}</td>
          <td class="pt-week">${[dReach ? `+${dReach.toLocaleString()} imp` : '', dOpens ? `+${dOpens} opens` : ''].filter(Boolean).join(' · ') || '—'}</td>
          <td class="pt-bar-col"><span class="pt-bar"><span style="width:${Math.round((r.opens / maxOpens) * 100)}%"></span></span></td>
        </tr>`;
      }).join('')}</tbody>
    </table>
    <p class="subhead-note">Opens are clicks into a listing; on eBay that is its page views. Facebook, Depop and Grailed don't report impressions.</p>`;
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
    const metaBits = [
      it.soldPrice ? `Sold ${escapeHtml(it.soldPrice)}` : '',
      it.buyer ? escapeHtml(it.buyer) : '',
      soldDate ? escapeHtml(soldDate) : '',
    ].filter(Boolean);
    return itemCard(it, {
      cls: 'to-ship-card',
      accent: '#1f5c46',
      sites: false,
      meta: metaBits.join(' · '),
      body: `<div class="ar-actions"><button class="btn ar-primary ts-ship-btn" data-id="${escapeHtml(it.itemId)}">Mark shipped</button></div>`,
      foot: actionStarHTML(it.itemId, [it.brand, it.item].filter(Boolean).join(' ') || it.itemId),
    });
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
    const title = itemDisplayName(item, ' — ') || item.itemId;
    const soldWhere = soldOn ? platformMeta(item.buyer).label : (item.buyer || '');
    const metaBits = [
      item.soldPrice ? `Sold ${escapeHtml(item.soldPrice)}` : '',
      soldWhere ? `via ${escapeHtml(soldWhere)}` : '',
      `Still up on ${escapeHtml(meta.label)}`,
    ].filter(Boolean);
    return itemCard(item, {
      cls: 'end-card',
      accent: '#7a2038',
      sites: false,
      meta: metaBits.join(' · '),
      tags: tag(`<i></i>${escapeHtml(meta.label)}`, 'tg-site tg-live', 'Still live on ' + meta.label, `--plat:${meta.color}`),
      body: `<div class="ar-actions">
          <button class="btn ar-primary end-btn" data-id="${escapeHtml(item.itemId)}" data-platform="${escapeHtml(meta.label)}" data-listing="${escapeHtml((entry && entry.listingId) || '')}">Mark ended</button>
          <div class="ar-secondary">
            ${entry && entry.listingUrl ? `<a class="icon-btn" href="${escapeHtml(entry.listingUrl)}" target="_blank" rel="noopener">Open listing</a>` : ''}
          </div>
        </div>`,
      foot: actionStarHTML(endTaskKey(item.itemId, meta.id), `${title} on ${meta.label}`),
    });
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
      const title = item ? (itemDisplayName(item, ' — ') || item.itemId) : deal.itemId;
      const meta = localDealStatusMeta(deal.status);
      const pmeta = platformMeta(deal.platform);
      const editing = state.editingLocalDeal === localDealKey(deal);
      const actionsHTML = editing ? localDealFormHTML(deal) : `
            <div class="ar-actions">
              <button type="button" class="btn ar-primary ld-edit" data-key="${escapeHtml(localDealKey(deal))}">Update</button>
              <div class="ar-secondary">
                <button type="button" class="icon-btn ld-clear-btn" data-id="${escapeHtml(deal.itemId)}" data-platform="${escapeHtml(deal.platform)}">Clear</button>
              </div>
            </div>`;
      const star = actionStarHTML(`deal:${deal.itemId}`, `${title} — ${meta.label}`);
      const chip = `<span class="ld-chip" style="--plat:${meta.color}"><span aria-hidden="true">${meta.icon}</span> ${escapeHtml(meta.label)}</span>`;
      const note = deal.note ? `<p class="ld-note-text">${escapeHtml(deal.note)}</p>` : '';
      const placeBits = [
        deal.when ? escapeHtml(deal.when) : '',
        deal.buyer ? escapeHtml(deal.buyer) : '',
        deal.where ? `@ ${escapeHtml(deal.where)}` : '',
      ];
      const metaBits = [escapeHtml(pmeta.label), item ? priceLineHTML(item) : '', ...placeBits].filter(Boolean);
      if (item) {
        // The price column already carries the price, so the details line
        // keeps the rest: site, when, who, where.
        return itemCard(item, {
          cls: `ld-card ld-${meta.id}`,
          accent: meta.color,
          sites: false,
          noStatus: true,
          meta: [escapeHtml(pmeta.label), ...placeBits].filter(Boolean).join(' · '),
          tags: tag(`<span aria-hidden="true">${meta.icon}</span> ${escapeHtml(meta.label)}`, 'tg-deal', meta.blurb, `--plat:${meta.color}`),
          callout: note,
          body: actionsHTML,
          foot: star,
        });
      }
      return `
        <div class="card ld-card ld-${meta.id} action-row" style="--cat:${meta.color}">
          <div class="ar-title-row">
            <h3>${escapeHtml(title)}</h3>
            <div class="card-top-actions">${star}${chip}</div>
          </div>
          ${metaBits.length ? `<div class="ar-meta-line">${metaBits.join(' · ')}</div>` : ''}
          ${note}
          ${actionsHTML}
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
  renderTaskList();
  renderLocalDeals();
  renderSoldElsewhere();
  renderStillToList();
  renderPricingActions();
  renderActionSummary();
}

// The tasks you chose on Optimize, as a list you can tick off. Each one is a
// row in Item Actions, so ticking it leaves a record rather than deleting it.
function renderTaskList() {
  const container = document.getElementById('taskList');
  if (!container) return;
  const tasks = allOpenTasks();
  setActionSectionVisible('section-tasks', tasks.length > 0);
  if (!tasks.length) { container.innerHTML = ''; return; }
  const byItem = new Map();
  tasks.forEach(({ item, task }) => {
    if (!byItem.has(item.itemId)) byItem.set(item.itemId, { item, tasks: [] });
    byItem.get(item.itemId).tasks.push(task);
  });
  container.innerHTML = `<div class="card-grid">${[...byItem.values()].map(({ item, tasks }) => `
    <div class="card stl-card action-row">
      <div class="ar-title-row"><h3>${escapeHtml(itemShortName(item))}</h3><span class="stl-need-count">${tasks.length} task${tasks.length === 1 ? '' : 's'}</span></div>
      <div class="ar-meta-line">${priceLineHTML(item)} ${expectedSaleChipHTML(item)}</div>
      <ul class="task-lines">${tasks.map(t => `
        <li><span>${escapeHtml(t)}</span><button type="button" class="btn small task-done" data-id="${escapeHtml(item.itemId)}" data-task="${escapeHtml(t)}">Done</button></li>`).join('')}</ul>
    </div>`).join('')}</div>`;
  container.querySelectorAll('.task-done').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true;
    await recordItemAction(btn.dataset.id, 'Task Done', btn.dataset.task);
    renderTaskList();
    renderActionSummary();
    renderOptimizeView();
  }));
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
  const readyRows = listRows.filter(r => !prepNoteFor(r.item.itemId));
  const toList = readyRows.reduce((n, r) => n + r.status.missing.length, 0);
  const prepCount = listRows.filter(r => r.status.missing.length && prepNoteFor(r.item.itemId)).length;
  const moves = state.inventory.filter(it => !isSold(it)).map(pricingActionFor)
    .filter(a => !a.hidden && MOVE_GROUP_KEYS.includes(pricingGroupKeyFor(a))).length;
  const tiles = [
    { kind: 'ship', num: toShip, lbl: 'To ship', target: 'sec-ship' },
    { kind: 'tasks', num: allOpenTasks().length, lbl: 'Planned tasks', target: 'sec-tasks' },
    { kind: 'local', num: openLocalDeals().length, lbl: 'Local deals', target: 'sec-local', sub: localDealsDueLabel() },
    { kind: 'end', num: soldElsewhereTasks().length, lbl: 'Listings to end', target: 'sec-end' },
    { kind: 'prep', num: prepCount, lbl: 'Item prep', target: 'sec-prep' },
    { kind: 'list', num: toList, lbl: 'Posts to make', target: 'sec-list' },
    { kind: 'moves', num: moves, lbl: 'Optimize moves', target: 'sec-pricing', sub: 'on Optimize' },
  ];
  container.innerHTML = tiles.map(t => `<button class="as-tile ${kpiClass(t.kind, t.num)}${t.num ? '' : ' as-zero'}" data-target="${t.target}">${kpiIcon(t.kind)}<span class="num">${t.num}</span><span class="lbl">${t.lbl}</span>${t.sub ? `<span class="sub">${t.sub}</span>` : ''}</button>`).join('');
  container.querySelectorAll('.as-tile').forEach(tile => tile.addEventListener('click', () => scrollToSection(tile.dataset.target)));
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
// A "Draft Created" action means the listing is built and sitting in that
// site's drafts, waiting on a publish. It's the state between "still to list"
// and "live", and without it a half-done listing looks identical to one that
// hasn't been started. "Draft Discarded" clears it; going live supersedes it,
// so a posted platform never shows a stale draft badge.
function draftPlatformsFor(itemId) {
  const byPlatform = new Map();
  state.itemActions.forEach(function (a) {
    if (String(a.itemId) !== String(itemId)) return;
    if (a.action !== 'Draft Created' && a.action !== 'Draft Discarded' && a.action !== 'Listing Posted') return;
    const pid = platformId(String(a.detail || '').trim());
    if (!pid) return;
    byPlatform.set(pid, a.action);
  });
  const out = new Set();
  byPlatform.forEach(function (action, pid) { if (action === 'Draft Created') out.add(pid); });
  return out;
}
function hasDraftFor(itemId, platformMetaId) {
  return draftPlatformsFor(itemId).has(platformMetaId);
}
// Card-level summary so the badge is visible without reading every site row.
function draftBadgeHTML(itemId) {
  const ids = [...draftPlatformsFor(itemId)];
  if (!ids.length) return '';
  const names = ids.map(function (id) { const m = PLATFORM_META[id]; return m ? (m.short || m.label) : id; });
  return tag(`Draft ready · ${escapeHtml(names.join(', '))}`, 'tg-draft', 'Listing already drafted on ' + names.join(', '));
}
function draftToggleHTML(itemId, meta) {
  const on = hasDraftFor(itemId, meta.id);
  return `<button class="icon-btn stl-draft-btn${on ? ' is-on' : ''}" data-id="${escapeHtml(itemId)}" data-platform="${escapeHtml(meta.label)}" data-on="${on ? '1' : '0'}" title="${on ? 'Drafted on ' + escapeHtml(meta.label) + ' \u2014 click to clear' : 'Mark that a draft exists on ' + escapeHtml(meta.label)}">${on ? '\u2713 Draft made' : '+ Draft made'}</button>`;
}

function postingNoteFor(itemId) {
  const latest = latestActionOfType(itemId, 'Posting Note');
  const note = latest ? String(latest.detail || '').trim() : '';
  // Notes about the sheet and a listing disagreeing on price are retired:
  // the live listing price is the price, so there is nothing to reconcile.
  if (note && isPriceNote(note)) return '';
  return note;
}
function isPriceNote(note) {
  return /\$\s?\d/.test(note) && /(price|drop|sheet|drift|still \$|listed at)/i.test(note);
}
// The note that actually holds up posting (photos, parts, testing). Price
// notes are alerts, not prep work, so they never park an item in Item prep.
function prepNoteFor(itemId) {
  const note = postingNoteFor(itemId);
  return note && !isPriceNote(note) ? note : '';
}

// Everything worth a second look on one item, kept behind a small "!" rather
// than printed across the card.
function itemAlerts(item) {
  const alerts = [];
  const note = postingNoteFor(item.itemId);
  if (note) alerts.push({ kind: 'note', text: note, clearable: true });
  if (isSold(item)) {
    platformsStatusFor(item).done.forEach(d => alerts.push({ kind: 'live', text: `Sold, but still live on ${d.meta.label} \u2014 end that listing.` }));
  }
  return alerts;
}
function alertButtonHTML(item) {
  const alerts = itemAlerts(item);
  if (!alerts.length) return '';
  const open = state.openAlerts.has(String(item.itemId));
  return `<button type="button" class="alert-btn${open ? ' on' : ''}" data-alert="${escapeHtml(item.itemId)}" title="${escapeHtml(alerts.map(a => a.text).join('\n'))}" aria-expanded="${open}">!${alerts.length > 1 ? `<i>${alerts.length}</i>` : ''}</button>`;
}
function alertPanelHTML(item) {
  if (!state.openAlerts.has(String(item.itemId))) return '';
  const alerts = itemAlerts(item);
  if (!alerts.length) return '';
  return `<ul class="alert-list">${alerts.map(a => `
    <li class="alert-${a.kind}"><span>${escapeHtml(a.text)}</span>${a.clearable ? `<button type="button" class="icon-btn alert-clear" data-id="${escapeHtml(item.itemId)}">Clear</button>` : ''}</li>`).join('')}</ul>`;
}
function postingNoteHTML(item, groupId) {
  const note = prepNoteFor(item.itemId);
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

// Expected sale window — what this KIND of thing usually takes, decided
// before it has any traffic of its own. The speed band above grades how a
// listing is actually doing; this one sets the expectation it is graded
// against. Rules come from what has sold here plus how deep each buyer pool
// is: shoes and named electronics move, plain basics and niche collectibles
// sit.
const SALE_EXPECTATIONS = {
  quick:  { id: 'quick',  label: 'Quick mover', days: 'about 1-3 weeks', maxDays: 21, order: 1 },
  steady: { id: 'steady', label: 'Steady',      days: 'about 3-6 weeks', maxDays: 42, order: 2 },
  slow:   { id: 'slow',   label: 'Slow mover',  days: 'about 6-12 weeks', maxDays: 84, order: 3 },
  tail:   { id: 'tail',   label: 'Long tail',   days: '3 months or more', maxDays: 365, order: 4 },
};
const QUICK_SHOE_BRANDS = ['nike', 'brooks', 'vans', 'adidas', 'new balance', 'converse', 'asics', 'hoka', 'jordan'];
const KNOWN_ACTIVE_BRANDS = ['under armour', 'gymshark', 'lululemon', 'patagonia', 'north face', 'carhartt', 'peter millar'];
function expectedSaleFor(item) {
  const cat = String(item.category || '').toLowerCase();
  const brand = String(item.brand || '').toLowerCase();
  const name = String(item.item || '').toLowerCase();
  const price = parseMoney(item.listPrice) || 0;
  const hay = brand + ' ' + name;
  const pick = (band, why) => ({ ...SALE_EXPECTATIONS[band], why });

  if (cat === 'shoes') {
    if (/boot/.test(hay)) return pick('quick', 'Boots in autumn - the season is the whole story.');
    if (QUICK_SHOE_BRANDS.some(b => hay.includes(b))) {
      return price <= 80 ? pick('quick', 'Named athletic shoes under $80 are the deepest buyer pool you have.')
                         : pick('steady', 'Named shoes above $80 sell, but to a narrower set of buyers.');
    }
    return pick('steady', 'Shoes move, but an unfamiliar brand narrows the pool.');
  }
  if (cat === 'clothing') {
    if (KNOWN_ACTIVE_BRANDS.some(b => hay.includes(b))) return pick('steady', 'A brand people search for, so it gets found - just not instantly.');
    if (price <= 25) return pick('slow', 'Plain basics compete with thousands of identical listings.');
    return pick('slow', 'Mid-priced clothing without a searched-for brand takes a while.');
  }
  if (cat === 'electronics') {
    if (/\b([a-z]{1,4}[- ]?\d{2,}[a-z]?)\b/.test(name)) return pick('quick', 'People search electronics by model number, and this listing has one.');
    return pick('steady', 'Electronics sell well when the buyer can name what they want.');
  }
  if (cat === 'kitchen') return pick('steady', 'Small appliances sell steadily, especially locally where shipping is not in the way.');
  if (cat === 'collectibles') return pick('tail', 'Collectibles wait for the one buyer who wants exactly this - worth more, takes longer.');
  if (cat === 'tools') return pick('steady', 'Tools hold value and sell to people searching for the exact one.');
  if (cat === 'furniture') return pick('tail', 'Local pickup only, so it waits for someone nearby who wants it.');
  if (/\b(dvd|cd|book|vinyl|record)\b/.test(hay)) return pick('tail', 'Media sells eventually; individual discs and books are a waiting game.');
  return pick('steady', 'No strong signal either way from the category.');
}
// Shown wherever an item is queued to be listed or sitting as a draft, so the
// speed you can expect is visible while you decide what to work on next -
// "Quick mover, about 1-3 weeks" rather than an abstract band name. The colour
// runs fast-to-slow so a column of these reads at a glance.
const EXPECT_PLAIN = {
  quick:  'Quick sale',
  steady: 'Medium sale',
  slow:   'Slower sale',
  tail:   'Long haul',
};
function expectedSaleChipHTML(item) {
  const e = expectedSaleFor(item);
  const plain = EXPECT_PLAIN[e.id] || e.label;
  return `<span class="sale-speed sale-${e.id}" title="${escapeHtml(e.label)} \u2014 ${escapeHtml(e.why)}"><b>${escapeHtml(plain)}</b><i>${escapeHtml(e.days)}</i></span>`;
}
function expectedChipHTML(item) {
  const e = expectedSaleFor(item);
  return `<span class="expect-chip expect-${e.id}" title="${escapeHtml(e.why)}">Expect: ${escapeHtml(e.label)} · ${escapeHtml(e.days)}</span>`;
}

// Estimated sale speed — how long this listing looks like it will take,
// read off its own traffic rather than a guess about the category. Clicks are
// the honest signal: an impression is eBay showing it to someone, a click is
// someone choosing it. Bands are deliberately wide because the underlying
// numbers are small.
const SPEED_BANDS = {
  fast:   { id: 'fast',   label: 'Fast',        days: '1-14 days',  max: 14,   order: 1 },
  medium: { id: 'medium', label: 'Medium',      days: '15-45 days', max: 45,   order: 2 },
  slow:   { id: 'slow',   label: 'Longer',      days: '45+ days',   max: 999,  order: 3 },
  newish: { id: 'newish', label: 'Too new to tell', days: 'under 4 days up', max: 999, order: 4 },
  nodata: { id: 'nodata', label: 'No data yet', days: 'no stats logged', max: 999, order: 5 },
};
function saleSpeedFor(item, latestByPlatform) {
  const map = latestByPlatform || latestMetricsByItemPlatform();
  const stats = itemSortStats(item, map);
  const posted = postedInfoFor(item.itemId);
  const days = posted ? Math.max(1, posted.days) : null;
  let watchers = 0;
  splitPlatforms(item.platform).forEach(p => {
    const snap = map.get(item.itemId + '|' + platformMeta(p).id);
    watchers += Number(snap && snap.watchers) || 0;
  });
  const out = { views: stats.views, clicks: stats.clicks, watchers, daysListed: posted ? posted.days : null };
  if (days === null) return { ...out, band: SPEED_BANDS.nodata, expected: expectedSaleFor(item), overdue: false };
  if (days < 4 && stats.clicks === 0) return { ...out, band: SPEED_BANDS.newish, expected: expectedSaleFor(item), overdue: false };
  if (!stats.views && !stats.clicks) return { ...out, band: SPEED_BANDS.nodata, expected: expectedSaleFor(item), overdue: days > expectedSaleFor(item).maxDays };
  // eBay page visits count as clicks here (see listingOpensFor).
  const clicksPerDay = Math.max(stats.clicks, listingOpensFor(item, map)) / days;
  const viewsPerDay = stats.views / days;
  let band = SPEED_BANDS.slow;
  if (clicksPerDay >= 0.7 || watchers >= 3) band = SPEED_BANDS.fast;
  else if (clicksPerDay >= 0.15 || viewsPerDay >= 3 || watchers >= 1) band = SPEED_BANDS.medium;
  // Overdue is measured against what this KIND of item was expected to take,
  // not against how it happens to be performing - otherwise a listing doing
  // well gets flagged simply for being older than two weeks.
  const expected = expectedSaleFor(item);
  return { ...out, band, expected, clicksPerDay, overdue: days > expected.maxDays };
}
// One row, one verdict. The old pair of chips made you compare two labels
// ("Expect: Steady" against "Pace: Medium") to work out whether an item was
// doing fine - so this states the answer and keeps the evidence in the
// tooltip: where the listing is today, against how long it was meant to take.
function paceRowHTML(item, latestByPlatform) {
  const s = saleSpeedFor(item, latestByPlatform);
  const e = s.expected || expectedSaleFor(item);
  const day = s.daysListed;
  let id, flag, detail;
  if (day === null) { id = 'none'; flag = 'Not posted'; detail = 'no listing date yet'; }
  else if (s.band.id === 'nodata') { id = 'none'; flag = 'No stats'; detail = `day ${day} \u00b7 nothing logged yet`; }
  else if (s.band.id === 'newish') { id = 'new'; flag = 'Too new'; detail = `day ${day} \u00b7 usually ${e.days}`; }
  else if (s.overdue) { id = 'behind'; flag = 'Behind'; detail = `day ${day} \u00b7 expected ${e.days}`; }
  else { id = 'onpace'; flag = 'On pace'; detail = `day ${day} of ${e.days}`; }
  const traffic = (s.band.id === 'nodata' || s.band.id === 'newish' || day === null)
    ? ''
    : ` Traffic so far reads ${s.band.label.toLowerCase()}: ${s.clicks} click${s.clicks === 1 ? '' : 's'} in ${day} day${day === 1 ? '' : 's'}.`;
  const title = `${e.label} \u2014 ${e.why}${traffic}`;
  return `<div class="pace-row pace-${id}" title="${escapeHtml(title)}"><span class="pace-flag">${escapeHtml(flag)}</span><span class="pace-detail">${escapeHtml(detail)}</span></div>`;
}
function speedChipHTML(item, latestByPlatform) {
  const s = saleSpeedFor(item, latestByPlatform);
  const cls = 'speed-chip speed-' + s.band.id + (s.overdue ? ' overdue' : '');
  const age = s.daysListed === null ? 'not posted' : `day ${s.daysListed}`;
  const title = `Performing ${s.band.label.toLowerCase()} — ${s.clicks} clicks over ${s.daysListed || 0} days. At this pace it reads like ${s.band.days}.`
    + (s.overdue ? ` Past the ${s.expected ? s.expected.days : ''} it was expected to take.` : '');
  return `<span class="${cls}" title="${escapeHtml(title)}">Pace: ${escapeHtml(s.band.label)} · ${escapeHtml(age)}${s.overdue ? ' · OVERDUE' : ''}</span>`;
}

// Focus — a hand-picked shortlist of listings worth pushing. Kept in Item
// Actions so it follows the Sheet rather than one browser: the latest "Focus"
// wins unless a later "Unfocus" clears it. Focusing never takes an item out of
// Inventory; the Focus tab is a second window onto the same items.
function focusedFor(itemId) {
  const on = latestActionOfType(itemId, 'Focus');
  if (!on) return null;
  const off = latestActionOfType(itemId, 'Unfocus');
  if (off && off.date >= on.date && state.itemActions.indexOf(off) > state.itemActions.indexOf(on)) return null;
  return on;
}
function focusedItems() {
  return state.inventory.filter(it => !isSold(it) && focusedFor(it.itemId));
}
async function toggleFocus(itemId, isOn) {
  await recordItemAction(itemId, isOn ? 'Unfocus' : 'Focus', isOn ? 'Back to regular inventory.' : 'Pushing this one.');
  renderList();
  renderFocusView();
  renderPickPanel();
}

// When an item first went up anywhere, and how long it has been sitting.
function postedInfoFor(itemId) {
  const dates = state.postingQueue
    .filter(r => String(r.itemId) === String(itemId))
    .map(r => String(r.datePosted || '').slice(0, 10))
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  if (!dates.length) return null;
  const first = dates[0];
  const days = Math.max(0, Math.round(
    (new Date(todayStr() + 'T12:00:00') - new Date(first + 'T12:00:00')) / 86400000));
  return { date: first, days };
}
function postedLabel(itemId) {
  const p = postedInfoFor(itemId);
  if (!p) return '';
  const when = new Date(p.date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const age = p.days === 0 ? 'today' : `${p.days} day${p.days === 1 ? '' : 's'} old`;
  return `${when} · ${age}`;
}

// Everything still owed on one item, so a compilation can total them up.
function itemTasks(item) {
  const posts = platformsStatusFor(item).missing.length;
  const action = pricingActionFor(item);
  const suggests = action && !action.hidden && ['urgent', 'attention', 'opportunity'].includes(action.severity);
  const other = [];
  if (!photoForItem(item.itemId)) other.push('needs a photo');
  const note = postingNoteFor(item.itemId);
  if (note) other.push(note);
  return {
    posts: posts,
    suggestion: suggests ? action.label : '',
    other: other,
    total: posts + (suggests ? 1 : 0) + other.length,
  };
}

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

// Everything with a posting note ("waiting on the charger", "taking photos")
// is item prep, not listing work - it sits in its own Actions section until
// the note is cleared, so Still to list only holds things ready to post.
function renderStillToList() {
  renderReadyToList();
  renderItemPrep();
}
function renderItemPrep() {
  const container = document.getElementById('itemPrepList');
  if (!container) return;
  const rows = stillToListRows().filter(r => r.status.missing.length && prepNoteFor(r.item.itemId));
  setActionSectionVisible('section-prep', rows.length > 0);
  if (!rows.length) { container.innerHTML = ''; return; }
  rows.sort((a, b) => (a.item.item || a.item.brand || '').localeCompare(b.item.item || b.item.brand || ''));
  container.innerHTML = `<div class="ic-grid">${rows.map(({ item }) => itemCard(item, {
    cls: 'prep-card stl-card',
    accent: '#d97706',
    expect: true,
    sites: false,
    tags: draftBadgeHTML(item.itemId) + siteTagsHTML(item, 'live') + '<span class="tg-label">Then post to</span>' + siteTagsHTML(item, 'missing'),
    callout: postingNoteHTML(item, 'prep'),
    foot: editToggleHTML(item).replace('btn secondary ie-toggle', 'icon-btn ie-toggle'),
    body: itemEditPanelHTML(item),
  })).join('')}</div>`;
  wireStillToListCards(container);
}
function renderReadyToList() {
  const container = document.getElementById('stillToListList');
  if (!container) return;
  const rows = stillToListRows().filter(r => !prepNoteFor(r.item.itemId));
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
  const itemTitle = function (item) { return itemDisplayName(item, ' — ') || item.itemId; };

  // By item: one card per thing you own, with every site it still owes. Better
  // for "what have I got left to do" than the by-site view, which repeats an
  // item once per platform.
  if (state.stlGroup === 'item') {
    const itemRows = rows
      .filter(function (r) { return r.status.missing.some(function (m) { return !siteFilter || m.meta.id === siteFilter; }); })
      .slice()
      .sort(function (a, b) {
        return (postingNoteFor(a.item.itemId) ? 1 : 0) - (postingNoteFor(b.item.itemId) ? 1 : 0) || byName(a, b);
      });
    const onHoldCount = itemRows.filter(function (r) { return postingNoteFor(r.item.itemId); }).length;
    const cards = itemRows.map(function ({ item, status }) {
      const missing = status.missing.filter(function (m) { return !siteFilter || m.meta.id === siteFilter; });
      return itemCard(item, {
        cls: 'stl-card',
        expect: true,
        tags: draftBadgeHTML(item.itemId) + tag(`${missing.length} site${missing.length === 1 ? '' : 's'} to post`, 'tg-count'),
        callout: postingNoteHTML(item, missing.length ? missing[0].meta.id : ''),
        body: `<div class="stl-site-rows">
            ${missing.map(function (m) {
              return `<div class="stl-site-row${hasDraftFor(item.itemId, m.meta.id) ? ' has-draft' : ''}" style="--plat:${m.meta.color}">
                <span class="tg tg-site tg-todo" style="--plat:${m.meta.color}">${escapeHtml(m.meta.short)}</span>
                <button class="btn small stl-listed-btn" data-id="${escapeHtml(item.itemId)}" data-platform="${escapeHtml(m.meta.label)}">Mark listed</button>
                ${draftToggleHTML(item.itemId, m.meta)}
              </div>`;
            }).join('')}
          </div>${itemEditPanelHTML(item)}${missing.length ? stlListingDetailsHTML(item, missing[0].meta) : ''}`,
        foot: `${editToggleHTML(item).replace('btn secondary ie-toggle', 'icon-btn ie-toggle')}
              ${prepNoteFor(item.itemId) || !missing.length ? '' : `<button class="icon-btn stl-note-add" data-key="${escapeHtml(`${item.itemId}|${missing[0].meta.id}`)}">+ Note</button>`}`,
      });
    }).join('');
    container.innerHTML = `
      <details class="action-group stl-group" open>
        <summary><span class="ag-title">Every item still to list</span><span class="ag-count">${itemRows.length}</span>${onHoldCount ? `<span class="ag-hold">${onHoldCount} on hold</span>` : ''}</summary>
        <div class="ic-grid">${cards || '<div class="empty-state">Nothing outstanding.</div>'}</div>
      </details>` + (skippedRows.length ? '' : '');
    wireStillToListCards(container);
    return;
  }

  const groupHTML = Array.from(groups.values())
    .sort(function (a, b) { return platformRank(a.meta.id) - platformRank(b.meta.id) || a.meta.label.localeCompare(b.meta.label); })
    .map(function (g) {
      // Items that are on hold sink below the ones ready to post.
      const onHold = g.rows.filter(function (r) { return postingNoteFor(r.item.itemId); }).length;
      const cards = g.rows.slice().sort(function (a, b) {
        return (postingNoteFor(a.item.itemId) ? 1 : 0) - (postingNoteFor(b.item.itemId) ? 1 : 0) || byName(a, b);
      }).map(function ({ item, status }) {
        return itemCard(item, {
          cls: 'stl-card',
          accent: g.meta.color,
          expect: true,
          tags: draftBadgeHTML(item.itemId),
          callout: postingNoteHTML(item, g.meta.id),
          body: `<div class="ar-actions">
              <button class="btn ar-primary stl-listed-btn" data-id="${escapeHtml(item.itemId)}" data-platform="${escapeHtml(g.meta.label)}">Mark listed</button>
              <div class="ar-secondary">
                ${draftToggleHTML(item.itemId, g.meta)}
                <button class="icon-btn stl-skip-btn" data-id="${escapeHtml(item.itemId)}" data-platform="${escapeHtml(g.meta.label)}">Not posting</button>
              </div>
            </div>${itemEditPanelHTML(item)}${stlListingDetailsHTML(item, g.meta)}`,
          foot: `${actionStarHTML(postingTaskKey(item.itemId, g.meta.id), `${itemTitle(item)} on ${g.meta.label}`)}
                ${editToggleHTML(item).replace('btn secondary ie-toggle', 'icon-btn ie-toggle')}
                ${prepNoteFor(item.itemId) || state.editingPostingNote === `${item.itemId}|${g.meta.id}` ? '' : `<button class="icon-btn stl-note-add" data-key="${escapeHtml(`${item.itemId}|${g.meta.id}`)}">+ Note</button>`}`,
        });
      }).join('');
      return `
        <details class="action-group stl-group" id="stl-group-${escapeHtml(g.meta.id)}" style="--plat:${g.meta.color}" open>
          <summary><span class="ag-title">${escapeHtml(g.meta.short)}</span><span class="ag-count">${g.rows.length}</span>${onHold ? `<span class="ag-hold">${onHold} on hold</span>` : ''}</summary>
          <div class="ic-grid">${cards}</div>
        </details>`;
    }).join('');

  const skippedHTML = skippedRows.length ? `
    <details class="action-group stl-group">
      <summary><span class="ag-title">Not posting</span><span class="ag-count">${skippedRows.length}</span></summary>
      <div class="card-grid">${skippedRows.slice().sort(byName).map(function ({ item, status }) {
        const skipped = status.skipped.filter(function (s) { return !siteFilter || s.meta.id === siteFilter; });
        return `
          <div class="card stl-card action-row">
            <div class="ar-title-row"><h3>${itemLink(item, escapeHtml(itemTitle(item)))}</h3></div>
            <div class="stl-chips">${skipped.map(function (s) {
              return `<div class="ar-actions"><span class="stl-chip stl-skipped" style="--plat:${s.meta.color}">${escapeHtml(s.meta.label)}</span><button class="btn ar-primary stl-reopen-btn" data-id="${escapeHtml(item.itemId)}" data-platform="${escapeHtml(s.meta.label)}">Post after all</button></div>`;
            }).join('')}</div>
          </div>`;
      }).join('')}</div>
    </details>` : '';

  container.innerHTML = groupHTML + skippedHTML;
  wireStillToListCards(container);
}

// Shared by both groupings: the by-site columns and the by-item list render
// the same buttons, so they wire up the same way.
function wireStillToListCards(container) {
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
  container.querySelectorAll('.stl-draft-btn').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      const clearing = btn.dataset.on === '1';
      await recordItemAction(btn.dataset.id, clearing ? 'Draft Discarded' : 'Draft Created', btn.dataset.platform);
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
    const window = offerWindowFor(item.itemId, withWatchers[0].meta.id, withWatchers[0].meta.label);
    return {
      severity: 'opportunity', label: 'Send an offer',
      reason: `${where} — send an offer to close the sale instead of waiting.`,
      offerWhere: `${withWatchers[0].meta.label}: ${hint}`,
      offerPlatformLabel: withWatchers[0].meta.label,
      offerWindow: window,
      views, clicks, watchers,
    };
  }
  if (views === 0) {
    return { severity: 'attention', label: 'Boost visibility', reason: 'No views yet — refresh the listing, sharpen the title/keywords, or share it for more reach. This is a visibility problem, not a pricing one.', views, clicks, watchers };
  }

  const ctr = clicks / views;
  const weakInterest = views >= PRICING_MIN_VIEWS_TO_JUDGE && ctr < PRICING_LOW_CTR;
  if (weakInterest) {
    const listPrice = askFor(item);
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
    if (!out.suggestedPrice) out.suggestedPrice = suggestedDropPrice(askFor(item), parseMoney(item.floorPrice));
  } else {
    delete out.suggestedPrice;
  }
  return out;
}

// eBay only lets you offer to buyers who showed interest recently, so an offer
// left too long quietly becomes impossible to send. Walk this item's metric
// history back to the start of the current unbroken run of watchers: that is
// when the oldest of them arrived, and the clock starts there.
const OFFER_WINDOW_DAYS = 30;
function interestSinceFor(itemId, platformId) {
  const rows = state.metrics
    .filter(m => String(m.itemId) === String(itemId) && platformMeta(m.platform).id === platformId)
    .map(m => ({ date: String(m.date || '').slice(0, 10), watchers: Number(m.watchers || 0) }))
    .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) return '';
  // One row per day — later pulls of the same day win.
  const byDay = new Map();
  rows.forEach(r => byDay.set(r.date, r));
  const days = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (!days.length || !days[days.length - 1].watchers) return '';
  let since = days[days.length - 1].date;
  for (let i = days.length - 1; i >= 0; i--) {
    if (!days[i].watchers) break;
    since = days[i].date;
  }
  return since;
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function prettyDay(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
// Poshmark likers don't lapse the way eBay watchers do — there the limit is
// the price of your own last offer, not a clock.
function offerWindowFor(itemId, platformId, platformLabel) {
  const since = interestSinceFor(itemId, platformId);
  if (!since) return null;
  if (platformId !== 'ebay') {
    return { platform: platformLabel, since: since, expires: false,
      text: `${platformLabel} likers don't expire — but each new offer has to be at least 10% under your last one.` };
  }
  const deadline = addDays(since, OFFER_WINDOW_DAYS);
  const left = Math.round((new Date(deadline + 'T12:00:00') - new Date(todayStr() + 'T12:00:00')) / 86400000);
  return {
    platform: platformLabel, since: since, deadline: deadline, daysLeft: left, expires: true,
    lapsed: left < 0,
    text: left < 0
      ? `Too late on ${platformLabel} — those watchers have been there since ${prettyDay(since)}, past eBay's ${OFFER_WINDOW_DAYS}-day offer window.`
      : `Send by ${prettyDay(deadline)} — ${left === 0 ? 'today is the last day' : `${left} day${left === 1 ? '' : 's'} left`}. eBay stops letting you offer ${OFFER_WINDOW_DAYS} days after someone starts watching (watching since ${prettyDay(since)}).`,
  };
}

// Offers the daily update has lined up but not sent. It logs "Offer Prepared"
// with the amount; nothing goes to a buyer until you approve it here (logged
// as "Offer Approved"), and the next daily run sends whatever is approved.
// A prepared offer goes stale after a few days, since the listing price or
// the watchers may have moved on.
const PREPARED_OFFER_DAYS = 3;
function preparedOfferFor(itemId) {
  const prep = latestActionOfType(itemId, 'Offer Prepared');
  if (!prep || daysSince(prep.date) > PREPARED_OFFER_DAYS) return null;
  const after = a => a && state.itemActions.indexOf(a) > state.itemActions.indexOf(prep);
  if (after(latestActionOfType(itemId, 'Offer Sent'))) return null;
  if (after(latestActionOfType(itemId, 'Ignored'))) return null;
  const approved = latestActionOfType(itemId, 'Offer Approved');
  return { date: prep.date, detail: String(prep.detail || ''), approved: after(approved) ? approved : null };
}
function preparedOfferHTML(item, action) {
  const p = action && action.prepared;
  if (!p) return '';
  if (p.approved) {
    return `<div class="pa-callout pa-prepared approved">✅ <b>Approved ${escapeHtml(prettyDay(p.approved.date))}</b> — ${escapeHtml(p.detail)}. Claude sends it on the next daily run.</div>`;
  }
  return `<div class="pa-callout pa-prepared">
    <span>📝 <b>Offer ready</b> — ${escapeHtml(p.detail)}</span>
    <button type="button" class="btn small pa-approve-btn" data-id="${escapeHtml(item.itemId)}" data-detail="${escapeHtml(p.detail)}">Approve</button>
  </div>`;
}
async function approvePreparedOffer(itemId, detail, btn) {
  if (btn) btn.disabled = true;
  await recordItemAction(itemId, 'Offer Approved', detail);
  renderPricingActions();
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
    const prepared = preparedOfferFor(item.itemId);
    if (prepared) natural = { ...natural, prepared };
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
// Only worth showing where an offer is still on the table: on a live
// suggestion it's the deadline, on one already sent it's when you could go
// again. Everywhere else it would just be noise.
function offerDeadlineHTML(action) {
  const w = action && action.offerWindow;
  if (!w) return '';
  if (action.label !== 'Send an offer' && action.label !== 'Offer sent') return '';
  let text = w.text;
  let cls = '';
  if (w.expires) {
    if (w.lapsed) cls = ' lapsed';
    else if (w.daysLeft <= 7) cls = ' soon';
    if (action.label === 'Offer sent' && !w.lapsed) {
      text = `Window closes ${prettyDay(w.deadline)} — ${w.daysLeft} day${w.daysLeft === 1 ? '' : 's'} left to offer these watchers again if they don't bite.`;
    }
  }
  return `<div class="pa-callout pa-deadline${cls}">${w.lapsed ? '⚠️' : '⏳'} ${escapeHtml(text)}</div>`;
}

function renderPricingStatsNote() {
  const head = document.getElementById('sec-pricing');
  if (!head) return;
  let note = document.getElementById('pricingStatsNote');
  if (!note) {
    note = document.createElement('p');
    note.id = 'pricingStatsNote';
    note.className = 'subhead-note';
    (head.closest('summary') || head).insertAdjacentElement('afterend', note);
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

// The four labels that ask for a move live on Optimize; everything else a
// listing can be (offer out, dropped, held, on track...) is a status, and
// statuses live on Performance.
const MOVE_GROUP_KEYS = ['Send an offer', 'Try a price drop', 'Boost visibility', 'Refresh listing'];
const STATUS_GROUP_KEYS = PRICING_GROUPS.map(g => g.key).filter(k => !MOVE_GROUP_KEYS.includes(k));
function pricingGroupKeyFor(action) {
  return PRICING_GROUPS.some(g => g.key === action.label) ? action.label : 'On track';
}

// Re-renders every place a pricing card can appear. Kept under the old name
// because every button handler already calls it.
function renderPricingActions() {
  renderPricingStatsNote();
  renderPricingInto(document.getElementById('pricingActions'), MOVE_GROUP_KEYS,
    '<div class="empty-state">No moves suggested right now — every live listing is on track or already handled.</div>');
  setSectionCount('sec-pricing', state.inventory.filter(it => !isSold(it)).map(pricingActionFor)
    .filter(a => !a.hidden && MOVE_GROUP_KEYS.includes(pricingGroupKeyFor(a))).length);
  renderOptimizeToday();
  renderOptimizeTiles();
  renderOffersOut();
  renderPerformanceView();
  renderActionSummary();
}

function renderPricingInto(container, groupKeys, emptyHTML) {
  if (!container) return;
  const items = state.inventory.filter(it => !isSold(it));
  if (!items.length) { container.innerHTML = '<div class="empty-state">No active listings yet.</div>'; return; }

  const rows = items.map(it => ({ item: it, action: pricingActionFor(it) }))
    .filter(row => !row.action.hidden && groupKeys.includes(pricingGroupKeyFor(row.action)))
    .filter(row => state.showCompletedActions || row.action.severity !== 'complete');

  if (!rows.length) {
    container.innerHTML = emptyHTML || '<div class="empty-state">Nothing here.</div>';
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
    const primary = showOfferBtn
      ? `<button class="btn ar-primary pa-offer-btn" data-id="${escapeHtml(item.itemId)}" data-plat="${escapeHtml(action.offerPlatformLabel || '')}">Offer sent</button>`
      : (showPriceControls && action.suggestedPrice)
        ? `<button class="btn ar-primary pa-drop-suggested-btn" data-id="${escapeHtml(item.itemId)}" data-price="${action.suggestedPrice}">Dropped to ${fmtMoney(action.suggestedPrice)}</button>`
        : `<button class="btn ar-primary pa-complete-btn" data-id="${escapeHtml(item.itemId)}" data-completed="${isCompleted}" data-label="${escapeHtml(action.label)}">${isCompleted ? 'Reopen' : 'Mark complete'}</button>`;
    const secondaryComplete = (showOfferBtn || (showPriceControls && action.suggestedPrice))
      ? `<button class="icon-btn pa-complete-btn" data-id="${escapeHtml(item.itemId)}" data-completed="${isCompleted}" data-label="${escapeHtml(action.label)}">${isCompleted ? 'Reopen' : 'Complete'}</button>`
      : '';
    const SEV_COLOR = { opportunity: '#0d9488', urgent: '#e11d48', attention: '#d97706', handled: '#0891b2', held: '#64748b', complete: '#16a34a', dismissed: '#94a3b8', ok: '#16a34a' };
    return itemCard(item, {
      cls: `pricing-card pa-${action.severity}`,
      attrs: ` data-item-id="${escapeHtml(item.itemId)}"`,
      accent: SEV_COLOR[action.severity] || '#64748b',
      tags: tag(`${escapeHtml(action.label)}${action.manual ? ' · you' : ''}`, `tg-sev tg-sev-${action.severity}`)
        + (held ? tag('🔒 Price held', 'tg-held', 'Price drops stay off this one until you release it') : '')
        + suggestionAddedChipHTML(item, action)
        + tag(`${action.views} views · ${action.clicks} clicks${action.watchers ? ` · ${action.watchers} watching` : ''}`, 'tg-count'),
      body: `
      ${action.suggestedPrice ? `<div class="pa-callout"><b>Suggest ${fmtMoney(action.suggestedPrice)}</b></div>` : ''}
      ${offerDeadlineHTML(action)}
      ${action.offerWhere && !action.prepared ? `<div class="pa-callout"><b>${escapeHtml(action.offerWhere)}</b></div>` : ''}
      ${preparedOfferHTML(item, action)}
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
          </div>
      </div>
      <div class="status-msg pa-status"></div>
      ${itemEditPanelHTML(item)}`,
      foot: `${actionStarHTML(item.itemId, itemShortName(item))}
            ${editToggleHTML(item).replace('btn secondary ie-toggle', 'icon-btn ie-toggle')}
            <button class="icon-btn pa-delete-btn" data-id="${escapeHtml(item.itemId)}" data-label="${escapeHtml(action.label)}" aria-label="Delete action">Delete</button>`,
    });
  };

  const byGroup = new Map();
  rows.forEach(row => {
    const key = pricingGroupKeyFor(row.action);
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(row);
  });
  container.innerHTML = PRICING_GROUPS.filter(g => groupKeys.includes(g.key) && byGroup.has(g.key)).map(g => {
    const groupRows = byGroup.get(g.key).sort((a, b) => (b.action.watchers - a.action.watchers) || (b.action.views - a.action.views));
    return `
      <details class="action-group pa-group" id="${pricingGroupId(g.key)}" style="--plat:${g.color}"${g.collapsed ? '' : ' open'}>
        <summary><span class="ag-title">${escapeHtml(g.title)}</span><span class="ag-count">${groupRows.length}</span></summary>
        <div class="ic-grid">${groupRows.map(cardHTML).join('')}</div>
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
  container.querySelectorAll('.pa-approve-btn').forEach(btn => {
    btn.addEventListener('click', () => approvePreparedOffer(btn.dataset.id, btn.dataset.detail, btn));
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
state.inventoryMode = localGet('sellHub.inventoryMode', 'browse');
state.stlGroup = localGet('sellHub.stlGroup', 'site');
state.listGroup = localGet('sellHub.listGroup', 'category');
// Views / Sale speed / Offers sent moved to the Performance tab.
if (!['category', 'size'].includes(state.listGroup)) state.listGroup = 'category';
state.perfView = localGet('sellHub.perfView', 'status');
state.perfSort = localGet('sellHub.perfSort', 'views');
// Inventory sections always start collapsed; expand choices live only in-session.
state.expandedCats = new Set();
state.expandedSizes = new Set();
state.expandedRanked = new Set();
state.expandedWheelItems = new Set();
if (listGroupSelect) listGroupSelect.value = state.listGroup;
document.querySelectorAll('#stlGroupSwitch button').forEach(b => {
  b.classList.toggle('active', b.dataset.stlGroup === state.stlGroup);
  b.addEventListener('click', () => {
    state.stlGroup = b.dataset.stlGroup;
    localSet('sellHub.stlGroup', state.stlGroup);
    document.querySelectorAll('#stlGroupSwitch button').forEach(x => x.classList.toggle('active', x === b));
    renderStillToList();
  });
});
// Actions and Optimize sections fold shut and stay that way across visits.
decorateSectionHeadings();
(function rememberSectionFolds() {
  const closed = new Set(localGet('sellHub.closedSections', []));
  document.querySelectorAll('details.action-section, details.opt-block').forEach(d => {
    if (closed.has(d.id)) d.open = false;
    d.addEventListener('toggle', () => {
      if (d.open) closed.delete(d.id); else closed.add(d.id);
      localSet('sellHub.closedSections', [...closed]);
    });
  });
})();
document.getElementById('compileOpenBtn')?.addEventListener('click', () => {
  setInventoryMode(state.inventoryMode === 'compile' ? 'browse' : 'compile');
});
document.getElementById('compileSearch')?.addEventListener('input', () => renderCompilation());

renderWheel();
applyZoom();
routeOverview();
renderListChips();
renderList();
renderPickPanel();
renderFocusView();
renderOptimizeView();
setInventoryMode(state.inventoryMode);
setMode();
renderStats();
state.featuredActions = new Set(localGet('sellHub.featuredActions', []));
// Stars set in another tab (or in Life Hub's embedded copy of this site) show up here too,
// and Life Hub hears about them right away.
window.addEventListener('storage', event => {
  if (event.key !== 'sellHub.featuredActions') return;
  state.featuredActions = new Set(localGet('sellHub.featuredActions', []));
  try { renderAction(); } catch { /* views not ready yet */ }
  notifyWorkroom();
});
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
