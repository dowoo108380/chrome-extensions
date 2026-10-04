(() => {
  "use strict";

  type AnyRecord = Record<string, any>;
  type MediaShortcutCommand = ToolboxShared.ShortcutCommand;



  interface BrowserTab {
    id?: number;
    pendingUrl?: string;
    url?: string;
    title?: string;
    index?: number;
    active?: boolean;
    pinned?: boolean;
    autoDiscardable?: boolean;
    discarded?: boolean;
    frozen?: boolean;
    status?: string;
  }

  interface TabEntry {
    id: number;
    index: number;
    title: string;
    url: string;
    origin: string | null;
    active: boolean;
    pinned: boolean;
    keepActiveEligible: boolean;
    keepActiveManaged: boolean;
    keepActiveDesired: boolean;
    keepActiveApplied: boolean;
    keepActivePending: boolean;
    keepActiveError: string;
  }

  interface SiteDataTarget {
    tabId: number;
    origin: string;
  }

  interface MediaTabResponse extends AnyRecord {
    ok: true;
    hasMedia?: boolean;
    rate?: number;
    label?: string;
  }



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

  const MEDIA_STORAGE_KEYS = ToolboxShared.MEDIA_KEYS;
  const MEDIA_SHORTCUT_DEFINITIONS = ToolboxShared.SHORTCUTS;
  const MEDIA_RATE_MIN = 0.07;
  const MEDIA_RATE_MAX = 16;
  const MEDIA_SPEED_STEP_MIN = 0.01;
  const MEDIA_SPEED_STEP_MAX = 2;
  const MEDIA_SEEK_STEP_MIN = 1;
  const MEDIA_SEEK_STEP_MAX = 600;
  const MEDIA_DEFAULTS = Object.freeze({
    ...ToolboxShared.SHORTCUT_DEFAULTS,
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

  const DEFAULT_SETTINGS: Readonly<Record<string, boolean>> = Object.freeze({
    youtubeAbLoopKeyboardEnabled: true,
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
    backNavigationProtectionEnabled: false
  });

  const PAGE_UNLOCK_SETTING_KEYS = Object.freeze([
    "rightClickEnabled",
    "textSelectionEnabled",
    "copyUnlockEnabled",
    "clipboardProtectionEnabled",
    "imageDragEnabled",
    "middleClickEnabled",
    "backNavigationProtectionEnabled"
  ]);

  const MESSAGE_TYPES = Object.freeze({
    CAPTURE_FULL_PAGE: "capture-full-page",
    START_AREA_SELECTION: "start-area-selection",
    START_ELEMENT_ERASER: "page-element-eraser:start",
    GET_ELEMENT_ERASER_STATUS: "page-element-eraser:get-site-status",
    CLEAR_ELEMENT_ERASER_RULES: "page-element-eraser:clear-site-rules",
    GET_MEDIA_TAB_STATE: "media-controller:get-tab-state",
    SET_MEDIA_TAB_RATE: "media-controller:set-tab-rate",
    MEDIA_TAB_RATE_UPDATED: "media-controller:tab-rate-updated",
    CLEAR_SELECTED_SITE_DATA: "tab-tools:clear-site-data",
    GET_TAB_KEEP_ACTIVE_STATE: "tab-tools:get-keep-active-state",
    SET_SELECTED_TAB_KEEP_ACTIVE: "tab-tools:set-selected-keep-active",
    SET_ALL_TAB_KEEP_ACTIVE: "tab-tools:set-all-keep-active"
  });

  const controls: Record<string, HTMLInputElement> = {
    youtubeAbLoopKeyboardEnabled: document.getElementById("youtube-ab-keyboard-toggle") as HTMLInputElement,
    composerCtrlEnterEnabled: document.getElementById("composer-toggle") as HTMLInputElement,
    messageEditCtrlEnterEnabled: document.getElementById("message-edit-toggle") as HTMLInputElement,
    mediaControllerEnabled: document.getElementById("media-controller-toggle") as HTMLInputElement,
    mediaKeepRateForNewMedia: document.getElementById("media-keep-rate-toggle") as HTMLInputElement,
    mediaOverlayEnabled: document.getElementById("media-overlay-toggle") as HTMLInputElement,
    mediaKeyboardEnabled: document.getElementById("media-keyboard-toggle") as HTMLInputElement,
    rightClickEnabled: document.getElementById("right-click-toggle") as HTMLInputElement,
    textSelectionEnabled: document.getElementById("text-selection-toggle") as HTMLInputElement,
    copyUnlockEnabled: document.getElementById("copy-unlock-toggle") as HTMLInputElement,
    clipboardProtectionEnabled: document.getElementById("clipboard-protection-toggle") as HTMLInputElement,
    imageDragEnabled: document.getElementById("image-drag-toggle") as HTMLInputElement,
    middleClickEnabled: document.getElementById("middle-click-toggle") as HTMLInputElement,
    backNavigationProtectionEnabled: document.getElementById("back-navigation-toggle") as HTMLInputElement
  };

  const pageUnlockToggle = document.getElementById("page-unlock-toggle") as HTMLButtonElement;
  const pageUnlockDropdown = document.getElementById("page-unlock-dropdown") as HTMLElement;
  const pageUnlockSummary = document.getElementById("page-unlock-summary") as HTMLElement;
  const pageUnlockMasterToggle = document.getElementById("page-unlock-master-toggle") as HTMLInputElement;
  const chatWidthSlider = document.getElementById("chat-width-slider") as HTMLInputElement;
  const chatWidthValue = document.getElementById("chat-width-value") as HTMLElement;
  const composerWidthSlider = document.getElementById("composer-width-slider") as HTMLInputElement;
  const composerWidthValue = document.getElementById("composer-width-value") as HTMLElement;
  const mediaToggle = document.getElementById("media-toggle") as HTMLButtonElement;
  const mediaDropdown = document.getElementById("media-dropdown") as HTMLElement;
  const mediaSummary = document.getElementById("media-summary") as HTMLElement;
  const mediaRateSlider = document.getElementById("media-rate-slider") as HTMLInputElement;
  const mediaRateInput = document.getElementById("media-rate-input") as HTMLInputElement;
  const mediaSpeedStepInput = document.getElementById("media-speed-step-input") as HTMLInputElement;
  const mediaSeekStepInput = document.getElementById("media-seek-step-input") as HTMLInputElement;
  const mediaResetFallbackRateInput = document.getElementById("media-reset-fallback-rate-input") as HTMLInputElement;
  const mediaRateResetButton = document.getElementById("media-rate-reset") as HTMLButtonElement;
  const mediaOverlayPositionResetButton = document.getElementById("media-overlay-position-reset") as HTMLButtonElement;
  const mediaShortcutResetButton = document.getElementById("media-shortcut-reset") as HTMLButtonElement;
  const mediaShortcutHint = document.getElementById("media-shortcut-hint") as HTMLElement;
  const mediaShortcutButtons = new Map<MediaShortcutCommand, HTMLButtonElement>(
    Array.from(document.querySelectorAll<HTMLButtonElement>("[data-media-shortcut-command]")).map((button) => [
      button.dataset.mediaShortcutCommand,
      button
    ] as [MediaShortcutCommand, HTMLButtonElement])
  );
  const fullPageButton = document.getElementById("full-page-button") as HTMLButtonElement;
  const fullPageButtonLabel = document.getElementById("full-page-button-label") as HTMLElement;
  const areaButton = document.getElementById("area-button") as HTMLButtonElement;
  const areaButtonLabel = document.getElementById("area-button-label") as HTMLElement;
  const fileToImageButton = document.getElementById("file-to-image-button") as HTMLButtonElement;
  const fileToImageButtonLabel = document.getElementById("file-to-image-button-label") as HTMLElement;
  const elementEraserToggle = document.getElementById("element-eraser-toggle") as HTMLButtonElement;
  const elementEraserDropdown = document.getElementById("element-eraser-dropdown") as HTMLElement;
  const elementEraserModeButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-eraser-mode]")
  );
  const elementEraserSiteSummary = document.getElementById("element-eraser-site-summary") as HTMLElement;
  const clearElementEraserRulesButton = document.getElementById("clear-element-eraser-rules") as HTMLButtonElement;
  const tabUrlToggle = document.getElementById("tab-url-toggle") as HTMLButtonElement;
  const tabUrlDropdown = document.getElementById("tab-url-dropdown") as HTMLElement;
  const tabList = document.getElementById("tab-list") as HTMLElement;
  const tabListSummary = document.getElementById("tab-list-summary") as HTMLElement;
  const refreshTabsButton = document.getElementById("refresh-tabs-button") as HTMLButtonElement;
  const selectAllTabsButton = document.getElementById("select-all-tabs-button") as HTMLButtonElement;
  const clearTabsButton = document.getElementById("clear-tabs-button") as HTMLButtonElement;
  const selectedTabsCount = document.getElementById("selected-tabs-count") as HTMLElement;
  const copyTabUrlsButton = document.getElementById("copy-tab-urls-button") as HTMLButtonElement;
  const copyTabUrlsLabel = document.getElementById("copy-tab-urls-label") as HTMLElement;
  const clearSiteDataButton = document.getElementById("clear-site-data-button") as HTMLButtonElement;
  const clearSiteDataLabel = document.getElementById("clear-site-data-label") as HTMLElement;
  const tabKeepActiveGlobalToggle = document.getElementById("tab-keep-active-global-toggle") as HTMLInputElement;
  const tabKeepActiveGlobalSummary = document.getElementById("tab-keep-active-global-summary") as HTMLElement;
  const enableSelectedTabKeepActiveButton = document.getElementById("enable-selected-tab-keep-active") as HTMLButtonElement;
  const enableSelectedTabKeepActiveLabel = document.getElementById("enable-selected-tab-keep-active-label") as HTMLElement;
  const disableSelectedTabKeepActiveButton = document.getElementById("disable-selected-tab-keep-active") as HTMLButtonElement;
  const disableSelectedTabKeepActiveLabel = document.getElementById("disable-selected-tab-keep-active-label") as HTMLElement;
  const status = document.getElementById("status") as HTMLElement;
  const storageArea = globalThis.chrome?.storage?.local;
  const settingsJournal = new ToolboxShared.SettingsReadJournal([
    ...Object.keys(DEFAULT_SETTINGS), ...Object.values(MEDIA_STORAGE_KEYS),
    ...ToolboxShared.SHORTCUTS.map(item => item.storageKey),
    CHAT_WIDTH_STORAGE_KEY, COMPOSER_WIDTH_STORAGE_KEY
  ]);
  let settingsReadGeneration = 0;

  let activeAction = "";
  let tabListLoading = false;
  let tabCopying = false;
  let tabSiteDataClearing = false;
  let tabKeepActiveBusy = false;
  let tabKeepActiveGlobalEnabled = false;
  let tabKeepActiveStateAvailable = false;
  let tabEntries: TabEntry[] = [];
  let copyLabelResetTimer = 0;
  const chatWidthSetting = createWidthSetting(CHAT_WIDTH_STORAGE_KEY, "대화", normalizeChatWidthPx, updateChatWidthUi);
  const composerWidthSetting = createWidthSetting(COMPOSER_WIDTH_STORAGE_KEY, "입력란", normalizeComposerWidthPx, updateComposerWidthUi);
  let mediaRateSaveTimer = 0;
  let pendingMediaRate = 1;
  let activeMediaTabId: number | null = null;
  let activeMediaAvailable = false;
  let activeMediaLabel = "";
  let mediaTabStateLoading = false;
  let settingsControlsReady = false;
  let mediaShortcutCodes: Record<MediaShortcutCommand, string> = Object.fromEntries(
    MEDIA_SHORTCUT_DEFINITIONS.map((definition) => [definition.command, definition.defaultCode])
  ) as Record<MediaShortcutCommand, string>;
  let mediaShortcutCaptureCommand: MediaShortcutCommand | "" = "";
  let elementEraserStatusLoading = false;
  let elementEraserRuleCount = 0;
  let elementEraserHostname = "";
  const selectedTabIds = new Set<number>();

  function setStatus(message: string|null, state = "ready") {
    status.textContent = message;
    status.dataset.state = state;
  }

  function setSettingsStatus(message: string, state = "ready") {
    if (!activeAction && !tabListLoading && !tabCopying && !tabSiteDataClearing && !tabKeepActiveBusy) {
      setStatus(message, state);
    }
  }

  function setPageUnlockControlsEnabled(enabled: boolean) {
    pageUnlockMasterToggle.disabled = !enabled;
    for (const key of PAGE_UNLOCK_SETTING_KEYS) {
      controls[key].disabled = !enabled;
    }
  }

  function setControlsEnabled(enabled: boolean) {
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

  function normalizeWidthPx(value: unknown, fallbackPx: number) {
    const numericValue = ToolboxShared.numericSetting(value);
    if (numericValue === 0) {
      return 0;
    }

    if (!Number.isFinite(numericValue)) {
      return fallbackPx;
    }

    const steppedValue = Math.round(numericValue / CHAT_WIDTH_STEP_PX) * CHAT_WIDTH_STEP_PX;
    return Math.min(CHAT_WIDTH_MAX_PX, Math.max(CHAT_WIDTH_MIN_PX, steppedValue));
  }

  function normalizeChatWidthPx(value: unknown) {
    return normalizeWidthPx(value, CHAT_WIDTH_DEFAULT_PX);
  }

  function normalizeComposerWidthPx(value: unknown) {
    return normalizeWidthPx(value, COMPOSER_WIDTH_DEFAULT_PX);
  }

  function widthToSliderValue(widthPx: number) {
    if (widthPx === 0) {
      return 0;
    }

    return 1 + Math.round((widthPx - CHAT_WIDTH_MIN_PX) / CHAT_WIDTH_STEP_PX);
  }

  function sliderValueToWidth(value: string) {
    const sliderValue = Math.min(
      CHAT_WIDTH_SLIDER_MAX,
      Math.max(0, Math.round(Number(value) || 0))
    );

    if (sliderValue === 0) {
      return 0;
    }

    return CHAT_WIDTH_MIN_PX + (sliderValue - 1) * CHAT_WIDTH_STEP_PX;
  }

  function formatChatWidth(widthPx: number) {
    return widthPx === 0
      ? "ChatGPT 기본 너비"
      : `${widthPx.toLocaleString("ko-KR")}픽셀`;
  }

  function updateChatWidthUi(widthPx: unknown) {
    const normalizedWidth = normalizeChatWidthPx(widthPx);
    chatWidthSlider.max = String(CHAT_WIDTH_SLIDER_MAX);
    chatWidthSlider.value = String(widthToSliderValue(normalizedWidth));
    chatWidthValue.textContent = formatChatWidth(normalizedWidth);
    chatWidthSlider.setAttribute("aria-valuetext", formatChatWidth(normalizedWidth));
  }

  function updateComposerWidthUi(widthPx: unknown) {
    const normalizedWidth = normalizeComposerWidthPx(widthPx);
    composerWidthSlider.max = String(CHAT_WIDTH_SLIDER_MAX);
    composerWidthSlider.value = String(widthToSliderValue(normalizedWidth));
    composerWidthValue.textContent = formatChatWidth(normalizedWidth);
    composerWidthSlider.setAttribute("aria-valuetext", formatChatWidth(normalizedWidth));
  }

  function clampNumber(value: number, minimum: number, maximum: number) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function normalizeMediaNumber(value: unknown, fallback: number, minimum: number, maximum: number, decimals = 2) {
    const numericValue = ToolboxShared.numericSetting(value);
    if (!Number.isFinite(numericValue)) return fallback;
    const factor = 10 ** decimals;
    return clampNumber(
      Math.round(numericValue * factor) / factor,
      minimum,
      maximum
    );
  }

  function normalizeMediaRate(value: unknown) {
    return normalizeMediaNumber(
      value,
      1,
      MEDIA_RATE_MIN,
      MEDIA_RATE_MAX,
      2
    );
  }

  function normalizeMediaSpeedStep(value: unknown) {
    return normalizeMediaNumber(
      value,
      MEDIA_DEFAULTS[MEDIA_STORAGE_KEYS.speedStep],
      MEDIA_SPEED_STEP_MIN,
      MEDIA_SPEED_STEP_MAX,
      2
    );
  }

  function normalizeMediaResetFallbackRate(value: unknown) {
    return normalizeMediaNumber(
      value,
      MEDIA_DEFAULTS[MEDIA_STORAGE_KEYS.resetFallbackRate],
      MEDIA_RATE_MIN,
      MEDIA_RATE_MAX,
      2
    );
  }

  function normalizeMediaSeekStep(value: unknown) {
    const numericValue = ToolboxShared.numericSetting(value);
    if (!Number.isFinite(numericValue)) {
      return MEDIA_DEFAULTS[MEDIA_STORAGE_KEYS.seekStep];
    }
    return clampNumber(
      Math.round(numericValue),
      MEDIA_SEEK_STEP_MIN,
      MEDIA_SEEK_STEP_MAX
    );
  }


  const normalizeMediaShortcutCode = ToolboxShared.normalizeShortcutCode;

  function formatMediaShortcutCode(code: string) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^Numpad[0-9]$/.test(code)) return `숫자 ${code.slice(6)}`;

    const labels: Record<string, string> = {
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

  function updateMediaShortcutUi(values: Record<string, unknown> = {}) {
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

  function showShortcutConflicts(): void {
    if (mediaShortcutCaptureCommand) return;
    const values: Record<string, unknown> = Object.fromEntries(MEDIA_SHORTCUT_DEFINITIONS.map(d => [d.storageKey, mediaShortcutCodes[d.command]]));
    values[ToolboxShared.AB_ENABLED_KEY] = controls.youtubeAbLoopKeyboardEnabled.checked;
    const conflicts = ToolboxShared.shortcutConflicts(values);
    mediaShortcutHint.textContent = conflicts.length
      ? `중복 단축키는 유튜브에서 실행되지 않습니다. 변경해 주세요: ${conflicts.join("; ")}`
      : "키 버튼을 누른 뒤 새 단축키를 입력합니다. 미디어와 A/B 반복의 중복 키는 저장할 수 없습니다. Esc 키로 취소합니다.";
    mediaShortcutHint.dataset.error = String(conflicts.length > 0);
  }

  function setMediaShortcutCapture(command: MediaShortcutCommand | "" = "") {
    mediaShortcutCaptureCommand = command;
    updateMediaShortcutUi(mediaShortcutCodes);

    if (!mediaShortcutHint) return;
    if (!command) {
      showShortcutConflicts();
      return;
    }

    const definition = MEDIA_SHORTCUT_DEFINITIONS.find((item) => item.command === command);
    mediaShortcutHint.textContent = `${definition?.label || "선택한 기능"}에 사용할 키를 누르세요.`;
  }

  function formatMediaRate(rate: number|undefined) {
    return `${normalizeMediaRate(rate).toFixed(2)}배속`;
  }

  function updateMediaRateUi(rate: number|undefined) {
    const normalizedRate = normalizeMediaRate(rate);
    pendingMediaRate = normalizedRate;
    mediaRateSlider.value = String(Math.round(normalizedRate * 100));
    mediaRateSlider.setAttribute("aria-valuetext", formatMediaRate(normalizedRate));
    mediaRateInput.value = normalizedRate.toFixed(2);
    updateMediaSummary();
  }

  function updateMediaSpeedStepUi(step: unknown) {
    mediaSpeedStepInput.value = normalizeMediaSpeedStep(step).toFixed(2);
  }

  function updateMediaSeekStepUi(seconds: unknown) {
    mediaSeekStepInput.value = String(normalizeMediaSeekStep(seconds));
  }

  function updateMediaResetFallbackRateUi(rate: unknown) {
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
    fileToImageButton.disabled = busy;
    fullPageButton.setAttribute("aria-busy", String(action === "full-page"));
    areaButton.setAttribute("aria-busy", String(action === "area"));
    fileToImageButton.setAttribute("aria-busy", String(action === "file-to-image"));

    fullPageButtonLabel.textContent = action === "full-page"
      ? "전체 페이지를 캡처하는 중입니다"
      : "현재 페이지 전체 캡처";

    areaButtonLabel.textContent = action === "area"
      ? "영역 선택 도구를 여는 중입니다"
      : "드래그하여 영역 캡처";

    fileToImageButtonLabel.textContent = action === "file-to-image"
      ? "파일 포함 이미지 도구를 여는 중입니다"
      : "파일 포함 이미지 만들기";

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

  function resolveStoredSetting(stored: Record<string, unknown>, key: string) {
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

  function applySettings(values: Record<string, unknown>) {
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
    chatWidthSetting.applyStored(storedChatWidth);
    composerWidthSetting.applyStored(storedComposerWidth);

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
    showShortcutConflicts();

    updatePageUnlockSummary();
    updateMediaSummary();
  }

  function persistLegacyCopySetting(stored: Record<string,unknown>) {
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

  function loadSettings({ preserveStatus = false }: { preserveStatus?: boolean } = {}) {
    const generation = ++settingsReadGeneration;
    const revision = settingsJournal.mark();
    if (!storageArea || typeof storageArea.get !== "function") {
      applySettings(DEFAULT_SETTINGS);
      setControlsEnabled(false);
      if (!preserveStatus) setSettingsStatus("Chrome 저장소를 사용할 수 없습니다.", "error");
      return;
    }

    try {
      storageArea.get(null, (storedSettings) => {
        if (generation !== settingsReadGeneration) return;
        if (getRuntimeErrorMessage()) {
          applySettings(settingsJournal.merge(DEFAULT_SETTINGS, revision));
          setControlsEnabled(false);
          if (!preserveStatus) setSettingsStatus("설정을 불러오지 못했습니다.", "error");
          return;
        }

        const currentSettings = settingsJournal.merge(storedSettings, revision);
        applySettings(currentSettings);
        persistLegacyCopySetting(currentSettings);
        setControlsEnabled(true);
        if (!preserveStatus) {
          setSettingsStatus("설정을 불러왔습니다. ChatGPT 너비와 공통 미디어 설정은 열려 있는 페이지에 즉시 적용됩니다.");
        }
        void loadActiveMediaTabState(false);
        document.documentElement.dataset.popupControlsReady = "true";
        document.dispatchEvent(new Event("browser-toolbox-popup-ready"));
      });
    } catch {
      applySettings(DEFAULT_SETTINGS);
      setControlsEnabled(false);
      if (!preserveStatus) setSettingsStatus("설정을 불러오지 못했습니다.", "error");
    }
  }

  function reloadSettingsAfterSaveFailure(message: string) {
    setSettingsStatus(message, "error");
    loadSettings({ preserveStatus: true });
  }

  function saveSetting(key: string, value: boolean) {
    if (!storageArea || typeof storageArea.set !== "function") {
      setSettingsStatus("설정을 저장할 수 없습니다.", "error");
      return;
    }

    setSettingsStatus("설정을 저장하는 중입니다.", "working");

    try {
      storageArea.set({ [key]: value }, () => {
        if (getRuntimeErrorMessage()) {
          reloadSettingsAfterSaveFailure("설정을 저장하지 못했습니다.");
          return;
        }

        setSettingsStatus("설정이 저장되어 즉시 적용되었습니다.", "success");
      });
    } catch {
      reloadSettingsAfterSaveFailure("설정을 저장하지 못했습니다.");
    }
  }

  function createWidthSetting(
    storageKey: string,
    name: "대화" | "입력란",
    normalize: (value: unknown) => number,
    updateUi: (value: unknown) => void
  ) {
    let revision = 0;
    let completedRevision = 0;
    let timer = 0;
    let saveQueue: Promise<void> = Promise.resolve();

    return {
      applyStored(widthPx: unknown) {
        // Storage notifications and recovery reads must not replace a local edit.
        if (completedRevision === revision) updateUi(widthPx);
      },
      save(widthPx: number, immediate = false) {
        const requestedWidth = normalize(widthPx);
        const requestedRevision = ++revision;
        if (timer) window.clearTimeout(timer);
        timer = 0;

        const persist = () => {
          timer = 0;
          // Serialize writes and skip superseded requests before touching storage.
          saveQueue = saveQueue.then(async () => {
            if (requestedRevision !== revision) return;
            setSettingsStatus(`ChatGPT ${name} 너비를 적용하는 중입니다.`, "working");
            const errorMessage = await new Promise<string>((resolve) => {
              if (!storageArea || typeof storageArea.set !== "function") {
                resolve(`${name} 너비를 저장할 수 없습니다.`);
                return;
              }
              try {
                storageArea.set({ [storageKey]: requestedWidth }, () => {
                  resolve(getRuntimeErrorMessage() ? `${name} 너비를 저장하지 못했습니다.` : "");
                });
              } catch {
                resolve(`${name} 너비를 저장하지 못했습니다.`);
              }
            });
            if (requestedRevision !== revision) return;
            completedRevision = requestedRevision;
            if (errorMessage) {
              reloadSettingsAfterSaveFailure(errorMessage);
              return;
            }
            setSettingsStatus(
              requestedWidth === 0
                ? `ChatGPT의 기본 ${name} 너비로 되돌렸습니다.`
                : `ChatGPT ${name} 너비를 ${formatChatWidth(requestedWidth)}로 설정했습니다.`,
              "success"
            );
          });
        };
        if (immediate) persist();
        else timer = window.setTimeout(persist, 120);
      }
    };
  }

  function handleChatWidthInput() {
    const widthPx = sliderValueToWidth(chatWidthSlider.value);
    updateChatWidthUi(widthPx);
    chatWidthSetting.save(widthPx);
  }

  function handleChatWidthChange() {
    const widthPx = sliderValueToWidth(chatWidthSlider.value);
    updateChatWidthUi(widthPx);
    chatWidthSetting.save(widthPx, true);
  }

  function handleComposerWidthInput() {
    const widthPx = sliderValueToWidth(composerWidthSlider.value);
    updateComposerWidthUi(widthPx);
    composerWidthSetting.save(widthPx);
  }

  function handleComposerWidthChange() {
    const widthPx = sliderValueToWidth(composerWidthSlider.value);
    updateComposerWidthUi(widthPx);
    composerWidthSetting.save(widthPx, true);
  }

  function persistMediaValue(key: string, value: unknown, successMessage: string) {
    if (!storageArea || typeof storageArea.set !== "function") {
      setSettingsStatus("미디어 설정을 저장할 수 없습니다.", "error");
      return;
    }

    setSettingsStatus("미디어 설정을 적용하는 중입니다.", "working");
    try {
      storageArea.set({ [key]: value }, () => {
        if (getRuntimeErrorMessage()) {
          reloadSettingsAfterSaveFailure("미디어 설정을 저장하지 못했습니다.");
          return;
        }
        setSettingsStatus(successMessage, "success");
      });
    } catch {
      reloadSettingsAfterSaveFailure("미디어 설정을 저장하지 못했습니다.");
    }
  }

  async function loadActiveMediaTabState(showStatus = false) {
    if (mediaTabStateLoading) return;
    mediaTabStateLoading = true;
    const readRevision = pendingRateRevision;
    updateMediaRateControlsEnabled();

    try {
      const tab = await getActiveTab();
      const response = await requestAction<MediaTabResponse>(
        MESSAGE_TYPES.GET_MEDIA_TAB_STATE,
        tab.id,
        "현재 탭의 미디어 상태를 확인하지 못했습니다."
      );
      if (readRevision !== pendingRateRevision || completedRateRevision !== pendingRateRevision) return;
      activeMediaTabId = tab.id;
      activeMediaAvailable = response.hasMedia === true;
      activeMediaLabel = String(response.label || "");
      if (readRevision === pendingRateRevision && completedRateRevision === pendingRateRevision) updateMediaRateUi(response.rate);
      if (showStatus) {
        setSettingsStatus(
          activeMediaAvailable
            ? `${activeMediaLabel || "현재 선택된 미디어"}의 재생 속도는 ${formatMediaRate(response.rate)}입니다.`
            : "현재 탭에서 조절할 동영상이나 오디오를 찾지 못했습니다. 미디어를 재생하거나 마우스를 올려 보세요.",
          activeMediaAvailable ? "success" : "ready"
        );
      }
    } catch (error) {
      if (readRevision !== pendingRateRevision || completedRateRevision !== pendingRateRevision) return;
      activeMediaTabId = null;
      activeMediaAvailable = false;
      activeMediaLabel = "";
      updateMediaRateUi(1);
      if (showStatus) {
        setSettingsStatus(String((error as AnyRecord)?.message || "현재 탭의 미디어 상태를 확인하지 못했습니다."), "error");
      }
    } finally {
      mediaTabStateLoading = false;
      updateMediaRateControlsEnabled();
      updateMediaSummary();
    }
  }


  let mediaApplyQueue: Promise<void> = Promise.resolve();
  let pendingRateRevision = 0;
  let completedRateRevision = 0;
  function applyMediaRateToActiveTab(rate: number, revision = ++pendingRateRevision): Promise<void> {
    const task = mediaApplyQueue.then(() => revision === pendingRateRevision ? performMediaRateApply(rate, revision) : undefined);
    mediaApplyQueue = task.catch(() => {});
    return task;
  }
  async function performMediaRateApply(rate: number, revision: number) {
    const normalizedRate = normalizeMediaRate(rate);
    try {
      let tabId = activeMediaTabId;
      if (typeof tabId !== "number" || !Number.isInteger(tabId)) {
        const tab = await getActiveTab();
        tabId = tab.id;
        activeMediaTabId = tabId;
      }

      if (revision !== pendingRateRevision) return;
      const response = await requestAction<MediaTabResponse>(
        MESSAGE_TYPES.SET_MEDIA_TAB_RATE,
        tabId,
        "현재 탭의 재생 속도를 적용하지 못했습니다.",
        { rate: normalizedRate }
      );
      if (revision !== pendingRateRevision) return;
      completedRateRevision = revision;
      activeMediaAvailable = response.hasMedia === true;
      activeMediaLabel = String(response.label || activeMediaLabel || "");
      updateMediaRateUi(response.rate);
      updateMediaRateControlsEnabled();
      setSettingsStatus(
        `${activeMediaLabel || "현재 선택된 미디어"}의 재생 속도를 ${formatMediaRate(response.rate)}으로 설정했습니다.`,
        "success"
      );
    } catch (error) {
      if (revision !== pendingRateRevision) return;
      completedRateRevision = revision;
      setSettingsStatus(String((error as AnyRecord)?.message || "현재 탭의 재생 속도를 적용하지 못했습니다."), "error");
      await loadActiveMediaTabState(false);
    }
  }

  function queueMediaRateSave(rate: number, immediate = false) {
    const revision = ++pendingRateRevision;
    const requestedRate = normalizeMediaRate(rate);
    pendingMediaRate = requestedRate;
    if (mediaRateSaveTimer) {
      window.clearTimeout(mediaRateSaveTimer);
      mediaRateSaveTimer = 0;
    }

    if (immediate) {
      void applyMediaRateToActiveTab(requestedRate, revision);
      return;
    }

    mediaRateSaveTimer = window.setTimeout(() => {
      mediaRateSaveTimer = 0;
      void applyMediaRateToActiveTab(requestedRate, revision);
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

  function saveMediaShortcut(command: MediaShortcutCommand, code: unknown) {
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

  function beginMediaShortcutCapture(command: MediaShortcutCommand) {
    if (!MEDIA_SHORTCUT_DEFINITIONS.some((item) => item.command === command)) return;
    setMediaShortcutCapture(command);
    mediaShortcutButtons.get(command)?.focus();
    setSettingsStatus("새 단축키 입력을 기다리고 있습니다.", "working");
  }

  function handleMediaShortcutCaptureKeydown(event: KeyboardEvent) {
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
    ) as Record<MediaShortcutCommand, string>;
    setMediaShortcutCapture("");
    setSettingsStatus("미디어 단축키를 기본값으로 되돌리는 중입니다.", "working");

    try {
      storageArea.set(values, () => {
        if (getRuntimeErrorMessage()) {
          reloadSettingsAfterSaveFailure("미디어 단축키를 되돌리지 못했습니다.");
          return;
        }
        setSettingsStatus("미디어 및 A/B 단축키를 S, D, R, Z, X, V, A, B 기본값으로 되돌렸습니다.", "success");
      });
    } catch {
      reloadSettingsAfterSaveFailure("미디어 단축키를 되돌리지 못했습니다.");
    }
  }

  function saveAllPageUnlockSettings(enabled: boolean) {
    if (!storageArea || typeof storageArea.set !== "function") {
      reloadSettingsAfterSaveFailure("설정을 저장할 수 없습니다.");
      return;
    }

    const nextValues: Record<string, boolean> = {};
    for (const key of PAGE_UNLOCK_SETTING_KEYS) {
      nextValues[key] = enabled;
      controls[key].checked = enabled;
    }

    pageUnlockMasterToggle.indeterminate = false;
    updatePageUnlockSummary();
    setPageUnlockControlsEnabled(false);
    const totalCount = PAGE_UNLOCK_SETTING_KEYS.length;
    setSettingsStatus(
      enabled ? `${totalCount}개 기능을 모두 켜는 중입니다.` : `${totalCount}개 기능을 모두 끄는 중입니다.`,
      "working"
    );

    try {
      storageArea.set(nextValues, () => {
        if (getRuntimeErrorMessage()) {
          reloadSettingsAfterSaveFailure("전체 설정을 저장하지 못했습니다.");
          return;
        }

        setPageUnlockControlsEnabled(true);
        setSettingsStatus(
          enabled
            ? `웹페이지 입력 제한 해제 기능 ${totalCount}개를 모두 켰습니다.`
            : `웹페이지 입력 제한 해제 기능 ${totalCount}개를 모두 껐습니다.`,
          "success"
        );
      });
    } catch {
      reloadSettingsAfterSaveFailure("전체 설정을 저장하지 못했습니다.");
    }
  }

  function setMediaDropdownOpen(open: boolean) {
    mediaDropdown.hidden = !open;
    mediaToggle.setAttribute("aria-expanded", String(open));
    if (!open && mediaShortcutCaptureCommand) setMediaShortcutCapture("");
  }

  function setPageUnlockDropdownOpen(open: boolean) {
    pageUnlockDropdown.hidden = !open;
    pageUnlockToggle.setAttribute("aria-expanded", String(open));
  }

  function setTabUrlDropdownOpen(open: boolean) {
    tabUrlDropdown.hidden = !open;
    tabUrlToggle.setAttribute("aria-expanded", String(open));
  }

  function setElementEraserDropdownOpen(open: boolean) {
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

  function queryTabs(queryInfo: AnyRecord): Promise<BrowserTab[]> {
    return new Promise<BrowserTab[]>((resolve, reject) => {
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

  async function getActiveTab(): Promise<BrowserTab & { id: number }> {
    const tabs = await queryTabs({ active: true, currentWindow: true });
    const tab = tabs[0];

    if (!tab || typeof tab.id !== "number" || !Number.isInteger(tab.id)) {
      throw new Error("현재 탭을 찾을 수 없습니다.");
    }

    return { ...tab, id: tab.id };
  }

  function requestAction<T extends AnyRecord = AnyRecord>(
    type: string,
    tabId: number,
    fallbackMessage: string,
    extra: AnyRecord = {}
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
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

        resolve(response as T);
      });
    });
  }

  function requestExtensionAction<T extends AnyRecord = AnyRecord>(
    type: string,
    fallbackMessage: string,
    extra: AnyRecord = {}
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const runtimeApi = globalThis.chrome?.runtime;
      if (!runtimeApi || typeof runtimeApi.sendMessage !== "function") {
        reject(new Error("확장 프로그램의 백그라운드 작업을 시작할 수 없습니다."));
        return;
      }

      runtimeApi.sendMessage({ type, ...extra }, (response) => {
        const runtimeError = getRuntimeErrorMessage();
        if (runtimeError) {
          reject(new Error(runtimeError));
          return;
        }

        if (!response || response.ok !== true) {
          reject(new Error(response?.error || fallbackMessage));
          return;
        }

        resolve(response as T);
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
      setStatus(response.message || "전체 페이지 PNG 파일의 다운로드를 시작했습니다.", "success");
    } catch (error) {
      setStatus(String((error as AnyRecord)?.message || "전체 페이지 화면 캡처에 실패했습니다."), "error");
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
      setStatus(String((error as AnyRecord)?.message || "영역 선택 도구를 시작하지 못했습니다."), "error");
      setActionBusy();
    }
  }

  async function handleFileToImageClick() {
    if (activeAction) return;

    setActionBusy("file-to-image");
    setStatus("파일 포함 이미지 도구를 새 탭에서 열고 있습니다.", "working");

    try {
      const runtimeApi = globalThis.chrome?.runtime;
      const tabsApi = globalThis.chrome?.tabs;
      if (!runtimeApi || typeof runtimeApi.getURL !== "function" || !tabsApi || typeof tabsApi.create !== "function") {
        throw new Error("파일 포함 이미지 도구를 열 수 없습니다.");
      }

      const url = runtimeApi.getURL("file_to_image.html");
      await new Promise<void>((resolve, reject) => {
        tabsApi.create({ url, active: true }, () => {
          const runtimeError = getRuntimeErrorMessage();
          if (runtimeError) reject(new Error(runtimeError));
          else resolve();
        });
      });

      setStatus("파일 포함 이미지 도구를 새 탭에서 열었습니다.", "success");
      setActionBusy();
      window.setTimeout(() => window.close(), 80);
    } catch (error) {
      setStatus(String((error as AnyRecord)?.message || "파일 포함 이미지 도구를 열지 못했습니다."), "error");
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
      setStatus(String((error as AnyRecord)?.message || "현재 사이트의 정보를 확인하지 못했습니다."), "error");
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

  async function startElementEraser(mode: string|undefined) {
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
      setStatus(String((error as AnyRecord)?.message || "요소 숨기기 모드를 시작하지 못했습니다."), "error");
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
      setStatus(String((error as AnyRecord)?.message || "기억된 요소를 복원하지 못했습니다."), "error");
    } finally {
      setActionBusy();
    }
  }

  function getHttpOrigin(urlText: string): string | null {
    try {
      const parsed = new URL(urlText);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return null;
      }

      return parsed.origin;
    } catch {
      return null;
    }
  }

  function normalizeTab(tab: BrowserTab): TabEntry | null {
    const id = Number(tab?.id);
    const url = String(tab?.pendingUrl || tab?.url || "").trim();

    if (!Number.isInteger(id) || id < 0 || !url) {
      return null;
    }

    const title = String(tab?.title || "").trim() || "제목 없는 탭";
    const index = typeof tab.index === "number" && Number.isInteger(tab.index) ? tab.index : Number.MAX_SAFE_INTEGER;
    const origin = getHttpOrigin(url);

    return {
      id,
      index,
      title,
      url,
      origin,
      active: Boolean(tab?.active),
      pinned: Boolean(tab?.pinned),
      keepActiveEligible: Boolean(origin),
      keepActiveManaged: false,
      keepActiveDesired: false,
      keepActiveApplied: false,
      keepActivePending: false,
      keepActiveError: ""
    };
  }

  function applyTabKeepActiveState(response: AnyRecord) {
    tabKeepActiveGlobalEnabled = response?.globalEnabled === true;
    tabKeepActiveGlobalToggle.checked = tabKeepActiveGlobalEnabled;
    const statuses: AnyRecord = response?.statuses && typeof response.statuses === "object"
      ? response.statuses
      : {};

    for (const entry of tabEntries) {
      const state = statuses[String(entry.id)] || {};
      entry.keepActiveEligible = state.eligible === true;
      entry.keepActiveManaged = state.managed === true;
      entry.keepActiveDesired = state.desired === true;
      entry.keepActiveApplied = state.applied === true;
      entry.keepActivePending = state.pending === true;
      entry.keepActiveError = String(state.error || "").trim();
    }
    tabKeepActiveStateAvailable = true;
  }

  function setTabListMessage(message: string|null, state = "ready") {
    const paragraph = document.createElement("p");
    paragraph.className = "tab-list-message";
    paragraph.dataset.state = state;
    paragraph.textContent = message;
    tabList.replaceChildren(paragraph);
  }

  function getSelectedTabEntries() {
    return tabEntries.filter((entry) => selectedTabIds.has(entry.id));
  }

  function getSelectedSiteDataTargets() {
    const selectedEntries = getSelectedTabEntries();
    const targets: SiteDataTarget[] = selectedEntries
      .filter((entry) => Boolean(entry.origin))
      .map((entry) => ({ tabId: entry.id, origin: entry.origin as string }));
    const originCount = new Set(targets.map((target) => target.origin)).size;

    return {
      targets,
      originCount,
      skippedTabCount: selectedEntries.length - targets.length
    };
  }

  function updateTabSelectionUi() {
    const selectedEntries = getSelectedTabEntries();
    const selectedCount = selectedEntries.length;
    const siteDataSelection = getSelectedSiteDataTargets();
    const allSelected = tabEntries.length > 0 && selectedCount === tabEntries.length;
    const keepActiveAppliedCount = tabEntries.filter((entry) => entry.keepActiveApplied).length;
    const keepActivePendingCount = tabEntries.filter(
      (entry) => entry.keepActiveDesired && !entry.keepActiveApplied
    ).length;
    const selectedEligibleCount = selectedEntries.filter((entry) => entry.keepActiveEligible).length;
    const selectedManagedCount = selectedEntries.filter((entry) => entry.keepActiveManaged).length;
    const keepActiveRestoreErrorCount = tabEntries.filter(
      (entry) => entry.keepActiveManaged && !entry.keepActiveDesired && Boolean(entry.keepActiveError)
    ).length;
    const controlsBusy = tabSiteDataClearing || tabKeepActiveBusy;

    tabListSummary.textContent = `현재 창의 탭 ${tabEntries.length}개 · 활성 유지 ${keepActiveAppliedCount}개`;
    selectedTabsCount.textContent = selectedCount > 0
      ? `${selectedCount}개 선택 · 활성 유지 가능 ${selectedEligibleCount}개 · 삭제 가능 ${siteDataSelection.originCount}개 사이트`
      : "0개 선택";

    tabKeepActiveGlobalToggle.disabled =
      tabListLoading || controlsBusy || !tabKeepActiveStateAvailable;
    tabKeepActiveGlobalSummary.textContent = !tabKeepActiveStateAvailable
      ? "활성 상태 유지 정보를 불러오지 못했습니다."
      : tabKeepActiveGlobalEnabled
        ? `켜짐 · 모든 창의 현재 탭과 새 HTTP 및 HTTPS 탭에 적용합니다.`
        : keepActiveAppliedCount > 0 || keepActivePendingCount > 0 || keepActiveRestoreErrorCount > 0
          ? `꺼짐 · 현재 창에서 적용 ${keepActiveAppliedCount}개, 적용 대기 또는 오류 ${keepActivePendingCount}개, 복원 오류 ${keepActiveRestoreErrorCount}개입니다.`
          : "꺼짐 · 선택한 탭에만 개별적으로 적용할 수 있습니다.";

    selectAllTabsButton.disabled = tabListLoading || controlsBusy || tabEntries.length === 0 || allSelected;
    clearTabsButton.disabled = tabListLoading || controlsBusy || selectedCount === 0;
    refreshTabsButton.disabled = tabListLoading || controlsBusy;
    copyTabUrlsButton.disabled = tabListLoading || tabCopying || controlsBusy || selectedCount === 0;
    clearSiteDataButton.disabled =
      tabListLoading || tabCopying || controlsBusy || siteDataSelection.originCount === 0;
    enableSelectedTabKeepActiveButton.disabled =
      tabListLoading || controlsBusy || !tabKeepActiveStateAvailable || tabKeepActiveGlobalEnabled || selectedEligibleCount === 0;
    disableSelectedTabKeepActiveButton.disabled =
      tabListLoading || controlsBusy || !tabKeepActiveStateAvailable || tabKeepActiveGlobalEnabled || selectedManagedCount === 0;

    for (const checkbox of tabList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      checkbox.disabled = tabListLoading || controlsBusy;
    }

    if (!tabCopying && !copyLabelResetTimer) {
      copyTabUrlsLabel.textContent = selectedCount > 0
        ? `${selectedCount}개 URL 복사`
        : "선택한 URL 복사";
    }

    if (!tabSiteDataClearing) {
      clearSiteDataLabel.textContent = siteDataSelection.originCount > 0
        ? `${siteDataSelection.originCount}개 사이트의 쿠키와 캐시 삭제`
        : "선택한 사이트의 쿠키와 캐시 삭제";
    }

    if (!tabKeepActiveBusy) {
      enableSelectedTabKeepActiveLabel.textContent = selectedEligibleCount > 0
        ? `${selectedEligibleCount}개 탭의 페이지 활성 상태 유지`
        : "선택한 탭의 페이지 활성 상태 유지";
      disableSelectedTabKeepActiveLabel.textContent = selectedManagedCount > 0
        ? `${selectedManagedCount}개 탭을 원래 상태로 복원`
        : "선택한 탭을 원래 상태로 복원";
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
      setTabListMessage("현재 창에서 표시할 수 있는 탭을 찾지 못했습니다.");
      updateTabSelectionUi();
      return;
    }

    const fragment = document.createDocumentFragment();

    for (const entry of tabEntries) {
      const label = document.createElement("label");
      label.className = "tab-option";
      label.dataset.selected = String(selectedTabIds.has(entry.id));
      label.title = entry.keepActiveError
        ? `${entry.title}\n${entry.url}\n${entry.keepActiveError}`
        : `${entry.title}\n${entry.url}`;

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selectedTabIds.has(entry.id);
      checkbox.disabled = tabSiteDataClearing || tabKeepActiveBusy;
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

      if (entry.keepActiveDesired) {
        const badge = document.createElement("span");
        if (entry.keepActiveApplied) {
          badge.className = "tab-option__badge tab-option__badge--keep-active";
          badge.textContent = "활성 유지";
        } else if (entry.keepActivePending) {
          badge.className = "tab-option__badge tab-option__badge--pending";
          badge.textContent = "적용 대기";
        } else {
          badge.className = "tab-option__badge tab-option__badge--error";
          badge.textContent = "적용 오류";
        }
        titleRow.appendChild(badge);
      } else if (entry.keepActiveManaged && entry.keepActiveError) {
        const badge = document.createElement("span");
        badge.className = "tab-option__badge tab-option__badge--error";
        badge.textContent = "복원 오류";
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

  async function loadOpenTabs(announceStatus = true) {
    if (tabListLoading || tabSiteDataClearing || tabKeepActiveBusy) return;

    tabListLoading = true;
    tabKeepActiveStateAvailable = false;
    tabUrlToggle.setAttribute("aria-busy", "true");
    setTabListMessage("현재 창의 탭을 불러오는 중입니다.");
    updateTabSelectionUi();
    if (announceStatus) {
      setStatus("현재 창의 탭 목록과 활성 상태를 불러오는 중입니다.", "working");
    }

    try {
      const tabs = await queryTabs({ currentWindow: true });
      tabEntries = (tabs
        .map(normalizeTab)
        .filter(Boolean) as TabEntry[])
        .sort((first, second) => first.index - second.index);

      let stateError = "";
      if (tabEntries.length > 0) {
        try {
          const keepActiveResponse = await requestExtensionAction(
            MESSAGE_TYPES.GET_TAB_KEEP_ACTIVE_STATE,
            "탭의 활성 상태 유지 정보를 읽지 못했습니다.",
            { tabIds: tabEntries.map((entry) => entry.id) }
          );
          applyTabKeepActiveState(keepActiveResponse);
        } catch (error) {
          stateError = String(
            (error as AnyRecord)?.message || "탭의 활성 상태 유지 정보를 읽지 못했습니다."
          );
          tabKeepActiveStateAvailable = false;
          for (const entry of tabEntries) {
            entry.keepActiveError = stateError;
          }
        }
      } else {
        tabKeepActiveStateAvailable = true;
        tabKeepActiveGlobalToggle.checked = tabKeepActiveGlobalEnabled;
      }

      renderTabList();
      if (announceStatus) {
        if (stateError) {
          setStatus(`탭 목록은 불러왔지만 활성 상태 유지 정보를 읽지 못했습니다. ${stateError}`, "error");
        } else {
          setStatus(`현재 창에서 ${tabEntries.length}개의 탭과 최종 활성 상태를 불러왔습니다.`);
        }
      }
    } catch (error) {
      tabEntries = [];
      selectedTabIds.clear();
      tabKeepActiveStateAvailable = false;
      setTabListMessage(
        String((error as AnyRecord)?.message || "탭 목록을 불러오지 못했습니다."),
        "error"
      );
      if (announceStatus) {
        setStatus(String((error as AnyRecord)?.message || "탭 목록을 불러오지 못했습니다."), "error");
      }
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
    if (tabSiteDataClearing) return;
    for (const entry of tabEntries) {
      selectedTabIds.add(entry.id);
    }
    renderTabList();
  }

  function clearTabSelection() {
    if (tabSiteDataClearing) return;
    selectedTabIds.clear();
    renderTabList();
  }

  async function writeClipboardText(text: string) {
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
    if (tabCopying || tabSiteDataClearing) return;

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
      setStatus(String((error as AnyRecord)?.message || "클립보드에 복사하지 못했습니다."), "error");
    } finally {
      tabCopying = false;
      copyTabUrlsButton.setAttribute("aria-busy", "false");
      updateTabSelectionUi();
    }
  }

  async function clearSelectedSiteData() {
    if (tabSiteDataClearing || tabCopying) return;

    const selection = getSelectedSiteDataTargets();
    if (selection.targets.length === 0) {
      setStatus("쿠키와 캐시를 삭제할 HTTP 또는 HTTPS 탭을 하나 이상 선택하세요.", "error");
      return;
    }

    tabSiteDataClearing = true;
    clearSiteDataButton.setAttribute("aria-busy", "true");
    tabUrlToggle.setAttribute("aria-busy", "true");
    clearSiteDataLabel.textContent = "쿠키와 캐시를 삭제하는 중입니다";
    updateTabSelectionUi();
    setStatus(
      `${selection.originCount}개 사이트의 쿠키와 캐시를 삭제하는 중입니다.`,
      "working"
    );

    try {
      const response = await requestExtensionAction(
        MESSAGE_TYPES.CLEAR_SELECTED_SITE_DATA,
        "선택한 사이트의 쿠키와 캐시를 삭제하지 못했습니다.",
        { targets: selection.targets }
      );
      const clearedOriginCount = Number(response.originCount) || selection.originCount;
      const skippedMessage = selection.skippedTabCount > 0
        ? ` HTTP 및 HTTPS가 아닌 탭 ${selection.skippedTabCount}개는 제외했습니다.`
        : "";
      setStatus(
        `${clearedOriginCount}개 사이트의 쿠키와 캐시를 삭제했습니다. 해당 탭을 새로 고치면 반영됩니다.${skippedMessage}`,
        "success"
      );
    } catch (error) {
      setStatus(
        String((error as AnyRecord)?.message || "선택한 사이트의 쿠키와 캐시를 삭제하지 못했습니다."),
        "error"
      );
    } finally {
      tabSiteDataClearing = false;
      clearSiteDataButton.setAttribute("aria-busy", "false");
      tabUrlToggle.setAttribute("aria-busy", "false");
      updateTabSelectionUi();
    }
  }

  function getTabKeepActiveResultMessage(
    response: AnyRecord,
    enabled: boolean,
    globalOperation: boolean
  ): { message: string; state: string } {
    const appliedCount = Number(response?.appliedCount) || 0;
    const disabledCount = Number(response?.disabledCount) || 0;
    const pendingCount = Number(response?.pendingCount) || 0;
    const failedCount = Number(response?.failedCount) || 0;
    const skippedCount = Number(response?.skippedCount) || 0;
    const firstError = Array.isArray(response?.results)
      ? String(response.results.find((result: AnyRecord) => result?.status === "failed")?.error || "")
      : "";
    const scope = globalOperation ? "모든 탭" : "선택한 탭";

    if (failedCount > 0) {
      return {
        message: `${scope} 처리 결과 적용 ${appliedCount}개, 복원 ${disabledCount}개, 대기 ${pendingCount}개, 실패 ${failedCount}개입니다.${firstError ? ` ${firstError}` : ""}`,
        state: "error"
      };
    }

    if (enabled) {
      const skippedMessage = skippedCount > 0
        ? ` 지원하지 않는 탭 ${skippedCount}개는 제외했습니다.`
        : "";
      const pendingMessage = pendingCount > 0
        ? ` 페이지 로드 후 적용할 탭은 ${pendingCount}개입니다.`
        : "";
      return {
        message: globalOperation
          ? `모든 탭의 활성 상태 유지를 켰습니다. 현재 ${appliedCount}개 탭에 최종 적용을 확인했습니다.${pendingMessage}${skippedMessage}`
          : `선택한 탭 ${appliedCount}개에서 최종 활성 상태를 확인했습니다.${pendingMessage}${skippedMessage}`,
        state: "success"
      };
    }

    return {
      message: globalOperation
        ? `모든 탭의 활성 상태 유지를 끄고 ${disabledCount}개 탭을 원래 설정으로 복원했습니다.`
        : `선택한 탭 ${disabledCount}개를 원래 설정으로 복원했습니다.${skippedCount > 0 ? ` 적용되지 않은 탭 ${skippedCount}개는 변경하지 않았습니다.` : ""}`,
      state: "success"
    };
  }

  async function setSelectedTabsKeepActive(enabled: boolean) {
    if (tabKeepActiveBusy || tabListLoading || tabKeepActiveGlobalEnabled) return;

    const selectedEntries = getSelectedTabEntries();
    const targetEntries = enabled
      ? selectedEntries.filter((entry) => entry.keepActiveEligible)
      : selectedEntries.filter((entry) => entry.keepActiveManaged);
    if (targetEntries.length === 0) {
      setStatus(
        enabled
          ? "활성 상태를 유지할 HTTP 또는 HTTPS 탭을 하나 이상 선택하세요."
          : "원래 상태로 복원할 탭을 하나 이상 선택하세요.",
        "error"
      );
      return;
    }

    tabKeepActiveBusy = true;
    tabUrlToggle.setAttribute("aria-busy", "true");
    const busyButton = enabled
      ? enableSelectedTabKeepActiveButton
      : disableSelectedTabKeepActiveButton;
    busyButton.setAttribute("aria-busy", "true");
    if (enabled) enableSelectedTabKeepActiveLabel.textContent = "최종 활성 상태를 적용하고 확인하는 중입니다";
    else disableSelectedTabKeepActiveLabel.textContent = "원래 설정으로 복원하는 중입니다";
    updateTabSelectionUi();
    setStatus(
      enabled
        ? `${targetEntries.length}개 탭에 활성 상태를 적용하고 최종 값을 확인하는 중입니다.`
        : `${targetEntries.length}개 탭을 원래 설정으로 복원하는 중입니다.`,
      "working"
    );

    let finalStatus: { message: string; state: string } | null = null;
    try {
      const response = await requestExtensionAction(
        MESSAGE_TYPES.SET_SELECTED_TAB_KEEP_ACTIVE,
        enabled
          ? "선택한 탭의 활성 상태를 유지하지 못했습니다."
          : "선택한 탭을 원래 상태로 복원하지 못했습니다.",
        {
          tabIds: targetEntries.map((entry) => entry.id),
          enabled
        }
      );
      finalStatus = getTabKeepActiveResultMessage(response, enabled, false);
    } catch (error) {
      finalStatus = {
        message: String((error as AnyRecord)?.message || "선택한 탭의 활성 상태 유지 설정을 변경하지 못했습니다."),
        state: "error"
      };
    } finally {
      tabKeepActiveBusy = false;
      tabUrlToggle.setAttribute("aria-busy", "false");
      busyButton.setAttribute("aria-busy", "false");
      await loadOpenTabs(false);
      updateTabSelectionUi();
      if (finalStatus) setStatus(finalStatus.message, finalStatus.state);
    }
  }

  async function handleTabKeepActiveGlobalChange() {
    if (tabKeepActiveBusy || tabListLoading || !tabKeepActiveStateAvailable) {
      tabKeepActiveGlobalToggle.checked = tabKeepActiveGlobalEnabled;
      return;
    }

    const enabled = tabKeepActiveGlobalToggle.checked;
    const previousEnabled = tabKeepActiveGlobalEnabled;
    tabKeepActiveBusy = true;
    tabUrlToggle.setAttribute("aria-busy", "true");
    tabKeepActiveGlobalToggle.disabled = true;
    updateTabSelectionUi();
    setStatus(
      enabled
        ? "모든 창의 현재 탭과 앞으로 열리는 탭에 활성 상태 유지를 적용하는 중입니다."
        : "모든 탭의 활성 상태 유지 설정을 끄고 원래 설정으로 복원하는 중입니다.",
      "working"
    );

    let finalStatus: { message: string; state: string } | null = null;
    try {
      const response = await requestExtensionAction(
        MESSAGE_TYPES.SET_ALL_TAB_KEEP_ACTIVE,
        "모든 탭의 활성 상태 유지 설정을 변경하지 못했습니다.",
        { enabled }
      );
      tabKeepActiveGlobalEnabled = response.globalEnabled === true;
      finalStatus = getTabKeepActiveResultMessage(response, enabled, true);
    } catch (error) {
      tabKeepActiveGlobalEnabled = previousEnabled;
      tabKeepActiveGlobalToggle.checked = previousEnabled;
      finalStatus = {
        message: String((error as AnyRecord)?.message || "모든 탭의 활성 상태 유지 설정을 변경하지 못했습니다."),
        state: "error"
      };
    } finally {
      tabKeepActiveBusy = false;
      tabUrlToggle.setAttribute("aria-busy", "false");
      await loadOpenTabs(false);
      updateTabSelectionUi();
      if (finalStatus) setStatus(finalStatus.message, finalStatus.state);
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
  const chatWidthInspectButton = document.getElementById("chat-width-inspect") as HTMLButtonElement | null;
  const chatWidthInspection = document.getElementById("chat-width-inspection");
  const chatWidthCopyButton = document.getElementById("chat-width-copy-diagnostics") as HTMLButtonElement | null;
  const chatWidthCopyStatus = document.getElementById("chat-width-copy-status");
  async function requestChatWidthReport(type: "chatgpt-width:inspect" | "chatgpt-width:diagnose"): Promise<AnyRecord> {
    const tab = await getActiveTab();
    const url = new URL(tab.pendingUrl || tab.url || "");
    if (url.protocol !== "https:" || url.hostname !== "chatgpt.com") {
      throw new Error("ChatGPT 탭을 선택한 뒤 다시 확인하십시오.");
    }
    return new Promise<AnyRecord>((resolve, reject) => {
      const tabs = globalThis.chrome?.tabs;
      if (typeof tabs?.sendMessage !== "function") {
        reject(new Error("현재 탭에 접근할 수 없습니다."));
        return;
      }
      tabs.sendMessage(tab.id, { type }, { frameId: 0 }, (value) => {
        const error = getRuntimeErrorMessage();
        if (error) { reject(new Error(`${error} ChatGPT 탭을 새로 고친 뒤 다시 확인하십시오.`)); return; }
        const scope = type === "chatgpt-width:diagnose" ? "chatgpt-width-structure" : "matched-visible-width-containers";
        if (value?.ok !== true || value.scope !== scope) {
          reject(new Error(value?.error || "새 진단 코드가 응답하지 않았습니다. ChatGPT 탭을 새로 고친 뒤 다시 확인하십시오.")); return;
        }
        resolve(value);
      });
    });
  }
  chatWidthCopyButton?.addEventListener("click", async () => {
    if (!chatWidthCopyStatus) return;
    chatWidthCopyButton.disabled = true;
    chatWidthCopyStatus.hidden = false;
    chatWidthCopyStatus.textContent = "내용을 제외한 현재 화면의 너비 구조를 읽고 있습니다.";
    try {
      const report = await requestChatWidthReport("chatgpt-width:diagnose");
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      chatWidthCopyStatus.textContent = "구조 진단을 복사했습니다. 이 대화에 붙여 넣어 보내주십시오. 너비 수정 완료를 의미하지 않습니다.";
    } catch (error) {
      chatWidthCopyStatus.textContent = error instanceof Error ? error.message : "진단 복사에 실패했습니다.";
    } finally {
      chatWidthCopyButton.disabled = false;
    }
  });
  chatWidthInspectButton?.addEventListener("click", async () => {
    if (!chatWidthInspection) return;
    chatWidthInspectButton.disabled = true;
    chatWidthInspection.hidden = false;
    chatWidthInspection.textContent = "현재 탭의 실제 너비를 읽고 있습니다.";
    try {
      const response = await requestChatWidthReport("chatgpt-width:inspect");
      const describe = (label: string, configured: unknown, samples: unknown): string => {
        const desired = configured === 0 ? "ChatGPT 기본값" : `${configured} CSS px`;
        const valid = Array.isArray(samples) ? samples.filter(item => Number.isFinite(item?.width) && item.width > 0) : [];
        const widths = [...new Set(valid.map(item => item.width))];
        return `${label} 설정: ${desired}\n` + (widths.length ? `표시된 컨테이너: ${widths.join(" / ")} CSS px` : "표시된 너비 대상을 확인하지 못했습니다.");
      };
      chatWidthInspection.textContent = [
        describe("대화", response.configured?.conversation, response.conversation),
        describe("입력란", response.configured?.composer, response.composer),
        `화면 너비: ${response.viewportWidth} CSS px\n가로 넘침: ${response.horizontalOverflow} CSS px`,
        "확인 버튼을 누른 시점의 컨테이너 측정값입니다. 새 대화에는 대화 영역이 아직 없을 수 있습니다."
      ].join("\n\n");
    } catch (error) {
      chatWidthInspection.textContent = error instanceof Error ? error.message : "현재 너비를 확인하지 못했습니다.";
    } finally {
      chatWidthInspectButton.disabled = false;
    }
  });

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
  fileToImageButton.addEventListener("click", handleFileToImageClick);
  elementEraserToggle.addEventListener("click", toggleElementEraserDropdown);
  for (const button of elementEraserModeButtons) {
    button.addEventListener("click", () => startElementEraser(button.dataset.eraserMode));
  }
  clearElementEraserRulesButton.addEventListener("click", clearElementEraserRules);
  tabUrlToggle.addEventListener("click", toggleTabUrlDropdown);
  refreshTabsButton.addEventListener("click", () => void loadOpenTabs());
  selectAllTabsButton.addEventListener("click", selectAllTabs);
  clearTabsButton.addEventListener("click", clearTabSelection);
  copyTabUrlsButton.addEventListener("click", copySelectedTabUrls);
  clearSiteDataButton.addEventListener("click", clearSelectedSiteData);
  enableSelectedTabKeepActiveButton.addEventListener("click", () => void setSelectedTabsKeepActive(true));
  disableSelectedTabKeepActiveButton.addEventListener("click", () => void setSelectedTabsKeepActive(false));
  tabKeepActiveGlobalToggle.addEventListener("change", () => void handleTabKeepActiveGlobalChange());

  const runtimeMessages = globalThis.chrome?.runtime?.onMessage;
  if (runtimeMessages && typeof runtimeMessages.addListener === "function") {
    runtimeMessages.addListener((message) => {
      if (message?.type !== MESSAGE_TYPES.MEDIA_TAB_RATE_UPDATED) return false;
      if (Number(message.tabId) !== activeMediaTabId) return false;
      activeMediaAvailable = message.hasMedia === true;
      activeMediaLabel = String(message.label || "");
      if (completedRateRevision === pendingRateRevision) updateMediaRateUi(message.rate);
      updateMediaRateControlsEnabled();
      updateMediaSummary();
      return false;
    });
  }

  window.addEventListener("browser-toolbox-settings-imported", () => {
    // Re-read the actual managed-tab state after an explicitly confirmed global import.
    if (!tabUrlDropdown.hidden) void loadOpenTabs(false);
  });
  const storageChanged = globalThis.chrome?.storage?.onChanged;
  if (storageChanged && typeof storageChanged.addListener === "function") {
    storageChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes || typeof changes !== "object") {
        return;
      }
      settingsJournal.record(changes);

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
        chatWidthSetting.applyStored(
          typeof newWidth === "number" ? newWidth : CHAT_WIDTH_DEFAULT_PX
        );
      }

      if (Object.prototype.hasOwnProperty.call(changes, COMPOSER_WIDTH_STORAGE_KEY)) {
        const newWidth = changes[COMPOSER_WIDTH_STORAGE_KEY]?.newValue;
        composerWidthSetting.applyStored(
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

      const shortcutChanges: Record<string, unknown> = {};
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
        showShortcutConflicts();
      }

      if (controlsChanged) {
        showShortcutConflicts();
        updatePageUnlockSummary();
        updateMediaRateControlsEnabled();
        updateMediaSummary();
      }
    });
  }

  // The navigation shell only changes presentation; cancel an unfinished key capture on exit.
  document.addEventListener("browser-toolbox-section-change", (event) => {
    if (event instanceof CustomEvent && event.detail !== "media" && mediaShortcutCaptureCommand) setMediaShortcutCapture("");
  });
  document.getElementById("media-keyboard-settings")?.addEventListener("toggle", (event) => {
    if (!(event.currentTarget as HTMLDetailsElement).open && mediaShortcutCaptureCommand) setMediaShortcutCapture("");
  });

  updateElementEraserSiteSummary();
  updateElementEraserControls();
  updateTabSelectionUi();
  loadSettings();
})();
