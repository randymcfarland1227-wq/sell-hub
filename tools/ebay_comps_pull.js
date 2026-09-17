// eBay sold-comps pull for Acquire — run in a browser tab on www.ebay.com
// (eBay blocks server-side requests, so this can't run from Apps Script).
// Read-only: it fetches eBay's public search pages from that tab and parses
// them; nothing is posted to eBay.
//
// 1. Open https://www.ebay.com in a tab, paste this file into the console.
// 2. await pullEbayComps([[opportunityId, ebayQuery], ...])
//    — the pairs come from the Sourcing Intel sheet (Opportunity ID, eBay Query).
// 3. The result is an array of observations ready for the Apps Script
//    `setMarketObservations` POST action ({ action, observations }). Add each
//    row's searchTerm and category from Sourcing Intel before posting.
//
// Notes that matter for data quality:
// - Low/High are the 25th/75th percentiles of the sampled sold prices.
// - eBay appends "results matching fewer words" after the real matches; only
//   the first `sold` cards (the result count in the heading) are sampled.
// - Sold results cover roughly the last 90 days. Counts over ~10,000 come back
//   rounded by eBay, so sell-through from them is approximate.
// - eBay treats every bare word as required: "-box only" means "exclude box
//   AND require 'only'". Write exclusions as separate -words.

function ebayPercentile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return Math.round((sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)) * 100) / 100;
}

function ebayResultCount(doc) {
  const heading = (doc.querySelector('.srp-controls__count-heading')?.textContent || '').replace(/,/g, '');
  const m = heading.match(/(\d+)\+?\s*result/i);
  return m ? +m[1] : null;
}

async function ebayComp(query) {
  const enc = encodeURIComponent(query);
  const soldDoc = new DOMParser().parseFromString(
    await (await fetch(`https://www.ebay.com/sch/i.html?_nkw=${enc}&LH_Sold=1&LH_Complete=1&_ipg=120`)).text(), 'text/html');
  const sold = ebayResultCount(soldDoc);
  const root = soldDoc.querySelector('.srp-river-results') || soldDoc;
  const prices = [], ships = [];
  let image = '', seen = 0;
  for (const card of root.querySelectorAll('.s-card')) {
    if (sold !== null && seen >= sold) break;
    const text = (card.textContent || '').replace(/\s+/g, ' ');
    if (!/Sold\s+[A-Z][a-z]{2}\s+\d/.test(text) || /Shop on eBay/i.test(text)) continue;
    seen++;
    const priceMatch = (card.querySelector('.s-card__price')?.textContent || '').replace(/,/g, '').match(/\$([\d.]+)/);
    if (!priceMatch) continue;
    const price = parseFloat(priceMatch[1]);
    if (!(price > 1 && price < 10000)) continue;
    prices.push(price);
    if (/Free (delivery|shipping)/i.test(text)) ships.push(0);
    else {
      const shipMatch = text.replace(/,/g, '').match(/\+\$([\d.]+)\s*(delivery|shipping)/i);
      if (shipMatch) ships.push(parseFloat(shipMatch[1]));
    }
    if (!image) {
      const src = card.querySelector('img')?.getAttribute('src') || '';
      if (/i\.ebayimg\.com/.test(src)) image = src;
    }
  }
  const sorted = prices.slice().sort((a, b) => a - b);
  const cut = Math.floor(sorted.length * 0.1);
  const trimmed = sorted.length >= 10 ? sorted.slice(cut, sorted.length - cut) : sorted;
  const activeDoc = new DOMParser().parseFromString(
    await (await fetch(`https://www.ebay.com/sch/i.html?_nkw=${enc}&_ipg=60`)).text(), 'text/html');
  const active = ebayResultCount(activeDoc);
  return {
    sampleSize: sorted.length,
    avgPrice: trimmed.length ? Math.round(trimmed.reduce((a, b) => a + b, 0) / trimmed.length * 100) / 100 : null,
    medianPrice: ebayPercentile(sorted, 0.5),
    lowPrice: ebayPercentile(sorted, 0.25),
    highPrice: ebayPercentile(sorted, 0.75),
    salesFound: sold,
    activeListings: active,
    sellThrough: sold !== null && active !== null && sold + active > 0 ? Math.round(100 * sold / (sold + active)) : '',
    avgShipping: ships.length ? Math.round(ships.reduce((a, b) => a + b, 0) / ships.length * 100) / 100 : '',
    imageUrl: image,
  };
}

async function pullEbayComps(pairs, { pauseMs = 400 } = {}) {
  const out = [];
  for (const [opportunityId, query] of pairs) {
    try {
      const r = await ebayComp(query);
      out.push({ opportunityId, platform: 'eBay', source: 'eBay sold search', ...r });
      if (!r.sampleSize) console.warn('No sold matches — check the query:', opportunityId, query);
    } catch (err) {
      console.warn('Pull failed:', opportunityId, err);
    }
    await new Promise(res => setTimeout(res, pauseMs));
  }
  return out;
}
