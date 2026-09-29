(() => {
  "use strict";

  const CONTROLLER_KEY = "__browserToolboxYouTubeSyncedCaptionOverlayV1__";
  const OVERLAY_HOST_ID = "__browser_toolbox_youtube_synced_caption_overlay__";
  const TRACK_LABEL = "Browser Toolbox 동기화 자막";
  const TRACK_CHANGED_EVENT = "browser-toolbox-youtube-synced-caption-changed";

  const STORAGE_KEYS = Object.freeze({
    fontSize: "youtubeSyncedCaptionFontSizePx",
    position: "youtubeSyncedCaptionPosition",
    maxWidthPercent: "youtubeSyncedCaptionMaxWidthPercent",
    preferredLineCount: "youtubeSyncedCaptionPreferredLineCount",
    overflowMode: "youtubeSyncedCaptionOverflowMode"
  });

  const DEFAULT_POSITION = Object.freeze({ x: 0.5, y: 0.83 });
  const DEFAULT_FONT_SIZE_PX = 28;
  const MIN_FONT_SIZE_PX = 14;
  const MAX_FONT_SIZE_PX = 64;
  const DEFAULT_MAX_WIDTH_PERCENT = 92;
  const MIN_MAX_WIDTH_PERCENT = 30;
  const MAX_MAX_WIDTH_PERCENT = 100;
  const DEFAULT_PREFERRED_LINE_COUNT = 0;
  const MIN_PREFERRED_LINE_COUNT = 0;
  const MAX_PREFERRED_LINE_COUNT = 6;
  const POSITION_SAVE_DELAY_MS = 100;

  if (globalThis[CONTROLLER_KEY]) return;

  const settingsJournal = new ToolboxShared.SettingsReadJournal(Object.values(STORAGE_KEYS));
  const storageArea = globalThis.chrome?.storage?.local;
  const registeredVideos = new Set<HTMLVideoElement>();
  const videoListeners = new WeakMap<HTMLVideoElement, Record<string, EventListener>>();

  let settings: {
    youtubeSyncedCaptionFontSizePx: number;
    youtubeSyncedCaptionPosition: { x: number; y: number };
    youtubeSyncedCaptionMaxWidthPercent: number;
    youtubeSyncedCaptionPreferredLineCount: number;
    youtubeSyncedCaptionOverflowMode: "scroll" | "expand";
  } = {
    [STORAGE_KEYS.fontSize]: DEFAULT_FONT_SIZE_PX,
    [STORAGE_KEYS.position]: { ...DEFAULT_POSITION },
    [STORAGE_KEYS.maxWidthPercent]: DEFAULT_MAX_WIDTH_PERCENT,
    [STORAGE_KEYS.preferredLineCount]: DEFAULT_PREFERRED_LINE_COUNT,
    [STORAGE_KEYS.overflowMode]: "scroll"
  };
  let activeVideo: HTMLVideoElement | null = null;
  let activeTrack: TextTrack | null = null;
  let activeTrackCueListener: EventListener | null = null;
  let overlayHost: HTMLElement | null = null;
  let overlayBubble: HTMLElement | null = null;
  let overlayText: HTMLElement | null = null;
  let overlayWarning: HTMLElement | null = null;
  let overlayFrame = 0;
  let overlayFallbackTimer = 0;
  let scanScheduled = false;
  let positionSaveTimer = 0;
  let dragging: {
    pointerId: number;
    video: HTMLVideoElement;
    pointerOffsetX: number;
    pointerOffsetY: number;
  } | null = null;
  let mutationObserver: MutationObserver | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let layoutCache: {
    key: string;
    width: string;
    renderedLines: number;
  } | null = null;

  function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function normalizeFontSize(value: unknown): number {
    const numericValue = Math.round(ToolboxShared.numericSetting(value));
    return Number.isFinite(numericValue)
      ? clamp(numericValue, MIN_FONT_SIZE_PX, MAX_FONT_SIZE_PX)
      : DEFAULT_FONT_SIZE_PX;
  }

  function normalizeMaxWidthPercent(value: unknown): number {
    const numericValue = Math.round(ToolboxShared.numericSetting(value));
    return Number.isFinite(numericValue)
      ? clamp(numericValue, MIN_MAX_WIDTH_PERCENT, MAX_MAX_WIDTH_PERCENT)
      : DEFAULT_MAX_WIDTH_PERCENT;
  }

  function normalizePreferredLineCount(value: unknown): number {
    const numericValue = Math.round(ToolboxShared.numericSetting(value));
    return Number.isFinite(numericValue)
      ? clamp(numericValue, MIN_PREFERRED_LINE_COUNT, MAX_PREFERRED_LINE_COUNT)
      : DEFAULT_PREFERRED_LINE_COUNT;
  }

  function normalizePosition(value: unknown): { x: number; y: number } {
    const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const x = ToolboxShared.numericSetting(source.x);
    const y = ToolboxShared.numericSetting(source.y);
    return {
      x: Number.isFinite(x) ? clamp(x, 0, 1) : DEFAULT_POSITION.x,
      y: Number.isFinite(y) ? clamp(y, 0, 1) : DEFAULT_POSITION.y
    };
  }

  function getRuntimeErrorMessage(): string {
    return globalThis.chrome?.runtime?.lastError?.message || "";
  }

  function loadStoredSettings(): void {
    if (!storageArea || typeof storageArea.get !== "function") return;
    const start = settingsJournal.mark();
    try {
      storageArea.get({
        [STORAGE_KEYS.fontSize]: DEFAULT_FONT_SIZE_PX,
        [STORAGE_KEYS.position]: { ...DEFAULT_POSITION },
        [STORAGE_KEYS.maxWidthPercent]: DEFAULT_MAX_WIDTH_PERCENT,
        [STORAGE_KEYS.preferredLineCount]: DEFAULT_PREFERRED_LINE_COUNT,
    [STORAGE_KEYS.overflowMode]: "scroll"
      }, (stored: Record<string, unknown>) => {
        const errorMessage = getRuntimeErrorMessage();
        if (errorMessage) {
          console.error("Could not read synchronized caption display settings:", errorMessage);
          return;
        }
        stored = settingsJournal.merge(stored || {}, start);
        settings = {
          [STORAGE_KEYS.fontSize]: normalizeFontSize(stored?.[STORAGE_KEYS.fontSize]),
          [STORAGE_KEYS.position]: normalizePosition(stored?.[STORAGE_KEYS.position]),
          [STORAGE_KEYS.maxWidthPercent]: normalizeMaxWidthPercent(stored?.[STORAGE_KEYS.maxWidthPercent]),
          [STORAGE_KEYS.preferredLineCount]: normalizePreferredLineCount(stored?.[STORAGE_KEYS.preferredLineCount]),
          [STORAGE_KEYS.overflowMode]: stored?.[STORAGE_KEYS.overflowMode] === "expand" ? "expand" : "scroll"
        };
        layoutCache = null;
        scheduleOverlayRender();
      });
    } catch (error) {
      console.error("Could not read synchronized caption display settings:", error);
    }
  }

  function savePositionSoon(): void {
    if (positionSaveTimer) window.clearTimeout(positionSaveTimer);
    positionSaveTimer = window.setTimeout(() => {
      positionSaveTimer = 0;
      if (!storageArea || typeof storageArea.set !== "function") return;
      try {
        storageArea.set({
          [STORAGE_KEYS.position]: { ...settings[STORAGE_KEYS.position] }
        }, () => {
          const errorMessage = getRuntimeErrorMessage();
          if (errorMessage) {
            console.error("Could not save synchronized caption position:", errorMessage);
          }
        });
      } catch (error) {
        console.error("Could not save synchronized caption position:", error);
      }
    }, POSITION_SAVE_DELAY_MS);
  }

  function isVideoVisible(video: HTMLVideoElement | null): video is HTMLVideoElement {
    if (!(video instanceof HTMLVideoElement) || !video.isConnected) return false;
    const rect = video.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 45) return false;
    const style = getComputedStyle(video);
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0;
  }

  function getVideoArea(video: HTMLVideoElement): number {
    if (!isVideoVisible(video)) return 0;
    const rect = video.getBoundingClientRect();
    const visibleWidth = Math.max(0, Math.min(window.innerWidth, rect.right) - Math.max(0, rect.left));
    const visibleHeight = Math.max(0, Math.min(window.innerHeight, rect.bottom) - Math.max(0, rect.top));
    return visibleWidth * visibleHeight;
  }

  function findSyncedTrack(video: HTMLVideoElement): TextTrack | null {
    for (const track of Array.from(video.textTracks || [])) {
      if (String(track.label || "") !== TRACK_LABEL) continue;
      if ((Number(track.cues?.length) || 0) <= 0) continue;
      return track;
    }
    return null;
  }

  function registerVideo(video: HTMLVideoElement): void {
    if (registeredVideos.has(video)) return;
    registeredVideos.add(video);

    const schedule = () => scheduleTrackScan();
    const listeners: Record<string, EventListener> = {
      loadedmetadata: schedule,
      emptied: schedule,
      durationchange: schedule,
      timeupdate: () => {
        if (video === activeVideo) scheduleOverlayRender();
      },
      seeking: () => {
        if (video === activeVideo) scheduleOverlayRender();
      },
      seeked: () => {
        if (video === activeVideo) scheduleOverlayRender();
      },
      ratechange: () => {
        if (video === activeVideo) scheduleOverlayRender();
      }
    };

    for (const [type, listener] of Object.entries(listeners)) {
      video.addEventListener(type, listener, true);
    }
    try { video.textTracks?.addEventListener?.("addtrack", schedule); } catch { /* Optional TextTrackList event. */ }
    try { video.textTracks?.addEventListener?.("removetrack", schedule); } catch { /* Optional TextTrackList event. */ }
    videoListeners.set(video, listeners);
  }

  function unregisterDisconnectedVideos(): boolean {
    let changed = false;
    for (const video of [...registeredVideos]) {
      if (video.isConnected) continue;
      const listeners = videoListeners.get(video);
      if (listeners) {
        for (const [type, listener] of Object.entries(listeners)) {
          try { video.removeEventListener(type, listener, true); } catch { /* Ignore a detached media element. */ }
        }
        const schedule = listeners.loadedmetadata;
        try { video.textTracks?.removeEventListener?.("addtrack", schedule); } catch { /* Ignore. */ }
        try { video.textTracks?.removeEventListener?.("removetrack", schedule); } catch { /* Ignore. */ }
      }
      registeredVideos.delete(video);
      videoListeners.delete(video);
      changed = true;
    }
    return changed;
  }

  function scanAddedNode(node: Node): boolean {
    let changed = false;
    if (node instanceof HTMLVideoElement && !registeredVideos.has(node)) {
      registerVideo(node);
      changed = true;
    }
    if (!(node instanceof Element) || !node.childElementCount || node === overlayHost) return changed;
    for (const video of node.querySelectorAll<HTMLVideoElement>("video")) {
      if (registeredVideos.has(video)) continue;
      registerVideo(video);
      changed = true;
    }
    return changed;
  }

  function startDocumentTracking(): void {
    // Only the initial scan visits the whole document; later scans use added subtrees and known videos.
    for (const video of document.querySelectorAll("video")) registerVideo(video as HTMLVideoElement);
    mutationObserver = new MutationObserver(records => {
      let changed = false;
      let sawRelevantRemoval = false;
      for (const record of records) {
        if (overlayHost && (record.target === overlayHost || overlayHost.contains(record.target))) continue;
        for (const node of record.addedNodes) changed = scanAddedNode(node) || changed;
        for (const node of record.removedNodes) {
          if (!(node instanceof Element)) continue;
          if ([...registeredVideos].some(video => node === video || node.contains(video))) sawRelevantRemoval = true;
        }
      }
      if (sawRelevantRemoval) changed = unregisterDisconnectedVideos() || changed;
      if (changed) scheduleTrackScan();
    });
    mutationObserver.observe(document.documentElement || document, { childList: true, subtree: true });
  }

  function setActiveTrack(video: HTMLVideoElement | null, track: TextTrack | null): void {
    if (activeTrack && activeTrackCueListener) {
      try { activeTrack.removeEventListener("cuechange", activeTrackCueListener); } catch { /* Ignore. */ }
    }
    resizeObserver?.disconnect();
    resizeObserver = null;

    activeVideo = video;
    activeTrack = track;
    activeTrackCueListener = null;

    if (!activeTrack || !activeVideo) {
      hideOverlay();
      return;
    }

    if (activeTrack && activeVideo) {
      try {
        if (activeTrack.mode !== "hidden") activeTrack.mode = "hidden";
      } catch {
        activeVideo = null;
        activeTrack = null;
        hideOverlay();
        return;
      }

      activeTrackCueListener = () => {
        if (!activeTrack || activeTrack.mode === "disabled" || (Number(activeTrack.cues?.length) || 0) <= 0) {
          hideOverlay();
          scheduleTrackScan();
          return;
        }
        scheduleOverlayRender();
      };
      try { activeTrack.addEventListener("cuechange", activeTrackCueListener); } catch { /* timeupdate remains a fallback. */ }

      if (typeof ResizeObserver === "function") {
        resizeObserver = new ResizeObserver(() => scheduleOverlayRender());
        try { resizeObserver.observe(activeVideo); } catch { resizeObserver.disconnect(); resizeObserver = null; }
      }
    }

    scheduleOverlayRender();
  }

  function scanForSyncedTrack(): void {
    scanScheduled = false;
    unregisterDisconnectedVideos();

    let bestVideo: HTMLVideoElement | null = null;
    let bestTrack: TextTrack | null = null;
    let bestScore = -1;

    for (const video of registeredVideos) {
      const track = findSyncedTrack(video);
      if (!track) continue;
      const score = getVideoArea(video) + (!video.paused && !video.ended ? 1_000_000_000 : 0);
      if (score > bestScore) {
        bestScore = score;
        bestVideo = video;
        bestTrack = track;
      }
    }

    if (bestVideo !== activeVideo || bestTrack !== activeTrack) {
      setActiveTrack(bestVideo, bestTrack);
      return;
    }

    if (!activeTrack || !activeVideo) {
      hideOverlay();
      return;
    }

    try {
      if (activeTrack.mode !== "hidden") activeTrack.mode = "hidden";
    } catch {
      setActiveTrack(null, null);
      return;
    }
    scheduleOverlayRender();
  }

  function scheduleTrackScan(): void {
    if (scanScheduled) return;
    scanScheduled = true;
    queueMicrotask(scanForSyncedTrack);
  }

  function getOverlayParent(video: HTMLVideoElement): Element | null {
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

  function ensureOverlay(): void {
    if (overlayHost?.isConnected && overlayBubble && overlayText) return;

    document.getElementById(OVERLAY_HOST_ID)?.remove();

    overlayHost = document.createElement("div");
    overlayHost.id = OVERLAY_HOST_ID;
    overlayHost.setAttribute("data-browser-toolbox-synced-caption-overlay", "true");
    overlayHost.style.cssText = [
      "all: initial",
      "position: fixed",
      "top: 0",
      "left: 0",
      "z-index: 2147483644",
      "display: none",
      "width: max-content",
      "height: max-content",
      "pointer-events: none",
      "transform: translate3d(0, 0, 0)"
    ].join(";");

    const shadow = overlayHost.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      .caption {
        box-sizing: border-box;
        width: max-content;
        max-width: 92vw;
        padding: 0.22em 0.48em 0.28em;
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 0.24em;
        background: rgba(0, 0, 0, 0.78);
        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.38);
        color: #ffffff;
        cursor: grab;
        font-family: Arial, "Noto Sans KR", "Segoe UI", sans-serif;
        font-weight: 700;
        line-height: 1.32;
        overflow-wrap: anywhere;
        pointer-events: auto;
        text-align: center;
        text-shadow: 0 2px 3px rgba(0, 0, 0, 0.98), 0 0 2px rgba(0, 0, 0, 0.95);
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
        white-space: pre-wrap;
      }
      .caption:active { cursor: grabbing; }
      .caption-text { display: block; }
      .caption[data-overflow="true"] .caption-text {
        overflow: auto; overscroll-behavior: contain; cursor: auto; touch-action: pan-y;
        user-select: text; -webkit-user-select: text;
      }
      .caption-warning {
        font: 12px/1.35 Arial, "Noto Sans KR", sans-serif; color: #ffe4a3;
        padding: 3px 0 7px; white-space: normal; text-shadow: none;
      }
      .caption-warning[hidden] { display: none; }
      .caption:focus-visible {
        outline: 3px solid rgba(96, 165, 250, 0.95);
        outline-offset: 3px;
      }
    `;

    overlayBubble = document.createElement("div");
    overlayBubble.className = "caption";
    overlayBubble.tabIndex = 0;
    overlayBubble.setAttribute("role", "status");
    overlayBubble.setAttribute("aria-live", "off");
    overlayBubble.setAttribute("aria-label", "배속 동기화 자막. 마우스로 끌어 위치를 이동할 수 있습니다.");
    overlayBubble.title = "마우스로 끌어 자막 위치 이동";

    overlayWarning = document.createElement("div");
    overlayWarning.className = "caption-warning";
    overlayWarning.hidden = true;
    overlayText = document.createElement("span");
    overlayText.className = "caption-text";
    overlayBubble.append(overlayWarning, overlayText);
    shadow.append(style, overlayBubble);

    overlayBubble.addEventListener("pointerdown", startCaptionDrag);
    overlayBubble.addEventListener("pointermove", moveCaptionDrag);
    overlayBubble.addEventListener("pointerup", finishCaptionDrag);
    overlayBubble.addEventListener("pointercancel", finishCaptionDrag);

    const parent = document.documentElement || document.body;
    if (parent) parent.appendChild(overlayHost);
  }

  function hideOverlay(): void {
    if (overlayHost) {
      overlayHost.style.display = "none";
      overlayHost.setAttribute("data-visible", "false");
    }
  }

  function getActiveCaptionText(): string {
    if (!activeTrack) return "";
    const texts: string[] = [];
    const seen = new Set<string>();
    for (const cue of Array.from(activeTrack.activeCues || [])) {
      const text = String((cue as VTTCue)?.text || "").trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      texts.push(text);
    }
    return texts.join("\n");
  }

  function normalizeCaptionForPreferredLines(value: string): string {
    return String(value || "")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function countRenderedCaptionLines(): number {
    if (!overlayText || !overlayText.textContent) return 0;
    const range = document.createRange();
    try {
      range.selectNodeContents(overlayText);
      const lineTops: number[] = [];
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width <= 0 || rect.height <= 0) continue;
        const top = Math.round(rect.top * 2) / 2;
        if (!lineTops.some((existingTop) => Math.abs(existingTop - top) <= 1)) {
          lineTops.push(top);
        }
      }
      return lineTops.length || 1;
    } finally {
      try { range.detach(); } catch { /* The method is optional in modern browsers. */ }
    }
  }

  function applyCaptionLayout(videoRect: DOMRect, text: string): DOMRect | null {
    if (!overlayBubble || !overlayHost) return null;

    const fontSize = settings[STORAGE_KEYS.fontSize];
    const maxWidthPercent = settings[STORAGE_KEYS.maxWidthPercent];
    const preferredLineCount = settings[STORAGE_KEYS.preferredLineCount];
    const maximumWidth = Math.max(1, Math.floor(videoRect.width * maxWidthPercent / 100));
    const cacheKey = [
      text,
      fontSize,
      maxWidthPercent,
      preferredLineCount,
      Math.round(videoRect.width * 10) / 10
    ].join("|");

    overlayBubble.style.fontSize = `${fontSize}px`;
    overlayBubble.style.maxWidth = `${maximumWidth}px`;

    if (layoutCache?.key === cacheKey) {
      overlayBubble.style.width = layoutCache.width;
      const cachedRect = overlayBubble.getBoundingClientRect();
      overlayHost.setAttribute("data-rendered-lines", String(layoutCache.renderedLines));
      overlayHost.setAttribute("data-bubble-width", String(Math.round(cachedRect.width)));
      return cachedRect;
    }

    let selectedWidth = "max-content";
    let renderedLines = 0;

    if (preferredLineCount > 0) {
      overlayBubble.style.maxWidth = "none";
      overlayBubble.style.width = "max-content";
      const naturalWidth = Math.max(1, Math.ceil(overlayBubble.getBoundingClientRect().width));

      if (naturalWidth <= maximumWidth) {
        selectedWidth = `${naturalWidth}px`;
      } else {
        overlayBubble.style.maxWidth = `${maximumWidth}px`;
        overlayBubble.style.width = `${maximumWidth}px`;
        const linesAtMaximumWidth = countRenderedCaptionLines();

        if (linesAtMaximumWidth > preferredLineCount) {
          selectedWidth = `${maximumWidth}px`;
        } else {
          let lower = Math.min(maximumWidth, Math.max(72, Math.ceil(fontSize * 3)));
          let upper = maximumWidth;

          overlayBubble.style.width = `${lower}px`;
          if (countRenderedCaptionLines() <= preferredLineCount) {
            upper = lower;
          } else {
            while (upper - lower > 1) {
              const candidate = Math.floor((lower + upper) / 2);
              overlayBubble.style.width = `${candidate}px`;
              if (countRenderedCaptionLines() <= preferredLineCount) upper = candidate;
              else lower = candidate;
            }
          }
          selectedWidth = `${upper}px`;
        }
      }
    }

    overlayBubble.style.maxWidth = `${maximumWidth}px`;
    overlayBubble.style.width = selectedWidth;
    const bubbleRect = overlayBubble.getBoundingClientRect();
    renderedLines = countRenderedCaptionLines();
    layoutCache = { key: cacheKey, width: selectedWidth, renderedLines };
    overlayHost.setAttribute("data-rendered-lines", String(renderedLines));
    overlayHost.setAttribute("data-bubble-width", String(Math.round(bubbleRect.width)));
    return bubbleRect;
  }

  function getOverlayGeometry(video: HTMLVideoElement, text: string): {
    left: number; top: number; videoRect: DOMRect; bubbleRect: DOMRect;
  } | null {
    if (!overlayBubble || !overlayText || !overlayWarning || !overlayHost || !isVideoVisible(video)) return null;
    const videoRect = video.getBoundingClientRect();
    const minimumLeft = Math.max(0, videoRect.left);
    const minimumTop = Math.max(0, videoRect.top);
    const availableWidth = Math.floor(Math.min(innerWidth, videoRect.right) - minimumLeft);
    const availableHeight = Math.floor(Math.min(innerHeight, videoRect.bottom) - minimumTop);
    if (availableWidth <= 0 || availableHeight <= 0) return null; // Actually outside the viewport.

    overlayText.style.maxHeight = "none";
    overlayBubble.style.maxHeight = "none";
    overlayBubble.style.overflow = "visible";
    overlayWarning.hidden = true;
    overlayBubble.dataset.overflow = "false";
    let bubbleRect = applyCaptionLayout(videoRect, text);
    if (!bubbleRect) return null;
    let expanded = false;
    if (bubbleRect.height > availableHeight && settings[STORAGE_KEYS.overflowMode] === "expand") {
      // Explicit opt-in: increase width, never shrink the chosen font or change cue text/timing.
      overlayBubble.style.maxWidth = `${availableWidth}px`;
      overlayBubble.style.width = `${availableWidth}px`;
      bubbleRect = overlayBubble.getBoundingClientRect();
      expanded = true;
    }
    if (bubbleRect.width > availableWidth) {
      overlayBubble.style.maxWidth = `${availableWidth}px`;
      overlayBubble.style.width = `${availableWidth}px`;
      bubbleRect = overlayBubble.getBoundingClientRect();
    }
    const overflow = bubbleRect.height > availableHeight;
    if (overflow) {
      overlayBubble.dataset.overflow = "true";
      overlayWarning.textContent = "자막이 표시 공간보다 큽니다. 아래 문장을 스크롤하거나 패널에서 글자 크기와 너비를 조절하세요. 이 안내를 잡고 이동할 수 있습니다.";
      overlayWarning.hidden = false;
      const style = getComputedStyle(overlayBubble);
      const verticalPadding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      const warningHeight = overlayWarning.getBoundingClientRect().height;
      overlayText.style.maxHeight = `${Math.max(24, availableHeight - verticalPadding - warningHeight)}px`;
      overlayText.tabIndex = 0;
      overlayText.setAttribute("aria-label", "전체 자막. 위아래로 스크롤할 수 있습니다.");
      bubbleRect = overlayBubble.getBoundingClientRect();
      if (bubbleRect.height > availableHeight) {
        // A very small viewport must scroll the warning as well, never discard cue text.
        overlayBubble.style.maxHeight = `${availableHeight}px`;
        overlayBubble.style.overflow = "auto";
        bubbleRect = overlayBubble.getBoundingClientRect();
      }
    } else {
      overlayText.removeAttribute("tabindex");
      overlayText.removeAttribute("aria-label");
    }
    overlayHost.dataset.layoutStatus = overflow ? "scroll-required" : expanded ? "expanded" : "fits";
    overlayHost.dataset.renderedLines = String(countRenderedCaptionLines());
    overlayHost.dataset.bubbleWidth = String(Math.round(bubbleRect.width));
    overlayHost.dataset.bubbleHeight = String(Math.round(bubbleRect.height));
    const position = settings[STORAGE_KEYS.position];
    return {
      left: clamp(videoRect.left + position.x * videoRect.width - bubbleRect.width / 2, minimumLeft, Math.max(minimumLeft, Math.min(innerWidth, videoRect.right) - bubbleRect.width)),
      top: clamp(videoRect.top + position.y * videoRect.height - bubbleRect.height / 2, minimumTop, Math.max(minimumTop, Math.min(innerHeight, videoRect.bottom) - bubbleRect.height)),
      videoRect, bubbleRect
    };
  }

  function renderOverlay(): void {
    if (overlayFrame) window.cancelAnimationFrame(overlayFrame);
    if (overlayFallbackTimer) window.clearTimeout(overlayFallbackTimer);
    overlayFrame = 0;
    overlayFallbackTimer = 0;

    if (!activeVideo || !activeTrack) {
      hideOverlay();
      return;
    }

    if (!activeVideo.isConnected || activeTrack.mode === "disabled" || (Number(activeTrack.cues?.length) || 0) <= 0) {
      hideOverlay();
      scheduleTrackScan();
      return;
    }

    const rawText = getActiveCaptionText();
    if (!rawText) {
      hideOverlay();
      return;
    }

    ensureOverlay();
    if (!overlayHost || !overlayBubble || !overlayText) return;

    const parent = getOverlayParent(activeVideo);
    if (parent && overlayHost.parentNode !== parent) parent.appendChild(overlayHost);

    const preferredLineCount = settings[STORAGE_KEYS.preferredLineCount];
    const text = preferredLineCount > 0
      ? normalizeCaptionForPreferredLines(rawText)
      : rawText;
    if (!text) {
      hideOverlay();
      return;
    }

    if (overlayText.textContent !== text) {
      overlayText.textContent = text;
      overlayText.scrollTop = 0;
    }
    overlayHost.style.display = "block";
    overlayHost.setAttribute("data-visible", "true");
    overlayHost.setAttribute("data-font-size", String(settings[STORAGE_KEYS.fontSize]));
    overlayHost.setAttribute("data-max-width-percent", String(settings[STORAGE_KEYS.maxWidthPercent]));
    overlayHost.setAttribute("data-preferred-lines", String(preferredLineCount));
    overlayHost.setAttribute("data-caption-text-length", String(text.length));

    const geometry = getOverlayGeometry(activeVideo, text);
    if (!geometry) {
      hideOverlay();
      return;
    }

    overlayHost.style.transform = `translate3d(${Math.round(geometry.left)}px, ${Math.round(geometry.top)}px, 0)`;
  }

  function scheduleOverlayRender(): void {
    if (overlayFrame || overlayFallbackTimer) return;
    overlayFrame = window.requestAnimationFrame(renderOverlay);
    overlayFallbackTimer = window.setTimeout(renderOverlay, 80);
  }

  function startCaptionDrag(event: PointerEvent): void {
    if (!event.isTrusted || event.button !== 0 || !activeVideo || !overlayBubble) return;
    if (overlayBubble.dataset.overflow === "true" && overlayText?.contains(event.target as Node)) return;
    const rect = overlayBubble.getBoundingClientRect();
    dragging = {
      pointerId: event.pointerId,
      video: activeVideo,
      pointerOffsetX: event.clientX - rect.left,
      pointerOffsetY: event.clientY - rect.top
    };
    try { overlayBubble.setPointerCapture(event.pointerId); } catch { /* Pointer capture is optional. */ }
    event.preventDefault();
    event.stopPropagation();
  }

  function moveCaptionDrag(event: PointerEvent): void {
    if (!event.isTrusted || !dragging || event.pointerId !== dragging.pointerId || !overlayBubble) return;
    const video = dragging.video;
    if (!isVideoVisible(video)) {
      finishCaptionDrag(event);
      return;
    }

    const videoRect = video.getBoundingClientRect();
    const bubbleRect = overlayBubble.getBoundingClientRect();
    const maximumLeft = Math.max(videoRect.left, videoRect.right - bubbleRect.width);
    const maximumTop = Math.max(videoRect.top, videoRect.bottom - bubbleRect.height);
    const left = clamp(event.clientX - dragging.pointerOffsetX, videoRect.left, maximumLeft);
    const top = clamp(event.clientY - dragging.pointerOffsetY, videoRect.top, maximumTop);
    const centerX = left + bubbleRect.width / 2;
    const centerY = top + bubbleRect.height / 2;

    settings[STORAGE_KEYS.position] = {
      x: videoRect.width > 0 ? clamp((centerX - videoRect.left) / videoRect.width, 0, 1) : DEFAULT_POSITION.x,
      y: videoRect.height > 0 ? clamp((centerY - videoRect.top) / videoRect.height, 0, 1) : DEFAULT_POSITION.y
    };

    scheduleOverlayRender();
    event.preventDefault();
    event.stopPropagation();
  }

  function finishCaptionDrag(event: PointerEvent): void {
    if (!event.isTrusted || !dragging || event.pointerId !== dragging.pointerId) return;
    try { overlayBubble?.releasePointerCapture?.(dragging.pointerId); } catch { /* It may already be released. */ }
    dragging = null;
    savePositionSoon();
    event.preventDefault();
    event.stopPropagation();
  }

  function handleStorageChanges(changes: Record<string, any>, areaName: string): void {
    if (areaName !== "local") return;
    settingsJournal.record(changes);
    let changed = false;

    if (Object.prototype.hasOwnProperty.call(changes, STORAGE_KEYS.fontSize)) {
      settings[STORAGE_KEYS.fontSize] = normalizeFontSize(changes[STORAGE_KEYS.fontSize]?.newValue);
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(changes, STORAGE_KEYS.position)) {
      settings[STORAGE_KEYS.position] = normalizePosition(changes[STORAGE_KEYS.position]?.newValue);
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(changes, STORAGE_KEYS.maxWidthPercent)) {
      settings[STORAGE_KEYS.maxWidthPercent] = normalizeMaxWidthPercent(changes[STORAGE_KEYS.maxWidthPercent]?.newValue);
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(changes, STORAGE_KEYS.preferredLineCount)) {
      settings[STORAGE_KEYS.preferredLineCount] = normalizePreferredLineCount(changes[STORAGE_KEYS.preferredLineCount]?.newValue);
      changed = true;
    }

    if (Object.prototype.hasOwnProperty.call(changes, STORAGE_KEYS.overflowMode)) {
      settings[STORAGE_KEYS.overflowMode] = changes[STORAGE_KEYS.overflowMode]?.newValue === "expand" ? "expand" : "scroll";
      changed = true;
    }
    if (changed) {
      layoutCache = null;
      scheduleOverlayRender();
    }
  }

  function handleViewportChange(): void {
    layoutCache = null;
    scheduleOverlayRender();
  }

  globalThis[CONTROLLER_KEY] = {
    scheduleTrackScan,
    scheduleOverlayRender
  };

  globalThis.chrome?.storage?.onChanged?.addListener?.(handleStorageChanges);
  loadStoredSettings();
  startDocumentTracking();
  document.addEventListener(TRACK_CHANGED_EVENT, scheduleTrackScan, true);
  document.addEventListener("visibilitychange", scheduleTrackScan, true);
  window.addEventListener("focus", scheduleTrackScan, true);
  window.addEventListener("pageshow", scheduleTrackScan, true);
  document.addEventListener("fullscreenchange", handleViewportChange, true);
  window.addEventListener("resize", handleViewportChange, { passive: true });
  window.addEventListener("scroll", handleViewportChange, { passive: true, capture: true });
  scheduleTrackScan();
})();
