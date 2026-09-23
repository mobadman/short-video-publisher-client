const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, shell, dialog, clipboard } = require('electron');
const { AccountStore } = require('./account-store');
const { BrowserManager } = require('./browser-manager');
const { ConfigStore } = require('./config-store');
const { LibraryStore } = require('./library-store');
const { FeishuService } = require('./feishu-service');
const { FeishuBrowserManager } = require('./feishu-browser-manager');
const { PlanService } = require('./plan-service');
const { asChineseError } = require('./chinese-error');
const { DurationStore } = require('./duration-store');
const { AutomationGuard } = require('./automation-guard');
const { WorkspaceStore } = require('./workspace-store');
const { WechatChannelsBrowserManager } = require('./wechat-channels-browser-manager');
const { createPublishingAdapter } = require('./publishing-adapters');
const { writePackage, packageSummary, importPackage } = require('./material-package');
const { parseMaterialRows, templateCsv } = require('./material-batch');

// 工作台本身不需要 GPU 合成；关闭硬件加速可避免部分 Windows 机器的 Electron GPU 子进程崩溃。
// 发布用 Chrome 由 Playwright 单独启动，不受此设置影响。
app.disableHardwareAcceleration();

let mainWindow;
let accountStore;
let browserManager;
let feishuBrowserManager;
let configStore;
let libraryStore;
let planService;
let durationStore;
let automationGuard;
let workspaceStore;
let wechatBrowserManager;
let publishingAdapter;
let nativeDialogHelperPath;

function elapsedText(durationMs) {
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  if (seconds < 60) return `${seconds}秒`;
  return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
}

function planTotalBytes(plan) {
  const fs = require('node:fs');
  return (plan?.items || []).reduce((sum, item) => {
    try { return sum + fs.statSync(item.videoPath).size; } catch { return sum; }
  }, 0);
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.show();
  mainWindow.restore();
  mainWindow.focus();
}

function startGuard(kind) {
  if (kind === 'pull') feishuBrowserManager.beginAutomation();
  else if (kind === 'test') browserManager.beginAutomation();
  else publishingAdapter.beginAutomation();
  // 1.0.3 临时停用全屏覆盖层。它会拦截封面上传所需的 Windows 原生鼠标操作。
}

function allBrowserManagers() {
  return [browserManager, wechatBrowserManager].filter(Boolean);
}

function managerForAccount(account) {
  if (account.platform === 'wechat-channels') return wechatBrowserManager;
  return browserManager;
}

function combinedBrowserStatus() {
  const active = allBrowserManagers().map((manager) => manager.status()).find((status) => status.open);
  return active || { activeAccountId: null, open: false };
}

function allWorkspaceLibraries() {
  return workspaceStore.list().map((workspace) => {
    const store = workspace.id === workspaceStore.activeId()
      ? libraryStore : new LibraryStore(app.getPath('userData'), workspace.id);
    store.initialize();
    return { workspace, store };
  });
}

async function rebuildWorkspaceRuntime() {
  const workspace = workspaceStore.active();
  libraryStore = new LibraryStore(app.getPath('userData'), workspace.id);
  libraryStore.initialize();
  feishuBrowserManager = new FeishuBrowserManager(path.join(
    app.getPath('userData'), '工作区', workspace.id, 'browser-profiles', 'feishu-fixed-145'
  ), {
    downloadsPath: path.join(app.getPath('userData'), '工作区', workspace.id, 'browser-downloads'),
    diagnosticsPath: path.join(app.getPath('userData'), '工作区', workspace.id, 'browser-health.log')
  });
  browserManager = new BrowserManager(libraryStore.logsRoot, nativeDialogHelperPath);
  wechatBrowserManager = new WechatChannelsBrowserManager(libraryStore.logsRoot, nativeDialogHelperPath);
  publishingAdapter = createPublishingAdapter(workspace, {
    douyin: browserManager,
    wechat: wechatBrowserManager
  });
  planService = new PlanService(configStore, libraryStore, new FeishuService(feishuBrowserManager), { workspace });
  return workspace;
}

function safeAccountProfile(accountId) {
  const account = accountStore.get(String(accountId));
  const profilesRoot = path.resolve(accountStore.profilesRoot);
  const profilePath = path.resolve(account.profilePath);
  const relative = path.relative(profilesRoot, profilePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('账号资料目录不在软件管理范围内，已拒绝操作');
  }
  return { account, profilePath };
}

