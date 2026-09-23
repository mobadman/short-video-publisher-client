const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildCustomTimes } = require('./plan-engine');

const DEFAULT_POLICY = Object.freeze({
  id: 'default', name: '默认排期', mode: 'default', builtIn: true,
  description: '沿用当前算法，按视频数量自动分布在下午与晚间。'
});

function normalizePolicy(input, existingId = '') {
  const name = String(input?.name || '').trim();
  if (!name) throw new Error('请填写排期方案名称');
  if (name.length > 24) throw new Error('排期方案名称不能超过24个字符');
  const focusRanges = Array.isArray(input.focusRanges) && input.focusRanges.length
    ? input.focusRanges : [{ start: input.focusStart, end: input.focusEnd }];
  const avoidRanges = Array.isArray(input.avoidRanges) && input.avoidRanges.length
    ? input.avoidRanges : input.avoidStart && input.avoidEnd ? [{ start: input.avoidStart, end: input.avoidEnd }] : [];
  const policy = {
    id: existingId || crypto.randomUUID(),
    name,
    mode: 'custom',
    builtIn: false,
    intervalMinutes: Number(input.intervalMinutes),
    focusRanges: focusRanges.map((range) => ({ start: String(range?.start || ''), end: String(range?.end || '') })),
    avoidEnabled: input.avoidEnabled === true,
    avoidRanges: avoidRanges.map((range) => ({ start: String(range?.start || ''), end: String(range?.end || '') }))
  };
  buildCustomTimes('2026-01-01', 1, policy);
  return policy;
}

class SchedulePolicyStore {
  constructor(dataRoot) {
    this.filePath = path.join(dataRoot, '排期策略.json');
  }

  initialize() {
    if (!fs.existsSync(this.filePath)) this.write({ activeId: 'default', items: [] });
    return this.list();
  }

  read() {
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      return { activeId: String(data.activeId || 'default'), items: Array.isArray(data.items) ? data.items : [] };
    } catch {
      return { activeId: 'default', items: [] };
    }
  }

  write(data) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, this.filePath);
  }

  list() {
    const data = this.read();
    const items = [DEFAULT_POLICY, ...data.items.map((item) => {
      const focusRanges = Array.isArray(item.focusRanges) && item.focusRanges.length
        ? item.focusRanges : item.focusStart && item.focusEnd ? [{ start: item.focusStart, end: item.focusEnd }] : [];
      const avoidRanges = Array.isArray(item.avoidRanges) && item.avoidRanges.length
        ? item.avoidRanges : item.avoidStart && item.avoidEnd ? [{ start: item.avoidStart, end: item.avoidEnd }] : [];
      return { ...item, mode: 'custom', builtIn: false, focusRanges, avoidRanges };
    })];
    const activeId = items.some((item) => item.id === data.activeId) ? data.activeId : 'default';
    return { activeId, items };
  }

  get(id = '') {
    const state = this.list();
    return state.items.find((item) => item.id === String(id || state.activeId)) || DEFAULT_POLICY;
  }

  save(input = {}) {
    const data = this.read();
    const requestedId = String(input.id || '');
    if (requestedId === 'default') throw new Error('默认排期是系统算法，不能修改');
    const current = data.items.find((item) => item.id === requestedId);
    const policy = normalizePolicy(input, current?.id || '');
    if (data.items.some((item) => item.id !== policy.id && String(item.name).toLowerCase() === policy.name.toLowerCase())) {
      throw new Error('已经存在同名排期方案');
    }
    const now = new Date().toISOString();
    const saved = { ...current, ...policy, createdAt: current?.createdAt || now, updatedAt: now };
    delete saved.focusStart;
    delete saved.focusEnd;
    delete saved.avoidStart;
    delete saved.avoidEnd;
    const index = data.items.findIndex((item) => item.id === saved.id);
    if (index >= 0) data.items[index] = saved;
    else data.items.push(saved);
    data.activeId = saved.id;
    this.write(data);
    return this.list();
  }

  select(id) {
    const data = this.read();
    const selected = String(id || 'default');
    if (selected !== 'default' && !data.items.some((item) => item.id === selected)) throw new Error('排期方案不存在');
    data.activeId = selected;
    this.write(data);
    return this.list();
  }

  delete(id) {
    const selected = String(id || '');
    if (!selected || selected === 'default') throw new Error('默认排期不能删除');
    const data = this.read();
    if (!data.items.some((item) => item.id === selected)) throw new Error('排期方案不存在');
    data.items = data.items.filter((item) => item.id !== selected);
    if (data.activeId === selected) data.activeId = 'default';
    this.write(data);
    return this.list();
  }
}

module.exports = { SchedulePolicyStore, DEFAULT_POLICY, normalizePolicy };
