"use strict";

// The service worker is emitted to dist/, so these paths resolve to sibling build outputs.
importScripts("./toolbox_shared.js", "./settings_transfer.js", "./navigation_guard.js", "./youtube_transcript_page_task.js", "./youtube_caption_text_bridge.js", "./background_capture.js", "./background_captions.js");

type AnyRecord = Record<string, any>;

interface BrowserTab {
  id?: number;
  url?: string;
  pendingUrl?: string;
  title?: string;
  index?: number;
  windowId?: number;
  active?: boolean;
  pinned?: boolean;
  incognito?: boolean;
  openerTabId?: number;
  autoDiscardable?: boolean;
  discarded?: boolean;
  frozen?: boolean;
  status?: string;
}

interface BrowserWindowInfo {
  id?: number;
  focused?: boolean;
  state?: string;
  type?: string;
}

interface MediaActiveState {
  frameId: number;
  mediaId: string;
  sourceKey: string;
  rate: number;
  kind: "audio" | "video";
  label: string;
  updatedAt: number;
}

interface MediaTabState {
  templateRate: number;
  active: MediaActiveState | null;
}

type MediaTabStateStore = Record<string, MediaTabState>;

interface ElementEraserRule {
  selector: string;
  label: string;
  createdAt: number;
}

type ElementEraserStore = Record<string, ElementEraserRule[]>;

interface SiteDataTarget {
  tabId: number;
  origin: string;
}

interface NativeLinkActivation {
  url: string;
  inputKind: "modifier" | "middle";
  registeredAt: number;
  expiresAt: number;
}

type TabKeepActiveMode = "manual" | "global";

interface TabKeepActiveRecord {
  mode: TabKeepActiveMode;
  desired: boolean;
  originalAutoDiscardable: boolean;
  applied: boolean;
  pending: boolean;
  retryBlocked: boolean;
  lastError: string;
  updatedAt: number;
}

type TabKeepActiveRecordStore = Record<string, TabKeepActiveRecord>;

interface TabKeepActiveOperationResult {
  tabId: number;
  status: "applied" | "disabled" | "pending" | "failed" | "skipped";
  error: string;
}

interface TabKeepActiveFocusContext {
  focusEmulationEnabled: boolean;
  debuggerRequired: boolean;
  useNativeDisplayedState: boolean;
  tabActive: boolean;
  windowMinimized: boolean;
  windowId: number;
}

const DEBUGGER_PROTOCOL_VERSION = "1.3";
const BADGE_CLEAR_DELAY_MS = 1800;

const MESSAGE_TYPES = Object.freeze({
  CAPTURE_FULL_PAGE: "capture-full-page",
  START_AREA_SELECTION: "start-area-selection",
  CAPTURE_SELECTED_AREA: "drag-area-screenshot:capture",
  AREA_SELECTION_READY: "drag-area-screenshot:ready",
  AREA_SELECTION_CANCELLED: "drag-area-screenshot:cancel",
  APPLY_NAVIGATION_GUARD: "page-tools:apply-navigation-guard",
  REGISTER_NATIVE_LINK_ACTIVATION: "page-tools:register-native-link-activation",
  START_ELEMENT_ERASER: "page-element-eraser:start",
  ACTIVATE_ELEMENT_ERASER: "page-element-eraser:activate",
  ADD_ELEMENT_ERASER_RULE: "page-element-eraser:add-rule",
  GET_ELEMENT_ERASER_STATUS: "page-element-eraser:get-site-status",
  CLEAR_ELEMENT_ERASER_RULES: "page-element-eraser:clear-site-rules",
  GET_YOUTUBE_TRANSCRIPT_INFO: "youtube-transcript:get-info",
  GET_YOUTUBE_TRANSCRIPT: "youtube-transcript:get-transcript",
  APPLY_YOUTUBE_SYNCED_CAPTIONS: "youtube-synced-captions:apply",
  REMOVE_YOUTUBE_SYNCED_CAPTIONS: "youtube-synced-captions:remove",
  SAVE_YOUTUBE_TRANSCRIPT: "youtube-transcript:save-text",
  SAVE_YOUTUBE_TRANSCRIPT_BATCH: "youtube-transcript:save-batch",
  GET_MEDIA_TAB_STATE: "media-controller:get-tab-state",
  SET_MEDIA_TAB_RATE: "media-controller:set-tab-rate",
  REPORT_MEDIA_TAB_RATE: "media-controller:report-tab-rate",
  APPLY_MEDIA_TAB_RATE: "media-controller:apply-tab-rate",
  MEDIA_TAB_RATE_UPDATED: "media-controller:tab-rate-updated",
  CLEAR_SELECTED_SITE_DATA: "tab-tools:clear-site-data",
  GET_TAB_KEEP_ACTIVE_STATE: "tab-tools:get-keep-active-state",
  SET_SELECTED_TAB_KEEP_ACTIVE: "tab-tools:set-selected-keep-active",
  SET_ALL_TAB_KEEP_ACTIVE: "tab-tools:set-all-keep-active"
});

const LEGACY_VISITED_LINKS_STORAGE_KEY = "pageToolsVisitedLinksV1";
const ELEMENT_ERASER_RULES_STORAGE_KEY = "pageElementEraserRulesV1";
const MAX_ELEMENT_ERASER_SITES = 80;
const MAX_ELEMENT_ERASER_RULES_PER_SITE = 60;
const MAX_ELEMENT_ERASER_SELECTOR_LENGTH = 1200;
const MEDIA_TAB_STATES_SESSION_KEY = "mediaControllerTabStatesV3";
const LEGACY_MEDIA_TAB_STATES_SESSION_KEY = "mediaControllerTabStatesV2";
const LEGACY_MEDIA_TAB_RATES_SESSION_KEY = "mediaPlaybackRatesByTabV1";
const MEDIA_RATE_MIN = 0.07;
const MEDIA_RATE_MAX = 16;
const MAX_YOUTUBE_TRANSCRIPT_BATCH_FILES = 50;
const MAX_YOUTUBE_TRANSCRIPT_BATCH_TOTAL_LENGTH = 32_000_000;
const MAX_SITE_DATA_TARGETS = 300;
const NATIVE_LINK_ACTIVATION_TTL_MS = 2500;
const NATIVE_LINK_MATCH_RETRY_MS = 25;
const NATIVE_LINK_MATCH_MAX_ATTEMPTS = 12;
const MAX_PENDING_NATIVE_LINK_ACTIVATIONS_PER_TAB = 12;
const TAB_KEEP_ACTIVE_GLOBAL_STORAGE_KEY = "tabKeepActiveGlobalEnabledV1";
const TAB_KEEP_ACTIVE_RECORDS_SESSION_KEY = "tabKeepActiveRecordsV1";
const MAX_TAB_KEEP_ACTIVE_TARGETS = 300;
const TAB_KEEP_ACTIVE_VERIFY_RETRY_MS = 40;
const TAB_KEEP_ACTIVE_VERIFY_ATTEMPTS = 3;
const TAB_KEEP_ACTIVE_CONTEXT_APPLY_ATTEMPTS = 4;
const TAB_KEEP_ACTIVE_WINDOW_SYNC_DELAY_MS = 90;
const capturingTabs = new Set<number>();
let elementEraserWriteQueue: Promise<unknown> = Promise.resolve();
let mediaTabStatesCache: MediaTabStateStore | null = null;
let mediaTabStatesWriteQueue: Promise<unknown> = Promise.resolve();
let siteDataClearInProgress = false;
const pendingNativeLinkActivations = new Map<number, NativeLinkActivation[]>();
const nativeLinkPlacementQueues = new Map<number, Promise<void>>();
let tabKeepActiveRecordsCache: TabKeepActiveRecordStore | null = null;
let tabKeepActiveRecordsLoad: Promise<TabKeepActiveRecordStore> | null = null;
let tabKeepActiveRecordsWriteQueue: Promise<unknown> = Promise.resolve();
let tabKeepActiveGlobalEnabledCache: boolean | null = null;
let tabKeepActiveInitializationPromise: Promise<void> | null = null;
let tabKeepActiveInitialized = false;
const tabKeepActiveControlQueue = new ToolboxShared.SerialTaskQueue();
function queueTabKeepActiveControl<T>(task: () => Promise<T>): Promise<T> {
  return tabKeepActiveControlQueue.run(task);
}
const tabDebuggerOperationQueues = new ToolboxShared.KeyedTaskQueue<number>();
const captionOperationQueues = new ToolboxShared.KeyedTaskQueue<number>();
const extensionAttachedDebuggerTabs = new Set<number>();
const expectedDebuggerDetaches = new Map<number, Set<symbol>>();
const tabKeepActiveWindowSyncTimers = new Map<number, ReturnType<typeof setTimeout>>();
let tabKeepActiveAllWindowsSyncTimer: ReturnType<typeof setTimeout> | null = null;

function getTab(tabId: number): Promise<BrowserTab> {
  return new Promise<BrowserTab>((resolve, reject) => {
    chrome.tabs.get(tabId, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(tab);
    });
  });
}

function getWindow(windowId: number): Promise<BrowserWindowInfo> {
  return new Promise<BrowserWindowInfo>((resolve, reject) => {
    chrome.windows.get(windowId, (windowInfo) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else if (!windowInfo) reject(new Error("Chrome이 창 정보를 반환하지 않았습니다."));
      else resolve(windowInfo);
    });
  });
}

function queryTabs(queryInfo: AnyRecord): Promise<BrowserTab[]> {
  return new Promise<BrowserTab[]>((resolve, reject) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(Array.isArray(tabs) ? tabs : []);
    });
  });
}

function updateTab(tabId: number, updateProperties: AnyRecord): Promise<BrowserTab> {
  return new Promise<BrowserTab>((resolve, reject) => {
    chrome.tabs.update(tabId, updateProperties, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      if (!tab) {
        reject(new Error("Chrome이 변경한 탭 정보를 반환하지 않았습니다."));
        return;
      }
      resolve(tab);
    });
  });
}

function moveTab(tabId: number, moveProperties: chrome.tabs.MoveProperties): Promise<BrowserTab> {
  return new Promise<BrowserTab>((resolve, reject) => {
    chrome.tabs.move(tabId, moveProperties, (moved) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      const tab = Array.isArray(moved) ? moved[0] : moved;
      if (!tab) {
        reject(new Error("Chrome이 이동한 탭 정보를 반환하지 않았습니다."));
        return;
      }
      resolve(tab);
    });
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isTabTemporarilyUneditableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return /Tabs cannot be edited right now/i.test(message);
}

function normalizeHttpUrl(value: unknown): string | null {
  const text = String(value || "").trim();
  if (!text) return null;

  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

function normalizeHttpOrigin(value: unknown): string | null {
  const normalizedUrl = normalizeHttpUrl(value);
  return normalizedUrl ? new URL(normalizedUrl).origin : null;
}

function getTabNavigationUrl(tab: BrowserTab): string {
  return String(tab?.pendingUrl || tab?.url || "").trim();
}

function isTrustedExtensionPageSender(sender: chrome.runtime.MessageSender | undefined): boolean {
  if (sender?.id !== chrome.runtime.id) return false;
  const senderUrl = typeof sender.url === "string" ? sender.url : "";
  // Chrome, not message data, supplies the sender URL. A missing URL is not proof
  // of UI origin; conversely an extension page opened in a tab is still own UI.
  return senderUrl.startsWith(chrome.runtime.getURL(""));
}

function isTrustedPageContentSender(sender: AnyRecord): boolean {
  if (sender?.id !== chrome.runtime.id || !Number.isInteger(sender?.tab?.id)) {
    return false;
  }

  return Boolean(
    normalizeHttpOrigin(sender?.origin) ||
    normalizeHttpOrigin(sender?.url) ||
    normalizeHttpOrigin(getTabNavigationUrl(sender.tab))
  );
}

async function placeTabImmediatelyRightOfSource(
  targetTabId: number,
  sourceTabId: number,
  expectedWindowId: number
): Promise<BrowserTab> {
  const maxAttempts = 4;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const sourceTab = await getTab(sourceTabId);
    const sourceWindowId = Number(sourceTab.windowId);
    const sourceTabIndex = Number(sourceTab.index);
    if (sourceWindowId !== expectedWindowId) {
      throw new Error("링크를 연 원래 탭이 다른 창으로 이동했습니다.");
    }
    if (!Number.isInteger(sourceTabIndex) || sourceTabIndex < 0) {
      throw new Error("링크를 연 원래 탭의 현재 위치를 확인할 수 없습니다.");
    }

    try {
      await moveTab(targetTabId, {
        windowId: sourceWindowId,
        index: sourceTabIndex + 1
      });
    } catch (error) {
      if (isTabTemporarilyUneditableError(error) && attempt + 1 < maxAttempts) {
        await delay(50);
        continue;
      }
      throw error;
    }

    const [latestSourceTab, latestCreatedTab] = await Promise.all([
      getTab(sourceTabId),
      getTab(targetTabId)
    ]);
    const latestSourceIndex = Number(latestSourceTab.index);
    const latestCreatedIndex = Number(latestCreatedTab.index);
    const sameWindow = latestCreatedTab.windowId === latestSourceTab.windowId;

    if (
      sameWindow &&
      Number.isInteger(latestSourceIndex) &&
      Number.isInteger(latestCreatedIndex) &&
      latestCreatedIndex === latestSourceIndex + 1
    ) {
      return latestCreatedTab;
    }

    // Chrome keeps unpinned tabs outside the pinned-tab area. In that case the
    // requested adjacent index is clamped to the nearest valid unpinned position.
    if (latestSourceTab.pinned === true && latestCreatedTab.pinned !== true && sameWindow) {
      return latestCreatedTab;
    }

    if (attempt + 1 < maxAttempts) {
      await delay(50);
    }
  }

  throw new Error("새 탭이 원래 탭의 바로 오른쪽에 배치되지 않았습니다.");
}

function prunePendingNativeLinkActivations(sourceTabId: number, now = Date.now()): NativeLinkActivation[] {
  const queue = pendingNativeLinkActivations.get(sourceTabId) || [];
  const live = queue.filter((entry) => entry.expiresAt > now);

  if (live.length > 0) {
    pendingNativeLinkActivations.set(sourceTabId, live);
  } else {
    pendingNativeLinkActivations.delete(sourceTabId);
  }

  return live;
}

function registerNativeLinkActivation(
  rawUrl: unknown,
  rawInputKind: unknown,
  sender: AnyRecord
): AnyRecord {
  if (!isTrustedPageContentSender(sender)) {
    throw new Error("웹페이지에서 시작된 실제 링크 입력만 처리할 수 있습니다.");
  }

  const url = normalizeHttpUrl(rawUrl);
  if (!url) {
    throw new Error("HTTP 또는 HTTPS 일반 링크만 처리할 수 있습니다.");
  }

  const inputKind = rawInputKind === "middle"
    ? "middle"
    : rawInputKind === "modifier"
      ? "modifier"
      : null;
  if (!inputKind) {
    throw new Error("링크를 연 마우스 입력 종류를 확인할 수 없습니다.");
  }

  const sourceTabId = Number(sender.tab.id);
  if (!Number.isInteger(sourceTabId) || sourceTabId < 0) {
    throw new Error("링크를 연 원래 탭을 확인할 수 없습니다.");
  }

  const now = Date.now();
  const queue = prunePendingNativeLinkActivations(sourceTabId, now);
  queue.push({
    url,
    inputKind,
    registeredAt: now,
    expiresAt: now + NATIVE_LINK_ACTIVATION_TTL_MS
  });
  if (queue.length > MAX_PENDING_NATIVE_LINK_ACTIVATIONS_PER_TAB) {
    queue.splice(0, queue.length - MAX_PENDING_NATIVE_LINK_ACTIVATIONS_PER_TAB);
  }
  pendingNativeLinkActivations.set(sourceTabId, queue);

  setTimeout(() => {
    prunePendingNativeLinkActivations(sourceTabId);
  }, NATIVE_LINK_ACTIVATION_TTL_MS + 100);

  return { sourceTabId, url, inputKind };
}

function takePendingNativeLinkActivation(
  sourceTabId: number,
  candidateUrl: string | null
): NativeLinkActivation | null {
  const queue = prunePendingNativeLinkActivations(sourceTabId);
  if (queue.length === 0 || !candidateUrl) return null;

  const index = queue.findIndex((entry) => entry.url === candidateUrl);
  if (index < 0) return null;

  const [activation] = queue.splice(index, 1);
  if (queue.length > 0) pendingNativeLinkActivations.set(sourceTabId, queue);
  else pendingNativeLinkActivations.delete(sourceTabId);
  return activation || null;
}

function isClosedTabError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return /No tab with id|No tab with ID|tab was closed|tab was removed/i.test(message);
}

