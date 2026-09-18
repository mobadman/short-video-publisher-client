const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FeishuService, parseSheetUrl, parseTsv, extractHttps, columnName, isAiMarked } = require('../src/feishu-service');

const columns = {
  material: '素材链接', category: '产品类目', model: '产品型号', publishDate: '发布时间', allowPublish: '允许发布', aiGenerated: 'AI标识'
};

test('从飞书链接解析表格和工作表标识', () => {
  assert.deepEqual(
    parseSheetUrl('https://example.feishu.cn/sheets/abcDEF123?sheet=mlxXMF'),
    { spreadsheetToken: 'abcDEF123', sheetId: 'mlxXMF', sourceType: 'sheets' }
  );
});

test('飞书知识库中的电子表格链接也可解析', () => {
  assert.deepEqual(
    parseSheetUrl('https://example.feishu.cn/wiki/Pj1Vw2rwziqlOmkYJAmc1RO2nJc?sheet=t00WHd'),
    { spreadsheetToken: 'Pj1Vw2rwziqlOmkYJAmc1RO2nJc', sheetId: 't00WHd', sourceType: 'wiki' }
  );
});

test('知识库表格节点直链不要求额外的sheet参数', () => {
  assert.deepEqual(
    parseSheetUrl('https://example.feishu.cn/wiki/YoC3w8eOFi9iQikhhkxcOXsanbc'),
    { spreadsheetToken: 'YoC3w8eOFi9iQikhhkxcOXsanbc', sheetId: null, sourceType: 'wiki' }
  );
});

test('解析飞书复制出的制表符数据和带换行的引号字段', () => {
  assert.deepEqual(parseTsv('A\tB\n1\t"两行\n文字"'), [['A', 'B'], ['1', '两行\n文字']]);
  assert.equal(extractHttps('素材：https://example.com/video.mp4'), 'https://example.com/video.mp4');
  assert.equal(columnName(0), 'A');
  assert.equal(columnName(28), 'AC');
});

test('按日期读取并在允许发布列存在时过滤', async () => {
  const copied = [
    '素材链接\t产品类目\t产品型号\t发布时间\t允许发布\tAI标识',
    'https://example.com/a.mp4\t冰箱\tA\t2026/8/21\t是\tTRUE',
    'https://example.com/b.mp4\t洗衣机\tB\t2026/8/21\t否\tFALSE',
    'https://example.com/c.mp4\t空调\tC\t2026/8/22\t是\tFALSE'
  ].join('\n');
  const browser = { copySheet: async () => copied };
  const service = new FeishuService(browser);
  const result = await service.rowsForDate({
    sheetUrl: 'https://example.feishu.cn/sheets/token?sheet=sheet1', columns
  }, '2026-08-21');
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].model, 'A');
  assert.equal(result.rows[0].aiGenerated, true);
  assert.equal(result.allowColumnExists, true);
  assert.equal(result.aiColumnExists, true);
});

test('AI标识兼容飞书复选框和常用人工标记', () => {
  assert.equal(isAiMarked('TRUE'), true);
  assert.equal(isAiMarked('☑'), true);
  assert.equal(isAiMarked('内容由AI生成'), true);
  assert.equal(isAiMarked('FALSE'), false);
  assert.equal(isAiMarked(''), false);
});

test('素材单元格复制为文件名时记录附件单元格而不要求网址', async () => {
  const browser = { copySheet: async () => '素材链接\t产品类目\t产品型号\t发布时间\n视频文件\t冰箱\tA\t2026-08-21' };
  const service = new FeishuService(browser);
  const result = await service.rowsForDate({
    sheetUrl: 'https://example.feishu.cn/sheets/token?sheet=sheet1', columns
  }, '2026-08-21');
  assert.equal(result.rows[0].materialLink, '');
  assert.equal(result.rows[0].materialText, '视频文件');
  assert.equal(result.rows[0].materialCell, 'A2');
  assert.deepEqual(result.rows[0].sourceMissing, []);
});

