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

  interface ShortcutSettings { composerCtrlEnterEnabled: boolean; messageEditCtrlEnterEnabled: boolean; }
  type EditorContext = { kind: "message-edit"; editor: HTMLElement; messageTurn: Element }
    | { kind: "composer"; editor: HTMLElement };
  const DEFAULT_SHORTCUT_SETTINGS: Readonly<ShortcutSettings> = Object.freeze({
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

  function normalizeWidthPx(value: unknown, fallbackPx: number) {
    if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return fallbackPx;
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

  function normalizeChatWidthPx(value: unknown) {
    return normalizeWidthPx(value, CHAT_WIDTH_DEFAULT_PX);
  }

  function normalizeComposerWidthPx(value: unknown) {
    return normalizeWidthPx(value, COMPOSER_WIDTH_DEFAULT_PX);
  }

  // ChatGPT's September 2026 layout also uses --thread-body-max-width.
  // Match the actual sizing class, not an assumed number of parent elements.
  // Keep these selectors shared by CSS and the read-only layout diagnostics.
  const WIDTH_EXCLUDED = ':is(dialog, [role="dialog"], [aria-modal="true"], aside, nav, [role="navigation"])';
  const WIDTH_SAFE_SCOPE = `:not(${WIDTH_EXCLUDED}):not(${WIDTH_EXCLUDED} *)`;
  const WIDTH_TURN = ':is([data-testid^="conversation-turn-"], [data-turn], [data-scroll-anchor], [class~="group/turn-messages"])';
  const WIDTH_EDITOR = ':is(#prompt-textarea, [data-testid="prompt-textarea"], [data-testid="composer-text-input"])';
  const WIDTH_COMPOSER_ROOT = ':is([data-type="unified-composer"], [data-testid="composer"], [data-testid="composer-container"])';
  const WIDTH_NOT_EDIT = `:not(${WIDTH_TURN}):not(${WIDTH_TURN} *):not([data-message-author-role] *)`;
  const WIDTH_COMPOSER_ANCHOR = `:is(${WIDTH_COMPOSER_ROOT}, ${WIDTH_EDITOR})${WIDTH_NOT_EDIT}${WIDTH_SAFE_SCOPE}`;
  const WIDTH_MODERN_BOX = ':is([class~="max-w-(--thread-body-max-width)"], [class~="max-w-[var(--thread-body-max-width)]"])';
  const WIDTH_LEGACY_BOX = `:is(
    [class*="[--thread-content-max-width:"],
    [class~="max-w-(--thread-content-max-width)"],
    [class~="max-w-[var(--thread-content-max-width)]"],
    [style*="--thread-content-max-width"],
    [class~="md:max-w-3xl"], [class~="lg:max-w-[40rem]"], [class~="xl:max-w-[48rem]"]
  )`;
  const WIDTH_BOX = `:is(${WIDTH_MODERN_BOX}, ${WIDTH_LEGACY_BOX},
    [class~="max-w-(--composer-max-width)"], [class~="max-w-[var(--composer-max-width)]"])`;
  // User-provided 1.64.1 structural report: both real width carriers are
  // max-w-(--thread-body-max-width), but neither has the old turn/editor IDs.
  // Identify the two separate lanes from their observed DOM relationship:
  // reverse scrollport -> flow content -> conversation width carrier;
  // reverse scrollport -> absolute dock -> width carrier -> form/ProseMirror.
  // No main ancestry, generated ID, parent-count heuristic, or text inspection.
  // Keep the rich editor anchor OUT of WIDTH_EDITOR: broadening that constant
  // would also affect legacy forms/previous-message editors.
  const WIDTH_REPORTED_SCROLL = '[role="presentation"].overflow-y-auto.flex-col-reverse';
  const WIDTH_REPORTED_EDITOR = `.ProseMirror[role="textbox"]${WIDTH_SAFE_SCOPE}`;
  // The live 2026-10-04 layout replaced px-toolbar with variable inline padding.
  // Both remain real width carriers; retain the lane/form constraints below.
  const WIDTH_REPORTED_PADDING = ':is(.px-toolbar, [class~="px-[var(--thread-body-inline-padding,var(--padding-toolbar))]"])';
  const WIDTH_REPORTED_BOX = `${WIDTH_MODERN_BOX}.mx-auto.w-full${WIDTH_REPORTED_PADDING}`;
  const WIDTH_REPORTED_CONVERSATION = `${WIDTH_REPORTED_SCROLL}${WIDTH_SAFE_SCOPE}:has(> .absolute > ${WIDTH_REPORTED_BOX} form ${WIDTH_REPORTED_EDITOR}) > .min-h-full.flex-col.overflow-x-clip > ${WIDTH_REPORTED_BOX}${WIDTH_SAFE_SCOPE}`;
  const WIDTH_REPORTED_COMPOSER = `${WIDTH_REPORTED_SCROLL}${WIDTH_SAFE_SCOPE} > .absolute > ${WIDTH_REPORTED_BOX}:has(form ${WIDTH_REPORTED_EDITOR})${WIDTH_NOT_EDIT}${WIDTH_SAFE_SCOPE}`;
  // User-provided 1.67.0 NEW-CHAT report: the form is in the centered landing
  // column (basis-5/9) under a role=main scrollport, NOT in the reverse-scroll
  // absolute dock above. Old prompt/turn IDs are absent here as well.
  // Match only that observed relationship and the actual ProseMirror form.
  // Do not widen all main/forms or the landing page's headings/suggestion cards.
  // Keep the same rich-editor identity used for the dock. Editability is not
  // an identity: the page may temporarily make the composer read-only while busy.
  // This is a composer-only branch; no conversation exists before the first turn.
  const WIDTH_REPORTED_NEW_CHAT_COMPOSER = `[role="main"].overflow-y-auto.flex-col${WIDTH_SAFE_SCOPE} [class~="basis-5/9"].flex-col${WIDTH_NOT_EDIT}${WIDTH_SAFE_SCOPE} .relative > ${WIDTH_REPORTED_BOX}:has(form ${WIDTH_REPORTED_EDITOR}):not(:has(${WIDTH_TURN}, [data-message-author-role]))${WIDTH_NOT_EDIT}${WIDTH_SAFE_SCOPE}`;
  // Some versions retain a second, explicit thread-content width inside the
  // body carrier. Release only that column constraint, not generic max-w-* or
  // arbitrary grids, controls, inputs, and cards.
  const WIDTH_THREAD_CONTENT_BOX = ':is([class~="max-w-(--thread-content-max-width)"], [class~="max-w-[var(--thread-content-max-width)]"])';
  const WIDTH_CONVERSATION_TARGET = `:is(
    ${WIDTH_REPORTED_CONVERSATION},
    ${WIDTH_TURN}${WIDTH_LEGACY_BOX},
    ${WIDTH_TURN} ${WIDTH_LEGACY_BOX},
    ${WIDTH_MODERN_BOX}:is(${WIDTH_TURN}, ${WIDTH_TURN} *, :has(${WIDTH_TURN}, [data-message-author-role])):not(${WIDTH_COMPOSER_ANCHOR}):not(:has(${WIDTH_COMPOSER_ANCHOR}))
  )${WIDTH_SAFE_SCOPE}`;
  const WIDTH_COMPOSER_TARGET = `:is(
    ${WIDTH_REPORTED_COMPOSER},
    ${WIDTH_REPORTED_NEW_CHAT_COMPOSER},
    ${WIDTH_BOX}:has(${WIDTH_COMPOSER_ANCHOR}):not(:has(${WIDTH_TURN})),
    ${WIDTH_COMPOSER_ROOT}${WIDTH_NOT_EDIT},
    form:has(${WIDTH_EDITOR})${WIDTH_NOT_EDIT}
  )${WIDTH_SAFE_SCOPE}`;
  const WIDTH_SHARED_BOX = `${WIDTH_BOX}:has(${WIDTH_TURN}):has(${WIDTH_COMPOSER_ANCHOR})${WIDTH_SAFE_SCOPE}`;

  function buildSharedWidthCss(): string {
    // If one real sizing wrapper contains BOTH regions, it must not constrain
    // the other independently configured region. Do not replace site variables:
    // the unset region must still be able to read the site's current default.
    // The same rules in the two removable sheets refer only to live CSS vars.
    const siteWidth = 'var(--thread-body-max-width, var(--thread-content-max-width, 100%))';
    return `
${WIDTH_SHARED_BOX} {
  width: 100% !important;
  max-width: min(100%, max(${siteWidth}, var(--chatgpt-extension-conversation-width, 0px), var(--chatgpt-extension-composer-width, 0px))) !important;
  box-sizing: border-box !important;
}
${WIDTH_SHARED_BOX} ${WIDTH_TURN}${WIDTH_SAFE_SCOPE} {
  width: 100% !important;
  max-width: min(100%, var(--chatgpt-extension-conversation-width, ${siteWidth})) !important;
  margin-inline: auto !important;
  box-sizing: border-box !important;
}
${WIDTH_SHARED_BOX} :is(${WIDTH_COMPOSER_ROOT}, form:has(${WIDTH_EDITOR}))${WIDTH_NOT_EDIT}${WIDTH_SAFE_SCOPE} {
  width: 100% !important;
  max-width: min(100%, var(--chatgpt-extension-composer-width, var(--composer-max-width, ${siteWidth}))) !important;
  margin-inline: auto !important;
  box-sizing: border-box !important;
}
`;
  }

  function buildChatWidthCss(widthPx: number): string {
    return `
:root {
  --chatgpt-extension-conversation-width: ${widthPx}px;
}
${WIDTH_CONVERSATION_TARGET} {
  width: 100% !important;
  max-width: min(var(--chatgpt-extension-conversation-width), 100%) !important;
  margin-inline: auto !important;
  box-sizing: border-box !important;
}
${WIDTH_TURN}${WIDTH_SAFE_SCOPE} .markdown.prose${WIDTH_SAFE_SCOPE},
${WIDTH_REPORTED_CONVERSATION} .markdown.prose${WIDTH_SAFE_SCOPE} {
  max-width: 100% !important;
}
${WIDTH_REPORTED_CONVERSATION} ${WIDTH_THREAD_CONTENT_BOX}${WIDTH_SAFE_SCOPE} {
  width: 100% !important;
  max-width: 100% !important;
  box-sizing: border-box !important;
}
${buildSharedWidthCss()}
`;
  }

  function applyChatConversationWidth(value: unknown) {
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

  function buildComposerWidthCss(widthPx: number): string {
    return `
:root {
  --chatgpt-extension-composer-width: ${widthPx}px;
}
${WIDTH_COMPOSER_TARGET} {
  width: 100% !important;
  max-width: min(var(--chatgpt-extension-composer-width), 100%) !important;
  margin-inline: auto !important;
  box-sizing: border-box !important;
}
${buildSharedWidthCss()}
`;
  }

  function applyChatComposerWidth(value: unknown) {
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

  type WidthSample = {
    width: number;
    parentWidth: number;
    maxWidth: string;
  };

  function readWidthSamples(selector: string): WidthSample[] {
    const result: WidthSample[] = [];
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector));
    for (const element of candidates) {
      if (result.length >= 12) break;
      if (!element.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]')) continue;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || rect.width <= 0 || rect.height <= 0) continue;
      result.push({
        width: Math.round(rect.width * 10) / 10,
        parentWidth: Math.round((element.parentElement?.getBoundingClientRect().width || 0) * 10) / 10,
        maxWidth: style.maxWidth
      });
    }
    return result;
  }

  /** On-demand, read-only structural report. Never used to select or alter a UI target.
   * Unknown layouts must be diagnosed, not treated as the composer by guesswork.
   * No text, values, HTML, URL, title, arbitrary IDs/data values, or storage dump.
   */
  function buildWidthDiagnostics(): Record<string, unknown> {
    const round = (value: number): number => Math.round(value * 10) / 10;
    const selectors: Record<string, string> = {
      main: 'main, [role="main"]',
      turnTestId: '[data-testid^="conversation-turn-"]',
      dataTurn: '[data-turn]',
      scrollAnchor: '[data-scroll-anchor]',
      messageAuthor: '[data-message-author-role]',
      promptEditor: WIDTH_EDITOR,
      composerRoot: WIDTH_COMPOSER_ROOT,
      modernWidthToken: WIDTH_MODERN_BOX,
      reportedConversationLane: WIDTH_REPORTED_CONVERSATION,
      reportedComposerLane: WIDTH_REPORTED_COMPOSER,
      reportedNewChatComposerLane: WIDTH_REPORTED_NEW_CHAT_COMPOSER,
      legacyWidthToken: WIDTH_LEGACY_BOX,
      conversationTarget: WIDTH_CONVERSATION_TARGET,
      composerTarget: WIDTH_COMPOSER_TARGET,
      sharedTarget: WIDTH_SHARED_BOX,
      forms: 'form',
      editable: 'textarea, [contenteditable="true"], [contenteditable=""], [role="textbox"]',
      widthClasses: '[class*="max-w-"], [class*="--thread"], [class*="--composer"]'
    };
    const safeIds = new Set(['thread', 'thread-bottom-container', 'prompt-textarea', 'main',
      'composer', 'composer-background', 'stage-slideover-sidebar', 'stage-sidebar-tiny-bar']);
    const safeRoles = new Set(['main', 'dialog', 'navigation', 'textbox', 'region', 'presentation', 'form']);
    // Restrict output to layout-related class tokens. Never export arbitrary Tailwind
    // URL/content values or a full className supplied by page/message contents.
    const layoutClass = /^(?:(?:[a-z0-9_@.-]+):)*(?:max-w-|min-w-|w-|basis-|flex-|grid-|mx-|px-|p-|max-h-|min-h-|h-|overflow-)/i;
    const simpleClass = /^(?:flex|grid|block|hidden|contents|container|relative|absolute|fixed|sticky|grow|shrink|markdown|prose|ProseMirror|group\/turn-messages)$/;
    const allowedClass = (value: string): boolean => value.length <= 150 &&
      /^[a-zA-Z0-9_@.[\]():%+,/!#-]+$/.test(value) && !/url\(|content-/i.test(value) &&
      (layoutClass.test(value) || simpleClass.test(value) || /^\[--(?:thread|composer)-/.test(value));
    const snapshot = (element: Element): Record<string, unknown> => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const classes = Array.from(element.classList).filter(allowedClass).slice(0, 32);
      const variableNames = new Set(['--thread-body-max-width', '--thread-content-max-width', '--composer-max-width']);
      for (const token of classes) {
        for (const name of token.match(/--(?:thread|composer)-[a-z0-9-]+/gi) || []) variableNames.add(name);
      }
      const variables: Record<string, string> = {};
      for (const name of variableNames) {
        const value = style.getPropertyValue(name).trim();
        if (value && value.length <= 160 && CSS.supports('max-width', value)) variables[name] = value;
      }
      const role = element.getAttribute('role') || '';
      const tag = element.localName;
      return {
        tag: /^[a-z][a-z0-9-]{0,50}$/.test(tag) ? tag : '[other-tag]',
        id: safeIds.has(element.id) ? element.id : element.id ? '[other-id]' : '',
        role: safeRoles.has(role) ? role : role ? '[other-role]' : '',
        classes,
        flags: {
          dataTurn: element.hasAttribute('data-turn'),
          turnTestId: element.getAttribute('data-testid')?.startsWith('conversation-turn-') === true,
          messageAuthor: element.hasAttribute('data-message-author-role'),
          scrollAnchor: element.hasAttribute('data-scroll-anchor'),
          hidden: element.hasAttribute('hidden'), inert: element.hasAttribute('inert'),
          ariaHidden: element.getAttribute('aria-hidden') === 'true',
          modal: element.getAttribute('aria-modal') === 'true',
          contentEditable: element instanceof HTMLElement && element.isContentEditable
        },
        rect: { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) },
        css: {
          display: style.display, visibility: style.visibility, position: style.position,
          width: style.width, minWidth: style.minWidth, maxWidth: style.maxWidth,
          boxSizing: style.boxSizing, flexBasis: style.flexBasis,
          paddingLeft: style.paddingLeft, paddingRight: style.paddingRight,
          overflowX: style.overflowX, zoom: style.getPropertyValue('zoom')
        },
        variables,
        excludedByScope: !element.matches(WIDTH_SAFE_SCOPE),
        excludedByVisibilityAttribute: !!element.closest('[hidden], [inert], [aria-hidden="true"]')
      };
    };
    const matches = new Map<string, Element[]>();
    const counts: Record<string, unknown> = {};
    for (const [name, selector] of Object.entries(selectors)) {
      // CSS.supports("selector(main, [role=main])") rejects the top-level
      // selector-list grammar even though querySelectorAll accepts that list.
      // Report the actual query's support rather than that unrelated grammar.
      let nodes: Element[] = [];
      let selectorSupported = true;
      try { nodes = Array.from(document.querySelectorAll(selector)); }
      catch { selectorSupported = false; }
      matches.set(name, nodes);
      let rendered = 0, visibleUnderInspectionRules = 0;
      for (const node of nodes) {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden') {
          rendered++;
          if (!node.closest('[hidden], [inert], [aria-hidden="true"]')) visibleUnderInspectionRules++;
        }
      }
      counts[name] = { total: nodes.length, rendered, visibleUnderInspectionRules,
        selectorSupported };
    }
    // Up to two distinct structural examples per anchor type, plus the first and
    // last sizing classes. Ancestor chains reveal the actual limiting wrapper
    // even when the production selectors find no targets.
    const examples: Record<string, unknown>[] = [];
    const elements: Record<string, unknown>[] = [];
    const elementIds = new Map<Element, number>();
    const nodeIndex = (element: Element): number => {
      const previous = elementIds.get(element);
      if (previous !== undefined) return previous;
      const index = elements.length;
      elementIds.set(element, index);
      elements.push(snapshot(element));
      return index;
    };
    const seen = new Set<Element>();
    for (const name of ['promptEditor', 'composerRoot', 'editable', 'forms', 'dataTurn',
      'turnTestId', 'messageAuthor', 'scrollAnchor', 'modernWidthToken', 'widthClasses', 'main']) {
      const nodes = matches.get(name) || [];
      const visible = nodes.filter(node => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      const choices = visible.length ? visible : nodes;
      const candidates = [choices[0], choices[choices.length - 1]];
      for (const candidate of candidates) {
        if (!candidate || seen.has(candidate) || examples.length >= 18) continue;
        seen.add(candidate);
        const ancestors: number[] = [];
        let current: Element | null = candidate;
        while (current && ancestors.length < 16) {
          ancestors.push(nodeIndex(current));
          current = current.parentElement;
        }
        examples.push({ source: name, ancestors, truncated: current !== null });
      }
    }
    const sheets = [CHAT_WIDTH_STYLE_ID, COMPOSER_WIDTH_STYLE_ID].map(id => {
      const element = document.getElementById(id);
      const sheet = element instanceof HTMLStyleElement ? element.sheet : null;
      return { id, present: !!element, disabled: sheet?.disabled ?? null, ruleCount: sheet?.cssRules.length ?? null };
    });
    return {
      ok: true, scope: 'chatgpt-width-structure', schemaVersion: 1,
      contentScriptRevision: '2.0.2', extensionVersion: globalThis.chrome?.runtime?.getManifest?.().version || null,
      configured: { conversation: chatConversationWidthPx, composer: chatComposerWidthPx },
      document: { readyState: document.readyState, viewportWidth: document.documentElement.clientWidth,
        viewportHeight: document.documentElement.clientHeight,
        horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth) },
      sheets, counts, examples, elements,
      limits: { maximumExamples: 18, maximumAncestors: 16 },
      privacy: 'No conversation text, input values, HTML, URL, page title, cookies, or arbitrary IDs/data values.',
      mode: 'Read-only snapshot; not a width fix or proof that widths were applied.'
    };
  }

  function observeWidthInspection(): void {
    const runtime = globalThis.chrome?.runtime;
    if (typeof runtime?.onMessage?.addListener !== "function") return;
    runtime.onMessage.addListener((message: unknown, sender: { id?: string }, reply: (value: unknown) => void) => {
      if (!message || typeof message !== "object") return false;
      const type = (message as { type?: unknown }).type;
      if (type !== "chatgpt-width:inspect" && type !== "chatgpt-width:diagnose") return false;
      if (sender?.id !== runtime.id) {
        reply({ ok: false, error: "확장 프로그램의 너비 확인 요청이 아닙니다." });
        return false;
      }
      try {
        if (type === "chatgpt-width:diagnose") {
          reply(buildWidthDiagnostics());
          return false;
        }
        reply({
          ok: true,
          configured: { conversation: chatConversationWidthPx, composer: chatComposerWidthPx },
          viewportWidth: document.documentElement.clientWidth,
          horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
          conversation: readWidthSamples(`${WIDTH_CONVERSATION_TARGET}, ${WIDTH_SHARED_BOX} ${WIDTH_TURN}${WIDTH_SAFE_SCOPE}`),
          composer: readWidthSamples(WIDTH_COMPOSER_TARGET),
          // Measurements of matching containers, NOT a claim about a requested
          // width having applied. No text, URLs, IDs, or HTML are returned.
          scope: "matched-visible-width-containers"
        });
      } catch (error) {
        reply({ ok: false, error: error instanceof Error ? error.message : "현재 너비를 읽지 못했습니다." });
      }
      return false;
    });
  }

  function applyShortcutSettings(storedSettings: { [key: string]: unknown; }) {
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

  let shortcutLifecycleSuspended = false;
  let shortcutSettingsEpoch = 0;

  function reportShortcutSettingsReadError(error: unknown): void {
    // Do not replace user widths with defaults after a failed read (including BFCache).
    // An uninitialized shortcut handler remains inactive until real settings arrive.
    console.warn("Could not load ChatGPT settings; existing width styles were kept:", error);
    updateShortcutKeyListener();
  }

  function loadShortcutSettings() {
    const epoch = ++shortcutSettingsEpoch;
    const storageArea = globalThis.chrome?.storage?.local;
    if (!storageArea || typeof storageArea.get !== "function") {
      reportShortcutSettingsReadError(new Error("Chrome 설정 저장소를 사용할 수 없습니다."));
      return;
    }
    try {
      storageArea.get(STORAGE_DEFAULTS, (storedSettings) => {
        const error = globalThis.chrome?.runtime?.lastError;
        if (shortcutLifecycleSuspended || epoch !== shortcutSettingsEpoch) return;
        if (error) { reportShortcutSettingsReadError(error); return; }
        applyShortcutSettings(storedSettings);
        shortcutSettingsReady = true;
        updateShortcutKeyListener();
      });
    } catch (error) {
      if (!shortcutLifecycleSuspended && epoch === shortcutSettingsEpoch) reportShortcutSettingsReadError(error);
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

      if (!Object.keys(changes).some(key => Object.prototype.hasOwnProperty.call(STORAGE_DEFAULTS, key))) return;
      if (shortcutLifecycleSuspended) { shortcutSettingsEpoch++; return; }
      // Refresh the complete settings snapshot when startup/restore has not finished.
      if (!shortcutSettingsReady) { loadShortcutSettings(); return; }
      shortcutSettingsEpoch++;
      const nextSettings = { ...shortcutSettings };
      let didChange = false;

      for (const key of Object.keys(DEFAULT_SHORTCUT_SETTINGS) as Array<keyof ShortcutSettings>) {
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

  function isShortcutEnabledForContext(context: EditorContext) {
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

  function normalizeText(value: string|null) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function containsAnyWord(text: string, words: readonly string[]) {
    return words.some((word) => text.includes(word));
  }

  function getButtonDescription(button: HTMLButtonElement): string {
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

  function isExactCtrlEnter(event: KeyboardEvent) {
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

  function findEditorFromEvent(event: Event) {
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

  function isWritableEditor(element: Element|null): element is HTMLElement {
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

  function isUsableButton(button: Element): button is HTMLButtonElement {
    if (!(button instanceof HTMLButtonElement)) {
      return false;
    }

    return button.isConnected && !button.closest("[hidden],[inert],[aria-hidden='true']") &&
      button.getClientRects().length > 0 && getComputedStyle(button).visibility !== "hidden" && !(
      button.disabled ||
      button.hidden ||
      button.getAttribute("aria-disabled") === "true" ||
      button.getAttribute("aria-hidden") === "true"
    );
  }

  function isBlockedActionButton(button: HTMLButtonElement): boolean {
    return containsAnyWord(getButtonDescription(button), BLOCKED_ACTION_WORDS);
  }

  function isUsableSubmitButton(button: Element): button is HTMLButtonElement {
    return isUsableButton(button) && !isBlockedActionButton(button);
  }

  function findButtonBySelectors(
    scope: Document | Element,
    selectors: readonly string[]
  ): HTMLButtonElement | null {
    if (!(scope instanceof Document || scope instanceof Element)) {
      return null;
    }

    for (const selector of selectors) {
      for (const button of scope.querySelectorAll<HTMLButtonElement>(selector)) {
        if (isUsableSubmitButton(button)) {
          return button;
        }
      }
    }

    return null;
  }

  function isInsideConversationTurn(element: HTMLButtonElement) {
    return Boolean(
      element.closest(MESSAGE_TURN_SELECTOR) ||
      element.closest("[data-message-author-role='user']")
    );
  }

  function findComposerSendButton(scope: Document | Element): HTMLButtonElement | null {
    if (!(scope instanceof Document || scope instanceof Element)) {
      return null;
    }

    for (const selector of COMPOSER_SEND_BUTTON_SELECTORS) {
      for (const button of scope.querySelectorAll<HTMLButtonElement>(selector)) {
        if (isUsableSubmitButton(button) && !isInsideConversationTurn(button)) {
          return button;
        }
      }
    }

    return null;
  }

  function findGenericSubmitButton(form: Element | null): HTMLButtonElement | null {
    if (!(form instanceof HTMLFormElement)) {
      return null;
    }

    const candidates = Array.from(form.querySelectorAll<HTMLButtonElement>("button[type='submit']"))
      .filter(button => button.form === form && isUsableSubmitButton(button));
    return candidates.length === 1 ? candidates[0] : null;
  }

  function isUserConversationTurn(turn: Element, editor: HTMLElement) {
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

  function getUserMessageTurn(editor: HTMLElement) {
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

  function getEditActionScopes(editor: HTMLElement, messageTurn: Element) {
    const scopes: Element[] = [];
    const seen = new Set<Element>();

    const addScope = (scope: Element | null) => {
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

  function isPositiveEditAction(button: HTMLButtonElement) {
    const description = getButtonDescription(button);
    return (
      containsAnyWord(description, EDIT_ACTION_WORDS) &&
      !containsAnyWord(description, BLOCKED_ACTION_WORDS)
    );
  }

  function findEditSubmitButtonInScope(scope: Element): HTMLButtonElement | null {
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

    const actions = Array.from(scope.querySelectorAll("button")).filter(button =>
      isUsableButton(button) && isPositiveEditAction(button));
    return actions.length === 1 ? actions[0] : null;
  }

  function findEditSubmitButton(editor: HTMLElement, messageTurn: Element): HTMLButtonElement | null {
    for (const scope of getEditActionScopes(editor, messageTurn)) {
      const button = findEditSubmitButtonInScope(scope);
      if (button) {
        return button;
      }
    }

    return null;
  }

  function getEditorContext(event: Event): EditorContext | null {
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

  function findLocalComposerAction(editor: HTMLElement): HTMLButtonElement | null {
    // A known editor is not permission to click a send-looking button elsewhere
    // in the document. Only its owning form or explicit composer root is used.
    const form = editor.closest("form");
    if (form instanceof HTMLFormElement) {
      return findComposerSendButton(form) || findGenericSubmitButton(form);
    }
    const root = editor.closest(COMPOSER_ROOT_SELECTOR);
    return root ? findComposerSendButton(root) : null;
  }

  function getSubmitAction(context: EditorContext): HTMLButtonElement | null {
    return context.kind === "message-edit"
      ? findEditSubmitButton(context.editor, context.messageTurn)
      : findLocalComposerAction(context.editor);
  }

  function updateShortcutKeyListener() {
    const shouldAttach = !shortcutLifecycleSuspended && shortcutSettingsReady && (
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

  function handleKeyDown(event: KeyboardEvent) {
    if (!event.isTrusted || !isExactCtrlEnter(event)) {
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

    const action = getSubmitAction(context);
    if (!action) {
      // Do not equate a canceled synthetic key/submit event with submission.
      console.warn("ChatGPT Ctrl+Enter: 같은 작성 영역의 전송 동작을 확인하지 못했습니다. 입력을 가로채지 않았습니다.");
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    action.click();
  }

  window.addEventListener("pagehide", () => {
    shortcutLifecycleSuspended = true;
    shortcutSettingsEpoch++;
    updateShortcutKeyListener();
  });
  window.addEventListener("pageshow", event => {
    if (!event.persisted) return;
    shortcutLifecycleSuspended = false;
    shortcutSettingsReady = false;
    loadShortcutSettings();
  });

  loadShortcutSettings();
  observeShortcutSettings();
  observeWidthInspection();
})();
