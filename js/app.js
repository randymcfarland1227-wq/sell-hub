const state = {
  showSold: false,        // category drill-down view
  listShowSold: false,    // list mode
  listActiveCats: new Set(),
  zoom: 1,
  listSort: 'views',
  showCompletedActions: true,
  showSkippedListings: false,
  inventory: [],          // from Listing Hub (read-only, sourced from the Sheet)
  descriptions: [],       // from Listing Descriptions
  postingQueue: [],       // from Platform Posting Queue
  metrics: [],            // from Metrics tab (auto eBay + manual entries)
  acquire: [],            // from Acquire Watchlist tab
  photos: [],             // from Photos tab (cover photo per item x platform)
  trends: [],             // from Market Trends tab (curated resale categories, daily auto-refresh)
  itemActions: [],        // from Item Actions tab (price drops/offers sent/ignored, logged from pricing actions)
  featuredActions: new Set(),
  loadedAt: '',
  expandedItems: new Set(),
  editingAcquireId: null,
};

const ZOOM_MIN = 0.7, ZOOM_MAX = 1.6, ZOOM_STEP = 0.1, ZOOM_BASE = 380;

const connected = () => !!APPS_SCRIPT_URL;

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
async function apiPost(action, payload) {
  if (!connected()) return null;
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!res.ok) throw new Error('Request failed');
  return res.json();
}
function localGet(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
}
function localSet(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

const WORKROOM_ORIGIN = 'https://frontier-work-room.randymcfarland1227.workers.dev';
// Posting tasks are starred per site, separately from the item's pricing/shipping star.
function postingTaskKey(itemId, platformIdValue) { return `list:${itemId}:${platformIdValue}`; }
function isFeaturedAction(itemId) { return state.featuredActions.has(String(itemId)); }
function actionStarHTML(itemId, label) {
  const starred = isFeaturedAction(itemId);
  return `<button class="action-star${starred ? ' starred' : ''}" data-feature-action="${escapeHtml(itemId)}" aria-label="${starred ? 'Remove' : 'Feature'} ${escapeHtml(label)} in Randy's Work Room" title="${starred ? 'Featured in Work Room' : 'Feature in Work Room'}">${starred ? '★' : '☆'}</button>`;
}
function wireActionStars(root) {
  root.querySelectorAll('[data-feature-action]').forEach(btn => btn.addEventListener('click', () => {
    const id = String(btn.dataset.featureAction);
    if (state.featuredActions.has(id)) state.featuredActions.delete(id); else state.featuredActions.add(id);
    localSet('sellHub.featuredActions', [...state.featuredActions]);
    renderAction();
    syncWorkroomFromStar();
  }));
}
function resaleWorkroomSnapshot() {
  const active = state.inventory.filter(it => !isSold(it));
  const sold = state.inventory.filter(isSold);
  const latest = latestMetricsByItemPlatform();
  let listingViews = 0;
  latest.forEach(metric => { listingViews += Number(metric.views || metric.impressions) || 0; });
  const featured = active.filter(it => isFeaturedAction(it.itemId)).map(item => {
    const action = pricingActionFor(item);
    return { id: String(item.itemId), title: [item.brand, item.item].filter(Boolean).join(' — ') || item.itemId, detail: `${action.label}: ${action.reason}`, meta: `${action.views} views · ${action.clicks} clicks` };
  }).concat(sold.filter(it => !hasShipped(it.itemId) && isFeaturedAction(it.itemId)).map(item => ({
    id: String(item.itemId), title: [item.brand, item.item].filter(Boolean).join(' — ') || item.itemId, detail: 'Ship this sold item.', meta: item.soldPrice ? `Sold for ${item.soldPrice}` : 'Sold'
  }))).concat(active.flatMap(item => platformsStatusFor(item).missing
    .filter(m => isFeaturedAction(postingTaskKey(item.itemId, m.meta.id)))
    .map(m => ({
      id: postingTaskKey(item.itemId, m.meta.id),
      title: [item.brand, item.item].filter(Boolean).join(' — ') || item.itemId,
      detail: `Post it on ${m.meta.label}.`,
      meta: item.listPrice ? `List price ${fmtMoney(parseMoney(item.listPrice))}` : 'No list price yet',
    })))).concat(soldElsewhereTasks()
      .filter(t => isFeaturedAction(endTaskKey(t.item.itemId, t.meta.id)))
      .map(t => ({
        id: endTaskKey(t.item.itemId, t.meta.id),
        title: [t.item.brand, t.item.item].filter(Boolean).join(' — ') || t.item.itemId,
        detail: `It sold — take the ${t.meta.label} listing down.`,
        meta: t.item.soldPrice ? `Sold for ${t.item.soldPrice}` : 'Sold',
      })));
  return {
    source: 'resale',
    metrics: {
      listed: active.length,
      sold: sold.length,
      activeListings: active.reduce((count, item) => count + Math.max(1, splitPlatforms(item.platform).length), 0),
      listingViews,
    },
    featured,
    refreshedAt: state.loadedAt || new Date().toISOString(),
  };
}
function notifyWorkroom() {
  const message = { type: 'randys-workroom:snapshot', payload: resaleWorkroomSnapshot() };
  if (window.opener && !window.opener.closed) window.opener.postMessage(message, WORKROOM_ORIGIN);
  if (window.parent !== window) window.parent.postMessage(message, WORKROOM_ORIGIN);
}
function syncWorkroomFromStar() {
  notifyWorkroom();
  const encoded = btoa(encodeURIComponent(JSON.stringify(resaleWorkroomSnapshot())));
  window.open(`${WORKROOM_ORIGIN}/#sync=${encoded}`, 'randys-work-room');
}
window.addEventListener('message', event => {
  if (event.origin !== WORKROOM_ORIGIN || event.data?.type !== 'randys-workroom:request') return;
  event.source?.postMessage({ type: 'randys-workroom:snapshot', payload: resaleWorkroomSnapshot() }, event.origin);
});

// ---------------------------------------------------------------------
// Loading synced data — inventory/descriptions/postingQueue/metrics are
// read-only reflections of the Sheet (no local fallback data to show);
// only Acquire is a site-created CRUD domain with an offline path.
// ---------------------------------------------------------------------
async function loadInventory() {
  document.getElementById('inventorySetupNote').style.display = connected() ? 'none' : 'block';
  if (!connected()) { state.inventory = []; return; }
  try { state.inventory = ((await apiGet('inventory')) || []).filter(isRealItem); }
  catch { state.inventory = []; }
}
async function loadDescriptionsData() {
  if (!connected()) { state.descriptions = []; return; }
  try { state.descriptions = (await apiGet('descriptions')) || []; }
  catch { state.descriptions = []; }
}
async function loadPostingQueueData() {
  if (!connected()) { state.postingQueue = []; return; }
  try { state.postingQueue = (await apiGet('postingQueue')) || []; }
  catch { state.postingQueue = []; }
}
async function loadMetricsData() {
  if (!connected()) { state.metrics = []; return; }
  try { state.metrics = (await apiGet('metrics')) || []; }
  catch { state.metrics = []; }
}
async function loadPhotosData() {
  if (!connected()) { state.photos = []; return; }
  try { state.photos = (await apiGet('photos')) || []; }
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
  try { state.itemActions = (await apiGet('itemActions')) || []; }
  catch { state.itemActions = []; }
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
document.querySelectorAll('nav.tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav.tabs button').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.view).classList.add('active');
    // The wheel sizes itself from its container, which measures 0 while hidden.
    if (btn.dataset.view === 'inventory') applyZoom();
  });
});

