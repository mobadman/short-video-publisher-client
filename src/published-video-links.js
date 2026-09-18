const PUBLISHED_STATES = new Set(['verified', 'id-resolved']);

function canonicalDouyinVideoUrl(item) {
  const explicitId = String(item?.publish?.videoId || '').trim();
  const storedUrl = String(item?.publish?.videoUrl || '').trim();
  const storedId = storedUrl.match(/^https:\/\/(?:www\.)?douyin\.com\/video\/(\d+)(?:[/?#]|$)/i)?.[1] || '';
  const videoId = /^\d{10,}$/.test(explicitId) ? explicitId : storedId;
  return videoId ? `https://www.douyin.com/video/${videoId}` : '';
}

function collectPublishedVideoLinks(plan) {
  const publishedItems = (plan?.items || []).filter((item) => (
    PUBLISHED_STATES.has(item?.execution?.state) || item?.publish?.idState === 'resolved'
  ));
  const links = [];
  const seen = new Set();
  const unresolvedItems = [];

  for (const item of publishedItems) {
    const url = canonicalDouyinVideoUrl(item);
    if (!url) {
      unresolvedItems.push({
        itemId: String(item?.itemId || ''),
        sequence: Number(item?.sequence || 0),
        name: String(item?.originalMaterialName || '')
      });
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    links.push(url);
  }

  return {
    links,
    publishedCount: publishedItems.length,
    resolvedCount: links.length,
    unresolvedCount: unresolvedItems.length,
    unresolvedItems
  };
}

module.exports = { canonicalDouyinVideoUrl, collectPublishedVideoLinks, PUBLISHED_STATES };
