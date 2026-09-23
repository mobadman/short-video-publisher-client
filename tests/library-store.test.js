const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LibraryStore, safeName } = require('../src/library-store');

test('本地素材库只按产品型号直接匹配三个素材', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-library-'));
  const store = new LibraryStore(root);
  store.initialize();
  const paths = store.productPaths('冰箱', '熊墩墩600Pro');
  fs.mkdirSync(paths.coverDirectory, { recursive: true });
  fs.mkdirSync(path.dirname(paths.copyFile), { recursive: true });
  fs.mkdirSync(path.dirname(paths.tagsFile), { recursive: true });
  fs.writeFileSync(path.join(paths.coverDirectory, '封面.jpg'), 'test');
  fs.writeFileSync(paths.copyFile, '冰箱收纳更省心\n第二条文案\n');
  fs.writeFileSync(paths.tagsFile, '熊墩墩600Pro,冰箱,美的冰箱,大容量,美的官方旗舰店\n');
  fs.writeFileSync(paths.shortTitlesFile, '熊墩墩冰箱\n');
  const result = store.match({ category: '冰箱', model: '熊墩墩600Pro' });
  assert.ok(['冰箱收纳更省心', '第二条文案'].includes(result.body));
  assert.equal(result.tags.length, 5);
  assert.equal(path.basename(result.coverPath), '封面.jpg');
  assert.equal(result.productShortTitle, '熊墩墩冰箱');
  assert.deepEqual(result.missing, []);
  assert.equal(paths.coverDirectory, path.join(store.coversRoot, '熊墩墩600Pro'));
  assert.equal(paths.copyFile, path.join(store.copyRoot, '熊墩墩600Pro.txt'));
  assert.equal(paths.tagsFile, path.join(store.tagsRoot, '熊墩墩600Pro.txt'));
  assert.equal(paths.shortTitlesFile, path.join(store.shortTitlesRoot, '熊墩墩600Pro.txt'));
});

test('不同工作区使用完全独立的本地素材库', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'short-video-library-'));
  const standard = new LibraryStore(root, 'douyin-standard');
  const commerce = new LibraryStore(root, 'douyin-commerce');
  standard.initialize();
  commerce.initialize();
  assert.notEqual(standard.root, commerce.root);
  assert.match(standard.root, /douyin-standard/);
  assert.match(commerce.root, /douyin-commerce/);
});

test('相同产品型号在不同品类下使用同一套本地素材', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-library-'));
  const store = new LibraryStore(root);
  store.initialize();
  assert.deepEqual(store.productPaths('冰箱', '型号A'), store.productPaths('其他品类', '型号A'));
});

test('超过20个汉字的文案不会被标记为缺失或异常', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-library-'));
  const store = new LibraryStore(root);
  store.initialize();
  const paths = store.productPaths('冰箱', '长文案型号');
  fs.mkdirSync(paths.coverDirectory, { recursive: true });
  fs.writeFileSync(path.join(paths.coverDirectory, '封面.jpg'), 'test');
  fs.writeFileSync(paths.copyFile, '这是一个明显超过二十个汉字但是仍然允许进入发布计划的文案\n');
  fs.writeFileSync(paths.tagsFile, '产品,品类\n');
  const result = store.match({ category: '冰箱', model: '长文案型号' });
  assert.deepEqual(result.missing, []);
});

test('Windows 非法文件名字符会被替换', () => {
  assert.equal(safeName('X6S/Max:测试', 'fallback'), 'X6S_Max_测试');
});

test('4.2.1把旧素材安全复制到按方案组织的素材中心', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'material-center-migration-'));
  const legacy = path.join(root, '工作区', 'douyin-commerce', '本地素材库');
  fs.mkdirSync(path.join(legacy, '文案库'), { recursive: true });
  fs.mkdirSync(path.join(legacy, 'Tag库'), { recursive: true });
  fs.mkdirSync(path.join(legacy, '封面库', '型号A'), { recursive: true });
  fs.mkdirSync(path.join(legacy, '素材方案', 'scheme-old', '文案库'), { recursive: true });
  fs.writeFileSync(path.join(legacy, '文案库', '型号A.txt'), '常规文案\n');
  fs.writeFileSync(path.join(legacy, 'Tag库', '型号A.txt'), '常规,型号A\n');
  fs.writeFileSync(path.join(legacy, '封面库', '型号A', '封面.jpg'), 'image');
  fs.writeFileSync(path.join(legacy, '素材方案', '方案列表.json'), JSON.stringify([{ id: 'scheme-old', name: '双十一', enabled: true }]));
  fs.writeFileSync(path.join(legacy, '素材方案', 'scheme-old', '文案库', '型号A.txt'), '活动文案\n');
  const store = new LibraryStore(root, 'douyin-commerce');
  store.initialize();
  const scheme = store.listSchemes().find((item) => item.id === 'scheme-old');
  assert.equal(scheme.directoryName, '双十一__S001');
  assert.equal(fs.readFileSync(store.productPaths('', '型号A').copyFile, 'utf8'), '常规文案\n');
  assert.equal(fs.readFileSync(store.schemeProductPaths('', '型号A', 'scheme-old').copyFile, 'utf8'), '活动文案\n');
  assert.equal(fs.existsSync(path.join(legacy, '文案库', '型号A.txt')), true);
  assert.equal(fs.existsSync(path.join(root, '素材中心', '_迁移状态.json')), true);
  fs.rmSync(store.productPaths('', '型号A').copyFile);
  store.initialize();
  assert.equal(fs.existsSync(store.productPaths('', '型号A').copyFile), false, '迁移完成后不应把用户主动删除的新库文件重新恢复');
});

