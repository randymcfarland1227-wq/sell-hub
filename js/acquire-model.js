// Acquire — derived sourcing intelligence. Pure functions only: raw market
// observations, sourcing intel and the Hunt List go in; scores, ceilings,
// confidence and verdicts come out. Nothing here touches the DOM, so rendering
// (js/acquire.js) never does business math, and every number on a card can be
// traced back to one of these helpers and ACQUIRE_CONFIG.
//
// Missing data stays missing: a value that can't be computed from real inputs
// is null, and the UI says "Not enough data" rather than showing a guess.

// Same slug rule as opportunityIdFor() in Code.gs — the two must agree.
function opportunityIdFor(term) {
  return String(term || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function roundMoney(v) { return v === null ? null : Math.round(v * 100) / 100; }

function marketPlatformId(label) {
  const s = String(label || '').toLowerCase();
  if (s.includes('ebay')) return 'ebay';
  if (s.includes('posh')) return 'poshmark';
  if (s.includes('mercari')) return 'mercari';
  if (s.includes('facebook') || s.includes('marketplace')) return 'facebook';
  return s.replace(/[^a-z0-9]+/g, '-');
}

function ageInDays(dateStr, now) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const then = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((today - then) / 86400000));
}

function splitLines(text) {
  return String(text || '').split(/\r?\n|•/).map(s => s.replace(/^[\s\-–✓*]+/, '').trim()).filter(Boolean);
}
function splitList(text) {
  return String(text || '').split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------
function resolveCategory(category, subcategory, taxonomy) {
  const cat = String(category || '').trim();
  const sub = String(subcategory || '').trim();
  const lower = s => s.toLowerCase();
  let group = taxonomy.find(g => lower(g.label) === lower(cat) || g.id === lower(cat));
  let resolvedSub = sub;
  if (!group && cat) {
    // Older rows carry a subcategory ("Outerwear") in the Category column.
    group = taxonomy.find(g => g.subs.some(s => lower(s) === lower(cat)));
    if (group && !sub) resolvedSub = group.subs.find(s => lower(s) === lower(cat));
  }
  if (!group && !cat && sub) group = taxonomy.find(g => g.subs.some(s => lower(s) === lower(sub)));
  if (group) return { groupId: group.id, groupLabel: group.label, icon: group.icon, subcategory: resolvedSub };
  if (cat) return { groupId: opportunityIdFor(cat), groupLabel: cat, icon: ACQUIRE_DEFAULT_CATEGORY_ICON, subcategory: resolvedSub };
  const other = taxonomy.find(g => g.id === 'other');
  return { groupId: 'other', groupLabel: other ? other.label : 'Other', icon: ACQUIRE_DEFAULT_CATEGORY_ICON, subcategory: resolvedSub };
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------
function calculateFees(salePrice, platformId, config) {
  const p = config.platforms[platformId];
  if (!p || salePrice === null) return null;
  if (p.flatUnder && salePrice < p.flatUnder.limit) return p.flatUnder.fee;
  return roundMoney(salePrice * p.rate + (p.fixed || 0));
}

// Seller-paid shipping estimate for this item on this platform.
function estimateShipping(shippingClass, platformId, config, buyerPaid) {
  const p = config.platforms[platformId];
  const cls = config.shippingClasses[String(shippingClass || '').toLowerCase()];
  if (!p) return { cost: null, known: false, viable: true, note: 'No fee model for this platform' };
  if (p.maxShippingClass && cls) {
    const order = Object.keys(config.shippingClasses);
    if (order.indexOf(String(shippingClass).toLowerCase()) > order.indexOf(p.maxShippingClass)) {
      return { cost: null, known: true, viable: false, note: `Too heavy for ${p.label}'s shipping label` };
    }
  }
  if (!p.sellerPaysShipping) return { cost: 0, known: true, viable: true, note: p.localOnly ? 'Local pickup' : 'Buyer pays shipping' };
  if (!cls) return { cost: null, known: false, viable: true, note: 'Shipping class unknown — not included' };
  if (cls.cost === null) return { cost: null, known: true, viable: false, note: 'Local pickup only' };
  // Buyer-paid shipping from the comps (an average that already includes the
  // free-shipping sales at $0) comes back to the seller, minus the fee on it.
  const credit = p.creditBuyerShipping && buyerPaid !== null && buyerPaid !== undefined && buyerPaid > 0
    ? roundMoney(buyerPaid * (1 - (p.rate || 0))) : 0;
  if (credit > 0) {
    const net = roundMoney(Math.max(0, cls.cost - credit));
    return { cost: net, label: cls.cost, credit, known: true, viable: true,
      note: `${cls.label} label ≈ $${cls.cost}, less ≈ $${credit.toFixed(2)} buyers typically pay` };
  }
  return { cost: cls.cost, label: cls.cost, credit: 0, known: true, viable: true, note: `${cls.label} estimate` };
}

// Expected and conservative sale prices from one platform's observation.
function calculateSalePrices(obs, config) {
  if (obs.median !== null) {
    const spread = obs.low !== null && obs.high !== null && obs.median > 0 ? (obs.high - obs.low) / obs.median : null;
    const pull = spread === null ? 0.5 : clamp01(spread / config.conservative.wideSpread);
    const floor = obs.low !== null ? obs.low : obs.median * 0.8;
    return { expected: obs.median, conservative: roundMoney(obs.median - (obs.median - floor) * pull), basis: 'median', spread };
  }
  if (obs.avg !== null) {
    return { expected: obs.avg, conservative: roundMoney(obs.avg * config.conservative.avgOnlyDiscount), basis: 'average', spread: null };
  }
  return { expected: null, conservative: null, basis: null, spread: null };
}

function calculateDesiredProfit(salePrice, config) {
  if (salePrice === null) return null;
  return roundMoney(Math.max(config.desiredProfit.minDollars, salePrice * config.desiredProfit.shareOfSale));
}

function calculateRiskBuffer(salePrice, testingRisk, config) {
  if (salePrice === null) return null;
  const extra = config.riskBuffer[testingRisk] || 0;
  return roundMoney(salePrice * (config.riskBuffer.base + extra));
}

// The most you can pay and still clear your minimum profit after fees,
// shipping and a risk reserve. Returns 0 when there's no margin at any price.
function calculateMaxBuy({ conservativeSale, fees, shipping, desiredProfit, riskBuffer }) {
  if (conservativeSale === null || fees === null || desiredProfit === null) return null;
  const ceiling = conservativeSale - fees - (shipping || 0) - desiredProfit - (riskBuffer || 0);
  return ceiling < 1 ? 0 : Math.floor(ceiling);
}

function calculateExpectedProfit({ conservativeNet, expectedNet, costLow, costHigh }) {
  if (conservativeNet === null || expectedNet === null || costLow === null || costHigh === null) return null;
  return {
    low: roundMoney(conservativeNet - costHigh),
    high: roundMoney(expectedNet - costLow),
    mid: roundMoney((conservativeNet + expectedNet) / 2 - (costLow + costHigh) / 2),
  };
}

function calculateROI(profit, cost) {
  if (profit === null || cost === null || cost <= 0) return null;
  return profit / Math.max(cost, 1);
}

// ---------------------------------------------------------------------------
// Market velocity, confidence and trend
// ---------------------------------------------------------------------------
function normalizeObservation(row) {
  const platformId = marketPlatformId(row.platform);
  const salesFound = toNumber(row.recentSalesFound);
  const active = toNumber(row.activeListings);
  let sellThrough = toNumber(row.sellThrough);
  let sellThroughDerived = false;
  if (sellThrough !== null) sellThrough = sellThrough > 1 ? sellThrough / 100 : sellThrough;
  else if (salesFound !== null && active !== null && salesFound + active > 0) {
    sellThrough = salesFound / (salesFound + active);
    sellThroughDerived = true;
  }
  const sampleSize = toNumber(row.sampleSize);
  return {
    platform: row.platform,
    platformId,
    avg: toNumber(row.avgSoldPrice),
    median: toNumber(row.medianSoldPrice),
    low: toNumber(row.lowSoldPrice),
    high: toNumber(row.highSoldPrice),
    salesFound,
    sampleSize: sampleSize !== null ? sampleSize : null,
    activeListings: active,
    sellThrough,
    sellThroughDerived,
    avgShipping: toNumber(row.avgShipping),
    source: row.source || '',
    lastChecked: row.lastChecked || '',
    imageUrl: row.imageUrl || '',
  };
}

function calculateVelocity(obs, config) {
  const windowDays = config.soldWindowDays[obs.platformId];
  if (!windowDays || obs.salesFound === null || obs.salesFound <= 0) return { perDay: null, daysOfSupply: null };
  const perDay = obs.salesFound / windowDays;
  return { perDay, daysOfSupply: obs.activeListings === null ? null : obs.activeListings / perDay };
}

function calculateConfidence(observations, primary, now, config) {
  const c = config.confidence;
  if (!primary) return { score: 0, label: 'Low', reasons: ['No market data yet'], note: "Market data hasn't been collected for this yet." };
  const n = primary.sampleSize !== null ? primary.sampleSize : primary.salesFound;
  const sample = n === null ? 0 : clamp01(n / c.sampleFull);
  const age = ageInDays(primary.lastChecked, now);
  const ageScore = age === null ? 0 : c.ageDays.find(a => age <= a.max).score;
  const sources = observations.filter(o => o.median !== null || o.avg !== null).length;
  const sourceScore = sources >= 2 ? 1 : sources === 1 ? 0.6 : 0;
  const prices = calculateSalePrices(primary, config);
  let consistency = 0.5;
  if (prices.spread !== null) {
    consistency = prices.spread <= c.consistentSpread ? 1
      : prices.spread >= c.inconsistentSpread ? 0.2
        : 1 - 0.8 * (prices.spread - c.consistentSpread) / (c.inconsistentSpread - c.consistentSpread);
  }
  const score = c.weights.sample * sample + c.weights.age * ageScore + c.weights.sources * sourceScore + c.weights.consistency * consistency;
  const label = c.bands.find(b => score >= b.min).label;
  const reasons = [];
  if (n !== null) reasons.push(`${n} sold sampled`);
  if (age !== null) reasons.push(age === 0 ? 'refreshed today' : `refreshed ${age} day${age === 1 ? '' : 's'} ago`);
  reasons.push(`${sources} source${sources === 1 ? '' : 's'}`);
  if (prices.spread !== null && prices.spread >= c.inconsistentSpread) reasons.push('prices vary widely');
  if (prices.basis === 'average') reasons.push('average only, no median');
  let note = null;
  if (n !== null && n < c.sampleTiny) note = `Only ${n} recent sale${n === 1 ? '' : 's'} found — treat this result cautiously.`;
  else if (age !== null && age > config.freshness.veryStaleDays) note = `Last researched ${age} days ago.`;
  return { score, label, reasons, note, sampleSize: n, ageDays: age, sources };
}

function calculateTrendDirection(historyRows, primary, config) {
  if (!primary) return { direction: 'insufficient', label: '? Insufficient data', change: null, since: null };
  const rows = historyRows
    .filter(h => marketPlatformId(h.platform) === primary.platformId && (!primary.source || !h.source || h.source === primary.source))
    .map(h => ({ date: String(h.date || '').slice(0, 10), value: toNumber(h.medianSoldPrice) !== null ? toNumber(h.medianSoldPrice) : toNumber(h.avgSoldPrice) }))
    .filter(h => h.date && h.value !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  const since = rows.length ? rows[0].date : null;
  if (rows.length < 2) return { direction: 'insufficient', label: '? Insufficient data', change: null, since, points: rows };
  const latest = rows[rows.length - 1];
  const latestDate = new Date(latest.date);
  const past = rows.slice(0, -1).reverse().find(r => (latestDate - new Date(r.date)) / 86400000 >= config.trend.minDays);
  if (!past || past.value <= 0) return { direction: 'insufficient', label: '? Insufficient data', change: null, since, points: rows };
  const change = (latest.value - past.value) / past.value;
  if (change >= config.trend.risingChange) return { direction: 'rising', label: '↑ Rising', change, since: past.date, points: rows };
  if (change <= config.trend.coolingChange) return { direction: 'cooling', label: '↓ Cooling', change, since: past.date, points: rows };
  return { direction: 'stable', label: '→ Stable', change, since: past.date, points: rows };
}

// ---------------------------------------------------------------------------
// Score and classification
// ---------------------------------------------------------------------------
function calculateOpportunityScore(m, config) {
  const t = config.scoreTargets;
  const factors = {
    demand: m.sellThrough === null ? null : clamp01(m.sellThrough / t.sellThroughFull),
    profit: m.profitMid === null ? null : clamp01(m.profitMid / t.profitFull),
    roi: m.roi === null ? null : clamp01(m.roi / t.roiFull),
    volume: m.sales === null ? null : clamp01(Math.log10(1 + m.sales) / Math.log10(1 + t.volumeFull)),
    shipping: m.shippingEase === null ? null : m.shippingEase,
    testing: m.testingRisk in config.riskScore ? config.riskScore[m.testingRisk] : null,
    competition: m.demandSupply === null ? null : clamp01(m.demandSupply / t.demandSupplyFull),
    confidence: m.confidence === null ? null : clamp01(m.confidence),
  };
  let total = 0;
  const contributions = {};
  Object.keys(config.scoreWeights).forEach(k => {
    const c = factors[k] === null ? 0 : factors[k] * config.scoreWeights[k];
    contributions[k] = Math.round(c * 1000) / 10;
    total += c;
  });
  const raw = Math.round(total * 100);
  let score = raw;
  let cap = null;
  if (m.maxBuy === 0 && raw > config.scoreCaps.noMargin) {
    score = config.scoreCaps.noMargin;
    cap = { id: 'noMargin', limit: score, reason: 'No margin left at the conservative sale price' };
  } else if (m.maxBuy !== null && m.maxBuy > 0 && m.costLow !== null && m.maxBuy < m.costLow && raw > config.scoreCaps.belowTypicalCost) {
    score = config.scoreCaps.belowTypicalCost;
    cap = { id: 'belowTypicalCost', limit: score, reason: `Max buy ($${m.maxBuy}) is under its usual $${m.costLow}+ price` };
  }
  return { score, raw, cap, factors, contributions };
}

function scoreBand(score, config) {
  return config.scoreBands.find(b => score >= b.min);
}

function overallRisk(intel) {
  const order = { Low: 1, Medium: 2, High: 3 };
  const levels = [intel.testingRisk, intel.counterfeitRisk, intel.returnRisk].filter(l => order[l]);
  if (!levels.length) return null;
  return levels.reduce((a, b) => (order[b] > order[a] ? b : a));
}

function classifyOpportunity(opp, config) {
  const d = opp.derived;
  const intel = opp.intel;
  const flags = [];
  const mustTest = intel.testingRisk === 'High' || intel.conditionRequirement === 'Must test';
  const authenticate = intel.counterfeitRisk === 'High' || intel.conditionRequirement === 'Authentication concern';
  if (mustTest) flags.push({ id: 'testing', icon: '🧪', label: 'Testing required' });
  if (authenticate) flags.push({ id: 'authenticate', icon: '🔍', label: 'Authenticate' });
  if (d.sellThrough !== null && d.sellThrough >= config.flags.fastSellThrough) flags.push({ id: 'fast', icon: '⚡', label: 'Fast mover' });
  if (d.sellThrough !== null && d.sellThrough < config.flags.slowSellThrough) flags.push({ id: 'slow', icon: '🐌', label: 'Slow mover' });
  if (d.confidence.label === 'Low') flags.push({ id: 'thin', icon: '❔', label: 'Thin data' });
  if (d.confidence.ageDays !== null && d.confidence.ageDays > config.freshness.staleDays) flags.push({ id: 'stale', icon: '🕰️', label: `Data ${d.confidence.ageDays}d old` });
  if (String(intel.shippingClass).toLowerCase() === 'local') flags.push({ id: 'local', icon: '📍', label: 'Local pickup' });
  if (d.maxBuy > 0 && d.cost && d.maxBuy < d.cost.low) flags.push({ id: 'price', icon: '🏷️', label: `Only under $${d.maxBuy}` });

  let status;
  if (!d.hasMarketData) status = { id: 'nodata', icon: '⏳', label: 'Awaiting data' };
  else if (d.maxBuy === 0) status = { id: 'pass', icon: '❌', label: 'No margin' };
  else if (d.score < 40) status = { id: 'pass', icon: '❌', label: 'Usually pass' };
  else if (d.score >= 85) status = { id: 'strong-buy', icon: '🔥', label: 'Strong buy' };
  else if (d.score >= 70) status = { id: 'good-buy', icon: '✅', label: 'Good buy' };
  else if (mustTest) status = { id: 'testing', icon: '🧪', label: 'Testing required' };
  else if (d.sellThrough !== null && d.sellThrough < config.flags.slowSellThrough) status = { id: 'slow', icon: '🐌', label: 'Slow mover' };
  else status = { id: 'conditional', icon: '⚠️', label: 'Conditional' };
  return { status, flags };
}

// ---------------------------------------------------------------------------
// Opportunities
// ---------------------------------------------------------------------------
function blankIntel(term) {
  return {
    opportunityId: opportunityIdFor(term), searchTerm: term, brand: '', model: '', category: '', subcategory: '', keywords: '',
    shippingClass: '', testingRisk: '', counterfeitRisk: '', shippingDifficulty: '', fragility: '', returnRisk: '',
    knowledgeLevel: '', conditionRequirement: '', typicalCostLow: '', typicalCostHigh: '', sourcingLocations: '',
    inspectionNotes: '', recognitionNotes: '', platformNotes: '', active: 'Y', ebayQuery: '', poshmarkQuery: '',
  };
}

function isInactive(intel) {
  return ['n', 'no', 'false'].includes(String(intel.active || '').trim().toLowerCase());
}

function matchHuntEntry(opp, watchlist) {
  return watchlist.find(w => String(w.opportunityId || '') === opp.id)
    || watchlist.find(w => !w.opportunityId && (opportunityIdFor(w.itemType) === opp.id || opportunityIdFor(`${w.brand} ${w.itemType}`) === opp.id))
    || null;
}

// Evaluates one platform as a place to sell this item.
function platformEconomics(obs, intel, config) {
  const prices = calculateSalePrices(obs, config);
  const ship = estimateShipping(intel.shippingClass, obs.platformId, config, obs.avgShipping);
  const feesConservative = calculateFees(prices.conservative, obs.platformId, config);
  const feesExpected = calculateFees(prices.expected, obs.platformId, config);
  const shippingCost = ship.cost === null ? 0 : ship.cost;
  const conservativeNet = prices.conservative === null || feesConservative === null ? null : roundMoney(prices.conservative - feesConservative - shippingCost);
  const expectedNet = prices.expected === null || feesExpected === null ? null : roundMoney(prices.expected - feesExpected - shippingCost);
  return { obs, prices, shipping: ship, fees: feesConservative, conservativeNet, expectedNet };
}

function buildOpportunities({ trends = [], intel = [], history = [], watchlist = [] }, config, taxonomy, now) {
  now = now || new Date();
  const byId = new Map();
  const ensure = (id, term) => {
    if (!byId.has(id)) byId.set(id, { id, intel: blankIntel(term), rows: [], history: [] });
    return byId.get(id);
  };
  intel.forEach(row => {
    const id = row.opportunityId || opportunityIdFor(row.searchTerm);
    if (!id) return;
    const entry = ensure(id, row.searchTerm);
    entry.intel = { ...entry.intel, ...row, opportunityId: id };
  });
  trends.forEach(row => {
    const id = row.opportunityId || opportunityIdFor(row.searchTerm);
    if (!id) return;
    const entry = ensure(id, row.searchTerm);
    entry.rows.push(row);
    if (!entry.intel.category && row.category) entry.intel.category = row.category;
  });
  history.forEach(row => { if (byId.has(row.opportunityId)) byId.get(row.opportunityId).history.push(row); });

  const out = [];
  byId.forEach(entry => {
    if (isInactive(entry.intel)) return;
    const intelRow = entry.intel;
    const observations = entry.rows.map(normalizeObservation).filter(o => o.median !== null || o.avg !== null);
    const primary = observations.slice().sort((a, b) =>
      ((b.sampleSize ?? b.salesFound ?? 0) + (b.median !== null ? 1e6 : 0)) - ((a.sampleSize ?? a.salesFound ?? 0) + (a.median !== null ? 1e6 : 0)))[0] || null;
    const category = resolveCategory(intelRow.category, intelRow.subcategory, taxonomy);

    const economics = observations.map(o => platformEconomics(o, intelRow, config));
    const ranked = economics
      .filter(e => e.shipping.viable && e.conservativeNet !== null && (e.obs.sampleSize ?? e.obs.salesFound ?? 0) >= config.minSampleForPlatform)
      .sort((a, b) => b.conservativeNet - a.conservativeNet);
    const best = ranked[0] || null;

    const costLow = toNumber(intelRow.typicalCostLow);
    const costHigh = toNumber(intelRow.typicalCostHigh) ?? costLow;
    const cost = costLow === null ? null : { low: costLow, high: costHigh ?? costLow, mid: (costLow + (costHigh ?? costLow)) / 2 };

    const conservativeSale = best ? best.prices.conservative : null;
    const desiredProfit = calculateDesiredProfit(conservativeSale, config);
    const riskBuffer = calculateRiskBuffer(conservativeSale, intelRow.testingRisk, config);
    const maxBuy = best ? calculateMaxBuy({
      conservativeSale, fees: best.fees, shipping: best.shipping.cost, desiredProfit, riskBuffer,
    }) : null;
    const profit = best && cost ? calculateExpectedProfit({
      conservativeNet: best.conservativeNet, expectedNet: best.expectedNet, costLow: cost.low, costHigh: cost.high,
    }) : null;
    const roi = profit && cost ? calculateROI(profit.mid, cost.mid) : null;

    const demandObs = primary && primary.sellThrough !== null ? primary : observations.find(o => o.sellThrough !== null) || null;
    const sellThrough = demandObs ? demandObs.sellThrough : null;
    const supplyObs = observations.find(o => o.salesFound !== null && o.activeListings !== null && o.activeListings > 0) || null;
    const demandSupply = supplyObs ? supplyObs.salesFound / supplyObs.activeListings : null;
    const velocity = supplyObs ? calculateVelocity(supplyObs, config) : { perDay: null, daysOfSupply: null };
    const sales = primary ? (primary.salesFound ?? primary.sampleSize) : null;
    const confidence = calculateConfidence(observations, primary, now, config);
    const trend = calculateTrendDirection(entry.history, primary, config);
    const shipClass = config.shippingClasses[String(intelRow.shippingClass || '').toLowerCase()];

    const scored = calculateOpportunityScore({
      sellThrough, profitMid: profit ? profit.mid : null, roi, sales,
      shippingEase: shipClass ? shipClass.ease : null, testingRisk: intelRow.testingRisk,
      demandSupply, confidence: primary ? confidence.score : null,
      maxBuy, costLow: cost ? cost.low : null,
    }, config);

    const imageUrl = (primary && primary.imageUrl) || (observations.find(o => o.imageUrl) || {}).imageUrl || '';
    const lastChecked = observations.map(o => o.lastChecked).filter(Boolean).sort().pop() || '';

    const opp = {
      id: entry.id,
      searchTerm: intelRow.searchTerm || (entry.rows[0] && entry.rows[0].searchTerm) || entry.id,
      brand: intelRow.brand || '',
      model: intelRow.model || '',
      keywords: intelRow.keywords || '',
      category,
      imageUrl,
      intel: intelRow,
      observations,
      history: entry.history,
      economics,
      lastChecked,
      derived: {
        hasMarketData: !!primary,
        primary,
        best,
        platformRanking: ranked,
        expectedSale: best ? best.prices.expected : primary ? calculateSalePrices(primary, config).expected : null,
        conservativeSale,
        priceBasis: best ? best.prices.basis : primary ? calculateSalePrices(primary, config).basis : null,
        fees: best ? best.fees : null,
        shipping: best ? best.shipping : null,
        expectedNet: best ? best.expectedNet : null,
        conservativeNet: best ? best.conservativeNet : null,
        desiredProfit,
        riskBuffer,
        maxBuy,
        cost,
        profit,
        roi,
        sellThrough,
        sellThroughDerived: demandObs ? demandObs.sellThroughDerived : false,
        demandSupply,
        velocity,
        sales,
        confidence,
        trend,
        score: scored.score,
        rawScore: scored.raw,
        scoreCap: scored.cap,
        factors: scored.factors,
        contributions: scored.contributions,
        risk: overallRisk(intelRow),
        locations: splitList(intelRow.sourcingLocations),
        inspection: splitLines(intelRow.inspectionNotes),
        recognition: splitLines(intelRow.recognitionNotes),
      },
    };
    opp.derived.band = scoreBand(opp.derived.score, config);
    const cls = classifyOpportunity(opp, config);
    opp.derived.status = cls.status;
    opp.derived.flags = cls.flags;
    opp.hunt = matchHuntEntry(opp, watchlist);
    out.push(opp);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Deal calculator
// ---------------------------------------------------------------------------
function evaluateDeal(opp, { purchasePrice, conditionId, shippingOverride, platformId }, config) {
  const price = toNumber(purchasePrice);
  const condition = config.conditions.find(c => c.id === conditionId) || config.conditions.find(c => c.id === 'good');
  const econ = opp.economics.find(e => e.obs.platformId === platformId) || opp.derived.best || opp.economics[0];
  if (!econ || econ.prices.conservative === null) return { ready: false, reason: 'Not enough market data to price this yet.' };
  const saleFor = mult => roundMoney(econ.prices.conservative * mult);
  const shipOverride = toNumber(shippingOverride);
  const shipping = shipOverride !== null ? shipOverride : econ.shipping.cost;
  const shippingKnown = shipOverride !== null || econ.shipping.known;
  const sale = saleFor(condition.multiplier);
  const fees = calculateFees(sale, econ.obs.platformId, config);
  const net = roundMoney(sale - fees - (shipping || 0));
  const desired = calculateDesiredProfit(sale, config);
  const base = {
    ready: true, platformId: econ.obs.platformId, platformLabel: (config.platforms[econ.obs.platformId] || { label: econ.obs.platform }).label,
    condition, sale, fees, shipping, shippingKnown, shippingNote: shipOverride !== null ? 'your estimate' : econ.shipping.note, net, desired,
    basis: econ.prices.basis,
  };
  if (price === null) return { ...base, profit: null, roi: null, verdict: null };
  const profit = roundMoney(net - price);
  const roi = calculateROI(profit, price);
  const untestedCondition = config.conditions.find(c => c.id === 'untested');
  const untestedSale = saleFor(untestedCondition.multiplier);
  const untestedProfit = roundMoney(untestedSale - calculateFees(untestedSale, econ.obs.platformId, config) - (shipping || 0) - price);

  let verdict;
  const summary = `About $${profit.toFixed(0)} profit on $${price.toFixed(2)}.`;
  if (profit <= 0) verdict = { id: 'fail', icon: '❌', label: 'Margin too small', detail: `You'd lose about $${Math.abs(profit).toFixed(0)} after fees and shipping.` };
  else if (profit < desired) verdict = { id: 'thin', icon: '⚠️', label: 'Thin margin', detail: `About $${profit.toFixed(0)} profit — under your $${desired.toFixed(0)} minimum for an item at this price.` };
  else {
    verdict = roi !== null && roi >= config.calculator.excellentRoi
      ? { id: 'excellent', icon: '🔥', label: 'Excellent buy', detail: summary }
      : { id: 'good', icon: '✅', label: 'Good buy', detail: summary };
    // High failure rate and priced as working: it has to hold up untested too.
    if (opp.intel.testingRisk === 'High' && !condition.untested) {
      verdict = untestedProfit >= calculateDesiredProfit(untestedSale, config)
        ? { ...verdict, detail: `${summary} Still about $${untestedProfit.toFixed(0)} if it turns out not to work.` }
        : { id: 'test', icon: '⚠️', label: 'Only buy if tested', detail: `${summary} That assumes it works — untested it would clear about $${untestedProfit.toFixed(0)}.` };
    } else if (condition.untested) {
      verdict = { ...verdict, detail: `${verdict.detail} Priced as ${condition.label.toLowerCase()}.` };
    }
  }
  return { ...base, price, profit, roi, verdict };
}

// ---------------------------------------------------------------------------
// Pulse, categories, filters, sorting
// ---------------------------------------------------------------------------
const PULSE_PRESETS = {
  strong: { label: 'Strong opportunities', test: (o, c) => o.derived.hasMarketData && o.derived.score >= c.flags.strongScore },
  fast: { label: 'Fast movers', test: (o, c) => o.derived.sellThrough !== null && o.derived.sellThrough >= c.flags.fastSellThrough },
  lowcost: {
    label: 'Best low-cost buys',
    test: (o, c) => o.derived.cost && o.derived.expectedSale && o.derived.maxBuy > 0 && o.derived.cost.high <= o.derived.expectedSale * c.flags.lowCostRatio,
  },
  hunting: { label: 'On your hunt list', test: o => !!o.hunt },
  risky: {
    label: 'High potential, needs expertise',
    test: o => o.derived.hasMarketData && o.derived.score >= 55
      && (o.intel.testingRisk === 'High' || o.intel.counterfeitRisk === 'High' || o.intel.knowledgeLevel === 'Specialist'),
  },
};

function summarizePulse(opps, watchlist, config) {
  const withData = opps.filter(o => o.derived.hasMarketData);
  const topProfit = withData.filter(o => o.derived.profit).sort((a, b) => b.derived.profit.mid - a.derived.profit.mid)[0] || null;
  return {
    strong: opps.filter(o => PULSE_PRESETS.strong.test(o, config)).length,
    topProfit,
    fast: opps.filter(o => PULSE_PRESETS.fast.test(o, config)).length,
    lowcost: opps.filter(o => PULSE_PRESETS.lowcost.test(o, config)).length,
    hunting: watchlist.length,
    risky: opps.filter(o => PULSE_PRESETS.risky.test(o, config)).length,
    total: opps.length,
    withData: withData.length,
  };
}

function median(values) {
  if (!values.length) return null;
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function summarizeCategories(opps, taxonomy, config) {
  const groups = new Map();
  taxonomy.forEach(g => groups.set(g.id, { id: g.id, label: g.label, icon: g.icon, opps: [] }));
  opps.forEach(o => {
    if (!groups.has(o.category.groupId)) groups.set(o.category.groupId, { id: o.category.groupId, label: o.category.groupLabel, icon: o.category.icon, opps: [] });
    groups.get(o.category.groupId).opps.push(o);
  });
  return [...groups.values()].map(g => {
    const scored = g.opps.filter(o => o.derived.hasMarketData);
    return {
      id: g.id, label: g.label, icon: g.icon,
      count: g.opps.length,
      withData: scored.length,
      medianScore: scored.length ? Math.round(median(scored.map(o => o.derived.score))) : null,
      strong: scored.filter(o => o.derived.score >= config.flags.strongScore).length,
    };
  });
}

function filterOpportunities(opps, f, config) {
  const q = String(f.q || '').trim().toLowerCase();
  const terms = q ? q.split(/\s+/) : [];
  return opps.filter(o => {
    const d = o.derived;
    if (terms.length) {
      const hay = [o.searchTerm, o.brand, o.model, o.keywords, o.category.groupLabel, o.category.subcategory].join(' ').toLowerCase();
      if (!terms.every(t => hay.includes(t))) return false;
    }
    if (f.category && o.category.groupId !== f.category) return false;
    if (f.budget && !(d.cost && d.cost.low <= Number(f.budget))) return false;
    if (f.profit && !(d.profit && d.profit.mid >= Number(f.profit))) return false;
    if (f.sellThrough && !(d.sellThrough !== null && d.sellThrough >= Number(f.sellThrough))) return false;
    if (f.risk && d.risk !== f.risk) return false;
    if (f.conditionReq && o.intel.conditionRequirement !== f.conditionReq) return false;
    if (f.location && !d.locations.some(l => l.toLowerCase() === String(f.location).toLowerCase())) return false;
    if (f.frequency && String(o.intel.thriftFrequency || '') !== f.frequency) return false;
    if (f.preset && PULSE_PRESETS[f.preset] && !PULSE_PRESETS[f.preset].test(o, config)) return false;
    return true;
  });
}

function sortOpportunities(opps, sortId) {
  const val = {
    score: o => o.derived.hasMarketData ? o.derived.score : null,
    profit: o => o.derived.profit ? o.derived.profit.mid : null,
    roi: o => o.derived.roi,
    fast: o => o.derived.velocity.daysOfSupply === null ? null : -o.derived.velocity.daysOfSupply,
    sellThrough: o => o.derived.sellThrough,
    price: o => o.derived.expectedSale,
    maxBuyLow: o => o.derived.maxBuy ? -o.derived.maxBuy : null,
    sales: o => o.derived.sales,
    updated: o => o.lastChecked ? Number(o.lastChecked.replace(/-/g, '')) : null,
  }[sortId];
  const list = opps.slice();
  if (!val) return list.sort((a, b) => a.searchTerm.localeCompare(b.searchTerm));
  return list.sort((a, b) => {
    const va = val(a), vb = val(b);
    if (va === null && vb === null) return b.derived.score - a.derived.score || a.searchTerm.localeCompare(b.searchTerm);
    if (va === null) return 1;
    if (vb === null) return -1;
    return vb - va || b.derived.score - a.derived.score;
  });
}

// Freshness of each market source, for the header ("eBay · Sep 16").
function summarizeFreshness(trends, intel, now) {
  const latest = new Map();
  trends.forEach(t => {
    const key = (ACQUIRE_CONFIG.platforms[marketPlatformId(t.platform)] || { label: t.platform }).label;
    const d = String(t.lastChecked || '').slice(0, 10);
    if (d && (!latest.has(key) || d > latest.get(key))) latest.set(key, d);
  });
  const intelDate = intel.map(i => String(i.lastUpdated || '').slice(0, 10)).filter(Boolean).sort().pop();
  const out = [...latest.entries()].map(([label, date]) => ({ label, date, ageDays: ageInDays(date, now), kind: 'market' }));
  if (intelDate) out.push({ label: 'Sourcing intel', date: intelDate, ageDays: ageInDays(intelDate, now), kind: 'intel' });
  return out;
}

// ---------------------------------------------------------------------------
// Personal learning — groundwork. Sold history comes from inventory; there is
// no purchase-cost column yet, so "edge" (your profit vs. the market's) stays
// null until acquisition costs are tracked.
// ---------------------------------------------------------------------------
function buildUserHistory(inventory) {
  const sold = (inventory || []).filter(i => /sold/i.test(String(i.sourceStatus || '')));
  const byBrand = new Map();
  sold.forEach(i => {
    const brand = String(i.brand || '').trim().toLowerCase();
    if (!brand) return;
    if (!byBrand.has(brand)) byBrand.set(brand, []);
    byBrand.get(brand).push(i);
  });
  return { soldCount: sold.length, byBrand };
}

function calculateUserEdge(opp, userHistory) {
  if (!userHistory || !opp.brand) return null;
  const firstBrand = opp.brand.split('/')[0].trim().toLowerCase();
  const items = userHistory.byBrand.get(firstBrand);
  if (!items || !items.length) return null;
  const prices = items.map(i => toNumber(i.soldPrice)).filter(v => v !== null);
  return {
    soldCount: items.length,
    avgSoldPrice: prices.length ? roundMoney(prices.reduce((a, b) => a + b, 0) / prices.length) : null,
    avgCost: null,
    avgProfit: null,
    avgDaysToSale: null,
    edge: null,
    note: 'Track what you paid for items to see your own profit and edge here.',
  };
}

// ---------------------------------------------------------------------------
// Lanes — the curated shelves at the top of the tab. Each one is a filter over
// the same opportunities the explorer holds, with its own reason for existing.
// An opportunity can appear on more than one shelf: something can be both the
// best money and the fastest sale, and pretending otherwise would hide it.
// ---------------------------------------------------------------------------
const RISK_ORDER = { Low: 1, Medium: 2, High: 3 };

function laneBuyable(opp) {
  const d = opp.derived;
  if (d.maxBuy === null || !d.cost) return false;
  return d.maxBuy >= d.cost.low;
}

function laneQualifies(opp, lane, config) {
  const d = opp.derived;
  if (!d.hasMarketData) return false;
  if (lane.frequency && !lane.frequency.includes(String(opp.intel.thriftFrequency || ''))) return false;
  const min = lane.min || {};
  if (min.score !== undefined && d.score < min.score) return false;
  if (min.profit !== undefined && (!d.profit || d.profit.mid < min.profit)) return false;
  if (min.roi !== undefined && (d.roi === null || d.roi < min.roi)) return false;
  if (min.sellThrough !== undefined && (d.sellThrough === null || d.sellThrough < min.sellThrough)) return false;
  if (min.sales !== undefined && (d.sales === null || d.sales < min.sales)) return false;
  if (min.confidence !== undefined && (!d.confidence || d.confidence.score < min.confidence)) return false;
  if (lane.requireBuyable && !laneBuyable(opp)) return false;
  if (lane.maxRisk) {
    const risk = d.risk ? RISK_ORDER[d.risk] : null;
    if (risk === null || risk > RISK_ORDER[lane.maxRisk]) return false;
  }
  if (lane.shippingEase !== undefined) {
    const cls = config.shippingClasses[String(opp.intel.shippingClass || '').toLowerCase()];
    if (!cls || cls.ease === null || cls.ease < lane.shippingEase) return false;
  }
  return true;
}

function laneSort(list, how) {
  const by = {
    score: (a, b) => b.derived.score - a.derived.score,
    // Fewest days of supply first — that's what "moves fast" actually means.
    velocity: (a, b) => {
      const da = a.derived.velocity.daysOfSupply, db = b.derived.velocity.daysOfSupply;
      if (da === null && db === null) return (b.derived.sellThrough || 0) - (a.derived.sellThrough || 0);
      if (da === null) return 1;
      if (db === null) return -1;
      return da - db;
    },
    trend: (a, b) => (b.derived.trend.change || 0) - (a.derived.trend.change || 0),
    profit: (a, b) => (b.derived.profit ? b.derived.profit.mid : -Infinity) - (a.derived.profit ? a.derived.profit.mid : -Infinity),
  };
  return list.slice().sort(by[how] || by.score);
}

// "Emerging" is only ever claimed from real movement between two dated
// snapshots. When there aren't enough snapshots yet the lane says so and shows
// what it is tracking instead of inventing a direction.
function buildEmergingLane(opps, config) {
  const rising = opps.filter(o => o.derived.hasMarketData && o.derived.trend.direction === 'rising');
  const tracked = opps.filter(o => o.derived.hasMarketData);
  const dates = new Set();
  tracked.forEach(o => o.history.forEach(h => { const d = String(h.date || '').slice(0, 10); if (d) dates.add(d); }));
  const sorted = [...dates].sort();
  return {
    items: laneSort(rising, 'trend'),
    tracking: tracked.length,
    since: sorted[0] || null,
    days: sorted.length,
    needsDays: config.trend.minDays,
  };
}

function buildLanes(opps, config) {
  return config.lanes.map(lane => {
    if (lane.id === 'emerging') {
      const e = buildEmergingLane(opps, config);
      return { ...lane, items: e.items, total: e.items.length, meta: e };
    }
    const matching = laneSort(opps.filter(o => laneQualifies(o, lane, config)), lane.sort);
    return { ...lane, items: matching, total: matching.length, meta: null };
  });
}

// Platform Trends rows (Depop's "Popular this week" so far): the newest pull
// per platform, with a term matched to a researched opportunity where one
// exists so a trending search can jump straight into the comps.
function summarizePlatformTrends(rows, opps) {
  if (!rows || !rows.length) return [];
  const byPlatform = new Map();
  rows.forEach(row => {
    if (!row.term) return;
    const key = String(row.platform || 'Other');
    const date = String(row.date || '').slice(0, 10);
    const entry = byPlatform.get(key);
    if (!entry || date > entry.date) byPlatform.set(key, { platform: key, date, rows: [row] });
    else if (date === entry.date) entry.rows.push(row);
  });
  return [...byPlatform.values()].map(group => ({
    platform: group.platform,
    date: group.date,
    source: group.rows[0].source || '',
    terms: group.rows
      .slice()
      .sort((a, b) => (a.rank || 99) - (b.rank || 99))
      .map(row => {
        const slug = opportunityIdFor(row.term);
        const match = opps.find(o => o.id === slug) ||
          opps.find(o => o.searchTerm.toLowerCase() === row.term.toLowerCase()) || null;
        return { ...row, opportunity: match };
      }),
  })).sort((a, b) => a.platform.localeCompare(b.platform));
}