function createWindow() {
  const windowWidth = Number(process.env.SMOKE_WINDOW_WIDTH) || 1280;
  const windowHeight = Number(process.env.SMOKE_WINDOW_HEIGHT) || 860;
  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    minWidth: 860,
    minHeight: 620,
    title: '短视频批量发布助手',
    icon: path.join(__dirname, 'renderer', 'assets', 'app-icon.png'),
    backgroundColor: '#f5f5f2',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file:')) event.preventDefault();
  });
}

function registerIpc() {
  ipcMain.on('guard:takeover', (event) => {
    if (automationGuard.owns(event.sender)) automationGuard.requestTakeover();
  });
  ipcMain.handle('workspaces:list', () => ({ active: workspaceStore.active(), items: workspaceStore.list() }));
  ipcMain.handle('workspace:update', (_event, workspaceId, input) => {
    const updated = workspaceStore.update(String(workspaceId), input || {});
    if (updated.id === workspaceStore.activeId()) planService.updateWorkspace(updated);
    return updated;
  });
  ipcMain.handle('workspace:select', async (_event, workspaceId) => {
    if (combinedBrowserStatus().open || feishuBrowserManager.status().open) {
      throw new Error('切换工作区前请先关闭当前发布账号、抖店和飞书 Chrome');
    }
    workspaceStore.select(String(workspaceId));
    return rebuildWorkspaceRuntime();
  });
  ipcMain.handle('accounts:list', () => accountStore.list());
  ipcMain.handle('browser:status', () => combinedBrowserStatus());
  ipcMain.handle('browser:open', async (_event, accountId) => {
    const account = accountStore.get(String(accountId));
    const other = allBrowserManagers().find((manager) => manager !== managerForAccount(account) && manager.status().open);
    if (other) throw new Error('另一个平台或账号的 Chrome 仍在运行，请先关闭后再切换');
    return managerForAccount(account).open(account);
  });
  ipcMain.handle('browser:detect', async (_event, accountId) => {
    const account = accountStore.get(String(accountId));
    const detection = await managerForAccount(account).detect(account.id);
    accountStore.saveDetection(account.id, detection);
    return detection;
  });
  ipcMain.handle('account:rename', (_event, accountId, label) => accountStore.rename(String(accountId), label));
  ipcMain.handle('account:open-folder', async (_event, accountId) => {
    const { profilePath } = safeAccountProfile(accountId);
    fs.mkdirSync(profilePath, { recursive: true });
    const result = await shell.openPath(profilePath);
    if (result) throw new Error(`打开账号目录失败：${result}`);
    return profilePath;
  });
  ipcMain.handle('account:reset', async (_event, accountId) => {
    const normalizedId = String(accountId);
    const { account, profilePath } = safeAccountProfile(normalizedId);
    if (managerForAccount(account).status().activeAccountId === normalizedId) {
      throw new Error('请先关闭这个账号的 Chrome，再删除账号登录资料');
    }
    if (fs.existsSync(profilePath)) {
      const information = fs.lstatSync(profilePath);
      if (information.isSymbolicLink()) throw new Error('账号资料目录是链接，已拒绝删除');
      await shell.trashItem(profilePath);
    }
    const reset = accountStore.reset(normalizedId);
    return { account: reset, removedProfile: account.label, recoverable: true };
  });
  ipcMain.handle('browser:close', async () => {
    await Promise.all(allBrowserManagers().map((manager) => manager.close()));
    return combinedBrowserStatus();
  });
  ipcMain.handle('file:choose-video', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择测试视频',
      properties: ['openFile'],
      filters: [{ name: '视频', extensions: ['mp4', 'mov', 'm4v', 'webm'] }]
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('file:choose-cover', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择封面图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png'] }]
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('test-publish:submit', async (_event, payload) => {
    const platform = payload?.platform === 'wechat-channels' ? 'wechat-channels' : 'douyin';
    const account = accountStore.get(platform === 'wechat-channels' ? 'wechat-test' : 'test-account');
    if (account.lastDetected?.state !== 'logged-in') throw new Error('请先打开、检测并人工核对当前测试账号');
    if (platform === 'wechat-channels') wechatBrowserManager.beginAutomation();
    else browserManager.beginAutomation();
    const startedAt = Date.now();
    try {
      const result = platform === 'wechat-channels'
        ? await wechatBrowserManager.submitTestPublish(account, payload || {})
        : await browserManager.submitTestPublish(account, payload || {});
      automationGuard.stop();
      focusMainWindow();
      await dialog.showMessageBox(mainWindow, {
        type: 'info', title: '测试发布完成', message: `${platform === 'wechat-channels' ? '视频号' : '抖音'}测试视频已经提交`,
        detail: `耗时${elapsedText(Date.now() - startedAt)}。请前往作品管理人工检查。`
      });
      return result;
    } finally {
      automationGuard.stop();
    }
  });
  ipcMain.handle('test-publish:resolve-id', async (_event, input) => {
    const account = accountStore.get('test-account');
    return browserManager.scanTestPublishedId(account, input || {});
  });
  ipcMain.handle('settings:get', () => configStore.publicConfig());
  ipcMain.handle('settings:save', (_event, input) => configStore.save(input || {}));
  ipcMain.handle('feishu-browser:status', () => feishuBrowserManager.status());
  ipcMain.handle('feishu-browser:open', () => feishuBrowserManager.open(workspaceStore.active().sheetUrl));
  ipcMain.handle('feishu-browser:detect', () => feishuBrowserManager.detect(workspaceStore.active().sheetUrl));
  ipcMain.handle('feishu-browser:close', () => feishuBrowserManager.close());
  ipcMain.handle('library:paths', () => libraryStore.paths());
  ipcMain.handle('library:list-products', (_event, workspaceId, schemeId = 'default') => {
    const workspace = workspaceStore.get(String(workspaceId || workspaceStore.activeId()));
    const store = workspace.id === workspaceStore.activeId()
      ? libraryStore : new LibraryStore(app.getPath('userData'), workspace.id);
    store.initialize();
    return { workspace, items: store.listProducts(String(schemeId || 'default')), schemes: store.listSchemes() };
  });
  ipcMain.handle('library:schemes', () => ({
    items: libraryStore.listSchemes(),
    effective: libraryStore.resolveScheme(new Date().toISOString().slice(0, 10), 'auto')
  }));
  ipcMain.handle('library:save-scheme', (_event, input = {}) => {
    const workspaceIds = new Set((input.workspaceIds || workspaceStore.list().map((workspace) => workspace.id)).map(String));
    const sharedInput = { ...input, id: input.id || `scheme-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
    const results = [];
    for (const { workspace, store } of allWorkspaceLibraries()) {
      if (workspaceIds.has(workspace.id)) results.push({ workspaceId: workspace.id, ...store.saveScheme(sharedInput) });
    }
    return { results, items: libraryStore.listSchemes() };
  });
  ipcMain.handle('library:open-scheme', async (_event, schemeId = 'default') => {
    const directory = libraryStore.schemeDirectory(String(schemeId || 'default'));
    const result = await shell.openPath(directory);
    if (result) throw new Error(`打开方案目录失败：${result}`);
    return directory;
  });
  ipcMain.handle('library:inspect-scheme', (_event, schemeId = 'default') => ({
    schemeId,
    workspaces: allWorkspaceLibraries().map(({ workspace, store }) => ({ workspace, ...store.inspectScheme(String(schemeId || 'default')) }))
  }));
  ipcMain.handle('library:save-batch-template', async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存批量素材模板', defaultPath: '素材批量导入模板.csv',
      filters: [{ name: 'CSV 表格', extensions: ['csv'] }]
    });
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(result.filePath, templateCsv(workspaceStore.list()), 'utf8');
    return result.filePath;
  });
  ipcMain.handle('library:import-batch', async (_event, schemeId = 'default') => {
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: '导入批量素材表', properties: ['openFile'], filters: [{ name: 'CSV 表格', extensions: ['csv'] }]
    });
    if (selected.canceled || !selected.filePaths[0]) return null;
    const groups = parseMaterialRows(fs.readFileSync(selected.filePaths[0], 'utf8'), workspaceStore.list());
    const workspaceCount = new Set(groups.map((group) => group.workspaceId)).size;
    const decision = await dialog.showMessageBox(mainWindow, {
      type: 'question', buttons: ['取消', '合并追加', '覆盖同名产品'], defaultId: 1, cancelId: 0,
      title: '确认批量写入素材',
      message: `将写入 ${workspaceCount} 个工作区、${groups.length} 个产品`,
      detail: '合并追加会保留原内容并去重；覆盖会用表格内容替换同名产品的文案、Tag 和商品短标题。封面不会改动。'
    });
    if (decision.response === 0) return null;
    const mode = decision.response === 2 ? 'replace' : 'append';
    const libraryMap = new Map(allWorkspaceLibraries().map((item) => [item.workspace.id, item.store]));
    const snapshots = [];
    try {
      for (const group of groups) {
        const store = libraryMap.get(group.workspaceId);
        snapshots.push({ store, snapshot: store.captureProduct(group.model, schemeId) });
        store.saveProduct({ ...group, schemeId, mode, coverPaths: [] });
      }
    } catch (error) {
      for (const item of snapshots.reverse()) item.store.restoreProduct(item.snapshot);
      throw new Error(`批量素材写入失败，已恢复原有素材：${error.message}`);
    }
    return { filePath: selected.filePaths[0], workspaceCount, productCount: groups.length, mode };
  });
  ipcMain.handle('library:choose-covers', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '\u9009\u62e9\u4ea7\u54c1\u5c01\u9762', properties: ['openFile', 'multiSelections'],
      filters: [{ name: '\u56fe\u7247', extensions: ['jpg', 'jpeg', 'png'] }]
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle('library:save-product', (_event, input = {}) => {
    const model = String(input.model || '').trim();
    if (!model) throw new Error('\u4ea7\u54c1\u578b\u53f7\u4e0d\u80fd\u4e3a\u7a7a');
    const workspaceIds = [...new Set((input.workspaceIds || []).map(String))];
    if (!workspaceIds.length) throw new Error('\u8bf7\u81f3\u5c11\u9009\u62e9\u4e00\u4e2a\u76ee\u6807\u5de5\u4f5c\u533a');
    const validIds = new Set(workspaceStore.list().map((workspace) => workspace.id));
    if (workspaceIds.some((id) => !validIds.has(id))) throw new Error('\u76ee\u6807\u5de5\u4f5c\u533a\u4e0d\u5b58\u5728');
    const targets = workspaceIds.map((workspaceId) => {
      const store = workspaceId === workspaceStore.activeId()
        ? libraryStore : new LibraryStore(app.getPath('userData'), workspaceId);
      store.initialize();
      return { workspaceId, store, snapshot: store.captureProduct(model, input.schemeId || 'default') };
    });
    const results = [];
    try {
      for (const { workspaceId, store } of targets) results.push({ workspaceId, ...store.saveProduct(input) });
    } catch (error) {
      for (const { store, snapshot } of targets.reverse()) store.restoreProduct(snapshot);
      throw new Error(`\u7d20\u6750\u5199\u5165\u5931\u8d25\uff0c\u5df2\u56de\u6eda\u6240\u6709\u5de5\u4f5c\u533a\uff1a${error.message}`);
    }
    return { model, results };
  });
  ipcMain.handle('library:export-package', async (_event, input = {}) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出本地素材包',
      defaultPath: `短视频素材包-${new Date().toISOString().slice(0, 10)}.svmpack`,
      filters: [{ name: '短视频素材包', extensions: ['svmpack'] }]
    });
    if (result.canceled || !result.filePath) return null;
    return writePackage(result.filePath, allWorkspaceLibraries(), { ...input, appVersion: app.getVersion() });
  });
  ipcMain.handle('library:import-package', async () => {
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: '导入本地素材包', properties: ['openFile'],
      filters: [{ name: '短视频素材包', extensions: ['svmpack'] }]
    });
    if (selected.canceled || !selected.filePaths[0]) return null;
    const summary = packageSummary(selected.filePaths[0]);
    const confirmed = await dialog.showMessageBox(mainWindow, {
      type: 'question', buttons: ['取消', '校验并导入'], defaultId: 1, cancelId: 0,
      title: '确认导入素材包',
      message: `素材包包含 ${summary.workspaces.length} 个工作区`,
      detail: `${summary.workspaces.map((item) => `${item.name}：${item.fileCount}个文件`).join('\n')}\n\n只导入素材库和素材方案；不会导入飞书链接、登录资料、Chrome Profile、日志、缓存或发布计划。同名素材文件将覆盖，失败会自动恢复。`
    });
    if (confirmed.response !== 1) return null;
    return { ...importPackage(selected.filePaths[0], allWorkspaceLibraries()), summary };
  });
  ipcMain.handle('library:open', async (_event, key) => {
    const paths = libraryStore.paths();
    if (!['covers', 'copy', 'tags', 'shortTitles', 'productConfig', 'cache', 'logs', 'records', 'root', 'materialCenter', 'schemes', 'activitySchemes', 'currentScheme'].includes(String(key))) throw new Error('不允许打开这个目录');
    const result = await shell.openPath(paths[key]);
    if (result) throw new Error(`打开目录失败：${result}`);
    return paths[key];
  });
  ipcMain.handle('plan:current', () => planService.current());
  ipcMain.handle('plan:resolve-commerce-titles', async () => {
    const workspace = workspaceStore.active();
    if (workspace.mode !== 'commerce') throw new Error('当前不是商城号工作区');
    const plan = planService.requirePlan();
    const account = accountStore.get(workspace.publisherAccountId);
    const status = browserManager.status();
    if (!status.open || status.activeAccountId !== account.id) {
      throw new Error('请先打开并核对当前商城发布账号的 Chrome，再读取商品原始标题');
    }
    let proposed = 0;
    let needsManual = 0;
    let skipped = 0;
    const failures = [];
    for (const item of plan.items.filter((candidate) => candidate.selected && candidate.commerce?.required)) {
      if (item.commerce.shortTitleSource === 'library' && item.commerce.productShortTitle) { skipped += 1; continue; }
      if (!item.commerce.productUrl) { needsManual += 1; continue; }
      try {
        const result = await browserManager.readCommerceProductOriginalTitle(account, item.commerce.productUrl);
        const updated = planService.applyCommerceProductTitle(item.itemId, result.productOriginalTitle);
        const currentItem = updated.items.find((candidate) => candidate.itemId === item.itemId);
        if (currentItem.commerce.state === 'needs-short-title-confirmation') proposed += 1;
        else needsManual += 1;
      } catch (error) {
        planService.applyCommerceProductTitle(item.itemId, '', error.message);
        needsManual += 1;
        failures.push(`${item.model}：${error.message}`);
      }
    }
    return { plan: planService.current(), proposed, needsManual, skipped, failures };
  });
  ipcMain.handle('duration:estimates', () => durationStore.estimates(planService.current()));
  ipcMain.handle('plan:create', async (_event, input) => {
    const date = typeof input === 'string' ? input : input?.date;
    const filterMode = typeof input === 'object' ? input?.filterMode : 'auto';
    const schemeId = typeof input === 'object' ? input?.schemeId : 'auto';
    const startedAt = Date.now();
    startGuard('pull');
    try {
      const plan = await planService.create(String(date || ''), { filterMode, schemeId });
      const durationMs = Date.now() - startedAt;
      durationStore.record('pull', plan.items.length, durationMs);
      automationGuard.stop();
      focusMainWindow();
      await dialog.showMessageBox(mainWindow, {
        type: 'info', title: '素材拉取完成', message: `已生成${plan.items.length}条发布计划`,
        detail: `实际耗时${elapsedText(durationMs)}。请逐行检查文件、产品、时间、文案、Tag和封面。\n性能报告：${plan.performance?.reportPath || '生成失败'}`
      });
      return plan;
    } catch (error) {
      throw asChineseError(error, '生成发布计划');
    } finally {
      automationGuard.stop();
    }
  });
  ipcMain.handle('plan:update-item', (_event, itemId, input) => planService.updateItem(itemId, input || {}));
  ipcMain.handle('plan:set-selection', (_event, itemIds, selected) => planService.setSelections(itemIds, selected));
  ipcMain.handle('plan:confirm-uncertain', (_event, itemId, published) => planService.confirmUncertain(itemId, Boolean(published)));
  ipcMain.handle('plan:choose-cover', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '为计划项选择封面', properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png'] }]
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('plan:export-ids', () => planService.exportIdRecords());
  ipcMain.handle('plan:copy-id-table', () => {
    const records = planService.exportIdRecords();
    if (!records.idClipboardText) throw new Error('当前计划还没有已获取的发布ID，无法复制');
    clipboard.writeText(records.idClipboardText);
    return { ...records, clipboardText: undefined, idClipboardText: undefined };
  });
  ipcMain.handle('plan:sync-ids', async () => {
    const plan = planService.requirePlan();
    const activeAccountId = publishingAdapter.status().activeAccountId;
    if (!activeAccountId) throw new Error('请先打开并检测发布账号');
    const account = accountStore.get(activeAccountId);
    const result = await publishingAdapter.syncIds(account, plan);
    for (const match of result.matches) planService.updatePublishIdentity(match.itemId, match);
    const records = planService.exportIdRecords();
    return { ...result, records };
  });
  ipcMain.handle('plan:open-published-videos', async () => {
    const plan = planService.requirePlan();
    const activeAccountId = publishingAdapter.status().activeAccountId;
    if (!activeAccountId) throw new Error('请先打开并检测发布账号');
    const account = accountStore.get(activeAccountId);
    if (account.id !== plan.workspace?.publisherAccountId && plan.workspace) {
      throw new Error('当前账号与计划锁定的发布账号不一致');
    }
    return publishingAdapter.openPublishedVideos(account, plan);
  });
  ipcMain.handle('plan:open-id-records', async () => {
    fs.mkdirSync(libraryStore.recordsRoot, { recursive: true });
    const result = await shell.openPath(libraryStore.recordsRoot);
    if (result) throw new Error(`打开发布ID记录目录失败：${result}`);
    return libraryStore.recordsRoot;
  });
  ipcMain.handle('plan:execute', async () => {
    const plan = planService.current();
    if (!plan || plan.invalid) throw new Error('当前计划缓存已损坏，请重新生成计划后再发布');
    const activeAccountId = publishingAdapter.status().activeAccountId;
    if (!activeAccountId) throw new Error('请先打开并检测要发布的账号');
    const account = accountStore.get(activeAccountId);
    if (account.id !== plan.workspace?.publisherAccountId && plan.workspace) throw new Error('当前账号与计划锁定的发布账号不一致');
    if (account.role !== 'production') throw new Error('正式批量发布只允许使用“发布账号”；测试请进入测试工具');
    planService.updateStatus('executing', `正在使用${account.label}发布`);
    const startedAt = Date.now();
    startGuard('publish');
    try {
      const result = await publishingAdapter.execute(account, plan, {
        onItemState: async (item, state, detail, evidence) => {
          planService.markItem(item.itemId, state, detail, evidence || null);
          if (state === 'verified' && evidence?.videoId) {
            planService.updatePublishIdentity(item.itemId, {
              videoId: evidence.videoId,
              videoUrl: evidence.videoUrl || `https://www.douyin.com/video/${evidence.videoId}`
            });
          }
          mainWindow?.webContents.send('plan:item-state', { itemId: item.itemId, state, detail });
        }
      });
      planService.updateStatus('published', `已发布${result.count}条；日志：${result.reportPath}`);
      const records = planService.exportIdRecords();
      result.records = records;
      const durationMs = Date.now() - startedAt;
      durationStore.record('publish', result.count, durationMs, planTotalBytes(plan));
      automationGuard.stop();
      focusMainWindow();
      await dialog.showMessageBox(mainWindow, {
        type: 'info', title: '批量发布完成', message: `全部${result.count}条视频已经提交`,
        detail: `实际耗时${elapsedText(durationMs)}。请前往作品管理核对发布数量和定时时间。\nID记录：${records.filePath}\nID表格：${records.csvPath}`
      });
      return result;
    } catch (error) {
      planService.updateStatus('failed', error.message);
      throw error;
    } finally {
      automationGuard.stop();
    }
  });
  ipcMain.handle('cache:clear', () => libraryStore.clearCache());
}

app.whenReady().then(() => {
  accountStore = new AccountStore(app.getPath('userData'));
  accountStore.initialize();
  configStore = new ConfigStore(app.getPath('userData'));
  configStore.initialize();
  workspaceStore = new WorkspaceStore(app.getPath('userData'));
  workspaceStore.initialize(configStore.settings().sheetUrl);
  durationStore = new DurationStore(app.getPath('userData'));
  automationGuard = new AutomationGuard();
  nativeDialogHelperPath = app.isPackaged
    ? path.join(process.resourcesPath, 'native', 'FileDialogHelper.exe')
    : path.join(__dirname, '..', 'native', 'FileDialogHelper.exe');
  rebuildWorkspaceRuntime();
  registerIpc();
  createWindow();
});

app.on('window-all-closed', async () => {
  await Promise.all([...allBrowserManagers().map((manager) => manager.close()), feishuBrowserManager.close()]);
  app.quit();
});

app.on('before-quit', () => {
  automationGuard?.stop();
  for (const manager of allBrowserManagers()) manager.close().catch(() => {});
  feishuBrowserManager.close().catch(() => {});
});