document.getElementById('todayLabel').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

// ---------------------------------------------------------------------
// Inventory — mode switch (wheel vs list)
// ---------------------------------------------------------------------
document.querySelectorAll('#modeSwitch button').forEach(btn => {
  btn.addEventListener('click', () => setMode(btn.dataset.mode, true));
});

function setMode(mode, resetHash) {
  document.querySelectorAll('#modeSwitch button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  document.getElementById('wheelMode').style.display = mode === 'wheel' ? '' : 'none';
  document.getElementById('listMode').style.display = mode === 'list' ? '' : 'none';
  localSet('sellHub.mode', mode);
  if (mode === 'wheel' && resetHash) location.hash = '';
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
  const base = Math.min(scroll.clientWidth, ZOOM_BASE);
  const px = Math.round(base * state.zoom);
  wrap.style.width = px + 'px';
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
}

function showCategory(catId) {
  const cat = activeCategories().find(c => c.id === catId);
  if (!cat) { showWheel(); return; }

  document.getElementById('wheelView').style.display = 'none';
  const view = document.getElementById('categoryView');
  view.style.display = '';
  view.style.setProperty('--cat', cat.color);

  document.getElementById('catIcon').textContent = cat.icon;
  document.getElementById('catLabel').textContent = cat.label;
  const count = state.inventory.filter(it => categoryMeta(it.category).id === catId).length;
  document.getElementById('catBlurb').textContent = `${count} item${count === 1 ? '' : 's'} in this category`;

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
        <span>Photo pending</span>
      </div>
      <div class="card-top">
        <h3>${escapeHtml(title)}</h3>
        <span class="status-badge ${statusClass(item.sourceStatus)}">${escapeHtml(item.sourceStatus || '—')}</span>
      </div>
      ${actionBadgesHTML(item.itemId)}
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
      <input type="text" class="ms-price" placeholder="Sold price">
      <input type="text" class="ms-buyer" placeholder="Buyer (optional)">
      <button class="btn secondary ms-submit" data-id="${item.itemId}" data-source="${escapeHtml(item.sourceTab || '')}">Mark sold</button>
    </div>
    <div class="status-msg ms-status"></div>
  ` : '';

  return `<div class="item-detail">${blocks}${soldForm}</div>`;
}

function wireItemCards(container, onChange) {
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
}

async function markSold(btn, onChange) {
  const card = btn.closest('.item-detail');
  const status = card.querySelector('.ms-status');
  const price = card.querySelector('.ms-price').value.trim();
  const buyer = card.querySelector('.ms-buyer').value.trim();
  const itemId = btn.dataset.id;
  const sourceTab = btn.dataset.source;
  if (!price) { status.textContent = 'Enter a sold price.'; return; }
  if (!connected()) { status.textContent = 'Connect your Sheet to mark items sold — see SETUP.md.'; return; }

  status.textContent = 'Saving...';
  try {
    const res = await apiPost('markSold', { itemId, sourceTab, soldPrice: price, buyer });
    if (!res || !res.ok) { status.textContent = (res && res.error) || 'Could not find that row in the Sheet.'; return; }
    const item = state.inventory.find(i => i.itemId === itemId);
    if (item) { item.sourceStatus = 'Sold'; item.soldPrice = price; item.buyer = buyer; }
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

function renderCategoryCards(cat) {
  const grid = document.getElementById('categoryCards');
  let items = state.inventory.filter(it => categoryMeta(it.category).id === cat.id);
  if (!state.showSold) items = items.filter(it => !isSold(it));
  items = items.slice().sort((a, b) => (a.item || a.brand || '').localeCompare(b.item || b.brand || ''));

  grid.innerHTML = items.length ? items.map(it => itemCardHTML(it, cat)).join('') : '<div class="empty-state">Nothing here yet.</div>';
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
    views += Number(snap && (snap.views || snap.impressions)) || 0;
    clicks += Number(snap && snap.clicks) || 0;
  });
  return { views, clicks, ctr: views ? clicks / views : 0, price: parseMoney(item.listPrice) };
}

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

  if (state.listSort !== 'name') {
    let items = state.inventory.filter(it => state.listActiveCats.has(categoryMeta(it.category).id));
    if (!state.listShowSold) items = items.filter(it => !isSold(it));
    const ranked = items.map(it => ({ it, stats: itemSortStats(it, latestByPlatform) })).sort(compareItems);
    const labels = { views: 'Most views', clicks: 'Most clicks', ctr: 'Highest click rate', price: 'Highest price' };
    container.innerHTML = ranked.length ? `
      <div class="cat-section ranked-section">
        <div class="cat-heading"><span class="rank-mark">#</span><h2>${labels[state.listSort]}</h2><span class="count">${ranked.length} items</span></div>
        <div class="card-grid">${ranked.map(({ it }) => itemCardHTML(it, categoryMeta(it.category))).join('')}</div>
      </div>
    ` : '<div class="empty-state">No inventory matches these filters.</div>';
    wireItemCards(container, renderList);
    return;
  }

  activeCategories().filter(c => state.listActiveCats.has(c.id)).forEach(cat => {
    let items = state.inventory.filter(it => categoryMeta(it.category).id === cat.id);
    if (!state.listShowSold) items = items.filter(it => !isSold(it));
    const withStats = items.map(it => ({ it, stats: itemSortStats(it, latestByPlatform) }));
    withStats.sort(compareItems);
    items = withStats.map(x => x.it);

    const section = document.createElement('div');
    section.className = 'cat-section';
    section.style.setProperty('--cat', cat.color);
    section.innerHTML = `
      <div class="cat-heading">
        <span class="icon">${cat.icon}</span>
        <h2>${cat.label}</h2>
        <span class="count">${items.length}</span>
      </div>
      ${items.length ? `<div class="card-grid">${items.map(it => itemCardHTML(it, cat)).join('')}</div>` : '<div class="empty-state">Nothing here yet.</div>'}
    `;
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
  renderOverallTiles();
  renderPlatformCards();
}

function renderOverallTiles() {
  const items = state.inventory;
  const listed = items.filter(it => !isSold(it)).length;
  const sold = items.filter(isSold).length;
  const estValue = items.filter(it => !isSold(it)).reduce((s, it) => s + parseMoney(it.estValue), 0);
  const netCash = items.filter(isSold).reduce((s, it) => s + parseMoney(it.netCash || it.soldPrice), 0);
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
}
function renderToShip() {
  const container = document.getElementById('toShipList');
  if (!container) return;
  const items = state.inventory.filter(it => isSold(it) && !hasShipped(it.itemId));
  if (!items.length) { container.innerHTML = '<div class="empty-state">Nothing waiting to ship.</div>'; return; }

  const sorted = items.slice().sort((a, b) => (soldDateFor(a.itemId) || '').localeCompare(soldDateFor(b.itemId) || ''));
  container.innerHTML = sorted.map(it => {
    const soldDate = soldDateFor(it.itemId);
    return `
      <div class="card to-ship-card" style="--cat:#1f5c46">
      <div class="card-top">
        <h3>${escapeHtml([it.brand, it.item].filter(Boolean).join(' — ') || it.itemId)}</h3>
        ${actionStarHTML(it.itemId, [it.brand, it.item].filter(Boolean).join(' ') || it.itemId)}
        </div>
        <div class="meta">
          <span><b>Sold price —</b> ${escapeHtml(it.soldPrice || '—')}</span>
          ${it.buyer ? `<span><b>Buyer/platform —</b> ${escapeHtml(it.buyer)}</span>` : ''}
          ${soldDate ? `<span><b>Sold —</b> ${escapeHtml(soldDate)}</span>` : ''}
        </div>
        <button class="btn secondary ts-ship-btn" data-id="${escapeHtml(it.itemId)}">Mark shipped</button>
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
    const soldOn = platformId(item.buyer);
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
  if (!tasks.length) { container.innerHTML = '<div class="empty-state">No sold item still has a listing up elsewhere.</div>'; return; }

  container.innerHTML = tasks.map(({ item, meta, entry, soldOn }) => {
    const title = [item.brand, item.item].filter(Boolean).join(' — ') || item.itemId;
    const soldWhere = soldOn ? ` on ${escapeHtml(platformMeta(item.buyer).label)}` : item.buyer ? ` (${escapeHtml(item.buyer)})` : '';
    return `
      <div class="card end-card">
        <div class="card-top">
          <h3>${escapeHtml(title)}</h3>
          <div class="card-top-actions">${actionStarHTML(endTaskKey(item.itemId, meta.id), `${title} on ${meta.label}`)}<span class="stl-chip stl-done" style="--plat:${meta.color}">${escapeHtml(meta.label)}</span></div>
        </div>
        <div class="meta">
          <span><b>Sold —</b> ${escapeHtml(item.soldPrice || '—')}${soldWhere}</span>
          <span><b>Still up on —</b> ${escapeHtml(meta.label)}</span>
        </div>
        <div class="stl-platform-row">
          ${entry && entry.listingUrl ? `<a class="btn secondary" href="${escapeHtml(entry.listingUrl)}" target="_blank" rel="noopener">Open listing</a>` : ''}
          <button class="btn secondary end-btn" data-id="${escapeHtml(item.itemId)}" data-platform="${escapeHtml(meta.label)}" data-listing="${escapeHtml((entry && entry.listingId) || '')}">Mark ended on ${escapeHtml(meta.label)}</button>
        </div>
      </div>`;
  }).join('');

  wireActionStars(container);
  container.querySelectorAll('.end-btn').forEach(btn => btn.addEventListener('click', () => {
    btn.disabled = true;
    endListingElsewhere(btn.dataset.id, btn.dataset.platform, btn.dataset.listing);
  }));
}

function renderAction() {
  renderToShip();
  renderSoldElsewhere();
  renderStillToList();
  renderPricingActions();
  renderActionSummary();
}

function renderActionSummary() {
  const container = document.getElementById('actionSummary');
  if (!container) return;
  const toShip = state.inventory.filter(it => isSold(it) && !hasShipped(it.itemId)).length;
  const toList = stillToListRows().reduce((n, r) => n + r.status.missing.length, 0);
  const counts = {};
  state.inventory.filter(it => !isSold(it)).forEach(it => {
    const a = pricingActionFor(it);
    if (!a.hidden) counts[a.label] = (counts[a.label] || 0) + 1;
  });
  const visibility = (counts['Boost visibility'] || 0) + (counts['Refresh listing'] || 0);
  const tiles = [
    { num: toShip, lbl: 'To ship', target: 'sec-ship' },
    { num: soldElsewhereTasks().length, lbl: 'Listings to end', target: 'sec-end' },
    { num: toList, lbl: 'Posts to make', target: 'sec-list' },
    { num: counts['Send an offer'] || 0, lbl: 'Offers to send', target: pricingGroupId('Send an offer') },
    { num: counts['Try a price drop'] || 0, lbl: 'Price drops', target: pricingGroupId('Try a price drop') },
    { num: visibility, lbl: 'Need visibility', target: pricingGroupId(counts['Boost visibility'] ? 'Boost visibility' : 'Refresh listing') },
  ];
  container.innerHTML = tiles.map(t => `<button class="as-tile${t.num ? '' : ' as-zero'}" data-target="${t.target}"><span class="num">${t.num}</span><span class="lbl">${t.lbl}</span></button>`).join('');
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
function isPlatformLive(entry) {
  if (!entry) return false;
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

  if (!groups.size && !skippedRows.length) {
    container.innerHTML = `<div class="empty-state">${siteFilter ? 'Nothing outstanding for that platform.' : 'Everything is listed everywhere it should be.'}</div>`;
    return;
  }

  const byName = function (a, b) { return (a.item.item || a.item.brand || '').localeCompare(b.item.item || b.item.brand || ''); };
  const itemTitle = function (item) { return [item.brand, item.item].filter(Boolean).join(' — ') || item.itemId; };

  const groupHTML = Array.from(groups.values())
    .sort(function (a, b) { return platformRank(a.meta.id) - platformRank(b.meta.id) || a.meta.label.localeCompare(b.meta.label); })
    .map(function (g) {
      const cards = g.rows.slice().sort(byName).map(function ({ item, status }) {
        const live = status.done.map(function (d) { return d.meta.label; });
        const elsewhere = status.missing.filter(function (m) { return m.meta.id !== g.meta.id; }).map(function (m) { return m.meta.label; });
        return `
          <div class="card stl-card" style="--cat:${g.meta.color}">
            <div class="card-top">
              <h3>${escapeHtml(itemTitle(item))}</h3>
              <div class="card-top-actions">${actionStarHTML(postingTaskKey(item.itemId, g.meta.id), `${itemTitle(item)} on ${g.meta.label}`)}<span class="status-badge ${statusClass(item.sourceStatus)}">${escapeHtml(item.sourceStatus || '—')}</span></div>
            </div>
            <div class="meta">
              <span><b>List price —</b> ${priceLineHTML(item)}${item.floorPrice ? ` (floor ${escapeHtml(item.floorPrice)})` : ''}</span>
              ${live.length ? `<span><b>Live on —</b> ${escapeHtml(live.join(', '))}</span>` : ''}
              ${elsewhere.length ? `<span><b>Also still needs —</b> ${escapeHtml(elsewhere.join(', '))}</span>` : ''}
            </div>
            <div class="stl-platform-row">
              <button class="btn secondary stl-listed-btn" data-id="${escapeHtml(item.itemId)}" data-platform="${escapeHtml(g.meta.label)}">Mark listed</button>
              <button class="icon-btn stl-skip-btn" data-id="${escapeHtml(item.itemId)}" data-platform="${escapeHtml(g.meta.label)}">Not posting</button>
              ${editToggleHTML(item)}
            </div>
            ${itemEditPanelHTML(item)}
          </div>`;
      }).join('');
      return `
        <details class="action-group stl-group" id="stl-group-${escapeHtml(g.meta.id)}" style="--plat:${g.meta.color}" open>
          <summary><span class="ag-title">${escapeHtml(g.meta.label)}</span><span class="ag-count">${g.rows.length}</span></summary>
          <div class="card-grid">${cards}</div>
        </details>`;
    }).join('');

  const skippedHTML = skippedRows.length ? `
    <details class="action-group stl-group" open>
      <summary><span class="ag-title">Not posting</span><span class="ag-count">${skippedRows.length}</span></summary>
      <div class="card-grid">${skippedRows.slice().sort(byName).map(function ({ item, status }) {
        const skipped = status.skipped.filter(function (s) { return !siteFilter || s.meta.id === siteFilter; });
        return `
          <div class="card stl-card">
            <div class="card-top"><h3>${escapeHtml(itemTitle(item))}</h3></div>
            <div class="stl-chips">${skipped.map(function (s) {
              return `<div class="stl-platform-row"><span class="stl-chip stl-skipped" style="--plat:${s.meta.color}">Not posting · ${escapeHtml(s.meta.label)}</span><button class="btn secondary stl-reopen-btn" data-id="${escapeHtml(item.itemId)}" data-platform="${escapeHtml(s.meta.label)}">Reopen</button></div>`;
            }).join('')}</div>
          </div>`;
      }).join('')}</div>
    </details>` : '';

  container.innerHTML = groupHTML + skippedHTML;
  wireActionStars(container);
  wireItemEditors(container);
  container.querySelectorAll('.stl-listed-btn').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      await recordItemAction(btn.dataset.id, 'Listing Posted', btn.dataset.platform);
      renderStillToList();
    });
  });
  container.querySelectorAll('.stl-skip-btn').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      await recordItemAction(btn.dataset.id, 'Not Posting', btn.dataset.platform);
      renderStillToList();
    });
  });
  container.querySelectorAll('.stl-reopen-btn').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      await recordItemAction(btn.dataset.id, 'Reopened Listing', btn.dataset.platform);
      renderStillToList();
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
    views += Number(snap && (snap.views || snap.impressions)) || 0;
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