async function waitForNativeLinkActivation(
  targetTabId: number,
  sourceTabId: number,
  initialTargetUrl: unknown
): Promise<NativeLinkActivation | null> {
  let candidateUrl = normalizeHttpUrl(initialTargetUrl);

  for (let attempt = 0; attempt < NATIVE_LINK_MATCH_MAX_ATTEMPTS; attempt += 1) {
    const activation = takePendingNativeLinkActivation(sourceTabId, candidateUrl);
    if (activation) return activation;

    if (attempt + 1 >= NATIVE_LINK_MATCH_MAX_ATTEMPTS) break;
    await delay(NATIVE_LINK_MATCH_RETRY_MS);

    try {
      const latestTab = await getTab(targetTabId);
      if (
        Number.isInteger(latestTab.openerTabId) &&
        Number(latestTab.openerTabId) !== sourceTabId
      ) {
        return null;
      }
      candidateUrl = normalizeHttpUrl(getTabNavigationUrl(latestTab)) || candidateUrl;
    } catch (error) {
      if (isClosedTabError(error)) return null;
      throw error;
    }
  }

  return null;
}

async function placeNativeOpenedLinkTab(tab: BrowserTab): Promise<void> {
  const targetTabId = Number(tab.id);
  const sourceTabId = Number(tab.openerTabId);
  if (
    !Number.isInteger(targetTabId) ||
    targetTabId < 0 ||
    !Number.isInteger(sourceTabId) ||
    sourceTabId < 0
  ) {
    return;
  }

  const activation = await waitForNativeLinkActivation(
    targetTabId,
    sourceTabId,
    getTabNavigationUrl(tab)
  );
  if (!activation) return;

  const [sourceTab, targetTab] = await Promise.all([
    getTab(sourceTabId),
    getTab(targetTabId)
  ]);
  const sourceWindowId = Number(sourceTab.windowId);
  if (!Number.isInteger(sourceWindowId) || sourceWindowId < 0) {
    throw new Error("링크를 연 원래 탭의 창을 확인할 수 없습니다.");
  }
  if (Number(targetTab.windowId) !== sourceWindowId) {
    throw new Error("Chrome이 링크를 원래 탭과 다른 창에서 열었습니다.");
  }

  await placeTabImmediatelyRightOfSource(targetTabId, sourceTabId, sourceWindowId);
}

function queueNativeOpenedLinkTabPlacement(tab: BrowserTab): void {
  const targetTabId = Number(tab?.id);
  const sourceTabId = Number(tab?.openerTabId);
  if (
    !Number.isInteger(targetTabId) ||
    targetTabId < 0 ||
    !Number.isInteger(sourceTabId) ||
    sourceTabId < 0
  ) {
    return;
  }

  const previous = nativeLinkPlacementQueues.get(sourceTabId) || Promise.resolve();
  const operation = previous
    .catch(() => {})
    .then(() => placeNativeOpenedLinkTab(tab));
  const tail = operation.then(() => undefined, () => undefined);
  nativeLinkPlacementQueues.set(sourceTabId, tail);
  tail.then(() => {
    if (nativeLinkPlacementQueues.get(sourceTabId) === tail) {
      nativeLinkPlacementQueues.delete(sourceTabId);
    }
  });
  operation.catch((error) => {
    if (!isClosedTabError(error)) {
      console.error("Could not place a native link tab next to its source tab:", error);
    }
  });
}

chrome.tabs.onCreated.addListener((tab) => {
  queueNativeOpenedLinkTabPlacement(tab);
  const tabId = Number(tab?.id);
  if (Number.isInteger(tabId) && tabId >= 0) {
    ensureTabKeepActiveInitialized()
      .then(() => syncTabKeepActive(tabId, false))
      .catch((error) => {
        if (!isClosedTabError(error)) {
          console.warn("Could not apply all-tab keep-active state to a new tab:", error);
        }
      });
  }
});

function removeBrowsingDataForOrigins(origins: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const [firstOrigin, ...otherOrigins] = origins;
    if (!firstOrigin) { reject(new Error("삭제할 사이트 주소가 없습니다.")); return; }
    const browsingDataApi = chrome.browsingData;
    if (!browsingDataApi || typeof browsingDataApi.remove !== "function") {
      reject(new Error("Chrome의 사이트 데이터 삭제 API를 사용할 수 없습니다."));
      return;
    }

    try {
      browsingDataApi.remove(
        { origins: [firstOrigin, ...otherOrigins], since: 0 },
        {
          cache: true,
          cacheStorage: true,
          cookies: true
        },
        () => {
          const error = chrome.runtime.lastError;
          if (error) reject(new Error(error.message));
          else resolve();
        }
      );
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

async function clearSelectedTabSiteData(rawTargets: unknown): Promise<AnyRecord> {
  if (siteDataClearInProgress) {
    throw new Error("다른 사이트 데이터 삭제 작업이 진행 중입니다.");
  }

  if (!Array.isArray(rawTargets) || rawTargets.length === 0) {
    throw new Error("쿠키와 캐시를 삭제할 탭을 하나 이상 선택하세요.");
  }

  if (rawTargets.length > MAX_SITE_DATA_TARGETS) {
    throw new Error(`한 번에 최대 ${MAX_SITE_DATA_TARGETS}개의 탭만 처리할 수 있습니다.`);
  }

  const targetsByTab = new Map<number, SiteDataTarget>();
  for (const rawTarget of rawTargets) {
    const tabId = (rawTarget as AnyRecord)?.tabId;
    const origin = normalizeHttpOrigin((rawTarget as AnyRecord)?.origin);
    if (typeof tabId !== "number" || !Number.isInteger(tabId) || tabId < 0 || !origin) {
      throw new Error("선택한 탭의 사이트 주소를 확인할 수 없습니다.");
    }

    const existing = targetsByTab.get(tabId);
    if (existing && existing.origin !== origin) {
      throw new Error("같은 탭에 서로 다른 사이트 주소가 지정되었습니다.");
    }
    targetsByTab.set(tabId, { tabId, origin });
  }

  const targets = [...targetsByTab.values()];
  siteDataClearInProgress = true;

  try {
    const validatedOrigins = await Promise.all(targets.map(async (target) => {
      let tab: BrowserTab;
      try {
        tab = await getTab(target.tabId);
      } catch {
        throw new Error("선택한 탭 중 하나가 닫혔습니다. 탭 목록을 새로고침하고 다시 선택하세요.");
      }

      const currentOrigin = normalizeHttpOrigin(getTabNavigationUrl(tab));
      if (!currentOrigin) {
        throw new Error("선택한 탭 중 하나가 HTTP 또는 HTTPS 페이지가 아닙니다.");
      }

      if (currentOrigin !== target.origin) {
        throw new Error("선택한 탭 중 하나의 주소가 변경되었습니다. 탭 목록을 새로고침하고 다시 선택하세요.");
      }

      return currentOrigin;
    }));

    const origins = [...new Set(validatedOrigins)];
    await removeBrowsingDataForOrigins(origins);

    return {
      tabCount: targets.length,
      originCount: origins.length
    };
  } finally {
    siteDataClearInProgress = false;
  }
}

function getStoredValues(keys: any): Promise<AnyRecord> {
  return new Promise<AnyRecord>((resolve, reject) => {
    chrome.storage.local.get(keys, (values) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(values || {});
    });
  });
}

function setStoredValues(values: AnyRecord): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function removeStoredValues(keys: any): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function getSessionStoredValues(keys: any): Promise<AnyRecord> {
  return ToolboxShared.readStorage(chrome.storage?.session, chrome.runtime, keys);
}
function setSessionStoredValues(values: AnyRecord): Promise<void> {
  return ToolboxShared.writeStorage(chrome.storage?.session, chrome.runtime, values);
}
function removeSessionStoredValues(keys: string | string[]): Promise<void> {
  return ToolboxShared.removeStorage(chrome.storage?.session, chrome.runtime, keys);
}


function normalizeMediaTabRate(value: unknown) {
  const numeric = ToolboxShared.numericSetting(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(MEDIA_RATE_MAX, Math.max(MEDIA_RATE_MIN, Math.round(numeric * 100) / 100));
}

function normalizeMediaText(value: unknown, maximumLength = 160) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumLength);
}

function isOpaqueMediaSourceKey(value: string) {
  const key = String(value || "");
  if (!key || key.length > 180 || /https?:\/\/|[?&=]/i.test(key)) return false;
  return /^(?:url|dynamic|stream|empty):[a-z0-9_-]+(?::[a-z0-9_-]+)?(?:\|(?:page|youtube):[a-z0-9_-]+)?$/i.test(key);
}

function normalizeMediaActiveState(value: any): MediaActiveState | null {
  const source: AnyRecord | null = value && typeof value === "object" ? value : null;
  if (!source) return null;

  const frameId = Number(source.frameId);
  const mediaId = normalizeMediaText(source.mediaId, 96);
  const sourceKey = normalizeMediaText(source.sourceKey, 180);
  const actualRate = Number(source.rate);
  if (!Number.isInteger(frameId) || frameId < 0 || !mediaId || !isOpaqueMediaSourceKey(sourceKey) || !ToolboxShared.isRate(actualRate)) return null;

  return {
    frameId,
    mediaId,
    sourceKey,
    rate: actualRate,
    kind: source.kind === "audio" ? "audio" : "video",
    label: normalizeMediaText(source.label || (source.kind === "audio" ? "오디오" : "동영상"), 140),
    updatedAt: Math.max(0, Number(source.updatedAt) || Date.now())
  };
}

function normalizeMediaTabState(value: any): MediaTabState {
  const source: AnyRecord = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    templateRate: normalizeMediaTabRate(source.templateRate ?? source.rate ?? 1),
    active: normalizeMediaActiveState(source.active)
  };
}

let mediaStoreLoad: Promise<MediaTabStateStore> | null = null;
function getMediaTabStatesStore(): Promise<MediaTabStateStore> {
  if (mediaTabStatesCache) return Promise.resolve(mediaTabStatesCache);
  if (!mediaStoreLoad) mediaStoreLoad = loadMediaTabStatesStore().finally(() => { mediaStoreLoad = null; });
  return mediaStoreLoad;
}
async function loadMediaTabStatesStore(): Promise<MediaTabStateStore> {
  if (mediaTabStatesCache) return mediaTabStatesCache;

  const stored = await getSessionStoredValues([
    MEDIA_TAB_STATES_SESSION_KEY,
    LEGACY_MEDIA_TAB_STATES_SESSION_KEY,
    LEGACY_MEDIA_TAB_RATES_SESSION_KEY
  ]);
  const source = stored?.[MEDIA_TAB_STATES_SESSION_KEY];
  const legacyStateSource = stored?.[LEGACY_MEDIA_TAB_STATES_SESSION_KEY];
  const legacySource = stored?.[LEGACY_MEDIA_TAB_RATES_SESSION_KEY];
  const nextStore: MediaTabStateStore = {};

  if (source && typeof source === "object" && !Array.isArray(source)) {
    for (const [tabId, value] of Object.entries(source)) {
      nextStore[String(tabId)] = normalizeMediaTabState(value);
    }
  } else if (legacyStateSource && typeof legacyStateSource === "object" && !Array.isArray(legacyStateSource)) {
    // Preserve only the harmless per-tab template rate. Version 2 stored the
    // complete signed media URL in active.sourceKey, so that field is deliberately discarded.
    for (const [tabId, value] of Object.entries(legacyStateSource as AnyRecord)) {
      nextStore[String(tabId)] = normalizeMediaTabState({
        templateRate: (value as AnyRecord)?.templateRate ?? (value as AnyRecord)?.rate ?? 1
      });
    }
  } else if (legacySource && typeof legacySource === "object" && !Array.isArray(legacySource)) {
    for (const [tabId, rate] of Object.entries(legacySource)) {
      nextStore[String(tabId)] = normalizeMediaTabState({ templateRate: rate });
    }
  }

  // Persist only the sanitized opaque-key format and remove older session data
  // that could contain complete signed media URLs.
  await setSessionStoredValues({ [MEDIA_TAB_STATES_SESSION_KEY]: { ...nextStore } });
  await removeSessionStoredValues([
    LEGACY_MEDIA_TAB_STATES_SESSION_KEY,
    LEGACY_MEDIA_TAB_RATES_SESSION_KEY
  ]);
  mediaTabStatesCache = nextStore;
  return nextStore;
}

function queueMediaTabStatesWrite<T>(task: () => Promise<T> | T): Promise<T> {
  const run = mediaTabStatesWriteQueue.then(task, task);
  mediaTabStatesWriteQueue = run.catch(() => {});
  return run;
}

async function getMediaTabState(tabId: number): Promise<MediaTabState> {
  const store = await getMediaTabStatesStore();
  return normalizeMediaTabState(store[String(tabId)]);
}

const mediaTargetRevisions = new Map<number, number>();

function setMediaTabState(
  tabId: number,
  updater: MediaTabState | ((current: MediaTabState) => MediaTabState)
): Promise<MediaTabState> {
  return queueMediaTabStatesWrite(async () => {
    const store = await getMediaTabStatesStore();
    const current = normalizeMediaTabState(store[String(tabId)]);
    const candidate = typeof updater === "function" ? updater(current) : updater;
    if (candidate === current) return current; // A stale read does not persist anything.
    const next = normalizeMediaTabState(candidate);
    const nextStore = { ...store, [String(tabId)]: next };
    await setSessionStoredValues({ [MEDIA_TAB_STATES_SESSION_KEY]: nextStore });
    mediaTabStatesCache = nextStore;
    mediaTargetRevisions.set(tabId, (mediaTargetRevisions.get(tabId) || 0) + 1);
    return next;
  });
}

function removeMediaTabState(tabId: number): Promise<void> {
  return queueMediaTabStatesWrite(async () => {
    const store = await getMediaTabStatesStore();
    const nextStore = { ...store };
    delete nextStore[String(tabId)];
    await setSessionStoredValues({ [MEDIA_TAB_STATES_SESSION_KEY]: nextStore });
    mediaTabStatesCache = nextStore;
    mediaTargetRevisions.set(tabId, (mediaTargetRevisions.get(tabId) || 0) + 1);
  });
}

function makeMediaPopupState(tabId: number|undefined, state: MediaTabState) {
  const normalized = normalizeMediaTabState(state);
  const active = normalized.active;
  return {
    ok: true,
    tabId,
    rate: active?.rate ?? normalized.templateRate,
    templateRate: normalized.templateRate,
    hasMedia: Boolean(active),
    mediaId: active?.mediaId || "",
    sourceKey: active?.sourceKey || "",
    kind: active?.kind || "",
    label: active?.label || ""
  };
}

