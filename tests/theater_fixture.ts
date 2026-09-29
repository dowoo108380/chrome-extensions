/** Test-only native layout transitions. Not a captured YouTube implementation.
 * T / size-button inputs are trusted browser events; this fixture applies the
 * documented test conditions (mode attributes and reparenting of actual nodes).
 */
namespace TheaterFixture {
  const w = globalThis as unknown as Record<string, any>;
  export type Options = { playlist?: boolean; reclaim?: string[]; delayed?: boolean; replaceSidebar?: boolean };
  let options: Options = {};
  let watch: HTMLElement, normalPlayerParent: HTMLElement, theaterSlot: HTMLElement;
  let player: HTMLElement;
  const origins = new Map<string, { node: HTMLElement; parent: HTMLElement; anchor: Comment }>();
  export const events: { theater: boolean; trusted: boolean; via: string }[] = [];
  const move = (parent: HTMLElement, node: Node, before: Node | null): void => (parent as HTMLElement & { moveBefore(node: Node, before: Node | null): void }).moveBefore(node, before);
  export function build(opts: Options = {}): void {
    options = opts; origins.clear(); events.length = 0;
    w.PlaylistFixture.build({ attach: opts.playlist !== false });
    watch = w.LayoutRegressionFixture.watch;
    player = document.getElementById('movie_player')!;
    normalPlayerParent = player.parentElement!;
    theaterSlot = document.createElement('div'); theaterSlot.id = 'full-bleed-container';
    watch.insertBefore(theaterSlot, watch.firstChild);
    const style = document.createElement('style');
    style.textContent = `
      #full-bleed-container { display:none; }
      ytd-watch-flexy[theater] > #full-bleed-container { display:block; width:100%; background:#080808; }
      ytd-watch-flexy[theater] > #full-bleed-container > #movie_player { height:440px; aspect-ratio:auto; max-width:1440px; margin:auto; }
      .fixture-size-button { position:absolute; bottom:8px; right:8px; color:white; background:#333; border:1px solid #666; padding:8px; }
    `;
    document.head.append(style);
    for (const name of ['info', 'comments', 'playlist', 'videos']) {
      const node = name === 'info' ? w.LayoutRegressionFixture.description : name === 'comments' ? w.LayoutRegressionFixture.comments : name === 'playlist' ? (opts.playlist === false ? null : w.PlaylistFixture.panel) : w.LayoutRegressionFixture.related;
      if (!(node instanceof HTMLElement) || !node.parentElement) continue;
      const anchor = document.createComment('fixture-native-' + name);
      node.parentElement.insertBefore(anchor, node);
      origins.set(name, { node, parent: node.parentElement, anchor });
    }
    const button = document.createElement('button'); button.className = 'fixture-size-button ytp-size-button'; button.textContent = '영화관 모드 (T)'; button.type = 'button';
    button.addEventListener('click', e => { if(e.isTrusted) change(!watch.hasAttribute('theater'), e.isTrusted, 'button'); });
    player.append(button);
    document.addEventListener('keydown', e => {
      if (!e.isTrusted || e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.key.toLowerCase() !== 't') return;
      if (e.target instanceof HTMLElement && e.target.closest('input,textarea,[contenteditable]')) return;
      change(!watch.hasAttribute('theater'), e.isTrusted, 'keyboard');
    });
  }
  export function reclaim(name: string): void {
    const r = origins.get(name); if (!r) return;
    const next = r.anchor.nextSibling === r.node ? r.node.nextSibling : r.anchor.nextSibling;
    move(r.parent, r.node, next);
  }
  function replaceSidebar(): void {
    const old = document.getElementById('secondary-inner')!;
    const fresh = document.createElement('div'); fresh.id = 'secondary-inner';
    old.id = 'fixture-old-sidebar'; old.parentElement!.insertBefore(fresh, old);
    // Native sections and the extension host remain connected; the observed
    // destination changes, but the original restore markers remain valid.
    for (const child of [...old.childNodes]) move(fresh, child, null);
    for (const r of origins.values()) if (r.parent === old) r.parent = fresh;
    old.remove();
  }
  export function change(theater: boolean, trusted = false, via = 'fixture'): void {
    events.push({ theater, trusted, via });
    watch.toggleAttribute('theater', theater);
    watch.toggleAttribute('full-bleed-player', theater);
    if (theater) move(theaterSlot, player, null);
    else move(normalPlayerParent, player, normalPlayerParent.firstChild);
    const names = options.reclaim || [];
    const apply = () => { for (const name of names) reclaim(name); if (options.replaceSidebar) replaceSidebar(); };
    if (options.delayed) window.setTimeout(apply, 140); else apply();
  }
  export function hideSource(name: string, hidden: boolean): void { origins.get(name)!.node.hidden = hidden; }
  export function hideWatch(hidden: boolean): void { watch.hidden = hidden; }
  export function moveToNewOrigin(name: string): void {
    const r = origins.get(name)!;
    const root = name === 'info' ? r.parent : document.getElementById('secondary-inner')!;
    const parent = document.createElement('div'); parent.className = 'fixture-new-origin'; root.append(parent);
    const anchor = document.createComment('fixture-new-native-'+name); parent.append(anchor);
    move(parent, r.node, null); r.anchor.remove(); r.parent = parent; r.anchor = anchor;
  }
  export function read(): Record<string, unknown> {
    const status = w.__browserToolboxYouTubeLayoutV1__?.getStatus();
    const values: Record<string, unknown> = {};
    for (const [name, r] of origins) {
      const pane = document.getElementById('btx-pane-'+name);
      values[name] = { connected:r.node.isConnected, sameNode:pane?.firstElementChild===r.node,
        parent:r.node.parentElement?.id || r.node.parentElement?.className,
        atOrigin:r.node.parentElement===r.parent && r.node.previousSibling===r.anchor,
        owned:r.node.getAttribute('data-btx-layout-owned') };
    }
    const v = w.LayoutRegressionFixture.mainVideo as HTMLVideoElement;
    return { status, sections:values, hosts:document.querySelectorAll('#btx-youtube-tabs').length,
      hostParent:document.getElementById('btx-youtube-tabs')?.parentElement?.id,
      events:[...events], theater:watch.hasAttribute('theater'), playerParent:player.parentElement?.id,
      video:{ sameNode:player.querySelector('video')===v, rate:v.playbackRate,time:v.currentTime,paused:v.paused,ended:v.ended },
      inputValue:(document.getElementById('fixture-input') as HTMLInputElement|null)?.value,
      selected:[...document.querySelectorAll('#btx-youtube-tabs [role=tab][aria-selected=true]')].map(n=>n.id),
      orphan:document.querySelector('#btx-youtube-tabs[data-orphan=true]')!==null };
  }
}
(globalThis as unknown as Record<string, unknown>).TheaterFixture = TheaterFixture;
