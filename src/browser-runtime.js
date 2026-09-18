const fs = require('node:fs');
const path = require('node:path');

const FEISHU_CHROMIUM_REVISION = '1208';
const FEISHU_CHROMIUM_VERSION = '145.0.7632.6';
const CHROMIUM_EXECUTABLE_PARTS = [`chromium-${FEISHU_CHROMIUM_REVISION}`, 'chrome-win64', 'chrome.exe'];

function feishuChromiumCandidates(options = {}) {
  const resourcesPath = options.resourcesPath || process.resourcesPath || '';
  const projectRoot = options.projectRoot || path.join(__dirname, '..');
  return [
    resourcesPath && path.join(resourcesPath, 'browsers', ...CHROMIUM_EXECUTABLE_PARTS),
    path.join(projectRoot, '.playwright-browsers', ...CHROMIUM_EXECUTABLE_PARTS)
  ].filter(Boolean);
}

function resolveFeishuChromiumPath(options = {}) {
  const candidates = feishuChromiumCandidates(options);
  const executablePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!executablePath) {
    throw new Error(`缺少软件内置的飞书专用Chromium ${FEISHU_CHROMIUM_VERSION}，请重新安装完整的3.0.8安装包`);
  }
  return executablePath;
}

function isBrowserClosedError(error) {
  return /Target page, context or browser has been closed|browser has been closed|context closed|page crashed|browser closed/i
    .test(String(error?.message || error || ''));
}

module.exports = {
  FEISHU_CHROMIUM_REVISION,
  FEISHU_CHROMIUM_VERSION,
  CHROMIUM_EXECUTABLE_PARTS,
  feishuChromiumCandidates,
  resolveFeishuChromiumPath,
  isBrowserClosedError
};
