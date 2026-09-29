import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'); process.chdir(root);
for (const flags of [['--noEmit', '--noUnusedLocals', '--noUnusedParameters'], []]) {
  const r = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', ...flags], { stdio: 'inherit', windowsHide: true });
  if (r.status !== 0) process.exit(r.status || 1);
}
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (manifest.version !== pkg.version || !readFileSync('README.md', 'utf8').includes(`Browser Toolbox ${pkg.version}`)) throw new Error('Manifest, package and README versions must agree.');
// Positive allowlist: logs, reports, source, tests, dependencies and profiles cannot enter a release.
const files = ['manifest.json', 'README.md', 'popup.html', 'popup.css', 'file_to_image.html', 'file_to_image.css', 'youtube_layout.css', 'youtube_progress_theme.css',
  'assets/file_to_image_default.jpg', ...Object.values(manifest.icons),
  ...readdirSync('src').filter(n => n.endsWith('.ts') && !n.endsWith('.d.ts')).map(n => `dist/${n.slice(0, -3)}.js`)].sort();
const required = [manifest.background.service_worker, manifest.action.default_popup, ...Object.values(manifest.action.default_icon),
  ...manifest.content_scripts.flatMap(item => [...(item.js || []), ...(item.css || [])])];
for (const html of ['popup.html', 'file_to_image.html']) {
  for (const match of readFileSync(html, 'utf8').matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    if (!/^(?:[a-z]+:|#)/i.test(match[1])) required.push(posix.join(posix.dirname(html), match[1]));
  }
}
for (const match of readFileSync(manifest.background.service_worker, 'utf8').matchAll(/\bimportScripts\(([^)]+)\)/g)) {
  for (const resource of match[1].matchAll(/["']([^"']+)["']/g)) required.push(posix.join(posix.dirname(manifest.background.service_worker), resource[1]));
}
for (const file of required) if (!files.includes(file)) throw new Error(`Missing runtime resource: ${file}`);
for (const file of files) if (!existsSync(file)) throw new Error(`Missing release file: ${file}`);
const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1; return c >>> 0; });
const crc32 = data => { let c = 0xffffffff; for (const byte of data) c = table[(c ^ byte) & 255] ^ c >>> 8; return (c ^ 0xffffffff) >>> 0; };
const local = [], central = [], hashes = {}; let offset = 0;
for (const file of files) {
  const data = readFileSync(file), name = Buffer.from(`browser_toolbox_extension/${file}`), crc = crc32(data);
  hashes[file] = createHash('sha256').update(data).digest('hex');
  const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x800, 6); h.writeUInt16LE(33, 12);
  h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26);
  const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt16LE(33, 14);
  c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
  local.push(h, name, data); central.push(c, name); offset += h.length + name.length + data.length;
}
const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
const bytes = Buffer.concat([...local, directory, end]); mkdirSync('release', { recursive: true });
const output = `release/browser-toolbox-${pkg.version}.zip`; writeFileSync(output, bytes);
writeFileSync(`${output}.sha256`, `${createHash('sha256').update(bytes).digest('hex')}  browser-toolbox-${pkg.version}.zip\n`);
writeFileSync('release/files.json', JSON.stringify({ version: pkg.version, files: hashes }, null, 2) + '\n');
console.log(`${output}: ${files.length} files, ${bytes.length} bytes`);
