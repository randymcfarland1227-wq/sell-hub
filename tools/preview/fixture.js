// Mock bootBundle for local preview (2026-10-01).
const d = n => { const t = new Date('2026-10-01T12:00:00Z'); t.setUTCDate(t.getUTCDate() - n); return t.toISOString().slice(0,10); };
const CT = 'Clothing Sell Inventory', NT = 'Non Clothing Sell Inventory';
const inv = (o) => ({ sourceTab: CT, sourceStatus: 'Listed', category: 'Clothing', clothingType: '', brand: '', size: '', item: '', itemNumber: '', condition: 'Pre-owned - Good', estValue: '', listPrice: '', floorPrice: '', platform: '', dateListed: '', buyer: '', soldPrice: '', netCash: '', ...o });
const inventory = [
  inv({ itemId: 'C-101', brand: 'Patagonia', item: "Better Sweater 1/4 Zip Fleece Pullover Men's Heather Grey", size: 'L', listPrice: '$79', floorPrice: '$55', platform: 'eBay, Poshmark, Facebook Marketplace' }),
  inv({ itemId: 'C-102', brand: "Levi's", item: '501 Original Fit Jeans Medium Wash', size: '34x32', listPrice: '$45', floorPrice: '$28', platform: 'eBay, Poshmark' }),
  inv({ itemId: 'N-201', sourceTab: NT, category: 'Electronics', brand: 'Sony', item: 'WH-1000XM4 Wireless Noise Cancelling Headphones Black', condition: 'Used - Like New', listPrice: '$165', floorPrice: '$130', platform: 'eBay' }),
  inv({ itemId: 'N-202', sourceTab: NT, category: 'Home', brand: 'Le Creuset', item: '5.5 qt Round Dutch Oven Flame', condition: 'Used - Very Good', listPrice: '$180', floorPrice: '$140', platform: 'Facebook Marketplace, eBay' }),
  inv({ itemId: 'N-203', sourceTab: NT, category: 'Home', sourceStatus: 'Ready to list', brand: 'Pyrex', item: 'Vintage Butterprint Nesting Mixing Bowls Set of 4', condition: 'Vintage - Good', listPrice: '$95', floorPrice: '$70', platform: 'eBay, Poshmark, Mercari' }),
  inv({ itemId: 'C-103', sourceStatus: 'Ready to list', brand: 'Nike', item: 'Air Max 90 Infrared', size: '10.5', condition: 'Pre-owned - Excellent', listPrice: '$110', floorPrice: '$85', platform: 'eBay, Depop' }),
  inv({ itemId: 'C-104', sourceStatus: 'Sold', brand: 'Carhartt', item: 'Detroit Jacket Blanket Lined Brown Duck', size: 'M', listPrice: '$120', floorPrice: '$90', platform: 'eBay, Poshmark', buyer: 'eBay', soldPrice: '$95', netCash: '$81.20' }),
  inv({ itemId: 'C-105', sourceStatus: 'Sold', brand: 'Coach', item: 'Signature Canvas Tote', listPrice: '$85', floorPrice: '$60', platform: 'Poshmark', buyer: 'Poshmark', soldPrice: '$72', netCash: '$57.60', category: 'Clothing' }),
  inv({ itemId: 'N-204', sourceTab: NT, category: 'Collectibles', brand: 'LEGO', item: 'Star Wars 75192 Millennium Falcon UCS Complete with Box', condition: 'Used - Complete', listPrice: '$650', floorPrice: '$560', platform: 'Facebook Marketplace, Mercari' }),
  inv({ itemId: 'C-106', brand: 'Polo Ralph Lauren', item: "Classic Fit Long Sleeve Oxford Button Down Shirt Big Pony Embroidered Men's Big & Tall", size: 'XXL Tall', listPrice: '$60', floorPrice: '$38', platform: 'eBay, Poshmark, Depop, Grailed' }),
  inv({ itemId: 'C-107', sourceStatus: 'Photograph', brand: 'Lululemon', item: 'Define Jacket Nulu', size: '6', listPrice: '$68', floorPrice: '$48', platform: 'Poshmark, Mercari' }),
  inv({ itemId: 'C-108', brand: 'Peter Millar', item: 'Crown Soft Quarter Zip Pullover', size: 'M', listPrice: '$70', floorPrice: '$62', platform: 'eBay, Poshmark' }),
  inv({ itemId: 'N-205', sourceTab: NT, category: 'Electronics', sourceStatus: 'Sold', brand: 'Apple', item: 'iPad Air 4th Gen 64GB Sky Blue', listPrice: '$300', floorPrice: '$260', platform: 'Facebook Marketplace', buyer: 'Facebook Marketplace', soldPrice: '$275' }),
];
const q = (itemId, platform, status, posted, url) => ({ listingId: itemId + '-' + platform.slice(0,3), itemId, platform, postingOrder: '', status, listingUrl: url || (status === 'Active' ? 'https://example.com/' + itemId : ''), datePosted: posted || '' });
const postingQueue = [
  q('C-101','eBay','Active',d(34)), q('C-101','Poshmark','Active',d(34)), q('C-101','Facebook Marketplace','Active',d(30)),
  q('C-102','eBay','Active',d(52)), q('C-102','Poshmark','Active',d(52)),
  q('N-201','eBay','Active',d(6)),
  q('N-202','Facebook Marketplace','Active',d(20)), q('N-202','eBay','Active',d(20)),
  q('C-104','eBay','Sold',d(40)), q('C-104','Poshmark','Active',d(40)),
  q('C-105','Poshmark','Sold',d(25)),
  q('N-204','Facebook Marketplace','Active',d(12)),
  q('C-106','eBay','Active',d(18)), q('C-106','Poshmark','Active',d(18)), q('C-106','Depop','Active',d(17)),
  q('C-108','eBay','Active',d(70)), q('C-108','Poshmark','Active',d(70)),
  q('N-205','Facebook Marketplace','Sold',d(9)),
];
const m = (daysAgo, itemId, platform, views, watchers, clicks, price) => ({ date: d(daysAgo), listingId: itemId + '-' + platform.slice(0,3), itemId, platform, impressions: views * 8, views, watchers, clicks, price, source: 'ebay-api' });
const metrics = [];
[[9,0.7],[2,1]].forEach(([ago, f]) => {
  const r = x => Math.round(x * f);
  metrics.push(
    m(ago,'C-101','eBay', r(210), ago===2?3:1, r(14), 79), m(ago,'C-101','Poshmark', r(88), ago===2?2:0, r(6), 79),
    m(ago,'C-102','eBay', r(160), 0, 1, 45), m(ago,'C-102','Poshmark', r(70), 0, 1, 45),
    m(ago,'N-201','eBay', 0, 0, 0, 159.99),
    m(ago,'N-202','eBay', r(140), 0, r(12), 180),
    m(ago,'C-106','eBay', r(95), 0, r(9), 49.99), m(ago,'C-106','Poshmark', r(60), 0, r(5), 60), m(ago,'C-106','Depop', r(30), 0, r(3), 55),
    m(ago,'C-108','eBay', r(300), 0, 2, 70), m(ago,'C-108','Poshmark', r(120), 0, 1, 70),
    m(ago,'N-204','Facebook Marketplace', r(400), 0, r(30), 650),
  );
});
const a = (ago, itemId, action, detail) => ({ date: d(ago), itemId, action, detail: detail || '' });
const itemActions = [
  a(40,'C-102','Price Drop','49'), a(20,'C-102','Price Drop','45'),
  a(15,'C-101','Offer Sent','eBay'),
  a(1,'C-101','Offer Prepared','eBay: 3 watchers, offer $69 (13% off), free shipping'),
  a(10,'N-203','Draft Created','eBay'),
  a(5,'C-103','Posting Note','Waiting on the original box from storage'),
  a(4,'C-108','Price Hold','Holding at $70 through October'),
  a(3,'C-101','Focus','Pushing this one.'), a(3,'C-106','Focus','Pushing this one.'), a(3,'N-204','Focus','Pushing this one.'),
  a(6,'C-104','Sold','eBay'), a(3,'C-105','Sold','Poshmark'),
  a(2,'N-204','Listing Posted','Facebook Marketplace'),
];
const localDeals = [
  { itemId: 'N-202', platform: 'Facebook Marketplace', status: 'Meeting set', buyer: 'Dana K.', when: 'Sat Oct 3, 10:00 AM', where: 'Library parking lot', note: 'Bring the lid and the box', updated: d(1) },
  { itemId: 'N-204', platform: 'Facebook Marketplace', status: 'Interest', buyer: 'Marcus', when: '', where: '', note: 'Asked if $600 works', updated: d(1) },
];
const photos = [];
module.exports = { bootBundle: { inventory, descriptions: [], postingQueue, metrics, photos, itemActions, localDeals }, salesBundle: { sales: [
  { saleId: 'ebay-C-104', itemId: 'C-104', platform: 'eBay', salePrice: 95, netCash: 81.2, dateSold: d(6), cashStatus: 'Pending' },
  { saleId: 'posh-C-105', itemId: 'C-105', platform: 'Poshmark', salePrice: 72, netCash: 57.6, dateSold: d(3) },
  { saleId: 'fb-N-205', itemId: 'N-205', platform: 'Facebook Marketplace', salePrice: 275, netCash: 275, dateSold: d(8), fundsStatus: 'Paid in person' },
], balances: [] }, savedItems: [] };
