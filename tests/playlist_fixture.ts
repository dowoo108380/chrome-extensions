/** Controlled playlist DOM, not a recording of live YouTube.
 * Native test controls own their state; the extension must only move the tree.
 */
namespace PlaylistFixture {
  const env = globalThis as unknown as Record<string, any>;
  export let panel: HTMLElement, container: HTMLElement, items: HTMLElement;
  export let before: HTMLElement, after: HTMLElement;
  export let links: HTMLAnchorElement[] = [];
  export let events: { kind: string; trusted: boolean; href?: string; prevented?: boolean }[] = [];
  export let frame: HTMLIFrameElement | null = null;
  export let frameLoads = 0;
  function el(tag: string, id = '', text = ''): HTMLElement {
    const node = document.createElement(tag);
    if (id) node.id = id;
    if (text) node.textContent = text;
    return node;
  }
  export function fill(target = items, count = 36): void {
    for (let i = 0; i < count; i++) {
      const item = el('ytd-playlist-panel-video-renderer');
      const link = document.createElement('a'); link.href = `https://www.youtube.com/watch?v=playlist_fixture_${i}&list=playlist_fixture&index=${i+1}`;
      link.className = 'fixture-playlist-link';
      const number = el('span', '', `${i + 1}`); number.className = 'fixture-playlist-number';
      const picture = el('span', '', `${String(i+1).padStart(2,'0')}`); picture.className = 'fixture-playlist-image';
      const copy = el('span'); copy.append(el('strong', '', `재생목록 영상 ${i+1} · 원래 링크와 조작을 유지합니다`), el('small', '', '테스트 채널 · 상태 보존 시험'));
      link.append(number, picture, copy);
      link.addEventListener('click', event => {
        events.push({ kind: 'link', trusted: event.isTrusted, href: link.href, prevented: event.defaultPrevented });
        // Fixture-only: keep testing offline, do not navigate to YouTube.
        event.preventDefault();
        target.querySelectorAll('[selected]').forEach(n => n.removeAttribute('selected')); item.setAttribute('selected', '');
      });
      if (i === 1) item.setAttribute('selected', '');
      links.push(link); item.append(link); target.append(item);
    }
  }
  export function attach(options: { empty?: boolean; hidden?: boolean; collapsed?: boolean; rawList?: boolean } = {}): void {
    events = []; links = []; frame = null; frameLoads = 0;
    const origin = document.getElementById('secondary-inner')!;
    before = el('div', 'fixture-before-playlist'); after = el('div', 'fixture-after-playlist');
    panel = el('ytd-playlist-panel-renderer', 'playlist');
    container = el('div', 'container');
    const header = el('div', 'playlist-header');
    header.append(el('strong', '', '테스트 재생목록 — 실제 요소 이동'), el('small', '', '테스트 채널 · 2 / 36'));
    const controls = el('div', 'fixture-playlist-controls');
    for (const [kind, label] of [['repeat', '반복'], ['shuffle', '셔플'], ['collapse', '접기'], ['close', '닫기']]) {
      const b = document.createElement('button'); b.id = 'fixture-playlist-' + kind; b.textContent = label; b.type = 'button';
      if (kind === 'repeat' || kind === 'shuffle') b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', event => {
        events.push({ kind, trusted: event.isTrusted });
        if (kind === 'repeat' || kind === 'shuffle') b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
        if (kind === 'collapse') panel.toggleAttribute('collapsed');
        if (kind === 'close') panel.hidden = true;
      }); controls.append(b);
    }
    header.append(controls); items = el('div', 'items');
    if (!options.empty) fill();
    container.append(header, items);
    if (options.rawList) panel.append(header, items); else panel.append(container);
    if (options.hidden) panel.hidden = true;
    if (options.collapsed) panel.setAttribute('collapsed', '');
    origin.append(before, panel, after);
  }
  export function build(options: Record<string, unknown> = {}): void {
    env.ScrollRegressionFixture.build('combined');
    const style = el('style'); style.textContent = `
      [hidden] { display:none !important; }
      ytd-playlist-panel-renderer { display:block;margin:16px 0;border:1px solid #383838;border-radius:12px;background:#202020;box-sizing:border-box; }
      ytd-playlist-panel-renderer > #container { border:1px solid #383838;border-radius:12px; }
      ytd-playlist-panel-renderer #playlist-header { padding:14px; background:#202020; }
      ytd-playlist-panel-renderer #playlist-header > strong { display:block;font-size:14px; }
      ytd-playlist-panel-renderer #playlist-header > small { display:block;font-size:12px;opacity:.7; }
      #fixture-playlist-controls { display:flex;gap:8px;padding-top:8px; }
      #fixture-playlist-controls button { background:#363636;color:#eee;border:0;border-radius:5px;padding:6px 8px; }
      ytd-playlist-panel-renderer #items { max-height:760px;overflow:auto; }
      ytd-playlist-panel-renderer[collapsed] #items { display:none !important; }
      ytd-playlist-panel-video-renderer { display:block; }
      ytd-playlist-panel-video-renderer[selected] { background:#3a3a3a; }
      .fixture-playlist-link { display:flex;align-items:center;gap:8px;min-height:78px;padding:8px;color:inherit;text-decoration:none;box-sizing:border-box; }
      .fixture-playlist-number { width:20px;font-size:12px;text-align:center;flex:none;color:#aaa; }
      .fixture-playlist-image { width:108px;height:60px;background:#323d54;flex:none;border-radius:5px;display:flex;align-items:center;justify-content:center;font:700 22px Arial;color:#ddd; }
      .fixture-playlist-link > span:last-child { min-width:0; }
      .fixture-playlist-link strong { font:500 13px/1.5 Arial;display:block; }
      .fixture-playlist-link small { font:400 11px/1.5 Arial;display:block;color:#aaa; }
    `; document.head.append(style);
    if (options.attach !== false) attach(options);
  }
  export function addFrame(): void {
    frame = document.createElement('iframe'); frame.src = 'about:blank'; frame.style.cssText = 'width:80px;height:45px';
    frame.addEventListener('load', () => frameLoads++); items.append(frame);
  }
  export function read(): Record<string, unknown> {
    const ownPane = document.getElementById('btx-pane-playlist');
    const status = env.__browserToolboxYouTubeLayoutV1__?.getStatus?.();
    const rect = (n: HTMLElement | null) => { if (!n) return null; const r = n.getBoundingClientRect(); return { top:r.top,bottom:r.bottom,width:r.width,height:r.height,scroll:n.scrollTop,scrollHeight:n.scrollHeight,clientHeight:n.clientHeight,overflow:getComputedStyle(n).overflowY }; };
    return { status, parent:panel?.parentElement?.id, identity:ownPane?.firstElementChild===panel,
      tabOrder:[...document.querySelectorAll<HTMLButtonElement>('#btx-youtube-tabs [role=tab]')].filter(b=>!b.hidden).map(b=>b.id),
      enabled:document.getElementById('btx-tab-playlist')?.getAttribute('aria-disabled'),
      selected:document.getElementById('btx-tab-playlist')?.getAttribute('aria-selected'),
      playlistHidden:panel?.hidden, collapsed:panel?.hasAttribute('collapsed'),
      outsideItems:[...document.querySelectorAll('ytd-playlist-panel-video-renderer')].filter(n=>!ownPane?.contains(n)).length,
      outsideVisibleItems:[...document.querySelectorAll('ytd-playlist-panel-video-renderer')].filter(n=>!ownPane?.contains(n) && !n.closest('[hidden],[aria-hidden="true"]') && n.getClientRects().length>0).length,
      linksPreserved:links.every(l=>items.contains(l)),
      originalPosition:panel?.previousElementSibling===before && panel?.nextElementSibling===after,
      pane:rect(ownPane), list:rect(items), header:rect(panel?.querySelector('#playlist-header') || null),
      documentRange:document.scrollingElement!.scrollHeight-document.scrollingElement!.clientHeight,
      bodyOverflow:getComputedStyle(document.body).overflowY, documentWidth:document.documentElement.scrollWidth,
      viewport:innerWidth, mainRate:env.LayoutRegressionFixture.mainVideo.playbackRate,
      frameLoads,events:[...events], count:document.querySelectorAll('#btx-tab-playlist').length };
  }
}
(globalThis as unknown as Record<string, unknown>).PlaylistFixture = PlaylistFixture;
