const state = {
  showSold: false,        // category drill-down view
  listShowSold: false,    // list mode
  listActiveCats: new Set(),
  zoom: 1,
  listSort: 'name',
  inventory: [],          // from Listing Hub (read-only, sourced from the Sheet)
  descriptions: [],       // from Listing Descriptions
  postingQueue: [],       // from Platform Posting Queue
  metrics: [],            // from Metrics tab (auto eBay + manual entries)
  acquire: [],            // from Acquire Watchlist tab
  photos: [],             // from Photos tab (cover photo per item x platform)
  trends: [],             // from Market Trends tab (curated resale categories, daily auto-refresh)
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
  return null;
}
function platformMeta(name) {
  const id = platformId(name);
  if (id && PLATFORM_META[id]) return { id, ...PLATFORM_META[id] };
  return { id: id || categoryId(name) || 'other', label: name || DEFAULT_PLATFORM_META.label, color: DEFAULT_PLATFORM_META.color };
}
function splitPlatforms(field) {
  return String(field || '').split(',').map(s => s.trim()).filter(Boolean);
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
  const match = state.photos.find(p => p.itemId === itemId && p.photoUrl);
  return match ? match.photoUrl : null;
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
  const price = item.listPrice ? fmtMoney(parseMoney(item.listPrice)) : '—';
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

function itemCardHTML(item, cat) {
  const sold = isSold(item);
  const expanded = state.expandedItems.has(item.itemId);
  const titleParts = [item.brand, item.item].filter(Boolean);
  const photo = photoForItem(item.itemId);
  return `
    <div class="card${sold ? ' sold' : ''}" style="--cat:${cat.color}">
      ${photo ? `<img class="card-photo" src="${escapeHtml(photo)}" alt="" loading="lazy">` : ''}
      <div class="card-top">
        <h3>${escapeHtml(titleParts.join(' — ') || item.itemId)}</h3>
        <span class="status-badge ${statusClass(item.sourceStatus)}">${escapeHtml(item.sourceStatus || '—')}</span>
      </div>
      <div class="meta">
        ${item.size ? `<span><b>Size —</b> ${escapeHtml(item.size)}</span>` : ''}
        ${item.condition ? `<span><b>Condition —</b> ${escapeHtml(item.condition)}</span>` : ''}
        <span><b>List price —</b> ${escapeHtml(item.listPrice || '—')}${item.floorPrice ? ` (floor ${escapeHtml(item.floorPrice)})` : ''}</span>
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
    status.textContent = 'Marked sold.';
    onChange();
    renderWheel();
    renderStats();
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

  activeCategories().filter(c => state.listActiveCats.has(c.id)).forEach(cat => {
    let items = state.inventory.filter(it => categoryMeta(it.category).id === cat.id);
    if (!state.listShowSold) items = items.filter(it => !isSold(it));
    const withStats = items.map(it => ({ it, stats: itemSortStats(it, latestByPlatform) }));
    withStats.sort((a, b) => {
      if (state.listSort === 'views') return b.stats.views - a.stats.views;
      if (state.listSort === 'clicks') return b.stats.clicks - a.stats.clicks;
      if (state.listSort === 'ctr') return b.stats.ctr - a.stats.ctr;
      if (state.listSort === 'price') return b.stats.price - a.stats.price;
      return (a.it.item || a.it.brand || '').localeCompare(b.it.item || b.it.brand || '');
    });
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
    .sort((a, b) => a.meta.label.localeCompare(b.meta.label));
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
    state.metrics.push({ ...body, date: new Date().toISOString().slice(0, 10), source: 'manual' });
  } catch { status.textContent = 'Could not save to your Sheet.'; return; }

  ['metricImpressions', 'metricViews', 'metricWatchers', 'metricClicks'].forEach(id => document.getElementById(id).value = '');
  status.textContent = 'Saved.';
  renderStats();
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
const TREND_CATEGORY_COLOR = { Outerwear: '#5b6bd6', Shirts: '#2f9e6e', Pants: '#c9932e', Shoes: '#2fa3b8', Accessories: '#8c5bd6', Other: '#d6693f' };

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

  const today = new Date().toISOString().slice(0, 10);
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
setMode(localGet('sellHub.mode', 'wheel'));
renderStats();
populateMetricForm();
loadAcquire();
loadTrendsData().then(renderTrends);

Promise.all([loadInventory(), loadDescriptionsData(), loadPostingQueueData(), loadMetricsData(), loadPhotosData()]).then(() => {
  renderWheel();
  routeOverview();
  renderListChips();
  renderList();
  renderStats();
  populateMetricForm();
});
