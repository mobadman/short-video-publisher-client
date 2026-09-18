const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RunReporter } = require('../src/run-reporter');

test('性能报告记录阶段耗时和批次总耗时', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-reporter-'));
  const reporter = new RunReporter(root, '性能测试');
  const result = await reporter.measure('读取素材', async () => 'ok', '第1条');
  assert.equal(result, 'ok');
  const reportPath = await reporter.save('completed', null, null);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.equal(report.timings.length, 1);
  assert.equal(report.timings[0].phase, '读取素材');
  assert.equal(report.timings[0].detail, '第1条');
  assert.ok(report.timings[0].durationMs >= 0);
  assert.ok(report.totalDurationMs >= report.timings[0].durationMs);
});
