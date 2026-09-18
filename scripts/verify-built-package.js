const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');
const packageJson = require('../package.json');

const projectRoot = path.resolve(__dirname, '..');
const outputRoot = path.resolve(projectRoot, packageJson.build.directories.output);
const asarPath = path.join(outputRoot, 'win-unpacked', 'resources', 'app.asar');

if (!fs.existsSync(asarPath)) throw new Error(`找不到待复检的安装包内容：${asarPath}`);

const configSource = asar.extractFile(asarPath, 'src/config-store.js').toString('utf8');
if (!/sheetUrl:\s*['"]['"]/.test(configSource)) {
  throw new Error('打包产物中的默认飞书链接不是空值，禁止发布');
}

const privateFeishuDocument = /https:\/\/[a-z0-9-]+\.feishu\.cn\/(?:wiki|sheets?)\/[A-Za-z0-9_-]{8,}/i;
const personalWindowsPath = /[A-Za-z]:\\Users\\[^\\\s"']+/;
const token = /\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{20,}\b/;
const findings = [];

for (const entry of asar.listPackage(asarPath)) {
  const extractionPath = entry.replace(/^[/\\]+/, '');
  const normalized = extractionPath.replaceAll('\\', '/');
  if (!(normalized === 'package.json' || normalized.startsWith('src/'))) continue;
  if (!/\.(?:js|json|html|css|md|yml|yaml)$/i.test(normalized)) continue;
  const text = asar.extractFile(asarPath, extractionPath).toString('utf8');
  if (privateFeishuDocument.test(text)) findings.push(`${normalized}: 真实飞书文档地址`);
  if (personalWindowsPath.test(text)) findings.push(`${normalized}: Windows 用户绝对路径`);
  if (token.test(text)) findings.push(`${normalized}: 访问令牌`);
}

if (findings.length) throw new Error(`打包产物安全复检失败：\n${findings.join('\n')}`);
console.log(`打包产物安全复检通过：${packageJson.version}，默认飞书链接为空。`);