// Pricing suggestions are shown in these sections, in this order. Anything
// that needs a move from you is open; waiting/done sections start collapsed.
const PRICING_GROUPS = [
  { key: 'Send an offer', title: 'Send an offer', color: '#1f3a5c', blurb: 'Someone is watching or liked it — nudge them with an offer.' },
  { key: 'Try a price drop', title: 'Try a price drop', color: '#7a2038', blurb: 'Getting views but few clicks — price is the likely sticking point.' },
  { key: 'Boost visibility', title: 'Boost visibility', color: '#a1752e', blurb: 'No views yet — refresh it, sharpen the title, or share it.' },
  { key: 'Refresh listing', title: 'Refresh listing', color: '#a1752e', blurb: 'Already near your floor — new photos or copy instead of a lower price.' },
  { key: 'Offer sent', title: 'Offer sent — waiting', color: '#1f5c64', collapsed: true },
  { key: 'Price dropped', title: 'Price dropped — waiting', color: '#1f5c64', collapsed: true },
  { key: 'Hold', title: 'On hold', color: '#56657a', collapsed: true },
  { key: 'Dismissed', title: 'Dismissed today', color: '#74849a', collapsed: true },
  { key: 'On track', title: 'On track', color: '#1f5c46', collapsed: true },
  { key: 'No data yet', title: 'No data yet', color: '#74849a', collapsed: true },
  { key: 'Completed', title: 'Completed', color: '#16836a', collapsed: true },
];
function pricingGroupId(label) { return 'pa-group-' + categoryId(label); }

