/** Controlled native-slot fixture, NOT copied YouTube markup or CSS.
 * Old fixed inline sizes are ordinary browser styles. The fixture does not
 * implement resize recovery; that must come from the unmodified product code.
 */
namespace PlayerViewportFixture {
  const w = globalThis as unknown as Record<string, any>;
  export type Options = { mode?: 'root-stale' | 'video-stale' | 'responsive' | 'letterbox'; padding?: boolean; unknownWrapper?: boolean; customTransform?: boolean; noIndependentHeight?: boolean };
  export let slot: HTMLElement, player: HTMLElement, video: HTMLVideoElement, controls: HTMLElement;
  export let seekCalls = 0, fullscreenClicks = 0, syntheticResize = 0;
  export function build(options: Options = {}): void {
    w.WidthFixture.build({ playlist: true });
    document.documentElement.setAttribute('dark', '');
    window.addEventListener('resize', e => { if (!e.isTrusted) syntheticResize++; });
    player = document.getElementById('movie_player')!;
    video = w.LayoutRegressionFixture.mainVideo; video.classList.add('html5-main-video');
    const outer = document.createElement('div'); outer.id = 'player-container-outer';
    slot = document.createElement('div'); slot.id = 'player-container-inner';
    const host = document.createElement('ytd-player'); host.id = 'ytd-player';
    const container = document.createElement('div'); container.id = 'container';
    player.before(outer); outer.append(slot); slot.append(host); host.append(container); container.append(player);
    const videoHost = document.createElement('div'); videoHost.className = 'html5-video-container';
    videoHost.append(video); player.prepend(videoHost);
    const style = document.createElement('style'); style.id = 'native-slot-css';
    style.textContent = `
      #player-container-outer { width:100%; }
      ytd-watch-flexy[theater] #player-container-outer { display:none; }
      #player-container-inner { position:relative; width:100%; ${options.padding ? 'height:0;padding-top:56.25%;' : 'aspect-ratio:16/9;'} }
      ytd-player#ytd-player, ytd-player > #container { display:block; position:absolute; inset:0; width:100%; height:100%; }
      #movie_player { width:100%; height:100%; aspect-ratio:auto; margin:0; border:0; }
      .html5-video-container { position:absolute; inset:0; width:100%; height:100%; }
      video.html5-main-video { position:absolute; object-fit:contain; width:100%; height:100%; }
      .ytp-chrome-bottom { position:absolute; bottom:0; left:12px; height:48px; width:calc(100% - 24px); color:white; }
      .ytp-chrome-controls { display:flex; justify-content:space-between; height:32px; }
      .ytp-progress-bar { display:block; width:100%; height:16px; background:#777; border:0; }
      #slot-caption { position:absolute; bottom:68px; left:0; width:100%; text-align:center; color:white; }
    `;
    document.head.append(style);
    // Complete the fixture's original theater return with the dedicated slot
    // introduced above. This models native reparenting; it does not size anything.
    document.addEventListener('keydown', event => {
      if (event.isTrusted && event.key.toLowerCase() === 't' && !w.LayoutRegressionFixture.watch.hasAttribute('theater')) (container as unknown as HTMLElement & {moveBefore(node:Node,before:Node|null):void}).moveBefore(player, null);
    });
    const mode = options.mode || 'root-stale';
    if (mode === 'root-stale') { player.style.width = '1000px'; player.style.height = '562.5px'; }
    if (mode !== 'responsive' && mode !== 'letterbox') { video.style.width = '1000px'; video.style.height = '562.5px'; video.style.left = '0px'; video.style.top = '0px'; }
    if (options.noIndependentHeight) {
      slot.style.aspectRatio = 'auto'; host.style.position = 'relative'; host.style.height = 'auto'; container.style.position = 'relative'; container.style.height = 'auto';
    }
    if (options.unknownWrapper) { const unknown = document.createElement('div'); unknown.style.width = '100%'; unknown.style.height = '100%'; player.before(unknown); unknown.append(player); }
    if (options.customTransform) video.style.transform = 'scale(1.15)';
    controls = document.createElement('div'); controls.className = 'ytp-chrome-bottom';
    if (mode === 'root-stale') controls.style.width = '976px';
    const rail = document.createElement('button'); rail.className = 'ytp-progress-bar'; rail.type = 'button'; rail.setAttribute('aria-label', 'Native fixture seek');
    rail.addEventListener('click', e => { if (Number.isFinite(video.duration)) { const r = rail.getBoundingClientRect(); video.currentTime = (e.clientX-r.left)/r.width * video.duration; seekCalls++; } });
    const row = document.createElement('div'); row.className = 'ytp-chrome-controls';
    const play = document.createElement('button'); play.textContent = 'Play'; play.id = 'native-play'; play.onclick = () => { void video.play(); };
    const full = document.createElement('button'); full.id = 'native-fullscreen'; full.textContent = 'Fullscreen'; full.onclick = () => { fullscreenClicks++; void player.requestFullscreen(); };
    row.append(play,full); controls.append(rail,row);player.append(controls);
    const caption = document.createElement('div');caption.id='slot-caption';caption.textContent='Original native test caption';player.append(caption);
  }
  function box(node: HTMLElement): Record<string, unknown> {
    const rect = node.getBoundingClientRect(), css = getComputedStyle(node);
    return { left:rect.left,top:rect.top,width:rect.width,height:rect.height,right:rect.right,bottom:rect.bottom,
      style:node.getAttribute('style'),objectFit:css.objectFit,transform:css.transform,filter:css.filter,backdropFilter:css.backdropFilter };
  }
  export function read(): Record<string, unknown> {
    const doc = document.scrollingElement!;
    return { status:w.__browserToolboxYouTubeLayoutV1__.getStatus(),slot:box(slot),player:box(player),video:box(video),controls:box(controls),
      caption:box(document.getElementById('slot-caption')!), actualVideo:video === document.querySelector('#movie_player video'),
      rate:video.playbackRate,time:video.currentTime,paused:video.paused,readyState:video.readyState,
      natural:{width:video.videoWidth,height:video.videoHeight},source:video.currentSrc.slice(0,20),seekCalls,syntheticResize,
      marked:document.querySelectorAll('[data-btx-player-viewport]').length,horizontalRange:doc.scrollWidth-doc.clientWidth,
      hasFocus:document.activeElement?.id || '' };
  }
  export function changeNativeSize(width: number): void {
    player.style.width = `${width}px`; player.style.height = `${width*9/16}px`;
    video.style.width = `${width}px`; video.style.height = `${width*9/16}px`;
    controls.style.width = `${width-24}px`;
  }
}
(globalThis as unknown as Record<string, unknown>).PlayerViewportFixture = PlayerViewportFixture;
