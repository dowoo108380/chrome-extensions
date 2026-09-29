/** Test-only popup service doubles. No production file loads this script. */
(() => {
  type Obj = Record<string, any>;
  const w = globalThis as unknown as Obj;
  const test = w.__test;
  const state = { rate: 1.75, hasMedia: true, rateFailure: false, captionFailure: false, synced: false, copied: "", closeCalls: 0 };
  w.__popupTest = state;
  const tabs = [
    { id: 11, windowId: 1, index: 0, active: true, pinned: false, title: "영상 속도와 자막의 설정을 확인하는 로컬 시험 영상", url: "https://www.youtube.com/watch?v=popup_fixture" },
    { id: 12, windowId: 1, index: 1, active: false, pinned: true, title: "작업 중인 페이지의 입력과 도구", url: "https://example.com/article" },
    { id: 13, windowId: 1, index: 2, active: false, pinned: false, title: "브라우저 설정", url: "chrome://settings/" }
  ];
  w.chrome.runtime.getManifest = () => ({ version: "1.60.0" });
  w.chrome.tabs.query = (q: Obj, callback: (tabs: Obj[]) => void) => queueMicrotask(() => callback(q.active ? tabs.filter(t => t.active) : tabs));
  w.close = () => { state.closeCalls++; };
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: (value: string) => { state.copied = value; return Promise.resolve(); }
  } });
  w.__browserTestResponse = (message: Obj) => {
    switch (message.type) {
      case "media-controller:get-tab-state": return { ok: true, hasMedia: state.hasMedia, rate: state.rate, label: "동영상" };
      case "media-controller:set-tab-rate":
        if (state.rateFailure) return { ok: false, error: "시험용 배속 변경 거부" };
        state.rate = message.rate; return { ok: true, hasMedia: true, rate: state.rate, label: "동영상" };
      case "page-element-eraser:get-site-status": return { ok: true, hostname: "www.youtube.com", ruleCount: 2 };
      case "tab-tools:get-keep-active-state": return { ok: true, globalEnabled: false, states: {} };
      case "tab-tools:set-selected-keep-active": return { ok: true, appliedCount: message.tabIds?.length ?? 0, restoredCount: message.tabIds?.length ?? 0, failedCount: 0, results: [] };
      case "youtube-transcript:get-info": return { ok: true, videoId: "popup_fixture", title: tabs[0].title,
        tracks: [{ id: "ko", languageCode: "ko", label: "한국어", isDefault: true, isTranslatable: true }, { id: "en", languageCode: "en", label: "영어" }],
        translationLanguages: [{ languageCode: "en", name: "영어" }, { languageCode: "ja", name: "일본어" }], syncedCaption: { active: state.synced, entryCount: state.synced ? 3 : 0 } };
      case "youtube-synced-captions:apply":
        if (state.captionFailure) return { ok: false, error: "시험용 자막 적용 거부" };
        state.synced = true; return { ok: true, syncedCaption: { active: true, videoId: "popup_fixture", entryCount: 3 } };
      case "youtube-synced-captions:remove": state.synced = false; return { ok: true };
      case "youtube-transcript:get-transcript": return { ok: true, title: tabs[0].title, videoId: "popup_fixture", entries: [{ startMs: 0, text: "첫 번째 시험 문장" }, { startMs: 2000, text: "두 번째 시험 문장" }] };
      case "settings-tools:export": return { ok: true, result: { app: "Browser Toolbox Extension", schemaVersion: 1, extensionVersion: "1.60.0", exportedAt: new Date().toISOString(), settings: { mediaSpeedStep: .2 } } };
    }
    // Settings message names come from the unchanged production contract at runtime.
    const settingsApi = w.ToolboxSettings;
    if (settingsApi && message.type === settingsApi.MESSAGES.EXPORT) return { ok: true, result: { app: "Browser Toolbox Extension", schemaVersion: 1, extensionVersion: "1.60.0", exportedAt: new Date().toISOString(), settings: { mediaSpeedStep: .2 } } };
    if (settingsApi && message.type === settingsApi.MESSAGES.PREVIEW) return { ok: true, result: { digest: "test-preview-only", changedKeys: ["mediaSpeedStep"], ruleSiteCount: 0, ruleCount: 0, includesGlobal: false } };
    if (settingsApi && message.type === settingsApi.MESSAGES.APPLY) { void test.update({ mediaSpeedStep: .2 }); return { ok: true, result: { changedCount: 1 } }; }
    if (settingsApi && message.type === settingsApi.MESSAGES.DIAGNOSTICS) return { ok: true, result: { environment: "Local popup API double", gpuVideoSuperResolution: "not-measured" } };
    return undefined;
  };
})();
