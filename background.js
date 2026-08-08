"use strict";

importScripts("navigation_guard.js", "youtube_transcript_page_task.js");

const DEBUGGER_PROTOCOL_VERSION = "1.3";
const BADGE_CLEAR_DELAY_MS = 1800;

const MESSAGE_TYPES = Object.freeze({
  CAPTURE_FULL_PAGE: "capture-full-page",
  START_AREA_SELECTION: "start-area-selection",
  CAPTURE_SELECTED_AREA: "drag-area-screenshot:capture",
  AREA_SELECTION_READY: "drag-area-screenshot:ready",
  AREA_SELECTION_CANCELLED: "drag-area-screenshot:cancel",
  OPEN_LINK_IN_NEW_TAB: "page-tools:open-link-in-new-tab",
  GET_CONTEXT_LINK: "page-tools:get-context-link",
  COPY_LINK_ADDRESS: "page-tools:copy-link-address",
  APPLY_NAVIGATION_GUARD: "page-tools:apply-navigation-guard",
  START_ELEMENT_ERASER: "page-element-eraser:start",
  ACTIVATE_ELEMENT_ERASER: "page-element-eraser:activate",
  ADD_ELEMENT_ERASER_RULE: "page-element-eraser:add-rule",
  GET_ELEMENT_ERASER_STATUS: "page-element-eraser:get-site-status",
  CLEAR_ELEMENT_ERASER_RULES: "page-element-eraser:clear-site-rules",
  GET_YOUTUBE_TRANSCRIPT_INFO: "youtube-transcript:get-info",
  GET_YOUTUBE_TRANSCRIPT: "youtube-transcript:get-transcript",
  SAVE_YOUTUBE_TRANSCRIPT: "youtube-transcript:save-text",
  SAVE_YOUTUBE_TRANSCRIPT_BATCH: "youtube-transcript:save-batch",
  GET_MEDIA_TAB_STATE: "media-controller:get-tab-state",
  SET_MEDIA_TAB_RATE: "media-controller:set-tab-rate",
  REPORT_MEDIA_TAB_RATE: "media-controller:report-tab-rate",
  APPLY_MEDIA_TAB_RATE: "media-controller:apply-tab-rate",
  MEDIA_TAB_RATE_UPDATED: "media-controller:tab-rate-updated"
});

const LINK_OPEN_MENU_ID = "page-tools-open-real-link-new-tab";
const LINK_OPEN_MENU_TITLE = "버튼 링크를 새 탭에서 열기";
const LINK_COPY_MENU_ID = "page-tools-copy-real-link-address";
const LINK_COPY_MENU_TITLE = "링크 주소 복사";
const LINK_OPEN_SETTING_KEY = "newTabLinksEnabled";
const LINK_COPY_SETTING_KEY = "linkAddressCopyEnabled";
const LINK_MENU_DOCUMENT_PATTERNS = Object.freeze(["http://*/*", "https://*/*"]);
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
const capturingTabs = new Set();
let contextMenuSyncSequence = 0;
let elementEraserWriteQueue = Promise.resolve();
let mediaTabStatesCache = null;
let mediaTabStatesWriteQueue = Promise.resolve();

function getTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(tab);
    });
  });
}

function getStoredValues(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (values) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(values || {});
    });
  });
}

