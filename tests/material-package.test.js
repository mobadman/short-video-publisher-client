const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LibraryStore } = require('../src/library-store');
const { writePackage, readPackage, importPackage, safeRelative } = require('../src/material-package');

test('素材包只导出白名单素材且可以校验导入', () => {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'material-pack-source-'));
  const source = new LibraryStore(sourceRoot, 'workspace-a');
  source.initialize();
  source.saveProduct({ model: 'M1', copies: '文案', tagGroups: 'Tag' });
  fs.writeFileSync(path.join(source.logsRoot, 'private-report.json'), '{"secret":true}');
  fs.writeFileSync(path.join(source.cacheRoot, 'current-plan.json'), '{"sheetUrl":"private"}');
  const packagePath = path.join(sourceRoot, 'team.svmpack');
  writePackage(packagePath, [{ workspace: { id: 'workspace-a', name: '工作区A', platform: 'douyin', mode: 'standard' }, store: source }], { appVersion: '4.2.0' });
  const payload = readPackage(packagePath);
  const names = payload.workspaces[0].files.map((file) => file.path);
  assert.ok(names.some((name) => name.startsWith('文案库/')));
  assert.ok(names.every((name) => !name.includes('发布日志') && !name.includes('下载缓存')));

  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'material-pack-target-'));
  const target = new LibraryStore(targetRoot, 'workspace-a');
  target.initialize();
  const result = importPackage(packagePath, [{ workspace: { id: 'workspace-a' }, store: target }]);
  assert.equal(result.workspaceCount, 1);
  assert.equal(target.match({ model: 'M1' }).body, '文案');
});

test('素材包拒绝目录穿越和非素材目录', () => {
  assert.throws(() => safeRelative('../workspaces.json'), /不安全路径/);
  assert.throws(() => safeRelative('发布日志/report.json'), /非素材目录/);
});

test('素材包发现飞书文档链接时拒绝导出', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'material-pack-private-'));
  const store = new LibraryStore(root, 'workspace-a');
  store.initialize();
  store.saveProduct({ model: 'M1', copies: 'https://team.feishu.cn/sheets/abcdefghi', tagGroups: 'Tag' });
  const packagePath = path.join(root, 'unsafe.svmpack');
  assert.throws(() => writePackage(packagePath, [{ workspace: { id: 'workspace-a', name: '工作区A' }, store }]), /包含飞书文档链接/);
  assert.equal(fs.existsSync(packagePath), false);
});
