const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SchedulePolicyStore } = require('../src/schedule-policy-store');

test('排期方案支持创建修改选择删除并保护默认算法', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-policy-'));
  const store = new SchedulePolicyStore(root);
  let state = store.initialize();
  assert.equal(state.activeId, 'default');
  assert.equal(state.items[0].builtIn, true);
  state = store.save({ name: '晚间集中', intervalMinutes: 30, focusStart: '18:00', focusEnd: '23:00', avoidEnabled: true, avoidStart: '20:00', avoidEnd: '21:00' });
  const created = state.items.find((item) => item.name === '晚间集中');
  assert.equal(state.activeId, created.id);
  state = store.save({ ...created, name: '晚间错峰' });
  assert.equal(store.get(created.id).name, '晚间错峰');
  assert.throws(() => store.save({ ...created, id: 'default' }), /不能修改/);
  state = store.delete(created.id);
  assert.equal(state.activeId, 'default');
  assert.equal(state.items.length, 1);
  assert.throws(() => store.delete('default'), /不能删除/);
});

test('排期方案拒绝无容量和非法间隔', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-policy-invalid-'));
  const store = new SchedulePolicyStore(root);
  store.initialize();
  assert.throws(() => store.save({ name: '错误', intervalMinutes: 7, focusStart: '18:00', focusEnd: '20:00' }), /5分钟整数倍/);
  assert.throws(() => store.save({ name: '反向', intervalMinutes: 30, focusStart: '20:00', focusEnd: '18:00' }), /结束时间必须晚于/);
});

test('排期方案持久化多个集中与避开时段', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-policy-ranges-'));
  const store = new SchedulePolicyStore(root);
  store.initialize();
  const state = store.save({
    name: '早晚双时段', intervalMinutes: 60,
    focusRanges: [{ start: '04:00', end: '07:00' }, { start: '19:00', end: '20:00' }],
    avoidEnabled: true, avoidRanges: [{ start: '05:00', end: '06:00' }]
  });
  const saved = state.items.find((item) => item.name === '早晚双时段');
  assert.deepEqual(saved.focusRanges, [{ start: '04:00', end: '07:00' }, { start: '19:00', end: '20:00' }]);
  assert.deepEqual(saved.avoidRanges, [{ start: '05:00', end: '06:00' }]);
});
