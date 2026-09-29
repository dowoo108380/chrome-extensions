/** Optional watch-page layout. Operates on existing DOM only; no private YouTube state or API calls. */
(() => {
  "use strict";
  const KEY = "__browserToolboxYouTubeLayoutV1__";
  const w = globalThis as unknown as Record<string, unknown>;
  if (w[KEY]) return;
  function isYouTubePage(): boolean {
    return location.protocol === "https:" && ["www.youtube.com", "youtube.com"].includes(location.hostname) && window.top === window;
  }
  function isWatchPage(): boolean { return Boolean(watchVideoKey()); }
  function watchVideoKey(): string {
    if (location.pathname === "/watch") return new URL(location.href).searchParams.get("v") || "";
    return /^\/live\/([A-Za-z0-9_-]+)\/?$/.exec(location.pathname)?.[1] || "";
  }
  if (!isYouTubePage()) return;

  type TabName = "info" | "comments" | "chat" | "playlist" | "videos";
  const TAB_ORDER: readonly TabName[] = ["info", "comments", "chat", "playlist", "videos"];
  type RecordNode = { node: HTMLElement; marker: Comment; parent: HTMLElement; pane: HTMLElement; priorOwner: string | null; initialRelocationAvailable: boolean };
  type SectionState = { state: "mounted" | "waiting" | "absent" | "ambiguous" | "protected"; reason: string; candidates: number };
  type Discovery = { node: HTMLElement | null; details: SectionState };
  type NativePlayerReference = { player: HTMLElement; video: HTMLVideoElement; controls: HTMLElement;
    progress: HTMLElement | null; row: HTMLElement; originalWidth: number; originalHeight: number; left: number; right: number; bottom: number;
    progressLeft: number; progressRight: number; rowLeft: number; rowRight: number };
  type NativeWidthState = { sample: number[] | null; sampleChangedAt: number; phase: "idle" | "settling" | "accepted" | "unconfirmed" | "blocked"; established: boolean;
    reference: NativePlayerReference | null; timeout: number; reason: string;
    notification: { player: HTMLElement; width: number; height: number; ready: boolean } | null; notifications: number };
  type Session = { watch: HTMLElement; secondary: HTMLElement; videoKey: string; host: HTMLElement; body: HTMLElement; note: HTMLElement; issueNote: HTMLElement;
    selected: TabName; buttons: Map<TabName, HTMLButtonElement>; panes: Map<TabName, HTMLElement>; records: Map<TabName, RecordNode>;
    sections: Map<TabName, SectionState>; scrollPositions: Map<TabName, number>; renderedTab: TabName | null;
    nativeSignature: string; manuallyOpened: boolean; ac: AbortController; resizeObserver: ResizeObserver; modeObserver: MutationObserver;
    sizingObserver: ResizeObserver; sizingNodes: Set<HTMLElement>; sizingChecks: number;
    nativeWidth: NativeWidthState;
    flowNodes: Map<HTMLElement, string | null>; flowReason: string;
    widthNodes: Map<HTMLElement, string | null>; widthReason: string;
    ambientNodes: Map<HTMLElement, string | null>; ambientReason: string;
    theater: boolean; relocationAllowed: Set<TabName>; relocationCount: number;
    playlistScroll: { top: number; left: number } | null; restoreScrollPending: boolean; scrollQuiet: boolean };
  type LayoutBookmark = { watch: HTMLElement; videoKey: string; selected: TabName;
    scrollPositions: Map<TabName, number>; playlistScroll: { top: number; left: number } | null };
  type Expansion = { node: HTMLElement; initiallyExpanded: boolean; requested: boolean; confirmed: boolean; userTouched: boolean;
    sentAt: number; attempts: number; videoKey: string; resizeObserver: ResizeObserver };
  type MoveParent = HTMLElement & { moveBefore?: (node: Node, before: Node | null) => void };
  let settings = { ...ToolboxShared.YOUTUBE_DEFAULTS };
  const settingsJournal = new ToolboxShared.SettingsReadJournal(Object.keys(ToolboxShared.YOUTUBE_DEFAULTS));
  let session: Session | null = null;
  // Page-width policy outlives video-specific section records. Ownership stays
  // with this exact watch surface; navigation never transfers it to another one.
  type CarriedWidth = Pick<Session, "watch" | "widthNodes" | "nativeWidth">;
  let carriedWidth: CarriedWidth | null = null;
  let expansion: Expansion | null = null;
  // A user's decision belongs to this video, not to a replaceable DOM element.
  let descriptionUserVideo: string | null = null;
  let markedWatch: HTMLElement | null = null;
  let observer: MutationObserver | null = null;
  // Discovery must also work BEFORE a session exists. A stylesheet/ancestor can
  // reveal the watch/sidebar without inserting any child or resizing the window.
  let readinessObserver: ResizeObserver | null = null;
  const readinessNodes = new Set<HTMLElement>();
  let navigationOrigin: { watch: HTMLElement | null; videoKey: string; nativeVideoKey: string } | null = null;
  let lastLifecycleEvent = "initial-load";
  let blockedVideoKey = "";
  let blockedSecondary: HTMLElement | null = null;
  let blockedAmbiguousSection: TabName | null = null;
  type FailureCode = "move-api-unavailable" | "move-precondition-changed" | "move-threw" | "move-result-changed" | "repeated-native-relocation" | "unverified-native-target" | "panel-context-changed" | "section-conflict" | "unexpected-error";
  class LayoutFailure extends Error {
    constructor(readonly code: FailureCode, message: string) { super(message); }
  }
  let failureStage = "none", failureSection: TabName | null = null;
  let lastFailure: { code: FailureCode; stage: string; section: TabName | null; errorName: string; message: string; documentReadyState: string; documentVisible: boolean; sourceConnected: boolean | null; targetConnected: boolean | null } | null = null;
  let moveSource: HTMLElement | null = null, moveTarget: HTMLElement | null = null;
  let committedWatch: HTMLElement | null = null, committedVideo = "";

  class SectionConflict extends Error {
    constructor(readonly section: TabName, message: string) { super(message); }
  }
  let timer = 0, expansionTimer = 0, resizeFrame = 0, sizingFrame = 0, settingsEpoch = 0;
  let suspended = false, navigating = false, blockedWatch: HTMLElement | null = null;
  // A conflict is stopped for the current mode, not for the entire watch page.
  // A real normal/theater boundary may resume it; unrelated DOM mutations may not.
  let blockedTheater: boolean | null = null;
  let bookmark: LayoutBookmark | null = null;
  let lastIssue = "", lastDescriptionIssue = "";
  let reconciliations = 0;
  const RECOMMENDATION_RENDERER = "ytd-watch-next-secondary-results-renderer";
  const PLAYLIST_RENDERER = "ytd-playlist-panel-renderer";
  const CHAT_RENDERER = "ytd-live-chat-frame#chat";
  const NATIVE_PANELS = "ytd-live-chat-frame,ytd-playlist-panel-renderer,ytd-engagement-panel-section-list-renderer";
  const PLAYER_SHELLS = "#player,#player-container-outer,#player-container-inner,#ytd-player,ytd-player,#movie_player";
  const DESCRIPTION_EXPANDERS = "ytd-text-inline-expander,ytd-expander";
  const DESCRIPTION_CONTROLS = "#expand,#collapse,#more,#less";
  const DESCRIPTION_BUTTON = "button,[role='button'],tp-yt-paper-button,.button";
  const DESCRIPTION_ATTEMPT_LIMIT = 3;
  const PARTS = "ytd-watch-flexy,#cinematics,#columns,#primary-inner,#below,#primary,#secondary,#secondary-inner,#description,ytd-comments#comments,#related,ytd-watch-next-secondary-results-renderer,ytd-comments-header-renderer,ytd-message-renderer,ytd-text-inline-expander,ytd-expander,ytd-live-chat-frame#chat,ytd-playlist-panel-renderer,ytd-playlist-panel-video-renderer,ytd-playlist-panel-video-wrapper-renderer,ytd-engagement-panel-section-list-renderer,#expand,#collapse,#more,#less";
  const DISCOVERY_PARTS = PARTS + "," + PLAYER_SHELLS + ",.html5-video-container,video.html5-main-video,.ytp-chrome-bottom,iframe#chatframe,#show-hide-button";
  const LABELS: Record<TabName, string> = { info: "정보", comments: "댓글", chat: "실시간 채팅", playlist: "재생목록", videos: "동영상" };
  const LAYOUT_KEYS = ToolboxShared.YOUTUBE_FEATURES.filter(f => f.group === "layout").map(f => f.key);
  const text = (node: Element | null): string => node?.textContent?.replace(/\s+/g, " ").trim() || "";
  const videoKey = (): string => watchVideoKey();
  function chatWatch(watch: HTMLElement): boolean {
    return /^\/live\//.test(location.pathname) || watch.hasAttribute("should-stamp-chat") ||
      Boolean(watch.querySelector("#movie_player.ytp-live")) ||
      [...watch.querySelectorAll<HTMLElement>(CHAT_RENDERER)].some(node =>
        !node.hidden && node.getAttribute("aria-hidden") !== "true" && sectionHasContent("chat", node));
  }
  function requiredTabs(s: Session): readonly TabName[] {
    return ["info", chatWatch(s.watch) ? "chat" : "comments", "videos"];
  }
  function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = ""): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag); if (className) node.className = className; return node;
  }
  function setText(node: Node, value: string): void { if (node.textContent !== value) node.textContent = value; }
  function setAttr(node: Element, key: string, value: string): void { if (node.getAttribute(key) !== value) node.setAttribute(key, value); }
  function rendered(node: HTMLElement): boolean {
    if (!node.isConnected || node.closest("[hidden],[aria-hidden='true']")) return false;
    const style = getComputedStyle(node);
    return style.display !== "none" && style.visibility !== "hidden" && node.getClientRects().length > 0;
  }
  function currentWatch(): HTMLElement | null {
    if (!isWatchPage()) return null;
    const found = [...document.querySelectorAll<HTMLElement>("ytd-watch-flexy")].filter(n => rendered(n));
    if (found.length !== 1) return null;
    // A committed URL is not proof that the reused native watch has its new
    // content yet. Respect a real reflected video-id when it is present.
    const nativeKey = found[0].getAttribute("video-id");
    return nativeKey && nativeKey !== videoKey() ? null : found[0];
  }
  function single(root: HTMLElement, selector: string): HTMLElement | null {
    const found = [...root.querySelectorAll<HTMLElement>(selector)];
    return found.length === 1 ? found[0] : null;
  }
  function sameWatch(node: HTMLElement, watch: HTMLElement): boolean {
    return node.closest("ytd-watch-flexy") === watch && !node.closest("#btx-youtube-tabs,noscript,template");
  }
  function hasRecommendations(node: HTMLElement): boolean {
    // A known recommendations wrapper plus real navigation links is evidence of
    // content. An empty responsive placeholder must not win over the live list.
    for (const link of node.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      try {
        const url = new URL(link.getAttribute("href") || "", "https://www.youtube.com/");
        if (!["https:", "http:"].includes(url.protocol) || !["www.youtube.com", "youtube.com", "m.youtube.com"].includes(url.hostname)) continue;
        if ((url.pathname === "/watch" && url.searchParams.has("v")) ||
            (url.pathname === "/playlist" && url.searchParams.has("list")) ||
            /^\/(shorts|live)\/[^/]+/.test(url.pathname)) return true;
      } catch { /* Invalid href is not evidence of a recommendations list. */ }
    }
    return false;
  }
  function hasPlaylistItems(node: HTMLElement): boolean {
    // Only real playlist items/links in the known native panel are evidence.
    // A URL's list parameter or a text-only placeholder is not enough.
    if (node.querySelector("ytd-playlist-panel-video-renderer,ytd-playlist-panel-video-wrapper-renderer")) return true;
    for (const link of node.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      try {
        const url = new URL(link.getAttribute("href") || "", "https://www.youtube.com/");
        if (["https:", "http:"].includes(url.protocol) &&
            ["www.youtube.com", "youtube.com", "m.youtube.com"].includes(url.hostname) &&
            url.pathname === "/watch" && Boolean(url.searchParams.get("v"))) return true;
      } catch { /* Invalid links are not playlist items. */ }
    }
    return false;
  }
  function sectionHasContent(name: TabName, node: HTMLElement): boolean {
    return name === "videos" ? hasRecommendations(node) : name === "playlist" ? hasPlaylistItems(node) :
      name === "chat" ? Boolean(node.querySelector(":scope > iframe#chatframe,:scope > #show-hide-button")) : true;
  }
  function discover(watch: HTMLElement, name: TabName): Discovery {
    let candidates: HTMLElement[];
    if (name === "videos") {
      const wrappers = [...watch.querySelectorAll<HTMLElement>("#related")].filter(node =>
        sameWatch(node, watch) && Boolean(node.closest("#secondary,#primary")) && !node.closest(NATIVE_PANELS));
      // Nested matching IDs are a single tree, not two independent lists.
      const outerWrappers = wrappers.filter(node => !wrappers.some(parent => parent !== node && parent.contains(node)));
      const renderers = [...watch.querySelectorAll<HTMLElement>(RECOMMENDATION_RENDERER)].filter(node =>
        sameWatch(node, watch) && Boolean(node.closest("#secondary,#primary")) && !node.closest(NATIVE_PANELS) &&
        !outerWrappers.some(parent => parent.contains(node)));
      candidates = [...outerWrappers, ...renderers];
    } else if (name === "playlist") {
      const panels = [...watch.querySelectorAll<HTMLElement>(PLAYLIST_RENDERER)].filter(node =>
        sameWatch(node, watch) && Boolean(node.closest("#secondary,#primary")) &&
        !node.closest("#movie_player,ytd-player,ytd-miniplayer,ytd-watch-metadata,ytd-engagement-panel-section-list-renderer"));
      candidates = panels.filter(node => !panels.some(parent => parent !== node && parent.contains(node)));
    } else if (name === "chat") {
      candidates = [...watch.querySelectorAll<HTMLElement>(CHAT_RENDERER)].filter(node =>
        sameWatch(node, watch) && Boolean(node.closest("#secondary,#primary")) &&
        !node.closest("#movie_player,ytd-player,ytd-miniplayer,ytd-engagement-panel-section-list-renderer"));
    } else {
      const selector = name === "info" ? "ytd-watch-metadata #description" : "ytd-comments#comments";
      candidates = [...watch.querySelectorAll<HTMLElement>(selector)].filter(node => sameWatch(node, watch));
    }
    const visible = candidates.filter(rendered);
    const ready = visible.filter(node => sectionHasContent(name, node));
    if ((name === "playlist" || name === "chat") && !candidates.length) return { node: null, details: { state: "absent", candidates: 0,
      reason: name === "chat" && chatWatch(watch) ? "YouTube가 채팅 영역을 아직 표시하지 않았거나 이 방송에서 채팅을 제공하지 않습니다." : "" } };
    if (ready.length > 1) return { node: null, details: { state: "ambiguous", candidates: ready.length,
      reason: `서로 다른 ${LABELS[name]} 영역 ${ready.length}개가 표시되어 대상을 확정하지 못했습니다. 기존 내용은 이동하거나 숨기지 않았습니다.` } };
    if (!ready.length) return { node: null, details: { state: "waiting", candidates: candidates.length,
      reason: candidates.length ? `${LABELS[name]} 영역이 비어 있거나 YouTube에서 숨겨져 있습니다. 내용이 준비되면 다시 연결합니다.` :
        `${LABELS[name]} 영역의 지원 구조를 아직 찾지 못했습니다. 기존 내용은 그대로 유지합니다.` } };
    const node = ready[0];
    const containsMainPlayer = node.matches("#movie_player,ytd-player") || Boolean(node.querySelector("#movie_player,ytd-player"));
    // Move the native chat host as one connected tree. Its iframe often has no
    // src attribute: YouTube navigates the existing browsing context itself.
    // Never recreate that iframe or inspect/copy its messages or draft input.
    const unexpectedChatMedia = name === "chat" && (node.querySelectorAll("iframe").length > 1 ||
      [...node.querySelectorAll("video,audio,iframe")].some(media => !media.matches("iframe#chatframe") || media.parentElement !== node));
    const protectedContent = unexpectedChatMedia || (name !== "videos" && name !== "playlist" && name !== "chat" &&
      (node.matches("video,audio,iframe") || Boolean(node.querySelector("video,audio,iframe"))));
    if (containsMainPlayer || protectedContent) return { node: null, details: { state: "protected", candidates: 1,
      reason: `${LABELS[name]} 영역에 본 플레이어 또는 보호할 미디어가 있어 이동하지 않았습니다.` } };
    // A recommendation's preview/advertising iframe is not the main player.
    // moveBefore preserves that subtree; do not reject the entire list merely
    // because it contains a <video> or <iframe>.
    return { node, details: { state: "mounted", reason: "", candidates: 1 } };
  }
  function nativeHidden(record: RecordNode): boolean {
    // Our inactive tab intentionally hides its pane. Inspect only the native
    // source itself here, never interpret our own [hidden] as YouTube state.
    return record.node.hidden || record.node.getAttribute("aria-hidden") === "true" ||
      getComputedStyle(record.node).display === "none";
  }
  function liveSection(s: Session, name: TabName): boolean {
    const record = s.records.get(name);
    return Boolean(record && record.node.isConnected && record.node.parentNode === record.pane && !nativeHidden(record) && sectionHasContent(name, record.node));
  }
  function move(parent: HTMLElement, node: HTMLElement, before: Node | null): void {
    const method = (parent as MoveParent).moveBefore;
    moveSource = node; moveTarget = parent;
    if (typeof method !== "function") throw new LayoutFailure("move-api-unavailable", "상태를 보존하는 DOM 이동 API가 없습니다. 레이아웃을 적용하지 않았습니다.");
    if (!parent.isConnected || !node.isConnected || node.ownerDocument !== parent.ownerDocument || (before && before.parentNode !== parent)) {
      throw new LayoutFailure("move-precondition-changed", "이동 직전에 원래 요소 또는 대상의 연결 상태가 변경되었습니다.");
    }
    // No appendChild fallback: it can reset iframe/media state and custom-element lifetime.
    try { method.call(parent, node, before); }
    catch (error) { throw new LayoutFailure("move-threw", `DOM 이동이 거부되었습니다 (${error instanceof Error ? error.name : "Error"}).`); }
    if (node.parentNode !== parent || (before && node.nextSibling !== before)) throw new LayoutFailure("move-result-changed", "이동 직후 페이지가 요소를 다시 배치했습니다.");
  }
  function followRestoreMarker(record: RecordNode, watch: HTMLElement): void {
    // An entire native container may move without moving the section itself.
    // The exact marker remains our source of truth, not an inferred selector.
    const origin = record.marker.parentElement;
    if (origin && origin !== record.parent && origin.isConnected &&
        origin.closest("#primary,#secondary")?.closest("ytd-watch-flexy") === watch && sameWatch(origin, watch)) {
      record.parent = origin;
    }
  }
  function restoreRecord(record: RecordNode): boolean {
    const watch = record.pane.closest<HTMLElement>("ytd-watch-flexy");
    if (watch) followRestoreMarker(record, watch);
    const { node, marker, parent, pane } = record;
    if (node.parentNode === pane && node.isConnected) {
      if (marker.parentNode !== parent || !parent.isConnected) return false;
      try { move(parent, node, marker); } catch (error) { lastIssue = ToolboxShared.errorMessage(error); return false; }
    }
    // If YouTube itself removed or reparented the node, do not resurrect or fight it.
    if (record.priorOwner === null) node.removeAttribute("data-btx-layout-owned");
    else setAttr(node, "data-btx-layout-owned", record.priorOwner);
    marker.remove();
    return true;
  }
  function rememberLayout(s: Session): void {
    bookmark = { watch: s.watch, videoKey: s.videoKey, selected: s.selected,
      scrollPositions: new Map(s.scrollPositions), playlistScroll: s.playlistScroll };
  }
  function restoreLayout(preserveWidth = false): void {
    const previous = session;
    if (!previous) return;
    previous.ac.abort(); previous.resizeObserver.disconnect(); previous.modeObserver.disconnect();
    previous.sizingObserver.disconnect(); previous.sizingNodes.clear();
    if (sizingFrame) cancelAnimationFrame(sizingFrame); sizingFrame = 0;
    clearFlowSizing(previous);
    if (preserveWidth && previous.widthNodes.size && previous.nativeWidth.established && previous.watch.isConnected) {
      releaseCarriedWidth();
      pauseNativeWidth(previous, "waiting-for-navigation");
      carriedWidth = { watch: previous.watch, widthNodes: previous.widthNodes, nativeWidth: previous.nativeWidth };
      previous.widthNodes = new Map();
    }
    clearWidthSizing(previous);
    resetNativeWidth(previous);
    clearAmbientContainment(previous);
    let restored = true;
    for (const record of previous.records.values()) if (!restoreRecord(record)) restored = false;
    if (restored) previous.host.remove();
    else {
      // Never delete a live original comment/description tree when its origin was removed by the site.
      setAttr(previous.host, "data-orphan", "true"); previous.body.hidden = false; previous.note.hidden = false;
      setText(previous.note, "원래 위치가 사라져 일부 요소를 복원하지 못했습니다. 내용을 보존했습니다. 페이지를 새로 고쳐 주세요.");
      lastIssue ||= previous.note.textContent || "원래 위치 복원 실패";
    }
    session = null;
  }
  function makeIcon(name: TabName): SVGSVGElement {
    const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("class", "btx-tabs-icon"); svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "1.7");
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", name === "info" ? "M12 8v1m0 3v5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" : name === "comments" || name === "chat" ? "M4 4h16v12H9l-5 4V4Z" : name === "playlist" ? "M3 5h14M3 10h14M3 15h8m4-2 6 4-6 4v-8Z" : "M4 4h16v16H4ZM10 8l6 4-6 4V8Z");
    svg.append(path); return svg;
  }
  function createLayout(watch: HTMLElement, secondary: HTMLElement): Session {
    const host = el("section"); host.id = "btx-youtube-tabs"; host.setAttribute("aria-label", "Browser Toolbox 영상 정보");
    const header = el("div", "btx-tabs-header"); header.setAttribute("role", "tablist"); header.setAttribute("aria-label", "영상 정보 종류");
    const body = el("div", "btx-tabs-body"), note = el("p", "btx-native-note"), issueNote = el("p", "btx-layout-status");
    note.hidden = true; issueNote.hidden = true; issueNote.setAttribute("role", "status"); issueNote.setAttribute("aria-live", "polite");
    // Observe this one native attribute separately: its old values let us
    // distinguish real enter/exit edges from redundant writes, including a
    // rapid round trip that finishes before the debounced reconciliation.
    const modeObserver = new MutationObserver(records => {
      if (session !== next) return;
      const changes = records.filter(r => r.target === watch && r.attributeName === "theater");
      const changed = changes.some((r, i) => (r.oldValue !== null) !==
        (i + 1 < changes.length ? changes[i + 1].oldValue !== null : watch.hasAttribute("theater")));
      if (changed) { observeTheaterMode(next, true); schedule(); }
    });
    const next: Session = { watch, secondary, videoKey: videoKey(), host, body, note, issueNote, selected: "info", buttons: new Map(), panes: new Map(), records: new Map(),
      sections: new Map(), scrollPositions: new Map(), renderedTab: null,
      nativeSignature: "", manuallyOpened: false, ac: new AbortController(), resizeObserver: new ResizeObserver(scheduleGeometry), modeObserver, flowNodes: new Map(), flowReason: "pending", widthNodes: new Map(), widthReason: "pending", ambientNodes: new Map(), ambientReason: "pending",
      sizingObserver: new ResizeObserver(() => { if (session === next) scheduleSizing(); }), sizingNodes: new Set(), sizingChecks: 0, nativeWidth: newNativeWidthState(),
      theater: watch.hasAttribute("theater"), relocationAllowed: new Set(), relocationCount: 0,
      playlistScroll: null, restoreScrollPending: false, scrollQuiet: false };
    if (carriedWidth?.watch === watch) {
      next.widthNodes = carriedWidth.widthNodes;
      next.nativeWidth = carriedWidth.nativeWidth;
      // A new watch session can reuse the same shell dimensions while the
      // site's replacement media/control state needs its own size notification.
      next.nativeWidth.notification = null;
      carriedWidth = null;
    }
    if (bookmark?.watch === watch && bookmark.videoKey === next.videoKey) {
      next.selected = bookmark.selected; next.scrollPositions = new Map(bookmark.scrollPositions);
      next.playlistScroll = bookmark.playlistScroll; next.restoreScrollPending = true;
    }
    bookmark = null;
    for (const name of TAB_ORDER) {
      const label = LABELS[name];
      const button = el("button"), span = el("span", "btx-tabs-label"), pane = el("div", "btx-tab-pane");
      button.type = "button"; button.id = `btx-tab-${name}`; pane.id = `btx-pane-${name}`;
      button.setAttribute("role", "tab"); button.setAttribute("aria-controls", pane.id); button.setAttribute("aria-selected", "false");
      pane.setAttribute("role", "tabpanel"); pane.setAttribute("aria-labelledby", button.id); pane.tabIndex = 0; pane.hidden = true;
      span.textContent = label; button.hidden = name === "playlist" || name === "chat";
      button.append(makeIcon(name), span); header.append(button); body.append(pane);
      button.addEventListener("click", event => { if (!event.isTrusted || button.getAttribute("aria-disabled") === "true") return; next.selected = name; next.manuallyOpened = true; paint(next); schedule(); }, { signal: next.ac.signal });
      button.addEventListener("keydown", event => {
        if (!event.isTrusted || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const available = [...next.buttons.values()].filter(b => !b.hidden && b.getAttribute("aria-disabled") !== "true");
        if (!available.length) return;
        event.preventDefault();
        const i = available.indexOf(button), index = event.key === "Home" ? 0 : event.key === "End" ? available.length - 1 : (i + (event.key === "ArrowRight" ? 1 : -1) + available.length) % available.length;
        const target = available[index];
        next.selected = [...next.buttons].find(([, b]) => b === target)![0]; next.manuallyOpened = true; paint(next); target.focus(); schedule();
      }, { signal: next.ac.signal });
      next.buttons.set(name, button); next.panes.set(name, pane);
    }
    host.append(header, note, body, issueNote);
    secondary.insertBefore(host, secondary.firstChild);
    next.resizeObserver.observe(host);
    modeObserver.observe(watch, { attributes: true, attributeFilter: ["theater"], attributeOldValue: true });
    host.addEventListener("scroll", event => {
      // Record actual scroll positions while the native layout is stable.
      // Do not replace a saved offset with a temporary clamp during a mode move.
      if (session !== next || next.restoreScrollPending || next.scrollQuiet || next.theater !== watch.hasAttribute("theater")) return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      for (const [name, pane] of next.panes) if (target === pane && !pane.hidden) next.scrollPositions.set(name, pane.scrollTop);
      const playlist = next.records.get("playlist");
      if (playlist && target === playlist.node.querySelector(":scope > #container > #items") && !playlist.pane.hidden) {
        next.playlistScroll = { top: target.scrollTop, left: target.scrollLeft };
      }
    }, { capture: true, passive: true, signal: next.ac.signal });
    return next;
  }
  function observeTheaterMode(s: Session, observedTransition = false): void {
    const theater = s.watch.hasAttribute("theater");
    if (!observedTransition && theater === s.theater) return;
    s.theater = theater;
    // Mode changes invalidate measurements, NOT the normal-mode width policy.
    // Existing CSS excludes [theater]/fullscreen. Keeping the markers lets the
    // site's normal-mode sizing read the wide shell immediately on return.
    if (s.nativeWidth.phase === "blocked") resetNativeWidth(s);
    pauseNativeWidth(s, theater ? "native-mode" : "waiting-for-native-size");
    // The evidence is the actual DOM mode attribute, never the T key. Grant
    // one reattachment per existing section per boundary, not a polling loop.
    for (const record of s.records.values()) record.initialRelocationAvailable = false;
    s.relocationAllowed = new Set(s.records.keys());
    s.restoreScrollPending = true;
  }
  function reattachAfterModeChange(s: Session, name: TabName, record: RecordNode): boolean {
    const node = record.node, parent = node.parentElement;
    const nativeColumn = node.closest("#primary,#secondary");
    if ((!s.relocationAllowed.has(name) && !record.initialRelocationAvailable) || !parent || !nativeColumn ||
        nativeColumn.closest("ytd-watch-flexy") !== s.watch || !sameWatch(node, s.watch) ||
        node.closest("#movie_player,ytd-player,ytd-miniplayer,ytd-engagement-panel-section-list-renderer")) {
      throw new LayoutFailure("repeated-native-relocation", "같은 원래 요소가 반복해서 재배치되거나 확인된 시청 영역을 벗어났습니다. 반복 이동을 중단합니다.");
    }
    const found = discover(s.watch, name);
    if ((found.node && found.node !== node) || ["ambiguous", "protected"].includes(found.details.state)) {
      if (found.details.state === "ambiguous") throw new SectionConflict(name, found.details.reason);
      throw new LayoutFailure("unverified-native-target", `${LABELS[name]}의 현재 이동 대상을 확정하지 못했습니다. 기존 내용을 유지합니다.`);
    }
    if (!rendered(node)) {
      s.sections.set(name, { state: "waiting", candidates: 1, reason: `모드 전환 중 YouTube가 ${LABELS[name]} 영역을 숨겼습니다. 표시되면 다시 연결합니다.` });
      return false;
    }
    // YouTube placed this exact original node in a verified native column.
    // Its new actual position becomes the restore target. Do not reuse a stale
    // marker from the previous mode, clone content, or modify site internals.
    const marker = document.createComment(`Browser Toolbox ${name} original position`);
    parent.insertBefore(marker, node);
    record.marker.remove(); record.marker = marker; record.parent = parent;
    if (!s.relocationAllowed.has(name)) record.initialRelocationAvailable = false;
    s.relocationAllowed.delete(name);
    move(record.pane, node, null);
    s.relocationCount++;
    s.restoreScrollPending = true;
    return true;
  }
  function mountParts(s: Session): void {
    for (const name of TAB_ORDER) {
      failureStage = "mount-section"; failureSection = name;
      const existing = s.records.get(name);
      if (existing) {
        followRestoreMarker(existing, s.watch);
        if (!existing.node.isConnected) { restoreRecord(existing); s.records.delete(name); s.scrollPositions.delete(name); }
        else if (existing.node.parentNode !== existing.pane) {
          if (!reattachAfterModeChange(s, name, existing)) continue;
          s.sections.set(name, { state: "mounted", candidates: 1, reason: "" });
          continue;
        }
        else {
          // A site may empty a responsive placeholder and create its replacement
          // outside our pane. Rebind only when the old tree is empty and a unique
          // actual replacement is observed; do not move populated rivals.
          if ((name === "videos" || name === "playlist" || name === "chat") && (!sectionHasContent(name, existing.node) || ((name === "playlist" || name === "chat") && nativeHidden(existing)))) {
            const replacement = discover(s.watch, name);
            if (replacement.node) {
              if (!restoreRecord(existing)) throw new Error(`이전 ${LABELS[name]} 영역을 복원하지 못했습니다.`);
              s.records.delete(name);
            } else {
              s.sections.set(name, { state: "waiting", candidates: 1, reason: `YouTube가 ${LABELS[name]} 내용을 준비하거나 숨긴 상태입니다.` });
              continue;
            }
          } else {
            if (name === "videos" || name === "playlist" || name === "chat") {
              const rival = discover(s.watch, name);
              if (rival.node || rival.details.state === "ambiguous") throw new SectionConflict(name, `YouTube가 패널 밖에 별도의 ${LABELS[name]} 목록을 만들었습니다. 잘못된 목록을 숨기거나 반복 이동하지 않고 원래 배치로 복원합니다.`);
            }
            s.sections.set(name, nativeHidden(existing) ? { state: "waiting", candidates: 1, reason: `YouTube가 ${LABELS[name]} 영역을 숨긴 상태입니다.` } :
              { state: "mounted", candidates: 1, reason: "" });
            continue;
          }
        }
      }
      const found = discover(s.watch, name); s.sections.set(name, found.details);
      const source = found.node;
      if (!source || !(source.parentElement instanceof HTMLElement)) continue;
      const parent = source.parentElement, marker = document.createComment(`Browser Toolbox ${name} original position`);
      const record: RecordNode = { node: source, marker, parent, pane: s.panes.get(name)!, priorOwner: source.getAttribute("data-btx-layout-owned"), initialRelocationAvailable: true };
      parent.insertBefore(marker, source); s.records.set(name, record);
      setAttr(source, "data-btx-layout-owned", name);
      move(record.pane, source, null);
      if (name === "chat" && !s.manuallyOpened && !s.restoreScrollPending) s.selected = "chat";
    }
  }
  function nativePanels(watch: HTMLElement): string[] {
    const active: string[] = [];
    for (const node of watch.querySelectorAll<HTMLElement>("ytd-live-chat-frame#chat,ytd-playlist-panel-renderer,ytd-engagement-panel-section-list-renderer")) {
      // A chat or playlist that we actually own is a tab, not an external panel.
      // Otherwise selecting it would make the tab panel yield to itself.
      const managed = session?.records.get(node.matches(CHAT_RENDERER) ? "chat" : "playlist");
      if (managed?.node === node && node.parentNode === managed.pane) continue;
      // A restored, emptied shell is not a second active playlist. Keep the
      // shell's DOM untouched, but do not make our tab yield to an empty list.
      if (node.matches(PLAYLIST_RENDERER) && session && liveSection(session, "playlist") && !hasPlaylistItems(node)) continue;
      if (!rendered(node)) continue;
      if (node.matches("ytd-engagement-panel-section-list-renderer")) {
        if (node.getAttribute("visibility") === "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED") active.push(`panel:${node.getAttribute("target-id") || "visible"}`);
      } else if (!node.hasAttribute("collapsed")) active.push(node.tagName.toLowerCase());
    }
    return active.sort();
  }
  function commentLabel(s: Session): { label: string; detail: string } {
    if (!settings.youtubeCommentStatusEnabled) return { label: "댓글", detail: "댓글" };
    const comments = s.records.get("comments")?.node;
    if (!comments) return { label: "댓글 · 미로드", detail: "현재 문서에 댓글 영역이 아직 없습니다." };
    const count = text(comments.querySelector("ytd-comments-header-renderer #count, ytd-comments-header-renderer #count-text"));
    if (count) return { label: count, detail: count };
    const message = text(comments.querySelector("ytd-message-renderer yt-formatted-string"));
    return message ? { label: "댓글 · 안내", detail: message } : { label: "댓글 · 미로드", detail: "YouTube가 아직 댓글 수나 상태를 표시하지 않았습니다." };
  }
  function paint(s: Session): void {
    const useChat = chatWatch(s.watch);
    const comments = commentLabel(s), commentButton = s.buttons.get("comments")!;
    setText(commentButton.querySelector(".btx-tabs-label")!, comments.label); commentButton.title = comments.detail;
    const active = settings.youtubeNativePanelsEnabled ? nativePanels(s.watch) : [];
    const signature = active.join("|");
    if (signature !== s.nativeSignature) { s.nativeSignature = signature; s.manuallyOpened = false; }
    const yieldSpace = active.length > 0 && !s.manuallyOpened;
    const availableNames = [...s.buttons.keys()].filter(name =>
      name !== (useChat ? "comments" : "chat") && liveSection(s, name));
    if (!availableNames.includes(s.selected)) s.selected = availableNames[0] || "info";
    const nextTab = yieldSpace || !availableNames.length ? null : s.selected;
    if (nextTab !== s.renderedTab && s.renderedTab && !s.restoreScrollPending) s.scrollPositions.set(s.renderedTab, s.panes.get(s.renderedTab)!.scrollTop);
    if (s.body.hidden !== (nextTab === null)) s.body.hidden = nextTab === null;
    s.note.hidden = !yieldSpace && availableNames.length > 0;
    if (!availableNames.length) setText(s.note, `정보·${useChat ? "채팅" : "댓글"}·동영상의 실제 요소를 기다리는 중입니다. 확인하지 못한 내용을 임의로 만들거나 숨기지 않습니다.`);
    if (yieldSpace) setText(s.note, "YouTube 패널을 사용하는 중입니다. 위의 탭을 선택하면 함께 볼 수 있습니다.");
    const reasons: string[] = [];
    for (const [name, button] of s.buttons) {
      const available = availableNames.includes(name), selected = available && nextTab === name;
      const inactiveDiscussion = name === (useChat ? "comments" : "chat");
      const hideOptional = inactiveDiscussion || (name === "playlist" && !available);
      if (button.hidden !== hideOptional) button.hidden = hideOptional;
      const details = s.sections.get(name);
      setAttr(button, "aria-disabled", String(!available)); setAttr(button, "aria-selected", String(selected)); button.tabIndex = available && s.selected === name ? 0 : -1;
      const pane = s.panes.get(name)!;
      if (pane.hidden !== !selected) pane.hidden = !selected;
      if (!available) {
        button.title = details?.reason || `${LABELS[name]} 영역을 기다리는 중입니다.`;
        if (!inactiveDiscussion && (name !== "playlist" || details?.state === "ambiguous" || details?.state === "protected")) reasons.push(`${LABELS[name]}: ${button.title}`);
      } else if (name !== "comments") button.title = LABELS[name];
    }
    // No silent disabled tab: expose the reason without claiming that a missing
    // recommendations list was successfully moved.
    setText(s.issueNote, reasons.join("\n")); s.issueNote.hidden = reasons.length === 0;
    setAttr(s.host, "data-scroll", String(settings.youtubePanelScrollEnabled));
    if (nextTab !== s.renderedTab && nextTab) s.panes.get(nextTab)!.scrollTop = s.scrollPositions.get(nextTab) || 0;
    s.renderedTab = nextTab;
    updateFlowSizing(s);
    updateGeometry();
    if (s.restoreScrollPending) {
      // Restore only after the actual panes and their current heights exist.
      // Browsers clamp offsets naturally when the new viewport is smaller.
      s.scrollQuiet = true;
      for (const [name, pane] of s.panes) if (!pane.hidden) pane.scrollTop = s.scrollPositions.get(name) || 0;
      const items = s.records.get("playlist")?.node.querySelector<HTMLElement>(":scope > #container > #items");
      if (items && s.playlistScroll && liveSection(s, "playlist") && !s.panes.get("playlist")!.hidden) {
        items.scrollTop = s.playlistScroll.top; items.scrollLeft = s.playlistScroll.left;
      }
      s.restoreScrollPending = false;
      requestAnimationFrame(() => { if (session === s) s.scrollQuiet = false; });
    }
  }
  const FLOW_ATTRIBUTE = "data-btx-layout-flow";
  const AMBIENT_ATTRIBUTE = "data-btx-layout-ambient";
  // A known decoration must not acquire scrolling semantics from its canvas.
  // Never apply layout/size containment to the video, text, controls, or page.
  const AMBIENT_PROTECTED = "video,audio,iframe,#movie_player,ytd-player,a[href],button,input,textarea,select,summary,[contenteditable]:not([contenteditable='false']),[role='button'],[tabindex]:not([tabindex='-1'])";
  function clearAmbientContainment(s: Session, keep = new Set<HTMLElement>()): void {
    for (const [node, prior] of s.ambientNodes) {
      if (keep.has(node)) continue;
      if (prior === null) node.removeAttribute(AMBIENT_ATTRIBUTE);
      else setAttr(node, AMBIENT_ATTRIBUTE, prior);
      s.ambientNodes.delete(node);
    }
  }
  function updateAmbientContainment(s: Session): void {
    if (!s.host.isConnected || document.fullscreenElement || s.watch.matches("[theater],[fullscreen]")) {
      clearAmbientContainment(s); s.ambientReason = "native-mode"; return;
    }
    const candidates = [...s.watch.querySelectorAll<HTMLElement>("#cinematics")].filter(node =>
      node.closest("ytd-watch-flexy") === s.watch && !node.closest("#btx-youtube-tabs,#movie_player,ytd-player"));
    if (candidates.length !== 1) {
      clearAmbientContainment(s); s.ambientReason = candidates.length ? "ambiguous" : "not-present"; return;
    }
    const node = candidates[0];
    if (!node.querySelector("canvas") || node.matches(AMBIENT_PROTECTED) || node.querySelector(AMBIENT_PROTECTED) || text(node)) {
      clearAmbientContainment(s); s.ambientReason = "unverified-decoration"; return;
    }
    const original = getComputedStyle(node).contain;
    // Preserve a site's stronger paint containment rather than replacing it.
    if (!s.ambientNodes.has(node) && /\b(layout|paint|content|strict)\b/.test(original)) {
      clearAmbientContainment(s); s.ambientReason = "native-containment"; return;
    }
    clearAmbientContainment(s, new Set([node]));
    if (!s.ambientNodes.has(node)) s.ambientNodes.set(node, node.getAttribute(AMBIENT_ATTRIBUTE));
    setAttr(node, AMBIENT_ATTRIBUTE, "contained");
    // The stylesheet can be blocked or superseded; the marker is not success.
    s.ambientReason = /\blayout\b/.test(getComputedStyle(node).contain) ? "contained" : "style-not-applied";
  }
  function clearFlowSizing(s: Session, keep = new Set<HTMLElement>()): void {
    for (const [node, prior] of s.flowNodes) {
      if (keep.has(node)) continue;
      if (prior === null) node.removeAttribute(FLOW_ATTRIBUTE);
      else setAttr(node, FLOW_ATTRIBUTE, prior);
      s.flowNodes.delete(node);
    }
  }
  const WIDTH_ATTRIBUTE = "data-btx-layout-width";
  function syncSizingObservation(s: Session): void {
    // The fixed-width sidebar can stay unchanged while the primary column,
    // containing block or player becomes ready. Observe those actual boxes,
    // including unmarked shells for which width sizing was initially skipped.
    // No document-wide ResizeObserver, polling or synthetic window.resize.
    const nodes = new Set<HTMLElement>([s.watch, s.secondary]);
    if (s.watch.parentElement) nodes.add(s.watch.parentElement);
    const columns = single(s.watch, ":scope > #columns");
    const primary = columns && single(columns, ":scope > #primary");
    const secondary = columns && single(columns, ":scope > #secondary");
    for (const node of [columns, primary, secondary, primary && single(primary, ":scope > #primary-inner")]) {
      if (node) nodes.add(node);
    }
    // Observe element BOXES, not decoded frames. The main video's CSS box can
    // stay stale even when #movie_player already matches its available slot.
    if (primary) for (const node of primary.querySelectorAll<HTMLElement>(PLAYER_SHELLS)) {
      if (node.closest("ytd-watch-flexy") === s.watch && !node.closest("#btx-youtube-tabs,ytd-miniplayer")) nodes.add(node);
    }
    if (primary) for (const node of primary.querySelectorAll<HTMLElement>(
      "#movie_player > .html5-video-container,#movie_player > .html5-video-container > video.html5-main-video,#movie_player > .ytp-chrome-bottom,#movie_player .ytp-progress-bar-container,#movie_player .ytp-progress-bar,#movie_player .ytp-chrome-controls")) {
      if (node.closest("ytd-watch-flexy") === s.watch && !node.closest("#btx-youtube-tabs,ytd-miniplayer")) nodes.add(node);
    }
    if (primary) for (const player of primary.querySelectorAll<HTMLElement>("#movie_player")) {
      if (player.closest("ytd-watch-flexy") !== s.watch || player.closest("#btx-youtube-tabs,ytd-miniplayer")) continue;
      const slot = player.closest<HTMLElement>("#player-container-inner");
      if (!slot || !primary.contains(slot)) continue;
      for (let parent = player.parentElement, depth = 0; parent && parent !== slot && depth < 15; parent = parent.parentElement, depth++) nodes.add(parent);
    }
    for (const node of s.sizingNodes) if (!nodes.has(node)) {
      s.sizingObserver.unobserve(node); s.sizingNodes.delete(node);
    }
    for (const node of nodes) if (!s.sizingNodes.has(node)) {
      s.sizingNodes.add(node); s.sizingObserver.observe(node);
    }
  }
  function scheduleSizing(): void {
    const expected = session;
    if (!expected || suspended || navigating || !settings.youtubeLayoutTabsEnabled || sizingFrame) return;
    // Observe -> next animation frame -> measure/update. Coalesce deliveries
    // and never write a watched size from inside the ResizeObserver callback.
    sizingFrame = requestAnimationFrame(() => {
      sizingFrame = 0;
      if (session !== expected || suspended || navigating || !settings.youtubeLayoutTabsEnabled) return;
      updateFlowSizing(expected);
      updateGeometry();
      // A primary column becoming visible can also expose sections that were
      // unavailable during initial discovery. Reconcile those only as needed.
      if (requiredTabs(expected).some(name => !liveSection(expected, name))) schedule();
    });
  }
  function releaseCarriedWidth(): void {
    if (!carriedWidth) return;
    clearNativeWidthCheck(carriedWidth);
    clearWidthSizing(carriedWidth);
    carriedWidth = null;
  }
  function clearWidthSizing(s: Pick<Session, "watch" | "widthNodes" | "nativeWidth">, keep = new Set<HTMLElement>()): void {
    const removing = [...s.widthNodes.keys()].some(node => !keep.has(node));
    const parts = removing ? nativePlayerParts(s) : null;
    const before = parts?.player.getBoundingClientRect();
    for (const [node, prior] of s.widthNodes) {
      if (keep.has(node)) continue;
      if (prior === null) node.removeAttribute(WIDTH_ATTRIBUTE);
      else setAttr(node, WIDTH_ATTRIBUTE, prior);
      s.widthNodes.delete(node);
    }
    // Releasing our shell can also leave the site's cached video/seek geometry
    // at the wide size. Notify its owner only after a real box-size change.
    if (parts && before && !sameBox(before, parts.player.getBoundingClientRect()) &&
        (!videoFitsBox(parts.video, parts.player.getBoundingClientRect()) ||
         (s.nativeWidth.reference && !nativeMarginsMatch(parts, s.nativeWidth.reference)))) notifyNativeSize(s, parts);
  }
  function updateWidthSizing(s: Session): void {
    // Independent of vertical flow sizing: comments may still be loading, and
    // a native chat panel is not a reason to bring back large outside gutters.
    // Keep the site's layout engine, breakpoint, sidebar width and video sizing.
    const columns = single(s.watch, ":scope > #columns");
    const primary = columns && single(columns, ":scope > #primary");
    const secondary = columns && single(columns, ":scope > #secondary");
    s.widthReason = !s.host.isConnected || !columns || !primary || !secondary || !secondary.contains(s.host) ? "unsupported-shell" :
      (document.fullscreenElement || s.watch.matches("[theater],[fullscreen]") ||
        (document.pictureInPictureElement && s.watch.contains(document.pictureInPictureElement))) ? "native-mode" :
      document.documentElement.clientWidth <= 980 ? "narrow-window" : "compact";
    if (s.widthReason !== "compact" || !columns || !primary || !secondary) {
      // Keep established normal-mode markers through theater/fullscreen and a
      // narrow viewport. CSS gates them directly on those native conditions.
      // PIP has no equivalent cross-version CSS gate, so only pause its markers.
      const pip = document.pictureInPictureElement && s.watch.contains(document.pictureInPictureElement);
      if (s.widthReason === "native-mode" || s.widthReason === "narrow-window") {
        if (pip) clearWidthSizing(s);
        pauseNativeWidth(s, s.widthReason);
      } else { clearWidthSizing(s); resetNativeWidth(s); }
      renderNativeWidthNotice(s); return;
    }
    const style = getComputedStyle(columns);
    const rowLayout = ["flex", "inline-flex"].includes(style.display) && ["row", "row-reverse"].includes(style.flexDirection);
    const gridLayout = ["grid", "inline-grid"].includes(style.display);
    const extraColumn = [...columns.children].some(node => node !== primary && node !== secondary && node instanceof HTMLElement &&
      rendered(node) && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0);
    if ((!rowLayout && !gridLayout) || style.writingMode !== "horizontal-tb" || extraColumn) {
      s.widthReason = "unsupported-columns"; clearWidthSizing(s); resetNativeWidth(s); return;
    }
    const left = primary.getBoundingClientRect(), right = secondary.getBoundingClientRect();
    const sideBySide = left.width > 0 && right.width > 0 &&
      (left.right <= right.left + 1 || right.right <= left.left + 1) && left.top < right.bottom && right.top < left.bottom;
    if (!sideBySide) { s.widthReason = "single-column"; clearWidthSizing(s); resetNativeWidth(s); return; }
    if (s.nativeWidth.phase === "blocked") { s.widthReason = "native-width-restored"; clearWidthSizing(s); return; }
    if (!s.nativeWidth.reference) {
      const reference = nativeReference(s);
      if (!reference) { s.widthReason = "native-player-not-ready"; clearWidthSizing(s); return; }
      s.nativeWidth.reference = reference;
      s.nativeWidth.phase = "settling";
    }
    const roles = new Map<HTMLElement, string>([[s.watch, "watch"], [columns, "columns"], [primary, "primary"], [secondary, "secondary"]]);
    const primaryInner = single(primary, ":scope > #primary-inner");
    if (primaryInner) roles.set(primaryInner, "primary-inner");
    clearWidthSizing(s, new Set(roles.keys()));
    for (const [node, role] of roles) {
      if (!s.widthNodes.has(node)) s.widthNodes.set(node, node.getAttribute(WIDTH_ATTRIBUTE));
      setAttr(node, WIDTH_ATTRIBUTE, role);
    }
    // Report observed box geometry, not merely that a marker was written.
    // Unrecognized deeper size restrictions are exposed by diagnostics; never
    // mask horizontal overflow on html/body or guess player internals.
    const outer = columns.getBoundingClientRect(), a = primary.getBoundingClientRect(), b = secondary.getBoundingClientRect();
    const first = a.left < b.left ? a : b, last = first === a ? b : a;
    const close = (x: number, expected: number): boolean => Math.abs(x - expected) <= 1;
    s.widthReason = close(first.left - outer.left, 16) && close(outer.right - last.right, 16) && close(last.left - first.right, 16) &&
      close(outer.width, s.watch.getBoundingClientRect().width) ? "compact" : "unverified-geometry";
  }
  // Only the surrounding page layout is ours. Never independently stretch
  // native video, control rail, chapter pixels or menu coordinate systems.
  // A reference is taken BEFORE our width change, from a coherent native
  // video/player pair, and is not learned from the resulting mismatch.
  const NATIVE_SIZE_SETTLE_MS = 1000;
  const NATIVE_SIZE_NOTIFY_MS = 100;
  function newNativeWidthState(): NativeWidthState {
    return { sample: null, sampleChangedAt: 0, phase: "idle", established: false, reference: null,
      timeout: 0, reason: "pending", notification: null, notifications: 0 };
  }
  function resetNativeWidth(s: Session): void {
    if (s.nativeWidth.timeout) clearTimeout(s.nativeWidth.timeout);
    s.nativeWidth = newNativeWidthState();
  }
  function sameBox(a: DOMRect, b: DOMRect): boolean {
    return [a.left - b.left, a.top - b.top, a.width - b.width, a.height - b.height].every(n => Math.abs(n) <= 2);
  }
  function videoFitsBox(video: HTMLVideoElement, box: DOMRect): boolean {
    const rect = video.getBoundingClientRect();
    if (sameBox(rect, box)) return true;
    // A native video can occupy a centered, letterboxed rectangle instead of
    // filling the element box. Do not mistake portrait/cinema aspect ratios for
    // a stale player size. Natural dimensions are read, never fabricated.
    if (!(video.videoWidth > 0 && video.videoHeight > 0)) return false;
    const scale = Math.min(box.width / video.videoWidth, box.height / video.videoHeight);
    const width = video.videoWidth * scale, height = video.videoHeight * scale;
    return Math.abs(rect.width - width) <= 2 && Math.abs(rect.height - height) <= 2 &&
      Math.abs(rect.left - box.left - (box.width - width) / 2) <= 2 &&
      Math.abs(rect.top - box.top - (box.height - height) / 2) <= 2;
  }
  function nativePlayerParts(s: Pick<Session, "watch">): { player: HTMLElement; video: HTMLVideoElement;
    controls: HTMLElement; progress: HTMLElement | null; row: HTMLElement } | null {
    const players = [...s.watch.querySelectorAll<HTMLElement>("#movie_player.html5-video-player")]
      .filter(n => rendered(n) && n.closest("ytd-watch-flexy") === s.watch && !n.closest("#btx-youtube-tabs,ytd-miniplayer"));
    if (players.length !== 1) return null;
    const player = players[0];
    const videos = [...player.querySelectorAll<HTMLVideoElement>("video.html5-main-video")].filter(rendered);
    const controls = single(player, ":scope > .ytp-chrome-bottom");
    const progressNode = controls && single(controls, ".ytp-progress-bar");
    // Non-DVR live broadcasts can have no visible seek bar. Continue checking
    // the native video, control rail and button row without requiring a fake bar.
    const progress = progressNode && rendered(progressNode) && progressNode.getBoundingClientRect().height > 0 ? progressNode : null;
    const row = controls && single(controls, ".ytp-chrome-controls");
    if (videos.length !== 1 || !controls || (!progress && !chatWatch(s.watch)) || !row ||
        ![player, controls, ...(progress ? [progress] : []), row, videos[0]].every(n => {
          const c = getComputedStyle(n), r = n.getBoundingClientRect();
          return rendered(n) && r.width > 0 && r.height > 0 && c.transform === "none" &&
            c.zoom === "1" && c.writingMode === "horizontal-tb";
        })) return null;
    return { player, video: videos[0], controls, progress, row };
  }
  type NativeParts = NonNullable<ReturnType<typeof nativePlayerParts>>;
  function sizeNotificationPending(s: Pick<Session, "nativeWidth">, parts: NativeParts): boolean {
    const prior = s.nativeWidth.notification, box = parts.player.getBoundingClientRect();
    return !prior || prior.player !== parts.player || Math.abs(prior.width - box.width) > 2 ||
      Math.abs(prior.height - box.height) > 2 || prior.ready !== (parts.video.readyState >= 1);
  }
  function notifyNativeSize(s: Pick<Session, "watch" | "nativeWidth">, parts: NativeParts): boolean {
    if (suspended || navigating || document.visibilityState !== "visible" || !s.watch.isConnected ||
        s.watch.matches("[theater],[fullscreen]") || document.fullscreenElement || document.pictureInPictureElement ||
        !sizeNotificationPending(s, parts)) return false;
    const box = parts.player.getBoundingClientRect();
    // Set the guard BEFORE dispatch: synchronous site resize handlers can change
    // DOM and reenter layout. One notification per observed size/readiness, never
    // a recurring timer, native leaf CSS override, private player API or trusted
    // user event. The site owns both rendered dimensions and seek coordinates.
    s.nativeWidth.notification = { player: parts.player, width: box.width, height: box.height, ready: parts.video.readyState >= 1 };
    s.nativeWidth.notifications++;
    window.dispatchEvent(new Event("resize"));
    return true;
  }
  function nativeReference(s: Session): NativePlayerReference | null {
    const p = nativePlayerParts(s);
    if (!p || document.pictureInPictureElement === p.video) return null;
    const box = p.player.getBoundingClientRect(), rail = p.controls.getBoundingClientRect();
    const progress = p.progress?.getBoundingClientRect(), row = p.row.getBoundingClientRect();
    if (!videoFitsBox(p.video, box) || rail.left < box.left - 2 || rail.right > box.right + 2 ||
        rail.top < box.top - 2 || rail.bottom > box.bottom + 2 ||
        (progress && (progress.left < rail.left - 2 || progress.right > rail.right + 2)) ||
        row.left < rail.left - 2 || row.right > rail.right + 2) return null;
    return { ...p, originalWidth: box.width, originalHeight: box.height, left: rail.left - box.left, right: box.right - rail.right, bottom: box.bottom - rail.bottom,
      progressLeft: progress ? progress.left - rail.left : 0, progressRight: progress ? rail.right - progress.right : 0,
      rowLeft: row.left - rail.left, rowRight: rail.right - row.right };
  }
  function nativeSizeMatches(s: Session): boolean {
    const ref = s.nativeWidth.reference, current = nativePlayerParts(s);
    if (!ref || !current || currentWatch() !== s.watch || videoKey() !== s.videoKey) return false;
    // A route/mode update may replace native controls after URL commit. Compare
    // the CURRENT player subtree with the pre-expansion geometry; detached old
    // DOM identities are not a permanent failure, and new geometry is not used
    // to redefine the expected control margins.
    const box = current.player.getBoundingClientRect();
    const slot = current.player.closest<HTMLElement>("#player-container-inner");
    return !!slot && sameBox(slot.getBoundingClientRect(), box) && videoFitsBox(current.video, box) &&
      nativeMarginsMatch(current, ref);
  }
  function nativeMarginsMatch(current: NativeParts, ref: NativePlayerReference): boolean {
    const box = current.player.getBoundingClientRect(), rail = current.controls.getBoundingClientRect();
    const progress = current.progress?.getBoundingClientRect(), row = current.row.getBoundingClientRect();
    const near = (value: number, expected: number): boolean => Math.abs(value - expected) <= 2;
    return near(rail.left - box.left, ref.left) && near(box.right - rail.right, ref.right) && near(box.bottom - rail.bottom, ref.bottom) &&
      (!progress || (ref.progress ? near(progress.left - rail.left, ref.progressLeft) && near(rail.right - progress.right, ref.progressRight) :
        progress.left >= rail.left - 2 && progress.right <= rail.right + 2)) &&
      near(row.left - rail.left, ref.rowLeft) && near(rail.right - row.right, ref.rowRight);
  }
  function nativeRestoreMatches(s: Session): boolean {
    const ref = s.nativeWidth.reference;
    if (!ref || !nativeSizeMatches(s)) return false;
    const current = nativePlayerParts(s);
    if (!current) return false;
    const box = current.player.getBoundingClientRect();
    return Math.abs(box.width - ref.originalWidth) <= 2 && Math.abs(box.height - ref.originalHeight) <= 2;
  }
  function restoreNativeWidth(s: Session, reason: string): void {
    if (s.nativeWidth.timeout) clearTimeout(s.nativeWidth.timeout);
    s.nativeWidth.timeout = 0; s.nativeWidth.phase = "blocked"; s.nativeWidth.reason = reason;
    clearWidthSizing(s);
    s.widthReason = "native-width-restored";
    renderNativeWidthNotice(s);
  }
  function renderNativeWidthNotice(s: Session): void {
    // Kept separate from section-discovery issues. A mounted panel is not proof
    // of a working player or of a successful width expansion.
    let note = s.host.querySelector<HTMLElement>(":scope > .btx-player-sizing-status");
    if (!["blocked", "unconfirmed"].includes(s.nativeWidth.phase)) { note?.remove(); return; }
    if (!note) { note = el("p", "btx-layout-status btx-player-sizing-status"); note.setAttribute("role", "status"); s.host.append(note); }
    if (s.nativeWidth.phase === "unconfirmed") {
      setText(note, "넓은 배치는 유지하고 있습니다. 현재 영상·진행 막대·버튼 줄의 크기 관계는 아직 확인하지 못했습니다. 내부 조작부는 변경하지 않았습니다.");
      return;
    }
    setText(note, "플레이어와 진행 막대가 함께 넓어지는 것을 확인하지 못해 폭 확장만 해제했습니다. 탭형 패널은 유지합니다. " +
      (nativeRestoreMatches(s) ? "폭 확장 전 영상·조작부의 크기로 복원된 것을 확인했습니다." :
        "폭 확장 전 영상·조작부의 크기로 돌아왔는지는 아직 확인하지 못했습니다."));
  }
  function clearNativeWidthCheck(s: Pick<Session, "nativeWidth">): void {
    if (s.nativeWidth.timeout) clearTimeout(s.nativeWidth.timeout);
    s.nativeWidth.timeout = 0;
  }
  function pauseNativeWidth(s: Pick<Session, "nativeWidth">, reason: string): void {
    clearNativeWidthCheck(s);
    const state = s.nativeWidth;
    state.sample = null; state.sampleChangedAt = 0;
    if (state.phase !== "blocked") { state.phase = state.reference ? "settling" : "idle"; state.reason = reason; }
  }
  function nativeWidthSample(s: Session): number[] | null {
    const p = nativePlayerParts(s);
    if (!p) return null;
    const slot = p.player.closest<HTMLElement>("#player-container-inner");
    if (!slot) return null;
    const origin = p.player.getBoundingClientRect();
    // Relative coordinates exclude ordinary scrolling. Playback time, progress
    // fill length, labels and unrelated DOM changes cannot extend the deadline.
    return [slot, p.player, p.video, p.controls, ...(p.progress ? [p.progress] : []), p.row].flatMap(node => {
      const r = node.getBoundingClientRect();
      return [r.left - origin.left, r.top - origin.top, r.width, r.height];
    });
  }
  function updatePlayerViewport(s: Session): void {
    if (s.nativeWidth.phase === "blocked") { renderNativeWidthNotice(s); return; }
    if (s.widthReason !== "compact") {
      pauseNativeWidth(s, s.widthReason); renderNativeWidthNotice(s); return;
    }
    const state = s.nativeWidth;
    const media = [...s.watch.querySelectorAll<HTMLVideoElement>("#movie_player video")]
      .filter(video => video.closest("ytd-watch-flexy") === s.watch && !video.closest("#btx-youtube-tabs,ytd-miniplayer"));
    // End-screen controls need not have the playing-state geometry. Natural
    // completion is not a request to shrink the page. Recheck after real replay,
    // seek or a new source; never change ended/currentTime or click replay here.
    if (media.length === 1 && media[0].ended) {
      pauseNativeWidth(s, "playback-ended-width-retained"); renderNativeWidthNotice(s); return;
    }
    // Temporarily unavailable controls are NOT measured mismatching controls.
    // Autohide, node replacement and background rendering must not consume a
    // deadline while no complete current native geometry can be observed.
    const sample = document.visibilityState === "visible" ? nativeWidthSample(s) : null;
    if (!sample) {
      clearNativeWidthCheck(s); state.sample = null; state.sampleChangedAt = 0;
      state.phase = "settling";
      state.reason = document.visibilityState === "visible" ? "waiting-for-native-controls" : "waiting-for-visible-document";
      renderNativeWidthNotice(s); return;
    }
    if (nativeSizeMatches(s)) {
      clearNativeWidthCheck(s); state.sample = null; state.sampleChangedAt = 0;
      state.established = true; state.phase = "accepted"; state.reason = "native-boxes-match";
      renderNativeWidthNotice(s); return;
    }
    // A placeholder can already have coherent CSS dimensions while the site's
    // media/resize handlers are not initialized. Metadata readiness is a real
    // lifecycle signal; do not permanently reject expansion during that gap.
    if (media.length === 1 && media[0].readyState === 0) {
      clearNativeWidthCheck(s); state.sample = null; state.sampleChangedAt = 0;
      state.phase = "settling"; state.reason = "waiting-for-media-metadata";
      renderNativeWidthNotice(s); return;
    }
    const now = performance.now();
    const changed = !state.sample || sample.length !== state.sample.length || sample.some((value, i) => Math.abs(value - state.sample![i]) > 0.5);
    if (changed) {
      clearNativeWidthCheck(s); state.sample = sample; state.sampleChangedAt = now;
    }
    if (state.phase === "unconfirmed" && !changed) { renderNativeWidthNotice(s); return; }
    state.phase = "settling"; state.reason = "waiting-for-native-size";
    const parts = nativePlayerParts(s);
    const canNotify = parts && sizeNotificationPending(s, parts);
    const notificationDelay = NATIVE_SIZE_NOTIFY_MS - (now - state.sampleChangedAt);
    if (canNotify && notificationDelay <= 0 && notifyNativeSize(s, parts)) {
      // Verify on the next rendering frame; dispatch alone is not success.
      scheduleSizing();
      return;
    }
    // Keep the same 1s safety interval, but require an observed mismatch to
    // remain unchanged for that interval. A multi-step native layout is not a
    // failed layout merely because 1s elapsed since its first intermediate box.
    const remaining = NATIVE_SIZE_SETTLE_MS - (now - state.sampleChangedAt);
    if (remaining <= 0) {
      if (state.established) {
        // A previously verified page-width preference is not a video/control
        // measurement. Do not silently undo it on a later site-state change.
        // Retaining width is NOT a claim that native interactions are verified.
        clearNativeWidthCheck(s); state.phase = "unconfirmed";
        state.reason = "native-size-unconfirmed-width-retained";
        renderNativeWidthNotice(s);
      } else restoreNativeWidth(s, "native-size-update-unconfirmed");
      return;
    }
    if (!state.timeout) state.timeout = window.setTimeout(() => {
      if (session !== s || s.nativeWidth !== state) return;
      state.timeout = 0;
      if (suspended || navigating) return;
      // Re-enter normal validation on a rendering frame. In particular, do not
      // roll back from a stale timer after a mode or document-context change.
      scheduleSizing();
    }, Math.ceil(canNotify && notificationDelay > 0 ? Math.min(remaining, notificationDelay) : remaining));
  }
  function updateFlowSizing(s: Session): void {
    syncSizingObservation(s); s.sizingChecks++;
    // Ambient overflow is independent of whether all three content sections
    // have loaded. Isolate only verified decoration, not the partial page.
    updateAmbientContainment(s);
    updateWidthSizing(s);
    updatePlayerViewport(s);
    const columns = single(s.watch, ":scope > #columns");
    const primary = columns && single(columns, ":scope > #primary");
    const secondary = columns && single(columns, ":scope > #secondary");
    // Live pages need no comment tree. An absent/disabled chat must not reserve
    // comment-sized blank space; any visible unmanaged native panel still wins.
    const flowTabs: readonly TabName[] = chatWatch(s.watch) ? ["info", "videos"] : requiredTabs(s);
    const ready = flowTabs.every(name => liveSection(s, name));
    s.flowReason = !ready ? "sections-not-ready" : !columns || !primary || !secondary || !secondary.contains(s.secondary) ? "unsupported-shell" :
      document.fullscreenElement || s.watch.matches("[theater],[fullscreen]") ? "native-mode" : nativePanels(s.watch).length ? "native-panel-open" : "content-sized";
    if (s.flowReason !== "content-sized" || !columns || !primary || !secondary) { clearFlowSizing(s); return; }
    const left = primary.getBoundingClientRect(), right = secondary.getBoundingClientRect();
    const sideBySide = left.width > 0 && right.width > 0 &&
      (left.right <= right.left + 1 || right.right <= left.left + 1) &&
      left.top < right.bottom && right.top < left.bottom;
    if (!sideBySide) { s.flowReason = "single-column"; clearFlowSizing(s); return; }
    const primaryInner = single(primary, ":scope > #primary-inner") || primary;
    const below = single(primaryInner, ":scope > #below");
    const nodes = new Set([s.watch, columns, primary, primaryInner, secondary, s.secondary]);
    if (below) nodes.add(below);
    // The description's original metadata card retains its bottom margin after
    // relocation. That margin can collapse through #below and its empty siblings,
    // extending the page even when all visible content fits in the viewport.
    // Own only the verified origin card's spacing; keep its title/actions intact.
    const metadata = s.records.get("info")?.marker.parentElement?.closest<HTMLElement>("ytd-watch-metadata");
    if (metadata && primaryInner.contains(metadata)) nodes.add(metadata);
    clearFlowSizing(s, nodes);
    for (const node of nodes) {
      if (!s.flowNodes.has(node)) s.flowNodes.set(node, node.getAttribute(FLOW_ATTRIBUTE));
      setAttr(node, FLOW_ATTRIBUTE, node === columns ? "columns" : node === metadata ? "metadata" : "content");
    }
  }
  const GEOMETRY_IDS = new Set(["content", "page-manager", "columns", "primary", "primary-inner", "secondary", "secondary-inner", "below", "cinematics", "player", "player-container-outer", "player-container-inner", "ytd-player", "movie_player", "btx-youtube-tabs", "btx-pane-info", "btx-pane-comments", "btx-pane-playlist", "btx-pane-videos", "playlist"]);
  function geometry(node: HTMLElement): Record<string, unknown> {
    // No titles, text, hrefs, source URLs, arbitrary IDs, or page state objects.
    const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
    return { element: node.tagName.toLowerCase() + (GEOMETRY_IDS.has(node.id) ? `#${node.id}` : ""),
      top: Math.round(rect.top + scrollY), bottom: Math.round(rect.bottom + scrollY),
      left: Math.round(rect.left + scrollX), right: Math.round(rect.right + scrollX),
      width: Math.round(rect.width), height: Math.round(rect.height),
      clientHeight: node.clientHeight, scrollHeight: node.scrollHeight,
      display: style.display, position: style.position, contain: style.contain,
      cssWidth: style.width, cssHeight: style.height, inlineSize: style.inlineSize, blockSize: style.blockSize,
      aspectRatio: style.aspectRatio, objectFit: style.objectFit, transform: style.transform,
      minHeight: style.minHeight, maxHeight: style.maxHeight, minWidth: style.minWidth, maxWidth: style.maxWidth,
      paddingLeft: style.paddingLeft, paddingRight: style.paddingRight, marginLeft: style.marginLeft, marginRight: style.marginRight,
      columnGap: style.columnGap, flexGrow: style.flexGrow, flexBasis: style.flexBasis,
      paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, marginBottom: style.marginBottom,
      boxSizing: style.boxSizing, borderTop: style.borderTopWidth, borderBottom: style.borderBottomWidth,
      borderLeft: style.borderLeftWidth, borderRight: style.borderRightWidth,
      overflowX: style.overflowX, overflowY: style.overflowY,
      widthMarker: node.getAttribute(WIDTH_ATTRIBUTE), flowMarker: node.getAttribute(FLOW_ATTRIBUTE), ambientMarker: node.getAttribute(AMBIENT_ATTRIBUTE) };
  }
  function playerSizingState(s: Session | null): Record<string, unknown> {
    if (!s) return { state: "no-session" };
    const primary = single(s.watch, ":scope > #columns > #primary");
    const inner = primary && (single(primary, ":scope > #primary-inner") || primary);
    const candidates = [...s.watch.querySelectorAll<HTMLElement>("#movie_player")].filter(node =>
      rendered(node) && !node.closest("#btx-youtube-tabs,ytd-miniplayer") && node.closest("ytd-watch-flexy") === s.watch);
    if (!inner || candidates.length !== 1) return { state: candidates.length > 1 ? "ambiguous-player" : "player-not-ready" };
    const player = candidates[0], box = player.getBoundingClientRect(), style = getComputedStyle(inner);
    const contentWidth = Math.max(0, inner.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0));
    const nativeMode = Boolean(document.fullscreenElement || s.watch.matches("[theater],[fullscreen]"));
    const comparable = !nativeMode && s.widthReason === "compact" && inner.contains(player);
    // An outer gutter check does NOT prove the player followed the new width.
    // Report the difference; never force a private player size or mislabel a
    // deliberately letterboxed video as a playback failure.
    const state = nativeMode ? "native-mode" : !comparable ? "width-not-applied" : box.width <= 0 || contentWidth <= 0 ? "player-not-ready" :
      Math.abs(contentWidth - box.width) <= 2 ? "matches-primary" : box.width < contentWidth ? "narrower-than-primary" : "wider-than-primary";
    const ancestors: Record<string, unknown>[] = [];
    for (let node: HTMLElement | null = player, depth = 0; node && node !== inner && depth < 8; node = node.parentElement, depth++) {
      ancestors.push(geometry(node));
      if (node === s.watch) break;
    }
    const media = [...player.querySelectorAll<HTMLVideoElement>("video")].filter(node => rendered(node));
    const videoFits = media.length === 1 ? videoFitsBox(media[0], box) : null;
    // Read-only status can be requested before a queued ResizeObserver delivery.
    // Never repeat a cached success when the current rendered boxes disagree.
    const nativeSlot = player.closest<HTMLElement>("#player-container-inner");
    const parts = nativePlayerParts(s);
    const fitState = s.nativeWidth.phase === "accepted" ? (nativeSizeMatches(s) ? "native-boxes-match" : "unverified-geometry") : s.nativeWidth.reason;
    return { state, primaryContentWidth: Math.round(contentWidth), playerWidth: Math.round(box.width),
      playerHeight: Math.round(box.height), unusedPrimaryWidth: Math.round(contentWidth - box.width),
      viewportFit: { state: fitState, active: false, strategy: "native-owner", outerWrappersModified: false,
        widthPhase: s.nativeWidth.phase, widthExpansionApplied: s.widthNodes.size > 0 && s.widthReason === "compact",
        normalWidthPolicyRetained: s.widthNodes.size > 0, previouslyVerifiedWide: s.nativeWidth.established,
        interactionVerification: "not-performed-by-passive-diagnostic",
        referenceNodesReplaced: s.nativeWidth.reference && parts ?
          (["player", "video", "controls", "progress", "row"] as const).some(key => s.nativeWidth.reference![key] !== parts[key]) : null,
        mismatchQuietForMs: s.nativeWidth.sample ? Math.round(performance.now() - s.nativeWidth.sampleChangedAt) : null,
        pendingCheck: s.nativeWidth.timeout !== 0,
        sizeNotifications: s.nativeWidth.notifications,
        lastMismatchSample: s.nativeWidth.sample ? [...s.nativeWidth.sample] : null,
        restoreVerified: s.nativeWidth.phase === "blocked" ? nativeRestoreMatches(s) : null,
        slot: nativeSlot ? geometry(nativeSlot) : null,
        videoContainer: media.length === 1 && media[0].parentElement ? geometry(media[0].parentElement) : null,
        videoFitsPlayer: videoFits,
        controls: parts ? geometry(parts.controls) : null,
        progress: parts?.progress ? geometry(parts.progress) : null, buttonRow: parts ? geometry(parts.row) : null },
      ancestors, video: media.length === 1 ? { ...geometry(media[0]), decodedWidth: media[0].videoWidth, decodedHeight: media[0].videoHeight } : null };
  }
  function scrollState(): Record<string, unknown> {
    // On-demand geometry only, never a pixel heuristic or a blanket claim that
    // a nonzero scroll range is empty. Include unmodified ancestors and decor.
    const root = document.scrollingElement, s = session;
    const nodes = new Set<HTMLElement>();
    for (let node = s?.watch || null, depth = 0; node && depth < 12; node = node.parentElement, depth++) nodes.add(node);
    if (s) for (const node of s.watch.querySelectorAll<HTMLElement>("#columns,#primary,#primary-inner,#secondary,#secondary-inner,#below,#movie_player,#player,#player-container-outer,#player-container-inner,#ytd-player,ytd-watch-metadata")) nodes.add(node);
    const ambient = s ? [...s.watch.querySelectorAll<HTMLElement>("#cinematics")] : [];
    return { contentSized: Boolean(s?.flowNodes.size), sizingReason: s?.flowReason || "no-session",
      playerSizing: playerSizingState(s), sizingChecks: s?.sizingChecks ?? 0, observedSizingElements: s?.sizingNodes.size ?? 0,
      widthSizingReason: s?.widthReason || "no-session", viewportWidth: root?.clientWidth ?? innerWidth, documentWidth: root?.scrollWidth ?? null,
      horizontalScrollRange: root ? Math.max(0, root.scrollWidth - root.clientWidth) : null,
      viewportHeight: root?.clientHeight ?? innerHeight, documentHeight: root?.scrollHeight ?? null,
      scrollTop: root?.scrollTop ?? null, scrollRange: root ? Math.max(0, root.scrollHeight - root.clientHeight) : null,
      ambientState: s?.ambientReason || "no-session",
      containers: [...nodes].slice(0, 32).map(geometry),
      ambient: ambient.slice(0, 4).map(node => ({ ...geometry(node),
        descendants: [...node.querySelectorAll<HTMLElement>("div,canvas")].slice(0, 12).map(geometry) })),
      panel: s ? { ...geometry(s.host), internalScroll: settings.youtubePanelScrollEnabled,
        panes: [...s.panes.values()].map(node => ({ ...geometry(node), hidden: node.hidden })) } : null };
  }
  function scheduleGeometry(): void {
    if (session && !resizeFrame) resizeFrame = requestAnimationFrame(() => { resizeFrame = 0; updateGeometry(); });
  }
  function updateGeometry(): void {
    if (!session) return;
    // In the content-sized two-column layout, this panel is in document flow.
    // Scrolling does not create more available height: anchor its budget to its
    // document position so wheel input cannot grow the chat and extend the page.
    const top = session.host.getBoundingClientRect().top + (session.flowReason === "content-sized" ? scrollY : 0);
    const header = session.host.querySelector<HTMLElement>(".btx-tabs-header")!;
    const chromeHeight = header.offsetHeight + (session.note.hidden ? 0 : session.note.offsetHeight) + (session.issueNote.hidden ? 0 : session.issueNote.offsetHeight);
    const height = Math.max(160, Math.floor(innerHeight - Math.max(16, top) - chromeHeight - 24));
    const value = `${height}px`;
    if (session.host.style.getPropertyValue("--btx-pane-height") !== value) session.host.style.setProperty("--btx-pane-height", value);
  }
  function expanded(node: HTMLElement): boolean | null {
    if (node.matches("ytd-text-inline-expander")) return node.hasAttribute("is-expanded");
    if (node.matches("ytd-expander")) return !node.hasAttribute("collapsed");
    return null;
  }
  function visibleDescriptionCandidate(nodes: HTMLElement[]): HTMLElement | null {
    const visible = nodes.filter(rendered);
    // A sole hidden source can be observed for readiness, but never clicked.
    return visible.length === 1 ? visible[0] : !visible.length && nodes.length === 1 ? nodes[0] : null;
  }
  function descriptionRoot(watch: HTMLElement): HTMLElement | null {
    const candidates = [...watch.querySelectorAll<HTMLElement>("ytd-watch-metadata #description")].filter(node =>
      sameWatch(node, watch) && !node.closest(NATIVE_PANELS));
    const owned = session?.records.get("info")?.node;
    if (owned?.isConnected && owned.closest("ytd-watch-flexy") === watch) candidates.push(owned);
    // Expansion does not relocate anything. Embedded media is a reason to
    // decline layout ownership, not a reason to reject the native more button.
    return visibleDescriptionCandidate(candidates);
  }
  function descriptionExpander(description: HTMLElement): HTMLElement | null {
    if (description.matches(DESCRIPTION_EXPANDERS)) return description;
    const roots = [...description.querySelectorAll<HTMLElement>(DESCRIPTION_EXPANDERS)].filter(node => {
      const parent = node.parentElement?.closest(DESCRIPTION_EXPANDERS);
      return !parent || !description.contains(parent);
    });
    const named = roots.filter(node => node.id === "description-inline-expander");
    return visibleDescriptionCandidate(named.length ? named : roots);
  }
  function expanderButton(node: HTMLElement, opening: boolean): HTMLElement | null {
    const candidates = [...node.querySelectorAll<HTMLElement>(opening ? "#expand,#more" : "#collapse,#less")].filter(candidate =>
      candidate.closest(DESCRIPTION_EXPANDERS) === node && candidate.matches(DESCRIPTION_BUTTON) && rendered(candidate) &&
      !candidate.matches(":disabled") && !candidate.hasAttribute("disabled") && candidate.getAttribute("aria-disabled") !== "true");
    return candidates.length === 1 ? candidates[0] : null;
  }
  function clearExpansionCheck(): void {
    if (expansionTimer) clearTimeout(expansionTimer); expansionTimer = 0;
  }
  function checkExpansionLater(e: Expansion, delay: number): void {
    clearExpansionCheck();
    expansionTimer = window.setTimeout(() => {
      expansionTimer = 0;
      if (expansion === e) schedule();
    }, Math.max(1, delay));
  }
  function restoreExpansion(): void {
    const e = expansion; expansion = null;
    e?.resizeObserver.disconnect(); clearExpansionCheck();
    if (!e || e.userTouched || e.initiallyExpanded || !e.requested || !e.node.isConnected || videoKey() !== e.videoKey || expanded(e.node) !== true) return;
    // A different tab/native panel can hide OUR container. Reveal only that container
    // synchronously for the real collapse control; never modify YouTube's hidden/state attributes.
    const ownPane = session?.panes.get("info");
    const ownBody = session?.body;
    const reveal = Boolean(ownPane?.contains(e.node) && ownBody);
    const paneHidden = ownPane?.hidden, bodyHidden = ownBody?.hidden;
    try {
      if (reveal) { ownPane!.hidden = false; ownBody!.hidden = false; }
      const button = expanderButton(e.node, false);
      if (!button) { lastDescriptionIssue = "설명을 접는 실제 버튼을 확인하지 못해 펼침 상태를 복원하지 못했습니다."; return; }
      button.click();
    } finally {
      if (reveal) { ownPane!.hidden = Boolean(paneHidden); ownBody!.hidden = Boolean(bodyHidden); }
    }
    expansionTimer = window.setTimeout(() => {
      expansionTimer = 0;
      if (e.node.isConnected && videoKey() === e.videoKey && expanded(e.node) === true) lastDescriptionIssue = "YouTube 설명의 접힘 결과를 확인하지 못했습니다.";
    }, 500);
  }
  function updateExpansion(watch: HTMLElement | null): void {
    if (descriptionUserVideo !== null && descriptionUserVideo !== videoKey()) descriptionUserVideo = null;
    if (!settings.youtubeDescriptionExpandedEnabled || !watch) { restoreExpansion(); return; }
    const description = descriptionRoot(watch);
    const node = description ? descriptionExpander(description) : null;
    if (!node) {
      if (expansion && (!expansion.node.isConnected || expansion.videoKey !== videoKey())) restoreExpansion();
      lastDescriptionIssue = "지원하는 설명 펼침 요소를 아직 확인하지 못했습니다."; return;
    }
    if (expansion?.node !== node || expansion.videoKey !== videoKey()) {
      restoreExpansion();
      const resizeObserver = new ResizeObserver(() => { if (expansion?.node === node) schedule(); });
      expansion = { node, videoKey: videoKey(), initiallyExpanded: expanded(node) === true, requested: false, confirmed: false,
        userTouched: descriptionUserVideo === videoKey(), sentAt: 0, attempts: 0, resizeObserver };
      lastDescriptionIssue = "";
    }
    const e = expansion;
    if (e.userTouched || expanded(node) === true) {
      e.confirmed = expanded(node) === true;
      e.resizeObserver.disconnect(); clearExpansionCheck(); lastDescriptionIssue = "";
      return;
    }
    e.confirmed = false;
    if (e.attempts >= DESCRIPTION_ATTEMPT_LIMIT) {
      e.resizeObserver.disconnect(); clearExpansionCheck();
      lastDescriptionIssue = "확인된 더보기 버튼을 눌렀지만 설명이 펼쳐지지 않아 제한된 재시도를 중단했습니다."; return;
    }
    // Native styles and inactive information panes can become visible without
    // inserting another control. Observe the actual expander until it is ready.
    e.resizeObserver.observe(node);
    const remaining = Math.min(1500, 750 * e.attempts) - (performance.now() - e.sentAt);
    if (e.requested && remaining > 0) { checkExpansionLater(e, remaining); return; }
    const button = expanderButton(node, true);
    if (!button) { lastDescriptionIssue = "설명의 더보기 버튼이 표시되고 활성화되기를 기다립니다."; return; }
    // Recheck real collapsed state and the owning, enabled native control on
    // every attempt. Never retry after a trusted user choice or confirmed success.
    e.initiallyExpanded = false; e.requested = true; e.attempts++; e.sentAt = performance.now(); button.click();
    e.confirmed = expanded(node) === true;
    if (e.confirmed) { e.resizeObserver.disconnect(); clearExpansionCheck(); lastDescriptionIssue = ""; }
    else {
      lastDescriptionIssue = "YouTube 설명이 펼쳐지는지 확인하고 있습니다.";
      checkExpansionLater(e, Math.min(1500, 750 * e.attempts));
    }
  }
  function clearReadinessObservation(): void {
    readinessObserver?.disconnect(); readinessObserver = null; readinessNodes.clear();
  }
  function syncReadinessObservation(): void {
    const descriptionWaiting = settings.youtubeDescriptionExpandedEnabled && !expansion;
    if (suspended || (!descriptionWaiting && (!settings.youtubeLayoutTabsEnabled || (session && session.host.isConnected)))) {
      clearReadinessObservation(); return;
    }
    const wanted = new Set<HTMLElement>();
    for (const watch of document.querySelectorAll<HTMLElement>("ytd-watch-flexy")) {
      for (let node: HTMLElement | null = watch; node && node !== document.documentElement; node = node.parentElement) wanted.add(node);
      for (const node of watch.querySelectorAll<HTMLElement>("#columns,#primary,#primary-inner,#secondary,#secondary-inner")) {
        if (sameWatch(node, watch)) wanted.add(node);
      }
    }
    if (!wanted.size) { clearReadinessObservation(); return; }
    readinessObserver ||= new ResizeObserver(() => schedule());
    for (const node of readinessNodes) if (!wanted.has(node)) { readinessObserver.unobserve(node); readinessNodes.delete(node); }
    for (const node of wanted) if (!readinessNodes.has(node)) { readinessNodes.add(node); readinessObserver.observe(node); }
  }
  function clearBlock(): void {
    blockedWatch = null; blockedTheater = null; blockedVideoKey = ""; blockedSecondary = null; blockedAmbiguousSection = null;
  }
  function resumeWhenNativeNavigationReady(): void {
    if (!navigating || !navigationOrigin) return;
    const watch = currentWatch();
    const key = watch?.getAttribute("video-id");
    // No timeout claims that the page is ready. Resume only on actual new
    // identity reflected in the DOM and consistent with the current URL.
    if (watch && key && key === videoKey() &&
        (watch !== navigationOrigin.watch || key !== navigationOrigin.videoKey || key !== navigationOrigin.nativeVideoKey)) {
      navigating = false; navigationOrigin = null; lastLifecycleEvent = "native-video-ready";
    }
  }
  function refreshNavigationBoundary(kind: string): void {
    lastLifecycleEvent = kind;
    // Commit is only a signal to inspect, not a signal to intercept navigation
    // or an assertion that YouTube's new DOM has already finished loading.
    if (kind === "navigatesuccess" && navigating && navigationOrigin &&
        navigationOrigin.videoKey === videoKey() && currentWatch() === navigationOrigin.watch) {
      // A completed same-video navigation (for example a chapter/hash change)
      // does not need a different video-id in order to resume.
      navigating = false; navigationOrigin = null;
    }
    resumeWhenNativeNavigationReady(); refresh();
  }
  function finishNavigation(kind: string): void {
    navigating = false; navigationOrigin = null; lastLifecycleEvent = kind;
    const watch = currentWatch();
    // A real first commit may follow native startup relocation. Re-evaluate it
    // once per watch/video, never on every duplicated finish notification.
    if (kind === "yt-navigate-finish" && watch && (committedWatch !== watch || committedVideo !== videoKey())) {
      committedWatch = watch; committedVideo = videoKey();
      if (blockedWatch === watch && lastFailure && ["move-precondition-changed", "move-result-changed", "repeated-native-relocation"].includes(lastFailure.code)) clearBlock();
    }
    refresh();
  }
  function reconcile(): void {
    timer = 0;
    if (suspended) return;
    if (carriedWidth && (!carriedWidth.watch.isConnected || !isWatchPage() || !settings.youtubeLayoutTabsEnabled)) releaseCarriedWidth();
    syncReadinessObservation();
    resumeWhenNativeNavigationReady();
    if (navigating) return;
    reconciliations++;
    const watch = currentWatch();
    // A connected watch surface may be temporarily hidden during native mode
    // relayout. It is not a navigation: retain originals and wait for its DOM.
    if (!watch && session && settings.youtubeLayoutTabsEnabled && isWatchPage()) {
      if (session.videoKey !== videoKey() && session.watch.isConnected) {
        // URL commit can precede both reflected video-id and navigate-start.
        // Release old video sections without narrowing the still-current shell.
        restoreExpansion(); restoreLayout(true); syncReadinessObservation();
      }
      return;
    }
    if (session && (session.watch !== watch || session.videoKey !== videoKey())) {
      restoreExpansion(); restoreLayout(session.watch === watch && settings.youtubeLayoutTabsEnabled);
      blockedWatch = null; bookmark = null;
    }
    if (carriedWidth && watch && carriedWidth.watch !== watch) releaseCarriedWidth();
    if (bookmark && (bookmark.watch !== watch || bookmark.videoKey !== videoKey())) bookmark = null;
    if (blockedWatch && (blockedWatch !== watch && watch !== null || blockedVideoKey !== videoKey() ||
        (watch === blockedWatch && blockedTheater !== watch.hasAttribute("theater")))) { clearBlock(); lastIssue = ""; }
    if (watch && blockedWatch === watch) {
      const nativeSides = [...watch.querySelectorAll<HTMLElement>("#secondary #secondary-inner")].filter(n => sameWatch(n, watch) && rendered(n));
      const contextReplaced = nativeSides.length === 1 && blockedSecondary !== null && nativeSides[0] !== blockedSecondary;
      const ambiguityResolved = blockedAmbiguousSection !== null && discover(watch, blockedAmbiguousSection).node !== null;
      // Retry only after the blocking structural evidence changed. The same
      // reparenting conflict is never retried on unrelated text mutations.
      if (contextReplaced || ambiguityResolved) { clearBlock(); lastIssue = ""; }
    }
    if (session) observeTheaterMode(session);
    if (markedWatch && markedWatch !== watch) { markedWatch.removeAttribute("data-btx-channel-name"); markedWatch = null; }
    if (watch && settings.youtubeFullChannelNameEnabled) { setAttr(watch, "data-btx-channel-name", ""); markedWatch = watch; }
    else if (markedWatch) { markedWatch.removeAttribute("data-btx-channel-name"); markedWatch = null; }
    if (!settings.youtubeLayoutTabsEnabled) { restoreLayout(); blockedWatch = null; bookmark = null; }
    else if (watch && blockedWatch !== watch) {
      const secondaries = [...watch.querySelectorAll<HTMLElement>("#secondary #secondary-inner")].filter(node => sameWatch(node, watch) && rendered(node));
      const secondary = secondaries.length === 1 ? secondaries[0] : null;
      if (!secondary) lastIssue = "지원하는 오른쪽 패널 구조를 확인하지 못했습니다. 기존 배치를 유지합니다.";
      else if (!session && document.getElementById("btx-youtube-tabs")) lastIssue = "이전 레이아웃의 복원이 필요합니다. 페이지를 새로 고쳐 주세요.";
      else {
        try {
          failureStage = "verify-panel"; failureSection = null; moveSource = moveTarget = null;
          if (typeof (secondary as MoveParent).moveBefore !== "function") throw new LayoutFailure("move-api-unavailable", "이 Chrome에는 상태를 보존하는 DOM 이동 API가 없습니다.");
          if (session && !session.host.isConnected) {
            // Detachment can be temporary. Do not destroy the original trees in
            // a detached host before the site reconnects it. A complete set of
            // actual replacements is evidence that the old tree was discarded.
            const replaced = [...session.records.keys()].every(name => discover(watch, name).node !== null);
            if (!replaced) { lastIssue = "YouTube가 패널을 일시적으로 분리했습니다. 원래 요소의 재연결 또는 실제 대체 요소를 기다립니다."; return; }
            rememberLayout(session); restoreLayout();
          }
          if (session && (session.secondary !== secondary || session.host.parentElement !== secondary)) {
            // Move our own connected host as one tree to the observed sidebar;
            // do not destroy the session, its selection, inputs or scroll state.
            if (!session.host.isConnected || session.host.closest("ytd-watch-flexy") !== watch) throw new LayoutFailure("panel-context-changed", "탭 패널의 현재 문서를 확인하지 못했습니다.");
            if (session.host.parentElement !== secondary) move(secondary, session.host, secondary.firstChild);
            session.secondary = secondary;
            session.restoreScrollPending = true;
          }
          failureStage = "create-panel"; failureSection = null; moveSource = moveTarget = null;
          if (!session) { session = createLayout(watch, secondary); lastIssue = ""; }
          mountParts(session);
          failureStage = "paint-panel"; failureSection = null;
          paint(session); lastIssue = "";
        } catch (error) {
          lastIssue = ToolboxShared.errorMessage(error);
          const code: FailureCode = error instanceof LayoutFailure ? error.code : error instanceof SectionConflict ? "section-conflict" : "unexpected-error";
          lastFailure = { code, stage: failureStage, section: failureSection,
            errorName: error instanceof Error ? error.name : "Error", message: error instanceof LayoutFailure || error instanceof SectionConflict ? error.message : "예상하지 못한 DOM 작업 오류입니다.",
            documentReadyState: document.readyState, documentVisible: document.visibilityState === "visible",
            sourceConnected: moveSource?.isConnected ?? null, targetConnected: moveTarget?.isConnected ?? null };
          // Keep the exact record across a synchronous native connected/move
          // callback. Only an observed, unique native destination may reattach;
          // its one-time budget prevents an endless extension/site tug-of-war.
          if (session && failureSection && ["move-precondition-changed", "move-result-changed"].includes(code)) {
            const record = session.records.get(failureSection);
            if (record?.initialRelocationAvailable && session.host.isConnected && record.node.parentNode !== record.pane) {
              session.sections.set(failureSection, { state: "waiting", candidates: 1, reason: lastIssue });
              paint(session); syncReadinessObservation(); return;
            }
          }
          if (session) rememberLayout(session);
          restoreLayout(); blockedWatch = watch; blockedTheater = watch.hasAttribute("theater");
          blockedVideoKey = videoKey(); blockedSecondary = secondary;
          blockedAmbiguousSection = error instanceof SectionConflict ? error.section : null;
        }
      }
    } else if (settings.youtubeLayoutTabsEnabled && !watch) lastIssue = "일반 YouTube 시청 페이지의 지원 구조를 아직 확인하지 못했습니다.";
    updateExpansion(watch);
    syncReadinessObservation();
  }
  function schedule(): void {
    // Keep inspecting actual readiness during navigation rather than losing
    // every signal until one particular YouTube finish event arrives.
    if (!suspended && !timer) timer = window.setTimeout(reconcile, 32);
  }
  function relevant(records: MutationRecord[]): boolean {
    for (const r of records) {
      const target = r.target instanceof Element ? r.target : r.target.parentElement;
      if (r.type === "attributes" && target instanceof HTMLElement &&
          (readinessNodes.has(target) || (session && target.contains(session.watch)))) return true;
      if (r.type === "attributes" && target?.matches(PARTS)) return true;
      if (r.type === "attributes" && expansion && target &&
          (target.contains(expansion.node) || expansion.node.contains(target))) return true;
      if (r.type === "attributes" && r.attributeName === "href" &&
          (target?.closest(PLAYLIST_RENDERER) || (session?.sections.get("videos")?.state !== "mounted" && target?.closest("#related,ytd-watch-next-secondary-results-renderer")))) return true;
      if (r.type === "characterData" && target?.closest("ytd-comments-header-renderer,ytd-message-renderer")) return true;
      if (r.type === "childList") {
        if (target?.closest("#description")) return true;
        if (target?.closest("#cinematics")) return true;
        if (target?.closest(PLAYLIST_RENDERER)) return true;
        if (target?.closest(CHAT_RENDERER)) return true;
        if (target?.matches("ytd-comments-header-renderer *,ytd-message-renderer *,#count,#count-text")) return true;
        if (target?.matches("#related,ytd-watch-next-secondary-results-renderer")) return true;
        if (session?.sections.get("videos")?.state !== "mounted" && target?.closest("#related,ytd-watch-next-secondary-results-renderer")) return true;
        for (const node of [...r.addedNodes, ...r.removedNodes]) {
          if (node instanceof Element && (node.matches(DISCOVERY_PARTS) || node.querySelector(DISCOVERY_PARTS))) return true;
        }
      }
    }
    return false;
  }
  function refresh(): void {
    if (carriedWidth && (!settings.youtubeLayoutTabsEnabled || !isWatchPage() || !carriedWidth.watch.isConnected)) releaseCarriedWidth();
    const needsLayout = LAYOUT_KEYS.some(key => settings[key]);
    if (document.documentElement) {
      if (!suspended && settings.youtubeProgressThemeEnabled) setAttr(document.documentElement, "data-btx-youtube-progress", "");
      else document.documentElement.removeAttribute("data-btx-youtube-progress");
    }
    if (suspended) return;
    if (needsLayout && !observer) {
      observer = new MutationObserver(records => {
        if (relevant(records)) schedule();
        else if (session && records.some(r => (r.type === "attributes" || r.type === "childList") && r.target instanceof HTMLElement && session!.sizingNodes.has(r.target))) scheduleSizing();
      });
      observer.observe(document, { childList: true, subtree: true, characterData: true, attributes: true,
        attributeFilter: ["id", "hidden", "aria-hidden", "disabled", "aria-disabled", "role", "collapsed", "visibility", "is-expanded", "aria-expanded", "is-two-columns_", "theater", "full-bleed-player", "full-bleed-no-max-width-columns", "fullscreen", "video-id", "should-stamp-chat", "class", "style", "href"] });
    } else if (!needsLayout && observer) { observer.disconnect(); observer = null; }
    syncReadinessObservation();
    if (needsLayout || session || expansion || markedWatch) schedule();
  }
  function cleanup(preserveWidth = false): void {
    if (timer) clearTimeout(timer); timer = 0;
    if (resizeFrame) cancelAnimationFrame(resizeFrame); resizeFrame = 0;
    if (sizingFrame) cancelAnimationFrame(sizingFrame); sizingFrame = 0;
    observer?.disconnect(); observer = null;
    clearReadinessObservation();
    if (!preserveWidth) releaseCarriedWidth();
    restoreExpansion(); restoreLayout(preserveWidth); bookmark = null; blockedTheater = null;
    markedWatch?.removeAttribute("data-btx-channel-name"); markedWatch = null;
    document.documentElement?.removeAttribute("data-btx-youtube-progress");
  }
  function status(): Record<string, unknown> {
    const watch = currentWatch();
    const connectedSession = session && session.watch === watch && session.host.isConnected && session.host.parentElement === session.secondary;
    const liveSections = connectedSession ? [...session!.records.keys()].filter(name => liveSection(session!, name)) : [];
    const playlistState = session?.sections.get("playlist")?.state;
    const ready = Boolean(session && requiredTabs(session).every(name => liveSections.includes(name))) && !["ambiguous", "protected"].includes(playlistState || "");
    return { supportedWatchPage: Boolean(currentWatch()), layoutEnabled: settings.youtubeLayoutTabsEnabled,
      layout: session ? (ready ? "applied" : liveSections.length ? "partial" : "waiting") : settings.youtubeLayoutTabsEnabled ? "unavailable" : "off",
      movedSections: liveSections, selected: session?.selected || null,
      discussion: watch && chatWatch(watch) ? "chat" : "comments",
      displayMode: document.fullscreenElement || currentWatch()?.hasAttribute("fullscreen") ? "fullscreen" : currentWatch()?.hasAttribute("theater") ? "theater" : "normal",
      modeReattachments: session?.relocationCount || 0,
      blockedForCurrentMode: blockedWatch !== null && blockedWatch === currentWatch(),
      lifecycle: { revision: "2.0.0", suspended, navigating, observerConnected: observer !== null,
        widthCarryPending: carriedWidth !== null,
        readinessObservedElements: readinessNodes.size, lastEvent: lastLifecycleEvent,
        blockedReason: blockedWatch ? (blockedAmbiguousSection ? "ambiguous-" + blockedAmbiguousSection : lastFailure?.code || "unexpected-error") : null,
        lastFailure, initialReattachmentsRemaining: session ? [...session.records.values()].filter(record => record.initialRelocationAvailable).length : 0,
        visibleWatchCandidates: [...document.querySelectorAll<HTMLElement>("ytd-watch-flexy")].filter(rendered).length,
        nativeVideoMatchesLocation: (() => { const roots = [...document.querySelectorAll<HTMLElement>("ytd-watch-flexy")].filter(rendered);
          const key = roots.length === 1 ? roots[0].getAttribute("video-id") : null; return key ? key === videoKey() : null; })() },
      sections: session ? Object.fromEntries(session.sections) : {},
      yieldingToNativePanel: Boolean(session?.nativeSignature && !session.manuallyOpened),
      commentStatus: session && !chatWatch(session.watch) ? commentLabel(session).detail : null,
      description: !settings.youtubeDescriptionExpandedEnabled ? "off" : descriptionUserVideo === videoKey() ? "user-controlled" :
        expansion?.node.isConnected && expansion.videoKey === videoKey() && watch?.contains(expansion.node) && expanded(expansion.node) === true ? "expanded" : "unverified",
      descriptionAttempts: expansion?.videoKey === videoKey() ? expansion.attempts : 0,
      issue: lastIssue, descriptionIssue: lastDescriptionIssue, pageFlow: scrollState(),
      autoMiniplayer: "not-implemented-no-verified-public-navigation-path", reconciliationCount: reconciliations };
  }
  async function load(): Promise<void> {
    const epoch = ++settingsEpoch;
    const snapshotRevision = settingsJournal.mark();
    try {
      const values = await ToolboxShared.readStorage(chrome.storage.local, chrome.runtime, ToolboxShared.YOUTUBE_DEFAULTS);
      if (settingsEpoch !== epoch) return;
      // Keep unrelated stored preferences when one setting changes during the read.
      // Pagehide/new reads still invalidate the entire obsolete lifecycle operation.
      settings = ToolboxShared.youtubeSettings(settingsJournal.merge(values, snapshotRevision)); refresh();
    } catch (error) { lastIssue = `YouTube 설정을 읽지 못했습니다: ${ToolboxShared.errorMessage(error)}`; }
  }
  chrome.storage.onChanged.addListener((changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== "local") return;
    const next: Record<string, unknown> = { ...settings }; let changed = false;
    for (const key of Object.keys(ToolboxShared.YOUTUBE_DEFAULTS)) if (Object.hasOwn(changes, key)) { changed = true; next[key] = changes[key].newValue; }
    if (!changed) return;
    const layoutToggled = Object.hasOwn(changes, "youtubeLayoutTabsEnabled") &&
      settings.youtubeLayoutTabsEnabled !== Boolean(changes.youtubeLayoutTabsEnabled.newValue);
    settingsJournal.record(changes); settings = ToolboxShared.youtubeSettings(next);
    if (layoutToggled) clearBlock();
    if (!blockedWatch) lastIssue = "";
    lastDescriptionIssue = ""; refresh();
  });
  chrome.runtime.onMessage.addListener((message: { type?: string }, _sender: unknown, respond: (value: unknown) => void) => {
    if (message?.type !== ToolboxShared.YOUTUBE_STATUS_MESSAGE) return false;
    respond({ ok: true, result: status() }); return false;
  });
  document.addEventListener("click", event => {
    if (!event.isTrusted || !settings.youtubeDescriptionExpandedEnabled || !(event.target instanceof Element)) return;
    const button = event.target.closest(DESCRIPTION_CONTROLS);
    if (!button?.matches(DESCRIPTION_BUTTON)) return;
    const watch = currentWatch(), description = watch ? descriptionRoot(watch) : null;
    const node = description ? descriptionExpander(description) : null;
    if (!node || button.closest(DESCRIPTION_EXPANDERS) !== node) return;
    descriptionUserVideo = videoKey();
    if (expansion?.node === node) { expansion.userTouched = true; expansion.resizeObserver.disconnect(); }
    clearExpansionCheck(); schedule();
  }, true);
  document.addEventListener("yt-navigate-start", () => {
    const watch = currentWatch();
    navigationOrigin = { watch, videoKey: videoKey(), nativeVideoKey: watch?.getAttribute("video-id") || "" };
    navigating = true; lastLifecycleEvent = "yt-navigate-start";
    cleanup(true); clearBlock();
    // Return video-specific sections before the site's navigation, but retain
    // the verified normal-width shell. A new page/disabled feature releases it.
    // Re-arm discovery even if no yt-navigate-finish notification arrives.
    refresh();
  });
  document.addEventListener("yt-navigate-finish", () => finishNavigation("yt-navigate-finish"));
  window.addEventListener("popstate", () => finishNavigation("popstate"));
  // The standardized API is read-only here: do not patch history, intercept
  // routing, invent destinations or synthesize site/browser lifecycle events.
  const navigationEvents = w.navigation;
  if (navigationEvents instanceof EventTarget) {
    navigationEvents.addEventListener("currententrychange", () => refreshNavigationBoundary("currententrychange"));
    navigationEvents.addEventListener("navigatesuccess", () => refreshNavigationBoundary("navigatesuccess"));
    navigationEvents.addEventListener("navigateerror", () => finishNavigation("navigateerror"));
  }
  window.addEventListener("resize", event => {
    if (event.isTrusted && session && session.nativeWidth.phase === "blocked") resetNativeWidth(session);
    if (observer) schedule(); scheduleGeometry();
  });
  window.addEventListener("scroll", scheduleGeometry, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" && session) {
      // A backgrounded document may not render animation frames. Do not spend
      // its validation interval while the native renderer cannot be observed.
      clearNativeWidthCheck(session);
      session.nativeWidth.sample = null; session.nativeWidth.sampleChangedAt = 0;
      if (session.nativeWidth.reference && session.nativeWidth.phase !== "blocked") {
        session.nativeWidth.phase = "settling"; session.nativeWidth.reason = "waiting-for-visible-document";
      }
    }
    if (document.visibilityState === "visible" && (settings.youtubeLayoutTabsEnabled || settings.youtubeDescriptionExpandedEnabled)) { refreshNavigationBoundary("visibilitychange"); scheduleSizing(); }
  });
  // Position-only transitions need an explicit geometry check, not a recurring
  // resize notification. Only a measured native mismatch can request one.
  for (const type of ["transitionend", "transitioncancel", "animationend"]) document.addEventListener(type, event => {
    if (!(event.target instanceof HTMLElement)) return;
    if (readinessNodes.has(event.target)) schedule();
    else if (session?.sizingNodes.has(event.target)) scheduleSizing();
  }, true);
  for (const name of ["loadedmetadata", "resize", "emptied", "ended", "play", "playing", "seeked", "enterpictureinpicture", "leavepictureinpicture"]) {
    document.addEventListener(name, event => {
      if (event.target instanceof HTMLVideoElement && session?.sizingNodes.has(event.target)) scheduleSizing();
    }, true);
  }
  document.addEventListener("fullscreenchange", () => { if (session) updateFlowSizing(session); schedule(); scheduleGeometry(); });
  document.addEventListener("DOMContentLoaded", refresh, { once: true });
  window.addEventListener("pagehide", () => { suspended = true; settingsEpoch++; cleanup(); });
  window.addEventListener("pageshow", event => { if (event.persisted) { suspended = false; navigating = false; void load(); } });
  w[KEY] = Object.freeze({ getStatus: status });
  void load();
})();
