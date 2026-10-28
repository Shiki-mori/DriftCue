import { readdir, readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
async function files(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await files(p)); else result.push(p);
  }
  return result;
}
const source = await files('extension');
for (const file of [...source, ...await files('scripts'), ...await files('tests')].filter(p => p.endsWith('.js'))) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status) throw new Error(result.stderr);
}
const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
for (const file of [manifest.background.service_worker, manifest.action.default_popup, manifest.options_page, ...Object.values(manifest.icons)]) await access(`extension/${file}`);
for (const file of source.filter(p => p.endsWith('.html'))) {
  const html = await readFile(file, 'utf8');
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html) || /\bon\w+\s*=/i.test(html)) throw new Error(`CSP 禁止内联脚本：${file}`);
  for (const match of html.matchAll(/(?:src|href)="([^"#:]+)"/g)) if (!match[1].includes('://')) await access(path.join(path.dirname(file), match[1]));
}
for (const file of source.filter(p => p.endsWith('.js'))) {
  const text = await readFile(file, 'utf8');
  if (/\beval\s*\(|\bfetch\s*\(|XMLHttpRequest|\.innerHTML\s*=|\.outerHTML\s*=/.test(text)) throw new Error(`扩展不得远程请求或解析用户 HTML：${file}`);
}
console.log(`静态检查通过：${source.length} 个扩展文件；JS 语法、CSP、资源引用、无远程请求/HTML 注入。`);