function notifyMediaTabStateUpdated(tabId: number|undefined, state: MediaTabState) {
  try {
    chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.MEDIA_TAB_RATE_UPDATED,
      ...makeMediaPopupState(tabId, state)
    }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    // The popup may not be open. The session state remains available.
  }
}

async function refreshMediaActiveState(tabId: number, state: MediaTabState) {
  const normalized = normalizeMediaTabState(state);
  const active = normalized.active;
  if (!active) return normalized;
  const revision = mediaTargetRevisions.get(tabId) || 0;
  const unchanged = (current: MediaTabState) => (mediaTargetRevisions.get(tabId) || 0) === revision &&
    ToolboxSettings.canonical(current.active) === ToolboxSettings.canonical(active);

  let response: unknown;
  try {
    response = await sendTabMessage(tabId, {
      type: MESSAGE_TYPES.GET_MEDIA_TAB_STATE, mediaId: active.mediaId, sourceKey: active.sourceKey, queryFrame: true
    }, { frameId: active.frameId });
  } catch (error) {
    // An unavailable content script is not evidence that the old source is still present.
    if (/Receiving end does not exist|Could not establish connection|No frame with|No tab with|message port closed/i.test(ToolboxShared.errorMessage(error))) {
      return setMediaTabState(tabId, current => unchanged(current) ? ({ ...current, active: null }) : current);
    }
    throw error;
  }
  if (!ToolboxShared.mediaReply(response)) throw new Error("미디어 상태 응답 형식이 올바르지 않습니다.");
  if (response.ok === false) throw new Error(response.error);
  if (!response.hasMedia) return setMediaTabState(tabId, current => unchanged(current) ? ({ ...current, active: null }) : current);
  if (response.mediaId !== active.mediaId || response.sourceKey !== active.sourceKey) {
    throw new Error("조회한 미디어 소스와 응답 대상이 다릅니다. 새 상태 보고를 기다린 뒤 다시 확인해 주세요.");
  }
  return setMediaTabState(tabId, current => unchanged(current) ? ({
    ...current, templateRate: response.templateRate,
    active: { frameId: active.frameId, mediaId: response.mediaId || active.mediaId, sourceKey: response.sourceKey || active.sourceKey,
      rate: response.rate, kind: response.kind || active.kind, label: response.label || active.label, updatedAt: Date.now() }
  }) : current);
}

async function reportMediaTabState(tabId: number, frameId: number, message: Record<string, unknown>) {
  if (!ToolboxShared.isRate(message.rate)) throw new Error("실제 미디어 배속이 누락된 상태 보고입니다.");
  const rate = message.rate;
  const mediaId = normalizeMediaText(message.mediaId, 96);
  const sourceKey = normalizeMediaText(message.sourceKey, 180);
  const hasMedia = message.hasMedia !== false && Boolean(mediaId && sourceKey);

  const state = await setMediaTabState(tabId, (current) => ({
    templateRate: message.updateTemplate === true ? rate : current.templateRate,
    active: hasMedia
      ? {
          frameId,
          mediaId,
          sourceKey,
          rate,
          kind: message.kind === "audio" ? "audio" : "video",
          label: normalizeMediaText(message.label || (message.kind === "audio" ? "오디오" : "동영상"), 140),
          updatedAt: Date.now()
        }
      : current.active
  }));

  notifyMediaTabStateUpdated(tabId, state);
  return state;
}

async function applyMediaRateToActiveSource(tabId: number, rawRate: unknown) {
  const rate = normalizeMediaTabRate(rawRate);
  let state = await getMediaTabState(tabId);
  state = await refreshMediaActiveState(tabId, state);
  const active = state.active;

  if (!active) {
    throw new Error("현재 탭에서 조절할 동영상이나 오디오를 찾지 못했습니다. 재생하거나 마우스를 올린 뒤 다시 시도하세요.");
  }

  const startRevision = mediaTargetRevisions.get(tabId) || 0;
  const response = await sendTabMessage(tabId, {
    type: MESSAGE_TYPES.APPLY_MEDIA_TAB_RATE,
    mediaId: active.mediaId,
    sourceKey: active.sourceKey,
    rate
  }, { frameId: active.frameId });

  if (!ToolboxShared.mediaReply(response)) throw new Error("미디어 배속 응답 형식이 올바르지 않습니다.");
  if (response.ok === false) throw new Error(response.error);
  if (!response.hasMedia || Math.abs(response.rate - rate) > 0.0001) {
    throw new Error("미디어의 실제 적용값이 요청한 배속과 일치하지 않습니다.");
  }

  if (response.mediaId !== active.mediaId || response.sourceKey !== active.sourceKey) {
    throw new Error("배속 응답의 미디어 소스가 요청한 대상과 다릅니다. 현재 미디어를 다시 확인하세요.");
  }
  let stale = false;
  try {
    state = await setMediaTabState(tabId, (current) => {
      if ((mediaTargetRevisions.get(tabId) || 0) !== startRevision ||
          ToolboxSettings.canonical(current.active) !== ToolboxSettings.canonical(active)) {
        stale = true;
        return current;
      }
      return {
        templateRate: response.templateRate,
        active: { ...active, rate: response.rate, label: response.label || active.label, updatedAt: Date.now() }
      };
    });
  } catch (error) {
    throw new Error(`현재 미디어에 ${response.rate}배속은 적용되었지만 세션 저장에 실패했습니다: ${ToolboxShared.errorMessage(error)}`);
  }
  if (stale) throw new Error("배속 처리 중 활성 미디어 또는 배속이 다시 변경되었습니다. 이전 응답을 저장하지 않았습니다. 현재 상태를 다시 확인하세요.");
  notifyMediaTabStateUpdated(tabId, state);
  return state;
}


function getElementEraserSiteKey(rawUrl: string|undefined) {
  try {
    const url = new URL(String(rawUrl || ""));
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.origin;
  } catch {
    return "";
  }
}

function isSafePersistentElementSelector(rawSelector: unknown): boolean {
  return ToolboxShared.isSafePersistentSelector(rawSelector);
}

function normalizeElementEraserRule(rule: Record<string,unknown>) {
  const selector = String(rule?.selector || "").trim();
  if (
    !selector ||
    selector.length > MAX_ELEMENT_ERASER_SELECTOR_LENGTH ||
    selector.includes("\0") ||
    !isSafePersistentElementSelector(selector)
  ) {
    return null;
  }

  const label = String(rule?.label || "요소")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 120) || "요소";
  const createdAtValue = Number(rule?.createdAt);
  const createdAt = Number.isFinite(createdAtValue) && createdAtValue > 0
    ? Math.floor(createdAtValue)
    : Date.now();

  return { selector, label, createdAt };
}

function normalizeElementEraserStore(rawStore: any): ElementEraserStore {
  const source: AnyRecord = rawStore && typeof rawStore === "object" ? rawStore : {};
  const store: ElementEraserStore = {};

  for (const [siteKey, rawRules] of Object.entries(source)) {
    if (!getElementEraserSiteKey(siteKey) || !Array.isArray(rawRules)) continue;

    const rules: ElementEraserRule[] = [];
    const seen = new Set<string>();
    for (const rawRule of rawRules) {
      const rule = normalizeElementEraserRule(rawRule);
      if (!rule || seen.has(rule.selector)) continue;
      seen.add(rule.selector);
      rules.push(rule);
    }

    rules.sort((first, second) => first.createdAt - second.createdAt);
    if (rules.length > MAX_ELEMENT_ERASER_RULES_PER_SITE) {
      rules.splice(0, rules.length - MAX_ELEMENT_ERASER_RULES_PER_SITE);
    }
    if (rules.length > 0) store[siteKey] = rules;
  }

  const siteEntries = Object.entries(store);
  if (siteEntries.length > MAX_ELEMENT_ERASER_SITES) {
    siteEntries
      .sort((first, second) => {
        const firstTime = Math.max(...first[1].map((rule) => rule.createdAt));
        const secondTime = Math.max(...second[1].map((rule) => rule.createdAt));
        return secondTime - firstTime;
      })
      .slice(MAX_ELEMENT_ERASER_SITES)
      .forEach(([siteKey]) => delete store[siteKey]);
  }

  return store;
}

async function getElementEraserStore() {
  const stored = await getStoredValues([ELEMENT_ERASER_RULES_STORAGE_KEY]);
  return normalizeElementEraserStore(stored[ELEMENT_ERASER_RULES_STORAGE_KEY]);
}

function migrateElementEraserRules() {
  return queueElementEraserWrite(async () => {
    const stored = await getStoredValues([ELEMENT_ERASER_RULES_STORAGE_KEY]);
    const current = stored[ELEMENT_ERASER_RULES_STORAGE_KEY];
    const normalized = normalizeElementEraserStore(current);
    if (JSON.stringify(current || {}) !== JSON.stringify(normalized)) {
      await setStoredValues({ [ELEMENT_ERASER_RULES_STORAGE_KEY]: normalized });
    }
    return normalized;
  });
}

function queueElementEraserWrite<T>(operation: () => Promise<T> | T): Promise<T> {
  const result = elementEraserWriteQueue
    .catch(() => {})
    .then(operation);
  elementEraserWriteQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function getElementEraserStatus(rawUrl: string|undefined) {
  const siteKey = getElementEraserSiteKey(rawUrl);
  if (!siteKey) {
    throw new Error("이 페이지에서는 요소 숨기기 기능을 사용할 수 없습니다.");
  }

  const store = await getElementEraserStore();
  return {
    siteKey,
    hostname: new URL(siteKey).hostname,
    count: Array.isArray(store[siteKey]) ? store[siteKey].length : 0
  };
}

async function addElementEraserRule(rawUrl: string|undefined, rawRule: Record<string,unknown>) {
  const siteKey = getElementEraserSiteKey(rawUrl);
  if (!siteKey) {
    throw new Error("이 페이지의 사이트 정보를 확인할 수 없습니다.");
  }

  const rule = normalizeElementEraserRule({ ...rawRule, createdAt: Date.now() });
  if (!rule) {
    throw new Error("이 요소를 다시 찾기 위한 선택자가 올바르지 않습니다.");
  }

  const store = await getElementEraserStore();
  const rules = Array.isArray(store[siteKey]) ? [...store[siteKey]] : [];
  const existingIndex = rules.findIndex((item) => item.selector === rule.selector);
  if (existingIndex >= 0) rules.splice(existingIndex, 1);
  rules.push(rule);

  if (rules.length > MAX_ELEMENT_ERASER_RULES_PER_SITE) {
    rules.splice(0, rules.length - MAX_ELEMENT_ERASER_RULES_PER_SITE);
  }
  store[siteKey] = rules;

  const normalizedStore = normalizeElementEraserStore(store);
  await setStoredValues({ [ELEMENT_ERASER_RULES_STORAGE_KEY]: normalizedStore });

  return {
    siteKey,
    hostname: new URL(siteKey).hostname,
    count: normalizedStore[siteKey]?.length || 0,
    selector: rule.selector
  };
}

async function clearElementEraserRules(rawUrl: string|undefined) {
  const siteKey = getElementEraserSiteKey(rawUrl);
  if (!siteKey) {
    throw new Error("이 페이지의 사이트 정보를 확인할 수 없습니다.");
  }

  const store = await getElementEraserStore();
  const removedCount = Array.isArray(store[siteKey]) ? store[siteKey].length : 0;
  delete store[siteKey];
  await setStoredValues({ [ELEMENT_ERASER_RULES_STORAGE_KEY]: store });

  return {
    siteKey,
    hostname: new URL(siteKey).hostname,
    count: 0,
    removedCount
  };
}

function sendTabMessage<T = AnyRecord>(
  tabId: number,
  message: AnyRecord,
  options: AnyRecord = {}
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, options, (response) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response);
    });
  });
}

function executeScript<Args extends unknown[], Result>(options: chrome.scripting.ScriptInjection<Args, Result>): Promise<chrome.scripting.InjectionResult<chrome.scripting.Awaited<Result>>[]> {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(options, (results) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(results || []);
    });
  });
}

function isNavigationGuardTargetUnavailableError(error: unknown): boolean {
  const message = String((error as AnyRecord)?.message || error || "").trim();
  if (!message) return false;

  return (
    /^No frame with ID(?::|\s)\s*\d+(?:\s+in tab with ID(?::|\s)\s*\d+)?\.?$/i.test(message) ||
    /^No document with ID(?::|\s)\s*['"]?[a-z0-9_-]+['"]?(?:\s+in tab with ID(?::|\s)\s*\d+)?\.?$/i.test(message) ||
    /^No tab with ID(?::|\s)\s*\d+\.?$/i.test(message) ||
    /^(?:The )?frame(?: with ID(?::|\s)\s*\d+)? was removed\.?$/i.test(message) ||
    /^Frame with ID(?::|\s)\s*\d+ does not exist\.?$/i.test(message) ||
    /^Frame with ID(?::|\s)\s*\d+ is not ready\.?$/i.test(message) ||
    /^Frame with ID(?::|\s)\s*\d+ is showing error page\.?$/i.test(message) ||
    /^Tab containing frame with ID(?::|\s)\s*\d+ was removed\.?$/i.test(message) ||
    /^The tab was closed\.?$/i.test(message)
  );
}

async function applyNavigationGuardSettingsToDocument(
  tabId: number,
  frameId: number,
  documentId: unknown,
  guardToken: unknown
) {
  if (typeof tabId !== "number" || !Number.isInteger(tabId) || tabId < 0 || !Number.isInteger(frameId) || frameId < 0) {
    throw new Error("페이지 프레임 정보를 확인하지 못했습니다.");
  }
  if (!/^__cbt_guard_[a-f0-9]{32,96}$/i.test(String(guardToken || ""))) {
    throw new Error("페이지 탐색 보호 연결값이 올바르지 않습니다.");
  }

  // Use the extension's stored settings as the authority. The page and the
  // content script message cannot choose a different MAIN-world state.
  const stored = await getStoredValues({
    backNavigationProtectionEnabled: false
  });
  const settings = {
    backNavigationProtectionEnabled: stored.backNavigationProtectionEnabled === true
  };
  const normalizedDocumentId = typeof documentId === "string" ? documentId.trim() : "";
  const target = normalizedDocumentId
    ? { tabId, documentIds: [normalizedDocumentId] }
    : { tabId, frameIds: [frameId] };

  try {
    await executeScript({
      target,
      world: "MAIN",
      injectImmediately: true,
      func: applyNavigationGuardMain,
      args: [String(guardToken), settings]
    });
  } catch (error) {
    // A document_start content script can outlive a short-lived iframe just long
    // enough for its message to reach the service worker. A frame can also become
    // unavailable before injection finishes. There is nothing useful left to
    // configure in those exact lifecycle states, and a replacement document sends
    // its own request.
    if (isNavigationGuardTargetUnavailableError(error)) {
      return { settings, applied: false };
    }
    throw error;
  }

  return { settings, applied: true };
}

function attachDebugger(target: AnyRecord): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    chrome.debugger.attach(target, DEBUGGER_PROTOCOL_VERSION, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function detachDebuggerStrict(target: AnyRecord): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    chrome.debugger.detach(target, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function sendCommand<T = AnyRecord>(
  target: chrome.debugger.Debuggee,
  command: string,
  params: AnyRecord = {}
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    chrome.debugger.sendCommand(target, command, params, (result) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve((result || {}) as T);
    });
  });
}

function queueTabDebuggerOperation<T>(tabId: number, task: () => Promise<T>): Promise<T> {
  return tabDebuggerOperationQueues.run(tabId, task);
}

function isDebuggerNotAttachedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return /debugger is not attached|not attached to the tab|no debugger session/i.test(message);
}

