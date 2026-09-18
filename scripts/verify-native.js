const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { FEISHU_CHROMIUM_REVISION, FEISHU_CHROMIUM_VERSION, resolveFeishuChromiumPath } = require('../src/browser-runtime');

const validatedHash = '2A8CE30A7391B666DFA71D3ED87D5E15BEDBEDD380ADDBEAAB936F27DA2DFF23';
const helperPath = path.join(__dirname, '..', 'native', 'FileDialogHelper.exe');

if (!fs.existsSync(helperPath)) throw new Error('缺少已验证的封面文件选择辅助程序');
const actualHash = crypto.createHash('sha256').update(fs.readFileSync(helperPath)).digest('hex').toUpperCase();
if (actualHash !== validatedHash) {
  throw new Error(`封面文件选择辅助程序不是3.0.7沿用的兼容补丁版本，已停止打包。期望 ${validatedHash}，实际 ${actualHash}`);
}
process.stdout.write(`封面辅助程序校验通过：${actualHash}\n`);

const browserPath = resolveFeishuChromiumPath({ resourcesPath: '', projectRoot: path.join(__dirname, '..') });
const browserDirectory = path.dirname(browserPath);
const requiredBrowserFiles = [
  ['chrome.exe', 1_000_000],
  ['chrome.dll', 100_000_000],
  ['icudtl.dat', 1_000_000]
];
for (const [name, minimumBytes] of requiredBrowserFiles) {
  const filePath = path.join(browserDirectory, name);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size < minimumBytes) {
    throw new Error(`飞书专用Chromium文件缺失或不完整：${name}`);
  }
}
process.stdout.write(`飞书专用Chromium校验通过：${FEISHU_CHROMIUM_VERSION}（revision ${FEISHU_CHROMIUM_REVISION}）\n`);
