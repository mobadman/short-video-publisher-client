const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PlanService } = require('../src/plan-service');

test('损坏的当前计划不会阻断账号等其他模块初始化', () => {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-plan-'));
  fs.writeFileSync(path.join(cacheRoot, 'current-plan.json'), '{"tags":[美的官方旗舰店]}', 'utf8');
  const service = new PlanService({ settings: () => ({}) }, { cacheRoot }, {});
  const plan = service.current();
  assert.equal(plan.invalid, true);
  assert.equal(plan.status, 'invalid');
  assert.deepEqual(plan.items, []);
  assert.match(plan.statusDetail, /格式损坏/);
});

test('保存当前工作区链接后计划服务立即读取新链接', () => {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-link-sync-'));
  const workspace = { id: 'douyin-standard', sheetUrl: '', columns: { material: '素材链接' } };
  const service = new PlanService({ settings: () => ({}) }, { cacheRoot }, {}, { workspace });
  service.updateWorkspace({
    ...workspace,
    sheetUrl: 'https://example.invalid/mock-sheet'
  });
  assert.equal(service.settings().sheetUrl, 'https://example.invalid/mock-sheet');
});

test('计划项勾选、状态持久化和ID导出互不影响', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-plan-v2-'));
  const cacheRoot = path.join(root, '下载缓存');
  const recordsRoot = path.join(root, '发布ID记录');
  fs.mkdirSync(cacheRoot, { recursive: true });
  const videoPath = path.join(cacheRoot, 'a.mp4');
  const videoPath2 = path.join(cacheRoot, 'b.mp4');
  const coverPath = path.join(root, 'a.jpg');
  fs.writeFileSync(videoPath, 'video');
  fs.writeFileSync(videoPath2, 'video');
  fs.writeFileSync(coverPath, 'cover');
  const service = new PlanService({ settings: () => ({}) }, { cacheRoot, recordsRoot }, {});
  service.save({ id: 'p1', date: '2026-08-25', status: 'draft', items: [{
    itemId: 'i2', sourceRow: 18, sourceActualRow: 1800, originalMaterialName: '后行素材.mp4', videoPath: videoPath2, coverPath,
    body: '文案', tags: ['Tag'], scheduledLocal: '2026-08-25 19:30', ready: true, selected: true, problems: []
  }, {
    itemId: 'i1', sourceRow: 12, sourceActualRow: 1737, originalMaterialName: '原素材.mp4', videoPath, coverPath,
    body: '文案', tags: ['Tag'], scheduledLocal: '2026-08-25 19:00', ready: true, selected: true, problems: []
  }] });
  service.setSelections(['i1'], false);
  assert.equal(service.current().items.find((item) => item.itemId === 'i1').execution.state, 'skipped');
  service.setSelections(['i1'], true);
  service.markItem('i1', 'verified', '作品管理已核验');
  service.updatePublishIdentity('i1', { videoId: '7676796249760189746', videoUrl: 'https://www.douyin.com/video/7676796249760189746' });
  service.updatePublishIdentity('i2', { videoId: '8888888888888888888', videoUrl: 'https://www.douyin.com/video/8888888888888888888' });
  const exported = service.exportIdRecords();
  const text = fs.readFileSync(exported.filePath, 'utf8');
  assert.match(text, /1737\t原素材\.mp4\t7676796249760189746/);
  assert.ok(text.indexOf('1737\t原素材.mp4') < text.indexOf('1800\t后行素材.mp4'));
  const csv = fs.readFileSync(exported.csvPath, 'utf8');
  assert.match(csv, /"所在行","视频名称","发布ID","视频网址","获取状态"/);
  assert.ok(csv.indexOf('"1737","原素材.mp4"') < csv.indexOf('"1800","后行素材.mp4"'));
  assert.ok(exported.clipboardText.indexOf('1737\t原素材.mp4') < exported.clipboardText.indexOf('1800\t后行素材.mp4'));
  assert.equal(exported.idClipboardText, '7676796249760189746\r\n8888888888888888888');
  assert.doesNotMatch(exported.idClipboardText, /发布ID|视频名称|\t/);
  assert.equal(service.current().items.find((item) => item.itemId === 'i1').selected, false);
});

