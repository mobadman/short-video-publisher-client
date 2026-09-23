const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizeTags } = require('./test-publish');
const { validateShortTitle } = require('./commerce-product-title');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);
const DEFAULT_SCHEME_ID = 'default';
const PLATFORM_FOLDERS = {
  'douyin-commerce': '抖音商城',
  'douyin-standard': '抖音普通',
  'wechat-channels': '微信视频号'
};
const CONTENT_DIRECTORIES = ['文案库', 'Tag库', '商品短标题库'];

function safeName(value, fallback) {
  const normalized = String(value || '').trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '');
  if (!normalized) return fallback;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(normalized)) return `_${normalized}`;
  return normalized.slice(0, 100);
}

function readVariants(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('//'));
}

function uniqueLines(values) {
  return [...new Set((Array.isArray(values) ? values : String(values || '').split(/\r?\n/))
    .map((value) => String(value || '').trim())
    .filter((value) => value && !value.startsWith('//')))];
}

function fileHash(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function seededRandom(seedText) {
  let state = crypto.createHash('sha256').update(String(seedText)).digest().readUInt32LE(0) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function shuffledIndex(length, ordinal, seedText) {
  if (length <= 1) return 0;
  const position = Math.max(0, Number(ordinal) || 0);
  const cycle = Math.floor(position / length);
  const indexes = Array.from({ length }, (_, index) => index);
  const random = seededRandom(`${seedText}|${cycle}`);
  for (let index = indexes.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [indexes[index], indexes[swap]] = [indexes[swap], indexes[index]];
  }
  if (cycle > 0) {
    const previousLast = shuffledIndex(length, cycle * length - 1, seedText);
    if (indexes[0] === previousLast) [indexes[0], indexes[1]] = [indexes[1], indexes[0]];
  }
  return indexes[position % length];
}

function validateImageFile(filePath) {
  const header = Buffer.alloc(8);
  const descriptor = fs.openSync(filePath, 'r');
  try { fs.readSync(descriptor, header, 0, header.length, 0); } finally { fs.closeSync(descriptor); }
  const extension = path.extname(filePath).toLowerCase();
  const jpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  const png = header.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if ((extension === '.png' && !png) || (extension !== '.png' && !jpeg)) {
    throw new Error(`\u5c01\u9762\u6269\u5c55\u540d\u4e0e\u771f\u5b9e\u56fe\u7247\u683c\u5f0f\u4e0d\u4e00\u81f4\uff1a${filePath}`);
  }
}

function copyDirectory(source, target) {
  fs.mkdirSync(target, { recursive: true });
  if (!fs.existsSync(source)) return;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`\u5c01\u9762\u76ee\u5f55\u4e2d\u5b58\u5728\u94fe\u63a5\u6587\u4ef6\uff0c\u5df2\u505c\u6b62\u5199\u5165\uff1a${entry.name}`);
    if (entry.isFile()) fs.copyFileSync(path.join(source, entry.name), path.join(target, entry.name));
  }
}

function copyTreeMissing(source, target) {
  if (!fs.existsSync(source)) return { files: 0, bytes: 0 };
  const sourceRoot = path.resolve(source);
  const targetRoot = path.resolve(target);
  let files = 0;
  let bytes = 0;
  const walk = (current, destination) => {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const from = path.join(current, entry.name);
      const to = path.join(destination, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`素材目录中存在链接文件，已停止迁移：${from}`);
      if (entry.isDirectory()) walk(from, to);
      else if (entry.isFile() && !fs.existsSync(to)) {
        const relative = path.relative(sourceRoot, from);
        const resolved = path.resolve(targetRoot, relative);
        if (path.relative(targetRoot, resolved).startsWith('..')) throw new Error(`素材迁移路径越界：${from}`);
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        fs.copyFileSync(from, resolved);
        const size = fs.statSync(from).size;
        if (fileHash(from) !== fileHash(resolved)) throw new Error(`素材迁移校验失败：${from}`);
        files += 1;
        bytes += size;
      }
    }
  };
  walk(sourceRoot, targetRoot);
  return { files, bytes };
}

function schemeDirectoryName(name, code) {
  return `${safeName(name, '未命名方案')}__${safeName(code, 'S000')}`;
}

