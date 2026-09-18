// Acquire — every assumption the sourcing intelligence runs on, in one place.
// Scores, max-buy ceilings, verdicts and confidence all read from here; change a
// number here and every card, filter and calculator follows. Nothing in this
// file is marketplace data — fees and shipping costs are planning assumptions,
// and the site labels them as estimates wherever they show up.

const ACQUIRE_CONFIG = {
  // Seller-side fees per platform. `rate` applies to the sale price; `fixed` is
  // a per-order charge; `flatUnder` covers Poshmark's flat fee below $15.
  // sellerPaysShipping: whether the profit model subtracts a shipping cost.
  // creditBuyerShipping: sold comps report what buyers paid for shipping on
  // top of the price (free-shipping sales count as $0); that money offsets the
  // label, less the platform's cut of it. Randy's own eBay sales bear this out
  // — buyers paid $5–7 shipping on most of them.
  platforms: {
    ebay:     { label: 'eBay',     rate: 0.1325, fixed: 0.40, sellerPaysShipping: true, creditBuyerShipping: true },
    poshmark: { label: 'Poshmark', rate: 0.20,   fixed: 0, flatUnder: { limit: 15, fee: 2.95 }, sellerPaysShipping: false, maxShippingClass: 'medium' },
    mercari:  { label: 'Mercari',  rate: 0.10,   fixed: 0.50, sellerPaysShipping: true },
    facebook: { label: 'Facebook Marketplace', rate: 0, fixed: 0, sellerPaysShipping: false, localOnly: true },
  },

  // Seller-paid shipping estimates by shipping class (label cost, not what
  // buyers were charged). `ease` feeds the score's shipping factor.
  shippingClasses: {
    small:  { label: 'Small (≤1 lb mailer)', cost: 6,    ease: 1.0 },
    medium: { label: 'Medium (1–3 lb box)',  cost: 11,   ease: 0.75 },
    large:  { label: 'Large (3–10 lb box)',  cost: 18,   ease: 0.45 },
    bulky:  { label: 'Bulky (10+ lb)',       cost: 35,   ease: 0.2 },
    local:  { label: 'Local pickup only',    cost: null, ease: 0.1 },
  },

  // Minimum profit worth the trip: the larger of a flat floor or a share of the
  // expected sale.
  desiredProfit: { minDollars: 10, shareOfSale: 0.35 },

  // Reserve held back from the max-buy ceiling for things going wrong, by
  // testing risk (share of the conservative sale price).
  riskBuffer: { base: 0.03, Low: 0, Medium: 0.07, High: 0.15 },

  // How far toward the 25th percentile the "conservative" sale price moves as
  // the sold range widens. spread = (p75 - p25) / median; at or above
  // `wideSpread` the conservative price is the 25th percentile itself.
  conservative: { wideSpread: 0.8, avgOnlyDiscount: 0.9 },

  // Opportunity Score weights — must sum to 1. Each factor is normalized 0–1;
  // a factor with no data contributes nothing (it is never guessed).
  scoreWeights: {
    demand: 0.25,       // sell-through
    profit: 0.20,       // expected profit dollars
    roi: 0.15,          // expected ROI
    volume: 0.15,       // how many sold
    shipping: 0.10,     // shipping ease
    testing: 0.05,      // testing / condition risk
    competition: 0.05,  // sold vs. active supply
    confidence: 0.05,   // data confidence
  },
  // Value at which each factor maxes out (normalization targets).
  scoreTargets: {
    sellThroughFull: 0.7,     // 70% sell-through = full demand marks
    profitFull: 80,           // $80 expected profit = full marks
    roiFull: 4,               // 400% ROI = full marks
    volumeFull: 5000,         // 5,000 sold in the window = full marks (log scale)
    demandSupplyFull: 2,      // twice as many sold as are listed = full marks
  },
  // Caps that keep the score honest about whether you can actually buy it
  // right. They're shown in the score breakdown whenever they apply.
  scoreCaps: {
    noMargin: 54,             // no max buy at all at the conservative price
    belowTypicalCost: 69,     // max buy is under what it's usually priced at
  },
  riskScore: { Low: 1, Medium: 0.5, High: 0 },

  scoreBands: [
    { min: 85, id: 'excellent', label: 'Excellent', icon: '🔥' },
    { min: 70, id: 'strong',    label: 'Strong',    icon: '✅' },
    { min: 55, id: 'selective', label: 'Selective', icon: '⚖️' },
    { min: 40, id: 'risky',     label: 'Risky',     icon: '⚠️' },
    { min: 0,  id: 'pass',      label: 'Usually pass', icon: '❌' },
  ],


  // Shelves at the top of the tab. The explorer holds everything researched;
  // these three answer the three questions that actually come up in a store:
  // what's worth real money, what turns over fast, and what's heating up.
  // Every threshold here is a claim about the data, so nothing lands on a
  // shelf without the numbers behind it.
  lanes: [
    {
      id: 'everyday',
      title: 'Everyday thrift finds',
      icon: '🛒',
      blurb: 'Things that turn up on a normal thrift, bins or yard-sale run — and still at least double your money.',
      empty: 'None of the common finds clear the bar in the current data.',
      frequency: ['Common'],
      min: {
        profit: 10,          // worth the listing time
        roi: 1.0,            // doubles what you paid at the usual shelf price
        sellThrough: 0.18,   // common items have huge supply; below this they sit for months
        sales: 500,
        confidence: 0.55,
      },
      requireBuyable: true,
      sort: 'profit',
    },
    {
      id: 'strong',
      title: 'Strong buys',
      icon: '🔥',
      blurb: 'Best money per dollar spent, with enough sold data to trust the number.',
      empty: 'Nothing clears the bar right now. That usually means the market data needs a refresh, not that there is nothing out there.',
      min: {
        score: 70,           // Strong band or better
        profit: 15,          // at least this much expected profit per flip
        roi: 0.8,            // and it roughly doubles what you put in
      },
      requireBuyable: true,  // max buy has to beat what these usually cost
      sort: 'score',
    },
    {
      id: 'quick',
      title: 'Reliable quick sales',
      icon: '⚡',
      blurb: 'Smaller wins that move fast and rarely sit — low risk, easy to ship, proven demand.',
      empty: 'Nothing has both a high sell-through and a real margin in the current data.',
      min: {
        sellThrough: 0.55,
        sales: 50,           // a real, repeatedly-sold item, not a one-off
        profit: 8,
        confidence: 0.55,    // Medium confidence or better
      },
      maxRisk: 'Medium',
      shippingEase: 0.6,     // small/medium parcels only
      requireBuyable: true,
      sort: 'velocity',
    },
    {
      id: 'emerging',
      title: 'Emerging trends',
      icon: '📈',
      blurb: 'Prices or demand moving up, plus what shoppers are searching for more of this week.',
      empty: 'No rising prices yet — direction needs a few days of market snapshots to be real.',
      sort: 'trend',
    },
  ],
  laneSize: 6,

  // Thresholds for the status flags and Sourcing Pulse counts.
  flags: {
    fastSellThrough: 0.55,    // "Fast mover"
    slowSellThrough: 0.12,    // "Slow mover"
    lowCostRatio: 0.2,        // typical cost ≤ 20% of expected sale = "Best low-cost buy"
    strongScore: 70,
  },

  // Confidence: sample size, age, sources and price consistency, each 0–1.
  confidence: {
    weights: { sample: 0.3, age: 0.25, sources: 0.15, consistency: 0.3 },
    sampleFull: 40, sampleTiny: 5,
    ageDays: [{ max: 3, score: 1 }, { max: 7, score: 0.8 }, { max: 14, score: 0.6 }, { max: 30, score: 0.3 }, { max: Infinity, score: 0.1 }],
    consistentSpread: 0.5, inconsistentSpread: 1.2,
    bands: [{ min: 0.8, label: 'High' }, { min: 0.55, label: 'Medium' }, { min: 0, label: 'Low' }],
  },

  freshness: { staleDays: 14, veryStaleDays: 30 },

  // Window each source's sold count covers — used for velocity (days of supply).
  // Sources not listed have no known window, so no velocity is shown for them.
  soldWindowDays: { ebay: 90 },
  // A platform needs at least this many sampled sales to be ranked as a place to sell.
  minSampleForPlatform: 3,

  // Trend direction from Market History: needs two observations from the same
  // platform and source at least `minDays` apart.
  trend: { minDays: 6, risingChange: 0.08, coolingChange: -0.08 },

  // Deal calculator: condition changes the expected sale price (sold comps are a
  // mix of conditions, so "Good" is treated as the baseline).
  conditions: [
    { id: 'new',       label: 'New',        multiplier: 1.15 },
    { id: 'excellent', label: 'Excellent',  multiplier: 1.05 },
    { id: 'good',      label: 'Good',       multiplier: 1.0 },
    { id: 'fair',      label: 'Fair',       multiplier: 0.75 },
    { id: 'untested',  label: 'Untested',   multiplier: 0.55, untested: true },
    { id: 'parts',     label: 'Parts only', multiplier: 0.3,  untested: true },
  ],
  calculator: { excellentRoi: 1.5 },

  filters: {
    budgets: [10, 25, 50, 100],
    profits: [20, 40, 75, 100],
    sellThrough: [0.25, 0.5, 0.75],
    locations: ['Bins', 'Thrift store', 'Yard sale', 'Estate sale', 'Marketplace', 'Flea market'],
    conditionRequirements: ['Works untested', 'Testing recommended', 'Must test', 'Authentication concern'],
    frequencies: ['Common', 'Occasional', 'Rare'],
  },
  // How often a target turns up on a sourcing run (Sourcing Intel → Thrift
  // Frequency). An estimate, like typical cost.
  thriftFrequency: {
    Common:     { label: 'Common find', icon: '🛒', blurb: 'Turns up on most thrift/bins runs' },
    Occasional: { label: 'Occasional',  icon: '🔎', blurb: 'You will see one every few trips' },
    Rare:       { label: 'Rare find',   icon: '💎', blurb: 'Worth knowing, but do not plan a trip around it' },
  },

  sorts: [
    { id: 'score',      label: 'Best opportunities' },
    { id: 'profit',     label: 'Highest profit' },
    { id: 'roi',        label: 'Highest ROI' },
    { id: 'fast',       label: 'Fastest selling' },
    { id: 'sellThrough', label: 'Highest sell-through' },
    { id: 'price',      label: 'Highest sold price' },
    { id: 'maxBuyLow',  label: 'Lowest max buy' },
    { id: 'sales',      label: 'Most sales' },
    { id: 'updated',    label: 'Recently updated' },
    { id: 'alpha',      label: 'Alphabetical' },
  ],
};

