(() => {
  "use strict";

  const CONTROLLER_KEY = "__chatgptBrowserToolsMediaControllerV1__";
  const OVERLAY_HOST_ID = "__chatgpt_browser_tools_media_speed_overlay__";
  const AREA_SELECTOR_HOST_ID = "__drag_area_screenshot_host__";
  const ELEMENT_ERASER_HOST_ID = "__page_element_eraser_host__";

  const MESSAGE_TYPES = Object.freeze({
    GET_TAB_STATE: "media-controller:get-tab-state",
    REPORT_TAB_RATE: "media-controller:report-tab-rate",
    APPLY_TAB_RATE: "media-controller:apply-tab-rate"
  });

  const STORAGE_KEYS = Object.freeze({
    enabled: "mediaControllerEnabled",
    speedStep: "mediaSpeedStep",
    seekStep: "mediaSeekStepSeconds",
    resetFallbackRate: "mediaResetFallbackRate",
    keepRateForNewMedia: "mediaKeepRateForNewMedia",
    overlayEnabled: "mediaOverlayEnabled",
    keyboardEnabled: "mediaKeyboardEnabled",
    overlayPosition: "mediaOverlayPosition",
    shortcutSlower: "mediaShortcutSlowerCode",
    shortcutFaster: "mediaShortcutFasterCode",
    shortcutReset: "mediaShortcutResetCode",
    shortcutBackward: "mediaShortcutBackwardCode",
    shortcutForward: "mediaShortcutForwardCode",
    shortcutOverlay: "mediaShortcutOverlayCode"
  });

  const SHORTCUT_DEFINITIONS = Object.freeze([
    Object.freeze({ command: "slower", storageKey: STORAGE_KEYS.shortcutSlower, defaultCode: "KeyS" }),
    Object.freeze({ command: "faster", storageKey: STORAGE_KEYS.shortcutFaster, defaultCode: "KeyD" }),
    Object.freeze({ command: "reset", storageKey: STORAGE_KEYS.shortcutReset, defaultCode: "KeyR" }),
    Object.freeze({ command: "backward", storageKey: STORAGE_KEYS.shortcutBackward, defaultCode: "KeyZ" }),
    Object.freeze({ command: "forward", storageKey: STORAGE_KEYS.shortcutForward, defaultCode: "KeyX" }),
    Object.freeze({ command: "overlay", storageKey: STORAGE_KEYS.shortcutOverlay, defaultCode: "KeyV" })
  ]);

  const LEGACY_OVERLAY_DEFAULT_POSITION = Object.freeze({ x: 0.02, y: 0.02 });
  const CENTER_TOP_OVERLAY_POSITION = Object.freeze({ x: 0.5, y: 0.02 });

  const DEFAULT_SETTINGS = Object.freeze({
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

  if (globalThis[CONTROLLER_KEY]) return;

  const storageArea = globalThis.chrome?.storage?.local;
  const mediaElements = new Set();
  const mediaListeners = new WeakMap();
  const mediaRuntimeStates = new WeakMap();
  const mediaSourceStates = new Map();
  const mediaObjectIds = new WeakMap();

  let settings = normalizeSettings(DEFAULT_SETTINGS);
  let activeMedia = null;
  let mutationObserver = null;
  let documentReadyListenerAttached = false;
  let cleanupScheduled = false;
  let overlayHost = null;
  let overlayBadge = null;
  let overlayText = null;
  let overlayFrame = 0;
  let overlayPositionSaveTimer = 0;
  let rateReportTimer = 0;
  let pendingMediaReport = null;
  let tabTemplateRate = 1;
  let mediaIdSequence = 0;
  let mediaObjectIdSequence = 0;
  let sourceStateSequence = 0;
  let dragging = null;
  let keyboardEventListenerAttached = false;
  let viewportEventListenersAttached = false;

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function normalizeNumber(value, fallback, minimum, maximum, decimals = 2) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return fallback;
    const factor = 10 ** decimals;
    return clamp(Math.round(numericValue * factor) / factor, minimum, maximum);
  }

  function normalizeRate(value) {
    return normalizeNumber(value, 1, MIN_RATE, MAX_RATE, 2);
  }

  function normalizeSpeedStep(value) {
    return normalizeNumber(value, 0.1, MIN_SPEED_STEP, MAX_SPEED_STEP, 2);
  }

  function normalizeResetFallbackRate(value) {
    return normalizeNumber(value, 2, MIN_RATE, MAX_RATE, 2);
  }

  function normalizeSeekStep(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return 10;
    return clamp(Math.round(numericValue), MIN_SEEK_STEP_SECONDS, MAX_SEEK_STEP_SECONDS);
  }

  function normalizePosition(value) {
    const source = value && typeof value === "object"
      ? value
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

  function normalizeShortcutCode(value, fallback) {
    const code = typeof value === "string" ? value.trim() : "";
    if (!code || code.length > 32) return fallback;

    const blockedCodes = new Set([
      "Escape",
      "Tab",
      "Enter",
      "NumpadEnter",
      "ShiftLeft",
      "ShiftRight",
      "ControlLeft",
      "ControlRight",
      "AltLeft",
      "AltRight",
      "MetaLeft",
      "MetaRight",
      "CapsLock",
      "NumLock",
      "ScrollLock",
      "Pause",
      "PrintScreen",
      "Unidentified",
      "Process"
    ]);

    if (blockedCodes.has(code)) return fallback;
    return /^[A-Za-z][A-Za-z0-9]*$/.test(code) ? code : fallback;
  }

  function normalizeSettings(values) {
    const source = values && typeof values === "object" ? values : {};
    return {
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

  function formatRate(rate) {
    return `${normalizeRate(rate).toFixed(2)}×`;
  }

  function isMediaElement(value) {
    return typeof HTMLMediaElement !== "undefined" && value instanceof HTMLMediaElement;
  }

  function isVideoElement(value) {
    return typeof HTMLVideoElement !== "undefined" && value instanceof HTMLVideoElement;
  }

  function getRuntimeErrorMessage() {
    return globalThis.chrome?.runtime?.lastError?.message || "";
  }

  function saveStoredValues(values) {
    if (!storageArea || typeof storageArea.set !== "function") return;
    try {
      storageArea.set(values, () => {
        void getRuntimeErrorMessage();
      });
    } catch {
      // The controller keeps working in the current document if storage is unavailable.
    }
  }

  function sendRuntimeMessage(message, callback = null) {
    const runtime = globalThis.chrome?.runtime;
    if (!runtime || typeof runtime.sendMessage !== "function") {
      callback?.(null);
      return;
    }

    try {
      runtime.sendMessage(message, (response) => {
        void getRuntimeErrorMessage();
        callback?.(response || null);
      });
    } catch {
      callback?.(null);
    }
  }

  function normalizeMediaText(value, maximumLength = 160) {
    return String(value || "")
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maximumLength);
  }

  function hashOpaqueText(value) {
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

  function getObjectId(value, prefix = "object") {
    if (!value || (typeof value !== "object" && typeof value !== "function")) return "";
    let id = mediaObjectIds.get(value);
    if (!id) {
      mediaObjectIdSequence += 1;
      id = `${prefix}-${mediaObjectIdSequence}`;
      mediaObjectIds.set(value, id);
    }
    return id;
  }

  function resolveMediaUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    try {
      return new URL(raw, document.baseURI).href;
    } catch {
      return raw.slice(0, 2048);
    }
  }

  function getMediaSourceDescriptor(media, runtimeState) {
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

  function getMediaLabel(media) {
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

  function getMediaRuntimeState(media) {
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
        ignoreRateChangesUntil: 0
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

  function getMediaSourceState(media, forceRefresh = false) {
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

  function makeMediaStatePayload(media) {
    if (!isMediaElement(media) || !media.isConnected) {
      return { hasMedia: false, rate: tabTemplateRate, templateRate: tabTemplateRate };
    }

    const runtimeState = getMediaRuntimeState(media);
    const sourceState = getMediaSourceState(media);
    const rawRate = Number(media.playbackRate);
    const rate = Number.isFinite(rawRate) && rawRate > 0
      ? normalizeRate(rawRate)
      : normalizeRate(sourceState.rate);

    return {
      hasMedia: true,
      mediaId: runtimeState.mediaId,
      sourceKey: runtimeState.sourceKey,
      rate,
      templateRate: tabTemplateRate,
      kind: isVideoElement(media) ? "video" : "audio",
      label: getMediaLabel(media)
    };
  }

  function queueActiveMediaReport(media, reason = "selection", updateTemplate = false, immediate = false) {
    if (!isMediaElement(media) || !media.isConnected) return;
    const payload = {
      type: MESSAGE_TYPES.REPORT_TAB_RATE,
      ...makeMediaStatePayload(media),
      reason,
      updateTemplate: Boolean(updateTemplate)
    };
    pendingMediaReport = payload;

    const send = () => {
      rateReportTimer = 0;
      const report = pendingMediaReport;
      pendingMediaReport = null;
      if (!report) return;
      sendRuntimeMessage(report, (response) => {
        if (response?.ok === true && Number.isFinite(Number(response.templateRate))) {
          tabTemplateRate = normalizeRate(response.templateRate);
        }
      });
    };

    if (rateReportTimer) window.clearTimeout(rateReportTimer);
    if (immediate) send();
    else rateReportTimer = window.setTimeout(send, RATE_REPORT_DELAY_MS);
  }

  function setTabTemplateRate(rate) {
    tabTemplateRate = normalizeRate(rate);
    return tabTemplateRate;
  }

  function loadTabState(callback) {
    sendRuntimeMessage({ type: MESSAGE_TYPES.GET_TAB_STATE }, (response) => {
      const rate = response?.ok === true
        ? (response.templateRate ?? response.rate)
        : 1;
      tabTemplateRate = normalizeRate(rate);
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

  function safeSetPlaybackRate(media, rate) {
    if (!isMediaElement(media) || !media.isConnected) return false;
    const normalizedRate = normalizeRate(rate);
    let changed = false;

    try {
      if (Math.abs(Number(media.defaultPlaybackRate) - normalizedRate) > 0.0001) {
        media.defaultPlaybackRate = normalizedRate;
        changed = true;
      }
    } catch {
      // Some players reject rates outside their own supported range.
    }

    try {
      if (Math.abs(Number(media.playbackRate) - normalizedRate) > 0.0001) {
        media.playbackRate = normalizedRate;
        changed = true;
      }
    } catch {
      // Keep the site's current rate when the user agent rejects the value.
    }

    return changed;
  }

  function recordRestorableRate(media, rate) {
    if (!isMediaElement(media)) return;
    const numericRate = Number(rate);
    if (!Number.isFinite(numericRate) || numericRate <= 0) return;
    const normalizedRate = normalizeRate(numericRate);
    if (Math.abs(normalizedRate - 1) < 0.0001) return;
    getMediaSourceState(media).restoreRate = normalizedRate;
  }

  function initializeMediaRate(media, force = false) {
    if (!settings[STORAGE_KEYS.enabled] || !isMediaElement(media)) return;
    const runtimeState = getMediaRuntimeState(media);
    const sourceState = getMediaSourceState(media, force);
    if (runtimeState.rateInitialized && sourceState.initialized && !force) return;

    const targetRate = sourceState.initialized
      ? normalizeRate(sourceState.rate)
      : (settings[STORAGE_KEYS.keepRateForNewMedia] ? tabTemplateRate : 1);

    sourceState.rate = targetRate;
    sourceState.initialized = true;
    if (Math.abs(targetRate - 1) >= 0.0001 && !Number.isFinite(Number(sourceState.restoreRate))) {
      sourceState.restoreRate = targetRate;
    }

    runtimeState.rateInitialized = true;
    runtimeState.ignoreRateChangesUntil = performance.now() + 160;
    safeSetPlaybackRate(media, targetRate);
  }

  function initializeRegisteredMediaIndependently() {
    if (!settings[STORAGE_KEYS.enabled]) return;
    cleanupDisconnectedMedia();
    for (const media of mediaElements) initializeMediaRate(media);
    scheduleOverlayUpdate();
  }


  function isVisibleVideo(video) {
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

  function visibleVideoArea(video) {
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

  function selectActiveMedia(media, reason = "selection", report = true) {
    if (!isMediaElement(media) || !media.isConnected) return;
    initializeMediaRate(media);
    activeMedia = media;
    if (report) queueActiveMediaReport(media, reason, false);
    scheduleOverlayUpdate();
  }

  function handleLoadStart(event) {
    const media = event.currentTarget;
    if (!isMediaElement(media)) return;
    const runtimeState = getMediaRuntimeState(media);
    runtimeState.sourceGeneration += 1;
    runtimeState.sourceKey = "";
    runtimeState.sourceState = null;
    runtimeState.rateInitialized = false;
    runtimeState.ignoreRateChangesUntil = performance.now() + 160;
  }

  function handleLoadedMetadata(event) {
    const media = event.currentTarget;
    if (!isMediaElement(media)) return;
    initializeMediaRate(media, true);
    if (!activeMedia || (!media.paused && !media.ended)) selectActiveMedia(media, "metadata");
  }

  function handlePlay(event) {
    const media = event.currentTarget;
    if (!isMediaElement(media)) return;
    initializeMediaRate(media);
    selectActiveMedia(media, "play", true);
  }

  function handlePointerEnter(event) {
    if (!event?.isTrusted) return;
    const media = event.currentTarget;
    if (isMediaElement(media)) selectActiveMedia(media, "pointer", true);
  }

  function handleRateChange(event) {
    const media = event.currentTarget;
    if (!isMediaElement(media)) return;
    const runtimeState = getMediaRuntimeState(media);
    const sourceState = getMediaSourceState(media);
    const rawRate = Number(media.playbackRate);
    if (!Number.isFinite(rawRate) || rawRate <= 0) return;

    const normalizedRate = normalizeRate(rawRate);
    sourceState.rate = normalizedRate;
    sourceState.initialized = true;

    if (performance.now() >= runtimeState.ignoreRateChangesUntil) {
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
  }


  function handleMediaEnded(event) {
    if (event.currentTarget === activeMedia) scheduleOverlayUpdate();
  }

  function registerMedia(media) {
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

    if (settings[STORAGE_KEYS.enabled] && media.readyState >= 1) initializeMediaRate(media, true);
    if (!activeMedia && isVideoElement(media) && isVisibleVideo(media)) {
      activeMedia = media;
      queueActiveMediaReport(media, "initial", false);
    }
  }

  function unregisterMedia(media) {
    const listeners = mediaListeners.get(media);
    if (listeners) {
      for (const [type, listener] of Object.entries(listeners)) {
        media.removeEventListener(type, listener, true);
      }
      mediaListeners.delete(media);
    }
    mediaElements.delete(media);
    if (activeMedia === media) activeMedia = null;
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
    });
  }

  function scanNode(node) {
    if (!node) return;
    if (isMediaElement(node)) registerMedia(node);

    if (
      node.nodeType !== Node.ELEMENT_NODE &&
      node.nodeType !== Node.DOCUMENT_NODE &&
      node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE
    ) {
      return;
    }

    if (typeof node.querySelectorAll === "function") {
      for (const media of node.querySelectorAll("video, audio")) registerMedia(media);
    }
  }

  function startMutationObserver() {
    if (!settings[STORAGE_KEYS.enabled]) return;

    scanNode(document);
    const root = document.documentElement;
    if (!root || mutationObserver) return;

    mutationObserver = new MutationObserver((records) => {
      let sawRemoval = false;
      for (const record of records) {
        for (const node of record.addedNodes) scanNode(node);
        if (record.removedNodes.length > 0) sawRemoval = true;
        if (record.type === "attributes" && record.attributeName === "src") {
          const target = record.target;
          const media = isMediaElement(target) ? target : target?.closest?.("video, audio");
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
    if (!settings[STORAGE_KEYS.enabled]) return;
    if (document.documentElement) {
      startMutationObserver();
      return;
    }

    if (!documentReadyListenerAttached) {
      documentReadyListenerAttached = true;
      document.addEventListener("readystatechange", handleDocumentReadyForTracking);
    }
  }

  function stopMediaTracking() {
    mutationObserver?.disconnect();
    mutationObserver = null;

    for (const media of [...mediaElements]) unregisterMedia(media);
    activeMedia = null;
    dragging = null;
    hideOverlay();
  }

  function getOverlayParent(video) {
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
    style.textContent = `
      :host { all: initial; }
      .badge {
        box-sizing: border-box;
        min-width: 54px;
        padding: 6px 9px;
        border: 1px solid rgba(255, 255, 255, 0.34);
        border-radius: 8px;
        background: rgba(12, 18, 28, 0.82);
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
        backdrop-filter: blur(3px);
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

  function getOverlayGeometry(video) {
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
    if (overlayFrame) return;
    overlayFrame = window.requestAnimationFrame(renderOverlay);
  }

  function startOverlayDrag(event) {
    if (!event?.isTrusted || event.button !== 0) return;
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

  function moveOverlayDrag(event) {
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

  function finishOverlayDrag(event) {
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

  function isEditableTarget(target) {
    if (!(target instanceof Element)) return false;
    if (target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']")) {
      return true;
    }
    return false;
  }

  function pageToolIsActive() {
    return Boolean(
      document.getElementById(AREA_SELECTOR_HOST_ID) ||
      document.getElementById(ELEMENT_ERASER_HOST_ID)
    );
  }

  function decimalPlaces(value) {
    const text = String(value);
    const exponentMatch = text.match(/e-(\d+)$/i);
    if (exponentMatch) return Number(exponentMatch[1]);
    const decimalIndex = text.indexOf(".");
    return decimalIndex >= 0 ? text.length - decimalIndex - 1 : 0;
  }

  function stepRate(currentRate, direction) {
    const step = settings[STORAGE_KEYS.speedStep];
    const precision = Math.max(2, decimalPlaces(step));
    const factor = 10 ** Math.min(6, precision);
    const next = Math.round((Number(currentRate) + direction * step) * factor) / factor;
    return normalizeRate(next);
  }

  function setControllerRate(rate, media = getActiveMedia(), report = true) {
    if (!isMediaElement(media) || !media.isConnected) return null;
    const normalizedRate = normalizeRate(rate);
    const runtimeState = getMediaRuntimeState(media);
    const sourceState = getMediaSourceState(media);

    activeMedia = media;
    runtimeState.ignoreRateChangesUntil = performance.now() + 180;
    sourceState.rate = normalizedRate;
    sourceState.initialized = true;
    safeSetPlaybackRate(media, normalizedRate);
    recordRestorableRate(media, normalizedRate);
    setTabTemplateRate(normalizedRate);

    if (report) queueActiveMediaReport(media, "controller", true, true);
    updateOverlayText();
    scheduleOverlayUpdate();
    return normalizedRate;
  }

  function toggleResetRate(media) {
    if (!isMediaElement(media)) return false;
    const sourceState = getMediaSourceState(media);
    const rawCurrentRate = Number(media.playbackRate);
    const currentRate = Number.isFinite(rawCurrentRate) && rawCurrentRate > 0
      ? normalizeRate(rawCurrentRate)
      : 1;

    if (Math.abs(currentRate - 1) >= 0.0001) {
      sourceState.restoreRate = currentRate;
      setControllerRate(1, media);
      return true;
    }

    const storedRestoreRate = Number(sourceState.restoreRate);
    const hasValidStoredRate = Number.isFinite(storedRestoreRate) && storedRestoreRate > 0;
    const restoreRate = hasValidStoredRate
      ? normalizeRate(storedRestoreRate)
      : settings[STORAGE_KEYS.resetFallbackRate];

    if (Math.abs(restoreRate - 1) >= 0.0001) {
      sourceState.restoreRate = restoreRate;
    }
    setControllerRate(restoreRate, media);
    return true;
  }


  function seekMedia(media, deltaSeconds) {
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

  function handleKeyboard(event) {
    if (
      !event.isTrusted ||
      !settings[STORAGE_KEYS.enabled] ||
      !settings[STORAGE_KEYS.keyboardEnabled] ||
      event.defaultPrevented ||
      event.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      isEditableTarget(event.target) ||
      pageToolIsActive()
    ) {
      return;
    }

    const command = SHORTCUT_DEFINITIONS.find(
      (definition) => settings[definition.storageKey] === event.code
    )?.command;
    if (!command) return;

    const media = getActiveMedia();
    if (!isMediaElement(media)) return;

    let handled = true;
    if (command === "slower") setControllerRate(stepRate(media.playbackRate, -1), media);
    else if (command === "faster") setControllerRate(stepRate(media.playbackRate, 1), media);
    else if (command === "reset") handled = toggleResetRate(media);
    else if (command === "backward") handled = seekMedia(media, -settings[STORAGE_KEYS.seekStep]);
    else if (command === "forward") handled = seekMedia(media, settings[STORAGE_KEYS.seekStep]);
    else if (command === "overlay") toggleOverlayFromKeyboard();

    if (!handled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function updateControllerEventListeners() {
    const shouldAttachKeyboard =
      settings[STORAGE_KEYS.enabled] === true && settings[STORAGE_KEYS.keyboardEnabled] === true;
    if (shouldAttachKeyboard !== keyboardEventListenerAttached) {
      const method = shouldAttachKeyboard ? "addEventListener" : "removeEventListener";
      document[method]("keydown", handleKeyboard, true);
      keyboardEventListenerAttached = shouldAttachKeyboard;
    }

    const shouldAttachViewport =
      settings[STORAGE_KEYS.enabled] === true && settings[STORAGE_KEYS.overlayEnabled] === true;
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

  function teardownController() {
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
    if (documentReadyListenerAttached) {
      document.removeEventListener("readystatechange", handleDocumentReadyForTracking);
      documentReadyListenerAttached = false;
    }
  }

  function applySettings(nextValues) {
    const previousSettings = settings;
    settings = normalizeSettings(nextValues);

    const becameEnabled = !previousSettings[STORAGE_KEYS.enabled] && settings[STORAGE_KEYS.enabled];
    const becameDisabled = previousSettings[STORAGE_KEYS.enabled] && !settings[STORAGE_KEYS.enabled];

    if (becameEnabled) ensureMutationObserver();
    if (becameDisabled) stopMediaTracking();
    updateControllerEventListeners();

    if (
      previousSettings[STORAGE_KEYS.overlayEnabled] !== settings[STORAGE_KEYS.overlayEnabled] ||
      previousSettings[STORAGE_KEYS.overlayPosition].x !== settings[STORAGE_KEYS.overlayPosition].x ||
      previousSettings[STORAGE_KEYS.overlayPosition].y !== settings[STORAGE_KEYS.overlayPosition].y ||
      previousSettings[STORAGE_KEYS.enabled] !== settings[STORAGE_KEYS.enabled]
    ) {
      scheduleOverlayUpdate();
    }
  }

  function loadSettings(callback) {
    if (!storageArea || typeof storageArea.get !== "function") {
      callback?.({ ...DEFAULT_SETTINGS });
      return;
    }

    try {
      storageArea.get(DEFAULT_SETTINGS, (stored) => {
        if (getRuntimeErrorMessage()) {
          callback?.({ ...DEFAULT_SETTINGS });
          return;
        }
        callback?.(stored);
      });
    } catch {
      callback?.({ ...DEFAULT_SETTINGS });
    }
  }

  function observeStorageChanges() {
    const storageChanged = globalThis.chrome?.storage?.onChanged;
    if (!storageChanged || typeof storageChanged.addListener !== "function") return;

    storageChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes || typeof changes !== "object") return;

      const nextValues = { ...settings };
      let relevant = false;
      for (const key of Object.values(STORAGE_KEYS)) {
        if (!Object.prototype.hasOwnProperty.call(changes, key)) continue;
        relevant = true;
        nextValues[key] = changes[key]?.newValue;
      }
      if (relevant) applySettings(nextValues);
    });
  }

  function findMediaByIdentity(mediaId, sourceKey) {
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
      if (message?.type === MESSAGE_TYPES.GET_TAB_STATE && message.queryFrame === true) {
        const requested = findMediaByIdentity(message.mediaId, message.sourceKey);
        const media = requested || getActiveMedia();
        if (!isMediaElement(media)) {
          sendResponse?.({ ok: true, hasMedia: false, rate: tabTemplateRate, templateRate: tabTemplateRate });
          return false;
        }
        initializeMediaRate(media);
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

      const rate = setControllerRate(message.rate, media, false);
      queueActiveMediaReport(media, "popup", true, true);
      sendResponse?.({ ok: true, ...makeMediaStatePayload(media), rate });
      return false;
    });
  }


  function handleViewportChange() {
    scheduleOverlayUpdate();
  }

  function initialize() {
    observeStorageChanges();
    observeRuntimeMessages();
    window.addEventListener("pagehide", teardownController, { once: true });

    globalThis[CONTROLLER_KEY] = Object.freeze({
      getSettings: () => ({ ...settings, currentRate: getActiveMedia()?.playbackRate ?? tabTemplateRate, templateRate: tabTemplateRate }),
      getMediaCount: () => mediaElements.size,
      getActiveMedia: () => getActiveMedia(),
      getActiveState: () => makeMediaStatePayload(getActiveMedia()),
      getAllMediaStates: () => [...mediaElements].map((media) => makeMediaStatePayload(media)),
      setRate: (rate) => setControllerRate(rate)
    });

    loadSettings((storedSettings) => {
      loadTabState(() => {
        applySettings(storedSettings);
      });
    });
  }

  initialize();
})();