function renderPricingActions() {
  const container = document.getElementById('pricingActions');
  if (!container) return;
  const items = state.inventory.filter(it => !isSold(it));
  if (!items.length) { container.innerHTML = '<div class="empty-state">No active listings yet.</div>'; return; }

  const rows = items.map(it => ({ item: it, action: pricingActionFor(it) }))
    .filter(row => !row.action.hidden && (state.showCompletedActions || row.action.severity !== 'complete'));

  if (!rows.length) { container.innerHTML = '<div class="empty-state">No open actions. Turn on “show completed” to review finished items.</div>'; return; }

  const cardHTML = ({ item, action }) => {
    const isCompleted = action.severity === 'complete';
    const showOfferBtn = action.severity === 'opportunity';
    const showPriceControls = action.severity === 'urgent' || (action.severity === 'attention' && action.label === 'Refresh listing');
    const showIgnore = ['urgent', 'attention', 'opportunity'].includes(action.severity);
    return `
    <div class="card pricing-card pa-${action.severity}" data-item-id="${escapeHtml(item.itemId)}">
      <div class="card-top">
        <h3>${escapeHtml([item.brand, item.item].filter(Boolean).join(' — ') || item.itemId)}</h3>
        <div class="card-top-actions">${actionStarHTML(item.itemId, [item.brand, item.item].filter(Boolean).join(' ') || item.itemId)}<span class="pa-badge pa-${action.severity}">${escapeHtml(action.label)}${action.manual ? ' · set by you' : ''}</span></div>
      </div>
      <div class="meta">
        <span><b>List price —</b> ${priceLineHTML(item)}${item.floorPrice ? ` (floor ${escapeHtml(item.floorPrice)})` : ''}</span>
        <span><b>Views —</b> ${action.views} &nbsp; <b>Clicks —</b> ${action.clicks}${action.watchers ? ` &nbsp; <b>Watchers —</b> ${action.watchers}` : ''}</span>
        <span><b>Posting to —</b> ${escapeHtml(splitPlatforms(item.platform).map(p => platformMeta(p).label).join(', ') || '—')}</span>
      </div>
      ${action.suggestedPrice ? `<div class="pa-callout"><b>Suggested price — ${fmtMoney(action.suggestedPrice)}</b></div>` : ''}
      ${action.offerWhere ? `<div class="pa-callout"><b>${escapeHtml(action.offerWhere)}</b></div>` : ''}
      <p class="pa-reason">${escapeHtml(action.reason)}</p>
      <div class="pa-actions">
          ${showOfferBtn ? `<button class="btn secondary pa-offer-btn" data-id="${escapeHtml(item.itemId)}" data-plat="${escapeHtml(action.offerPlatformLabel || '')}">Offer sent</button>` : ''}
          ${showPriceControls && action.suggestedPrice ? `<button class="btn secondary pa-drop-suggested-btn" data-id="${escapeHtml(item.itemId)}" data-price="${action.suggestedPrice}">Dropped to ${fmtMoney(action.suggestedPrice)}</button>` : ''}
          ${showPriceControls ? `
            <span class="pa-custom-price">
              <input type="number" min="0" step="1" class="pa-custom-input" placeholder="Custom $">
              <button class="btn secondary pa-drop-custom-btn" data-id="${escapeHtml(item.itemId)}">Save</button>
            </span>
          ` : ''}
          ${showIgnore ? `<button class="icon-btn pa-ignore-btn" data-id="${escapeHtml(item.itemId)}" data-label="${escapeHtml(action.label)}">Ignore</button>` : ''}
          <button class="btn secondary pa-complete-btn" data-id="${escapeHtml(item.itemId)}" data-completed="${isCompleted}" data-label="${escapeHtml(action.label)}">${isCompleted ? 'Reopen' : 'Mark complete'}</button>
          ${editToggleHTML(item)}
          <button class="icon-btn pa-delete-btn" data-id="${escapeHtml(item.itemId)}" data-label="${escapeHtml(action.label)}" aria-label="Delete action">Delete</button>
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
        <summary><span class="ag-title">${escapeHtml(g.title)}</span><span class="ag-count">${groupRows.length}</span>${g.blurb ? `<span class="ag-blurb">${escapeHtml(g.blurb)}</span>` : ''}</summary>
        <div class="card-grid">${groupRows.map(cardHTML).join('')}</div>
      </details>`;
  }).join('');

  wireActionStars(container);
  wireItemEditors(container);

  container.querySelectorAll('.pa-offer-btn').forEach(btn => {
    btn.addEventListener('click', () => sendOfferForAction(btn.dataset.id, btn.dataset.plat));
  });
  container.querySelectorAll('.pa-ignore-btn').forEach(btn => {
    btn.addEventListener('click', () => ignoreAction(btn.dataset.id, btn.dataset.label));
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

// ---------------------------------------------------------------------
// Acquire — full CRUD watchlist, same online/offline dual-path as
// routine-hub's Inbox.
// ---------------------------------------------------------------------
async function loadAcquire() {
  document.getElementById('acquireSetupNote').style.display = connected() ? 'none' : 'block';
  if (connected()) {
    try { state.acquire = (await apiGet('acquire')) || []; }
    catch { state.acquire = []; document.getElementById('acquireStatus').textContent = 'Could not reach your Sheet.'; }
  } else {
    state.acquire = localGet('sellHub.acquire.local', []);
  }
  renderAcquire();
}

async function loadTrendsData() {
  if (!connected()) { state.trends = []; return; }
  try { state.trends = (await apiGet('trends')) || []; }
  catch { state.trends = []; }
}

const TREND_CATEGORY_ORDER = ['Outerwear', 'Shirts', 'Pants', 'Shoes', 'Accessories', 'Other'];
const TREND_CATEGORY_ICON = { Outerwear: '🧥', Shirts: '👕', Pants: '👖', Shoes: '👟', Accessories: '👜', Other: '🏷️' };
const TREND_CATEGORY_COLOR = { Outerwear: '#1f3a5c', Shirts: '#1f5c46', Pants: '#a1752e', Shoes: '#1f5c64', Accessories: '#5c3a63', Other: '#a2532f' };

function trendCardHTML(c) {
  return `
    <div class="trend-card">
      ${c.imageUrl ? `<img class="trend-photo" src="${escapeHtml(c.imageUrl)}" alt="" loading="lazy">` : ''}
      <h4>${escapeHtml(c.term)}</h4>
      ${c.platforms.map(p => `
        <div class="prow"><span>${escapeHtml(p.platform)} avg sold</span><b>${fmtMoney(Number(p.avgSoldPrice))}</b></div>
        <div class="prow"><span>${escapeHtml(p.platform)} sales found</span><b>${p.recentSalesFound}</b></div>
        ${p.sellThrough ? `<div class="prow"><span>${escapeHtml(p.platform)} sell-through</span><b>${p.sellThrough}%</b></div>` : ''}
      `).join('')}
      <div class="trend-date">as of ${escapeHtml(c.platforms[0].lastChecked || '')}</div>
    </div>
  `;
}

function renderTrends() {
  const container = document.getElementById('trendsCards');
  if (!container) return;

  // Trends come as one row per (term x platform) — group into one card per term.
  const byTerm = new Map();
  state.trends.forEach(t => {
    if (!t.avgSoldPrice) return;
    const entry = byTerm.get(t.searchTerm) || { term: t.searchTerm, platforms: [], imageUrl: '', category: '' };
    entry.platforms.push(t);
    if (t.imageUrl && !entry.imageUrl) entry.imageUrl = t.imageUrl;
    if (t.category && !entry.category) entry.category = t.category;
    byTerm.set(t.searchTerm, entry);
  });
  const cards = [...byTerm.values()];

  if (!cards.length) {
    container.innerHTML = '<div class="empty-state">No trend data yet — refreshes automatically once a day (see SETUP.md to turn it on).</div>';
    return;
  }

  // Group into categories (Outerwear/Shirts/Pants/Shoes/Accessories/Other),
  // most-sold-first within each, so sourcing targets read like a shopping
  // list by department instead of one flat undifferentiated grid.
  const byCategory = new Map();
  cards.forEach(c => {
    const cat = TREND_CATEGORY_ORDER.includes(c.category) ? c.category : 'Other';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(c);
  });
  byCategory.forEach(list => list.sort((a, b) =>
    b.platforms.reduce((s, p) => s + Number(p.recentSalesFound || 0), 0) -
    a.platforms.reduce((s, p) => s + Number(p.recentSalesFound || 0), 0)
  ));

  container.innerHTML = TREND_CATEGORY_ORDER.filter(cat => byCategory.has(cat)).map(cat => `
    <div class="cat-section" style="--cat:${TREND_CATEGORY_COLOR[cat] || TREND_CATEGORY_COLOR.Other}">
      <div class="cat-heading">
        <span class="icon">${TREND_CATEGORY_ICON[cat] || '🏷️'}</span>
        <h2>${escapeHtml(cat)}</h2>
        <span class="count">${byCategory.get(cat).length}</span>
      </div>
      <div class="platform-cards">${byCategory.get(cat).map(trendCardHTML).join('')}</div>
    </div>
  `).join('');
}

function acquireCardHTML(a) {
  const pri = PRIORITY_META[a.priority] || PRIORITY_META.Medium;
  const editing = String(state.editingAcquireId) === String(a.id);
  if (editing) {
    return `
      <div class="acquire-card" style="--pri:${pri.color}">
        <div class="field"><label>Brand</label><input type="text" class="ae-brand" value="${escapeHtml(a.brand)}"></div>
        <div class="field"><label>Item type</label><input type="text" class="ae-itemType" value="${escapeHtml(a.itemType)}"></div>
        <div class="field-row">
          <div class="field"><label>Size</label><input type="text" class="ae-size" value="${escapeHtml(a.size)}"></div>
          <div class="field"><label>Color</label><input type="text" class="ae-color" value="${escapeHtml(a.color)}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Condition</label><input type="text" class="ae-condition" value="${escapeHtml(a.condition)}"></div>
          <div class="field"><label>Target price</label><input type="text" class="ae-targetPrice" value="${escapeHtml(a.targetPrice)}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Best platform</label><select class="ae-bestPlatform">${platformOptionsHTML(a.bestPlatform)}</select></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Priority</label>
            <select class="ae-priority">${['High', 'Medium', 'Low'].map(p => `<option value="${p}"${p === a.priority ? ' selected' : ''}>${p}</option>`).join('')}</select>
          </div>
          <div class="field"><label>Notes</label><input type="text" class="ae-notes" value="${escapeHtml(a.notes)}"></div>
        </div>
        <button class="btn ae-save" data-id="${a.id}">Save</button>
        <button class="btn secondary ae-cancel">Cancel</button>
        <div class="status-msg ae-status"></div>
      </div>
    `;
  }
  return `
    <div class="acquire-card" style="--pri:${pri.color}">
      ${a.imageUrl ? `<img class="acquire-photo" src="${escapeHtml(a.imageUrl)}" alt="" loading="lazy">` : ''}
      <h3>${escapeHtml(a.brand)} — ${escapeHtml(a.itemType)}<span class="priority-tag">${escapeHtml(a.priority || 'Medium')}</span></h3>
      <div class="meta">
        ${a.size ? `<span><b>Size —</b> ${escapeHtml(a.size)}</span>` : ''}
        ${a.color ? `<span><b>Color —</b> ${escapeHtml(a.color)}</span>` : ''}
        ${a.condition ? `<span><b>Condition —</b> ${escapeHtml(a.condition)}</span>` : ''}
        ${a.targetPrice ? `<span><b>Target price —</b> ${escapeHtml(a.targetPrice)}</span>` : ''}
        ${a.bestPlatform ? `<span><b>Best platform —</b> ${escapeHtml((PLATFORM_META[a.bestPlatform] || { label: a.bestPlatform }).label)}</span>` : ''}
      </div>
      ${a.notes ? `<p class="notes">${escapeHtml(a.notes)}</p>` : ''}
      ${a.ebayAvgPrice || a.poshmarkAvgPrice ? `
        <div class="market-data">
          ${a.ebayAvgPrice ? `<span><b>${fmtMoney(Number(a.ebayAvgPrice))}</b> eBay avg (${a.ebaySalesFound} sold${a.ebaySellThrough ? `, ${a.ebaySellThrough}% sell-through` : ''})</span>` : ''}
          ${a.poshmarkAvgPrice ? `<span><b>${fmtMoney(Number(a.poshmarkAvgPrice))}</b> Poshmark avg (${a.poshmarkSalesFound} found)</span>` : ''}
          <span class="market-data-date">as of ${escapeHtml(a.lastChecked || '')}</span>
        </div>
      ` : '<div class="market-data market-data-pending">No market data yet — Poshmark updates daily; eBay needs a manual refresh (ask Claude, or run it yourself via Terapeak in Seller Hub).</div>'}
      <button class="icon-btn ae-edit-btn" title="Edit" data-id="${a.id}">✎</button>
      <button class="icon-btn card-delete-btn ae-delete-btn" title="Delete" data-id="${a.id}">✕</button>
    </div>
  `;
}

function renderAcquire() {
  const list = document.getElementById('acquireList');
  if (!state.acquire.length) { list.innerHTML = '<div class="empty-state">Nothing on the watchlist yet.</div>'; return; }

  const order = { High: 0, Medium: 1, Low: 2 };
  const sorted = state.acquire.slice().sort((a, b) => (order[a.priority] ?? 1) - (order[b.priority] ?? 1));
  list.innerHTML = sorted.map(acquireCardHTML).join('');

  list.querySelectorAll('.ae-edit-btn').forEach(btn => btn.addEventListener('click', () => { state.editingAcquireId = btn.dataset.id; renderAcquire(); }));
  list.querySelectorAll('.ae-delete-btn').forEach(btn => btn.addEventListener('click', () => deleteAcquireItem(btn.dataset.id)));
  list.querySelectorAll('.ae-cancel').forEach(btn => btn.addEventListener('click', () => { state.editingAcquireId = null; renderAcquire(); }));
  list.querySelectorAll('.ae-save').forEach(btn => btn.addEventListener('click', () => saveAcquireEdit(btn.dataset.id, btn.closest('.acquire-card'))));
}

async function saveAcquireEdit(id, card) {
  const status = card.querySelector('.ae-status');
  const body = {
    id,
    brand: card.querySelector('.ae-brand').value.trim(),
    itemType: card.querySelector('.ae-itemType').value.trim(),
    size: card.querySelector('.ae-size').value.trim(),
    color: card.querySelector('.ae-color').value.trim(),
    condition: card.querySelector('.ae-condition').value.trim(),
    targetPrice: card.querySelector('.ae-targetPrice').value.trim(),
    bestPlatform: card.querySelector('.ae-bestPlatform').value,
    priority: card.querySelector('.ae-priority').value,
    notes: card.querySelector('.ae-notes').value.trim(),
  };
  if (!body.brand || !body.itemType) { status.textContent = 'Fill in brand and item type.'; return; }
  status.textContent = 'Saving...';

  let saved = null;
  if (connected()) {
    try { saved = await apiPost('updateAcquireItem', body); }
    catch { status.textContent = 'Could not save to your Sheet.'; return; }
  }
  const item = state.acquire.find(a => String(a.id) === String(id));
  if (item) Object.assign(item, body, saved || {});
  if (!connected()) localSet('sellHub.acquire.local', state.acquire);

  state.editingAcquireId = null;
  renderAcquire();
}

async function addAcquireItem() {
  const status = document.getElementById('acquireStatus');
  const body = {
    brand: document.getElementById('acqBrand').value.trim(),
    itemType: document.getElementById('acqItemType').value.trim(),
    size: document.getElementById('acqSize').value.trim(),
    color: document.getElementById('acqColor').value.trim(),
    condition: document.getElementById('acqCondition').value.trim(),
    targetPrice: document.getElementById('acqTargetPrice').value.trim(),
    bestPlatform: document.getElementById('acqBestPlatform').value,
    priority: document.getElementById('acqPriority').value,
    notes: document.getElementById('acqNotes').value.trim(),
  };
  if (!body.brand || !body.itemType) { status.textContent = 'Fill in brand and item type.'; return; }
  status.textContent = 'Saving...';

  const today = todayStr();
  const localEntry = { ...body, id: `acq-${Date.now()}`, dateAdded: today };

  if (connected()) {
    try {
      const saved = await apiPost('addAcquireItem', body);
      if (!saved || !saved.id) { status.textContent = 'Sheet did not confirm the save — is Code.gs redeployed?'; return; }
      state.acquire.push({ ...body, ...saved });
    } catch { status.textContent = 'Could not save to your Sheet.'; return; }
  } else {
    state.acquire.push(localEntry);
    localSet('sellHub.acquire.local', state.acquire);
  }

  ['acqBrand', 'acqItemType', 'acqSize', 'acqColor', 'acqCondition', 'acqTargetPrice', 'acqNotes'].forEach(id => document.getElementById(id).value = '');
  status.textContent = 'Added.';
  setTimeout(() => status.textContent = '', 1500);
  renderAcquire();
}

async function deleteAcquireItem(id) {
  if (!confirm('Remove this from the watchlist?')) return;
  state.acquire = state.acquire.filter(a => String(a.id) !== String(id));
  renderAcquire();
  if (connected()) {
    try { await apiPost('deleteAcquireItem', { id }); }
    catch { /* already removed locally; Sheet will drift until next successful call */ }
  } else {
    localSet('sellHub.acquire.local', state.acquire);
  }
}

document.getElementById('acquireAddToggle').addEventListener('click', () => {
  const panel = document.getElementById('acquireAddPanel');
  const open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : '';
  document.getElementById('acquireAddToggle').textContent = open ? '+ Add to watchlist' : '− Close';
});
document.getElementById('addAcquireBtn').addEventListener('click', addAcquireItem);

// ---------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------
document.getElementById('acqBestPlatform').innerHTML = platformOptionsHTML();

renderWheel();
applyZoom();
routeOverview();
renderListChips();
renderList();
setMode(localGet('sellHub.mode', 'list'));
renderStats();
state.featuredActions = new Set(localGet('sellHub.featuredActions', []));
renderAction();
populateMetricForm();
loadAcquire();
loadTrendsData().then(renderTrends);

Promise.all([loadInventory(), loadDescriptionsData(), loadPostingQueueData(), loadMetricsData(), loadPhotosData(), loadItemActionsData()]).then(() => {
  state.loadedAt = new Date().toISOString();
  renderWheel();
  routeOverview();
  renderListChips();
  renderList();
  renderStats();
  renderAction();
  notifyWorkroom();
  populateMetricForm();
});
