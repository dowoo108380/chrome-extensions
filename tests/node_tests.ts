/** Regression tests against the actual compiled output; Chrome APIs below are explicitly mocked. */
export {};
declare function require(name: string): any;
declare const process: { cwd(): string; env: Record<string, string | undefined> };
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { test } = require("node:test") as { test(name: string, fn: () => void | Promise<void>): void };
const assert = require("node:assert/strict");
type Obj = Record<string, any>;
const root = process.cwd();
const dist = process.env.BTX_TEST_DIST || path.join(root, "dist");
function baseContext(extra: Obj = {}): any {
  return vm.createContext({ console, URL, Blob, File, TextEncoder, TextDecoder, Uint8Array, DataView, ArrayBuffer,
    structuredClone, setTimeout, clearTimeout, AbortController, AbortSignal, crypto: crypto.webcrypto, ...extra });
}
function load(context: any, file: string): void { vm.runInContext(fs.readFileSync(path.join(dist, file), "utf8"), context, { filename: file }); }
function shared(): any { const context = baseContext(); load(context, "toolbox_shared.js"); load(context, "settings_transfer.js"); return context; }

test('malformed numeric preferences cannot coerce null, blanks, booleans or arrays to zero', () => {
  const c = shared();
  for (const value of [null, undefined, '', '  ', true, false, [], [1], {}, { valueOf: () => 3 }]) {
    assert.ok(Number.isNaN(c.ToolboxShared.numericSetting(value)));
  }
  for (const value of [0, '0', 0.1, '0.1', ' 2.25 ']) assert.equal(c.ToolboxShared.numericSetting(value), Number(value));
});

test("archive cancellation stops bounded reads and permits the next build", async () => {
  const c = baseContext(); load(c, "file_to_image_core.js");
  const cover = new Blob([fs.readFileSync(path.join(root, "assets/file_to_image_default.jpg"))], { type: "image/jpeg" });
  const chunks: number[] = [];
  const file = new File([new Uint8Array(3 * 1024 * 1024)], "large.bin");
  const slice = file.slice.bind(file);
  file.slice = (start?: number, end?: number, type?: string) => { chunks.push((end || 0) - (start || 0)); return slice(start, end, type); };
  const controller = new AbortController();
  await assert.rejects(c.FileToImageCore.buildImageArchive({ cover, files: [file], signal: controller.signal,
    onProgress: (p: Obj) => { if (p.processedBytes > 0) controller.abort(new Error("user cancelled")); } }), /user cancelled/);
  assert.equal(chunks.length, 1); assert.ok(chunks.every(size => size <= 1024 * 1024));
  const next = await c.FileToImageCore.buildImageArchive({ cover, files: [new File(["after cancellation"], "small.txt")] });
  assert.equal(next.entries.length, 1);
});

test("capture limits reject invalid or excessive areas before capture", () => {
  const b = background();
  for (const pair of [[NaN, 100], [100, Infinity], [0, 100], [32768, 1], [8193, 8192]]) {
    b.context.dimensions = pair;
    assert.throws(() => b.run('validateCaptureSize(...dimensions)'), /캡처/);
  }
  b.run('validateCaptureSize(1920,10800)');
});

for (const kind of ['full', 'selection']) for (const phase of ['queued', 'queued-reload', 'metrics', 'capturing', 'unchanged']) {
  test(`${kind} capture verifies the same document when ${phase}`, async () => {
    const b = background(); await b.run('ensureTabKeepActiveInitialized()');
    const listenerCount = b.chrome.tabs.onUpdated.listeners.length;
    b.context.capturePhase = phase;
    b.chrome.scripting.executeScript = (_options: Obj, cb: (result: Obj[]) => void) => cb([{frameId:0,documentId:'selection-document',result:true}]);
    b.run(`captureProbe={screenshots:0,saves:0,detaches:0,reads:0};
      getTab=async()=>({id:8,url:'https://capture.test/page'});
      setBadge=async()=>{};ensureExtensionDebuggerAttached=async()=>{};
      shouldKeepDebuggerAttachedAfterTemporaryOperation=async()=>false;
      detachExtensionDebugger=async()=>{captureProbe.detaches++};
      sendCommand=async(_target,method)=>{
        if(method==='Page.getFrameTree'){
          const read=++captureProbe.reads;
          const changed=(capturePhase==='metrics'&&read>=2)||(capturePhase==='capturing'&&read>=3);
          return {frameTree:{frame:{id:'main',loaderId:changed?'new-document':'original-document',url:capturePhase==='queued'?'https://other.test/':'https://capture.test/page'}}};
        }
        if(method==='Page.getLayoutMetrics')return {cssContentSize:{width:800,height:600}};
        if(method==='Page.captureScreenshot'){captureProbe.screenshots++;return {data:'test-png'}};
        return {};
      };
      saveScreenshot=async()=>{captureProbe.saves++;return {downloadId:1}};`);
    if (phase === 'queued-reload') b.run(`queueTabDebuggerOperation=async(id,operation)=>{
      for(const listener of chrome.tabs.onUpdated.listeners)listener(id,{status:'loading'},{});
      return operation();
    }`);
    const operation = kind === 'full' ? 'captureFullPage(8)' : "captureSelection({id:8,url:'https://capture.test/page'},{x:0,y:0,width:300,height:200},'selection-document')";
    if (phase === 'unchanged') await b.run(operation);
    else await assert.rejects(b.run(operation), /페이지|문서/);
    assert.equal(b.context.captureProbe.saves, phase === 'unchanged' ? 1 : 0);
    assert.equal(b.context.captureProbe.screenshots, ['capturing','unchanged'].includes(phase) ? 1 : 0);
    assert.equal(b.context.captureProbe.detaches, phase === 'queued-reload' ? 0 : 1);
    assert.equal(b.run('capturingTabs.size'), 0);
    assert.equal(b.chrome.tabs.onUpdated.listeners.length, listenerCount);
  });
}

async function captureCleanupFixture(kind: string) {
  const b = background(); await b.run('ensureTabKeepActiveInitialized()');
  b.context.console = { ...console, error: () => {} };
  b.chrome.scripting.executeScript = (_options: Obj, cb: (result: Obj[]) => void) => cb([{frameId:0,documentId:'selection-document',result:true}]);
  b.run(`captureCleanupProbe={events:[],keep:false,failCapture:false};
    getTab=async()=>({id:8,url:'https://capture.test/page'});
    setBadge=async(_id,text)=>{captureCleanupProbe.events.push(text)};
    ensureExtensionDebuggerAttached=async()=>{extensionAttachedDebuggerTabs.add(8)};
    shouldKeepDebuggerAttachedAfterTemporaryOperation=async()=>captureCleanupProbe.keep;
    sendCommand=async(_target,method)=>{
      if(method==='Page.getFrameTree')return {frameTree:{frame:{id:'main',loaderId:'document',url:'https://capture.test/page'}}};
      if(method==='Page.getLayoutMetrics')return {cssContentSize:{width:800,height:600}};
      if(method==='Page.captureScreenshot'){
        if(captureCleanupProbe.failCapture)throw new Error('Injected screenshot failure');
        return {data:'test-png'};
      }
      return {};
    };
    saveScreenshot=async()=>{captureCleanupProbe.events.push('download');return {filename:'capture.png',downloadId:1}};`);
  const probe = b.context.captureCleanupProbe as Obj;
  const request = () => kind === 'full'
    ? b.message({type:'capture-full-page',tabId:8}, {id:b.chrome.runtime.id,url:b.chrome.runtime.getURL('popup.html')})
    : b.message({type:'drag-area-screenshot:capture',rectangle:{x:0,y:0,width:300,height:200}},
      {id:b.chrome.runtime.id,tab:{id:8,url:'https://capture.test/page'},frameId:0,documentId:'selection-document'});
  return { b, probe, request };
}

for (const kind of ['full', 'selection']) {
  for (const failCapture of [false, true]) test(`${kind} capture reports cleanup failure and retains debugger ownership (capture failure: ${failCapture})`, async () => {
    const { b, probe, request } = await captureCleanupFixture(kind);
    const listenerCount = b.chrome.tabs.onUpdated.listeners.length;
    probe.failCapture = failCapture;
    b.chrome.debugger.detach = (_target: Obj, cb: () => void) => {
      probe.events.push('detach');
      b.chrome.runtime.lastError = { message: 'Injected detach failure' };
      try { cb(); } finally { delete b.chrome.runtime.lastError; }
    };
    const response = await request();
    assert.equal(response.ok, false);
    assert.match(response.error, /디버거.*해제/);
    assert.match(response.error, failCapture ? /Injected screenshot failure/ : /다운로드.*시작/);
    assert.ok(!probe.events.includes('OK'));
    assert.equal(probe.events.at(-1), 'ERR');
    assert.equal(b.run('extensionAttachedDebuggerTabs.has(8)'), true);
    assert.equal(b.run('expectedDebuggerDetaches.size'), 0);
    assert.equal(b.run('capturingTabs.size'), 0);
    assert.equal(b.chrome.tabs.onUpdated.listeners.length, listenerCount);
    b.chrome.debugger.detach = (_target: Obj, cb: () => void) => cb();
    await b.run('detachExtensionDebugger(8)');
    assert.equal(b.run('extensionAttachedDebuggerTabs.has(8)'), false);
  });

  test(`${kind} capture publishes success only after debugger cleanup completes`, async () => {
    const { b, probe, request } = await captureCleanupFixture(kind);
    const detaching = gate(); let finishDetach!: () => void;
    b.chrome.debugger.detach = (_target: Obj, cb: () => void) => {
      probe.events.push('detach'); finishDetach = cb; detaching.resolve();
    };
    const response = request(); await detaching.promise;
    assert.ok(!probe.events.includes('OK'));
    finishDetach();
    assert.equal((await response).ok, true);
    assert.deepEqual(plain(probe.events), ['...', 'download', 'detach', 'OK']);
    assert.equal(b.run('extensionAttachedDebuggerTabs.has(8)'), false);
  });

  for (const message of ['Debugger is not attached to the tab', 'Target closed']) {
    test(`${kind} capture accepts confirmed debugger absence: ${message}`, async () => {
      const { b, request } = await captureCleanupFixture(kind);
      b.chrome.debugger.detach = (_target: Obj, cb: () => void) => {
        b.chrome.runtime.lastError = { message };
        try { cb(); } finally { delete b.chrome.runtime.lastError; }
      };
      assert.equal((await request()).ok, true);
      assert.equal(b.run('extensionAttachedDebuggerTabs.has(8)'), false);
      assert.equal(b.run('expectedDebuggerDetaches.size'), 0);
    });
  }

  test(`${kind} capture preserves a debugger still required by keep-active`, async () => {
    const { b, probe, request } = await captureCleanupFixture(kind);
    probe.keep = true;
    b.chrome.debugger.detach = () => { throw new Error('Keep-active debugger must remain attached'); };
    assert.equal((await request()).ok, true);
    assert.equal(b.run('extensionAttachedDebuggerTabs.has(8)'), true);
  });
}

