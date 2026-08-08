(() => {
  "use strict";

  const CONTROLLER_KEY = "__pageElementEraserControllerV1__";
  const HOST_ID = "__page_element_eraser_host__";
  const SESSION_STYLE_ID = "__page_element_eraser_session_style__";
  const AREA_SELECTOR_HOST_ID = "__drag_area_screenshot_host__";
  const AREA_SELECTOR_CANCEL_EVENT = "drag-area-screenshot:force-cancel";
  const FORCE_EXIT_EVENT = "page-element-eraser:force-exit";
  const MESSAGE_TYPES = Object.freeze({
    ACTIVATE: "page-element-eraser:activate",
    ADD_RULE: "page-element-eraser:add-rule"
  });
  const VALID_MODES = new Set(["temporary", "persistent"]);
  const BLOCKED_TAGS = new Set(["HTML", "BODY", "HEAD", "SCRIPT", "STYLE", "LINK", "META", "TITLE"]);
  const STABLE_ATTRIBUTES = Object.freeze([
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
  const UNSTABLE_CLASS_NAMES = new Set([
    "active",
    "selected",
    "current",
    "hover",
    "focus",
    "focused",
    "open",
    "opened",
    "closed",
    "hidden",
    "visible",
    "loading",
    "loaded",
    "disabled",
    "enabled"
  ]);

  if (globalThis[CONTROLLER_KEY]) return;

  let active = false;
  let mode = "temporary";
  let host = null;
  let shadow = null;
  let surface = null;
  let outline = null;
  let targetLabel = null;
  let modeBadge = null;
  let instruction = null;
  let exitButton = null;
  let currentTarget = null;
  let lastClientX = -1;
  let lastClientY = -1;
  let pendingFrame = 0;
  let statusResetTimer = 0;
  let saving = false;

  function cssEscape(value) {
    if (globalThis.CSS && typeof globalThis.CSS.escape === "function") {
      return globalThis.CSS.escape(String(value));
    }

    return String(value).replace(/(^-?\d)|[^a-zA-Z0-9_-]/g, (match, leadingDigit) => {
      if (leadingDigit) return `\\3${leadingDigit} `;
      return `\\${match}`;
    });
  }

  function escapeAttributeValue(value) {
    return String(value)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r/g, "\\d ")
      .replace(/\n/g, "\\a ")
      .replace(/\f/g, "\\c ");
  }

  function looksGenerated(value) {
    const text = String(value || "").trim();
    if (!text || text.length > 80) return true;
    if (/[a-f0-9]{12,}/i.test(text)) return true;
    if (/\d{7,}/.test(text)) return true;
    if (/^(?:css|sc|jsx|react|vue|svelte)[-_][a-z0-9_-]{6,}$/i.test(text)) return true;
    return false;
  }

  function isSafeIdentifier(value) {
    const text = String(value || "").trim();
    return /^-?[a-zA-Z_][a-zA-Z0-9_-]{0,79}$/.test(text);
  }

  function getStableClasses(element) {
    const classes = [];

    for (const className of element.classList || []) {
      const normalized = String(className || "").trim();
      if (!normalized || !isSafeIdentifier(normalized) || looksGenerated(normalized)) continue;
      if (UNSTABLE_CLASS_NAMES.has(normalized.toLowerCase())) continue;
      classes.push(normalized);
      if (classes.length >= 4) break;
    }

    return classes;
  }

  function queryMatches(selector) {
    try {
      return Array.from(document.querySelectorAll(selector));
    } catch {
      return [];
    }
  }

  function isUniqueSelectorFor(selector, element) {
    const matches = queryMatches(selector);
    return matches.length === 1 && matches[0] === element;
  }

  function getUniqueSimpleSelector(element) {
    const tag = element.localName;
    if (!tag) return "";

    const id = String(element.id || "").trim();
    if (id && isSafeIdentifier(id) && !looksGenerated(id)) {
      const selector = `#${cssEscape(id)}`;
      if (isUniqueSelectorFor(selector, element)) return selector;
    }

    for (const attribute of STABLE_ATTRIBUTES) {
      const value = String(element.getAttribute(attribute) || "").trim();
      if (!value || value.length > 120 || looksGenerated(value)) continue;

      const selector = `${tag}[${attribute}="${escapeAttributeValue(value)}"]`;
      if (isUniqueSelectorFor(selector, element)) return selector;
    }

    // A class-only selector can silently start matching a different element
    // after a site redesign. Persistent rules therefore require a unique ID
    // or an explicitly stable attribute as their root anchor. Classes may
    // still be used only for descendant path segments beneath that anchor.
    return "";
  }

  function countMatchingChildren(parent, selector) {
    let count = 0;
    for (const child of parent.children || []) {
      try {
        if (child.matches(selector)) count += 1;
      } catch {
        return 0;
      }
    }
    return count;
  }

  function makeStablePathSegment(element) {
    const tag = element.localName;
    if (!tag) return "";

    for (const attribute of STABLE_ATTRIBUTES) {
      const value = String(element.getAttribute(attribute) || "").trim();
      if (!value || value.length > 100 || looksGenerated(value)) continue;
      const segment = `${tag}[${attribute}="${escapeAttributeValue(value)}"]`;
      const parent = element.parentElement;
      if (!parent || countMatchingChildren(parent, segment) === 1) return segment;
    }

    const stableClasses = getStableClasses(element).slice(0, 3);
    for (let count = stableClasses.length; count >= 1; count -= 1) {
      const segment = `${tag}${stableClasses
        .slice(0, count)
        .map((className) => `.${cssEscape(className)}`)
        .join("")}`;
      const parent = element.parentElement;
      if (!parent || countMatchingChildren(parent, segment) === 1) return segment;
    }

    return "";
  }

  function buildPersistentSelector(element) {
    if (!(element instanceof Element) || element.getRootNode() !== document) return "";

    const simple = getUniqueSimpleSelector(element);
    if (simple) return simple;

    // Persistent rules deliberately refuse positional selectors such as
    // :nth-of-type(). Those selectors can silently point at a different element
    // after a site redesign. Only a path anchored to a unique, stable ancestor is saved.
    const descendantSegments = [];
    let current = element;

    for (let depth = 0; current && depth < 6; depth += 1) {
      const segment = makeStablePathSegment(current);
      if (!segment) return "";
      descendantSegments.unshift(segment);

      const currentId = String(current.id || "").trim();
      if (currentId && isSafeIdentifier(currentId) && !looksGenerated(currentId)) {
        const anchor = `#${cssEscape(currentId)}`;
        if (queryMatches(anchor).length === 1) {
          const remaining = descendantSegments.slice(1);
          const candidate = [anchor, ...remaining].join(" > ");
          if (isUniqueSelectorFor(candidate, element)) return candidate;
        }
      }

      for (const attribute of STABLE_ATTRIBUTES) {
        const value = String(current.getAttribute(attribute) || "").trim();
        if (!value || value.length > 100 || looksGenerated(value)) continue;
        const anchor = `${current.localName}[${attribute}="${escapeAttributeValue(value)}"]`;
        if (queryMatches(anchor).length !== 1) continue;
        const remaining = descendantSegments.slice(1);
        const candidate = [anchor, ...remaining].join(" > ");
        if (isUniqueSelectorFor(candidate, element)) return candidate;
      }

      current = current.parentElement;
      if (!current || current === document.documentElement || current === document.body) break;
    }

    return "";
  }

  function getElementName(element) {
    if (!(element instanceof Element)) return "요소";

    let name = element.localName || element.tagName.toLowerCase();
    const id = String(element.id || "").trim();
    if (id) name += `#${id}`;

    const classes = getStableClasses(element).slice(0, 2);
    if (classes.length > 0) {
      name += classes.map((className) => `.${className}`).join("");
    }

    return name.length > 90 ? `${name.slice(0, 87)}...` : name;
  }

  function isAllowedTarget(element) {
    if (!(element instanceof Element) || !element.isConnected) return false;
    if (BLOCKED_TAGS.has(element.tagName)) return false;
    if (element.id === HOST_ID || element.id === AREA_SELECTOR_HOST_ID) return false;
    if (element.closest?.(`#${HOST_ID}, #${AREA_SELECTOR_HOST_ID}`)) return false;

    const rectangle = element.getBoundingClientRect();
    return rectangle.width > 0.5 && rectangle.height > 0.5;
  }

  function findElementBelowPoint(clientX, clientY) {
    if (!surface || !active) return null;

    const previousPointerEvents = surface.style.pointerEvents;
    surface.style.pointerEvents = "none";
    const element = document.elementFromPoint(clientX, clientY);
    surface.style.pointerEvents = previousPointerEvents || "auto";

    return isAllowedTarget(element) ? element : null;
  }

  function clearHighlight() {
    currentTarget = null;
    if (outline) outline.hidden = true;
    if (targetLabel) targetLabel.hidden = true;
  }

  function drawHighlight() {
    pendingFrame = 0;
    if (!active || !currentTarget || !currentTarget.isConnected) {
      clearHighlight();
      return;
    }

    const rectangle = currentTarget.getBoundingClientRect();
    const left = Math.max(0, rectangle.left);
    const top = Math.max(0, rectangle.top);
    const right = Math.min(window.innerWidth, rectangle.right);
    const bottom = Math.min(window.innerHeight, rectangle.bottom);
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);

    if (width < 0.5 || height < 0.5) {
      clearHighlight();
      return;
    }

    outline.hidden = false;
    outline.style.left = `${left}px`;
    outline.style.top = `${top}px`;
    outline.style.width = `${width}px`;
    outline.style.height = `${height}px`;

    targetLabel.textContent = getElementName(currentTarget);
    targetLabel.hidden = false;

    const estimatedLabelWidth = Math.min(300, Math.max(90, targetLabel.textContent.length * 7.1 + 18));
    const labelLeft = Math.max(4, Math.min(window.innerWidth - estimatedLabelWidth - 4, left));
    const labelTop = top >= 31
      ? top - 27
      : Math.min(window.innerHeight - 27, bottom + 4);

    targetLabel.style.left = `${labelLeft}px`;
    targetLabel.style.top = `${Math.max(4, labelTop)}px`;
  }

  function scheduleHighlight() {
    if (!pendingFrame) pendingFrame = requestAnimationFrame(drawHighlight);
  }

  function updateTargetFromPoint(clientX, clientY) {
    lastClientX = clientX;
    lastClientY = clientY;
    currentTarget = findElementBelowPoint(clientX, clientY);
    scheduleHighlight();
  }

  function getDefaultInstruction() {
    return mode === "persistent"
      ? "마우스를 올린 뒤 클릭하면 이 사이트에서 계속 숨깁니다."
      : "마우스를 올린 뒤 클릭하면 이번 페이지에서만 숨깁니다.";
  }

  function updateModeUi() {
    if (!modeBadge || !instruction) return;
    modeBadge.textContent = mode === "persistent" ? "사이트 기억" : "이번에만";
    modeBadge.dataset.mode = mode;
    instruction.textContent = getDefaultInstruction();
  }

  function showInstruction(message, state = "ready", resetAfter = 0) {
    if (!instruction) return;
    instruction.textContent = message;
    instruction.dataset.state = state;

    if (statusResetTimer) {
      clearTimeout(statusResetTimer);
      statusResetTimer = 0;
    }

    if (resetAfter > 0) {
      statusResetTimer = setTimeout(() => {
        statusResetTimer = 0;
        if (instruction) {
          instruction.dataset.state = "ready";
          instruction.textContent = getDefaultInstruction();
        }
      }, resetAfter);
    }
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      const runtime = globalThis.chrome?.runtime;
      if (!runtime || typeof runtime.sendMessage !== "function") {
        reject(new Error("확장 프로그램 저장소에 연결할 수 없습니다."));
        return;
      }

      runtime.sendMessage(message, (response) => {
        const error = runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(response);
      });
    });
  }

  function captureInlineDisplay(element) {
    return {
      value: element.style.getPropertyValue("display"),
      priority: element.style.getPropertyPriority("display")
    };
  }

  function restoreInlineDisplay(element, original) {
    if (!element?.isConnected) return;
    if (original.value) {
      element.style.setProperty("display", original.value, original.priority || "");
    } else {
      element.style.removeProperty("display");
    }
  }

  function hideTemporarily(element) {
    element.style.setProperty("display", "none", "important");
  }

  function addSessionPersistentRule(selector) {
    const parent = document.documentElement || document.head || document.body;
    if (!parent) return;

    let style = document.getElementById(SESSION_STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = SESSION_STYLE_ID;
      style.setAttribute("data-page-element-eraser", "session");
      parent.appendChild(style);
    }

    try {
      style.sheet?.insertRule(`${selector} { display: none !important; }`, style.sheet.cssRules.length);
    } catch {
      style.textContent += `\n${selector} { display: none !important; }`;
    }
  }

  function nextTwoFrames() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }

  async function erasePersistent(element) {
    if (element.getRootNode() !== document) {
      showInstruction("Shadow DOM 안의 요소는 사이트에 기억할 수 없습니다. 이번 페이지에서만 숨기기를 사용하세요.", "error", 2600);
      return;
    }

    const selector = buildPersistentSelector(element);
    if (!selector) {
      showInstruction("사이트 변경 뒤에도 안전하게 찾을 수 있는 선택자를 만들지 못했습니다. 이번에만 숨기기를 사용하세요.", "error", 3000);
      return;
    }

    const label = getElementName(element);
    const originalDisplay = captureInlineDisplay(element);
    hideTemporarily(element);
    clearHighlight();

    try {
      const response = await sendRuntimeMessage({
        type: MESSAGE_TYPES.ADD_RULE,
        selector,
        label,
        pageUrl: location.href
      });

      if (!response?.ok) {
        throw new Error(response?.error || "이 사이트의 숨기기 규칙을 저장하지 못했습니다.");
      }

      addSessionPersistentRule(selector);
      await nextTwoFrames();
      restoreInlineDisplay(element, originalDisplay);
      showInstruction(
        `${label} 요소를 숨기고 이 사이트에 기억했습니다.`,
        "success",
        1700
      );
    } catch (error) {
      restoreInlineDisplay(element, originalDisplay);
      showInstruction(String(error?.message || "숨기기 규칙을 저장하지 못했습니다."), "error", 2400);
    }
  }

  async function eraseCurrentTarget() {
    if (saving || !currentTarget || !isAllowedTarget(currentTarget)) return;

    const element = currentTarget;
    const label = getElementName(element);

    if (mode === "temporary") {
      hideTemporarily(element);
      clearHighlight();
      showInstruction(`${label} 요소를 이번 페이지에서 숨겼습니다.`, "success", 1400);
      updateTargetFromPoint(lastClientX, lastClientY);
      return;
    }

    saving = true;
    surface.style.cursor = "wait";
    try {
      await erasePersistent(element);
    } finally {
      saving = false;
      if (surface) surface.style.cursor = "crosshair";
      updateTargetFromPoint(lastClientX, lastClientY);
    }
  }

  function onSurfacePointerMove(event) {
    if (!event.isTrusted) return;
    updateTargetFromPoint(event.clientX, event.clientY);
  }

  function onSurfacePointerLeave() {
    clearHighlight();
  }

  function onSurfacePointerDown(event) {
    if (!event.isTrusted || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function onSurfaceClick(event) {
    if (!event.isTrusted || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    updateTargetFromPoint(event.clientX, event.clientY);
    void eraseCurrentTarget();
  }

  function onWindowScroll() {
    if (currentTarget) scheduleHighlight();
  }

  function onWindowResize() {
    if (currentTarget) scheduleHighlight();
  }

  function onKeyDown(event) {
    if (!event.isTrusted || event.key !== "Escape" || !active) return;
    event.preventDefault();
    event.stopPropagation();
    stop();
  }

  function onExitClick(event) {
    if (!event.isTrusted) return;
    stop();
  }

  function buildUi() {
    host = document.createElement("div");
    host.id = HOST_ID;
    host.style.cssText = [
      "all: initial",
      "position: fixed",
      "inset: 0",
      "z-index: 2147483647",
      "display: block",
      "pointer-events: none"
    ].join(";");

    shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; }
        .surface {
          position: fixed;
          inset: 0;
          z-index: 1;
          pointer-events: auto;
          cursor: crosshair;
          background: transparent;
          touch-action: none;
          user-select: none;
        }
        .bar {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 4;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          min-height: 48px;
          padding: 8px 14px;
          background: rgba(17, 24, 39, 0.97);
          color: #ffffff;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.28);
          font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          pointer-events: auto;
        }
        .mode {
          flex: 0 0 auto;
          padding: 3px 7px;
          border-radius: 999px;
          background: #475569;
          color: #ffffff;
          font-size: 11px;
          font-weight: 700;
          white-space: nowrap;
        }
        .mode[data-mode="persistent"] { background: #b91c1c; }
        .instruction {
          min-width: 0;
          max-width: 760px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .instruction[data-state="success"] { color: #86efac; }
        .instruction[data-state="error"] { color: #fca5a5; }
        .keys {
          flex: 0 0 auto;
          color: #cbd5e1;
          font-size: 11px;
          white-space: nowrap;
        }
        .exit {
          flex: 0 0 auto;
          min-height: 30px;
          padding: 5px 11px;
          border: 1px solid rgba(255, 255, 255, 0.35);
          border-radius: 7px;
          background: rgba(255, 255, 255, 0.1);
          color: #ffffff;
          cursor: pointer;
          font: 700 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .exit:hover { background: rgba(255, 255, 255, 0.18); }
        .exit:focus-visible { outline: 3px solid rgba(147, 197, 253, 0.75); outline-offset: 2px; }
        .outline {
          position: fixed;
          z-index: 2;
          border: 2px solid #ef4444;
          background: rgba(239, 68, 68, 0.08);
          box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.7) inset;
          pointer-events: none;
        }
        .label {
          position: fixed;
          z-index: 3;
          max-width: 300px;
          padding: 4px 8px;
          overflow: hidden;
          border-radius: 5px;
          background: #dc2626;
          color: #ffffff;
          font: 700 11px/1.35 Consolas, "Courier New", monospace;
          text-overflow: ellipsis;
          white-space: nowrap;
          pointer-events: none;
          box-shadow: 0 2px 7px rgba(0, 0, 0, 0.25);
        }
        @media (max-width: 620px) {
          .bar { justify-content: flex-start; gap: 7px; }
          .keys { display: none; }
          .instruction { flex: 1 1 auto; }
        }
        @media (prefers-reduced-motion: reduce) {
          .exit { transition: none; }
        }
      </style>
      <div class="surface" aria-hidden="true"></div>
      <div class="outline" hidden></div>
      <div class="label" hidden></div>
      <div class="bar" role="status" aria-live="polite">
        <span class="mode"></span>
        <span class="instruction"></span>
        <span class="keys">Esc 키로 종료</span>
        <button class="exit" type="button">종료</button>
      </div>
    `;

    surface = shadow.querySelector(".surface");
    outline = shadow.querySelector(".outline");
    targetLabel = shadow.querySelector(".label");
    modeBadge = shadow.querySelector(".mode");
    instruction = shadow.querySelector(".instruction");
    exitButton = shadow.querySelector(".exit");

    surface.addEventListener("pointermove", onSurfacePointerMove, true);
    surface.addEventListener("pointerleave", onSurfacePointerLeave, true);
    surface.addEventListener("pointerdown", onSurfacePointerDown, true);
    surface.addEventListener("click", onSurfaceClick, true);
    exitButton.addEventListener("click", onExitClick);
    host.addEventListener(FORCE_EXIT_EVENT, stop);

    (document.documentElement || document.body).appendChild(host);
  }

  function removeUi() {
    if (pendingFrame) {
      cancelAnimationFrame(pendingFrame);
      pendingFrame = 0;
    }
    if (statusResetTimer) {
      clearTimeout(statusResetTimer);
      statusResetTimer = 0;
    }

    surface?.removeEventListener("pointermove", onSurfacePointerMove, true);
    surface?.removeEventListener("pointerleave", onSurfacePointerLeave, true);
    surface?.removeEventListener("pointerdown", onSurfacePointerDown, true);
    surface?.removeEventListener("click", onSurfaceClick, true);
    exitButton?.removeEventListener("click", onExitClick);
    host?.removeEventListener(FORCE_EXIT_EVENT, stop);
    host?.remove();

    host = null;
    shadow = null;
    surface = null;
    outline = null;
    targetLabel = null;
    modeBadge = null;
    instruction = null;
    exitButton = null;
    currentTarget = null;
    saving = false;
  }

  function start(requestedMode) {
    const normalizedMode = VALID_MODES.has(requestedMode) ? requestedMode : "temporary";
    mode = normalizedMode;

    const areaSelectorHost = document.getElementById(AREA_SELECTOR_HOST_ID);
    areaSelectorHost?.dispatchEvent(new CustomEvent(AREA_SELECTOR_CANCEL_EVENT));

    if (!active) {
      document.getElementById(HOST_ID)?.remove();
      buildUi();
      window.addEventListener("keydown", onKeyDown, true);
      window.addEventListener("scroll", onWindowScroll, true);
      window.addEventListener("resize", onWindowResize, true);
      active = true;
    }

    updateModeUi();
    return { mode };
  }

  function stop() {
    if (!active) return;
    active = false;
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("scroll", onWindowScroll, true);
    window.removeEventListener("resize", onWindowResize, true);
    removeUi();
  }

  const runtimeMessages = globalThis.chrome?.runtime?.onMessage;
  if (runtimeMessages && typeof runtimeMessages.addListener === "function") {
    runtimeMessages.addListener((message, _sender, sendResponse) => {
      if (message?.type !== MESSAGE_TYPES.ACTIVATE) return false;

      try {
        const result = start(message.mode);
        sendResponse({ ok: true, ...result });
      } catch (error) {
        sendResponse({ ok: false, error: String(error?.message || error) });
      }
      return false;
    });
  }

  globalThis[CONTROLLER_KEY] = Object.freeze({ start, stop });
})();
