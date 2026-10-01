const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const fx = require('./fixture.js');
const OUT = process.env.OUT || require('os').tmpdir() + '/sell-hub-shots/';
require('fs').mkdirSync(OUT, { recursive: true });
const posts = [];
async function open(browser, { width, height, theme }) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, timezoneId: 'America/New_York' });
  await ctx.addInitScript(`{ const T = new Date('2026-10-01T15:00:00Z').getTime(); const O = Date; class D extends O { constructor(...a){ super(...(a.length? a : [T])); } static now(){ return T; } } window.Date = D; window.confirm = () => true; }`);
  await ctx.route(/script\.google\.com/, async route => {
    const req = route.request();
    if (req.method() === 'POST') { posts.push(JSON.parse(req.postData() || '{}')); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }
    const action = new URL(req.url()).searchParams.get('action');
    const body = fx[action] !== undefined ? fx[action] : (fx.bootBundle[action] !== undefined ? fx.bootBundle[action] : []);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await ctx.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
  await page.goto('http://localhost:8942/index.html');
  await page.waitForFunction(() => typeof state !== "undefined" && state.inventory && state.inventory.length > 0, null, { timeout: 15000 }).catch(() => console.log('no inventory loaded'));
  await page.waitForTimeout(800);
  return { ctx, page };
}
module.exports = { open, posts, OUT };
if (require.main === module) (async () => {
  const browser = await chromium.launch();
  const views = (process.env.VIEWS || 'action,focus,optimize,performance,inventory').split(',');
  for (const theme of ['light', 'dark']) for (const [w, h, tag] of [[1280, 900, 'desk'], [375, 812, 'phone']]) {
    const { ctx, page } = await open(browser, { width: w, height: h, theme });
    for (const v of views) {
      await page.evaluate(v => document.querySelector(`[data-view="${v}"]`).click(), v);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}${v}-${theme}-${tag}.png`, fullPage: true });
    }
    await ctx.close();
  }
  await browser.close();
})();
