/** Local native-player model for lifecycle regressions, not YouTube source.
 * The model owns media/control styles and seek coordinates. Product code must
 * only change its own outer-width markers, never these nodes or event handlers.
 */
namespace LayoutTransitionFixture {
  const w = globalThis as unknown as Record<string, any>;
  export let replacements = 0, visits = 0, trustedVisits = 0, seekCalls = 0;
  export let settled = true;
  let cachedSeekWidth = 0;
  let returning = false;
  const parts = () => {
    const player = w.PlayerViewportFixture.player as HTMLElement;
    const controls = player.querySelector<HTMLElement>(':scope > .ytp-chrome-bottom')!;
    return {player, video:w.PlayerViewportFixture.video as HTMLVideoElement, controls,
      progress:controls.querySelector<HTMLElement>('.ytp-progress-bar')!, row:controls.querySelector<HTMLElement>('.ytp-chrome-controls')!};
  };
  function updateSeekWidth(): void { cachedSeekWidth = parts().progress.getBoundingClientRect().width; }
  export function build(): void {
    w.FoundationFixture.player('responsive-css');
    const watch = w.LayoutRegressionFixture.watch as HTMLElement;
    history.replaceState({}, '', 'about:blank?v=Fixture_A');
    watch.setAttribute('video-id', 'Fixture_A');
    updateSeekWidth();
    new ResizeObserver(updateSeekWidth).observe(parts().player);
    // Delegated native listener survives the model rebuilding its controls.
    parts().player.addEventListener('click', e => {
      if (!e.isTrusted || !(e.target instanceof Element) || !e.target.closest('.ytp-progress-bar')) return;
      e.stopImmediatePropagation();
      const p = parts(), box = p.progress.getBoundingClientRect();
      p.video.currentTime = Math.max(0, Math.min(p.video.duration, (e.clientX-box.left)/cachedSeekWidth*p.video.duration));
      seekCalls++;
    }, true);
    document.addEventListener('keydown', e => {
      if (!e.isTrusted || e.key.toLowerCase() !== 't' || e.ctrlKey || e.altKey || e.metaKey) return;
      if (watch.hasAttribute('theater')) { returning = true; return; }
      if (returning) {
        returning = false; settled = false;
        window.setTimeout(() => { replaceControls('progress'); settled = true; }, 150);
      }
    });
    const recommendation = document.createElement('a');
    recommendation.id = 'fixture-recommendation'; recommendation.href='https://www.youtube.com/watch?v=Fixture_B'; recommendation.textContent='Next test video';
    (w.LayoutRegressionFixture.related as HTMLElement).append(recommendation);
    recommendation.addEventListener('click', e => {
      if (!e.isTrusted || e.button !== 0) return;
      e.preventDefault(); visits++; trustedVisits++; settled = false;
      document.dispatchEvent(new Event('yt-navigate-start'));
      const key = 'Fixture_' + (visits % 2 ? 'B' : 'A');
      history.pushState({}, '', 'about:blank?v=' + key);
      watch.setAttribute('video-id',key);
      document.dispatchEvent(new Event('yt-navigate-finish'));
      // The real application can commit a URL before replacing controls.
      window.setTimeout(() => { replaceControls('controls'); settled = true; }, 180);
    });
  }
  export function replaceControls(kind: 'progress' | 'row' | 'controls'): void {
    const p = parts(), node = p[kind];
    node.replaceWith(node.cloneNode(true));
    replacements++; updateSeekWidth();
  }
  export function hideControls(hidden: boolean): void { parts().controls.hidden = hidden; }
  export function stagedNativeResize(): void {
    const p=parts(); settled=false;
    // Actual staged native writes, deliberately longer than the old deadline.
    // Geometry keeps advancing rather than one unchanging failed request.
    const width=p.player.getBoundingClientRect().width-24;
    for (const [delay, fraction] of [[0,.72],[450,.80],[850,.88],[1250,.94],[1550,1]]) window.setTimeout(() => {
      p.progress.style.width = (width*fraction)+'px';
      p.row.style.width = (width*fraction)+'px';
      updateSeekWidth();
      if (fraction===1) { p.progress.style.removeProperty('width'); p.row.style.removeProperty('width'); settled=true; }
    }, delay);
  }
  export function breakProgress(): void {
    const p=parts(), width=p.player.getBoundingClientRect().width;
    p.progress.style.width=(width*.7)+'px'; p.row.style.width=(width*.7)+'px';
  }
  export function read(): Record<string,unknown> {
    const p=parts(), rect=(n:HTMLElement)=> {const r=n.getBoundingClientRect();return {width:r.width,height:r.height,left:r.left,right:r.right};};
    return {status:w.__browserToolboxYouTubeLayoutV1__.getStatus(),player:rect(p.player),video:rect(p.video),controls:rect(p.controls),progress:rect(p.progress),row:rect(p.row),
      replacements,visits,trustedVisits,seekCalls,cachedSeekWidth,settled,rate:p.video.playbackRate,time:p.video.currentTime,
      sameVideo:p.video===document.querySelector('#movie_player video'),hosts:document.querySelectorAll('#btx-youtube-tabs').length,
      nativeStyleMarkers:document.querySelectorAll('[data-btx-player-viewport]').length};
  }
}
(globalThis as unknown as Record<string,unknown>).LayoutTransitionFixture=LayoutTransitionFixture;