function isDebuggerTargetUnavailableError(error: unknown): boolean {
  return isClosedTabError(error) || /target closed|target was closed|no target with given id/i.test(
    error instanceof Error ? error.message : String(error || "")
  );
}

function markExpectedDebuggerDetach(tabId: number): symbol {
  const token = Symbol("debugger-detach");
  const tokens = expectedDebuggerDetaches.get(tabId) || new Set<symbol>();
  tokens.add(token);
  expectedDebuggerDetaches.set(tabId, tokens);
  return token;
}

function expireExpectedDebuggerDetach(tabId: number, token: symbol): void {
  const tokens = expectedDebuggerDetaches.get(tabId);
  if (!tokens) return;
  tokens.delete(token);
  if (tokens.size === 0) expectedDebuggerDetaches.delete(tabId);
}

function consumeExpectedDebuggerDetach(tabId: number): boolean {
  const token = expectedDebuggerDetaches.get(tabId)?.values().next().value;
  if (token === undefined) return false;
  expireExpectedDebuggerDetach(tabId, token);
  return true;
}

async function detachExtensionDebugger(tabId: number): Promise<void> {
  const target = { tabId };
  const detachToken = markExpectedDebuggerDetach(tabId);
  try {
    await detachDebuggerStrict(target);
    setTimeout(() => {
      expireExpectedDebuggerDetach(tabId, detachToken);
    }, 1500);
  } catch (error) {
    expireExpectedDebuggerDetach(tabId, detachToken);
    if (!isDebuggerNotAttachedError(error) && !isDebuggerTargetUnavailableError(error)) {
      throw error;
    }
  }
  // Keep ownership when an unexpected failure leaves the connection uncertain.
  extensionAttachedDebuggerTabs.delete(tabId);
}

async function ensureExtensionDebuggerAttached(tabId: number): Promise<boolean> {
  const target = { tabId };
  try {
    await sendCommand(target, "Runtime.enable");
    extensionAttachedDebuggerTabs.add(tabId);
    return false;
  } catch (error) {
    if (!isDebuggerNotAttachedError(error)) throw error;
  }

  await attachDebugger(target);
  extensionAttachedDebuggerTabs.add(tabId);
  return true;
}

function normalizeTabKeepActiveRecord(value: unknown): TabKeepActiveRecord | null {
  const source: AnyRecord | null = value && typeof value === "object" && !Array.isArray(value)
    ? value as AnyRecord
    : null;
  if (!source) return null;

  const mode: TabKeepActiveMode = source.mode === "global" ? "global" : "manual";
  const updatedAtValue = Number(source.updatedAt);
  return {
    mode,
    desired: source.desired !== false,
    originalAutoDiscardable: source.originalAutoDiscardable !== false,
    applied: source.applied === true,
    pending: source.pending === true,
    retryBlocked: source.retryBlocked === true,
    lastError: String(source.lastError || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 500),
    updatedAt: Number.isFinite(updatedAtValue) && updatedAtValue > 0
      ? Math.floor(updatedAtValue)
      : Date.now()
  };
}

function normalizeTabKeepActiveRecordStore(value: unknown): TabKeepActiveRecordStore {
  const source: AnyRecord = value && typeof value === "object" && !Array.isArray(value)
    ? value as AnyRecord
    : {};
  const store: TabKeepActiveRecordStore = {};

  for (const [rawTabId, rawRecord] of Object.entries(source)) {
    const tabId = Number(rawTabId);
    const record = normalizeTabKeepActiveRecord(rawRecord);
    if (typeof tabId !== "number" || !Number.isInteger(tabId) || tabId < 0 || !record) continue;
    store[String(tabId)] = record;
  }
  return store;
}

async function loadTabKeepActiveRecordStore(): Promise<TabKeepActiveRecordStore> {
  if (tabKeepActiveRecordsCache) return tabKeepActiveRecordsCache;
  if (!tabKeepActiveRecordsLoad) {
    tabKeepActiveRecordsLoad = getSessionStoredValues([TAB_KEEP_ACTIVE_RECORDS_SESSION_KEY])
      .then(stored => {
        tabKeepActiveRecordsCache = normalizeTabKeepActiveRecordStore(stored[TAB_KEEP_ACTIVE_RECORDS_SESSION_KEY]);
        return tabKeepActiveRecordsCache;
      }).finally(() => { tabKeepActiveRecordsLoad = null; });
  }
  return tabKeepActiveRecordsLoad;
}