test('商城计划从飞书商品链接读取，并要求确认平台候选短标题', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'commerce-plan-'));
  const cacheRoot = path.join(root, '下载缓存');
  fs.mkdirSync(cacheRoot, { recursive: true });
  const videoPath = path.join(cacheRoot, '商品视频.mp4');
  fs.writeFileSync(videoPath, 'video');
  const workspace = {
    id: 'douyin-commerce', name: '抖音商城号', platform: 'douyin', mode: 'commerce',
    publisherAccountId: 'production-account', commerceAccountId: null, commerceRequired: true,
    sheetUrl: 'https://example.invalid/mock-commerce-sheet', columns: {}
  };
  const libraryStore = {
    cacheRoot,
    match: () => ({ body: '商品文案', tags: ['商品'], coverPath: path.join(root, 'cover.jpg'), productShortTitle: 'G23微蒸烤', missing: [] })
  };
  fs.writeFileSync(libraryStore.match().coverPath, 'cover');
  const feishuService = {
    rowsForDate: async (_settings, _date, options) => {
      assert.equal(options.commerceRequired, true);
      return { rows: [{ sourceRow: 14, actualSourceRow: 1737, materialText: '商品视频.mp4', category: '微蒸烤', model: 'G23', productLink: 'https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=1', sourceMissing: [] }], allowColumnExists: false };
    },
    downloadMaterial: async () => videoPath
  };
  const service = new PlanService({ settings: () => ({}) }, libraryStore, feishuService, { workspace });
  let plan = await service.create('2026-08-27');
  assert.equal(plan.workspace.id, 'douyin-commerce');
  assert.equal(plan.workspace.publisherAccountId, 'production-account');
  assert.equal(plan.items[0].commerce.productShortTitle, 'G23微蒸烤');
  assert.match(plan.items[0].commerce.productUrl, /haohuo\.jinritemai\.com/);
  assert.equal(plan.items[0].ready, true);
  plan = service.applyCommerceProductTitle(plan.items[0].itemId, '美的G23微蒸烤一体机');
  assert.equal(plan.items[0].commerce.productShortTitle, '美的G23微蒸烤一体机');
  assert.equal(plan.items[0].commerce.shortTitleConfirmed, false);
  assert.equal(plan.items[0].ready, false);
  plan = service.updateItem(plan.items[0].itemId, { confirmProductShortTitle: true, saveProductShortTitle: false });
  assert.equal(plan.items[0].ready, true);
});

test('商城计划只缺封面时使用黄色首帧警告且仍可发布', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'commerce-first-frame-'));
  const cacheRoot = path.join(root, '下载缓存');
  fs.mkdirSync(cacheRoot, { recursive: true });
  const videoPath = path.join(cacheRoot, '商品视频.mp4');
  fs.writeFileSync(videoPath, 'video');
  const service = new PlanService({ settings: () => ({}) }, { cacheRoot }, {});
  const plan = service.save({ id: 'p-first-frame', date: '2026-09-18', status: 'draft', items: [{
    itemId: 'commerce-1', videoPath, coverPath: null, body: '文案', tags: ['商品'],
    scheduledLocal: '2026-09-18 18:00', selected: true, problems: ['封面'],
    commerce: { required: true, productUrl: 'https://haohuo.jinritemai.com/ecommerce/trade/detail?id=1', productShortTitle: 'G23微蒸烤', shortTitleConfirmed: true }
  }] });
  assert.equal(plan.schemaVersion, 5);
  assert.equal(plan.items[0].ready, true);
  assert.equal(plan.items[0].coverMode, 'video-first-frame');
  assert.deepEqual(plan.items[0].problems, []);
  assert.match(plan.items[0].warnings[0], /视频首帧/);
});

