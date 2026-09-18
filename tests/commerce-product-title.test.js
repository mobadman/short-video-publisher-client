const test = require('node:test');
const assert = require('node:assert/strict');
const { extractProductTitle, platformTitleAsShortTitle, validateShortTitle } = require('../src/commerce-product-title');

test('从平台页面元信息读取商品原始标题', () => {
  const title = extractProductTitle('<html><head><meta property="og:title" content="美的 G23 微蒸烤一体机 - 抖音商城"></head></html>');
  assert.equal(title, '美的 G23 微蒸烤一体机');
});

test('平台商品原始标题只能作为符合限制的短标题候选', () => {
  assert.deepEqual(platformTitleAsShortTitle('美的G23微蒸烤一体机'), {
    valid: true, title: '美的G23微蒸烤一体机', reason: ''
  });
  const invalid = platformTitleAsShortTitle('美的全自动智能家用多功能微蒸烤一体机厨房套装');
  assert.equal(invalid.valid, false);
  assert.match(invalid.reason, /无法直接作为短标题/);
  assert.equal(validateShortTitle('美的全自动智能家用多功能微蒸烤一体机厨房套装').valid, false);
});