function setStoredValues(values) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function removeStoredValues(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function getSessionStoredValues(keys) {
  return new Promise((resolve) => {
    const area = chrome.storage?.session;
    if (!area || typeof area.get !== "function") {
      resolve({});
      return;
    }
    area.get(keys, (values) => {
      void chrome.runtime.lastError;
      resolve(values || {});
    });
  });
}

function setSessionStoredValues(values) {
  return new Promise((resolve) => {
    const area = chrome.storage?.session;
    if (!area || typeof area.set !== "function") {
      resolve();
      return;
    }
    area.set(values, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function removeSessionStoredValues(keys) {
  return new Promise((resolve) => {
    const area = chrome.storage?.session;
    if (!area || typeof area.remove !== "function") {
      resolve();
      return;
    }
    area.remove(keys, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function normalizeMediaTabRate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(MEDIA_RATE_MAX, Math.max(MEDIA_RATE_MIN, Math.round(numeric * 100) / 100));
}

function normalizeMediaText(value, maximumLength = 160) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumLength);
}

function isOpaqueMediaSourceKey(value) {
  const key = String(value || "");
  if (!key || key.length > 180 || /https?:\/\/|[?&=]/i.test(key)) return false;
  return /^(?:url|dynamic|stream|empty):[a-z0-9_-]+(?::[a-z0-9_-]+)?(?:\|(?:page|youtube):[a-z0-9_-]+)?$/i.test(key);
}

function normalizeMediaActiveState(value) {
  const source = value && typeof value === "object" ? value : null;
  if (!source) return null;

  const frameId = Number(source.frameId);
  const mediaId = normalizeMediaText(source.mediaId, 96);
  const sourceKey = normalizeMediaText(source.sourceKey, 180);
  if (!Number.isInteger(frameId) || frameId < 0 || !mediaId || !isOpaqueMediaSourceKey(sourceKey)) return null;

  return {
    frameId,
    mediaId,
    sourceKey,
    rate: normalizeMediaTabRate(source.rate),
    kind: source.kind === "audio" ? "audio" : "video",
    label: normalizeMediaText(source.label || (source.kind === "audio" ? "오디오" : "동영상"), 140),
    updatedAt: Math.max(0, Number(source.updatedAt) || Date.now())
  };
}

function normalizeMediaTabState(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    templateRate: normalizeMediaTabRate(source.templateRate ?? source.rate ?? 1),
    active: normalizeMediaActiveState(source.active)
  };
}

async function getMediaTabStatesStore() {
  if (mediaTabStatesCache) return mediaTabStatesCache;

  const stored = await getSessionStoredValues([
    MEDIA_TAB_STATES_SESSION_KEY,
    LEGACY_MEDIA_TAB_STATES_SESSION_KEY,
    LEGACY_MEDIA_TAB_RATES_SESSION_KEY
  ]);
  const source = stored?.[MEDIA_TAB_STATES_SESSION_KEY];
  const legacyStateSource = stored?.[LEGACY_MEDIA_TAB_STATES_SESSION_KEY];
  const legacySource = stored?.[LEGACY_MEDIA_TAB_RATES_SESSION_KEY];
  const nextStore = {};

  if (source && typeof source === "object" && !Array.isArray(source)) {
    for (const [tabId, value] of Object.entries(source)) {
      nextStore[String(tabId)] = normalizeMediaTabState(value);
    }
  } else if (legacyStateSource && typeof legacyStateSource === "object" && !Array.isArray(legacyStateSource)) {
    // Preserve only the harmless per-tab template rate. Version 2 stored the
    // complete signed media URL in active.sourceKey, so that field is deliberately discarded.
    for (const [tabId, value] of Object.entries(legacyStateSource)) {
      nextStore[String(tabId)] = normalizeMediaTabState({ templateRate: value?.templateRate ?? value?.rate ?? 1 });
    }
  } else if (legacySource && typeof legacySource === "object" && !Array.isArray(legacySource)) {
    for (const [tabId, rate] of Object.entries(legacySource)) {
      nextStore[String(tabId)] = normalizeMediaTabState({ templateRate: rate });
    }
  }

  mediaTabStatesCache = nextStore;
  // Persist only the sanitized opaque-key format and remove older session data
  // that could contain complete signed media URLs.
  await setSessionStoredValues({ [MEDIA_TAB_STATES_SESSION_KEY]: { ...nextStore } });
  await removeSessionStoredValues([
    LEGACY_MEDIA_TAB_STATES_SESSION_KEY,
    LEGACY_MEDIA_TAB_RATES_SESSION_KEY
  ]);
  return mediaTabStatesCache;
}

function queueMediaTabStatesWrite(task) {
  const run = mediaTabStatesWriteQueue.then(task, task);
  mediaTabStatesWriteQueue = run.catch(() => {});
  return run;
}

async function getMediaTabState(tabId) {
  const store = await getMediaTabStatesStore();
  return normalizeMediaTabState(store[String(tabId)]);
}

function setMediaTabState(tabId, updater) {
  return queueMediaTabStatesWrite(async () => {
    const store = await getMediaTabStatesStore();
    const current = normalizeMediaTabState(store[String(tabId)]);
    const next = normalizeMediaTabState(
      typeof updater === "function" ? updater(current) : updater
    );
    store[String(tabId)] = next;
    await setSessionStoredValues({ [MEDIA_TAB_STATES_SESSION_KEY]: { ...store } });
    return next;
  });
}

function removeMediaTabState(tabId) {
  return queueMediaTabStatesWrite(async () => {
    const store = await getMediaTabStatesStore();
    delete store[String(tabId)];
    await setSessionStoredValues({ [MEDIA_TAB_STATES_SESSION_KEY]: { ...store } });
  });
}

function makeMediaPopupState(tabId, state) {
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

function notifyMediaTabStateUpdated(tabId, state) {
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

async function refreshMediaActiveState(tabId, state) {
  const normalized = normalizeMediaTabState(state);
  const active = normalized.active;
  if (!active) return normalized;

  try {
    const response = await sendTabMessage(tabId, {
      type: MESSAGE_TYPES.GET_MEDIA_TAB_STATE,
      mediaId: active.mediaId,
      sourceKey: active.sourceKey,
      queryFrame: true
    }, { frameId: active.frameId });

    if (!response?.ok || !response.hasMedia) {
      return setMediaTabState(tabId, (current) => ({ ...current, active: null }));
    }

    return setMediaTabState(tabId, (current) => ({
      ...current,
      templateRate: response.templateRate ?? response.rate ?? current.templateRate,
      active: {
        frameId: active.frameId,
        mediaId: response.mediaId || active.mediaId,
        sourceKey: response.sourceKey || active.sourceKey,
        rate: response.rate,
        kind: response.kind || active.kind,
        label: response.label || active.label,
        updatedAt: Date.now()
      }
    }));
  } catch {
    return normalized;
  }
}

async function reportMediaTabState(tabId, frameId, message) {
  const rate = normalizeMediaTabRate(message.rate);
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

async function applyMediaRateToActiveSource(tabId, rawRate) {
  const rate = normalizeMediaTabRate(rawRate);
  let state = await getMediaTabState(tabId);
  state = await refreshMediaActiveState(tabId, state);
  const active = state.active;

  if (!active) {
    throw new Error("현재 탭에서 조절할 동영상이나 오디오를 찾지 못했습니다. 재생하거나 마우스를 올린 뒤 다시 시도하세요.");
  }

  const response = await sendTabMessage(tabId, {
    type: MESSAGE_TYPES.APPLY_MEDIA_TAB_RATE,
    mediaId: active.mediaId,
    sourceKey: active.sourceKey,
    rate
  }, { frameId: active.frameId });

  if (!response?.ok || !response.hasMedia) {
    throw new Error(response?.error || "선택한 미디어가 바뀌었습니다. 미디어에 마우스를 올린 뒤 다시 시도하세요.");
  }

  state = await setMediaTabState(tabId, (current) => ({
    templateRate: response.templateRate ?? response.rate ?? rate,
    active: {
      frameId: active.frameId,
      mediaId: response.mediaId || active.mediaId,
      sourceKey: response.sourceKey || active.sourceKey,
      rate: response.rate ?? rate,
      kind: response.kind || active.kind,
      label: response.label || active.label,
      updatedAt: Date.now()
    }
  }));
  notifyMediaTabStateUpdated(tabId, state);
  return state;
}


function getElementEraserSiteKey(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ""));
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.origin;
  } catch {
    return "";
  }
}

const SAFE_ELEMENT_ERASER_ANCHOR_ATTRIBUTES = Object.freeze([
  "data-testid",
  "data-test-id",
  "data-test",
  "data-qa",
  "data-cy",
  "data-component",
  "aria-label",
  "name",
  "role"
]);

function splitSafePersistentSelector(rawSelector) {
  const selector = String(rawSelector || "").trim();
  if (!selector || selector.length > MAX_ELEMENT_ERASER_SELECTOR_LENGTH) return null;

  const segments = [];
  let current = "";
  let quote = "";
  let bracketDepth = 0;
  let escaped = false;

  for (const character of selector) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      current += character;
      escaped = true;
      continue;
    }
    if (quote) {
      current += character;
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if (character === "[") {
      bracketDepth += 1;
      current += character;
      continue;
    }
    if (character === "]") {
      bracketDepth -= 1;
      if (bracketDepth < 0) return null;
      current += character;
      continue;
    }
    if (bracketDepth === 0 && character === ">") {
      const segment = current.trim();
      if (!segment) return null;
      segments.push(segment);
      current = "";
      continue;
    }
    if (
      bracketDepth === 0 &&
      (character === "," || character === "+" || character === "~" ||
        character === "*" || character === ":" || character === "{" ||
        character === "}" || character === "\n" || character === "\r")
    ) {
      return null;
    }
    current += character;
  }

  if (escaped || quote || bracketDepth !== 0) return null;
  const finalSegment = current.trim();
  if (!finalSegment) return null;
  segments.push(finalSegment);
  return segments.length <= 7 ? segments : null;
}

function isSafePersistentElementSelector(rawSelector) {
  const segments = splitSafePersistentSelector(rawSelector);
  if (!segments?.length) return false;

  const anchorAttributes = SAFE_ELEMENT_ERASER_ANCHOR_ATTRIBUTES
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const attributeAnchorPattern = new RegExp(
    `^[a-z][a-z0-9-]*\\[(?:${anchorAttributes})\\s*=`,
    "i"
  );
  const root = segments[0];
  if (!/^#[a-zA-Z_][a-zA-Z0-9_-]{0,79}$/.test(root) && !attributeAnchorPattern.test(root)) {
    return false;
  }

  for (const segment of segments) {
    if (!segment || segment.length > 360) return false;
    if (/^(?:html|body|head)(?:$|[.#\[])/i.test(segment)) return false;

    let quote = "";
    let bracketDepth = 0;
    let escaped = false;
    for (const character of segment) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (quote) {
        if (character === quote) quote = "";
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        continue;
      }
      if (character === "[") bracketDepth += 1;
      else if (character === "]") bracketDepth -= 1;
      else if (bracketDepth === 0 && /\s/.test(character)) return false;
    }
    if (escaped || quote || bracketDepth !== 0) return false;
  }

  return true;
}

function normalizeElementEraserRule(rule) {
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

function normalizeElementEraserStore(rawStore) {
  const source = rawStore && typeof rawStore === "object" ? rawStore : {};
  const store = {};

  for (const [siteKey, rawRules] of Object.entries(source)) {
    if (!getElementEraserSiteKey(siteKey) || !Array.isArray(rawRules)) continue;

    const rules = [];
    const seen = new Set();
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

async function migrateElementEraserRules() {
  const stored = await getStoredValues([ELEMENT_ERASER_RULES_STORAGE_KEY]);
  const current = stored[ELEMENT_ERASER_RULES_STORAGE_KEY];
  const normalized = normalizeElementEraserStore(current);
  if (JSON.stringify(current || {}) !== JSON.stringify(normalized)) {
    await setStoredValues({ [ELEMENT_ERASER_RULES_STORAGE_KEY]: normalized });
  }
  return normalized;
}

function queueElementEraserWrite(operation) {
  const result = elementEraserWriteQueue
    .catch(() => {})
    .then(operation);
  elementEraserWriteQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function getElementEraserStatus(rawUrl) {
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

async function addElementEraserRule(rawUrl, rawRule) {
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

async function clearElementEraserRules(rawUrl) {
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

function createTab(properties) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create(properties, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(tab);
    });
  });
}

function sendTabMessage(tabId, message, options = {}) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, options, (response) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response);
    });
  });
}

function removeContextMenu(menuItemId) {
  return new Promise((resolve) => {
    chrome.contextMenus.remove(menuItemId, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function createContextMenu(properties) {
  return new Promise((resolve, reject) => {
    chrome.contextMenus.create(properties, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function executeScript(options) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(options, (results) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(results || []);
    });
  });
}

async function applyNavigationGuardSettingsToFrame(tabId, frameId, guardToken) {
  if (!Number.isInteger(tabId) || tabId < 0 || !Number.isInteger(frameId) || frameId < 0) {
    throw new Error("페이지 프레임 정보를 확인하지 못했습니다.");
  }
  if (!/^__cbt_guard_[a-f0-9]{32,96}$/i.test(String(guardToken || ""))) {
    throw new Error("페이지 탐색 보호 연결값이 올바르지 않습니다.");
  }

  // Use the extension's stored settings as the authority. The page and the
  // content script message cannot choose a different MAIN-world state.
  const stored = await getStoredValues({
    backNavigationProtectionEnabled: false,
    siteWarningBypassEnabled: false
  });
  const settings = {
    backNavigationProtectionEnabled: stored.backNavigationProtectionEnabled === true,
    siteWarningBypassEnabled: stored.siteWarningBypassEnabled === true
  };

  await executeScript({
    target: { tabId, frameIds: [frameId] },
    world: "MAIN",
    injectImmediately: true,
    func: applyNavigationGuardMain,
    args: [String(guardToken), settings]
  });

  return settings;
}

function attachDebugger(target) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach(target, DEBUGGER_PROTOCOL_VERSION, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function detachDebugger(target) {
  return new Promise((resolve) => {
    chrome.debugger.detach(target, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function sendCommand(target, command, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target, command, params, (result) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result || {});
    });
  });
}

function downloadFile(options) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(options, (downloadId) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(downloadId);
    });
  });
}

function setBadgeText(options) {
  return new Promise((resolve) => {
    chrome.action.setBadgeText(options, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function setBadgeBackgroundColor(options) {
  return new Promise((resolve) => {
    chrome.action.setBadgeBackgroundColor(options, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

async function setBadge(tabId, text, color = "#2563eb", clearAfter = 0) {
  await setBadgeBackgroundColor({ tabId, color });
  await setBadgeText({ tabId, text });

  if (text && clearAfter > 0) {
    setTimeout(() => {
      setBadgeText({ tabId, text: "" }).catch(() => {});
    }, clearAfter);
  }
}

function isCapturableUrl(url) {
  const value = String(url || "");
  return Boolean(value)
    && !/^(?:chrome|chrome-search|chrome-untrusted|edge|about|devtools|chrome-extension):/i.test(value)
    && !/^https:\/\/chromewebstore\.google\.com\//i.test(value);
}

function validateTab(tab) {
  if (!Number.isInteger(tab?.id) || !isCapturableUrl(tab.url)) {
    throw new Error("이 페이지에서는 화면을 캡처할 수 없습니다.");
  }
}

function stripWrappingQuotes(value) {
  let text = String(value || "").trim();
  if (
    text.length >= 2 &&
    ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'")) ||
      (text.startsWith("`") && text.endsWith("`")))
  ) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

function urlTextCandidates(value) {
  const candidates = [];
  let current = stripWrappingQuotes(
    String(value || "")
      .replace(/&amp;/gi, "&")
      .replace(/\\u002f/gi, "/")
      .replace(/\\x2f/gi, "/")
      .replace(/\\\//g, "/")
      .trim()
  );

  for (let index = 0; index < 4 && current; index += 1) {
    if (!candidates.includes(current)) candidates.push(current);
    try {
      const decoded = stripWrappingQuotes(decodeURIComponent(current));
      if (!decoded || decoded === current) break;
      current = decoded;
    } catch {
      break;
    }
  }

  return candidates;
}

function normalizeWebUrl(value, baseUrl = "") {
  for (const candidate of urlTextCandidates(value)) {
    if (/^(?:javascript|data|blob):/i.test(candidate)) continue;
    const prepared = /^www\./i.test(candidate) ? `https://${candidate}` : candidate;

    try {
      const url = new URL(prepared, baseUrl || undefined);
      if (url.protocol === "http:" || url.protocol === "https:") return url.href;
    } catch {
      // Try the next decoding level when an encoded URL was supplied.
    }
  }

  return null;
}

async function openLinkInNewTab(rawUrl, sourceTab) {
  // Page code must send an already resolved HTTP(S) URL. Relative strings are
  // rejected here so the service worker never guesses a destination.
  const url = normalizeWebUrl(rawUrl);
  if (!url) throw new Error("새 탭에서 열 링크 주소를 확인하지 못했습니다.");
  if (!Number.isInteger(sourceTab?.id) || !Number.isInteger(sourceTab?.windowId)) {
    throw new Error("현재 탭 정보를 확인하지 못했습니다.");
  }

  const createdTab = await createTab({
    url,
    active: false,
    windowId: sourceTab.windowId,
    index: Number.isInteger(sourceTab.index) ? sourceTab.index + 1 : undefined,
    openerTabId: sourceTab.id
  });

  return { url, tabId: createdTab?.id };
}

async function syncLinkContextMenus(values = {}) {
  const sequence = ++contextMenuSyncSequence;
  await Promise.all([
    removeContextMenu(LINK_OPEN_MENU_ID),
    removeContextMenu(LINK_COPY_MENU_ID)
  ]);
  if (sequence !== contextMenuSyncSequence) return;

  const menuItems = [];
  if (values[LINK_OPEN_SETTING_KEY] === true) {
    menuItems.push({
      id: LINK_OPEN_MENU_ID,
      title: LINK_OPEN_MENU_TITLE,
      contexts: ["all"],
      documentUrlPatterns: LINK_MENU_DOCUMENT_PATTERNS
    });
  }
  if (values[LINK_COPY_SETTING_KEY] === true) {
    menuItems.push({
      id: LINK_COPY_MENU_ID,
      title: LINK_COPY_MENU_TITLE,
      contexts: ["all"],
      documentUrlPatterns: LINK_MENU_DOCUMENT_PATTERNS
    });
  }

  for (const item of menuItems) {
    if (sequence !== contextMenuSyncSequence) return;
    await createContextMenu(item);
  }
}

async function syncLinkContextMenusFromStorage() {
  try {
    const stored = await getStoredValues({
      [LINK_OPEN_SETTING_KEY]: false,
      [LINK_COPY_SETTING_KEY]: false
    });
    await syncLinkContextMenus(stored);
  } catch (error) {
    console.error("Could not update the link context menus:", error);
  }
}

async function resolveContextLink(info, tab) {
  const frameId = Number.isInteger(info?.frameId) ? info.frameId : 0;
  let response = null;

  try {
    response = await sendTabMessage(
      tab.id,
      { type: MESSAGE_TYPES.GET_CONTEXT_LINK },
      { frameId }
    );
  } catch {
    // A normal anchor still supplies linkUrl through the context menu API.
  }

  // Chrome already knows the exact URL for a real <a>/<area> link. Prefer it
  // over heuristic extraction from page scripts or data attributes.
  const candidates = [info?.linkUrl, response?.url];
  for (const candidate of candidates) {
    const url = normalizeWebUrl(candidate, info?.pageUrl || tab.url);
    if (url) return { url, frameId };
  }

  throw new Error("이 위치에서 사용할 링크 주소를 찾지 못했습니다.");
}

async function openContextLinkInNewTab(info, tab) {
  if (!Number.isInteger(tab?.id)) {
    throw new Error("현재 탭을 확인하지 못했습니다.");
  }

  const { url } = await resolveContextLink(info, tab);
  const result = await openLinkInNewTab(url, tab);
  await setBadge(tab.id, "OPEN", "#2563eb", BADGE_CLEAR_DELAY_MS);
  return result;
}

async function copyContextLinkAddress(info, tab) {
  if (!Number.isInteger(tab?.id)) {
    throw new Error("현재 탭을 확인하지 못했습니다.");
  }

  const { url, frameId } = await resolveContextLink(info, tab);
  let response;

  try {
    response = await sendTabMessage(
      tab.id,
      { type: MESSAGE_TYPES.COPY_LINK_ADDRESS, url },
      { frameId }
    );
  } catch (error) {
    if (frameId === 0) throw error;
    response = await sendTabMessage(
      tab.id,
      { type: MESSAGE_TYPES.COPY_LINK_ADDRESS, url },
      { frameId: 0 }
    );
  }

  if (!response || response.ok !== true) {
    throw new Error(response?.error || "링크 주소를 클립보드에 복사하지 못했습니다.");
  }

  await setBadge(tab.id, "COPY", "#15803d", BADGE_CLEAR_DELAY_MS);
  return url;
}

function makeTimestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");

  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "_",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join("");
}

function makeEnglishPageName(url) {
  try {
    return new URL(url).hostname
      .replace(/^www\./i, "")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "page";
  } catch {
    return "page";
  }
}

function normalizeRectangle(rectangle, contentSize) {
  const rawX = Number(rectangle?.x);
  const rawY = Number(rectangle?.y);
  const rawWidth = Number(rectangle?.width);
  const rawHeight = Number(rectangle?.height);

  if (![rawX, rawY, rawWidth, rawHeight].every(Number.isFinite)) {
    throw new Error("선택 영역 좌표가 올바르지 않습니다.");
  }

  const contentWidth = Math.max(1, Math.ceil(Number(contentSize?.width) || 0));
  const contentHeight = Math.max(1, Math.ceil(Number(contentSize?.height) || 0));
  const left = Math.max(0, Math.min(rawX, contentWidth));
  const top = Math.max(0, Math.min(rawY, contentHeight));
  const right = Math.max(left, Math.min(rawX + rawWidth, contentWidth));
  const bottom = Math.max(top, Math.min(rawY + rawHeight, contentHeight));
  const width = right - left;
  const height = bottom - top;

  if (width < 2 || height < 2) {
    throw new Error("선택 영역이 너무 작습니다.");
  }

  return { x: left, y: top, width, height };
}

async function saveScreenshot(data, folder, tabUrl) {
  if (!data) {
    throw new Error("Chrome에서 이미지 데이터를 받지 못했습니다.");
  }

  const pageName = makeEnglishPageName(tabUrl);
  const filename = `${folder}/${makeTimestamp()}_${pageName}.png`;
  const downloadId = await downloadFile({
    url: `data:image/png;base64,${data}`,
    filename,
    conflictAction: "uniquify",
    saveAs: false
  });

  return { filename, downloadId };
}

async function captureFullPage(tabId) {
  const tab = await getTab(tabId);
  validateTab(tab);

  if (capturingTabs.has(tab.id)) {
    throw new Error("이 탭에서 이미 화면을 캡처하고 있습니다.");
  }

  const target = { tabId: tab.id };
  let attached = false;
  capturingTabs.add(tab.id);

  try {
    await setBadge(tab.id, "...", "#2563eb");
    await attachDebugger(target);
    attached = true;

    await sendCommand(target, "Page.enable");
    const metrics = await sendCommand(target, "Page.getLayoutMetrics");
    const contentSize = metrics.cssContentSize || metrics.contentSize;
    const width = Math.ceil(Number(contentSize?.width));
    const height = Math.ceil(Number(contentSize?.height));

    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new Error("페이지 전체 크기를 확인할 수 없습니다.");
    }

    const screenshot = await sendCommand(target, "Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      clip: {
        x: 0,
        y: 0,
        width,
        height,
        scale: 1
      }
    });

    const saved = await saveScreenshot(
      screenshot.data,
      "full_page_screenshots",
      tab.url
    );

    await setBadge(tab.id, "OK", "#15803d", BADGE_CLEAR_DELAY_MS);
    return { ...saved, width, height };
  } finally {
    capturingTabs.delete(tab.id);
    if (attached) {
      await detachDebugger(target);
    }
  }
}

async function captureSelection(tab, rectangle) {
  validateTab(tab);

  if (capturingTabs.has(tab.id)) {
    throw new Error("이 탭에서 이미 화면을 캡처하고 있습니다.");
  }

  const target = { tabId: tab.id };
  let attached = false;
  capturingTabs.add(tab.id);

  try {
    await setBadge(tab.id, "...", "#2563eb");
    await attachDebugger(target);
    attached = true;

    await sendCommand(target, "Page.enable");
    const metrics = await sendCommand(target, "Page.getLayoutMetrics");
    const contentSize = metrics.cssContentSize || metrics.contentSize;
    const clip = normalizeRectangle(rectangle, contentSize);

    const screenshot = await sendCommand(target, "Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      clip: {
        x: clip.x,
        y: clip.y,
        width: clip.width,
        height: clip.height,
        scale: 1
      }
    });

    const saved = await saveScreenshot(
      screenshot.data,
      "selected_area_screenshots",
      tab.url
    );

    await setBadge(tab.id, "OK", "#15803d", BADGE_CLEAR_DELAY_MS);
    return { ok: true, ...saved, clip };
  } finally {
    capturingTabs.delete(tab.id);
    if (attached) {
      await detachDebugger(target);
    }
  }
}

async function startAreaSelection(tabId) {
  const tab = await getTab(tabId);
  validateTab(tab);

  await executeScript({
    target: { tabId: tab.id },
    files: ["selector.js"]
  });

  return { tabId: tab.id };
}


function validateElementEraserTab(tab) {
  if (!Number.isInteger(tab?.id) || !getElementEraserSiteKey(tab.url)) {
    throw new Error("이 페이지에서는 요소 숨기기 기능을 사용할 수 없습니다.");
  }
}

async function startElementEraser(tabId, requestedMode) {
  const mode = requestedMode === "persistent" ? "persistent" : "temporary";
  const tab = await getTab(tabId);
  validateElementEraserTab(tab);

  await executeScript({
    target: { tabId: tab.id },
    files: ["element_eraser.js"]
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


function isYouTubeVideoPageUrl(rawUrl) {
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

async function runYouTubeTranscriptPageTask(tabId, task) {
  const tab = await getTab(tabId);
  if (!Number.isInteger(tab?.id) || !isYouTubeVideoPageUrl(tab.url)) {
    throw new Error("유튜브 영상 또는 Shorts 페이지에서 사용하세요.");
  }

  const results = await executeScript({
    target: { tabId: tab.id, frameIds: [0] },
    world: "MAIN",
    func: youtubeTranscriptPageTask,
    args: [task && typeof task === "object" ? task : {}]
  });

  const result = results.find((entry) => entry?.frameId === 0)?.result ?? results[0]?.result;
  if (!result || result.ok !== true) {
    throw new Error(result?.error || "유튜브 자막 정보를 읽지 못했습니다.");
  }
  return result;
}

async function saveYouTubeTranscriptText(rawText, rawTitle, rawVideoId, options = {}) {
  const text = String(rawText || "");
  if (!text.trim()) throw new Error("저장할 자막 내용이 없습니다.");
  if (text.length > 8_000_000) throw new Error("자막 내용이 너무 커서 텍스트 파일로 저장할 수 없습니다.");

  void rawTitle;
  const videoId = String(rawVideoId || "video")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32) || "video";
  const timestamp = String(options.timestamp || makeTimestamp());
  const combinedCount = Math.max(0, Math.round(Number(options.combinedCount) || 0));
  const filename = options.filename || (combinedCount > 1
    ? `youtube_transcripts/${timestamp}_youtube_transcripts_${combinedCount}_videos.txt`
    : `youtube_transcripts/${timestamp}_youtube_transcript_${videoId}.txt`);
  const dataUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(`\uFEFF${text}`)}`;
  const downloadId = await downloadFile({
    url: dataUrl,
    filename,
    conflictAction: "uniquify",
    saveAs: false
  });

  return { filename, downloadId };
}

async function saveYouTubeTranscriptBatch(rawFiles) {
  const files = Array.isArray(rawFiles) ? rawFiles : [];
  if (files.length === 0) throw new Error("저장할 자막 파일이 없습니다.");
  if (files.length > MAX_YOUTUBE_TRANSCRIPT_BATCH_FILES) {
    throw new Error(`한 번에 최대 ${MAX_YOUTUBE_TRANSCRIPT_BATCH_FILES}개의 자막 파일을 저장할 수 있습니다.`);
  }

  const totalLength = files.reduce((sum, file) => sum + String(file?.text || "").length, 0);
  if (totalLength > MAX_YOUTUBE_TRANSCRIPT_BATCH_TOTAL_LENGTH) {
    throw new Error("선택한 자막 전체의 크기가 너무 커서 한 번에 저장할 수 없습니다.");
  }

  const timestamp = makeTimestamp();
  const folder = `youtube_transcripts/batch_${timestamp}`;
  const results = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index] || {};
    const videoId = String(file.videoId || "video")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 32) || "video";
    const sequence = String(index + 1).padStart(2, "0");
    const filename = `${folder}/${sequence}_youtube_transcript_${videoId}.txt`;
    results.push(await saveYouTubeTranscriptText(file.text, file.title, videoId, { timestamp, filename }));
  }

  return { folder, results };
}

function makeUserMessage(error, fallback) {
  const message = String(error?.message || error || "").trim();

  if (/another debugger|already attached|being debugged/i.test(message)) {
    return "개발자 도구 또는 다른 확장 프로그램이 현재 탭의 디버거를 사용하고 있습니다.";
  }

  if (/cannot access|cannot be scripted|missing host permission/i.test(message)) {
    return "이 페이지에는 확장 프로그램 도구를 삽입할 수 없습니다.";
  }

  return message || fallback;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === MESSAGE_TYPES.GET_MEDIA_TAB_STATE) {
    const requestedTabId = Number(message.tabId);
    const tabId = Number.isInteger(requestedTabId) && requestedTabId >= 0
      ? requestedTabId
      : sender.tab?.id;
    if (!Number.isInteger(tabId) || tabId < 0) {
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
    const tabId = Number(message.tabId);
    if (!Number.isInteger(tabId) || tabId < 0) {
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
    if (!Number.isInteger(tabId) || tabId < 0 || !Number.isInteger(frameId) || frameId < 0) {
      sendResponse({ ok: false, error: "현재 미디어가 있는 탭과 프레임을 확인할 수 없습니다." });
      return false;
    }

    reportMediaTabState(tabId, frameId, message)
      .then((state) => sendResponse(makeMediaPopupState(tabId, state)))
      .catch((error) => sendResponse({ ok: false, error: makeUserMessage(error, "현재 미디어 상태를 저장하지 못했습니다.") }));
    return true;
  }

  if (message?.type === MESSAGE_TYPES.GET_YOUTUBE_TRANSCRIPT_INFO) {
    const tabId = Number(message.tabId);
    if (!Number.isInteger(tabId) || tabId < 0) {
      sendResponse({ ok: false, error: "현재 탭을 확인할 수 없습니다." });
      return false;
    }

    runYouTubeTranscriptPageTask(tabId, { operation: "info" })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        console.error("Could not read YouTube caption tracks:", error);
        sendResponse({
          ok: false,
          error: makeUserMessage(error, "유튜브 자막 목록을 불러오지 못했습니다.")
        });
      });
    return true;
  }

  if (message?.type === MESSAGE_TYPES.GET_YOUTUBE_TRANSCRIPT) {
    const tabId = Number(message.tabId);
    if (!Number.isInteger(tabId) || tabId < 0) {
      sendResponse({ ok: false, error: "현재 탭을 확인할 수 없습니다." });
      return false;
    }

    runYouTubeTranscriptPageTask(tabId, {
      operation: "transcript",
      trackIndex: message.trackIndex,
      trackId: message.trackId,
      translationLanguageCode: message.translationLanguageCode,
      expectedVideoId: message.expectedVideoId
    })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        console.error("Could not extract the YouTube transcript:", error);
        sendResponse({
          ok: false,
          error: makeUserMessage(error, "유튜브 자막 전체를 읽지 못했습니다.")
        });
      });
    return true;
  }

  if (message?.type === MESSAGE_TYPES.SAVE_YOUTUBE_TRANSCRIPT) {
    saveYouTubeTranscriptText(message.text, message.title, message.videoId, {
      combinedCount: message.combinedCount
    })
      .then((result) => sendResponse({
        ok: true,
        ...result,
        message: "정리한 유튜브 자막을 텍스트 파일로 저장했습니다."
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
        message: `${result.results.length}개의 유튜브 자막을 개별 텍스트 파일로 저장했습니다.`
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

    queueElementEraserWrite(() => addElementEraserRule(sender.url || sender.tab.url, {
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
    const tabId = Number(message.tabId);
    if (!Number.isInteger(tabId) || tabId < 0) {
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
    const tabId = Number(message.tabId);
    if (!Number.isInteger(tabId) || tabId < 0) {
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

  if (message?.type === MESSAGE_TYPES.APPLY_NAVIGATION_GUARD) {
    const senderUrl = String(sender.url || sender.tab?.url || "");
    if (!Number.isInteger(sender.tab?.id) || !/^https?:\/\//i.test(senderUrl)) {
      sendResponse({ ok: false, error: "현재 웹페이지 프레임을 확인하지 못했습니다." });
      return false;
    }

    const frameId = Number.isInteger(sender.frameId) ? sender.frameId : 0;
    applyNavigationGuardSettingsToFrame(sender.tab.id, frameId, message.guardToken)
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((error) => {
        const messageText = makeUserMessage(error, "페이지 탐색 보호 설정을 적용하지 못했습니다.");
        console.error("Could not apply navigation guard settings:", error);
        sendResponse({ ok: false, error: messageText });
      });
    return true;
  }

  if (message?.type === MESSAGE_TYPES.START_ELEMENT_ERASER) {
    const tabId = Number(message.tabId);
    if (!Number.isInteger(tabId) || tabId < 0) {
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
  if (message?.type === MESSAGE_TYPES.OPEN_LINK_IN_NEW_TAB) {
    if (!sender.tab) {
      sendResponse({ ok: false, error: "현재 탭 정보를 확인하지 못했습니다." });
      return false;
    }

    openLinkInNewTab(message.url, sender.tab)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        console.error("Could not open the link in a new tab:", error);
        sendResponse({
          ok: false,
          error: makeUserMessage(error, "새 탭에서 링크를 열지 못했습니다.")
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
    const tabId = Number(message.tabId);
    if (!Number.isInteger(tabId) || tabId < 0) {
      sendResponse({ ok: false, error: "현재 탭을 확인할 수 없습니다." });
      return false;
    }

    captureFullPage(tabId)
      .then((result) => {
        sendResponse({
          ok: true,
          ...result,
          message: "현재 페이지 전체를 PNG 파일로 저장했습니다."
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
    const tabId = Number(message.tabId);
    if (!Number.isInteger(tabId) || tabId < 0) {
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
    const sourceTab = {
      ...sender.tab,
      url: sender.tab.url || sender.url || ""
    };

    captureSelection(sourceTab, message.rectangle)
      .then((result) => sendResponse(result))
      .catch(async (error) => {
        console.error("Selected area screenshot failed:", error);
        if (sourceTab.id) {
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
  syncLinkContextMenusFromStorage();
  migrateElementEraserRules().catch((error) => {
    console.error("Could not migrate remembered element-hiding rules:", error);
  });
  removeStoredValues([LEGACY_VISITED_LINKS_STORAGE_KEY, "mediaPlaybackRate"]).catch((error) => {
    console.error("Could not remove legacy extension records:", error);
  });
  removeSessionStoredValues([
    LEGACY_MEDIA_TAB_STATES_SESSION_KEY,
    LEGACY_MEDIA_TAB_RATES_SESSION_KEY
  ]).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  syncLinkContextMenusFromStorage();
  migrateElementEraserRules().catch((error) => {
    console.error("Could not migrate remembered element-hiding rules:", error);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  removeMediaTabState(tabId).catch(() => {});
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes || typeof changes !== "object") return;

  const linkMenuSettingChanged =
    Object.prototype.hasOwnProperty.call(changes, LINK_OPEN_SETTING_KEY) ||
    Object.prototype.hasOwnProperty.call(changes, LINK_COPY_SETTING_KEY);
  if (!linkMenuSettingChanged) return;

  syncLinkContextMenusFromStorage().catch((error) => {
    console.error("Could not update the link context menus:", error);
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab) return;

  let action;
  if (info.menuItemId === LINK_OPEN_MENU_ID) {
    action = openContextLinkInNewTab(info, tab);
  } else if (info.menuItemId === LINK_COPY_MENU_ID) {
    action = copyContextLinkAddress(info, tab);
  } else {
    return;
  }

  action.catch(async (error) => {
    console.error("Could not use the link address:", error);
    if (Number.isInteger(tab.id)) {
      await setBadge(tab.id, "ERR", "#b91c1c", BADGE_CLEAR_DELAY_MS).catch(() => {});
    }
  });
});
