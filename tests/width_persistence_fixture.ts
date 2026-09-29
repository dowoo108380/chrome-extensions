/** Independent lifecycle model; this is NOT YouTube's implementation.
 * The page owner samples the shell once at a native mode/route boundary and
 * owns both pixel styles and seek coordinates. There is intentionally NO
 * ResizeObserver resizing these parts when extension markers change.
 */
namespace WidthPersistenceFixture {
  const w = globalThis as unknown as Record<string, any>;
  export const reads: { reason: string; width: number; height: number; wide: boolean }[] = [];
  export const removed: string[] = [];
  export let seeks = 0, routes = 0, ends = 0, endedTrusted = false;
  let seekWidth = 0, trace: MutationObserver;
  function parts() {
    const player = w.PlayerViewportFixture.player as HTMLElement;
    const controls = player.querySelector<HTMLElement>(':scope > .ytp-chrome-bottom')!;
    return { player, video: w.PlayerViewportFixture.video as HTMLVideoElement, controls,
      progress: controls.querySelector<HTMLElement>('.ytp-progress-bar')!,
      row: controls.querySelector<HTMLElement>('.ytp-chrome-controls')! };
  }
  export function commit(reason = 'owner-layout'): void {
    const p = parts(), box = p.player.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    reads.push({reason, width:box.width, height:box.height, wide: w.LayoutRegressionFixture.watch.hasAttribute('data-btx-layout-width')});
    p.video.style.width = box.width + 'px'; p.video.style.height = box.height + 'px';
    p.controls.style.width = (box.width - 24) + 'px';
    p.progress.style.width = p.controls.style.width; p.row.style.width = p.controls.style.width;
    seekWidth = box.width - 24;
  }
  export function build(): void {
    w.FoundationFixture.player('responsive-css');
    const watch = w.LayoutRegressionFixture.watch as HTMLElement;
    history.replaceState({}, '', 'about:blank?v=Persistent_A');
    watch.setAttribute('video-id', 'Persistent_A');
    commit('initial-small');
    const p = parts();
    p.player.addEventListener('click', e => {
      if (!e.isTrusted || !(e.target instanceof Element) || !e.target.closest('.ytp-progress-bar')) return;
      e.stopImmediatePropagation();
      const now = parts(), rect = now.progress.getBoundingClientRect();
      now.video.currentTime = Math.max(0, Math.min(now.video.duration, (e.clientX - rect.left) / seekWidth * now.video.duration));
      seeks++;
    }, true);
    // Runs after the underlying fixture's native T handler. The old product
    // removed width markers in a microtask before this one owner layout pass.
    document.addEventListener('keydown', e => {
      if (e.isTrusted && e.key.toLowerCase() === 't' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        requestAnimationFrame(() => commit(watch.hasAttribute('theater') ? 'theater' : 'normal-return'));
      }
    });
    const a = document.createElement('a'); a.id = 'persistence-next'; a.href = 'https://www.youtube.com/watch?v=Persistent_B'; a.textContent = 'Next video';
    (w.LayoutRegressionFixture.related as HTMLElement).append(a);
    a.addEventListener('click', e => { if (e.isTrusted && e.button === 0) { e.preventDefault(); navigate(); } });
    p.video.addEventListener('ended', e => {
      ends++; endedTrusted = e.isTrusted;
      // A natural end screen has different controls. No source/time values are
      // invented: ended is the real media state reached by playback.
      parts().controls.style.bottom = '8px';
    });
    p.video.addEventListener('play', () => { parts().controls.style.bottom = '0px'; });
    trace = new MutationObserver(records => {
      for (const r of records) if (r.oldValue !== null && (r.target as Element).getAttribute('data-btx-layout-width') === null) {
        removed.push((r.target as HTMLElement).id || (r.target as HTMLElement).tagName);
      }
    });
    trace.observe(watch, { attributes:true, subtree:true, attributeOldValue:true, attributeFilter:['data-btx-layout-width'] });
  }
  export function navigate(finish = true): void {
    const watch = w.LayoutRegressionFixture.watch as HTMLElement;
    document.dispatchEvent(new Event('yt-navigate-start'));
    routes++;
    const key = 'Persistent_' + routes;
    history.pushState({}, '', 'about:blank?v=' + key);
    watch.setAttribute('video-id', key);
    const controls = parts().controls;
    controls.replaceWith(controls.cloneNode(true));
    // Source owner updates after navigation-start/URL commit, before finish.
    commit('route-commit');
    if (finish) document.dispatchEvent(new Event('yt-navigate-finish'));
  }
  export function beginTrace(): void { trace.takeRecords(); removed.length = 0; reads.length = 0; }
  export function breakControls(): void { parts().progress.style.width = (parts().player.clientWidth * .7) + 'px'; }
  export function repairControls(): void { commit('owner-repaired'); }
  export function read(): Record<string, unknown> {
    const p = parts(), rect = (n: HTMLElement) => { const r = n.getBoundingClientRect(); return {width:r.width,height:r.height,left:r.left,top:r.top}; };
    return {status:w.__browserToolboxYouTubeLayoutV1__.getStatus(),player:rect(p.player),video:rect(p.video),controls:rect(p.controls),progress:rect(p.progress),row:rect(p.row),
      seekWidth,seeks,routes,ends,endedTrusted,ended:p.video.ended,rate:p.video.playbackRate,time:p.video.currentTime,
      reads:[...reads],removed:[...removed],sameVideo:p.video===document.querySelector('#movie_player video'),
      hosts:document.querySelectorAll('#btx-youtube-tabs').length,wide:w.LayoutRegressionFixture.watch.getAttribute('data-btx-layout-width'),
      markers:document.querySelectorAll('[data-btx-layout-width]').length,
      forbiddenMarkers:document.querySelectorAll('[data-btx-player-viewport]').length,
      syntheticResize:w.PlayerViewportFixture.syntheticResize};
  }
}
(globalThis as unknown as Record<string, unknown>).WidthPersistenceFixture = WidthPersistenceFixture;
