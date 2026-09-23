function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const source = String(text || '').replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') { row.push(cell); cell = ''; }
    else if (character === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += character;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  if (quoted) throw new Error('CSV 中存在未闭合的双引号');
  return rows.filter((item) => item.some((value) => String(value).trim()));
}

function parseMaterialRows(text, workspaces) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('批量素材表为空');
  const headers = rows.shift().map((value) => String(value).trim());
  const required = ['工作区', '产品型号', '文案', 'Tag', '商品短标题'];
  const indexes = Object.fromEntries(required.map((name) => [name, headers.indexOf(name)]));
  if (indexes['工作区'] < 0 || indexes['产品型号'] < 0) throw new Error('CSV 必须包含“工作区”和“产品型号”列');
  const workspaceMap = new Map();
  for (const workspace of workspaces) {
    workspaceMap.set(String(workspace.id).trim(), workspace.id);
    workspaceMap.set(String(workspace.name).trim(), workspace.id);
  }
  const groups = new Map();
  const errors = [];
  rows.forEach((values, offset) => {
    const line = offset + 2;
    const workspaceValue = String(values[indexes['工作区']] || '').trim();
    const workspaceId = workspaceMap.get(workspaceValue);
    const model = String(values[indexes['产品型号']] || '').trim();
    if (!workspaceId) { errors.push(`第${line}行：工作区“${workspaceValue}”不存在`); return; }
    if (!model) { errors.push(`第${line}行：产品型号为空`); return; }
    const key = `${workspaceId}\u0000${model}`;
    if (!groups.has(key)) groups.set(key, { workspaceId, model, copies: [], tagGroups: [], shortTitles: [] });
    const group = groups.get(key);
    const copy = indexes['文案'] >= 0 ? String(values[indexes['文案']] || '').trim() : '';
    const tags = indexes.Tag >= 0 ? String(values[indexes.Tag] || '').trim() : '';
    const shortTitle = indexes['商品短标题'] >= 0 ? String(values[indexes['商品短标题']] || '').trim() : '';
    if (copy) group.copies.push(copy);
    if (tags) group.tagGroups.push(tags);
    if (shortTitle) group.shortTitles.push(shortTitle);
  });
  if (errors.length) throw new Error(errors.slice(0, 8).join('\n'));
  for (const group of groups.values()) {
    if (!group.copies.length && !group.tagGroups.length && !group.shortTitles.length) errors.push(`${group.model}：文案、Tag 和商品短标题不能全部为空`);
  }
  if (errors.length) throw new Error(errors.slice(0, 8).join('\n'));
  if (!groups.size) throw new Error('批量素材表中没有可写入的内容');
  return [...groups.values()];
}

function templateCsv(workspaces) {
  const examples = workspaces.map((workspace) => `${workspace.name},示例型号,每行代表一条文案,"家电,活动,新品",示例短标题`);
  return `\uFEFF工作区,产品型号,文案,Tag,商品短标题\r\n${examples.join('\r\n')}\r\n`;
}

module.exports = { parseCsv, parseMaterialRows, templateCsv };