test('下载附件后把飞书实际单元格行号写回计划数据', async () => {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-actual-row-'));
  const browser = {
    downloadAttachment: async (_sheetUrl, _cell, outputPath) => {
      fs.writeFileSync(outputPath, 'video');
      return { outputPath, actualCell: 'C1737' };
    }
  };
  const service = new FeishuService(browser);
  const item = {
    sourceRow: 2, materialLink: '', materialText: '原素材.mp4', materialCell: 'C2',
    sourceSheetUrl: 'https://example.feishu.cn/sheets/token?sheet=sheet1', model: 'A'
  };
  await service.downloadMaterial(item, cacheRoot);
  assert.equal(item.actualMaterialCell, 'C1737');
  assert.equal(item.actualSourceRow, 1737);
});

test('建立附件下载任务后无需等待落盘即可继续发起下一条', async () => {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-transfer-pipeline-'));
  const started = [];
  const browser = {
    beginAttachmentDownload: async (_sheetUrl, cell, name) => {
      started.push(`${cell}:${name}`);
      return {
        actualCell: cell === 'C2' ? 'C1737' : 'C1738',
        download: { saveAs: async (outputPath) => { fs.writeFileSync(outputPath, name); } }
      };
    }
  };
  const service = new FeishuService(browser);
  const first = await service.beginMaterialDownload({ sourceRow: 2, materialLink: '', materialText: 'first.mp4', materialCell: 'C2', sourceSheetUrl: 'https://example.feishu.cn/sheets/token?sheet=sheet1', model: 'A' }, cacheRoot);
  const second = await service.beginMaterialDownload({ sourceRow: 3, materialLink: '', materialText: 'second.mp4', materialCell: 'C3', sourceSheetUrl: 'https://example.feishu.cn/sheets/token?sheet=sheet1', model: 'B' }, cacheRoot);
  assert.deepEqual(started, ['C2:first.mp4', 'C3:second.mp4']);
  assert.equal(fs.existsSync(first.outputPath), false);
  await Promise.all([first.complete(), second.complete()]);
  assert.equal(fs.readFileSync(first.outputPath, 'utf8'), 'first.mp4');
  assert.equal(fs.readFileSync(second.outputPath, 'utf8'), 'second.mp4');
});

test('飞书浏览器在附件下载中崩溃时只重启并重试当前素材一次', async () => {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-crash-recovery-'));
  let attempts = 0;
  let recoveries = 0;
  const browser = {
    downloadAttachment: async (_sheetUrl, _cell, outputPath) => {
      attempts += 1;
      if (attempts === 1) throw new Error('download.saveAs: Target page, context or browser has been closed');
      fs.writeFileSync(outputPath, 'video-after-recovery');
      return { outputPath, actualCell: 'C1737' };
    },
    recoverAfterUnexpectedClose: async () => { recoveries += 1; }
  };
  const service = new FeishuService(browser);
  const item = {
    sourceRow: 2, materialLink: '', materialText: '原素材.mp4', materialCell: 'C2',
    sourceSheetUrl: 'https://example.feishu.cn/sheets/token?sheet=sheet1', model: 'A'
  };
  const result = await service.downloadMaterial(item, cacheRoot);
  assert.equal(attempts, 2);
  assert.equal(recoveries, 1);
  assert.equal(fs.readFileSync(result, 'utf8'), 'video-after-recovery');
});

test('飞书附件非浏览器崩溃错误不会自动重试', async () => {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-no-retry-'));
  let attempts = 0;
  const browser = {
    downloadAttachment: async () => { attempts += 1; throw new Error('没有找到下载按钮'); },
    recoverAfterUnexpectedClose: async () => { throw new Error('不应执行恢复'); }
  };
  const service = new FeishuService(browser);
  await assert.rejects(() => service.downloadMaterial({
    sourceRow: 2, materialLink: '', materialText: '原素材.mp4', materialCell: 'C2',
    sourceSheetUrl: 'https://example.feishu.cn/sheets/token?sheet=sheet1', model: 'A'
  }, cacheRoot), /没有找到下载按钮/);
  assert.equal(attempts, 1);
});
