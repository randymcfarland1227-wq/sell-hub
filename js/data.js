// Static display config for the Sell/Acquire Hub. The actual inventory, per-platform
// descriptions, metrics, and acquire watchlist all sync live from the
// "selling_inventory_updated" Google Sheet via Code.gs — this file never needs manual
// re-syncing the way routine-hub's data.js does, since categories are read from
// whatever's actually in the sheet's "Category" column rather than hardcoded here.

// Known category -> icon/color. Any category found in the sheet that isn't listed here
// falls back to DEFAULT_CATEGORY_META plus a color pulled from CATEGORY_PALETTE so it
// still gets a distinct wheel color.
const CATEGORY_META = {
  clothing:     { icon: '👕', color: '#1f5c46' },
  electronics:  { icon: '🖥️', color: '#1f3a5c' },
  collectibles: { icon: '🧸', color: '#a1752e' },
  home:         { icon: '🏠', color: '#1f5c64' },
  furniture:    { icon: '🪑', color: '#5c3a63' },
  jewelry:      { icon: '💍', color: '#7a2038' },
};
const DEFAULT_CATEGORY_META = { icon: '📦', color: '#5c3a63' };
const CATEGORY_PALETTE = ['#1f5c46', '#1f3a5c', '#a1752e', '#1f5c64', '#5c3a63', '#7a2038', '#a2532f', '#33475b'];

// Known platform -> label/color. Matched against the sheet's free-text Platform fields
// via platformMeta() in app.js (case-insensitive substring match), so "Facebook
// Marketplace", "FB Marketplace", etc. all resolve to the same entry.
// offerHint: where/how to act on a watcher-has-interest signal on that
// platform — surfaced by the Stats tab's "Send an offer" pricing action.
const PLATFORM_META = {
  ebay:     { label: 'eBay',                    color: '#8a4a2f', offerHint: "Seller Hub → Promotions → Offers to Buyers (or enable \"Best Offer\" on the listing)." },
  poshmark: { label: 'Poshmark',                color: '#7a2038', offerHint: 'Open the listing → the ⋯ menu → "Offer to Likes."' },
  depop:    { label: 'Depop',                   color: '#8a2635', offerHint: 'Open the listing → Offers → send a private offer to a liker.' },
  facebook: { label: 'Facebook Marketplace',    color: '#1f3a5c', offerHint: 'Message the interested buyer directly from Your Listings.' },
  mercari:  { label: 'Mercari',                 color: '#b3603a', offerHint: 'Message the buyer directly, or drop the price to trigger their saved-search alert.' },
};
const DEFAULT_PLATFORM_META = { label: 'Other', color: '#8c7754', offerHint: 'Reach out to them directly through the platform.' };

const PRIORITY_META = {
  High:   { color: '#7a2038' },
  Medium: { color: '#a1752e' },
  Low:    { color: '#6c5c42' },
};
