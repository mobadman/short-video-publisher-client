const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const FORMAT = 'short-video-material-package';
const FORMAT_VERSION = 1;
const ALLOWED_ROOTS = new Set(['封面库', '文案库', 'Tag库', '商品短标题库', '素材方案']);

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function safeRelative(value) {
  const normalized = String(value || '').replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('../') || path.isAbsolute(normalized)) {
    throw new Error(`素材包中存在不安全路径：${value}`);
  }
  const root = normalized.split('/')[0];
  if (!ALLOWED_ROOTS.has(root)) throw new Error(`素材包包含非素材目录：${root}`);
  return normalized;
}

function collectFiles(store, schemeIds = null) {
  const files = [];
  const walk = (directory, prefix) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`素材目录包含链接文件，已停止导出：${target}`);
      if (entry.isDirectory()) walk(target, `${prefix}/${entry.name}`);
      else if (entry.isFile()) {
        const relativePath = safeRelative(`${prefix}/${entry.name}`);
        if (relativePath.endsWith('/_使用说明.txt') || relativePath === '_使用说明.txt') continue;
        const data = fs.readFileSync(target);
        if (['.txt', '.json', '.csv'].includes(path.extname(target).toLowerCase())) {
          const text = data.toString('utf8');
          if (/https:\/\/[a-z0-9-]+\.feishu\.cn\/(?:wiki|sheets?)\//i.test(text)) {
            throw new Error(`素材文件中包含飞书文档链接，已停止导出：${relativePath}`);
          }
          if (/[A-Za-z]:\\Users\\[^\\\r\n"']+/i.test(text)) {
            throw new Error(`素材文件中包含本机用户路径，已停止导出：${relativePath}`);
          }
        }
        files.push({ path: relativePath, size: data.length, sha256: sha256(data), data: data.toString('base64') });
      }
    }
  };
  for (const source of store.packageSources(schemeIds)) walk(source.root, source.prefix);
  return files.sort((left, right) => left.path.localeCompare(right.path, 'zh-CN'));
}

function writePackage(filePath, workspaces, options = {}) {
  const selectedIds = new Set((options.workspaceIds || []).map(String));
  const selectedSchemes = options.schemeIds?.length ? new Set(options.schemeIds.map(String)) : null;
  const included = workspaces.filter(({ workspace }) => !selectedIds.size || selectedIds.has(workspace.id)).map(({ workspace, store }) => ({
    workspace: { id: workspace.id, name: workspace.name, platform: workspace.platform, mode: workspace.mode },
    schemes: store.listSchemes(),
    files: collectFiles(store, selectedSchemes)
  }));
  if (!included.length) throw new Error('没有可导出的工作区');
  const payload = {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    packageId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    appVersion: String(options.appVersion || ''),
    scope: { workspaceIds: included.map((item) => item.workspace.id), schemeIds: selectedSchemes ? [...selectedSchemes] : ['*'] },
    exclusions: ['飞书链接', 'Chrome Profile', '登录态', '发布日志', '下载缓存', '发布计划', '本机绝对路径'],
    workspaces: included
  };
  fs.writeFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
  return {
    filePath,
    workspaceCount: included.length,
    fileCount: included.reduce((sum, item) => sum + item.files.length, 0),
    bytes: included.reduce((sum, item) => sum + item.files.reduce((total, file) => total + file.size, 0), 0)
  };
}

function readPackage(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (parsed?.format !== FORMAT || parsed?.formatVersion !== FORMAT_VERSION || !Array.isArray(parsed.workspaces)) {
    throw new Error('这不是受支持的短视频素材包');
  }
  for (const bundle of parsed.workspaces) {
    if (!bundle?.workspace?.id || !Array.isArray(bundle.files)) throw new Error('素材包清单不完整');
    for (const file of bundle.files) {
      safeRelative(file.path);
      const data = Buffer.from(String(file.data || ''), 'base64');
      if (data.length !== file.size || sha256(data) !== file.sha256) throw new Error(`素材文件校验失败：${file.path}`);
    }
  }
  return parsed;
}

function packageSummary(filePath) {
  const parsed = readPackage(filePath);
  return {
    filePath,
    packageId: parsed.packageId,
    createdAt: parsed.createdAt,
    appVersion: parsed.appVersion,
    exclusions: parsed.exclusions,
    workspaces: parsed.workspaces.map((bundle) => ({
      id: bundle.workspace.id,
      name: bundle.workspace.name,
      schemes: bundle.schemes?.map((scheme) => ({ id: scheme.id, name: scheme.name })) || [],
      fileCount: bundle.files.length,
      bytes: bundle.files.reduce((sum, file) => sum + file.size, 0)
    }))
  };
}

function importPackage(filePath, targets, options = {}) {
  const parsed = readPackage(filePath);
  const targetMap = new Map(targets.map((target) => [target.workspace.id, target]));
  const requestedIds = new Set((options.workspaceIds || []).map(String));
  const applicable = parsed.workspaces.filter((bundle) => !requestedIds.size || requestedIds.has(bundle.workspace.id));
  const missing = applicable.filter((bundle) => !targetMap.has(bundle.workspace.id)).map((bundle) => bundle.workspace.name || bundle.workspace.id);
  if (missing.length) throw new Error(`本机没有对应工作区：${missing.join('、')}`);
  const transactionRoot = path.join(targets[0].store.materialCenterRoot, `.material-import-${crypto.randomUUID()}`);
  const backups = [];
  const written = [];
  try {
    fs.mkdirSync(transactionRoot, { recursive: true });
    for (const bundle of applicable) {
      const target = targetMap.get(bundle.workspace.id);
      for (const scheme of bundle.schemes || []) {
        if (scheme?.id && scheme.id !== 'default') target.store.saveScheme(scheme);
      }
      for (const file of bundle.files) {
        const relativePath = safeRelative(file.path);
        const destination = target.store.packageDestination(relativePath);
        if (!destination) continue;
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        if (fs.existsSync(destination)) {
          if (fs.lstatSync(destination).isSymbolicLink()) throw new Error(`目标是链接文件，已停止导入：${relativePath}`);
          const backup = path.join(transactionRoot, `${backups.length}.bak`);
          fs.copyFileSync(destination, backup);
          backups.push({ destination, backup });
        } else written.push(destination);
        fs.writeFileSync(destination, Buffer.from(file.data, 'base64'));
      }
      target.store.initialize();
    }
    return { workspaceCount: applicable.length, fileCount: applicable.reduce((sum, bundle) => sum + bundle.files.length, 0) };
  } catch (error) {
    for (const destination of written.reverse()) if (fs.existsSync(destination)) fs.rmSync(destination, { force: true });
    for (const { destination, backup } of backups.reverse()) fs.copyFileSync(backup, destination);
    throw new Error(`素材包导入失败，已恢复原有素材：${error.message}`);
  } finally {
    if (fs.existsSync(transactionRoot)) fs.rmSync(transactionRoot, { recursive: true, force: true });
  }
}

module.exports = { writePackage, readPackage, packageSummary, importPackage, safeRelative, ALLOWED_ROOTS };