test('selection capture rejects an old document even when its URL is unchanged', async () => {
  const b = background(); await b.run('ensureTabKeepActiveInitialized()');
  const listenerCount = b.chrome.tabs.onUpdated.listeners.length;
  b.chrome.scripting.executeScript = (_options: Obj, cb: (result: Obj[]) => void) => cb([{frameId:0,documentId:'new-document',result:true}]);
  await assert.rejects(b.run("captureSelection({id:8,url:'https://capture.test/page'},{x:0,y:0,width:300,height:200},'original-document')"), /페이지|문서/);
  assert.equal(b.run('capturingTabs.size'), 0);
  assert.equal(b.chrome.tabs.onUpdated.listeners.length, listenerCount);
  assert.ok(!b.calls.some(call => call.api === 'attach'));
});

test('area capture accepts only the owning main-frame content document', async () => {
  const b = background(); await b.run('ensureTabKeepActiveInitialized()');
  const sender = { id:b.chrome.runtime.id, tab:{id:8,url:'https://capture.test/page'}, frameId:0, documentId:'selection-document' };
  for (const invalid of [{...sender,id:'other'}, {...sender,frameId:3}, {...sender,documentId:undefined}]) {
    const reply = await b.message({type:'drag-area-screenshot:capture',rectangle:{x:0,y:0,width:300,height:200}}, invalid);
    assert.equal(reply.ok,false); assert.match(reply.error,/페이지/);
  }
  assert.ok(!b.calls.some(call => call.api === 'attach'));
});

test("caption port denies page senders and cancels only its owned tasks", async () => {
  const b = background(); await b.run('ensureTabKeepActiveInitialized()');
  let disconnected = false;
  const denied = {name:'browser-toolbox:caption-tasks',sender:{id:b.chrome.runtime.id,url:'https://example.com'},disconnect:()=>{disconnected=true;}};
  for (const listener of b.chrome.runtime.onConnect.listeners) listener(denied);
  assert.equal(disconnected,true);
  const responses: Obj[] = [];
  const port = {name:denied.name,sender:{id:b.chrome.runtime.id,url:b.chrome.runtime.getURL('popup.html')},disconnect:()=>{},onMessage:event(),onDisconnect:event(),postMessage:(value:Obj)=>responses.push(value)};
  b.context.captionSignals=[];
  b.run('runYouTubeTranscriptPageTask=async(_id,_task,signal)=>{captionSignals.push(signal);await new Promise((_,reject)=>signal.addEventListener("abort",()=>reject(new Error("cancelled"))));}');
  for (const listener of b.chrome.runtime.onConnect.listeners) listener(port);
  const first=crypto.randomUUID(), second=crypto.randomUUID();
  for(const id of [first,second]) for(const listener of port.onMessage.listeners) listener({requestId:id,message:{type:'youtube-transcript:get-info',tabId:8}});
  await tick(); assert.equal(b.context.captionSignals.length,2);
  for(const listener of port.onMessage.listeners) listener({requestId:first,cancel:true});
  await tick(); assert.equal(b.context.captionSignals[0].aborted,true); assert.equal(b.context.captionSignals[1].aborted,false);
  for(const listener of port.onDisconnect.listeners) listener();
  await tick(); assert.equal(b.context.captionSignals[1].aborted,true);
  assert.equal(responses.length,1); assert.equal(responses[0].response.ok,false);
});
function plain(value: unknown): any { return JSON.parse(JSON.stringify(value)); }
function event(): any {
  const listeners: ((...values: any[]) => any)[] = [];
  return { listeners, addListener: (f: typeof listeners[number]) => listeners.push(f), removeListener: (f: typeof listeners[number]) => { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); } };
}
function background() {
  const local: Obj = {}, session: Obj = {}, writes: Obj[] = [], calls: Obj[] = [];
  const fault: Obj = { local: "", session: "", dropLocalWrites: false };
  const runtime: Obj = { id: "unit-test-extension", onMessage: event(), onConnect: event(), onInstalled: event(), onStartup: event(),
    getURL: (p: string) => `chrome-extension://unit-test-extension/${p}`, getManifest: () => ({ version: "1.52.0" }),
    sendMessage: (_m: unknown, cb?: () => void) => cb?.() };
  function area(name: "local" | "session", store: Obj): Obj {
    const invoke = (method: string, cb: (...args: any[]) => void, fn: () => unknown) => {
      if (fault[name] === method || fault[name] === "all") {
        runtime.lastError = { message: `Injected ${name} ${method} storage failure` };
        try { cb(method === "get" ? {} : undefined); } finally { delete runtime.lastError; }
      } else cb(fn());
    };
    return {
      get: (keys: unknown, cb: (data: Obj) => void) => invoke("get", cb, () => {
        if (typeof keys === "string") keys = [keys];
        if (Array.isArray(keys)) return structuredClone(Object.fromEntries(keys.filter(k => k in store).map(k => [k, store[k]])));
        return structuredClone({ ...(keys && typeof keys === "object" ? keys : {}), ...store });
      }),
      set: (values: Obj, cb: () => void) => invoke("set", cb, () => {
        writes.push({ area: name, values: structuredClone(values) });
        if (!(name === "local" && fault.dropLocalWrites)) Object.assign(store, structuredClone(values));
      }),
      remove: (keys: string | string[], cb: () => void) => invoke("remove", cb, () => { for (const k of typeof keys === "string" ? [keys] : keys) delete store[k]; })
    };
  }
  const tabs: Obj[] = [];
  let mediaReply: Obj = { ok: true, hasMedia: true, mediaId: "media-1", sourceKey: "url:abcdef", rate: 1, templateRate: 1, kind: "video" };
  const chrome: Obj = {
    runtime, storage: { local: area("local", local), session: area("session", session), onChanged: event() },
    tabs: { query: (_q: Obj, cb: (values: Obj[]) => void) => cb(tabs), sendMessage: (_id: number, _message: Obj, _opts: Obj, cb: (v: Obj) => void) => cb(mediaReply) },
    windows: { onFocusChanged: event(), onBoundsChanged: event(), onRemoved: event() },
    debugger: { onDetach: event(), getTargets: (cb: (values: Obj[]) => void) => { calls.push({ api: "getTargets" }); cb([]); }, attach: () => { calls.push({ api: "attach" }); throw new Error("Diagnostics must never attach."); } },
    scripting: { executeScript: (_opts: Obj, cb: (value: Obj[]) => void) => { calls.push({ api: "executeScript" }); cb([{ frameId: 0, result: { state: "observed", media: [] } }]); } }
  };
  for (const name of ["onCreated", "onRemoved", "onUpdated", "onActivated", "onDetached", "onAttached", "onReplaced"]) chrome.tabs[name] = event();
  const context = baseContext({ chrome, navigator: { userAgent: "Node mock, not real Chrome" } });
  context.importScripts = (...files: string[]) => { for (const file of files) load(context, file); };
  load(context, "background.js");
  const run = (code: string): any => vm.runInContext(code, context);
  const message = (payload: Obj, sender: Obj): Promise<any> => new Promise(resolve => {
    for (const listener of runtime.onMessage.listeners) {
      const keep = listener(payload, sender, resolve);
      if (keep) return;
    }
  });
  return { context, run, local, session, writes, fault, calls, tabs, chrome, message, setMediaReply: (value: Obj) => { mediaReply = value; } };
}
function backup(settings: Obj = {}, rules?: Obj): Obj {
  return { app: "Browser Toolbox Extension", schemaVersion: 1, extensionVersion: "1.52.0", exportedAt: new Date().toISOString(), settings, ...(rules ? { rules } : {}) };
}

test("exact playback rate is observed; defaultPlaybackRate is untouched", () => {
  const c = shared(), m = { isConnected: true, playbackRate: 1, defaultPlaybackRate: 1 };
  const result = c.ToolboxShared.applyPlaybackRate(m, 3.25);
  assert.equal(result.ok, true); assert.equal(result.actualRate, 3.25); assert.equal(m.playbackRate, 3.25); assert.equal(m.defaultPlaybackRate, 1);
});
test("setter rejection is an error, not a requested value reported as successful", () => {
  const c = shared();
  const m = { isConnected: true, get playbackRate() { return 1.1; }, set playbackRate(_v: number) { throw new Error("injected rejection"); } };
  const result = c.ToolboxShared.applyPlaybackRate(m, 4);
  assert.equal(result.ok, false); assert.equal(result.actualRate, 1.1); assert.equal(result.restored, true);
});
test("silent clamping is rejected and the actually observed previous rate is restored", () => {
  const c = shared(); let rate = 1.1;
  const m = { isConnected: true, get playbackRate() { return rate; }, set playbackRate(v: number) { rate = Math.min(2, v); } };
  const result = c.ToolboxShared.applyPlaybackRate(m, 4);
  assert.equal(result.ok, false); assert.equal(rate, 1.1); assert.equal(result.restored, true);
});
test("rollback failure is reported explicitly", () => {
  const c = shared(); let rate = 1, calls = 0;
  const m = { isConnected: true, get playbackRate() { return rate; }, set playbackRate(_v: number) { if (++calls === 1) rate = 2; else throw new Error("injected restore failure"); } };
  const result = c.ToolboxShared.applyPlaybackRate(m, 4);
  assert.equal(result.ok, false); assert.equal(result.restored, false); assert.match(result.error, /restore failure/);
});
test("out-of-range and detached media requests are not applied", () => {
  const c = shared(), m = { isConnected: false, playbackRate: 1 };
  assert.equal(c.ToolboxShared.applyPlaybackRate(m, 2).ok, false); m.isConnected = true;
  for (const rate of [NaN, Infinity, 0, -1, 17]) assert.equal(c.ToolboxShared.applyPlaybackRate(m, rate).ok, false);
  assert.equal(m.playbackRate, 1);
});
test("one shared shortcut registry detects A/B and media collisions without modifying settings", () => {
  const c = shared(), source = { mediaShortcutFasterCode: "KeyA" }, before = JSON.stringify(source);
  assert.equal(c.ToolboxShared.shortcutBindings(source, "KeyA").length, 2);
  assert.equal(c.ToolboxShared.shortcutConflicts(source).length, 1); assert.equal(JSON.stringify(source), before);
  assert.equal(c.ToolboxShared.shortcutBindings({ ...source, youtubeAbLoopKeyboardEnabled: false }, "KeyA").length, 1);
  assert.equal(c.ToolboxShared.normalizeShortcutCode("Escape"), "");
});
test("new settings ZIP round-trips without external ZIP libraries", () => {
  const c = shared(), value = backup({ mediaSpeedStep: 0.1, youtubeSyncedCaptionPosition: { x: 0.5, y: 0.83 } });
  const bytes = c.ToolboxSettings.createZip(value);
  assert.deepEqual(plain(c.ToolboxSettings.readZip(bytes)), value);
  fs.mkdirSync(path.join(root, ".test_results"), { recursive: true });
  fs.writeFileSync(path.join(root, ".test_results", "settings_roundtrip.zip"), bytes);
});
test("corrupt ZIP data, compression, extra entries, path names and unknown settings are rejected", () => {
  const c = shared(), bytes: Uint8Array = c.ToolboxSettings.createZip(backup({ mediaSpeedStep: 0.1 }));
  const corrupt = bytes.slice(); corrupt[45] ^= 1; assert.throws(() => c.ToolboxSettings.readZip(corrupt));
  const compressed = bytes.slice(); compressed[8] = 8; assert.throws(() => c.ToolboxSettings.readZip(compressed));
  const two = bytes.slice(); two[two.length - 22 + 10] = 2; assert.throws(() => c.ToolboxSettings.readZip(two));
  const renamed = bytes.slice(); renamed[30] = 47; assert.throws(() => c.ToolboxSettings.readZip(renamed));
  for (const value of [backup({ cookies: [] }), backup({ mediaSpeedStep: 99 }), backup({ mediaControllerEnabled: "true" }), JSON.parse(JSON.stringify(backup()).replace('"settings":{}','"settings":{"__proto__":{}}'))]) assert.throws(() => c.ToolboxSettings.validateBackup(value));
});
test("export whitelist excludes cookies, tab/session identities and unrelated keys", () => {
  const c = shared(), source = { mediaSpeedStep: 0.2, cookie: "secret", mediaControllerTabStatesV3: { 5: "private" }, pageElementEraserRulesV1: { private: [] } };
  const exported = plain(c.ToolboxSettings.selectSettings(source));
  assert.deepEqual(exported, { ...plain(c.ToolboxSettings.EXPORT_DEFAULTS), mediaSpeedStep: 0.2 });
  assert.ok(!("cookies" in exported) && !("unrelated" in exported));
});
test("all session API wrappers propagate read, write and removal errors", async () => {
  const b = background(); await b.run("ensureTabKeepActiveInitialized()");
  for (const [method, code] of [["get", "getSessionStoredValues([])"], ["set", "setSessionStoredValues({test:1})"], ["remove", "removeSessionStoredValues(['test'])"]]) {
    b.fault.session = method; await assert.rejects(b.run(code), /Injected session/);
  }
});
test("failed media writes do not change the cache or masquerade as saved state", async () => {
  const b = background(); await b.run("ensureTabKeepActiveInitialized()");
  await b.run("setMediaTabState(5, {templateRate:1.5,active:null})"); b.fault.session = "set";
  await assert.rejects(b.run("setMediaTabState(5, {templateRate:4,active:null})"));
  assert.equal((await b.run("getMediaTabState(5)")).templateRate, 1.5);
  assert.equal(b.session.mediaControllerTabStatesV3[5].templateRate, 1.5);
  b.fault.session = "";
  await b.run("setMediaTabState(5, {templateRate:2,active:null})"); assert.equal(b.session.mediaControllerTabStatesV3[5].templateRate, 2);
});
test("failed initial media migration does not leave an initialized ghost cache", async () => {
  const b = background(); await b.run("ensureTabKeepActiveInitialized()"); b.fault.session = "set";
  await assert.rejects(b.run("getMediaTabStatesStore()")); assert.equal(b.run("mediaTabStatesCache"), null);
  b.fault.session = ""; await b.run("getMediaTabStatesStore()"); assert.ok(b.session.mediaControllerTabStatesV3);
});

