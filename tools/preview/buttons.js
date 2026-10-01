const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const { open, posts } = require('./shoot.js');
const results = [];
async function step(name, page, view, fn, expect) {
  posts.length = 0;
  await page.evaluate(v => document.querySelector(`[data-view="${v}"]`).click(), view);
  await page.waitForTimeout(200);
  let err = '';
  try { await fn(page); } catch (e) { err = e.message.split('\n')[0]; }
  await page.waitForTimeout(400);
  const got = posts.map(p => [p.action, p.itemAction || '', p.detail || p.platform || p.newPrice || ''].join(':'));
  const ok = !err && expect.every(e => got.some(g => g.startsWith(e)));
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}  -> ${got.join(' | ') || '(no request)'} ${err}`);
}
(async () => {
  const browser = await chromium.launch();
  for (const width of [1280, 375]) {
    results.push(`--- width ${width}`);
    const fresh = async () => (await open(browser, { width, height: 900, theme: 'light' })).page;
    let page = await fresh();
    const card = (p, id) => p.locator(`#optimize .pricing-card[data-item-id="${id}"]`);
    await step('Approve offer', page, 'optimize', p => card(p,'C-101').locator('.pa-approve-btn').click(), ['logItemAction:Offer Approved:eBay: 3 watchers']);
    await step('Offer sent', page, 'optimize', p => card(p,'C-101').locator('.pa-offer-btn').click(), ['logItemAction:Offer Sent:eBay']);
    await step('Dropped to $41', page, 'optimize', p => card(p,'C-102').locator('.pa-drop-suggested-btn').click(), ['dropListingPrice']);
    page = await fresh();
    await step('Ignore', page, 'optimize', p => card(p,'C-102').locator('.pa-ignore-btn').click(), ['logItemAction:Ignored:Try a price drop']);
    page = await fresh();
    await step('Hold', page, 'optimize', p => card(p,'C-102').locator('.pa-hold-btn').click(), ['logItemAction:Price Hold']);
    page = await fresh();
    await step('Complete', page, 'optimize', p => card(p,'C-102').locator('.pa-complete-btn').click(), ['logItemAction:Completed:Try a price drop']);
    await step('Delete', page, 'optimize', p => card(p,'N-201').locator('.pa-delete-btn').click(), ['logItemAction:Deleted:Boost visibility']);
    page = await fresh();
    await step('Mark listed', page, 'action', p => p.locator('#action .stl-card:not(.prep-card)').filter({ hasText: 'Lululemon' }).first().locator('.stl-listed-btn').click(), ['logItemAction:Listing Posted:Poshmark']);
    await step('+ Draft made', page, 'action', p => p.locator('#action .stl-card:not(.prep-card)').filter({ hasText: 'Lululemon' }).first().locator('.stl-draft-btn').click(), ['logItemAction:Draft Created']);
    await step('Draft made (clear)', page, 'action', p => p.locator('#action .stl-card:not(.prep-card) .stl-draft-btn.is-on').first().click(), ['logItemAction:Draft Discarded']);
    await step('Not posting', page, 'action', p => p.locator('#action .stl-card:not(.prep-card)').filter({ hasText: 'Pyrex' }).first().locator('.stl-skip-btn').click(), ['logItemAction:Not Posting']);
    await step('+ Note', page, 'action', async p => {
      await p.locator('#action .stl-card:not(.prep-card)').filter({ hasText: 'Polo' }).first().locator('.stl-note-add').click();
      const f = p.locator('#action .stl-note-editor').first();
      await f.locator('.stl-note-input').fill('Taking photos');
      await f.locator('button[type="submit"]').click();
    }, ['logItemAction:Posting Note:Taking photos']);
    await step('Edit note (Item prep)', page, 'action', async p => {
      await p.locator('#itemPrepList .stl-note-edit').filter({ hasText: 'Edit' }).locator('nth=0').click();
      const f = p.locator('#action .stl-note-editor').first();
      const v = await f.locator('.stl-note-input').inputValue();
      if (!v.includes('original box')) throw new Error('editor not prefilled: ' + v);
      await f.locator('.stl-note-input').fill('Waiting on the box, arriving Friday');
      await f.locator('button[type="submit"]').click();
    }, ['logItemAction:Posting Note:Waiting on the box']);
    await step('Mark shipped', page, 'action', p => p.locator('#toShipList .ts-ship-btn').first().click(), ['logItemAction:Shipped']);
    await step('Mark ended', page, 'action', p => p.locator('#soldElsewhereList .end-btn').first().click(), ['logItemAction:Listing Ended:Poshmark', 'setQueueStatus']);
    await step('Local deal Update+Save', page, 'action', async p => {
      await p.locator('#localDealsList .ld-edit').first().click();
      await p.locator('#localDealsList .ld-form .ld-note').fill('Bring lid');
      await p.locator('#localDealsList .ld-form button[type="submit"]').click();
    }, ['setLocalDeal']);
    page = await fresh();
    await step('Focus toggle (Inventory)', page, 'inventory', p => p.locator('#inventory .card.ic').filter({ hasText: 'Levi' }).locator('.focus-btn').click(), ['logItemAction:Focus']);
    await step('Select checkbox (Inventory)', page, 'inventory', async p => {
      await p.locator('#inventory .card.ic').filter({ hasText: 'Levi' }).locator('.pick-box').click();
      const n = await p.evaluate(() => state.picked.size);
      if (n !== 1) throw new Error('picked ' + n);
    }, []);
    await step('Unfocus (Focus)', page, 'focus', p => p.locator('#focus .card.ic').filter({ hasText: 'LEGO' }).locator('.focus-btn').click(), ['logItemAction:Unfocus']);
    await page.context().close();
  }
  console.log(results.join('\n'));
  await browser.close();
})();
