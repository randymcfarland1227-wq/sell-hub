// Acquire — rendering and interaction for the sourcing intelligence tab.
// Data loads once into acqState; every filter, sort and calculator change works
// on that in-memory copy. All the numbers come from js/acquire-model.js — this
// file only decides how to show them.

const acqState = {
  data: { watchlist: [], trends: [], history: [], intel: [], platformTrends: [] },
  opps: [],
  lanes: [],
  expandedLanes: new Set(),
  loading: true,
  error: '',
  filters: { q: '', category: '', budget: '', profit: '', sellThrough: '', risk: '', conditionReq: '', location: '', frequency: '', preset: '' },
  sort: 'score',
  quick: false,
  drawerId: null,
  drawerMode: null,
  lastFocus: null,
  editingHuntId: null,
  researchTerm: '',
  showAll: false,
};
const ACQ_PAGE_SIZE = 24;

function acqPrefGet(key, fallback) {
  try { const v = localStorage.getItem('sellHub.acquire.' + key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
}
function acqPrefSet(key, value) {
  try { localStorage.setItem('sellHub.acquire.' + key, JSON.stringify(value)); } catch { /* per-viewer convenience only */ }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
function acqMoney(v, opts = {}) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  if (opts.cents || (Math.abs(n) < 10 && n % 1 !== 0)) return '$' + n.toFixed(2);
  return '$' + Math.round(n).toLocaleString();
}
function acqPct(v) { return v === null || v === undefined ? '—' : Math.round(v * 100) + '%'; }
function acqCount(v) { return v === null || v === undefined ? '—' : Number(v).toLocaleString(); }
function acqShortDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '—';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function acqRange(lo, hi) {
  if (lo === null || hi === null || lo === undefined || hi === undefined) return null;
  return Math.round(lo) === Math.round(hi) ? acqMoney(lo) : `${acqMoney(lo)}–${acqMoney(hi)}`;
}
function acqCategoryPath(opp) {
  return opp.category.subcategory ? `${opp.category.groupLabel} → ${opp.category.subcategory}` : opp.category.groupLabel;
}
function acqRiskClass(level) { return level ? 'risk-' + String(level).toLowerCase() : 'risk-unknown'; }
function acqPlatformLabel(id) {
  return (ACQUIRE_CONFIG.platforms[id] || PLATFORM_META[id] || { label: id }).label;
}

// Sold range for a card: the typical middle-50% range when there's a median,
// otherwise the average, clearly labelled.
function acqSoldRangeHTML(opp) {
  const p = opp.derived.primary;
  if (!p) return '<span class="muted">Not enough data</span>';
  const range = acqRange(p.low, p.high);
  if (p.median !== null && range) return `${range}<small>median ${acqMoney(p.median)}</small>`;
  if (p.median !== null) return `${acqMoney(p.median)}<small>median</small>`;
  return `${acqMoney(p.avg)}<small>average only</small>`;
}
function acqProfitText(opp) {
  const pr = opp.derived.profit;
  if (!opp.derived.hasMarketData) return null;
  if (!pr) return null;
  if (pr.high <= 0) return 'No profit';
  return `≈ ${acqRange(Math.max(pr.low, 0), pr.high)}`;
}
function acqMaxBuyText(opp) {
  const m = opp.derived.maxBuy;
  if (m === null) return '—';
  return m === 0 ? 'Pass' : `≤ ${acqMoney(m)}`;
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
async function loadAcquireData() {
  acqState.loading = true;
  acqState.error = '';
  renderAcquireAll();
  const setup = document.getElementById('acquireSetupNote');
  if (setup) setup.style.display = connected() ? 'none' : 'block';

  if (!connected()) {
    acqState.data = { watchlist: localGet('sellHub.acquire.local', []), trends: [], history: [], intel: [], platformTrends: [] };
  } else {
    const onRetry = () => {
      const el = document.getElementById('acqFreshness');
      if (el) el.innerHTML = '<span class="fresh-chip">Still loading market data — retrying…</span>';
    };
    try {
      const bundle = await apiGetWithRetry('acquireBundle', { onRetry });
      if (!bundle || bundle.error || !Array.isArray(bundle.trends)) throw new Error('bundle unavailable');
      acqState.data = { watchlist: bundle.watchlist || [], trends: bundle.trends || [], history: bundle.history || [], intel: bundle.intel || [], platformTrends: bundle.platformTrends || [] };
    } catch {
      // Older backend without the bundle: fall back to the original two calls.
      try {
        const [watchlist, trends] = await Promise.all([apiGetWithRetry('acquire'), apiGetWithRetry('trends')]);
        acqState.data = { watchlist: watchlist || [], trends: trends || [], history: [], intel: [], platformTrends: [] };
      } catch {
        acqState.error = "Couldn't reach your Sheet, so market data isn't loaded. Reload the page to try again.";
      }
    }
  }
  state.acquire = acqState.data.watchlist;
  acqState.loading = false;
  rebuildOpportunities();
  renderAcquireAll();
}

function rebuildOpportunities() {
  acqState.data.watchlist = state.acquire;
  acqState.opps = buildOpportunities(acqState.data, ACQUIRE_CONFIG, ACQUIRE_TAXONOMY, new Date());
  acqState.lanes = buildLanes(acqState.opps, ACQUIRE_CONFIG);
}

function acqOpp(id) { return acqState.opps.find(o => o.id === id) || null; }

// ---------------------------------------------------------------------------
// Header + pulse
// ---------------------------------------------------------------------------
function renderAcquireFreshness() {
  const el = document.getElementById('acqFreshness');
  if (!el) return;
  if (acqState.loading) { el.innerHTML = '<span class="fresh-chip">Loading market data…</span>'; return; }
  const items = summarizeFreshness(acqState.data.trends, acqState.data.intel, new Date());
  if (!items.length) { el.innerHTML = '<span class="fresh-chip fresh-stale">No market data collected yet</span>'; return; }
  el.innerHTML = `<span class="fresh-label">Market data updated</span>` + items.map(i => {
    const stale = i.ageDays !== null && i.ageDays > ACQUIRE_CONFIG.freshness.staleDays;
    const age = i.ageDays === 0 ? 'today' : i.ageDays === null ? '' : `${i.ageDays}d ago`;
    return `<span class="fresh-chip${stale ? ' fresh-stale' : ''}${i.kind === 'intel' ? ' fresh-intel' : ''}" title="${escapeHtml(i.label)} last refreshed ${escapeHtml(i.date)}${age ? ' (' + age + ')' : ''}">${escapeHtml(i.label)} · ${escapeHtml(acqShortDate(i.date))}${stale ? ` <b>${escapeHtml(age)}</b>` : ''}</span>`;
  }).join('');
}

function renderAcquirePulse() {
  const el = document.getElementById('acqPulse');
  if (!el) return;
  if (acqState.loading) { el.innerHTML = '<div class="empty-state">Loading…</div>'; return; }
  const p = summarizePulse(acqState.opps, state.acquire, ACQUIRE_CONFIG);
  const f = ACQUIRE_CONFIG.flags;
  const active = acqState.filters.preset;
  const tile = (preset, icon, num, label, sub) => `
    <button type="button" class="pulse-tile${active === preset ? ' active' : ''}" data-preset="${preset}" aria-pressed="${active === preset}">
      <span class="pulse-icon" aria-hidden="true">${icon}</span>
      <span class="pulse-num">${num}</span>
      <span class="pulse-label">${label}</span>
      <span class="pulse-sub">${sub}</span>
    </button>`;
  const top = p.topProfit;
  el.innerHTML = [
    tile('strong', '🔥', p.strong, 'Strong opportunities', `score ${f.strongScore}+ of ${p.withData} researched`),
    top ? `
      <button type="button" class="pulse-tile pulse-top" data-open="${escapeHtml(top.id)}">
        <span class="pulse-icon" aria-hidden="true">💰</span>
        <span class="pulse-num">${escapeHtml(acqProfitText(top) || '—')}</span>
        <span class="pulse-label">Highest profit potential</span>
        <span class="pulse-sub">${escapeHtml(top.searchTerm)}</span>
      </button>` : tile('', '💰', '—', 'Highest profit potential', 'needs cost + market data'),
    tile('fast', '⚡', p.fast, 'Fast movers', `${Math.round(f.fastSellThrough * 100)}%+ sell-through`),
    tile('lowcost', '🏷️', p.lowcost, 'Best low-cost buys', `typical cost ≤ ${Math.round(f.lowCostRatio * 100)}% of resale`),
    `<button type="button" class="pulse-tile" data-scroll="acq-hunt">
      <span class="pulse-icon" aria-hidden="true">👀</span>
      <span class="pulse-num">${p.hunting}</span>
      <span class="pulse-label">Hunt list</span>
      <span class="pulse-sub">things you're watching for</span>
    </button>`,
    tile('risky', '⚠️', p.risky, 'Risky opportunities', 'good money, needs testing or expertise'),
  ].join('');
}

// ---------------------------------------------------------------------------
// Explorer
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Lanes — three shelves above the explorer. The explorer still holds every
// researched target; these answer "what should I actually be hunting?" without
// making Randy filter for it. Each shelf states its own bar, so a short shelf
// reads as "the data doesn't support more" rather than "something is broken".
// ---------------------------------------------------------------------------
function laneCriteriaText(lane) {
  const min = lane.min || {};
  const bits = [];
  if (lane.frequency) bits.push(`${lane.frequency.map(f => f.toLowerCase()).join('/')} finds only`);
  if (min.score !== undefined) bits.push(`score ${min.score}+`);
  if (min.profit !== undefined) bits.push(`${acqMoney(min.profit)}+ profit`);
  if (min.roi !== undefined) bits.push(`${Math.round(min.roi * 100)}%+ return`);
  if (min.sellThrough !== undefined) bits.push(`${Math.round(min.sellThrough * 100)}%+ sell-through`);
  if (min.sales !== undefined) bits.push(`${acqCount(min.sales)}+ recent sales`);
  if (min.confidence !== undefined) bits.push('medium+ confidence');
  if (lane.maxRisk) bits.push(`risk ${lane.maxRisk.toLowerCase()} or below`);
  if (lane.shippingEase !== undefined) bits.push('ships easily');
  if (lane.requireBuyable) bits.push('max buy beats the usual cost');
  return bits.join(' · ');
}

function trendingTermsHTML(groups) {
  if (!groups.length) return '';
  return groups.map(group => `
    <div class="acq-trending">
      <h5>${escapeHtml(group.platform)} — what shoppers are searching for</h5>
      <p class="acq-trending-sub">${escapeHtml(group.source || 'Platform trending searches')}${group.date ? ` · pulled ${escapeHtml(acqShortDate(group.date))}` : ''}</p>
      <ul class="trend-terms">
        ${group.terms.map(t => `
          <li>
            ${t.opportunity
              ? `<button type="button" class="trend-term" data-open="${escapeHtml(t.opportunity.id)}">${escapeHtml(t.term)}</button>`
              : t.url
                ? `<a class="trend-term" href="${escapeHtml(t.url)}" target="_blank" rel="noopener">${escapeHtml(t.term)}</a>`
                : `<span class="trend-term">${escapeHtml(t.term)}</span>`}
            ${t.searchDelta ? `<span class="trend-delta">${escapeHtml(t.searchDelta)}</span>` : ''}
            ${t.opportunity ? '' : `<button type="button" class="trend-research" data-research="" data-term="${escapeHtml(t.term)}">Research it</button>`}
          </li>`).join('')}
      </ul>
    </div>`).join('');
}

function emergingEmptyHTML(meta) {
  const since = meta.since ? ` since ${acqShortDate(meta.since)}` : '';
  return `
    <p class="lane-empty">
      No rising prices to report yet. Price direction only counts once two snapshots of the same
      target sit at least ${meta.needsDays} days apart — right now there ${meta.days === 1 ? 'is' : 'are'}
      ${meta.days} day${meta.days === 1 ? '' : 's'} of history across ${acqCount(meta.tracking)} targets${since}.
      Keep running the market refresh and this fills itself in.
    </p>`;
}

function renderAcquireLanes() {
  const el = document.getElementById('acqLanes');
  if (!el) return;
  if (acqState.loading) { el.innerHTML = '<div class="empty-state">Loading market data…</div>'; return; }
  if (acqState.error) { el.innerHTML = ''; return; }

  const trending = summarizePlatformTrends(acqState.data.platformTrends, acqState.opps);
  el.innerHTML = acqState.lanes.map(lane => {
    const expanded = acqState.expandedLanes.has(lane.id);
    const shown = expanded ? lane.items : lane.items.slice(0, ACQUIRE_CONFIG.laneSize);
    const body = shown.length
      ? `<div class="acq-rail">
          <button type="button" class="acq-rail-btn" data-rail="-1" aria-label="Scroll left">‹</button>
          <div class="acq-carousel${expanded ? ' dense' : ''} lane-carousel">${shown.map(oppCardHTML).join('')}</div>
          <button type="button" class="acq-rail-btn" data-rail="1" aria-label="Scroll right">›</button>
        </div>`
      : lane.id === 'emerging' ? emergingEmptyHTML(lane.meta) : `<p class="lane-empty">${escapeHtml(lane.empty)}</p>`;
    const criteria = laneCriteriaText(lane);
    return `
      <section class="acq-lane lane-${lane.id}">
        <div class="lane-head">
          <h4><span aria-hidden="true">${lane.icon}</span> ${escapeHtml(lane.title)} <span class="lane-count">${lane.total}</span></h4>
          <p class="lane-blurb">${escapeHtml(lane.blurb)}</p>
          ${criteria ? `<p class="lane-criteria">Bar to get here: ${escapeHtml(criteria)}</p>` : ''}
        </div>
        ${body}
        ${lane.id === 'emerging' ? trendingTermsHTML(trending) : ''}
        ${lane.items.length > shown.length || (expanded && lane.items.length > ACQUIRE_CONFIG.laneSize)
          ? `<div class="lane-foot"><button type="button" class="btn secondary" data-lane="${lane.id}">${expanded ? 'Show fewer' : `See all ${lane.total}`}</button></div>`
          : ''}
      </section>`;
  }).join('');
}


// ---------------------------------------------------------------------------
// Featured Media run — thrift bins most trips actually have
// ---------------------------------------------------------------------------
function isMediaOpportunity(opp) {
  if (opp.category && opp.category.groupId === 'media') return true;
  const sub = String(opp.category && opp.category.subcategory || '').toLowerCase();
  return /books?|cds?|dvds?|vinyl|vhs|blu/.test(sub);
}

function mediaShelfSort(a, b) {
  const aData = !!(a.derived && a.derived.hasMarketData);
  const bData = !!(b.derived && b.derived.hasMarketData);
  if (aData !== bData) return aData ? -1 : 1;
  if (aData && bData) {
    const scoreDiff = (b.derived.score || 0) - (a.derived.score || 0);
    if (scoreDiff) return scoreDiff;
    const stA = a.derived.sellThrough == null ? -1 : a.derived.sellThrough;
    const stB = b.derived.sellThrough == null ? -1 : b.derived.sellThrough;
    if (stB !== stA) return stB - stA;
  }
  return String(a.searchTerm || '').localeCompare(String(b.searchTerm || ''), undefined, { sensitivity: 'base' });
}

function renderAcquireMediaShelf() {
  const el = document.getElementById('acqMediaShelf');
  if (!el) return;
  if (acqState.loading) { el.innerHTML = '<div class="empty-state">Loading market data…</div>'; return; }
  if (acqState.error) { el.innerHTML = ''; return; }

  const freqRank = { Common: 0, Occasional: 1 };
  const media = acqState.opps.filter(opp => {
    if (!isMediaOpportunity(opp)) return false;
    // Inactive targets are usually dropped in buildOpportunities; skip again if present.
    if (opp.intel && ['n', 'no', 'false'].includes(String(opp.intel.active || '').trim().toLowerCase())) return false;
    const freq = String(opp.intel && opp.intel.thriftFrequency || '');
    return freq === '' || freq in freqRank;
  }).sort((a, b) => {
    const ra = freqRank[String(a.intel.thriftFrequency || '')];
    const rb = freqRank[String(b.intel.thriftFrequency || '')];
    const aPref = ra === undefined ? 2 : ra;
    const bPref = rb === undefined ? 2 : rb;
    if (aPref !== bPref) return aPref - bPref;
    return mediaShelfSort(a, b);
  });

  // Prefer Common, then Occasional; keep untagged only if nothing preferred exists.
  const preferred = media.filter(o => freqRank[String(o.intel.thriftFrequency || '')] !== undefined);
  const list = preferred.length ? preferred : media;

  if (!list.length) {
    el.innerHTML = `<div class="empty-state">No Media targets yet — books, CDs, DVDs, vinyl and VHS show up here once researched. <button type="button" class="btn secondary" data-research="media">Add research target</button></div>`;
    return;
  }
  el.innerHTML = list.map(oppCardHTML).join('');
}

function renderAcquireControls() {
  const sort = document.getElementById('acqSort');
  if (sort && !sort.options.length) {
    sort.innerHTML = ACQUIRE_CONFIG.sorts.map(s => `<option value="${s.id}">${escapeHtml(s.label)}</option>`).join('');
  }
  if (sort) sort.value = acqState.sort;

  const chips = document.getElementById('acqCategoryChips');
  if (chips) {
    const cats = summarizeCategories(acqState.opps, ACQUIRE_TAXONOMY, ACQUIRE_CONFIG).filter(c => c.count > 0);
    chips.innerHTML = [`<button type="button" class="acq-chip${!acqState.filters.category ? ' active' : ''}" data-category="" aria-pressed="${!acqState.filters.category}">All</button>`]
      .concat(cats.map(c => `<button type="button" class="acq-chip${acqState.filters.category === c.id ? ' active' : ''}" data-category="${escapeHtml(c.id)}" aria-pressed="${acqState.filters.category === c.id}"><span aria-hidden="true">${c.icon}</span> ${escapeHtml(c.label)} <small>${c.count}</small></button>`))
      .join('');
  }

  const filters = document.getElementById('acqFilters');
  if (filters && !filters.dataset.built) {
    const C = ACQUIRE_CONFIG.filters;
    const select = (key, label, options) => `
      <label class="acq-filter"><span>${label}</span>
        <select data-filter="${key}">
          <option value="">Any</option>
          ${options.map(o => `<option value="${escapeHtml(String(o.value))}">${escapeHtml(o.label)}</option>`).join('')}
        </select>
      </label>`;
    filters.innerHTML = [
      select('budget', 'Purchase budget', C.budgets.map(b => ({ value: b, label: `Typically under $${b}` }))),
      select('profit', 'Expected profit', C.profits.map(p => ({ value: p, label: `$${p}+` }))),
      select('sellThrough', 'Sell-through', C.sellThrough.map(s => ({ value: s, label: `${Math.round(s * 100)}%+` }))),
      select('risk', 'Risk', ['Low', 'Medium', 'High'].map(r => ({ value: r, label: r }))),
      select('conditionReq', 'Condition requirement', C.conditionRequirements.map(r => ({ value: r, label: r }))),
      select('location', 'Sourcing location', C.locations.map(l => ({ value: l, label: l }))),
      select('frequency', 'How often you\'ll see it', C.frequencies.map(f => ({ value: f, label: ACQUIRE_CONFIG.thriftFrequency[f].label }))),
    ].join('');
    filters.dataset.built = '1';
  }
  if (filters) {
    filters.querySelectorAll('select[data-filter]').forEach(s => { s.value = acqState.filters[s.dataset.filter] || ''; });
  }
  const search = document.getElementById('acqSearch');
  if (search && search.value !== acqState.filters.q) search.value = acqState.filters.q;
  const quick = document.getElementById('acqQuickSource');
  if (quick) quick.checked = acqState.quick;
}

function activeFilterDescriptions() {
  const f = acqState.filters;
  const out = [];
  if (f.preset && PULSE_PRESETS[f.preset]) out.push({ key: 'preset', label: PULSE_PRESETS[f.preset].label });
  if (f.category) {
    const c = summarizeCategories(acqState.opps, ACQUIRE_TAXONOMY, ACQUIRE_CONFIG).find(x => x.id === f.category);
    out.push({ key: 'category', label: c ? c.label : f.category });
  }
  if (f.q) out.push({ key: 'q', label: `“${f.q}”` });
  if (f.budget) out.push({ key: 'budget', label: `Under $${f.budget}` });
  if (f.profit) out.push({ key: 'profit', label: `$${f.profit}+ profit` });
  if (f.sellThrough) out.push({ key: 'sellThrough', label: `${Math.round(f.sellThrough * 100)}%+ sell-through` });
  if (f.risk) out.push({ key: 'risk', label: `${f.risk} risk` });
  if (f.conditionReq) out.push({ key: 'conditionReq', label: f.conditionReq });
  if (f.location) out.push({ key: 'location', label: f.location });
  if (f.frequency) out.push({ key: 'frequency', label: (ACQUIRE_CONFIG.thriftFrequency[f.frequency] || {}).label || f.frequency });
  return out;
}

function acqFrequencyPillHTML(opp) {
  const key = String(opp.intel.thriftFrequency || '');
  const meta = ACQUIRE_CONFIG.thriftFrequency[key];
  if (!meta) return '';
  return `<span class="freq-pill freq-${key.toLowerCase()}" title="${escapeHtml(meta.blurb)}"><span aria-hidden="true">${meta.icon}</span> ${escapeHtml(meta.label)}</span>`;
}

function oppCardHTML(opp) {
  const d = opp.derived;
  const band = d.hasMarketData ? d.band : { id: 'nodata', label: 'No data', icon: '⏳' };
  const hunting = !!opp.hunt;
  const profit = acqProfitText(opp);
  const brandLine = [opp.brand, opp.model].filter(Boolean).join(' · ');
  const best = d.best ? acqPlatformLabel(d.best.obs.platformId) : null;
  const flags = d.flags.filter(f => !['stale'].includes(f.id)).slice(0, 3);
  return `
    <article class="opp-card band-${band.id}" data-id="${escapeHtml(opp.id)}">
      <div class="opp-media">
        ${opp.imageUrl ? `<img src="${escapeHtml(opp.imageUrl)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
        <span class="opp-media-icon" aria-hidden="true">${opp.category.icon}</span>
      </div>
      <div class="opp-body">
        <div class="opp-top">
          <div class="opp-score" role="img" aria-label="${d.hasMarketData ? `Opportunity score ${d.score} out of 100, ${band.label}` : 'No score yet — awaiting market data'}">
            <b>${d.hasMarketData ? d.score : '—'}</b><span>${d.hasMarketData ? escapeHtml(band.label) : 'No data'}</span>
          </div>
          <div class="opp-titles">
            <h4><button type="button" class="opp-open" data-open="${escapeHtml(opp.id)}">${escapeHtml(opp.searchTerm)}</button></h4>
            <p class="opp-cat">${escapeHtml(acqCategoryPath(opp))}</p>
            ${brandLine ? `<p class="opp-brand">${escapeHtml(brandLine)}</p>` : ''}
          </div>
        </div>
        <div class="opp-status">
          ${acqFrequencyPillHTML(opp)}
          <span class="status-pill status-${d.status.id}"><span aria-hidden="true">${d.status.icon}</span> ${escapeHtml(d.status.label)}</span>
          ${flags.map(f => `<span class="flag-pill flag-${f.id}"><span aria-hidden="true">${f.icon}</span> ${escapeHtml(f.label)}</span>`).join('')}
        </div>
        ${d.hasMarketData ? `
          <dl class="opp-key">
            <div class="k-maxbuy"><dt>Max buy</dt><dd>${acqMaxBuyText(opp)}</dd></div>
            <div class="k-profit"><dt>Est. profit</dt><dd>${profit ? escapeHtml(profit) : '<span class="muted">Needs buy cost</span>'}</dd></div>
          </dl>
          <dl class="opp-metrics">
            <div class="m-str"><dt>Sell-through</dt><dd>${acqPct(d.sellThrough)}</dd></div>
            <div class="m-range"><dt>Sold range</dt><dd>${acqSoldRangeHTML(opp)}</dd></div>
            <div class="m-sales"><dt>Sales found</dt><dd>${acqCount(d.sales)}</dd></div>
            <div class="m-best"><dt>Best platform</dt><dd>${best ? escapeHtml(best) : '—'}</dd></div>
            <div class="m-risk"><dt>Risk</dt><dd><span class="risk-dot ${acqRiskClass(d.risk)}" aria-hidden="true"></span>${escapeHtml(d.risk || '—')}</dd></div>
          </dl>` : `
          <p class="opp-empty">Market data hasn't been collected for this yet — it's pulled on the next market refresh.</p>`}
        <div class="opp-foot">
          ${d.hasMarketData ? `<span class="conf conf-${d.confidence.label.toLowerCase()}" title="${escapeHtml(d.confidence.reasons.join(' · '))}">${escapeHtml(d.confidence.label)} confidence</span>` : '<span></span>'}
          <button type="button" class="hunt-btn${hunting ? ' hunting' : ''}" data-hunt="${escapeHtml(opp.id)}" aria-pressed="${hunting}">
            <span aria-hidden="true">${hunting ? '★' : '☆'}</span> ${hunting ? 'Hunting' : 'Hunt this'}
          </button>
        </div>
      </div>
    </article>`;
}

function renderAcquireExplorer() {
  const results = document.getElementById('acqResults');
  const summary = document.getElementById('acqActiveFilters');
  if (!results) return;
  results.classList.toggle('quick', acqState.quick);
  if (acqState.loading) { results.innerHTML = '<div class="empty-state">Loading market data…</div>'; if (summary) summary.innerHTML = ''; return; }
  if (acqState.error) { results.innerHTML = `<div class="empty-state">${escapeHtml(acqState.error)}</div>`; return; }

  const filtered = sortOpportunities(filterOpportunities(acqState.opps, acqState.filters, ACQUIRE_CONFIG), acqState.sort);
  const active = activeFilterDescriptions();
  if (summary) {
    summary.innerHTML = `
      <span class="acq-count">${filtered.length} of ${acqState.opps.length} opportunities</span>
      ${active.map(a => `<button type="button" class="acq-active-chip" data-clear="${a.key}" aria-label="Remove filter ${escapeHtml(a.label)}">${escapeHtml(a.label)} <span aria-hidden="true">✕</span></button>`).join('')}
      ${active.length ? '<button type="button" class="acq-clear-all" data-clear="all">Clear all</button>' : ''}`;
  }
  if (!acqState.opps.length) {
    results.innerHTML = `<div class="empty-state">No research targets yet. <button type="button" class="btn secondary" data-research="">Add research target</button></div>`;
    return;
  }
  if (!filtered.length) {
    results.innerHTML = `<div class="empty-state">Nothing matches these filters. <button type="button" class="btn secondary" data-clear="all">Clear filters</button> <button type="button" class="btn secondary" data-research="${escapeHtml(acqState.filters.category)}">Add research target</button></div>`;
    return;
  }
  const shown = acqState.showAll ? filtered : filtered.slice(0, ACQ_PAGE_SIZE);
  results.innerHTML = `
    <div class="opp-grid">${shown.map(oppCardHTML).join('')}</div>
    <div class="acq-results-foot">
      ${filtered.length > shown.length ? `<button type="button" class="btn secondary" data-show-all>Show all ${filtered.length}</button>` : ''}
      <button type="button" class="btn secondary" data-research="${escapeHtml(acqState.filters.category)}">＋ Add research target</button>
    </div>`;
}

// ---------------------------------------------------------------------------
// Category intelligence
// ---------------------------------------------------------------------------
function renderAcquireCategories() {
  const el = document.getElementById('acqCategories');
  if (!el) return;
  if (acqState.loading) { el.innerHTML = ''; return; }
  const cats = summarizeCategories(acqState.opps, ACQUIRE_TAXONOMY, ACQUIRE_CONFIG);
  el.innerHTML = cats.map(c => {
    if (!c.count) {
      return `
        <div class="cat-card cat-empty">
          <span class="cat-icon" aria-hidden="true">${c.icon}</span>
          <h4>${escapeHtml(c.label)}</h4>
          <p>Market data hasn't been collected for this category yet.</p>
          <button type="button" class="btn secondary" data-research="${escapeHtml(c.id)}">Add research target</button>
        </div>`;
    }
    const selected = acqState.filters.category === c.id;
    return `
      <button type="button" class="cat-card${selected ? ' active' : ''}" data-category="${escapeHtml(c.id)}" aria-pressed="${selected}">
        <span class="cat-icon" aria-hidden="true">${c.icon}</span>
        <h4>${escapeHtml(c.label)}</h4>
        <span class="cat-stat"><b>${c.count}</b> opportunit${c.count === 1 ? 'y' : 'ies'}</span>
        <span class="cat-stat">Median score <b>${c.medianScore === null ? '—' : c.medianScore}</b></span>
        <span class="cat-stat"><span aria-hidden="true">🔥</span> <b>${c.strong}</b> strong</span>
        ${c.withData < c.count ? `<span class="cat-stat muted">${c.count - c.withData} awaiting data</span>` : ''}
      </button>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// Drawer: opportunity detail, deal calculator, research target form
// ---------------------------------------------------------------------------
function openAcquireDrawer(mode, id) {
  const drawer = document.getElementById('acqDrawer');
  const backdrop = document.getElementById('acqDrawerBackdrop');
  if (!drawer) return;
  acqState.lastFocus = document.activeElement;
  acqState.drawerMode = mode;
  acqState.drawerId = id;
  renderAcquireDrawer();
  drawer.hidden = false;
  backdrop.hidden = false;
  document.body.classList.add('acq-drawer-open');
  requestAnimationFrame(() => {
    drawer.classList.add('open');
    const close = drawer.querySelector('.drawer-close');
    if (close) close.focus();
  });
}

function closeAcquireDrawer() {
  const drawer = document.getElementById('acqDrawer');
  const backdrop = document.getElementById('acqDrawerBackdrop');
  if (!drawer || drawer.hidden) return;
  drawer.classList.remove('open');
  drawer.hidden = true;
  backdrop.hidden = true;
  document.body.classList.remove('acq-drawer-open');
  acqState.drawerId = null;
  acqState.drawerMode = null;
  if (acqState.lastFocus && document.contains(acqState.lastFocus)) acqState.lastFocus.focus();
}

function renderAcquireDrawer() {
  const body = document.getElementById('acqDrawerBody');
  if (!body) return;
  if (acqState.drawerMode === 'research') { body.innerHTML = researchFormHTML(acqState.drawerId || ''); return; }
  const opp = acqOpp(acqState.drawerId);
  if (!opp) { body.innerHTML = '<div class="drawer-bar"><button type="button" class="drawer-close" aria-label="Close">✕</button></div><p>That opportunity is no longer available.</p>'; return; }
  body.innerHTML = oppDetailHTML(opp);
  updateDealCalculator(body, opp);
}

function detailRow(label, value, note) {
  return `<div class="d-row"><dt>${escapeHtml(label)}</dt><dd>${value}${note ? `<small>${note}</small>` : ''}</dd></div>`;
}

function oppDetailHTML(opp) {
  const d = opp.derived;
  const cfg = ACQUIRE_CONFIG;
  const band = d.hasMarketData ? d.band : { id: 'nodata', label: 'No data' };
  const p = d.primary;
  const best = d.best;
  const hunting = !!opp.hunt;
  // Inventory loads separately from Acquire, so read sold history at open time.
  const edge = calculateUserEdge(opp, buildUserHistory(state.inventory || []));
  const trendChange = d.trend.change === null ? '' : ` (${d.trend.change > 0 ? '+' : ''}${Math.round(d.trend.change * 100)}% since ${acqShortDate(d.trend.since)})`;
  const factorLabels = { demand: 'Sell-through', profit: 'Expected profit', roi: 'ROI', volume: 'Sales volume', shipping: 'Shipping ease', testing: 'Testing risk', competition: 'Demand vs. supply', confidence: 'Data confidence' };

  const overview = `
    <div class="d-hero">
      ${opp.imageUrl ? `<img src="${escapeHtml(opp.imageUrl)}" alt="" onerror="this.remove()">` : `<span class="d-hero-icon" aria-hidden="true">${opp.category.icon}</span>`}
      <div>
        <p class="d-cat">${escapeHtml(acqCategoryPath(opp))}</p>
        <h3 id="acqDrawerTitle">${escapeHtml(opp.searchTerm)}</h3>
        ${[opp.brand, opp.model].filter(Boolean).length ? `<p class="d-brand">${escapeHtml([opp.brand, opp.model].filter(Boolean).join(' · '))}</p>` : ''}
        <div class="opp-status">
          <span class="status-pill status-${d.status.id}"><span aria-hidden="true">${d.status.icon}</span> ${escapeHtml(d.status.label)}</span>
          ${d.flags.map(f => `<span class="flag-pill flag-${f.id}"><span aria-hidden="true">${f.icon}</span> ${escapeHtml(f.label)}</span>`).join('')}
        </div>
      </div>
      <div class="d-score band-${band.id}" role="img" aria-label="${d.hasMarketData ? `Opportunity score ${d.score} out of 100` : 'No score yet'}">
        <b>${d.hasMarketData ? d.score : '—'}</b><span>/ 100</span><em>${escapeHtml(band.label)}</em>
      </div>
    </div>
    <div class="d-actions">
      <button type="button" class="hunt-btn big${hunting ? ' hunting' : ''}" data-hunt="${escapeHtml(opp.id)}" aria-pressed="${hunting}"><span aria-hidden="true">${hunting ? '★' : '☆'}</span> ${hunting ? 'Hunting' : 'Hunt this'}</button>
      ${d.confidence.note ? `<p class="d-note">${escapeHtml(d.confidence.note)}</p>` : ''}
    </div>`;

  if (!d.hasMarketData) {
    return `
      <div class="drawer-bar"><button type="button" class="drawer-close" aria-label="Close">✕</button></div>
      ${overview}
      <section class="d-section"><p class="opp-empty">Market data hasn't been collected for this yet. Once it's pulled, the score, max buy and profit estimates fill in here.</p></section>
      ${riskAndGuidesHTML(opp)}`;
  }

  const money = `
    <section class="d-section">
      <h4>Money <span class="d-tag">calculated estimate</span></h4>
      <div class="d-money-hero">
        <div><span>Max buy</span><b>${acqMaxBuyText(opp)}</b></div>
        <div><span>Expected profit</span><b>${escapeHtml(acqProfitText(opp) || '—')}</b></div>
        <div><span>ROI</span><b>${d.roi === null ? '—' : Math.round(d.roi * 100) + '%'}</b></div>
      </div>
      <dl class="d-grid">
        ${detailRow('Expected sale', acqMoney(d.expectedSale), d.priceBasis === 'average' ? 'average only' : `${best ? acqPlatformLabel(best.obs.platformId) : ''} median`)}
        ${detailRow('Conservative sale', acqMoney(d.conservativeSale), 'leans toward the low end when prices vary')}
        ${detailRow('Platform fees', '−' + acqMoney(d.fees, { cents: true }), best ? `${acqPlatformLabel(best.obs.platformId)} fee assumption` : '')}
        ${detailRow('Shipping', d.shipping && d.shipping.cost !== null ? '−' + acqMoney(d.shipping.cost) : '—', d.shipping ? escapeHtml(d.shipping.note) : '')}
        ${detailRow('Expected net', acqMoney(d.conservativeNet) + '–' + acqMoney(d.expectedNet), 'after fees and shipping')}
        ${detailRow('Your minimum profit', '−' + acqMoney(d.desiredProfit), `larger of $${cfg.desiredProfit.minDollars} or ${Math.round(cfg.desiredProfit.shareOfSale * 100)}% of the sale`)}
        ${detailRow('Risk reserve', '−' + acqMoney(d.riskBuffer), `${opp.intel.testingRisk || 'unknown'} testing risk`)}
        ${detailRow('Typical buy cost', d.cost ? acqRange(d.cost.low, d.cost.high) : '—', d.cost ? 'sourcing intel estimate' : 'add one to calculate profit and ROI')}
      </dl>
      ${d.maxBuy === 0 ? '<p class="d-note">After fees, shipping and your minimum profit there\'s no margin left at any price.</p>' : ''}
    </section>`;

  const market = `
    <section class="d-section">
      <h4>Market <span class="d-tag">market data</span></h4>
      <dl class="d-grid">
        ${detailRow('Sold range', p.low !== null && p.high !== null ? acqRange(p.low, p.high) : '—', p.low !== null ? 'middle 50% of sold prices' : 'no range available')}
        ${detailRow('Median sold', acqMoney(p.median), p.median === null ? 'not available' : '')}
        ${detailRow('Average sold', acqMoney(p.avg), p.avg !== null ? 'trimmed average' : '')}
        ${detailRow('Sell-through', acqPct(d.sellThrough), d.sellThrough === null ? 'active supply unknown' : d.sellThroughDerived ? 'sold ÷ (sold + active), approximate' : '')}
        ${detailRow('Sales found', acqCount(d.sales), p.platformId === 'ebay' ? 'eBay sold results, last 90 days' : '')}
        ${detailRow('Active supply', acqCount(p.activeListings), p.activeListings === null ? 'not reported by this source' : 'current listings')}
        ${detailRow('Days of supply', d.velocity.daysOfSupply === null ? '—' : `≈ ${Math.round(d.velocity.daysOfSupply)} days`, d.velocity.daysOfSupply === null ? '' : 'how long current listings would take to sell at this pace')}
        ${detailRow('Buyer-paid shipping', p.avgShipping === null ? '—' : acqMoney(p.avgShipping, { cents: true }), p.avgShipping === null ? '' : 'average charged on sold listings')}
        ${detailRow('Trend', escapeHtml(d.trend.label) + escapeHtml(trendChange), d.trend.direction === 'insufficient' ? `history started ${acqShortDate(d.trend.since)} — direction appears once there's a week of snapshots` : '')}
        ${detailRow('Confidence', `<span class="conf conf-${d.confidence.label.toLowerCase()}">${escapeHtml(d.confidence.label)}</span>`, escapeHtml(d.confidence.reasons.join(' · ')))}
      </dl>
    </section>`;

  const platforms = `
    <section class="d-section">
      <h4>Best places to sell</h4>
      ${d.platformRanking.length ? `<ol class="d-platforms">${d.platformRanking.map((e, i) => `
        <li${i === 0 ? ' class="top"' : ''}>
          <b>${escapeHtml(acqPlatformLabel(e.obs.platformId))}</b>
          <span>nets ≈ ${acqMoney(e.conservativeNet)}–${acqMoney(e.expectedNet)}</span>
          <small>${e.prices.basis === 'average' ? 'average' : 'median'} ${acqMoney(e.prices.expected)} · ${acqCount(e.obs.sampleSize ?? e.obs.salesFound)} sampled · ${escapeHtml(e.shipping.note)}</small>
        </li>`).join('')}</ol>` : '<p class="muted">Not enough data to rank platforms.</p>'}
      ${opp.economics.filter(e => !e.shipping.viable).map(e => `<p class="muted">${escapeHtml(acqPlatformLabel(e.obs.platformId))}: ${escapeHtml(e.shipping.note)}</p>`).join('')}
      ${opp.intel.platformNotes ? `<p class="d-note">${escapeHtml(opp.intel.platformNotes)}</p>` : ''}
    </section>`;

  const calculator = `
    <section class="d-section d-calc" aria-labelledby="calcHead">
      <h4 id="calcHead">Found one?</h4>
      <div class="calc-inputs">
        <label class="calc-price"><span>Purchase price</span><span class="calc-money"><span aria-hidden="true">$</span><input type="number" inputmode="decimal" min="0" step="0.01" data-calc="price" placeholder="12.99" aria-label="Purchase price in dollars"></span></label>
        <label><span>Condition</span><select data-calc="condition">${cfg.conditions.map(c => `<option value="${c.id}"${c.id === 'good' ? ' selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}</select></label>
        <label><span>Sell on</span><select data-calc="platform">${(d.platformRanking.length ? d.platformRanking : opp.economics).map(e => `<option value="${e.obs.platformId}">${escapeHtml(acqPlatformLabel(e.obs.platformId))}</option>`).join('')}</select></label>
        <label><span>Shipping <small>optional</small></span><span class="calc-money"><span aria-hidden="true">$</span><input type="number" inputmode="decimal" min="0" step="0.01" data-calc="shipping" placeholder="${d.shipping && d.shipping.cost !== null ? d.shipping.cost : ''}" aria-label="Shipping cost override in dollars"></span></label>
      </div>
      <div class="calc-out" aria-live="polite"></div>
      <p class="muted calc-foot">Nothing here is saved — it's just math.</p>
    </section>`;

  const scoreBreakdown = `
    <section class="d-section">
      <details class="d-details">
        <summary>How the ${d.score} was calculated</summary>
        <table class="d-factors">
          <thead><tr><th scope="col">Factor</th><th scope="col">Weight</th><th scope="col">Points</th></tr></thead>
          <tbody>${Object.keys(cfg.scoreWeights).map(k => `
            <tr><td>${factorLabels[k]}</td><td>${Math.round(cfg.scoreWeights[k] * 100)}%</td><td>${d.factors[k] === null ? '<span class="muted">no data</span>' : d.contributions[k].toFixed(1)}</td></tr>`).join('')}
          </tbody>
        </table>
      </details>
    </section>`;

  const sources = `
    <section class="d-section">
      <h4>Sources</h4>
      <ul class="d-sources">${opp.observations.map(o => `
        <li><b>${escapeHtml(o.source || o.platform)}</b> · ${escapeHtml(acqShortDate(o.lastChecked))} · ${acqCount(o.sampleSize ?? o.salesFound)} ${o.sampleSize !== null ? 'sampled' : 'found'}</li>`).join('')}
        <li><b>Sourcing intel</b> · risks, costs and guides · ${escapeHtml(acqShortDate(opp.intel.lastUpdated))}</li>
      </ul>
      ${opp.intel.ebayQuery ? `<p class="muted">eBay search: <code>${escapeHtml(opp.intel.ebayQuery)}</code></p>` : ''}
    </section>`;

  const personal = edge ? `
    <section class="d-section">
      <h4>Your results</h4>
      <dl class="d-grid">
        ${detailRow('You\'ve sold', `${edge.soldCount} from ${escapeHtml(opp.brand.split('/')[0].trim())}`)}
        ${detailRow('Your avg sold price', acqMoney(edge.avgSoldPrice))}
        ${detailRow('Your edge', '—', escapeHtml(edge.note))}
      </dl>
    </section>` : '';

  return `
    <div class="drawer-bar"><button type="button" class="drawer-close" aria-label="Close">✕</button></div>
    ${overview}
    ${money}
    ${calculator}
    ${market}
    ${platforms}
    ${riskAndGuidesHTML(opp)}
    ${personal}
    ${scoreBreakdown}
    ${sources}`;
}

function riskAndGuidesHTML(opp) {
  const i = opp.intel;
  const d = opp.derived;
  const risk = (label, value) => `<div class="d-risk"><dt>${label}</dt><dd><span class="risk-dot ${acqRiskClass(value === 'Easy' ? 'Low' : value === 'Moderate' ? 'Medium' : value === 'Difficult' ? 'High' : value)}" aria-hidden="true"></span>${escapeHtml(value || '—')}</dd></div>`;
  const ship = ACQUIRE_CONFIG.shippingClasses[String(i.shippingClass || '').toLowerCase()];
  return `
    <section class="d-section">
      <h4>Risk <span class="d-tag">sourcing intel</span></h4>
      <dl class="d-risks">
        ${risk('Testing', i.testingRisk)}
        ${risk('Counterfeit', i.counterfeitRisk)}
        ${risk('Shipping', i.shippingDifficulty)}
        ${risk('Fragility', i.fragility)}
        ${risk('Returns', i.returnRisk)}
        <div class="d-risk"><dt>Knowledge</dt><dd>${escapeHtml(i.knowledgeLevel || '—')}</dd></div>
      </dl>
      <p class="muted">${[i.conditionRequirement, ship ? ship.label : '', d.locations.length ? 'Look at: ' + d.locations.join(', ') : ''].filter(Boolean).map(escapeHtml).join(' · ')}</p>
    </section>
    ${d.recognition.length ? `
    <section class="d-section">
      <details class="d-details" open>
        <summary>What to recognize</summary>
        <ul class="d-list">${d.recognition.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
      </details>
    </section>` : ''}
    ${d.inspection.length ? `
    <section class="d-section">
      <details class="d-details" open>
        <summary>Before buying, check</summary>
        <ul class="d-checklist">${d.inspection.map(r => `<li><span aria-hidden="true">✓</span> ${escapeHtml(r)}</li>`).join('')}</ul>
      </details>
    </section>` : ''}`;
}

function updateDealCalculator(root, opp) {
  const out = root.querySelector('.calc-out');
  if (!out) return;
  const get = k => root.querySelector(`[data-calc="${k}"]`);
  const r = evaluateDeal(opp, {
    purchasePrice: get('price').value,
    conditionId: get('condition').value,
    platformId: get('platform') ? get('platform').value : null,
    shippingOverride: get('shipping').value,
  }, ACQUIRE_CONFIG);
  if (!r.ready) { out.innerHTML = `<p class="muted">${escapeHtml(r.reason)}</p>`; return; }
  out.innerHTML = `
    <dl class="calc-lines">
      <div><dt>Expected sale <small>${escapeHtml(r.condition.label.toLowerCase())}, conservative</small></dt><dd>${acqMoney(r.sale)}</dd></div>
      <div><dt>Estimated fees <small>${escapeHtml(r.platformLabel)}</small></dt><dd>−${acqMoney(r.fees, { cents: true })}</dd></div>
      <div><dt>Estimated shipping <small>${escapeHtml(r.shippingNote)}</small></dt><dd>${r.shipping === null ? '—' : '−' + acqMoney(r.shipping, { cents: true })}</dd></div>
      ${r.price !== null && r.price !== undefined ? `<div><dt>Purchase price</dt><dd>−${acqMoney(r.price, { cents: true })}</dd></div>` : ''}
      <div class="calc-total"><dt>Estimated profit</dt><dd>${r.profit === null ? '<span class="muted">enter a price</span>' : acqMoney(r.profit)}</dd></div>
      <div><dt>ROI</dt><dd>${r.roi === null ? '—' : Math.round(r.roi * 100) + '%'}</dd></div>
    </dl>
    ${r.verdict ? `<div class="calc-verdict verdict-${r.verdict.id}"><b><span aria-hidden="true">${r.verdict.icon}</span> ${escapeHtml(r.verdict.label)}</b><span>${escapeHtml(r.verdict.detail)}</span></div>` : ''}`;
}

// ---------------------------------------------------------------------------
// Research target form (adds a Sourcing Intel row)
// ---------------------------------------------------------------------------
function researchFormHTML(categoryId) {
  const cfg = ACQUIRE_CONFIG;
  const group = ACQUIRE_TAXONOMY.find(g => g.id === categoryId);
  const lvl = (name, label, values) => `<label class="field"><span>${label}</span><select name="${name}"><option value="">Unknown</option>${values.map(v => `<option>${v}</option>`).join('')}</select></label>`;
  return `
    <div class="drawer-bar"><button type="button" class="drawer-close" aria-label="Close">✕</button></div>
    <h3 id="acqDrawerTitle">Add research target</h3>
    <p class="muted">Something worth pricing out. It shows up as "awaiting data" until the next market refresh pulls comps for it.</p>
    <form class="research-form" novalidate>
      <label class="field"><span>Search term <b aria-hidden="true">*</b></span><input name="searchTerm" required value="${escapeHtml(acqState.researchTerm || '')}" placeholder="e.g. Canon AE-1 film camera"></label>
      <div class="field-row">
        <label class="field"><span>Category</span><select name="category">${ACQUIRE_TAXONOMY.map(g => `<option${group && group.id === g.id ? ' selected' : ''}>${escapeHtml(g.label)}</option>`).join('')}</select></label>
        <label class="field"><span>Subcategory</span><input name="subcategory" list="acqSubcategoryList"></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Brand</span><input name="brand"></label>
        <label class="field"><span>Model</span><input name="model"></label>
      </div>
      <label class="field"><span>eBay search <small>optional — defaults to the search term</small></span><input name="ebayQuery" placeholder="canon ae-1 camera -lens -parts"></label>
      <div class="field-row">
        <label class="field"><span>Typical buy cost low</span><input name="typicalCostLow" type="number" min="0" step="1" inputmode="decimal"></label>
        <label class="field"><span>Typical buy cost high</span><input name="typicalCostHigh" type="number" min="0" step="1" inputmode="decimal"></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Shipping class</span><select name="shippingClass"><option value="">Unknown</option>${Object.keys(cfg.shippingClasses).map(k => `<option value="${k}">${escapeHtml(cfg.shippingClasses[k].label)}</option>`).join('')}</select></label>
        ${lvl('testingRisk', 'Testing risk', ['Low', 'Medium', 'High'])}
      </div>
      <div class="field-row">
        ${lvl('counterfeitRisk', 'Counterfeit risk', ['Low', 'Medium', 'High'])}
        ${lvl('conditionRequirement', 'Condition requirement', cfg.filters.conditionRequirements)}
      </div>
      <label class="field"><span>What to check <small>one per line</small></span><textarea name="inspectionNotes" rows="3"></textarea></label>
      <label class="field"><span>How to recognize it <small>one per line</small></span><textarea name="recognitionNotes" rows="3"></textarea></label>
      <button type="submit" class="btn">Add research target</button>
      <p class="status-msg research-status" role="status"></p>
    </form>`;
}

async function submitResearchForm(form) {
  const status = form.querySelector('.research-status');
  const data = Object.fromEntries(new FormData(form).entries());
  data.searchTerm = String(data.searchTerm || '').trim();
  if (!data.searchTerm) { status.textContent = 'Add a search term.'; form.querySelector('[name="searchTerm"]').focus(); return; }
  const cls = ACQUIRE_CONFIG.shippingClasses[data.shippingClass];
  const row = {
    ...data,
    opportunityId: opportunityIdFor(data.searchTerm),
    ebayQuery: data.ebayQuery || data.searchTerm.toLowerCase(),
    shippingDifficulty: cls ? (cls.ease >= 0.75 ? 'Easy' : cls.ease >= 0.45 ? 'Moderate' : 'Difficult') : '',
    active: 'Y',
  };
  if (acqOpp(row.opportunityId)) { status.textContent = 'That one is already a research target.'; return; }
  if (!connected()) { status.textContent = 'Research targets are saved to your Sheet — connect it first.'; return; }
  status.textContent = 'Saving…';
  try {
    const res = await apiPost('upsertSourcingIntel', { rows: [row] });
    if (!res || !res.ok) throw new Error((res && res.error) || 'not saved');
  } catch {
    status.textContent = "Couldn't confirm the save — check the Sourcing Intel tab before trying again.";
    return;
  }
  acqState.data.intel.push({ ...row, lastUpdated: todayStr() });
  rebuildOpportunities();
  closeAcquireDrawer();
  acqState.filters = { ...acqState.filters, q: data.searchTerm, preset: '', category: '' };
  renderAcquireAll();
}

// ---------------------------------------------------------------------------
// Hunt list
// ---------------------------------------------------------------------------
const HUNT_FIELD_DEFS = {
  subcategory: { label: 'Subcategory', type: 'text', list: 'acqSubcategoryList' },
  model: { label: 'Model', type: 'text', placeholder: 'e.g. DCR-TRV350' },
  targetVariant: { label: 'Target variant', type: 'text', placeholder: 'e.g. with battery, 3rd gen' },
  size: { label: 'Size', type: 'text', placeholder: 'e.g. M / 34' },
  color: { label: 'Color', type: 'text' },
};

function huntCategoryId(label) {
  const g = ACQUIRE_TAXONOMY.find(t => t.label.toLowerCase() === String(label || '').toLowerCase() || t.id === String(label || '').toLowerCase());
  if (g) return g.id;
  if (!label) return '';
  const bySub = ACQUIRE_TAXONOMY.find(t => t.subs.some(s => s.toLowerCase() === String(label).toLowerCase()));
  return bySub ? bySub.id : 'other';
}

function huntFormFieldsHTML(entry, prefix) {
  const e = entry || {};
  const catId = huntCategoryId(e.category);
  const visible = HUNT_FIELDS_BY_CATEGORY[catId] || HUNT_FIELDS_BY_CATEGORY[''];
  const input = (name, label, value, attrs = '') => `<label class="field hf-${name}"><span>${label}</span><input name="${name}" value="${escapeHtml(value == null ? '' : value)}" ${attrs}></label>`;
  const conditional = Object.keys(HUNT_FIELD_DEFS).map(name => {
    const def = HUNT_FIELD_DEFS[name];
    return `<label class="field hf-${name}" data-conditional="${name}"${visible.includes(name) ? '' : ' hidden'}><span>${def.label}</span><input name="${name}" value="${escapeHtml(e[name] || '')}"${def.list ? ` list="${def.list}"` : ''}${def.placeholder ? ` placeholder="${escapeHtml(def.placeholder)}"` : ''}></label>`;
  }).join('');
  return `
    <div class="field-row">
      <label class="field"><span>Category</span>
        <select name="category" data-hunt-category>
          <option value=""${!e.category ? ' selected' : ''}>—</option>
          ${ACQUIRE_TAXONOMY.map(g => `<option value="${escapeHtml(g.label)}"${catId === g.id ? ' selected' : ''}>${g.icon} ${escapeHtml(g.label)}</option>`).join('')}
        </select>
      </label>
      ${input('brand', 'Brand', e.brand, 'placeholder="e.g. Sony"')}
    </div>
    ${input('itemType', 'Item / search term <b aria-hidden="true">*</b>', e.itemType, `required placeholder="e.g. Digital8 camcorder" id="${prefix}ItemType"`)}
    <div class="hunt-conditional">${conditional}</div>
    <div class="field-row">
      ${input('condition', 'Condition floor', e.condition, 'placeholder="e.g. Tested working"')}
      ${input('targetPrice', 'Target buy price', e.targetPrice, 'placeholder="e.g. under $25"')}
    </div>
    <div class="field-row">
      ${input('desiredProfit', 'Desired profit', e.desiredProfit, 'placeholder="e.g. $40"')}
      <label class="field"><span>Preferred platform</span><select name="bestPlatform"><option value="">—</option>${platformOptionsHTML(e.bestPlatform)}</select></label>
    </div>
    <div class="field-row">
      <label class="field"><span>Priority</span><select name="priority">${['High', 'Medium', 'Low'].map(p => `<option${(e.priority || 'Medium') === p ? ' selected' : ''}>${p}</option>`).join('')}</select></label>
      ${input('whereToFind', 'Where I expect to find it', e.whereToFind, 'placeholder="e.g. Estate sales, Goodwill bins"')}
    </div>
    <label class="field"><span>Inspection notes</span><textarea name="inspectionNotes" rows="2">${escapeHtml(e.inspectionNotes || '')}</textarea></label>
    <label class="field"><span>Notes</span><textarea name="notes" rows="2">${escapeHtml(e.notes || '')}</textarea></label>`;
}

function wireHuntCategory(root) {
  const select = root.querySelector('[data-hunt-category]');
  if (!select) return;
  const apply = () => {
    const visible = HUNT_FIELDS_BY_CATEGORY[huntCategoryId(select.value)] || HUNT_FIELDS_BY_CATEGORY[''];
    root.querySelectorAll('[data-conditional]').forEach(el => { el.hidden = !visible.includes(el.dataset.conditional); });
    const group = ACQUIRE_TAXONOMY.find(g => g.label === select.value);
    const list = document.getElementById('acqSubcategoryList');
    if (list) list.innerHTML = (group ? group.subs : ACQUIRE_TAXONOMY.flatMap(g => g.subs)).map(s => `<option value="${escapeHtml(s)}">`).join('');
  };
  select.addEventListener('change', apply);
  apply();
}

// Reads a hunt form. Hidden conditional fields are sent blank so switching a
// category doesn't leave stale apparel sizes on a camcorder entry.
function readHuntForm(root) {
  const body = {};
  root.querySelectorAll('input[name], select[name], textarea[name]').forEach(el => {
    const wrapper = el.closest('[data-conditional]');
    body[el.name] = wrapper && wrapper.hidden ? '' : String(el.value || '').trim();
  });
  const group = ACQUIRE_TAXONOMY.find(g => g.label === body.category);
  if (group && body.subcategory && !group.subs.some(s => s.toLowerCase() === body.subcategory.toLowerCase())) {
    // A free-typed subcategory is fine — categories are data-driven.
  }
  return body;
}

function huntCardHTML(a) {
  const pri = PRIORITY_META[a.priority] || PRIORITY_META.Medium;
  const editing = String(acqState.editingHuntId) === String(a.id);
  if (editing) {
    return `
      <div class="acquire-card hunt-card editing" style="--pri:${pri.color}" data-hunt-id="${escapeHtml(a.id)}">
        <form class="hunt-edit-form" novalidate>
          ${huntFormFieldsHTML(a, 'edit')}
          <button type="submit" class="btn">Save</button>
          <button type="button" class="btn secondary ae-cancel">Cancel</button>
          <p class="status-msg ae-status" role="status"></p>
        </form>
      </div>`;
  }
  const opp = acqState.opps.find(o => o.hunt && String(o.hunt.id) === String(a.id)) || null;
  const catId = huntCategoryId(a.category);
  const group = ACQUIRE_TAXONOMY.find(g => g.id === catId);
  const title = [a.brand, a.itemType].filter(Boolean).join(' — ') || 'Untitled';
  const meta = [
    ['Category', [a.category, a.subcategory].filter(Boolean).join(' → ')],
    ['Model', a.model], ['Variant', a.targetVariant], ['Size', a.size], ['Color', a.color],
    ['Condition floor', a.condition], ['Target buy', typeof a.targetPrice === 'number' ? acqMoney(a.targetPrice) : a.targetPrice],
    ['Desired profit', typeof a.desiredProfit === 'number' ? acqMoney(a.desiredProfit) : a.desiredProfit],
    ['Best platform', a.bestPlatform ? (PLATFORM_META[a.bestPlatform] || { label: a.bestPlatform }).label : ''],
    ['Where to find', a.whereToFind],
  ].filter(m => String(m[1] || '').trim());
  const legacyMarket = !opp && (a.ebayAvgPrice || a.poshmarkAvgPrice);
  return `
    <div class="acquire-card hunt-card" style="--pri:${pri.color}" data-hunt-id="${escapeHtml(a.id)}">
      ${a.imageUrl ? `<img class="acquire-photo" src="${escapeHtml(a.imageUrl)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
      <h3><span aria-hidden="true">${group ? group.icon : '🏷️'}</span> ${escapeHtml(title)}<span class="priority-tag">${escapeHtml(a.priority || 'Medium')}</span></h3>
      <div class="meta">${meta.map(m => `<span><b>${escapeHtml(m[0])} —</b> ${escapeHtml(m[1])}</span>`).join('')}</div>
      ${opp && opp.derived.hasMarketData ? `
        <div class="hunt-intel">
          <span class="hunt-score band-${opp.derived.band.id}"><b>${opp.derived.score}</b> score</span>
          <span><b>${acqMaxBuyText(opp)}</b> max buy</span>
          <span>${acqSoldRangeHTML(opp)}</span>
          <button type="button" class="btn secondary" data-open="${escapeHtml(opp.id)}">Open intel</button>
        </div>` : ''}
      ${legacyMarket ? `
        <div class="market-data">
          ${a.ebayAvgPrice ? `<span><b>${acqMoney(a.ebayAvgPrice)}</b> eBay avg (${escapeHtml(a.ebaySalesFound)} sold${a.ebaySellThrough ? `, ${escapeHtml(a.ebaySellThrough)}% sell-through` : ''})</span>` : ''}
          ${a.poshmarkAvgPrice ? `<span><b>${acqMoney(a.poshmarkAvgPrice)}</b> Poshmark avg (${escapeHtml(a.poshmarkSalesFound)} found)</span>` : ''}
          <span class="market-data-date">as of ${escapeHtml(a.lastChecked || '')}</span>
        </div>` : ''}
      ${a.inspectionNotes ? `<p class="notes"><b>Check:</b> ${escapeHtml(a.inspectionNotes)}</p>` : ''}
      ${a.notes ? `<p class="notes">${escapeHtml(a.notes)}</p>` : ''}
      <button type="button" class="icon-btn ae-edit-btn" aria-label="Edit ${escapeHtml(title)}" data-id="${escapeHtml(a.id)}">✎</button>
      <button type="button" class="icon-btn card-delete-btn ae-delete-btn" aria-label="Remove ${escapeHtml(title)} from hunt list" data-id="${escapeHtml(a.id)}">✕</button>
    </div>`;
}

function renderHuntList() {
  const list = document.getElementById('acquireList');
  if (!list) return;
  if (!state.acquire.length) {
    list.innerHTML = '<div class="empty-state">Nothing on your hunt list yet. Tap <b>☆ Hunt this</b> on any opportunity, or add your own below.</div>';
    return;
  }
  const order = { High: 0, Medium: 1, Low: 2 };
  list.innerHTML = state.acquire.slice().sort((a, b) => (order[a.priority] ?? 1) - (order[b.priority] ?? 1)).map(huntCardHTML).join('');
  list.querySelectorAll('.hunt-edit-form').forEach(form => wireHuntCategory(form));
}

// Edits apply immediately and save in the background: Apps Script can take a
// minute to answer, and a stuck "Saving…" form is worse than a late notice.
async function saveHuntEdit(id, form) {
  const status = form.querySelector('.ae-status');
  const body = { id, ...readHuntForm(form) };
  if (!body.itemType) { status.textContent = 'Add the item or search term.'; return; }
  const item = state.acquire.find(a => String(a.id) === String(id));
  if (item) Object.assign(item, body);
  acqState.editingHuntId = null;
  rebuildOpportunities();
  renderAcquireAll();
  if (!connected()) { localSet('sellHub.acquire.local', state.acquire); return; }
  setHuntStatus('Saving to your Sheet…');
  try {
    const saved = await apiPost('updateAcquireItem', body);
    if (!saved || saved.ok === false) throw new Error('not confirmed');
    if (item) Object.assign(item, Object.fromEntries(Object.entries(saved).filter(([k]) => k !== 'ok')));
    setHuntStatus('Saved.', 1500);
  } catch {
    setHuntStatus("Couldn't confirm the save — it may still have landed. Reload to check before editing again.");
  }
}

function setHuntStatus(text, clearAfter) {
  const el = document.getElementById('acqHuntStatus');
  if (!el) return;
  el.textContent = text;
  clearTimeout(setHuntStatus.timer);
  if (clearAfter) setHuntStatus.timer = setTimeout(() => { el.textContent = ''; }, clearAfter);
}

async function addHuntEntry(body, statusEl) {
  if (!body.itemType) { if (statusEl) statusEl.textContent = 'Add the item or search term.'; return null; }
  if (statusEl) statusEl.textContent = 'Saving…';
  let entry;
  if (connected()) {
    try {
      const saved = await apiPost('addAcquireItem', body);
      if (!saved || !saved.id) { if (statusEl) statusEl.textContent = 'Sheet did not confirm the save — is Code.gs redeployed?'; return null; }
      entry = { ...body, ...saved };
    } catch { if (statusEl) statusEl.textContent = 'Could not save to your Sheet.'; return null; }
  } else {
    entry = { ...body, id: `acq-${Date.now()}`, dateAdded: todayStr() };
  }
  state.acquire.push(entry);
  if (!connected()) localSet('sellHub.acquire.local', state.acquire);
  rebuildOpportunities();
  return entry;
}

async function deleteHuntEntry(id) {
  const entry = state.acquire.find(a => String(a.id) === String(id));
  const name = entry ? [entry.brand, entry.itemType].filter(Boolean).join(' ') : 'this';
  if (!confirm(`Remove ${name} from your hunt list?`)) return false;
  state.acquire = state.acquire.filter(a => String(a.id) !== String(id));
  rebuildOpportunities();
  renderAcquireAll();
  if (connected()) {
    try { await apiPost('deleteAcquireItem', { id }); }
    catch { /* already removed locally; the Sheet drifts until the next successful call */ }
  } else {
    localSet('sellHub.acquire.local', state.acquire);
  }
  return true;
}

// "Hunt this" on an opportunity: creates a linked hunt entry, or removes the
// existing one. Linking by opportunity ID keeps it from ever duplicating.
async function toggleHunt(oppId, btn) {
  const opp = acqOpp(oppId);
  if (!opp) return;
  if (opp.hunt) {
    await deleteHuntEntry(opp.hunt.id);
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  const d = opp.derived;
  const entry = await addHuntEntry({
    brand: opp.brand || '',
    itemType: opp.searchTerm,
    category: opp.category.groupLabel,
    subcategory: opp.category.subcategory || '',
    model: opp.model || '',
    targetPrice: d.maxBuy ? `under $${d.maxBuy}` : '',
    desiredProfit: d.desiredProfit ? `$${Math.round(d.desiredProfit)}` : '',
    bestPlatform: d.best && PLATFORM_META[d.best.obs.platformId] ? d.best.obs.platformId : '',
    priority: 'Medium',
    whereToFind: d.locations.join(', '),
    opportunityId: opp.id,
    size: '', color: '', condition: '', notes: '', targetVariant: '', inspectionNotes: '',
  }, null);
  if (!entry && btn) { btn.disabled = false; btn.textContent = "Couldn't save — retry"; return; }
  renderAcquireAll();
}

function renderHuntAddForm() {
  const holder = document.getElementById('acqHuntForm');
  if (!holder || holder.dataset.built) return;
  holder.innerHTML = `<form class="hunt-add-form" novalidate>${huntFormFieldsHTML({}, 'add')}<button type="submit" class="btn" id="addAcquireBtn">Add to hunt list</button><p class="status-msg" id="acquireStatus" role="status"></p></form>`;
  holder.dataset.built = '1';
  const form = holder.querySelector('form');
  wireHuntCategory(form);
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const status = document.getElementById('acquireStatus');
    const entry = await addHuntEntry(readHuntForm(form), status);
    if (!entry) return;
    form.reset();
    wireHuntCategory(form);
    status.textContent = 'Added.';
    setTimeout(() => { status.textContent = ''; }, 1500);
    renderAcquireAll();
  });
}

// ---------------------------------------------------------------------------
// Render + events
// ---------------------------------------------------------------------------
function renderAcquireAll() {
  renderAcquireFreshness();
  renderAcquirePulse();
  renderAcquireLanes();
  renderAcquireMediaShelf();
  renderAcquireControls();
  renderAcquireExplorer();
  renderAcquireCategories();
  renderHuntList();
  renderHuntAddForm();
  const drawer = document.getElementById('acqDrawer');
  if (drawer && !drawer.hidden && acqState.drawerMode === 'opp') {
    // Keep the open drawer's hunt button in step without resetting the calculator.
    const opp = acqOpp(acqState.drawerId);
    drawer.querySelectorAll('.hunt-btn[data-hunt]').forEach(btn => {
      const hunting = !!(opp && opp.hunt);
      btn.classList.toggle('hunting', hunting);
      btn.setAttribute('aria-pressed', String(hunting));
      btn.disabled = false;
      btn.innerHTML = `<span aria-hidden="true">${hunting ? '★' : '☆'}</span> ${hunting ? 'Hunting' : 'Hunt this'}`;
    });
  }
}

function setAcquireFilter(patch) {
  acqState.filters = { ...acqState.filters, ...patch };
  if ('frequency' in patch) acqPrefSet('frequency', acqState.filters.frequency);
  acqState.showAll = false;
  renderAcquirePulse();
  renderAcquireControls();
  renderAcquireExplorer();
  renderAcquireCategories();
}

function scrollToAcquire(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function wireAcquire() {
  const section = document.getElementById('acquire');
  if (!section) return;
  acqState.quick = !!acqPrefGet('quick', false);
  acqState.sort = acqPrefGet('sort', 'score');
  if (!ACQUIRE_CONFIG.sorts.some(s => s.id === acqState.sort)) acqState.sort = 'score';
  // Thrift-first: default frequency to Common when no saved preference so Everyday thrift finds dominate.
  acqState.filters.frequency = acqPrefGet('frequency', 'Common');

  let searchTimer = null;
  document.getElementById('acqSearch').addEventListener('input', ev => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => setAcquireFilter({ q: ev.target.value }), 150);
  });
  document.getElementById('acqSort').addEventListener('change', ev => {
    acqState.sort = ev.target.value;
    acqPrefSet('sort', acqState.sort);
    acqState.showAll = false;
    renderAcquireExplorer();
  });
  document.getElementById('acqQuickSource').addEventListener('change', ev => {
    acqState.quick = ev.target.checked;
    acqPrefSet('quick', acqState.quick);
    renderAcquireExplorer();
  });
  document.getElementById('acqFilters').addEventListener('change', ev => {
    const key = ev.target.dataset.filter;
    if (key) setAcquireFilter({ [key]: ev.target.value });
  });
  const toggle = document.getElementById('acqFilterToggle');
  toggle.addEventListener('click', () => {
    const filters = document.getElementById('acqFilters');
    const open = !filters.classList.contains('open');
    filters.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
  });

  // One delegated handler for every button rendered into the tab and drawer.
  const onClick = async ev => {
    const t = ev.target.closest('button, [data-open]');
    if (!t) return;
    if (t.dataset.hunt !== undefined) { ev.preventDefault(); ev.stopPropagation(); await toggleHunt(t.dataset.hunt, t); return; }
    if (t.dataset.open !== undefined) { ev.preventDefault(); openAcquireDrawer('opp', t.dataset.open); return; }
    if (t.dataset.research !== undefined) {
      ev.preventDefault();
      acqState.researchTerm = t.dataset.term || '';
      openAcquireDrawer('research', t.dataset.research);
      return;
    }
    if (t.dataset.preset !== undefined) {
      const preset = acqState.filters.preset === t.dataset.preset ? '' : t.dataset.preset;
      setAcquireFilter({ preset });
      if (preset) scrollToAcquire('acq-explorer');
      return;
    }
    if (t.dataset.rail) {
      const rail = t.closest('.acq-rail');
      const scroller = rail && rail.querySelector('.acq-carousel');
      if (scroller) {
        scroller.scrollBy({
          left: Number(t.dataset.rail) * Math.min(300, scroller.clientWidth * 0.85),
          behavior: 'smooth'
        });
      }
      return;
    }
    if (t.dataset.scroll) {
      scrollToAcquire(t.dataset.scroll);
      const jump = t.closest('#acqJump');
      if (jump) {
        jump.querySelectorAll('button[data-scroll]').forEach(btn => {
          btn.classList.toggle('active', btn === t);
        });
      }
      return;
    }
    if (t.dataset.category !== undefined) {
      const category = t.classList.contains('cat-card') && acqState.filters.category === t.dataset.category ? '' : t.dataset.category;
      setAcquireFilter({ category });
      if (t.classList.contains('cat-card')) scrollToAcquire('acq-explorer');
      return;
    }
    if (t.dataset.clear !== undefined) {
      if (t.dataset.clear === 'all') setAcquireFilter({ q: '', category: '', budget: '', profit: '', sellThrough: '', risk: '', conditionReq: '', location: '', frequency: '', preset: '' });
      else setAcquireFilter({ [t.dataset.clear]: '' });
      return;
    }
    if (t.dataset.showAll !== undefined) { acqState.showAll = true; renderAcquireExplorer(); return; }
    if (t.dataset.lane !== undefined) {
      if (acqState.expandedLanes.has(t.dataset.lane)) acqState.expandedLanes.delete(t.dataset.lane);
      else acqState.expandedLanes.add(t.dataset.lane);
      renderAcquireLanes();
      return;
    }
    if (t.classList.contains('ae-edit-btn')) { acqState.editingHuntId = t.dataset.id; renderHuntList(); return; }
    if (t.classList.contains('ae-delete-btn')) { await deleteHuntEntry(t.dataset.id); return; }
    if (t.classList.contains('ae-cancel')) { acqState.editingHuntId = null; renderHuntList(); return; }
  };
  section.addEventListener('click', onClick);

  // Whole opportunity card opens its detail (buttons inside handle themselves).
  section.addEventListener('click', ev => {
    if (ev.target.closest('button, a, input, select, label')) return;
    const card = ev.target.closest('.opp-card');
    if (card) openAcquireDrawer('opp', card.dataset.id);
  });

  section.addEventListener('submit', ev => {
    const form = ev.target.closest('.hunt-edit-form');
    if (!form) return;
    ev.preventDefault();
    saveHuntEdit(form.closest('[data-hunt-id]').dataset.huntId, form);
  });

  const drawer = document.getElementById('acqDrawer');
  drawer.addEventListener('click', async ev => {
    if (ev.target.closest('.drawer-close')) { closeAcquireDrawer(); return; }
    await onClick(ev);
  });
  drawer.addEventListener('input', ev => {
    if (!ev.target.closest('[data-calc]')) return;
    const opp = acqOpp(acqState.drawerId);
    if (opp) updateDealCalculator(drawer, opp);
  });
  drawer.addEventListener('change', ev => {
    if (!ev.target.closest('[data-calc]')) return;
    const opp = acqOpp(acqState.drawerId);
    if (opp) updateDealCalculator(drawer, opp);
  });
  drawer.addEventListener('submit', ev => {
    const form = ev.target.closest('.research-form');
    if (!form) return;
    ev.preventDefault();
    submitResearchForm(form);
  });
  document.getElementById('acqDrawerBackdrop').addEventListener('click', closeAcquireDrawer);
  document.addEventListener('keydown', ev => {
    if (drawer.hidden) return;
    if (ev.key === 'Escape') { closeAcquireDrawer(); return; }
    if (ev.key !== 'Tab') return;
    // Keep keyboard focus inside the open drawer.
    const focusable = [...drawer.querySelectorAll('button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')].filter(el => !el.disabled && el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  });

  document.getElementById('acquireAddToggle').addEventListener('click', () => {
    const panel = document.getElementById('acquireAddPanel');
    const open = panel.style.display !== 'none';
    panel.style.display = open ? 'none' : '';
    document.getElementById('acquireAddToggle').textContent = open ? '+ Add to hunt list' : '− Close';
    document.getElementById('acquireAddToggle').setAttribute('aria-expanded', String(!open));
  });
}

// The mobile search bar sticks just under the site header, whose height
// depends on how the tabs wrap — measure it rather than hard-coding it.
function syncHeaderHeight() {
  const header = document.querySelector('header.top');
  if (header) document.documentElement.style.setProperty('--header-h', header.getBoundingClientRect().height + 'px');
}
window.addEventListener('resize', syncHeaderHeight);
syncHeaderHeight();

wireAcquire();
loadAcquireData();
