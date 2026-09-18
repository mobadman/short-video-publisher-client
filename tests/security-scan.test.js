const test = require('node:test');
const assert = require('node:assert/strict');
const { findingsFor, scan } = require('../scripts/security-scan');

test('发布安全扫描会阻止真实飞书文档地址和本机用户路径', () => {
  assert.equal(findingsFor('fixture.js', "const url='https://tenant.feishu.cn/wiki/Abcdefgh1234';").length, 1);
  assert.equal(findingsFor('fixture.js', String.raw`const path='C:\Users\someone\secret';`).length, 1);
});

test('当前可发布源码不包含受保护信息', () => {
  assert.deepEqual(scan(), []);
});