class LibraryStore {
  constructor(dataRoot, workspaceId = '') {
    this.dataRoot = dataRoot;
    this.workspaceId = String(workspaceId || '').trim();
    this.platformFolder = PLATFORM_FOLDERS[this.workspaceId] || safeName(this.workspaceId, '默认工作区');
    this.root = this.workspaceId
      ? path.join(dataRoot, '工作区', safeName(this.workspaceId, 'default'), '本地素材库')
      : path.join(dataRoot, '本地素材库');
    this.legacyRoot = this.root;
    this.materialCenterRoot = path.join(dataRoot, '素材中心');
    this.sharedRoot = path.join(this.materialCenterRoot, '共享素材', this.platformFolder);
    this.schemeLibraryRoot = path.join(this.materialCenterRoot, '方案库');
    this.defaultSchemeRoot = path.join(this.schemeLibraryRoot, '常规方案', this.platformFolder);
    this.activitySchemesRoot = path.join(this.schemeLibraryRoot, '活动方案');
    this.coversRoot = path.join(this.sharedRoot, '封面库');
    this.copyRoot = path.join(this.defaultSchemeRoot, '文案库');
    this.tagsRoot = path.join(this.defaultSchemeRoot, 'Tag库');
    this.shortTitlesRoot = path.join(this.defaultSchemeRoot, '商品短标题库');
    this.productConfigRoot = path.join(this.root, '商品配置');
    this.legacySchemesRoot = path.join(this.root, '素材方案');
    this.schemesRoot = this.schemeLibraryRoot;
    this.schemesFile = path.join(this.schemeLibraryRoot, '方案列表.json');
    this.migrationFile = path.join(this.materialCenterRoot, '_迁移状态.json');
    this.productMappingFile = path.join(this.productConfigRoot, '产品型号映射.csv');
    this.cacheRoot = path.join(this.root, '下载缓存');
    this.logsRoot = path.join(this.root, '发布日志');
    this.recordsRoot = path.join(this.root, '发布ID记录');
  }

  initialize() {
    this.migrateLegacyMaterials();
    for (const directory of Object.values(this.paths())) fs.mkdirSync(directory, { recursive: true });
    this.writeInstructions();
    this.writeCenterGuide();
    return this.paths();
  }

  paths() {
    return {
      root: this.materialCenterRoot,
      materialCenter: this.materialCenterRoot,
      schemes: this.schemeLibraryRoot,
      activitySchemes: this.activitySchemesRoot,
      currentScheme: this.defaultSchemeRoot,
      covers: this.coversRoot,
      copy: this.copyRoot,
      tags: this.tagsRoot,
      shortTitles: this.shortTitlesRoot,
      productConfig: this.productConfigRoot,
      cache: this.cacheRoot,
      logs: this.logsRoot,
      records: this.recordsRoot
    };
  }

  writeCenterGuide() {
    const guidePath = path.join(this.materialCenterRoot, '00_素材库使用说明.txt');
    if (!fs.existsSync(guidePath)) fs.writeFileSync(guidePath, [
      '素材中心按“方案优先、平台其次”组织。',
      '常规方案保存日常文案；活动方案只需放变化内容，缺失内容会自动继承常规方案。',
      '共享素材中的封面不会随活动方案切换。',
      '每个产品型号建立同名 txt；文案每行一条，Tag 每行一组，商品短标题每行一个。',
      '请勿在工作区目录中复制 Chrome Profile、飞书链接、发布日志或下载缓存。',
      ''
    ].join('\n'), 'utf8');
  }

