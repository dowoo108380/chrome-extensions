"use strict";
(() => {
    "use strict";
    const DEFAULT_SETTINGS = Object.freeze({
        rightClickEnabled: false,
        textSelectionEnabled: false,
        imageDragEnabled: false,
        middleClickEnabled: false,
        copyUnlockEnabled: false,
        clipboardProtectionEnabled: false,
        backNavigationProtectionEnabled: false
    });
    const MESSAGE_TYPES = Object.freeze({
        APPLY_NAVIGATION_GUARD: "page-tools:apply-navigation-guard",
        REGISTER_NATIVE_LINK_ACTIVATION: "page-tools:register-native-link-activation"
    });
    const LEFT_BUTTON = 0;
    const MIDDLE_BUTTON = 1;
    const RIGHT_BUTTON = 2;
    const LEFT_BUTTONS_MASK = 1;
    const TEXT_DRAG_THRESHOLD_PX = 4;
    const AREA_SELECTOR_HOST_ID = "__drag_area_screenshot_host__";
    const ELEMENT_ERASER_HOST_ID = "__page_element_eraser_host__";
    const UNLOCK_STYLE_ID = "__chatgpt_browser_tools_unlock_style__";
    const TEXT_SELECTION_ACTIVE_CLASS = "__chatgpt_browser_tools_text_selection_active__";
    const LEGACY_VISITED_LINK_STYLE_ID = "__chatgpt_browser_tools_visited_link_style__";
    const LEGACY_VISITED_LINK_ATTRIBUTE = "data-chatgpt-browser-tools-visited-link";
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
    function createNavigationGuardToken() {
        const bytes = new Uint8Array(24);
        try {
            globalThis.crypto.getRandomValues(bytes);
        }
        catch {
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
    let eventListenersAttached = false;
    let lifecycleSuspended = false;
    let settingsEpoch = 0;
    let navigationGuardSettingsInitialized = false;
    let textSelectionDeactivateTimer = 0;
    const preparedImages = new Map();
    const preparedTextElements = new Map();
    function areaSelectorIsActive() {
        return Boolean(document.getElementById(AREA_SELECTOR_HOST_ID) ||
            document.getElementById(ELEMENT_ERASER_HOST_ID));
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
        }
        catch {
            // Legacy cleanup is best-effort only.
        }
    }
    function getEventPath(event) {
        if (typeof event.composedPath === "function") {
            const path = event.composedPath();
            if (Array.isArray(path) && path.length > 0)
                return path;
        }
        return event.target ? [event.target] : [];
    }
    function firstElementInPath(event) {
        return getEventPath(event).find((node) => node instanceof Element) || null;
    }
    function imageInPath(event) {
        return getEventPath(event).find((node) => node instanceof HTMLImageElement) || null;
    }
    function standardLinkInPath(event) {
        return getEventPath(event).find((node) => {
            if (!(node instanceof Element))
                return false;
            return node.localName === "a" || node.localName === "area";
        }) || null;
    }
    function getStandardHttpLinkUrl(event) {
        const link = standardLinkInPath(event);
        if (!link || link.hasAttribute("download"))
            return null;
        const rawHref = String(link.getAttribute("href") || "").trim();
        if (!rawHref)
            return null;
        try {
            const url = new URL(rawHref, document.baseURI);
            return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
        }
        catch {
            return null;
        }
    }
    function isMouseModifiedLeftLinkActivation(event, requireClickDetail = false) {
        if (event.button !== LEFT_BUTTON ||
            event.altKey ||
            event.shiftKey ||
            !(event.ctrlKey || event.metaKey)) {
            return false;
        }
        const pointerType = event instanceof PointerEvent ? event.pointerType : "";
        if (pointerType && pointerType !== "mouse")
            return false;
        if (requireClickDetail && (!Number.isFinite(event.detail) || event.detail <= 0))
            return false;
        return Boolean(getStandardHttpLinkUrl(event));
    }
    function isMouseMiddleLinkActivation(event) {
        if (event.button !== MIDDLE_BUTTON || event.altKey || event.shiftKey)
            return false;
        const pointerType = event instanceof PointerEvent ? event.pointerType : "";
        if (pointerType && pointerType !== "mouse")
            return false;
        return Boolean(getStandardHttpLinkUrl(event));
    }
    function stopWebsiteHandlers(event) {
        // The caller decides whether preventDefault() is needed. Stopping page handlers alone
        // keeps Chrome's ordinary browser action available.
        event.stopImmediatePropagation();
    }
    function activateTextSelectionStyle() {
        if (!settings.textSelectionEnabled)
            return;
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
        if (delay > 0)
            textSelectionDeactivateTimer = window.setTimeout(remove, delay);
        else
            remove();
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
        if (!(element instanceof HTMLElement || element instanceof SVGElement) || preparedTextElements.has(element))
            return;
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
            if (!(node instanceof Element) || seen.has(node))
                continue;
            seen.add(node);
            rememberTextElement(node);
        }
        let current = firstElementInPath(event);
        while (current && current.nodeType === Node.ELEMENT_NODE) {
            if (!seen.has(current))
                rememberTextElement(current);
            if (current === document.documentElement)
                break;
            current = current.parentElement;
        }
    }
    function restoreAllPreparedTextElements() {
        for (const [element, previous] of [...preparedTextElements.entries()]) {
            const currentUserSelect = element.style.getPropertyValue("user-select");
            const currentUserSelectPriority = element.style.getPropertyPriority("user-select");
            if (currentUserSelect === "text" && currentUserSelectPriority === "important") {
                if (previous.userSelectValue) {
                    element.style.setProperty("user-select", previous.userSelectValue, previous.userSelectPriority);
                }
                else {
                    element.style.removeProperty("user-select");
                }
            }
            const currentWebkitValue = element.style.getPropertyValue("-webkit-user-select");
            const currentWebkitPriority = element.style.getPropertyPriority("-webkit-user-select");
            if (currentWebkitValue === "text" && currentWebkitPriority === "important") {
                if (previous.webkitUserSelectValue) {
                    element.style.setProperty("-webkit-user-select", previous.webkitUserSelectValue, previous.webkitUserSelectPriority);
                }
                else {
                    element.style.removeProperty("-webkit-user-select");
                }
            }
            preparedTextElements.delete(element);
        }
    }
    function restorePreparedImage(image) {
        const previous = preparedImages.get(image);
        if (!previous)
            return;
        // A page may update the image during the gesture. Release only values
        // still owned by our preparation, as with text-selection restoration.
        if (image.getAttribute("draggable") === "true") {
            if (previous.draggableAttribute === null)
                image.removeAttribute("draggable");
            else
                image.setAttribute("draggable", previous.draggableAttribute);
        }
        if (image.style.getPropertyValue("-webkit-user-drag") === "auto" &&
            image.style.getPropertyPriority("-webkit-user-drag") === "important") {
            if (previous.userDragValue) {
                image.style.setProperty("-webkit-user-drag", previous.userDragValue, previous.userDragPriority);
            }
            else
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
        if (!image || image.localName !== "img")
            return;
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
        if (!image || !preparedImages.has(image))
            return;
        window.setTimeout(() => restorePreparedImage(image), 0);
    }
    function isInteractiveElement(element) {
        if (!element || typeof element.closest !== "function")
            return true;
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
    function textPositionAtPoint(event) {
        const x = Number(event.clientX);
        const y = Number(event.clientY);
        if (!Number.isFinite(x) || !Number.isFinite(y))
            return null;
        if (typeof document.caretPositionFromPoint === "function") {
            const position = document.caretPositionFromPoint(x, y);
            if (position?.offsetNode?.nodeType === Node.TEXT_NODE) {
                const node = position.offsetNode;
                return {
                    node,
                    offset: Math.max(0, Math.min(Number(position.offset) || 0, node.data.length))
                };
            }
        }
        if (typeof document.caretRangeFromPoint === "function") {
            const range = document.caretRangeFromPoint(x, y);
            if (range?.startContainer?.nodeType === Node.TEXT_NODE) {
                const node = range.startContainer;
                return {
                    node,
                    offset: Math.max(0, Math.min(Number(range.startOffset) || 0, node.data.length))
                };
            }
        }
        return null;
    }
    function textNodeAtPoint(event) {
        return textPositionAtPoint(event)?.node || null;
    }
    function eventStartsTextSelection(event) {
        if (event.button !== LEFT_BUTTON)
            return false;
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
        const target = getEventPath(event).find((node) => node instanceof Node && (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE));
        if (!target)
            return false;
        try {
            return selection.getRangeAt(0).intersectsNode(target);
        }
        catch {
            return false;
        }
    }
    function hasDocumentTextSelection() {
        const selection = globalThis.getSelection?.();
        return Boolean(selection && !selection.isCollapsed && selection.rangeCount > 0);
    }
    function hasCopyableSelection() {
        const active = document.activeElement;
        if (active &&
            (active.localName === "input" || active.localName === "textarea") &&
            Number.isInteger(active.selectionStart) &&
            Number.isInteger(active.selectionEnd) &&
            active.selectionStart !==
                active.selectionEnd) {
            return true;
        }
        return hasDocumentTextSelection();
    }
    function getSelectedPlainText() {
        const active = document.activeElement;
        const isSafeTextControl = Boolean(active &&
            (active.localName === "textarea" ||
                (active.localName === "input" &&
                    !["file", "password"].includes(String(active.type || "").toLowerCase()))));
        if (isSafeTextControl &&
            Number.isInteger(active.selectionStart) &&
            Number.isInteger(active.selectionEnd) &&
            active.selectionStart !==
                active.selectionEnd) {
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
        }
        catch {
            return false;
        }
    }
    function writeCleanSelectionToCopyEvent(event) {
        const selectedText = getSelectedPlainText();
        return selectedText !== null && writeTextToCopyEvent(event, selectedText);
    }
    function beginTextGesture(event) {
        const position = textPositionAtPoint(event);
        const previousGesture = textGesture;
        const gesture = {
            x: Number(event.clientX) || 0,
            y: Number(event.clientY) || 0,
            moved: false,
            pressDefaultPrevented: Boolean(previousGesture?.pressDefaultPrevented),
            startNode: position?.node || previousGesture?.startNode || null,
            startOffset: position?.offset ?? previousGesture?.startOffset ?? 0
        };
        textGesture = gesture;
        queueMicrotask(() => {
            if (textGesture === gesture && event.defaultPrevented) {
                gesture.pressDefaultPrevented = true;
            }
        });
    }
    function restorePreventedTextSelection(event) {
        if (!textGesture?.pressDefaultPrevented ||
            !textGesture.startNode ||
            textGesture.startNode.nodeType !== Node.TEXT_NODE) {
            return false;
        }
        const current = textPositionAtPoint(event);
        const selection = globalThis.getSelection?.();
        if (!current || !selection || typeof selection.setBaseAndExtent !== "function") {
            return false;
        }
        try {
            selection.setBaseAndExtent(textGesture.startNode, textGesture.startOffset, current.node, current.offset);
            return !selection.isCollapsed;
        }
        catch {
            return false;
        }
    }
    function updateTextGesture(event) {
        if (!textGesture || !(event.buttons & LEFT_BUTTONS_MASK))
            return false;
        if (Math.abs((Number(event.clientX) || 0) - textGesture.x) >= TEXT_DRAG_THRESHOLD_PX ||
            Math.abs((Number(event.clientY) || 0) - textGesture.y) >= TEXT_DRAG_THRESHOLD_PX) {
            textGesture.moved = true;
            restorePreventedTextSelection(event);
        }
        return textGesture.moved;
    }
    function finishTextGesture(event) {
        if (!textGesture || event.button !== LEFT_BUTTON)
            return false;
        const moved = textGesture.moved;
        textGesture = null;
        if (!moved || !hasDocumentTextSelection())
            return false;
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
    function registerNativeLinkActivation(url, inputKind) {
        const runtime = globalThis.chrome?.runtime;
        if (!runtime || typeof runtime.sendMessage !== "function")
            return;
        try {
            runtime.sendMessage({
                type: MESSAGE_TYPES.REGISTER_NATIVE_LINK_ACTIVATION,
                url,
                inputKind
            }, () => {
                void runtimeErrorMessage();
            });
        }
        catch {
            // Chrome's native link activation still proceeds even if the service worker
            // cannot record this gesture for post-creation tab placement.
        }
    }
    function runtimeErrorMessage() {
        return globalThis.chrome?.runtime?.lastError?.message || "";
    }
    function syncNavigationGuardSettings() {
        const runtime = globalThis.chrome?.runtime;
        if (!runtime || typeof runtime.sendMessage !== "function")
            return;
        try {
            runtime.sendMessage({
                type: MESSAGE_TYPES.APPLY_NAVIGATION_GUARD,
                guardToken: NAVIGATION_GUARD_TOKEN
            }, () => {
                void runtimeErrorMessage();
            });
        }
        catch {
            // The remaining page tools continue to work if MAIN-world injection is unavailable.
        }
    }
    function pageEventFeaturesEnabled() {
        return Boolean(settings.rightClickEnabled ||
            settings.textSelectionEnabled ||
            settings.imageDragEnabled ||
            settings.middleClickEnabled ||
            settings.copyUnlockEnabled ||
            settings.clipboardProtectionEnabled);
    }
    function updateEventListeners() {
        const shouldAttach = !lifecycleSuspended && pageEventFeaturesEnabled();
        if (shouldAttach === eventListenersAttached)
            return;
        for (const eventType of EVENT_TYPES) {
            if (shouldAttach)
                window.addEventListener(eventType, handleEvent, true);
            else
                window.removeEventListener(eventType, handleEvent, true);
        }
        if (shouldAttach)
            document.addEventListener("selectionchange", handleEvent, true);
        else
            document.removeEventListener("selectionchange", handleEvent, true);
        eventListenersAttached = shouldAttach;
    }
    function applySettings(values) {
        const previousImageDragEnabled = settings.imageDragEnabled;
        const previousBackNavigationProtectionEnabled = settings.backNavigationProtectionEnabled;
        const source = values && typeof values === "object" ? values : {};
        const nextSettings = { ...DEFAULT_SETTINGS };
        for (const key of Object.keys(DEFAULT_SETTINGS)) {
            let value = typeof source[key] === "boolean"
                ? source[key]
                : DEFAULT_SETTINGS[key];
            // Version 1.11 tied ordinary copy protection to text selection.
            // Keep that behavior for existing settings that do not have the new key yet.
            if (key === "copyUnlockEnabled" &&
                !Object.prototype.hasOwnProperty.call(source, key) &&
                source.textSelectionEnabled === true) {
                value = true;
            }
            nextSettings[key] = value;
        }
        settings = nextSettings;
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
        const shouldSyncNavigationGuard = navigationGuardSettingsInitialized
            ? previousBackNavigationProtectionEnabled !== settings.backNavigationProtectionEnabled
            : settings.backNavigationProtectionEnabled;
        navigationGuardSettingsInitialized = true;
        ensureUnlockStyle();
        updateEventListeners();
        if (shouldSyncNavigationGuard) {
            syncNavigationGuardSettings();
        }
    }
    function handleEvent(event) {
        if (event.type === "selectionchange") {
            if (settings.textSelectionEnabled &&
                !textGesture &&
                !hasDocumentTextSelection()) {
                deactivateTextSelectionStyle();
            }
            return;
        }
        if (!event.isTrusted)
            return;
        if (areaSelectorIsActive())
            return;
        if (event.type === "contextmenu") {
            if (settings.rightClickEnabled) {
                stopWebsiteHandlers(event);
            }
            return;
        }
        if (event.type === "keydown" || event.type === "keyup") {
            if (!(event instanceof KeyboardEvent))
                return;
            const copyFeatureEnabled = settings.copyUnlockEnabled || settings.clipboardProtectionEnabled;
            const isCopyShortcut = copyFeatureEnabled &&
                !event.altKey &&
                (event.ctrlKey || event.metaKey) &&
                String(event.key || "").toLowerCase() === "c" &&
                hasCopyableSelection();
            if (isCopyShortcut)
                stopWebsiteHandlers(event);
            return;
        }
        if (event.type === "beforecopy") {
            if ((settings.copyUnlockEnabled || settings.clipboardProtectionEnabled) &&
                hasCopyableSelection()) {
                stopWebsiteHandlers(event);
            }
            return;
        }
        if (event.type === "copy") {
            if (!(event instanceof ClipboardEvent))
                return;
            if ((settings.copyUnlockEnabled || settings.clipboardProtectionEnabled) &&
                hasCopyableSelection()) {
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
        if (!(event instanceof MouseEvent))
            return;
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
                window.setTimeout(() => {
                    if (!hasDocumentTextSelection())
                        deactivateTextSelectionStyle();
                }, 120);
                stopWebsiteHandlers(event);
            }
            return;
        }
        if (event.type === "click") {
            if (settings.middleClickEnabled &&
                isMouseModifiedLeftLinkActivation(event, true)) {
                // Keep Chrome's default Ctrl/Command+click activation intact. Stopping
                // website handlers is enough to prevent a page from cancelling it.
                stopWebsiteHandlers(event);
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
            if (settings.middleClickEnabled &&
                isMouseMiddleLinkActivation(event)) {
                // Keep Chrome's native middle-click activation so navigation, history,
                // referrer handling and :visited state remain browser-owned.
                stopWebsiteHandlers(event);
                return;
            }
            if ((settings.middleClickEnabled && event.button === MIDDLE_BUTTON) ||
                (settings.rightClickEnabled && event.button === RIGHT_BUTTON)) {
                stopWebsiteHandlers(event);
            }
            return;
        }
        if (event.type === "pointercancel") {
            textGesture = null;
            restoreAllPreparedImages();
            deactivateTextSelectionStyle();
            return;
        }
        if (event.type === "pointerdown" || event.type === "mousedown") {
            if (settings.rightClickEnabled && event.button === RIGHT_BUTTON) {
                stopWebsiteHandlers(event);
                return;
            }
            if (settings.middleClickEnabled && event.button === MIDDLE_BUTTON) {
                if (event.type === "mousedown") {
                    const url = getStandardHttpLinkUrl(event);
                    if (url)
                        registerNativeLinkActivation(url, "middle");
                }
                stopWebsiteHandlers(event);
                return;
            }
            if (settings.middleClickEnabled &&
                isMouseModifiedLeftLinkActivation(event)) {
                if (event.type === "mousedown") {
                    const url = getStandardHttpLinkUrl(event);
                    if (url)
                        registerNativeLinkActivation(url, "modifier");
                }
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
                beginTextGesture(event);
                // Prepare the browser's native selection before its default action, but do not
                // consume the initial press. Web applications can implement real controls with
                // non-semantic text containers and may need pointerdown or mousedown to open a
                // menu, activate a file input, or complete another user-initiated action.
            }
            return;
        }
        if (event.type === "pointerup" || event.type === "mouseup") {
            if (settings.rightClickEnabled && event.button === RIGHT_BUTTON) {
                stopWebsiteHandlers(event);
                return;
            }
            if (settings.middleClickEnabled && event.button === MIDDLE_BUTTON) {
                stopWebsiteHandlers(event);
                return;
            }
            if (settings.middleClickEnabled &&
                isMouseModifiedLeftLinkActivation(event)) {
                stopWebsiteHandlers(event);
                return;
            }
            if (event.button === LEFT_BUTTON && preparedImages.size > 0) {
                for (const image of [...preparedImages.keys()]) {
                    schedulePreparedImageRestore(image);
                }
            }
            if (event.type === "mouseup" &&
                settings.textSelectionEnabled &&
                finishTextGesture(event)) {
                stopWebsiteHandlers(event);
            }
            if (event.type === "mouseup" &&
                settings.textSelectionEnabled &&
                !hasDocumentTextSelection()) {
                deactivateTextSelectionStyle(0);
            }
        }
    }
    removeLegacyVisitedLinkOverrides();
    function reloadSettings() {
        const epoch = ++settingsEpoch;
        const storageArea = globalThis.chrome?.storage?.local;
        if (storageArea && typeof storageArea.get === "function") {
            storageArea.get(DEFAULT_SETTINGS, (stored) => {
                if (globalThis.chrome?.runtime?.lastError || lifecycleSuspended || epoch !== settingsEpoch)
                    return;
                applySettings(stored);
            });
        }
        else if (!lifecycleSuspended)
            applySettings(DEFAULT_SETTINGS);
    }
    reloadSettings();
    const storageChanged = globalThis.chrome?.storage?.onChanged;
    if (storageChanged && typeof storageChanged.addListener === "function") {
        storageChanged.addListener((changes, areaName) => {
            if (areaName !== "local" || !changes || typeof changes !== "object")
                return;
            if (!Object.keys(changes).some(key => Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)))
                return;
            if (lifecycleSuspended) {
                settingsEpoch++;
                return;
            }
            // Read the whole effective snapshot; a partial change must not cancel initial defaults.
            reloadSettings();
            return;
        });
    }
    window.addEventListener("pagehide", () => {
        lifecycleSuspended = true;
        settingsEpoch++;
        restoreAllPreparedImages();
        deactivateTextSelectionStyle();
        if (eventListenersAttached) {
            for (const eventType of EVENT_TYPES) {
                window.removeEventListener(eventType, handleEvent, true);
            }
            document.removeEventListener("selectionchange", handleEvent, true);
            eventListenersAttached = false;
        }
    });
    window.addEventListener("pageshow", event => {
        if (!event.persisted)
            return;
        lifecycleSuspended = false;
        navigationGuardSettingsInitialized = false;
        reloadSettings();
    });
})();
