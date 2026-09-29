(() => {
  "use strict";

  const CONTROLLER_KEY = "__chatgptBrowserToolsMediaControllerV1__";
  const OVERLAY_HOST_ID = "__chatgpt_browser_tools_media_speed_overlay__";
  const YOUTUBE_SPEED_NOTICE_STYLE_ID = "btx-youtube-speed-notice-style";
  const AREA_SELECTOR_HOST_ID = "__drag_area_screenshot_host__";
  const ELEMENT_ERASER_HOST_ID = "__page_element_eraser_host__";

  const MESSAGE_TYPES = ToolboxShared.MEDIA_MESSAGES;

  const STORAGE_KEYS = ToolboxShared.MEDIA_KEYS;

  const SHORTCUT_DEFINITIONS = ToolboxShared.MEDIA_SHORTCUTS;
  const normalizeShortcutCode = ToolboxShared.normalizeShortcutCode;

  const LEGACY_OVERLAY_DEFAULT_POSITION = Object.freeze({ x: 0.02, y: 0.02 });
  const CENTER_TOP_OVERLAY_POSITION = Object.freeze({ x: 0.5, y: 0.02 });

  const DEFAULT_SETTINGS = Object.freeze({
    ...ToolboxShared.SHORTCUT_DEFAULTS,
    youtubeSpeedNoticeEnabled: false,
    [STORAGE_KEYS.enabled]: false,
    [STORAGE_KEYS.speedStep]: 0.1,
    [STORAGE_KEYS.seekStep]: 10,
    [STORAGE_KEYS.resetFallbackRate]: 2,
    [STORAGE_KEYS.keepRateForNewMedia]: false,
    [STORAGE_KEYS.overlayEnabled]: true,
    [STORAGE_KEYS.keyboardEnabled]: true,
    [STORAGE_KEYS.overlayPosition]: CENTER_TOP_OVERLAY_POSITION,
    [STORAGE_KEYS.shortcutSlower]: "KeyS",
    [STORAGE_KEYS.shortcutFaster]: "KeyD",
    [STORAGE_KEYS.shortcutReset]: "KeyR",
    [STORAGE_KEYS.shortcutBackward]: "KeyZ",
    [STORAGE_KEYS.shortcutForward]: "KeyX",
    [STORAGE_KEYS.shortcutOverlay]: "KeyV"
  });

  const settingsJournal = new ToolboxShared.SettingsReadJournal(Object.keys(DEFAULT_SETTINGS));

  const MIN_RATE = 0.07;
  const MAX_RATE = 16;
  const MIN_SPEED_STEP = 0.01;
  const MAX_SPEED_STEP = 2;
  const MIN_SEEK_STEP_SECONDS = 1;
  const MAX_SEEK_STEP_SECONDS = 600;
  const MIN_VIDEO_WIDTH = 120;
  const MIN_VIDEO_HEIGHT = 68;
  const POSITION_SAVE_DELAY_MS = 80;
  const RATE_REPORT_DELAY_MS = 80;
  const RUNTIME_RELOAD_MESSAGE = "확장 프로그램이 업데이트되거나 다시 로드되어 이 페이지와의 연결이 끊겼습니다. 페이지를 새로고침하면 배속 조절과 세션 저장이 다시 작동합니다.";

  interface SourceState { id: number; rate: number; restoreRate: number | null; initialized: boolean; lastUsedAt: number; }
  interface RuntimeState { mediaId: string; sourceGeneration: number; sourceKey: string; sourceStateKey: string; sourceState: SourceState | null; rateInitialized: boolean; expectedRateChange: { rate: number; sourceKey: string } | null; resume: { sourceKey: string; active: boolean } | null; }
  const scope = globalThis as typeof globalThis & { [CONTROLLER_KEY]?: unknown };
  if (scope[CONTROLLER_KEY]) return;

  const storageArea = globalThis.chrome?.storage?.local;
  const mediaElements = new Set<HTMLMediaElement>();
  const mediaListeners = new WeakMap<HTMLMediaElement, Record<string, EventListener>>();
  const mediaRuntimeStates = new WeakMap<HTMLMediaElement, RuntimeState>();
  const mediaSourceStates = new Map<string, SourceState>();
  const mediaObjectIds = new WeakMap<object, string>();

  let settings = normalizeSettings(DEFAULT_SETTINGS);
  let activeMedia: HTMLMediaElement | null = null;
  let mutationObserver: MutationObserver | null = null;
  let documentReadyListenerAttached = false;
  let cleanupScheduled = false;
  let overlayHost: HTMLDivElement|null = null;
  let overlayBadge: HTMLDivElement | null = null;
  let overlayText: HTMLSpanElement|null = null;
  let overlayFrame = 0;
  let youtubeNoticeFrame = 0;
  let overlayPositionSaveTimer = 0;
  let rateReportTimer = 0;
  let pendingMediaReport: { reason: string; updateTemplate: boolean; hasMedia: boolean; rate: number; templateRate: number; mediaId?: string; sourceKey?: string; kind?: "video"|"audio"; label?: string; persistence?: "unknown"|"pending"|"saved"|"failed"; lastError?: string; type: "media-controller:report-tab-rate"; }|null = null;
  let tabTemplateRate = 1;
  let tabTemplateRevision = 0;
  let mediaIdSequence = 0;
  let mediaObjectIdSequence = 0;
  let sourceStateSequence = 0;
  let dragging: { pointerId: number; video: HTMLVideoElement; pointerOffsetX: number; pointerOffsetY: number } | null = null;
  let keyboardEventListenerAttached = false;
  let viewportEventListenersAttached = false;
  let lifecycleSuspended = false;
  let lifecycleEpoch = 0;
  let resumingFromCache = false;
  let persistence: "unknown" | "pending" | "saved" | "failed" = "unknown";
  let lastOperationError = "";
  let errorNotice: HTMLElement | null = null;
  let errorNoticeTimer = 0;
  let reportSequence = 0;
  let runtimeDisconnected = false;

  function showMediaError(error: unknown): void {
    lastOperationError = ToolboxShared.errorMessage(error);
    if (lifecycleSuspended) return;
    if (!errorNotice?.isConnected) {
      errorNotice = document.createElement("div");
      errorNotice.id = "__browser_toolbox_media_error__";
      errorNotice.setAttribute("role", "status");
      errorNotice.style.cssText = "position:fixed;bottom:16px;left:16px;max-width:min(560px,90vw);padding:12px;background:#241717;color:white;border:1px solid #bd6464;border-radius:6px;font:14px/1.5 sans-serif;z-index:2147483647;pointer-events:none;white-space:normal;";
      (document.fullscreenElement || document.documentElement)?.appendChild(errorNotice);
    }
    errorNotice.textContent = lastOperationError;
    if (errorNoticeTimer) clearTimeout(errorNoticeTimer);
    errorNoticeTimer = window.setTimeout(() => { errorNotice?.remove(); errorNotice = null; errorNoticeTimer = 0; }, 7000);
  }

  function clamp(value: number, minimum: number, maximum: number) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function normalizeNumber(value: unknown, fallback: number, minimum: number, maximum: number, decimals = 2) {
    const numericValue = ToolboxShared.numericSetting(value);
    if (!Number.isFinite(numericValue)) return fallback;
    const factor = 10 ** decimals;
    return clamp(Math.round(numericValue * factor) / factor, minimum, maximum);
  }

  function normalizeRate(value: unknown) {
    return normalizeNumber(value, 1, MIN_RATE, MAX_RATE, 2);
  }

  function normalizeSpeedStep(value: unknown) {
    return normalizeNumber(value, 0.1, MIN_SPEED_STEP, MAX_SPEED_STEP, 2);
  }

  function normalizeResetFallbackRate(value: unknown) {
    return normalizeNumber(value, 2, MIN_RATE, MAX_RATE, 2);
  }

  function normalizeSeekStep(value: unknown) {
    const numericValue = ToolboxShared.numericSetting(value);
    if (!Number.isFinite(numericValue)) return 10;
    return clamp(Math.round(numericValue), MIN_SEEK_STEP_SECONDS, MAX_SEEK_STEP_SECONDS);
  }

  function normalizePosition(value: unknown) {
    const source = value && typeof value === "object"
      ? value as Record<string, unknown>
      : DEFAULT_SETTINGS[STORAGE_KEYS.overlayPosition];

    const normalized = {
      x: normalizeNumber(source.x, CENTER_TOP_OVERLAY_POSITION.x, 0, 1, 4),
      y: normalizeNumber(source.y, CENTER_TOP_OVERLAY_POSITION.y, 0, 1, 4)
    };

    // Version 1.22 used the exact upper-left coordinates below as its default.
    // Migrate that untouched default to the new upper-center position while
    // preserving every other position the user may have dragged to.
    if (
      Math.abs(normalized.x - LEGACY_OVERLAY_DEFAULT_POSITION.x) < 0.0001 &&
      Math.abs(normalized.y - LEGACY_OVERLAY_DEFAULT_POSITION.y) < 0.0001
    ) {
      return { ...CENTER_TOP_OVERLAY_POSITION };
    }

    return normalized;
  }


  function normalizeSettings(values: Record<string, unknown>) {
    const source = values && typeof values === "object" ? values : {};
    return {
      ...ToolboxShared.shortcutSettings(source),
      youtubeSpeedNoticeEnabled: source.youtubeSpeedNoticeEnabled === true,
      [STORAGE_KEYS.enabled]: typeof source[STORAGE_KEYS.enabled] === "boolean"
        ? source[STORAGE_KEYS.enabled]
        : DEFAULT_SETTINGS[STORAGE_KEYS.enabled],
      [STORAGE_KEYS.speedStep]: normalizeSpeedStep(
        Object.prototype.hasOwnProperty.call(source, STORAGE_KEYS.speedStep)
          ? source[STORAGE_KEYS.speedStep]
          : DEFAULT_SETTINGS[STORAGE_KEYS.speedStep]
      ),
      [STORAGE_KEYS.seekStep]: normalizeSeekStep(
        Object.prototype.hasOwnProperty.call(source, STORAGE_KEYS.seekStep)
          ? source[STORAGE_KEYS.seekStep]
          : DEFAULT_SETTINGS[STORAGE_KEYS.seekStep]
      ),
      [STORAGE_KEYS.resetFallbackRate]: normalizeResetFallbackRate(
        Object.prototype.hasOwnProperty.call(source, STORAGE_KEYS.resetFallbackRate)
          ? source[STORAGE_KEYS.resetFallbackRate]
          : DEFAULT_SETTINGS[STORAGE_KEYS.resetFallbackRate]
      ),
      [STORAGE_KEYS.keepRateForNewMedia]: typeof source[STORAGE_KEYS.keepRateForNewMedia] === "boolean"
        ? source[STORAGE_KEYS.keepRateForNewMedia]
        : DEFAULT_SETTINGS[STORAGE_KEYS.keepRateForNewMedia],
      [STORAGE_KEYS.overlayEnabled]: typeof source[STORAGE_KEYS.overlayEnabled] === "boolean"
        ? source[STORAGE_KEYS.overlayEnabled]
        : DEFAULT_SETTINGS[STORAGE_KEYS.overlayEnabled],
      [STORAGE_KEYS.keyboardEnabled]: typeof source[STORAGE_KEYS.keyboardEnabled] === "boolean"
        ? source[STORAGE_KEYS.keyboardEnabled]
        : DEFAULT_SETTINGS[STORAGE_KEYS.keyboardEnabled],
      [STORAGE_KEYS.overlayPosition]: normalizePosition(source[STORAGE_KEYS.overlayPosition]),
      ...Object.fromEntries(SHORTCUT_DEFINITIONS.map((definition) => [
        definition.storageKey,
        normalizeShortcutCode(source[definition.storageKey], definition.defaultCode)
      ]))
    };
  }

  function formatRate(rate: number) {
    return `${normalizeRate(rate).toFixed(2)}×`;
  }

  function isMediaElement(value: unknown): value is HTMLMediaElement {
    return typeof HTMLMediaElement !== "undefined" && value instanceof HTMLMediaElement;
  }

  function isVideoElement(value: unknown): value is HTMLVideoElement {
    return typeof HTMLVideoElement !== "undefined" && value instanceof HTMLVideoElement;
  }

  function getRuntimeErrorMessage() {
    return globalThis.chrome?.runtime?.lastError?.message || "";
  }

  function disconnectRuntime(): void {
    if (runtimeDisconnected) return;
    runtimeDisconnected = true;
    persistence = "failed";
    lifecycleEpoch++;
    // An invalidated content-script context cannot reconnect. Stop its writers
    // and pending work without changing playback or trying to save through it.
    teardownController(false);
    showMediaError(RUNTIME_RELOAD_MESSAGE);
  }

  function hasRuntimeContext(): boolean {
    if (runtimeDisconnected) return false;
    try {
      if (globalThis.chrome?.runtime?.id && typeof chrome.runtime.sendMessage === "function") return true;
    } catch { /* Chrome may invalidate the API object as well as runtime.id. */ }
    disconnectRuntime();
    return false;
  }

  function runtimeFailureMessage(error: unknown): string {
    const message = ToolboxShared.errorMessage(error);
    if (/extension context invalidated/i.test(message)) disconnectRuntime();
    if (!hasRuntimeContext()) return RUNTIME_RELOAD_MESSAGE;
    return message;
  }

  function saveStoredValues(values: Record<string, unknown>): void {
    if (!hasRuntimeContext()) return;
    void ToolboxShared.writeStorage(storageArea, globalThis.chrome?.runtime || {}, values)
      .catch(error => {
        const message = runtimeFailureMessage(error);
        if (!runtimeDisconnected) showMediaError(`현재 페이지에는 적용되었지만 설정 저장에 실패했습니다: ${message}`);
      });
  }

  function sendRuntimeMessage(message: { type: string }, callback?: (response: { ok?: boolean; error?: string; templateRate?: number; rate?: number }) => void) {
    if (!hasRuntimeContext()) {
      callback?.({ ok: false, error: RUNTIME_RELOAD_MESSAGE });
      return;
    }

    try {
      chrome.runtime.sendMessage(message, (response) => {
        const error = getRuntimeErrorMessage();
        callback?.(error ? { ok: false, error: runtimeFailureMessage(error) } : (response || { ok: false, error: "확장 프로그램의 응답이 없습니다." }));
      });
    } catch (error) {
      callback?.({ ok: false, error: runtimeFailureMessage(error) });
    }
  }

  function normalizeMediaText(value: string, maximumLength = 160) {
    return String(value || "")
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maximumLength);
  }

  function hashOpaqueText(value: string) {
    const text = String(value || "");
    let first = 0x811c9dc5;
    let second = 0x9e3779b9;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      first = Math.imul(first ^ code, 0x01000193);
      second = Math.imul(second ^ (code + index), 0x85ebca6b);
    }
    return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
  }

  function getPageMediaContext() {
    try {
      const url = new URL(location.href);
      const host = url.hostname.toLowerCase();
      if (host === "youtube.com" || host.endsWith(".youtube.com")) {
        const watchId = url.pathname === "/watch" ? url.searchParams.get("v") : "";
        const pathMatch = url.pathname.match(/^\/(?:shorts|live|embed)\/([^/?#]+)/i);
        const videoId = watchId || pathMatch?.[1] || "";
        if (videoId) return `youtube:${hashOpaqueText(videoId)}`;
      }
      url.hash = "";
      return `page:${hashOpaqueText(`${url.origin}${url.pathname}${url.search}`)}`;
    } catch {
      return `page:${hashOpaqueText(String(location.href || "document").split("#", 1)[0])}`;
    }
  }

  function getObjectId(value: object, prefix = "object") {
    if (!value || (typeof value !== "object" && typeof value !== "function")) return "";
    let id = mediaObjectIds.get(value);
    if (!id) {
      mediaObjectIdSequence += 1;
      id = `${prefix}-${mediaObjectIdSequence}`;
      mediaObjectIds.set(value, id);
    }
    return id;
  }

  function resolveMediaUrl(value: string) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    try {
      return new URL(raw, document.baseURI).href;
    } catch {
      return raw.slice(0, 2048);
    }
  }

  function getMediaSourceDescriptor(media: HTMLMediaElement, runtimeState: RuntimeState) {
    const pageContext = getPageMediaContext();
    let rawSource = "";

    try {
      rawSource = media.currentSrc || media.getAttribute("src") || "";
    } catch {
      rawSource = "";
    }

    if (!rawSource && typeof media.querySelector === "function") {
      rawSource = media.querySelector("source[src]")?.getAttribute("src") || "";
    }

    const resolvedSource = resolveMediaUrl(rawSource);
    if (resolvedSource) {
      const sourceHash = hashOpaqueText(resolvedSource);
      if (/^(?:blob|mediasource):/i.test(resolvedSource)) {
        return `dynamic:${sourceHash}|${pageContext}`;
      }
      return `url:${sourceHash}`;
    }

    try {
      if (media.srcObject) {
        return `stream:${getObjectId(media.srcObject, "stream")}|${pageContext}`;
      }
    } catch {
      // Some pages expose a guarded srcObject getter.
    }

    return `empty:${runtimeState.mediaId}:${runtimeState.sourceGeneration}|${pageContext}`;
  }

  function getMediaLabel(media: HTMLMediaElement) {
    const kind = isVideoElement(media) ? "동영상" : "오디오";
    const directLabel = normalizeMediaText(
      media.getAttribute?.("aria-label") ||
      media.getAttribute?.("title") ||
      media.closest?.("[aria-label]")?.getAttribute?.("aria-label") ||
      "",
      120
    );
    if (directLabel) return `${kind} · ${directLabel}`;

    let source = "";
    try {
      source = media.currentSrc || media.getAttribute("src") || "";
    } catch {
      source = "";
    }
    if (source && !/^(?:blob|data|mediasource):/i.test(source)) {
      try {
        const url = new URL(source, document.baseURI);
        const filename = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || url.hostname);
        if (filename) return `${kind} · ${normalizeMediaText(filename, 100)}`;
      } catch {
        // Fall back to the document title below.
      }
    }

    const documentLabel = normalizeMediaText(document.title, 100);
    return documentLabel ? `${kind} · ${documentLabel}` : kind;
  }

  function getMediaRuntimeState(media: HTMLMediaElement) {
    let state = mediaRuntimeStates.get(media);
    if (!state) {
      mediaIdSequence += 1;
      state = {
        mediaId: `media-${mediaIdSequence}`,
        sourceGeneration: 0,
        sourceKey: "",
        sourceStateKey: "",
        sourceState: null,
        rateInitialized: false,
        expectedRateChange: null,
        resume: null
      };
      mediaRuntimeStates.set(media, state);
    }
    return state;
  }

  function pruneMediaSourceStates() {
    const maximum = 240;
    if (mediaSourceStates.size <= maximum) return;
    const ordered = [...mediaSourceStates.entries()]
      .sort((first, second) => Number(first[1]?.lastUsedAt || 0) - Number(second[1]?.lastUsedAt || 0));
    for (const [key] of ordered.slice(0, mediaSourceStates.size - maximum)) {
      mediaSourceStates.delete(key);
    }
  }

  function getMediaSourceState(media: HTMLMediaElement, forceRefresh = false) {
    const runtimeState = getMediaRuntimeState(media);
    if (forceRefresh) runtimeState.sourceKey = "";

    const nextSourceKey = getMediaSourceDescriptor(media, runtimeState);
    if (runtimeState.sourceKey !== nextSourceKey || !runtimeState.sourceState) {
      runtimeState.sourceKey = nextSourceKey;
      runtimeState.sourceStateKey = `${runtimeState.mediaId}\n${nextSourceKey}`;
      let sourceState = mediaSourceStates.get(runtimeState.sourceStateKey);
      if (!sourceState) {
        sourceStateSequence += 1;
        sourceState = {
          id: sourceStateSequence,
          rate: settings[STORAGE_KEYS.keepRateForNewMedia] ? tabTemplateRate : 1,
          restoreRate: null,
          initialized: false,
          lastUsedAt: Date.now()
        };
        mediaSourceStates.set(runtimeState.sourceStateKey, sourceState);
        pruneMediaSourceStates();
      }
      runtimeState.sourceState = sourceState;
      runtimeState.rateInitialized = false;
    }

    runtimeState.sourceState.lastUsedAt = Date.now();
    return runtimeState.sourceState;
  }

  function makeMediaStatePayload(media: unknown): ToolboxShared.MediaSnapshot {
    if (!isMediaElement(media) || !media.isConnected) {
      return { hasMedia: false, rate: tabTemplateRate, templateRate: tabTemplateRate };
    }

    const runtimeState = getMediaRuntimeState(media);
    getMediaSourceState(media);
    // Observation is not a request: do not replace an unreadable/zero rate with a stored value.
    const rate = Number(media.playbackRate);

    return {
      hasMedia: true,
      mediaId: runtimeState.mediaId,
      sourceKey: runtimeState.sourceKey,
      rate,
      persistence,
      lastError: lastOperationError,
      templateRate: tabTemplateRate,
      kind: isVideoElement(media) ? "video" : "audio",
      label: getMediaLabel(media)
    };
  }

  function queueActiveMediaReport(media: unknown, reason = "selection", updateTemplate = false, immediate = false) {
    if (runtimeDisconnected || lifecycleSuspended || !isMediaElement(media) || !media.isConnected) return;
    const payload = {
      type: MESSAGE_TYPES.REPORT_TAB_RATE,
      ...makeMediaStatePayload(media),
      reason,
      updateTemplate: Boolean(updateTemplate)
    };
    pendingMediaReport = payload;
    const sequence = ++reportSequence;

    const send = () => {
      rateReportTimer = 0;
      const report = pendingMediaReport;
      pendingMediaReport = null;
      if (!report) return;
      persistence = "pending";
      sendRuntimeMessage(report, (response) => {
        if (sequence !== reportSequence) return;
        if (response?.ok === true && Number.isFinite(Number(response.templateRate))) {
          persistence = "saved";
          if (lastOperationError.startsWith("현재 배속은 적용되었지만 세션 상태를 저장하지 못했습니다:")) lastOperationError = "";
          if (errorNotice?.textContent?.startsWith("현재 배속은 적용되었지만 세션 상태를 저장하지 못했습니다:")) {
            if (errorNoticeTimer) clearTimeout(errorNoticeTimer);
            errorNoticeTimer = 0;
            errorNotice.remove();
            errorNotice = null;
          }
          // A delayed report must not replace a newer local rate choice.
        } else {
          persistence = "failed";
          showMediaError(`현재 배속은 적용되었지만 세션 상태를 저장하지 못했습니다: ${response?.error || "응답 없음"}`);
        }
      });
    };

    if (rateReportTimer) window.clearTimeout(rateReportTimer);
    if (immediate) send();
    else rateReportTimer = window.setTimeout(send, RATE_REPORT_DELAY_MS);
  }

  function setTabTemplateRate(rate: number) {
    tabTemplateRevision++;
    tabTemplateRate = normalizeRate(rate);
    return tabTemplateRate;
  }

  function loadTabState(callback: { (): void; (): void; }) {
    const templateRevision = tabTemplateRevision;
    const epoch = lifecycleEpoch;
    sendRuntimeMessage({ type: MESSAGE_TYPES.GET_TAB_STATE }, (response) => {
      if (lifecycleSuspended || epoch !== lifecycleEpoch) return;
      const rate = response?.ok === true
        ? (response.templateRate ?? response.rate)
        : 1;
      if (response?.ok !== true) {
        persistence = "failed";
        showMediaError(`세션 배속을 읽지 못했습니다: ${response?.error || "응답 없음"}`);
      } else if (templateRevision === tabTemplateRevision) tabTemplateRate = normalizeRate(rate);
      callback?.();
    });
  }


  function queueStoredOverlayPosition() {
    if (overlayPositionSaveTimer) window.clearTimeout(overlayPositionSaveTimer);
    overlayPositionSaveTimer = window.setTimeout(() => {
      overlayPositionSaveTimer = 0;
      saveStoredValues({
        [STORAGE_KEYS.overlayPosition]: settings[STORAGE_KEYS.overlayPosition]
      });
    }, POSITION_SAVE_DELAY_MS);
  }

  function safeSetPlaybackRate(media: HTMLMediaElement, rate: number): ToolboxShared.RateChangeResult {
    const state = getMediaRuntimeState(media);
    // Native ratechange events are asynchronous. Only our own value on this
    // source is an echo; a site's subsequent value must still reach storage.
    state.expectedRateChange = { rate, sourceKey: state.sourceKey };
    const result = ToolboxShared.applyPlaybackRate(media, rate);
    if (!result.ok) state.expectedRateChange = null;
    return result;
  }

  function recordRestorableRate(media: unknown, rate: number) {
    if (!isMediaElement(media)) return;
    const numericRate = Number(rate);
    if (!Number.isFinite(numericRate) || numericRate <= 0) return;
    const normalizedRate = normalizeRate(numericRate);
    if (Math.abs(normalizedRate - 1) < 0.0001) return;
    getMediaSourceState(media).restoreRate = normalizedRate;
  }

  function initializeMediaRate(media: unknown, force = false) {
    if (!settings[STORAGE_KEYS.enabled] || !isMediaElement(media)) return;
    const runtimeState = getMediaRuntimeState(media);
    const sourceState = getMediaSourceState(media, force);
    if (runtimeState.rateInitialized && sourceState.initialized && !force) return;

    const targetRate = sourceState.initialized
      ? normalizeRate(sourceState.rate)
      : (settings[STORAGE_KEYS.keepRateForNewMedia] ? tabTemplateRate : 1);

    const result = safeSetPlaybackRate(media, targetRate);
    // Mark this attempt, not an unobserved rate, to avoid retrying a rejected rate on every query.
    runtimeState.rateInitialized = true;
    sourceState.initialized = true;
    if (result.ok === false) {
      if (ToolboxShared.isRate(result.actualRate)) sourceState.rate = result.actualRate;
      showMediaError(result.error);
      return;
    }
    sourceState.rate = result.actualRate;
    if (Math.abs(result.actualRate - 1) >= 0.0001 && !ToolboxShared.isRate(sourceState.restoreRate)) {
      sourceState.restoreRate = result.actualRate;
    }
  }


  function isVisibleVideo(video: unknown) {
    if (!isVideoElement(video) || !video.isConnected) return false;
    const rect = video.getBoundingClientRect();
    if (rect.width < MIN_VIDEO_WIDTH || rect.height < MIN_VIDEO_HEIGHT) return false;
    if (
      rect.bottom <= 0 ||
      rect.right <= 0 ||
      rect.top >= window.innerHeight ||
      rect.left >= window.innerWidth
    ) {
      return false;
    }

    const style = getComputedStyle(video);
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0;
  }

  function isYouTubeDocument() {
    const host = String(location.hostname || "").toLowerCase();
    return host === "youtube.com" || host.endsWith(".youtube.com") ||
      host === "youtube-nocookie.com" || host.endsWith(".youtube-nocookie.com");
  }

  function getYouTubeSpeedNoticeTarget(): { video: HTMLVideoElement; player: HTMLElement } | null {
    if (!isYouTubeDocument()) return null;
    const players = [...document.querySelectorAll<HTMLElement>(".html5-video-player")];
    const selected = isVideoElement(activeMedia) ? activeMedia.closest<HTMLElement>(".html5-video-player") : null;
    if (selected) players.sort((a, b) => a === selected ? -1 : b === selected ? 1 : 0);
    for (const player of players) {
      if (player.closest("[hidden]") || !player.getClientRects().length) continue;
      const videos = [...player.querySelectorAll<HTMLVideoElement>("video")].filter(v => v.isConnected && v.getClientRects().length > 0);
      const main = videos.find(v => v.matches(".html5-main-video")) || (videos.length === 1 ? videos[0] : null);
      if (main) return { video: main, player };
    }
    return null;
  }

  type SpeedNotice = { video: HTMLVideoElement; player: HTMLElement; toast: HTMLElement; toastTimer: number; lastRate: number };
  let youtubeNotice: SpeedNotice | null = null;
  function ensureYouTubeSpeedNoticeStyle(): void {
    if (document.getElementById(YOUTUBE_SPEED_NOTICE_STYLE_ID)) return;
    const style = document.createElement("style"); style.id = YOUTUBE_SPEED_NOTICE_STYLE_ID;
    style.textContent = `
      #btx-youtube-speed-toast { position:absolute; left:50%; top:42%; transform:translate(-50%,-50%); max-width:90%; padding:12px 20px; border:1px solid #ffffff30; border-radius:12px; background:#1a1b1ef5; color:#fff; font:600 27px/1.25 Roboto,Arial,sans-serif; font-variant-numeric:tabular-nums; z-index:65; pointer-events:none; white-space:nowrap; filter:none !important; backdrop-filter:none !important; -webkit-backdrop-filter:none !important; }
      #btx-youtube-speed-toast[hidden] { display:none !important; }
    `;
    (document.head || document.documentElement)?.appendChild(style);
  }
  function removeYouTubeSpeedNotice(): void {
    const ui = youtubeNotice; youtubeNotice = null;
    if (ui) { clearTimeout(ui.toastTimer); ui.toast.remove(); }
    document.getElementById(YOUTUBE_SPEED_NOTICE_STYLE_ID)?.remove();
  }
  function updateYouTubeSpeedNotice(ui: SpeedNotice): void {
    const actual = ui.video.playbackRate;
    if (!ToolboxShared.isRate(actual) || Math.abs(ui.lastRate - actual) <= 0.0001) return;
    ui.lastRate = actual;
    ui.toast.textContent = formatRate(actual); ui.toast.hidden = false;
    clearTimeout(ui.toastTimer);
    ui.toastTimer = window.setTimeout(() => { ui.toast.hidden = true; ui.toastTimer = 0; }, 1200);
  }
  function makeYouTubeSpeedNotice(target: { video: HTMLVideoElement; player: HTMLElement }): SpeedNotice {
    ensureYouTubeSpeedNoticeStyle();
    const toast = document.createElement("div"); toast.id = "btx-youtube-speed-toast"; toast.hidden = true;
    toast.setAttribute("role", "status"); toast.setAttribute("aria-live", "polite");
    target.player.append(toast);
    return { ...target, toast, toastTimer: 0, lastRate: target.video.playbackRate };
  }
  function renderYouTubeSpeedNotice(): void {
    youtubeNoticeFrame = 0;
    if (lifecycleSuspended || !settings[STORAGE_KEYS.enabled] || !settings.youtubeSpeedNoticeEnabled) { removeYouTubeSpeedNotice(); return; }
    const target = getYouTubeSpeedNoticeTarget();
    if (!target) { removeYouTubeSpeedNotice(); return; }
    if (youtubeNotice && (youtubeNotice.video !== target.video || youtubeNotice.player !== target.player || !youtubeNotice.toast.isConnected)) removeYouTubeSpeedNotice();
    if (!youtubeNotice) youtubeNotice = makeYouTubeSpeedNotice(target);
    updateYouTubeSpeedNotice(youtubeNotice);
  }
  function scheduleYouTubeSpeedNoticeUpdate(): void {
    if (lifecycleSuspended || runtimeDisconnected || !isYouTubeDocument() || youtubeNoticeFrame) return;
    if (!youtubeNotice && !settings.youtubeSpeedNoticeEnabled) return;
    youtubeNoticeFrame = window.requestAnimationFrame(renderYouTubeSpeedNotice);
  }

  function visibleVideoArea(video: HTMLMediaElement) {
    if (!isVisibleVideo(video)) return 0;
    const rect = video.getBoundingClientRect();
    const width = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
    const height = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
    return width * height;
  }

  function chooseBestMedia() {
    cleanupDisconnectedMedia();

    const playing = [];
    const visibleVideos = [];
    const remaining = [];

    for (const media of mediaElements) {
      if (!media.isConnected) continue;
      if (!media.paused && !media.ended) playing.push(media);
      if (isVideoElement(media) && isVisibleVideo(media)) visibleVideos.push(media);
      else remaining.push(media);
    }

    if (playing.length > 0) {
      const playingVideos = playing
        .filter((media) => isVideoElement(media) && isVisibleVideo(media))
        .sort((first, second) => visibleVideoArea(second) - visibleVideoArea(first));
      return playingVideos[0] || playing[playing.length - 1];
    }

    visibleVideos.sort((first, second) => visibleVideoArea(second) - visibleVideoArea(first));
    return visibleVideos[0] || remaining[0] || null;
  }

  function getActiveMedia() {
    if (!isMediaElement(activeMedia) || !activeMedia.isConnected) {
      activeMedia = chooseBestMedia();
    }
    return activeMedia;
  }

  function selectActiveMedia(media: unknown, reason = "selection", report = true) {
    if (!isMediaElement(media) || !media.isConnected) return;
    initializeMediaRate(media);
    activeMedia = media;
    if (report) queueActiveMediaReport(media, reason, false);
    scheduleOverlayUpdate();
    scheduleYouTubeSpeedNoticeUpdate();
  }

  function handleLoadStart(event: Event) {
    const media = event.currentTarget;
    if (!isMediaElement(media)) return;
    const runtimeState = getMediaRuntimeState(media);
    runtimeState.sourceGeneration += 1;
    runtimeState.sourceKey = "";
    runtimeState.sourceState = null;
    runtimeState.rateInitialized = false;
    runtimeState.expectedRateChange = null;
    scheduleYouTubeSpeedNoticeUpdate();
  }

  function handleLoadedMetadata(event: Event) {
    const media = event.currentTarget;
    if (!isMediaElement(media)) return;
    initializeMediaRate(media, true);
    if (!activeMedia || (!media.paused && !media.ended)) selectActiveMedia(media, "metadata");
    scheduleYouTubeSpeedNoticeUpdate();
  }

  function handlePlay(event: Event) {
    const media = event.currentTarget;
    if (!isMediaElement(media)) return;
    initializeMediaRate(media);
    selectActiveMedia(media, "play", true);
  }

  function handlePointerEnter(event: Event) {
    if (!event?.isTrusted) return;
    const media = event.currentTarget;
    if (isMediaElement(media)) selectActiveMedia(media, "pointer", true);
  }

  function handleRateChange(event: Event) {
    const media = event.currentTarget;
    if (!isMediaElement(media)) return;
    const runtimeState = getMediaRuntimeState(media);
    const sourceState = getMediaSourceState(media);
    const rawRate = Number(media.playbackRate);
    if (!Number.isFinite(rawRate) || rawRate <= 0) return;

    // load() can emit a reset to defaultPlaybackRate before metadata is ready.
    // This is a new-source reset, not a new user preference.
    if (!runtimeState.rateInitialized && media.readyState === 0 && rawRate === media.defaultPlaybackRate) return;
    const expected = runtimeState.expectedRateChange;
    runtimeState.expectedRateChange = null;
    const ownChange = expected?.sourceKey === runtimeState.sourceKey && expected.rate === rawRate;
    const normalizedRate = normalizeRate(rawRate);
    sourceState.rate = normalizedRate;
    sourceState.initialized = true;

    if (!ownChange) {
      recordRestorableRate(media, normalizedRate);
      setTabTemplateRate(normalizedRate);
      if (media === activeMedia || !media.paused) {
        activeMedia = media;
        queueActiveMediaReport(media, "ratechange", true, true);
      }
    }

    if (media === activeMedia) {
      updateOverlayText();
      scheduleOverlayUpdate();
    }
    scheduleYouTubeSpeedNoticeUpdate();
  }


  function handleMediaEnded(event: Event) {
    if (event.currentTarget === activeMedia) scheduleOverlayUpdate();
  }

  function registerMedia(media: unknown): void {
    if (!isMediaElement(media) || mediaElements.has(media)) return;

    const listeners = {
      loadstart: handleLoadStart,
      loadedmetadata: handleLoadedMetadata,
      play: handlePlay,
      playing: handlePlay,
      pointerenter: handlePointerEnter,
      focus: handlePointerEnter,
      ratechange: handleRateChange,
      ended: handleMediaEnded
    };

    for (const [type, listener] of Object.entries(listeners)) {
      media.addEventListener(type, listener, true);
    }

    mediaElements.add(media);
    mediaListeners.set(media, listeners);

    const runtimeState = getMediaRuntimeState(media);
    const resume = runtimeState.resume;
    runtimeState.resume = null;
    const resumingSameSource = resume?.sourceKey === getMediaSourceDescriptor(media, runtimeState);
    if (resumingFromCache || resumingSameSource) {
      // A surviving element may have changed while tracking was off. Reading
      // its live rate must not assign a stale source snapshot or a default.
      const sourceState = getMediaSourceState(media);
      sourceState.rate = media.playbackRate;
      sourceState.initialized = true;
      runtimeState.rateInitialized = true;
      if (resumingSameSource && resume?.active) {
        activeMedia = media;
        recordRestorableRate(media, media.playbackRate);
        setTabTemplateRate(media.playbackRate);
        queueActiveMediaReport(media, "resume", true, true);
      }
    } else if (settings[STORAGE_KEYS.enabled] && media.readyState >= 1) initializeMediaRate(media, true);
    if (!activeMedia && isVideoElement(media) && isVisibleVideo(media)) {
      activeMedia = media;
      if (resumingSameSource) setTabTemplateRate(media.playbackRate);
      queueActiveMediaReport(media, "initial", resumingSameSource);
    }
    scheduleYouTubeSpeedNoticeUpdate();
  }

  function unregisterMedia(media: HTMLMediaElement): void {
    const listeners = mediaListeners.get(media);
    if (listeners) {
      for (const [type, listener] of Object.entries(listeners)) {
        media.removeEventListener(type, listener, true);
      }
      mediaListeners.delete(media);
    }
    mediaElements.delete(media);
    if (activeMedia === media) activeMedia = null;
    scheduleYouTubeSpeedNoticeUpdate();
  }

  function cleanupDisconnectedMedia() {
    for (const media of [...mediaElements]) {
      if (!media.isConnected) unregisterMedia(media);
    }
  }

  function scheduleCleanup() {
    if (cleanupScheduled) return;
    cleanupScheduled = true;
    queueMicrotask(() => {
      cleanupScheduled = false;
      cleanupDisconnectedMedia();
      scheduleOverlayUpdate();
      scheduleYouTubeSpeedNoticeUpdate();
    });
  }

  function scanNode(node: Node | Document | DocumentFragment | null): void {
    if (!node) return;
    if (isMediaElement(node)) registerMedia(node);

    if (
      node.nodeType !== Node.ELEMENT_NODE &&
      node.nodeType !== Node.DOCUMENT_NODE &&
      node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE
    ) {
      return;
    }

    if (typeof (node as ParentNode).querySelectorAll === "function") {
      for (const media of (node as ParentNode).querySelectorAll<HTMLMediaElement>("video, audio"))
        registerMedia(media);
    }
  }

  function startMutationObserver() {
    if (lifecycleSuspended || !settings[STORAGE_KEYS.enabled]) return;

    scanNode(document);
    scheduleYouTubeSpeedNoticeUpdate();
    const root = document.documentElement;
    if (!root || mutationObserver) return;

    mutationObserver = new MutationObserver((records) => {
      let sawRemoval = false;
      for (const record of records) {
        for (const node of record.addedNodes) scanNode(node);
        if (record.removedNodes.length > 0) sawRemoval = true;
        if (record.type === "attributes" && record.attributeName === "src") {
          const target = record.target;
          const media = isMediaElement(target)
            ? target
            : ((target as Element)?.closest?.("video, audio") as HTMLMediaElement | null);
          if (isMediaElement(media)) {
            const runtimeState = getMediaRuntimeState(media);
            runtimeState.sourceKey = "";
            runtimeState.sourceState = null;
            runtimeState.rateInitialized = false;
            if (media.readyState >= 1) initializeMediaRate(media, true);
          }
        }
      }
      if (sawRemoval) scheduleCleanup();
      scheduleYouTubeSpeedNoticeUpdate();
    });

    mutationObserver.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src"]
    });
  }

  function handleDocumentReadyForTracking() {
    if (!document.documentElement) return;
    document.removeEventListener("readystatechange", handleDocumentReadyForTracking);
    documentReadyListenerAttached = false;
    if (settings[STORAGE_KEYS.enabled]) startMutationObserver();
  }

  function ensureMutationObserver() {
    if (lifecycleSuspended || runtimeDisconnected || !settings[STORAGE_KEYS.enabled]) return;
    if (document.documentElement) {
      startMutationObserver();
      return;
    }

    if (!documentReadyListenerAttached) {
      documentReadyListenerAttached = true;
      document.addEventListener("readystatechange", handleDocumentReadyForTracking);
    }
  }

  function cancelPendingMediaReport(): void {
    if (rateReportTimer) window.clearTimeout(rateReportTimer);
    rateReportTimer = 0;
    pendingMediaReport = null;
    reportSequence++;
  }

  function stopMediaTracking(adoptOnResume = false) {
    cancelPendingMediaReport();
    mutationObserver?.disconnect();
    mutationObserver = null;

    const previousActiveMedia = activeMedia;
    for (const media of [...mediaElements]) {
      const state = getMediaRuntimeState(media);
      state.expectedRateChange = null;
      if (adoptOnResume) state.resume = { sourceKey: getMediaSourceDescriptor(media, state), active: media === previousActiveMedia };
      unregisterMedia(media);
    }
    activeMedia = null;
    dragging = null;
    hideOverlay();
    if (youtubeNoticeFrame) {
      window.cancelAnimationFrame(youtubeNoticeFrame);
      youtubeNoticeFrame = 0;
    }
    removeYouTubeSpeedNotice();
  }

  function getOverlayParent(video: Node|null) {
    const fullscreenElement = document.fullscreenElement;
    if (
      fullscreenElement instanceof Element &&
      fullscreenElement !== video &&
      fullscreenElement.contains(video)
    ) {
      return fullscreenElement;
    }
    return document.documentElement || document.body;
  }

  function ensureOverlay() {
    if (overlayHost?.isConnected && overlayBadge && overlayText) return;

    document.getElementById(OVERLAY_HOST_ID)?.remove();

    overlayHost = document.createElement("div");
    overlayHost.id = OVERLAY_HOST_ID;
    overlayHost.style.cssText = [
      "all: initial",
      "position: fixed",
      "top: 0",
      "left: 0",
      "z-index: 2147483645",
      "display: none",
      "width: max-content",
      "height: max-content",
      "pointer-events: auto",
      "transform: translate3d(0, 0, 0)"
    ].join(";");

    const shadow = overlayHost.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    // Do not apply backdrop-filter to an overlay that intersects the video.
    // Chromium rejects DirectComposition video overlay promotion in that case,
    // which can prevent NVIDIA RTX Video Super Resolution from using its normal
    // overlay-swapchain processing path on Windows.
    style.textContent = `
      :host { all: initial; }
      .badge {
        box-sizing: border-box;
        min-width: 54px;
        padding: 6px 9px;
        border: 1px solid rgba(255, 255, 255, 0.34);
        border-radius: 8px;
        background: rgba(12, 18, 28, 0.94);
        box-shadow: 0 3px 12px rgba(0, 0, 0, 0.28);
        color: #ffffff;
        cursor: grab;
        font: 700 13px/1.15 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0.01em;
        text-align: center;
        user-select: none;
        -webkit-user-select: none;
        touch-action: none;
        white-space: nowrap;
      }
      .badge:active { cursor: grabbing; }
      .badge:focus-visible {
        outline: 3px solid rgba(96, 165, 250, 0.9);
        outline-offset: 2px;
      }
    `;

    overlayBadge = document.createElement("div");
    overlayBadge.className = "badge";
    overlayBadge.tabIndex = 0;
    overlayBadge.setAttribute("role", "status");
    overlayBadge.setAttribute("aria-label", "현재 미디어 재생 속도");

    overlayText = document.createElement("span");
    overlayText.textContent = formatRate(tabTemplateRate);
    overlayBadge.appendChild(overlayText);
    shadow.append(style, overlayBadge);

    overlayBadge.addEventListener("pointerdown", startOverlayDrag);
    overlayBadge.addEventListener("pointermove", moveOverlayDrag);
    overlayBadge.addEventListener("pointerup", finishOverlayDrag);
    overlayBadge.addEventListener("pointercancel", finishOverlayDrag);

    const parent = document.documentElement || document.body;
    if (parent) parent.appendChild(overlayHost);
  }

  function hideOverlay() {
    if (overlayHost) overlayHost.style.display = "none";
  }

  function updateOverlayText() {
    if (!overlayText) return;
    const media = getActiveMedia();
    const rate = isMediaElement(media) ? Number(media.playbackRate) : tabTemplateRate;
    overlayText.textContent = formatRate(rate);
  }

  function getOverlayGeometry(video: HTMLVideoElement) {
    if (!isVisibleVideo(video) || !overlayBadge) return null;

    const videoRect = video.getBoundingClientRect();
    const badgeRect = overlayBadge.getBoundingClientRect();
    const badgeWidth = Math.max(1, badgeRect.width);
    const badgeHeight = Math.max(1, badgeRect.height);
    const availableWidth = Math.max(0, videoRect.width - badgeWidth);
    const availableHeight = Math.max(0, videoRect.height - badgeHeight);
    const position = settings[STORAGE_KEYS.overlayPosition];

    const rawLeft = videoRect.left + position.x * availableWidth;
    const rawTop = videoRect.top + position.y * availableHeight;
    const minimumLeft = Math.max(0, videoRect.left);
    const maximumLeft = Math.min(window.innerWidth - badgeWidth, videoRect.right - badgeWidth);
    const minimumTop = Math.max(0, videoRect.top);
    const maximumTop = Math.min(window.innerHeight - badgeHeight, videoRect.bottom - badgeHeight);

    if (maximumLeft < minimumLeft || maximumTop < minimumTop) return null;

    return {
      videoRect,
      badgeWidth,
      badgeHeight,
      availableWidth,
      availableHeight,
      left: clamp(rawLeft, minimumLeft, maximumLeft),
      top: clamp(rawTop, minimumTop, maximumTop)
    };
  }

  function renderOverlay() {
    overlayFrame = 0;

    if (!settings[STORAGE_KEYS.enabled] || !settings[STORAGE_KEYS.overlayEnabled]) {
      hideOverlay();
      return;
    }

    const media = getActiveMedia();
    if (!isVideoElement(media) || !isVisibleVideo(media)) {
      const candidate = chooseBestMedia();
      if (isVideoElement(candidate)) activeMedia = candidate;
    }

    const video = getActiveMedia();
    if (!isVideoElement(video) || !isVisibleVideo(video)) {
      hideOverlay();
      return;
    }

    ensureOverlay();
    if (!overlayHost || !overlayBadge) return;

    const parent = getOverlayParent(video);
    if (parent && overlayHost.parentNode !== parent) parent.appendChild(overlayHost);

    overlayHost.style.display = "block";
    updateOverlayText();

    const geometry = getOverlayGeometry(video);
    if (!geometry) {
      hideOverlay();
      return;
    }

    overlayHost.style.transform = `translate3d(${Math.round(geometry.left)}px, ${Math.round(geometry.top)}px, 0)`;
  }

  function scheduleOverlayUpdate() {
    if (lifecycleSuspended || runtimeDisconnected) return;
    if (overlayFrame) return;
    overlayFrame = window.requestAnimationFrame(renderOverlay);
  }

  function startOverlayDrag(event: PointerEvent) {
    if (!event?.isTrusted || event.button !== 0) return;
    if (!hasRuntimeContext()) return;
    const video = getActiveMedia();
    if (!isVideoElement(video) || !overlayBadge) return;

    const geometry = getOverlayGeometry(video);
    if (!geometry) return;

    const badgeRect = overlayBadge.getBoundingClientRect();
    dragging = {
      pointerId: event.pointerId,
      video,
      pointerOffsetX: event.clientX - badgeRect.left,
      pointerOffsetY: event.clientY - badgeRect.top
    };

    overlayBadge.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  function moveOverlayDrag(event: PointerEvent) {
    if (!event?.isTrusted || !dragging || event.pointerId !== dragging.pointerId || !overlayBadge) return;
    const video = dragging.video;
    if (!isVideoElement(video) || !video.isConnected) {
      finishOverlayDrag(event);
      return;
    }

    const videoRect = video.getBoundingClientRect();
    const badgeRect = overlayBadge.getBoundingClientRect();
    const availableWidth = Math.max(0, videoRect.width - badgeRect.width);
    const availableHeight = Math.max(0, videoRect.height - badgeRect.height);
    const left = clamp(
      event.clientX - dragging.pointerOffsetX,
      videoRect.left,
      videoRect.left + availableWidth
    );
    const top = clamp(
      event.clientY - dragging.pointerOffsetY,
      videoRect.top,
      videoRect.top + availableHeight
    );

    settings[STORAGE_KEYS.overlayPosition] = {
      x: availableWidth > 0 ? clamp((left - videoRect.left) / availableWidth, 0, 1) : 0,
      y: availableHeight > 0 ? clamp((top - videoRect.top) / availableHeight, 0, 1) : 0
    };

    scheduleOverlayUpdate();
    event.preventDefault();
    event.stopPropagation();
  }

  function finishOverlayDrag(event?: PointerEvent) {
    if (event && !event.isTrusted) return;
    if (!dragging) return;
    if (event?.pointerId !== undefined && event.pointerId !== dragging.pointerId) return;

    try {
      overlayBadge?.releasePointerCapture?.(dragging.pointerId);
    } catch {
      // Pointer capture may already have been released by the browser.
    }

    dragging = null;
    queueStoredOverlayPosition();
    event?.preventDefault?.();
    event?.stopPropagation?.();
  }


  function pageToolIsActive() {
    return Boolean(
      document.getElementById(AREA_SELECTOR_HOST_ID) ||
      document.getElementById(ELEMENT_ERASER_HOST_ID)
    );
  }

  function decimalPlaces(value: number) {
    const text = String(value);
    const exponentMatch = text.match(/e-(\d+)$/i);
    if (exponentMatch) return Number(exponentMatch[1]);
    const decimalIndex = text.indexOf(".");
    return decimalIndex >= 0 ? text.length - decimalIndex - 1 : 0;
  }

  function stepRate(currentRate: number, direction: number) {
    const step = settings[STORAGE_KEYS.speedStep];
    const precision = Math.max(2, decimalPlaces(step));
    const factor = 10 ** Math.min(6, precision);
    const next = Math.round((Number(currentRate) + direction * step) * factor) / factor;
    return normalizeRate(next);
  }

  function setControllerRate(rate: unknown, media = getActiveMedia(), report = true) {
    if (!hasRuntimeContext()) throw new Error(RUNTIME_RELOAD_MESSAGE);
    if (!isMediaElement(media) || !media.isConnected) throw new Error("조절할 미디어를 찾지 못했습니다.");
    if (!ToolboxShared.isRate(rate) || rate < MIN_RATE || rate > MAX_RATE) throw new Error("올바른 배속 범위는 0.07부터 16입니다.");
    const normalizedRate = normalizeRate(rate);
    const runtimeState = getMediaRuntimeState(media);
    const sourceState = getMediaSourceState(media);

    activeMedia = media;
    const result = safeSetPlaybackRate(media, normalizedRate);
    if (result.ok === false) {
      showMediaError(result.error);
      updateOverlayText();
      scheduleYouTubeSpeedNoticeUpdate();
      throw new Error(result.error);
    }
    lastOperationError = "";
    sourceState.rate = result.actualRate;
    sourceState.initialized = true;
    runtimeState.rateInitialized = true;
    recordRestorableRate(media, result.actualRate);
    setTabTemplateRate(result.actualRate);

    if (report) queueActiveMediaReport(media, "controller", true, true);
    updateOverlayText();
    scheduleOverlayUpdate();
    scheduleYouTubeSpeedNoticeUpdate();
    return normalizedRate;
  }

  function toggleResetRate(media: unknown) {
    if (!isMediaElement(media)) return false;
    const sourceState = getMediaSourceState(media);
    const rawCurrentRate = Number(media.playbackRate);
    const currentRate = Number.isFinite(rawCurrentRate) && rawCurrentRate > 0
      ? normalizeRate(rawCurrentRate)
      : 1;

    if (Math.abs(currentRate - 1) >= 0.0001) {
      setControllerRate(1, media);
      sourceState.restoreRate = currentRate;
      return true;
    }

    const storedRestoreRate = Number(sourceState.restoreRate);
    const hasValidStoredRate = Number.isFinite(storedRestoreRate) && storedRestoreRate > 0;
    const restoreRate = hasValidStoredRate
      ? normalizeRate(storedRestoreRate)
      : settings[STORAGE_KEYS.resetFallbackRate];

    setControllerRate(restoreRate, media);
    return true;
  }


  function seekMedia(media: unknown, deltaSeconds: number) {
    if (!isMediaElement(media)) return false;
    const currentTime = Number(media.currentTime);
    if (!Number.isFinite(currentTime)) return false;

    let minimum = 0;
    let maximum = Number(media.duration);

    try {
      if (media.seekable && media.seekable.length > 0) {
        minimum = media.seekable.start(0);
        maximum = media.seekable.end(media.seekable.length - 1);
      }
    } catch {
      // Fall back to duration and zero if the seekable ranges cannot be read.
    }

    if (!Number.isFinite(maximum)) maximum = Math.max(minimum, currentTime + Math.abs(deltaSeconds));
    const nextTime = clamp(currentTime + deltaSeconds, minimum, maximum);

    try {
      if (typeof media.fastSeek === "function") media.fastSeek(nextTime);
      else media.currentTime = nextTime;
      return true;
    } catch {
      return false;
    }
  }

  function toggleOverlayFromKeyboard() {
    const enabled = !settings[STORAGE_KEYS.overlayEnabled];
    settings[STORAGE_KEYS.overlayEnabled] = enabled;
    saveStoredValues({ [STORAGE_KEYS.overlayEnabled]: enabled });
    scheduleOverlayUpdate();
  }

  function handleKeyboard(event: KeyboardEvent) {
    if (
      !event.isTrusted ||
      lifecycleSuspended ||
      !settings[STORAGE_KEYS.enabled] ||
      !settings[STORAGE_KEYS.keyboardEnabled] ||
      event.defaultPrevented ||
      event.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      ToolboxShared.keyboardInputContext(event) ||
      (event.target instanceof Element && event.target.closest("[data-browser-toolbox-synced-caption-overlay],[data-btx-media-control]")) ||
      pageToolIsActive()
    ) {
      return;
    }

    const command = SHORTCUT_DEFINITIONS.find(
      (definition) => (settings as Record<string, unknown>)[definition.storageKey] === event.code
    )?.command;
    if (!command) return;
    if (!hasRuntimeContext()) return;
    const bindings = ToolboxShared.shortcutBindings(settings, event.code, true, isYouTubeDocument());
    if (bindings.length !== 1) {
      showMediaError("단축키가 중복되어 실행하지 않았습니다. 확장 프로그램 패널에서 미디어 및 A/B 단축키를 변경해 주세요.");
      return;
    }

    const media = getActiveMedia();
    if (!isMediaElement(media)) return;

    let handled = true;
    try {
    if (command === "slower") setControllerRate(stepRate(media.playbackRate, -1), media);
    else if (command === "faster") setControllerRate(stepRate(media.playbackRate, 1), media);
    else if (command === "reset") handled = toggleResetRate(media);
    else if (command === "backward") handled = seekMedia(media, -settings[STORAGE_KEYS.seekStep]);
    else if (command === "forward") handled = seekMedia(media, settings[STORAGE_KEYS.seekStep]);
    else if (command === "overlay") toggleOverlayFromKeyboard();
    } catch (error) {
      showMediaError(error);
      // The trusted shortcut was ours, but it failed; do not invoke an unrelated page shortcut.
    }

    if (!handled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function updateControllerEventListeners() {
    const shouldAttachKeyboard =
      !lifecycleSuspended && !runtimeDisconnected && settings[STORAGE_KEYS.enabled] === true && settings[STORAGE_KEYS.keyboardEnabled] === true;
    if (shouldAttachKeyboard !== keyboardEventListenerAttached) {
      if (shouldAttachKeyboard) document.addEventListener("keydown", handleKeyboard, true);
      else document.removeEventListener("keydown", handleKeyboard, true);
      keyboardEventListenerAttached = shouldAttachKeyboard;
    }

    const shouldAttachViewport =
      !lifecycleSuspended && !runtimeDisconnected && settings[STORAGE_KEYS.enabled] === true && settings[STORAGE_KEYS.overlayEnabled] === true;
    if (shouldAttachViewport !== viewportEventListenersAttached) {
      const method = shouldAttachViewport ? "addEventListener" : "removeEventListener";
      document[method]("fullscreenchange", handleViewportChange, true);
      document[method]("visibilitychange", handleViewportChange, true);
      if (shouldAttachViewport) {
        window.addEventListener("resize", handleViewportChange, { passive: true });
        window.addEventListener("scroll", handleViewportChange, { passive: true, capture: true });
      } else {
        window.removeEventListener("resize", handleViewportChange, false);
        window.removeEventListener("scroll", handleViewportChange, true);
      }
      viewportEventListenersAttached = shouldAttachViewport;
    }
  }

  function teardownController(persistPosition = true) {
    if (keyboardEventListenerAttached) {
      document.removeEventListener("keydown", handleKeyboard, true);
      keyboardEventListenerAttached = false;
    }
    if (viewportEventListenersAttached) {
      document.removeEventListener("fullscreenchange", handleViewportChange, true);
      document.removeEventListener("visibilitychange", handleViewportChange, true);
      window.removeEventListener("resize", handleViewportChange, false);
      window.removeEventListener("scroll", handleViewportChange, true);
      viewportEventListenersAttached = false;
    }
    stopMediaTracking();
    if (overlayFrame) cancelAnimationFrame(overlayFrame);
    overlayFrame = 0;
    if (overlayPositionSaveTimer) {
      clearTimeout(overlayPositionSaveTimer);
      overlayPositionSaveTimer = 0;
      if (persistPosition && !runtimeDisconnected) saveStoredValues({ [STORAGE_KEYS.overlayPosition]: settings[STORAGE_KEYS.overlayPosition] });
    }
    if (errorNoticeTimer) clearTimeout(errorNoticeTimer);
    errorNoticeTimer = 0;
    errorNotice?.remove();
    errorNotice = null;
    if (documentReadyListenerAttached) {
      document.removeEventListener("readystatechange", handleDocumentReadyForTracking);
      documentReadyListenerAttached = false;
    }
    document.getElementById(YOUTUBE_SPEED_NOTICE_STYLE_ID)?.remove();
  }

  function applySettings(nextValues: Record<string,unknown>) {
    if (runtimeDisconnected) return;
    const previousSettings = settings;
    settings = normalizeSettings(nextValues);

    const becameEnabled = !previousSettings[STORAGE_KEYS.enabled] && settings[STORAGE_KEYS.enabled];
    const becameDisabled = previousSettings[STORAGE_KEYS.enabled] && !settings[STORAGE_KEYS.enabled];

    if (becameEnabled) ensureMutationObserver();
    if (becameDisabled) stopMediaTracking(true);
    updateControllerEventListeners();
    if (settings[STORAGE_KEYS.enabled]) scheduleYouTubeSpeedNoticeUpdate();

    if (
      previousSettings[STORAGE_KEYS.overlayEnabled] !== settings[STORAGE_KEYS.overlayEnabled] ||
      previousSettings[STORAGE_KEYS.overlayPosition].x !== settings[STORAGE_KEYS.overlayPosition].x ||
      previousSettings[STORAGE_KEYS.overlayPosition].y !== settings[STORAGE_KEYS.overlayPosition].y ||
      previousSettings[STORAGE_KEYS.enabled] !== settings[STORAGE_KEYS.enabled]
    ) {
      scheduleOverlayUpdate();
    }
  }

  function loadSettings(callback: (stored: Record<string, unknown>) => void): void {
    if (!hasRuntimeContext()) return;
    const start = settingsJournal.mark();
    void ToolboxShared.readStorage(storageArea, globalThis.chrome?.runtime, DEFAULT_SETTINGS)
      .then(stored => callback(settingsJournal.merge(stored, start)))
      .catch(error => {
        const message = runtimeFailureMessage(error);
        if (runtimeDisconnected) return;
        showMediaError(`미디어 설정을 읽지 못했습니다. 마지막으로 확인한 설정을 유지합니다. ${message}`);
        callback({ ...settings });
      });
  }

  function observeStorageChanges() {
    const storageChanged = globalThis.chrome?.storage?.onChanged;
    if (!storageChanged || typeof storageChanged.addListener !== "function") return;

    storageChanged.addListener((changes, areaName) => {
      if (runtimeDisconnected) return;
      if (areaName !== "local" || !changes || typeof changes !== "object") return;

      settingsJournal.record(changes);
      const nextValues: Record<string, unknown> = { ...settings };
      let relevant = false;
      for (const key of [...Object.values(STORAGE_KEYS), ...Object.keys(ToolboxShared.SHORTCUT_DEFAULTS), "youtubeSpeedNoticeEnabled"]) {
        if (!Object.prototype.hasOwnProperty.call(changes, key)) continue;
        relevant = true;
        nextValues[key] = changes[key]?.newValue;
      }
      if (relevant) applySettings(nextValues);
    });
  }

  function findMediaByIdentity(mediaId: unknown, sourceKey: unknown) {
    const expectedId = String(mediaId || "");
    const expectedSource = String(sourceKey || "");
    for (const media of mediaElements) {
      if (!media.isConnected) continue;
      const runtimeState = getMediaRuntimeState(media);
      getMediaSourceState(media);
      if (expectedId && runtimeState.mediaId !== expectedId) continue;
      if (expectedSource && runtimeState.sourceKey !== expectedSource) continue;
      return media;
    }
    return null;
  }

  function observeRuntimeMessages() {
    const onMessage = globalThis.chrome?.runtime?.onMessage;
    if (!onMessage || typeof onMessage.addListener !== "function") return;

    onMessage.addListener((message, _sender, sendResponse) => {
      if (runtimeDisconnected) return false;
      if (message?.type === MESSAGE_TYPES.GET_TAB_STATE && message.queryFrame === true) {
        const hasIdentity = Boolean(message.mediaId || message.sourceKey);
        const media = hasIdentity ? findMediaByIdentity(message.mediaId, message.sourceKey) : getActiveMedia();
        if (!isMediaElement(media)) {
          sendResponse?.({ ok: true, hasMedia: false, rate: tabTemplateRate, templateRate: tabTemplateRate });
          return false;
        }
        // Status requests observe the actual rate; normal media events initialize playback.
        sendResponse?.({ ok: true, ...makeMediaStatePayload(media) });
        return false;
      }

      if (message?.type !== MESSAGE_TYPES.APPLY_TAB_RATE) return false;
      if (!settings[STORAGE_KEYS.enabled]) {
        sendResponse?.({ ok: false, hasMedia: false, error: "미디어 속도 조절 기능이 꺼져 있습니다." });
        return false;
      }

      const media = findMediaByIdentity(message.mediaId, message.sourceKey);
      if (!isMediaElement(media)) {
        sendResponse?.({ ok: false, hasMedia: false, error: "선택한 미디어 소스가 더 이상 존재하지 않습니다." });
        return false;
      }

      try {
        setControllerRate(message.rate, media, false);
        // The service worker persists this response; no second racing report is sent here.
        persistence = "unknown";
        const response: ToolboxShared.MediaReply = { ok: true, ...makeMediaStatePayload(media) };
        sendResponse?.(response);
      } catch (error) {
        const response: ToolboxShared.MediaReply = { ok: false, hasMedia: true, rate: media.playbackRate, error: ToolboxShared.errorMessage(error) };
        sendResponse?.(response);
      }
      return false;
    });
  }


  function handleViewportChange() {
    scheduleOverlayUpdate();
  }

  function initialize() {
    observeStorageChanges();
    observeRuntimeMessages();
    window.addEventListener("pagehide", () => {
      lifecycleSuspended = true;
      lifecycleEpoch++;
      teardownController();
    });
    window.addEventListener("pageshow", (event: PageTransitionEvent) => {
      if (!event.persisted || !lifecycleSuspended || runtimeDisconnected) return;
      if (!hasRuntimeContext()) {
        lifecycleSuspended = false;
        showMediaError(RUNTIME_RELOAD_MESSAGE);
        return;
      }
      // Refresh preferences changed in another tab while preserving media elements and source history.
      const epoch = lifecycleEpoch;
      loadSettings((stored) => {
        if (epoch !== lifecycleEpoch || !lifecycleSuspended) return;
        settings = normalizeSettings(stored);
        lifecycleSuspended = false;
        resumingFromCache = true;
        try { ensureMutationObserver(); } finally { resumingFromCache = false; }
        updateControllerEventListeners();
        scheduleOverlayUpdate();
        scheduleYouTubeSpeedNoticeUpdate();
      });
    });

    scope[CONTROLLER_KEY] = Object.freeze({
      getSettings: () => ({ ...settings, currentRate: getActiveMedia()?.playbackRate ?? tabTemplateRate, templateRate: tabTemplateRate }),
      getMediaCount: () => mediaElements.size,
      getActiveMedia: () => getActiveMedia(),
      getActiveState: () => makeMediaStatePayload(getActiveMedia()),
      getAllMediaStates: () => [...mediaElements].map((media) => makeMediaStatePayload(media)),
      getDiagnosticState: () => ({ present: true, enabled: settings[STORAGE_KEYS.enabled], registeredCount: mediaElements.size,
        persistence, hasOperationError: Boolean(lastOperationError), lifecycleSuspended, runtimeDisconnected,
        speedOverlayFilter: overlayBadge ? getComputedStyle(overlayBadge).backdropFilter : null }),
      setRate: (rate: unknown) => setControllerRate(rate)
    });

    const initialEpoch = lifecycleEpoch;
    const initialSettingsRead = settingsJournal.mark();
    loadSettings((storedSettings) => {
      loadTabState(() => {
        if (lifecycleSuspended || initialEpoch !== lifecycleEpoch) return;
        applySettings(settingsJournal.merge(storedSettings, initialSettingsRead));
      });
    });
  }

  initialize();
})();