test('新建活动方案立即生成中文目录并继承常规内容', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'material-center-scheme-'));
  const store = new LibraryStore(root, 'douyin-standard');
  store.initialize();
  fs.writeFileSync(store.productPaths('', '型号B').copyFile, '常规文案\n');
  fs.writeFileSync(store.productPaths('', '型号B').tagsFile, '常规,产品\n');
  const scheme = store.saveScheme({ id: 'campaign-1', name: '2026双11', startDate: '2026-10-01', endDate: '2026-11-11' });
  assert.equal(scheme.directoryName, '2026双11__S001');
  assert.equal(fs.existsSync(path.join(store.schemeDirectory(scheme.id), '抖音普通', '文案库')), true);
  assert.equal(store.match({ model: '型号B' }, 0, { schemeId: scheme.id }).body, '常规文案');
  assert.equal(store.productSummary('型号B', scheme.id).inherited, true);
});

test('清理缓存保留发布日志', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-library-'));
  const store = new LibraryStore(root);
  store.initialize();
  fs.writeFileSync(path.join(store.cacheRoot, 'video.mp4'), 'video');
  fs.writeFileSync(path.join(store.logsRoot, 'log.json'), '{}');
  const result = store.clearCache();
  assert.equal(result.removed, 1);
  assert.equal(fs.existsSync(path.join(store.logsRoot, 'log.json')), true);
});

test('表单式保存产品素材会追加去重并保留现有目录结构', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'material-form-'));
  const store = new LibraryStore(root, 'douyin-commerce');
  store.initialize();
  const cover = path.join(root, 'cover.jpg');
  fs.writeFileSync(cover, Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x00]));
  store.saveProduct({
    model: 'G23', mode: 'append', copies: '第一条文案\n第一条文案',
    tagGroups: '美的,G23,微蒸烤', shortTitles: 'G23微蒸烤', coverPaths: [cover]
  });
  const result = store.saveProduct({
    model: 'G23', mode: 'append', copies: '第一条文案\n第二条文案',
    tagGroups: '美的,G23,微蒸烤', shortTitles: 'G23微蒸烤', coverPaths: [cover]
  });
  assert.equal(result.copyCount, 2);
  assert.equal(result.tagGroupCount, 1);
  assert.equal(result.coverCount, 1);
  assert.equal(result.shortTitleCount, 1);
  assert.ok(['第一条文案', '第二条文案'].includes(store.match({ model: 'G23' }).body));
});

test('随机文案按种子稳定且同一轮不重复', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'material-random-'));
  const store = new LibraryStore(root, 'douyin-standard');
  store.initialize();
  store.saveProduct({ model: '随机型号', copies: '文案A\n文案B\n文案C', tagGroups: '标签' });
  const values = Array.from({ length: 3 }, (_, copyOrdinal) => store.match(
    { model: '随机型号' }, copyOrdinal, { randomSeed: 'fixed-seed', copyOrdinal }
  ).body);
  assert.equal(new Set(values).size, 3);
  const repeated = Array.from({ length: 3 }, (_, copyOrdinal) => store.match(
    { model: '随机型号' }, copyOrdinal, { randomSeed: 'fixed-seed', copyOrdinal }
  ).body);
  assert.deepEqual(repeated, values);
});

test('活动方案按发布日期生效并沿用常规封面', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'material-scheme-'));
  const store = new LibraryStore(root, 'douyin-standard');
  store.initialize();
  store.saveProduct({ model: '活动型号', copies: '常规文案', tagGroups: '常规Tag' });
  const coverDirectory = store.productPaths('', '活动型号').coverDirectory;
  fs.mkdirSync(coverDirectory, { recursive: true });
  fs.writeFileSync(path.join(coverDirectory, '共享封面.jpg'), 'cover');
  const scheme = store.saveScheme({ id: 'double-11', name: '双十一', startDate: '2026-11-01', endDate: '2026-11-11' });
  store.saveProduct({ model: '活动型号', schemeId: scheme.id, copies: '活动文案', tagGroups: '活动Tag' });
  const active = store.resolveScheme('2026-11-05', 'auto');
  const result = store.match({ model: '活动型号' }, 0, { targetDate: '2026-11-05', schemeId: active.id, randomSeed: 'x' });
  assert.equal(active.id, 'double-11');
  assert.equal(result.body, '活动文案');
  assert.equal(path.basename(result.coverPath), '共享封面.jpg');
  assert.equal(store.resolveScheme('2026-11-12', 'auto').id, 'default');
});

test('跨工作区事务失败时可从快照恢复产品素材', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'material-rollback-'));
  const store = new LibraryStore(root, 'douyin-standard');
  store.initialize();
  store.saveProduct({ model: '型号A', copies: '旧文案', tagGroups: '旧Tag' });
  const snapshot = store.captureProduct('型号A');
  store.saveProduct({ model: '型号A', mode: 'replace', copies: '新文案', tagGroups: '新Tag' });
  assert.equal(store.match({ model: '型号A' }).body, '新文案');
  store.restoreProduct(snapshot);
  assert.equal(store.match({ model: '型号A' }).body, '旧文案');
  assert.deepEqual(store.match({ model: '型号A' }).tags, ['旧Tag']);
});
