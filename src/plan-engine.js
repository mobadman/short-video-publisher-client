function normalizeDate(value) {
  const text = String(value ?? '').trim();
  const match = text.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!match) return '';
  return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
}

function isAllowed(value) {
  return /^(是|允许|可发布|发布|true|1|yes|√)$/i.test(String(value ?? '').trim());
}

function arrangeProducts(items) {
  const remaining = items.map((item, index) => ({ ...item, sourceOrder: index }));
  const output = [];
  while (remaining.length) {
    const last = output[output.length - 1];
    let index = remaining.findIndex((item) => !last || item.category !== last.category);
    if (index < 0) index = remaining.findIndex((item) => !last || item.model !== last.model);
    if (index < 0) index = 0;
    output.push(remaining.splice(index, 1)[0]);
  }
  return output;
}

function roundToLane(minutes, lane = 0) {
  return Math.round((minutes - lane) / 10) * 10 + lane;
}

function formatMinutes(date, minutes) {
  return `${date} ${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function parseClock(value, label) {
  const match = String(value || '').match(/^(\d{2}):(\d{2})$/);
  if (!match) throw new Error(`${label}格式不正确`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error(`${label}格式不正确`);
  return hours * 60 + minutes;
}

function policyRanges(policy, key, legacyStart, legacyEnd, required = false) {
  const source = Array.isArray(policy?.[key]) && policy[key].length
    ? policy[key]
    : policy?.[legacyStart] && policy?.[legacyEnd]
      ? [{ start: policy[legacyStart], end: policy[legacyEnd] }]
      : [];
  if (required && !source.length) throw new Error(`至少需要一个${key === 'focusRanges' ? '集中' : '避开'}时段`);
  if (source.length > 8) throw new Error(`${key === 'focusRanges' ? '集中' : '避开'}时段最多设置8个`);
  return source.map((range, index) => {
    const label = `${key === 'focusRanges' ? '集中' : '避开'}时段${index + 1}`;
    const start = parseClock(range?.start, `${label}开始时间`);
    const end = parseClock(range?.end, `${label}结束时间`);
    if (start >= end) throw new Error(`${label}的结束时间必须晚于开始时间`);
    return { start, end };
  });
}

function buildCustomTimes(date, count, policy, options = {}) {
  if (!Number.isInteger(count) || count < 1 || count > 44) throw new Error('单日视频数量必须在1到44条之间');
  const intervalMinutes = Number(policy?.intervalMinutes);
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 10 || intervalMinutes > 180 || intervalMinutes % 5 !== 0) {
    throw new Error('发布间隔必须是10到180分钟之间的5分钟整数倍');
  }
  const focusRanges = policyRanges(policy, 'focusRanges', 'focusStart', 'focusEnd', true);
  const avoidRanges = policy?.avoidEnabled
    ? policyRanges(policy, 'avoidRanges', 'avoidStart', 'avoidEnd', true) : [];
  const lane = options.lane === 5 ? 5 : 0;
  const available = new Set();
  for (const range of focusRanges) {
    let first = range.start;
    if (first % 10 !== lane) first += (lane - first % 10 + 10) % 10;
    for (let minutes = first; minutes <= range.end; minutes += intervalMinutes) {
      if (avoidRanges.some((avoid) => minutes >= avoid.start && minutes < avoid.end)) continue;
      available.add(minutes);
    }
  }
  const values = [...available].sort((left, right) => left - right).map((minutes) => formatMinutes(date, minutes));
  if (values.length < count) {
    throw new Error(`排期规则最多可安排${values.length}条，当前需要${count}条；请扩大集中时段、缩短间隔或缩小避开时段`);
  }
  return values.slice(0, count);
}

function buildTimes(date, count, options = {}) {
  if (!Number.isInteger(count) || count < 1 || count > 44) throw new Error('单日视频数量必须在1到44条之间');
  if (options.schedulePolicy && options.schedulePolicy.mode === 'custom') {
    return buildCustomTimes(date, count, options.schedulePolicy, options);
  }
  const lane = options.lane === 5 ? 5 : 0;
  if (count === 1) return [formatMinutes(date, 19 * 60 + lane)];

  let start;
  let end;
  if (count <= 11) {
    const span = (count - 1) * 60;
    start = 19 * 60 - span / 2;
    end = start + span;
    if (end > 23 * 60) {
      start -= end - 23 * 60;
      end = 23 * 60;
    }
  } else if (count <= 27) {
    start = 13 * 60;
    end = 23 * 60;
  } else {
    start = 13 * 60 - 180 * (count - 27) / 17;
    end = 23 * 60;
  }

  const values = [];
  let previous = null;
  for (let index = 0; index < count; index += 1) {
    let minutes = roundToLane(start + (end - start) * index / (count - 1), lane);
    if (index === 0) minutes = roundToLane(start, lane);
    if (index === count - 1) minutes = roundToLane(end, lane);
    if (lane === 5 && minutes > 22 * 60 + 55) minutes = 22 * 60 + 55;
    if (previous !== null && minutes <= previous) minutes = previous + 10;
    if (minutes < 10 * 60 || minutes > 23 * 60) throw new Error('排期超出10:00到23:00，已停止生成计划');
    values.push(formatMinutes(date, minutes));
    previous = minutes;
  }
  return values;
}

function buildPlan(items, date, options = {}) {
  const arranged = arrangeProducts(items);
  const times = buildTimes(date, arranged.length, options);
  return arranged.map((item, index) => ({ ...item, sequence: index + 1, scheduledLocal: times[index] }));
}

module.exports = { normalizeDate, isAllowed, arrangeProducts, buildTimes, buildCustomTimes, buildPlan };
