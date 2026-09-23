const byId = (id) => document.getElementById(id);
const ui = Object.fromEntries([
  'global-status','side-workspace-label','workbench-date','accounts-main','accounts-test','settings-accounts','workspace-select','select-workspace','workspace-status','workspace-badge','workspace-platform','sheet-url','save-sheet','open-feishu','detect-feishu','close-feishu','settings-status','settings-state','runtime-ready','readiness-score','readiness-progress','readiness-badge','readiness-detail','metric-estimate-value','metric-download-count','metric-download-value','metric-download-progress','metric-download-meta','metric-publish-count','metric-publish-value','metric-publish-progress','metric-publish-meta','metric-risk','metric-next-time','metric-next-meta','commerce-panel','open-short-titles','resolve-commerce-titles','commerce-status','plan-date','plan-scheme','schedule-policy-trigger','schedule-policy-label','schedule-policy-modal','schedule-policy-list','schedule-policy-new','schedule-policy-default-note','schedule-policy-editor','schedule-policy-name','schedule-focus-start','schedule-focus-end','schedule-interval','schedule-avoid-enabled','schedule-avoid-fields','schedule-avoid-start','schedule-avoid-end','schedule-policy-preview','schedule-policy-save','schedule-policy-delete','schedule-policy-status','create-plan-current-filter','clear-cache','plan-body','plan-status','plan-summary','batch-confirm','execute-plan','batch-status','pull-estimate','publish-estimate','select-all','select-none','selection-summary','sync-ids','open-published-videos','export-ids','copy-id-table','open-id-records','view-plan-modal','edit-plan-modal','edit-plan-file','edit-plan-category','edit-plan-model','edit-plan-time','edit-plan-body','edit-plan-tags','edit-plan-choose-cover','edit-plan-cover','edit-cover-mode','edit-commerce-fields','edit-product-short-title','edit-product-link','edit-product-original-title','edit-confirm-short-title','edit-save-short-title','save-plan-item','edit-plan-status','library-workspace-badge','library-model','library-safe-name','library-workspace-targets','library-copies','library-tags','library-short-titles','library-choose-covers','library-cover-summary','library-cover-list','library-save-mode','library-save-product','library-form-status','library-refresh','library-workspace-filter','library-scheme','library-scheme-filter','library-effective-scheme','library-product-list','scheme-name','scheme-start','scheme-end','scheme-mode','scheme-source','scheme-current','scheme-save','scheme-open-folder','scheme-import-batch','scheme-check','scheme-download-template','scheme-status','scheme-inspection','package-scope','export-material-package','import-material-package','package-status','test-platform','test-platform-badge','test-id-tool','choose-video','choose-cover','video-path','cover-path','test-body','body-count','test-tags','scheduled-at','test-confirm','prepare-test','prepare-status','test-resolve-id','test-id-status','watermark-enabled','guard-seconds','save-preferences','preferences-status','close-browser','settings-close-feishu','finish-guide','open-donation','donation-modal','delete-account-modal','delete-account-description','delete-check','delete-account-name','delete-confirm-phrase','confirm-delete-account','delete-account-status'
].map((id) => [id, byId(id)]));
let workspaces = [], activeWorkspace = null, accounts = [], browserStatus = {}, settings = {}, feishuStatus = {}, libraryPaths = {}, currentPlan = null, estimates = {};
let videoPath = null, coverPath = null, busy = false, activePage = 'main';
let testPlatform = 'douyin';
let pendingDeleteAccountId = null;
let editingItemId = null;
let editingCoverPath = null;
let editingCoverMode = 'library-cover';
let libraryCoverPaths = [];
let libraryCatalog = [];
let librarySchemes = [];
let schedulePolicies = [];
let activeSchedulePolicyId = 'default';
let editingSchedulePolicyId = 'default';
let operationKind = null;
const scheduleFocusRanges = ui['schedule-focus-start'].closest('.schedule-time-grid');
const scheduleAvoidRanges = ui['schedule-avoid-start'].closest('.schedule-time-grid');
const scheduleIntervalField = ui['schedule-interval'].closest('.field');
scheduleFocusRanges.insertAdjacentElement('afterend', scheduleIntervalField);
scheduleIntervalField.classList.add('schedule-interval-field');
scheduleFocusRanges.id = 'schedule-focus-ranges';
scheduleAvoidRanges.id = 'schedule-avoid-ranges';
scheduleFocusRanges.className = 'schedule-ranges';
scheduleAvoidRanges.className = 'schedule-ranges';
const addFocusRangeButton = document.createElement('button');
addFocusRangeButton.id = 'schedule-add-focus';
addFocusRangeButton.className = 'quiet schedule-add-range';
addFocusRangeButton.textContent = '＋ 添加集中时段';
scheduleFocusRanges.insertAdjacentElement('afterend', addFocusRangeButton);
const addAvoidRangeButton = document.createElement('button');
addAvoidRangeButton.id = 'schedule-add-avoid';
addAvoidRangeButton.className = 'quiet schedule-add-range';
addAvoidRangeButton.textContent = '＋ 添加避开时段';
scheduleAvoidRanges.insertAdjacentElement('afterend', addAvoidRangeButton);

const stateLabels = {
  pending: '待发布', running: '执行中', verified: '平台已确认提交',
  failed: '失败，可续发', uncertain: '结果待人工确认', skipped: '未勾选', 'id-resolved': '已获取ID',
  'waiting-human': '等待管理员扫码'
};

function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[character]); }
function basename(value) { return String(value || '').split(/[\\/]/).pop() || '—'; }
function setStatus(message, type = '') { ui['global-status'].textContent = message; ui['global-status'].className = type; }

function showPage(name) {
  activePage = name;
  document.querySelectorAll('[data-page-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.pagePanel === name));
  document.querySelectorAll('[data-page]').forEach((button) => button.classList.toggle('active', button.dataset.page === name));
  document.querySelector('main').scrollTo?.(0, 0);
  if (name === 'library') refreshLibraryProducts().catch((error) => { ui['library-form-status'].textContent = error.message; ui['library-form-status'].className = 'error'; });
}

function safeModelName(value) {
  const normalized = String(value || '').trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '');
  return normalized.slice(0, 100);
}

function effectiveSchemeForDate(date) {
  return librarySchemes.filter((scheme) => !scheme.builtIn && scheme.enabled !== false
    && (!scheme.startDate || date >= scheme.startDate)
    && (!scheme.endDate || date <= scheme.endDate))
    .sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0)
      || String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))[0]
    || librarySchemes.find((scheme) => scheme.id === 'default');
}

function updatePlanSchemeLabel() {
  if (!ui['plan-scheme'] || !librarySchemes.length) return;
  const previous = ui['plan-scheme'].value || 'auto';
  const effective = effectiveSchemeForDate(ui['plan-date'].value || '');
  const autoOption = ui['plan-scheme'].querySelector('option[value="auto"]');
  if (autoOption) autoOption.textContent = `自动 · ${effective?.name || '常规方案'}`;
  ui['plan-scheme'].value = previous;
}

function schedulePolicySummary(policy) {
  if (!policy || policy.mode === 'default') return '按数量自动分布';
  const focusRanges = policy.focusRanges?.length ? policy.focusRanges : [{ start: policy.focusStart, end: policy.focusEnd }];
  const avoidRanges = policy.avoidRanges?.length ? policy.avoidRanges : policy.avoidStart ? [{ start: policy.avoidStart, end: policy.avoidEnd }] : [];
  const avoid = policy.avoidEnabled && avoidRanges.length ? ` · 避开${avoidRanges.length}段` : '';
  return `集中${focusRanges.length}段 · 每${policy.intervalMinutes}分钟${avoid}`;
}

function rangeRowHtml(type, range, index, count) {
  const label = type === 'focus' ? '集中' : '避开';
  return `<div class="schedule-range-row" data-schedule-range="${type}"><span>${label} ${index + 1}</span><label><span>开始</span><input type="time" step="300" data-range-start value="${escapeHtml(range.start || '')}"></label><span class="schedule-range-separator">至</span><label><span>结束</span><input type="time" step="300" data-range-end value="${escapeHtml(range.end || '')}"></label><button class="quiet schedule-remove-range" data-remove-range="${type}" aria-label="删除${label}时段" ${type === 'focus' && count === 1 ? 'disabled' : ''}>×</button></div>`;
}

function renderRangeRows(container, type, ranges) {
  const safeRanges = ranges.length ? ranges.slice(0, 8) : type === 'focus' ? [{ start: '13:00', end: '23:00' }] : [];
  container.innerHTML = safeRanges.map((range, index) => rangeRowHtml(type, range, index, safeRanges.length)).join('');
  const addButton = type === 'focus' ? addFocusRangeButton : addAvoidRangeButton;
  addButton.disabled = safeRanges.length >= 8;
}

function collectRangeRows(container) {
  return [...container.querySelectorAll('[data-schedule-range]')].map((row) => ({
    start: row.querySelector('[data-range-start]').value,
    end: row.querySelector('[data-range-end]').value
  }));
}

