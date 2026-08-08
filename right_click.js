(() => {
  "use strict";

  const DEFAULT_SETTINGS = Object.freeze({
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

  const MESSAGE_TYPES = Object.freeze({
    OPEN_LINK_IN_NEW_TAB: "page-tools:open-link-in-new-tab",
    GET_CONTEXT_LINK: "page-tools:get-context-link",
    COPY_LINK_ADDRESS: "page-tools:copy-link-address",
    APPLY_NAVIGATION_GUARD: "page-tools:apply-navigation-guard"
  });

  const LEFT_BUTTON = 0;
  const MIDDLE_BUTTON = 1;
  const RIGHT_BUTTON = 2;
  const LEFT_BUTTONS_MASK = 1;
  const TEXT_DRAG_THRESHOLD_PX = 4;
  const CONTEXT_LINK_MAX_AGE_MS = 30_000;
  const OPEN_REQUEST_DEDUP_MS = 650;
  const AREA_SELECTOR_HOST_ID = "__drag_area_screenshot_host__";
  const ELEMENT_ERASER_HOST_ID = "__page_element_eraser_host__";
  const UNLOCK_STYLE_ID = "__chatgpt_browser_tools_unlock_style__";
  const TEXT_SELECTION_ACTIVE_CLASS = "__chatgpt_browser_tools_text_selection_active__";
  const LEGACY_VISITED_LINK_STYLE_ID = "__chatgpt_browser_tools_visited_link_style__";
  const LEGACY_VISITED_LINK_ATTRIBUTE = "data-chatgpt-browser-tools-visited-link";
  const TOAST_HOST_ID = "__chatgpt_browser_tools_toast_host__";
  const NAVIGATION_GUARD_TOKEN = createNavigationGuardToken();

  const EVENT_TYPES = Object.freeze([
    "contextmenu",
    "pointerdown",
    "pointerup",
    "pointercancel",
    "mousedown",
    "pointermove",
    "mousemove",
    "mouseup",
    "click",
    "dblclick",
    "auxclick",
    "selectstart",
    "dragstart",
    "dragend",
    "beforecopy",
    "copy",
    "keydown",
    "keyup"
  ]);

  const DIRECT_URL_ATTRIBUTES = Object.freeze([
    "data-href",
    "data-url",
    "data-link-url",
    "data-target-url"
  ]);

  const HANDLER_ATTRIBUTES = Object.freeze([
    "onclick",
    "onauxclick"
  ]);


  function createNavigationGuardToken() {
    const bytes = new Uint8Array(24);
    try {
      globalThis.crypto.getRandomValues(bytes);
    } catch {
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
    }
    return `__cbt_guard_${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
  }

  let settings = { ...DEFAULT_SETTINGS };
  let textGesture = null;
  let suppressNextTextClick = false;
  let suppressTextClickTimer = 0;
  let pendingNewTabGesture = null;
  let lastOpenRequest = { url: "", timestamp: 0 };
  let lastContextLink = null;
  let forcedClipboardText = null;
  let toastTimer = 0;
  let eventListenersAttached = false;
  let textSelectionDeactivateTimer = 0;
  const preparedImages = new Map();
  const preparedTextElements = new Map();

  function areaSelectorIsActive() {
    return Boolean(
      document.getElementById(AREA_SELECTOR_HOST_ID) ||
      document.getElementById(ELEMENT_ERASER_HOST_ID)
    );
  }

  function removeLegacyVisitedLinkOverrides() {
    document.getElementById(LEGACY_VISITED_LINK_STYLE_ID)?.remove();

    const root = document.documentElement;
    if (!root) {
      document.addEventListener("DOMContentLoaded", removeLegacyVisitedLinkOverrides, {
        once: true
      });
      return;
    }

    try {
      for (const element of root.querySelectorAll(`[${LEGACY_VISITED_LINK_ATTRIBUTE}]`)) {
        element.removeAttribute(LEGACY_VISITED_LINK_ATTRIBUTE);
      }
    } catch {
      // Legacy cleanup is best-effort only.
    }
  }

  function getEventPath(event) {
    if (typeof event.composedPath === "function") {
      const path = event.composedPath();
      if (Array.isArray(path) && path.length > 0) return path;
    }

    return event.target ? [event.target] : [];
  }

  function firstElementInPath(event) {
    return getEventPath(event).find((node) => node?.nodeType === Node.ELEMENT_NODE) || null;
  }

  function imageInPath(event) {
    return getEventPath(event).find(
      (node) => node?.nodeType === Node.ELEMENT_NODE && node.localName === "img"
    ) || null;
  }

  function stopWebsiteHandlers(event) {
    // The caller decides whether preventDefault() is needed. Stopping page handlers alone
    // keeps Chrome's ordinary browser action available.
    event.stopImmediatePropagation();
  }

  function activateTextSelectionStyle() {
    if (!settings.textSelectionEnabled) return;
    if (textSelectionDeactivateTimer) {
      window.clearTimeout(textSelectionDeactivateTimer);
      textSelectionDeactivateTimer = 0;
    }
    document.documentElement?.classList.add(TEXT_SELECTION_ACTIVE_CLASS);
  }

  function deactivateTextSelectionStyle(delay = 0) {
    if (textSelectionDeactivateTimer) {
      window.clearTimeout(textSelectionDeactivateTimer);
      textSelectionDeactivateTimer = 0;
    }

    const remove = () => {
      textSelectionDeactivateTimer = 0;
      document.documentElement?.classList.remove(TEXT_SELECTION_ACTIVE_CLASS);
      restoreAllPreparedTextElements();
    };

    if (delay > 0) textSelectionDeactivateTimer = window.setTimeout(remove, delay);
    else remove();
  }

  function ensureUnlockStyle() {
    const needsStyle = settings.textSelectionEnabled;
    let style = document.getElementById(UNLOCK_STYLE_ID);

    if (!needsStyle) {
      style?.remove();
      document.documentElement?.classList.remove(TEXT_SELECTION_ACTIVE_CLASS);
      return;
    }

    const root = document.documentElement;
    if (!root) {
      document.addEventListener("DOMContentLoaded", ensureUnlockStyle, { once: true });
      return;
    }

    if (!style) {
      style = document.createElement("style");
      style.id = UNLOCK_STYLE_ID;
      root.appendChild(style);
    }

    const rules = [];
    if (settings.textSelectionEnabled) {
      rules.push(`
        html.${TEXT_SELECTION_ACTIVE_CLASS} body,
        html.${TEXT_SELECTION_ACTIVE_CLASS} body *:not(input):not(textarea):not(select):not(option):not(button):not(canvas):not(video):not(audio):not(iframe):not(object):not(embed):not([contenteditable]):not([role="slider"]) {
          -webkit-user-select: text !important;
          user-select: text !important;
        }
      `);
    }


    style.textContent = rules.join("\n");
  }

  function rememberTextElement(element) {
    if (!element || preparedTextElements.has(element)) return;

    preparedTextElements.set(element, {
      userSelectValue: element.style.getPropertyValue("user-select"),
      userSelectPriority: element.style.getPropertyPriority("user-select"),
      webkitUserSelectValue: element.style.getPropertyValue("-webkit-user-select"),
      webkitUserSelectPriority: element.style.getPropertyPriority("-webkit-user-select")
    });

    element.style.setProperty("user-select", "text", "important");
    element.style.setProperty("-webkit-user-select", "text", "important");
  }

  function prepareTextSelectionPath(event) {
    const seen = new Set();

    for (const node of getEventPath(event)) {
      if (node?.nodeType !== Node.ELEMENT_NODE || seen.has(node)) continue;
      seen.add(node);
      rememberTextElement(node);
    }

    let current = firstElementInPath(event);
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      if (!seen.has(current)) rememberTextElement(current);
      if (current === document.documentElement) break;
      current = current.parentElement;
    }
  }

  function restoreAllPreparedTextElements() {
    for (const [element, previous] of [...preparedTextElements.entries()]) {
      const currentUserSelect = element.style.getPropertyValue("user-select");
      const currentUserSelectPriority = element.style.getPropertyPriority("user-select");
      if (currentUserSelect === "text" && currentUserSelectPriority === "important") {
        if (previous.userSelectValue) {
          element.style.setProperty(
            "user-select",
            previous.userSelectValue,
            previous.userSelectPriority
          );
        } else {
          element.style.removeProperty("user-select");
        }
      }

      const currentWebkitValue = element.style.getPropertyValue("-webkit-user-select");
      const currentWebkitPriority = element.style.getPropertyPriority("-webkit-user-select");
      if (currentWebkitValue === "text" && currentWebkitPriority === "important") {
        if (previous.webkitUserSelectValue) {
          element.style.setProperty(
            "-webkit-user-select",
            previous.webkitUserSelectValue,
            previous.webkitUserSelectPriority
          );
        } else {
          element.style.removeProperty("-webkit-user-select");
        }
      }

      preparedTextElements.delete(element);
    }
  }

  function restorePreparedImage(image) {
    const previous = preparedImages.get(image);
    if (!previous) return;

    if (previous.draggableAttribute === null) {
      image.removeAttribute("draggable");
    } else {
      image.setAttribute("draggable", previous.draggableAttribute);
    }

    if (previous.userDragValue) {
      image.style.setProperty(
        "-webkit-user-drag",
        previous.userDragValue,
        previous.userDragPriority
      );
    } else {
      image.style.removeProperty("-webkit-user-drag");
    }

    preparedImages.delete(image);
  }

  function restoreAllPreparedImages() {
    for (const image of [...preparedImages.keys()]) {
      restorePreparedImage(image);
    }
  }

  function prepareImageForDrag(image) {
    if (!image || image.localName !== "img") return;

    if (!preparedImages.has(image)) {
      preparedImages.set(image, {
        draggableAttribute: image.getAttribute("draggable"),
        userDragValue: image.style.getPropertyValue("-webkit-user-drag"),
        userDragPriority: image.style.getPropertyPriority("-webkit-user-drag")
      });
    }

    image.setAttribute("draggable", "true");
    image.style.setProperty("-webkit-user-drag", "auto", "important");
  }

  function schedulePreparedImageRestore(image) {
    if (!image || !preparedImages.has(image)) return;
    window.setTimeout(() => restorePreparedImage(image), 0);
  }

  function isInteractiveElement(element) {
    if (!element || typeof element.closest !== "function") return true;

    return Boolean(element.closest([
      "a",
      "button",
      "input",
      "textarea",
      "select",
      "option",
      "canvas",
      "video",
      "audio",
      "iframe",
      "object",
      "embed",
      "[contenteditable]",
      "[draggable='true']",
      "[role='button']",
      "[role='link']",
      "[role='slider']",
      "[role='textbox']",
      "[role='tab']",
      "[role='menuitem']",
      "[role='checkbox']",
      "[role='radio']"
    ].join(",")));
  }

  function textNodeAtPoint(event) {
    const x = Number(event.clientX);
    const y = Number(event.clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    if (typeof document.caretPositionFromPoint === "function") {
      const position = document.caretPositionFromPoint(x, y);
      if (position?.offsetNode?.nodeType === Node.TEXT_NODE) {
        return position.offsetNode;
      }
    }

    if (typeof document.caretRangeFromPoint === "function") {
      const range = document.caretRangeFromPoint(x, y);
      if (range?.startContainer?.nodeType === Node.TEXT_NODE) {
        return range.startContainer;
      }
    }

    return null;
  }

  function eventStartsTextSelection(event) {
    if (event.button !== LEFT_BUTTON) return false;

    const target = firstElementInPath(event);
    if (!target || target.localName === "img" || isInteractiveElement(target)) {
      return false;
    }

    const textNode = textNodeAtPoint(event);
    if (!textNode || !/\S/.test(textNode.data || "")) {
      return false;
    }

    const parent = textNode.parentElement;
    return !parent || !isInteractiveElement(parent);
  }

  function selectionIntersectsEventTarget(event) {
    const selection = globalThis.getSelection?.();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return false;
    }

    const target = getEventPath(event).find(
      (node) => node?.nodeType === Node.ELEMENT_NODE || node?.nodeType === Node.TEXT_NODE
    );
    if (!target) return false;

    try {
      return selection.getRangeAt(0).intersectsNode(target);
    } catch {
      return false;
    }
  }

  function hasCopyableSelection() {
    const active = document.activeElement;
    if (
      active &&
      (active.localName === "input" || active.localName === "textarea") &&
      Number.isInteger(active.selectionStart) &&
      Number.isInteger(active.selectionEnd) &&
      active.selectionStart !== active.selectionEnd
    ) {
      return true;
    }

    const selection = globalThis.getSelection?.();
    return Boolean(selection && !selection.isCollapsed && selection.rangeCount > 0);
  }

  function getSelectedPlainText() {
    const active = document.activeElement;
    const isSafeTextControl = Boolean(
      active &&
      (
        active.localName === "textarea" ||
        (
          active.localName === "input" &&
          !["file", "password"].includes(String(active.type || "").toLowerCase())
        )
      )
    );

    if (
      isSafeTextControl &&
      Number.isInteger(active.selectionStart) &&
      Number.isInteger(active.selectionEnd) &&
      active.selectionStart !== active.selectionEnd
    ) {
      return String(active.value || "").slice(active.selectionStart, active.selectionEnd);
    }

    const selection = globalThis.getSelection?.();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return null;
    }

    const text = selection.toString();
    return text.length > 0 ? text : null;
  }

  function writeTextToCopyEvent(event, text) {
    const clipboardData = event.clipboardData;
    if (!clipboardData || typeof clipboardData.setData !== "function") {
      return false;
    }

    try {
      if (typeof clipboardData.clearData === "function") {
        clipboardData.clearData();
      }
      clipboardData.setData("text/plain", text);
      event.preventDefault();
      return true;
    } catch {
      return false;
    }
  }

  function writeCleanSelectionToCopyEvent(event) {
    const selectedText = getSelectedPlainText();
    return selectedText !== null && writeTextToCopyEvent(event, selectedText);
  }

  function beginTextGesture(event) {
    textGesture = {
      x: Number(event.clientX) || 0,
      y: Number(event.clientY) || 0,
      moved: false
    };
  }

  function updateTextGesture(event) {
    if (!textGesture || !(event.buttons & LEFT_BUTTONS_MASK)) return false;

    if (
      Math.abs((Number(event.clientX) || 0) - textGesture.x) >= TEXT_DRAG_THRESHOLD_PX ||
      Math.abs((Number(event.clientY) || 0) - textGesture.y) >= TEXT_DRAG_THRESHOLD_PX
    ) {
      textGesture.moved = true;
    }

    return true;
  }

  function finishTextGesture(event) {
    if (!textGesture || event.button !== LEFT_BUTTON) return false;

    const moved = textGesture.moved;
    textGesture = null;

    if (!moved) return false;

    suppressNextTextClick = true;
    if (suppressTextClickTimer) {
      window.clearTimeout(suppressTextClickTimer);
    }
    suppressTextClickTimer = window.setTimeout(() => {
      suppressNextTextClick = false;
      suppressTextClickTimer = 0;
    }, 0);

    return true;
  }

  function decodeHtmlEntities(value) {
    const text = String(value || "");
    if (!text.includes("&")) return text;

    try {
      const textarea = document.createElement("textarea");
      textarea.innerHTML = text;
      return textarea.value;
    } catch {
      return text.replace(/&amp;/gi, "&");
    }
  }

  function cleanUrlText(value) {
    return decodeHtmlEntities(value)
      .replace(/\\u002f/gi, "/")
      .replace(/\\x2f/gi, "/")
      .replace(/\\\//g, "/")
      .trim();
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

  function looksLikeUrlValue(value, trustedAttribute = false) {
    const text = stripWrappingQuotes(value);
    if (!text || /^(?:javascript|data|blob):/i.test(text)) return false;
    if (trustedAttribute) return !/^#(?:[^/]|$)/.test(text);

    if (/^(?:https?:\/\/|\/\/|\/|\.\.\/|\.\/|\?)/i.test(text)) {
      return true;
    }
    if (/^www\.[a-z0-9.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(text)) {
      return true;
    }

    // Heuristic data attributes often contain indices such as "1". Accept only
    // relative values that visibly resemble a path or URL, never a bare ID.
    return !/^[+-]?\d+(?:\.\d+)?$/.test(text) &&
      /(?:[/?#]|\.[a-z0-9]{1,8}(?:[?#]|$))/i.test(text) &&
      !/[{}<>]/.test(text);
  }

  function urlTextCandidates(value) {
    const candidates = [];
    let current = stripWrappingQuotes(cleanUrlText(value));

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

  function normalizeWebUrl(value, baseUrl = document.baseURI, trustedAttribute = false) {
    for (const candidate of urlTextCandidates(value)) {
      if (!looksLikeUrlValue(candidate, trustedAttribute)) continue;
      const prepared = /^www\./i.test(candidate) ? `https://${candidate}` : candidate;

      try {
        const url = new URL(prepared, baseUrl || location.href);
        if (url.protocol === "http:" || url.protocol === "https:") return url.href;
      } catch {
        // Try the next decoding level when an encoded URL was supplied.
      }
    }

    return null;
  }

  function extractUrlTextFromHandler(source) {
    const text = decodeHtmlEntities(source)
      .replace(/\\u002f/gi, "/")
      .replace(/\\x2f/gi, "/")
      .replace(/\\\//g, "/");
    if (!text) return "";

    const patterns = [
      /(?:window\s*\.\s*)?open\s*\(\s*(["'`])((?:https?:\/\/|\/\/|\/|\.\.\/|\.\/)[^"'`]+)\1\s*(?:,|\))/i,
      /(?:window\s*\.\s*)?(?:document\s*\.\s*)?location(?:\s*\.\s*href)?\s*=\s*(["'`])((?:https?:\/\/|\/\/|\/|\.\.\/|\.\/)[^"'`]+)\1/i,
      /(?:window\s*\.\s*)?location\s*\.\s*(?:assign|replace)\s*\(\s*(["'`])((?:https?:\/\/|\/\/|\/|\.\.\/|\.\/)[^"'`]+)\1\s*\)/i
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[2]) return match[2];
    }
    return "";
  }

  function nativeHyperlinkFromElement(element) {
    if (!(element instanceof Element)) return null;
    if (element.localName !== "a" && element.localName !== "area") return null;

    const rawHref = element.getAttribute("href");
    if (!rawHref || /^\s*(?:javascript:|#)/i.test(rawHref)) return null;

    const url = finalizeLinkCandidate(rawHref, true);
    return url ? { url, element } : null;
  }

  function findNativeHyperlinkDetails(event) {
    for (const element of elementCandidatesFromEvent(event)) {
      const details = nativeHyperlinkFromElement(element);
      if (details) return details;
    }
    return null;
  }

  function elementCandidatesFromEvent(event) {
    const first = firstElementInPath(event);
    if (!(first instanceof Element)) return [];

    const candidates = [first];
    const nearestControl = first.closest(
      "a[href], area[href], button, [role='button'], [role='link'], [data-href], [data-url], [data-link-url], [data-target-url]"
    );
    if (nearestControl && nearestControl !== first) candidates.push(nearestControl);
    return candidates;
  }

  function finalizeLinkCandidate(rawValue, trustedAttribute = false) {
    const normalized = normalizeWebUrl(rawValue, document.baseURI, trustedAttribute);
    return normalized;
  }

  function linkCandidateFromElement(element) {
    if (!(element instanceof Element)) return null;

    if (element.localName === "a" || element.localName === "area") {
      const directHref = element.getAttribute("href") || element.href;
      const candidate = finalizeLinkCandidate(directHref, true);
      if (candidate) return candidate;

      if (/^\s*javascript:/i.test(String(directHref || ""))) {
        const scriptedCandidate = finalizeLinkCandidate(
          extractUrlTextFromHandler(String(directHref).replace(/^\s*javascript:\s*/i, ""))
        );
        if (scriptedCandidate) return scriptedCandidate;
      }
    }


    for (const attribute of DIRECT_URL_ATTRIBUTES) {
      if (!element.hasAttribute(attribute)) continue;
      const raw = element.getAttribute(attribute);
      const candidate = finalizeLinkCandidate(raw, false);
      if (candidate) return candidate;
    }


    for (const attribute of HANDLER_ATTRIBUTES) {
      const source = element.getAttribute(attribute);
      if (!source) continue;
      const candidate = finalizeLinkCandidate(extractUrlTextFromHandler(source));
      if (candidate) return candidate;
    }


    return null;
  }

  function findLinkDetails(event) {
    const nativeDetails = findNativeHyperlinkDetails(event);
    if (nativeDetails) return nativeDetails;

    for (const element of elementCandidatesFromEvent(event)) {
      const candidate = linkCandidateFromElement(element);
      if (candidate) return { url: candidate, element };
    }
    return null;
  }

  function findLinkCandidate(event) {
    return findLinkDetails(event)?.url || null;
  }

  function rememberContextLink(event) {
    const details = findLinkDetails(event);
    lastContextLink = details
      ? { ...details, timestamp: Date.now() }
      : null;
    return details?.url || null;
  }

  function getRememberedContextLink() {
    if (!lastContextLink) return null;
    if (Date.now() - lastContextLink.timestamp > CONTEXT_LINK_MAX_AGE_MS) {
      lastContextLink = null;
      return null;
    }
    return lastContextLink.url;
  }

  function showToast(message, state = "success") {
    const root = document.documentElement;
    if (!root) return;

    let host = document.getElementById(TOAST_HOST_ID);
    let textNode;

    if (!host) {
      host = document.createElement("div");
      host.id = TOAST_HOST_ID;
      host.style.setProperty("all", "initial", "important");
      host.style.setProperty("position", "fixed", "important");
      host.style.setProperty("left", "50%", "important");
      host.style.setProperty("bottom", "24px", "important");
      host.style.setProperty("transform", "translateX(-50%)", "important");
      host.style.setProperty("z-index", "2147483647", "important");
      host.style.setProperty("pointer-events", "none", "important");

      const shadow = host.attachShadow({ mode: "closed" });
      const style = document.createElement("style");
      style.textContent = `
        .toast {
          max-width: min(420px, calc(100vw - 32px));
          padding: 10px 14px;
          border: 1px solid rgba(255, 255, 255, 0.18);
          border-radius: 10px;
          background: rgba(31, 41, 55, 0.96);
          color: #fff;
          box-shadow: 0 8px 28px rgba(0, 0, 0, 0.28);
          font: 600 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          text-align: center;
          overflow-wrap: anywhere;
        }
        .toast[data-state="error"] { background: rgba(153, 27, 27, 0.97); }
      `;
      textNode = document.createElement("div");
      textNode.className = "toast";
      shadow.append(style, textNode);
      host.__chatgptBrowserToolsToastText = textNode;
      root.appendChild(host);
    } else {
      textNode = host.__chatgptBrowserToolsToastText;
    }

    if (!textNode) return;
    textNode.dataset.state = state;
    textNode.textContent = String(message || "");

    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toastTimer = 0;
      host?.remove();
    }, 1900);
  }

  function runtimeErrorMessage() {
    return globalThis.chrome?.runtime?.lastError?.message || "";
  }

  function requestOpenInNewTab(url) {
    const currentTime = Date.now();
    if (
      lastOpenRequest.url === url &&
      currentTime - lastOpenRequest.timestamp < OPEN_REQUEST_DEDUP_MS
    ) {
      return;
    }
    lastOpenRequest = { url, timestamp: currentTime };

    const runtime = globalThis.chrome?.runtime;
    if (!runtime || typeof runtime.sendMessage !== "function") {
      showToast("새 탭을 열 수 없습니다.", "error");
      return;
    }

    runtime.sendMessage(
      { type: MESSAGE_TYPES.OPEN_LINK_IN_NEW_TAB, url },
      (response) => {
        const error = runtimeErrorMessage();
        if (error || response?.ok !== true) {
          showToast(response?.error || error || "새 탭을 열지 못했습니다.", "error");
          return;
        }

        // A real hyperlink is left to Chrome. JavaScript-only controls have no
        // native :visited state to style, so no synthetic color is applied.
      }
    );
  }

  function pendingNewTabDetailsFor(event) {
    if (!pendingNewTabGesture) return null;
    if (Date.now() - pendingNewTabGesture.timestamp >= 3000) {
      pendingNewTabGesture = null;
      return null;
    }
    return pendingNewTabGesture.button === event.button
      ? pendingNewTabGesture
      : null;
  }

  function handleNewTabGesture(event, fallbackDetails = null) {
    if (findNativeHyperlinkDetails(event)) {
      pendingNewTabGesture = null;
      return false;
    }

    const details = fallbackDetails?.url ? fallbackDetails : findLinkDetails(event);
    if (!details?.url) return false;

    event.preventDefault();
    stopWebsiteHandlers(event);
    pendingNewTabGesture = null;
    requestOpenInNewTab(details.url);
    return true;
  }

  async function writeClipboardText(text) {
    const value = String(text || "");
    if (!value) throw new Error("복사할 링크 주소가 없습니다.");

    const clipboard = globalThis.navigator?.clipboard;
    if (clipboard && typeof clipboard.writeText === "function") {
      try {
        await clipboard.writeText(value);
        return;
      } catch {
        // Fall through to an execCommand copy that is protected by our early capture listener.
      }
    }

    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.setProperty("position", "fixed", "important");
    textarea.style.setProperty("left", "-9999px", "important");
    textarea.style.setProperty("top", "0", "important");
    textarea.style.setProperty("opacity", "0", "important");
    document.documentElement.appendChild(textarea);
    textarea.focus();
    textarea.select();

    forcedClipboardText = value;
    let copied = false;
    try {
      copied = typeof document.execCommand === "function" && document.execCommand("copy");
    } finally {
      forcedClipboardText = null;
      textarea.remove();
    }

    if (!copied) throw new Error("클립보드에 링크 주소를 복사하지 못했습니다.");
  }

  function syncNavigationGuardSettings() {
    const runtime = globalThis.chrome?.runtime;
    if (!runtime || typeof runtime.sendMessage !== "function") return;

    try {
      runtime.sendMessage({
        type: MESSAGE_TYPES.APPLY_NAVIGATION_GUARD,
        guardToken: NAVIGATION_GUARD_TOKEN
      }, () => {
        void runtimeErrorMessage();
      });
    } catch {
      // The page tools continue to work even if MAIN-world injection is unavailable.
    }
  }

  function pageEventFeaturesEnabled() {
    return Boolean(
      settings.rightClickEnabled ||
      settings.textSelectionEnabled ||
      settings.imageDragEnabled ||
      settings.middleClickEnabled ||
      settings.copyUnlockEnabled ||
      settings.clipboardProtectionEnabled ||
      settings.newTabLinksEnabled ||
      settings.linkAddressCopyEnabled
    );
  }

  function updateEventListeners() {
    const shouldAttach = pageEventFeaturesEnabled();
    if (shouldAttach === eventListenersAttached) return;

    for (const eventType of EVENT_TYPES) {
      if (shouldAttach) window.addEventListener(eventType, handleEvent, true);
      else window.removeEventListener(eventType, handleEvent, true);
    }
    eventListenersAttached = shouldAttach;
  }

  function applySettings(values) {
    const previousImageDragEnabled = settings.imageDragEnabled;
    const source = values && typeof values === "object" ? values : {};

    settings = Object.fromEntries(
      Object.keys(DEFAULT_SETTINGS).map((key) => {
        let value = typeof source[key] === "boolean"
          ? source[key]
          : DEFAULT_SETTINGS[key];

        // Version 1.11 tied ordinary copy protection to text selection.
        // Keep that behavior for existing settings that do not have the new key yet.
        if (
          key === "copyUnlockEnabled" &&
          !Object.prototype.hasOwnProperty.call(source, key) &&
          source.textSelectionEnabled === true
        ) {
          value = true;
        }

        return [key, value];
      })
    );

    if (previousImageDragEnabled && !settings.imageDragEnabled) {
      restoreAllPreparedImages();
    }

    if (!settings.textSelectionEnabled) {
      deactivateTextSelectionStyle();
      textGesture = null;
      suppressNextTextClick = false;
      if (suppressTextClickTimer) {
        window.clearTimeout(suppressTextClickTimer);
        suppressTextClickTimer = 0;
      }
    }

    if (!settings.newTabLinksEnabled) {
      pendingNewTabGesture = null;
    }

    if (!settings.newTabLinksEnabled && !settings.linkAddressCopyEnabled) {
      lastContextLink = null;
    }

    ensureUnlockStyle();
    updateEventListeners();
    syncNavigationGuardSettings();
  }

  function handleEvent(event) {
    const internalCopyEvent =
      forcedClipboardText !== null &&
      (event.type === "beforecopy" || event.type === "copy");
    if (!event.isTrusted && !internalCopyEvent) return;
    if (areaSelectorIsActive()) return;

    if (event.type === "contextmenu") {
      const linkContextToolsEnabled =
        settings.newTabLinksEnabled || settings.linkAddressCopyEnabled;
      if (linkContextToolsEnabled) rememberContextLink(event);
      if (settings.rightClickEnabled || linkContextToolsEnabled) {
        stopWebsiteHandlers(event);
      }
      return;
    }

    if (event.type === "keydown" || event.type === "keyup") {
      const copyFeatureEnabled =
        settings.copyUnlockEnabled || settings.clipboardProtectionEnabled;
      const isCopyShortcut =
        copyFeatureEnabled &&
        !event.altKey &&
        (event.ctrlKey || event.metaKey) &&
        String(event.key || "").toLowerCase() === "c" &&
        hasCopyableSelection();

      if (isCopyShortcut) stopWebsiteHandlers(event);
      return;
    }

    if (event.type === "beforecopy") {
      if (
        forcedClipboardText !== null ||
        ((settings.copyUnlockEnabled || settings.clipboardProtectionEnabled) &&
          hasCopyableSelection())
      ) {
        stopWebsiteHandlers(event);
      }
      return;
    }

    if (event.type === "copy") {
      if (forcedClipboardText !== null) {
        writeTextToCopyEvent(event, forcedClipboardText);
        stopWebsiteHandlers(event);
        return;
      }

      if (
        (settings.copyUnlockEnabled || settings.clipboardProtectionEnabled) &&
        hasCopyableSelection()
      ) {
        if (settings.clipboardProtectionEnabled) {
          writeCleanSelectionToCopyEvent(event);
        }
        stopWebsiteHandlers(event);
      }
      return;
    }

    if (event.type === "selectstart") {
      if (settings.textSelectionEnabled) {
        ensureUnlockStyle();
        activateTextSelectionStyle();
        stopWebsiteHandlers(event);
      }
      return;
    }

    if (event.type === "dragstart") {
      const image = imageInPath(event);
      if (settings.imageDragEnabled && image) {
        ensureUnlockStyle();
        prepareImageForDrag(image);
        stopWebsiteHandlers(event);
        return;
      }

      if (settings.textSelectionEnabled && selectionIntersectsEventTarget(event)) {
        stopWebsiteHandlers(event);
      }
      return;
    }

    if (event.type === "dragend") {
      schedulePreparedImageRestore(imageInPath(event));
      return;
    }

    if (event.type === "pointermove" || event.type === "mousemove") {
      if (settings.textSelectionEnabled && updateTextGesture(event)) {
        stopWebsiteHandlers(event);
      }
      return;
    }

    if (event.type === "dblclick") {
      if (settings.textSelectionEnabled && eventStartsTextSelection(event)) {
        ensureUnlockStyle();
        activateTextSelectionStyle();
        prepareTextSelectionPath(event);
        window.setTimeout(() => deactivateTextSelectionStyle(), 120);
        stopWebsiteHandlers(event);
      }
      return;
    }

    if (event.type === "click") {
      if (
        settings.newTabLinksEnabled &&
        event.button === LEFT_BUTTON &&
        !event.altKey &&
        (event.ctrlKey || event.metaKey) &&
        handleNewTabGesture(event, pendingNewTabDetailsFor(event))
      ) {
        return;
      }

      if (settings.middleClickEnabled && event.button === MIDDLE_BUTTON) {
        stopWebsiteHandlers(event);
        return;
      }

      if (settings.textSelectionEnabled && suppressNextTextClick) {
        suppressNextTextClick = false;
        if (suppressTextClickTimer) {
          window.clearTimeout(suppressTextClickTimer);
          suppressTextClickTimer = 0;
        }
        stopWebsiteHandlers(event);
      }
      return;
    }

    if (event.type === "auxclick") {
      if (
        settings.newTabLinksEnabled &&
        event.button === MIDDLE_BUTTON &&
        handleNewTabGesture(event, pendingNewTabDetailsFor(event))
      ) {
        return;
      }

      if (
        (settings.middleClickEnabled && event.button === MIDDLE_BUTTON) ||
        ((settings.rightClickEnabled || settings.newTabLinksEnabled ||
          settings.linkAddressCopyEnabled) && event.button === RIGHT_BUTTON)
      ) {
        stopWebsiteHandlers(event);
      }
      return;
    }

    if (event.type === "pointercancel") {
      textGesture = null;
      pendingNewTabGesture = null;
      restoreAllPreparedImages();
      deactivateTextSelectionStyle();
      return;
    }

    if (event.type === "pointerdown" || event.type === "mousedown") {
      if (
        event.button === RIGHT_BUTTON &&
        (settings.newTabLinksEnabled || settings.linkAddressCopyEnabled)
      ) {
        rememberContextLink(event);
      }

      if (
        settings.newTabLinksEnabled &&
        (
          event.button === MIDDLE_BUTTON ||
          (event.button === LEFT_BUTTON && !event.altKey && (event.ctrlKey || event.metaKey))
        )
      ) {
        if (findNativeHyperlinkDetails(event)) {
          pendingNewTabGesture = null;
        } else {
          const details = findLinkDetails(event);
          if (details?.url) {
            pendingNewTabGesture = {
              ...details,
              button: event.button,
              timestamp: Date.now()
            };
            stopWebsiteHandlers(event);
            return;
          }
          pendingNewTabGesture = null;
        }
      }

      if (
        (settings.rightClickEnabled || settings.newTabLinksEnabled ||
          settings.linkAddressCopyEnabled) && event.button === RIGHT_BUTTON
      ) {
        stopWebsiteHandlers(event);
        return;
      }

      if (settings.middleClickEnabled && event.button === MIDDLE_BUTTON) {
        stopWebsiteHandlers(event);
        return;
      }

      const image = imageInPath(event);
      if (settings.imageDragEnabled && event.button === LEFT_BUTTON && image) {
        ensureUnlockStyle();
        prepareImageForDrag(image);
        stopWebsiteHandlers(event);
        return;
      }

      if (settings.textSelectionEnabled && eventStartsTextSelection(event)) {
        ensureUnlockStyle();
        activateTextSelectionStyle();
        prepareTextSelectionPath(event);
        if (event.type === "mousedown") beginTextGesture(event);
        stopWebsiteHandlers(event);
      }
      return;
    }

    if (event.type === "pointerup" || event.type === "mouseup") {
      if (
        pendingNewTabGesture &&
        event.button === pendingNewTabGesture.button &&
        Date.now() - pendingNewTabGesture.timestamp < 3000
      ) {
        stopWebsiteHandlers(event);
        return;
      }

      if (
        (settings.rightClickEnabled || settings.newTabLinksEnabled ||
          settings.linkAddressCopyEnabled) && event.button === RIGHT_BUTTON
      ) {
        stopWebsiteHandlers(event);
        return;
      }

      if (settings.middleClickEnabled && event.button === MIDDLE_BUTTON) {
        stopWebsiteHandlers(event);
        return;
      }

      if (event.button === LEFT_BUTTON && preparedImages.size > 0) {
        for (const image of [...preparedImages.keys()]) {
          schedulePreparedImageRestore(image);
        }
      }

      if (
        event.type === "mouseup" &&
        settings.textSelectionEnabled &&
        finishTextGesture(event)
      ) {
        stopWebsiteHandlers(event);
      }
      if (event.type === "mouseup" && settings.textSelectionEnabled) {
        deactivateTextSelectionStyle(0);
      }
    }
  }

  const runtimeMessages = globalThis.chrome?.runtime?.onMessage;
  if (runtimeMessages && typeof runtimeMessages.addListener === "function") {
    runtimeMessages.addListener((message, _sender, sendResponse) => {
      if (message?.type === MESSAGE_TYPES.GET_CONTEXT_LINK) {
        sendResponse({ ok: true, url: getRememberedContextLink() || "" });
        return false;
      }

      if (message?.type === MESSAGE_TYPES.COPY_LINK_ADDRESS) {
        const normalizedUrl = normalizeWebUrl(message.url, document.baseURI, true);
        const url = normalizedUrl;
        if (!url) {
          sendResponse({ ok: false, error: "복사할 링크 주소를 확인하지 못했습니다." });
          return false;
        }

        writeClipboardText(url)
          .then(() => {
            showToast("링크 주소를 복사했습니다.");
            sendResponse({ ok: true, url });
          })
          .catch((error) => {
            const messageText = String(error?.message || "링크 주소를 복사하지 못했습니다.");
            showToast(messageText, "error");
            sendResponse({ ok: false, error: messageText });
          });
        return true;
      }

      return false;
    });
  }

  removeLegacyVisitedLinkOverrides();

  const storageArea = globalThis.chrome?.storage?.local;
  if (storageArea && typeof storageArea.get === "function") {
    storageArea.get(DEFAULT_SETTINGS, (stored) => {
      if (globalThis.chrome?.runtime?.lastError) return;
      applySettings(stored);
    });
  } else {
    applySettings(DEFAULT_SETTINGS);
  }

  const storageChanged = globalThis.chrome?.storage?.onChanged;
  if (storageChanged && typeof storageChanged.addListener === "function") {
    storageChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes || typeof changes !== "object") return;

      const next = { ...settings };
      let changed = false;
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (!Object.prototype.hasOwnProperty.call(changes, key)) continue;
        next[key] = changes[key]?.newValue === true;
        changed = true;
      }

      if (changed) applySettings(next);
    });
  }

  window.addEventListener("pagehide", () => {
    restoreAllPreparedImages();
    deactivateTextSelectionStyle();
    if (eventListenersAttached) {
      for (const eventType of EVENT_TYPES) {
        window.removeEventListener(eventType, handleEvent, true);
      }
      eventListenersAttached = false;
    }
  }, { once: true });
})();
