class DouyinStandardAdapter {
  constructor(browserManager) { this.browserManager = browserManager; }
  beginAutomation() { this.browserManager.beginAutomation(); }
  status() { return this.browserManager.status(); }
  open(account) { return this.browserManager.open(account); }
  detect(account) { return this.browserManager.detect(account.id); }
  close() { return this.browserManager.close(); }
  execute(account, plan, hooks) { return this.browserManager.submitPlannedBatch(account, plan, hooks); }
  syncIds(account, plan) { return this.browserManager.scanPublishedIds(account, plan); }
  openPublishedVideos(account, plan) { return this.browserManager.openPublishedVideos(account, plan); }
}

class DouyinCommerceAdapter extends DouyinStandardAdapter {
  async execute(account, plan, hooks) {
    const missing = (plan.items || []).filter((item) => item.selected && (
      !item.commerce?.required || !item.commerce.productUrl || !item.commerce.productShortTitle || !item.commerce.shortTitleConfirmed
    ));
    if (missing.length) throw new Error(`商城计划中有${missing.length}条缺少商品链接、商品短标题或人工确认`);
    return this.browserManager.submitPlannedBatch(account, plan, { ...hooks, commerce: true });
  }
}

class WechatChannelsAdapter {
  constructor(browserManager) { this.browserManager = browserManager; }
  beginAutomation() { this.browserManager.beginAutomation?.(); }
  status() { return this.browserManager.status(); }
  open(account) { return this.browserManager.open(account); }
  detect(account) { return this.browserManager.detect(account.id); }
  close() { return this.browserManager.close(); }
  execute(account, plan, hooks) { return this.browserManager.submitPlannedBatch(account, plan, hooks); }
  async syncIds() {
    return { matches: [], unresolved: [], unsupported: true, message: '视频号发布ID接口已预留，当前版本不主动获取' };
  }
  async openPublishedVideos() {
    throw new Error('视频号工作区暂不支持批次视频链接检查');
  }
}

function createPublishingAdapter(workspace, managers) {
  if (workspace.platform === 'wechat-channels') return new WechatChannelsAdapter(managers.wechat);
  if (workspace.mode === 'commerce') return new DouyinCommerceAdapter(managers.douyin);
  return new DouyinStandardAdapter(managers.douyin);
}

module.exports = {
  DouyinStandardAdapter,
  DouyinCommerceAdapter,
  WechatChannelsAdapter,
  createPublishingAdapter
};
