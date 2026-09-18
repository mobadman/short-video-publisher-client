const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { FEISHU_CHROMIUM_VERSION, resolveFeishuChromiumPath } = require('../src/browser-runtime');

(async () => {
  const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-chromium-smoke-'));
  const executablePath = process.argv[2] ? path.resolve(process.argv[2]) : resolveFeishuChromiumPath();
  assert.equal(fs.existsSync(executablePath), true, `没有找到待验证的飞书浏览器：${executablePath}`);
  const context = await chromium.launchPersistentContext(profilePath, {
    executablePath,
    chromiumSandbox: true,
    headless: true,
    args: ['--enable-automation']
  });
  try {
    const browser = context.browser();
    assert.match(browser.version(), new RegExp(`^${FEISHU_CHROMIUM_VERSION.replace(/\./g, '\\.')}\\b`));
    const page = context.pages()[0] || await context.newPage();
    const session = await context.newCDPSession(page);
    const commandLine = (await session.send('Browser.getBrowserCommandLine')).arguments;
    assert.equal(commandLine.includes('--no-sandbox'), false, '飞书固定Chromium不应使用--no-sandbox');
    await page.goto('data:text/html,<title>feishu-browser-smoke</title>');
    assert.equal(await page.title(), 'feishu-browser-smoke');
    process.stdout.write(`飞书固定Chromium检查通过：${browser.version()}，沙箱已启用\n`);
  } finally {
    await context.close();
  }
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
