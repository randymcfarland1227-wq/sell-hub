// Static display config for the Sell/Acquire Hub. The actual inventory, per-platform
// descriptions, metrics, and acquire watchlist all sync live from the
// "selling_inventory_updated" Google Sheet via Code.gs — this file never needs manual
// re-syncing the way routine-hub's data.js does, since categories are read from
// whatever's actually in the sheet's "Category" column rather than hardcoded here.

// Known category -> icon/color. Any category found in the sheet that isn't listed here
// falls back to DEFAULT_CATEGORY_META plus a color pulled from CATEGORY_PALETTE so it
// still gets a distinct wheel color.
const CATEGORY_META = {
  clothing:     { icon: '👕', color: '#2f5bff' },
  electronics:  { icon: '🖥️', color: '#087ea4' },
  collectibles: { icon: '🧸', color: '#a447e8' },
  home:         { icon: '🏠', color: '#16836a' },
  furniture:    { icon: '🪑', color: '#df5b35' },
  jewelry:      { icon: '💍', color: '#c92f67' },
};
const DEFAULT_CATEGORY_META = { icon: '📦', color: '#56657a' };
const CATEGORY_PALETTE = ['#2f5bff', '#087ea4', '#a447e8', '#16836a', '#df5b35', '#c92f67', '#7950f2', '#56657a'];

// Known platform -> label/color. Matched against the sheet's free-text Platform fields
// via platformMeta() in app.js (case-insensitive substring match), so "Facebook
// Marketplace", "FB Marketplace", etc. all resolve to the same entry.
// offerHint: where/how to act on a watcher-has-interest signal on that
// platform — surfaced by the Stats tab's "Send an offer" pricing action.
const PLATFORM_META = {
  ebay:     { label: 'eBay',                    color: '#3665f3', offerHint: "Seller Hub → Promotions → Offers to Buyers (or enable \"Best Offer\" on the listing)." },
  poshmark: { label: 'Poshmark',                color: '#822432', offerHint: 'Open the listing → the ⋯ menu → "Offer to Likes."' },
  depop:    { label: 'Depop',                   color: '#ff4655', offerHint: 'Open the listing → Offers → send a private offer to a liker.' },
  facebook: { label: 'Facebook Marketplace',    color: '#1877f2', offerHint: 'Message the interested buyer directly from Your Listings.' },
  mercari:  { label: 'Mercari',                 color: '#5e5ce6', offerHint: 'Message the buyer directly, or drop the price to trigger their saved-search alert.' },
};
const DEFAULT_PLATFORM_META = { label: 'Other', color: '#56657a', offerHint: 'Reach out to them directly through the platform.' };

const PRIORITY_META = {
  High:   { color: '#c92f67' },
  Medium: { color: '#df5b35' },
  Low:    { color: '#16836a' },
};