function queueTabKeepActiveRecordWrite<T>(
  task: (store: TabKeepActiveRecordStore) => Promise<T> | T
): Promise<T> {
  const operation = tabKeepActiveRecordsWriteQueue
    .catch(() => {})
    .then(async () => {
      const original = await loadTabKeepActiveRecordStore();
      const store: TabKeepActiveRecordStore = Object.fromEntries(Object.entries(original).map(([id, record]) => [id, { ...record }]));
      const result = await task(store);
      await setSessionStoredValues({
        [TAB_KEEP_ACTIVE_RECORDS_SESSION_KEY]: { ...store }
      });
      tabKeepActiveRecordsCache = store;
      return result;
    });
  tabKeepActiveRecordsWriteQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

async function getTabKeepActiveRecord(tabId: number): Promise<TabKeepActiveRecord | null> {
  await tabKeepActiveRecordsWriteQueue.catch(() => {});
  const store = await loadTabKeepActiveRecordStore();
  const record = normalizeTabKeepActiveRecord(store[String(tabId)]);
  return record ? { ...record } : null;
}

async function getAllTabKeepActiveRecords(): Promise<TabKeepActiveRecordStore> {
  await tabKeepActiveRecordsWriteQueue.catch(() => {});
  const store = await loadTabKeepActiveRecordStore();
  return Object.fromEntries(
    Object.entries(store).map(([tabId, record]) => [tabId, { ...record }])
  );
}

function setTabKeepActiveRecord(
  tabId: number,
  record: TabKeepActiveRecord
): Promise<TabKeepActiveRecord> {
  return queueTabKeepActiveRecordWrite((store) => {
    const normalized = normalizeTabKeepActiveRecord(record);
    if (!normalized) throw new Error("탭 활성 상태 유지 기록이 올바르지 않습니다.");
    store[String(tabId)] = normalized;
    return { ...normalized };
  });
}

function removeTabKeepActiveRecord(tabId: number): Promise<void> {
  return queueTabKeepActiveRecordWrite((store) => {
    delete store[String(tabId)];
  });
}

async function getTabKeepActiveGlobalEnabled(): Promise<boolean> {
  if (tabKeepActiveGlobalEnabledCache !== null) {
    return tabKeepActiveGlobalEnabledCache;
  }
  const stored = await getStoredValues({ [TAB_KEEP_ACTIVE_GLOBAL_STORAGE_KEY]: false });
  tabKeepActiveGlobalEnabledCache = stored[TAB_KEEP_ACTIVE_GLOBAL_STORAGE_KEY] === true;
  return tabKeepActiveGlobalEnabledCache;
}

async function setTabKeepActiveGlobalEnabled(enabled: boolean): Promise<void> {
  await setStoredValues({ [TAB_KEEP_ACTIVE_GLOBAL_STORAGE_KEY]: enabled === true });
  tabKeepActiveGlobalEnabledCache = enabled === true;
}

function getTabKeepActiveEligibility(tab: BrowserTab): { eligible: boolean; reason: string } {
  const url = normalizeHttpUrl(getTabNavigationUrl(tab));
  if (!url) {
    return {
      eligible: false,
      reason: "HTTP 또는 HTTPS 웹페이지에서만 활성 상태를 유지할 수 있습니다."
    };
  }

  const hostname = new URL(url).hostname.toLowerCase();
  if (hostname === "chromewebstore.google.com" || hostname === "chrome.google.com") {
    return {
      eligible: false,
      reason: "Chrome 웹 스토어 페이지에는 디버거를 연결할 수 없습니다."
    };
  }

  return { eligible: true, reason: "" };
}

function isMinimizedWindowState(value: unknown): boolean {
  return String(value || "").toLowerCase() === "minimized";
}

async function getTabKeepActiveFocusContext(tab: BrowserTab): Promise<TabKeepActiveFocusContext> {
  const windowId = Number(tab.windowId);
  if (!Number.isInteger(windowId) || windowId < 0) {
    throw new Error("탭이 속한 Chrome 창을 확인할 수 없습니다.");
  }

  const windowInfo = await getWindow(windowId);
  const tabActive = tab.active === true;
  const windowMinimized = isMinimizedWindowState(windowInfo.state);

  // Focus emulation makes Chromium treat the page as visibly captured. That capture
  // forces fullscreen-within-tab and, on Windows, disables the video overlay path used
  // by NVIDIA RTX Video Super Resolution. Every active tab in a non-minimized Chrome window is a
  // displayed tab, even when another application or Chrome window currently has focus.
  // Keep those tabs entirely outside the persistent debugger session and emulate focus
  // only for true background tabs or tabs in minimized windows.
  const useNativeDisplayedState = tabActive && !windowMinimized;

  return {
    focusEmulationEnabled: !useNativeDisplayedState,
    debuggerRequired: !useNativeDisplayedState,
    useNativeDisplayedState,
    tabActive,
    windowMinimized,
    windowId
  };
}

function areTabKeepActiveFocusContextsEquivalent(
  left: TabKeepActiveFocusContext,
  right: TabKeepActiveFocusContext
): boolean {
  return (
    left.focusEmulationEnabled === right.focusEmulationEnabled &&
    left.debuggerRequired === right.debuggerRequired &&
    left.useNativeDisplayedState === right.useNativeDisplayedState &&
    left.tabActive === right.tabActive &&
    left.windowMinimized === right.windowMinimized &&
    left.windowId === right.windowId
  );
}

function normalizeTabIdList(rawTabIds: unknown): number[] {
  if (!Array.isArray(rawTabIds) || rawTabIds.length === 0) {
    throw new Error("처리할 탭을 하나 이상 선택하세요.");
  }
  if (rawTabIds.length > MAX_TAB_KEEP_ACTIVE_TARGETS) {
    throw new Error(`한 번에 최대 ${MAX_TAB_KEEP_ACTIVE_TARGETS}개의 탭만 처리할 수 있습니다.`);
  }

  const tabIds = [...new Set(rawTabIds)];
  if (tabIds.some((tabId) => typeof tabId !== "number" || !Number.isInteger(tabId) || tabId < 0)) {
    throw new Error("선택한 탭 번호가 올바르지 않습니다.");
  }
  return tabIds;
}

function makeTabKeepActiveOperationResult(
  tabId: number,
  status: TabKeepActiveOperationResult["status"],
  error = ""
): TabKeepActiveOperationResult {
  return { tabId, status, error: String(error || "").trim() };
}

function summarizeTabKeepActiveOperationResults(results: TabKeepActiveOperationResult[]): AnyRecord {
  return {
    results,
    appliedCount: results.filter((result) => result.status === "applied").length,
    disabledCount: results.filter((result) => result.status === "disabled").length,
    pendingCount: results.filter((result) => result.status === "pending").length,
    failedCount: results.filter((result) => result.status === "failed").length,
    skippedCount: results.filter((result) => result.status === "skipped").length
  };
}

async function readTabKeepActiveDocumentState(tabId: number): Promise<AnyRecord> {
  const response = await sendCommand<AnyRecord>({ tabId }, "Runtime.evaluate", {
    expression: "(() => ({ visibilityState: document.visibilityState, hidden: document.hidden, hasFocus: document.hasFocus() }))()",
    returnByValue: true,
    awaitPromise: false
  });

  if (response?.exceptionDetails) {
    const description = String(
      response.exceptionDetails?.exception?.description ||
      response.exceptionDetails?.text ||
      "페이지의 활성 상태를 읽지 못했습니다."
    );
    throw new Error(description);
  }

  const value = response?.result?.value;
  if (!value || typeof value !== "object") {
    throw new Error("페이지가 활성 상태 확인 결과를 반환하지 않았습니다.");
  }

  return {
    visibilityState: String(value.visibilityState || ""),
    hidden: value.hidden === true,
    hasFocus: value.hasFocus === true
  };
}

function assertTabKeepActiveLoadedTabState(tab: BrowserTab): void {
  const eligibility = getTabKeepActiveEligibility(tab);
  if (!eligibility.eligible) throw new Error(eligibility.reason);
  if (tab.discarded === true) {
    throw new Error("탭의 페이지가 메모리에서 언로드되어 활성 상태를 확인할 수 없습니다.");
  }
  if (tab.status === "loading") {
    throw new Error("탭의 페이지를 불러오는 중이라 활성 상태 확인을 기다리고 있습니다.");
  }
  if (tab.autoDiscardable !== false) {
    throw new Error("Chrome의 자동 탭 폐기 방지가 적용되지 않았습니다.");
  }
  if (tab.frozen === true) {
    throw new Error("탭이 여전히 정지된 상태입니다.");
  }
}

async function verifyTabKeepActiveDebuggerState(
  tabId: number,
  expectedFocusContext?: TabKeepActiveFocusContext
): Promise<AnyRecord> {
  let latestError: unknown = null;

  for (let attempt = 0; attempt < TAB_KEEP_ACTIVE_VERIFY_ATTEMPTS; attempt += 1) {
    try {
      const tab = await getTab(tabId);
      assertTabKeepActiveLoadedTabState(tab);

      const focusContext = await getTabKeepActiveFocusContext(tab);
      if (
        !focusContext.debuggerRequired ||
        !focusContext.focusEmulationEnabled ||
        focusContext.useNativeDisplayedState
      ) {
        throw new Error("탭이 화면에 표시되는 상태로 바뀌어 디버거 연결을 해제해야 합니다.");
      }
      if (
        expectedFocusContext &&
        !areTabKeepActiveFocusContextsEquivalent(expectedFocusContext, focusContext)
      ) {
        throw new Error("활성 탭이나 Chrome 창의 상태가 설정을 적용하는 동안 바뀌었습니다.");
      }

      const pageState = await readTabKeepActiveDocumentState(tabId);
      if (pageState.visibilityState !== "visible" || pageState.hidden !== false) {
        throw new Error(
          `페이지가 visible 상태를 보고하지 않았습니다. ` +
          `(visibilityState=${pageState.visibilityState || "unknown"}, ` +
          `hidden=${String(pageState.hidden)}, hasFocus=${String(pageState.hasFocus)})`
        );
      }
      if (pageState.hasFocus !== true) {
        throw new Error(
          `백그라운드 탭이 포커스 상태를 보고하지 않았습니다. ` +
          `(visibilityState=${pageState.visibilityState || "unknown"}, ` +
          `hidden=${String(pageState.hidden)}, hasFocus=${String(pageState.hasFocus)})`
        );
      }

      const latestTab = await getTab(tabId);
      assertTabKeepActiveLoadedTabState(latestTab);
      const latestFocusContext = await getTabKeepActiveFocusContext(latestTab);
      if (!areTabKeepActiveFocusContextsEquivalent(focusContext, latestFocusContext)) {
        throw new Error("활성 탭이나 Chrome 창의 상태가 최종 확인 중에 바뀌었습니다.");
      }

      return {
        mode: "emulated-background",
        tab: latestTab,
        pageState,
        focusContext: latestFocusContext,
        autoDiscardable: latestTab.autoDiscardable,
        frozen: false
      };
    } catch (error) {
      latestError = error;
      if (attempt + 1 < TAB_KEEP_ACTIVE_VERIFY_ATTEMPTS) {
        await delay(TAB_KEEP_ACTIVE_VERIFY_RETRY_MS);
      }
    }
  }

  throw latestError instanceof Error
    ? latestError
    : new Error("페이지의 최종 활성 상태를 확인하지 못했습니다.");
}

async function isExtensionDebuggerSessionAttached(tabId: number): Promise<boolean> {
  try {
    await sendCommand({ tabId }, "Runtime.enable");
    extensionAttachedDebuggerTabs.add(tabId);
    return true;
  } catch (error) {
    if (isDebuggerNotAttachedError(error)) {
      extensionAttachedDebuggerTabs.delete(tabId);
      return false;
    }
    throw error;
  }
}

async function verifyTabKeepActiveNativeDisplayedState(
  tabId: number,
  expectedFocusContext?: TabKeepActiveFocusContext
): Promise<AnyRecord> {
  let latestError: unknown = null;

  for (let attempt = 0; attempt < TAB_KEEP_ACTIVE_VERIFY_ATTEMPTS; attempt += 1) {
    try {
      const tab = await getTab(tabId);
      assertTabKeepActiveLoadedTabState(tab);

      const focusContext = await getTabKeepActiveFocusContext(tab);
      if (
        !focusContext.useNativeDisplayedState ||
        focusContext.debuggerRequired ||
        focusContext.focusEmulationEnabled
      ) {
        throw new Error("탭이 백그라운드 상태로 바뀌어 포커스 에뮬레이션을 다시 적용해야 합니다.");
      }
      if (
        expectedFocusContext &&
        !areTabKeepActiveFocusContextsEquivalent(expectedFocusContext, focusContext)
      ) {
        throw new Error("활성 탭이나 Chrome 창의 상태가 설정을 적용하는 동안 바뀌었습니다.");
      }
      if (await isExtensionDebuggerSessionAttached(tabId)) {
        throw new Error("화면에 표시된 탭의 확장 프로그램 디버거 연결이 해제되지 않았습니다.");
      }

      const latestTab = await getTab(tabId);
      assertTabKeepActiveLoadedTabState(latestTab);
      const latestFocusContext = await getTabKeepActiveFocusContext(latestTab);
      if (!areTabKeepActiveFocusContextsEquivalent(focusContext, latestFocusContext)) {
        throw new Error("활성 탭이나 Chrome 창의 상태가 최종 확인 중에 바뀌었습니다.");
      }

      return {
        mode: "native-displayed",
        tab: latestTab,
        pageState: null,
        focusContext: latestFocusContext,
        autoDiscardable: latestTab.autoDiscardable,
        frozen: false
      };
    } catch (error) {
      latestError = error;
      if (attempt + 1 < TAB_KEEP_ACTIVE_VERIFY_ATTEMPTS) {
        await delay(TAB_KEEP_ACTIVE_VERIFY_RETRY_MS);
      }
    }
  }

  throw latestError instanceof Error
    ? latestError
    : new Error("화면에 표시된 탭의 기본 렌더링 상태를 확인하지 못했습니다.");
}

async function bestEffortClearTabKeepActiveEmulation(tabId: number): Promise<void> {
  try {
    await sendCommand({ tabId }, "Emulation.setFocusEmulationEnabled", { enabled: false });
  } catch (error) {
    if (!isDebuggerNotAttachedError(error) && !isDebuggerTargetUnavailableError(error)) {
      throw error;
    }
  }
}

async function releaseTabKeepActiveDebuggerSession(tabId: number): Promise<void> {
  let firstError: unknown = null;

  try {
    await bestEffortClearTabKeepActiveEmulation(tabId);
  } catch (error) {
    firstError = error;
  }

  try {
    await detachExtensionDebugger(tabId);
  } catch (error) {
    if (!firstError) firstError = error;
  }

  if (firstError) throw firstError;
}

async function applyAndVerifyTabKeepActiveCurrentMode(tabId: number): Promise<AnyRecord> {
  let latestError: unknown = null;

  for (let attempt = 0; attempt < TAB_KEEP_ACTIVE_CONTEXT_APPLY_ATTEMPTS; attempt += 1) {
    try {
      const tab = await getTab(tabId);
      assertTabKeepActiveLoadedTabState(tab);
      const focusContext = await getTabKeepActiveFocusContext(tab);

      if (focusContext.useNativeDisplayedState) {
        await releaseTabKeepActiveDebuggerSession(tabId);
        return await verifyTabKeepActiveNativeDisplayedState(tabId, focusContext);
      }

      await ensureExtensionDebuggerAttached(tabId);
      await sendCommand({ tabId }, "Runtime.enable");
      await sendCommand({ tabId }, "Page.enable");

      const latestTab = await getTab(tabId);
      assertTabKeepActiveLoadedTabState(latestTab);
      const latestFocusContext = await getTabKeepActiveFocusContext(latestTab);
      if (
        !latestFocusContext.debuggerRequired ||
        !latestFocusContext.focusEmulationEnabled ||
        latestFocusContext.useNativeDisplayedState ||
        !areTabKeepActiveFocusContextsEquivalent(focusContext, latestFocusContext)
      ) {
        throw new Error("탭이 화면에 표시되는 상태로 바뀌어 디버거 연결을 해제해야 합니다.");
      }

      await sendCommand(
        { tabId },
        "Emulation.setFocusEmulationEnabled",
        { enabled: true }
      );
      await sendCommand({ tabId }, "Page.setWebLifecycleState", { state: "active" });

      return await verifyTabKeepActiveDebuggerState(tabId, latestFocusContext);
    } catch (error) {
      latestError = error;
      if (attempt + 1 < TAB_KEEP_ACTIVE_CONTEXT_APPLY_ATTEMPTS) {
        await delay(TAB_KEEP_ACTIVE_VERIFY_RETRY_MS);
      }
    }
  }

  throw latestError instanceof Error
    ? latestError
    : new Error("현재 탭과 창의 상태에 맞게 활성 상태 유지를 적용하지 못했습니다.");
}

async function applyTabKeepActive(
  tabId: number,
  mode: TabKeepActiveMode,
  forceRetry = false,
  syncOnly = false
): Promise<TabKeepActiveOperationResult> {
  return queueTabDebuggerOperation(tabId, async () => {
    let tab: BrowserTab;
    try {
      tab = await getTab(tabId);
    } catch (error) {
      if (isClosedTabError(error)) {
        await removeTabKeepActiveRecord(tabId).catch(() => {});
        return makeTabKeepActiveOperationResult(tabId, "skipped", "탭이 이미 닫혔습니다.");
      }
      return makeTabKeepActiveOperationResult(
        tabId,
        "failed",
        makeUserMessage(error, "탭 정보를 확인하지 못했습니다.")
      );
    }

    const eligibility = getTabKeepActiveEligibility(tab);
    const existingRecord = await getTabKeepActiveRecord(tabId);
    if (syncOnly) {
      const globalEnabled = await getTabKeepActiveGlobalEnabled();
      if (!globalEnabled && existingRecord?.desired !== true) {
        return makeTabKeepActiveOperationResult(
          tabId,
          "skipped",
          "이 탭에는 활성 상태 유지가 요청되어 있지 않습니다."
        );
      }
      mode = globalEnabled ? "global" : existingRecord?.mode || mode;
    }

    if (!eligibility.eligible) {
      if (existingRecord) {
        if (existingRecord.applied || extensionAttachedDebuggerTabs.has(tabId)) {
          await bestEffortClearTabKeepActiveEmulation(tabId).catch(() => {});
          await detachExtensionDebugger(tabId).catch(() => {});
        }
        await setTabKeepActiveRecord(tabId, {
          ...existingRecord,
          mode,
          desired: true,
          applied: false,
          pending: false,
          lastError: eligibility.reason,
          updatedAt: Date.now()
        });
      }
      return makeTabKeepActiveOperationResult(tabId, "skipped", eligibility.reason);
    }

    if (existingRecord?.retryBlocked && !forceRetry) {
      const focusContext = await getTabKeepActiveFocusContext(tab).catch(() => null);
      if (!focusContext?.useNativeDisplayedState) {
        return makeTabKeepActiveOperationResult(
          tabId,
          "failed",
          existingRecord.lastError || "개발자 도구를 닫은 뒤 선택한 탭에 다시 적용하세요."
        );
      }
    }

    const originalAutoDiscardable = existingRecord
      ? existingRecord.originalAutoDiscardable
      : tab.autoDiscardable !== false;
    const pendingRecord: TabKeepActiveRecord = {
      mode,
      desired: true,
      originalAutoDiscardable,
      applied: false,
      pending: true,
      retryBlocked: false,
      lastError: "",
      updatedAt: Date.now()
    };
    await setTabKeepActiveRecord(tabId, pendingRecord);

    try {
      if (tab.autoDiscardable !== false) {
        tab = await updateTab(tabId, { autoDiscardable: false });
      }
      const verifiedTab = await getTab(tabId);
      if (verifiedTab.autoDiscardable !== false) {
        throw new Error("Chrome의 자동 탭 폐기 방지를 적용하지 못했습니다.");
      }

      if (verifiedTab.discarded === true || verifiedTab.status === "loading") {
        const reason = verifiedTab.discarded === true
          ? "탭이 메모리에서 언로드되어 다음 페이지 로드 후 활성 상태를 적용합니다."
          : "탭의 페이지 로드가 끝난 뒤 활성 상태를 적용합니다.";
        await setTabKeepActiveRecord(tabId, {
          ...pendingRecord,
          pending: true,
          lastError: reason,
          updatedAt: Date.now()
        });
        return makeTabKeepActiveOperationResult(tabId, "pending", reason);
      }

      await applyAndVerifyTabKeepActiveCurrentMode(tabId);

      await setTabKeepActiveRecord(tabId, {
        ...pendingRecord,
        applied: true,
        pending: false,
        retryBlocked: false,
        lastError: "",
        updatedAt: Date.now()
      });
      return makeTabKeepActiveOperationResult(tabId, "applied");
    } catch (error) {
      const message = makeUserMessage(error, "탭의 활성 상태를 유지하지 못했습니다.");
      await releaseTabKeepActiveDebuggerSession(tabId).catch(() => {});
      await setTabKeepActiveRecord(tabId, {
        ...pendingRecord,
        applied: false,
        pending: false,
        retryBlocked: /another debugger|already attached|being debugged|개발자 도구/i.test(
          String((error as AnyRecord)?.message || error || "")
        ),
        lastError: message,
        updatedAt: Date.now()
      }).catch(() => {});
      return makeTabKeepActiveOperationResult(tabId, "failed", message);
    }
  });
}

async function disableTabKeepActive(tabId: number): Promise<TabKeepActiveOperationResult> {
  return queueTabDebuggerOperation(tabId, async () => {
    const record = await getTabKeepActiveRecord(tabId);
    if (!record) {
      return makeTabKeepActiveOperationResult(tabId, "skipped", "이 탭에는 활성 상태 유지가 적용되어 있지 않습니다.");
    }

    const disablingRecord = await setTabKeepActiveRecord(tabId, {
      ...record,
      desired: false,
      pending: false,
      retryBlocked: false,
      lastError: "원래 상태로 복원하는 중입니다.",
      updatedAt: Date.now()
    });

    try {
      await getTab(tabId);
    } catch (error) {
      if (isClosedTabError(error)) {
        await removeTabKeepActiveRecord(tabId);
        extensionAttachedDebuggerTabs.delete(tabId);
        return makeTabKeepActiveOperationResult(tabId, "disabled");
      }
      const message = makeUserMessage(error, "탭 정보를 확인하지 못했습니다.");
      await setTabKeepActiveRecord(tabId, {
        ...disablingRecord,
        desired: false,
        applied: false,
        pending: false,
        lastError: message,
        updatedAt: Date.now()
      }).catch(() => {});
      return makeTabKeepActiveOperationResult(tabId, "failed", message);
    }

    try {
      let firstError: unknown = null;

      try {
        await releaseTabKeepActiveDebuggerSession(tabId);
      } catch (error) {
        if (!isDebuggerNotAttachedError(error) && !isDebuggerTargetUnavailableError(error)) {
          firstError = error;
        }
      }

      try {
        const latestTab = await getTab(tabId);
        if (latestTab.autoDiscardable !== record.originalAutoDiscardable) {
          await updateTab(tabId, { autoDiscardable: record.originalAutoDiscardable });
        }
        const restoredTab = await getTab(tabId);
        if (restoredTab.autoDiscardable !== record.originalAutoDiscardable) {
          throw new Error("Chrome의 자동 탭 폐기 설정을 원래 값으로 복원하지 못했습니다.");
        }
      } catch (error) {
        if (!firstError) firstError = error;
      }

      if (firstError) throw firstError;

      await removeTabKeepActiveRecord(tabId);
      return makeTabKeepActiveOperationResult(tabId, "disabled");
    } catch (error) {
      const message = makeUserMessage(error, "탭의 활성 상태 유지 설정을 해제하지 못했습니다.");
      await setTabKeepActiveRecord(tabId, {
        ...disablingRecord,
        desired: false,
        applied: false,
        pending: false,
        lastError: message,
        updatedAt: Date.now()
      }).catch(() => {});
      return makeTabKeepActiveOperationResult(tabId, "failed", message);
    }
  });
}

async function mapTabKeepActiveWithConcurrency<T>(
  tabIds: number[],
  task: (tabId: number) => Promise<T>,
  concurrency = 6
): Promise<T[]> {
  return ToolboxShared.mapConcurrent(tabIds, task, concurrency);
}

async function refreshVerifiedTabKeepActiveRecord(
  tabId: number,
  _snapshot: TabKeepActiveRecord
): Promise<TabKeepActiveRecord | null> {
  // Read and write INSIDE the same per-tab queue as apply/disable. The caller's
  // old desired:true snapshot is never allowed to recreate a deleted record.
  return queueTabDebuggerOperation(tabId, async () => {
    const current = await getTabKeepActiveRecord(tabId);
    if (!current?.desired || !current.applied) return current;
    try {
      await applyAndVerifyTabKeepActiveCurrentMode(tabId);
      return await getTabKeepActiveRecord(tabId);
    } catch (error) {
      const latest = await getTabKeepActiveRecord(tabId);
      if (!latest?.desired || ToolboxSettings.canonical(latest) !== ToolboxSettings.canonical(current)) return latest;
      const message = makeUserMessage(error, "탭의 활성 상태 유지 결과를 다시 확인하지 못했습니다.");
      const updated = { ...latest, applied: false, pending: false,
        retryBlocked: /another debugger|already attached|being debugged|개발자 도구/i.test(String((error as AnyRecord)?.message || error || "")),
        lastError: message, updatedAt: Date.now() };
      await setTabKeepActiveRecord(tabId, updated);
      return updated;
    }
  });
}

async function getTabKeepActiveState(rawTabIds: unknown): Promise<AnyRecord> {
  const tabIds = normalizeTabIdList(rawTabIds);
  await ensureTabKeepActiveInitialized();
  const globalEnabled = await getTabKeepActiveGlobalEnabled();
  const statuses: AnyRecord = {};

  await mapTabKeepActiveWithConcurrency(tabIds, async (tabId) => {
    let tab: BrowserTab;
    try {
      tab = await getTab(tabId);
    } catch (error) {
      statuses[String(tabId)] = {
        tabId,
        eligible: false,
        desired: false,
        applied: false,
        pending: false,
        mode: "",
        error: isClosedTabError(error) ? "탭이 이미 닫혔습니다." : makeUserMessage(error, "탭 정보를 확인하지 못했습니다."),
        autoDiscardable: null,
        discarded: false,
        frozen: false
      };
      return;
    }

    const eligibility = getTabKeepActiveEligibility(tab);
    let record = await getTabKeepActiveRecord(tabId);
    if (record?.applied) {
      record = await refreshVerifiedTabKeepActiveRecord(tabId, record);
    }
    const desired = record?.desired === true || (globalEnabled && eligibility.eligible);
    const managed = Boolean(record);
    const pending = (record?.desired === true && record.pending === true) || (desired && !record);
    statuses[String(tabId)] = {
      tabId,
      eligible: eligibility.eligible,
      managed,
      desired,
      applied: record?.applied === true,
      pending,
      mode: globalEnabled && eligibility.eligible ? "global" : record?.mode || "",
      error: record?.lastError || (!eligibility.eligible ? eligibility.reason : ""),
      autoDiscardable: typeof tab.autoDiscardable === "boolean" ? tab.autoDiscardable : null,
      discarded: tab.discarded === true,
      frozen: tab.frozen === true
    };
  });

  return { globalEnabled, statuses };
}

function setSelectedTabsKeepActive(rawTabIds: unknown, enabled: boolean): Promise<AnyRecord> {
  return queueTabKeepActiveControl(() => performSelectedTabsKeepActive(rawTabIds, enabled));
}
async function performSelectedTabsKeepActive(
  rawTabIds: unknown,
  enabled: boolean
): Promise<AnyRecord> {
  const tabIds = normalizeTabIdList(rawTabIds);
  await ensureTabKeepActiveInitialized();
  const globalEnabled = await getTabKeepActiveGlobalEnabled();
  if (globalEnabled) {
    throw new Error("모든 탭의 활성 상태 유지가 켜져 있습니다. 일괄 기능을 먼저 끄세요.");
  }

  const results = await mapTabKeepActiveWithConcurrency(
    tabIds,
    (tabId) => enabled
      ? applyTabKeepActive(tabId, "manual", true)
      : disableTabKeepActive(tabId)
  );
  return {
    globalEnabled: false,
    ...summarizeTabKeepActiveOperationResults(results)
  };
}

function setAllTabsKeepActive(enabled: boolean): Promise<AnyRecord> {
  return queueTabKeepActiveControl(() => performAllTabsKeepActive(enabled));
}
async function performAllTabsKeepActive(enabled: boolean): Promise<AnyRecord> {
  await ensureTabKeepActiveInitialized();
  await setTabKeepActiveGlobalEnabled(enabled);

  let tabIds: number[];
  if (enabled) {
    const tabs = await queryTabs({});
    tabIds = tabs
      .map((tab) => Number(tab.id))
      .filter((tabId) => Number.isInteger(tabId) && tabId >= 0);
  } else {
    const records = await getAllTabKeepActiveRecords();
    tabIds = Object.keys(records)
      .map((tabId) => Number(tabId))
      .filter((tabId) => Number.isInteger(tabId) && tabId >= 0);
  }

  const results = await mapTabKeepActiveWithConcurrency(
    tabIds,
    (tabId) => enabled
      ? applyTabKeepActive(tabId, "global", true)
      : disableTabKeepActive(tabId)
  );
  return {
    globalEnabled: enabled,
    ...summarizeTabKeepActiveOperationResults(results)
  };
}

async function syncTabKeepActive(tabId: number, forceRetry = false): Promise<void> {
  const [globalEnabled, record] = await Promise.all([
    getTabKeepActiveGlobalEnabled(),
    getTabKeepActiveRecord(tabId)
  ]);
  if (!globalEnabled && record?.desired !== true) return;

  if (record?.retryBlocked && !forceRetry) return;

  const result = await applyTabKeepActive(
    tabId,
    globalEnabled ? "global" : record?.mode || "manual",
    forceRetry,
    true
  );
  if (result.status === "failed" && !result.error) {
    console.warn(`Could not keep tab ${tabId} active.`);
  }
}

async function syncTabKeepActiveForWindow(windowId: number): Promise<void> {
  if (!Number.isInteger(windowId) || windowId < 0) return;

  const tabs = await queryTabs({ windowId });
  const tabIds = tabs
    .map((tab) => Number(tab.id))
    .filter((tabId) => Number.isInteger(tabId) && tabId >= 0);

  await mapTabKeepActiveWithConcurrency(tabIds, async (tabId) => {
    await syncTabKeepActive(tabId, false).catch((error) => {
      if (!isClosedTabError(error)) {
        console.warn("Could not synchronize a tab active-state session after tab activation:", error);
      }
    });
  });
}

async function syncAllDesiredTabKeepActive(): Promise<void> {
  const [globalEnabled, records] = await Promise.all([
    getTabKeepActiveGlobalEnabled(),
    getAllTabKeepActiveRecords()
  ]);

  let tabIds: number[];
  if (globalEnabled) {
    const tabs = await queryTabs({});
    tabIds = tabs
      .map((tab) => Number(tab.id))
      .filter((tabId) => Number.isInteger(tabId) && tabId >= 0);
  } else {
    tabIds = Object.entries(records)
      .filter(([, record]) => record?.desired === true)
      .map(([tabId]) => Number(tabId))
      .filter((tabId) => Number.isInteger(tabId) && tabId >= 0);
  }

  await mapTabKeepActiveWithConcurrency(tabIds, async (tabId) => {
    await syncTabKeepActive(tabId, false).catch((error) => {
      if (!isClosedTabError(error)) {
        console.warn("Could not synchronize a tab active-state session after window focus changed:", error);
      }
    });
  });
}

function scheduleTabKeepActiveWindowSync(
  windowId: number,
  delayMs = TAB_KEEP_ACTIVE_WINDOW_SYNC_DELAY_MS
): void {
  if (!Number.isInteger(windowId) || windowId < 0) return;

  const existingTimer = tabKeepActiveWindowSyncTimers.get(windowId);
  if (existingTimer) clearTimeout(existingTimer);

  const timer = setTimeout(() => {
    tabKeepActiveWindowSyncTimers.delete(windowId);
    ensureTabKeepActiveInitialized()
      .then(() => syncTabKeepActiveForWindow(windowId))
      .catch((error) => {
        if (!/No window with id|No window with ID|window was closed|window was removed/i.test(
          String((error as AnyRecord)?.message || error || "")
        )) {
          console.warn("Could not synchronize page active-state maintenance for a Chrome window:", error);
        }
      });
  }, Math.max(0, delayMs));

  tabKeepActiveWindowSyncTimers.set(windowId, timer);
}

function scheduleAllDesiredTabKeepActiveSync(): void {
  if (tabKeepActiveAllWindowsSyncTimer) {
    clearTimeout(tabKeepActiveAllWindowsSyncTimer);
  }

  tabKeepActiveAllWindowsSyncTimer = setTimeout(() => {
    tabKeepActiveAllWindowsSyncTimer = null;
    ensureTabKeepActiveInitialized()
      .then(() => syncAllDesiredTabKeepActive())
      .catch((error) => {
        console.warn("Could not synchronize page active-state maintenance after Chrome window focus changed:", error);
      });
  }, TAB_KEEP_ACTIVE_WINDOW_SYNC_DELAY_MS);
}

async function cleanupClosedTabKeepActiveRecords(openTabs: BrowserTab[]): Promise<void> {
  const openTabIds = new Set(
    openTabs
      .map((tab) => Number(tab.id))
      .filter((tabId) => Number.isInteger(tabId) && tabId >= 0)
      .map(String)
  );
  const records = await getAllTabKeepActiveRecords();
  const closedTabIds = Object.keys(records).filter((tabId) => !openTabIds.has(tabId));
  if (closedTabIds.length === 0) return;

  await queueTabKeepActiveRecordWrite((store) => {
    for (const tabId of closedTabIds) delete store[tabId];
  });
}

async function initializeTabKeepActive(): Promise<void> {
  const tabs = await queryTabs({});
  await cleanupClosedTabKeepActiveRecords(tabs);
  const globalEnabled = await getTabKeepActiveGlobalEnabled();
  const records = await getAllTabKeepActiveRecords();
  const targetIds = globalEnabled
    ? tabs
      .map((tab) => Number(tab.id))
      .filter((tabId) => Number.isInteger(tabId) && tabId >= 0)
    : Object.keys(records)
      .map((tabId) => Number(tabId))
      .filter((tabId) => Number.isInteger(tabId) && tabId >= 0);

  await mapTabKeepActiveWithConcurrency(targetIds, async (tabId) => {
    const record = await getTabKeepActiveRecord(tabId).catch(() => null);
    const operation = !globalEnabled && record?.desired === false
      ? disableTabKeepActive(tabId).then(() => undefined)
      : syncTabKeepActive(tabId, false);
    await operation.catch((error) => {
      if (!isClosedTabError(error)) {
        console.warn("Could not restore a tab active-state session:", error);
      }
    });
  });
}

function ensureTabKeepActiveInitialized(): Promise<void> {
  if (tabKeepActiveInitialized) return Promise.resolve();
  if (tabKeepActiveInitializationPromise) return tabKeepActiveInitializationPromise;

  tabKeepActiveInitializationPromise = initializeTabKeepActive()
    .then(() => {
      tabKeepActiveInitialized = true;
    })
    .finally(() => {
      tabKeepActiveInitializationPromise = null;
    });
  return tabKeepActiveInitializationPromise;
}

async function shouldKeepDebuggerAttachedAfterTemporaryOperation(tabId: number): Promise<boolean> {
  const record = await getTabKeepActiveRecord(tabId).catch(() => null);
  if (record?.desired !== true || record.applied !== true) return false;

  try {
    const tab = await getTab(tabId);
    const focusContext = await getTabKeepActiveFocusContext(tab);
    return focusContext.debuggerRequired;
  } catch {
    // A temporary operation must not leave a debugger session behind when the
    // desired final state cannot be confirmed.
    return false;
  }
}

function downloadFile(options: chrome.downloads.DownloadOptions): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    chrome.downloads.download(options, (downloadId) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else if (!Number.isInteger(downloadId) || downloadId < 0) reject(new Error("Chrome이 다운로드 식별자를 반환하지 않았습니다."));
      else resolve(downloadId);
    });
  });
}

