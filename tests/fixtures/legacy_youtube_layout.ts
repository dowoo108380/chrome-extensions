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

  type TabName = "info" | "comments" | "videos";
  type RecordNode = { node: HTMLElement; marker: Comment; parent: HTMLElement; pane: HTMLElement; priorOwner: string | null };
  type Session = { watch: HTMLElement; videoKey: string; host: HTMLElement; body: HTMLElement; note: HTMLElement;
    selected: TabName; buttons: Map<TabName, HTMLButtonElement>; panes: Map<TabName, HTMLElement>; records: Map<TabName, RecordNode>;
    nativeSignature: string; manuallyOpened: boolean; ac: AbortController };
  type Expansion = { node: HTMLElement; initiallyExpanded: boolean; requested: boolean; confirmed: boolean; userTouched: boolean; sentAt: number; videoKey: string };
  type MoveParent = HTMLElement & { moveBefore?: (node: Node, before: Node | null) => void };
  let settings = { ...ToolboxShared.YOUTUBE_DEFAULTS };
  let session: Session | null = null;
  let expansion: Expansion | null = null;
  let markedWatch: HTMLElement | null = null;
  let observer: MutationObserver | null = null;
  let timer = 0, expansionTimer = 0, resizeFrame = 0, settingsEpoch = 0;
  let suspended = false, navigating = false, blockedWatch: HTMLElement | null = null;
  let lastIssue = "", lastDescriptionIssue = "";
  let reconciliations = 0;
  const PARTS = "ytd-watch-flexy,#secondary-inner,#description,ytd-comments#comments,#related,ytd-comments-header-renderer,ytd-message-renderer,ytd-text-inline-expander,ytd-live-chat-frame#chat,ytd-playlist-panel-renderer#playlist,ytd-engagement-panel-section-list-renderer,#expand,#collapse";
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
    return found.length === 1 ? found[0] : null;
  }
  function single(root: HTMLElement, selector: string): HTMLElement | null {
    const found = [...root.querySelectorAll<HTMLElement>(selector)];
    return found.length === 1 ? found[0] : null;
  }
  function move(parent: HTMLElement, node: HTMLElement, before: Node | null): void {
    const method = (parent as MoveParent).moveBefore;
    if (typeof method !== "function") throw new Error("상태를 보존하는 DOM 이동 API가 없습니다. 레이아웃을 적용하지 않았습니다.");
    // No appendChild fallback: it can reset iframe/media state and custom-element lifetime.
    method.call(parent, node, before);
    if (node.parentNode !== parent || (before && node.nextSibling !== before)) throw new Error("원래 페이지 요소의 이동 결과를 확인하지 못했습니다.");
  }
  function restoreRecord(record: RecordNode): boolean {
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
  function restoreLayout(): void {
    const previous = session;
    if (!previous) return;
    previous.ac.abort();
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
    path.setAttribute("d", name === "info" ? "M12 8v1m0 3v5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" : name === "comments" ? "M4 4h16v12H9l-5 4V4Z" : "M4 4h16v16H4ZM10 8l6 4-6 4V8Z");
    svg.append(path); return svg;
  }
  function createLayout(watch: HTMLElement, secondary: HTMLElement): Session {
    const host = el("section"); host.id = "btx-youtube-tabs"; host.setAttribute("aria-label", "Browser Toolbox 영상 정보");
    const header = el("div", "btx-tabs-header"); header.setAttribute("role", "tablist"); header.setAttribute("aria-label", "영상 정보 종류");
    const body = el("div", "btx-tabs-body"), note = el("p", "btx-native-note"); note.hidden = true;
    const next: Session = { watch, videoKey: videoKey(), host, body, note, selected: "info", buttons: new Map(), panes: new Map(), records: new Map(), nativeSignature: "", manuallyOpened: false, ac: new AbortController() };
    for (const [name, label] of [["info", "정보"], ["comments", "댓글"], ["videos", "동영상"]] as const) {
      const button = el("button"), span = el("span", "btx-tabs-label"), pane = el("div", "btx-tab-pane");
      button.type = "button"; button.id = `btx-tab-${name}`; pane.id = `btx-pane-${name}`;
      button.setAttribute("role", "tab"); button.setAttribute("aria-controls", pane.id); button.setAttribute("aria-selected", "false");
      pane.setAttribute("role", "tabpanel"); pane.setAttribute("aria-labelledby", button.id); pane.hidden = true;
      span.textContent = label; button.append(makeIcon(name), span); header.append(button); body.append(pane);
      button.addEventListener("click", event => { if (!event.isTrusted || button.getAttribute("aria-disabled") === "true") return; next.selected = name; next.manuallyOpened = true; paint(next); }, { signal: next.ac.signal });
      button.addEventListener("keydown", event => {
        if (!event.isTrusted || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const available = [...next.buttons.values()].filter(b => b.getAttribute("aria-disabled") !== "true");
        if (!available.length) return;
        event.preventDefault();
        const i = available.indexOf(button), index = event.key === "Home" ? 0 : event.key === "End" ? available.length - 1 : (i + (event.key === "ArrowRight" ? 1 : -1) + available.length) % available.length;
        const target = available[index];
        next.selected = [...next.buttons].find(([, b]) => b === target)![0]; next.manuallyOpened = true; paint(next); target.focus();
      }, { signal: next.ac.signal });
      next.buttons.set(name, button); next.panes.set(name, pane);
    }
    host.append(header, note, body);
    secondary.insertBefore(host, secondary.firstChild);
    return next;
  }
  function mountParts(s: Session): void {
    for (const [name, selector] of [["info", "ytd-watch-metadata #description"], ["comments", "ytd-comments#comments"], ["videos", "#related"]] as const) {
      const existing = s.records.get(name);
      if (existing) {
        if (!existing.node.isConnected) { restoreRecord(existing); s.records.delete(name); }
        else if (existing.node.parentNode !== existing.pane) throw new Error("YouTube가 요소의 배치를 다시 변경했습니다. 반복 이동하지 않고 레이아웃을 중단합니다.");
        else continue;
      }
      const source = single(s.watch, selector);
      if (!source || source.closest("#btx-youtube-tabs") || !(source.parentElement instanceof HTMLElement)) continue;
      // Do not relocate players, live chat, or video-containing description experiments.
      if (source.matches("video,iframe") || source.querySelector("video,iframe")) { lastIssue = "미디어나 프레임이 포함된 정보 요소는 이동하지 않았습니다."; continue; }
      const parent = source.parentElement, marker = document.createComment(`Browser Toolbox ${name} original position`);
      const record: RecordNode = { node: source, marker, parent, pane: s.panes.get(name)!, priorOwner: source.getAttribute("data-btx-layout-owned") };
      parent.insertBefore(marker, source); s.records.set(name, record);
      setAttr(source, "data-btx-layout-owned", name);
      move(record.pane, source, null);
    }
  }
  function nativePanels(watch: HTMLElement): string[] {
    const active: string[] = [];
    for (const node of watch.querySelectorAll<HTMLElement>("ytd-live-chat-frame#chat,ytd-playlist-panel-renderer#playlist,ytd-engagement-panel-section-list-renderer")) {
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
    const comments = commentLabel(s), button = s.buttons.get("comments")!;
    setText(button.querySelector(".btx-tabs-label")!, comments.label); button.title = comments.detail;
    const active = settings.youtubeNativePanelsEnabled ? nativePanels(s.watch) : [];
    const signature = active.join("|");
    if (signature !== s.nativeSignature) { s.nativeSignature = signature; s.manuallyOpened = false; }
    const yieldSpace = active.length > 0 && !s.manuallyOpened;
    s.body.hidden = yieldSpace || s.records.size === 0; s.note.hidden = !yieldSpace && s.records.size > 0;
    if (s.records.size === 0) setText(s.note, "옮길 정보·댓글·동영상 영역이 아직 없습니다. 원래 페이지에서 실제 요소가 준비되면 다시 확인합니다.");
    if (yieldSpace) setText(s.note, "YouTube 패널을 사용하는 중입니다. 위의 탭을 선택하면 함께 볼 수 있습니다.");
    if (!s.records.has(s.selected)) s.selected = [...s.records.keys()][0] || "info";
    for (const [name, b] of s.buttons) {
      const available = s.records.has(name), selected = available && s.selected === name;
      setAttr(b, "aria-disabled", String(!available)); setAttr(b, "aria-selected", String(selected)); b.tabIndex = selected ? 0 : -1;
      s.panes.get(name)!.hidden = !selected;
    }
    setAttr(s.host, "data-scroll", String(settings.youtubePanelScrollEnabled));
    updateGeometry();
  }
  function updateGeometry(): void {
    if (!session) return;
    const top = session.host.getBoundingClientRect().top;
    const height = Math.max(180, Math.floor(innerHeight - Math.max(72, top) - 82));
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
    const description = session?.records.get("info")?.node || single(watch, "ytd-watch-metadata #description");
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
  function reconcile(): void {
    timer = 0;
    if (suspended || navigating) return;
    reconciliations++;
    const watch = currentWatch();
    if (session && (session.watch !== watch || session.videoKey !== videoKey())) { restoreExpansion(); restoreLayout(); blockedWatch = null; }
    if (markedWatch && markedWatch !== watch) { markedWatch.removeAttribute("data-btx-channel-name"); markedWatch = null; }
    if (watch && settings.youtubeFullChannelNameEnabled) { setAttr(watch, "data-btx-channel-name", ""); markedWatch = watch; }
    else if (markedWatch) { markedWatch.removeAttribute("data-btx-channel-name"); markedWatch = null; }
    if (!settings.youtubeLayoutTabsEnabled) { restoreLayout(); blockedWatch = null; }
    else if (watch && blockedWatch !== watch) {
      const secondary = single(watch, "#secondary-inner");
      if (!secondary) lastIssue = "지원하는 오른쪽 패널 구조를 확인하지 못했습니다. 기존 배치를 유지합니다.";
      else if (!session && document.getElementById("btx-youtube-tabs")) lastIssue = "이전 레이아웃의 복원이 필요합니다. 페이지를 새로 고쳐 주세요.";
      else {
        try {
          if (typeof (secondary as MoveParent).moveBefore !== "function") throw new Error("이 Chrome에는 상태를 보존하는 DOM 이동 API가 없습니다.");
          if (!session) { session = createLayout(watch, secondary); lastIssue = ""; }
          mountParts(session); paint(session);
        } catch (error) { lastIssue = ToolboxShared.errorMessage(error); restoreLayout(); blockedWatch = watch; }
      }
    } else if (settings.youtubeLayoutTabsEnabled && !watch) lastIssue = "일반 YouTube 시청 페이지의 지원 구조를 아직 확인하지 못했습니다.";
    updateExpansion(watch);
  }
  function schedule(): void {
    if (!suspended && !navigating && !timer) timer = window.setTimeout(reconcile, 32);
  }
  function relevant(records: MutationRecord[]): boolean {
    for (const r of records) {
      const target = r.target instanceof Element ? r.target : r.target.parentElement;
      if (r.type === "attributes" && target?.matches(PARTS)) return true;
      if (r.type === "characterData" && target?.closest("ytd-comments-header-renderer,ytd-message-renderer")) return true;
      if (r.type === "childList") {
        if (target?.matches("ytd-comments-header-renderer *,ytd-message-renderer *,#count,#count-text")) return true;
        for (const node of [...r.addedNodes, ...r.removedNodes]) {
          if (node instanceof Element && (node.matches(PARTS) || node.querySelector(PARTS))) return true;
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
      observer = new MutationObserver(records => { if (relevant(records)) schedule(); });
      observer.observe(document, { childList: true, subtree: true, characterData: true, attributes: true,
        attributeFilter: ["hidden", "collapsed", "visibility", "is-expanded", "aria-expanded", "is-two-columns_", "theater", "video-id"] });
    } else if (!needsLayout && observer) { observer.disconnect(); observer = null; }
    if (needsLayout || session || expansion || markedWatch) schedule();
  }
  function cleanup(): void {
    if (timer) clearTimeout(timer); timer = 0;
    if (resizeFrame) cancelAnimationFrame(resizeFrame); resizeFrame = 0;
    observer?.disconnect(); observer = null;
    restoreExpansion(); restoreLayout();
    markedWatch?.removeAttribute("data-btx-channel-name"); markedWatch = null;
    document.documentElement?.removeAttribute("data-btx-youtube-progress");
  }
  function status(): Record<string, unknown> {
    const liveSections = session ? [...session.records].filter(([, r]) => r.node.isConnected && r.node.parentNode === r.pane).map(([name]) => name) : [];
    return { supportedWatchPage: Boolean(currentWatch()), layoutEnabled: settings.youtubeLayoutTabsEnabled,
      layout: session ? (liveSections.length === 3 ? "applied" : liveSections.length ? "partial" : "waiting") : settings.youtubeLayoutTabsEnabled ? "unavailable" : "off",
      movedSections: liveSections, selected: session?.selected || null,
      yieldingToNativePanel: Boolean(session?.nativeSignature && !session.manuallyOpened), commentStatus: session ? commentLabel(session).detail : null,
      description: !settings.youtubeDescriptionExpandedEnabled ? "off" : expansion?.userTouched ? "user-controlled" : expansion && (expansion.initiallyExpanded || expansion.confirmed) ? "expanded" : "unverified",
      issue: lastIssue, descriptionIssue: lastDescriptionIssue,
      autoMiniplayer: "not-implemented-no-verified-public-navigation-path", reconciliationCount: reconciliations };
  }
  async function load(): Promise<void> {
    const epoch = settingsEpoch;
    try {
      const values = await ToolboxShared.readStorage(chrome.storage.local, chrome.runtime, ToolboxShared.YOUTUBE_DEFAULTS);
      if (settingsEpoch !== epoch) return;
      settings = ToolboxShared.youtubeSettings(values); refresh();
    } catch (error) { lastIssue = `YouTube 설정을 읽지 못했습니다: ${ToolboxShared.errorMessage(error)}`; }
  }
  chrome.storage.onChanged.addListener((changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== "local") return;
    const next: Record<string, unknown> = { ...settings }; let changed = false;
    for (const key of Object.keys(ToolboxShared.YOUTUBE_DEFAULTS)) if (Object.hasOwn(changes, key)) { changed = true; next[key] = changes[key].newValue; }
    if (!changed) return;
    settingsEpoch++; settings = ToolboxShared.youtubeSettings(next); lastIssue = ""; lastDescriptionIssue = ""; refresh();
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
  document.addEventListener("yt-navigate-start", () => { navigating = true; cleanup(); blockedWatch = null; });
  document.addEventListener("yt-navigate-finish", () => { navigating = false; blockedWatch = null; refresh(); });
  window.addEventListener("popstate", () => { navigating = false; schedule(); });
  window.addEventListener("resize", () => { if (session && !resizeFrame) resizeFrame = requestAnimationFrame(() => { resizeFrame = 0; updateGeometry(); }); });
  document.addEventListener("DOMContentLoaded", refresh, { once: true });
  window.addEventListener("pagehide", () => { suspended = true; settingsEpoch++; cleanup(); });
  window.addEventListener("pageshow", event => { if (event.persisted) { suspended = false; navigating = false; void load(); } });
  w[KEY] = Object.freeze({ getStatus: status });
  void load();
})();
