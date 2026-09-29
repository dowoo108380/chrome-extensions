/** Test-only browser instrumentation and Chrome API doubles. Never loaded by the manifest. */
(() => {
  type Obj = Record<string, any>;
  const w = globalThis as unknown as Obj;
  const settings: Obj = { mediaControllerEnabled: true, mediaOverlayEnabled: false };
  const messageListeners: ((message: Obj, sender: Obj, reply: (value: Obj) => void) => unknown)[] = [];
  const storageListeners: ((changes: Obj, area: string) => void)[] = [];
  const sent: Obj[] = [], downloads: Obj[] = [], roots: ShadowRoot[] = [];
  const stats = { rafRuns: 0, rafRequests: 0, documentVideoScans: 0 };
  const faults = { report: false, read: false, write: false };
  let templateRate = 1;
  const nativeRaf = requestAnimationFrame.bind(window);
  window.requestAnimationFrame = fn => { stats.rafRequests++; return nativeRaf(t => { stats.rafRuns++; fn(t); }); };
  const query = Document.prototype.querySelectorAll;
  Document.prototype.querySelectorAll = function(selector: string): NodeListOf<any> {
    if (selector === 'video') stats.documentVideoScans++;
    return query.call(this, selector);
  };
  const attach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function(options: ShadowRootInit) { const root = attach.call(this, options); roots.push(root); return root; };
  function event<T> (listeners: T[] = []) { return { listeners, addListener: (f: T) => listeners.push(f), removeListener: (f: T) => { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); } }; }
  const runtime: Obj = {
    id: 'browser_regression_stub', getURL: (p: string) => `chrome-extension://browser_regression_stub/${p}`, getManifest: () => ({ version: '1.52.0' }),
    onMessage: event(messageListeners), sendMessage: (message: Obj, callback?: (response: Obj) => void) => {
      sent.push(structuredClone(message));
      queueMicrotask(() => {
        if (typeof w.__browserTestResponse === 'function') { const custom = w.__browserTestResponse(message); if (custom !== undefined) { callback?.(custom); return; } }
        if (message.type === 'media-controller:report-tab-rate') {
          if (faults.report) { callback?.({ ok: false, error: 'Injected session write rejection' }); return; }
          templateRate = message.templateRate ?? message.rate;
        }
        callback?.({ ok: true, templateRate, rate: templateRate, hasMedia: false, tabs: [], states: {}, globalEnabled: false });
      });
    }
  };
  const local: Obj = {
    get: (keys: unknown, callback: (values: Obj) => void) => queueMicrotask(() => {
      if (faults.read) {
        runtime.lastError = { message: 'Injected local read rejection' };
        try { callback({}); } finally { delete runtime.lastError; } return;
      }
      if (typeof keys === 'string') keys = [keys];
      const values = Array.isArray(keys) ? Object.fromEntries(keys.filter(k => k in settings).map(k => [k, settings[k]])) : { ...(keys && typeof keys === 'object' ? keys : {}), ...settings };
      callback(structuredClone(values));
    }),
    set: (values: Obj, callback?: () => void) => queueMicrotask(() => {
      if (faults.write) {
        runtime.lastError = { message: 'Injected local write rejection' };
        try { callback?.(); } finally { delete runtime.lastError; } return;
      }
      const changes: Obj = {};
      for (const [key, value] of Object.entries(values)) { changes[key] = { oldValue: settings[key], newValue: value }; settings[key] = structuredClone(value); }
      callback?.(); for (const fn of storageListeners) fn(changes, 'local');
    })
  };
  w.chrome = {
    runtime, storage: { local, onChanged: event(storageListeners) },
    tabs: { query: (_q: Obj, callback: (tabs: Obj[]) => void) => callback([{ id: 11, windowId: 1, index: 0, active: true, url: 'https://www.youtube.com/watch?v=test', title: 'LOCAL TEST' }]),
      onActivated: event(), onUpdated: event(), onRemoved: event() },
    downloads: { download: (options: Obj, callback: (id: number) => void) => { downloads.push(options); callback(1); } }
  };
  const video = () => document.querySelector('video')!;
  const controller = () => w.__chatgptBrowserToolsMediaControllerV1__;
  w.__test = {
    settings, sent, downloads, faults, roots, stats,
    update: (values: Obj) => new Promise<void>(resolve => local.set(values, resolve)),
    media: () => ({ count: controller()?.getMediaCount(), rate: video().playbackRate, defaultRate: video().defaultPlaybackRate, state: controller()?.getActiveState(), diagnostic: controller()?.getDiagnosticState() }),
    requestRate: (rate: number) => {
      const state = controller().getActiveState(); let response: Obj | null = null;
      for (const listener of messageListeners) listener({ type: 'media-controller:apply-tab-rate', mediaId: state.mediaId, sourceKey: state.sourceKey, rate }, {}, value => { response = value; });
      return response;
    },
    rejectSetter: () => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate')!;
      Object.defineProperty(video(), 'playbackRate', { configurable: true, get: () => descriptor.get!.call(video()), set: () => { throw new DOMException('Injected unsupported speed', 'NotSupportedError'); } });
    },
    restoreSetter: () => { Reflect.deleteProperty(video(), 'playbackRate'); },
    lifecycle: () => { window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); },
    addCaptions: (cues: [number, number, string][]) => {
      let track = Array.from(video().textTracks).find(t => t.label === 'Browser Toolbox 동기화 자막');
      if (!track) track = video().addTextTrack('captions', 'Browser Toolbox 동기화 자막', 'ko');
      for (const cue of Array.from(track.cues || [])) track.removeCue(cue);
      for (const [start, end, text] of cues) track.addCue(new VTTCue(start, end, text));
      track.mode = 'hidden'; document.dispatchEvent(new Event('browser-toolbox-youtube-synced-caption-changed'));
    },
    caption: () => {
      const host = document.getElementById('__browser_toolbox_youtube_synced_caption_overlay__');
      const root = roots.find(r => r.host === host);
      const bubble = root?.querySelector<HTMLElement>('.caption'), text = root?.querySelector<HTMLElement>('.caption-text'), warning = root?.querySelector<HTMLElement>('.caption-warning');
      const r = bubble?.getBoundingClientRect();
      return { host: !!host, display: host ? getComputedStyle(host).display : null, data: host ? { ...host.dataset } : null,
        text: text?.textContent, warning: warning?.hidden === false, textScrollHeight: text?.scrollHeight, textClientHeight: text?.clientHeight,
        rect: r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null,
        fontSize: bubble ? getComputedStyle(bubble).fontSize : null,
        backdropFilter: bubble ? getComputedStyle(bubble).backdropFilter : null,
        active: Array.from(video()?.textTracks[0]?.activeCues || []).map(c => (c as VTTCue).text), time: video()?.currentTime, rate: video()?.playbackRate };
    },
    ab: () => Array.from(document.querySelectorAll<HTMLElement>('.btx-yt-ab-loop-card')).map(e => ({ text: e.textContent, set: e.dataset.set })),
    keys: () => Array.from(document.querySelectorAll('.btx-yt-ab-loop-key')).map(e => e.textContent),
    ownFilters: () => roots.flatMap(root => Array.from(root.querySelectorAll<HTMLElement>('*')).filter(e => getComputedStyle(e).backdropFilter !== 'none').map(e => e.className)),
    restoreInstrumentation: () => { window.requestAnimationFrame = nativeRaf; Document.prototype.querySelectorAll = query; Element.prototype.attachShadow = attach; }
  };
})();
