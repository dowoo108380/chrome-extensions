"use strict";
(() => {
    "use strict";
    const MESSAGE_TYPES = Object.freeze({
        GET_INFO: "youtube-transcript:get-info",
        GET_TRANSCRIPT: "youtube-transcript:get-transcript",
        APPLY_SYNCED_CAPTIONS: "youtube-synced-captions:apply",
        REMOVE_SYNCED_CAPTIONS: "youtube-synced-captions:remove",
        SAVE_TEXT: "youtube-transcript:save-text",
        SAVE_BATCH: "youtube-transcript:save-batch"
    });
    const STORAGE_KEYS = Object.freeze({
        includeTitle: "youtubeTranscriptIncludeTitle",
        includeTimestamps: "youtubeTranscriptIncludeTimestamps",
        blankLines: "youtubeTranscriptBlankLines",
        sourcePreference: "youtubeTranscriptSourcePreference",
        translationLanguage: "youtubeTranscriptTranslationLanguage",
        syncedCaptionFontSize: "youtubeSyncedCaptionFontSizePx",
        syncedCaptionPosition: "youtubeSyncedCaptionPosition",
        syncedCaptionMaxWidthPercent: "youtubeSyncedCaptionMaxWidthPercent",
        syncedCaptionPreferredLineCount: "youtubeSyncedCaptionPreferredLineCount"
    });
    const SYNCED_CAPTION_DEFAULT_POSITION = Object.freeze({ x: 0.5, y: 0.83 });
    const SYNCED_CAPTION_DEFAULT_FONT_SIZE_PX = 28;
    const SYNCED_CAPTION_MIN_FONT_SIZE_PX = 14;
    const SYNCED_CAPTION_MAX_FONT_SIZE_PX = 64;
    const SYNCED_CAPTION_DEFAULT_MAX_WIDTH_PERCENT = 92;
    const SYNCED_CAPTION_MIN_MAX_WIDTH_PERCENT = 30;
    const SYNCED_CAPTION_MAX_MAX_WIDTH_PERCENT = 100;
    const SYNCED_CAPTION_DEFAULT_PREFERRED_LINE_COUNT = 0;
    const SYNCED_CAPTION_MIN_PREFERRED_LINE_COUNT = 0;
    const SYNCED_CAPTION_MAX_PREFERRED_LINE_COUNT = 6;
    const DEFAULTS = Object.freeze({
        [STORAGE_KEYS.includeTitle]: true,
        [STORAGE_KEYS.includeTimestamps]: false,
        [STORAGE_KEYS.blankLines]: 0,
        [STORAGE_KEYS.sourcePreference]: "",
        [STORAGE_KEYS.translationLanguage]: "",
        [STORAGE_KEYS.syncedCaptionFontSize]: SYNCED_CAPTION_DEFAULT_FONT_SIZE_PX,
        [STORAGE_KEYS.syncedCaptionPosition]: { ...SYNCED_CAPTION_DEFAULT_POSITION },
        [STORAGE_KEYS.syncedCaptionMaxWidthPercent]: SYNCED_CAPTION_DEFAULT_MAX_WIDTH_PERCENT,
        [STORAGE_KEYS.syncedCaptionPreferredLineCount]: SYNCED_CAPTION_DEFAULT_PREFERRED_LINE_COUNT
    });
    const MAX_SELECTED_TABS = 50;
    const INFO_CONCURRENCY = 3;
    const COMBINED_TRANSCRIPT_SEPARATOR = "\r\n\r\n\r\n";
    const toggle = document.getElementById("youtube-transcript-toggle");
    const dropdown = document.getElementById("youtube-transcript-dropdown");
    const summary = document.getElementById("youtube-transcript-summary");
    const listSummary = document.getElementById("youtube-transcript-list-summary");
    const refreshButton = document.getElementById("youtube-transcript-refresh");
    const selectAllButton = document.getElementById("youtube-transcript-select-all");
    const clearButton = document.getElementById("youtube-transcript-clear");
    const selectedCount = document.getElementById("youtube-transcript-selected-count");
    const tabList = document.getElementById("youtube-transcript-tab-list");
    const includeTitleToggle = document.getElementById("youtube-transcript-title-toggle");
    const includeTimeToggle = document.getElementById("youtube-transcript-time-toggle");
    const spacingSelect = document.getElementById("youtube-transcript-spacing");
    const copyButton = document.getElementById("youtube-transcript-copy");
    const copyLabel = document.getElementById("youtube-transcript-copy-label");
    const downloadButton = document.getElementById("youtube-transcript-download");
    const downloadLabel = document.getElementById("youtube-transcript-download-label");
    const separateDownloadButton = document.getElementById("youtube-transcript-download-separate");
    const separateDownloadLabel = document.getElementById("youtube-transcript-download-separate-label");
    const syncedCaptionApplyButton = document.getElementById("youtube-synced-caption-apply");
    const syncedCaptionApplyLabel = document.getElementById("youtube-synced-caption-apply-label");
    const syncedCaptionRemoveButton = document.getElementById("youtube-synced-caption-remove");
    const syncedCaptionRemoveLabel = document.getElementById("youtube-synced-caption-remove-label");
    const syncedCaptionFontSizeInput = document.getElementById("youtube-synced-caption-font-size");
    const syncedCaptionFontSizeValue = document.getElementById("youtube-synced-caption-font-size-value");
    const syncedCaptionMaxWidthInput = document.getElementById("youtube-synced-caption-max-width");
    const syncedCaptionMaxWidthValue = document.getElementById("youtube-synced-caption-max-width-value");
    const syncedCaptionPreferredLineCountSelect = document.getElementById("youtube-synced-caption-line-count");
    const syncedCaptionPositionResetButton = document.getElementById("youtube-synced-caption-position-reset");
    const status = document.getElementById("status");
    const storageArea = globalThis.chrome?.storage?.local;
    const otherDropdownPairs = Object.freeze([
        ["media-dropdown", "media-toggle"],
        ["page-unlock-dropdown", "page-unlock-toggle"],
        ["element-eraser-dropdown", "element-eraser-toggle"],
        ["tab-url-dropdown", "tab-url-toggle"]
    ]);
    const baseButtonLabels = Object.freeze({
        syncedApply: "선택 탭에 적용",
        syncedRemove: "선택 탭에서 해제",
        copy: "선택 자막 모두 복사",
        combined: "한 파일로 저장",
        separate: "개별 파일 일괄 저장"
    });
    let settings = { ...DEFAULTS };
    let settingsReady = false;
    const settingsJournal = new ToolboxShared.SettingsReadJournal(Object.keys(DEFAULTS));
    let listLoading = false;
    let operationBusy = false;
    let tabEntries = [];
    let selectedTabIds = new Set();
    let transientLabelTimer = 0;
    function setStatus(message, state = "ready") {
        if (!status)
            return;
        status.textContent = message;
        status.dataset.state = state;
    }
    function getRuntimeErrorMessage() {
        return globalThis.chrome?.runtime?.lastError?.message || "";
    }
    function normalizeBlankLines(value) {
        const numeric = Math.round(ToolboxShared.numericSetting(value));
        return Number.isFinite(numeric) ? Math.min(3, Math.max(0, numeric)) : 0;
    }
    function normalizeSyncedCaptionFontSize(value) {
        const numeric = Math.round(ToolboxShared.numericSetting(value));
        return Number.isFinite(numeric)
            ? Math.min(SYNCED_CAPTION_MAX_FONT_SIZE_PX, Math.max(SYNCED_CAPTION_MIN_FONT_SIZE_PX, numeric))
            : SYNCED_CAPTION_DEFAULT_FONT_SIZE_PX;
    }
    function normalizeSyncedCaptionMaxWidthPercent(value) {
        const numeric = Math.round(ToolboxShared.numericSetting(value));
        return Number.isFinite(numeric)
            ? Math.min(SYNCED_CAPTION_MAX_MAX_WIDTH_PERCENT, Math.max(SYNCED_CAPTION_MIN_MAX_WIDTH_PERCENT, numeric))
            : SYNCED_CAPTION_DEFAULT_MAX_WIDTH_PERCENT;
    }
    function normalizeSyncedCaptionPreferredLineCount(value) {
        const numeric = Math.round(ToolboxShared.numericSetting(value));
        return Number.isFinite(numeric)
            ? Math.min(SYNCED_CAPTION_MAX_PREFERRED_LINE_COUNT, Math.max(SYNCED_CAPTION_MIN_PREFERRED_LINE_COUNT, numeric))
            : SYNCED_CAPTION_DEFAULT_PREFERRED_LINE_COUNT;
    }
    function normalizeSyncedCaptionPosition(value) {
        const source = value && typeof value === "object" ? value : {};
        const x = ToolboxShared.numericSetting(source.x);
        const y = ToolboxShared.numericSetting(source.y);
        return {
            x: Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : SYNCED_CAPTION_DEFAULT_POSITION.x,
            y: Number.isFinite(y) ? Math.min(1, Math.max(0, y)) : SYNCED_CAPTION_DEFAULT_POSITION.y
        };
    }
    function normalizeSettings(values) {
        const source = values && typeof values === "object" ? values : {};
        return {
            [STORAGE_KEYS.includeTitle]: typeof source[STORAGE_KEYS.includeTitle] === "boolean"
                ? source[STORAGE_KEYS.includeTitle]
                : DEFAULTS[STORAGE_KEYS.includeTitle],
            [STORAGE_KEYS.includeTimestamps]: typeof source[STORAGE_KEYS.includeTimestamps] === "boolean"
                ? source[STORAGE_KEYS.includeTimestamps]
                : DEFAULTS[STORAGE_KEYS.includeTimestamps],
            [STORAGE_KEYS.blankLines]: normalizeBlankLines(Object.prototype.hasOwnProperty.call(source, STORAGE_KEYS.blankLines)
                ? source[STORAGE_KEYS.blankLines]
                : DEFAULTS[STORAGE_KEYS.blankLines]),
            [STORAGE_KEYS.sourcePreference]: String(source[STORAGE_KEYS.sourcePreference] || ""),
            [STORAGE_KEYS.translationLanguage]: String(source[STORAGE_KEYS.translationLanguage] || ""),
            [STORAGE_KEYS.syncedCaptionFontSize]: normalizeSyncedCaptionFontSize(Object.prototype.hasOwnProperty.call(source, STORAGE_KEYS.syncedCaptionFontSize)
                ? source[STORAGE_KEYS.syncedCaptionFontSize]
                : DEFAULTS[STORAGE_KEYS.syncedCaptionFontSize]),
            [STORAGE_KEYS.syncedCaptionPosition]: normalizeSyncedCaptionPosition(Object.prototype.hasOwnProperty.call(source, STORAGE_KEYS.syncedCaptionPosition)
                ? source[STORAGE_KEYS.syncedCaptionPosition]
                : DEFAULTS[STORAGE_KEYS.syncedCaptionPosition]),
            [STORAGE_KEYS.syncedCaptionMaxWidthPercent]: normalizeSyncedCaptionMaxWidthPercent(Object.prototype.hasOwnProperty.call(source, STORAGE_KEYS.syncedCaptionMaxWidthPercent)
                ? source[STORAGE_KEYS.syncedCaptionMaxWidthPercent]
                : DEFAULTS[STORAGE_KEYS.syncedCaptionMaxWidthPercent]),
            [STORAGE_KEYS.syncedCaptionPreferredLineCount]: normalizeSyncedCaptionPreferredLineCount(Object.prototype.hasOwnProperty.call(source, STORAGE_KEYS.syncedCaptionPreferredLineCount)
                ? source[STORAGE_KEYS.syncedCaptionPreferredLineCount]
                : DEFAULTS[STORAGE_KEYS.syncedCaptionPreferredLineCount])
        };
    }
    function isYouTubeVideoUrl(rawUrl) {
        try {
            const url = new URL(String(rawUrl || ""));
            const host = url.hostname.toLowerCase();
            if (!(host === "youtube.com" || host.endsWith(".youtube.com")))
                return false;
            if (url.pathname === "/watch")
                return Boolean(url.searchParams.get("v"));
            return /^\/(?:shorts|live|embed)\/[^/?#]+/i.test(url.pathname);
        }
        catch {
            return false;
        }
    }
    function getDisplayUrl(rawUrl) {
        try {
            const url = new URL(String(rawUrl || ""));
            return `${url.hostname}${url.pathname}${url.search}`;
        }
        catch {
            return String(rawUrl || "");
        }
    }
    function queryCurrentWindowTabs() {
        return new Promise((resolve, reject) => {
            const tabsApi = globalThis.chrome?.tabs;
            if (!tabsApi || typeof tabsApi.query !== "function") {
                reject(new Error("현재 창의 탭을 확인할 수 없습니다."));
                return;
            }
            tabsApi.query({ currentWindow: true }, (tabs) => {
                const errorMessage = getRuntimeErrorMessage();
                if (errorMessage) {
                    reject(new Error(errorMessage));
                    return;
                }
                resolve(Array.isArray(tabs) ? tabs : []);
            });
        });
    }
    let captionPort = null;
    const pendingCaptionRequests = new Map();
    function rejectPendingCaptions(message) {
        for (const request of pendingCaptionRequests.values()) {
            clearTimeout(request.timer);
            request.reject(new Error(message));
        }
        pendingCaptionRequests.clear();
    }
    function requestCaptionTask(message, timeoutMs) {
        return new Promise((resolve, reject) => {
            try {
                if (!captionPort) {
                    const port = chrome.runtime.connect({ name: ToolboxShared.CAPTION_PORT_NAME });
                    captionPort = port;
                    port.onMessage.addListener((raw) => {
                        if (!ToolboxShared.isRecord(raw) || typeof raw.requestId !== "string")
                            return;
                        const request = pendingCaptionRequests.get(raw.requestId);
                        if (!request)
                            return;
                        pendingCaptionRequests.delete(raw.requestId);
                        clearTimeout(request.timer);
                        const response = raw.response;
                        if (ToolboxShared.isRecord(response) && response.ok === true)
                            request.resolve(response);
                        else
                            request.reject(new Error(ToolboxShared.isRecord(response) && typeof response.error === "string" ? response.error : "자막 작업이 실패했습니다."));
                    });
                    port.onDisconnect.addListener(() => {
                        const error = chrome.runtime.lastError;
                        if (captionPort !== port)
                            return;
                        captionPort = null;
                        rejectPendingCaptions(error?.message || "자막 작업 연결이 종료되었습니다. 다시 시도하세요.");
                    });
                }
                const requestId = crypto.randomUUID(), port = captionPort;
                const timer = window.setTimeout(() => {
                    const request = pendingCaptionRequests.get(requestId);
                    if (!request)
                        return;
                    pendingCaptionRequests.delete(requestId);
                    try {
                        port.postMessage({ requestId, cancel: true });
                    }
                    catch { /* The disconnect handler owns other requests. */ }
                    request.reject(new Error("유튜브 자막 요청 시간이 초과되어 작업을 취소했습니다."));
                }, timeoutMs);
                pendingCaptionRequests.set(requestId, { timer, resolve: value => resolve(value), reject });
                try {
                    port.postMessage({ requestId, message });
                }
                catch (error) {
                    clearTimeout(timer);
                    pendingCaptionRequests.delete(requestId);
                    throw error;
                }
            }
            catch (error) {
                reject(error instanceof Error ? error : new Error("자막 작업 연결을 시작하지 못했습니다."));
            }
        });
    }
    window.addEventListener("pagehide", () => {
        captionPort?.disconnect();
        captionPort = null;
        rejectPendingCaptions("자막 패널이 닫혀 작업을 취소했습니다.");
    }, { once: true });
    function sendRuntimeMessage(message, timeoutMs = 60000) {
        if (ToolboxShared.isCaptionMessage(message) && typeof globalThis.chrome?.runtime?.connect === "function") {
            return requestCaptionTask(message, timeoutMs);
        }
        return new Promise((resolve, reject) => {
            const runtime = globalThis.chrome?.runtime;
            if (!runtime || typeof runtime.sendMessage !== "function") {
                reject(new Error("확장 프로그램의 백그라운드 기능을 사용할 수 없습니다."));
                return;
            }
            let settled = false;
            const timer = window.setTimeout(() => {
                if (settled)
                    return;
                settled = true;
                reject(new Error("유튜브 자막 요청 시간이 초과되었습니다."));
            }, timeoutMs);
            try {
                runtime.sendMessage(message, (response) => {
                    if (settled)
                        return;
                    settled = true;
                    window.clearTimeout(timer);
                    const errorMessage = getRuntimeErrorMessage();
                    if (errorMessage) {
                        reject(new Error(errorMessage));
                        return;
                    }
                    if (!response || response.ok !== true) {
                        reject(new Error(response?.error || "유튜브 자막 요청에 실패했습니다."));
                        return;
                    }
                    resolve(response);
                });
            }
            catch (error) {
                if (settled)
                    return;
                settled = true;
                window.clearTimeout(timer);
                reject(error);
            }
        });
    }
    function closeOtherDropdowns() {
        for (const [dropdownId, toggleId] of otherDropdownPairs) {
            const otherDropdown = document.getElementById(dropdownId);
            const otherToggle = document.getElementById(toggleId);
            if (otherDropdown && !otherDropdown.hidden && otherToggle) {
                otherToggle.click();
                continue;
            }
            if (otherDropdown)
                otherDropdown.hidden = true;
            if (otherToggle)
                otherToggle.setAttribute("aria-expanded", "false");
        }
    }
    function setOpen(open) {
        if (!dropdown || !toggle)
            return;
        dropdown.hidden = !open;
        toggle.setAttribute("aria-expanded", String(open));
    }
    function closeYouTubeDropdown() {
        setOpen(false);
    }
    function saveStoredValues(values) {
        // The current popup can use the user's selection, but persistence failure
        // must be explicit and must never be followed by a reset-success message.
        Object.assign(settings, values);
        return new Promise(resolve => {
            const failed = (error) => {
                setStatus(`자막 설정을 저장하지 못했습니다. 현재 선택은 다음에 다시 열 때 유지되지 않을 수 있습니다. ${ToolboxShared.errorMessage(error)}`, "error");
                resolve(false);
            };
            if (!storageArea || typeof storageArea.set !== "function") {
                failed(new Error("Chrome 저장소를 사용할 수 없습니다."));
                return;
            }
            try {
                storageArea.set(values, () => {
                    const error = getRuntimeErrorMessage();
                    if (error)
                        failed(new Error(error));
                    else
                        resolve(true);
                });
            }
            catch (error) {
                failed(error);
            }
        });
    }
    async function loadStoredSettings() {
        const start = settingsJournal.mark();
        const stored = await ToolboxShared.readStorage(storageArea, globalThis.chrome?.runtime, DEFAULTS);
        settings = normalizeSettings(settingsJournal.merge(stored, start));
        return settings;
    }
    function normalizeSyncedCaptionStatus(value, expectedVideoId = "") {
        const source = value && typeof value === "object" ? value : {};
        const videoId = String(source.videoId || "");
        const active = source.active === true && (!expectedVideoId || !videoId || videoId === expectedVideoId);
        if (!active)
            return { active: false };
        return {
            active: true,
            videoId,
            sourceTrackId: String(source.sourceTrackId || ""),
            sourceTrackLabel: String(source.sourceTrackLabel || ""),
            sourceLanguageCode: String(source.sourceLanguageCode || ""),
            translationLanguageCode: String(source.translationLanguageCode || ""),
            translationLanguageName: String(source.translationLanguageName || ""),
            entryCount: Math.max(0, Math.round(Number(source.entryCount) || 0)),
            format: String(source.format || ""),
            installedAt: Math.max(0, Math.round(Number(source.installedAt) || 0))
        };
    }
    function makeTrackPreference(track) {
        if (!track)
            return "";
        return `${String(track.languageCode || "und").toLowerCase()}|${track.isAutoGenerated ? "auto" : "manual"}`;
    }
    function chooseTrackIndex(info, preferredValue, previousIndex = -1) {
        const tracks = Array.isArray(info?.tracks) ? info.tracks : [];
        if (tracks.length === 0)
            return -1;
        if (Number.isInteger(previousIndex) && previousIndex >= 0 && previousIndex < tracks.length) {
            return previousIndex;
        }
        if (preferredValue) {
            const preferredIndex = tracks.findIndex((track) => makeTrackPreference(track) === preferredValue);
            if (preferredIndex >= 0)
                return preferredIndex;
        }
        const defaultIndex = tracks.findIndex((track) => track.isDefault === true);
        return defaultIndex >= 0 ? defaultIndex : 0;
    }
    function getSelectedTrack(entry) {
        if (!entry?.info || !Array.isArray(entry.info.tracks))
            return null;
        return entry.info.tracks[entry.trackIndex] || null;
    }
    function normalizeTranslationForEntry(entry, preferredLanguage = "") {
        const track = getSelectedTrack(entry);
        const languages = Array.isArray(entry?.info?.translationLanguages)
            ? entry.info.translationLanguages
            : [];
        if (!track || track.isTranslatable === false)
            return "";
        return languages.some((language) => language.languageCode === preferredLanguage)
            ? preferredLanguage
            : "";
    }
    function createTabEntry(tab, previous = null) {
        const samePage = previous && previous.url === tab.url;
        return {
            id: tab.id,
            index: typeof tab.index === "number" && Number.isInteger(tab.index) ? tab.index : 0,
            title: String(tab.title || "제목 없는 유튜브 영상"),
            url: String(tab.url || ""),
            active: tab.active === true,
            pinned: tab.pinned === true,
            selected: selectedTabIds.has(tab.id),
            infoState: samePage ? previous.infoState : "idle",
            info: samePage ? previous.info : null,
            infoError: samePage ? previous.infoError : "",
            infoPromise: null,
            trackIndex: samePage ? previous.trackIndex : -1,
            translationLanguageCode: samePage ? previous.translationLanguageCode : "",
            transcriptCache: samePage ? previous.transcriptCache : new Map(),
            operationState: "",
            operationMessage: ""
        };
    }
    function getSelectedEntries() {
        return tabEntries
            .filter((entry) => selectedTabIds.has(entry.id))
            .sort((first, second) => first.index - second.index);
    }
    function updateSummary() {
        const total = tabEntries.length;
        const selected = getSelectedEntries().length;
        if (listLoading) {
            summary.textContent = "현재 창의 유튜브 영상 탭을 확인하는 중입니다.";
            listSummary.textContent = "탭 목록을 불러오는 중입니다.";
        }
        else if (total === 0) {
            summary.textContent = "현재 창에 열린 유튜브 영상이나 Shorts 탭이 없습니다.";
            listSummary.textContent = "자막을 추출할 수 있는 유튜브 탭이 없습니다.";
        }
        else {
            summary.textContent = `${total}개 유튜브 탭 · ${selected}개 선택`;
            listSummary.textContent = `현재 창에서 ${total}개의 유튜브 영상 또는 Shorts 탭을 찾았습니다.`;
        }
        selectedCount.textContent = `${selected}개 선택`;
    }
    function updateControls() {
        const selected = getSelectedEntries().length;
        const generalDisabled = !settingsReady || listLoading || operationBusy;
        refreshButton.disabled = listLoading || operationBusy;
        selectAllButton.disabled = generalDisabled || tabEntries.length === 0 || selected >= Math.min(tabEntries.length, MAX_SELECTED_TABS);
        clearButton.disabled = generalDisabled || selected === 0;
        includeTitleToggle.disabled = generalDisabled;
        includeTimeToggle.disabled = generalDisabled;
        spacingSelect.disabled = generalDisabled;
        syncedCaptionFontSizeInput.disabled = generalDisabled;
        syncedCaptionMaxWidthInput.disabled = generalDisabled;
        syncedCaptionPreferredLineCountSelect.disabled = generalDisabled;
        syncedCaptionPositionResetButton.disabled = generalDisabled;
        syncedCaptionApplyButton.disabled = generalDisabled || selected === 0;
        syncedCaptionRemoveButton.disabled = generalDisabled || selected === 0;
        copyButton.disabled = generalDisabled || selected === 0;
        downloadButton.disabled = generalDisabled || selected === 0;
        separateDownloadButton.disabled = generalDisabled || selected < 2;
    }
    function makeBadge(text, modifier = "") {
        const badge = document.createElement("span");
        badge.className = `youtube-transcript-tab__badge${modifier ? ` youtube-transcript-tab__badge--${modifier}` : ""}`;
        badge.textContent = text;
        return badge;
    }
    function renderEntryControls(entry, container) {
        if (!entry.selected)
            return;
        const controls = document.createElement("div");
        controls.className = "youtube-transcript-tab__controls";
        if (entry.infoState === "loading") {
            const loading = document.createElement("p");
            loading.className = "youtube-transcript-tab__message youtube-transcript-tab__message--working";
            loading.textContent = "자막 목록을 불러오는 중입니다.";
            controls.appendChild(loading);
            container.appendChild(controls);
            return;
        }
        if (entry.infoState === "error") {
            const error = document.createElement("p");
            error.className = "youtube-transcript-tab__message youtube-transcript-tab__message--error";
            error.textContent = entry.infoError || "자막 목록을 불러오지 못했습니다.";
            controls.appendChild(error);
            const retry = document.createElement("button");
            retry.className = "text-button youtube-transcript-tab__retry";
            retry.type = "button";
            retry.textContent = "다시 시도";
            retry.disabled = operationBusy;
            retry.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                void ensureCaptionInfo(entry, true).catch(() => { });
            });
            controls.appendChild(retry);
            container.appendChild(controls);
            return;
        }
        if (entry.infoState !== "ready" || !entry.info) {
            const waiting = document.createElement("p");
            waiting.className = "youtube-transcript-tab__message";
            waiting.textContent = "이 탭을 선택하면 자막 목록을 확인합니다.";
            controls.appendChild(waiting);
            container.appendChild(controls);
            return;
        }
        const trackField = document.createElement("label");
        trackField.className = "youtube-transcript-tab__field";
        const trackLabel = document.createElement("span");
        trackLabel.textContent = "원본 자막";
        const trackSelect = document.createElement("select");
        trackSelect.setAttribute("aria-label", `${entry.info.title || entry.title} 원본 자막`);
        trackSelect.disabled = operationBusy;
        entry.info.tracks.forEach((track, index) => {
            const option = document.createElement("option");
            option.value = String(index);
            option.textContent = track.label || track.name || track.languageCode || `자막 ${index + 1}`;
            trackSelect.appendChild(option);
        });
        trackSelect.value = String(entry.trackIndex);
        trackSelect.addEventListener("change", (event) => {
            event.stopPropagation();
            const nextIndex = Number(trackSelect.value);
            if (!Number.isInteger(nextIndex) || nextIndex < 0 || !entry.info || nextIndex >= entry.info.tracks.length)
                return;
            entry.trackIndex = nextIndex;
            entry.translationLanguageCode = normalizeTranslationForEntry(entry, settings[STORAGE_KEYS.translationLanguage]);
            entry.transcriptCache.clear();
            if (entry.info?.syncedCaption?.active) {
                entry.operationState = "ready";
                entry.operationMessage = "자막 선택이 바뀌었습니다. 배속 동기화 자막을 다시 적용하세요.";
            }
            saveStoredValues({ [STORAGE_KEYS.sourcePreference]: makeTrackPreference(getSelectedTrack(entry)) });
            renderTabList();
        });
        trackField.append(trackLabel, trackSelect);
        const languageField = document.createElement("label");
        languageField.className = "youtube-transcript-tab__field";
        const languageLabel = document.createElement("span");
        languageLabel.textContent = "유튜브 자동 번역";
        const languageSelect = document.createElement("select");
        languageSelect.setAttribute("aria-label", `${entry.info.title || entry.title} 자동 번역 언어`);
        languageSelect.disabled = operationBusy;
        const originalOption = document.createElement("option");
        originalOption.value = "";
        originalOption.textContent = "번역하지 않음 · 원본 자막";
        languageSelect.appendChild(originalOption);
        const selectedTrack = getSelectedTrack(entry);
        if (selectedTrack?.isTranslatable !== false) {
            for (const language of entry.info.translationLanguages) {
                const option = document.createElement("option");
                option.value = language.languageCode;
                option.textContent = language.name || language.languageCode;
                languageSelect.appendChild(option);
            }
        }
        entry.translationLanguageCode = normalizeTranslationForEntry(entry, entry.translationLanguageCode);
        languageSelect.value = entry.translationLanguageCode;
        languageSelect.disabled = operationBusy || !selectedTrack || selectedTrack.isTranslatable === false || languageSelect.options.length <= 1;
        languageSelect.addEventListener("change", (event) => {
            event.stopPropagation();
            entry.translationLanguageCode = String(languageSelect.value || "");
            entry.transcriptCache.clear();
            if (entry.info?.syncedCaption?.active) {
                entry.operationState = "ready";
                entry.operationMessage = "번역 언어가 바뀌었습니다. 배속 동기화 자막을 다시 적용하세요.";
            }
            saveStoredValues({ [STORAGE_KEYS.translationLanguage]: entry.translationLanguageCode });
            renderTabList();
        });
        languageField.append(languageLabel, languageSelect);
        controls.append(trackField, languageField);
        let operationMessage = entry.operationMessage;
        let operationState = entry.operationState;
        if (!operationMessage && entry.info.syncedCaption?.active) {
            const synced = entry.info.syncedCaption;
            const sourceLabel = synced.translationLanguageName || synced.sourceTrackLabel || "선택한 자막";
            const count = Math.max(0, Number(synced.entryCount) || 0);
            operationMessage = `${sourceLabel} · ${count.toLocaleString()}개 문장의 배속 동기화 자막이 적용되어 있습니다.`;
            operationState = "success";
        }
        if (operationMessage) {
            const operation = document.createElement("p");
            operation.className = `youtube-transcript-tab__message${operationState ? ` youtube-transcript-tab__message--${operationState}` : ""}`;
            operation.textContent = operationMessage;
            controls.appendChild(operation);
        }
        container.appendChild(controls);
    }
    function renderTabList() {
        tabList.replaceChildren();
        if (listLoading) {
            const placeholder = document.createElement("p");
            placeholder.className = "youtube-transcript-tab-list__empty";
            placeholder.textContent = "현재 창의 유튜브 영상 탭을 불러오는 중입니다.";
            tabList.appendChild(placeholder);
            updateSummary();
            updateControls();
            return;
        }
        if (tabEntries.length === 0) {
            const empty = document.createElement("p");
            empty.className = "youtube-transcript-tab-list__empty";
            empty.textContent = "일반 영상, Shorts 또는 라이브 영상 탭을 열고 새로고침을 누르세요.";
            tabList.appendChild(empty);
            updateSummary();
            updateControls();
            return;
        }
        for (const entry of tabEntries) {
            entry.selected = selectedTabIds.has(entry.id);
            const row = document.createElement("div");
            row.className = "youtube-transcript-tab";
            row.dataset.selected = String(entry.selected);
            row.dataset.state = entry.infoState;
            row.dataset.tabId = String(entry.id);
            const header = document.createElement("label");
            header.className = "youtube-transcript-tab__header";
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = entry.selected;
            checkbox.disabled = operationBusy;
            checkbox.setAttribute("aria-label", `${entry.title} 자막 선택`);
            checkbox.addEventListener("change", () => {
                if (checkbox.checked) {
                    if (selectedTabIds.size >= MAX_SELECTED_TABS) {
                        checkbox.checked = false;
                        setStatus(`한 번에 최대 ${MAX_SELECTED_TABS}개의 유튜브 탭을 선택할 수 있습니다.`, "error");
                        return;
                    }
                    selectedTabIds.add(entry.id);
                    entry.selected = true;
                    renderTabList();
                    void ensureCaptionInfo(entry).catch(() => { });
                }
                else {
                    selectedTabIds.delete(entry.id);
                    entry.selected = false;
                    renderTabList();
                }
            });
            const copy = document.createElement("span");
            copy.className = "youtube-transcript-tab__copy";
            const titleRow = document.createElement("span");
            titleRow.className = "youtube-transcript-tab__title-row";
            const title = document.createElement("span");
            title.className = "youtube-transcript-tab__title";
            title.textContent = entry.info?.title || entry.title;
            title.title = entry.info?.title || entry.title;
            titleRow.appendChild(title);
            if (entry.active)
                titleRow.appendChild(makeBadge("현재", "current"));
            if (entry.pinned)
                titleRow.appendChild(makeBadge("고정됨", "pinned"));
            if (entry.infoState === "ready" && entry.info)
                titleRow.appendChild(makeBadge(`${entry.info.tracks.length}개 자막`, "captions"));
            if (entry.info?.syncedCaption?.active)
                titleRow.appendChild(makeBadge("배속 동기화", "synced"));
            const url = document.createElement("span");
            url.className = "youtube-transcript-tab__url";
            url.textContent = getDisplayUrl(entry.url);
            url.title = entry.url;
            copy.append(titleRow, url);
            header.append(checkbox, copy);
            row.appendChild(header);
            renderEntryControls(entry, row);
            tabList.appendChild(row);
        }
        updateSummary();
        updateControls();
    }
    async function ensureCaptionInfo(entry, force = false) {
        if (!entry || !selectedTabIds.has(entry.id))
            return null;
        if (!force && entry.infoState === "ready" && entry.info)
            return entry.info;
        if (!force && entry.infoPromise)
            return entry.infoPromise;
        entry.infoState = "loading";
        entry.infoError = "";
        entry.operationMessage = "";
        renderTabList();
        const promise = sendRuntimeMessage({
            type: MESSAGE_TYPES.GET_INFO,
            tabId: entry.id
        }).then((response) => {
            const tracks = Array.isArray(response.tracks) ? response.tracks : [];
            if (tracks.length === 0)
                throw new Error("이 영상에서 사용할 수 있는 자막을 찾지 못했습니다.");
            const previousIndex = force ? -1 : entry.trackIndex;
            entry.info = {
                videoId: String(response.videoId || ""),
                title: String(response.title || entry.title || "YouTube 영상"),
                pageUrl: String(response.pageUrl || entry.url),
                tracks,
                translationLanguages: Array.isArray(response.translationLanguages) ? response.translationLanguages : [],
                syncedCaption: normalizeSyncedCaptionStatus(response.syncedCaption, String(response.videoId || ""))
            };
            entry.infoState = "ready";
            entry.infoError = "";
            entry.trackIndex = chooseTrackIndex(entry.info, settings[STORAGE_KEYS.sourcePreference], previousIndex);
            entry.translationLanguageCode = normalizeTranslationForEntry(entry, entry.translationLanguageCode || settings[STORAGE_KEYS.translationLanguage]);
            entry.transcriptCache.clear();
            return entry.info;
        }).catch((error) => {
            entry.info = null;
            entry.infoState = "error";
            entry.infoError = String(error?.message || "자막 목록을 불러오지 못했습니다.");
            throw error;
        }).finally(() => {
            entry.infoPromise = null;
            renderTabList();
        });
        entry.infoPromise = promise;
        return promise;
    }
    async function runWithConcurrency(items, limit, worker) {
        const queue = [...items];
        const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
            while (queue.length > 0) {
                const item = queue.shift(); // The length check and shift are synchronous.
                try {
                    await worker(item);
                }
                catch {
                    // Each entry displays its own error; loading the remaining tabs continues.
                }
            }
        });
        await Promise.all(workers);
    }
    async function loadYouTubeTabs(force = false) {
        if (listLoading || operationBusy)
            return;
        listLoading = true;
        renderTabList();
        try {
            const tabs = await queryCurrentWindowTabs();
            const youtubeTabs = tabs
                .filter((tab) => typeof tab.id === "number" && Number.isInteger(tab.id) && isYouTubeVideoUrl(tab.url))
                .sort((first, second) => (first.index || 0) - (second.index || 0));
            const previousById = new Map(tabEntries.map((entry) => [entry.id, entry]));
            const previousSelection = new Set(selectedTabIds);
            if (tabEntries.length === 0 && previousSelection.size === 0) {
                const activeYouTubeTab = youtubeTabs.find((tab) => tab.active);
                if (activeYouTubeTab)
                    previousSelection.add(activeYouTubeTab.id);
                else if (youtubeTabs.length === 1)
                    previousSelection.add(youtubeTabs[0].id);
            }
            selectedTabIds = new Set([...previousSelection].filter((tabId) => youtubeTabs.some((tab) => tab.id === tabId)));
            tabEntries = youtubeTabs.map((tab) => createTabEntry(tab, force ? null : previousById.get(tab.id) ?? null));
        }
        catch (error) {
            tabEntries = [];
            selectedTabIds.clear();
            setStatus(String(error?.message || "유튜브 탭 목록을 불러오지 못했습니다."), "error");
        }
        finally {
            listLoading = false;
            renderTabList();
        }
        const selectedEntries = getSelectedEntries();
        if (selectedEntries.length > 0) {
            await runWithConcurrency(selectedEntries, INFO_CONCURRENCY, (entry) => ensureCaptionInfo(entry, force));
        }
    }
    function formatTimestamp(startMs) {
        const totalSeconds = Math.max(0, Math.floor((Number(startMs) || 0) / 1000));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        const pad = (value) => String(value).padStart(2, "0");
        return hours > 0
            ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
            : `${pad(minutes)}:${pad(seconds)}`;
    }
    function normalizeCaptionText(value) {
        return String(value || "")
            .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
            .replace(/\u00A0/g, " ")
            .replace(/[\r\n\t]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }
    function buildTranscriptText(response) {
        const entries = Array.isArray(response?.entries) ? response.entries : [];
        const lineSeparator = "\r\n".repeat(settings[STORAGE_KEYS.blankLines] + 1);
        const lines = entries.map((entry) => {
            const text = normalizeCaptionText(entry?.text);
            if (!text)
                return "";
            return settings[STORAGE_KEYS.includeTimestamps]
                ? `[${formatTimestamp(entry?.startMs)}] ${text}`
                : text;
        }).filter(Boolean);
        if (lines.length === 0)
            throw new Error("읽을 수 있는 자막 문장이 없습니다.");
        const body = lines.join(lineSeparator);
        if (!settings[STORAGE_KEYS.includeTitle])
            return body;
        const title = normalizeCaptionText(response?.title) || "YouTube 영상";
        return `${title}\r\n\r\n${body}`;
    }
    function getTranscriptCacheKey(entry) {
        const track = getSelectedTrack(entry);
        return `${entry.info?.videoId || ""}|${track?.id || entry.trackIndex}|${entry.translationLanguageCode || ""}`;
    }
    async function getTranscript(entry) {
        await ensureCaptionInfo(entry);
        const track = getSelectedTrack(entry);
        if (!track || !entry.info)
            throw new Error("사용할 원본 자막을 선택하지 못했습니다.");
        const cacheKey = getTranscriptCacheKey(entry);
        const cached = entry.transcriptCache.get(cacheKey);
        if (cached)
            return cached;
        const response = await sendRuntimeMessage({
            type: MESSAGE_TYPES.GET_TRANSCRIPT,
            tabId: entry.id,
            trackIndex: entry.trackIndex,
            trackId: track.id,
            translationLanguageCode: entry.translationLanguageCode,
            expectedVideoId: entry.info.videoId
        }, 90000);
        entry.transcriptCache.set(cacheKey, response);
        return response;
    }
    function getActionLabel(kind) {
        if (kind === "syncedApply")
            return syncedCaptionApplyLabel;
        if (kind === "syncedRemove")
            return syncedCaptionRemoveLabel;
        if (kind === "copy")
            return copyLabel;
        if (kind === "combined")
            return downloadLabel;
        return separateDownloadLabel;
    }
    function getActionDefaultLabel(kind) {
        if (kind === "syncedApply")
            return baseButtonLabels.syncedApply;
        if (kind === "syncedRemove")
            return baseButtonLabels.syncedRemove;
        if (kind === "copy")
            return baseButtonLabels.copy;
        if (kind === "combined")
            return baseButtonLabels.combined;
        return baseButtonLabels.separate;
    }
    function setBusyState(kind, busy, progressText = "") {
        operationBusy = busy;
        syncedCaptionApplyButton.setAttribute("aria-busy", String(busy && kind === "syncedApply"));
        syncedCaptionRemoveButton.setAttribute("aria-busy", String(busy && kind === "syncedRemove"));
        copyButton.setAttribute("aria-busy", String(busy && kind === "copy"));
        downloadButton.setAttribute("aria-busy", String(busy && kind === "combined"));
        separateDownloadButton.setAttribute("aria-busy", String(busy && kind === "separate"));
        for (const actionKind of ["syncedApply", "syncedRemove", "copy", "combined", "separate"]) {
            getActionLabel(actionKind).textContent = busy && kind === actionKind
                ? progressText
                : getActionDefaultLabel(actionKind);
        }
        renderTabList();
    }
    function flashButtonLabel(kind, text) {
        if (transientLabelTimer)
            window.clearTimeout(transientLabelTimer);
        const label = getActionLabel(kind);
        const defaultText = getActionDefaultLabel(kind);
        label.textContent = text;
        transientLabelTimer = window.setTimeout(() => {
            transientLabelTimer = 0;
            if (!operationBusy)
                label.textContent = defaultText;
        }, 1900);
    }
    async function collectSelectedTranscripts(kind) {
        const entries = getSelectedEntries();
        if (entries.length === 0)
            throw new Error("자막을 추출할 유튜브 탭을 선택하세요.");
        const results = [];
        const failures = [];
        for (let index = 0; index < entries.length; index += 1) {
            const entry = entries[index];
            const progress = `${index + 1}/${entries.length} 처리 중`;
            entry.operationState = "working";
            entry.operationMessage = progress;
            if (kind === "copy")
                copyLabel.textContent = progress;
            else if (kind === "combined")
                downloadLabel.textContent = progress;
            else
                separateDownloadLabel.textContent = progress;
            renderTabList();
            try {
                const response = await getTranscript(entry);
                const text = buildTranscriptText(response);
                results.push({
                    tabId: entry.id,
                    index: entry.index,
                    videoId: response.videoId || entry.info?.videoId || "video",
                    title: response.title || entry.info?.title || entry.title,
                    text
                });
                entry.operationState = "success";
                entry.operationMessage = "자막을 준비했습니다.";
            }
            catch (error) {
                const message = String(error?.message || "자막을 가져오지 못했습니다.");
                failures.push({ tabId: entry.id, title: entry.info?.title || entry.title, error: message });
                entry.operationState = "error";
                entry.operationMessage = message;
            }
            renderTabList();
        }
        if (results.length === 0) {
            throw new Error(failures[0]?.error || "선택한 탭에서 자막을 가져오지 못했습니다.");
        }
        return { results, failures, selectedCount: entries.length };
    }
    async function writeClipboard(text) {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
            await navigator.clipboard.writeText(text);
            return;
        }
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        textarea.style.pointerEvents = "none";
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand("copy");
        textarea.remove();
        if (!copied)
            throw new Error("클립보드에 자막을 복사하지 못했습니다.");
    }
    function makeCompletionMessage(action, collected) {
        const succeeded = collected.results.length;
        const failed = collected.failures.length;
        const actionText = action === "copy"
            ? "클립보드에 복사했습니다"
            : action === "combined"
                ? "한 개의 텍스트 파일 다운로드를 시작했습니다"
                : "개별 텍스트 파일 다운로드를 시작했습니다";
        return failed > 0
            ? `${succeeded}개 자막을 ${actionText}. ${failed}개 탭은 오류로 건너뛰었습니다.`
            : `${succeeded}개 자막을 ${actionText}.`;
    }
    async function performSyncedCaptionAction(kind) {
        if (operationBusy)
            return;
        const entries = getSelectedEntries();
        if (entries.length === 0) {
            setStatus("배속 동기화 자막을 적용하거나 해제할 유튜브 탭을 선택하세요.", "error");
            return;
        }
        setBusyState(kind, true, "준비 중");
        setStatus(kind === "syncedApply"
            ? "선택한 유튜브 탭의 자막을 브라우저 자막 트랙으로 준비하고 있습니다."
            : "선택한 유튜브 탭의 동기화 자막을 해제하고 있습니다.", "working");
        let succeeded = 0;
        let failed = 0;
        let firstError = "";
        try {
            for (let index = 0; index < entries.length; index += 1) {
                const entry = entries[index];
                const progress = `${index + 1}/${entries.length} 처리 중`;
                entry.operationState = "working";
                entry.operationMessage = progress;
                getActionLabel(kind).textContent = progress;
                renderTabList();
                try {
                    if (kind === "syncedApply") {
                        await ensureCaptionInfo(entry);
                        const track = getSelectedTrack(entry);
                        if (!entry.info || !track)
                            throw new Error("사용할 원본 자막을 선택하지 못했습니다.");
                        const response = await sendRuntimeMessage({
                            type: MESSAGE_TYPES.APPLY_SYNCED_CAPTIONS,
                            tabId: entry.id,
                            trackIndex: entry.trackIndex,
                            trackId: track.id,
                            translationLanguageCode: entry.translationLanguageCode,
                            expectedVideoId: entry.info.videoId
                        }, 90000);
                        entry.info.syncedCaption = normalizeSyncedCaptionStatus(response.syncedCaption, entry.info.videoId);
                        if (!entry.info.syncedCaption.active) {
                            throw new Error("브라우저 자막 트랙의 최종 적용 상태를 확인하지 못했습니다.");
                        }
                        const count = entry.info.syncedCaption.entryCount || 0;
                        entry.operationState = "success";
                        entry.operationMessage = `${count.toLocaleString()}개 문장의 배속 동기화 자막을 적용했습니다.`;
                    }
                    else {
                        await sendRuntimeMessage({
                            type: MESSAGE_TYPES.REMOVE_SYNCED_CAPTIONS,
                            tabId: entry.id
                        }, 30000);
                        if (entry.info)
                            entry.info.syncedCaption = { active: false };
                        entry.operationState = "success";
                        entry.operationMessage = "배속 동기화 자막을 해제하고 YouTube 기본 자막 상태를 복원했습니다.";
                    }
                    succeeded += 1;
                }
                catch (error) {
                    const message = String(error?.message || "동기화 자막 작업에 실패했습니다.");
                    if (!firstError)
                        firstError = message;
                    failed += 1;
                    entry.operationState = "error";
                    entry.operationMessage = message;
                }
                renderTabList();
            }
            if (succeeded === 0)
                throw new Error(firstError || "선택한 탭에서 동기화 자막 작업을 완료하지 못했습니다.");
            const actionText = kind === "syncedApply" ? "적용했습니다" : "해제했습니다";
            setStatus(failed > 0
                ? `${succeeded}개 탭에 배속 동기화 자막을 ${actionText}. ${failed}개 탭은 오류로 건너뛰었습니다.`
                : `${succeeded}개 탭에 배속 동기화 자막을 ${actionText}.`, failed > 0 ? "ready" : "success");
        }
        catch (error) {
            setStatus(String(error?.message || "유튜브 동기화 자막 작업에 실패했습니다."), "error");
        }
        finally {
            setBusyState(kind, false);
            if (succeeded > 0)
                flashButtonLabel(kind, kind === "syncedApply" ? "적용 완료" : "해제 완료");
        }
    }
    async function performAction(kind) {
        if (operationBusy)
            return;
        let completionLabel = "";
        setBusyState(kind, true, "준비 중");
        setStatus("선택한 유튜브 탭의 자막을 확인하고 있습니다.", "working");
        try {
            const collected = await collectSelectedTranscripts(kind);
            if (kind === "copy") {
                const combinedText = collected.results.map((item) => item.text).join(COMBINED_TRANSCRIPT_SEPARATOR);
                await writeClipboard(combinedText);
                completionLabel = "복사 완료";
            }
            else if (kind === "combined") {
                const combinedText = collected.results.map((item) => item.text).join(COMBINED_TRANSCRIPT_SEPARATOR);
                await sendRuntimeMessage({
                    type: MESSAGE_TYPES.SAVE_TEXT,
                    text: combinedText,
                    title: collected.results[0]?.title || "YouTube 자막 모음",
                    videoId: collected.results.length === 1 ? collected.results[0].videoId : "batch",
                    combinedCount: collected.results.length
                });
                completionLabel = "다운로드 시작";
            }
            else {
                await sendRuntimeMessage({
                    type: MESSAGE_TYPES.SAVE_BATCH,
                    files: collected.results.map((item) => ({
                        videoId: item.videoId,
                        title: item.title,
                        text: item.text
                    }))
                }, 90000);
                completionLabel = "다운로드 시작";
            }
            setStatus(makeCompletionMessage(kind, collected), collected.failures.length > 0 ? "ready" : "success");
        }
        catch (error) {
            setStatus(String(error?.message || "유튜브 자막 작업에 실패했습니다."), "error");
        }
        finally {
            setBusyState(kind, false);
            if (completionLabel)
                flashButtonLabel(kind, completionLabel);
        }
    }
    function updateSyncedCaptionFontSizeControl(value) {
        const normalized = normalizeSyncedCaptionFontSize(value);
        syncedCaptionFontSizeInput.value = String(normalized);
        syncedCaptionFontSizeValue.value = `${normalized}px`;
        syncedCaptionFontSizeValue.textContent = `${normalized}px`;
        return normalized;
    }
    function updateSyncedCaptionMaxWidthControl(value) {
        const normalized = normalizeSyncedCaptionMaxWidthPercent(value);
        syncedCaptionMaxWidthInput.value = String(normalized);
        syncedCaptionMaxWidthValue.value = `${normalized}%`;
        syncedCaptionMaxWidthValue.textContent = `${normalized}%`;
        return normalized;
    }
    function updateSyncedCaptionPreferredLineCountControl(value) {
        const normalized = normalizeSyncedCaptionPreferredLineCount(value);
        syncedCaptionPreferredLineCountSelect.value = String(normalized);
        return normalized;
    }
    function applySettingsToControls() {
        includeTitleToggle.checked = settings[STORAGE_KEYS.includeTitle];
        includeTimeToggle.checked = settings[STORAGE_KEYS.includeTimestamps];
        spacingSelect.value = String(settings[STORAGE_KEYS.blankLines]);
        updateSyncedCaptionFontSizeControl(settings[STORAGE_KEYS.syncedCaptionFontSize]);
        updateSyncedCaptionMaxWidthControl(settings[STORAGE_KEYS.syncedCaptionMaxWidthPercent]);
        updateSyncedCaptionPreferredLineCountControl(settings[STORAGE_KEYS.syncedCaptionPreferredLineCount]);
    }
    async function initialize() {
        if (!toggle || !dropdown || !tabList)
            return;
        updateControls();
        try {
            await loadStoredSettings();
        }
        catch (error) {
            settingsReady = false;
            updateControls();
            setStatus(`자막 설정을 읽지 못했습니다. 설정을 기본값으로 대체하지 않았습니다. 패널을 다시 열어 주세요. ${ToolboxShared.errorMessage(error)}`, "error");
            return;
        }
        settingsReady = true;
        applySettingsToControls();
        updateSummary();
        updateControls();
        toggle.addEventListener("click", () => {
            const nextOpen = dropdown.hidden;
            if (nextOpen) {
                closeOtherDropdowns();
                setOpen(true);
                if (tabEntries.length === 0 && !listLoading)
                    void loadYouTubeTabs();
            }
            else {
                setOpen(false);
            }
        });
        refreshButton.addEventListener("click", () => {
            void loadYouTubeTabs(true);
        });
        selectAllButton.addEventListener("click", () => {
            const limitedEntries = tabEntries.slice(0, MAX_SELECTED_TABS);
            selectedTabIds = new Set(limitedEntries.map((entry) => entry.id));
            renderTabList();
            if (tabEntries.length > MAX_SELECTED_TABS) {
                setStatus(`처음 ${MAX_SELECTED_TABS}개의 유튜브 탭을 선택했습니다.`, "ready");
            }
            void runWithConcurrency(limitedEntries, INFO_CONCURRENCY, (entry) => ensureCaptionInfo(entry));
        });
        clearButton.addEventListener("click", () => {
            selectedTabIds.clear();
            for (const entry of tabEntries)
                entry.selected = false;
            renderTabList();
        });
        includeTitleToggle.addEventListener("change", () => {
            saveStoredValues({ [STORAGE_KEYS.includeTitle]: includeTitleToggle.checked });
        });
        includeTimeToggle.addEventListener("change", () => {
            saveStoredValues({ [STORAGE_KEYS.includeTimestamps]: includeTimeToggle.checked });
        });
        spacingSelect.addEventListener("change", () => {
            const blankLines = normalizeBlankLines(spacingSelect.value);
            spacingSelect.value = String(blankLines);
            saveStoredValues({ [STORAGE_KEYS.blankLines]: blankLines });
        });
        syncedCaptionFontSizeInput.addEventListener("input", () => {
            const fontSize = updateSyncedCaptionFontSizeControl(syncedCaptionFontSizeInput.value);
            saveStoredValues({ [STORAGE_KEYS.syncedCaptionFontSize]: fontSize });
        });
        syncedCaptionMaxWidthInput.addEventListener("input", () => {
            const maxWidthPercent = updateSyncedCaptionMaxWidthControl(syncedCaptionMaxWidthInput.value);
            saveStoredValues({ [STORAGE_KEYS.syncedCaptionMaxWidthPercent]: maxWidthPercent });
        });
        syncedCaptionPreferredLineCountSelect.addEventListener("change", () => {
            const preferredLineCount = updateSyncedCaptionPreferredLineCountControl(syncedCaptionPreferredLineCountSelect.value);
            saveStoredValues({ [STORAGE_KEYS.syncedCaptionPreferredLineCount]: preferredLineCount });
        });
        syncedCaptionPositionResetButton.addEventListener("click", () => {
            syncedCaptionPositionResetButton.disabled = true;
            void saveStoredValues({
                [STORAGE_KEYS.syncedCaptionPosition]: { ...SYNCED_CAPTION_DEFAULT_POSITION }
            }).then(saved => {
                if (saved)
                    setStatus("기본 자막 위치를 저장했습니다. 표시 중인 영상에는 설정 변경이 전달됩니다.", "success");
            }).finally(() => updateControls());
        });
        syncedCaptionApplyButton.addEventListener("click", () => void performSyncedCaptionAction("syncedApply"));
        syncedCaptionRemoveButton.addEventListener("click", () => void performSyncedCaptionAction("syncedRemove"));
        copyButton.addEventListener("click", () => void performAction("copy"));
        downloadButton.addEventListener("click", () => void performAction("combined"));
        separateDownloadButton.addEventListener("click", () => void performAction("separate"));
        for (const [, toggleId] of otherDropdownPairs) {
            document.getElementById(toggleId)?.addEventListener("click", closeYouTubeDropdown);
        }
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && !dropdown.hidden && !operationBusy)
                closeYouTubeDropdown();
        });
        document.documentElement.dataset.popupCaptionsReady = "true";
        document.dispatchEvent(new Event("browser-toolbox-popup-ready"));
    }
    globalThis.chrome?.storage?.onChanged?.addListener((changes, area) => {
        if (area !== "local" || !Object.keys(DEFAULTS).some(key => Object.hasOwn(changes, key)))
            return;
        settingsJournal.record(changes);
        if (!settingsReady)
            return;
        const actual = { ...settings };
        for (const key of Object.keys(DEFAULTS))
            if (Object.hasOwn(changes, key)) {
                actual[key] = changes[key].newValue;
            }
        settings = normalizeSettings(actual);
        applySettingsToControls();
    });
    void initialize();
})();