  migrateLegacyMaterials() {
    fs.mkdirSync(this.materialCenterRoot, { recursive: true });
    fs.mkdirSync(this.schemeLibraryRoot, { recursive: true });
    let state = { version: 2, workspaces: {} };
    try { state = JSON.parse(fs.readFileSync(this.migrationFile, 'utf8')); } catch {}
    state.workspaces = state.workspaces || {};
    const alreadyMigrated = Boolean(state.workspaces[this.workspaceId || 'default']);
    let registry = [];
    try { registry = JSON.parse(fs.readFileSync(this.schemesFile, 'utf8')); } catch {}
    if (!Array.isArray(registry)) registry = [];
    let legacySchemes = [];
    try { legacySchemes = JSON.parse(fs.readFileSync(path.join(this.legacySchemesRoot, '方案列表.json'), 'utf8')); } catch {}
    if (!Array.isArray(legacySchemes)) legacySchemes = [];
    for (const legacy of legacySchemes) {
      if (!legacy?.id || registry.some((item) => item.id === legacy.id)) continue;
      const nextNumber = registry.reduce((max, item) => Math.max(max, Number(String(item.code || '').replace(/^S/, '')) || 0), 0) + 1;
      const code = `S${String(nextNumber).padStart(3, '0')}`;
      registry.push({ ...legacy, code, directoryName: schemeDirectoryName(legacy.name, code) });
    }
    let highestCode = registry.reduce((max, item) => Math.max(max, Number(String(item.code || '').replace(/^S/, '')) || 0), 0);
    registry = registry.map((item) => {
      const code = item.code || `S${String(++highestCode).padStart(3, '0')}`;
      return { ...item, code, directoryName: item.directoryName || schemeDirectoryName(item.name, code) };
    });
    fs.writeFileSync(this.schemesFile, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
    let files = 0;
    let bytes = 0;
    if (!alreadyMigrated) {
      for (const [legacyName, target] of [
        ['封面库', this.coversRoot],
        ['文案库', this.copyRoot],
        ['Tag库', this.tagsRoot],
        ['商品短标题库', this.shortTitlesRoot]
      ]) {
        const copied = copyTreeMissing(path.join(this.legacyRoot, legacyName), target);
        files += copied.files; bytes += copied.bytes;
      }
    }
    for (const scheme of registry) {
      const directoryName = scheme.directoryName || schemeDirectoryName(scheme.name, scheme.code || 'S000');
      if (!alreadyMigrated) {
        for (const contentName of CONTENT_DIRECTORIES) {
          const copied = copyTreeMissing(
            path.join(this.legacySchemesRoot, safeName(scheme.id, ''), contentName),
            path.join(this.activitySchemesRoot, directoryName, this.platformFolder, contentName)
          );
          files += copied.files; bytes += copied.bytes;
        }
      }
      this.ensureSchemeDirectories({ ...scheme, directoryName });
    }
    state.version = 2;
    state.updatedAt = new Date().toISOString();
    if (!alreadyMigrated) state.workspaces[this.workspaceId || 'default'] = { migratedAt: new Date().toISOString(), copiedFiles: files, copiedBytes: bytes, legacyRoot: this.legacyRoot };
    fs.writeFileSync(this.migrationFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  }

  writeInstructions() {
    const instructions = [
      [
        this.coversRoot,
        '直接按“产品型号”创建文件夹，把 jpg、jpeg、png 封面放入型号文件夹。产品类目不参与路径匹配。',
        '按“产品类目/产品型号”创建文件夹，把 jpg、jpeg、png 封面放入型号文件夹。'
      ],
      [
        this.copyRoot,
        '每个产品型号直接建立一个同名 txt；每行一条正文，正文长度不限。产品类目不参与路径匹配。',
        [
          '每个产品型号直接建立一个同名 txt；每行一条正文，正文最多20个汉字。产品类目不参与路径匹配。',
          '按“产品类目”创建文件夹，每个产品型号建立一个同名 txt；每行一条正文，正文最多20个汉字。'
        ]
      ],
      [
        this.tagsRoot,
        '每个产品型号直接建立一个同名 txt；每行一组 Tag，用逗号分隔，最多5个，不必写井号。产品类目不参与路径匹配。',
        '按“产品类目”创建文件夹，每个产品型号建立一个同名 txt；每行一组 Tag，用逗号分隔，最多5个，不必写井号。'
      ],
      [
        this.shortTitlesRoot,
        '每个产品型号建立一个同名 txt；每行一个购物车商品短标题，最多10个汉字。商城工作区每条视频必须匹配。',
        ''
      ]
    ];
    for (const [directory, content, previousContent] of instructions) {
      const filePath = path.join(directory, '_使用说明.txt');
      const next = `${content}\n以 // 开头的行会被忽略。\n`;
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, next, 'utf8');
      } else {
        const previousContents = Array.isArray(previousContent) ? previousContent : [previousContent];
        const current = fs.readFileSync(filePath, 'utf8');
        if (previousContents.some((value) => current === `${value}\n以 // 开头的行会被忽略。\n`)) {
          fs.writeFileSync(filePath, next, 'utf8');
        }
      }
    }
  }

  productPaths(category, model) {
    return this.schemeProductPaths(category, model, DEFAULT_SCHEME_ID);
  }

  schemeById(schemeId) {
    return this.listSchemes().find((scheme) => scheme.id === schemeId) || null;
  }

  ensureSchemeDirectories(scheme) {
    const isDefault = !scheme || scheme.id === DEFAULT_SCHEME_ID || scheme.builtIn;
    const contentRoot = isDefault
      ? this.defaultSchemeRoot
      : path.join(this.activitySchemesRoot, scheme.directoryName || schemeDirectoryName(scheme.name, scheme.code));
    const platformRoot = isDefault ? contentRoot : path.join(contentRoot, this.platformFolder);
    for (const directory of CONTENT_DIRECTORIES) fs.mkdirSync(path.join(platformRoot, directory), { recursive: true });
    if (!isDefault) {
      const infoPath = path.join(contentRoot, '_方案信息.json');
      fs.writeFileSync(infoPath, `${JSON.stringify({
        id: scheme.id, code: scheme.code, name: scheme.name,
        startDate: scheme.startDate || '', endDate: scheme.endDate || '',
        mode: scheme.mode || 'inherit', note: '活动方案缺失的内容自动继承常规方案；封面始终来自共享素材。'
      }, null, 2)}\n`, 'utf8');
      const guide = path.join(contentRoot, '_批量填写说明.txt');
      if (!fs.existsSync(guide)) fs.writeFileSync(guide, [
        '只需填写本活动中发生变化的产品，未提供的内容会自动继承常规方案。',
        '文案库：产品型号.txt，每行一条文案。',
        'Tag库：产品型号.txt，每行一组 Tag，逗号分隔，最多5个，不写井号。',
        '商品短标题库：产品型号.txt，每行一个标题，最多10个汉字，仅抖音商城使用。',
        '封面由所有方案共享，不要复制到活动方案中。',
        ''
      ].join('\n'), 'utf8');
    }
    return platformRoot;
  }

  schemeProductPaths(category, model, schemeId = DEFAULT_SCHEME_ID) {
    const modelName = safeName(model, '未命名产品');
    const normalizedSchemeId = safeName(schemeId, DEFAULT_SCHEME_ID);
    const scheme = normalizedSchemeId === DEFAULT_SCHEME_ID ? null : this.schemeById(normalizedSchemeId);
    const contentRoot = normalizedSchemeId === DEFAULT_SCHEME_ID
      ? this.defaultSchemeRoot
      : path.join(this.activitySchemesRoot, scheme?.directoryName || normalizedSchemeId, this.platformFolder);
    return {
      coverDirectory: path.join(this.coversRoot, modelName),
      copyFile: path.join(contentRoot, '文案库', `${modelName}.txt`),
      tagsFile: path.join(contentRoot, 'Tag库', `${modelName}.txt`),
      shortTitlesFile: path.join(contentRoot, '商品短标题库', `${modelName}.txt`)
    };
  }

