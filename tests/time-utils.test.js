const test = require('node:test');
const assert = require('node:assert/strict');
const { nextScheduleInfo } = require('../src/renderer/time-utils');

test('下一发布时间跨午夜时显示明天并计算完整剩余时间', () => {
  const result = nextScheduleInfo([{ scheduledLocal: '2026-09-12 00:10' }], new Date('2026-09-11T23:30:00'));
  assert.deepEqual(result, { label: '明天 00:10', detail: '距计划时间 40分' });
});

test('下一发布时间跨多天时把日期差计入剩余时间', () => {
  const result = nextScheduleInfo([{ scheduledLocal: '2026-09-13 18:20' }], new Date('2026-09-11T16:06:00'));
  assert.deepEqual(result, { label: '9月13日 18:20', detail: '距计划时间 2天 2小时 14分' });
});

test('计划时间已过时明确标记过期', () => {
  const result = nextScheduleInfo([{ scheduledLocal: '2026-09-11 15:00' }], new Date('2026-09-11T16:06:00'));
  assert.deepEqual(result, { label: '今天 15:00', detail: '已过计划时间' });
});
