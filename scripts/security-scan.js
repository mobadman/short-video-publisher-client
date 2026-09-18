const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const sourceRoots = ['src', 'scripts'];
const textExtensions = new Set(['.js', '.json', '.html', '.css', '.md', '.yml', '.yaml']);

function walk(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function findingsFor(filePath, text) {
  const findings = [];
  const rules = [
    ['真实飞书文档地址', /https:\/\/[a-z0-9-]+\.feishu\.cn\/(?:wiki|sheets?)\/[A-Za-z0-9_-]{8,}/gi],
    ['Windows 用户绝对路径', /[A-Za-z]:\\Users\\[^\\\s"']+/g],
    ['GitHub 访问令牌', /\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{20,}\b/g],
    ['私钥标记', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g]
  ];
  for (const [label, pattern] of rules) {
    if (pattern.test(text)) findings.push(`${path.relative(projectRoot, filePath)}: ${label}`);
  }
  return findings;
}

function scan() {
  const files = sourceRoots.flatMap((folder) => walk(path.join(projectRoot, folder)))
    .filter((filePath) => textExtensions.has(path.extname(filePath).toLowerCase()));
  return files.flatMap((filePath) => findingsFor(filePath, fs.readFileSync(filePath, 'utf8')));
}

const findings = scan();
if (require.main === module) {
  if (findings.length) {
    console.error('安全扫描失败：');
    for (const finding of findings) console.error(`- ${finding}`);
    process.exitCode = 1;
  } else {
    console.log(`安全扫描通过：已检查 ${sourceRoots.join('、')} 中的可发布文本文件。`);
  }
}

module.exports = { findingsFor, scan };
