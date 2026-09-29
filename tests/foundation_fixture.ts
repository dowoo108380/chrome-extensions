/** Model of a page-owned player, NOT YouTube's player implementation.
 * Cached native seek width is deliberately separate from the displayed CSS.
 * The extension must not repair one without the other. */
namespace FoundationFixture {
  const w = globalThis as unknown as Record<string, any>;
  export let reference: Record<string, number> = {}, cachedSeekWidth = 0, seeks = 0, updates = 0;
  export let nativeObserver: ResizeObserver | null = null;
  export let windowUpdatesReady = true;
  export function player(mode: string): void {
    w.PlayerViewportFixture.build({mode: 'responsive', padding: true});
    const f = w.PlayerViewportFixture;
    const video = f.video as HTMLVideoElement, player = f.player as HTMLElement, controls = f.controls as HTMLElement;
    const progress = controls.querySelector('.ytp-progress-bar') as HTMLElement;
    const row = controls.querySelector('.ytp-chrome-controls') as HTMLElement;
    const pb = player.getBoundingClientRect(), cb = controls.getBoundingClientRect();
    reference = {player: pb.width, height: pb.height, controls: cb.width};
    cachedSeekWidth = cb.width; seeks = updates = 0;
    // Own player applies styles and updates its cached coordinate state together.
    function nativeUpdate(): void {
      const box = player.getBoundingClientRect();
      video.style.width = `${box.width}px`; video.style.height = `${box.height}px`;
      controls.style.width = `${box.width - 24}px`;
      progress.style.width = controls.style.width; row.style.width = controls.style.width;
      cachedSeekWidth = box.width - 24; updates++;
    }
    nativeUpdate();
    if (mode === 'responsive-css') {
      video.style.removeProperty('width'); video.style.removeProperty('height');
      controls.style.removeProperty('width'); progress.style.removeProperty('width'); row.style.removeProperty('width');
      // This model reads geometry at input time; no stale native cache.
    } else if (mode === 'native-resizes') {
      nativeObserver = new ResizeObserver(nativeUpdate); nativeObserver.observe(player);
    } else if (mode === 'window-resizes') {
      // Live YouTube can leave cached video/seek sizes unchanged when only the
      // surrounding columns change. Its window resize handler updates both.
      window.addEventListener('resize', () => { if (windowUpdatesReady) nativeUpdate(); });
    } else if (mode === 'stale-child') {
      video.style.removeProperty('width'); video.style.removeProperty('height'); controls.style.removeProperty('width');
    }
    progress.addEventListener('click', event => {
      event.stopImmediatePropagation();
      const r = progress.getBoundingClientRect();
      const width = mode === 'responsive-css' ? r.width : cachedSeekWidth;
      video.currentTime = Math.max(0, Math.min(video.duration, (event.clientX-r.left)/width*video.duration)); seeks++;
    }, true);
    Object.assign(w.__test.settings, {youtubeLayoutTabsEnabled:false, youtubePanelScrollEnabled:true, youtubeNativePanelsEnabled:false});
  }
  export function read(): Record<string, any> {
    const f = w.PlayerViewportFixture;
    const box = (node: HTMLElement) => { const r=node.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height,right:r.right,bottom:r.bottom}; };
    const p=f.controls.querySelector('.ytp-progress-bar'), r=f.controls.querySelector('.ytp-chrome-controls');
    const status=w.__browserToolboxYouTubeLayoutV1__.getStatus();
    return {status,reference,cachedSeekWidth,seeks,updates,player:box(f.player),video:box(f.video),controls:box(f.controls),progress:box(p),row:box(r),
      overriddenNativeNodes:document.querySelectorAll('[data-btx-player-viewport]').length,
      sourcePresent:Boolean(f.video.currentSrc),rate:f.video.playbackRate,time:f.video.currentTime,
      syntheticResize:f.syntheticResize, note:document.querySelector('.btx-player-sizing-status')?.textContent,
      videoSame: f.video === document.querySelector('#movie_player video'), hosts:document.querySelectorAll('#btx-youtube-tabs').length};
  }
  export function holdReadback(): void {
    const get=w.chrome.storage.local.get;
    const waiting:(()=>void)[]=[];
    w.chrome.storage.local.get=(keys:unknown,cb:(value:unknown)=>void)=>get(keys,(value:unknown)=>waiting.push(()=>cb(value)));
    w.foundationReadCount=()=>waiting.length;
    w.foundationReleaseRead=()=>waiting.shift()?.();
  }
}
(globalThis as unknown as Record<string,unknown>).FoundationFixture=FoundationFixture;