// Category taxonomy. Categories and subcategories in the Sourcing Intel sheet
// are matched against these (case-insensitive) for icons and ordering; anything
// not listed still works — it shows under its own name with the default icon.
const ACQUIRE_TAXONOMY = [
  { id: 'fashion', label: 'Fashion', icon: '👟', subs: ['Shoes', 'Outerwear', 'Shirts', 'Pants', 'Bags', 'Accessories', 'Designer', 'Vintage clothing'] },
  { id: 'electronics', label: 'Electronics', icon: '📷', subs: ['Cameras', 'Camcorders', 'Audio equipment', 'Headphones', 'Speakers', 'Receivers', 'Computers', 'Tablets', 'Phones', 'Calculators', 'GPS devices', 'Label printers', 'Specialty printers', 'Media players', 'Remote controls', 'Vintage electronics'] },
  { id: 'gaming', label: 'Gaming', icon: '🎮', subs: ['Consoles', 'Controllers', 'Handhelds', 'Games', 'Accessories', 'Retro gaming'] },
  { id: 'music-gear', label: 'Music Gear', icon: '🎸', subs: ['Guitars', 'Pedals', 'Keyboards', 'Audio interfaces', 'Microphones', 'DJ equipment', 'Recording equipment'] },
  { id: 'tools', label: 'Tools', icon: '🛠️', subs: ['Power tools', 'Batteries', 'Chargers', 'Specialty tools', 'Vintage hand tools'] },
  { id: 'home', label: 'Home', icon: '🏠', subs: ['Small appliances', 'Lamps', 'Decor', 'Kitchenware', 'Coffee equipment', 'Vacuums', 'Replacement parts'] },
  { id: 'collectibles', label: 'Collectibles', icon: '🧸', subs: ['Trading cards', 'Toys', 'Figurines', 'Plush', 'Advertising', 'Memorabilia', 'Vintage media'] },
  { id: 'sporting-goods', label: 'Sporting Goods', icon: '⛳', subs: ['Outdoor gear', 'Golf', 'Camping', 'Fitness', 'Sports equipment'] },
  { id: 'auto-specialty', label: 'Auto / Specialty', icon: '🚗', subs: ['Auto parts', 'OEM accessories', 'Replacement components'] },
  { id: 'media', label: 'Media', icon: '📚', subs: ['Books', 'Vinyl', 'CDs', 'DVDs/Blu-rays', 'Box sets', 'Rare editions'] },
  { id: 'other', label: 'Other', icon: '🏷️', subs: [] },
];
const ACQUIRE_DEFAULT_CATEGORY_ICON = '🏷️';

// Hunt List form fields shown per category group. Fields not listed for a
// category are hidden, never required — Brand and Item always show.
const HUNT_FIELDS_BY_CATEGORY = {
  fashion: ['subcategory', 'size', 'color', 'targetVariant'],
  electronics: ['subcategory', 'model', 'targetVariant'],
  gaming: ['subcategory', 'model', 'targetVariant'],
  'music-gear': ['subcategory', 'model', 'targetVariant'],
  tools: ['subcategory', 'model', 'targetVariant'],
  home: ['subcategory', 'model', 'color'],
  collectibles: ['subcategory', 'targetVariant'],
  'sporting-goods': ['subcategory', 'model', 'size'],
  'auto-specialty': ['subcategory', 'model', 'targetVariant'],
  media: ['subcategory', 'targetVariant'],
  other: ['subcategory', 'model', 'size', 'color', 'targetVariant'],
  '': ['subcategory', 'model', 'size', 'color', 'targetVariant'],
};
