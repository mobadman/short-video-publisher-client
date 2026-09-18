(function exposeTimeUtils(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PublisherTime = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  function parseLocalDate(value) {
    const date = new Date(String(value || '').replace(' ', 'T'));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function nextScheduleInfo(items, nowValue = new Date()) {
    const candidates = items.map((item) => parseLocalDate(item.scheduledLocal)).filter(Boolean).sort((a, b) => a - b);
    if (!candidates.length) return { label: '—', detail: '计划中没有有效发布时间' };
    const now = new Date(nowValue);
    const target = candidates.find((date) => date > now) || candidates[candidates.length - 1];
    const nowDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const targetDay = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
    const dayDiff = Math.round((targetDay - nowDay) / 86400000);
    const dayLabel = dayDiff === 0 ? '今天' : dayDiff === 1 ? '明天' : `${target.getMonth() + 1}月${target.getDate()}日`;
    const time = `${String(target.getHours()).padStart(2, '0')}:${String(target.getMinutes()).padStart(2, '0')}`;
    const delta = target - now;
    if (delta <= 0) return { label: `${dayLabel} ${time}`, detail: '已过计划时间' };
    const totalMinutes = Math.ceil(delta / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    const remaining = [days && `${days}天`, hours && `${hours}小时`, minutes && `${minutes}分`].filter(Boolean).join(' ');
    return { label: `${dayLabel} ${time}`, detail: `距计划时间 ${remaining}` };
  }

  return { parseLocalDate, nextScheduleInfo };
});
