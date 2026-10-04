import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const suite = process.argv[2] || 'node';
const aliases = {
  browser: ['browser_tests'], captions: ['caption_security_tests', 'caption_lifecycle_tests'], live: ['live_chat_tests'],
  youtube: ['youtube_tools_tests'], description: ['description_tests'], 'info-hover': ['info_hover_tests'], layout: ['layout_regressions'], scroll: ['scroll_regressions'],
  ambient: ['ambient_scroll_tests'], playlist: ['playlist_tests'], theater: ['theater_tests'],
  popup: ['popup_navigation_tests', 'popup_settings_tests'], 'popup-settings': ['popup_settings_tests'], quality: ['quality_tests', 'quality_popup_tests'],
  width: ['width_tests'], readiness: ['width_readiness_tests'], chatgpt: ['chatgpt_width_tests'],
  'chatgpt-diagnostics': ['chatgpt_diagnostics_tests'], 'chatgpt-structure': ['chatgpt_structure_tests'],
  lifecycle: ['layout_lifecycle_tests'], review: ['review_regressions'],
  'chatgpt-new-chat': ['chatgpt_new_chat_tests'], audit: ['audit_races'], principles: ['principles_tests'],
  foundation: ['foundation_tests'], transitions: ['layout_transition_tests'], persistence: ['width_persistence_tests'],
  integration: ['installed_extension_tests'], accessibility: ['accessibility_tests'], 'popup-window': ['popup_window_tests'],
  'media-runtime': ['media_runtime_tests'], 'quality-integration': ['quality_integration_tests'],
  'full-audit': ['full_audit_tests'], 'layout-integration': ['layout_integration_tests'], 'state-preservation': ['state_preservation_tests']
};
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...options });
  if (result.error) throw result.error;
  return result.status ?? 1;
}
function requireSuccess(command, args) { if (run(command, args)) process.exit(1); }
const tsc = (...args) => requireSuccess(process.execPath, ['node_modules/typescript/bin/tsc', ...args]);
if (!(suite in aliases) && !['node', 'all'].includes(suite)) throw new Error(`Unknown suite: ${suite}`);
tsc('-p', 'tsconfig.json', '--noEmit', '--noUnusedLocals', '--noUnusedParameters');
tsc('-p', 'tsconfig.json');
tsc('-p', 'tests/tsconfig.json');
if (suite === 'node' || suite === 'all') requireSuccess(process.execPath, ['--test', '.test_dist/node_tests.js']);
if (suite === 'node') process.exit(0);
for (const config of readdirSync('tests').filter(n => /^tsconfig\..+_baseline\.json$/.test(n)).sort()) tsc('-p', `tests/${config}`);
requireSuccess(process.execPath, ['.test_dist/export_review_functions.js']);
const python = [process.env.BTX_PYTHON, '.venv/Scripts/python.exe', '.venv/bin/python', 'python', 'python3']
  .filter(Boolean).find(command => spawnSync(command, ['-c', 'import playwright'], { stdio: 'ignore', windowsHide: true }).status === 0);
if (!python) throw new Error('Install browser test dependencies: uv venv .venv && uv pip install --python .venv -r tests/requirements.txt; or set BTX_PYTHON.');
const forwardedArgs = process.argv.slice(3);
const chromiumIndex = forwardedArgs.indexOf('--chromium');
const requestedBrowser = chromiumIndex < 0 ? undefined : forwardedArgs.splice(chromiumIndex, 2)[1];
if (chromiumIndex >= 0 && (!requestedBrowser || !existsSync(requestedBrowser))) throw new Error('--chromium requires an existing executable path.');
if (process.env.BTX_CHROMIUM && !existsSync(process.env.BTX_CHROMIUM)) throw new Error('BTX_CHROMIUM must point to an existing executable.');
const browser = [requestedBrowser, process.env.BTX_CHROMIUM, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome',
  spawnSync(python, ['-c', 'from playwright.sync_api import sync_playwright; p=sync_playwright().start(); print(p.chromium.executable_path); p.stop()'], { encoding: 'utf8', windowsHide: true }).stdout?.trim()]
  .filter(Boolean).find(existsSync);
if (!browser) throw new Error('Set BTX_CHROMIUM to Chrome/Chromium, or run: python -m playwright install chromium');
const scripts = suite === 'all' ? readdirSync('tests').filter(n => /^run_.*\.py$/.test(n)).sort()
  : aliases[suite].map(n => `run_${n}.py`);
mkdirSync('.test_results', { recursive: true });
const results = [];
for (const script of scripts) {
  const started = Date.now();
  console.log(`\nRunning ${script}`);
  const status = run(python, [`tests/${script}`, '--chromium', browser, ...forwardedArgs]);
  results.push({ script, passed: status === 0, seconds: (Date.now() - started) / 1000 });
}
writeFileSync(`.test_results/${suite}-summary.json`, JSON.stringify({ suite, browser, results }, null, 2) + '\n');
console.log(`\n${results.filter(r => r.passed).length}/${results.length} browser suites passed.`);
process.exit(results.every(r => r.passed) ? 0 : 1);
