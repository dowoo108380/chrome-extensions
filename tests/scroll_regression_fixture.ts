/** Test-owned CSS reserves, not a capture of the user's live YouTube DOM.
 * Uses the existing layout fixture's native nodes and real Chromium geometry.
 */
namespace ScrollRegressionFixture {
  type LayoutFixture = { build: (options: Record<string, unknown>) => void; mainVideo: HTMLVideoElement;
    related: HTMLElement; primary: HTMLElement; secondary: HTMLElement; watch: HTMLElement };
  const env = globalThis as unknown as Record<string, unknown>;
  const base = (): LayoutFixture => env.LayoutRegressionFixture as LayoutFixture;
  export function build(reserve: string): void {
    const f = base(); f.build({ dark: true });
    document.querySelector('.native-card-outside')?.remove();
    document.getElementById('fixture-unrelated')?.remove();
    const primaryInner = document.createElement('div'); primaryInner.id = 'primary-inner';
    primaryInner.append(...f.primary.childNodes); f.primary.append(primaryInner);
    const owner = document.createElement('div'); owner.id = 'fixture-owner';
    owner.textContent = '원래 제목 · 채널 · 구독 및 공유 버튼 영역';
    owner.style.cssText = 'height:58px;display:flex;align-items:center;border-bottom:1px solid #444';
    document.querySelector('ytd-watch-metadata')!.insertBefore(owner, document.getElementById('description'));
    const style = document.createElement('style');
    style.id = 'fixture-native-reserves';
    style.textContent = `
      /* Explicit synthetic conditions: the old containers retain space. */
      #columns { grid-template-columns:minmax(0,1fr) minmax(320px,32%);padding:16px;gap:20px; }
      .fixture-heading { height:56px;padding:14px 24px; }
      #fixture-owner { margin:0; }
      ytd-watch-metadata h1 { margin:12px 0 0;font-size:18px; }
      @media(max-width:980px) { #columns { display:block; } }
    `;
    if (reserve === 'below-minimum') style.textContent += '#below { min-height:380px; }';
    if (reserve === 'outer-minimum') style.textContent += '#columns { min-height:1100px; }';
    if (reserve === 'inner-fixed') style.textContent += '#primary-inner { height:1080px; }';
    if (reserve === 'bottom-padding') style.textContent += '#primary { padding-bottom:340px; }';
    if (reserve === 'bottom-margin') style.textContent += '#below { margin-bottom:340px; }';
    if (reserve === 'combined') style.textContent += '#below { min-height:380px; } #primary { padding-bottom:100px; } #columns { padding-bottom:80px; }';
    document.head.append(style);
  }
  export function read(): Record<string, unknown> {
    const root = document.scrollingElement!, f = base();
    const dimensions = (node: Element | null) => {
      if (!node) return null;
      const r = node.getBoundingClientRect(), c = getComputedStyle(node);
      return { top:r.top + scrollY, bottom:r.bottom + scrollY, width:r.width, height:r.height,
        minHeight:c.minHeight, paddingBottom:c.paddingBottom, marginBottom:c.marginBottom,
        overflowY:c.overflowY, inlineStyle:node.getAttribute('style') };
    };
    return { scrollHeight:root.scrollHeight, clientHeight:root.clientHeight,
      scrollRange:root.scrollHeight-root.clientHeight, scrollTop:root.scrollTop,
      below:dimensions(document.getElementById('below')), columns:dimensions(document.getElementById('columns')),
      player:dimensions(document.getElementById('movie_player')), owner:dimensions(document.getElementById('fixture-owner')),
      body:dimensions(document.body), html:dimensions(document.documentElement),
      rate:f.mainVideo.playbackRate, marked:[...document.querySelectorAll('[data-btx-layout-flow]')].map(n=>n.id||n.tagName.toLowerCase()),
      state:(env.__browserToolboxYouTubeLayoutV1__ as {getStatus?:()=>unknown})?.getStatus?.() };
  }
}
(globalThis as unknown as Record<string, unknown>).ScrollRegressionFixture = ScrollRegressionFixture;