  listSchemes() {
    let stored = [];
    try { stored = JSON.parse(fs.readFileSync(this.schemesFile, 'utf8')); } catch {}
    if (!Array.isArray(stored)) stored = [];
    return [{ id: DEFAULT_SCHEME_ID, name: '常规方案', enabled: true, builtIn: true, code: 'S000', directoryName: '常规方案' }, ...stored]
      .filter((scheme, index, items) => scheme?.id && items.findIndex((item) => item.id === scheme.id) === index);
  }

  saveScheme(input = {}) {
    const name = String(input.name || '').trim();
    if (!name) throw new Error('素材方案名称不能为空');
    const id = safeName(input.id || `scheme-${crypto.randomUUID()}`, '');
    if (!id || id === DEFAULT_SCHEME_ID) throw new Error('素材方案标识无效');
    const startDate = String(input.startDate || '').trim();
    const endDate = String(input.endDate || '').trim();
    if ((startDate && !validDate(startDate)) || (endDate && !validDate(endDate))) throw new Error('素材方案生效日期格式不正确');
    if (startDate && endDate && startDate > endDate) throw new Error('素材方案结束日期不能早于开始日期');
    const schemes = this.listSchemes().filter((scheme) => !scheme.builtIn);
    const index = schemes.findIndex((scheme) => scheme.id === id);
    const nextCodeNumber = schemes.reduce((max, item) => Math.max(max, Number(String(item.code || '').replace(/^S/, '')) || 0), 0) + 1;
    const code = index >= 0 ? schemes[index].code : `S${String(nextCodeNumber).padStart(3, '0')}`;
    const next = {
      ...(index >= 0 ? schemes[index] : { id, createdAt: new Date().toISOString() }),
      name, startDate, endDate, enabled: input.enabled !== false,
      code,
      directoryName: index >= 0 ? schemes[index].directoryName : schemeDirectoryName(name, code),
      mode: input.mode === 'copy' ? 'copy' : input.mode === 'blank' ? 'blank' : 'inherit',
      priority: Number.isFinite(Number(input.priority)) ? Number(input.priority) : 0,
      updatedAt: new Date().toISOString()
    };
    if (index >= 0) schemes[index] = next;
    else schemes.push(next);
    fs.mkdirSync(this.schemesRoot, { recursive: true });
    const temporary = `${this.schemesFile}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(schemes, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, this.schemesFile);
    this.ensureSchemeDirectories(next);
    if (next.mode === 'copy' && input.sourceSchemeId) this.copySchemeContent(String(input.sourceSchemeId), next.id);
    return next;
  }

  schemeDirectory(schemeId = DEFAULT_SCHEME_ID) {
    if (schemeId === DEFAULT_SCHEME_ID) return this.defaultSchemeRoot;
    const scheme = this.schemeById(schemeId);
    if (!scheme) throw new Error('指定的素材方案不存在');
    this.ensureSchemeDirectories(scheme);
    return path.join(this.activitySchemesRoot, scheme.directoryName);
  }

  copySchemeContent(sourceSchemeId, targetSchemeId) {
    if (sourceSchemeId === targetSchemeId) throw new Error('不能复制到同一个方案');
    const sourcePaths = this.schemeProductPaths('', '__placeholder__', sourceSchemeId);
    const targetPaths = this.schemeProductPaths('', '__placeholder__', targetSchemeId);
    let files = 0;
    for (const [source, target] of [
      [path.dirname(sourcePaths.copyFile), path.dirname(targetPaths.copyFile)],
      [path.dirname(sourcePaths.tagsFile), path.dirname(targetPaths.tagsFile)],
      [path.dirname(sourcePaths.shortTitlesFile), path.dirname(targetPaths.shortTitlesFile)]
    ]) files += copyTreeMissing(source, target).files;
    return { files };
  }

  packageSources(schemeIds = null) {
    const selected = schemeIds ? new Set([...schemeIds].map(String)) : null;
    const sources = [
      { prefix: '封面库', root: this.coversRoot },
      { prefix: '文案库', root: this.copyRoot },
      { prefix: 'Tag库', root: this.tagsRoot },
      { prefix: '商品短标题库', root: this.shortTitlesRoot }
    ];
    for (const scheme of this.listSchemes().filter((item) => !item.builtIn)) {
      if (selected && !selected.has(scheme.id)) continue;
      const paths = this.schemeProductPaths('', '__placeholder__', scheme.id);
      sources.push(
        { prefix: `素材方案/${scheme.id}/文案库`, root: path.dirname(paths.copyFile) },
        { prefix: `素材方案/${scheme.id}/Tag库`, root: path.dirname(paths.tagsFile) },
        { prefix: `素材方案/${scheme.id}/商品短标题库`, root: path.dirname(paths.shortTitlesFile) }
      );
    }
    return sources;
  }

  packageDestination(relativePath) {
    const segments = String(relativePath || '').replace(/\\/g, '/').split('/').filter(Boolean);
    const rootName = segments.shift();
    let base;
    if (rootName === '封面库') base = this.coversRoot;
    else if (rootName === '文案库') base = this.copyRoot;
    else if (rootName === 'Tag库') base = this.tagsRoot;
    else if (rootName === '商品短标题库') base = this.shortTitlesRoot;
    else if (rootName === '素材方案') {
      const schemeId = segments.shift();
      if (segments[0] === '方案列表.json' || schemeId === '方案列表.json') return null;
      const category = segments.shift();
      const paths = this.schemeProductPaths('', '__placeholder__', schemeId);
      base = category === '文案库' ? path.dirname(paths.copyFile)
        : category === 'Tag库' ? path.dirname(paths.tagsFile)
          : category === '商品短标题库' ? path.dirname(paths.shortTitlesFile) : null;
    }
    if (!base) throw new Error(`不支持的素材包路径：${relativePath}`);
    const destination = path.resolve(base, ...segments);
    const relative = path.relative(path.resolve(base), destination);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`素材包路径越界：${relativePath}`);
    return destination;
  }

  inspectScheme(schemeId = DEFAULT_SCHEME_ID) {
    const scheme = this.schemeById(schemeId);
    if (!scheme) throw new Error('指定的素材方案不存在');
    const items = this.listProducts(schemeId);
    const issues = [];
    for (const item of items) {
      if (!item.copyCount && schemeId === DEFAULT_SCHEME_ID) issues.push(`${item.model}：缺少文案`);
      if (!item.tagGroupCount && schemeId === DEFAULT_SCHEME_ID) issues.push(`${item.model}：缺少 Tag`);
      if (!item.coverCount) issues.push(`${item.model}：缺少共享封面`);
      if (this.workspaceId === 'douyin-commerce' && !item.shortTitleCount && schemeId === DEFAULT_SCHEME_ID) issues.push(`${item.model}：缺少商品短标题`);
    }
    const overridden = items.filter((item) => item.overridden).length;
    return {
      schemeId, schemeName: scheme.name, workspaceId: this.workspaceId,
      directory: this.schemeDirectory(schemeId), products: items.length, overridden, issues
    };
  }

  resolveScheme(targetDate, requestedId = 'auto') {
    const schemes = this.listSchemes();
    if (requestedId && requestedId !== 'auto') {
      const selected = schemes.find((scheme) => scheme.id === requestedId && scheme.enabled !== false);
      if (!selected) throw new Error('指定的素材方案不存在或已停用');
      return { ...selected, selectionMode: 'manual' };
    }
    const matched = schemes.filter((scheme) => !scheme.builtIn && scheme.enabled !== false
      && (!scheme.startDate || targetDate >= scheme.startDate)
      && (!scheme.endDate || targetDate <= scheme.endDate))
      .sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0)
        || String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))[0];
    return { ...(matched || schemes[0]), selectionMode: 'auto' };
  }

  match(item, sequence = 0, options = {}) {
    const scheme = this.resolveScheme(options.targetDate || '', options.schemeId || DEFAULT_SCHEME_ID);
    const productPaths = this.schemeProductPaths(item.category, item.model, scheme.id);
    const fallbackPaths = this.productPaths(item.category, item.model);
    const copies = readVariants(productPaths.copyFile);
    const tagGroups = readVariants(productPaths.tagsFile);
    const shortTitles = readVariants(productPaths.shortTitlesFile);
    const allowsFallback = scheme.id !== DEFAULT_SCHEME_ID && scheme.mode !== 'blank';
    const resolvedCopies = copies.length || !allowsFallback ? copies : readVariants(fallbackPaths.copyFile);
    const resolvedTagGroups = tagGroups.length || !allowsFallback ? tagGroups : readVariants(fallbackPaths.tagsFile);
    const resolvedShortTitles = shortTitles.length || !allowsFallback ? shortTitles : readVariants(fallbackPaths.shortTitlesFile);
    const covers = fs.existsSync(productPaths.coverDirectory)
      ? fs.readdirSync(productPaths.coverDirectory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
        .map((entry) => path.join(productPaths.coverDirectory, entry.name))
        .sort((left, right) => left.localeCompare(right, 'zh-CN'))
      : [];
    const missing = [];
    if (!resolvedCopies.length) missing.push('文案');
    if (!resolvedTagGroups.length) missing.push('Tag');
    if (!covers.length) missing.push('封面');
    const copyOrdinal = Number.isFinite(Number(options.copyOrdinal)) ? Number(options.copyOrdinal) : sequence;
    const copyIndex = resolvedCopies.length
      ? shuffledIndex(resolvedCopies.length, copyOrdinal, `${options.randomSeed || 'legacy'}|${item.model || ''}|${scheme.id}`) : -1;
    const body = copyIndex >= 0 ? resolvedCopies[copyIndex] : '';
    const tags = resolvedTagGroups.length ? normalizeTags(resolvedTagGroups[sequence % resolvedTagGroups.length]) : [];
    if (resolvedTagGroups.length && !tags.length) missing.push('Tag内容为空');
    return {
      body,
      tags,
      coverPath: covers.length ? covers[sequence % covers.length] : null,
      productShortTitle: resolvedShortTitles.map((value) => validateShortTitle(value)).find((value) => value.valid)?.title || '',
      productShortTitles: resolvedShortTitles.map((value) => validateShortTitle(value)).filter((value) => value.valid).map((value) => value.title),
      shortTitleIssue: resolvedShortTitles.length && !resolvedShortTitles.some((value) => validateShortTitle(value).valid)
        ? '商品短标题库内容不符合平台限制' : '',
      missing: [...new Set(missing)],
      expectedPaths: productPaths,
      contentSelection: {
        schemeId: scheme.id, schemeName: scheme.name, selectionMode: scheme.selectionMode,
        copyIndex, copyHash: body ? crypto.createHash('sha256').update(body).digest('hex') : ''
      }
    };
  }

  productSummary(model, schemeId = DEFAULT_SCHEME_ID) {
    const productPaths = this.schemeProductPaths('', model, schemeId);
    const scheme = this.schemeById(schemeId);
    const fallbackPaths = this.productPaths('', model);
    const covers = fs.existsSync(productPaths.coverDirectory)
      ? fs.readdirSync(productPaths.coverDirectory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
      : [];
    const ownCopyCount = readVariants(productPaths.copyFile).length;
    const ownTagGroupCount = readVariants(productPaths.tagsFile).length;
    const ownShortTitleCount = readVariants(productPaths.shortTitlesFile).filter((value) => validateShortTitle(value).valid).length;
    const inherits = schemeId !== DEFAULT_SCHEME_ID && scheme?.mode !== 'blank';
    return {
      model: String(model || '').trim(),
      safeModel: safeName(model, '\u672a\u547d\u540d\u4ea7\u54c1'),
      copyCount: ownCopyCount || (inherits ? readVariants(fallbackPaths.copyFile).length : 0),
      tagGroupCount: ownTagGroupCount || (inherits ? readVariants(fallbackPaths.tagsFile).length : 0),
      coverCount: covers.length,
      shortTitleCount: ownShortTitleCount || (inherits ? readVariants(fallbackPaths.shortTitlesFile).filter((value) => validateShortTitle(value).valid).length : 0),
      ownCopyCount, ownTagGroupCount, ownShortTitleCount,
      inherited: inherits && !ownCopyCount && !ownTagGroupCount && !ownShortTitleCount,
      overridden: Boolean(ownCopyCount || ownTagGroupCount || ownShortTitleCount),
      paths: productPaths
    };
  }

  listProducts(schemeId = DEFAULT_SCHEME_ID) {
    const schemePaths = this.schemeProductPaths('', '__placeholder__', schemeId);
    const copyRoot = path.dirname(schemePaths.copyFile);
    const tagsRoot = path.dirname(schemePaths.tagsFile);
    const shortTitlesRoot = path.dirname(schemePaths.shortTitlesFile);
    const models = new Set();
    const addTextFiles = (directory) => {
      if (!fs.existsSync(directory)) return;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.txt' && !entry.name.startsWith('_')) {
          models.add(path.basename(entry.name, path.extname(entry.name)));
        }
      }
    };
    addTextFiles(copyRoot);
    addTextFiles(tagsRoot);
    addTextFiles(shortTitlesRoot);
    if (schemeId !== DEFAULT_SCHEME_ID) {
      addTextFiles(this.copyRoot);
      addTextFiles(this.tagsRoot);
      addTextFiles(this.shortTitlesRoot);
    }
    if (fs.existsSync(this.coversRoot)) {
      for (const entry of fs.readdirSync(this.coversRoot, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.name.startsWith('_')) models.add(entry.name);
      }
    }
    return [...models].sort((left, right) => left.localeCompare(right, 'zh-CN')).map((model) => this.productSummary(model, schemeId));
  }

  captureProduct(model, schemeId = DEFAULT_SCHEME_ID) {
    const targets = this.schemeProductPaths('', model, schemeId);
    const captureFile = (filePath) => fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
    const covers = fs.existsSync(targets.coverDirectory)
      ? fs.readdirSync(targets.coverDirectory, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => ({
        name: entry.name, data: fs.readFileSync(path.join(targets.coverDirectory, entry.name))
      })) : null;
    return {
      model, schemeId,
      copy: captureFile(targets.copyFile), tags: captureFile(targets.tagsFile), shortTitles: captureFile(targets.shortTitlesFile), covers,
      index: captureFile(path.join(this.productConfigRoot, '\u7d20\u6750\u5f55\u5165\u7d22\u5f15.json'))
    };
  }

  restoreProduct(snapshot) {
    const targets = this.schemeProductPaths('', snapshot.model, snapshot.schemeId || DEFAULT_SCHEME_ID);
    const restoreFile = (filePath, data) => {
      if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
      if (data !== null) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, data);
      }
    };
    restoreFile(targets.copyFile, snapshot.copy);
    restoreFile(targets.tagsFile, snapshot.tags);
    restoreFile(targets.shortTitlesFile, snapshot.shortTitles);
    if (fs.existsSync(targets.coverDirectory)) fs.rmSync(targets.coverDirectory, { recursive: true, force: true });
    if (snapshot.covers !== null) {
      fs.mkdirSync(targets.coverDirectory, { recursive: true });
      for (const cover of snapshot.covers) fs.writeFileSync(path.join(targets.coverDirectory, cover.name), cover.data);
    }
    restoreFile(path.join(this.productConfigRoot, '\u7d20\u6750\u5f55\u5165\u7d22\u5f15.json'), snapshot.index);
  }

  saveProduct(input = {}) {
    const model = String(input.model || '').trim();
    if (!model) throw new Error('\u4ea7\u54c1\u578b\u53f7\u4e0d\u80fd\u4e3a\u7a7a');
    const safeModel = safeName(model, '');
    if (!safeModel) throw new Error('\u4ea7\u54c1\u578b\u53f7\u65e0\u6cd5\u751f\u6210\u5b89\u5168\u6587\u4ef6\u540d');
    const mode = input.mode === 'replace' ? 'replace' : 'append';
    const materialIndexPath = path.join(this.productConfigRoot, '\u7d20\u6750\u5f55\u5165\u7d22\u5f15.json');
    let materialIndex = {};
    try { materialIndex = JSON.parse(fs.readFileSync(materialIndexPath, 'utf8')); } catch {}
    if (materialIndex[safeModel] && materialIndex[safeModel] !== model) {
      throw new Error(`\u4ea7\u54c1\u578b\u53f7\u201c${model}\u201d\u4e0e\u5df2\u6709\u578b\u53f7\u201c${materialIndex[safeModel]}\u201d\u4f1a\u751f\u6210\u540c\u4e00\u672c\u5730\u8def\u5f84\uff0c\u8bf7\u8c03\u6574\u578b\u53f7`);
    }
    const copies = uniqueLines(input.copies);
    const tagGroups = uniqueLines(input.tagGroups).map((group) => {
      const tags = normalizeTags(group);
      if (!tags.length) throw new Error('Tag\u65b9\u6848\u4e0d\u80fd\u4e3a\u7a7a');
      const sourceCount = String(group).split(/[\uff0c,\n]/).map((value) => value.trim()).filter(Boolean).length;
      if (sourceCount > 5) throw new Error(`Tag\u65b9\u6848\u201c${group}\u201d\u8d85\u8fc75\u4e2a`);
      return tags.join(',');
    });
    const shortTitles = uniqueLines(input.shortTitles).map((value) => {
      const checked = validateShortTitle(value);
      if (!checked.valid) throw new Error(checked.reason);
      return checked.title;
    });
    const coverPaths = uniqueLines(input.coverPaths);
    for (const coverPath of coverPaths) {
      const resolved = path.resolve(coverPath);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw new Error(`\u5c01\u9762\u6587\u4ef6\u4e0d\u5b58\u5728\uff1a${coverPath}`);
      if (!IMAGE_EXTENSIONS.has(path.extname(resolved).toLowerCase())) throw new Error(`\u5c01\u9762\u683c\u5f0f\u4e0d\u53d7\u652f\u6301\uff1a${coverPath}`);
      validateImageFile(resolved);
    }

    const schemeId = String(input.schemeId || DEFAULT_SCHEME_ID);
    if (!this.listSchemes().some((scheme) => scheme.id === schemeId)) throw new Error('要写入的素材方案不存在');
    const targets = this.schemeProductPaths('', model, schemeId);
    const stageRoot = path.join(this.root, `.material-stage-${crypto.randomUUID()}`);
    const stage = {
      copyFile: path.join(stageRoot, '\u6587\u6848.txt'),
      tagsFile: path.join(stageRoot, 'Tag.txt'),
      shortTitlesFile: path.join(stageRoot, '\u5546\u54c1\u77ed\u6807\u9898.txt'),
      coverDirectory: path.join(stageRoot, '\u5c01\u9762')
    };
    const backups = [];
    const createdTargets = [];
    try {
      fs.mkdirSync(stageRoot, { recursive: true });
      const nextCopies = mode === 'append' ? uniqueLines([...readVariants(targets.copyFile), ...copies]) : copies;
      const nextTags = mode === 'append' ? uniqueLines([...readVariants(targets.tagsFile), ...tagGroups]) : tagGroups;
      const nextTitles = mode === 'append' ? uniqueLines([...readVariants(targets.shortTitlesFile), ...shortTitles]) : shortTitles;
      fs.writeFileSync(stage.copyFile, nextCopies.length ? `${nextCopies.join('\n')}\n` : '', 'utf8');
      fs.writeFileSync(stage.tagsFile, nextTags.length ? `${nextTags.join('\n')}\n` : '', 'utf8');
      fs.writeFileSync(stage.shortTitlesFile, nextTitles.length ? `${nextTitles.join('\n')}\n` : '', 'utf8');
      const editsSharedCovers = schemeId === DEFAULT_SCHEME_ID;
      if (editsSharedCovers && mode === 'append') copyDirectory(targets.coverDirectory, stage.coverDirectory);
      else fs.mkdirSync(stage.coverDirectory, { recursive: true });
      const knownHashes = new Set(fs.readdirSync(stage.coverDirectory, { withFileTypes: true })
        .filter((entry) => entry.isFile()).map((entry) => fileHash(path.join(stage.coverDirectory, entry.name))));
      let coversAdded = 0;
      for (const source of editsSharedCovers ? coverPaths : []) {
        const hash = fileHash(source);
        if (knownHashes.has(hash)) continue;
        knownHashes.add(hash);
        const extension = path.extname(source).toLowerCase();
        const base = safeName(path.basename(source, path.extname(source)), '\u5c01\u9762');
        let name = `${base}${extension}`;
        let suffix = 2;
        while (fs.existsSync(path.join(stage.coverDirectory, name))) name = `${base}-${suffix++}${extension}`;
        fs.copyFileSync(source, path.join(stage.coverDirectory, name));
        coversAdded += 1;
      }

      const commitTargets = [
        [stage.copyFile, targets.copyFile],
        [stage.tagsFile, targets.tagsFile],
        [stage.shortTitlesFile, targets.shortTitlesFile]
      ];
      if (editsSharedCovers) commitTargets.push([stage.coverDirectory, targets.coverDirectory]);
      if (mode === 'replace' && commitTargets.some(([, target]) => fs.existsSync(target))) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupRoot = path.join(this.productConfigRoot, '\u7d20\u6750\u5907\u4efd', `${stamp}-${safeModel}`);
        fs.mkdirSync(backupRoot, { recursive: true });
        for (const [, target] of commitTargets) {
          if (!fs.existsSync(target)) continue;
          const destination = path.join(backupRoot, path.basename(target));
          if (fs.statSync(target).isDirectory()) copyDirectory(target, destination);
          else fs.copyFileSync(target, destination);
        }
      }
      for (const [, target] of commitTargets) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (fs.existsSync(target)) {
          if (fs.lstatSync(target).isSymbolicLink()) throw new Error(`\u76ee\u6807\u8def\u5f84\u662f\u94fe\u63a5\uff0c\u5df2\u62d2\u7edd\u8986\u76d6\uff1a${target}`);
          const backup = `${target}.backup-${crypto.randomUUID()}`;
          fs.renameSync(target, backup);
          backups.push([target, backup]);
        } else createdTargets.push(target);
      }
      for (const [source, target] of commitTargets) fs.renameSync(source, target);
      for (const [, backup] of backups) fs.rmSync(backup, { recursive: true, force: true });
      materialIndex[safeModel] = model;
      const indexTemporary = `${materialIndexPath}.tmp`;
      fs.writeFileSync(indexTemporary, `${JSON.stringify(materialIndex, null, 2)}\n`, 'utf8');
      fs.renameSync(indexTemporary, materialIndexPath);
      const summary = this.productSummary(model, schemeId);
      const auditPath = path.join(this.productConfigRoot, '\u7d20\u6750\u53d8\u66f4\u8bb0\u5f55.jsonl');
      fs.appendFileSync(auditPath, `${JSON.stringify({ at: new Date().toISOString(), workspaceId: this.workspaceId, schemeId, model, safeModel, mode, added: { copies: copies.length, tagGroups: tagGroups.length, covers: coversAdded, shortTitles: shortTitles.length }, totals: summary })}\n`, 'utf8');
      return { ...summary, mode, coversAdded };
    } catch (error) {
      for (const target of createdTargets) {
        if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
      }
      for (const [target, backup] of backups.reverse()) {
        if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
        if (fs.existsSync(backup)) fs.renameSync(backup, target);
      }
      throw error;
    } finally {
      if (fs.existsSync(stageRoot)) fs.rmSync(stageRoot, { recursive: true, force: true });
    }
  }

  saveProductShortTitle(model, value, schemeId = DEFAULT_SCHEME_ID) {
    const title = validateShortTitle(value);
    if (!title.valid) throw new Error(title.reason);
    const filePath = this.schemeProductPaths('', model, schemeId).shortTitlesFile;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const current = readVariants(filePath);
    if (!current.includes(title.title)) {
      const next = [...current, title.title];
      const temporary = `${filePath}.tmp`;
      fs.writeFileSync(temporary, `${next.join('\n')}\n`, 'utf8');
      fs.renameSync(temporary, filePath);
    }
    return { filePath, title: title.title };
  }

  clearCache() {
    const cacheRoot = path.resolve(this.cacheRoot);
    const expectedParent = path.resolve(this.root);
    if (path.dirname(cacheRoot) !== expectedParent || path.basename(cacheRoot) !== '下载缓存') {
      throw new Error('缓存目录校验失败，未执行清理');
    }
    fs.mkdirSync(cacheRoot, { recursive: true });
    const entries = fs.readdirSync(cacheRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error(`缓存中存在链接文件，已停止清理：${entry.name}`);
    }
    for (const entry of entries) fs.rmSync(path.join(cacheRoot, entry.name), { recursive: true, force: false });
    return { removed: entries.length, cacheRoot };
  }
}

module.exports = { LibraryStore, safeName, readVariants };