for (const legacy of ['mediaControllerTabStatesV2', 'mediaPlaybackRatesByTabV1']) {
  test(`installation preserves the tab rate before removing ${legacy}`, async () => {
    const b = background(); await b.run('ensureTabKeepActiveInitialized()');
    b.session[legacy] = { 8: legacy.endsWith('V2') ? { templateRate: 2.25, active: { sourceKey: 'https://media.test/?secret=old' } } : 2.25 };
    for (const listener of b.chrome.runtime.onInstalled.listeners) listener({ reason: 'update' });
    await tick();
    assert.equal((await b.run('getMediaTabState(8)')).templateRate, 2.25);
    assert.equal(b.session[legacy], undefined);
    assert.equal(b.session.mediaControllerTabStatesV3[8].active, null);
    assert.ok(!JSON.stringify(b.session).includes('secret=old'));
  });
}
test('installation keeps legacy media data recoverable when the migration write fails', async () => {
  const b = background(); await b.run('ensureTabKeepActiveInitialized()');
  b.session.mediaPlaybackRatesByTabV1 = { 8: 2.25 }; b.fault.session = 'set';
  for (const listener of b.chrome.runtime.onInstalled.listeners) listener({ reason: 'update' });
  await tick();
  assert.equal(b.session.mediaPlaybackRatesByTabV1?.[8], 2.25);
  assert.equal(b.session.mediaControllerTabStatesV3, undefined);
  b.fault.session = '';
  assert.equal((await b.run('getMediaTabState(8)')).templateRate, 2.25);
});
test("concurrent source-state writes are serialized and no tab update is lost", async () => {
  const b = background(); await b.run("ensureTabKeepActiveInitialized()");
  await Promise.all(Array.from({ length: 15 }, (_, i) => b.run(`setMediaTabState(${i}, {templateRate:2,active:null})`)));
  assert.equal(Object.keys(b.session.mediaControllerTabStatesV3).length, 15);
});
test("a refresh storage error is not hidden by the content-message catch", async () => {
  const b = background(); await b.run("ensureTabKeepActiveInitialized()");
  await b.run("reportMediaTabState(1,0,{rate:1,mediaId:'media-1',sourceKey:'url:abcdef',hasMedia:true})"); b.fault.session = "set";
  await assert.rejects(b.run("getMediaTabState(1).then(state => refreshMediaActiveState(1,state))"), /Injected session set/);
});
test("preference preview is read-only; applying verifies values and preserves unrelated storage", async () => {
  const b = background(); await b.run("ensureTabKeepActiveInitialized()");
  b.local.mediaSpeedStep = 0.1; b.local.unrelated = "leave alone"; b.session.keep = { secret: "not backed up" };
  b.context.candidate = backup({ mediaSpeedStep: 0.2, youtubeAbLoopShortcutACode: "KeyQ" });
  const count = b.writes.length;
  const preview = await b.run("previewPreferenceImport(candidate,{includeRules:false,includeGlobal:false})");
  assert.equal(b.writes.length, count); b.context.digest = preview.digest;
  await b.run("applyPreferenceImport(candidate,{includeRules:false,includeGlobal:false},digest)");
  assert.equal(b.local.mediaSpeedStep, 0.2); assert.equal(b.local.youtubeAbLoopShortcutACode, "KeyQ"); assert.equal(b.local.unrelated, "leave alone"); assert.equal(b.session.keep.secret, "not backed up");
});
test("stale preview, invalid rule and colliding shortcut imports do not write", async () => {
  const b = background(); await b.run("ensureTabKeepActiveInitialized()");
  b.context.candidate = backup({ mediaSpeedStep: 0.3 });
  const preview = await b.run("previewPreferenceImport(candidate,{includeRules:false,includeGlobal:false})"); b.context.digest = preview.digest;
  b.local.mediaSpeedStep = 0.2; let count = b.writes.length;
  await assert.rejects(b.run("applyPreferenceImport(candidate,{includeRules:false,includeGlobal:false},digest)"), /미리보기/); assert.equal(b.writes.length, count);
  b.context.candidate = backup({ mediaShortcutFasterCode: "KeyA" });
  await assert.rejects(b.run("previewPreferenceImport(candidate,{includeRules:false,includeGlobal:false})"), /단축키/);
  b.context.candidate = backup({}, { "https://example.com": [{ selector: "body", label: "invalid", createdAt: 1 }] });
  await assert.rejects(b.run("previewPreferenceImport(candidate,{includeRules:true,includeGlobal:false})"), /숨김/); assert.equal(b.writes.length, count);
});
test("site rules and all-tab activation require separate explicit import options", async () => {
  const b = background(); await b.run("ensureTabKeepActiveInitialized()");
  b.context.candidate = backup({ mediaSpeedStep: 0.3, tabKeepActiveGlobalEnabledV1: true }, { "https://example.com": [{ selector: "#sidebar", label: "sidebar", createdAt: 1 }] });
  b.context.digest = (await b.run("previewPreferenceImport(candidate,{includeRules:false,includeGlobal:false})")).digest;
  await b.run("applyPreferenceImport(candidate,{includeRules:false,includeGlobal:false},digest)");
  assert.equal(b.local.tabKeepActiveGlobalEnabledV1, undefined); assert.equal(b.local.pageElementEraserRulesV1, undefined);
  b.context.digest = (await b.run("previewPreferenceImport(candidate,{includeRules:true,includeGlobal:false})")).digest;
  await b.run("applyPreferenceImport(candidate,{includeRules:true,includeGlobal:false},digest)");
  assert.equal(b.local.pageElementEraserRulesV1["https://example.com"][0].selector, "#sidebar");
});
test("an explicit global import uses the existing all-tab operation and persists its final flag", async () => {
  const b = background(); await b.run("ensureTabKeepActiveInitialized()");
  for (const enabled of [true,false]) {
    b.context.candidate = backup({tabKeepActiveGlobalEnabledV1:enabled});
    b.context.digest = (await b.run("previewPreferenceImport(candidate,{includeRules:false,includeGlobal:true})")).digest;
    const result = await b.run("applyPreferenceImport(candidate,{includeRules:false,includeGlobal:true},digest)");
    assert.equal(result.globalApplied, true); assert.equal(b.local.tabKeepActiveGlobalEnabledV1, enabled);
  }
});
test("a storage implementation that silently drops imported values cannot produce success", async () => {
  const b = background(); await b.run("ensureTabKeepActiveInitialized()"); b.context.candidate = backup({ mediaSpeedStep: 0.3 });
  b.context.digest = (await b.run("previewPreferenceImport(candidate,{includeRules:false,includeGlobal:false})")).digest;
  b.fault.dropLocalWrites = true;
  await assert.rejects(b.run("applyPreferenceImport(candidate,{includeRules:false,includeGlobal:false},digest)"), /최종 저장값/);
});
test("settings actions reject content-script senders before reading or writing preferences", async () => {
  const b = background(); await b.run("ensureTabKeepActiveInitialized()"); const count = b.writes.length;
  const result = await b.message({ type: "settings-tools:apply", backup: backup({ mediaSpeedStep: 1 }) }, { id: b.chrome.runtime.id, tab: { id: 2 }, url: "https://example.com/" });
  assert.equal(result.ok, false); assert.equal(b.writes.length, count);
});
test("diagnostics do not attach a debugger or include URLs, titles, cookies or caption text", async () => {
  const b = background(); await b.run("ensureTabKeepActiveInitialized()");
  b.tabs.push({ id: 2, active: true, url: "https://private.example/path?secret=yes", title: "Private title", autoDiscardable: true });
  Object.assign(b.local, { mediaControllerEnabled: true, cookie: "secret_cookie", youtubeTranscriptSourcePreference: "sensitive_caption_preference" });
  const output = await b.run("collectDiagnosticSnapshot()");
  assert.equal(output.gpuVideoSuperResolution, "not-measured");
  assert.equal(b.calls.some(call => call.api === "attach"), false);
  for (const secret of ["private.example", "Private title", "secret_cookie", "sensitive_caption_preference"]) assert.equal(JSON.stringify(output).includes(secret), false);
});
test("keep-active cache commits only after its session write succeeds", async () => {
  const b = background(); await b.run("ensureTabKeepActiveInitialized()");
  await b.run("setTabKeepActiveRecord(7,{mode:'manual',desired:true,applied:true,originalAutoDiscardable:true})");
  b.fault.session = "set";
  await assert.rejects(b.run("setTabKeepActiveRecord(7,{mode:'manual',desired:false,applied:false,originalAutoDiscardable:true})"));
  assert.equal((await b.run("getTabKeepActiveRecord(7)")).desired, true);
});
test("shared definitions may load twice without corrupting existing consumers", () => {
  const c = shared(); c.previousKeys = c.ToolboxShared.MEDIA_KEYS;
  load(c,"toolbox_shared.js");
  assert.equal(c.previousKeys.enabled, c.ToolboxShared.MEDIA_KEYS.enabled);
  assert.equal(c.ToolboxShared.SHORTCUTS.length, 8);
});
test("an observed external rate is not rounded into a different reported rate", () => {
  const b = background();
  b.context.active = {frameId:0,mediaId:"media-1",sourceKey:"url:abcdef",rate:2.333,kind:"video"};
  assert.equal(b.run("normalizeMediaActiveState(active)").rate, 2.333);
});
test("legacy navigation lifetime errors are still narrow, not a blanket ignore", () => {
  const b = background();
  for (const message of ["No frame with ID: 1419", "No frame with id 107 in tab with id 1858811650", "The tab was closed."]) {
    b.context.err = new Error(message); assert.equal(b.run("isNavigationGuardTargetUnavailableError(err)"), true);
  }
  b.context.err = new Error("Cannot access contents of url. Host permission required."); assert.equal(b.run("isNavigationGuardTargetUnavailableError(err)"), false);
});
test("existing image archive core preserves duplicate names, UTF-8 content and image prefix", async () => {
  const c = baseContext(); load(c,"file_to_image_core.js");
  const coverBytes = fs.readFileSync(path.join(root,"assets/file_to_image_default.jpg"));
  const result = await c.FileToImageCore.buildImageArchive({cover:new Blob([coverBytes],{type:"image/jpeg"}),files:[new File(["alpha"],"sample.txt"),new File(["beta"],"sample.txt"),new File(["한글 내용"],"한글.txt")]});
  assert.deepEqual(plain(result.entries.map((entry: Obj) => entry.archiveName)), ["sample.txt","sample_2.txt","한글.txt"]);
  const bytes = new Uint8Array(await result.blob.arrayBuffer());
  assert.deepEqual(Array.from(bytes.slice(0,coverBytes.length)),Array.from(coverBytes));
  fs.writeFileSync(path.join(root,".test_results/image_archive.bin"),bytes);
});
test("archive collision numbering remains unique for large duplicate batches and pre-numbered files", async () => {
  const c = baseContext(); load(c, "file_to_image_core.js");
  const cover = new Blob([fs.readFileSync(path.join(root, "assets/file_to_image_default.jpg"))]);
  const files = [new File([], "sample_2.txt"), ...Array.from({ length: 2000 }, (_, i) => new File([], i % 2 ? "SAMPLE.txt" : "sample.txt"))];
  const result = await c.FileToImageCore.buildImageArchive({ cover, files });
  const names = plain(result.entries.map((entry: Obj) => entry.archiveName.toLowerCase())) as string[];
  assert.equal(new Set(names).size, files.length);
  assert.deepEqual(names.slice(0, 4), ["sample_2.txt", "sample.txt", "sample_3.txt", "sample_4.txt"]);
  assert.equal(names.at(-1), "sample_2001.txt");
});

