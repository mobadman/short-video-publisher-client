const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canonicalDouyinVideoUrl,
  collectPublishedVideoLinks
} = require('../src/published-video-links');
const { BrowserManager } = require('../src/browser-manager');

test('视频检查链接只接受抖音数字视频ID并统一为规范网址', () => {
  assert.equal(canonicalDouyinVideoUrl({ publish: { videoId: '7677529618735271210' } }), 'https://www.douyin.com/video/7677529618735271210');
  assert.equal(canonicalDouyinVideoUrl({ publish: { videoUrl: 'https://www.douyin.com/video/7677529618735271210?previous_page=app' } }), 'https://www.douyin.com/video/7677529618735271210');
  assert.equal(canonicalDouyinVideoUrl({ publish: { videoUrl: 'https://example.com/video/7677529618735271210' } }), '');
});

test('批次检查只收集已提交项目并报告未同步链接', () => {
  const result = collectPublishedVideoLinks({ items: [
    { itemId: 'pending', sequence: 1, execution: { state: 'pending' }, publish: {} },
    { itemId: 'resolved', sequence: 2, execution: { state: 'id-resolved' }, publish: { videoId: '1111111111111111111' } },
    { itemId: 'manual', sequence: 3, execution: { state: 'verified' }, publish: {} },
    { itemId: 'duplicate', sequence: 4, execution: { state: 'verified' }, publish: { videoUrl: 'https://www.douyin.com/video/1111111111111111111' } }
  ] });

  assert.deepEqual(result.links, ['https://www.douyin.com/video/1111111111111111111']);
  assert.equal(result.publishedCount, 3);
  assert.equal(result.resolvedCount, 1);
  assert.equal(result.unresolvedCount, 1);
  assert.equal(result.unresolvedItems[0].itemId, 'manual');
});

test('批次检查在当前发布账号Chrome中逐个打开规范链接', async () => {
  const opened = [];
  let frontCount = 0;
  const manager = new BrowserManager('unused', 'unused');
  manager.active = {
    accountId: 'production-account',
    context: {
      newPage: async () => ({
        goto: async (url) => { opened.push(url); },
        bringToFront: async () => { frontCount += 1; },
        close: async () => {}
      })
    }
  };
  const result = await manager.openPublishedVideos(
    { id: 'production-account', role: 'production' },
    { items: [
      { execution: { state: 'id-resolved' }, publish: { videoId: '1111111111111111111' } },
      { execution: { state: 'verified' }, publish: {} }
    ] }
  );

  assert.deepEqual(opened, ['https://www.douyin.com/video/1111111111111111111']);
  assert.equal(result.openedCount, 1);
  assert.equal(result.unresolvedCount, 1);
  assert.equal(frontCount, 1);
});
