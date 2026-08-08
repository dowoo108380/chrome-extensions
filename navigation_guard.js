"use strict";

/**
 * Runs inside the page MAIN world through chrome.scripting.executeScript().
 * The extension passes settings directly as function arguments; no DOM
 * attributes, CustomEvents, or page-readable bridge messages are used.
 */
function applyNavigationGuardMain(installToken, nextSettings) {
  "use strict";

  const INSTALL_KEY = String(installToken || "");
  if (!/^__cbt_guard_[a-f0-9]{32,96}$/i.test(INSTALL_KEY)) {
    return false;
  }

  const existing = globalThis[INSTALL_KEY];
  if (existing && typeof existing.cleanup === "function") {
    try { existing.cleanup(); } catch { /* Best-effort cleanup. */ }
  }
  try { delete globalThis[INSTALL_KEY]; } catch { /* Ignore sealed globals. */ }

  const POPSTATE_GUARD_MS = 1400;
  const EXTERNAL_CLICK_MAX_AGE_MS = 1600;
  const DIALOG_CHECK_DELAYS_MS = Object.freeze([0, 80, 220, 520, 1050]);
  const INTERMEDIATE_CHECK_DELAYS_MS = Object.freeze([0, 120, 500, 1200]);
  const MAX_WARNING_TEXT_LENGTH = 5000;

  const WARNING_LINK_CONTEXT =
    /(?:링크|주소|사이트|웹\s*사이트|페이지|외부|다른\s*사이트|타\s*사이트|제3자\s*사이트|URL|link|address|site|website|page|external|outside|outbound|third[ -]?party)/i;
  const WARNING_SAFETY_CONTEXT =
    /(?:안전하지|위험|주의|경고|신뢰할\s*수\s*없|보안|피싱|유해|악성|의심|unsafe|danger|warning|caution|untrusted|security|phishing|malicious|harmful|suspicious|risk)/i;
  const WARNING_EXTERNAL_CONTEXT =
    /(?:외부|다른\s*사이트|타\s*사이트|제3자\s*사이트|external|outside|outbound|third[ -]?party|leave\s+(?:this\s+)?site)/i;
  const WARNING_NAVIGATION_CONTEXT =
    /(?:이동|접속|열기|계속|방문|진행|넘어가|떠나|가시겠|하시겠|go|open|visit|continue|proceed|leave|redirect|navigate|follow)/i;
  const WARNING_CONFIRMATION_CONTEXT =
    /(?:하시겠|가시겠|겠습니까|계속|그래도|확인|주의|경고|are\s+you\s+sure|do\s+you\s+want|you\s+are\s+leaving|continue|proceed)/i;
  const POSITIVE_ACTION_TEXT =
    /(?:계속(?:해서)?(?:\s*(?:이동|접속|방문|열기))?|이동(?:하기)?|접속(?:하기)?|방문(?:하기)?|열기|진행(?:하기)?|넘어가기|그래도\s*(?:이동|접속|방문|열기)|continue|proceed|visit|open|go|leave|accept\s+(?:the\s+)?risk|continue\s+anyway)/i;
  const NEGATIVE_ACTION_TEXT =
    /(?:취소|아니오|닫기|돌아가기|거부|머무르기|중단|cancel|\bno\b|close|back|stay|deny|stop)/i;

  const EXPLICIT_WARNING_ROUTE_PATTERN =
    /(?:^|[\/_\-.])(?:warning|warn|unsafe|external(?:-?link)?|outlink|outbound|away|redirect|redir|gateway|jump|leave|exit|continue|forward)(?:$|[\/_\-.])/i;
  const EXPLICIT_DESTINATION_PARAMETERS = Object.freeze([
    "redirect",
    "redirect_url",
    "redirect_uri",
    "redirecturl",
    "destination",
    "dest",
    "target_url",
    "targeturl",
    "external_url",
    "outlink",
    "url",
    "u",
    "link",
    "href",
    "to"
  ]);

  const state = {
    backNavigationProtectionEnabled: false,
    siteWarningBypassEnabled: false,
    popstateGuardUntil: 0,
    historyPatch: null,
    historyRestoreTimer: 0,
    confirmPatch: null,
    alertPatch: null,
    pendingExternalClick: null,
    dialogTimers: new Set(),
    intermediateTimers: new Set(),
    warningNavigationInProgress: false,
    backListenersAttached: false,
    warningListenersAttached: false,
    domReadyListener: null
  };

  function now() {
    return typeof performance?.now === "function" ? performance.now() : Date.now();
  }

  function compactText(value, limit = MAX_WARNING_TEXT_LENGTH) {
    return String(value || "")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, limit);
  }

  function isStrictExternalWarningText(text, confirmationRequired) {
    const value = compactText(text);
    if (!value) return false;
    const hasLinkContext = WARNING_LINK_CONTEXT.test(value);
    const hasNavigationContext = WARNING_NAVIGATION_CONTEXT.test(value);
    const hasRiskOrExternalContext =
      WARNING_SAFETY_CONTEXT.test(value) || WARNING_EXTERNAL_CONTEXT.test(value);
    const hasConfirmationContext = WARNING_CONFIRMATION_CONTEXT.test(value);
    return hasLinkContext &&
      hasNavigationContext &&
      hasRiskOrExternalContext &&
      (!confirmationRequired || hasConfirmationContext);
  }

  function replacePrototypeMethod(prototype, property, replacement) {
    try {
      Object.defineProperty(prototype, property, {
        value: replacement,
        configurable: true,
        enumerable: false,
        writable: true
      });
      return true;
    } catch {
      try {
        prototype[property] = replacement;
        return prototype[property] === replacement;
      } catch {
        return false;
      }
    }
  }

  function restorePrototypeMethod(prototype, property, replacement, original) {
    try {
      if (prototype[property] !== replacement) return;
    } catch {
      return;
    }
    replacePrototypeMethod(prototype, property, original);
  }

  function resolveHistoryUrl(url) {
    try {
      if (url === undefined || url === null || String(url) === "") return location.href;
      return new URL(String(url), location.href).href;
    } catch {
      return null;
    }
  }

  function shouldBlockPushState(url) {
    if (!state.backNavigationProtectionEnabled || now() >= state.popstateGuardUntil) {
      return false;
    }
    const resolved = resolveHistoryUrl(url);
    return !resolved || resolved === location.href;
  }

  function restoreHistoryGuards() {
    const patch = state.historyPatch;
    if (!patch) return;
    restorePrototypeMethod(patch.prototype, "pushState", patch.guardedPushState, patch.originalPushState);
    restorePrototypeMethod(patch.prototype, "forward", patch.guardedForward, patch.originalForward);
    restorePrototypeMethod(patch.prototype, "go", patch.guardedGo, patch.originalGo);
    state.historyPatch = null;
  }

  function installHistoryGuards() {
    if (
      !state.backNavigationProtectionEnabled ||
      now() >= state.popstateGuardUntil
    ) {
      restoreHistoryGuards();
      return;
    }

    const prototype = globalThis.History?.prototype;
    if (!prototype) return;
    const current = state.historyPatch;
    if (
      current &&
      current.prototype === prototype &&
      prototype.pushState === current.guardedPushState &&
      prototype.forward === current.guardedForward &&
      prototype.go === current.guardedGo
    ) {
      return;
    }

    restoreHistoryGuards();
    const originalPushState = prototype.pushState;
    const originalForward = prototype.forward;
    const originalGo = prototype.go;
    if (
      typeof originalPushState !== "function" ||
      typeof originalForward !== "function" ||
      typeof originalGo !== "function"
    ) {
      return;
    }

    const guardedPushState = function pushState(stateValue, title, url) {
      if (shouldBlockPushState(url)) return undefined;
      return Reflect.apply(originalPushState, this, arguments);
    };
    const guardedForward = function forward() {
      if (state.backNavigationProtectionEnabled && now() < state.popstateGuardUntil) {
        return undefined;
      }
      return Reflect.apply(originalForward, this, arguments);
    };
    const guardedGo = function go(delta) {
      const step = Number(delta);
      if (
        state.backNavigationProtectionEnabled &&
        now() < state.popstateGuardUntil &&
        Number.isFinite(step) &&
        step > 0
      ) {
        return undefined;
      }
      return Reflect.apply(originalGo, this, arguments);
    };

    if (!replacePrototypeMethod(prototype, "pushState", guardedPushState)) return;
    if (!replacePrototypeMethod(prototype, "forward", guardedForward)) {
      restorePrototypeMethod(prototype, "pushState", guardedPushState, originalPushState);
      return;
    }
    if (!replacePrototypeMethod(prototype, "go", guardedGo)) {
      restorePrototypeMethod(prototype, "pushState", guardedPushState, originalPushState);
      restorePrototypeMethod(prototype, "forward", guardedForward, originalForward);
      return;
    }

    state.historyPatch = {
      prototype,
      originalPushState,
      originalForward,
      originalGo,
      guardedPushState,
      guardedForward,
      guardedGo
    };
  }

  function onPopState(event) {
    if (!state.backNavigationProtectionEnabled || !event?.isTrusted) return;

    state.popstateGuardUntil = now() + POPSTATE_GUARD_MS;
    installHistoryGuards();

    if (state.historyRestoreTimer) {
      window.clearTimeout(state.historyRestoreTimer);
    }
    state.historyRestoreTimer = window.setTimeout(() => {
      state.historyRestoreTimer = 0;
      state.popstateGuardUntil = 0;
      restoreHistoryGuards();
    }, POPSTATE_GUARD_MS + 40);
  }

  function attachBackListeners() {
    if (state.backListenersAttached) return;
    window.addEventListener("popstate", onPopState, true);
    state.backListenersAttached = true;
  }

  function detachBackListeners() {
    if (state.backListenersAttached) {
      window.removeEventListener("popstate", onPopState, true);
      state.backListenersAttached = false;
    }
    if (state.historyRestoreTimer) {
      window.clearTimeout(state.historyRestoreTimer);
      state.historyRestoreTimer = 0;
    }
    state.popstateGuardUntil = 0;
  }

  function clearTimers(timerSet) {
    for (const timerId of timerSet) window.clearTimeout(timerId);
    timerSet.clear();
  }

  function clearDialogChecks() {
    clearTimers(state.dialogTimers);
    state.pendingExternalClick = null;
  }

  function clearIntermediateChecks() {
    clearTimers(state.intermediateTimers);
  }

  function pendingExternalClickIsFresh() {
    const pending = state.pendingExternalClick;
    return Boolean(pending && Date.now() - pending.createdAt <= EXTERNAL_CLICK_MAX_AGE_MS);
  }

  function consumePendingExternalClick() {
    const pending = pendingExternalClickIsFresh() ? state.pendingExternalClick : null;
    clearDialogChecks();
    restoreDialogGuards();
    return pending;
  }

  function restoreDialogGuard(name) {
    const patchKey = name === "confirm" ? "confirmPatch" : "alertPatch";
    const patch = state[patchKey];
    if (!patch) return;
    try {
      if (globalThis[name] === patch.wrapper) globalThis[name] = patch.original;
    } catch {
      // Some pages expose immutable properties.
    }
    state[patchKey] = null;
  }

  function installDialogGuard(name) {
    if (!state.siteWarningBypassEnabled) {
      restoreDialogGuard(name);
      return;
    }

    const patchKey = name === "confirm" ? "confirmPatch" : "alertPatch";
    const previousPatch = state[patchKey];
    let current;
    try {
      current = globalThis[name];
    } catch {
      return;
    }
    if (previousPatch && current === previousPatch.wrapper) return;
    if (previousPatch && current !== previousPatch.wrapper) state[patchKey] = null;
    if (typeof current !== "function") return;

    const original = current;
    const wrapper = name === "confirm"
      ? function confirm(message) {
        if (
          state.siteWarningBypassEnabled &&
          pendingExternalClickIsFresh() &&
          isStrictExternalWarningText(message, true)
        ) {
          consumePendingExternalClick();
          return true;
        }
        return Reflect.apply(original, this, arguments);
      }
      : function alert(message) {
        if (
          state.siteWarningBypassEnabled &&
          pendingExternalClickIsFresh() &&
          isStrictExternalWarningText(message, false)
        ) {
          consumePendingExternalClick();
          return undefined;
        }
        return Reflect.apply(original, this, arguments);
      };

    try {
      globalThis[name] = wrapper;
      if (globalThis[name] === wrapper) state[patchKey] = { original, wrapper };
    } catch {
      // Ignore immutable page properties.
    }
  }

  function ensureDialogGuards() {
    installDialogGuard("confirm");
    installDialogGuard("alert");
  }

  function restoreDialogGuards() {
    restoreDialogGuard("confirm");
    restoreDialogGuard("alert");
  }

  function eventPath(event) {
    if (typeof event?.composedPath === "function") {
      const path = event.composedPath();
      if (Array.isArray(path) && path.length > 0) return path;
    }
    return event?.target ? [event.target] : [];
  }

  function normalizeDirectWebUrl(value, baseUrl = document.baseURI, requireAbsolute = false) {
    let text = String(value || "").trim();
    if (!text || /^(?:javascript|data|blob|mailto|tel):/i.test(text)) return null;

    for (let pass = 0; pass < 3; pass += 1) {
      const prepared = /^www\./i.test(text) ? `https://${text}` : text;
      if (requireAbsolute && !/^(?:https?:)?\/\//i.test(prepared)) return null;
      try {
        const url = new URL(prepared, baseUrl || location.href);
        if (url.protocol === "http:" || url.protocol === "https:") return url.href;
      } catch {
        // Try one decoding level below.
      }
      try {
        const decoded = decodeURIComponent(text);
        if (!decoded || decoded === text) break;
        text = decoded.trim();
      } catch {
        break;
      }
    }
    return null;
  }

  function nativeHyperlinkFromEvent(event) {
    for (const node of eventPath(event)) {
      if (!(node instanceof Element)) continue;
      if (node.localName !== "a" && node.localName !== "area") continue;
      const rawHref = node.getAttribute("href") || "";
      if (!rawHref || /^\s*(?:javascript:|#)/i.test(rawHref)) return null;
      const directUrl = normalizeDirectWebUrl(rawHref, node.baseURI || document.baseURI, false);
      if (!directUrl) return null;
      return {
        element: node,
        directUrl,
        target: String(node.getAttribute("target") || "").trim()
      };
    }
    return null;
  }

  function externalDestinationForHyperlink(details) {
    if (!details?.directUrl) return null;
    try {
      const target = new URL(details.directUrl);
      if (target.origin === location.origin) return null;
      return target.href;
    } catch {
      return null;
    }
  }

  function isElementVisible(element) {
    if (!(element instanceof Element)) return false;
    try {
      const style = getComputedStyle(element);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        Number(style.opacity) === 0
      ) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch {
      return false;
    }
  }

  function elementText(element, limit = 1200) {
    if (!(element instanceof Element)) return "";
    const pieces = [];
    const add = (value) => {
      const text = compactText(value, limit);
      if (text && !pieces.includes(text)) pieces.push(text);
    };
    try { add(element.innerText); } catch { add(element.textContent); }
    add(element.getAttribute("aria-label"));
    add(element.getAttribute("title"));
    add(element.getAttribute("value"));
    return compactText(pieces.join(" "), limit);
  }

  function semanticDialogCandidates() {
    const selector = [
      "dialog[open]",
      "[role='alertdialog']",
      "[role='dialog'][aria-modal='true']",
      "[aria-modal='true'][aria-label]",
      "[aria-modal='true'][aria-labelledby]"
    ].join(",");
    try {
      return [...document.querySelectorAll(selector)].filter(isElementVisible).slice(0, 24);
    } catch {
      return [];
    }
  }

  function hasStrongContinueAction(container) {
    let candidates;
    try {
      candidates = [...container.querySelectorAll("button, a[href], input[type='button'], input[type='submit'], [role='button']")].slice(0, 60);
    } catch {
      return false;
    }
    return candidates.some((element) => {
      if (!isElementVisible(element)) return false;
      if (element.matches(":disabled, [disabled], [aria-disabled='true']")) return false;
      const text = elementText(element, 180);
      return Boolean(text && !NEGATIVE_ACTION_TEXT.test(text) && POSITIVE_ACTION_TEXT.test(text));
    });
  }

  function navigateToDestination(destination, target = "", replace = false) {
    if (state.warningNavigationInProgress) return false;
    let url;
    try {
      url = new URL(destination, document.baseURI);
      if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    } catch {
      return false;
    }

    state.warningNavigationInProgress = true;
    clearDialogChecks();
    restoreDialogGuards();
    clearIntermediateChecks();
    try {
      if (target && !["_self", "_top", "_parent"].includes(target.toLowerCase())) {
        window.open(url.href, target, "noopener");
      } else if (replace) {
        location.replace(url.href);
      } else {
        location.assign(url.href);
      }
      return true;
    } catch {
      state.warningNavigationInProgress = false;
      return false;
    }
  }

  function tryHandlePendingDialog() {
    if (
      !state.siteWarningBypassEnabled ||
      state.warningNavigationInProgress ||
      window.top !== window ||
      !pendingExternalClickIsFresh()
    ) {
      return false;
    }

    const pending = state.pendingExternalClick;
    for (const dialog of semanticDialogCandidates()) {
      if (pending.visibleDialogsAtClick?.has(dialog)) continue;
      const text = elementText(dialog, MAX_WARNING_TEXT_LENGTH);
      if (!isStrictExternalWarningText(text, true)) continue;
      if (!WARNING_SAFETY_CONTEXT.test(text) || !hasStrongContinueAction(dialog)) continue;
      return navigateToDestination(pending.destination, pending.target, false);
    }
    return false;
  }

  function scheduleDialogChecks() {
    clearTimers(state.dialogTimers);
    for (const delay of DIALOG_CHECK_DELAYS_MS) {
      const timerId = window.setTimeout(() => {
        state.dialogTimers.delete(timerId);
        tryHandlePendingDialog();
      }, delay);
      state.dialogTimers.add(timerId);
    }

    const cleanupTimer = window.setTimeout(() => {
      state.dialogTimers.delete(cleanupTimer);
      if (!pendingExternalClickIsFresh()) {
        state.pendingExternalClick = null;
        restoreDialogGuards();
      }
    }, EXTERNAL_CLICK_MAX_AGE_MS + 60);
    state.dialogTimers.add(cleanupTimer);
  }

  function rememberPotentialExternalWarningClick(event) {
    if (
      !state.siteWarningBypassEnabled ||
      state.warningNavigationInProgress ||
      window.top !== window ||
      !event?.isTrusted ||
      event.type !== "click" ||
      event.button !== 0 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }

    ensureDialogGuards();
    const details = nativeHyperlinkFromEvent(event);
    const destination = externalDestinationForHyperlink(details);
    if (!destination) {
      clearDialogChecks();
      restoreDialogGuards();
      return;
    }

    state.pendingExternalClick = {
      destination,
      target: details.target,
      createdAt: Date.now(),
      visibleDialogsAtClick: new Set(semanticDialogCandidates())
    };
    scheduleDialogChecks();
  }

  function currentPageUrlLooksExplicitWarning() {
    try {
      const url = new URL(location.href);
      const routeText = `${url.hostname}${url.pathname}`.toLowerCase();
      return EXPLICIT_WARNING_ROUTE_PATTERN.test(routeText) ||
        (/(?:^|\.)google\.[a-z.]+$/i.test(url.hostname) && url.pathname === "/url") ||
        (/(?:^|\.)facebook\.com$/i.test(url.hostname) && /\/l\.php$/i.test(url.pathname));
    } catch {
      return false;
    }
  }

  function warningPageText() {
    const pieces = [document.title];
    const selector = [
      "h1",
      "h2",
      "h3",
      "[role='alert']",
      "[role='alertdialog']",
      "[class*='warning' i]",
      "[class*='caution' i]",
      "[class*='unsafe' i]",
      "[id*='warning' i]",
      "[id*='caution' i]",
      "[id*='unsafe' i]"
    ].join(",");
    try {
      for (const element of [...document.querySelectorAll(selector)].slice(0, 40)) {
        if (isElementVisible(element)) pieces.push(elementText(element, 700));
      }
    } catch {
      // The document may still be under construction.
    }
    return compactText(pieces.join(" "), MAX_WARNING_TEXT_LENGTH);
  }

  function destinationFromCurrentWarningUrl() {
    let current;
    try {
      current = new URL(location.href);
    } catch {
      return null;
    }
    if (!currentPageUrlLooksExplicitWarning()) return null;

    const parameterSources = [current.searchParams];
    if (current.hash.length > 1) {
      try { parameterSources.push(new URLSearchParams(current.hash.slice(1))); } catch { /* plain hash */ }
    }

    for (const parameters of parameterSources) {
      for (const key of EXPLICIT_DESTINATION_PARAMETERS) {
        const raw = parameters.get(key);
        if (!raw) continue;
        const destination = normalizeDirectWebUrl(raw, current.href, true);
        if (!destination) continue;
        try {
          if (new URL(destination).origin !== current.origin) return destination;
        } catch {
          // Try another parameter.
        }
      }
    }
    return null;
  }

  function destinationFromMetaRefresh() {
    let metas;
    try { metas = [...document.querySelectorAll("meta[http-equiv]")]; } catch { return null; }
    for (const meta of metas) {
      if (String(meta.httpEquiv || "").toLowerCase() !== "refresh") continue;
      const match = String(meta.content || "").match(/(?:^|;)\s*url\s*=\s*(.+)$/i);
      if (!match?.[1]) continue;
      const destination = normalizeDirectWebUrl(match[1], location.href, true);
      if (!destination) continue;
      try {
        if (new URL(destination).origin !== location.origin) return destination;
      } catch {
        // Try another meta element.
      }
    }
    return null;
  }


  function tryBypassExplicitIntermediateWarningPage() {
    if (
      !state.siteWarningBypassEnabled ||
      state.warningNavigationInProgress ||
      window.top !== window ||
      !currentPageUrlLooksExplicitWarning()
    ) {
      return false;
    }

    const text = warningPageText();
    if (!isStrictExternalWarningText(text, false)) return false;
    const destination =
      destinationFromCurrentWarningUrl() ||
      destinationFromMetaRefresh();
    if (!destination) return false;
    return navigateToDestination(destination, "", true);
  }

  function scheduleIntermediateChecks() {
    if (!state.siteWarningBypassEnabled || window.top !== window) return;
    clearIntermediateChecks();
    for (const delay of INTERMEDIATE_CHECK_DELAYS_MS) {
      const timerId = window.setTimeout(() => {
        state.intermediateTimers.delete(timerId);
        tryBypassExplicitIntermediateWarningPage();
      }, delay);
      state.intermediateTimers.add(timerId);
    }
  }

  function onPageShow() {
    scheduleIntermediateChecks();
  }

  function attachWarningListeners() {
    if (state.warningListenersAttached) return;
    window.addEventListener("click", rememberPotentialExternalWarningClick, true);
    window.addEventListener("pageshow", onPageShow, true);
    state.warningListenersAttached = true;
  }

  function detachWarningListeners() {
    if (state.warningListenersAttached) {
      window.removeEventListener("click", rememberPotentialExternalWarningClick, true);
      window.removeEventListener("pageshow", onPageShow, true);
      state.warningListenersAttached = false;
    }
    if (state.domReadyListener) {
      document.removeEventListener("DOMContentLoaded", state.domReadyListener);
      state.domReadyListener = null;
    }
    clearDialogChecks();
    clearIntermediateChecks();
  }

  function update(values) {
    const source = values && typeof values === "object" ? values : {};
    state.backNavigationProtectionEnabled = source.backNavigationProtectionEnabled === true;
    state.siteWarningBypassEnabled = source.siteWarningBypassEnabled === true;

    if (state.backNavigationProtectionEnabled) {
      attachBackListeners();
      // Do not replace History methods during ordinary browsing. The wrappers
      // exist only for the short interval immediately after a real back/forward
      // traversal, when a page could otherwise push the user forward again.
      restoreHistoryGuards();
    } else {
      detachBackListeners();
      restoreHistoryGuards();
    }

    if (state.siteWarningBypassEnabled) {
      attachWarningListeners();
      // confirm()/alert() are wrapped only during the short interval after a
      // real external-link click. Ordinary page code sees the native functions.
      if (document.readyState === "loading") {
        if (!state.domReadyListener) {
          state.domReadyListener = () => {
            state.domReadyListener = null;
            scheduleIntermediateChecks();
          };
          document.addEventListener("DOMContentLoaded", state.domReadyListener, { once: true });
        }
      } else {
        scheduleIntermediateChecks();
      }
    } else {
      detachWarningListeners();
      restoreDialogGuards();
      state.warningNavigationInProgress = false;
    }
  }

  let exposedApi = null;
  function cleanup() {
    detachBackListeners();
    restoreHistoryGuards();
    detachWarningListeners();
    restoreDialogGuards();
    state.warningNavigationInProgress = false;

    try {
      if (globalThis[INSTALL_KEY] === exposedApi) {
        delete globalThis[INSTALL_KEY];
      }
    } catch {
      // The page global may be sealed. Restoring native behavior is sufficient.
    }
  }

  update(nextSettings);
  if (!state.backNavigationProtectionEnabled && !state.siteWarningBypassEnabled) {
    cleanup();
    return true;
  }

  // Only a cleanup handle is retained. The page cannot call an exposed update
  // method to forge extension settings. A later extension injection cleans up
  // this instance and installs a fresh one with settings passed as arguments.
  exposedApi = Object.freeze({ cleanup });
  try {
    Object.defineProperty(globalThis, INSTALL_KEY, {
      value: exposedApi,
      configurable: true,
      enumerable: false,
      writable: false
    });
  } catch {
    globalThis[INSTALL_KEY] = exposedApi;
  }

  return true;
}
