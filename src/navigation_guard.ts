"use strict";

/**
 * Runs inside the page MAIN world through chrome.scripting.executeScript().
 * The extension passes the stored setting directly as a function argument; no
 * DOM attributes, CustomEvents, or page-readable bridge messages are used.
 */
function applyNavigationGuardMain(installToken: string, nextSettings: unknown) {
  "use strict";

  const INSTALL_KEY = String(installToken || "");
  if (!/^__cbt_guard_[a-f0-9]{32,96}$/i.test(INSTALL_KEY)) {
    return false;
  }

  type GuardApi = Readonly<{ cleanup: () => void }>;
  type HistoryPatch = { prototype: History; originalPushState: History["pushState"]; originalForward: History["forward"]; originalGo: History["go"]; guardedPushState: History["pushState"]; guardedForward: History["forward"]; guardedGo: History["go"] };
  const scope = globalThis as typeof globalThis & { [key: string]: GuardApi | undefined };
  const existing = scope[INSTALL_KEY];
  if (existing && typeof existing.cleanup === "function") {
    try { existing.cleanup(); } catch { /* Best-effort cleanup. */ }
  }
  try { delete scope[INSTALL_KEY]; } catch { /* Ignore sealed globals. */ }

  const POPSTATE_GUARD_MS = 1400;
  const state = {
    backNavigationProtectionEnabled: false,
    popstateGuardUntil: 0,
    historyPatch: null as HistoryPatch | null,
    historyRestoreTimer: 0,
    backListenersAttached: false
  };

  function now() {
    return typeof performance?.now === "function" ? performance.now() : Date.now();
  }

  function replacePrototypeMethod<K extends "pushState" | "forward" | "go">(prototype: History, property: K, replacement: History[K]) {
    // Modify only the function value we own. Preserve the native descriptor;
    // redefining enumerable/configurable/writable is not needed for the guard.
    try {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
      if (!descriptor || !("value" in descriptor)) return false;
      Object.defineProperty(prototype, property, { ...descriptor, value: replacement });
      return prototype[property] === replacement;
    } catch {
      return false;
    }
  }

  function restorePrototypeMethod<K extends "pushState" | "forward" | "go">(prototype: History, property: K, replacement: History[K], original: History[K]) {
    try {
      if (prototype[property] !== replacement) return;
    } catch {
      return;
    }
    replacePrototypeMethod(prototype, property, original);
  }

  function resolveHistoryUrl(url: string | URL | null | undefined) {
    try {
      if (url === undefined || url === null || String(url) === "") return location.href;
      return new URL(String(url), location.href).href;
    } catch {
      return null;
    }
  }

  function shouldBlockPushState(url: string | URL | null | undefined) {
    if (!state.backNavigationProtectionEnabled || now() >= state.popstateGuardUntil) {
      return false;
    }
    const resolved = resolveHistoryUrl(url);
    // Invalid URLs must reach the native method and retain its validation error.
    return resolved === location.href;
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

    const guardedPushState = function pushState(this: History, _stateValue: unknown, _title: string, url?: string | URL | null) {
      if (shouldBlockPushState(url)) return undefined;
      return Reflect.apply(originalPushState, this, arguments);
    };
    const guardedForward = function forward(this: History) {
      if (state.backNavigationProtectionEnabled && now() < state.popstateGuardUntil) {
        return undefined;
      }
      return Reflect.apply(originalForward, this, arguments);
    };
    const guardedGo = function go(this: History, delta?: number) {
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

  function onPopState(event: PopStateEvent) {
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

  function update(values: unknown) {
    const source = values && typeof values === "object" ? values as Record<string, unknown> : {};
    state.backNavigationProtectionEnabled = source.backNavigationProtectionEnabled === true;

    if (state.backNavigationProtectionEnabled) {
      attachBackListeners();
      // Ordinary browsing retains native History methods. Wrappers exist only
      // during the short interval after a real back or forward traversal.
      restoreHistoryGuards();
    } else {
      detachBackListeners();
      restoreHistoryGuards();
    }
  }

  let exposedApi: Readonly<{ cleanup: () => void; }>|null = null;
  function cleanup() {
    detachBackListeners();
    restoreHistoryGuards();

    try {
      if (scope[INSTALL_KEY] === exposedApi) {
        delete scope[INSTALL_KEY];
      }
    } catch {
      // The page global may be sealed. Restoring native behavior is sufficient.
    }
  }

  update(nextSettings);
  if (!state.backNavigationProtectionEnabled) {
    cleanup();
    return true;
  }

  exposedApi = Object.freeze({ cleanup });
  try {
    Object.defineProperty(globalThis, INSTALL_KEY, {
      value: exposedApi,
      configurable: true,
      enumerable: false,
      writable: false
    });
  } catch {
    scope[INSTALL_KEY] = exposedApi;
  }

  return true;
}
