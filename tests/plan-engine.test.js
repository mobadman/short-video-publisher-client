const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDate, isAllowed, arrangeProducts, buildTimes } = require('../src/plan-engine');

test('飞书格式化日期统一为年月日', () => {
  assert.equal(normalizeDate('2026/8/21 00:00'), '2026-08-21');
  assert.equal(normalizeDate('2026-08-21'), '2026-08-21');
});

test('允许发布只接受明确的肯定值', () => {
  assert.equal(isAllowed('是'), true);
  assert.equal(isAllowed('允许'), true);
  assert.equal(isAllowed(''), false);
  assert.equal(isAllowed('否'), false);
});

test('排序优先避免相邻相同品类', () => {
  const result = arrangeProducts([
    { category: '冰箱', model: 'A' },
    { category: '冰箱', model: 'B' },
    { category: '洗衣机', model: 'C' },
    { category: '洗衣机', model: 'D' }
  ]);
  assert.deepEqual(result.map((item) => item.category), ['冰箱', '洗衣机', '冰箱', '洗衣机']);
});

test('1至44条排期集中在下午晚上且不超出边界', () => {
  assert.deepEqual(buildTimes('2026-08-21', 1), ['2026-08-21 19:00']);
  assert.deepEqual(buildTimes('2026-08-21', 8), [
    '2026-08-21 15:30', '2026-08-21 16:30', '2026-08-21 17:30', '2026-08-21 18:30',
    '2026-08-21 19:30', '2026-08-21 20:30', '2026-08-21 21:30', '2026-08-21 22:30'
  ]);
  assert.equal(buildTimes('2026-08-21', 12)[0], '2026-08-21 13:00');
  assert.equal(buildTimes('2026-08-21', 27).at(-1), '2026-08-21 23:00');
  assert.equal(buildTimes('2026-08-21', 44)[0], '2026-08-21 10:00');
  assert.equal(buildTimes('2026-08-21', 44).at(-1), '2026-08-21 23:00');
  for (let count = 1; count <= 44; count += 1) {
    const values = buildTimes('2026-08-21', count);
    const commerceValues = buildTimes('2026-08-21', count, { lane: 5 });
    assert.equal(values.length, count);
    assert.equal(new Set(values).size, count);
    assert.ok(values.every((value) => value.slice(-5) >= '10:00' && value.slice(-5) <= '23:00'));
    assert.ok(commerceValues.every((value) => Number(value.slice(-2)) % 10 === 5));
    assert.equal(values.some((value) => commerceValues.includes(value)), false);
  }
});

test('自定义排期按固定间隔集中发布并跳过避开时段', () => {
  const policy = {
    mode: 'custom', intervalMinutes: 30,
    focusStart: '13:00', focusEnd: '16:00',
    avoidEnabled: true, avoidStart: '14:00', avoidEnd: '15:00'
  };
  assert.deepEqual(buildTimes('2026-11-01', 5, { schedulePolicy: policy }), [
    '2026-11-01 13:00', '2026-11-01 13:30', '2026-11-01 15:00', '2026-11-01 15:30', '2026-11-01 16:00'
  ]);
  assert.equal(buildTimes('2026-11-01', 2, { schedulePolicy: policy, lane: 5 })[0], '2026-11-01 13:05');
});

test('多个集中时段合并后统一扣除多个避开时段', () => {
  const policy = {
    mode: 'custom', intervalMinutes: 60,
    focusRanges: [{ start: '04:00', end: '07:00' }, { start: '19:00', end: '20:00' }],
    avoidEnabled: true,
    avoidRanges: [{ start: '05:00', end: '06:00' }, { start: '19:30', end: '20:00' }]
  };
  assert.deepEqual(buildTimes('2026-11-01', 5, { schedulePolicy: policy }), [
    '2026-11-01 04:00', '2026-11-01 06:00', '2026-11-01 07:00', '2026-11-01 19:00', '2026-11-01 20:00'
  ]);
});

test('自定义排期容量不足时在拉取前给出可操作提示', () => {
  assert.throws(() => buildTimes('2026-11-01', 4, { schedulePolicy: {
    mode: 'custom', intervalMinutes: 60,
    focusStart: '18:00', focusEnd: '20:00', avoidEnabled: false
  } }), /最多可安排3条/);
});
