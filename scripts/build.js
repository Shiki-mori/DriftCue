import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const target = path.resolve('dist/DriftCue');
await mkdir(target, { recursive: true });
await cp('extension', target, { recursive: true });
async function list(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await list(p)); else result.push(p);
  }
  return result;
}
const sums = [];
for (const file of await list(target)) sums.push(`${createHash('sha256').update(await readFile(file)).digest('hex')}  ${path.relative(target, file).replaceAll('\\', '/')}`);
await writeFile('dist/SHA256SUMS.txt', sums.join('\n') + '\n');
console.log(`可加载扩展：${target}（${sums.length} 个文件），校验和 dist/SHA256SUMS.txt`);
