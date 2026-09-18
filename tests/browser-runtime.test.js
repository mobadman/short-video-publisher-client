const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  FEISHU_CHROMIUM_VERSION,
  feishuChromiumCandidates,
  resolveFeishuChromiumPath,
  isBrowserClosedError
} = require('../src/browser-runtime');

test('固定飞书Chromium版本不会跟随系统Chrome自动更新', () => {
  assert.equal(FEISHU_CHROMIUM_VERSION, '145.0.7632.6');
});

test('打包环境优先使用resources中的固定Chromium', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-browser-runtime-'));
  const resourcesPath = path.join(root, 'resources');
  const projectRoot = path.join(root, 'project');
  const candidates = feishuChromiumCandidates({ resourcesPath, projectRoot });
  fs.mkdirSync(path.dirname(candidates[0]), { recursive: true });
  fs.writeFileSync(candidates[0], 'browser');
  assert.equal(resolveFeishuChromiumPath({ resourcesPath, projectRoot }), candidates[0]);
});

test('只把浏览器关闭或崩溃错误识别为可安全恢复', () => {
  assert.equal(isBrowserClosedError(new Error('Target page, context or browser has been closed')), true);
  assert.equal(isBrowserClosedError(new Error('page crashed')), true);
  assert.equal(isBrowserClosedError(new Error('没有找到下载按钮')), false);
});
