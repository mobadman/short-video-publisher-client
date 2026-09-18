const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const accountStore = fs.readFileSync(path.join(__dirname, '..', 'src', 'account-store.js'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

test('4.1.5流程仪表盘版本名称和商城链接入口完整显示', () => {
  assert.match(html, /发布工作台/);
  assert.match(html, /短视频批量发布助手/);
  assert.match(html, /4\.1\.5 · 本地工作台/);
  assert.match(html, /id="workspace-select"/);
  assert.match(html, /id="commerce-panel"/);
  assert.match(html, /商品短标题库/);
  assert.match(html, /id="resolve-commerce-titles"/);
  assert.match(html, /【商品链接】/);
  assert.match(html, /id="edit-confirm-short-title"/);
  assert.match(html, /id="edit-save-short-title"/);
  assert.doesNotMatch(html, /id="prepare-commerce"/);
  assert.doesNotMatch(html, /data-page="guide"/);
  assert.match(html, /id="test-platform"/);
});

test('计划支持勾选、编辑、续发和ID记录', () => {
  assert.match(html, /id="select-all"/);
  assert.match(html, /id="edit-plan-modal"/);
  assert.match(html, /发布已勾选的未完成视频/);
  assert.match(html, /id="sync-ids"/);
  assert.match(html, /id="edit-plan-category"/);
  assert.match(html, /id="edit-plan-model"/);
  assert.match(html, /飞书实际行/);
  assert.match(html, /id="test-resolve-id"/);
  assert.match(html, /id="copy-id-table"/);
  assert.match(html, /id="open-published-videos"/);
  assert.match(html, /检查本批次视频/);
  assert.match(html, /id="view-plan-modal"/);
  assert.match(app, /data-plan-view/);
  assert.match(app, /openPlanViewer/);
  assert.match(app, /\['视频链接'/);
  assert.match(html, /AI声明/);
  assert.doesNotMatch(html, /id="create-plan"/);
  assert.match(html, /id="create-plan-current-filter"/);
});

test('原版关键操作入口在指挥台完整保留', () => {
  for (const id of [
    'save-sheet', 'open-feishu', 'detect-feishu', 'close-feishu',
    'clear-cache', 'select-all', 'select-none', 'sync-ids', 'open-published-videos',
    'export-ids', 'copy-id-table', 'open-id-records', 'execute-plan'
  ]) assert.match(html, new RegExp(`id="${id}"`));
});

test('4.1.5沿用3.1.2的应用身份和本地Chrome Profile目录', () => {
  assert.equal(packageJson.version, '4.1.5');
  assert.equal(packageJson.build.appId, 'cn.boguan.shortvideo.publisher');
  assert.match(accountStore, /path\.join\(dataRoot, 'chrome-profiles'\)/);
  assert.match(main, /app\.getPath\('userData'\), '工作区', workspace\.id, 'browser-profiles', 'feishu-fixed-145'/);
});

test('4.1.0包含素材库表单与商城首帧封面入口', () => {
  assert.match(html, /data-page="library"/);
  assert.match(html, /id="library-save-product"/);
  assert.match(html, /id="library-workspace-targets"/);
  assert.match(html, /value="video-first-frame"/);
  assert.match(app, /warning-row/);
  assert.match(app, /可发布 · 使用首帧/);
});

test('文案字数只提示不限制', () => {
  assert.match(html, /正文（字数不限，可为空）/);
  assert.doesNotMatch(html, /正文（最多20个汉字/);
});

test('删除账号界面包含三重验证', () => {
  assert.match(html, /id="delete-check"/);
  assert.match(html, /id="delete-account-name"/);
  assert.match(html, /id="delete-confirm-phrase"/);
  assert.match(app, /delete-confirm-phrase/);
  assert.match(app, /=== '删除账号'/);
});

test('正式界面包含本地打赏二维码和实验功能提示', () => {
  assert.match(html, /assets\/donation-qr\.jpg/);
  assert.match(html, /功能开发中，敬请期待/);
});