test("manifest references exist and permissions remain those of supplied 1.51.0", () => {
  const current = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const baseline = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/baseline_manifest.json"), "utf8"));
  assert.deepEqual(current.permissions, baseline.permissions); assert.deepEqual(current.host_permissions, baseline.host_permissions);
  const paths = [current.background.service_worker, current.action.default_popup, ...Object.values(current.icons), ...current.content_scripts.flatMap((v: Obj) => v.js)];
  for (const file of paths) assert.ok(fs.existsSync(path.join(root, file)));
  const popup = fs.readFileSync(path.join(root, "popup.html"), "utf8") as string;
  const ids = [...popup.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]); assert.equal(new Set(ids).size, ids.length);
  for (const file of ["popup.ts", "youtube_transcript_popup.ts"]) {
    const source = fs.readFileSync(path.join(root, "src", file), "utf8") as string;
    for (const match of source.matchAll(/getElementById\("([^"]+)"\)/g)) assert.ok(ids.includes(match[1]), `${file}: ${match[1]} missing`);
  }
});

function captionWorker(mainResult: Obj = { ok: true, entries: [] }) {
  const b = background(), injections: Obj[] = [];
  b.chrome.tabs.get = (id: number, cb: (tab: Obj) => void) => cb({ id, url: "https://www.youtube.com/watch?v=fixture" });
  b.chrome.scripting.executeScript = (options: Obj, cb: (value: Obj[]) => void) => {
    injections.push(options);
    if (options.world === "ISOLATED") {
      cb([{ frameId: 0, documentId: "caption-fixture-document", result: { ok: true, installed: options.args[0].action === "install" } }]);
    } else cb([{ frameId: 0, documentId: "caption-fixture-document", result: mainResult }]);
  };
  return { ...b, injections };
}
test("caption parser is installed in ISOLATED; MAIN and cleanup target the same document", async () => {
  const b = captionWorker();
  await b.run('runYouTubeTranscriptPageTask(7,{operation:"transcript",captionTextChannelId:"caller-controlled"})');
  assert.deepEqual(b.injections.map(item => item.world), ["ISOLATED", "MAIN", "ISOLATED"]);
  assert.equal(b.injections[0].func.name, "youtubeCaptionTextBridge");
  assert.equal(b.injections[1].func.name, "youtubeTranscriptPageTask");
  const channel = b.injections[0].args[0].channelId;
  assert.match(channel, /^[a-f0-9-]{36}$/);
  assert.equal(b.injections[1].args[0].captionTextChannelId, channel);
  assert.equal(b.injections[2].args[0].channelId, channel);
  assert.deepEqual(plain(b.injections[1].target), { tabId: 7, documentIds: ["caption-fixture-document"] });
  assert.deepEqual(plain(b.injections[2].target), plain(b.injections[1].target));
  assert.equal(b.injections[2].args[0].action, "dispose");
});
test("caption parsing errors still clean up the isolated helper and remain failures", async () => {
  const b = captionWorker({ ok: false, error: "Injected caption parser failure" });
  await assert.rejects(b.run('runYouTubeTranscriptPageTask(7,{operation:"synced-caption-apply"})'), /Injected caption parser failure/);
  assert.equal(b.injections.length, 3); assert.equal(b.injections[2].args[0].action, "dispose");
});
test("caption info/status/removal do not allocate a text parser", async () => {
  const b = captionWorker();
  for (const operation of ["info", "synced-caption-status", "synced-caption-remove"]) {
    b.context.operation = operation;
    await b.run('runYouTubeTranscriptPageTask(7,{operation,captionTextChannelId:"untrusted"})');
  }
  assert.equal(b.injections.length, 3);
  for (const item of b.injections) { assert.equal(item.world, "MAIN"); assert.equal(item.args[0].captionTextChannelId, undefined); }
});
test("caption helper install failure does not run a MAIN task without its parser", async () => {
  const b = captionWorker();
  b.chrome.scripting.executeScript = (options: Obj, cb: (value: Obj[]) => void) => {
    b.injections.push(options); cb([{frameId:0, result:{ok:false}}]);
  };
  await assert.rejects(b.run('runYouTubeTranscriptPageTask(7,{operation:"transcript"})'), /준비하지 못/);
  assert.equal(b.injections.length, 1); assert.equal(b.injections[0].world, "ISOLATED");
});
test("unexpected caption cleanup failure is not reported as full success", async () => {
  const b = captionWorker(), original = b.chrome.scripting.executeScript;
  b.chrome.scripting.executeScript = (options: Obj, cb: (value: Obj[]) => void) => {
    if (options.args?.[0]?.action === "dispose") cb([{frameId:0,result:{ok:false}}]);
    else original(options, cb);
  };
  await assert.rejects(b.run('runYouTubeTranscriptPageTask(7,{operation:"transcript"})'), /정리하지 못/);
});
test("MAIN caption code has no markup parsing sink or Trusted Types policy workaround", () => {
  // TypeScript is already the project's build dependency. Walk syntax, not comments or text.
  const ts = require("typescript");
  const violations = (file: string, parser: boolean): string[] => {
    const source = fs.readFileSync(path.join(dist, file), "utf8") as string;
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const found: string[] = [];
    function visit(node: any): void {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const expression = node.expression;
        const name = ts.isPropertyAccessExpression(expression) ? expression.name.text : expression.getText(tree);
        const forbidden = parser
          ? ["fetch", "XMLHttpRequest", "createPolicy", "appendChild", "adoptNode", "importNode"]
          : ["DOMParser", "parseFromString", "insertAdjacentHTML", "createContextualFragment", "createPolicy"];
        if (forbidden.includes(name)) found.push(name);
      }
      if (!parser && ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isPropertyAccessExpression(node.left) && ["innerHTML", "outerHTML"].includes(node.left.name.text)) found.push(node.left.name.text);
      if (parser && ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "chrome") found.push("chrome API");
      ts.forEachChild(node, visit);
    }
    visit(tree); return found;
  };
  assert.deepEqual(violations("youtube_transcript_page_task.js", false), []);
  assert.deepEqual(violations("youtube_caption_text_bridge.js", true), []);
  const legacy = violations("../tests/fixtures/legacy_caption_page_task.ts", false);
  assert.ok(legacy.includes("DOMParser") && legacy.includes("parseFromString"), "The guard must detect the actual unchanged legacy source.");
});

