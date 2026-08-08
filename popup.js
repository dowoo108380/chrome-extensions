(() => {
  "use strict";

  const CHAT_WIDTH_STORAGE_KEY = "chatConversationWidthPx";
  const COMPOSER_WIDTH_STORAGE_KEY = "chatComposerWidthPx";
  const CHAT_WIDTH_DEFAULT_PX = 960;
  const COMPOSER_WIDTH_DEFAULT_PX = 0;
  const CHAT_WIDTH_MIN_PX = 640;
  const CHAT_WIDTH_MAX_PX = 2000;
  const CHAT_WIDTH_STEP_PX = 40;
  const CHAT_WIDTH_SLIDER_MAX = 1 + Math.floor(
    (CHAT_WIDTH_MAX_PX - CHAT_WIDTH_MIN_PX) / CHAT_WIDTH_STEP_PX
  );

  const MEDIA_STORAGE_KEYS = Object.freeze({
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
  const MEDIA_SHORTCUT_DEFINITIONS = Object.freeze([
    Object.freeze({ command: "slower", storageKey: MEDIA_STORAGE_KEYS.shortcutSlower, defaultCode: "KeyS", label: "느리게" }),
    Object.freeze({ command: "faster", storageKey: MEDIA_STORAGE_KEYS.shortcutFaster, defaultCode: "KeyD", label: "빠르게" }),
    Object.freeze({ command: "reset", storageKey: MEDIA_STORAGE_KEYS.shortcutReset, defaultCode: "KeyR", label: "1.00배속과 이전 또는 기본 배속 전환" }),
    Object.freeze({ command: "backward", storageKey: MEDIA_STORAGE_KEYS.shortcutBackward, defaultCode: "KeyZ", label: "뒤로 이동" }),
    Object.freeze({ command: "forward", storageKey: MEDIA_STORAGE_KEYS.shortcutForward, defaultCode: "KeyX", label: "앞으로 이동" }),
    Object.freeze({ command: "overlay", storageKey: MEDIA_STORAGE_KEYS.shortcutOverlay, defaultCode: "KeyV", label: "표시창 켜기 또는 끄기" })
  ]);
  const MEDIA_RATE_MIN = 0.07;
  const MEDIA_RATE_MAX = 16;
  const MEDIA_SPEED_STEP_MIN = 0.01;
  const MEDIA_SPEED_STEP_MAX = 2;
  const MEDIA_SEEK_STEP_MIN = 1;
  const MEDIA_SEEK_STEP_MAX = 600;
  const MEDIA_DEFAULTS = Object.freeze({
    [MEDIA_STORAGE_KEYS.enabled]: false,
    [MEDIA_STORAGE_KEYS.speedStep]: 0.1,
    [MEDIA_STORAGE_KEYS.seekStep]: 10,
    [MEDIA_STORAGE_KEYS.resetFallbackRate]: 2,
    [MEDIA_STORAGE_KEYS.keepRateForNewMedia]: false,
    [MEDIA_STORAGE_KEYS.overlayEnabled]: true,
    [MEDIA_STORAGE_KEYS.keyboardEnabled]: true,
    [MEDIA_STORAGE_KEYS.overlayPosition]: Object.freeze({ x: 0.5, y: 0.02 }),
    [MEDIA_STORAGE_KEYS.shortcutSlower]: "KeyS",
    [MEDIA_STORAGE_KEYS.shortcutFaster]: "KeyD",
    [MEDIA_STORAGE_KEYS.shortcutReset]: "KeyR",
    [MEDIA_STORAGE_KEYS.shortcutBackward]: "KeyZ",
    [MEDIA_STORAGE_KEYS.shortcutForward]: "KeyX",
    [MEDIA_STORAGE_KEYS.shortcutOverlay]: "KeyV"
  });

  const DEFAULT_SETTINGS = Object.freeze({
    composerCtrlEnterEnabled: true,
    messageEditCtrlEnterEnabled: true,
    mediaControllerEnabled: MEDIA_DEFAULTS[MEDIA_STORAGE_KEYS.enabled],
    mediaKeepRateForNewMedia: MEDIA_DEFAULTS[MEDIA_STORAGE_KEYS.keepRateForNewMedia],
    mediaOverlayEnabled: MEDIA_DEFAULTS[MEDIA_STORAGE_KEYS.overlayEnabled],
    mediaKeyboardEnabled: MEDIA_DEFAULTS[MEDIA_STORAGE_KEYS.keyboardEnabled],
    rightClickEnabled: false,
    textSelectionEnabled: false,
    imageDragEnabled: false,
    middleClickEnabled: false,
    copyUnlockEnabled: false,
    clipboardProtectionEnabled: false,
    newTabLinksEnabled: false,
    backNavigationProtectionEnabled: false,
    linkAddressCopyEnabled: false,
    siteWarningBypassEnabled: false
  });

  const PAGE_UNLOCK_SETTING_KEYS = Object.freeze([
    "rightClickEnabled",
    "textSelectionEnabled",
    "copyUnlockEnabled",
    "clipboardProtectionEnabled",
    "imageDragEnabled",
    "middleClickEnabled",
    "newTabLinksEnabled",
    "backNavigationProtectionEnabled",
    "linkAddressCopyEnabled",
    "siteWarningBypassEnabled"
  ]);

  const MESSAGE_TYPES = Object.freeze({
    CAPTURE_FULL_PAGE: "capture-full-page",
    START_AREA_SELECTION: "start-area-selection",
    START_ELEMENT_ERASER: "page-element-eraser:start",
    GET_ELEMENT_ERASER_STATUS: "page-element-eraser:get-site-status",
    CLEAR_ELEMENT_ERASER_RULES: "page-element-eraser:clear-site-rules",
    GET_MEDIA_TAB_STATE: "media-controller:get-tab-state",
    SET_MEDIA_TAB_RATE: "media-controller:set-tab-rate",
    MEDIA_TAB_RATE_UPDATED: "media-controller:tab-rate-updated"
  });

  const controls = {
    composerCtrlEnterEnabled: document.getElementById("composer-toggle"),
    messageEditCtrlEnterEnabled: document.getElementById("message-edit-toggle"),
    mediaControllerEnabled: document.getElementById("media-controller-toggle"),
    mediaKeepRateForNewMedia: document.getElementById("media-keep-rate-toggle"),
    mediaOverlayEnabled: document.getElementById("media-overlay-toggle"),
    mediaKeyboardEnabled: document.getElementById("media-keyboard-toggle"),
    rightClickEnabled: document.getElementById("right-click-toggle"),
    textSelectionEnabled: document.getElementById("text-selection-toggle"),
    copyUnlockEnabled: document.getElementById("copy-unlock-toggle"),
    clipboardProtectionEnabled: document.getElementById("clipboard-protection-toggle"),
    imageDragEnabled: document.getElementById("image-drag-toggle"),
    middleClickEnabled: document.getElementById("middle-click-toggle"),
    newTabLinksEnabled: document.getElementById("new-tab-links-toggle"),
    backNavigationProtectionEnabled: document.getElementById("back-navigation-toggle"),
    linkAddressCopyEnabled: document.getElementById("link-address-copy-toggle"),
    siteWarningBypassEnabled: document.getElementById("site-warning-bypass-toggle")
  };

  const pageUnlockToggle = document.getElementById("page-unlock-toggle");
  const pageUnlockDropdown = document.getElementById("page-unlock-dropdown");
  const pageUnlockSummary = document.getElementById("page-unlock-summary");
  const pageUnlockMasterToggle = document.getElementById("page-unlock-master-toggle");
  const chatWidthSlider = document.getElementById("chat-width-slider");
  const chatWidthValue = document.getElementById("chat-width-value");
  const composerWidthSlider = document.getElementById("composer-width-slider");
  const composerWidthValue = document.getElementById("composer-width-value");
  const mediaToggle = document.getElementById("media-toggle");
  const mediaDropdown = document.getElementById("media-dropdown");
  const mediaSummary = document.getElementById("media-summary");
  const mediaRateSlider = document.getElementById("media-rate-slider");
  const mediaRateInput = document.getElementById("media-rate-input");
  const mediaSpeedStepInput = document.getElementById("media-speed-step-input");
  const mediaSeekStepInput = document.getElementById("media-seek-step-input");
  const mediaResetFallbackRateInput = document.getElementById("media-reset-fallback-rate-input");
  const mediaRateResetButton = document.getElementById("media-rate-reset");
  const mediaOverlayPositionResetButton = document.getElementById("media-overlay-position-reset");
  const mediaShortcutResetButton = document.getElementById("media-shortcut-reset");
  const mediaShortcutHint = document.getElementById("media-shortcut-hint");
  const mediaShortcutButtons = new Map(
    Array.from(document.querySelectorAll("[data-media-shortcut-command]")).map((button) => [
      button.dataset.mediaShortcutCommand,
      button
    ])
  );
  const fullPageButton = document.getElementById("full-page-button");
  const fullPageButtonLabel = document.getElementById("full-page-button-label");
  const areaButton = document.getElementById("area-button");
  const areaButtonLabel = document.getElementById("area-button-label");
  const elementEraserToggle = document.getElementById("element-eraser-toggle");
  const elementEraserDropdown = document.getElementById("element-eraser-dropdown");
  const elementEraserModeButtons = Array.from(
    document.querySelectorAll("[data-eraser-mode]")
  );
  const elementEraserSiteSummary = document.getElementById("element-eraser-site-summary");
  const clearElementEraserRulesButton = document.getElementById("clear-element-eraser-rules");
  const tabUrlToggle = document.getElementById("tab-url-toggle");
  const tabUrlDropdown = document.getElementById("tab-url-dropdown");
  const tabList = document.getElementById("tab-list");
  const tabListSummary = document.getElementById("tab-list-summary");
  const refreshTabsButton = document.getElementById("refresh-tabs-button");
  const selectAllTabsButton = document.getElementById("select-all-tabs-button");
  const clearTabsButton = document.getElementById("clear-tabs-button");
  const selectedTabsCount = document.getElementById("selected-tabs-count");
  const copyTabUrlsButton = document.getElementById("copy-tab-urls-button");
  const copyTabUrlsLabel = document.getElementById("copy-tab-urls-label");
  const status = document.getElementById("status");
  const storageArea = globalThis.chrome?.storage?.local;

  let activeAction = "";
  let tabListLoading = false;
  let tabCopying = false;
  let tabEntries = [];
  let copyLabelResetTimer = 0;
  let chatWidthSaveTimer = 0;
  let composerWidthSaveTimer = 0;
  let pendingChatWidthPx = CHAT_WIDTH_DEFAULT_PX;
  let pendingComposerWidthPx = COMPOSER_WIDTH_DEFAULT_PX;
  let mediaRateSaveTimer = 0;
  let pendingMediaRate = 1;
  let activeMediaTabId = null;
  let activeMediaAvailable = false;
  let activeMediaLabel = "";
  let mediaTabStateLoading = false;
  let settingsControlsReady = false;
  let mediaShortcutCodes = Object.fromEntries(
    MEDIA_SHORTCUT_DEFINITIONS.map((definition) => [definition.command, definition.defaultCode])
  );
  let mediaShortcutCaptureCommand = "";
  let elementEraserStatusLoading = false;
  let elementEraserRuleCount = 0;
  let elementEraserHostname = "";
  const selectedTabIds = new Set();

  function setStatus(message, state = "ready") {
    status.textContent = message;
    status.dataset.state = state;
  }

  function setSettingsStatus(message, state = "ready") {
    if (!activeAction && !tabListLoading && !tabCopying) {
      setStatus(message, state);
    }
  }

  function setPageUnlockControlsEnabled(enabled) {
    pageUnlockMasterToggle.disabled = !enabled;
    for (const key of PAGE_UNLOCK_SETTING_KEYS) {
      controls[key].disabled = !enabled;
    }
  }

  function setControlsEnabled(enabled) {
    settingsControlsReady = Boolean(enabled);
    for (const control of Object.values(controls)) {
      control.disabled = !enabled;
    }
    pageUnlockMasterToggle.disabled = !enabled;
    chatWidthSlider.disabled = !enabled;
    composerWidthSlider.disabled = !enabled;
    mediaToggle.disabled = !enabled;
    mediaRateSlider.disabled = !enabled;
    mediaRateInput.disabled = !enabled;
    mediaSpeedStepInput.disabled = !enabled;
    mediaSeekStepInput.disabled = !enabled;
    mediaResetFallbackRateInput.disabled = !enabled;
    mediaRateResetButton.disabled = !enabled;
    mediaOverlayPositionResetButton.disabled = !enabled;
    mediaShortcutResetButton.disabled = !enabled;
    for (const button of mediaShortcutButtons.values()) {
      button.disabled = !enabled;
    }
    updateMediaRateControlsEnabled();
  }

  function updateMediaRateControlsEnabled() {
    const enabled = settingsControlsReady &&
      !mediaTabStateLoading &&
      controls.mediaControllerEnabled.checked &&
      activeMediaAvailable;
    mediaRateSlider.disabled = !enabled;
    mediaRateInput.disabled = !enabled;
    mediaRateResetButton.disabled = !enabled;
  }

  function normalizeWidthPx(value, fallbackPx) {
    const numericValue = Number(value);
    if (numericValue === 0) {
      return 0;
    }

    if (!Number.isFinite(numericValue)) {
      return fallbackPx;
    }

    const steppedValue = Math.round(numericValue / CHAT_WIDTH_STEP_PX) * CHAT_WIDTH_STEP_PX;
    return Math.min(CHAT_WIDTH_MAX_PX, Math.max(CHAT_WIDTH_MIN_PX, steppedValue));
  }

  function normalizeChatWidthPx(value) {
    return normalizeWidthPx(value, CHAT_WIDTH_DEFAULT_PX);
  }

  function normalizeComposerWidthPx(value) {
    return normalizeWidthPx(value, COMPOSER_WIDTH_DEFAULT_PX);
  }

  function widthToSliderValue(widthPx) {
    if (widthPx === 0) {
      return 0;
    }

    return 1 + Math.round((widthPx - CHAT_WIDTH_MIN_PX) / CHAT_WIDTH_STEP_PX);
  }

  function sliderValueToWidth(value) {
    const sliderValue = Math.min(
      CHAT_WIDTH_SLIDER_MAX,
      Math.max(0, Math.round(Number(value) || 0))
    );

    if (sliderValue === 0) {
      return 0;
    }

    return CHAT_WIDTH_MIN_PX + (sliderValue - 1) * CHAT_WIDTH_STEP_PX;
  }

  function formatChatWidth(widthPx) {
    return widthPx === 0
      ? "ChatGPT 기본 너비"
      : `${widthPx.toLocaleString("ko-KR")}픽셀`;
  }

  function updateChatWidthUi(widthPx) {
    const normalizedWidth = normalizeChatWidthPx(widthPx);
    pendingChatWidthPx = normalizedWidth;
    chatWidthSlider.max = String(CHAT_WIDTH_SLIDER_MAX);
    chatWidthSlider.value = String(widthToSliderValue(normalizedWidth));
    chatWidthValue.textContent = formatChatWidth(normalizedWidth);
    chatWidthSlider.setAttribute("aria-valuetext", formatChatWidth(normalizedWidth));
  }

  function updateComposerWidthUi(widthPx) {
    const normalizedWidth = normalizeComposerWidthPx(widthPx);
    pendingComposerWidthPx = normalizedWidth;
    composerWidthSlider.max = String(CHAT_WIDTH_SLIDER_MAX);
    composerWidthSlider.value = String(widthToSliderValue(normalizedWidth));
    composerWidthValue.textContent = formatChatWidth(normalizedWidth);
    composerWidthSlider.setAttribute("aria-valuetext", formatChatWidth(normalizedWidth));
  }

  function clampNumber(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function normalizeMediaNumber(value, fallback, minimum, maximum, decimals = 2) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return fallback;
    const factor = 10 ** decimals;
    return clampNumber(
      Math.round(numericValue * factor) / factor,
      minimum,
      maximum
    );
  }

  function normalizeMediaRate(value) {
    return normalizeMediaNumber(
      value,
      1,
      MEDIA_RATE_MIN,
      MEDIA_RATE_MAX,
      2
    );
  }

  function normalizeMediaSpeedStep(value) {
    return normalizeMediaNumber(
      value,
      MEDIA_DEFAULTS[MEDIA_STORAGE_KEYS.speedStep],
      MEDIA_SPEED_STEP_MIN,
      MEDIA_SPEED_STEP_MAX,
      2
    );
  }

  function normalizeMediaResetFallbackRate(value) {
    return normalizeMediaNumber(
      value,
      MEDIA_DEFAULTS[MEDIA_STORAGE_KEYS.resetFallbackRate],
      MEDIA_RATE_MIN,
      MEDIA_RATE_MAX,
      2
    );
  }

  function normalizeMediaSeekStep(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return MEDIA_DEFAULTS[MEDIA_STORAGE_KEYS.seekStep];
    }
    return clampNumber(
      Math.round(numericValue),
      MEDIA_SEEK_STEP_MIN,
      MEDIA_SEEK_STEP_MAX
    );
  }


  function normalizeMediaShortcutCode(value, fallback = "") {
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

  function formatMediaShortcutCode(code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^Numpad[0-9]$/.test(code)) return `숫자 ${code.slice(6)}`;

    const labels = {
      ArrowUp: "↑",
      ArrowDown: "↓",
      ArrowLeft: "←",
      ArrowRight: "→",
      Space: "Space",
      Backspace: "Backspace",
      Delete: "Delete",
      Insert: "Insert",
      Home: "Home",
      End: "End",
      PageUp: "Page Up",
      PageDown: "Page Down",
      Backquote: "`",
      Minus: "-",
      Equal: "=",
      BracketLeft: "[",
      BracketRight: "]",
      Backslash: "\\",
      Semicolon: ";",
      Quote: "'",
      Comma: ",",
      Period: ".",
      Slash: "/",
      NumpadAdd: "숫자 +",
      NumpadSubtract: "숫자 -",
      NumpadMultiply: "숫자 ×",
      NumpadDivide: "숫자 ÷",
      NumpadDecimal: "숫자 ."
    };
    return labels[code] || code;
  }

  function updateMediaShortcutUi(values = {}) {
    for (const definition of MEDIA_SHORTCUT_DEFINITIONS) {
      const code = normalizeMediaShortcutCode(
        values[definition.storageKey] ?? values[definition.command],
        definition.defaultCode
      );
      mediaShortcutCodes[definition.command] = code;

      const button = mediaShortcutButtons.get(definition.command);
      if (!button) continue;
      const listening = mediaShortcutCaptureCommand === definition.command;
      button.textContent = listening ? "키 입력…" : formatMediaShortcutCode(code);
      button.dataset.listening = String(listening);
      button.setAttribute("aria-label", `${definition.label} 단축키: ${formatMediaShortcutCode(code)}`);
    }
  }

  function setMediaShortcutCapture(command = "") {
    mediaShortcutCaptureCommand = command;
    updateMediaShortcutUi(mediaShortcutCodes);

    if (!mediaShortcutHint) return;
    if (!command) {
      mediaShortcutHint.textContent = "키 버튼을 누른 뒤 새 단축키를 입력합니다. Esc 키를 누르면 변경을 취소합니다.";
      return;
    }

    const definition = MEDIA_SHORTCUT_DEFINITIONS.find((item) => item.command === command);
    mediaShortcutHint.textContent = `${definition?.label || "선택한 기능"}에 사용할 키를 누르세요.`;
  }

  function formatMediaRate(rate) {
    return `${normalizeMediaRate(rate).toFixed(2)}배속`;
  }

  function updateMediaRateUi(rate) {
    const normalizedRate = normalizeMediaRate(rate);
    pendingMediaRate = normalizedRate;
    mediaRateSlider.value = String(Math.round(normalizedRate * 100));
    mediaRateSlider.setAttribute("aria-valuetext", formatMediaRate(normalizedRate));
    mediaRateInput.value = normalizedRate.toFixed(2);
    updateMediaSummary();
  }

  function updateMediaSpeedStepUi(step) {
    mediaSpeedStepInput.value = normalizeMediaSpeedStep(step).toFixed(2);
  }

  function updateMediaSeekStepUi(seconds) {
    mediaSeekStepInput.value = String(normalizeMediaSeekStep(seconds));
  }

  function updateMediaResetFallbackRateUi(rate) {
    mediaResetFallbackRateInput.value = normalizeMediaResetFallbackRate(rate).toFixed(2);
  }

  function updateMediaSummary() {
    if (!controls.mediaControllerEnabled.checked) {
      mediaSummary.textContent = "미디어 속도 조절이 꺼져 있습니다.";
      return;
    }

    const features = [];
    if (controls.mediaOverlayEnabled.checked) features.push("표시창");
    if (controls.mediaKeyboardEnabled.checked) features.push("단축키");

    const featureText = features.length > 0
      ? `${features.join("과 ")} 사용`
      : "표시창과 단축키를 사용하지 않음";
    const newMediaText = controls.mediaKeepRateForNewMedia.checked
      ? "새 소스에 마지막 속도 유지"
      : "새 소스는 1.00배속";
    const activeText = activeMediaAvailable
      ? `${activeMediaLabel || "현재 선택된 미디어"} ${formatMediaRate(pendingMediaRate)}`
      : "현재 선택된 미디어 없음";
    mediaSummary.textContent = `${activeText} · ${newMediaText} · ${featureText}`;
  }

  function updateElementEraserControls() {
    const busy = Boolean(activeAction);
    elementEraserToggle.disabled = busy || elementEraserStatusLoading;
    elementEraserToggle.setAttribute(
      "aria-busy",
      String(activeAction === "eraser-temporary" || activeAction === "eraser-persistent")
    );

    for (const button of elementEraserModeButtons) {
      button.disabled = busy || elementEraserStatusLoading;
    }

    clearElementEraserRulesButton.disabled =
      busy || elementEraserStatusLoading || elementEraserRuleCount === 0;
  }

  function setActionBusy(action = "") {
    activeAction = action;
    const busy = Boolean(action);

    fullPageButton.disabled = busy;
    areaButton.disabled = busy;
    fullPageButton.setAttribute("aria-busy", String(action === "full-page"));
    areaButton.setAttribute("aria-busy", String(action === "area"));

    fullPageButtonLabel.textContent = action === "full-page"
      ? "전체 페이지를 캡처하는 중입니다"
      : "현재 페이지 전체 캡처";

    areaButtonLabel.textContent = action === "area"
      ? "영역 선택 도구를 여는 중입니다"
      : "드래그하여 영역 캡처";

    updateElementEraserControls();
  }

  function updatePageUnlockSummary() {
    const enabledCount = PAGE_UNLOCK_SETTING_KEYS.reduce(
      (count, key) => count + (controls[key].checked ? 1 : 0),
      0
    );

    const totalCount = PAGE_UNLOCK_SETTING_KEYS.length;
    const allEnabled = enabledCount === totalCount;
    const mixed = enabledCount > 0 && !allEnabled;

    pageUnlockMasterToggle.checked = allEnabled;
    pageUnlockMasterToggle.indeterminate = mixed;
    pageUnlockMasterToggle.dataset.state = mixed
      ? "mixed"
      : (allEnabled ? "on" : "off");

    if (enabledCount === 0) {
      pageUnlockSummary.textContent = `${totalCount}개 기능이 모두 꺼져 있습니다.`;
      return;
    }

    if (allEnabled) {
      pageUnlockSummary.textContent = `${totalCount}개 기능을 모두 사용 중입니다.`;
      return;
    }

    pageUnlockSummary.textContent = `${totalCount}개 중 ${enabledCount}개 기능을 사용 중입니다.`;
  }

  function resolveStoredSetting(stored, key) {
    if (typeof stored[key] === "boolean") {
      return stored[key];
    }

    // Version 1.11 protected ordinary copy while text selection was enabled.
    // Preserve that behavior once for existing installations.
    if (key === "copyUnlockEnabled" && stored.textSelectionEnabled === true) {
      return true;
    }

    return DEFAULT_SETTINGS[key];
  }

  function applySettings(values) {
    const stored = values && typeof values === "object" ? values : {};

    for (const [key, control] of Object.entries(controls)) {
      control.checked = resolveStoredSetting(stored, key);
    }

    const storedChatWidth = Object.prototype.hasOwnProperty.call(stored, CHAT_WIDTH_STORAGE_KEY)
      ? stored[CHAT_WIDTH_STORAGE_KEY]
      : CHAT_WIDTH_DEFAULT_PX;
    const storedComposerWidth = Object.prototype.hasOwnProperty.call(stored, COMPOSER_WIDTH_STORAGE_KEY)
      ? stored[COMPOSER_WIDTH_STORAGE_KEY]
      : COMPOSER_WIDTH_DEFAULT_PX;
    updateChatWidthUi(storedChatWidth);
    updateComposerWidthUi(storedComposerWidth);

    updateMediaRateUi(pendingMediaRate);
    updateMediaSpeedStepUi(
      Object.prototype.hasOwnProperty.call(stored, MEDIA_STORAGE_KEYS.speedStep)
        ? stored[MEDIA_STORAGE_KEYS.speedStep]
        : MEDIA_DEFAULTS[MEDIA_STORAGE_KEYS.speedStep]
    );
    updateMediaSeekStepUi(
      Object.prototype.hasOwnProperty.call(stored, MEDIA_STORAGE_KEYS.seekStep)
        ? stored[MEDIA_STORAGE_KEYS.seekStep]
        : MEDIA_DEFAULTS[MEDIA_STORAGE_KEYS.seekStep]
    );
    updateMediaResetFallbackRateUi(
      Object.prototype.hasOwnProperty.call(stored, MEDIA_STORAGE_KEYS.resetFallbackRate)
        ? stored[MEDIA_STORAGE_KEYS.resetFallbackRate]
        : MEDIA_DEFAULTS[MEDIA_STORAGE_KEYS.resetFallbackRate]
    );
    updateMediaShortcutUi(stored);

    updatePageUnlockSummary();
    updateMediaSummary();
  }

  function persistLegacyCopySetting(stored) {
    if (
      stored &&
      typeof stored === "object" &&
      !Object.prototype.hasOwnProperty.call(stored, "copyUnlockEnabled") &&
      stored.textSelectionEnabled === true &&
      storageArea &&
      typeof storageArea.set === "function"
    ) {
      storageArea.set({ copyUnlockEnabled: true }, () => {
        void getRuntimeErrorMessage();
      });
    }
  }

  function getRuntimeErrorMessage() {
    return globalThis.chrome?.runtime?.lastError?.message || "";
  }

  function loadSettings() {
    if (!storageArea || typeof storageArea.get !== "function") {
      applySettings(DEFAULT_SETTINGS);
      setControlsEnabled(false);
      setSettingsStatus("Chrome 저장소를 사용할 수 없습니다.", "error");
      return;
    }

    try {
      storageArea.get(null, (storedSettings) => {
        if (getRuntimeErrorMessage()) {
          applySettings(DEFAULT_SETTINGS);
          setControlsEnabled(false);
          setSettingsStatus("설정을 불러오지 못했습니다.", "error");
          return;
        }

        applySettings(storedSettings);
        persistLegacyCopySetting(storedSettings);
        setControlsEnabled(true);
        setSettingsStatus("설정을 불러왔습니다. ChatGPT 너비와 공통 미디어 설정은 열려 있는 페이지에 즉시 적용됩니다.");
        void loadActiveMediaTabState(false);
      });
    } catch {
      applySettings(DEFAULT_SETTINGS);
      setControlsEnabled(false);
      setSettingsStatus("설정을 불러오지 못했습니다.", "error");
    }
  }

  function saveSetting(key, value) {
    if (!storageArea || typeof storageArea.set !== "function") {
      setSettingsStatus("설정을 저장할 수 없습니다.", "error");
      return;
    }

    setSettingsStatus("설정을 저장하는 중입니다.", "working");

    try {
      storageArea.set({ [key]: value }, () => {
        if (getRuntimeErrorMessage()) {
          setSettingsStatus("설정을 저장하지 못했습니다.", "error");
          loadSettings();
          return;
        }

        setSettingsStatus("설정이 저장되어 즉시 적용되었습니다.", "success");
      });
    } catch {
      setSettingsStatus("설정을 저장하지 못했습니다.", "error");
      loadSettings();
    }
  }

  function persistChatWidth(widthPx) {
    if (!storageArea || typeof storageArea.set !== "function") {
      setSettingsStatus("대화 너비를 저장할 수 없습니다.", "error");
      return;
    }

    const normalizedWidth = normalizeChatWidthPx(widthPx);
    pendingChatWidthPx = normalizedWidth;
    setSettingsStatus("ChatGPT 대화 너비를 적용하는 중입니다.", "working");

    try {
      storageArea.set({ [CHAT_WIDTH_STORAGE_KEY]: normalizedWidth }, () => {
        if (getRuntimeErrorMessage()) {
          setSettingsStatus("대화 너비를 저장하지 못했습니다.", "error");
          loadSettings();
          return;
        }

        setSettingsStatus(
          normalizedWidth === 0
            ? "ChatGPT의 기본 대화 너비로 되돌렸습니다."
            : `ChatGPT 대화 너비를 ${formatChatWidth(normalizedWidth)}로 설정했습니다.`,
          "success"
        );
      });
    } catch {
      setSettingsStatus("대화 너비를 저장하지 못했습니다.", "error");
      loadSettings();
    }
  }

  function queueChatWidthSave(widthPx, immediate = false) {
    pendingChatWidthPx = normalizeChatWidthPx(widthPx);
    if (chatWidthSaveTimer) {
      window.clearTimeout(chatWidthSaveTimer);
      chatWidthSaveTimer = 0;
    }

    if (immediate) {
      persistChatWidth(pendingChatWidthPx);
      return;
    }

    chatWidthSaveTimer = window.setTimeout(() => {
      chatWidthSaveTimer = 0;
      persistChatWidth(pendingChatWidthPx);
    }, 120);
  }

  function handleChatWidthInput() {
    const widthPx = sliderValueToWidth(chatWidthSlider.value);
    updateChatWidthUi(widthPx);
    queueChatWidthSave(widthPx);
  }

  function handleChatWidthChange() {
    const widthPx = sliderValueToWidth(chatWidthSlider.value);
    updateChatWidthUi(widthPx);
    queueChatWidthSave(widthPx, true);
  }

  function persistComposerWidth(widthPx) {
    if (!storageArea || typeof storageArea.set !== "function") {
      setSettingsStatus("입력란 너비를 저장할 수 없습니다.", "error");
      return;
    }

    const normalizedWidth = normalizeComposerWidthPx(widthPx);
    pendingComposerWidthPx = normalizedWidth;
    setSettingsStatus("ChatGPT 입력란 너비를 적용하는 중입니다.", "working");

    try {
      storageArea.set({ [COMPOSER_WIDTH_STORAGE_KEY]: normalizedWidth }, () => {
        if (getRuntimeErrorMessage()) {
          setSettingsStatus("입력란 너비를 저장하지 못했습니다.", "error");
          loadSettings();
          return;
        }

        setSettingsStatus(
          normalizedWidth === 0
            ? "ChatGPT의 기본 입력란 너비로 되돌렸습니다."
            : `ChatGPT 입력란 너비를 ${formatChatWidth(normalizedWidth)}로 설정했습니다.`,
          "success"
        );
      });
    } catch {
      setSettingsStatus("입력란 너비를 저장하지 못했습니다.", "error");
      loadSettings();
    }
  }

  function queueComposerWidthSave(widthPx, immediate = false) {
    pendingComposerWidthPx = normalizeComposerWidthPx(widthPx);
    if (composerWidthSaveTimer) {
      window.clearTimeout(composerWidthSaveTimer);
      composerWidthSaveTimer = 0;
    }

    if (immediate) {
      persistComposerWidth(pendingComposerWidthPx);
      return;
    }

    composerWidthSaveTimer = window.setTimeout(() => {
      composerWidthSaveTimer = 0;
      persistComposerWidth(pendingComposerWidthPx);
    }, 120);
  }

  function handleComposerWidthInput() {
    const widthPx = sliderValueToWidth(composerWidthSlider.value);
    updateComposerWidthUi(widthPx);
    queueComposerWidthSave(widthPx);
  }

  function handleComposerWidthChange() {
    const widthPx = sliderValueToWidth(composerWidthSlider.value);
    updateComposerWidthUi(widthPx);
    queueComposerWidthSave(widthPx, true);
  }

  function persistMediaValue(key, value, successMessage) {
    if (!storageArea || typeof storageArea.set !== "function") {
      setSettingsStatus("미디어 설정을 저장할 수 없습니다.", "error");
      return;
    }

    setSettingsStatus("미디어 설정을 적용하는 중입니다.", "working");
    try {
      storageArea.set({ [key]: value }, () => {
        if (getRuntimeErrorMessage()) {
          setSettingsStatus("미디어 설정을 저장하지 못했습니다.", "error");
          loadSettings();
          return;
        }
        setSettingsStatus(successMessage, "success");
      });
    } catch {
      setSettingsStatus("미디어 설정을 저장하지 못했습니다.", "error");
      loadSettings();
    }
  }

  async function loadActiveMediaTabState(showStatus = false) {
    if (mediaTabStateLoading) return;
    mediaTabStateLoading = true;
    updateMediaRateControlsEnabled();

    try {
      const tab = await getActiveTab();
      const response = await requestAction(
        MESSAGE_TYPES.GET_MEDIA_TAB_STATE,
        tab.id,
        "현재 탭의 미디어 상태를 확인하지 못했습니다."
      );
      activeMediaTabId = tab.id;
      activeMediaAvailable = response.hasMedia === true;
      activeMediaLabel = String(response.label || "");
      updateMediaRateUi(response.rate);
      if (showStatus) {
        setSettingsStatus(
          activeMediaAvailable
            ? `${activeMediaLabel || "현재 선택된 미디어"}의 재생 속도는 ${formatMediaRate(response.rate)}입니다.`
            : "현재 탭에서 조절할 동영상이나 오디오를 찾지 못했습니다. 미디어를 재생하거나 마우스를 올려 보세요.",
          activeMediaAvailable ? "success" : "ready"
        );
      }
    } catch (error) {
      activeMediaTabId = null;
      activeMediaAvailable = false;
      activeMediaLabel = "";
      updateMediaRateUi(1);
      if (showStatus) {
        setSettingsStatus(String(error?.message || "현재 탭의 미디어 상태를 확인하지 못했습니다."), "error");
      }
    } finally {
      mediaTabStateLoading = false;
      updateMediaRateControlsEnabled();
      updateMediaSummary();
    }
  }


  async function applyMediaRateToActiveTab(rate) {
    const normalizedRate = normalizeMediaRate(rate);
    try {
      let tabId = activeMediaTabId;
      if (!Number.isInteger(tabId)) {
        const tab = await getActiveTab();
        tabId = tab.id;
        activeMediaTabId = tabId;
      }

      const response = await requestAction(
        MESSAGE_TYPES.SET_MEDIA_TAB_RATE,
        tabId,
        "현재 탭의 재생 속도를 적용하지 못했습니다.",
        { rate: normalizedRate }
      );
      activeMediaAvailable = response.hasMedia === true;
      activeMediaLabel = String(response.label || activeMediaLabel || "");
      updateMediaRateUi(response.rate);
      updateMediaRateControlsEnabled();
      setSettingsStatus(
        `${activeMediaLabel || "현재 선택된 미디어"}의 재생 속도를 ${formatMediaRate(response.rate)}으로 설정했습니다.`,
        "success"
      );
    } catch (error) {
      setSettingsStatus(String(error?.message || "현재 탭의 재생 속도를 적용하지 못했습니다."), "error");
      await loadActiveMediaTabState(false);
    }
  }

  function queueMediaRateSave(rate, immediate = false) {
    pendingMediaRate = normalizeMediaRate(rate);
    if (mediaRateSaveTimer) {
      window.clearTimeout(mediaRateSaveTimer);
      mediaRateSaveTimer = 0;
    }

    if (immediate) {
      void applyMediaRateToActiveTab(pendingMediaRate);
      return;
    }

    mediaRateSaveTimer = window.setTimeout(() => {
      mediaRateSaveTimer = 0;
      void applyMediaRateToActiveTab(pendingMediaRate);
    }, 120);
  }

  function handleMediaRateSliderInput() {
    const rate = normalizeMediaRate(Number(mediaRateSlider.value) / 100);
    updateMediaRateUi(rate);
    queueMediaRateSave(rate);
  }

  function handleMediaRateSliderChange() {
    const rate = normalizeMediaRate(Number(mediaRateSlider.value) / 100);
    updateMediaRateUi(rate);
    queueMediaRateSave(rate, true);
  }

  function handleMediaRateInputChange() {
    const rate = normalizeMediaRate(mediaRateInput.value);
    updateMediaRateUi(rate);
    queueMediaRateSave(rate, true);
  }

  function handleMediaSpeedStepChange() {
    const step = normalizeMediaSpeedStep(mediaSpeedStepInput.value);
    updateMediaSpeedStepUi(step);
    persistMediaValue(
      MEDIA_STORAGE_KEYS.speedStep,
      step,
      `키보드의 속도 변경 간격을 ${step.toFixed(2)}배로 설정했습니다.`
    );
  }

  function handleMediaSeekStepChange() {
    const seconds = normalizeMediaSeekStep(mediaSeekStepInput.value);
    updateMediaSeekStepUi(seconds);
    persistMediaValue(
      MEDIA_STORAGE_KEYS.seekStep,
      seconds,
      `키보드의 앞뒤 이동 간격을 ${seconds}초로 설정했습니다.`
    );
  }

  function handleMediaResetFallbackRateChange() {
    const rate = normalizeMediaResetFallbackRate(mediaResetFallbackRateInput.value);
    updateMediaResetFallbackRateUi(rate);
    persistMediaValue(
      MEDIA_STORAGE_KEYS.resetFallbackRate,
      rate,
      `이전 배속 기록이 없을 때 R 키가 복원할 속도를 ${formatMediaRate(rate)}으로 설정했습니다.`
    );
  }

  function resetMediaRate() {
    updateMediaRateUi(1);
    queueMediaRateSave(1, true);
  }

  function resetMediaOverlayPosition() {
    persistMediaValue(
      MEDIA_STORAGE_KEYS.overlayPosition,
      { ...MEDIA_DEFAULTS[MEDIA_STORAGE_KEYS.overlayPosition] },
      "영상 위 속도 표시창을 가운데 위로 되돌렸습니다."
    );
  }

  function saveMediaShortcut(command, code) {
    const definition = MEDIA_SHORTCUT_DEFINITIONS.find((item) => item.command === command);
    if (!definition) return;

    const normalizedCode = normalizeMediaShortcutCode(code, "");
    if (!normalizedCode) {
      setSettingsStatus("이 키는 미디어 단축키로 사용할 수 없습니다.", "error");
      return;
    }

    const conflict = MEDIA_SHORTCUT_DEFINITIONS.find(
      (item) => item.command !== command && mediaShortcutCodes[item.command] === normalizedCode
    );
    if (conflict) {
      setSettingsStatus(
        `${formatMediaShortcutCode(normalizedCode)} 키는 이미 ${conflict.label} 기능에서 사용 중입니다.`,
        "error"
      );
      return;
    }

    mediaShortcutCodes[command] = normalizedCode;
    setMediaShortcutCapture("");
    persistMediaValue(
      definition.storageKey,
      normalizedCode,
      `${definition.label} 단축키를 ${formatMediaShortcutCode(normalizedCode)} 키로 설정했습니다.`
    );
  }

  function beginMediaShortcutCapture(command) {
    if (!MEDIA_SHORTCUT_DEFINITIONS.some((item) => item.command === command)) return;
    setMediaShortcutCapture(command);
    mediaShortcutButtons.get(command)?.focus();
    setSettingsStatus("새 단축키 입력을 기다리고 있습니다.", "working");
  }

  function handleMediaShortcutCaptureKeydown(event) {
    if (!mediaShortcutCaptureCommand) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (event.code === "Escape") {
      setMediaShortcutCapture("");
      setSettingsStatus("단축키 변경을 취소했습니다.");
      return;
    }

    if (event.ctrlKey || event.altKey || event.metaKey) {
      setSettingsStatus("Ctrl, Alt 또는 Windows 키 조합은 사용할 수 없습니다.", "error");
      return;
    }

    saveMediaShortcut(mediaShortcutCaptureCommand, event.code);
  }

  function resetMediaShortcuts() {
    if (!storageArea || typeof storageArea.set !== "function") {
      setSettingsStatus("단축키 설정을 저장할 수 없습니다.", "error");
      return;
    }

    const values = Object.fromEntries(
      MEDIA_SHORTCUT_DEFINITIONS.map((definition) => [definition.storageKey, definition.defaultCode])
    );
    mediaShortcutCodes = Object.fromEntries(
      MEDIA_SHORTCUT_DEFINITIONS.map((definition) => [definition.command, definition.defaultCode])
    );
    setMediaShortcutCapture("");
    setSettingsStatus("미디어 단축키를 기본값으로 되돌리는 중입니다.", "working");

    try {
      storageArea.set(values, () => {
        if (getRuntimeErrorMessage()) {
          setSettingsStatus("미디어 단축키를 되돌리지 못했습니다.", "error");
          loadSettings();
          return;
        }
        setSettingsStatus("미디어 단축키를 S, D, R, Z, X, V 기본값으로 되돌렸습니다.", "success");
      });
    } catch {
      setSettingsStatus("미디어 단축키를 되돌리지 못했습니다.", "error");
      loadSettings();
    }
  }

  function saveAllPageUnlockSettings(enabled) {
    if (!storageArea || typeof storageArea.set !== "function") {
      setSettingsStatus("설정을 저장할 수 없습니다.", "error");
      loadSettings();
      return;
    }

    const nextValues = {};
    for (const key of PAGE_UNLOCK_SETTING_KEYS) {
      nextValues[key] = enabled;
      controls[key].checked = enabled;
    }

    pageUnlockMasterToggle.indeterminate = false;
    updatePageUnlockSummary();
    setPageUnlockControlsEnabled(false);
    setSettingsStatus(
      enabled ? "열 가지 기능을 모두 켜는 중입니다." : "열 가지 기능을 모두 끄는 중입니다.",
      "working"
    );

    try {
      storageArea.set(nextValues, () => {
        if (getRuntimeErrorMessage()) {
          setSettingsStatus("전체 설정을 저장하지 못했습니다.", "error");
          loadSettings();
          return;
        }

        setPageUnlockControlsEnabled(true);
        setSettingsStatus(
          enabled
            ? "웹페이지 입력 제한 해제 기능 열 가지를 모두 켰습니다."
            : "웹페이지 입력 제한 해제 기능 열 가지를 모두 껐습니다.",
          "success"
        );
      });
    } catch {
      setSettingsStatus("전체 설정을 저장하지 못했습니다.", "error");
      loadSettings();
    }
  }

  function setMediaDropdownOpen(open) {
    mediaDropdown.hidden = !open;
    mediaToggle.setAttribute("aria-expanded", String(open));
    if (!open && mediaShortcutCaptureCommand) setMediaShortcutCapture("");
  }

  function setPageUnlockDropdownOpen(open) {
    pageUnlockDropdown.hidden = !open;
    pageUnlockToggle.setAttribute("aria-expanded", String(open));
  }

  function setTabUrlDropdownOpen(open) {
    tabUrlDropdown.hidden = !open;
    tabUrlToggle.setAttribute("aria-expanded", String(open));
  }

  function setElementEraserDropdownOpen(open) {
    elementEraserDropdown.hidden = !open;
    elementEraserToggle.setAttribute("aria-expanded", String(open));
  }

  function toggleMediaDropdown() {
    const opening = mediaDropdown.hidden;
    if (opening) {
      setPageUnlockDropdownOpen(false);
      setTabUrlDropdownOpen(false);
      setElementEraserDropdownOpen(false);
    }
    setMediaDropdownOpen(opening);
    if (opening) void loadActiveMediaTabState(false);
  }

  function togglePageUnlockDropdown() {
    const opening = pageUnlockDropdown.hidden;
    if (opening) {
      setMediaDropdownOpen(false);
      setTabUrlDropdownOpen(false);
      setElementEraserDropdownOpen(false);
    }
    setPageUnlockDropdownOpen(opening);
  }

  function queryTabs(queryInfo) {
    return new Promise((resolve, reject) => {
      const tabsApi = globalThis.chrome?.tabs;
      if (!tabsApi || typeof tabsApi.query !== "function") {
        reject(new Error("열린 탭 정보를 읽을 수 없습니다."));
        return;
      }

      tabsApi.query(queryInfo, (tabs) => {
        const runtimeError = getRuntimeErrorMessage();
        if (runtimeError) {
          reject(new Error(runtimeError));
          return;
        }

        resolve(Array.isArray(tabs) ? tabs : []);
      });
    });
  }

  async function getActiveTab() {
    const tabs = await queryTabs({ active: true, currentWindow: true });
    const tab = tabs[0];

    if (!tab || !Number.isInteger(tab.id)) {
      throw new Error("현재 탭을 찾을 수 없습니다.");
    }

    return tab;
  }

  function requestAction(type, tabId, fallbackMessage, extra = {}) {
    return new Promise((resolve, reject) => {
      const runtimeApi = globalThis.chrome?.runtime;
      if (!runtimeApi || typeof runtimeApi.sendMessage !== "function") {
        reject(new Error("현재 페이지에서 요청한 기능을 시작할 수 없습니다."));
        return;
      }

      runtimeApi.sendMessage({ type, tabId, ...extra }, (response) => {
        const runtimeError = getRuntimeErrorMessage();
        if (runtimeError) {
          reject(new Error(runtimeError));
          return;
        }

        if (!response || response.ok !== true) {
          reject(new Error(response?.error || fallbackMessage));
          return;
        }

        resolve(response);
      });
    });
  }

  async function handleFullPageClick() {
    if (activeAction) return;

    setActionBusy("full-page");
    setStatus("현재 탭의 전체 페이지를 캡처하고 있습니다.", "working");

    try {
      const tab = await getActiveTab();
      const response = await requestAction(
        MESSAGE_TYPES.CAPTURE_FULL_PAGE,
        tab.id,
        "전체 페이지 화면 캡처에 실패했습니다."
      );
      setStatus(response.message || "전체 페이지를 PNG 파일로 저장했습니다.", "success");
    } catch (error) {
      setStatus(String(error?.message || "전체 페이지 화면 캡처에 실패했습니다."), "error");
    } finally {
      setActionBusy();
    }
  }

  async function handleAreaClick() {
    if (activeAction) return;

    setActionBusy("area");
    setStatus("현재 페이지에 영역 선택 도구를 열고 있습니다.", "working");

    try {
      const tab = await getActiveTab();
      const response = await requestAction(
        MESSAGE_TYPES.START_AREA_SELECTION,
        tab.id,
        "영역 선택 도구를 시작하지 못했습니다."
      );
      setStatus(response.message || "페이지에서 드래그하여 영역을 선택하세요.", "success");
      setActionBusy();
      window.setTimeout(() => window.close(), 80);
    } catch (error) {
      setStatus(String(error?.message || "영역 선택 도구를 시작하지 못했습니다."), "error");
      setActionBusy();
    }
  }


  function updateElementEraserSiteSummary() {
    if (elementEraserStatusLoading) {
      elementEraserSiteSummary.textContent = "현재 사이트의 기억된 요소를 확인하는 중입니다.";
      return;
    }

    if (!elementEraserHostname) {
      elementEraserSiteSummary.textContent = "이 페이지에서는 사이트 기억 기능을 사용할 수 없습니다.";
      return;
    }

    elementEraserSiteSummary.textContent = elementEraserRuleCount > 0
      ? `${elementEraserHostname} · ${elementEraserRuleCount}개 요소를 숨기는 중입니다.`
      : `${elementEraserHostname} · 기억된 요소가 없습니다.`;
  }

  async function loadElementEraserStatus() {
    if (elementEraserStatusLoading || activeAction) return;

    elementEraserStatusLoading = true;
    updateElementEraserSiteSummary();
    updateElementEraserControls();

    try {
      const tab = await getActiveTab();
      const response = await requestAction(
        MESSAGE_TYPES.GET_ELEMENT_ERASER_STATUS,
        tab.id,
        "현재 사이트의 기억된 요소를 확인하지 못했습니다."
      );
      elementEraserRuleCount = Number(response.count) || 0;
      elementEraserHostname = String(response.hostname || "");
    } catch (error) {
      elementEraserRuleCount = 0;
      elementEraserHostname = "";
      setStatus(String(error?.message || "현재 사이트의 정보를 확인하지 못했습니다."), "error");
    } finally {
      elementEraserStatusLoading = false;
      updateElementEraserSiteSummary();
      updateElementEraserControls();
    }
  }

  async function toggleElementEraserDropdown() {
    const opening = elementEraserDropdown.hidden;
    if (opening) {
      setMediaDropdownOpen(false);
      setPageUnlockDropdownOpen(false);
      setTabUrlDropdownOpen(false);
    }
    setElementEraserDropdownOpen(opening);

    if (opening) {
      await loadElementEraserStatus();
    }
  }

  async function startElementEraser(mode) {
    if (activeAction) return;

    const persistent = mode === "persistent";
    setActionBusy(persistent ? "eraser-persistent" : "eraser-temporary");
    setStatus(
      persistent
        ? "현재 페이지에 사이트 기억 요소 숨기기 모드를 열고 있습니다."
        : "현재 페이지에 이번 페이지 요소 숨기기 모드를 열고 있습니다.",
      "working"
    );

    try {
      const tab = await getActiveTab();
      const response = await requestAction(
        MESSAGE_TYPES.START_ELEMENT_ERASER,
        tab.id,
        "요소 숨기기 모드를 시작하지 못했습니다.",
        { mode: persistent ? "persistent" : "temporary" }
      );
      setStatus(response.message || "페이지에서 숨길 요소를 클릭하세요.", "success");
      setActionBusy();
      window.setTimeout(() => window.close(), 80);
    } catch (error) {
      setStatus(String(error?.message || "요소 숨기기 모드를 시작하지 못했습니다."), "error");
      setActionBusy();
    }
  }

  async function clearElementEraserRules() {
    if (activeAction || elementEraserRuleCount === 0) return;

    const confirmed = window.confirm(
      `이 사이트에서 기억한 ${elementEraserRuleCount}개의 요소를 모두 다시 표시하시겠습니까?`
    );
    if (!confirmed) return;

    setActionBusy("eraser-clear");
    setStatus("이 사이트에서 기억한 요소를 복원하고 있습니다.", "working");

    try {
      const tab = await getActiveTab();
      const response = await requestAction(
        MESSAGE_TYPES.CLEAR_ELEMENT_ERASER_RULES,
        tab.id,
        "기억된 요소를 복원하지 못했습니다."
      );
      elementEraserRuleCount = 0;
      elementEraserHostname = String(response.hostname || elementEraserHostname);
      updateElementEraserSiteSummary();
      setStatus(response.message || "이 사이트에서 기억한 요소를 모두 복원했습니다.", "success");
    } catch (error) {
      setStatus(String(error?.message || "기억된 요소를 복원하지 못했습니다."), "error");
    } finally {
      setActionBusy();
    }
  }

  function normalizeTab(tab) {
    const id = Number(tab?.id);
    const url = String(tab?.pendingUrl || tab?.url || "").trim();

    if (!Number.isInteger(id) || id < 0 || !url) {
      return null;
    }

    const title = String(tab?.title || "").trim() || "제목 없는 탭";
    const index = Number.isInteger(tab?.index) ? tab.index : Number.MAX_SAFE_INTEGER;

    return {
      id,
      index,
      title,
      url,
      active: Boolean(tab?.active),
      pinned: Boolean(tab?.pinned)
    };
  }

  function setTabListMessage(message, state = "ready") {
    const paragraph = document.createElement("p");
    paragraph.className = "tab-list-message";
    paragraph.dataset.state = state;
    paragraph.textContent = message;
    tabList.replaceChildren(paragraph);
  }

  function getSelectedTabEntries() {
    return tabEntries.filter((entry) => selectedTabIds.has(entry.id));
  }

  function updateTabSelectionUi() {
    const selectedCount = getSelectedTabEntries().length;
    const allSelected = tabEntries.length > 0 && selectedCount === tabEntries.length;

    tabListSummary.textContent = `현재 창의 탭 ${tabEntries.length}개`;
    selectedTabsCount.textContent = `${selectedCount}개 선택`;
    selectAllTabsButton.disabled = tabListLoading || tabEntries.length === 0 || allSelected;
    clearTabsButton.disabled = tabListLoading || selectedCount === 0;
    refreshTabsButton.disabled = tabListLoading;
    copyTabUrlsButton.disabled = tabListLoading || tabCopying || selectedCount === 0;

    if (!tabCopying && !copyLabelResetTimer) {
      copyTabUrlsLabel.textContent = selectedCount > 0
        ? `${selectedCount}개 URL 복사`
        : "선택한 URL 복사";
    }
  }

  function renderTabList() {
    const availableIds = new Set(tabEntries.map((entry) => entry.id));
    for (const selectedId of [...selectedTabIds]) {
      if (!availableIds.has(selectedId)) {
        selectedTabIds.delete(selectedId);
      }
    }

    if (tabEntries.length === 0) {
      setTabListMessage("현재 창에서 URL을 복사할 수 있는 탭을 찾지 못했습니다.");
      updateTabSelectionUi();
      return;
    }

    const fragment = document.createDocumentFragment();

    for (const entry of tabEntries) {
      const label = document.createElement("label");
      label.className = "tab-option";
      label.dataset.selected = String(selectedTabIds.has(entry.id));
      label.title = `${entry.title}\n${entry.url}`;

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selectedTabIds.has(entry.id);
      checkbox.dataset.tabId = String(entry.id);
      checkbox.setAttribute("aria-label", `${entry.title} 탭 선택`);

      const copy = document.createElement("span");
      copy.className = "tab-option__copy";

      const titleRow = document.createElement("span");
      titleRow.className = "tab-option__title-row";

      const title = document.createElement("span");
      title.className = "tab-option__title";
      title.textContent = entry.pinned ? `고정됨 · ${entry.title}` : entry.title;
      titleRow.appendChild(title);

      if (entry.active) {
        const badge = document.createElement("span");
        badge.className = "tab-option__badge";
        badge.textContent = "현재";
        titleRow.appendChild(badge);
      }

      const url = document.createElement("span");
      url.className = "tab-option__url";
      url.textContent = entry.url;

      copy.append(titleRow, url);
      label.append(checkbox, copy);

      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          selectedTabIds.add(entry.id);
        } else {
          selectedTabIds.delete(entry.id);
        }

        label.dataset.selected = String(checkbox.checked);
        if (copyLabelResetTimer) {
          window.clearTimeout(copyLabelResetTimer);
          copyLabelResetTimer = 0;
        }
        updateTabSelectionUi();
      });

      fragment.appendChild(label);
    }

    tabList.replaceChildren(fragment);
    updateTabSelectionUi();
  }

  async function loadOpenTabs() {
    if (tabListLoading) return;

    tabListLoading = true;
    tabUrlToggle.setAttribute("aria-busy", "true");
    setTabListMessage("현재 창의 탭을 불러오는 중입니다.");
    updateTabSelectionUi();
    setStatus("현재 창의 탭 목록을 불러오는 중입니다.", "working");

    try {
      const tabs = await queryTabs({ currentWindow: true });
      tabEntries = tabs
        .map(normalizeTab)
        .filter(Boolean)
        .sort((first, second) => first.index - second.index);

      renderTabList();
      setStatus(`현재 창에서 ${tabEntries.length}개의 탭을 불러왔습니다.`);
    } catch (error) {
      tabEntries = [];
      selectedTabIds.clear();
      setTabListMessage(
        String(error?.message || "탭 목록을 불러오지 못했습니다."),
        "error"
      );
      setStatus(String(error?.message || "탭 목록을 불러오지 못했습니다."), "error");
    } finally {
      tabListLoading = false;
      tabUrlToggle.setAttribute("aria-busy", "false");
      updateTabSelectionUi();
    }
  }

  async function toggleTabUrlDropdown() {
    const opening = tabUrlDropdown.hidden;
    if (opening) {
      setMediaDropdownOpen(false);
      setPageUnlockDropdownOpen(false);
      setElementEraserDropdownOpen(false);
    }
    setTabUrlDropdownOpen(opening);

    if (opening) {
      await loadOpenTabs();
    }
  }

  function selectAllTabs() {
    for (const entry of tabEntries) {
      selectedTabIds.add(entry.id);
    }
    renderTabList();
  }

  function clearTabSelection() {
    selectedTabIds.clear();
    renderTabList();
  }

  async function writeClipboardText(text) {
    const clipboard = globalThis.navigator?.clipboard;
    let clipboardError = null;

    if (clipboard && typeof clipboard.writeText === "function") {
      try {
        await clipboard.writeText(text);
        return;
      } catch (error) {
        clipboardError = error;
      }
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    let copied = false;
    try {
      copied = typeof document.execCommand === "function" && document.execCommand("copy");
    } finally {
      textarea.remove();
    }

    if (!copied) {
      throw clipboardError || new Error("클립보드에 복사하지 못했습니다.");
    }
  }

  async function copySelectedTabUrls() {
    if (tabCopying) return;

    const selectedEntries = getSelectedTabEntries();
    if (selectedEntries.length === 0) {
      setStatus("복사할 탭을 하나 이상 선택하세요.", "error");
      return;
    }

    const text = selectedEntries.map((entry) => entry.url).join("\r\n");
    tabCopying = true;
    copyTabUrlsButton.setAttribute("aria-busy", "true");
    copyTabUrlsLabel.textContent = "클립보드에 복사하는 중입니다";
    updateTabSelectionUi();

    try {
      await writeClipboardText(text);
      setStatus(`${selectedEntries.length}개의 URL을 클립보드에 복사했습니다.`, "success");
      copyTabUrlsLabel.textContent = "복사했습니다";

      if (copyLabelResetTimer) {
        window.clearTimeout(copyLabelResetTimer);
      }
      copyLabelResetTimer = window.setTimeout(() => {
        copyLabelResetTimer = 0;
        updateTabSelectionUi();
      }, 1200);
    } catch (error) {
      setStatus(String(error?.message || "클립보드에 복사하지 못했습니다."), "error");
    } finally {
      tabCopying = false;
      copyTabUrlsButton.setAttribute("aria-busy", "false");
      updateTabSelectionUi();
    }
  }

  for (const [key, control] of Object.entries(controls)) {
    control.addEventListener("change", () => {
      updatePageUnlockSummary();
      updateMediaSummary();
      saveSetting(key, control.checked);
    });
  }

  pageUnlockMasterToggle.addEventListener("change", () => {
    saveAllPageUnlockSettings(pageUnlockMasterToggle.checked);
  });

  chatWidthSlider.addEventListener("input", handleChatWidthInput);
  chatWidthSlider.addEventListener("change", handleChatWidthChange);
  composerWidthSlider.addEventListener("input", handleComposerWidthInput);
  composerWidthSlider.addEventListener("change", handleComposerWidthChange);
  mediaToggle.addEventListener("click", toggleMediaDropdown);
  mediaRateSlider.addEventListener("input", handleMediaRateSliderInput);
  mediaRateSlider.addEventListener("change", handleMediaRateSliderChange);
  mediaRateInput.addEventListener("change", handleMediaRateInputChange);
  mediaSpeedStepInput.addEventListener("change", handleMediaSpeedStepChange);
  mediaSeekStepInput.addEventListener("change", handleMediaSeekStepChange);
  mediaResetFallbackRateInput.addEventListener("change", handleMediaResetFallbackRateChange);
  mediaRateResetButton.addEventListener("click", resetMediaRate);
  mediaOverlayPositionResetButton.addEventListener("click", resetMediaOverlayPosition);
  mediaShortcutResetButton.addEventListener("click", resetMediaShortcuts);
  for (const [command, button] of mediaShortcutButtons) {
    button.addEventListener("click", () => beginMediaShortcutCapture(command));
  }
  document.addEventListener("keydown", handleMediaShortcutCaptureKeydown, true);
  pageUnlockToggle.addEventListener("click", togglePageUnlockDropdown);
  fullPageButton.addEventListener("click", handleFullPageClick);
  areaButton.addEventListener("click", handleAreaClick);
  elementEraserToggle.addEventListener("click", toggleElementEraserDropdown);
  for (const button of elementEraserModeButtons) {
    button.addEventListener("click", () => startElementEraser(button.dataset.eraserMode));
  }
  clearElementEraserRulesButton.addEventListener("click", clearElementEraserRules);
  tabUrlToggle.addEventListener("click", toggleTabUrlDropdown);
  refreshTabsButton.addEventListener("click", loadOpenTabs);
  selectAllTabsButton.addEventListener("click", selectAllTabs);
  clearTabsButton.addEventListener("click", clearTabSelection);
  copyTabUrlsButton.addEventListener("click", copySelectedTabUrls);

  const runtimeMessages = globalThis.chrome?.runtime?.onMessage;
  if (runtimeMessages && typeof runtimeMessages.addListener === "function") {
    runtimeMessages.addListener((message) => {
      if (message?.type !== MESSAGE_TYPES.MEDIA_TAB_RATE_UPDATED) return false;
      if (Number(message.tabId) !== activeMediaTabId) return false;
      activeMediaAvailable = message.hasMedia === true;
      activeMediaLabel = String(message.label || "");
      updateMediaRateUi(message.rate);
      updateMediaRateControlsEnabled();
      updateMediaSummary();
      return false;
    });
  }

  const storageChanged = globalThis.chrome?.storage?.onChanged;
  if (storageChanged && typeof storageChanged.addListener === "function") {
    storageChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes || typeof changes !== "object") {
        return;
      }

      let controlsChanged = false;
      for (const [key, control] of Object.entries(controls)) {
        if (!Object.prototype.hasOwnProperty.call(changes, key)) {
          continue;
        }

        const newValue = changes[key]?.newValue;
        control.checked = typeof newValue === "boolean"
          ? newValue
          : DEFAULT_SETTINGS[key];
        controlsChanged = true;
      }

      if (Object.prototype.hasOwnProperty.call(changes, CHAT_WIDTH_STORAGE_KEY)) {
        const newWidth = changes[CHAT_WIDTH_STORAGE_KEY]?.newValue;
        updateChatWidthUi(
          typeof newWidth === "number" ? newWidth : CHAT_WIDTH_DEFAULT_PX
        );
      }

      if (Object.prototype.hasOwnProperty.call(changes, COMPOSER_WIDTH_STORAGE_KEY)) {
        const newWidth = changes[COMPOSER_WIDTH_STORAGE_KEY]?.newValue;
        updateComposerWidthUi(
          typeof newWidth === "number" ? newWidth : COMPOSER_WIDTH_DEFAULT_PX
        );
      }

      if (Object.prototype.hasOwnProperty.call(changes, MEDIA_STORAGE_KEYS.speedStep)) {
        updateMediaSpeedStepUi(changes[MEDIA_STORAGE_KEYS.speedStep]?.newValue);
      }

      if (Object.prototype.hasOwnProperty.call(changes, MEDIA_STORAGE_KEYS.seekStep)) {
        updateMediaSeekStepUi(changes[MEDIA_STORAGE_KEYS.seekStep]?.newValue);
      }

      if (Object.prototype.hasOwnProperty.call(changes, MEDIA_STORAGE_KEYS.resetFallbackRate)) {
        updateMediaResetFallbackRateUi(changes[MEDIA_STORAGE_KEYS.resetFallbackRate]?.newValue);
      }

      const shortcutChanges = {};
      let shortcutsChanged = false;
      for (const definition of MEDIA_SHORTCUT_DEFINITIONS) {
        if (!Object.prototype.hasOwnProperty.call(changes, definition.storageKey)) continue;
        shortcutChanges[definition.storageKey] = changes[definition.storageKey]?.newValue;
        shortcutsChanged = true;
      }
      if (shortcutsChanged) {
        updateMediaShortcutUi({
          ...Object.fromEntries(
            MEDIA_SHORTCUT_DEFINITIONS.map((definition) => [
              definition.storageKey,
              mediaShortcutCodes[definition.command]
            ])
          ),
          ...shortcutChanges
        });
      }

      if (controlsChanged) {
        updatePageUnlockSummary();
        updateMediaRateControlsEnabled();
        updateMediaSummary();
      }
    });
  }

  updateElementEraserSiteSummary();
  updateElementEraserControls();
  updateTabSelectionUi();
  loadSettings();
})();