function setBadgeText(options: chrome.action.BadgeTextDetails): Promise<void> {
  return new Promise<void>((resolve) => {
    chrome.action.setBadgeText(options, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function setBadgeBackgroundColor(options: chrome.action.BadgeColorDetails): Promise<void> {
  return new Promise<void>((resolve) => {
    chrome.action.setBadgeBackgroundColor(options, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

async function setBadge(tabId: number|undefined, text: string, color = "#2563eb", clearAfter = 0) {
  await setBadgeBackgroundColor({ tabId, color });
  await setBadgeText({ tabId, text });

  if (text && clearAfter > 0) {
    setTimeout(() => {
      setBadgeText({ tabId, text: "" }).catch(() => {});
    }, clearAfter);
  }
}

function validateElementEraserTab(tab: BrowserTab): asserts tab is BrowserTab & { id: number; url: string } {
  if (typeof tab.id !== "number" || !Number.isInteger(tab.id) || !getElementEraserSiteKey(tab.url)) {
    throw new Error("이 페이지에서는 요소 숨기기 기능을 사용할 수 없습니다.");
  }
}

async function startElementEraser(tabId: number, requestedMode: string) {
  const mode = requestedMode === "persistent" ? "persistent" : "temporary";
  const tab = await getTab(tabId);
  validateElementEraserTab(tab);

  await executeScript({
    target: { tabId: tab.id },
    files: ["dist/element_eraser.js"]
  });

  const response = await sendTabMessage(tab.id, {
    type: MESSAGE_TYPES.ACTIVATE_ELEMENT_ERASER,
    mode
  });

  if (!response?.ok) {
    throw new Error(response?.error || "요소 숨기기 모드를 시작하지 못했습니다.");
  }

  return {
    tabId: tab.id,
    mode,
    siteKey: getElementEraserSiteKey(tab.url),
    hostname: new URL(tab.url).hostname
  };
}


function makeUserMessage(error: unknown, fallback: string) {
  const message = String(error instanceof Error ? error.message : error || "").trim();

  if (/another debugger|already attached|being debugged/i.test(message)) {
    return "개발자 도구 또는 다른 확장 프로그램이 현재 탭의 디버거를 사용하고 있습니다.";
  }

  if (/cannot access|cannot be scripted|missing host permission/i.test(message)) {
    return "이 페이지에는 확장 프로그램 도구를 삽입할 수 없습니다.";
  }

  return message || fallback;
}

// Preferences transfer is restricted to extension UI, validated twice, and never clears unrelated storage.
function validateImportedRules(raw: unknown): Record<string, unknown> {
  if (!ToolboxShared.isRecord(raw) || Object.keys(raw).length > MAX_ELEMENT_ERASER_SITES) throw new Error("사이트 숨김 규칙의 개수 또는 형식이 올바르지 않습니다.");
  const result: Record<string, unknown> = {};
  for (const [origin, rules] of Object.entries(raw)) {
    if (getElementEraserSiteKey(origin) !== origin || !Array.isArray(rules) || rules.length > MAX_ELEMENT_ERASER_RULES_PER_SITE) throw new Error("숨김 규칙에 올바르지 않은 사이트 주소 또는 규칙 개수가 있습니다.");
    const seen = new Set<string>();
    const checked: ElementEraserRule[] = [];
    for (const rawRule of rules) {
      if (!ToolboxShared.isRecord(rawRule) || Object.keys(rawRule).some(k => !["selector", "label", "createdAt"].includes(k)) ||
          typeof rawRule.selector !== "string" || typeof rawRule.label !== "string" || rawRule.label.length > 120 || /[\r\n\t\0]/.test(rawRule.label) ||
          typeof rawRule.createdAt !== "number" || !Number.isFinite(rawRule.createdAt) || rawRule.createdAt < 0 ||
          seen.has(rawRule.selector) || !normalizeElementEraserRule(rawRule)) throw new Error("안전하게 저장할 수 없는 요소 숨김 규칙입니다.");
      seen.add(rawRule.selector);
      checked.push({ selector: rawRule.selector, label: rawRule.label, createdAt: rawRule.createdAt });
    }
    result[origin] = checked;
  }
  return result;
}
function importPreferencePatch(backup: ToolboxSettings.Backup, options: ToolboxSettings.ImportOptions): Record<string, unknown> {
  const patch = { ...backup.settings };
  if (!options.includeGlobal) delete patch[ToolboxSettings.GLOBAL_KEY];
  if (options.includeRules && backup.rules !== undefined) patch[ToolboxSettings.RULES_KEY] = validateImportedRules(backup.rules);
  return patch;
}
async function exportPreferences(includeRules: boolean): Promise<ToolboxSettings.Backup> {
  const stored = await getStoredValues(null);
  const backup: ToolboxSettings.Backup = {
    app: "Browser Toolbox Extension", schemaVersion: 2, extensionVersion: chrome.runtime.getManifest().version,
    exportedAt: new Date().toISOString(), settings: ToolboxSettings.selectSettings(stored)
  };
  if (includeRules) backup.rules = validateImportedRules(stored[ToolboxSettings.RULES_KEY] || {});
  return backup;
}
async function previewPreferenceImport(raw: unknown, options: ToolboxSettings.ImportOptions): Promise<ToolboxSettings.Preview> {
  const backup = ToolboxSettings.validateBackup(raw);
  const current = await getStoredValues(null);
  const patch = importPreferencePatch(backup, options);
  const conflicts = ToolboxShared.shortcutConflicts({ ...current, ...patch });
  if (conflicts.length) throw new Error(`가져온 설정을 적용하면 단축키가 충돌합니다: ${conflicts.join("; ")}`);
  const rules = options.includeRules ? backup.rules || {} : {};
  return {
    digest: await ToolboxSettings.digest(current),
    changedKeys: Object.keys(patch).filter(key => ToolboxSettings.canonical(current[key]) !== ToolboxSettings.canonical(patch[key])),
    ruleSiteCount: Object.keys(rules).length, ruleCount: Object.values(rules).reduce<number>((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0),
    includesGlobal: options.includeGlobal && Object.prototype.hasOwnProperty.call(patch, ToolboxSettings.GLOBAL_KEY)
  };
}
let preferenceImportQueue: Promise<unknown> = Promise.resolve();
function applyPreferenceImport(raw: unknown, options: ToolboxSettings.ImportOptions, expectedDigest: unknown): Promise<{ changedCount: number; globalApplied: boolean }> {
  const apply = async () => {
    const backup = ToolboxSettings.validateBackup(raw);
    const preview = await previewPreferenceImport(backup, options);
    if (typeof expectedDigest !== "string" || preview.digest !== expectedDigest) throw new Error("미리보기 이후 현재 설정이 변경되었습니다. 파일을 다시 선택하여 미리보기를 확인해 주세요.");
    const patch = importPreferencePatch(backup, options);
    const globalValue = patch[ToolboxSettings.GLOBAL_KEY];
    delete patch[ToolboxSettings.GLOBAL_KEY];
    if (Object.keys(patch).length) {
      await setStoredValues(patch);
      const observed = await getStoredValues(Object.keys(patch));
      if (Object.keys(patch).some(key => ToolboxSettings.canonical(observed[key]) !== ToolboxSettings.canonical(patch[key]))) throw new Error("설정을 저장했지만 최종 저장값이 일치하지 않습니다. 다른 설정 작업과 충돌했을 수 있습니다. 현재 값을 확인해 주세요.");
    }
    if (typeof globalValue === "boolean") {
      try {
        const result = await setAllTabsKeepActive(globalValue);
        if (result.failedCount > 0) throw new Error(`${result.failedCount}개 탭 적용 실패`);
      } catch (error) {
        throw new Error(`일반 설정은 저장되었지만 전체 탭 활성 유지 변경에 실패했습니다: ${ToolboxShared.errorMessage(error)}`);
      }
    }
    return { changedCount: preview.changedKeys.length, globalApplied: typeof globalValue === "boolean" };
  };
  // Preview validation and the replacement are one operation relative to add,
  // clear and migration; unrelated preferences retain their existing queue.
  const task = preferenceImportQueue.then(() => options.includeRules ? queueElementEraserWrite(apply) : apply());
  preferenceImportQueue = task.catch(() => {});
  return task;
}
async function collectDiagnosticSnapshot(): Promise<Record<string, unknown>> {
  const stored = await getStoredValues(null);
  const tabs = await queryTabs({ active: true, currentWindow: true });
  const tab = tabs[0];
  const selectedSettings: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ToolboxSettings.selectSettings(stored))) {
    // No origins, URL lists, text, preferred caption labels, source IDs, or site selectors.
    if (typeof value === "boolean" || typeof value === "number" || key.startsWith("mediaShortcut") || key.startsWith("youtubeAbLoopShortcut")) selectedSettings[key] = value;
  }
  let targetAttached: boolean | null = null;
  try {
    const targets = await new Promise<AnyRecord[]>((resolve, reject) => chrome.debugger.getTargets((items) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message)); else resolve(items);
    }));
    if (typeof tab?.id === "number" && Number.isInteger(tab.id)) targetAttached = targets.some(item => item.tabId === tab.id && item.attached === true);
  } catch { /* Unknown is explicit; diagnostics must never attach a debugger. */ }
  let page: unknown = { state: "unavailable", reason: "현재 탭에 읽기 전용 진단을 실행할 수 없습니다." };
  if (typeof tab?.id === "number" && Number.isInteger(tab.id) && /^https?:\/\//i.test(getTabNavigationUrl(tab))) {
    try {
      const results = await executeScript({ target: { tabId: tab.id, frameIds: [0] }, world: "ISOLATED", func: () => {
        const global = globalThis as any;
        const controller = global.__chatgptBrowserToolsMediaControllerV1__;
        const media = Array.from(document.querySelectorAll("video, audio")).slice(0, 100).map(element => {
          const item = element as HTMLMediaElement;
          return { kind: item.tagName.toLowerCase(), playbackRate: item.playbackRate, defaultPlaybackRate: item.defaultPlaybackRate,
            paused: item.paused, readyState: item.readyState, connected: item.isConnected, textTrackCount: item.textTracks.length };
        });
        const caption = document.getElementById("__browser_toolbox_youtube_synced_caption_overlay__");
        return { state: "observed", frame: "top-frame-only", visibilityState: document.visibilityState, hasFocus: document.hasFocus(),
          fullscreenElement: Boolean(document.fullscreenElement), media, mediaLimit: 100,
          controller: controller?.getDiagnosticState?.() || { present: false },
          captions: { present: Boolean(caption), visible: caption?.dataset.visible === "true", layout: caption?.dataset.layoutStatus || "unknown", fontSize: caption?.dataset.fontSize || null } };
      } });
      page = results[0]?.result || page;
    } catch { /* Do not leak a permission error containing a page URL into a shareable report. */ }
  }
  let sessionStatus: "readable" | "unavailable" = "readable";
  try { await getSessionStoredValues([]); } catch { sessionStatus = "unavailable"; }
  return { schemaVersion: 1, extensionVersion: chrome.runtime.getManifest().version, capturedAt: new Date().toISOString(),
    browser: navigator.userAgent, scope: "current-active-tab-only", settings: selectedSettings,
    shortcutConflicts: ToolboxShared.shortcutConflicts(stored), sessionStorage: sessionStatus,
    debugger: { attachedToCurrentTarget: targetAttached, trackedAsAttachedByThisExtension: typeof tab?.id === "number" && Number.isInteger(tab.id) ? extensionAttachedDebuggerTabs.has(tab.id) : null },
    tab: tab ? { active: tab.active, discarded: tab.discarded, frozen: tab.frozen ?? null, autoDiscardable: tab.autoDiscardable, status: tab.status } : null,
    page, gpuVideoSuperResolution: "not-measured", privacy: "No URLs, titles, cookies, tokens, media sources, caption text, or site hiding rules included." };
}

// These commands name arbitrary tabs or create downloads and are UI capabilities,
// not content-script capabilities. Content-initiated selection/report commands are separate.
const UI_ONLY_MESSAGES = new Set<string>([
  MESSAGE_TYPES.GET_YOUTUBE_TRANSCRIPT_INFO, MESSAGE_TYPES.GET_YOUTUBE_TRANSCRIPT,
  MESSAGE_TYPES.APPLY_YOUTUBE_SYNCED_CAPTIONS, MESSAGE_TYPES.REMOVE_YOUTUBE_SYNCED_CAPTIONS,
  MESSAGE_TYPES.SAVE_YOUTUBE_TRANSCRIPT, MESSAGE_TYPES.SAVE_YOUTUBE_TRANSCRIPT_BATCH,
  MESSAGE_TYPES.START_ELEMENT_ERASER, MESSAGE_TYPES.GET_ELEMENT_ERASER_STATUS,
  MESSAGE_TYPES.CLEAR_ELEMENT_ERASER_RULES, MESSAGE_TYPES.CAPTURE_FULL_PAGE, MESSAGE_TYPES.START_AREA_SELECTION
]);
// A popup owns its pending caption work. Closing it cancels queued/running work,
// while already-installed caption tracks remain independent of this connection.
chrome.runtime.onConnect?.addListener(port => {
  if (port.name !== ToolboxShared.CAPTION_PORT_NAME) return;
  if (!isTrustedExtensionPageSender(port.sender)) { port.disconnect(); return; }
  const pending = new Map<string, AbortController>();
  let disconnected = false;
  const reply = (requestId: string, response: unknown) => {
    if (!disconnected) try { port.postMessage({ requestId, response }); } catch { /* The popup closed. */ }
  };
  port.onMessage.addListener((raw: unknown) => {
    if (!ToolboxShared.isRecord(raw) || typeof raw.requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(raw.requestId)) return;
    const requestId = raw.requestId;
    if (raw.cancel === true) { pending.get(requestId)?.abort(new Error("자막 작업을 취소했습니다.")); return; }
    if (pending.has(requestId)) return;
    if (pending.size >= 50) { reply(requestId, { ok: false, error: "진행 중인 자막 작업이 너무 많습니다." }); return; }
    try {
      const request = ToolboxShared.captionRequest(raw.message);
      const controller = new AbortController();
      pending.set(requestId, controller);
      void runYouTubeTranscriptPageTask(request.tabId, request.task, controller.signal)
        .then(result => reply(requestId, result), error => reply(requestId, { ok: false, error: ToolboxShared.errorMessage(error) }))
        .finally(() => pending.delete(requestId));
    } catch (error) { reply(requestId, { ok: false, error: ToolboxShared.errorMessage(error) }); }
  });
  port.onDisconnect.addListener(() => {
    disconnected = true;
    for (const controller of pending.values()) controller.abort(new Error("자막 패널이 닫혀 작업을 취소했습니다."));
    pending.clear();
  });
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (UI_ONLY_MESSAGES.has(message?.type) && !isTrustedExtensionPageSender(sender)) {
    sendResponse({ ok: false, error: "이 작업은 확장 프로그램 화면에서 요청해야 합니다." });
    return false;
  }
  if (Object.values(ToolboxSettings.MESSAGES).includes(message?.type)) {
    if (!isTrustedExtensionPageSender(sender)) {
      sendResponse({ ok: false, error: "설정 도구는 확장 프로그램 패널에서만 실행할 수 있습니다." });
      return false;
    }
    const options: ToolboxSettings.ImportOptions = { includeRules: message.includeRules === true, includeGlobal: message.includeGlobal === true };
    const task = message.type === ToolboxSettings.MESSAGES.EXPORT ? exportPreferences(options.includeRules)
      : message.type === ToolboxSettings.MESSAGES.PREVIEW ? previewPreferenceImport(message.backup, options)
      : message.type === ToolboxSettings.MESSAGES.APPLY ? applyPreferenceImport(message.backup, options, message.digest)
      : collectDiagnosticSnapshot();
    task.then(result => sendResponse({ ok: true, result })).catch(error => sendResponse({ ok: false, error: ToolboxShared.errorMessage(error) }));
    return true;
  }
  if (message?.type === MESSAGE_TYPES.GET_TAB_KEEP_ACTIVE_STATE) {
    if (!isTrustedExtensionPageSender(sender)) {
      sendResponse({ ok: false, error: "탭 활성 상태 확인 요청을 보낸 확장 프로그램 화면을 확인할 수 없습니다." });
      return false;
    }

    getTabKeepActiveState(message.tabIds)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        console.error("Could not read tab keep-active state:", error);
        sendResponse({
          ok: false,
          error: makeUserMessage(error, "탭의 활성 상태 유지 정보를 읽지 못했습니다.")
        });
      });
    return true;
  }

  if (message?.type === MESSAGE_TYPES.SET_SELECTED_TAB_KEEP_ACTIVE) {
    if (!isTrustedExtensionPageSender(sender)) {
      sendResponse({ ok: false, error: "탭 활성 상태 변경 요청을 보낸 확장 프로그램 화면을 확인할 수 없습니다." });
      return false;
    }

    setSelectedTabsKeepActive(message.tabIds, message.enabled === true)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        console.error("Could not update selected tab keep-active state:", error);
        sendResponse({
          ok: false,
          error: makeUserMessage(error, "선택한 탭의 활성 상태 유지 설정을 변경하지 못했습니다.")
        });
      });
    return true;
  }

  if (message?.type === MESSAGE_TYPES.SET_ALL_TAB_KEEP_ACTIVE) {
    if (!isTrustedExtensionPageSender(sender)) {
      sendResponse({ ok: false, error: "전체 탭 활성 상태 변경 요청을 보낸 확장 프로그램 화면을 확인할 수 없습니다." });
      return false;
    }

    setAllTabsKeepActive(message.enabled === true)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        console.error("Could not update all-tab keep-active state:", error);
        sendResponse({
          ok: false,
          error: makeUserMessage(error, "모든 탭의 활성 상태 유지 설정을 변경하지 못했습니다.")
        });
      });
    return true;
  }

  if (message?.type === MESSAGE_TYPES.CLEAR_SELECTED_SITE_DATA) {
    if (!isTrustedExtensionPageSender(sender)) {
      sendResponse({ ok: false, error: "사이트 데이터 삭제 요청을 보낸 확장 프로그램 화면을 확인할 수 없습니다." });
      return false;
    }

    clearSelectedTabSiteData(message.targets)
      .then((result) => sendResponse({
        ok: true,
        ...result,
        message: `${result.originCount}개 사이트의 쿠키와 캐시를 삭제했습니다.`
      }))
      .catch((error) => {
        console.error("Could not clear selected site data:", error);
        sendResponse({
          ok: false,
          error: makeUserMessage(error, "선택한 사이트의 쿠키와 캐시를 삭제하지 못했습니다.")
        });
      });
    return true;
  }

  if (message?.type === MESSAGE_TYPES.GET_MEDIA_TAB_STATE) {
    const uiSender = isTrustedExtensionPageSender(sender);
    const ownTab = sender?.tab?.id;
    if (!uiSender && (sender?.id !== chrome.runtime.id || typeof ownTab !== "number" || !Number.isInteger(ownTab) || ownTab < 0 ||
        (message.tabId !== undefined && message.tabId !== ownTab))) {
      sendResponse({ ok: false, error: "페이지의 미디어 상태는 요청한 페이지 자신의 탭에서만 확인할 수 있습니다." });
      return false;
    }
    const tabId = uiSender ? message.tabId : ownTab;
    if (typeof tabId !== "number" || !Number.isInteger(tabId) || tabId < 0) {
      sendResponse({ ok: false, error: "현재 탭을 확인할 수 없습니다." });
      return false;
    }

    getMediaTabState(tabId)
      .then((state) => refreshMediaActiveState(tabId, state))
      .then((state) => sendResponse(makeMediaPopupState(tabId, state)))
      .catch((error) => sendResponse({ ok: false, error: makeUserMessage(error, "현재 탭의 미디어 상태를 확인하지 못했습니다.") }));
    return true;
  }

  if (message?.type === MESSAGE_TYPES.SET_MEDIA_TAB_RATE) {
    if (!isTrustedExtensionPageSender(sender)) {
      sendResponse({ ok: false, error: "미디어 배속은 확장 프로그램 패널에서 요청해야 합니다." });
      return false;
    }
    const tabId = message.tabId;
    if (typeof tabId !== "number" || !Number.isInteger(tabId) || tabId < 0) {
      sendResponse({ ok: false, error: "현재 탭을 확인할 수 없습니다." });
      return false;
    }

    applyMediaRateToActiveSource(tabId, message.rate)
      .then((state) => sendResponse(makeMediaPopupState(tabId, state)))
      .catch((error) => sendResponse({ ok: false, error: makeUserMessage(error, "현재 선택된 미디어의 재생 속도를 적용하지 못했습니다.") }));
    return true;
  }

  if (message?.type === MESSAGE_TYPES.REPORT_MEDIA_TAB_RATE) {
    const tabId = sender.tab?.id;
    const frameId = Number(sender.frameId);
    if (typeof tabId !== "number" || !Number.isInteger(tabId) || tabId < 0 || !Number.isInteger(frameId) || frameId < 0) {
      sendResponse({ ok: false, error: "현재 미디어가 있는 탭과 프레임을 확인할 수 없습니다." });
      return false;
    }

    reportMediaTabState(tabId, frameId, message)
      .then((state) => sendResponse(makeMediaPopupState(tabId, state)))
      .catch((error) => sendResponse({ ok: false, error: makeUserMessage(error, "현재 미디어 상태를 저장하지 못했습니다.") }));
    return true;
  }

  if (ToolboxShared.isCaptionMessage(message)) {
    let request: ReturnType<typeof ToolboxShared.captionRequest>;
    try { request = ToolboxShared.captionRequest(message); }
    catch (error) { sendResponse({ ok: false, error: makeUserMessage(error, "자막 요청 형식이 올바르지 않습니다.") }); return false; }
    runYouTubeTranscriptPageTask(request.tabId, request.task)
      .then(result => sendResponse({ ok: true, ...result }))
      .catch(error => sendResponse({ ok: false, error: makeUserMessage(error, "유튜브 자막 작업을 완료하지 못했습니다.") }));
    return true;
  }

  if (message?.type === MESSAGE_TYPES.SAVE_YOUTUBE_TRANSCRIPT) {
    saveYouTubeTranscriptText(message.text, message.title, message.videoId, {
      combinedCount: message.combinedCount
    })
      .then((result) => sendResponse({
        ok: true,
        ...result,
        message: "정리한 유튜브 자막의 텍스트 파일 다운로드를 시작했습니다."
      }))
      .catch((error) => {
        console.error("Could not save the YouTube transcript:", error);
        sendResponse({
          ok: false,
          error: makeUserMessage(error, "유튜브 자막 텍스트 파일을 저장하지 못했습니다.")
        });
      });
    return true;
  }

  if (message?.type === MESSAGE_TYPES.SAVE_YOUTUBE_TRANSCRIPT_BATCH) {
    saveYouTubeTranscriptBatch(message.files)
      .then((result) => sendResponse({
        ok: true,
        ...result,
        message: `${result.results.length}개의 유튜브 자막을 개별 텍스트 파일로 다운로드하기 시작했습니다.`
      }))
      .catch((error) => {
        console.error("Could not save the YouTube transcript batch:", error);
        sendResponse({
          ok: false,
          error: makeUserMessage(error, "유튜브 자막 파일들을 저장하지 못했습니다.")
        });
      });
    return true;
  }

  if (message?.type === MESSAGE_TYPES.ADD_ELEMENT_ERASER_RULE) {
    if (!sender.tab) {
      sendResponse({ ok: false, error: "현재 탭 정보를 확인하지 못했습니다." });
      return false;
    }

    const pageUrl = sender.url || sender.tab.url;
    queueElementEraserWrite(() => addElementEraserRule(pageUrl, {
      selector: message.selector,
      label: message.label
    }))
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        console.error("Could not save the page element eraser rule:", error);
        sendResponse({
          ok: false,
          error: makeUserMessage(error, "이 사이트의 요소 숨기기 규칙을 저장하지 못했습니다.")
        });
      });

    return true;
  }

  if (message?.type === MESSAGE_TYPES.GET_ELEMENT_ERASER_STATUS) {
    const tabId = message.tabId;
    if (typeof tabId !== "number" || !Number.isInteger(tabId) || tabId < 0) {
      sendResponse({ ok: false, error: "현재 탭을 확인할 수 없습니다." });
      return false;
    }

    getTab(tabId)
      .then((tab) => getElementEraserStatus(tab.url))
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: makeUserMessage(error, "이 사이트의 요소 숨기기 정보를 읽지 못했습니다.")
        });
      });

    return true;
  }

  if (message?.type === MESSAGE_TYPES.CLEAR_ELEMENT_ERASER_RULES) {
    const tabId = message.tabId;
    if (typeof tabId !== "number" || !Number.isInteger(tabId) || tabId < 0) {
      sendResponse({ ok: false, error: "현재 탭을 확인할 수 없습니다." });
      return false;
    }

    getTab(tabId)
      .then((tab) => queueElementEraserWrite(() => clearElementEraserRules(tab.url)))
      .then((result) => sendResponse({
        ok: true,
        ...result,
        message: result.removedCount > 0
          ? `${result.removedCount}개의 기억된 요소를 복원했습니다.`
          : "이 사이트에 기억된 요소가 없습니다."
      }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: makeUserMessage(error, "이 사이트의 기억된 요소를 복원하지 못했습니다.")
        });
      });

    return true;
  }

  if (message?.type === MESSAGE_TYPES.REGISTER_NATIVE_LINK_ACTIVATION) {
    try {
      const result = registerNativeLinkActivation(
        message.url,
        message.inputKind,
        sender
      );
      sendResponse({ ok: true, ...result });
    } catch (error) {
      sendResponse({
        ok: false,
        error: makeUserMessage(error, "Chrome의 기본 링크 입력을 확인하지 못했습니다.")
      });
    }
    return false;
  }

  if (message?.type === MESSAGE_TYPES.APPLY_NAVIGATION_GUARD) {
    const senderUrl = String(sender.url || sender.tab?.url || "");
    if (!sender.tab || typeof sender.tab.id !== "number" || !Number.isInteger(sender.tab.id) || !/^https?:\/\//i.test(senderUrl)) {
      sendResponse({ ok: false, error: "현재 웹페이지 프레임을 확인하지 못했습니다." });
      return false;
    }

    const frameId = typeof sender.frameId === "number" && Number.isInteger(sender.frameId) ? sender.frameId : 0;
    const documentId = typeof sender.documentId === "string" ? sender.documentId : "";
    applyNavigationGuardSettingsToDocument(
      sender.tab.id,
      frameId,
      documentId,
      message.guardToken
    )
      .then((result) => sendResponse({
        ok: true,
        settings: result.settings,
        applied: result.applied
      }))
      .catch((error) => {
        if (isNavigationGuardTargetUnavailableError(error)) {
          sendResponse({ ok: true, applied: false });
          return;
        }

        const messageText = makeUserMessage(error, "페이지 탐색 보호 설정을 적용하지 못했습니다.");
        console.error("Could not apply navigation guard settings:", error);
        sendResponse({ ok: false, error: messageText });
      });
    return true;
  }

  if (message?.type === MESSAGE_TYPES.START_ELEMENT_ERASER) {
    const tabId = message.tabId;
    if (typeof tabId !== "number" || !Number.isInteger(tabId) || tabId < 0) {
      sendResponse({ ok: false, error: "현재 탭을 확인할 수 없습니다." });
      return false;
    }

    startElementEraser(tabId, message.mode)
      .then((result) => sendResponse({
        ok: true,
        ...result,
        message: result.mode === "persistent"
          ? "페이지에서 숨길 요소를 클릭하세요. 선택한 요소를 이 사이트에 기억합니다."
          : "페이지에서 숨길 요소를 클릭하세요. 새로 고치면 다시 나타납니다."
      }))
      .catch(async (error) => {
        console.error("Could not start page element eraser:", error);
        await setBadge(tabId, "ERR", "#b91c1c", BADGE_CLEAR_DELAY_MS).catch(() => {});
        sendResponse({
          ok: false,
          error: makeUserMessage(error, "요소 숨기기 모드를 시작하지 못했습니다.")
        });
      });

    return true;
  }
  if (message?.type === MESSAGE_TYPES.AREA_SELECTION_READY && sender.tab?.id) {
    setBadge(sender.tab.id, "SEL", "#2563eb").catch(() => {});
    return false;
  }

  if (message?.type === MESSAGE_TYPES.AREA_SELECTION_CANCELLED && sender.tab?.id) {
    setBadgeText({ tabId: sender.tab.id, text: "" }).catch(() => {});
    return false;
  }

  if (message?.type === MESSAGE_TYPES.CAPTURE_FULL_PAGE) {
    const tabId = message.tabId;
    if (typeof tabId !== "number" || !Number.isInteger(tabId) || tabId < 0) {
      sendResponse({ ok: false, error: "현재 탭을 확인할 수 없습니다." });
      return false;
    }

    captureFullPage(tabId)
      .then((result) => {
        sendResponse({
          ok: true,
          ...result,
          message: "현재 페이지 전체 PNG 파일의 다운로드를 시작했습니다."
        });
      })
      .catch(async (error) => {
        console.error("Full page screenshot failed:", error);
        await setBadge(tabId, "ERR", "#b91c1c", BADGE_CLEAR_DELAY_MS).catch(() => {});
        sendResponse({
          ok: false,
          error: makeUserMessage(error, "전체 페이지 화면 캡처에 실패했습니다.")
        });
      });

    return true;
  }

  if (message?.type === MESSAGE_TYPES.START_AREA_SELECTION) {
    const tabId = message.tabId;
    if (typeof tabId !== "number" || !Number.isInteger(tabId) || tabId < 0) {
      sendResponse({ ok: false, error: "현재 탭을 확인할 수 없습니다." });
      return false;
    }

    startAreaSelection(tabId)
      .then((result) => {
        sendResponse({
          ok: true,
          ...result,
          message: "페이지에서 드래그하여 캡처할 영역을 선택하세요."
        });
      })
      .catch(async (error) => {
        console.error("Could not start area selection:", error);
        await setBadge(tabId, "ERR", "#b91c1c", BADGE_CLEAR_DELAY_MS).catch(() => {});
        sendResponse({
          ok: false,
          error: makeUserMessage(error, "영역 선택 도구를 시작하지 못했습니다.")
        });
      });

    return true;
  }

  if (message?.type === MESSAGE_TYPES.CAPTURE_SELECTED_AREA && sender.tab) {
    if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.documentId) {
      sendResponse({ ok: false, error: "영역을 선택한 페이지를 확인할 수 없습니다. 현재 페이지에서 다시 선택하세요." });
      return false;
    }
    const sourceTab = {
      ...sender.tab,
      url: sender.tab.url || sender.url || ""
    };

    captureSelection(sourceTab, message.rectangle, sender.documentId)
      .then((result) => sendResponse(result))
      .catch(async (error) => {
        console.error("Selected area screenshot failed:", error);
        if (typeof sourceTab.id === "number") {
          await setBadge(sourceTab.id, "ERR", "#b91c1c", BADGE_CLEAR_DELAY_MS).catch(() => {});
        }
        sendResponse({
          ok: false,
          error: makeUserMessage(error, "선택한 영역을 저장하지 못했습니다.")
        });
      });

    return true;
  }

  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  migrateElementEraserRules().catch((error) => {
    console.error("Could not migrate remembered element-hiding rules:", error);
  });
  removeStoredValues([
    LEGACY_VISITED_LINKS_STORAGE_KEY,
    "mediaPlaybackRate",
    "newTabLinksEnabled",
    "linkAddressCopyEnabled",
    "siteWarningBypassEnabled",
    "youtubeSpeedMenuEnabled",
    "dcinsideReadingGuardEnabled"
  ]).catch((error) => {
    console.error("Could not remove legacy extension records:", error);
  });
  // The loader commits the new format before deleting the old records. Deleting
  // them here first loses existing tab rates, including when migration fails.
  getMediaTabStatesStore().catch(error => console.warn("Could not migrate tab media sessions:", error));
  removeSessionStoredValues(["dcinsideReadingGuardStateV1"])
    .catch(error => console.warn("Could not remove obsolete session records:", error));
  ensureTabKeepActiveInitialized().catch((error) => {
    console.warn("Could not initialize tab active-state maintenance after installation:", error);
  });
});