function setScheduleEditor(policy = null) {
  editingSchedulePolicyId = policy?.id || null;
  const custom = policy?.mode === 'custom' || !policy;
  ui['schedule-policy-default-note'].hidden = custom;
  ui['schedule-policy-editor'].hidden = !custom;
  if (!custom) return;
  ui['schedule-policy-name'].value = policy?.name || '';
  const focusRanges = policy?.focusRanges?.length ? policy.focusRanges
    : policy?.focusStart ? [{ start: policy.focusStart, end: policy.focusEnd }] : [{ start: '13:00', end: '23:00' }];
  const avoidRanges = policy?.avoidRanges?.length ? policy.avoidRanges
    : policy?.avoidStart ? [{ start: policy.avoidStart, end: policy.avoidEnd }] : [{ start: '17:00', end: '18:00' }];
  renderRangeRows(scheduleFocusRanges, 'focus', focusRanges);
  renderRangeRows(scheduleAvoidRanges, 'avoid', avoidRanges);
  ui['schedule-interval'].value = policy?.intervalMinutes || 60;
  ui['schedule-avoid-enabled'].checked = policy?.avoidEnabled === true;
  ui['schedule-avoid-fields'].hidden = !ui['schedule-avoid-enabled'].checked;
  scheduleAvoidRanges.hidden = !ui['schedule-avoid-enabled'].checked;
  addAvoidRangeButton.hidden = !ui['schedule-avoid-enabled'].checked;
  ui['schedule-policy-delete'].hidden = !policy;
  updateSchedulePreview();
}

function renderSchedulePolicies() {
  const active = schedulePolicies.find((policy) => policy.id === activeSchedulePolicyId) || schedulePolicies[0];
  ui['schedule-policy-label'].textContent = active?.name || '默认排期';
  ui['schedule-policy-list'].innerHTML = schedulePolicies.map((policy) => `<button class="schedule-policy-option ${policy.id === activeSchedulePolicyId ? 'active' : ''}" data-schedule-policy="${escapeHtml(policy.id)}"><strong>${escapeHtml(policy.name)}</strong><span>${escapeHtml(schedulePolicySummary(policy))}</span></button>`).join('');
}