test('商城计划缺封面同时缺其他素材时仍然阻断', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'commerce-first-frame-blocked-'));
  const cacheRoot = path.join(root, '下载缓存');
  fs.mkdirSync(cacheRoot, { recursive: true });
  const videoPath = path.join(cacheRoot, '商品视频.mp4');
  fs.writeFileSync(videoPath, 'video');
  const service = new PlanService({ settings: () => ({}) }, { cacheRoot }, {});
  const plan = service.save({ id: 'p-blocked', date: '2026-09-18', status: 'draft', items: [{
    itemId: 'commerce-2', videoPath, coverPath: null, body: '文案', tags: [],
    scheduledLocal: '2026-09-18 18:00', selected: true, problems: ['封面', 'Tag'],
    commerce: { required: true, productUrl: 'https://haohuo.jinritemai.com/ecommerce/trade/detail?id=1', productShortTitle: 'G23微蒸烤', shortTitleConfirmed: true }
  }] });
  assert.equal(plan.items[0].ready, false);
  assert.deepEqual(plan.items[0].problems, ['Tag']);
  assert.match(plan.items[0].warnings[0], /视频首帧/);
});

test('计划生成锁定内容方案和随机文案结果', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scheme-plan-'));
  const cacheRoot = path.join(root, '下载缓存');
  fs.mkdirSync(cacheRoot, { recursive: true });
  const videos = ['a.mp4', 'b.mp4', 'c.mp4'].map((name) => {
    const filePath = path.join(cacheRoot, name);
    fs.writeFileSync(filePath, name);
    return filePath;
  });
  const workspace = { id: 'douyin-standard', name: '主页号', platform: 'douyin', mode: 'standard', publisherAccountId: 'production-account', sheetUrl: 'https://example.invalid/mock-standard-sheet', columns: {} };
  const copies = ['文案A', '文案B', '文案C'];
  const libraryStore = {
    cacheRoot,
    logsRoot: path.join(root, 'logs'),
    resolveScheme: () => ({ id: 'double-11', name: '双十一', selectionMode: 'auto', startDate: '2026-11-01', endDate: '2026-11-11' }),
    match: (_item, _index, options) => ({ body: copies[options.copyOrdinal], tags: ['Tag'], coverPath: path.join(root, 'cover.jpg'), missing: [], contentSelection: { schemeId: 'double-11', copyIndex: options.copyOrdinal } })
  };
  fs.writeFileSync(path.join(root, 'cover.jpg'), 'cover');
  const feishuService = {
    rowsForDate: async () => ({ rows: videos.map((videoPath, index) => ({ sourceRow: index + 2, actualSourceRow: index + 20, materialText: path.basename(videoPath), category: '冰箱', model: 'M1', sourceMissing: [] })), allowColumnExists: false }),
    downloadMaterial: async (item) => videos[item.sourceRow - 2]
  };
  const service = new PlanService({ settings: () => ({}) }, libraryStore, feishuService, { workspace });
  const plan = await service.create('2026-11-05', { schemeId: 'auto', schedulePolicy: {
    id: 'double-11-evening', name: '双十一晚间', mode: 'custom', intervalMinutes: 30,
    focusStart: '18:00', focusEnd: '20:00', avoidEnabled: false
  } });
  assert.equal(plan.contentScheme.id, 'double-11');
  assert.equal(plan.contentScheme.name, '双十一');
  assert.equal(new Set(plan.items.map((item) => item.body)).size, 3);
  assert.ok(plan.items.every((item) => item.contentSelection.schemeId === 'double-11'));
  assert.equal(plan.schedulePolicy.name, '双十一晚间');
  assert.equal(plan.schedulePolicy.lockedAt.length > 0, true);
  assert.deepEqual(plan.items.map((item) => item.scheduledLocal), ['2026-11-05 18:00', '2026-11-05 18:30', '2026-11-05 19:00']);
});
