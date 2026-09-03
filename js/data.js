// Static display config for the Sell/Acquire Hub. The actual inventory, per-platform
// descriptions, metrics, and acquire watchlist all sync live from the
// "selling_inventory_updated" Google Sheet via Code.gs — this file never needs manual
// re-syncing the way routine-hub's data.js does, since categories are read from
// whatever's actually in the sheet's "Category" column rather than hardcoded here.

// Known category -> icon/color. Any category found in the sheet that isn't listed here
// falls back to DEFAULT_CATEGORY_META plus a color pulled from CATEGORY_PALETTE so it
// still gets a distinct wheel color.
const CATEGORY_META = {
  clothing:     { icon: '👕', color: '#5b6bd6' },
  electronics:  { icon: '🖥️', color: '#2f9e6e' },
  collectibles: { icon: '🧸', color: '#c9932e' },
  home:         { icon: '🏠', color: '#2fa3b8' },
  furniture:    { icon: '🪑', color: '#8c5bd6' },
  jewelry:      { icon: '💍', color: '#d6693f' },
};
const DEFAULT_CATEGORY_META = { icon: '📦', color: '#8c5bd6' };
const CATEGORY_PALETTE = ['#5b6bd6', '#2f9e6e', '#c9932e', '#2fa3b8', '#8c5bd6', '#d6693f', '#c0553f', '#3f8fc0'];

// Known platform -> label/color. Matched against the sheet's free-text Platform fields
// via platformMeta() in app.js (case-insensitive substring match), so "Facebook
// Marketplace", "FB Marketplace", etc. all resolve to the same entry.
// offerHint: where/how to act on a watcher-has-interest signal on that
// platform — surfaced by the Stats tab's "Send an offer" pricing action.
const PLATFORM_META = {
  ebay:     { label: 'eBay',                    color: '#e5652e', offerHint: "Seller Hub → Promotions → Offers to Buyers (or enable \"Best Offer\" on the listing)." },
  poshmark: { label: 'Poshmark',                color: '#7f1c3f', offerHint: 'Open the listing → the ⋯ menu → "Offer to Likes."' },
  depop:    { label: 'Depop',                   color: '#e0221f', offerHint: 'Open the listing → Offers → send a private offer to a liker.' },
  facebook: { label: 'Facebook Marketplace',    color: '#1877f2', offerHint: 'Message the interested buyer directly from Your Listings.' },
  mercari:  { label: 'Mercari',                 color: '#ff5a5f', offerHint: 'Message the buyer directly, or drop the price to trigger their saved-search alert.' },
};
const DEFAULT_PLATFORM_META = { label: 'Other', color: '#a39d8f', offerHint: 'Reach out to them directly through the platform.' };

const PRIORITY_META = {
  High:   { color: '#c0553f' },
  Medium: { color: '#c9932e' },
  Low:    { color: '#726d62' },
};