function updateSchedulePreview() {
  if (ui['schedule-policy-editor'].hidden) return;
  const toMinutes = (value) => {
    const match = String(value || '').match(/^(\d{2}):(\d{2})$/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
  };
  const interval = Number(ui['schedule-interval'].value);
  const focusRanges = collectRangeRows(scheduleFocusRanges).map((range) => ({ start: toMinutes(range.start), end: toMinutes(range.end) }));
  const avoidRanges = ui['schedule-avoid-enabled'].checked
    ? collectRangeRows(scheduleAvoidRanges).map((range) => ({ start: toMinutes(range.start), end: toMinutes(range.end) })) : [];
  const invalidRange = [...focusRanges, ...avoidRanges].some((range) => !Number.isFinite(range.start) || !Number.isFinite(range.end) || range.start >= range.end);
  if (!focusRanges.length || invalidRange || !Number.isInteger(interval) || interval < 10 || interval > 180 || interval % 5) {
    ui['schedule-policy-preview'].textContent = '请填写有效时段；间隔需为10–180分钟之间的5分钟整数倍。';
    return;
  }
  const lane = activeWorkspace?.mode === 'commerce' ? 5 : 0;
  const slotMinutes = new Set();
  for (const range of focusRanges) {
    let first = range.start;
    if (first % 10 !== lane) first += (lane - first % 10 + 10) % 10;
    for (let minute = first; minute <= range.end; minute += interval) {
      if (avoidRanges.some((avoid) => minute >= avoid.start && minute < avoid.end)) continue;
      slotMinutes.add(minute);
    }
  }
  const slots = [...slotMinutes].sort((left, right) => left - right).map((minute) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`);
  ui['schedule-policy-preview'].textContent = slots.length
    ? `当前工作区预计可排 ${slots.length} 条：${slots.slice(0, 6).join('、')}${slots.length > 6 ? `…共${slots.length}个时刻` : ''}。生成后仍可逐条编辑。`
    : '当前条件没有可用发布时间，请调整集中或避开时段。';
}

function renderLibraryControls() {
  if (!ui['library-workspace-targets']) return;
  const selectedTargets = new Set([...ui['library-workspace-targets'].querySelectorAll('input:checked')].map((input) => input.value));
  if (!selectedTargets.size && activeWorkspace) selectedTargets.add(activeWorkspace.id);
  ui['library-workspace-targets'].innerHTML = workspaces.map((workspace) => `<label><input type="checkbox" value="${escapeHtml(workspace.id)}" ${selectedTargets.has(workspace.id) ? 'checked' : ''}>${escapeHtml(workspace.name)}</label>`).join('');
  const filterValue = ui['library-workspace-filter'].value || activeWorkspace?.id || '';
  ui['library-workspace-filter'].innerHTML = workspaces.map((workspace) => `<option value="${escapeHtml(workspace.id)}" ${workspace.id === filterValue ? 'selected' : ''}>${escapeHtml(workspace.name)}</option>`).join('');
  ui['library-workspace-badge'].textContent = activeWorkspace?.name || '\u5f53\u524d\u5de5\u4f5c\u533a';
  ui['library-cover-summary'].textContent = libraryCoverPaths.length ? `\u5df2\u9009\u62e9 ${libraryCoverPaths.length} \u5f20` : '\u5c1a\u672a\u9009\u62e9';
  ui['library-cover-list'].innerHTML = libraryCoverPaths.map((filePath) => `<span class="file-chip" title="${escapeHtml(filePath)}">${escapeHtml(basename(filePath))}</span>`).join('');
  const schemeOptions = librarySchemes.map((scheme) => `<option value="${escapeHtml(scheme.id)}">${escapeHtml(scheme.name)}${scheme.code && !scheme.builtIn ? ` · ${escapeHtml(scheme.code)}` : ''}</option>`).join('');
  const currentInputScheme = ui['library-scheme'].value || 'default';
  const currentFilterScheme = ui['library-scheme-filter'].value || 'default';
  const currentManagedScheme = ui['scheme-current'].value || currentFilterScheme;
  ui['library-scheme'].innerHTML = schemeOptions;
  ui['library-scheme-filter'].innerHTML = schemeOptions;
  ui['scheme-current'].innerHTML = schemeOptions;
  ui['scheme-source'].innerHTML = schemeOptions;
  if (librarySchemes.some((scheme) => scheme.id === currentInputScheme)) ui['library-scheme'].value = currentInputScheme;
  if (librarySchemes.some((scheme) => scheme.id === currentFilterScheme)) ui['library-scheme-filter'].value = currentFilterScheme;
  if (librarySchemes.some((scheme) => scheme.id === currentManagedScheme)) ui['scheme-current'].value = currentManagedScheme;
  const planSchemeValue = ui['plan-scheme'].value || 'auto';
  ui['plan-scheme'].innerHTML = `<option value="auto">自动匹配</option>${schemeOptions}`;
  if (planSchemeValue === 'auto' || librarySchemes.some((scheme) => scheme.id === planSchemeValue)) ui['plan-scheme'].value = planSchemeValue;
  updatePlanSchemeLabel();
  ui['library-choose-covers'].disabled = ui['library-scheme'].value !== 'default';
  if (ui['library-scheme'].value !== 'default') ui['library-cover-summary'].textContent = '活动方案沿用常规封面';
}

function renderLibraryCatalog() {
  if (!libraryCatalog.length) {
    ui['library-product-list'].innerHTML = '<p class="panel-note">\u5f53\u524d\u5de5\u4f5c\u533a\u8fd8\u6ca1\u6709\u4ea7\u54c1\u7d20\u6750\u3002</p>';
    return;
  }
  const workspace = workspaces.find((item) => item.id === ui['library-workspace-filter'].value);
  ui['library-product-list'].innerHTML = libraryCatalog.map((item) => {
    const missing = [];
    if (!item.copyCount) missing.push('\u6587\u6848');
    if (!item.tagGroupCount) missing.push('Tag');
    if (!item.coverCount && workspace?.mode !== 'commerce') missing.push('\u5c01\u9762');
    if (!item.shortTitleCount && workspace?.mode === 'commerce') missing.push('\u5546\u54c1\u77ed\u6807\u9898');
    const firstFrame = !item.coverCount && workspace?.mode === 'commerce';
    const state = missing.length ? `\u7f3a${missing.join('\u3001')}` : item.inherited ? '继承常规' : firstFrame ? '\u9996\u5e27\u5c01\u9762' : item.overridden ? '活动覆盖' : '\u5b8c\u6574';
    const badgeClass = missing.length ? 'danger-badge' : firstFrame ? 'warning' : 'success';
    return `<article class="library-product-card"><div class="library-product-head"><strong>${escapeHtml(item.model)}</strong><span class="badge ${badgeClass}">${escapeHtml(state)}</span></div><div class="library-counts"><span>\u6587\u6848 ${item.copyCount}</span><span>Tag ${item.tagGroupCount}</span><span>\u5c01\u9762 ${item.coverCount}</span><span>\u77ed\u6807\u9898 ${item.shortTitleCount}</span></div></article>`;
  }).join('');
}

async function refreshLibraryProducts() {
  const workspaceId = ui['library-workspace-filter']?.value || activeWorkspace?.id;
  if (!workspaceId) return;
  const result = await window.publisher.listLibraryProducts(workspaceId, ui['library-scheme-filter']?.value || 'default');
  libraryCatalog = result.items || [];
  if (result.schemes?.length) librarySchemes = result.schemes;
  renderLibraryControls();
  renderLibraryCatalog();
}

function detectionHtml(account) {
  const detected = account.lastDetected;
  if (!detected) return '<span>尚未检测。首次使用需要扫码登录。</span>';
  if (detected.state === 'logged-in') return `<strong>${escapeHtml(detected.nickname || '已登录账号')}</strong><br>账号标识：${escapeHtml(detected.douyinId || '未识别')}<br><small>上次检测：${new Date(detected.checkedAt).toLocaleString()}</small>`;
  return `<span>${escapeHtml(detected.message)}</span>`;
}

function accountCard(account) {
  const active = browserStatus.activeAccountId === account.id;
  const otherActive = browserStatus.open && !active;
  const role = account.surface === 'shop' ? '抖店商品账号' : account.role === 'production' ? '正式发布账号' : '测试账号';
  const detected = account.lastDetected;
  const status = detected?.state === 'logged-in'
    ? `已检测：${detected.nickname || account.label} · 账号 ${detected.douyinId || '未识别'}`
    : detected?.message || '尚未检测，首次使用需要扫码登录';
  const avatar = account.surface === 'shop' ? '店' : account.platform === 'wechat-channels' ? '视' : '抖';
  return `<article class="runtime-row ${active ? 'active' : ''}"><span class="runtime-avatar">${avatar}</span><div class="runtime-copy"><strong>${escapeHtml(account.label)} · ${escapeHtml(role)}</strong><small>${escapeHtml(status)}</small></div><div class="runtime-actions"><span class="badge ${detected?.state === 'logged-in' ? 'success' : ''}">${detected?.state === 'logged-in' ? '账号有效' : '待检测'}</span><button class="quiet" data-account-action="open" data-id="${account.id}" ${busy || otherActive ? 'disabled' : ''}>${active ? '切回 Chrome' : '打开 Chrome'}</button><button class="secondary" data-account-action="detect" data-id="${account.id}" ${busy || !active ? 'disabled' : ''}>检测账号</button></div></article>`;
}

function activeWorkspaceAccounts() {
  if (!activeWorkspace) return [];
  const ids = new Set([activeWorkspace.publisherAccountId, activeWorkspace.commerceAccountId].filter(Boolean));
  return accounts.filter((account) => ids.has(account.id));
}

function accountSettingsCard(account) {
  const active = browserStatus.activeAccountId === account.id;
  const detectedId = account.lastDetected?.douyinId || '尚未检测';
  return `<article class="account-settings-card"><div class="card-head"><div><strong>${escapeHtml(account.label)}</strong><div class="panel-note">${account.role === 'production' ? '发布账号' : '测试账号'} · 抖音号：${escapeHtml(detectedId)}</div></div><span class="role ${account.role}">${account.role === 'production' ? '正式' : '测试'}</span></div><label class="field"><span>软件内显示昵称</span><input data-account-label="${account.id}" value="${escapeHtml(account.label)}" maxlength="24"></label><div class="actions"><button data-settings-account-action="rename" data-id="${account.id}" ${busy ? 'disabled' : ''}>修改昵称</button><button class="secondary" data-settings-account-action="detect" data-id="${account.id}" ${busy || !active ? 'disabled' : ''}>核对信息</button><button class="secondary" data-settings-account-action="folder" data-id="${account.id}" ${busy ? 'disabled' : ''}>打开本地文件夹</button><button class="danger" data-settings-account-action="delete" data-id="${account.id}" ${busy || active ? 'disabled' : ''}>删除账号</button></div>${active ? '<p class="panel-note">删除前请先关闭这个账号的 Chrome。</p>' : ''}</article>`;
}

function renderSettingsAccounts() {
  ui['settings-accounts'].innerHTML = accounts.map(accountSettingsCard).join('');
}

function closeModal(id) {
  const modal = ui[id] || byId(id);
  if (modal) modal.hidden = true;
  if (id === 'delete-account-modal') pendingDeleteAccountId = null;
}

function openDeleteAccountModal(accountId) {
  const account = accounts.find((item) => item.id === accountId);
  if (!account) return;
  pendingDeleteAccountId = accountId;
  ui['delete-account-description'].textContent = `目标：${account.label}（${account.role === 'production' ? '发布账号' : '测试账号'}）。将删除本地 Chrome 登录资料并清除检测信息，账号角色会保留。`;
  ui['delete-check'].checked = false;
  ui['delete-account-name'].value = '';
  ui['delete-confirm-phrase'].value = '';
  ui['delete-account-status'].textContent = '';
  ui['delete-account-modal'].hidden = false;
  updateDeleteConfirmation();
}

function updateDeleteConfirmation() {
  const account = accounts.find((item) => item.id === pendingDeleteAccountId);
  const verified = Boolean(account)
    && ui['delete-check'].checked
    && ui['delete-account-name'].value.trim() === account.label
    && ui['delete-confirm-phrase'].value.trim() === '删除账号';
  ui['confirm-delete-account'].disabled = !verified || busy;
}

function renderPlan() {
  if (currentPlan?.invalid) {
    ui['plan-body'].innerHTML = '<tr class="problem-row"><td colspan="7">当前计划缓存文件损坏，已忽略；账号和登录资料没有丢失</td></tr>';
    ui['plan-summary'].textContent = '计划不可用';
    ui['plan-status'].textContent = `${currentPlan.statusDetail}；${(currentPlan.warnings || []).join('；')}`;
    ui['plan-status'].className = 'panel-note error';
    return;
  }
  if (!currentPlan?.items?.length) {
    ui['plan-body'].innerHTML = '<tr><td colspan="7">等待生成计划</td></tr>';
    ui['plan-summary'].textContent = '';
    ui['selection-summary'].textContent = '';
    return;
  }
  const selected = currentPlan.items.filter((item) => item.selected && ['pending','failed','skipped'].includes(item.execution?.state || 'pending'));
  const completed = currentPlan.items.filter((item) => ['verified','id-resolved'].includes(item.execution?.state)).length;
  const uncertain = currentPlan.items.filter((item) => item.execution?.state === 'uncertain').length;
  const firstFrameCount = selected.filter((item) => item.coverMode === 'video-first-frame').length;
  ui['plan-summary'].textContent = `${currentPlan.date} · ${currentPlan.items.length}条 · ${completed}条已完成 · ${currentPlan.schedulePolicy?.name || '默认排期'} · 内容方案：${currentPlan.contentScheme?.name || '常规方案'}`;
  ui['selection-summary'].textContent = `本次将执行 ${selected.length} 条${firstFrameCount ? `；${firstFrameCount}条使用视频首帧` : ''}${uncertain ? `；${uncertain}条待人工确认` : ''}`;
  ui['plan-body'].innerHTML = currentPlan.items.map((item) => {
    const state = item.execution?.state || 'pending';
    const locked = ['verified','id-resolved','running','uncertain'].includes(state);
    const warningText = (item.warnings || []).join('；');
    const statusText = !item.ready ? item.problems.join('；') : warningText || (stateLabels[state] || state);
    const uncertainActions = state === 'uncertain'
      ? `<button class="mini" data-plan-confirm="published" data-item-id="${item.itemId}">确认已发布</button><button class="mini secondary" data-plan-confirm="missing" data-item-id="${item.itemId}">确认未发布</button>` : '';
    const fileName = item.originalMaterialName || basename(item.videoPath);
    const sourceRow = item.sourceActualRow || '待重新拉取';
    const scheduled = item.scheduledLocal ? item.scheduledLocal.replace(' ', ' · ') : '—';
    const executionText = stateLabels[state] || state;
    const rowClass = !item.ready ? 'problem-row' : warningText ? 'warning-row' : '';
    const checkLabel = !item.ready ? statusText : warningText ? '可发布 · 使用首帧' : '完整';
    return `<tr class="${rowClass}"><td><input type="checkbox" data-plan-select="${item.itemId}" ${item.selected ? 'checked' : ''} ${locked ? 'disabled' : ''}></td><td title="${escapeHtml(item.videoPath)}"><strong class="item-title">${escapeHtml(fileName)}</strong><small class="item-sub">飞书第 ${escapeHtml(sourceRow)} 行 · 序号 ${escapeHtml(item.sequence)}</small></td><td><strong class="item-title">${escapeHtml(item.category || '—')}</strong><small class="item-sub">${escapeHtml(item.model || '—')}</small></td><td>${escapeHtml(scheduled)}</td><td><span class="check-status" title="${escapeHtml(statusText)}">${escapeHtml(checkLabel)}</span></td><td title="${escapeHtml(item.execution?.detail || '')}"><strong class="item-title ${['failed','uncertain'].includes(state) ? 'error' : ''}">${escapeHtml(executionText)}</strong><small class="item-sub">${escapeHtml(item.publish?.videoId ? `ID ${item.publish.videoId}` : item.aiGenerated ? '内容由 AI 生成' : '无需 AI 声明')}</small></td><td><div class="table-actions"><button class="mini quiet" data-plan-view="${item.itemId}">查看</button><button class="mini quiet" data-plan-edit="${item.itemId}" ${locked ? 'disabled' : ''}>编辑</button>${uncertainActions}</div></td></tr>`;
  }).join('');
  const warnings = currentPlan.warnings?.length ? `；${currentPlan.warnings.join('；')}` : '';
  ui['plan-status'].textContent = `计划状态：${currentPlan.status}${currentPlan.statusDetail ? `；${currentPlan.statusDetail}` : ''}${warnings}`;
  const itemWarnings = currentPlan.items.some((item) => item.ready && (item.warnings || []).length);
  ui['plan-status'].className = currentPlan.items.some((item) => !item.ready) ? 'panel-note error' : itemWarnings ? 'panel-note' : 'panel-note success';
}

function nextScheduleInfo(items) {
  return window.PublisherTime.nextScheduleInfo(items);
}

function setProgress(element, ratio, indeterminate = false) {
  element.classList.toggle('indeterminate', indeterminate);
  element.style.setProperty('--progress', String(Math.max(0, Math.min(1, ratio || 0))));
}

function renderMetrics() {
  const items = currentPlan?.items || [];
  const estimate = items.length ? estimates.publish : estimates.pull;
  const range = String(estimate || '').match(/(\d+)\s*[–~-]\s*(\d+)\s*分钟/);
  ui['metric-estimate-value'].textContent = range ? `${range[1]}–${range[2]} 分钟` : items.length ? '计算中' : '待生成';
  ui['pull-estimate'].textContent = estimate || '生成计划后根据本机记录估算';

  if (operationKind === 'pull') {
    ui['metric-download-count'].textContent = '处理中';
    ui['metric-download-value'].textContent = '正在拉取';
    ui['metric-download-meta'].textContent = '正在读取飞书并建立附件下载任务';
    setProgress(ui['metric-download-progress'], 0, true);
  } else {
    const downloaded = items.filter((item) => item.videoPath).length;
    ui['metric-download-count'].textContent = `${downloaded} / ${items.length}`;
    ui['metric-download-value'].textContent = items.length ? `${Math.round(downloaded / items.length * 100)}%` : '待拉取';
    ui['metric-download-meta'].textContent = items.length ? '计划素材已完成落盘与校验' : '生成计划后显示准确进度';
    setProgress(ui['metric-download-progress'], items.length ? downloaded / items.length : 0);
  }

  const publishable = items.filter((item) => item.ready);
  const completed = publishable.filter((item) => ['verified','id-resolved'].includes(item.execution?.state)).length;
  const running = publishable.find((item) => item.execution?.state === 'running');
  ui['metric-publish-count'].textContent = `${completed} / ${publishable.length}`;
  ui['metric-publish-value'].textContent = running ? '执行中' : completed && completed === publishable.length ? '已完成' : '待开始';
  ui['metric-publish-meta'].textContent = running ? `当前：${running.originalMaterialName || basename(running.videoPath)}` : publishable.length ? '执行后显示当前视频与完成数量' : '等待可发布计划';
  setProgress(ui['metric-publish-progress'], publishable.length ? completed / publishable.length : 0);

  const problemItems = items.filter((item) => !item.ready);
  const warningItems = items.filter((item) => item.ready && (item.warnings || []).length);
  const uncertain = items.filter((item) => item.execution?.state === 'uncertain').length;
  const ready = items.length - problemItems.length;
  ui['readiness-score'].textContent = `${ready} / ${items.length}`;
  setProgress(ui['readiness-progress'], items.length ? ready / items.length : 0);
  ui['readiness-badge'].textContent = !items.length ? '等待计划' : problemItems.length ? `${problemItems.length} 项待处理` : warningItems.length ? `${warningItems.length} 条使用首帧` : '全部通过';
  ui['readiness-badge'].className = `badge ${problemItems.length ? 'danger-badge' : warningItems.length ? 'warning' : 'success'}`;
  ui['readiness-detail'].textContent = problemItems.length ? (problemItems[0].problems || []).join('；') : warningItems.length ? `${ready} / ${items.length} 可发布；其中${warningItems.length}条商城视频将使用首帧。` : items.length ? '素材、内容与商品配置检查均已通过。' : '生成计划后汇总素材、内容和商品配置问题。';
  ui['metric-risk'].textContent = !items.length ? '等待计划' : problemItems.length || uncertain ? `${problemItems.length + uncertain} 项待处理` : warningItems.length ? `${warningItems.length} 条首帧` : '无异常';
  ui['metric-risk'].className = `metric-state ${problemItems.length || uncertain || warningItems.length ? 'warning' : 'success'}`;
  const next = nextScheduleInfo(items);
  ui['metric-next-time'].textContent = next.label;
  ui['metric-next-meta'].textContent = next.detail;
}

function openPlanEditor(itemId) {
  const item = currentPlan?.items?.find((candidate) => candidate.itemId === itemId);
  if (!item) return;
  editingItemId = itemId;
  editingCoverPath = item.coverPath || '';
  editingCoverMode = item.coverMode || (item.coverPath ? 'library-cover' : 'video-first-frame');
  ui['edit-plan-file'].textContent = `视频文件（不可修改）：${item.originalMaterialName || basename(item.videoPath)}`;
  ui['edit-plan-category'].value = item.category || '';
  ui['edit-plan-model'].value = item.model || '';
  ui['edit-plan-time'].value = String(item.scheduledLocal || '').replace(' ', 'T');
  ui['edit-plan-body'].value = item.body || '';
  ui['edit-plan-tags'].value = (item.tags || []).join('\n');
  ui['edit-plan-cover'].textContent = editingCoverPath || '尚未选择';
  ui['edit-commerce-fields'].hidden = !item.commerce?.required;
  ui['edit-cover-mode'].hidden = !item.commerce?.required;
  const coverRadio = document.querySelector(`input[name="edit-cover-mode"][value="${editingCoverMode === 'video-first-frame' ? 'video-first-frame' : 'manual-cover'}"]`);
  if (coverRadio) coverRadio.checked = true;
  ui['edit-plan-choose-cover'].disabled = item.commerce?.required && editingCoverMode === 'video-first-frame';
  ui['edit-product-short-title'].value = item.commerce?.productShortTitle || '';
  ui['edit-product-link'].value = item.commerce?.productUrl || '';
  ui['edit-product-original-title'].textContent = item.commerce?.productOriginalTitle ? `平台商品原始标题：${item.commerce.productOriginalTitle}` : '尚未读取平台商品原始标题。';
  ui['edit-confirm-short-title'].checked = Boolean(item.commerce?.shortTitleConfirmed);
  ui['edit-save-short-title'].checked = false;
  ui['edit-plan-status'].textContent = '';
  ui['edit-plan-modal'].hidden = false;
}

function openPlanViewer(itemId) {
  const item = currentPlan?.items?.find((candidate) => candidate.itemId === itemId);
  if (!item) return;
  const state = item.execution?.state || 'pending';
  const statusText = !item.ready ? (item.problems || []).join('；') : (item.warnings || []).join('；') || (stateLabels[state] || state);
  const commerce = item.commerce?.required
    ? [
        `商品链接：${item.commerce.productUrl || '缺失'}`,
        `商品短标题：${item.commerce.productShortTitle || '缺失'}`,
        `标题来源：${item.commerce.shortTitleSource === 'library' ? '本地库' : item.commerce.shortTitleConfirmed ? '人工确认' : '待人工确认'}`,
        item.commerce.productOriginalTitle ? `平台原始标题：${item.commerce.productOriginalTitle}` : ''
      ].filter(Boolean).join('\n')
    : '当前计划项不挂车';
  const fields = [
    ['序号 / 飞书实际行', `${item.sequence || '—'} / ${item.sourceActualRow || '待重新拉取'}`],
    ['产品匹配', `${item.category || '—'} / ${item.model || '—'}`],
    ['视频文件', item.videoPath || item.originalMaterialName || '—', true],
    ['发布时间', item.scheduledLocal || '—'],
    ['AI 声明', item.aiGenerated ? '内容由 AI 生成' : '无需声明'],
    ['封面策略', item.coverMode === 'video-first-frame' ? '视频首帧（商城默认，不上传本地封面）' : item.coverMode === 'manual-cover' ? '人工选择的本地封面' : '素材库封面', true],
    ['封面文件', item.coverPath || '不上传本地封面', true],
    ['可发布提醒', (item.warnings || []).join('；') || '—', true],
    ['文案', item.body || '—', true],
    ['Tag', (item.tags || []).join('、') || '—', true],
    ['商品配置', commerce, true],
    ['执行状态', `${statusText}${item.execution?.detail ? `\n${item.execution.detail}` : ''}`, true],
    ['发布 ID', item.publish?.videoId || '待获取'],
    ['视频链接', item.publish?.videoUrl || (item.publish?.videoId ? `https://www.douyin.com/video/${item.publish.videoId}` : '待同步'), true]
  ];
  const content = document.getElementById('view-plan-content');
  content.innerHTML = fields.map(([label, value, wide]) => `<dl class="plan-view-item${wide ? ' wide' : ''}"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></dl>`).join('');
  document.getElementById('view-plan-modal').hidden = false;
}

function render() {
  const workspaceAccounts = activeWorkspaceAccounts();
  ui['accounts-main'].innerHTML = workspaceAccounts.map(accountCard).join('');
  ui['accounts-test'].innerHTML = accounts.filter((item) => item.role === 'test' && item.platform === testPlatform).map(accountCard).join('');
  const production = accounts.find((item) => item.id === activeWorkspace?.publisherAccountId);
  const test = accounts.find((item) => item.role === 'test' && item.platform === testPlatform);
  const executable = currentPlan?.items?.filter((item) => item.selected
    && item.ready && ['pending','failed','skipped'].includes(item.execution?.state || 'pending')) || [];
  const planReady = executable.length > 0 && currentPlan?.items?.every((item) => !item.selected || item.ready);
  ui['execute-plan'].disabled = busy || !planReady || browserStatus.activeAccountId !== production?.id || production?.lastDetected?.state !== 'logged-in';
  ui['prepare-test'].disabled = busy || browserStatus.activeAccountId !== test?.id || test?.lastDetected?.state !== 'logged-in';
  ui['test-resolve-id'].disabled = busy || browserStatus.activeAccountId !== test?.id || test?.lastDetected?.state !== 'logged-in';
  ui['test-id-tool'].hidden = testPlatform === 'wechat-channels';
  ui['test-platform-badge'].textContent = testPlatform === 'wechat-channels' ? '视频号测试' : '抖音测试';
  ui['create-plan-current-filter'].disabled = busy || !feishuStatus.loggedIn;
  ui['resolve-commerce-titles'].disabled = busy || activeWorkspace?.mode !== 'commerce' || !currentPlan?.items?.length
    || browserStatus.activeAccountId !== production?.id || production?.lastDetected?.state !== 'logged-in';
  for (const id of ['save-sheet','open-feishu','clear-cache']) ui[id].disabled = busy;
  ui['save-preferences'].disabled = true;
  ui['watermark-enabled'].disabled = true;
  ui['guard-seconds'].disabled = true;
  ui['detect-feishu'].disabled = busy || !feishuStatus.open;
  ui['close-feishu'].disabled = busy || !feishuStatus.open;
  ui['close-browser'].disabled = busy || !browserStatus.open;
  ui['settings-close-feishu'].disabled = busy || !feishuStatus.open;
  for (const id of ['select-all','select-none','sync-ids','export-ids','copy-id-table','open-id-records']) ui[id].disabled = busy || !currentPlan?.items?.length;
  const submittedItems = currentPlan?.items?.filter((item) => ['verified','id-resolved'].includes(item.execution?.state) || item.publish?.idState === 'resolved') || [];
  const linkedUrls = new Set(submittedItems.map((item) => {
    const videoId = String(item.publish?.videoId || '').trim();
    if (/^\d{10,}$/.test(videoId)) return `https://www.douyin.com/video/${videoId}`;
    return String(item.publish?.videoUrl || '').match(/^https:\/\/(?:www\.)?douyin\.com\/video\/\d+(?:[/?#]|$)/i)?.[0] || '';
  }).filter(Boolean));
  ui['open-published-videos'].textContent = linkedUrls.size ? `检查本批次视频 ${linkedUrls.size}/${submittedItems.length}` : '检查本批次视频';
  ui['open-published-videos'].disabled = busy || !linkedUrls.size || activeWorkspace?.platform === 'wechat-channels'
    || browserStatus.activeAccountId !== production?.id || production?.lastDetected?.state !== 'logged-in';
  ui['pull-estimate'].textContent = estimates.pull || '预计约6–13分钟（按8–20条）';
  ui['publish-estimate'].textContent = estimates.publish || '完成计划后显示';
  ui['workspace-select'].innerHTML = workspaces.map((workspace) => `<option value="${escapeHtml(workspace.id)}" ${workspace.id === activeWorkspace?.id ? 'selected' : ''}>${escapeHtml(workspace.name)}</option>`).join('');
  ui['workspace-badge'].textContent = activeWorkspace?.name || '未选择工作区';
  ui['workspace-platform'].textContent = activeWorkspace?.platform === 'wechat-channels' ? '微信视频号' : activeWorkspace?.mode === 'commerce' ? '抖音 · 商城' : '抖音';
  ui['side-workspace-label'].textContent = activeWorkspace ? `当前工作区：${activeWorkspace.name}` : '正在读取工作区';
  ui['workbench-date'].textContent = `${new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date())} · 正式发布`;
  const environmentsReady = workspaceAccounts.every((account) => account.lastDetected?.state === 'logged-in') && feishuStatus.loggedIn;
  ui['runtime-ready'].textContent = environmentsReady ? `${workspaceAccounts.length + 1} / ${workspaceAccounts.length + 1} 就绪` : '存在待检测环境';
  ui['runtime-ready'].className = `badge ${environmentsReady ? 'success' : 'danger-badge'}`;
  ui['commerce-panel'].hidden = activeWorkspace?.mode !== 'commerce';
  ui['open-short-titles'].hidden = activeWorkspace?.mode !== 'commerce';
  ui['sync-ids'].hidden = activeWorkspace?.platform === 'wechat-channels';
  ui['open-published-videos'].hidden = activeWorkspace?.platform === 'wechat-channels';
  renderLibraryControls();
  renderSchedulePolicies();
  renderSettingsAccounts();
  renderPlan();
  renderMetrics();
}

async function refresh() {
  const results = await Promise.allSettled([
    window.publisher.listWorkspaces(), window.publisher.listAccounts(), window.publisher.getBrowserStatus(), window.publisher.getSettings(), window.publisher.getFeishuBrowserStatus(), window.publisher.getLibraryPaths(), window.publisher.getCurrentPlan(), window.publisher.getDurationEstimates(), window.publisher.listLibrarySchemes(), window.publisher.listSchedulePolicies()
  ]);
  if (results[0].status === 'rejected') throw results[0].reason;
  workspaces = results[0].value.items;
  activeWorkspace = results[0].value.active;
  if (results[1].status === 'rejected') throw results[1].reason;
  accounts = results[1].value;
  browserStatus = results[2].status === 'fulfilled' ? results[2].value : { open: false, activeAccountId: null };
  settings = results[3].status === 'fulfilled' ? results[3].value : settings;
  feishuStatus = results[4].status === 'fulfilled' ? results[4].value : { open: false, loggedIn: false };
  libraryPaths = results[5].status === 'fulfilled' ? results[5].value : libraryPaths;
  currentPlan = results[6].status === 'fulfilled' ? results[6].value : { invalid: true, status: 'invalid', statusDetail: results[6].reason?.message || '当前计划读取失败', items: [] };
  estimates = results[7].status === 'fulfilled' ? results[7].value : estimates;
  if (results[8].status === 'fulfilled') {
    librarySchemes = results[8].value.items || [];
    ui['library-effective-scheme'].textContent = `当前：${results[8].value.effective?.name || '常规方案'}`;
  }
  if (results[9].status === 'fulfilled') {
    schedulePolicies = results[9].value.items || [];
    activeSchedulePolicyId = results[9].value.activeId || 'default';
  }
  const nonAccountErrors = results.slice(1).filter((result) => result.status === 'rejected');
  if (nonAccountErrors.length) setStatus(`账号模块已正常加载；另有${nonAccountErrors.length}个模块初始化失败，请查看对应区域。`, 'error');
  ui['sheet-url'].value = activeWorkspace?.sheetUrl || '';
  ui['watermark-enabled'].checked = settings.watermarkEnabled !== false;
  ui['guard-seconds'].value = settings.guardSeconds || 2;
  ui['settings-state'].textContent = feishuStatus.loggedIn ? '飞书已登录' : feishuStatus.open ? '等待登录检测' : '飞书未打开';
  render();
}

async function run(action, successMessage, target = null, kind = null) {
  busy = true; operationKind = kind; render(); setStatus('正在处理，请稍候…');
  try { await action(); await refresh(); setStatus(successMessage, 'success'); }
  catch (error) { const message = error.message || String(error); setStatus(message, 'error'); if (target) { target.textContent = message; target.className = 'error'; } }
  finally { busy = false; operationKind = null; render(); }
}

document.addEventListener('click', (event) => {
  const pageButton = event.target.closest('[data-page]');
  if (pageButton) showPage(pageButton.dataset.page);
  const accountButton = event.target.closest('[data-account-action]');
  if (accountButton) {
    const accountId = accountButton.dataset.id;
    if (accountButton.dataset.accountAction === 'open') run(() => window.publisher.openBrowser(accountId), 'Chrome 已打开。登录后请返回客户端检测账号。');
    else run(() => window.publisher.detectAccount(accountId), '账号检测完成，请人工核对显示的账号。');
  }
  const settingsAccountButton = event.target.closest('[data-settings-account-action]');
  if (settingsAccountButton) {
    const accountId = settingsAccountButton.dataset.id;
    const action = settingsAccountButton.dataset.settingsAccountAction;
    if (action === 'rename') {
      const input = document.querySelector(`[data-account-label="${accountId}"]`);
      run(() => window.publisher.renameAccount(accountId, input?.value || ''), '账号昵称已修改。');
    } else if (action === 'detect') {
      run(() => window.publisher.detectAccount(accountId), '账号信息核对完成。');
    } else if (action === 'folder') {
      run(() => window.publisher.openAccountFolder(accountId), '账号本地文件夹已打开。');
    } else if (action === 'delete') {
      openDeleteAccountModal(accountId);
    }
  }
  const libraryButton = event.target.closest('[data-library]');
  if (libraryButton) window.publisher.openLibrary(libraryButton.dataset.library).then(() => setStatus(`已打开目录：${libraryPaths[libraryButton.dataset.library] || ''}`, 'success')).catch((error) => setStatus(error.message, 'error'));
  const editButton = event.target.closest('[data-plan-edit]');
  if (editButton) openPlanEditor(editButton.dataset.planEdit);
  const viewButton = event.target.closest('[data-plan-view]');
  if (viewButton) openPlanViewer(viewButton.dataset.planView);
  const confirmButton = event.target.closest('[data-plan-confirm]');
  if (confirmButton) {
    const published = confirmButton.dataset.planConfirm === 'published';
    const message = published ? '确认你已在作品管理中找到该视频？确认后不会重复发布。' : '确认作品管理中没有该视频？确认后将允许重新发布。';
    if (confirm(message)) run(() => window.publisher.confirmUncertain(confirmButton.dataset.itemId, published), '人工确认结果已保存。');
  }
});

document.addEventListener('change', (event) => {
  const checkbox = event.target.closest('[data-plan-select]');
  if (checkbox) run(() => window.publisher.setPlanSelection([checkbox.dataset.planSelect], checkbox.checked), '本次发布选择已更新。');
});

document.addEventListener('click', (event) => {
  const closeButton = event.target.closest('[data-close-modal]');
  if (closeButton) closeModal(closeButton.dataset.closeModal);
});

for (const control of [ui['delete-check'], ui['delete-account-name'], ui['delete-confirm-phrase']]) {
  control.addEventListener('input', updateDeleteConfirmation);
  control.addEventListener('change', updateDeleteConfirmation);
}

ui['open-donation'].addEventListener('click', () => { ui['donation-modal'].hidden = false; });
ui['library-model'].addEventListener('input', () => {
  const safeName = safeModelName(ui['library-model'].value);
  ui['library-safe-name'].textContent = safeName ? `\u672c\u5730\u6587\u4ef6\u540d\uff1a${safeName}` : '\u7528\u4e8e\u751f\u6210\u672c\u5730\u6587\u4ef6\u540d';
});
ui['library-choose-covers'].addEventListener('click', async () => {
  try {
    libraryCoverPaths = await window.publisher.chooseLibraryCovers();
    renderLibraryControls();
  } catch (error) {
    ui['library-form-status'].textContent = error.message;
    ui['library-form-status'].className = 'error';
  }
});
ui['library-scheme'].addEventListener('change', () => {
  const activityScheme = ui['library-scheme'].value !== 'default';
  ui['library-choose-covers'].disabled = activityScheme;
  if (activityScheme) {
    libraryCoverPaths = [];
    ui['library-cover-summary'].textContent = '活动方案沿用常规封面';
    ui['library-cover-list'].innerHTML = '';
  } else renderLibraryControls();
});
ui['library-workspace-filter'].addEventListener('change', () => refreshLibraryProducts().catch((error) => setStatus(error.message, 'error')));
ui['library-scheme-filter'].addEventListener('change', () => {
  ui['scheme-current'].value = ui['library-scheme-filter'].value;
  ui['scheme-inspection'].hidden = true;
  refreshLibraryProducts().catch((error) => setStatus(error.message, 'error'));
});
ui['library-refresh'].addEventListener('click', () => refreshLibraryProducts().catch((error) => setStatus(error.message, 'error')));
ui['scheme-mode'].addEventListener('change', () => {
  ui['scheme-source'].disabled = ui['scheme-mode'].value !== 'copy';
});
ui['scheme-current'].addEventListener('change', () => {
  ui['library-scheme-filter'].value = ui['scheme-current'].value;
  ui['library-scheme'].value = ui['scheme-current'].value;
  ui['scheme-inspection'].hidden = true;
  refreshLibraryProducts().catch((error) => setStatus(error.message, 'error'));
});
ui['scheme-open-folder'].addEventListener('click', () => run(async () => {
  const directory = await window.publisher.openLibraryScheme(ui['scheme-current'].value);
  ui['scheme-status'].textContent = `已打开：${directory}`;
}, '方案文件夹已打开。', ui['scheme-status']));
ui['scheme-download-template'].addEventListener('click', () => run(async () => {
  const filePath = await window.publisher.saveMaterialBatchTemplate();
  ui['scheme-status'].textContent = filePath ? `批量模板已保存：${filePath}` : '已取消保存模板。';
}, '批量素材模板已生成。', ui['scheme-status']));
ui['scheme-import-batch'].addEventListener('click', () => run(async () => {
  const result = await window.publisher.importMaterialBatch(ui['scheme-current'].value);
  if (!result) { ui['scheme-status'].textContent = '已取消批量导入。'; return; }
  ui['scheme-status'].textContent = `已向${result.workspaceCount}个工作区写入${result.productCount}个产品，${result.mode === 'replace' ? '覆盖同名内容' : '合并并去重'}。`;
  await refreshLibraryProducts();
}, '批量素材导入完成。', ui['scheme-status']));
ui['scheme-check'].addEventListener('click', () => run(async () => {
  const result = await window.publisher.inspectLibraryScheme(ui['scheme-current'].value);
  ui['scheme-inspection'].hidden = false;
  ui['scheme-inspection'].innerHTML = result.workspaces.map((item) => `<article><strong>${escapeHtml(item.workspace.name)}</strong><span>${item.overridden} 个方案覆盖产品 · ${item.products} 个可见产品</span><small class="${item.issues.length ? 'warning-text' : 'success'}">${item.issues.length ? `${item.issues.length} 项需检查：${escapeHtml(item.issues.slice(0, 3).join('；'))}${item.issues.length > 3 ? '…' : ''}` : '未发现结构问题'}</small></article>`).join('');
}, '素材检查完成。', ui['scheme-status']));
ui['library-save-product'].addEventListener('click', () => {
  const workspaceIds = [...ui['library-workspace-targets'].querySelectorAll('input:checked')].map((input) => input.value);
  const mode = ui['library-save-mode'].value;
  if (mode === 'replace' && !confirm('\u66ff\u6362\u6a21\u5f0f\u4f1a\u4ee5\u672c\u6b21\u8868\u5355\u53d6\u4ee3\u6240\u9009\u5de5\u4f5c\u533a\u4e2d\u8be5\u4ea7\u54c1\u7684\u65e7\u7d20\u6750\uff0c\u786e\u8ba4\u7ee7\u7eed\u5417\uff1f')) return;
  run(async () => {
    const result = await window.publisher.saveLibraryProduct({
      model: ui['library-model'].value,
      workspaceIds,
      copies: ui['library-copies'].value,
      tagGroups: ui['library-tags'].value,
      shortTitles: ui['library-short-titles'].value,
      coverPaths: libraryCoverPaths,
      schemeId: ui['library-scheme'].value,
      mode
    });
    const names = result.results.map((item) => workspaces.find((workspace) => workspace.id === item.workspaceId)?.name || item.workspaceId);
    ui['library-form-status'].textContent = `\u5df2\u4fdd\u5b58\u201c${result.model}\u201d\u5230${names.join('\u3001')}\u3002\u5df2\u751f\u6210\u7684\u53d1\u5e03\u8ba1\u5212\u4e0d\u4f1a\u81ea\u52a8\u6539\u52a8\u3002`;
    ui['library-form-status'].className = 'success';
    await refreshLibraryProducts();
  }, '\u4ea7\u54c1\u7d20\u6750\u5df2\u5b89\u5168\u5199\u5165\u672c\u5730\u7d20\u6750\u5e93\u3002', ui['library-form-status']);
});
ui['scheme-save'].addEventListener('click', () => run(async () => {
  const result = await window.publisher.saveLibraryScheme({
    name: ui['scheme-name'].value,
    startDate: ui['scheme-start'].value,
    endDate: ui['scheme-end'].value,
    mode: ui['scheme-mode'].value,
    sourceSchemeId: ui['scheme-mode'].value === 'copy' ? ui['scheme-source'].value : '',
    workspaceIds: workspaces.map((workspace) => workspace.id)
  });
  librarySchemes = result.items || librarySchemes;
  const createdId = result.results[0]?.id;
  renderLibraryControls();
  if (createdId) {
    ui['scheme-current'].value = createdId;
    ui['library-scheme'].value = createdId;
    ui['library-scheme-filter'].value = createdId;
  }
  ui['scheme-status'].textContent = `已建立“${ui['scheme-name'].value.trim()}”及三个工作区目录，到期后自动恢复常规方案。`;
  ui['scheme-status'].className = 'panel-note success';
}, '活动素材方案已建立。', ui['scheme-status']));
ui['export-material-package'].addEventListener('click', () => run(async () => {
  const scope = ui['package-scope'].value;
  const input = {};
  if (scope !== 'all') input.workspaceIds = [activeWorkspace.id];
  if (scope === 'current-scheme') input.schemeIds = [ui['library-scheme-filter'].value];
  const result = await window.publisher.exportMaterialPackage(input);
  if (!result) { ui['package-status'].textContent = '已取消导出。'; return; }
  ui['package-status'].textContent = `已导出${result.workspaceCount}个工作区、${result.fileCount}个素材文件：${result.filePath}`;
  ui['package-status'].className = 'panel-note success';
}, '素材包导出完成。', ui['package-status']));
ui['import-material-package'].addEventListener('click', () => run(async () => {
  const result = await window.publisher.importMaterialPackage();
  if (!result) { ui['package-status'].textContent = '已取消导入。'; return; }
  ui['package-status'].textContent = `已导入${result.workspaceCount}个工作区、${result.fileCount}个素材文件。原有非同名素材保持不变。`;
  ui['package-status'].className = 'panel-note success';
  const schemes = await window.publisher.listLibrarySchemes();
  librarySchemes = schemes.items || [];
  await refreshLibraryProducts();
}, '素材包校验并导入完成。', ui['package-status']));
ui['confirm-delete-account'].addEventListener('click', () => {
  const accountId = pendingDeleteAccountId;
  if (!accountId || ui['confirm-delete-account'].disabled) return;
  run(async () => {
    await window.publisher.resetAccount(accountId);
    closeModal('delete-account-modal');
  }, '账号登录资料已移入回收站，账号槽位已重置。', ui['delete-account-status']);
});

ui['select-workspace'].addEventListener('click', () => {
  const nextId = ui['workspace-select'].value;
  if (nextId === activeWorkspace?.id) return;
  if (!confirm('切换后将使用另一套账号、飞书表格、本地素材库和计划缓存。确认切换吗？')) return;
  run(() => window.publisher.selectWorkspace(nextId), '发布工作区已切换。', ui['workspace-status']);
});
ui['save-sheet'].addEventListener('click', () => run(async () => {
  activeWorkspace = await window.publisher.updateWorkspace(activeWorkspace.id, { sheetUrl: ui['sheet-url'].value });
  ui['settings-status'].textContent = '当前工作区链接已保存';
}, '当前工作区的飞书表格链接已保存。', ui['settings-status']));
ui['resolve-commerce-titles'].addEventListener('click', () => run(async () => {
  ui['commerce-status'].textContent = '正在逐条读取飞书商品链接对应的平台商品原始标题…';
  const result = await window.publisher.resolveCommerceTitles();
  currentPlan = result.plan;
  ui['commerce-status'].textContent = `读取到${result.proposed}条可确认短标题；${result.needsManual}条需人工填写；本地库已匹配${result.skipped}条${result.failures.length ? `；失败${result.failures.length}条：${result.failures.join('；')}` : ''}`;
}, '商品原始标题读取完成，请逐条人工确认。', ui['commerce-status']));
ui['open-feishu'].addEventListener('click', () => run(() => window.publisher.openFeishuBrowser(), '飞书 Chrome 已打开。登录并看到目标表格后点击检测登录。', ui['settings-status']));
ui['detect-feishu'].addEventListener('click', () => run(async () => { const result = await window.publisher.detectFeishuLogin(); ui['settings-status'].textContent = result.message; }, '飞书登录检测完成。', ui['settings-status']));
ui['close-feishu'].addEventListener('click', () => run(() => window.publisher.closeFeishuBrowser(), '飞书 Chrome 已关闭，登录状态保留。', ui['settings-status']));
ui['settings-close-feishu'].addEventListener('click', () => run(() => window.publisher.closeFeishuBrowser(), '飞书 Chrome 已关闭，登录状态保留。'));
ui['close-browser'].addEventListener('click', () => run(() => window.publisher.closeBrowser(), '当前平台 Chrome 已关闭，登录状态保留。'));

ui['test-platform'].addEventListener('change', () => {
  testPlatform = ui['test-platform'].value === 'wechat-channels' ? 'wechat-channels' : 'douyin';
  ui['test-confirm'].checked = false;
  render();
});
ui['plan-date'].addEventListener('change', updatePlanSchemeLabel);
ui['schedule-policy-trigger'].addEventListener('click', () => {
  const active = schedulePolicies.find((policy) => policy.id === activeSchedulePolicyId) || schedulePolicies[0];
  renderSchedulePolicies();
  setScheduleEditor(active);
  ui['schedule-policy-status'].textContent = '';
  ui['schedule-policy-modal'].hidden = false;
});
ui['schedule-policy-list'].addEventListener('click', async (event) => {
  const button = event.target.closest('[data-schedule-policy]');
  if (!button) return;
  try {
    const state = await window.publisher.selectSchedulePolicy(button.dataset.schedulePolicy);
    schedulePolicies = state.items;
    activeSchedulePolicyId = state.activeId;
    renderSchedulePolicies();
    setScheduleEditor(schedulePolicies.find((policy) => policy.id === activeSchedulePolicyId));
    ui['schedule-policy-status'].textContent = '已设为下一次生成计划使用的排期方案。';
    ui['schedule-policy-status'].className = 'panel-note success';
  } catch (error) {
    ui['schedule-policy-status'].textContent = error.message;
    ui['schedule-policy-status'].className = 'panel-note error';
  }
});
ui['schedule-policy-new'].addEventListener('click', () => {
  setScheduleEditor(null);
  ui['schedule-policy-name'].focus();
  ui['schedule-policy-status'].textContent = '填写规则后保存；保存成功后会自动设为当前方案。';
  ui['schedule-policy-status'].className = 'panel-note';
});
document.querySelectorAll('[data-schedule-preset]').forEach((button) => button.addEventListener('click', () => {
  const presets = { morning: ['08:00','12:00'], afternoon: ['13:00','18:00'], evening: ['18:00','23:00'], 'all-day': ['08:00','23:00'] };
  const [start, end] = presets[button.dataset.schedulePreset];
  renderRangeRows(scheduleFocusRanges, 'focus', [{ start, end }]);
  updateSchedulePreview();
}));
function addScheduleRange(container, type) {
  const ranges = collectRangeRows(container);
  if (ranges.length >= 8) return;
  const fallback = type === 'focus' ? { start: '18:00', end: '23:00' } : { start: '17:00', end: '18:00' };
  renderRangeRows(container, type, [...ranges, fallback]);
  updateSchedulePreview();
}
addFocusRangeButton.addEventListener('click', () => addScheduleRange(scheduleFocusRanges, 'focus'));
addAvoidRangeButton.addEventListener('click', () => addScheduleRange(scheduleAvoidRanges, 'avoid'));
for (const container of [scheduleFocusRanges, scheduleAvoidRanges]) {
  container.addEventListener('input', updateSchedulePreview);
  container.addEventListener('change', updateSchedulePreview);
  container.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-range]');
    if (!button || button.disabled) return;
    const type = button.dataset.removeRange;
    const ranges = collectRangeRows(container);
    const index = [...container.querySelectorAll('[data-schedule-range]')].indexOf(button.closest('[data-schedule-range]'));
    ranges.splice(index, 1);
    renderRangeRows(container, type, ranges);
    updateSchedulePreview();
  });
}
ui['schedule-interval'].addEventListener('input', updateSchedulePreview);
ui['schedule-interval'].addEventListener('change', updateSchedulePreview);
ui['schedule-avoid-enabled'].addEventListener('change', () => {
  if (ui['schedule-avoid-enabled'].checked && !collectRangeRows(scheduleAvoidRanges).length) {
    renderRangeRows(scheduleAvoidRanges, 'avoid', [{ start: '17:00', end: '18:00' }]);
  }
  scheduleAvoidRanges.hidden = !ui['schedule-avoid-enabled'].checked;
  addAvoidRangeButton.hidden = !ui['schedule-avoid-enabled'].checked;
  updateSchedulePreview();
});
ui['schedule-policy-save'].addEventListener('click', async () => {
  try {
    const state = await window.publisher.saveSchedulePolicy({
      id: editingSchedulePolicyId || undefined,
      name: ui['schedule-policy-name'].value,
      intervalMinutes: Number(ui['schedule-interval'].value),
      focusRanges: collectRangeRows(scheduleFocusRanges),
      avoidEnabled: ui['schedule-avoid-enabled'].checked,
      avoidRanges: collectRangeRows(scheduleAvoidRanges)
    });
    schedulePolicies = state.items;
    activeSchedulePolicyId = state.activeId;
    renderSchedulePolicies();
    setScheduleEditor(schedulePolicies.find((policy) => policy.id === activeSchedulePolicyId));
    ui['schedule-policy-status'].textContent = '方案已保存并用于下一次生成计划。';
    ui['schedule-policy-status'].className = 'panel-note success';
  } catch (error) {
    ui['schedule-policy-status'].textContent = error.message;
    ui['schedule-policy-status'].className = 'panel-note error';
  }
});
ui['schedule-policy-delete'].addEventListener('click', async () => {
  const policy = schedulePolicies.find((item) => item.id === editingSchedulePolicyId);
  if (!policy || policy.builtIn || !confirm(`删除排期方案“${policy.name}”？已生成计划不会受到影响。`)) return;
  try {
    const state = await window.publisher.deleteSchedulePolicy(policy.id);
    schedulePolicies = state.items;
    activeSchedulePolicyId = state.activeId;
    renderSchedulePolicies();
    setScheduleEditor(schedulePolicies.find((item) => item.id === activeSchedulePolicyId));
    ui['schedule-policy-status'].textContent = '排期方案已删除；已生成计划保持不变。';
    ui['schedule-policy-status'].className = 'panel-note success';
  } catch (error) {
    ui['schedule-policy-status'].textContent = error.message;
    ui['schedule-policy-status'].className = 'panel-note error';
  }
});

function createPlan() {
  if (!ui['plan-date'].value) { ui['plan-status'].textContent = '请先选择发布日期'; ui['plan-status'].className = 'panel-note error'; return; }
  run(async () => { ui['plan-status'].textContent = '正在使用当前飞书筛选结果拉取…'; currentPlan = await window.publisher.createPlan(ui['plan-date'].value, 'current', ui['plan-scheme'].value, activeSchedulePolicyId); ui['batch-confirm'].checked = false; }, '计划已经生成，请逐行人工检查。', ui['plan-status'], 'pull');
}
ui['create-plan-current-filter'].addEventListener('click', createPlan);
document.querySelector('.date-control').addEventListener('click', (event) => {
  if (event.target === ui['plan-date']) return;
  ui['plan-date'].focus();
  if (typeof ui['plan-date'].showPicker === 'function') {
    try { ui['plan-date'].showPicker(); } catch {}
  }
});
ui['select-all'].addEventListener('click', () => {
  const ids = currentPlan?.items?.filter((item) => item.ready && !['verified','id-resolved','running','uncertain'].includes(item.execution?.state)).map((item) => item.itemId) || [];
  run(() => window.publisher.setPlanSelection(ids, true), `已选中${ids.length}条可发布项。`);
});
ui['select-none'].addEventListener('click', () => {
  const ids = currentPlan?.items?.filter((item) => !['verified','id-resolved','running','uncertain'].includes(item.execution?.state)).map((item) => item.itemId) || [];
  run(() => window.publisher.setPlanSelection(ids, false), '已取消本次发布选择。');
});
ui['export-ids'].addEventListener('click', () => run(async () => {
  const result = await window.publisher.exportPlanIds();
  ui['batch-status'].textContent = `ID记录已更新：${result.resolved}/${result.total}条已获取；TXT：${result.filePath}；表格：${result.csvPath}`;
}, 'ID记录已更新。', ui['batch-status']));
ui['copy-id-table'].addEventListener('click', () => run(async () => {
  const result = await window.publisher.copyPlanIdTable();
  ui['batch-status'].textContent = `已按飞书行号复制${result.copyCount}个发布ID，每行一个纯数字。`;
}, '发布ID已复制。', ui['batch-status']));
ui['sync-ids'].addEventListener('click', () => run(async () => {
  const result = await window.publisher.syncPlanIds();
  ui['batch-status'].textContent = `本次获取${result.matches.length}个ID，仍有${result.unresolved}条待获取。`;
}, '视频ID同步完成。', ui['batch-status']));
ui['open-published-videos'].addEventListener('click', () => run(async () => {
  const result = await window.publisher.openPublishedVideos();
  const unresolved = result.unresolvedCount ? `；另有${result.unresolvedCount}条已提交视频尚未同步到链接` : '';
  const failed = result.failedCount ? `；${result.failedCount}个链接打开失败` : '';
  ui['batch-status'].textContent = `已在当前发布账号 Chrome 中打开${result.openedCount}个视频标签页${unresolved}${failed}。`;
}, '本批次视频检查页已打开。', ui['batch-status']));
ui['open-id-records'].addEventListener('click', () => run(() => window.publisher.openIdRecords(), '已打开发布ID记录目录。'));
ui['execute-plan'].addEventListener('click', () => {
  if (!ui['batch-confirm'].checked) { ui['batch-status'].textContent = '请先勾选人工检查和批量发布授权'; ui['batch-status'].className = 'error'; return; }
  const selectedCount = currentPlan?.items?.filter((item) => item.selected && item.ready && ['pending','failed','skipped'].includes(item.execution?.state || 'pending')).length || 0;
  const firstFrameCount = currentPlan?.items?.filter((item) => item.selected && item.ready && item.coverMode === 'video-first-frame' && ['pending','failed','skipped'].includes(item.execution?.state || 'pending')).length || 0;
  if (!confirm(`即将在正式账号实际发布 ${selectedCount} 条未完成视频${firstFrameCount ? `，其中 ${firstFrameCount} 条商城视频使用首帧` : ''}。已核验项不会重复执行，确认继续吗？`)) return;
  run(async () => { ui['batch-status'].textContent = '正在逐条发布，请勿操作设备…'; const result = await window.publisher.executePlan(); ui['batch-status'].textContent = `全部${result.count}条已提交。日志：${result.reportPath}`; ui['batch-status'].className = 'success'; }, '批量发布完成，请前往作品管理核对。', ui['batch-status'], 'publish');
});
ui['edit-plan-choose-cover'].addEventListener('click', async () => {
  const value = await window.publisher.choosePlanCover();
  if (value) {
    editingCoverPath = value;
    editingCoverMode = 'manual-cover';
    ui['edit-plan-cover'].textContent = value;
    const radio = document.querySelector('input[name="edit-cover-mode"][value="manual-cover"]');
    if (radio) radio.checked = true;
    ui['edit-plan-choose-cover'].disabled = false;
  }
});
document.querySelectorAll('input[name="edit-cover-mode"]').forEach((radio) => radio.addEventListener('change', () => {
  editingCoverMode = radio.value;
  if (editingCoverMode === 'video-first-frame') {
    editingCoverPath = '';
    ui['edit-plan-cover'].textContent = '\u5c06\u4f7f\u7528\u89c6\u9891\u9996\u5e27';
    ui['edit-plan-choose-cover'].disabled = true;
  } else {
    ui['edit-plan-choose-cover'].disabled = false;
    ui['edit-plan-cover'].textContent = editingCoverPath || '\u8bf7\u9009\u62e9\u672c\u5730\u5c01\u9762';
  }
}));
ui['save-plan-item'].addEventListener('click', () => {
  if (!editingItemId) return;
  run(async () => {
    currentPlan = await window.publisher.updatePlanItem(editingItemId, {
      category: ui['edit-plan-category'].value,
      model: ui['edit-plan-model'].value,
      scheduledLocal: ui['edit-plan-time'].value,
      body: ui['edit-plan-body'].value,
      tags: ui['edit-plan-tags'].value,
      coverPath: editingCoverMode === 'video-first-frame' ? null : editingCoverPath,
      coverMode: ui['edit-commerce-fields'].hidden ? (editingCoverPath ? 'manual-cover' : 'library-cover') : editingCoverMode,
      productShortTitle: ui['edit-commerce-fields'].hidden ? undefined : ui['edit-product-short-title'].value,
      productUrl: ui['edit-commerce-fields'].hidden ? undefined : ui['edit-product-link'].value,
      confirmProductShortTitle: ui['edit-commerce-fields'].hidden ? undefined : ui['edit-confirm-short-title'].checked,
      saveProductShortTitle: ui['edit-commerce-fields'].hidden ? undefined : ui['edit-save-short-title'].checked
    });
    closeModal('edit-plan-modal');
    editingItemId = null;
  }, '计划项已保存。', ui['edit-plan-status']);
});
ui['clear-cache'].addEventListener('click', () => { if (!confirm('只删除下载缓存和当前计划，保留素材库与发布日志。确认清理吗？')) return; run(async () => { const result = await window.publisher.clearCache(); currentPlan = null; ui['batch-confirm'].checked = false; ui['plan-status'].textContent = `缓存已清理，共移除${result.removed}项。`; }, '下载缓存已经清理，发布日志保持不变。', ui['plan-status']); });

ui['choose-video'].addEventListener('click', async () => { const value = await window.publisher.chooseVideo(); if (value) { videoPath = value; ui['video-path'].textContent = value; } });
ui['choose-cover'].addEventListener('click', async () => { const value = await window.publisher.chooseCover(); if (value) { coverPath = value; ui['cover-path'].textContent = value; } });
ui['test-body'].addEventListener('input', () => { const count = (ui['test-body'].value.match(/[\u3400-\u9fff]/g) || []).length; ui['body-count'].textContent = `${count} 个汉字，仅供参考`; ui['body-count'].className = ''; });
ui['prepare-test'].addEventListener('click', () => { if (!ui['test-confirm'].checked) { ui['prepare-status'].textContent = '请先确认测试账号并授权实际发布'; ui['prepare-status'].className = 'error'; return; } if (!confirm(`本次会在${testPlatform === 'wechat-channels' ? '视频号' : '抖音'}测试账号实际点击一次发布，确认继续吗？`)) return; run(async () => { const result = await window.publisher.submitTestPublish({ platform: testPlatform, videoPath, coverPath, body: ui['test-body'].value, tags: ui['test-tags'].value, scheduledAt: ui['scheduled-at'].value }); ui['prepare-status'].textContent = `已提交。报告：${result.reportPath}`; ui['prepare-status'].className = 'success'; }, '测试视频已提交，请立即人工检查。', ui['prepare-status']); });
ui['test-resolve-id'].addEventListener('click', () => run(async () => {
  const result = await window.publisher.resolveTestPublishId({
    body: ui['test-body'].value,
    scheduledAt: ui['scheduled-at'].value
  });
  ui['test-id-status'].textContent = `获取成功：${result.videoId}；${result.videoUrl}`;
  ui['test-id-status'].className = 'success';
}, '小号视频ID获取成功。', ui['test-id-status']));

ui['save-preferences'].addEventListener('click', () => run(async () => { settings = await window.publisher.saveSettings({ ...settings, watermarkEnabled: ui['watermark-enabled'].checked, guardSeconds: Number(ui['guard-seconds'].value) }); ui['preferences-status'].textContent = '设置已保存'; ui['preferences-status'].className = 'success'; }, '防误操设置已保存。', ui['preferences-status']));
ui['finish-guide'].addEventListener('click', () => run(async () => { settings = await window.publisher.saveSettings({ ...settings, guideCompleted: true }); showPage('main'); }, '准备状态已记录，可以开始使用主工作台。'));
window.publisher.onAutomationTakeover((kind) => { setStatus(kind === 'pull' ? '已请求人工接管，素材拉取将在安全检查点停止。' : '已请求人工接管，发布将在安全检查点停止。', 'error'); });
window.publisher.onPlanItemState(() => {
  window.publisher.getCurrentPlan().then((plan) => { currentPlan = plan; render(); }).catch(() => {});
});

const tomorrow = new Date(Date.now() + 86400000);
ui['plan-date'].value = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2,'0')}-${String(tomorrow.getDate()).padStart(2,'0')}`;
refresh().then(() => { showPage('main'); setStatus('本地配置已就绪。'); }).catch((error) => setStatus(error.message, 'error'));
