/** Local regression fixture, not a recording of YouTube. Address predicates only
 * are adapted by the runner; all production discovery/lifetime logic is unchanged.
 * Standard DOM observers and actual browser nodes are used, Chrome APIs are doubles.
 */
namespace LayoutLifecycleFixture {
  const w = globalThis as unknown as Record<string, any>;
  export let shell: HTMLElement;
  export let rival: HTMLElement | null = null;
  export const route = { watch: true, key: "lifecycle_first" };
  export function build(): void {
    w.LayoutRegressionFixture.build({ dark: true });
    const watch = w.LayoutRegressionFixture.watch as HTMLElement;
    watch.setAttribute('video-id', route.key);
    shell = document.createElement('ytd-page-manager');
    shell.id = 'fixture-page-manager'; shell.style.display = 'block';
    watch.before(shell); shell.append(watch);
    const style = document.createElement('style');
    style.id = 'lifecycle-site-css';
    style.textContent = '.fixture-loading { visibility:hidden; } .fixture-sidebar-hidden #secondary { display:none; }';
    document.head.append(style);
    w.__lifecycleRoute = route;
  }
  export function hideShell(value: boolean): void { shell.classList.toggle('fixture-loading', value); }
  export function hideSidebar(value: boolean): void { shell.classList.toggle('fixture-sidebar-hidden', value); }
  export function lateSidebarStyles(): void {
    const style = document.getElementById('lifecycle-site-css') as HTMLStyleElement;
    // CSSOM change deliberately has no DOM mutation and no window resize.
    style.sheet!.insertRule('#secondary { display:block !important; }', style.sheet!.cssRules.length);
  }
  export function resetRecommendations(): void {
    const related = w.LayoutRegressionFixture.related as HTMLElement;
    related.replaceChildren();
    const r = document.createElement('ytd-watch-next-secondary-results-renderer');
    const a = document.createElement('a'); a.textContent = 'Delayed actual link'; a.id = 'fixture-delayed-link';
    r.append(a); related.append(r);
  }
  export function readyLink(): void {
    document.getElementById('fixture-delayed-link')!.setAttribute('href', 'https://www.youtube.com/watch?v=delayed_native_link');
  }
  export function start(): void { document.dispatchEvent(new Event('yt-navigate-start')); }
  export function finish(): void { document.dispatchEvent(new Event('yt-navigate-finish')); }
  export function commit(key: string): void { route.key = key; }
  export function reflectKey(): void { w.LayoutRegressionFixture.watch.setAttribute('video-id', route.key); }
  export function detachWatch(): void { w.LayoutRegressionFixture.watch.remove(); }
  export function attachWatch(): void { shell.append(w.LayoutRegressionFixture.watch); }
  export function addRival(): void {
    rival = document.createElement('div'); rival.id = 'related';
    const r = document.createElement('ytd-watch-next-secondary-results-renderer');
    const a = document.createElement('a'); a.href = 'https://www.youtube.com/watch?v=responsive_copy'; a.textContent = 'Rival';
    r.append(a); rival.append(r); w.LayoutRegressionFixture.origin.append(rival);
  }
  export function reclaim(): void {
    const f = w.LayoutRegressionFixture;
    f.origin.moveBefore(f.related, null);
  }
  export function read(): Record<string, unknown> {
    const f = w.LayoutRegressionFixture;
    const host = document.getElementById('btx-youtube-tabs');
    return { status: w.__browserToolboxYouTubeLayoutV1__?.getStatus(),
      hosts: document.querySelectorAll('#btx-youtube-tabs').length,
      sourceConnected: f.related.isConnected,
      sourceInPane: f.related.parentElement?.id === 'btx-pane-videos',
      sourceSame: document.querySelector('#btx-pane-videos > *') === f.related,
      infoSame: document.querySelector('#btx-pane-info > *') === f.description,
      commentSame: document.querySelector('#btx-pane-comments > *') === f.comments,
      hostVisible: !!host?.getClientRects().length,
      nativeAtOrigin: f.related.parentElement === f.origin,
      errors: [],
      sourceParent: f.related.parentElement?.id,
      fieldValue: document.querySelector<HTMLInputElement>('#fixture-input')?.value };
  }
}
(globalThis as unknown as Record<string, unknown>).LayoutLifecycleFixture = LayoutLifecycleFixture;
