function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function normalizeProductTitle(value) {
  return decodeHtml(value).replace(/\s+/g, ' ').trim()
    .replace(/\s*[-_|｜]\s*(抖音|抖店|巨量|商品详情).*/i, '')
    .trim();
}

function extractProductTitle(html) {
  const text = String(html || '');
  const patterns = [
    /<meta[^>]+(?:property|name)=["'](?:og:title|twitter:title|title)["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:title|twitter:title|title)["'][^>]*>/i,
    /<title[^>]*>([^<]+)<\/title>/i
  ];
  for (const pattern of patterns) {
    const title = normalizeProductTitle(text.match(pattern)?.[1] || '');
    if (title) return title;
  }
  return '';
}

function chineseCount(value) {
  return (String(value || '').match(/[\u3400-\u9fff]/g) || []).length;
}

function validateShortTitle(value) {
  const title = normalizeProductTitle(value);
  if (!title) return { valid: false, title: '', reason: '商品短标题为空' };
  if (chineseCount(title) > 10) return { valid: false, title, reason: '商品短标题超过10个汉字' };
  if (title.length > 30) return { valid: false, title, reason: '商品短标题过长，需人工精简' };
  return { valid: true, title, reason: '' };
}

function platformTitleAsShortTitle(value) {
  const result = validateShortTitle(value);
  return result.valid ? result : { ...result, reason: `平台商品原始标题无法直接作为短标题：${result.reason}` };
}

module.exports = {
  normalizeProductTitle,
  extractProductTitle,
  chineseCount,
  validateShortTitle,
  platformTitleAsShortTitle
};
