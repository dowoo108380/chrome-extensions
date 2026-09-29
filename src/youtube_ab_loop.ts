(() => {
  "use strict";

  /**
   * YouTube A/B loop behavior adapted from the user-provided
   * "YouTube A/B Loop" v3.0.0 userscript by Black0S.
   *
   * The userscript-manager update checker is intentionally omitted because
   * this code is distributed as part of Browser Toolbox Extension.
   * No backdrop-filter or CSS filter is used over the video so that the
   * overlay does not disable Chromium's video-overlay path used by NVIDIA VSR.
   */

  const CONTROLLER_KEY = "__browserToolboxYouTubeAbLoopV1__";
  const STYLE_ID = "__browser_toolbox_youtube_ab_loop_style__";
  const BUTTON_ID = "__browser_toolbox_youtube_ab_loop_button__";
  const PANEL_ID = "__browser_toolbox_youtube_ab_loop_panel__";
  const EMPTY_TIME = "–:––";
  const RETRY_INTERVAL_MS = 600;
  const MAX_RETRY_COUNT = 180;
  const URL_CHECK_INTERVAL_MS = 750;
  const NAVIGATION_SETTLE_MS = 250;
  const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
  let shortcutSettings: Record<string, unknown> = { ...ToolboxShared.SHORTCUT_DEFAULTS, mediaControllerEnabled: false, mediaKeyboardEnabled: true };
  let shortcutsReady = false;
  const shortcutKeys = [...Object.keys(ToolboxShared.SHORTCUT_DEFAULTS), "mediaControllerEnabled", "mediaKeyboardEnabled"];
  const settingsJournal = new ToolboxShared.SettingsReadJournal(shortcutKeys);
  function refreshShortcutHints(): void {
    if (!session) return;
    const hints = session.panel.querySelectorAll<HTMLElement>(".btx-yt-ab-loop-key");
    for (const [index, definition] of ToolboxShared.AB_SHORTCUTS.entries()) {
      const code = ToolboxShared.normalizeShortcutCode(shortcutSettings[definition.storageKey], definition.defaultCode);
      if (hints[index]) hints[index].textContent = shortcutSettings[ToolboxShared.AB_ENABLED_KEY] === false ? "꺼짐" : code.replace(/^Key/, "");
    }
  }
  function loadShortcutSettings(): void {
    const start = settingsJournal.mark();
    void ToolboxShared.readStorage(chrome.storage?.local, chrome.runtime, {
      ...ToolboxShared.SHORTCUT_DEFAULTS, mediaControllerEnabled: false, mediaKeyboardEnabled: true
    }).then(values => { shortcutSettings = settingsJournal.merge(values, start); shortcutsReady = true; refreshShortcutHints(); })
      .catch(error => { shortcutsReady = false; console.warn("Could not load A/B loop shortcuts:", error); });
  }
  const onShortcutStorageChange = (changes: Record<string, { newValue?: unknown }>, area: string): void => {
    if (area !== "local") return;
    settingsJournal.record(changes);
    for (const key of shortcutKeys) if (Object.prototype.hasOwnProperty.call(changes, key)) shortcutSettings[key] = changes[key].newValue;
    refreshShortcutHints();
  };

  if ((globalThis as any)[CONTROLLER_KEY]) return;

  type LoopMode = "ab" | "full";
  type LoopPoint = "a" | "b";

  interface PointCardElements {
    card: HTMLElement;
    value: HTMLElement;
    setButton: HTMLButtonElement;
    clearButton: HTMLButtonElement;
  }

  interface PanelElements {
    toggle: HTMLButtonElement;
    toggleLabel: HTMLElement;
    modeFull: HTMLButtonElement;
    modeAb: HTMLButtonElement;
    abSection: HTMLElement;
    footer: HTMLElement;
    cardA: HTMLElement;
    cardB: HTMLElement;
    valueA: HTMLElement;
    valueB: HTMLElement;
    setA: HTMLButtonElement;
    setB: HTMLButtonElement;
    clearA: HTMLButtonElement;
    clearB: HTMLButtonElement;
    rail: HTMLElement;
    progress: HTMLElement;
    range: HTMLElement;
    thumbA: HTMLElement;
    thumbB: HTMLElement;
    playhead: HTMLElement;
    duration: HTMLElement;
    resetButton: HTMLButtonElement;
  }

  interface DragState {
    pointerId: number;
    element: HTMLElement;
    apply: (clientX: number) => void;
    moved: boolean;
    startX: number;
  }

  interface Session {
    video: HTMLVideoElement;
    controls: Element;
    player: HTMLElement;
    button: HTMLButtonElement;
    panel: HTMLElement;
    refs: PanelElements;
    pointA: number | null;
    pointB: number | null;
    loopEnabled: boolean;
    replayGeneration: number;
    mode: LoopMode;
    panelOpen: boolean;
    animationFrame: number;
    abortController: AbortController;
    drag: DragState | null;
    originalNativeLoop: boolean;
    sourceAtEnable: string;
    videoKeyAtEnable: string;
    sourceSuspended: boolean;
    mediaObserver: MutationObserver | null;
    nativeLoopOverridden: boolean;
    playerPositionWasChanged: boolean;
    originalPlayerInlinePosition: string;
    originalPlayerInlinePositionPriority: string;
    lastProgressPercent: number;
    lastDuration: number;
    lastRangeLow: number;
    lastRangeHigh: number;
    suppressRailClickUntil: number;
  }

  const CSS = `
    .btx-yt-ab-loop-button {
      border: 0;
      background: transparent;
      cursor: pointer;
      margin: 0;
      padding: 0;
      width: 48px;
      height: 48px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      position: relative;
      vertical-align: top;
      opacity: 0.9;
      transition: opacity 0.15s;
    }
    .btx-yt-ab-loop-button:hover { opacity: 1; }
    .btx-yt-ab-loop-button:focus-visible {
      outline: 2px solid rgba(255, 255, 255, 0.95);
      outline-offset: -5px;
      border-radius: 50%;
    }
    .btx-yt-ab-loop-dot {
      position: absolute;
      top: 9px;
      right: 9px;
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: #ff0000;
      opacity: 0;
      transform: scale(0);
      transition: opacity 0.2s, transform 0.25s cubic-bezier(.34, 1.56, .64, 1);
    }
    .btx-yt-ab-loop-button[data-loop-enabled="true"] .btx-yt-ab-loop-dot,
    .btx-yt-ab-loop-button[aria-expanded="true"] .btx-yt-ab-loop-dot {
      opacity: 1;
      transform: scale(1);
    }

    .btx-yt-ab-loop-panel {
      box-sizing: border-box;
      position: absolute;
      right: 4px;
      bottom: 54px;
      width: min(340px, calc(100% - 16px));
      max-width: 340px;
      background: rgba(30, 30, 30, 0.96);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.55);
      color: #ffffff;
      font-family: Roboto, "YouTube Sans", Arial, sans-serif;
      z-index: 99999;
      overflow: hidden;
      opacity: 0;
      visibility: hidden;
      transform: translateY(8px) scale(0.97);
      transform-origin: bottom right;
      transition: opacity 0.18s, transform 0.18s cubic-bezier(.4, 0, .2, 1), visibility 0s linear 0.18s;
      pointer-events: none;
      user-select: none;
      -webkit-user-select: none;
    }
    .btx-yt-ab-loop-panel[data-open="true"] {
      opacity: 1;
      visibility: visible;
      transform: none;
      transition-delay: 0s;
      pointer-events: auto;
    }
    .btx-yt-ab-loop-panel *,
    .btx-yt-ab-loop-panel *::before,
    .btx-yt-ab-loop-panel *::after { box-sizing: border-box; }
    .btx-yt-ab-loop-panel button,
    .btx-yt-ab-loop-panel input { font-family: inherit; }

    .btx-yt-ab-loop-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 16px 8px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
    .btx-yt-ab-loop-title {
      font-size: 12px;
      font-weight: 500;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: rgba(255, 255, 255, 0.55);
    }

    .btx-yt-ab-loop-toggle {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      padding: 4px 8px;
      border: 0;
      border-radius: 20px;
      background: transparent;
      color: inherit;
      transition: background 0.15s;
    }
    .btx-yt-ab-loop-toggle:hover { background: rgba(255, 255, 255, 0.08); }
    .btx-yt-ab-loop-toggle:focus-visible,
    .btx-yt-ab-loop-mode:focus-visible,
    .btx-yt-ab-loop-set:focus-visible,
    .btx-yt-ab-loop-clear:focus-visible,
    .btx-yt-ab-loop-reset:focus-visible,
    .btx-yt-ab-loop-time:focus-visible {
      outline: 2px solid rgba(96, 165, 250, 0.95);
      outline-offset: 2px;
    }
    .btx-yt-ab-loop-pill {
      width: 30px;
      height: 17px;
      border-radius: 9px;
      background: rgba(255, 255, 255, 0.18);
      position: relative;
      transition: background 0.2s;
      flex: 0 0 auto;
    }
    .btx-yt-ab-loop-pill::after {
      content: "";
      position: absolute;
      top: 2.5px;
      left: 2.5px;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.55);
      transition: transform 0.22s cubic-bezier(.34, 1.56, .64, 1), background 0.2s;
    }
    .btx-yt-ab-loop-toggle[aria-pressed="true"] .btx-yt-ab-loop-pill { background: #ff0000; }
    .btx-yt-ab-loop-toggle[aria-pressed="true"] .btx-yt-ab-loop-pill::after {
      transform: translateX(13px);
      background: #ffffff;
    }
    .btx-yt-ab-loop-toggle-label {
      font-size: 13px;
      font-weight: 500;
      color: rgba(255, 255, 255, 0.66);
      transition: color 0.15s;
    }
    .btx-yt-ab-loop-toggle[aria-pressed="true"] .btx-yt-ab-loop-toggle-label { color: #ffffff; }

    .btx-yt-ab-loop-modes {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      padding: 10px 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
    .btx-yt-ab-loop-mode {
      height: 32px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      background: rgba(255, 255, 255, 0.05);
      font-size: 12px;
      font-weight: 500;
      color: rgba(255, 255, 255, 0.56);
      cursor: pointer;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    .btx-yt-ab-loop-mode:hover { background: rgba(255, 255, 255, 0.1); color: rgba(255, 255, 255, 0.9); }
    .btx-yt-ab-loop-mode[aria-pressed="true"] {
      background: rgba(255, 255, 255, 0.13);
      border-color: rgba(255, 255, 255, 0.34);
      color: #ffffff;
    }

    .btx-yt-ab-loop-ab {
      padding: 10px 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      overflow: hidden;
      max-height: 200px;
      transition: opacity 0.2s, max-height 0.2s, padding 0.2s;
    }
    .btx-yt-ab-loop-ab[hidden] {
      display: block;
      opacity: 0;
      max-height: 0;
      padding: 0 16px;
      pointer-events: none;
    }
    .btx-yt-ab-loop-points {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      margin-bottom: 10px;
    }
    .btx-yt-ab-loop-card {
      min-width: 0;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.09);
      border-radius: 8px;
      padding: 8px 9px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      transition: border-color 0.2s, background 0.2s;
    }
    .btx-yt-ab-loop-card[data-set="true"] {
      border-color: rgba(255, 255, 255, 0.22);
      background: rgba(255, 255, 255, 0.08);
    }
    .btx-yt-ab-loop-card-left { min-width: 0; display: flex; align-items: center; gap: 7px; }
    .btx-yt-ab-loop-badge {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      flex: 0 0 auto;
      background: rgba(255, 255, 255, 0.08);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 9px;
      font-weight: 700;
      color: rgba(255, 255, 255, 0.38);
      transition: background 0.2s, color 0.2s;
    }
    .btx-yt-ab-loop-card[data-set="true"] .btx-yt-ab-loop-badge {
      background: rgba(255, 0, 0, 0.25);
      color: #ff7777;
    }
    .btx-yt-ab-loop-time {
      min-width: 0;
      border: 0;
      background: transparent;
      padding: 1px 0;
      color: rgba(255, 255, 255, 0.38);
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .btx-yt-ab-loop-card[data-set="true"] .btx-yt-ab-loop-time { color: #ffffff; }
    .btx-yt-ab-loop-time-input {
      width: 58px;
      background: rgba(255, 255, 255, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.32);
      border-radius: 4px;
      color: #ffffff;
      font-size: 13px;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
      padding: 2px 4px;
      outline: none;
      text-align: left;
    }
    .btx-yt-ab-loop-card-right { display: flex; align-items: center; gap: 2px; flex: 0 0 auto; }
    .btx-yt-ab-loop-set {
      font-size: 10px;
      font-weight: 600;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.11);
      border-radius: 4px;
      color: rgba(255, 255, 255, 0.58);
      padding: 3px 7px;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .btx-yt-ab-loop-set:hover { background: rgba(255, 255, 255, 0.15); color: #ffffff; }
    .btx-yt-ab-loop-clear {
      background: transparent;
      border: 0;
      color: rgba(255, 255, 255, 0.28);
      font-size: 11px;
      cursor: pointer;
      padding: 3px 4px;
      transition: color 0.15s;
    }
    .btx-yt-ab-loop-clear:hover { color: #ff5555; }

    .btx-yt-ab-loop-track {
      position: relative;
      height: 20px;
      display: flex;
      align-items: center;
      cursor: pointer;
      margin-bottom: 3px;
      touch-action: none;
    }
    .btx-yt-ab-loop-rail {
      position: absolute;
      left: 0;
      right: 0;
      height: 3px;
      background: rgba(255, 255, 255, 0.13);
      border-radius: 2px;
    }
    .btx-yt-ab-loop-progress {
      position: absolute;
      left: 0;
      height: 100%;
      background: rgba(255, 255, 255, 0.34);
      border-radius: 2px;
      pointer-events: none;
      width: 0%;
    }
    .btx-yt-ab-loop-range {
      position: absolute;
      height: 100%;
      background: #ff0000;
      border-radius: 2px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s;
    }
    .btx-yt-ab-loop-range[data-visible="true"] { opacity: 0.58; }
    .btx-yt-ab-loop-thumb {
      position: absolute;
      top: 50%;
      transform: translate(-50%, -50%);
      border-radius: 50%;
      cursor: grab;
      z-index: 2;
      display: none;
      touch-action: none;
      transition: transform 0.1s;
    }
    .btx-yt-ab-loop-thumb[data-visible="true"] { display: block; }
    .btx-yt-ab-loop-thumb:hover { transform: translate(-50%, -50%) scale(1.3); }
    .btx-yt-ab-loop-thumb:active { cursor: grabbing; }
    .btx-yt-ab-loop-thumb-point {
      width: 11px;
      height: 11px;
      background: #ffffff;
      box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.25);
    }
    .btx-yt-ab-loop-playhead {
      width: 11px;
      height: 11px;
      background: #ffffff;
      box-shadow: 0 1px 5px rgba(0, 0, 0, 0.65);
      display: block;
      z-index: 3;
      left: 0%;
    }
    .btx-yt-ab-loop-times {
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      color: rgba(255, 255, 255, 0.32);
      font-variant-numeric: tabular-nums;
    }

    .btx-yt-ab-loop-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 16px 12px;
      overflow: hidden;
      max-height: 80px;
      transition: opacity 0.2s, max-height 0.2s, padding 0.2s;
    }
    .btx-yt-ab-loop-footer[hidden] {
      display: flex;
      opacity: 0;
      max-height: 0;
      padding: 0;
      pointer-events: none;
    }
    .btx-yt-ab-loop-hints { display: flex; gap: 12px; }
    .btx-yt-ab-loop-hint {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 10px;
      color: rgba(255, 255, 255, 0.3);
    }
    .btx-yt-ab-loop-key {
      background: rgba(255, 255, 255, 0.07);
      border: 1px solid rgba(255, 255, 255, 0.11);
      border-radius: 3px;
      padding: 1px 5px;
      font-size: 10px;
      color: rgba(255, 255, 255, 0.42);
    }
    .btx-yt-ab-loop-reset {
      font-size: 11px;
      font-weight: 500;
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 6px;
      color: rgba(255, 255, 255, 0.4);
      padding: 5px 12px;
      cursor: pointer;
      letter-spacing: 0.03em;
      transition: border-color 0.15s, color 0.15s, background 0.15s;
    }
    .btx-yt-ab-loop-reset:hover {
      border-color: rgba(255, 60, 60, 0.55);
      color: #ff7777;
      background: rgba(255, 0, 0, 0.08);
    }

    @media (max-width: 520px) {
      .btx-yt-ab-loop-panel {
        right: 2px;
        bottom: 50px;
        width: min(330px, calc(100% - 8px));
      }
      .btx-yt-ab-loop-header,
      .btx-yt-ab-loop-modes,
      .btx-yt-ab-loop-ab,
      .btx-yt-ab-loop-footer { padding-left: 12px; padding-right: 12px; }
    }
  `;

  let session: Session | null = null;
  let mutationObserver: MutationObserver | null = null;
  let retryTimer = 0;
  let retryCount = 0;
  let navigationTimer = 0;
  let lastHref = location.href;
  let urlCheckTimer = 0;
  let lifecycleSuspended = false;
  const lifetimeAbortController = new AbortController();

  function createElement<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className = "",
    id = ""
  ): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (id) element.id = id;
    return element;
  }

  function createSvgElement(tag: string, attributes: Record<string, string | number>): SVGElement {
    const element = document.createElementNS(SVG_NAMESPACE, tag);
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, String(value));
    }
    return element;
  }

  function append(parent: Node, ...children: Node[]): void {
    for (const child of children) parent.appendChild(child);
  }

  function buildToolbarIcon(): SVGElement {
    const svg = createSvgElement("svg", {
      width: 22,
      height: 22,
      viewBox: "0 0 22 22",
      fill: "none",
      "aria-hidden": "true"
    });
    append(
      svg,
      createSvgElement("rect", { x: 2.5, y: 9.5, width: 17, height: 3, rx: 1.5, fill: "white", "fill-opacity": 0.2 }),
      createSvgElement("rect", { x: 2.5, y: 9.5, width: 7, height: 3, rx: 1.5, fill: "white", "fill-opacity": 0.55 }),
      createSvgElement("line", { x1: 7, y1: 7, x2: 7, y2: 15, stroke: "white", "stroke-width": 1.8, "stroke-linecap": "round" }),
      createSvgElement("line", { x1: 15, y1: 7, x2: 15, y2: 15, stroke: "white", "stroke-width": 1.8, "stroke-linecap": "round" }),
      createSvgElement("circle", { cx: 11, cy: 11, r: 2, fill: "white" })
    );
    return svg;
  }

  function buildFullModeIcon(): SVGElement {
    const svg = createSvgElement("svg", { width: 13, height: 13, viewBox: "0 0 13 13", fill: "none", "aria-hidden": "true" });
    append(
      svg,
      createSvgElement("path", {
        d: "M6.5 2 A4.5 4.5 0 1 1 2 6.5",
        stroke: "currentColor",
        "stroke-width": 1.4,
        "stroke-linecap": "round",
        fill: "none"
      }),
      createSvgElement("polyline", {
        points: "2,4 2,6.5 4.5,6.5",
        stroke: "currentColor",
        "stroke-width": 1.4,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        fill: "none"
      })
    );
    return svg;
  }

  function buildAbModeIcon(): SVGElement {
    const svg = createSvgElement("svg", { width: 13, height: 13, viewBox: "0 0 13 13", fill: "none", "aria-hidden": "true" });
    append(
      svg,
      createSvgElement("rect", { x: 1, y: 4, width: 4, height: 5, rx: 1, stroke: "currentColor", "stroke-width": 1.3, fill: "none" }),
      createSvgElement("rect", { x: 8, y: 4, width: 4, height: 5, rx: 1, stroke: "currentColor", "stroke-width": 1.3, fill: "none" }),
      createSvgElement("line", { x1: 5, y1: 6.5, x2: 8, y2: 6.5, stroke: "currentColor", "stroke-width": 1.3, "stroke-dasharray": "1 1.2" })
    );
    return svg;
  }

  function buildPointCard(label: LoopPoint): PointCardElements {
    const upperLabel = label.toUpperCase();
    const card = createElement("div", "btx-yt-ab-loop-card");
    card.dataset.set = "false";

    const left = createElement("div", "btx-yt-ab-loop-card-left");
    const badge = createElement("span", "btx-yt-ab-loop-badge");
    badge.textContent = upperLabel;
    const value = createElement("span", "btx-yt-ab-loop-time");
    value.textContent = EMPTY_TIME;
    value.title = `${upperLabel} 지점을 직접 입력`;
    value.setAttribute("role", "button");
    value.setAttribute("aria-label", `${upperLabel} 지점 시간. 눌러서 직접 입력할 수 있습니다.`);
    value.tabIndex = 0;
    append(left, badge, value);

    const right = createElement("div", "btx-yt-ab-loop-card-right");
    const setButton = createElement("button", "btx-yt-ab-loop-set");
    setButton.type = "button";
    setButton.textContent = "설정";
    setButton.title = `현재 재생 위치를 ${upperLabel} 지점으로 설정`;
    const clearButton = createElement("button", "btx-yt-ab-loop-clear");
    clearButton.type = "button";
    clearButton.textContent = "✕";
    clearButton.title = `${upperLabel} 지점 지우기`;
    clearButton.setAttribute("aria-label", `${upperLabel} 지점 지우기`);
    append(right, setButton, clearButton);

    append(card, left, right);
    return { card, value, setButton, clearButton };
  }

  function buildPanel(): { panel: HTMLElement; refs: PanelElements } {
    const panel = createElement("section", "btx-yt-ab-loop-panel", PANEL_ID);
    panel.dataset.open = "false";
    panel.setAttribute("aria-hidden", "true");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "유튜브 A/B 반복 설정");

    const header = createElement("div", "btx-yt-ab-loop-header");
    const title = createElement("span", "btx-yt-ab-loop-title");
    title.textContent = "A / B 반복";

    const toggle = createElement("button", "btx-yt-ab-loop-toggle");
    toggle.type = "button";
    toggle.setAttribute("aria-pressed", "false");
    toggle.title = "반복 재생 켜기 또는 끄기";
    const pill = createElement("span", "btx-yt-ab-loop-pill");
    const toggleLabel = createElement("span", "btx-yt-ab-loop-toggle-label");
    toggleLabel.textContent = "반복 꺼짐";
    append(toggle, pill, toggleLabel);
    append(header, title, toggle);

    const modes = createElement("div", "btx-yt-ab-loop-modes");
    const modeFull = createElement("button", "btx-yt-ab-loop-mode");
    modeFull.type = "button";
    modeFull.setAttribute("aria-pressed", "false");
    append(modeFull, buildFullModeIcon(), document.createTextNode("전체 영상"));
    const modeAb = createElement("button", "btx-yt-ab-loop-mode");
    modeAb.type = "button";
    modeAb.setAttribute("aria-pressed", "true");
    append(modeAb, buildAbModeIcon(), document.createTextNode("A → B"));
    append(modes, modeFull, modeAb);

    const cardA = buildPointCard("a");
    const cardB = buildPointCard("b");
    const points = createElement("div", "btx-yt-ab-loop-points");
    append(points, cardA.card, cardB.card);

    const progress = createElement("div", "btx-yt-ab-loop-progress");
    const range = createElement("div", "btx-yt-ab-loop-range");
    range.dataset.visible = "false";
    const rail = createElement("div", "btx-yt-ab-loop-rail");
    append(rail, progress, range);

    const thumbA = createElement("div", "btx-yt-ab-loop-thumb btx-yt-ab-loop-thumb-point");
    thumbA.dataset.visible = "false";
    thumbA.title = "A 지점 이동";
    thumbA.setAttribute("role", "slider");
    thumbA.setAttribute("aria-label", "A 지점");
    thumbA.tabIndex = 0;
    const thumbB = createElement("div", "btx-yt-ab-loop-thumb btx-yt-ab-loop-thumb-point");
    thumbB.dataset.visible = "false";
    thumbB.title = "B 지점 이동";
    thumbB.setAttribute("role", "slider");
    thumbB.setAttribute("aria-label", "B 지점");
    thumbB.tabIndex = 0;
    const playhead = createElement("div", "btx-yt-ab-loop-thumb btx-yt-ab-loop-playhead");
    playhead.dataset.visible = "true";
    playhead.title = "현재 재생 위치 이동";
    playhead.setAttribute("role", "slider");
    playhead.setAttribute("aria-label", "현재 재생 위치");
    playhead.tabIndex = 0;

    const track = createElement("div", "btx-yt-ab-loop-track");
    append(track, rail, thumbA, thumbB, playhead);

    const times = createElement("div", "btx-yt-ab-loop-times");
    const zero = createElement("span");
    zero.textContent = "0:00";
    const duration = createElement("span");
    duration.textContent = EMPTY_TIME;
    append(times, zero, duration);

    const abSection = createElement("div", "btx-yt-ab-loop-ab");
    append(abSection, points, track, times);

    const hints = createElement("div", "btx-yt-ab-loop-hints");
    for (const point of ["A", "B"]) {
      const hint = createElement("span", "btx-yt-ab-loop-hint");
      const key = createElement("span", "btx-yt-ab-loop-key");
      key.textContent = point;
      append(hint, key, document.createTextNode(`${point} 지점`));
      hints.appendChild(hint);
    }
    const resetButton = createElement("button", "btx-yt-ab-loop-reset");
    resetButton.type = "button";
    resetButton.textContent = "초기화";
    const footer = createElement("div", "btx-yt-ab-loop-footer");
    append(footer, hints, resetButton);

    append(panel, header, modes, abSection, footer);

    return {
      panel,
      refs: {
        toggle,
        toggleLabel,
        modeFull,
        modeAb,
        abSection,
        footer,
        cardA: cardA.card,
        cardB: cardB.card,
        valueA: cardA.value,
        valueB: cardB.value,
        setA: cardA.setButton,
        setB: cardB.setButton,
        clearA: cardA.clearButton,
        clearB: cardB.clearButton,
        rail,
        progress,
        range,
        thumbA,
        thumbB,
        playhead,
        duration,
        resetButton
      }
    };
  }

  function ensureStyles(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function isYouTubeWatchPage(): boolean {
    const host = location.hostname.toLowerCase();
    if (!(host === "youtube.com" || host.endsWith(".youtube.com"))) return false;
    return location.pathname === "/watch" || location.pathname.startsWith("/watch/");
  }

  function getPlayerElements(): { controls: Element; player: HTMLElement; video: HTMLVideoElement } | null {
    const candidates: { controls: Element; player: HTMLElement; video: HTMLVideoElement }[] = [];
    for (const player of document.querySelectorAll<HTMLElement>("#movie_player,.html5-video-player")) {
      if (player.closest("[hidden],[inert],[aria-hidden='true']") || !player.getClientRects().length ||
          getComputedStyle(player).visibility === "hidden") continue;
      // Never combine the first controls on the page with a video from another player.
      const belongs = (element: Element) => element.closest("#movie_player,.html5-video-player") === player;
      const controls = [...player.querySelectorAll(".ytp-right-controls")].filter(belongs);
      const allVideos = [...player.querySelectorAll<HTMLVideoElement>("video")].filter(belongs);
      const mainVideos = allVideos.filter(video => video.matches(".html5-main-video"));
      const videos = mainVideos.length ? mainVideos : allVideos;
      if (controls.length !== 1 || videos.length !== 1) continue;
      candidates.push({ controls: controls[0], player, video: videos[0] });
    }
    return candidates.length === 1 ? candidates[0] : null;
  }

  function formatTime(seconds: number | null): string {
    if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return EMPTY_TIME;
    const wholeSeconds = Math.floor(seconds);
    const hours = Math.floor(wholeSeconds / 3600);
    const minutes = Math.floor((wholeSeconds % 3600) / 60);
    const remainder = wholeSeconds % 60;
    const pad = (value: number) => String(value).padStart(2, "0");
    return hours > 0
      ? `${hours}:${pad(minutes)}:${pad(remainder)}`
      : `${pad(minutes)}:${pad(remainder)}`;
  }

  function parseTime(value: string): number | null {
    const match = String(value).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const hasHours = match[1] != null;
    const hours = hasHours ? Number(match[1]) : 0;
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
    if (seconds >= 60 || (hasHours && minutes >= 60)) return null;
    return hours * 3600 + minutes * 60 + seconds;
  }

  function finiteDuration(video: HTMLVideoElement): number {
    const duration = Number(video.duration);
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  }

  function clampTimeToVideo(video: HTMLVideoElement, value: number): number {
    const duration = finiteDuration(video);
    const maximum = duration > 0 ? duration : Number.MAX_SAFE_INTEGER;
    return Math.max(0, Math.min(maximum, Number.isFinite(value) ? value : 0));
  }

  function setPoint(current: Session, point: LoopPoint, value: number): void {
    const time = clampTimeToVideo(current.video, value);
    if (point === "a") {
      current.pointA = time;
      current.refs.valueA.textContent = formatTime(time);
      current.refs.cardA.dataset.set = "true";
      current.refs.thumbA.dataset.visible = "true";
      current.refs.thumbA.setAttribute("aria-valuenow", String(time));
      current.refs.thumbA.setAttribute("aria-valuetext", formatTime(time));
    } else {
      current.pointB = time;
      current.refs.valueB.textContent = formatTime(time);
      current.refs.cardB.dataset.set = "true";
      current.refs.thumbB.dataset.visible = "true";
      current.refs.thumbB.setAttribute("aria-valuenow", String(time));
      current.refs.thumbB.setAttribute("aria-valuetext", formatTime(time));
    }
    current.lastRangeLow = -1;
    current.lastRangeHigh = -1;
    scheduleFrame(current);
  }

  function clearPoint(current: Session, point: LoopPoint): void {
    if (point === "a") {
      current.pointA = null;
      current.refs.valueA.textContent = EMPTY_TIME;
      current.refs.cardA.dataset.set = "false";
      current.refs.thumbA.dataset.visible = "false";
      current.refs.thumbA.removeAttribute("aria-valuenow");
      current.refs.thumbA.removeAttribute("aria-valuetext");
    } else {
      current.pointB = null;
      current.refs.valueB.textContent = EMPTY_TIME;
      current.refs.cardB.dataset.set = "false";
      current.refs.thumbB.dataset.visible = "false";
      current.refs.thumbB.removeAttribute("aria-valuenow");
      current.refs.thumbB.removeAttribute("aria-valuetext");
    }
    current.lastRangeLow = -1;
    current.lastRangeHigh = -1;
    scheduleFrame(current);
  }

  function setCurrentPositionAsPoint(current: Session, point: LoopPoint): void {
    setPoint(current, point, current.video.currentTime);
  }

  function setLoopEnabled(current: Session, enabled: boolean): void {
    if (current.loopEnabled === enabled) return;
    if (enabled && (current.player.matches(".ad-showing,.ad-interrupting") || current.video.readyState < HTMLMediaElement.HAVE_METADATA)) {
      current.refs.toggleLabel.textContent = "본 영상이 준비된 뒤 반복을 켜세요";
      return;
    }
    current.replayGeneration++;
    current.loopEnabled = enabled;
    current.refs.toggle.setAttribute("aria-pressed", String(enabled));
    current.refs.toggleLabel.textContent = enabled ? "반복 켜짐" : "반복 꺼짐";
    current.button.dataset.loopEnabled = String(enabled);

    if (enabled) {
      current.sourceAtEnable = current.video.currentSrc || current.video.getAttribute("src") || "";
      current.videoKeyAtEnable = new URL(location.href).searchParams.get("v") || "";
      current.sourceSuspended = current.player.matches(".ad-showing,.ad-interrupting") || !current.sourceAtEnable;
      current.originalNativeLoop = current.video.loop;
      current.nativeLoopOverridden = true;
      try { current.video.loop = false; } catch { /* Ignore a transient detached media element. */ }
      scheduleFrame(current);
    } else {
      restoreNativeLoop(current);
    }
  }

  function restoreNativeLoop(current: Session): void {
    if (!current.nativeLoopOverridden) return;
    // Do not restore the main video's loop flag onto an ad/new media source.
    // The media listener can finish restoration when that exact source returns.
    const source = current.video.currentSrc || current.video.getAttribute("src") || "";
    if (source !== current.sourceAtEnable || current.player.matches(".ad-showing,.ad-interrupting") ||
        (new URL(location.href).searchParams.get("v") || "") !== current.videoKeyAtEnable) return;
    try { if (!current.video.loop) current.video.loop = current.originalNativeLoop; } catch { /* Ignore a detached media element. */ }
    current.nativeLoopOverridden = false;
  }

  function setMode(current: Session, mode: LoopMode): void {
    current.replayGeneration++;
    current.mode = mode;
    const abMode = mode === "ab";
    current.refs.modeAb.setAttribute("aria-pressed", String(abMode));
    current.refs.modeFull.setAttribute("aria-pressed", String(!abMode));
    current.refs.abSection.hidden = !abMode;
    current.refs.footer.hidden = !abMode;
    current.lastRangeLow = -1;
    current.lastRangeHigh = -1;
    scheduleFrame(current);
  }

  function setPanelOpen(current: Session, open: boolean): void {
    current.panelOpen = open;
    current.panel.dataset.open = String(open);
    current.panel.setAttribute("aria-hidden", String(!open));
    current.button.setAttribute("aria-expanded", String(open));
    if (open) {
      current.lastProgressPercent = -1;
      current.lastDuration = -1;
      current.lastRangeLow = -1;
      current.lastRangeHigh = -1;
      scheduleFrame(current);
    }
  }

  function fractionFromClientX(current: Session, clientX: number): number {
    const rectangle = current.refs.rail.getBoundingClientRect();
    if (rectangle.width <= 0) return 0;
    return Math.max(0, Math.min(1, (clientX - rectangle.left) / rectangle.width));
  }

  function updateTimeline(current: Session): void {
    const duration = finiteDuration(current.video);
    if (duration !== current.lastDuration) {
      current.refs.duration.textContent = formatTime(duration || null);
      current.refs.playhead.setAttribute("aria-valuemax", String(duration));
      current.refs.thumbA.setAttribute("aria-valuemax", String(duration));
      current.refs.thumbB.setAttribute("aria-valuemax", String(duration));
      current.lastDuration = duration;
    }

    const playbackPosition = Number.isFinite(current.video.currentTime) ? Math.max(0, current.video.currentTime) : 0;
    const percentage = duration > 0 ? Math.max(0, Math.min(100, playbackPosition / duration * 100)) : 0;
    if (percentage !== current.lastProgressPercent) {
      current.refs.progress.style.width = `${percentage}%`;
      current.refs.playhead.style.left = `${percentage}%`;
      current.refs.playhead.setAttribute("aria-valuenow", String(playbackPosition));
      current.refs.playhead.setAttribute("aria-valuetext", formatTime(playbackPosition));
      current.lastProgressPercent = percentage;
    }

    if (current.pointA != null && duration > 0) {
      current.refs.thumbA.style.left = `${Math.max(0, Math.min(100, current.pointA / duration * 100))}%`;
    }
    if (current.pointB != null && duration > 0) {
      current.refs.thumbB.style.left = `${Math.max(0, Math.min(100, current.pointB / duration * 100))}%`;
    }

    const bothPointsSet = current.pointA != null && current.pointB != null;
    if (current.mode === "ab" && bothPointsSet && duration > 0) {
      const low = Math.min(current.pointA as number, current.pointB as number);
      const high = Math.max(current.pointA as number, current.pointB as number);
      if (low !== current.lastRangeLow || high !== current.lastRangeHigh) {
        current.refs.range.style.left = `${Math.max(0, Math.min(100, low / duration * 100))}%`;
        current.refs.range.style.width = `${Math.max(0, Math.min(100, (high - low) / duration * 100))}%`;
        current.refs.range.dataset.visible = "true";
        current.lastRangeLow = low;
        current.lastRangeHigh = high;
      }
    } else if (current.refs.range.dataset.visible !== "false") {
      current.refs.range.dataset.visible = "false";
      current.lastRangeLow = -1;
      current.lastRangeHigh = -1;
    }
  }

  function loopContextReady(current: Session): boolean {
    const source = current.video.currentSrc || current.video.getAttribute("src") || "";
    const key = new URL(location.href).searchParams.get("v") || "";
    const duration = finiteDuration(current.video);
    const validRange = current.mode !== "ab" || current.pointA === null || current.pointB === null ||
      (Math.min(current.pointA, current.pointB) >= 0 && Math.max(current.pointA, current.pointB) <= duration);
    const ready = !current.player.matches(".ad-showing,.ad-interrupting") && current.video.readyState >= HTMLMediaElement.HAVE_METADATA &&
      !!source && source === current.sourceAtEnable && key === current.videoKeyAtEnable && validRange;
    current.sourceSuspended = !ready;
    if (current.loopEnabled) current.refs.toggleLabel.textContent = ready ? "반복 켜짐" : "반복 대기 · 본 영상 확인 필요";
    return ready;
  }

  function failLoop(current: Session, error: unknown): void {
    if (session !== current || current.abortController.signal.aborted) return;
    setLoopEnabled(current, false);
    current.refs.toggleLabel.textContent = `반복 중단: ${ToolboxShared.errorMessage(error)}`;
  }

  function rewindLoop(current: Session, target: number): void {
    // Natural completion pauses the element. A user-paused seek does not authorize play().
    const ended = current.video.ended;
    current.video.currentTime = target;
    if (!ended) return;
    const generation = ++current.replayGeneration;
    const source = current.sourceAtEnable;
    void current.video.play().catch(error => {
      if (session === current && current.loopEnabled && current.replayGeneration === generation &&
          (current.video.currentSrc || current.video.getAttribute("src") || "") === source) failLoop(current, error);
    });
  }

  function enforceLoop(current: Session): void {
    if (!current.loopEnabled || !current.video.isConnected || !loopContextReady(current)) return;
    try {
      if (current.video.loop) {
        // The native loop flag changed after we set it to false. Yield ownership
        // instead of repeatedly undoing another control's observed request.
        setLoopEnabled(current, false);
        current.refs.toggleLabel.textContent = "YouTube 기본 반복으로 전환됨";
        return;
      }
      if (current.mode === "ab" && current.pointA != null && current.pointB != null) {
        const low = Math.min(current.pointA, current.pointB);
        const high = Math.max(current.pointA, current.pointB);
        if (high - low <= 0.001) return;
        const now = current.video.currentTime;
        if (Number.isFinite(now) && (now >= high || now < low)) rewindLoop(current, low);
      } else if (current.mode === "full" && finiteDuration(current.video) > 0 && current.video.ended) {
        // No early-end margin: the final frames/audio belong to the full video too.
        rewindLoop(current, 0);
      }
    } catch (error) { failLoop(current, error); }
  }

  function scheduleFrame(current: Session): void {
    if (current.animationFrame || session !== current) return;
    current.animationFrame = requestAnimationFrame(() => renderFrame(current));
  }

  function renderFrame(current: Session): void {
    current.animationFrame = 0;
    if (session !== current || current.abortController.signal.aborted) return;

    try {
      if (current.panelOpen) updateTimeline(current);
      if (current.loopEnabled) enforceLoop(current);
    } catch (error) {
      failLoop(current, error);
    }

    if (!current.video.paused && !current.video.ended &&
        ((current.panelOpen && document.visibilityState !== "hidden") || (current.loopEnabled && !current.sourceSuspended))) scheduleFrame(current);
  }

  function beginPointerDrag(
    current: Session,
    element: HTMLElement,
    event: PointerEvent,
    apply: (clientX: number) => void
  ): void {
    if (!event.isTrusted || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    current.drag = {
      pointerId: event.pointerId,
      element,
      apply,
      moved: false,
      startX: event.clientX
    };
    try { element.setPointerCapture(event.pointerId); } catch { /* Pointer capture is optional. */ }
  }

  function movePointerDrag(current: Session, event: PointerEvent): void {
    const drag = current.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (Math.abs(event.clientX - drag.startX) >= 2) drag.moved = true;
    drag.apply(event.clientX);
    scheduleFrame(current);
  }

  function finishPointerDrag(current: Session, event: PointerEvent): void {
    const drag = current.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (drag.moved) current.suppressRailClickUntil = performance.now() + 150;
    try { drag.element.releasePointerCapture(event.pointerId); } catch { /* Ignore. */ }
    current.drag = null;
  }

  function wireTimeline(current: Session): void {
    const pointAFromX = (clientX: number) => {
      const duration = finiteDuration(current.video);
      if (duration > 0) setPoint(current, "a", fractionFromClientX(current, clientX) * duration);
    };
    const pointBFromX = (clientX: number) => {
      const duration = finiteDuration(current.video);
      if (duration > 0) setPoint(current, "b", fractionFromClientX(current, clientX) * duration);
    };
    const seekFromX = (clientX: number) => {
      const duration = finiteDuration(current.video);
      if (duration > 0) current.video.currentTime = fractionFromClientX(current, clientX) * duration;
    };

    current.refs.thumbA.addEventListener("pointerdown", (event) => beginPointerDrag(current, current.refs.thumbA, event, pointAFromX));
    current.refs.thumbB.addEventListener("pointerdown", (event) => beginPointerDrag(current, current.refs.thumbB, event, pointBFromX));
    current.refs.playhead.addEventListener("pointerdown", (event) => beginPointerDrag(current, current.refs.playhead, event, seekFromX));

    document.addEventListener("pointermove", (event) => movePointerDrag(current, event), {
      capture: true,
      signal: current.abortController.signal
    });
    document.addEventListener("pointerup", (event) => finishPointerDrag(current, event), {
      capture: true,
      signal: current.abortController.signal
    });
    document.addEventListener("pointercancel", (event) => finishPointerDrag(current, event), {
      capture: true,
      signal: current.abortController.signal
    });

    current.refs.rail.addEventListener("click", (event) => {
      if (!event.isTrusted || current.drag || performance.now() < current.suppressRailClickUntil) return;
      seekFromX(event.clientX);
      scheduleFrame(current);
    });
  }

  function editPointTime(current: Session, point: LoopPoint): void {
    const valueElement = point === "a" ? current.refs.valueA : current.refs.valueB;
    if (valueElement.dataset.editing === "true") return;
    const currentValue = point === "a" ? current.pointA : current.pointB;

    const input = createElement("input", "btx-yt-ab-loop-time-input");
    input.type = "text";
    input.inputMode = "numeric";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.value = currentValue != null ? formatTime(currentValue) : "";
    input.placeholder = "m:ss";
    input.setAttribute("aria-label", `${point.toUpperCase()} 지점 시간 입력`);

    valueElement.dataset.editing = "true";
    valueElement.hidden = true;
    valueElement.insertAdjacentElement("afterend", input);
    input.focus();
    input.select();

    let finished = false;
    const restoreText = () => {
      const value = point === "a" ? current.pointA : current.pointB;
      valueElement.textContent = value != null ? formatTime(value) : EMPTY_TIME;
    };
    const closeEditor = () => {
      input.remove();
      valueElement.hidden = false;
      delete valueElement.dataset.editing;
    };
    const finish = (commit: boolean) => {
      if (finished) return;
      finished = true;
      if (commit) {
        const raw = input.value.trim();
        if (!raw) {
          clearPoint(current, point);
          closeEditor();
          return;
        }
        const parsed = parseTime(raw);
        if (parsed != null) {
          setPoint(current, point, parsed);
          closeEditor();
          return;
        }
      }
      restoreText();
      closeEditor();
    };

    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("pointerdown", (event) => event.stopPropagation());
  }


  function wireSession(current: Session): void {
    current.button.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      event.preventDefault();
      event.stopPropagation();
      setPanelOpen(current, !current.panelOpen);
    });

    current.panel.addEventListener("click", (event) => event.stopPropagation());
    current.panel.addEventListener("pointerdown", (event) => event.stopPropagation());
    current.panel.addEventListener("dblclick", (event) => event.stopPropagation());

    document.addEventListener("click", (event) => {
      if (!event.isTrusted || !current.panelOpen) return;
      const target = event.target as Node | null;
      if (target && (current.panel.contains(target) || current.button.contains(target))) return;
      setPanelOpen(current, false);
    }, { signal: current.abortController.signal });

    const onTrustedClick = (element: HTMLElement, action: () => void) => {
      element.addEventListener("click", (event) => {
        if (!event.isTrusted) return;
        action();
      });
    };

    onTrustedClick(current.refs.toggle, () => setLoopEnabled(current, !current.loopEnabled));
    onTrustedClick(current.refs.modeFull, () => setMode(current, "full"));
    onTrustedClick(current.refs.modeAb, () => setMode(current, "ab"));
    onTrustedClick(current.refs.setA, () => setCurrentPositionAsPoint(current, "a"));
    onTrustedClick(current.refs.setB, () => setCurrentPositionAsPoint(current, "b"));
    onTrustedClick(current.refs.clearA, () => clearPoint(current, "a"));
    onTrustedClick(current.refs.clearB, () => clearPoint(current, "b"));
    onTrustedClick(current.refs.valueA, () => editPointTime(current, "a"));
    onTrustedClick(current.refs.valueB, () => editPointTime(current, "b"));
    const wireTimeKeyboardActivation = (element: HTMLElement, point: LoopPoint) => {
      element.addEventListener("keydown", (event) => {
        if (!event.isTrusted || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        event.stopPropagation();
        editPointTime(current, point);
      });
    };
    wireTimeKeyboardActivation(current.refs.valueA, "a");
    wireTimeKeyboardActivation(current.refs.valueB, "b");
    onTrustedClick(current.refs.resetButton, () => {
      clearPoint(current, "a");
      clearPoint(current, "b");
      setLoopEnabled(current, false);
      setMode(current, "ab");
    });

    wireTimeline(current);

    document.addEventListener("keydown", (event) => {
      if (!event.isTrusted || event.defaultPrevented || event.repeat || event.isComposing) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (ToolboxShared.keyboardInputContext(event) || (event.target instanceof Element && event.target.closest("[data-browser-toolbox-synced-caption-overlay],[data-btx-media-control]"))) return;
      if (!shortcutsReady || shortcutSettings[ToolboxShared.AB_ENABLED_KEY] === false) return;
      const mediaKeysEnabled = shortcutSettings.mediaControllerEnabled === true && shortcutSettings.mediaKeyboardEnabled !== false;
      const bindings = ToolboxShared.shortcutBindings(shortcutSettings, event.code, mediaKeysEnabled, true);
      if (bindings.length !== 1) return; // Never depend on listener registration order when existing settings collide.
      if (bindings[0].command === "loopA") setCurrentPositionAsPoint(current, "a");
      else if (bindings[0].command === "loopB") setCurrentPositionAsPoint(current, "b");
      else return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true, signal: current.abortController.signal });

    const update = () => {
      if (!current.loopEnabled && current.nativeLoopOverridden) restoreNativeLoop(current);
      if (current.loopEnabled) {
        // timeupdate/ended remain available when background rAF is suspended.
        // Never seek on metadata/emptied until the original source is confirmed.
        enforceLoop(current);
      }
      if (current.panelOpen || (current.loopEnabled && !current.sourceSuspended)) scheduleFrame(current);
    };
    current.mediaObserver = new MutationObserver(update);
    current.mediaObserver.observe(current.player, { attributes: true, attributeFilter: ["class"] });
    current.mediaObserver.observe(current.video, { attributes: true, attributeFilter: ["loop"] });
    document.addEventListener("visibilitychange", update, { signal: current.abortController.signal });
    for (const type of ["loadedmetadata", "durationchange", "timeupdate", "seeking", "seeked", "emptied", "play", "playing", "pause", "ended"] as const) {
      current.video.addEventListener(type, update, { signal: current.abortController.signal });
    }
  }

  function mount(): boolean {
    if (lifecycleSuspended || !isYouTubeWatchPage()) return false;

    const elements = getPlayerElements();
    if (!elements) return false;

    if (
      session &&
      session.button.isConnected &&
      session.panel.isConnected &&
      session.video === elements.video &&
      session.controls === elements.controls &&
      session.player === elements.player
    ) {
      return true;
    }

    teardownSession();
    document.getElementById(BUTTON_ID)?.remove();
    document.getElementById(PANEL_ID)?.remove();
    ensureStyles();

    const button = createElement("button", "ytp-button btx-yt-ab-loop-button", BUTTON_ID);
    button.type = "button";
    button.title = "A/B 반복";
    button.setAttribute("aria-label", "A/B 반복 설정 열기");
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.dataset.loopEnabled = "false";
    const dot = createElement("span", "btx-yt-ab-loop-dot");
    append(button, buildToolbarIcon(), dot);

    const { panel, refs } = buildPanel();

    try {
      elements.controls.insertBefore(button, elements.controls.firstChild);
    } catch {
      elements.controls.appendChild(button);
    }

    const originalPlayerInlinePosition = elements.player.style.position;
    const originalPlayerInlinePositionPriority = elements.player.style.getPropertyPriority("position");
    let playerPositionWasChanged = false;
    try {
      if (getComputedStyle(elements.player).position === "static") {
        elements.player.style.position = "relative";
        playerPositionWasChanged = true;
      }
    } catch {
      // The YouTube player normally already establishes an absolute-position containing block.
    }
    elements.player.appendChild(panel);

    const current: Session = {
      video: elements.video,
      controls: elements.controls,
      player: elements.player,
      button,
      panel,
      refs,
      pointA: null,
      pointB: null,
      loopEnabled: false,
      replayGeneration: 0,
      mode: "ab",
      panelOpen: false,
      animationFrame: 0,
      abortController: new AbortController(),
      drag: null,
      originalNativeLoop: elements.video.loop,
      sourceAtEnable: "", videoKeyAtEnable: "", sourceSuspended: false, mediaObserver: null,
      nativeLoopOverridden: false,
      playerPositionWasChanged,
      originalPlayerInlinePosition,
      originalPlayerInlinePositionPriority,
      lastProgressPercent: -1,
      lastDuration: -1,
      lastRangeLow: -1,
      lastRangeHigh: -1,
      suppressRailClickUntil: 0
    };

    session = current;
    refreshShortcutHints();
    wireSession(current);
    clearRetryTimer();
    stopControlsObserver();
    return true;
  }

  function teardownSession(): void {
    const current = session;
    if (!current) return;
    session = null;

    if (current.animationFrame) {
      cancelAnimationFrame(current.animationFrame);
      current.animationFrame = 0;
    }
    current.mediaObserver?.disconnect();
    restoreNativeLoop(current);
    try { current.abortController.abort(); } catch { /* Ignore. */ }
    try { current.button.remove(); } catch { /* Ignore. */ }
    try { current.panel.remove(); } catch { /* Ignore. */ }
    if (current.playerPositionWasChanged && current.player.isConnected &&
        current.player.style.position === "relative" && !current.player.style.getPropertyPriority("position")) {
      try { current.player.style.setProperty("position", current.originalPlayerInlinePosition, current.originalPlayerInlinePositionPriority); } catch { /* Ignore. */ }
    }
  }

  function clearRetryTimer(): void {
    if (!retryTimer) return;
    clearTimeout(retryTimer);
    retryTimer = 0;
  }

  function stopControlsObserver(): void {
    mutationObserver?.disconnect();
    mutationObserver = null;
  }

  function sessionMatchesCurrentPlayer(current: Session): boolean {
    if (!isYouTubeWatchPage()) return false;
    if (!current.button.isConnected || !current.panel.isConnected || !current.video.isConnected) return false;
    const elements = getPlayerElements();
    return Boolean(
      elements &&
      elements.video === current.video &&
      elements.controls === current.controls &&
      elements.player === current.player
    );
  }

  function startControlsObserver(): void {
    if (lifecycleSuspended || mutationObserver || session || !isYouTubeWatchPage()) return;
    const root = document.body || document.documentElement;
    if (!root) return;

    mutationObserver = new MutationObserver(() => {
      if (session || !isYouTubeWatchPage() || !getPlayerElements()) return;
      if (!mount()) return;
      retryCount = 0;
      clearRetryTimer();
      stopControlsObserver();
    });
    mutationObserver.observe(root, { childList: true, subtree: true });
  }

  function scheduleMount(delay = 0): void {
    if (lifecycleSuspended || retryTimer || session || !isYouTubeWatchPage()) return;
    retryTimer = window.setTimeout(() => {
      retryTimer = 0;
      if (lifecycleSuspended || session || !isYouTubeWatchPage()) return;

      startControlsObserver();
      if (mount()) {
        retryCount = 0;
        clearRetryTimer();
        stopControlsObserver();
        return;
      }

      retryCount += 1;
      if (retryCount <= MAX_RETRY_COUNT) scheduleMount(RETRY_INTERVAL_MS);
    }, Math.max(0, delay));
  }

  function restartForCurrentLocation(delay = NAVIGATION_SETTLE_MS): void {
    clearRetryTimer();
    stopControlsObserver();
    teardownSession();
    retryCount = 0;
    lastHref = location.href;
    updateUrlWatchdog();
    if (!isYouTubeWatchPage()) return;
    startControlsObserver();
    scheduleMount(delay);
  }

  function scheduleNavigationRefresh(delay = NAVIGATION_SETTLE_MS): void {
    if (lifecycleSuspended) return;
    if (navigationTimer) clearTimeout(navigationTimer);
    navigationTimer = window.setTimeout(() => {
      navigationTimer = 0;
      restartForCurrentLocation(delay);
    }, 50);
  }

  function handleNavigationStart(): void {
    if (urlCheckTimer) { clearTimeout(urlCheckTimer); urlCheckTimer = 0; }
    if (navigationTimer) {
      clearTimeout(navigationTimer);
      navigationTimer = 0;
    }
    clearRetryTimer();
    stopControlsObserver();
    teardownSession();
    retryCount = 0;
  }

  function startTracking(): void {
    document.addEventListener("yt-navigate-start", handleNavigationStart, {
      capture: true,
      signal: lifetimeAbortController.signal
    });
    document.addEventListener("yt-navigate-finish", () => scheduleNavigationRefresh(), {
      capture: true,
      signal: lifetimeAbortController.signal
    });
    window.addEventListener("popstate", () => scheduleNavigationRefresh(), {
      capture: true,
      signal: lifetimeAbortController.signal
    });
    window.addEventListener("pageshow", () => { lifecycleSuspended = false; scheduleNavigationRefresh(0); }, {
      capture: true,
      signal: lifetimeAbortController.signal
    });
    window.addEventListener("pagehide", () => {
      lifecycleSuspended = true;
      if (navigationTimer) { clearTimeout(navigationTimer); navigationTimer = 0; }
      if (urlCheckTimer) { clearTimeout(urlCheckTimer); urlCheckTimer = 0; }
      clearRetryTimer();
      stopControlsObserver();
      teardownSession();
    }, {
      capture: true,
      signal: lifetimeAbortController.signal
    });

    document.addEventListener("visibilitychange", () => {
      updateUrlWatchdog();
      if (document.visibilityState !== "visible") return;
      if (location.href !== lastHref || (session && !sessionMatchesCurrentPlayer(session))) scheduleNavigationRefresh(0);
      else if (!session) { startControlsObserver(); scheduleMount(0); }
    }, { signal: lifetimeAbortController.signal });
    updateUrlWatchdog();
  }

  function updateUrlWatchdog(): void {
    if (urlCheckTimer) { clearTimeout(urlCheckTimer); urlCheckTimer = 0; }
    if (lifecycleSuspended || lifetimeAbortController.signal.aborted || document.visibilityState === "hidden" || !isYouTubeWatchPage()) return;
    urlCheckTimer = window.setTimeout(() => {
      urlCheckTimer = 0;
      updateUrlWatchdog();
      if (location.href !== lastHref) {
        scheduleNavigationRefresh();
        return;
      }

      if (session && !sessionMatchesCurrentPlayer(session)) {
        restartForCurrentLocation(0);
        return;
      }

      if (!session && isYouTubeWatchPage() && !retryTimer) {
        startControlsObserver();
        scheduleMount();
      }
    }, URL_CHECK_INTERVAL_MS);
  }

  function destroy(): void {
    teardownSession();
    clearRetryTimer();
    stopControlsObserver();
    if (navigationTimer) {
      clearTimeout(navigationTimer);
      navigationTimer = 0;
    }
    if (urlCheckTimer) {
      clearTimeout(urlCheckTimer);
      urlCheckTimer = 0;
    }
    try { lifetimeAbortController.abort(); } catch { /* Ignore. */ }
    chrome.storage?.onChanged?.removeListener(onShortcutStorageChange);
    document.getElementById(STYLE_ID)?.remove();
    delete (globalThis as any)[CONTROLLER_KEY];
  }

  (globalThis as any)[CONTROLLER_KEY] = Object.freeze({ destroy });
  chrome.storage?.onChanged?.addListener(onShortcutStorageChange);
  loadShortcutSettings();
  startTracking();
  restartForCurrentLocation(0);
})();
