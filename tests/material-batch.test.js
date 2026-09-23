const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMaterialRows, templateCsv } = require('../src/material-batch');

const workspaces = [
  { id: 'douyin-commerce', name: '抖音商城号' },
  { id: 'wechat-channels', name: '微信视频号' }
];

test('批量素材CSV按工作区和产品聚合多条内容', () => {
  const rows = parseMaterialRows('工作区,产品型号,文案,Tag,商品短标题\n抖音商城号,A1,"文案,一","家电,活动",短标题\n抖音商城号,A1,文案二,"家电,新品",短标题二\n', workspaces);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].copies, ['文案,一', '文案二']);
  assert.deepEqual(rows[0].tagGroups, ['家电,活动', '家电,新品']);
});

test('批量素材模板包含所有工作区且不包含本机资料', () => {
  const csv = templateCsv(workspaces);
  assert.match(csv, /抖音商城号/);
  assert.match(csv, /微信视频号/);
  assert.doesNotMatch(csv, /feishu|Chrome Profile|Users\\/i);
});
