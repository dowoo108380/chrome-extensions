(() => {
  "use strict";

  const MESSAGE_TYPES = Object.freeze({
    GET_INFO: "youtube-transcript:get-info",
    GET_TRANSCRIPT: "youtube-transcript:get-transcript",
    SAVE_TEXT: "youtube-transcript:save-text",
    SAVE_BATCH: "youtube-transcript:save-batch"
  });

  const STORAGE_KEYS = Object.freeze({
    includeTitle: "youtubeTranscriptIncludeTitle",
    includeTimestamps: "youtubeTranscriptIncludeTimestamps",
    blankLines: "youtubeTranscriptBlankLines",
    sourcePreference: "youtubeTranscriptSourcePreference",
    translationLanguage: "youtubeTranscriptTranslationLanguage"
  });

  const DEFAULTS = Object.freeze({
    [STORAGE_KEYS.includeTitle]: true,
    [STORAGE_KEYS.includeTimestamps]: false,
    [STORAGE_KEYS.blankLines]: 0,
    [STORAGE_KEYS.sourcePreference]: "",
    [STORAGE_KEYS.translationLanguage]: ""
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
  const status = document.getElementById("status");
  const storageArea = globalThis.chrome?.storage?.local;

  const otherDropdownPairs = Object.freeze([
    ["media-dropdown", "media-toggle"],
    ["page-unlock-dropdown", "page-unlock-toggle"],
    ["element-eraser-dropdown", "element-eraser-toggle"],
    ["tab-url-dropdown", "tab-url-toggle"]
  ]);

  const baseButtonLabels = Object.freeze({
    copy: "선택 자막 모두 복사",
    combined: "한 파일로 저장",
    separate: "개별 파일 일괄 저장"
  });

  let settings = { ...DEFAULTS };
  let settingsReady = false;
  let listLoading = false;
  let operationBusy = false;
  let tabEntries = [];
  let selectedTabIds = new Set();
  let transientLabelTimer = 0;

  function setStatus(message, state = "ready") {
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
  }

  function getRuntimeErrorMessage() {
    return globalThis.chrome?.runtime?.lastError?.message || "";
  }

  function normalizeBlankLines(value) {
    const numeric = Math.round(Number(value));
    return Number.isFinite(numeric) ? Math.min(3, Math.max(0, numeric)) : 0;
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
      [STORAGE_KEYS.blankLines]: normalizeBlankLines(
        Object.prototype.hasOwnProperty.call(source, STORAGE_KEYS.blankLines)
          ? source[STORAGE_KEYS.blankLines]
          : DEFAULTS[STORAGE_KEYS.blankLines]
      ),
      [STORAGE_KEYS.sourcePreference]: String(source[STORAGE_KEYS.sourcePreference] || ""),
      [STORAGE_KEYS.translationLanguage]: String(source[STORAGE_KEYS.translationLanguage] || "")
    };
  }

  function isYouTubeVideoUrl(rawUrl) {
    try {
      const url = new URL(String(rawUrl || ""));
      const host = url.hostname.toLowerCase();
      if (!(host === "youtube.com" || host.endsWith(".youtube.com"))) return false;
      if (url.pathname === "/watch") return Boolean(url.searchParams.get("v"));
      return /^\/(?:shorts|live|embed)\/[^/?#]+/i.test(url.pathname);
    } catch {
      return false;
    }
  }

  function getDisplayUrl(rawUrl) {
    try {
      const url = new URL(String(rawUrl || ""));
      return `${url.hostname}${url.pathname}${url.search}`;
    } catch {
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

  function sendRuntimeMessage(message, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      const runtime = globalThis.chrome?.runtime;
      if (!runtime || typeof runtime.sendMessage !== "function") {
        reject(new Error("확장 프로그램의 백그라운드 기능을 사용할 수 없습니다."));
        return;
      }

      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("유튜브 자막 요청 시간이 초과되었습니다."));
      }, timeoutMs);

      try {
        runtime.sendMessage(message, (response) => {
          if (settled) return;
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
      } catch (error) {
        if (settled) return;
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
      if (otherDropdown) otherDropdown.hidden = true;
      if (otherToggle) otherToggle.setAttribute("aria-expanded", "false");
    }
  }

  function setOpen(open) {
    if (!dropdown || !toggle) return;
    dropdown.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  }

  function closeYouTubeDropdown() {
    setOpen(false);
  }

  function saveStoredValues(values) {
    Object.assign(settings, values);
    if (!storageArea || typeof storageArea.set !== "function") return;
    try {
      storageArea.set(values, () => {
        void getRuntimeErrorMessage();
      });
    } catch {
      // The current popup session can continue even if preferences are not persisted.
    }
  }

  function loadStoredSettings() {
    return new Promise((resolve) => {
      if (!storageArea || typeof storageArea.get !== "function") {
        settings = { ...DEFAULTS };
        resolve(settings);
        return;
      }

      try {
        storageArea.get(DEFAULTS, (stored) => {
          if (getRuntimeErrorMessage()) settings = { ...DEFAULTS };
          else settings = normalizeSettings(stored);
          resolve(settings);
        });
      } catch {
        settings = { ...DEFAULTS };
        resolve(settings);
      }
    });
  }

  function makeTrackPreference(track) {
    if (!track) return "";
    return `${String(track.languageCode || "und").toLowerCase()}|${track.isAutoGenerated ? "auto" : "manual"}`;
  }

  function chooseTrackIndex(info, preferredValue, previousIndex = -1) {
    const tracks = Array.isArray(info?.tracks) ? info.tracks : [];
    if (tracks.length === 0) return -1;
    if (Number.isInteger(previousIndex) && previousIndex >= 0 && previousIndex < tracks.length) {
      return previousIndex;
    }
    if (preferredValue) {
      const preferredIndex = tracks.findIndex((track) => makeTrackPreference(track) === preferredValue);
      if (preferredIndex >= 0) return preferredIndex;
    }
    const defaultIndex = tracks.findIndex((track) => track.isDefault === true);
    return defaultIndex >= 0 ? defaultIndex : 0;
  }

  function getSelectedTrack(entry) {
    if (!entry?.info || !Array.isArray(entry.info.tracks)) return null;
    return entry.info.tracks[entry.trackIndex] || null;
  }

  function normalizeTranslationForEntry(entry, preferredLanguage = "") {
    const track = getSelectedTrack(entry);
    const languages = Array.isArray(entry?.info?.translationLanguages)
      ? entry.info.translationLanguages
      : [];
    if (!track || track.isTranslatable === false) return "";
    return languages.some((language) => language.languageCode === preferredLanguage)
      ? preferredLanguage
      : "";
  }

  function createTabEntry(tab, previous = null) {
    const samePage = previous && previous.url === tab.url;
    return {
      id: tab.id,
      index: Number.isInteger(tab.index) ? tab.index : 0,
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

  function getEntry(tabId) {
    return tabEntries.find((entry) => entry.id === tabId) || null;
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
    } else if (total === 0) {
      summary.textContent = "현재 창에 열린 유튜브 영상이나 Shorts 탭이 없습니다.";
      listSummary.textContent = "자막을 추출할 수 있는 유튜브 탭이 없습니다.";
    } else {
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
    if (!entry.selected) return;

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
        void ensureCaptionInfo(entry, true).catch(() => {});
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
      if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= entry.info.tracks.length) return;
      entry.trackIndex = nextIndex;
      entry.translationLanguageCode = normalizeTranslationForEntry(entry, settings[STORAGE_KEYS.translationLanguage]);
      entry.transcriptCache.clear();
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
      saveStoredValues({ [STORAGE_KEYS.translationLanguage]: entry.translationLanguageCode });
    });
    languageField.append(languageLabel, languageSelect);

    controls.append(trackField, languageField);

    if (entry.operationMessage) {
      const operation = document.createElement("p");
      operation.className = `youtube-transcript-tab__message${entry.operationState ? ` youtube-transcript-tab__message--${entry.operationState}` : ""}`;
      operation.textContent = entry.operationMessage;
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
          void ensureCaptionInfo(entry).catch(() => {});
        } else {
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
      if (entry.active) titleRow.appendChild(makeBadge("현재", "current"));
      if (entry.pinned) titleRow.appendChild(makeBadge("고정됨", "pinned"));
      if (entry.infoState === "ready") titleRow.appendChild(makeBadge(`${entry.info.tracks.length}개 자막`, "captions"));

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
    if (!entry || !selectedTabIds.has(entry.id)) return null;
    if (!force && entry.infoState === "ready" && entry.info) return entry.info;
    if (!force && entry.infoPromise) return entry.infoPromise;

    entry.infoState = "loading";
    entry.infoError = "";
    entry.operationMessage = "";
    renderTabList();

    const promise = sendRuntimeMessage({
      type: MESSAGE_TYPES.GET_INFO,
      tabId: entry.id
    }).then((response) => {
      const tracks = Array.isArray(response.tracks) ? response.tracks : [];
      if (tracks.length === 0) throw new Error("이 영상에서 사용할 수 있는 자막을 찾지 못했습니다.");

      const previousIndex = force ? -1 : entry.trackIndex;
      entry.info = {
        videoId: String(response.videoId || ""),
        title: String(response.title || entry.title || "YouTube 영상"),
        pageUrl: String(response.pageUrl || entry.url),
        tracks,
        translationLanguages: Array.isArray(response.translationLanguages) ? response.translationLanguages : []
      };
      entry.infoState = "ready";
      entry.infoError = "";
      entry.trackIndex = chooseTrackIndex(entry.info, settings[STORAGE_KEYS.sourcePreference], previousIndex);
      entry.translationLanguageCode = normalizeTranslationForEntry(
        entry,
        entry.translationLanguageCode || settings[STORAGE_KEYS.translationLanguage]
      );
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
        const item = queue.shift();
        try {
          await worker(item);
        } catch {
          // Each entry displays its own error; loading the remaining tabs continues.
        }
      }
    });
    await Promise.all(workers);
  }

  async function loadYouTubeTabs(force = false) {
    if (listLoading || operationBusy) return;
    listLoading = true;
    renderTabList();

    try {
      const tabs = await queryCurrentWindowTabs();
      const youtubeTabs = tabs
        .filter((tab) => Number.isInteger(tab.id) && isYouTubeVideoUrl(tab.url))
        .sort((first, second) => (first.index || 0) - (second.index || 0));
      const previousById = new Map(tabEntries.map((entry) => [entry.id, entry]));
      const previousSelection = new Set(selectedTabIds);

      if (tabEntries.length === 0 && previousSelection.size === 0) {
        const activeYouTubeTab = youtubeTabs.find((tab) => tab.active);
        if (activeYouTubeTab) previousSelection.add(activeYouTubeTab.id);
        else if (youtubeTabs.length === 1) previousSelection.add(youtubeTabs[0].id);
      }

      selectedTabIds = new Set(
        [...previousSelection].filter((tabId) => youtubeTabs.some((tab) => tab.id === tabId))
      );

      tabEntries = youtubeTabs.map((tab) => createTabEntry(
        tab,
        force ? null : previousById.get(tab.id)
      ));
    } catch (error) {
      tabEntries = [];
      selectedTabIds.clear();
      setStatus(String(error?.message || "유튜브 탭 목록을 불러오지 못했습니다."), "error");
    } finally {
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
      if (!text) return "";
      return settings[STORAGE_KEYS.includeTimestamps]
        ? `[${formatTimestamp(entry?.startMs)}] ${text}`
        : text;
    }).filter(Boolean);

    if (lines.length === 0) throw new Error("읽을 수 있는 자막 문장이 없습니다.");
    const body = lines.join(lineSeparator);
    if (!settings[STORAGE_KEYS.includeTitle]) return body;
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
    if (!track) throw new Error("사용할 원본 자막을 선택하지 못했습니다.");

    const cacheKey = getTranscriptCacheKey(entry);
    if (entry.transcriptCache.has(cacheKey)) return entry.transcriptCache.get(cacheKey);

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

  function setBusyState(kind, busy, progressText = "") {
    operationBusy = busy;
    copyButton.setAttribute("aria-busy", String(busy && kind === "copy"));
    downloadButton.setAttribute("aria-busy", String(busy && kind === "combined"));
    separateDownloadButton.setAttribute("aria-busy", String(busy && kind === "separate"));

    copyLabel.textContent = busy && kind === "copy" ? progressText : baseButtonLabels.copy;
    downloadLabel.textContent = busy && kind === "combined" ? progressText : baseButtonLabels.combined;
    separateDownloadLabel.textContent = busy && kind === "separate" ? progressText : baseButtonLabels.separate;
    renderTabList();
  }

  function flashButtonLabel(kind, text) {
    if (transientLabelTimer) window.clearTimeout(transientLabelTimer);
    const label = kind === "copy" ? copyLabel : kind === "combined" ? downloadLabel : separateDownloadLabel;
    const defaultText = kind === "copy" ? baseButtonLabels.copy : kind === "combined" ? baseButtonLabels.combined : baseButtonLabels.separate;
    label.textContent = text;
    transientLabelTimer = window.setTimeout(() => {
      transientLabelTimer = 0;
      if (!operationBusy) label.textContent = defaultText;
    }, 1900);
  }

  async function collectSelectedTranscripts(kind) {
    const entries = getSelectedEntries();
    if (entries.length === 0) throw new Error("자막을 추출할 유튜브 탭을 선택하세요.");

    const results = [];
    const failures = [];
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const progress = `${index + 1}/${entries.length} 처리 중`;
      entry.operationState = "working";
      entry.operationMessage = progress;
      if (kind === "copy") copyLabel.textContent = progress;
      else if (kind === "combined") downloadLabel.textContent = progress;
      else separateDownloadLabel.textContent = progress;
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
      } catch (error) {
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
    if (!copied) throw new Error("클립보드에 자막을 복사하지 못했습니다.");
  }

  function makeCompletionMessage(action, collected) {
    const succeeded = collected.results.length;
    const failed = collected.failures.length;
    const actionText = action === "copy"
      ? "클립보드에 복사했습니다"
      : action === "combined"
        ? "한 개의 텍스트 파일로 저장했습니다"
        : "개별 텍스트 파일로 저장했습니다";
    return failed > 0
      ? `${succeeded}개 자막을 ${actionText}. ${failed}개 탭은 오류로 건너뛰었습니다.`
      : `${succeeded}개 자막을 ${actionText}.`;
  }

  async function performAction(kind) {
    if (operationBusy) return;
    let completionLabel = "";
    setBusyState(kind, true, "준비 중");
    setStatus("선택한 유튜브 탭의 자막을 확인하고 있습니다.", "working");

    try {
      const collected = await collectSelectedTranscripts(kind);
      if (kind === "copy") {
        const combinedText = collected.results.map((item) => item.text).join(COMBINED_TRANSCRIPT_SEPARATOR);
        await writeClipboard(combinedText);
        completionLabel = "복사 완료";
      } else if (kind === "combined") {
        const combinedText = collected.results.map((item) => item.text).join(COMBINED_TRANSCRIPT_SEPARATOR);
        await sendRuntimeMessage({
          type: MESSAGE_TYPES.SAVE_TEXT,
          text: combinedText,
          title: collected.results[0]?.title || "YouTube 자막 모음",
          videoId: collected.results.length === 1 ? collected.results[0].videoId : "batch",
          combinedCount: collected.results.length
        });
        completionLabel = "저장 완료";
      } else {
        await sendRuntimeMessage({
          type: MESSAGE_TYPES.SAVE_BATCH,
          files: collected.results.map((item) => ({
            videoId: item.videoId,
            title: item.title,
            text: item.text
          }))
        }, 90000);
        completionLabel = "저장 완료";
      }

      setStatus(makeCompletionMessage(kind, collected), collected.failures.length > 0 ? "ready" : "success");
    } catch (error) {
      setStatus(String(error?.message || "유튜브 자막 작업에 실패했습니다."), "error");
    } finally {
      setBusyState(kind, false);
      if (completionLabel) flashButtonLabel(kind, completionLabel);
    }
  }

  function applySettingsToControls() {
    includeTitleToggle.checked = settings[STORAGE_KEYS.includeTitle];
    includeTimeToggle.checked = settings[STORAGE_KEYS.includeTimestamps];
    spacingSelect.value = String(settings[STORAGE_KEYS.blankLines]);
  }

  async function initialize() {
    if (!toggle || !dropdown || !tabList) return;

    await loadStoredSettings();
    settingsReady = true;
    applySettingsToControls();
    updateSummary();
    updateControls();

    toggle.addEventListener("click", () => {
      const nextOpen = dropdown.hidden;
      if (nextOpen) {
        closeOtherDropdowns();
        setOpen(true);
        if (tabEntries.length === 0 && !listLoading) void loadYouTubeTabs();
      } else {
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
      for (const entry of tabEntries) entry.selected = false;
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

    copyButton.addEventListener("click", () => void performAction("copy"));
    downloadButton.addEventListener("click", () => void performAction("combined"));
    separateDownloadButton.addEventListener("click", () => void performAction("separate"));

    for (const [, toggleId] of otherDropdownPairs) {
      document.getElementById(toggleId)?.addEventListener("click", closeYouTubeDropdown);
    }

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !dropdown.hidden && !operationBusy) closeYouTubeDropdown();
    });
  }

  void initialize();
})();
