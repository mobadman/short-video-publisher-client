const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPublishingAdapter, DouyinStandardAdapter, DouyinCommerceAdapter, WechatChannelsAdapter } = require('../src/publishing-adapters');
const { candidateFromRowText } = require('../src/doudian-browser-manager');
const { COMMERCE_TAG_LABEL_PATTERN } = require('../src/browser-manager');

const manager = { status: () => ({ open: false }), close() {} };

test('工作区只会选择对应的平台发布适配器', () => {
  assert.ok(createPublishingAdapter({ platform: 'douyin', mode: 'standard' }, { douyin: manager }) instanceof DouyinStandardAdapter);
  assert.ok(createPublishingAdapter({ platform: 'douyin', mode: 'commerce' }, { douyin: manager }) instanceof DouyinCommerceAdapter);
  assert.ok(createPublishingAdapter({ platform: 'wechat-channels', mode: 'standard' }, { wechat: manager }) instanceof WechatChannelsAdapter);
});

test('抖店商品行文本提取价格库存销量和商品ID', () => {
  const item = candidateFromRowText('美的 G23 商品ID：3821815760901242988 ￥2099.00 总库存 59 总销量 6', 'https://haohuo.jinritemai.com/ecommerce/trade/detail?id=1');
  assert.equal(item.externalProductId, '3821815760901242988');
  assert.equal(item.priceCents, 209900);
  assert.equal(item.stock, 59);
  assert.equal(item.sales, 6);
});

test('视频号实现明确保持合集、视频标注和原创声明默认值', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'wechat-channels-browser-manager.js'), 'utf8');
  assert.match(source, /合集、视频标注、原创声明保持平台默认值/);
  assert.doesNotMatch(source, /含AI生成内容/);
  assert.match(source, /waiting-human/);
});

test('视频号4.1.3恢复4.0.3稳定节奏并保留分阶段计时', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'wechat-channels-browser-manager.js'), 'utf8');
  assert.match(source, /openCreatePage/);
  assert.match(source, /page\.goto\(CHANNELS_HOME/);
  assert.doesNotMatch(source, /directReady/);
  assert.match(source, /slowMo:\s*100/);
  assert.match(source, /发布表单就绪/);
  assert.match(source, /填写正文和Tag/);
  assert.match(source, /等待上传与处理/);
  assert.match(source, /结果确认/);
  assert.match(source, /page\.keyboard\.type\(`#\$\{tag\}`\)/);
  const flow = source.slice(source.indexOf('async fillPublishPage'), source.indexOf('async waitForUploadComplete'));
  const uploadIndex = flow.indexOf('${label}-等待上传与处理');
  const titleIndex = flow.indexOf('${label}-填写短标题');
  const scheduleIndex = flow.indexOf('${label}-设置定时');
  const coverIndex = flow.indexOf('${label}-设置封面');
  assert.ok(uploadIndex >= 0 && uploadIndex < titleIndex);
  assert.ok(titleIndex < scheduleIndex);
  assert.ok(scheduleIndex < coverIndex);
  assert.match(source, /dialogTitle\.waitFor\(\{ state: 'visible', timeout: 10_000 \}\)/);
  assert.match(source, /裁剪封面图.*filter\(\{ visible: true \}\)/);
  assert.doesNotMatch(source, /dialog\.isVisible\(\{ timeout/);
  assert.match(source, /禁止自动重试/);
});

test('商城挂车兼容抖音新旧标签文案并将控件限定在标签行', () => {
  assert.equal(COMMERCE_TAG_LABEL_PATTERN.test('标签'), true);
  assert.equal(COMMERCE_TAG_LABEL_PATTERN.test('添加标签'), true);
  assert.equal(COMMERCE_TAG_LABEL_PATTERN.test('添加合集'), false);

  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'browser-manager.js'), 'utf8');
  assert.match(source, /ancestor::\*\[descendant::\*\[@role="combobox"\]/);
  assert.match(source, /row\.locator\('\.semi-select:visible/);
  assert.doesNotMatch(source, /getByText\('标签', \{ exact: true \}\)/);
  assert.doesNotMatch(source, /input:not\(\[type="hidden"\]\)/);
});
