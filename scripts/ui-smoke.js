const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

(async () => {
  const root = path.join(__dirname, '..');
  const executablePath = process.argv[2] || process.env.SMOKE_EXECUTABLE || undefined;
  const smokeUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-publisher-ui-smoke-'));
  const application = await electron.launch({
    args: ['.', `--user-data-dir=${smokeUserData}`, '--disable-gpu', '--disable-gpu-compositing'],
    cwd: root,
    executablePath,
    env: { ...process.env, SMOKE_WINDOW_WIDTH: '1080', SMOKE_WINDOW_HEIGHT: '720' }
  });
  const page = await application.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2500);
  if (!await page.locator('#accounts-main .runtime-row').count()) {
    const diagnostic = {
      status: await page.locator('#global-status').innerText().catch(() => ''),
      main: await page.locator('#accounts-main').innerText().catch(() => ''),
      test: await page.locator('#accounts-test').innerText().catch(() => ''),
      errors
    };
    throw new Error(`账号模块没有渲染：${JSON.stringify(diagnostic)}`);
  }
  assert.equal(await page.locator('[data-page]').count(), 4);
  await page.locator('[data-page="main"]').click();
  assert.equal(await page.locator('[data-page-panel="main"].active').count(), 1);
  assert.equal(await page.locator('[data-page-panel="main"] #accounts-test').count(), 0);
  assert.match(await page.locator('#accounts-main').innerText(), /发布账号/);
  assert.equal(await page.locator('#workspace-select option').count(), 3);
  assert.ok(await page.locator('#accounts-main .runtime-row').count() >= 1);
  assert.equal(await page.locator('#create-plan').count(), 0);
  assert.equal(await page.locator('#create-plan-current-filter').count(), 1);
  for (const selector of ['#open-feishu', '#detect-feishu', '#clear-cache', '#copy-id-table']) {
    assert.equal(await page.locator(selector).isVisible(), true, `${selector} 应在指挥台可见`);
  }
  const dateInput = page.locator('#plan-date');
  assert.equal(await dateInput.isVisible(), true, '发布日期必须完整可见');
  assert.equal(await dateInput.isEnabled(), true, '发布日期必须可以操作');
  const dateBox = await dateInput.boundingBox();
  assert.ok(dateBox && dateBox.width >= 140 && dateBox.height >= 38, `发布日期命中区域异常：${JSON.stringify(dateBox)}`);
  const dateHitTarget = await page.evaluate(() => {
    const input = document.querySelector('#plan-date');
    const box = input.getBoundingClientRect();
    const target = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return target === input || input.contains(target);
  });
  assert.equal(dateHitTarget, true, '发布日期中央不能被其他元素遮挡');
  await dateInput.click();
  await dateInput.fill('2026-09-12');
  assert.equal(await dateInput.inputValue(), '2026-09-12');
  const clearCacheText = await page.locator('#clear-cache').evaluate((element) => ({
    scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, whiteSpace: getComputedStyle(element).whiteSpace
  }));
  assert.ok(clearCacheText.scrollWidth <= clearCacheText.clientWidth && clearCacheText.whiteSpace === 'nowrap', '清空下载缓存文字不应被裁切或异常折行');
  const refreshText = await page.locator('#create-plan-current-filter').evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
  assert.ok(refreshText.scrollWidth <= refreshText.clientWidth, '重新拉取当前筛选文字不应被裁切');
  for (const icon of await page.locator('.nav-icon svg').all()) {
    const box = await icon.boundingBox();
    assert.ok(box && box.width >= 16 && box.height >= 16, '侧栏 SVG 图标应正常显示');
  }
  const runtimePanel = await page.locator('.runtime-panel').boundingBox();
  for (const row of await page.locator('.runtime-panel .runtime-row').all()) {
    const box = await row.boundingBox();
    assert.ok(runtimePanel && box && box.x + box.width <= runtimePanel.x + runtimePanel.width, `运行环境操作不应溢出卡片：${JSON.stringify({ runtimePanel, box })}`);
  }
  for (const heading of await page.locator('.workbench-page h1, .workbench-page h2').all()) {
    const clipped = await heading.evaluate((element) => element.scrollWidth > element.clientWidth);
    assert.equal(clipped, false, `标题不应换行或吞字：${await heading.innerText()}`);
  }
  const footerBox = await page.locator('.workbench-footer').boundingBox();
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  assert.ok(footerBox && footerBox.y + footerBox.height <= viewportHeight + 1, `复核发布栏必须固定在可视区域底部：${JSON.stringify({ footerBox, viewportHeight })}`);
  assert.equal(await page.locator('#detect-feishu').isDisabled(), true, '飞书 Chrome 未打开时检测登录应保持禁用');
  assert.equal(await page.locator('#copy-id-table').isDisabled(), true, '没有发布计划时复制 ID 表格应保持禁用');
  assert.equal(await page.locator('#metric-download-value').isVisible(), true);
  assert.equal(await page.locator('#metric-publish-value').isVisible(), true);
  assert.equal(await page.locator('#metric-next-time').isVisible(), true);
  const firstView = page.locator('[data-plan-view]').first();
  if (await firstView.count()) {
    await firstView.click();
    assert.equal(await page.locator('#view-plan-modal').isVisible(), true);
    assert.match(await page.locator('#view-plan-content').innerText(), /飞书实际行/);
    await page.locator('#view-plan-modal [data-close-modal]').first().click();
    await page.locator('#view-plan-modal').waitFor({ state: 'hidden' });
    await firstView.click();
    await page.locator('#view-plan-modal [data-close-modal]').last().click();
    await page.locator('#view-plan-modal').waitFor({ state: 'hidden' });
  }
  const firstEdit = page.locator('[data-plan-edit]').first();
  if (await firstEdit.count() && await firstEdit.isEnabled()) {
    await firstEdit.click();
    assert.equal(await page.locator('#edit-plan-category').isVisible(), true);
    assert.equal(await page.locator('#edit-plan-model').isVisible(), true);
    await page.locator('#edit-plan-modal [data-close-modal]').first().click();
  }
  const tomorrow = new Date(Date.now() + 86400000);
  const scheduledLocal = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')} 18:20`;
  await page.evaluate((scheduled) => {
    currentPlan = {
      date: scheduled.slice(0, 10), status: 'draft', statusDetail: '', warnings: [],
      items: [{
        itemId: 'smoke-plan-1', sequence: 1, sourceActualRow: 27, sourceRelativeRow: 2,
        originalMaterialName: '秋日通勤风衣_03.mp4', videoPath: 'C:\\smoke\\秋日通勤风衣_03.mp4',
        category: '女装风衣', model: 'FY-2026-K7', scheduledLocal: scheduled,
        aiGenerated: false, body: '界面冒烟检查', tags: ['秋季穿搭'], coverPath: 'C:\\smoke\\FY-2026-K7.jpg',
        commerce: { required: false }, ready: true, problems: [], selected: true,
        execution: { state: 'pending', detail: '' }, publish: {}
      }, {
        itemId: 'smoke-plan-2', sequence: 2, sourceActualRow: 28, sourceRelativeRow: 3,
        originalMaterialName: '细节展示_04.mp4', videoPath: 'C:\\smoke\\细节展示_04.mp4',
        category: '女装风衣', model: 'FY-2026-K7', scheduledLocal: scheduled,
        aiGenerated: false, body: '批次视频检查', tags: ['秋季穿搭'], coverPath: 'C:\\smoke\\FY-2026-K7.jpg',
        commerce: { required: false }, ready: true, problems: [], selected: false,
        execution: { state: 'id-resolved', detail: '已同步视频 ID' },
        publish: { videoId: '7677529618735271210', videoUrl: 'https://www.douyin.com/video/7677529618735271210', idState: 'resolved' }
      }]
    };
    estimates.publish = '预计约18–22分钟（按1条）';
    render();
  }, scheduledLocal);
  assert.equal(await page.locator('[data-plan-view]').first().isVisible(), true);
  assert.equal(await page.locator('[data-plan-edit]').first().isVisible(), true);
  assert.equal(await page.locator('#open-published-videos').isVisible(), true);
  assert.match(await page.locator('#open-published-videos').innerText(), /1\/1/);
  assert.equal(await page.locator('#open-published-videos').isDisabled(), true, '发布账号 Chrome 未打开时批次检查按钮应保持禁用');
  await page.locator('.plan-secondary-toolbar').evaluate((element) => element.scrollIntoView({ block: 'center' }));
  const secondaryToolbar = await page.locator('.plan-secondary-toolbar').boundingBox();
  const reviewButton = await page.locator('#open-published-videos').boundingBox();
  assert.ok(secondaryToolbar && reviewButton
    && reviewButton.x >= secondaryToolbar.x
    && reviewButton.x + reviewButton.width <= secondaryToolbar.x + secondaryToolbar.width
    && reviewButton.y >= secondaryToolbar.y
    && reviewButton.y + reviewButton.height <= secondaryToolbar.y + secondaryToolbar.height,
  `批次检查按钮不应溢出工具栏：${JSON.stringify({ secondaryToolbar, reviewButton })}`);
  const reviewHitTarget = await page.locator('#open-published-videos').evaluate((element) => {
    const box = element.getBoundingClientRect();
    const target = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return target === element || element.contains(target);
  });
  assert.equal(reviewHitTarget, true, '批次检查按钮不能被固定发布栏或其他元素遮挡');
  assert.match(await page.locator('#metric-next-time').innerText(), /明天/);
  assert.match(await page.locator('#metric-next-meta').innerText(), /距计划时间/);
  const operationHeader = await page.locator('.compact-plan-table th').last().boundingBox();
  const operationButtons = await page.locator('.compact-plan-table tbody .table-actions').first().boundingBox();
  assert.ok(operationHeader && operationButtons);
  const headerCenter = operationHeader.x + operationHeader.width / 2;
  const buttonsCenter = operationButtons.x + operationButtons.width / 2;
  assert.ok(Math.abs(headerCenter - buttonsCenter) <= 2, `操作列中心偏差 ${Math.abs(headerCenter - buttonsCenter)}px`);
  if (process.env.SMOKE_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.SMOKE_SCREENSHOT_DIR, { recursive: true });
    await page.locator('.workbench-header h1').click();
    await page.screenshot({ path: path.join(process.env.SMOKE_SCREENSHOT_DIR, 'main-with-plan.png') });
    await page.locator('.plan-secondary-toolbar').evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await page.locator('.plan-secondary-toolbar').screenshot({ path: path.join(process.env.SMOKE_SCREENSHOT_DIR, 'batch-review-toolbar.png') });
  }
  await page.locator('[data-page="library"]').click();
  assert.equal(await page.getByRole('heading', { name: '素材库' }).isVisible(), true);
  assert.equal(await page.locator('#library-workspace-targets input').count(), 3);
  assert.equal(await page.locator('#library-save-product').isVisible(), true);
  assert.equal(await page.locator('#library-workspace-filter option').count(), 3);
  if (process.env.SMOKE_SCREENSHOT_DIR) {
    await page.screenshot({ path: path.join(process.env.SMOKE_SCREENSHOT_DIR, 'material-library.png'), fullPage: true });
  }
  await page.locator('[data-page="test"]').click();
  assert.equal(await page.getByRole('heading', { name: '测试工具' }).isVisible(), true);
  assert.match(await page.locator('#accounts-test').innerText(), /测试小号/);
  assert.equal(await page.locator('#test-platform option').count(), 2);
  assert.equal(await page.locator('#test-resolve-id').isVisible(), true);
  await page.locator('#test-platform').selectOption('wechat-channels');
  assert.match(await page.locator('#accounts-test').innerText(), /视频号测试账号/);
  assert.equal(await page.locator('#test-resolve-id').isHidden(), true);
  await page.locator('#test-platform').selectOption('douyin');
  if (process.env.SMOKE_SCREENSHOT_DIR) {
    await page.screenshot({ path: path.join(process.env.SMOKE_SCREENSHOT_DIR, 'test-tools.png'), fullPage: true });
  }
  await page.locator('[data-page="settings"]').click();
  assert.equal(await page.locator('#guard-seconds').isVisible(), true);
  assert.equal(await page.locator('#settings-accounts .account-settings-card').count(), 4);
  assert.equal(await page.locator('#open-donation').isVisible(), true);
  const deletableCard = page.locator('#settings-accounts .account-settings-card').filter({ has: page.locator('[data-settings-account-action="delete"]:not([disabled])') }).first();
  if (await deletableCard.count()) {
    const accountName = await deletableCard.locator('[data-account-label]').inputValue();
    await deletableCard.locator('[data-settings-account-action="delete"]').click();
    assert.equal(await page.locator('#confirm-delete-account').isDisabled(), true);
    await page.locator('#delete-check').check();
    await page.locator('#delete-account-name').fill(accountName);
    await page.locator('#delete-confirm-phrase').fill('删除账号');
    assert.equal(await page.locator('#confirm-delete-account').isEnabled(), true);
    await page.locator('#delete-account-modal [data-close-modal]').first().click();
  }
  if (process.env.SMOKE_SCREENSHOT_DIR) {
    await page.screenshot({ path: path.join(process.env.SMOKE_SCREENSHOT_DIR, 'settings.png'), fullPage: true });
    await page.locator('#open-donation').click();
    await page.screenshot({ path: path.join(process.env.SMOKE_SCREENSHOT_DIR, 'donation.png'), fullPage: true });
  }
  assert.equal(errors.length, 0, errors.join('\n'));
  await application.close();
  process.stdout.write('正式版界面冒烟检查通过\n');
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