test("YouTube features are opt-in, have unique keys and declare only real dependencies", () => {
  const c = shared(), defs = plain(c.ToolboxShared.YOUTUBE_FEATURES) as Obj[];
  const defaults = plain(c.ToolboxShared.YOUTUBE_DEFAULTS);
  assert.equal(defs.length, 8); assert.equal(new Set(defs.map(f => f.key)).size, 8);
  assert.equal(defs.filter(f => f.group === "layout").length, 6);
  assert.deepEqual(Object.values(defaults), Array(8).fill(false));
  for (const f of defs) if (f.dependsOn) assert.ok(f.dependsOn === "mediaControllerEnabled" || f.dependsOn in defaults);
  assert.ok(!Object.keys(defaults).some(key => /mini/i.test(key)), "No non-functional miniplayer toggle");
  assert.equal(c.ToolboxShared.youtubeSettings({youtubeSpeedMenuEnabled:true}).youtubeSpeedMenuEnabled, undefined);
  assert.equal(c.ToolboxShared.youtubeSettings({youtubeSpeedNoticeEnabled:"true"}).youtubeSpeedNoticeEnabled, false);
  assert.equal(c.ToolboxShared.youtubeSettings({youtubeSpeedNoticeEnabled:true}).youtubeSpeedNoticeEnabled, true);
});
test("all YouTube choices round-trip through the existing settings ZIP with strict boolean validation", () => {
  const c = shared(), settings = Object.fromEntries(Object.keys(c.ToolboxShared.YOUTUBE_DEFAULTS).map((key, i) => [key, i % 2 === 0]));
  const data = backup(settings), result = c.ToolboxSettings.readZip(c.ToolboxSettings.createZip(data));
  assert.deepEqual(plain(result.settings), settings);
  assert.deepEqual(plain(c.ToolboxSettings.selectSettings(settings)), { ...plain(c.ToolboxSettings.EXPORT_DEFAULTS), ...settings });
  for (const key of Object.keys(settings)) assert.throws(() => c.ToolboxSettings.validateBackup(backup({[key]:"true"})));
  // Both historical sparse and complete backups may contain the retired menu.
  for (const schemaVersion of [1, 2]) {
    const old: Obj = {...backup({...plain(c.ToolboxSettings.EXPORT_DEFAULTS),youtubeSpeedMenuEnabled:true}),schemaVersion};
    const restored = c.ToolboxSettings.readZip(c.ToolboxSettings.createZip(old));
    assert.deepEqual(plain(restored.settings), plain(c.ToolboxSettings.EXPORT_DEFAULTS));
    assert.equal(old.settings.youtubeSpeedMenuEnabled,true, 'Import must not mutate the backup');
  }
  assert.equal(c.ToolboxSettings.selectSettings({youtubeSpeedMenuEnabled:true}).youtubeSpeedMenuEnabled,undefined);
  assert.throws(() => c.ToolboxSettings.validateBackup(backup({youtubeSpeedMenuEnabled:'true'})));
});
test("new layout/UI scripts do not reintroduce private state patches, markup sinks or media setters", () => {
  const ts = require("typescript");
  for (const name of ["youtube_layout.js", "youtube_tools_popup.js"]) {
    const source = fs.readFileSync(path.join(dist,name),"utf8");
    const tree = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const found: string[] = [];
    function walk(node: any): void {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const e = node.expression, method = ts.isPropertyAccessExpression(e) ? e.name.text : e.getText(tree);
        if (["createPolicy","parseFromString","DOMParser","insertAdjacentHTML","createContextualFragment","setInterval","setPlaybackRate","resolveCommand","defineProperty","defineProperties","fetch","XMLHttpRequest"].includes(method)) found.push(method);
      }
      if (ts.isBinaryExpression(node) && ts.isPropertyAccessExpression(node.left) &&
          node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
          ["innerHTML","outerHTML","playbackRate","defaultPlaybackRate","loop","currentTime","data","collapsed","isExpanded","playlistId"].includes(node.left.name.text)) found.push(node.left.name.text);
      ts.forEachChild(node,walk);
    }
    walk(tree); assert.deepEqual(found,[],name);
  }
});
test("player speed selectors are absent and the rate-change notice only observes playback", () => {
  const source = fs.readFileSync(path.join(root,"src/media_controller.ts"),"utf8") as string;
  assert.ok(!source.includes("__browser_toolbox_youtube_speed_indicator__"));
  assert.doesNotMatch(source,/youtubeSpeedMenuEnabled|btx-youtube-speed-menu-button|btx-youtube-speed-tools|btx-speed-exact-input/);
  const start = source.indexOf("  type SpeedNotice ="), end = source.indexOf("  function scheduleYouTubeSpeedNoticeUpdate");
  assert.ok(start >= 0 && end > start);
  const ui = source.slice(start,end);
  assert.doesNotMatch(ui,/setControllerRate|addEventListener/);
  assert.doesNotMatch(ui,/\.playbackRate\s*=(?!=)/);
  assert.doesNotMatch(ui,/defaultPlaybackRate|createPolicy|parseFromString|innerHTML/);
});
test("new stylesheet and popup script paths are packaged and progress assets need no network", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root,"manifest.json"),"utf8"));
  for (const entry of manifest.content_scripts) for (const name of [...(entry.js || []), ...(entry.css || [])]) assert.ok(fs.existsSync(path.join(root,name)),name);
  const css = fs.readFileSync(path.join(root,"youtube_progress_theme.css"),"utf8") as string;
  assert.match(css,/data:image\/gif;base64,/); assert.match(css,/linear-gradient/);
  assert.doesNotMatch(css,/url\(["']?https?:|backdrop-filter|(?:^|[;{])\s*filter\s*:/);
  const ui = fs.readFileSync(path.join(root,"youtube_layout.css"),"utf8") as string;
  assert.doesNotMatch(ui,/(?:^|[;{])\s*(?:-webkit-)?backdrop-filter\s*:|(?:^|[;{])\s*filter\s*:/);
  const html = fs.readFileSync(path.join(root,"popup.html"),"utf8") as string;
  for (const match of html.matchAll(/<script[^>]+src="([^"]+)"/g)) assert.ok(fs.existsSync(path.join(root,match[1])));
});

test("one maintained README retains testing instructions and supplied third-party license", () => {
  function markdown(folder: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(folder, {withFileTypes:true})) {
      if (entry.isDirectory() && (entry.name.startsWith(".") || ["node_modules", "analysis", "docs", "release"].includes(entry.name))) continue;
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) out.push(...markdown(file));
      else if (/\.md$/i.test(entry.name)) out.push(path.relative(root, file));
    }
    return out.sort();
  }
  assert.deepEqual(markdown(root), ["README.md"]);
  const readme = fs.readFileSync(path.join(root,"README.md"),"utf8") as string;
  assert.ok(readme.includes("pnpm run test:playlist"));
  assert.ok(readme.includes("pnpm run test:captions"));
  assert.ok(readme.includes("Copyright (c) 2024 - 2026, Feiyt."));
  assert.ok(readme.includes("Permission is hereby granted, free of charge"));
  assert.ok(readme.includes('THE SOFTWARE IS PROVIDED "AS IS"'));
  const css = fs.readFileSync(path.join(root,"youtube_progress_theme.css"),"utf8") as string;
  assert.ok(css.includes("README.md"));
  assert.ok(!css.includes("THIRD_PARTY_NOTICES.md"));
});

test("popup navigation is packaged and all original control identifiers and ranges remain", () => {
  const html = fs.readFileSync(path.join(root, "popup.html"), "utf8") as string;
  const source = fs.readFileSync(path.join(root, "src/popup_navigation.ts"), "utf8") as string;
  const baseline = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/popup_controls_baseline.json"), "utf8")) as Obj;
  for (const id of Object.keys(baseline)) assert.ok(html.includes(`id="${id}"`), `Missing original control: ${id}`);
  assert.ok(html.includes('src="dist/popup_navigation.js"'));
  assert.ok(fs.existsSync(path.join(root,"dist/popup_navigation.js")));
  assert.equal((html.match(/role="tabpanel"/g) || []).length, 7);
  assert.ok(!source.includes("tabs.create") && !source.includes("browsingData") && !source.includes("playbackRate ="));
  assert.ok(!source.includes("innerHTML") && !source.includes("trustedTypes.createPolicy"));
});

test("quality preference selection is exact, then lower, then the available minimum", () => {
  const c = shared();
  const make = (h: number, index: number) => ({ height: h, index, label: `${h}p`, available: true, premium: false, checked: false });
  const levels = [144, 240, 360, 480, 720, 1080, 1440, 2160, 4320];
  // Exhaust the nonempty subsets, with an independent selection oracle.
  for (let bits = 1; bits < 1 << levels.length; bits++) {
    const list = levels.filter((_, i) => bits & 1 << i);
    for (const prefer of levels) {
      const lower = list.filter(h => h <= prefer);
      const expect = lower.length ? lower[lower.length - 1] : list[0];
      assert.equal(c.ToolboxShared.chooseQuality(list.slice().reverse().map(make), prefer, true).height, expect);
    }
  }
  assert.equal(c.ToolboxShared.chooseQuality([], 1080, true), null);
});
test("quality Premium preference uses only eligible entries of the chosen resolution", () => {
  const c = shared(); const plain = { height: 1080, index: 0, label: "1080p", available: true, premium: false, checked: true };
  const premium = { ...plain, index: 1, label: "1080p Premium", premium: true, checked: false };
  assert.equal(c.ToolboxShared.chooseQuality([plain, premium], 1080, true).premium, true);
  assert.equal(c.ToolboxShared.chooseQuality([plain, premium], 1080, false).premium, false);
  assert.equal(c.ToolboxShared.chooseQuality([plain, { ...premium, available: false }], 1080, true).premium, false);
  const higher = { ...plain, height: 2160, label: "2160p" };
  assert.equal(c.ToolboxShared.chooseQuality([premium, higher], 2160, true).height, 2160);
});
test("quality parser reads resolution separately from frame rate and HDR and rejects unrelated labels", () => {
  const c = shared();
  for (const [label, height, premium] of [["1080p60 HDR",1080,false],["1080p Premium",1080,true],["4320p60 8K",4320,false],["144p",144,false],["1080pᴴᴰ",1080,false],["1080pPremium",1080,true],["2160p60HDR",2160,false]]) {
    assert.deepEqual(plain(c.ToolboxShared.parseQualityLabel(label)), { height, premium });
  }
  for (const label of ["Auto (1080p)","자동", "재생 속도 1.5", "1080", "p1080", "16000p", "2160pixels", "0p"]) assert.equal(c.ToolboxShared.parseQualityLabel(label), null);
});
test("quality settings survive the ZIP backup and reject invalid values", () => {
  const c = shared();
  const settings = { youtubePreferredQualityEnabled: true, youtubePreferredQualityHeight: 2160, youtubeQualityPremiumPreferred: true };
  const backup = { app: "Browser Toolbox Extension", schemaVersion: 1, extensionVersion: "1.61.0", exportedAt: new Date().toISOString(), settings };
  assert.deepEqual(plain(c.ToolboxSettings.readZip(c.ToolboxSettings.createZip(backup))).settings, settings);
  for (const value of [0, 144.5, 500, "1080", 8640, null]) assert.throws(() => c.ToolboxSettings.validateBackup({ ...backup, settings: { ...settings, youtubePreferredQualityHeight: value } }));
});
test("quality automation never mutates media state, uses private APIs, trusts HTML or creates network requests", () => {
  const source = fs.readFileSync(path.join(root, "src/youtube_quality.ts"), "utf8");
  assert.doesNotMatch(source, /\b(?:playbackRate|defaultPlaybackRate|currentTime|videoWidth|videoHeight|src)\s*=/);
  assert.doesNotMatch(source, /\b(?:setPlaybackQuality|setPlaybackQualityRange|getAvailableQualityLevels|getAvailableQualityData|ytcfg|ytInitialPlayerResponse|fetch|XMLHttpRequest|createPolicy|innerHTML|eval)\b/);
  assert.doesNotMatch(source, /preventDefault\(|stopImmediatePropagation\(|setInterval\(/);
});


test("ChatGPT widths keep page defaults and remain CSS-only rather than polling or replacing app state", () => {
  const source = fs.readFileSync(path.join(root, "src/content_script.ts"), "utf8") as string;
  const widthCode = source.slice(source.indexOf("const WIDTH_EXCLUDED"), source.indexOf("function applyShortcutSettings"));
  assert.match(widthCode, /max-w-\(--thread-body-max-width\)/);
  assert.match(widthCode, /--thread-content-max-width/);
  assert.match(widthCode, /WIDTH_COMPOSER_ANCHOR/);
  assert.doesNotMatch(widthCode, /new MutationObserver|new ResizeObserver|setInterval\(|requestAnimationFrame\(/);
  assert.doesNotMatch(widthCode, /(?:innerHTML|outerHTML)\s*=|createPolicy\(|fetch\(|XMLHttpRequest|\beval\(/);
  assert.doesNotMatch(widthCode, /--thread-body-max-width\s*:|--composer-max-width\s*:/);
  // Independent reset must remove each stylesheet instead of restoring a guessed
  // historical page width. Actual geometry is covered by test:chatgpt.
  assert.match(widthCode, /chatConversationWidthPx === 0[\s\S]*?existingStyle\?\.remove\(\)/);
  assert.match(widthCode, /chatComposerWidthPx === 0[\s\S]*?existingStyle\?\.remove\(\)/);
  assert.match(widthCode, /getBoundingClientRect\(\)/);
});

// 1.67 review regressions. These use controlled API scheduling, not actual Chrome services.
function gate<T = void>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function keepActiveMock(b: ReturnType<typeof background>) {
  const attached = new Set<number>(), commands: Obj[] = [];
  b.chrome.tabs.get = (id: number, cb: (tab: Obj) => void) => cb(structuredClone(b.tabs.find(t => t.id === id)!));
  b.chrome.tabs.update = (id: number, patch: Obj, cb: (tab: Obj) => void) => {
    const t = b.tabs.find(t => t.id === id)!; Object.assign(t, patch); cb(structuredClone(t));
  };
  b.chrome.windows.get = (id: number, cb: (value: Obj) => void) => cb({ id, focused: true, state: "normal" });
  b.chrome.debugger.attach = (target: Obj, _version: string, cb: () => void) => { attached.add(target.tabId); cb(); };
  b.chrome.debugger.detach = (target: Obj, cb: () => void) => { attached.delete(target.tabId); cb(); };
  b.chrome.debugger.sendCommand = (target: Obj, method: string, params: Obj, cb: (reply: Obj) => void) => {
    commands.push({ id: target.tabId, method, params });
    if (!attached.has(target.tabId)) {
      b.chrome.runtime.lastError = { message: "Debugger is not attached to the tab with id: " + target.tabId };
      try { cb({}); } finally { delete b.chrome.runtime.lastError; }
    } else cb(method === "Runtime.evaluate" ? { result: { value: { visibilityState: "visible", hidden: false, hasFocus: true } } } : {});
  };
  // Initialization is covered separately; focus this fixture on current user-command races.
  b.run('tabKeepActiveInitialized = true');
  return { attached, commands };
}
test("review 1: a disabled record cannot be recreated by a delayed status snapshot", async () => {
  const b = background(); const m = keepActiveMock(b);
  b.tabs.push({ id: 1, windowId: 1, active: false, autoDiscardable: true, url: "https://example.test/", status: "complete" });
  assert.equal((await b.run('applyTabKeepActive(1,"manual",true)')).status, "applied");
  b.context.snapshot = await b.run('getTabKeepActiveRecord(1)');
  await b.run('disableTabKeepActive(1)');
  const before = m.commands.length;
  const result = await b.run('refreshVerifiedTabKeepActiveRecord(1,snapshot)');
  assert.equal(result, null); assert.equal(await b.run('getTabKeepActiveRecord(1)'), null);
  await b.run('syncTabKeepActive(1)');
  assert.equal(await b.run('getTabKeepActiveRecord(1)'), null);
  assert.equal(b.tabs[0].autoDiscardable, true); assert.equal(m.commands.length, before);
});
test("review 1: overlapping eight-tab enable and disable finish with every actual mock tab restored", async () => {
  const b = background(); const m = keepActiveMock(b);
  for (let id = 1; id <= 8; id++) b.tabs.push({ id, windowId: 1, active: false, autoDiscardable: true, url: "https://example.test/", status: "complete" });
  const started = gate(), release = gate(); const get = b.chrome.tabs.get;
  b.chrome.tabs.get = (id: number, cb: (tab: Obj) => void) => {
    if (id === 1) { started.resolve(); void release.promise.then(() => get(id, cb)); } else get(id, cb);
  };
  const enable = b.run('setAllTabsKeepActive(true)'); await started.promise;
  const disable = b.run('setAllTabsKeepActive(false)'); release.resolve();
  await Promise.all([enable, disable]);
  assert.equal(b.local.tabKeepActiveGlobalEnabledV1, false);
  assert.deepEqual(plain(await b.run('getAllTabKeepActiveRecords()')), {});
  assert.ok(b.tabs.every(t => t.autoDiscardable === true)); assert.equal(m.attached.size, 0);
});
test("review 3: an untouched-default backup restores effective preferences, not an empty patch", async () => {
  const b = background();
  const snapshot = await b.run('exportPreferences(false)');
  assert.equal(snapshot.schemaVersion, 2); assert.equal(snapshot.settings.chatConversationWidthPx, 960);
  Object.assign(b.local, { mediaControllerEnabled: true, youtubePreferredQualityEnabled: true, chatConversationWidthPx: 1400 });
  b.context.backupValue = snapshot;
  b.context.preview = await b.run('previewPreferenceImport(backupValue,{includeRules:false,includeGlobal:false})');
  assert.ok(b.context.preview.changedKeys.includes("chatConversationWidthPx"));
  await b.run('applyPreferenceImport(backupValue,{includeRules:false,includeGlobal:false},preview.digest)');
  assert.equal(b.local.mediaControllerEnabled, false); assert.equal(b.local.youtubePreferredQualityEnabled, false); assert.equal(b.local.chatConversationWidthPx, 960);
});
test("review 3: schema 1 stays sparse; schema 2 rejects missing values and never includes private/session data", () => {
  const c = shared();
  assert.deepEqual(plain(c.ToolboxSettings.validateBackup(backup()).settings), {});
  assert.throws(() => c.ToolboxSettings.validateBackup({ ...backup(), schemaVersion: 2 }));
  const selected = plain(c.ToolboxSettings.selectSettings({ cookies: "secret", sourceUrl: "secret", mediaTabStatesV3: { secret: true } }));
  assert.deepEqual(Object.keys(selected).sort(), Object.keys(c.ToolboxSettings.VALIDATORS).sort());
  assert.deepEqual(selected, plain(c.ToolboxSettings.EXPORT_DEFAULTS));
  const result = c.ToolboxSettings.readZip(c.ToolboxSettings.createZip({ ...backup(selected), schemaVersion: 2 }));
  assert.deepEqual(plain(result.settings), selected);
});
for (const reply of [{ ok: true, hasMedia: false, rate: 1, templateRate: 1 }, { ok: true, hasMedia: true, rate: 1.25, templateRate: 1.25, mediaId: "old", sourceKey: "url:old", kind: "video" }]) {
  test(`review 15: stale ${reply.hasMedia ? "positive" : "empty"} frame response cannot replace a later active target`, async () => {
    const b = background();
    await b.run('reportMediaTabState(7,0,{rate:1,mediaId:"old",sourceKey:"url:old",hasMedia:true})');
    const started = gate(), release = gate();
    b.chrome.tabs.sendMessage = (_id: number, _m: Obj, _o: Obj, cb: (r: Obj) => void) => { started.resolve(); void release.promise.then(() => cb(reply)); };
    const query = b.run('(async()=>refreshMediaActiveState(7,await getMediaTabState(7)))()'); await started.promise;
    await b.run('reportMediaTabState(7,2,{rate:2,mediaId:"new",sourceKey:"url:new",hasMedia:true})');
    release.resolve(); const actual = await query;
    assert.equal(actual.active.frameId, 2); assert.equal(actual.active.mediaId, "new"); assert.equal(actual.active.rate, 2);
    assert.deepEqual(plain((await b.run('getMediaTabState(7)')).active), plain(actual.active));
  });
}
function captionFunctions(names: string[], extra: Obj = {}) {
  const ts = require("typescript"), source = fs.readFileSync(path.join(dist, "youtube_transcript_page_task.js"), "utf8");
  const tree = ts.createSourceFile("caption.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const found: Obj = {};
  function visit(n: any): void { if (ts.isFunctionDeclaration(n) && names.includes(n.name?.text)) found[n.name.text] = n.getText(tree); ts.forEachChild(n, visit); }
  visit(tree); assert.deepEqual(Object.keys(found).sort(), [...names].sort());
  const c = baseContext({ location: { href: "https://www.youtube.com/watch?v=requested_video", hostname: "www.youtube.com", pathname: "/watch", search: "?v=requested_video" }, ...extra });
  vm.runInContext(names.map(n => found[n]).join("\n"), c);
  return c;
}
const captionParsingNames = ["record", "normalizeVisibleText", "readRichText", "parseTimestampLabelToMs", "finiteCaptionNumber", "parseTranscriptRendererNode", "parseActualTranscriptResponse", "finalizeEntries", "normalizeCaptionEntry"];
test("review 8: group times are inherited once; absent timing is not the number zero", () => {
  const c = captionFunctions(captionParsingNames);
  const payload = { groups: [10, 20].map(t => ({ transcriptCueGroupRenderer: { formattedStartOffset: { simpleText: `0:${t}` }, cues: [{ transcriptCueRenderer: { cue: { simpleText: `at ${t}` } } }] } })) };
  const result = plain(c.parseActualTranscriptResponse(payload));
  assert.deepEqual(result.map((e: Obj) => e.startMs), [10000, 20000]);
  const direct = { transcriptCueGroupRenderer: { startMs: 10000, cues: [{ cue: { simpleText: "raw group cue" } }] } };
  assert.deepEqual(plain(c.parseActualTranscriptResponse(direct)).map((e: Obj) => e.startMs), [10000]);
  assert.equal(c.parseTranscriptRendererNode({ cue: { simpleText: "no time" } }), null);
  assert.equal(c.parseTranscriptRendererNode({ startMs: 0, cue: { simpleText: "real zero" } }).startMs, 0);
});
test("review 6: captured body gate requires exact video, source language, translation and track kind", async () => {
  const names = ["verifiedCaptionUrl", "normalizeLanguageCode", "isTimedTextUrl", "isTranscriptApiUrl", "getUrlParameter", "captionUrlScore", "isAutoGeneratedTrack", "collectUrlsFromObject", "createActualYouTubeRequestCapture", "readCaptionResponse", "abortable", "captionTextParserError"];
  const c = captionFunctions(names, { performance: { getEntriesByType: () => [] }, Response,
    taskAbort: new AbortController(), MAX_CAPTION_BODY_BYTES: 8 * 1024 * 1024, checkTask: () => {},
    parseCaptionPayload: async () => [{ startMs: 0, durationMs: 1000, text: "actual parser independently tested" }],
    fetch: async () => new Response("captured body", { headers: { "content-type": "application/json" } }) });
  const raw = { languageCode: "en", kind: "asr", baseUrl: "https://www.youtube.com/api/timedtext?v=requested_video&lang=en&kind=asr" };
  const good = raw.baseUrl + "&tlang=ko";
  for (const url of [good.replace("requested_video", "other_video"), good.replace("lang=en", "lang=fr"), good.replace("tlang=ko", "tlang=ja"), good.replace("&kind=asr", ""), "https://www.youtube.com/youtubei/v1/get_transcript"]) {
    assert.equal(c.verifiedCaptionUrl(url, "requested_video", raw, "ko"), false);
    const capture = c.createActualYouTubeRequestCapture({ videoId: "requested_video" }, raw, "ko");
    await c.fetch(url); await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(await capture.getParsedResult(), null); assert.equal(capture.getUrls().length, 0); capture.cleanup();
  }
  const capture = c.createActualYouTubeRequestCapture({ videoId: "requested_video" }, raw, "ko");
  await c.fetch(good); await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal((await capture.getParsedResult()).entries.length, 1); capture.cleanup();
});

// 1.69 audit: deterministic asynchronous interleavings against the complete worker.
test("audit: a delayed apply response cannot replace a newly selected media source", async () => {
  const b = background();
  await b.run('reportMediaTabState(8,0,{rate:1,mediaId:"old",sourceKey:"url:old",hasMedia:true})');
  const started = gate(), release = gate();
  b.chrome.tabs.sendMessage = (_id: number, m: Obj, _o: Obj, cb: (r: Obj) => void) => {
    const response = { ok: true, hasMedia: true, mediaId: "old", sourceKey: "url:old", rate: m.rate ?? 1, templateRate: m.rate ?? 1, kind: "video" };
    if (m.type === "media-controller:apply-tab-rate") { started.resolve(); void release.promise.then(() => cb(response)); }
    else cb(response);
  };
  const operation = b.run('applyMediaRateToActiveSource(8,3)').then(() => "success", () => "stale");
  await started.promise;
  await b.run('reportMediaTabState(8,2,{rate:1.5,mediaId:"new",sourceKey:"url:new",hasMedia:true,updateTemplate:true})');
  release.resolve(); const outcome = await operation;
  const state = await b.run('getMediaTabState(8)');
  assert.equal(state.active.mediaId, "new"); assert.equal(state.active.rate, 1.5); assert.equal(state.templateRate, 1.5);
  assert.equal(outcome, "stale");
});
test("audit: an apply response with a different source identity is rejected", async () => {
  const b = background(); await b.run('reportMediaTabState(8,0,{rate:1,mediaId:"old",sourceKey:"url:old",hasMedia:true})');
  b.chrome.tabs.sendMessage = (_id: number, m: Obj, _o: Obj, cb: (r: Obj) => void) => cb({
    ok: true, hasMedia: true, mediaId: "old", sourceKey: m.rate ? "url:another" : "url:old", rate: m.rate ?? 1, templateRate: m.rate ?? 1
  });
  await assert.rejects(b.run('applyMediaRateToActiveSource(8,3)'), /소스|대상/);
  assert.equal((await b.run('getMediaTabState(8)')).active.sourceKey, "url:old");
});
test("audit: failing batch waits for in-flight workers before releasing its caller", async () => {
  const b = background(), release = gate(), started = gate(); let settled = false;
  b.context.auditTask = async (id: number) => { if (id === 1) { await Promise.resolve(); throw new Error("batch failure"); } started.resolve(); await release.promise; return id; };
  const result = b.run('mapTabKeepActiveWithConcurrency([1,2,3],auditTask,2)').then(() => { settled = true; }, () => { settled = true; });
  await started.promise; await new Promise(r => setTimeout(r, 15));
  const premature = settled; release.resolve(); await result;
  assert.equal(premature, false, "a rejected batch must not leave writes running behind the control queue");
});
test("audit: emulation clear failure still detaches and restores discard policy", async () => {
  const b = background(), m = keepActiveMock(b);
  b.tabs.push({ id: 5, windowId: 1, active: false, autoDiscardable: true, url: "https://example.test/", status: "complete" });
  await b.run('applyTabKeepActive(5,"manual",true)');
  const command = b.chrome.debugger.sendCommand;
  b.chrome.debugger.sendCommand = (t: Obj, name: string, params: Obj, cb: (r: Obj) => void) => {
    if (name === "Emulation.setFocusEmulationEnabled" && params.enabled === false) {
      b.chrome.runtime.lastError = {message:"Injected clear failure"}; try { cb({}); } finally { delete b.chrome.runtime.lastError; }
    } else command(t, name, params, cb);
  };
  const result = await b.run('disableTabKeepActive(5)');
  assert.equal(result.status, "failed"); assert.equal(b.tabs[0].autoDiscardable, true);
  assert.equal(m.attached.has(5), false, "clear failure cannot skip the actual detach");
  assert.equal((await b.run('getTabKeepActiveRecord(5)')).desired, false);
});
test("audit: a closed tab cleanup waits behind its current queued write", async () => {
  const b = background(); await b.run('ensureTabKeepActiveInitialized()');
  const started = gate(), release = gate(); b.context.auditStarted = started.resolve; b.context.auditRelease = release.promise;
  const write = b.run('queueTabDebuggerOperation(9,async()=>{auditStarted();await auditRelease;await setTabKeepActiveRecord(9,{desired:true,mode:"manual",originalAutoDiscardable:true,applied:false,pending:true,retryBlocked:false,lastError:"",updatedAt:Date.now()});})');
  await started.promise; for (const listener of b.chrome.tabs.onRemoved.listeners) listener(9);
  await new Promise(r => setTimeout(r, 10)); release.resolve(); await write;
  await b.run('queueTabDebuggerOperation(9,async()=>{})');
  assert.equal(await b.run('getTabKeepActiveRecord(9)'), null);
});
test("audit: caption apply and removal in the same tab do not overlap", async () => {
  const b = captionWorker(), started = gate(), release = gate();
  const original = b.chrome.scripting.executeScript;
  b.chrome.scripting.executeScript = (options: Obj, cb: (r: Obj[]) => void) => {
    if (options.world === "MAIN" && options.args[0].operation === "synced-caption-apply") {
      b.injections.push(options); started.resolve(); void release.promise.then(() => cb([{frameId:0,result:{ok:true}}]));
    } else original(options, cb);
  };
  const apply = b.run('runYouTubeTranscriptPageTask(7,{operation:"synced-caption-apply"})'); await started.promise;
  const removal = b.run('runYouTubeTranscriptPageTask(7,{operation:"synced-caption-remove"})');
  await new Promise(r => setTimeout(r, 10));
  const beforeRelease = b.injections.filter(o => o.args[0].operation === "synced-caption-remove").length;
  release.resolve(); await Promise.all([apply, removal]);
  assert.equal(beforeRelease, 0, "removal must not run while extraction still owns the page state");
  assert.equal(b.injections.at(-1)!.args[0].operation, "synced-caption-remove");
});

test("audit: per-key queues recover from rejection and unrelated keys run independently", async () => {
  const c = shared(), queue = new c.ToolboxShared.KeyedTaskQueue(), release = gate(), events: string[] = [];
  const first = queue.run(1, async () => { events.push("one-start"); await release.promise; throw new Error("failed one"); });
  const rejection = assert.rejects(first, /failed one/);
  const second = queue.run(1, () => { events.push("one-next"); return 2; });
  await queue.run(2, () => { events.push("two-independent"); return 3; });
  assert.deepEqual(events, ["one-start", "two-independent"]);
  release.resolve(); await rejection; assert.equal(await second, 2);
  assert.deepEqual(events, ["one-start", "two-independent", "one-next"]);
  assert.equal(await queue.run(1, () => 4), 4);
});
test("audit: settings read reconciliation preserves unmodified keys, removes deleted keys, and ignores unrelated data", () => {
  const c = shared(), journal = new c.ToolboxShared.SettingsReadJournal(["enabled", "step", "size"]);
  const start = journal.mark();
  journal.record({ enabled: {newValue:false}, step:{newValue:.25}, secret:{newValue:"must not be copied"} });
  journal.record({ step:{} });
  const result = journal.merge({enabled:true,step:.1,size:28}, start);
  assert.equal(result.enabled, false); assert.equal(result.step, undefined); assert.equal(result.size, 28); assert.equal("secret" in result, false);
  const fresh = journal.mark(); assert.equal(journal.merge({enabled:true}, fresh).enabled, true);
});
test("audit: active-tab record loading is single-flight and cannot overwrite a later committed record", async () => {
  const b = background(); await b.run('ensureTabKeepActiveInitialized()'); b.run('tabKeepActiveRecordsCache=null');
  const original = b.chrome.storage.session.get, held: (() => void)[] = [];
  b.chrome.storage.session.get = (keys: unknown, cb: (o: Obj) => void) => original(keys, (snapshot: Obj) => held.push(() => cb(snapshot)));
  const first = b.run('loadTabKeepActiveRecordStore()'), second = b.run('loadTabKeepActiveRecordStore()');
  await Promise.resolve(); assert.ok(held.length>0); held[0](); await first;
  await b.run('setTabKeepActiveRecord(4,{mode:"manual",desired:true,originalAutoDiscardable:true,applied:false,pending:true,lastError:"",updatedAt:Date.now()})');
  for (const cb of held.slice(1)) cb(); await second;
  assert.equal((await b.run('getTabKeepActiveRecord(4)')).desired, true); assert.equal(held.length, 1);
});
test("audit: failed active-state store read is not cached as success and is retryable", async () => {
  const b = background(); await b.run('ensureTabKeepActiveInitialized()'); b.run('tabKeepActiveRecordsCache=null');
  b.fault.session="get"; await assert.rejects(b.run('loadTabKeepActiveRecordStore()'), /Injected/);
  b.fault.session=""; assert.deepEqual(plain(await b.run('loadTabKeepActiveRecordStore()')), {});
});
test("audit: an expired old expected-detach timer does not consume the next detach event", async () => {
  const b = background(); await b.run('ensureTabKeepActiveInitialized()'); const timers: (()=>void)[]=[];
  b.context.setTimeout=(fn:()=>void)=>{timers.push(fn);return timers.length;};
  b.chrome.debugger.detach=(_target:Obj,cb:()=>void)=>cb();
  await b.run('detachExtensionDebugger(11)');assert.equal(b.run('consumeExpectedDebuggerDetach(11)'),true);
  await b.run('detachExtensionDebugger(11)');timers[0]();
  assert.equal(b.run('consumeExpectedDebuggerDetach(11)'),true);timers[1]();
  assert.equal(b.run('consumeExpectedDebuggerDetach(11)'),false);
});
test("audit: unexpected detach handling participates in the current per-tab operation queue", async () => {
  const b = background(), m = keepActiveMock(b);
  b.tabs.push({ id: 12, windowId: 1, active: false, autoDiscardable: true, url: "https://example.test/", status: "complete" });
  await b.run('applyTabKeepActive(12,"manual",true)');
  const started=gate(),release=gate();b.context.auditStarted=started.resolve;b.context.auditRelease=release.promise;
  b.run('globalThis.auditReadCount=0;globalThis.auditOriginalRead=getTabKeepActiveRecord;getTabKeepActiveRecord=async id=>{auditReadCount++;return auditOriginalRead(id)}');
  const busy=b.run('queueTabDebuggerOperation(12,async()=>{auditStarted();await auditRelease})');await started.promise;
  m.attached.delete(12);for(const fn of b.chrome.debugger.onDetach.listeners)fn({tabId:12},"canceled_by_user");
  await new Promise(r=>setTimeout(r,10));const beforeRelease=b.run('auditReadCount');
  release.resolve();await busy;await b.run('queueTabDebuggerOperation(12,async()=>{})');
  assert.equal(beforeRelease,0);assert.equal((await b.run('getTabKeepActiveRecord(12)')).retryBlocked,true);
  await b.run('disableTabKeepActive(12)');assert.equal(await b.run('getTabKeepActiveRecord(12)'),null);
});
test("audit: caption queues do not serialize unrelated tabs and recover after task failure", async () => {
  const b=captionWorker(),started=gate(),release=gate(),original=b.chrome.scripting.executeScript;
  b.chrome.scripting.executeScript=(o:Obj,cb:(r:Obj[])=>void)=>{
    if(o.world==='MAIN'&&o.target.tabId===7&&o.args[0].operation==='transcript') {b.injections.push(o);started.resolve();void release.promise.then(()=>cb([{frameId:0,result:{ok:false,error:'injected transcript failure'}}]));}
    else original(o,cb);
  };
  const first=b.run('runYouTubeTranscriptPageTask(7,{operation:"transcript"})');const rejected=assert.rejects(first,/injected transcript/);await started.promise;
  assert.equal((await b.run('runYouTubeTranscriptPageTask(8,{operation:"info"})')).ok,true);
  const second=b.run('runYouTubeTranscriptPageTask(7,{operation:"info"})');release.resolve();await rejected;
  assert.equal((await second).ok,true);
});
test("audit: download start needs a real numeric download ID, not merely an error-free callback", async () => {
  const b=background();b.chrome.downloads={download:(_o:Obj,cb:(id?:number)=>void)=>cb()};
  await assert.rejects(b.run('downloadFile({url:"data:text/plain,hello"})'),/식별자/);
  b.chrome.downloads.download=(_o:Obj,cb:(id:number)=>void)=>cb(0);
  assert.equal(await b.run('downloadFile({url:"data:text/plain,hello"})'),0);
});
test("audit: persistent selector validation is shared by both actual consumers", () => {
  const c=shared(),b=background();
  const valid=['#container > span.advert','div[data-testid="stable"] > span.label','aside[aria-label="literal > comma, colon:"]'];
  const invalid=['body','#container span','.advert','#container > *','#container:has(video)','#container >','#container, #other','div[onclick="bad"]','#container > span{color:red}'];
  for(const s of [...valid,...invalid]) {b.context.selector=s;assert.equal(c.ToolboxShared.isSafePersistentSelector(s),valid.includes(s),s);assert.equal(b.run('isSafePersistentElementSelector(selector)'),valid.includes(s),s);}
  const restore=fs.readFileSync(path.join(dist,'element_eraser_restore.js'),'utf8');assert.match(restore,/ToolboxShared\.isSafePersistentSelector/);
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  const entry=manifest.content_scripts.find((e:Obj)=>e.js.includes('dist/element_eraser_restore.js'));
  assert.ok(entry.js.indexOf('dist/toolbox_shared.js')<entry.js.indexOf('dist/element_eraser_restore.js'));
});


// Principles audit: regressions below run against BTX_TEST_DIST for an unchanged
// baseline comparison. Only Chrome API delivery is mocked; product code is loaded as built.
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
function gateOneLocalRead(b: ReturnType<typeof background>, predicate: (keys: unknown) => boolean) {
  const original = b.chrome.storage.local.get;
  let released: (() => void) | null = null, captured = false;
  b.chrome.storage.local.get = (keys: unknown, callback: (values: Obj) => void) => {
    if (!captured && predicate(keys)) {
      captured = true;
      original(keys, (values: Obj) => { released = () => callback(values); });
    } else original(keys, callback);
  };
  return { ready: () => captured, release: () => { assert.ok(released, "Read must actually be held"); released!(); } };
}
test("principles: migration cannot erase a later persistent rule", async () => {
  const b = background(); await b.run("ensureTabKeepActiveInitialized()");
  b.local.pageElementEraserRulesV1 = { "https://example.com": [{selector:"#first",label:"first",createdAt:1}, {selector:"",createdAt:0}] };
  const gate = gateOneLocalRead(b, keys => Array.isArray(keys) && keys.includes("pageElementEraserRulesV1"));
  const migration = b.run("migrateElementEraserRules()"); await tick(); assert.ok(gate.ready());
  const addition = b.run('queueElementEraserWrite(()=>addElementEraserRule("https://example.com",{selector:"#new",label:"new"}))');
  await tick(); gate.release(); await Promise.all([migration, addition]);
  assert.deepEqual(b.local.pageElementEraserRulesV1['https://example.com'].map((r: Obj) => r.selector), ['#first','#new']);
});
test("principles: rule import and a later add share the same write queue", async () => {
  const b = background(); await b.run("ensureTabKeepActiveInitialized()");
  b.context.candidate = backup({}, {"https://example.com":[{selector:"#imported",label:"imported",createdAt:1}]});
  b.context.digest = (await b.run("previewPreferenceImport(candidate,{includeRules:true,includeGlobal:false})")).digest;
  const gate = gateOneLocalRead(b, keys => keys === null);
  const importing = b.run("applyPreferenceImport(candidate,{includeRules:true,includeGlobal:false},digest)");
  await tick(); assert.ok(gate.ready());
  const addition = b.run('queueElementEraserWrite(()=>addElementEraserRule("https://example.com",{selector:"#new",label:"new"}))');
  await tick(); gate.release(); await Promise.all([importing, addition]);
  assert.deepEqual(b.local.pageElementEraserRulesV1['https://example.com'].map((r: Obj) => r.selector), ['#imported','#new']);
});
function stubPrivilegedTasks(b: ReturnType<typeof background>): string[] {
  const effects: string[] = []; b.context.__auditEffects = effects;
  for (const name of ['runYouTubeTranscriptPageTask','saveYouTubeTranscriptText','saveYouTubeTranscriptBatch','startElementEraser','getElementEraserStatus','clearElementEraserRules','captureFullPage','startAreaSelection'])
    b.run(`${name} = async()=>{__auditEffects.push('${name}');return {results:[],mode:'temporary',removedCount:0}}`);
  b.run('getTab = async()=>({id:8,url:"https://example.com"})');
  return effects;
}
test('tab commands reject null and coerced identifiers before performing work', async () => {
  const b = background(); await b.run('ensureTabKeepActiveInitialized()');
  const effects = stubPrivilegedTasks(b);
  b.run("applyMediaRateToActiveSource=async()=>{__auditEffects.push('rate');return {templateRate:1,active:null}}");
  const commands = ['capture-full-page','start-area-selection','page-element-eraser:start',
    'page-element-eraser:get-site-status','page-element-eraser:clear-site-rules','media-controller:set-tab-rate'];
  for (const tabId of [null, '', '8', true, [], [8], {}]) for (const type of commands) {
    const result = await b.message({type,tabId,rate:2}, {id:b.chrome.runtime.id,url:b.chrome.runtime.getURL('popup.html')});
    assert.equal(result.ok,false,`${type} ${JSON.stringify(tabId)}`);
    assert.equal(effects.length,0);
  }
});

test('tab lists preserve numeric zero but reject nonnumeric identifiers', async () => {
  const b = background(); await b.run('ensureTabKeepActiveInitialized()');
  for (const value of [null, '', '8', true, [], [8], {}]) {
    b.context.tabCandidates = [value];
    assert.throws(() => b.run('normalizeTabIdList(tabCandidates)'), /탭/);
  }
  assert.deepEqual(plain(b.run('normalizeTabIdList([0,8,8])')), [0,8]);
});

test('site-data removal never coerces a malformed target into another tab', async () => {
  const b = background(); await b.run('ensureTabKeepActiveInitialized()');
  b.run("getTab=async id=>({id,url:'https://capture.test/page'});removedSiteData=[];removeBrowsingDataForOrigins=async origins=>removedSiteData.push(origins)");
  for (const tabId of [null, '', '8', true, [], [8], {}]) {
    b.context.clearTargets = [{tabId,origin:'https://capture.test'}];
    await assert.rejects(b.run('clearSelectedTabSiteData(clearTargets)'), /탭|사이트/);
    assert.equal(b.context.removedSiteData.length,0);
  }
});
const UI_COMMANDS_TO_CHECK = ['youtube-transcript:get-info','youtube-transcript:get-transcript','youtube-synced-captions:apply','youtube-synced-captions:remove',
  'youtube-transcript:save-text','youtube-transcript:save-batch','page-element-eraser:start','page-element-eraser:get-site-status',
  'page-element-eraser:clear-site-rules','capture-full-page','start-area-selection'];
test("principles: privileged UI commands reject content senders without executing", async () => {
  const b = background(); await b.run("ensureTabKeepActiveInitialized()"); const effects=stubPrivilegedTasks(b);
  for (const type of UI_COMMANDS_TO_CHECK) {
    const response = await b.message({type,tabId:8,text:'test',files:[]}, {id:b.chrome.runtime.id,url:'https://example.com',tab:{id:7},frameId:0});
    assert.equal(response.ok,false,type); assert.equal(effects.length,0,type);
  }
});
test("principles: privileged UI commands still reach existing handlers from own UI", async () => {
  const b = background(); await b.run("ensureTabKeepActiveInitialized()"); const effects=stubPrivilegedTasks(b);
  for (const type of UI_COMMANDS_TO_CHECK) {
    const response=await b.message({type,tabId:8,text:'test',files:[]}, {id:b.chrome.runtime.id,url:b.chrome.runtime.getURL('popup.html')});
    assert.equal(response.ok,true,type);
  }
  assert.equal(effects.length,UI_COMMANDS_TO_CHECK.length);
});
test("principles: a missing sender URL does not authorize a privileged UI request", async () => {
  const b=background(); await b.run("ensureTabKeepActiveInitialized()"); const n=b.writes.length;
  const response=await b.message({type:'settings-tools:export'}, {id:b.chrome.runtime.id});
  assert.equal(response.ok,false); assert.equal(b.writes.length,n);
});
test("principles: own extension UI is recognized even when opened in a real tab", async () => {
  const b=background(); await b.run("ensureTabKeepActiveInitialized()");
  const response=await b.message({type:'settings-tools:export'}, {id:b.chrome.runtime.id,url:b.chrome.runtime.getURL('popup.html'),tab:{id:8}});
  assert.equal(response.ok,true);
});
test("principles: content media state requests are restricted to their own tab", async () => {
  const b=background(); await b.run("ensureTabKeepActiveInitialized()");
  b.context.readTabIds=[]; b.run('getMediaTabState=async id=>{readTabIds.push(id);return {templateRate:1,active:null}}');
  const response=await b.message({type:'media-controller:get-tab-state',tabId:9}, {id:b.chrome.runtime.id,url:'https://example.com',tab:{id:8},frameId:0});
  assert.equal(response.ok,false); assert.deepEqual(plain(b.context.readTabIds),[]);
  const own=await b.message({type:'media-controller:get-tab-state'}, {id:b.chrome.runtime.id,url:'file:///movie.webm',tab:{id:8},frameId:0});
  assert.equal(own.ok,true); assert.deepEqual(plain(b.context.readTabIds),[8]);
});
test("principles: mismatched query replies cannot relabel a different media source", async () => {
  const b=background(); await b.run("ensureTabKeepActiveInitialized()");
  await b.run('reportMediaTabState(8,0,{hasMedia:true,mediaId:"original",sourceKey:"url:original",rate:1})');
  const before=plain(b.session.mediaControllerTabStatesV3['8']);
  b.setMediaReply({ok:true,hasMedia:true,mediaId:'different',sourceKey:'url:different',rate:4,templateRate:4});
  await assert.rejects(b.run('getMediaTabState(8).then(s=>refreshMediaActiveState(8,s))'), /미디어|소스|대상/);
  assert.deepEqual(plain(b.session.mediaControllerTabStatesV3['8']),before);
});

// Ownership guards are static safeguards, not proof of native YouTube behavior.
test("foundation: native player leaves have no extension-owned stretch stylesheet", () => {
  const css=fs.readFileSync(path.join(root,"youtube_layout.css"),"utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const script=fs.readFileSync(path.join(dist,"youtube_layout.js"),"utf8");
  assert.doesNotMatch(css,/data-btx-player-viewport|--btx-player-controls-right/);
  assert.doesNotMatch(script,/setProperty\(["'](?:width|height|inset|object-fit|position)["']/);
  assert.doesNotMatch(script,/schedulePlayerSizeUpdate_|updatePageMediaQueries/);
});
test("foundation: shortcut activation cannot fall back to synthetic Enter or submit", () => {
  const source=fs.readFileSync(path.join(dist,"content_script.js"),"utf8");
  assert.doesNotMatch(source,/new KeyboardEvent|new Event\(["']submit|dispatchPlainEnter|findStructuralEditSubmitButton/);
  assert.doesNotMatch(source,/findComposerSendButton\(document\)/);
});
