const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizeTags } = require('./test-publish');
const { validateShortTitle } = require('./commerce-product-title');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);

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

class LibraryStore {
  constructor(dataRoot, workspaceId = '') {
    this.workspaceId = String(workspaceId || '').trim();
    this.root = this.workspaceId
      ? path.join(dataRoot, '工作区', safeName(this.workspaceId, 'default'), '本地素材库')
      : path.join(dataRoot, '本地素材库');
    this.coversRoot = path.join(this.root, '封面库');
    this.copyRoot = path.join(this.root, '文案库');
    this.tagsRoot = path.join(this.root, 'Tag库');
    this.shortTitlesRoot = path.join(this.root, '商品短标题库');
    this.productConfigRoot = path.join(this.root, '商品配置');
    this.productMappingFile = path.join(this.productConfigRoot, '产品型号映射.csv');
    this.cacheRoot = path.join(this.root, '下载缓存');
    this.logsRoot = path.join(this.root, '发布日志');
    this.recordsRoot = path.join(this.root, '发布ID记录');
  }

  initialize() {
    for (const directory of Object.values(this.paths())) fs.mkdirSync(directory, { recursive: true });
    this.writeInstructions();
    return this.paths();
  }

  paths() {
    return {
      root: this.root,
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
    const modelName = safeName(model, '未命名产品');
    return {
      coverDirectory: path.join(this.coversRoot, modelName),
      copyFile: path.join(this.copyRoot, `${modelName}.txt`),
      tagsFile: path.join(this.tagsRoot, `${modelName}.txt`),
      shortTitlesFile: path.join(this.shortTitlesRoot, `${modelName}.txt`)
    };
  }

  match(item, sequence = 0) {
    const productPaths = this.productPaths(item.category, item.model);
    const copies = readVariants(productPaths.copyFile);
    const tagGroups = readVariants(productPaths.tagsFile);
    const shortTitles = readVariants(productPaths.shortTitlesFile);
    const covers = fs.existsSync(productPaths.coverDirectory)
      ? fs.readdirSync(productPaths.coverDirectory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
        .map((entry) => path.join(productPaths.coverDirectory, entry.name))
        .sort((left, right) => left.localeCompare(right, 'zh-CN'))
      : [];
    const missing = [];
    if (!copies.length) missing.push('文案');
    if (!tagGroups.length) missing.push('Tag');
    if (!covers.length) missing.push('封面');
    const body = copies.length ? copies[sequence % copies.length] : '';
    const tags = tagGroups.length ? normalizeTags(tagGroups[sequence % tagGroups.length]) : [];
    if (tagGroups.length && !tags.length) missing.push('Tag内容为空');
    return {
      body,
      tags,
      coverPath: covers.length ? covers[sequence % covers.length] : null,
      productShortTitle: shortTitles.map((value) => validateShortTitle(value)).find((value) => value.valid)?.title || '',
      productShortTitles: shortTitles.map((value) => validateShortTitle(value)).filter((value) => value.valid).map((value) => value.title),
      shortTitleIssue: shortTitles.length && !shortTitles.some((value) => validateShortTitle(value).valid)
        ? '商品短标题库内容不符合平台限制' : '',
      missing: [...new Set(missing)],
      expectedPaths: productPaths
    };
  }

  productSummary(model) {
    const productPaths = this.productPaths('', model);
    const covers = fs.existsSync(productPaths.coverDirectory)
      ? fs.readdirSync(productPaths.coverDirectory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
      : [];
    return {
      model: String(model || '').trim(),
      safeModel: safeName(model, '\u672a\u547d\u540d\u4ea7\u54c1'),
      copyCount: readVariants(productPaths.copyFile).length,
      tagGroupCount: readVariants(productPaths.tagsFile).length,
      coverCount: covers.length,
      shortTitleCount: readVariants(productPaths.shortTitlesFile).filter((value) => validateShortTitle(value).valid).length,
      paths: productPaths
    };
  }

  listProducts() {
    const models = new Set();
    const addTextFiles = (directory) => {
      if (!fs.existsSync(directory)) return;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.txt' && !entry.name.startsWith('_')) {
          models.add(path.basename(entry.name, path.extname(entry.name)));
        }
      }
    };
    addTextFiles(this.copyRoot);
    addTextFiles(this.tagsRoot);
    addTextFiles(this.shortTitlesRoot);
    if (fs.existsSync(this.coversRoot)) {
      for (const entry of fs.readdirSync(this.coversRoot, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.name.startsWith('_')) models.add(entry.name);
      }
    }
    return [...models].sort((left, right) => left.localeCompare(right, 'zh-CN')).map((model) => this.productSummary(model));
  }

  captureProduct(model) {
    const targets = this.productPaths('', model);
    const captureFile = (filePath) => fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
    const covers = fs.existsSync(targets.coverDirectory)
      ? fs.readdirSync(targets.coverDirectory, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => ({
        name: entry.name, data: fs.readFileSync(path.join(targets.coverDirectory, entry.name))
      })) : null;
    return {
      model,
      copy: captureFile(targets.copyFile), tags: captureFile(targets.tagsFile), shortTitles: captureFile(targets.shortTitlesFile), covers,
      index: captureFile(path.join(this.productConfigRoot, '\u7d20\u6750\u5f55\u5165\u7d22\u5f15.json'))
    };
  }

  restoreProduct(snapshot) {
    const targets = this.productPaths('', snapshot.model);
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

    const targets = this.productPaths('', model);
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
      if (mode === 'append') copyDirectory(targets.coverDirectory, stage.coverDirectory);
      else fs.mkdirSync(stage.coverDirectory, { recursive: true });
      const knownHashes = new Set(fs.readdirSync(stage.coverDirectory, { withFileTypes: true })
        .filter((entry) => entry.isFile()).map((entry) => fileHash(path.join(stage.coverDirectory, entry.name))));
      let coversAdded = 0;
      for (const source of coverPaths) {
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
        [stage.shortTitlesFile, targets.shortTitlesFile],
        [stage.coverDirectory, targets.coverDirectory]
      ];
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
      const summary = this.productSummary(model);
      const auditPath = path.join(this.productConfigRoot, '\u7d20\u6750\u53d8\u66f4\u8bb0\u5f55.jsonl');
      fs.appendFileSync(auditPath, `${JSON.stringify({ at: new Date().toISOString(), workspaceId: this.workspaceId, model, safeModel, mode, added: { copies: copies.length, tagGroups: tagGroups.length, covers: coversAdded, shortTitles: shortTitles.length }, totals: summary })}\n`, 'utf8');
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

  saveProductShortTitle(model, value) {
    const title = validateShortTitle(value);
    if (!title.valid) throw new Error(title.reason);
    const filePath = this.productPaths('', model).shortTitlesFile;
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
