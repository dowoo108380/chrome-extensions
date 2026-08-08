(() => {
  "use strict";

  const CHAT_WIDTH_STORAGE_KEY = "chatConversationWidthPx";
  const COMPOSER_WIDTH_STORAGE_KEY = "chatComposerWidthPx";
  const CHAT_WIDTH_STYLE_ID = "chatgpt-ctrl-enter-conversation-width";
  const COMPOSER_WIDTH_STYLE_ID = "chatgpt-ctrl-enter-composer-width";
  const CHAT_WIDTH_DEFAULT_PX = 960;
  const COMPOSER_WIDTH_DEFAULT_PX = 0;
  const CHAT_WIDTH_MIN_PX = 640;
  const CHAT_WIDTH_MAX_PX = 2000;
  const CHAT_WIDTH_STEP_PX = 40;

  const DEFAULT_SHORTCUT_SETTINGS = Object.freeze({
    composerCtrlEnterEnabled: true,
    messageEditCtrlEnterEnabled: true
  });

  const STORAGE_DEFAULTS = Object.freeze({
    ...DEFAULT_SHORTCUT_SETTINGS,
    [CHAT_WIDTH_STORAGE_KEY]: CHAT_WIDTH_DEFAULT_PX,
    [COMPOSER_WIDTH_STORAGE_KEY]: COMPOSER_WIDTH_DEFAULT_PX
  });

  let shortcutSettings = { ...DEFAULT_SHORTCUT_SETTINGS };
  let shortcutSettingsReady = !(
    globalThis.chrome?.storage?.local &&
    typeof globalThis.chrome.storage.local.get === "function"
  );
  let chatConversationWidthPx = CHAT_WIDTH_DEFAULT_PX;
  let chatComposerWidthPx = COMPOSER_WIDTH_DEFAULT_PX;
  let shortcutKeyListenerAttached = false;

  function normalizeWidthPx(value, fallbackPx) {
    const numericValue = Number(value);
    if (numericValue === 0) {
      return 0;
    }

    if (!Number.isFinite(numericValue)) {
      return fallbackPx;
    }

    const steppedValue = Math.round(numericValue / CHAT_WIDTH_STEP_PX) * CHAT_WIDTH_STEP_PX;
    return Math.min(CHAT_WIDTH_MAX_PX, Math.max(CHAT_WIDTH_MIN_PX, steppedValue));
  }

  function normalizeChatWidthPx(value) {
    return normalizeWidthPx(value, CHAT_WIDTH_DEFAULT_PX);
  }

  function normalizeComposerWidthPx(value) {
    return normalizeWidthPx(value, COMPOSER_WIDTH_DEFAULT_PX);
  }

  function buildChatWidthCss(widthPx) {
    const width = `${widthPx}px`;
    return `
:root {
  --chatgpt-extension-conversation-width: ${width};
  --chatgpt-extension-conversation-safe-width: min(
    var(--chatgpt-extension-conversation-width),
    calc(100vw - 32px)
  );
}

:is(
  article[data-testid^="conversation-turn-"],
  [data-testid^="conversation-turn-"],
  [data-turn],
  [data-scroll-anchor],
  [class*="group/turn-messages"]
) {
  --thread-content-max-width: var(--chatgpt-extension-conversation-safe-width) !important;
}

:is(
  article[data-testid^="conversation-turn-"],
  [data-testid^="conversation-turn-"],
  [data-turn],
  [data-scroll-anchor],
  [class*="group/turn-messages"]
) :is(
  [class*="[--thread-content-max-width:"],
  [class*="max-w-(--thread-content-max-width)"],
  [class*="max-w-[var(--thread-content-max-width)]"],
  [style*="--thread-content-max-width"],
  [class~="md:max-w-3xl"],
  [class~="lg:max-w-[40rem]"],
  [class~="xl:max-w-[48rem]"]
) {
  --thread-content-max-width: var(--chatgpt-extension-conversation-safe-width) !important;
  max-width: var(--chatgpt-extension-conversation-safe-width) !important;
}

:is(
  article[data-testid^="conversation-turn-"],
  [data-testid^="conversation-turn-"],
  [data-turn],
  [data-scroll-anchor]
) .markdown.prose {
  max-width: 100% !important;
}

@media (max-width: 719px) {
  :root {
    --chatgpt-extension-conversation-safe-width: min(
      var(--chatgpt-extension-conversation-width),
      calc(100vw - 16px)
    );
  }
}
`;
  }

  function applyChatConversationWidth(value) {
    chatConversationWidthPx = normalizeChatWidthPx(value);
    const existingStyle = document.getElementById(CHAT_WIDTH_STYLE_ID);

    if (chatConversationWidthPx === 0) {
      existingStyle?.remove();
      document.documentElement?.removeAttribute("data-chatgpt-extension-conversation-width");
      return;
    }

    const host = document.head || document.documentElement;
    if (!host) {
      document.addEventListener(
        "readystatechange",
        () => applyChatConversationWidth(chatConversationWidthPx),
        { once: true }
      );
      return;
    }

    const style = existingStyle || document.createElement("style");
    style.id = CHAT_WIDTH_STYLE_ID;
    style.textContent = buildChatWidthCss(chatConversationWidthPx);
    if (!style.isConnected) {
      host.appendChild(style);
    }

    document.documentElement?.setAttribute(
      "data-chatgpt-extension-conversation-width",
      String(chatConversationWidthPx)
    );
  }

  function buildComposerWidthCss(widthPx) {
    const width = `${widthPx}px`;
    return `
:root {
  --chatgpt-extension-composer-width: ${width};
  --chatgpt-extension-composer-safe-width: min(
    var(--chatgpt-extension-composer-width),
    calc(100vw - 32px)
  );
}

#thread-bottom-container {
  --thread-content-max-width: var(--chatgpt-extension-composer-safe-width) !important;
  --composer-max-width: var(--chatgpt-extension-composer-safe-width) !important;
  width: 100% !important;
  max-width: 100% !important;
}

#thread-bottom-container :is(div, form):has(
  [data-type="unified-composer"],
  [data-testid="composer"],
  [data-testid="composer-container"]
),
#thread-bottom-container :is(
  [data-type="unified-composer"],
  [data-testid="composer"],
  [data-testid="composer-container"]
) {
  --thread-content-max-width: var(--chatgpt-extension-composer-safe-width) !important;
  --composer-max-width: var(--chatgpt-extension-composer-safe-width) !important;
  width: 100% !important;
  max-width: var(--chatgpt-extension-composer-safe-width) !important;
  margin-inline: auto !important;
  box-sizing: border-box !important;
}

#thread-bottom-container :is(
  [class*="[--thread-content-max-width:"],
  [class*="max-w-(--thread-content-max-width)"],
  [class*="max-w-[var(--thread-content-max-width)]"],
  [class*="max-w-[var(--composer-max-width)]"],
  [style*="--thread-content-max-width"],
  [style*="--composer-max-width"]
) {
  --thread-content-max-width: var(--chatgpt-extension-composer-safe-width) !important;
  --composer-max-width: var(--chatgpt-extension-composer-safe-width) !important;
  max-width: var(--chatgpt-extension-composer-safe-width) !important;
}

@media (max-width: 719px) {
  :root {
    --chatgpt-extension-composer-safe-width: min(
      var(--chatgpt-extension-composer-width),
      calc(100vw - 16px)
    );
  }
}
`;
  }

  function applyChatComposerWidth(value) {
    chatComposerWidthPx = normalizeComposerWidthPx(value);
    const existingStyle = document.getElementById(COMPOSER_WIDTH_STYLE_ID);

    if (chatComposerWidthPx === 0) {
      existingStyle?.remove();
      document.documentElement?.removeAttribute("data-chatgpt-extension-composer-width");
      return;
    }

    const host = document.head || document.documentElement;
    if (!host) {
      document.addEventListener(
        "readystatechange",
        () => applyChatComposerWidth(chatComposerWidthPx),
        { once: true }
      );
      return;
    }

    const style = existingStyle || document.createElement("style");
    style.id = COMPOSER_WIDTH_STYLE_ID;
    style.textContent = buildComposerWidthCss(chatComposerWidthPx);
    if (!style.isConnected) {
      host.appendChild(style);
    }

    document.documentElement?.setAttribute(
      "data-chatgpt-extension-composer-width",
      String(chatComposerWidthPx)
    );
  }

  function applyShortcutSettings(storedSettings) {
    const values = storedSettings && typeof storedSettings === "object"
      ? storedSettings
      : {};

    shortcutSettings = {
      composerCtrlEnterEnabled:
        typeof values.composerCtrlEnterEnabled === "boolean"
          ? values.composerCtrlEnterEnabled
          : DEFAULT_SHORTCUT_SETTINGS.composerCtrlEnterEnabled,
      messageEditCtrlEnterEnabled:
        typeof values.messageEditCtrlEnterEnabled === "boolean"
          ? values.messageEditCtrlEnterEnabled
          : DEFAULT_SHORTCUT_SETTINGS.messageEditCtrlEnterEnabled
    };

    applyChatConversationWidth(
      Object.prototype.hasOwnProperty.call(values, CHAT_WIDTH_STORAGE_KEY)
        ? values[CHAT_WIDTH_STORAGE_KEY]
        : CHAT_WIDTH_DEFAULT_PX
    );
    applyChatComposerWidth(
      Object.prototype.hasOwnProperty.call(values, COMPOSER_WIDTH_STORAGE_KEY)
        ? values[COMPOSER_WIDTH_STORAGE_KEY]
        : COMPOSER_WIDTH_DEFAULT_PX
    );
  }

  function loadShortcutSettings() {
    const storageArea = globalThis.chrome?.storage?.local;
    if (!storageArea || typeof storageArea.get !== "function") {
      applyChatConversationWidth(CHAT_WIDTH_DEFAULT_PX);
      applyChatComposerWidth(COMPOSER_WIDTH_DEFAULT_PX);
      shortcutSettingsReady = true;
      updateShortcutKeyListener();
      return;
    }

    try {
      storageArea.get(STORAGE_DEFAULTS, (storedSettings) => {
        if (globalThis.chrome?.runtime?.lastError) {
          applyChatConversationWidth(CHAT_WIDTH_DEFAULT_PX);
          applyChatComposerWidth(COMPOSER_WIDTH_DEFAULT_PX);
          shortcutSettingsReady = true;
          updateShortcutKeyListener();
          return;
        }

        applyShortcutSettings(storedSettings);
        shortcutSettingsReady = true;
        updateShortcutKeyListener();
      });
    } catch {
      applyChatConversationWidth(CHAT_WIDTH_DEFAULT_PX);
      applyChatComposerWidth(COMPOSER_WIDTH_DEFAULT_PX);
      shortcutSettingsReady = true;
      updateShortcutKeyListener();
      // Keep the backward-compatible defaults if Chrome storage is unavailable.
    }
  }

  function observeShortcutSettings() {
    const storageChanged = globalThis.chrome?.storage?.onChanged;
    if (!storageChanged || typeof storageChanged.addListener !== "function") {
      return;
    }

    storageChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes || typeof changes !== "object") {
        return;
      }

      const nextSettings = { ...shortcutSettings };
      let didChange = false;

      for (const key of Object.keys(DEFAULT_SHORTCUT_SETTINGS)) {
        if (!Object.prototype.hasOwnProperty.call(changes, key)) {
          continue;
        }

        const newValue = changes[key]?.newValue;
        nextSettings[key] =
          typeof newValue === "boolean"
            ? newValue
            : DEFAULT_SHORTCUT_SETTINGS[key];
        didChange = true;
      }

      if (Object.prototype.hasOwnProperty.call(changes, CHAT_WIDTH_STORAGE_KEY)) {
        const newWidth = changes[CHAT_WIDTH_STORAGE_KEY]?.newValue;
        applyChatConversationWidth(
          typeof newWidth === "number" ? newWidth : CHAT_WIDTH_DEFAULT_PX
        );
      }

      if (Object.prototype.hasOwnProperty.call(changes, COMPOSER_WIDTH_STORAGE_KEY)) {
        const newWidth = changes[COMPOSER_WIDTH_STORAGE_KEY]?.newValue;
        applyChatComposerWidth(
          typeof newWidth === "number" ? newWidth : COMPOSER_WIDTH_DEFAULT_PX
        );
      }

      if (didChange) {
        shortcutSettings = nextSettings;
        shortcutSettingsReady = true;
        updateShortcutKeyListener();
      }
    });
  }

  function isShortcutEnabledForContext(context) {
    if (!shortcutSettingsReady) {
      return false;
    }

    return context.kind === "message-edit"
      ? shortcutSettings.messageEditCtrlEnterEnabled
      : shortcutSettings.composerCtrlEnterEnabled;
  }

  const EDITOR_SELECTOR = [
    "textarea",
    "[contenteditable]:not([contenteditable='false'])",
    "[role='textbox'][aria-multiline='true']"
  ].join(",");

  const KNOWN_COMPOSER_EDITOR_SELECTOR = [
    "#prompt-textarea",
    "[data-testid='prompt-textarea']",
    "[data-testid='composer-text-input']",
    "textarea[data-id='root']"
  ].join(",");

  const COMPOSER_ROOT_SELECTOR = [
    "[data-type='unified-composer']",
    "[data-testid='composer']",
    "[data-testid*='composer']",
    "#thread-bottom-container"
  ].join(",");

  const MESSAGE_TURN_SELECTOR = [
    "article[data-testid^='conversation-turn-']",
    "[data-testid^='conversation-turn-']",
    "[data-turn]",
    "[class~='group/conversation-turn']"
  ].join(",");

  const USER_MESSAGE_SELECTOR = [
    "[data-message-author-role='user']",
    "[data-turn='user']"
  ].join(",");

  const COMPOSER_SEND_BUTTON_SELECTORS = [
    "button[data-testid='send-button']",
    "button[data-testid='composer-submit-button']",
    "button#composer-submit-button",
    "button[aria-label='Send prompt']",
    "button[aria-label='Send message']",
    "button[aria-label='메시지 보내기']",
    "button[aria-label='메시지 전송']",
    "button[aria-label*='Send' i]",
    "button[aria-label*='보내기']",
    "button[aria-label*='전송']"
  ];

  const EDIT_SUBMIT_BUTTON_SELECTORS = [
    "button[data-testid='edit-message-submit-button']",
    "button[data-testid='message-edit-submit-button']",
    "button[data-testid='save-message-button']",
    "button[data-testid='send-button']",
    "button[data-testid*='edit'][data-testid*='submit']",
    "button[data-testid*='message'][data-testid*='submit']",
    "button[data-testid*='submit']",
    "button[data-testid*='send']",
    "button.btn-primary",
    "button[class~='btn-primary']",
    "button[type='submit']",
    "button[aria-label*='Send' i]",
    "button[aria-label*='Submit' i]",
    "button[aria-label*='Save' i]",
    "button[aria-label*='Update' i]",
    "button[aria-label*='Confirm' i]",
    "button[aria-label*='보내기']",
    "button[aria-label*='전송']",
    "button[aria-label*='제출']",
    "button[aria-label*='저장']",
    "button[aria-label*='완료']",
    "button[aria-label*='확인']"
  ];

  const BLOCKED_ACTION_WORDS = [
    "stop",
    "cancel",
    "discard",
    "close",
    "delete",
    "abort",
    "go back",
    "중지",
    "취소",
    "버리기",
    "닫기",
    "삭제",
    "뒤로"
  ];

  const EDIT_ACTION_WORDS = [
    "send",
    "submit",
    "save",
    "update",
    "confirm",
    "apply",
    "done",
    "보내기",
    "전송",
    "제출",
    "저장",
    "완료",
    "확인",
    "적용"
  ];

  const NON_SUBMIT_ACTION_WORDS = [
    "copy",
    "edit message",
    "retry",
    "regenerate",
    "more",
    "read aloud",
    "thumb",
    "branch",
    "복사",
    "메시지 수정",
    "다시 생성",
    "더 보기",
    "소리 내어 읽기",
    "좋아요",
    "싫어요",
    "분기"
  ];

  let replayingKeyboardEvent = false;

  function normalizeText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function containsAnyWord(text, words) {
    return words.some((word) => text.includes(word));
  }

  function getButtonDescription(button) {
    return normalizeText(
      [
        button.id,
        button.name,
        button.value,
        button.getAttribute("data-testid"),
        button.getAttribute("aria-label"),
        button.getAttribute("title"),
        button.textContent
      ]
        .filter(Boolean)
        .join(" ")
    );
  }

  function isExactCtrlEnter(event) {
    const isEnter =
      event.key === "Enter" ||
      event.code === "Enter" ||
      event.code === "NumpadEnter";

    return (
      isEnter &&
      event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.shiftKey &&
      !event.repeat
    );
  }

  function findEditorFromEvent(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];

    for (const node of path) {
      if (!(node instanceof Element)) {
        continue;
      }

      if (node.matches(EDITOR_SELECTOR)) {
        return node;
      }

      const editor = node.closest(EDITOR_SELECTOR);
      if (editor) {
        return editor;
      }
    }

    const target = event.target;
    return target instanceof Element ? target.closest(EDITOR_SELECTOR) : null;
  }

  function isWritableEditor(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    if (element.matches(":disabled, [aria-disabled='true'], [contenteditable='false']")) {
      return false;
    }

    if (element instanceof HTMLTextAreaElement) {
      return !element.readOnly;
    }

    return (
      element.isContentEditable ||
      element.getAttribute("contenteditable") === "plaintext-only" ||
      element.matches("[role='textbox'][aria-multiline='true']")
    );
  }

  function isUsableButton(button) {
    if (!(button instanceof HTMLButtonElement)) {
      return false;
    }

    return !(
      button.disabled ||
      button.hidden ||
      button.getAttribute("aria-disabled") === "true" ||
      button.getAttribute("aria-hidden") === "true"
    );
  }

  function isBlockedActionButton(button) {
    return containsAnyWord(getButtonDescription(button), BLOCKED_ACTION_WORDS);
  }

  function isUsableSubmitButton(button) {
    return isUsableButton(button) && !isBlockedActionButton(button);
  }

  function findButtonBySelectors(scope, selectors) {
    if (!(scope instanceof Document || scope instanceof Element)) {
      return null;
    }

    for (const selector of selectors) {
      for (const button of scope.querySelectorAll(selector)) {
        if (isUsableSubmitButton(button)) {
          return button;
        }
      }
    }

    return null;
  }

  function isInsideConversationTurn(element) {
    return Boolean(
      element.closest(MESSAGE_TURN_SELECTOR) ||
      element.closest("[data-message-author-role='user']")
    );
  }

  function findComposerSendButton(scope) {
    if (!(scope instanceof Document || scope instanceof Element)) {
      return null;
    }

    for (const selector of COMPOSER_SEND_BUTTON_SELECTORS) {
      for (const button of scope.querySelectorAll(selector)) {
        if (isUsableSubmitButton(button) && !isInsideConversationTurn(button)) {
          return button;
        }
      }
    }

    return null;
  }

  function findGenericSubmitButton(form) {
    if (!(form instanceof HTMLFormElement)) {
      return null;
    }

    for (const button of form.querySelectorAll("button[type='submit']")) {
      if (isUsableSubmitButton(button)) {
        return button;
      }
    }

    return null;
  }

  function isUserConversationTurn(turn, editor) {
    if (!(turn instanceof Element)) {
      return false;
    }

    if (normalizeText(turn.getAttribute("data-turn")) === "user") {
      return true;
    }

    if (editor.closest("[data-message-author-role='user']")) {
      return true;
    }

    return Boolean(turn.querySelector("[data-message-author-role='user']"));
  }

  function getUserMessageTurn(editor) {
    // Current ChatGPT versions mark the outer turn itself with data-turn="user".
    // During editing, the usual data-message-author-role element can disappear,
    // so the outer turn must be recognized independently.
    const explicitUserTurn = editor.closest("[data-turn='user']");
    if (explicitUserTurn) {
      const testIdTurn = explicitUserTurn.closest(
        "article[data-testid^='conversation-turn-'], " +
          "[data-testid^='conversation-turn-']"
      );
      if (testIdTurn) {
        return testIdTurn;
      }

      return (
        explicitUserTurn.closest("[class~='group/conversation-turn']") ||
        explicitUserTurn
      );
    }

    const turn = editor.closest(MESSAGE_TURN_SELECTOR);
    if (turn && isUserConversationTurn(turn, editor)) {
      return turn;
    }

    const userMessage = editor.closest("[data-message-author-role='user']");
    if (userMessage) {
      return userMessage.closest(MESSAGE_TURN_SELECTOR) || userMessage;
    }

    return null;
  }

  function getEditActionScopes(editor, messageTurn) {
    const scopes = [];
    const seen = new Set();

    const addScope = (scope) => {
      if (
        scope &&
        !seen.has(scope) &&
        (scope === messageTurn || messageTurn.contains(scope))
      ) {
        seen.add(scope);
        scopes.push(scope);
      }
    };

    addScope(editor.closest("form"));

    let ancestor = editor.parentElement;
    for (let depth = 0; ancestor && depth < 12; depth += 1) {
      addScope(ancestor);
      if (ancestor === messageTurn) {
        break;
      }
      ancestor = ancestor.parentElement;
    }

    addScope(messageTurn);
    return scopes;
  }

  function isPositiveEditAction(button) {
    const description = getButtonDescription(button);
    return (
      containsAnyWord(description, EDIT_ACTION_WORDS) &&
      !containsAnyWord(description, BLOCKED_ACTION_WORDS)
    );
  }

  function isClearlyNonSubmitAction(button) {
    const description = getButtonDescription(button);
    return containsAnyWord(description, NON_SUBMIT_ACTION_WORDS);
  }

  function findStructuralEditSubmitButton(scope, editor) {
    const usableButtons = Array.from(scope.querySelectorAll("button")).filter(isUsableButton);
    const cancelButtons = usableButtons.filter(isBlockedActionButton);

    // Prefer a primary-styled button when the edit interface exposes one.
    const primaryButtons = usableButtons.filter((button) => {
      const description = getButtonDescription(button);
      return (
        !isBlockedActionButton(button) &&
        !isClearlyNonSubmitAction(button) &&
        (button.classList.contains("btn-primary") || description.includes("btn-primary"))
      );
    });

    if (primaryButtons.length === 1) {
      return primaryButtons[0];
    }

    // A compact group containing Cancel and one other action is the standard
    // shape of the message editor, including icon-only variants.
    if (usableButtons.length >= 2 && usableButtons.length <= 5 && cancelButtons.length >= 1) {
      const plausibleActions = usableButtons.filter(
        (button) =>
          !isBlockedActionButton(button) &&
          !isClearlyNonSubmitAction(button)
      );

      if (plausibleActions.length === 1) {
        return plausibleActions[0];
      }
    }

    // Find the smallest shared container around the editor and a Cancel button.
    // This avoids unrelated Copy/Edit controls elsewhere in the message turn.
    for (const cancelButton of cancelButtons) {
      let container = cancelButton.parentElement;
      for (let depth = 0; container && depth < 6; depth += 1) {
        if (container.contains(editor)) {
          const localButtons = Array.from(container.querySelectorAll("button")).filter(
            isUsableButton
          );
          const localCandidates = localButtons.filter(
            (button) =>
              !isBlockedActionButton(button) &&
              !isClearlyNonSubmitAction(button)
          );

          if (localCandidates.length === 1) {
            return localCandidates[0];
          }
        }

        if (container === scope) {
          break;
        }
        container = container.parentElement;
      }
    }

    return null;
  }

  function findEditSubmitButtonInScope(scope, editor) {
    const specificallyIdentifiedButton = findButtonBySelectors(
      scope,
      EDIT_SUBMIT_BUTTON_SELECTORS
    );
    if (specificallyIdentifiedButton) {
      return specificallyIdentifiedButton;
    }

    if (scope instanceof HTMLFormElement) {
      const genericSubmitButton = findGenericSubmitButton(scope);
      if (genericSubmitButton) {
        return genericSubmitButton;
      }
    }

    const usableButtons = Array.from(scope.querySelectorAll("button")).filter(isUsableButton);
    for (const button of usableButtons) {
      if (isPositiveEditAction(button)) {
        return button;
      }
    }

    return findStructuralEditSubmitButton(scope, editor);
  }

  function findEditSubmitButton(editor, messageTurn) {
    for (const scope of getEditActionScopes(editor, messageTurn)) {
      const button = findEditSubmitButtonInScope(scope, editor);
      if (button) {
        return button;
      }
    }

    return null;
  }

  function getEditorContext(event) {
    const editor = findEditorFromEvent(event);
    if (!isWritableEditor(editor)) {
      return null;
    }

    // Check an edited conversation turn before checking composer identifiers.
    // Some interface revisions reuse editor attributes in more than one place.
    const messageTurn = getUserMessageTurn(editor);
    if (messageTurn) {
      return {
        kind: "message-edit",
        editor,
        messageTurn
      };
    }

    if (editor.matches(KNOWN_COMPOSER_EDITOR_SELECTOR)) {
      return {
        kind: "composer",
        editor
      };
    }

    const explicitComposerRoot = editor.closest(COMPOSER_ROOT_SELECTOR);
    if (explicitComposerRoot) {
      return {
        kind: "composer",
        editor
      };
    }

    // Generic editors are accepted as the composer only when their nearest
    // form contains a specifically identified ChatGPT send button.
    const form = editor.closest("form");
    if (form && findComposerSendButton(form)) {
      return {
        kind: "composer",
        editor
      };
    }

    return null;
  }

  function getLocalComposerScopes(editor) {
    const scopes = [];
    const seen = new Set();

    const addScope = (scope) => {
      if (scope && scope !== document && !seen.has(scope)) {
        seen.add(scope);
        scopes.push(scope);
      }
    };

    addScope(editor.closest("form"));
    addScope(editor.closest("[data-type='unified-composer']"));
    addScope(editor.closest("[data-testid='composer']"));
    addScope(editor.closest("[data-testid*='composer']"));
    addScope(editor.closest("#thread-bottom-container"));

    let ancestor = editor.parentElement;
    for (let depth = 0; ancestor && depth < 7; depth += 1) {
      addScope(ancestor);
      ancestor = ancestor.parentElement;
    }

    return scopes;
  }

  function clickComposerSendButton(editor) {
    for (const scope of getLocalComposerScopes(editor)) {
      const button = findComposerSendButton(scope);
      if (button) {
        button.click();
        return true;
      }
    }

    const form = editor.closest("form");
    const genericSubmitButton = findGenericSubmitButton(form);
    if (genericSubmitButton) {
      genericSubmitButton.click();
      return true;
    }

    const documentSendButton = findComposerSendButton(document);
    if (documentSendButton) {
      documentSendButton.click();
      return true;
    }

    return false;
  }

  function clickEditSubmitButton(editor, messageTurn) {
    const button = findEditSubmitButton(editor, messageTurn);
    if (!button) {
      return false;
    }

    button.click();
    return true;
  }

  function requestNearestFormSubmit(editor) {
    const form = editor.closest("form");
    if (!(form instanceof HTMLFormElement)) {
      return false;
    }

    try {
      if (typeof form.requestSubmit === "function") {
        form.requestSubmit();
        return true;
      }
    } catch {
      // Fall through to a cancelable submit event for older implementations.
    }

    const submitEvent = new Event("submit", {
      bubbles: true,
      cancelable: true
    });
    form.dispatchEvent(submitEvent);
    return submitEvent.defaultPrevented;
  }

  function dispatchPlainEnter(editor) {
    const eventInit = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
      composed: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false
    };

    replayingKeyboardEvent = true;
    try {
      const keyDownAccepted = editor.dispatchEvent(new KeyboardEvent("keydown", eventInit));
      editor.dispatchEvent(new KeyboardEvent("keyup", eventInit));
      return !keyDownAccepted;
    } finally {
      replayingKeyboardEvent = false;
    }
  }

  function submitFromContext(context) {
    if (context.kind === "message-edit") {
      if (clickEditSubmitButton(context.editor, context.messageTurn)) {
        return true;
      }

      if (requestNearestFormSubmit(context.editor)) {
        return true;
      }

      // Last resort: expose a normal Enter event to ChatGPT's own editor
      // handler. Synthetic events have no browser default action, so this does
      // not insert an unwanted line when ChatGPT does not handle the event.
      return dispatchPlainEnter(context.editor);
    }

    if (clickComposerSendButton(context.editor)) {
      return true;
    }

    return dispatchPlainEnter(context.editor);
  }

  function updateShortcutKeyListener() {
    const shouldAttach = shortcutSettingsReady && (
      shortcutSettings.composerCtrlEnterEnabled ||
      shortcutSettings.messageEditCtrlEnterEnabled
    );

    if (shouldAttach === shortcutKeyListenerAttached) {
      return;
    }

    shortcutKeyListenerAttached = shouldAttach;
    if (shouldAttach) {
      document.addEventListener("keydown", handleKeyDown, true);
    } else {
      document.removeEventListener("keydown", handleKeyDown, true);
    }
  }

  function handleKeyDown(event) {
    if (replayingKeyboardEvent || !event.isTrusted || !isExactCtrlEnter(event)) {
      return;
    }

    // Do not submit in the middle of an active input-method composition.
    // This prevents partially composed Korean, Japanese, or Chinese text from
    // being sent.
    if (event.isComposing || event.keyCode === 229) {
      return;
    }

    const context = getEditorContext(event);
    if (!context || !isShortcutEnabledForContext(context)) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    submitFromContext(context);
  }

  window.addEventListener("pagehide", () => {
    if (shortcutKeyListenerAttached) {
      shortcutKeyListenerAttached = false;
      document.removeEventListener("keydown", handleKeyDown, true);
    }
  }, { once: true });

  loadShortcutSettings();
  observeShortcutSettings();
})();
