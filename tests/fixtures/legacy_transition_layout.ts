/** Optional watch-page layout. Operates on existing DOM only; no private YouTube state or API calls. */
(() => {
  "use strict";
  const KEY = "__browserToolboxYouTubeLayoutV1__";
  const w = globalThis as unknown as Record<string, unknown>;
  if (w[KEY]) return;
  function isYouTubePage(): boolean {
    return location.protocol === "https:" && ["www.youtube.com", "youtube.com"].includes(location.hostname) && window.top === window;
  }
  function isWatchPage(): boolean { return location.pathname === "/watch" && Boolean(new URL(location.href).searchParams.get("v")); }
  if (!isYouTubePage()) return;

  type TabName = "info" | "comments" | "playlist" | "videos";
  const TAB_ORDER: readonly TabName[] = ["info", "comments", "playlist", "videos"];
  const REQUIRED_TABS: readonly TabName[] = ["info", "comments", "videos"];
  type RecordNode = { node: HTMLElement; marker: Comment; parent: HTMLElement; pane: HTMLElement; priorOwner: string | null; initialRelocationAvailable: boolean };
  type SectionState = { state: "mounted" | "waiting" | "absent" | "ambiguous" | "protected"; reason: string; candidates: number };
  type Discovery = { node: HTMLElement | null; details: SectionState };
  type NativePlayerReference = { player: HTMLElement; video: HTMLVideoElement; controls: HTMLElement;
    progress: HTMLElement; row: HTMLElement; originalWidth: number; originalHeight: number; left: number; right: number; bottom: number;
    progressLeft: number; progressRight: number; rowLeft: number; rowRight: number };
  type NativeWidthState = { phase: "idle" | "settling" | "accepted" | "blocked";
    reference: NativePlayerReference | null; timeout: number; reason: string };
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
  type Expansion = { node: HTMLElement; initiallyExpanded: boolean; requested: boolean; confirmed: boolean; userTouched: boolean; sentAt: number; videoKey: string };
  type MoveParent = HTMLElement & { moveBefore?: (node: Node, before: Node | null) => void };
  let settings = { ...ToolboxShared.YOUTUBE_DEFAULTS };
  const settingsJournal = new ToolboxShared.SettingsReadJournal(Object.keys(ToolboxShared.YOUTUBE_DEFAULTS));
  let session: Session | null = null;
  let expansion: Expansion | null = null;
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
  const NATIVE_PANELS = "ytd-live-chat-frame,ytd-playlist-panel-renderer,ytd-engagement-panel-section-list-renderer";
  const PLAYER_SHELLS = "#player,#player-container-outer,#player-container-inner,#ytd-player,ytd-player,#movie_player";
  const PARTS = "ytd-watch-flexy,#cinematics,#columns,#primary-inner,#below,#primary,#secondary,#secondary-inner,#description,ytd-comments#comments,#related,ytd-watch-next-secondary-results-renderer,ytd-comments-header-renderer,ytd-message-renderer,ytd-text-inline-expander,ytd-live-chat-frame#chat,ytd-playlist-panel-renderer,ytd-playlist-panel-video-renderer,ytd-playlist-panel-video-wrapper-renderer,ytd-engagement-panel-section-list-renderer,#expand,#collapse";
  const DISCOVERY_PARTS = PARTS + "," + PLAYER_SHELLS + ",.html5-video-container,video.html5-main-video,.ytp-chrome-bottom";
  const LABELS: Record<TabName, string> = { info: "정보", comments: "댓글", playlist: "재생목록", videos: "동영상" };
  const LAYOUT_KEYS = ToolboxShared.YOUTUBE_FEATURES.filter(f => f.group === "layout").map(f => f.key);
  const text = (node: Element | null): string => node?.textContent?.replace(/\s+/g, " ").trim() || "";
  const videoKey = (): string => new URL(location.href).searchParams.get("v") || "";
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
    return name === "videos" ? hasRecommendations(node) : name === "playlist" ? hasPlaylistItems(node) : true;
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
    } else {
      const selector = name === "info" ? "ytd-watch-metadata #description" : "ytd-comments#comments";
      candidates = [...watch.querySelectorAll<HTMLElement>(selector)].filter(node => sameWatch(node, watch));
    }
    const visible = candidates.filter(rendered);
    const ready = visible.filter(node => sectionHasContent(name, node));
    if (name === "playlist" && !candidates.length) return { node: null, details: { state: "absent", candidates: 0, reason: "" } };
    if (ready.length > 1) return { node: null, details: { state: "ambiguous", candidates: ready.length,
      reason: `서로 다른 ${LABELS[name]} 영역 ${ready.length}개가 표시되어 대상을 확정하지 못했습니다. 기존 내용은 이동하거나 숨기지 않았습니다.` } };
    if (!ready.length) return { node: null, details: { state: "waiting", candidates: candidates.length,
      reason: candidates.length ? `${LABELS[name]} 영역이 비어 있거나 YouTube에서 숨겨져 있습니다. 내용이 준비되면 다시 연결합니다.` :
        `${LABELS[name]} 영역의 지원 구조를 아직 찾지 못했습니다. 기존 내용은 그대로 유지합니다.` } };
    const node = ready[0];
    const containsMainPlayer = node.matches("#movie_player,ytd-player") || Boolean(node.querySelector("#movie_player,ytd-player"));
    const protectedContent = name !== "videos" && name !== "playlist" && (node.matches("video,audio,iframe") || Boolean(node.querySelector("video,audio,iframe")));
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
  function restoreLayout(): void {
    const previous = session;
    if (!previous) return;
    previous.ac.abort(); previous.resizeObserver.disconnect(); previous.modeObserver.disconnect();
    previous.sizingObserver.disconnect(); previous.sizingNodes.clear();
    if (sizingFrame) cancelAnimationFrame(sizingFrame); sizingFrame = 0;
    clearFlowSizing(previous);
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
    path.setAttribute("d", name === "info" ? "M12 8v1m0 3v5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" : name === "comments" ? "M4 4h16v12H9l-5 4V4Z" : name === "playlist" ? "M3 5h14M3 10h14M3 15h8m4-2 6 4-6 4v-8Z" : "M4 4h16v16H4ZM10 8l6 4-6 4V8Z");
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
      sizingObserver: new ResizeObserver(() => { if (session === next) scheduleSizing(); }), sizingNodes: new Set(), sizingChecks: 0, nativeWidth: { phase: "idle", reference: null, timeout: 0, reason: "pending" },
      theater: watch.hasAttribute("theater"), relocationAllowed: new Set(), relocationCount: 0,
      playlistScroll: null, restoreScrollPending: false, scrollQuiet: false };
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
      span.textContent = label; button.hidden = name === "playlist";
      button.append(makeIcon(name), span); header.append(button); body.append(pane);
      button.addEventListener("click", event => { if (!event.isTrusted || button.getAttribute("aria-disabled") === "true") return; next.selected = name; next.manuallyOpened = true; paint(next); }, { signal: next.ac.signal });
      button.addEventListener("keydown", event => {
        if (!event.isTrusted || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const available = [...next.buttons.values()].filter(b => !b.hidden && b.getAttribute("aria-disabled") !== "true");
        if (!available.length) return;
        event.preventDefault();
        const i = available.indexOf(button), index = event.key === "Home" ? 0 : event.key === "End" ? available.length - 1 : (i + (event.key === "ArrowRight" ? 1 : -1) + available.length) % available.length;
        const target = available[index];
        next.selected = [...next.buttons].find(([, b]) => b === target)![0]; next.manuallyOpened = true; paint(next); target.focus();
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
          if ((name === "videos" || name === "playlist") && (!sectionHasContent(name, existing.node) || (name === "playlist" && nativeHidden(existing)))) {
            const replacement = discover(s.watch, name);
            if (replacement.node) {
              if (!restoreRecord(existing)) throw new Error(`이전 ${LABELS[name]} 영역을 복원하지 못했습니다.`);
              s.records.delete(name);
            } else {
              s.sections.set(name, { state: "waiting", candidates: 1, reason: `YouTube가 ${LABELS[name]} 내용을 준비하거나 숨긴 상태입니다.` });
              continue;
            }
          } else {
            if (name === "videos" || name === "playlist") {
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
    }
  }
  function nativePanels(watch: HTMLElement): string[] {
    const active: string[] = [];
    for (const node of watch.querySelectorAll<HTMLElement>("ytd-live-chat-frame#chat,ytd-playlist-panel-renderer,ytd-engagement-panel-section-list-renderer")) {
      // A playlist that we actually own is a tab, not an external panel.
      // Otherwise selecting it would make the tab panel yield to itself.
      const managed = session?.records.get("playlist");
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
    const comments = commentLabel(s), commentButton = s.buttons.get("comments")!;
    setText(commentButton.querySelector(".btx-tabs-label")!, comments.label); commentButton.title = comments.detail;
    const active = settings.youtubeNativePanelsEnabled ? nativePanels(s.watch) : [];
    const signature = active.join("|");
    if (signature !== s.nativeSignature) { s.nativeSignature = signature; s.manuallyOpened = false; }
    const yieldSpace = active.length > 0 && !s.manuallyOpened;
    const availableNames = [...s.buttons.keys()].filter(name => liveSection(s, name));
    if (!availableNames.includes(s.selected)) s.selected = availableNames[0] || "info";
    const nextTab = yieldSpace || !availableNames.length ? null : s.selected;
    if (nextTab !== s.renderedTab && s.renderedTab && !s.restoreScrollPending) s.scrollPositions.set(s.renderedTab, s.panes.get(s.renderedTab)!.scrollTop);
    if (s.body.hidden !== (nextTab === null)) s.body.hidden = nextTab === null;
    s.note.hidden = !yieldSpace && availableNames.length > 0;
    if (!availableNames.length) setText(s.note, "정보·댓글·동영상의 실제 요소를 기다리는 중입니다. 확인하지 못한 내용을 임의로 만들거나 숨기지 않습니다.");
    if (yieldSpace) setText(s.note, "YouTube 패널을 사용하는 중입니다. 위의 탭을 선택하면 함께 볼 수 있습니다.");
    const reasons: string[] = [];
    for (const [name, button] of s.buttons) {
      const available = availableNames.includes(name), selected = available && nextTab === name;
      const hideOptional = name === "playlist" && !available;
      if (button.hidden !== hideOptional) button.hidden = hideOptional;
      const details = s.sections.get(name);
      setAttr(button, "aria-disabled", String(!available)); setAttr(button, "aria-selected", String(selected)); button.tabIndex = available && s.selected === name ? 0 : -1;
      const pane = s.panes.get(name)!;
      if (pane.hidden !== !selected) pane.hidden = !selected;
      if (!available) {
        button.title = details?.reason || `${LABELS[name]} 영역을 기다리는 중입니다.`;
        if (name !== "playlist" || details?.state === "ambiguous" || details?.state === "protected") reasons.push(`${LABELS[name]}: ${button.title}`);
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
      if (REQUIRED_TABS.some(name => !liveSection(expected, name))) schedule();
    });
  }
  function clearWidthSizing(s: Session, keep = new Set<HTMLElement>()): void {
    for (const [node, prior] of s.widthNodes) {
      if (keep.has(node)) continue;
      if (prior === null) node.removeAttribute(WIDTH_ATTRIBUTE);
      else setAttr(node, WIDTH_ATTRIBUTE, prior);
      s.widthNodes.delete(node);
    }
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
      clearWidthSizing(s); resetNativeWidth(s); renderNativeWidthNotice(s); return;
    }
    const style = getComputedStyle(columns);
    const rowLayout = ["flex", "inline-flex"].includes(style.display) && ["row", "row-reverse"].includes(style.flexDirection);
    const gridLayout = ["grid", "inline-grid"].includes(style.display);
    const extraColumn = [...columns.children].some(node => node !== primary && node !== secondary && node instanceof HTMLElement &&
      rendered(node) && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0);
    if ((!rowLayout && !gridLayout) || style.writingMode !== "horizontal-tb" || extraColumn) {
      s.widthReason = "unsupported-columns"; clearWidthSizing(s); return;
    }
    const left = primary.getBoundingClientRect(), right = secondary.getBoundingClientRect();
    const sideBySide = left.width > 0 && right.width > 0 &&
      (left.right <= right.left + 1 || right.right <= left.left + 1) && left.top < right.bottom && right.top < left.bottom;
    if (!sideBySide) { s.widthReason = "single-column"; clearWidthSizing(s); return; }
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
  function resetNativeWidth(s: Session): void {
    if (s.nativeWidth.timeout) clearTimeout(s.nativeWidth.timeout);
    s.nativeWidth = { phase: "idle", reference: null, timeout: 0, reason: "pending" };
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
  function nativePlayerParts(s: Session): { player: HTMLElement; video: HTMLVideoElement;
    controls: HTMLElement; progress: HTMLElement; row: HTMLElement } | null {
    const players = [...s.watch.querySelectorAll<HTMLElement>("#movie_player.html5-video-player")]
      .filter(n => rendered(n) && n.closest("ytd-watch-flexy") === s.watch && !n.closest("#btx-youtube-tabs,ytd-miniplayer"));
    if (players.length !== 1) return null;
    const player = players[0];
    const videos = [...player.querySelectorAll<HTMLVideoElement>("video.html5-main-video")].filter(rendered);
    const controls = single(player, ":scope > .ytp-chrome-bottom");
    const progress = controls && single(controls, ".ytp-progress-bar");
    const row = controls && single(controls, ".ytp-chrome-controls");
    if (videos.length !== 1 || !controls || !progress || !row ||
        ![player, controls, progress, row, videos[0]].every(n => {
          const c = getComputedStyle(n), r = n.getBoundingClientRect();
          return rendered(n) && r.width > 0 && r.height > 0 && c.transform === "none" &&
            c.zoom === "1" && c.writingMode === "horizontal-tb";
        })) return null;
    return { player, video: videos[0], controls, progress, row };
  }
  function nativeReference(s: Session): NativePlayerReference | null {
    const p = nativePlayerParts(s);
    if (!p || document.pictureInPictureElement === p.video) return null;
    const box = p.player.getBoundingClientRect(), rail = p.controls.getBoundingClientRect();
    const progress = p.progress.getBoundingClientRect(), row = p.row.getBoundingClientRect();
    if (!videoFitsBox(p.video, box) || rail.left < box.left - 2 || rail.right > box.right + 2 ||
        rail.top < box.top - 2 || rail.bottom > box.bottom + 2 ||
        progress.left < rail.left - 2 || progress.right > rail.right + 2 ||
        row.left < rail.left - 2 || row.right > rail.right + 2) return null;
    return { ...p, originalWidth: box.width, originalHeight: box.height, left: rail.left - box.left, right: box.right - rail.right, bottom: box.bottom - rail.bottom,
      progressLeft: progress.left - rail.left, progressRight: rail.right - progress.right,
      rowLeft: row.left - rail.left, rowRight: rail.right - row.right };
  }
  function nativeSizeMatches(s: Session): boolean {
    const ref = s.nativeWidth.reference, current = nativePlayerParts(s);
    if (!ref || !current || (["player", "video", "controls", "progress", "row"] as const).some(k => ref[k] !== current[k])) return false;
    const box = ref.player.getBoundingClientRect(), rail = ref.controls.getBoundingClientRect();
    const progress = ref.progress.getBoundingClientRect(), row = ref.row.getBoundingClientRect();
    const slot = ref.player.closest<HTMLElement>("#player-container-inner");
    const near = (value: number, expected: number): boolean => Math.abs(value - expected) <= 2;
    return !!slot && sameBox(slot.getBoundingClientRect(), box) && videoFitsBox(ref.video, box) &&
      near(rail.left - box.left, ref.left) && near(box.right - rail.right, ref.right) && near(box.bottom - rail.bottom, ref.bottom) &&
      near(progress.left - rail.left, ref.progressLeft) && near(rail.right - progress.right, ref.progressRight) &&
      near(row.left - rail.left, ref.rowLeft) && near(rail.right - row.right, ref.rowRight);
  }
  function nativeRestoreMatches(s: Session): boolean {
    const ref = s.nativeWidth.reference;
    if (!ref || !nativeSizeMatches(s)) return false;
    const box = ref.player.getBoundingClientRect();
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
    if (s.nativeWidth.phase !== "blocked") { note?.remove(); return; }
    if (!note) { note = el("p", "btx-layout-status btx-player-sizing-status"); note.setAttribute("role", "status"); s.host.append(note); }
    setText(note, "플레이어와 진행 막대가 함께 넓어지는 것을 확인하지 못해 폭 확장만 해제했습니다. 탭형 패널은 유지합니다. " +
      (nativeRestoreMatches(s) ? "폭 확장 전 영상·조작부의 크기로 복원된 것을 확인했습니다." :
        "폭 확장 전 영상·조작부의 크기로 돌아왔는지는 아직 확인하지 못했습니다."));
  }
  function updatePlayerViewport(s: Session): void {
    // The native owner has a bounded opportunity to update its FULL interface.
    // No synthetic resize, private method, forced menu click or video style.
    if (s.nativeWidth.phase === "blocked") { renderNativeWidthNotice(s); return; }
    if (s.widthReason !== "compact") {
      resetNativeWidth(s); renderNativeWidthNotice(s); return;
    }
    if (nativeSizeMatches(s)) {
      if (s.nativeWidth.timeout) clearTimeout(s.nativeWidth.timeout);
      s.nativeWidth.timeout = 0; s.nativeWidth.phase = "accepted"; s.nativeWidth.reason = "native-boxes-match";
      renderNativeWidthNotice(s); return;
    }
    s.nativeWidth.phase = "settling"; s.nativeWidth.reason = "waiting-for-native-size";
    if (!s.nativeWidth.timeout) s.nativeWidth.timeout = window.setTimeout(() => {
      s.nativeWidth.timeout = 0;
      if (session !== s || suspended || navigating) return;
      if (nativeSizeMatches(s)) { s.nativeWidth.phase = "accepted"; s.nativeWidth.reason = "native-boxes-match"; }
      else restoreNativeWidth(s, "native-size-update-unconfirmed");
      renderNativeWidthNotice(s);
    }, NATIVE_SIZE_SETTLE_MS);
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
    const ready = REQUIRED_TABS.every(name => liveSection(s, name));
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
    clearFlowSizing(s, nodes);
    for (const node of nodes) {
      if (!s.flowNodes.has(node)) s.flowNodes.set(node, node.getAttribute(FLOW_ATTRIBUTE));
      setAttr(node, FLOW_ATTRIBUTE, node === columns ? "columns" : "content");
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
        widthPhase: s.nativeWidth.phase, widthExpansionApplied: s.widthNodes.size > 0,
        interactionVerification: "not-performed-by-passive-diagnostic",
        restoreVerified: s.nativeWidth.phase === "blocked" ? nativeRestoreMatches(s) : null,
        slot: nativeSlot ? geometry(nativeSlot) : null,
        videoContainer: media.length === 1 && media[0].parentElement ? geometry(media[0].parentElement) : null,
        videoFitsPlayer: videoFits,
        controls: parts ? geometry(parts.controls) : null,
        progress: parts ? geometry(parts.progress) : null, buttonRow: parts ? geometry(parts.row) : null },
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
    const top = session.host.getBoundingClientRect().top;
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
  function expanderButton(node: HTMLElement, opening: boolean): HTMLElement | null {
    const candidate = single(node, opening ? "#expand,#more" : "#collapse,#less");
    if (!candidate || !candidate.matches("button,[role='button'],tp-yt-paper-button,.button") || !rendered(candidate) || candidate.hasAttribute("disabled") || candidate.getAttribute("aria-disabled") === "true") return null;
    return candidate;
  }
  function restoreExpansion(): void {
    const e = expansion; expansion = null;
    if (expansionTimer) clearTimeout(expansionTimer); expansionTimer = 0;
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
    if (!settings.youtubeDescriptionExpandedEnabled || !watch) { restoreExpansion(); return; }
    const description = session?.records.get("info")?.node || discover(watch, "info").node;
    const node = description ? (description.matches("ytd-expander") ? description : single(description, "ytd-text-inline-expander")) : null;
    if (!node) { lastDescriptionIssue = "지원하는 설명 펼침 요소를 아직 확인하지 못했습니다."; return; }
    if (expansion?.node !== node || expansion.videoKey !== videoKey()) {
      restoreExpansion();
      expansion = { node, videoKey: videoKey(), initiallyExpanded: expanded(node) === true, requested: false, confirmed: false, userTouched: false, sentAt: 0 };
      lastDescriptionIssue = "";
    }
    const e = expansion;
    if (e.userTouched || e.initiallyExpanded) return;
    if (e.requested) {
      if (expanded(node)) { e.confirmed = true; lastDescriptionIssue = ""; }
      else if (performance.now() - e.sentAt >= 450) lastDescriptionIssue = "YouTube 설명 펼치기 결과를 확인하지 못했습니다. 자동으로 반복 클릭하지 않습니다.";
      return;
    }
    const button = expanderButton(node, true);
    if (!button) { lastDescriptionIssue = "확인 가능한 설명 더보기 버튼이 없습니다. 페이지 내용을 임의로 펼치지 않았습니다."; return; }
    e.requested = true; e.sentAt = performance.now(); button.click();
    expansionTimer = window.setTimeout(() => { expansionTimer = 0; schedule(); }, 500);
  }
  function clearReadinessObservation(): void {
    readinessObserver?.disconnect(); readinessObserver = null; readinessNodes.clear();
  }
  function syncReadinessObservation(): void {
    if (suspended || !settings.youtubeLayoutTabsEnabled || (session && session.host.isConnected)) {
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
    syncReadinessObservation();
    resumeWhenNativeNavigationReady();
    if (navigating) return;
    reconciliations++;
    const watch = currentWatch();
    // A connected watch surface may be temporarily hidden during native mode
    // relayout. It is not a navigation: retain originals and wait for its DOM.
    if (!watch && session && settings.youtubeLayoutTabsEnabled && isWatchPage() && session.videoKey === videoKey()) return;
    if (session && (session.watch !== watch || session.videoKey !== videoKey())) { restoreExpansion(); restoreLayout(); blockedWatch = null; bookmark = null; }
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
      if (r.type === "attributes" && r.attributeName === "href" &&
          (target?.closest(PLAYLIST_RENDERER) || (session?.sections.get("videos")?.state !== "mounted" && target?.closest("#related,ytd-watch-next-secondary-results-renderer")))) return true;
      if (r.type === "characterData" && target?.closest("ytd-comments-header-renderer,ytd-message-renderer")) return true;
      if (r.type === "childList") {
        if (target?.closest("#cinematics")) return true;
        if (target?.closest(PLAYLIST_RENDERER)) return true;
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
        attributeFilter: ["id", "hidden", "aria-hidden", "collapsed", "visibility", "is-expanded", "aria-expanded", "is-two-columns_", "theater", "full-bleed-player", "full-bleed-no-max-width-columns", "fullscreen", "video-id", "class", "style", "href"] });
    } else if (!needsLayout && observer) { observer.disconnect(); observer = null; }
    syncReadinessObservation();
    if (needsLayout || session || expansion || markedWatch) schedule();
  }
  function cleanup(): void {
    if (timer) clearTimeout(timer); timer = 0;
    if (resizeFrame) cancelAnimationFrame(resizeFrame); resizeFrame = 0;
    if (sizingFrame) cancelAnimationFrame(sizingFrame); sizingFrame = 0;
    observer?.disconnect(); observer = null;
    clearReadinessObservation();
    restoreExpansion(); restoreLayout(); bookmark = null; blockedTheater = null;
    markedWatch?.removeAttribute("data-btx-channel-name"); markedWatch = null;
    document.documentElement?.removeAttribute("data-btx-youtube-progress");
  }
  function status(): Record<string, unknown> {
    const watch = currentWatch();
    const connectedSession = session && session.watch === watch && session.host.isConnected && session.host.parentElement === session.secondary;
    const liveSections = connectedSession ? [...session!.records.keys()].filter(name => liveSection(session!, name)) : [];
    const playlistState = session?.sections.get("playlist")?.state;
    const ready = REQUIRED_TABS.every(name => liveSections.includes(name)) && !["ambiguous", "protected"].includes(playlistState || "");
    return { supportedWatchPage: Boolean(currentWatch()), layoutEnabled: settings.youtubeLayoutTabsEnabled,
      layout: session ? (ready ? "applied" : liveSections.length ? "partial" : "waiting") : settings.youtubeLayoutTabsEnabled ? "unavailable" : "off",
      movedSections: liveSections, selected: session?.selected || null,
      displayMode: currentWatch()?.hasAttribute("theater") ? "theater" : "normal",
      modeReattachments: session?.relocationCount || 0,
      blockedForCurrentMode: blockedWatch !== null && blockedWatch === currentWatch(),
      lifecycle: { revision: "1.74.0", suspended, navigating, observerConnected: observer !== null,
        readinessObservedElements: readinessNodes.size, lastEvent: lastLifecycleEvent,
        blockedReason: blockedWatch ? (blockedAmbiguousSection ? "ambiguous-" + blockedAmbiguousSection : lastFailure?.code || "unexpected-error") : null,
        lastFailure, initialReattachmentsRemaining: session ? [...session.records.values()].filter(record => record.initialRelocationAvailable).length : 0,
        visibleWatchCandidates: [...document.querySelectorAll<HTMLElement>("ytd-watch-flexy")].filter(rendered).length,
        nativeVideoMatchesLocation: (() => { const roots = [...document.querySelectorAll<HTMLElement>("ytd-watch-flexy")].filter(rendered);
          const key = roots.length === 1 ? roots[0].getAttribute("video-id") : null; return key ? key === videoKey() : null; })() },
      sections: session ? Object.fromEntries(session.sections) : {},
      yieldingToNativePanel: Boolean(session?.nativeSignature && !session.manuallyOpened), commentStatus: session ? commentLabel(session).detail : null,
      description: !settings.youtubeDescriptionExpandedEnabled ? "off" : expansion?.userTouched ? "user-controlled" : expansion && (expansion.initiallyExpanded || expansion.confirmed) ? "expanded" : "unverified",
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
    if (!event.isTrusted || !expansion || !(event.target instanceof Element)) return;
    const button = event.target.closest("#expand,#collapse,#more,#less");
    if (button && expansion.node.contains(button)) expansion.userTouched = true;
  }, true);
  document.addEventListener("yt-navigate-start", () => {
    const watch = currentWatch();
    navigationOrigin = { watch, videoKey: videoKey(), nativeVideoKey: watch?.getAttribute("video-id") || "" };
    navigating = true; lastLifecycleEvent = "yt-navigate-start";
    cleanup(); clearBlock();
    // Restore the old layout, but re-arm discovery even when a canceled or
    // superseded navigation never dispatches yt-navigate-finish.
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
    if (document.visibilityState === "visible" && settings.youtubeLayoutTabsEnabled) { refreshNavigationBoundary("visibilitychange"); scheduleSizing(); }
  });
  // Size observation does not cover position-only transitions; settle the
  // actual known shell once, rather than dispatching a fabricated resize event.
  for (const type of ["transitionend", "transitioncancel", "animationend"]) document.addEventListener(type, event => {
    if (!(event.target instanceof HTMLElement)) return;
    if (readinessNodes.has(event.target)) schedule();
    else if (session?.sizingNodes.has(event.target)) scheduleSizing();
  }, true);
  for (const name of ["loadedmetadata", "resize", "emptied", "enterpictureinpicture", "leavepictureinpicture"]) {
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
