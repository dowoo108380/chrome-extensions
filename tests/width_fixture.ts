/** Controlled width constraints, not captured YouTube CSS.
 * The site-owned fixture implements native theater changes; production code is
 * allowed to size known containers only, never to replace or style the video.
 */
namespace WidthFixture {
  const w = globalThis as unknown as Record<string, any>;
  export type Options = { kind?: 'flex' | 'grid'; rootLimit?: boolean; innerLimit?: boolean; sidebar?: boolean; rtl?: boolean; playlist?: boolean };
  export function build(options: Options = {}): void {
    w.TheaterFixture.build({ playlist: options.playlist !== false, reclaim: ['info', 'comments', 'playlist', 'videos'] });
    const watch: HTMLElement = w.LayoutRegressionFixture.watch;
    const wrapper = document.createElement('main'); wrapper.id = 'fixture-app-content';
    watch.before(wrapper); wrapper.append(watch);
    document.documentElement.dir = options.rtl ? 'rtl' : 'ltr';
    const style = document.createElement('style'); style.id = 'fixture-native-width';
    style.textContent = `
      #fixture-app-content { display:block; ${options.sidebar ? 'margin-inline-start:240px;' : ''} }
      ytd-watch-flexy { display:block; ${options.rootLimit ? 'max-width:1700px; margin-inline:auto; padding-inline:20px;' : ''} }
      ytd-watch-flexy:not([theater]) > #columns { display:${options.kind === 'grid' ? 'grid' : 'flex'}; flex-direction:row;
        max-width:1600px; width:auto; margin-inline:auto; padding-inline:24px; column-gap:0; align-items:start;
        grid-template-columns:minmax(0,1fr) 400px; }
      ytd-watch-flexy:not([theater]) #primary { flex:1 1 0; min-width:0; max-width:1120px; margin-inline:0; padding-inline:0 24px; }
      ytd-watch-flexy:not([theater]) #primary-inner { ${options.innerLimit ? 'max-width:850px; margin-inline:auto;' : ''} }
      ytd-watch-flexy:not([theater]) #secondary { box-sizing:content-box; flex:0 0 auto; width:400px; min-width:0; padding-inline:0 24px; }
      ytd-watch-flexy:not([theater]) #secondary-inner { width:100%; }
      #movie_player { border-radius:12px; overflow:hidden; }
      #movie_player video { background:linear-gradient(145deg,#16364a,#244f50 50%,#172437); }
      @media(max-width:980px) {
        #fixture-app-content { margin-inline-start:0; }
        ytd-watch-flexy { padding-inline:0; }
        ytd-watch-flexy:not([theater]) > #columns { display:block; padding-inline:14px; }
        ytd-watch-flexy:not([theater]) #primary,
        ytd-watch-flexy:not([theater]) #secondary { width:auto; max-width:none; padding-inline:0; }
      }
    `;
    document.head.append(style);
  }
  export function read(): Record<string, unknown> {
    const rect = (node: Element | null) => {
      if (!node) return null;
      const r = node.getBoundingClientRect(), s = getComputedStyle(node);
      return { left:r.left, right:r.right, width:r.width, height:r.height, top:r.top + scrollY,
        style:node.getAttribute('style'), paddingLeft:s.paddingLeft, paddingRight:s.paddingRight, maxWidth:s.maxWidth,
        overflowX:s.overflowX, overflowY:s.overflowY, position:s.position };
    };
    const f = w.LayoutRegressionFixture;
    const root = document.scrollingElement!;
    return { status:w.__browserToolboxYouTubeLayoutV1__?.getStatus(), viewport:{width:root.clientWidth,height:root.clientHeight},
      documentWidth:root.scrollWidth, horizontalRange:root.scrollWidth-root.clientWidth,
      watch:rect(f.watch), app:rect(document.getElementById('fixture-app-content')),
      columns:rect(document.getElementById('columns')), primary:rect(f.primary), secondary:rect(f.secondary),
      sidebar:rect(document.getElementById('secondary-inner')), player:rect(document.getElementById('movie_player')),
      video:rect(f.mainVideo), body:rect(document.body), html:rect(document.documentElement),
      media:{rate:f.mainVideo.playbackRate,time:f.mainVideo.currentTime,src:f.mainVideo.currentSrc,paused:f.mainVideo.paused},
      originalVideo:f.mainVideo === document.querySelector('#movie_player video'),
      hostCount:document.querySelectorAll('#btx-youtube-tabs').length,
      markers:document.querySelectorAll('[data-btx-layout-width]').length };
  }
  /** Responsive native controls required by the current layout readiness checks. */
  export function installNativeControls(): void {
    const player = document.getElementById('movie_player')!;
    const video = player.querySelector('video')!;
    video.classList.add('html5-main-video');
    const controls = document.createElement('div'); controls.className = 'ytp-chrome-bottom';
    const progress = document.createElement('div'); progress.className = 'ytp-progress-bar';
    const row = document.createElement('div'); row.className = 'ytp-chrome-controls';
    controls.append(progress, row); player.append(controls);
    const style = document.createElement('style');
    style.textContent = '#movie_player{position:relative} .ytp-chrome-bottom{position:absolute;left:12px;bottom:0;width:calc(100% - 24px);height:48px} .ytp-progress-bar{width:100%;height:16px} .ytp-chrome-controls{width:100%;height:32px}';
    document.head.append(style);
  }
}
(globalThis as unknown as Record<string, unknown>).WidthFixture = WidthFixture;