chrome.runtime.onStartup.addListener(() => {
  migrateElementEraserRules().catch((error) => {
    console.error("Could not migrate remembered element-hiding rules:", error);
  });
  ensureTabKeepActiveInitialized().catch((error) => {
    console.warn("Could not restore tab active-state maintenance on startup:", error);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  removeMediaTabState(tabId).catch(error => console.warn("Could not remove the closed tab media session:", error));
  void queueTabDebuggerOperation(tabId, async () => {
    extensionAttachedDebuggerTabs.delete(tabId);
    expectedDebuggerDetaches.delete(tabId);
    await removeTabKeepActiveRecord(tabId);
  }).catch(error => console.warn("Could not remove the closed tab active-state record:", error));
  pendingNativeLinkActivations.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  const relevant =
    changeInfo?.status === "complete" ||
    typeof changeInfo?.url === "string" ||
    changeInfo?.discarded === false ||
    changeInfo?.frozen === true ||
    changeInfo?.autoDiscardable === true;
  if (!relevant) return;

  ensureTabKeepActiveInitialized()
    .then(() => syncTabKeepActive(tabId, false))
    .catch((error) => {
      if (!isClosedTabError(error)) {
        console.warn("Could not synchronize a tab active-state session after a tab update:", error);
      }
    });
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  scheduleTabKeepActiveWindowSync(Number(activeInfo?.windowId), 0);
});

chrome.tabs.onDetached.addListener((_tabId, detachInfo) => {
  scheduleTabKeepActiveWindowSync(Number(detachInfo?.oldWindowId));
});

chrome.tabs.onAttached.addListener((_tabId, attachInfo) => {
  scheduleTabKeepActiveWindowSync(Number(attachInfo?.newWindowId));
});

chrome.windows.onFocusChanged.addListener(() => {
  scheduleAllDesiredTabKeepActiveSync();
});

chrome.windows.onBoundsChanged.addListener((windowInfo) => {
  scheduleTabKeepActiveWindowSync(Number(windowInfo?.id));
});

chrome.windows.onRemoved.addListener((windowId) => {
  const timer = tabKeepActiveWindowSyncTimers.get(windowId);
  if (timer) clearTimeout(timer);
  tabKeepActiveWindowSyncTimers.delete(windowId);
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  queueTabKeepActiveControl(async () => {
    await ensureTabKeepActiveInitialized();
    const [globalEnabled, removedRecord] = await Promise.all([
      getTabKeepActiveGlobalEnabled(),
      getTabKeepActiveRecord(removedTabId)
    ]);
    await removeTabKeepActiveRecord(removedTabId).catch(() => {});
    extensionAttachedDebuggerTabs.delete(removedTabId);
    expectedDebuggerDetaches.delete(removedTabId);

    if (!globalEnabled && removedRecord?.desired !== true) return;
    if (removedRecord?.desired === true && !globalEnabled) {
      const addedTab = await getTab(addedTabId);
      await setTabKeepActiveRecord(addedTabId, {
        ...removedRecord,
        desired: true,
        originalAutoDiscardable: addedTab.autoDiscardable !== false,
        applied: false,
        pending: true,
        retryBlocked: false,
        lastError: "교체된 탭에 활성 상태를 다시 적용합니다.",
        updatedAt: Date.now()
      });
    }
    await syncTabKeepActive(addedTabId, false);
  }).catch((error) => {
    if (!isClosedTabError(error)) {
      console.warn("Could not transfer tab active-state maintenance to a replacement tab:", error);
    }
  });
});

chrome.debugger.onDetach.addListener((source, reason) => {
  const tabId = Number(source?.tabId);
  if (typeof tabId !== "number" || !Number.isInteger(tabId) || tabId < 0) return;

  extensionAttachedDebuggerTabs.delete(tabId);
  if (consumeExpectedDebuggerDetach(tabId)) return;
  if (reason === "target_closed") return;

  queueTabDebuggerOperation(tabId, async () => {
      const record = await getTabKeepActiveRecord(tabId);
      if (!record || !record.desired) return;
      const message = reason === "canceled_by_user"
        ? "사용자 취소 또는 개발자 도구 연결로 활성 상태 유지가 중단되었습니다. 연결 상태를 확인한 뒤 선택한 탭에 다시 적용하세요."
        : "Chrome이 이 탭의 디버거 연결을 종료하여 활성 상태 유지가 중단되었습니다.";
      return setTabKeepActiveRecord(tabId, {
        ...record,
        applied: false,
        pending: false,
        retryBlocked: reason === "canceled_by_user",
        lastError: message,
        updatedAt: Date.now()
      });
    })
    .catch((error) => {
      console.warn("Could not record an unexpected debugger detach:", error);
    });
});

ensureTabKeepActiveInitialized().catch((error) => {
  console.warn("Could not initialize tab active-state maintenance:", error);
});
