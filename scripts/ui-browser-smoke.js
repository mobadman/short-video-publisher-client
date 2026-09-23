const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { BrowserManager } = require('../src/browser-manager');
const { WechatChannelsBrowserManager } = require('../src/wechat-channels-browser-manager');

(async () => {
  const root = path.join(__dirname, '..');
  const executablePath = path.join(root, '.playwright-browsers', 'chromium-1208', 'chrome-win64', 'chrome.exe');
  const output = path.join(root, '.ui-4.3.0');
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1080, height: 720 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const workspaces = [
      { id: 'douyin-standard', name: '抖音主页号', platform: 'douyin', mode: 'standard', publisherAccountId: 'production-account', commerceRequired: false },
      { id: 'douyin-commerce', name: '抖音商城号', platform: 'douyin', mode: 'commerce', publisherAccountId: 'production-account', commerceRequired: true },
      { id: 'wechat-channels', name: '微信视频号', platform: 'wechat-channels', mode: 'standard', publisherAccountId: 'wechat-publisher', commerceRequired: false }
    ];
    const accounts = [{ id: 'production-account', label: '抖音主页发布号', role: 'production', platform: 'douyin', lastDetected: { state: 'logged-in', nickname: '演示账号', douyinId: '85720', checkedAt: new Date().toISOString() } }];
    window.publisher = {
      listWorkspaces: async () => ({ active: workspaces[0], items: workspaces }), listAccounts: async () => accounts,
      getBrowserStatus: async () => ({ open: false, activeAccountId: null }), getSettings: async () => ({}),
      getFeishuBrowserStatus: async () => ({ open: false, loggedIn: false }), getLibraryPaths: async () => ({}),
      getCurrentPlan: async () => null, getDurationEstimates: async () => ({ pull: '预计约6–13分钟（按8–20条）' }),
      listLibrarySchemes: async () => ({ items: [{ id: 'default', name: '常规方案', enabled: true, builtIn: true }], effective: { id: 'default', name: '常规方案' } }),
      listSchedulePolicies: async () => ({ activeId: 'default', items: [{ id: 'default', name: '默认排期', mode: 'default', builtIn: true }] }),
      selectSchedulePolicy: async () => ({ activeId: 'default', items: [{ id: 'default', name: '默认排期', mode: 'default', builtIn: true }] }),
      listLibraryProducts: async (workspaceId) => ({ workspace: workspaces.find((item) => item.id === workspaceId), items: [
        { model: 'G23微蒸烤', copyCount: 5, tagGroupCount: 3, coverCount: workspaceId === 'douyin-commerce' ? 0 : 4, shortTitleCount: 2 },
        { model: '秋日通勤风衣', copyCount: 2, tagGroupCount: 1, coverCount: 3, shortTitleCount: 0 }
      ] }),
      onAutomationTakeover: () => {}, onPlanItemState: () => {}
    };
  });
  await page.goto(pathToFileURL(path.join(root, 'src', 'renderer', 'index.html')).href);
  await page.waitForTimeout(500);
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.equal(await page.locator('[data-page]').count(), 4);
  await page.locator('[data-page="library"]').click();
  await page.locator('#library-model').fill('G23/微蒸烤');
  assert.match(await page.locator('#library-safe-name').innerText(), /G23_微蒸烤/);
  assert.equal(await page.locator('#library-workspace-targets input').count(), 3);
  await page.screenshot({ path: path.join(output, 'material-library.png'), fullPage: true });
  await page.locator('[data-page="main"]').click();
  await page.locator('#schedule-policy-trigger').click();
  assert.equal(await page.locator('#schedule-policy-modal').isVisible(), true);
  assert.equal(await page.locator('#schedule-policy-default-note').isVisible(), true);
  await page.locator('#schedule-policy-new').click();
  await page.locator('#schedule-focus-ranges [data-range-start]').fill('04:00');
  await page.locator('#schedule-focus-ranges [data-range-end]').fill('07:00');
  await page.locator('#schedule-add-focus').click();
  await page.locator('#schedule-focus-ranges [data-schedule-range]').nth(1).locator('[data-range-start]').fill('19:00');
  await page.locator('#schedule-focus-ranges [data-schedule-range]').nth(1).locator('[data-range-end]').fill('20:00');
  await page.locator('#schedule-avoid-enabled').check();
  await page.locator('#schedule-avoid-ranges [data-range-start]').fill('05:00');
  await page.locator('#schedule-avoid-ranges [data-range-end]').fill('06:00');
  await page.locator('#schedule-interval').fill('60');
  assert.match(await page.locator('#schedule-policy-preview').innerText(), /预计可排 5 条/);
  const scheduleModalBox = await page.locator('#schedule-policy-modal .modal-card').boundingBox();
  assert.ok(scheduleModalBox && scheduleModalBox.x >= 0 && scheduleModalBox.y >= 0 && scheduleModalBox.x + scheduleModalBox.width <= 1080 && scheduleModalBox.y + scheduleModalBox.height <= 720);
  await page.screenshot({ path: path.join(output, 'schedule-policy-modal.png'), fullPage: true });
  await page.locator('#schedule-policy-modal [data-close-modal]').last().click();
  await page.evaluate(() => {
    currentPlan = { date: '2026-09-18', status: 'draft', statusDetail: '', warnings: [], items: [{
      itemId: 'commerce-yellow', sequence: 1, sourceActualRow: 27, originalMaterialName: '商城视频.mp4', videoPath: 'C:\\smoke\\商城视频.mp4',
      category: '微蒸烤', model: 'G23', scheduledLocal: '2026-09-18 18:20', body: '演示文案', tags: ['美的'], coverPath: null,
      coverMode: 'video-first-frame', commerce: { required: true, productUrl: 'https://example.com', productShortTitle: 'G23微蒸烤', shortTitleConfirmed: true },
      ready: true, problems: [], warnings: ['未匹配本地封面，将使用视频首帧'], selected: true, execution: { state: 'pending', detail: '' }, publish: {}
    }] };
    render();
  });
  assert.equal(await page.locator('.warning-row').count(), 1);
  assert.match(await page.locator('.warning-row .check-status').innerText(), /使用首帧/);
  const viewButton = page.locator('[data-plan-view]').first();
  await viewButton.click();
  assert.equal(await page.locator('#view-plan-modal').isVisible(), true);
  await page.locator('#view-plan-modal [data-close-modal]').first().click();
  await page.locator('#view-plan-modal').waitFor({ state: 'hidden' });
  await viewButton.click();
  await page.locator('#view-plan-modal [data-close-modal]').last().click();
  await page.locator('#view-plan-modal').waitFor({ state: 'hidden' });
  await page.screenshot({ path: path.join(output, 'commerce-first-frame-warning.png'), fullPage: true });

  const commercePage = await browser.newPage();
  await commercePage.setContent(`
    <div class="tag-row">
      <span class="tag-label">添加标签</span>
      <div class="semi-select" role="combobox">位置</div>
      <input id="product-link" placeholder="请输入商品链接" hidden>
      <button id="add-link" hidden>添加链接</button>
    </div>
    <div id="options" hidden><div class="semi-select-option" role="option">购物车</div></div>
    <div id="product-modal" role="dialog" hidden>
      <strong>编辑商品</strong>
      <input placeholder="商品短标题">
      <button>完成编辑</button>
    </div>
    <script>
      document.querySelector('[role="combobox"]').onclick = () => {
        setTimeout(() => { document.querySelector('#options').hidden = false; }, 600);
      };
      document.querySelector('[role="option"]').onclick = () => {
        options.hidden = true;
        document.querySelector('[role="combobox"]').textContent = '购物车';
        document.querySelector('#product-link').hidden = false;
        document.querySelector('#add-link').hidden = false;
      };
      document.querySelector('#add-link').onclick = () => { document.querySelector('#product-modal').hidden = false; };
      document.querySelector('#product-modal button').onclick = () => {
        const title = document.querySelector('#product-modal input').value;
        document.querySelector('#product-modal').hidden = true;
        document.body.append(title);
      };
    </script>
  `);
  const manager = new BrowserManager(output, '');
  await manager.fillCommerceProduct(commercePage, {
    productUrl: 'https://example.com/product/1',
    productShortTitle: 'G23微蒸烤'
  });
  assert.equal(await commercePage.locator('#product-link').inputValue(), 'https://example.com/product/1');
  assert.match(await commercePage.locator('body').innerText(), /G23微蒸烤/);
  await commercePage.close();

  const channelsPage = await browser.newPage();
  await channelsPage.setContent(`
    <div class="vertical-cover-wrap">3:4 个人主页卡片</div>
    <div id="cover-dialog" class="weui-desktop-dialog" hidden>
      <strong>编辑封面</strong>
      <div class="single-cover-uploader-wrap"><input type="file"></div>
      <div id="hidden-crop-dialog" class="weui-desktop-dialog" hidden>
        <strong>裁剪封面图</strong><button>确定</button>
      </div>
      <button>确认</button>
    </div>
    <script>
      document.querySelector('.vertical-cover-wrap').onclick = () => {
        setTimeout(() => { document.querySelector('#cover-dialog').hidden = false; }, 600);
      };
      document.querySelector('#cover-dialog > button').onclick = () => {
        document.querySelector('#cover-dialog').hidden = true;
      };
    </script>
  `);
  const channelsManager = new WechatChannelsBrowserManager(output, '');
  await channelsManager.setPortraitCover(channelsPage.mainFrame(), path.join(root, 'src', 'renderer', 'assets', 'app-icon.png'));
  assert.equal(await channelsPage.locator('#cover-dialog').isHidden(), true);
  assert.equal(await channelsPage.locator('#hidden-crop-dialog').isHidden(), true);
  await channelsPage.close();

  const channelsCropPage = await browser.newPage();
  await channelsCropPage.setContent(`
    <div class="vertical-cover-wrap">3:4 个人主页卡片</div>
    <div id="cover-dialog" class="weui-desktop-dialog" hidden>
      <strong>编辑封面</strong>
      <div class="single-cover-uploader-wrap"><input type="file"></div>
      <button>确认</button>
    </div>
    <div id="crop-dialog" class="weui-desktop-dialog" hidden>
      <strong>裁剪封面图</strong><button>确定</button>
    </div>
    <script>
      document.querySelector('.vertical-cover-wrap').onclick = () => { document.querySelector('#cover-dialog').hidden = false; };
      document.querySelector('#cover-dialog input').onchange = () => { document.querySelector('#crop-dialog').hidden = false; };
      document.querySelector('#crop-dialog button').onclick = () => { document.querySelector('#crop-dialog').hidden = true; };
      document.querySelector('#cover-dialog button').onclick = () => { document.querySelector('#cover-dialog').hidden = true; };
    </script>
  `);
  await channelsManager.setPortraitCover(channelsCropPage.mainFrame(), path.join(root, 'src', 'renderer', 'assets', 'app-icon.png'));
  assert.equal(await channelsCropPage.locator('#cover-dialog').isHidden(), true);
  assert.equal(await channelsCropPage.locator('#crop-dialog').isHidden(), true);
  await channelsCropPage.close();
  await browser.close();
  process.stdout.write('浏览器界面冒烟检查通过\n');
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
