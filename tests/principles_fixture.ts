/** Test-only fault injection and state observations; never loaded by the extension. */
namespace PrinciplesFixture {
  const w = globalThis as unknown as Record<string, any>;
  export function holdLocalReads(): void {
    const original = w.chrome.storage.local.get;
    const pending: (() => void)[] = [];
    w.chrome.storage.local.get = (keys: unknown, callback: (data: unknown) => void) => original(keys, (data: unknown) => pending.push(() => callback(data)));
    w.__auditReleaseRead = () => pending.shift()?.();
    w.__auditReadCount = () => pending.length;
  }
  export function preparePlayer(): void {
    const video = document.querySelector('video')!;
    const player = document.createElement('div'); player.id = 'movie_player';
    player.style.cssText = 'width:640px;height:420px;background:#111;position:relative';
    const controls = document.createElement('div'); controls.className = 'ytp-right-controls';
    controls.style.cssText = 'height:48px;position:absolute;bottom:0;right:0;display:flex';
    document.body.prepend(player); player.append(video, controls);
    const outside = document.createElement('button'); outside.textContent = 'Outside'; outside.id = 'outside'; document.body.append(outside);
  }
  export function spyPlayback(): void {
    const video = document.querySelector('video')!;
    const time = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')!;
    w.__auditSeeks = [];
    Object.defineProperty(video, 'currentTime', { configurable: true,
      get: () => time.get!.call(video),
      set: (value: number) => {
        w.__auditSeeks.push({ from: time.get!.call(video), to: value, ended: video.ended, paused: video.paused });
        time.set!.call(video, value);
      }
    });
  }
  export function mediaState(): unknown {
    const video = document.querySelector('video')!;
    return { time: video.currentTime, duration: video.duration, ended: video.ended, paused: video.paused, rate: video.playbackRate,
      label: document.querySelector('.btx-yt-ab-loop-toggle-label')?.textContent,
      enabled: document.querySelector('.btx-yt-ab-loop-toggle')?.getAttribute('aria-pressed'), seeks: w.__auditSeeks };
  }
  export function trackObjectUrls(): void {
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    w.__auditCreated = []; w.__auditRevoked = [];
    URL.createObjectURL = value => { const url = create(value); w.__auditCreated.push(url); return url; };
    URL.revokeObjectURL = url => { w.__auditRevoked.push(url); revoke(url); };
  }
  export function queryMedia(id: string, source: string): unknown {
    let reply: unknown;
    for (const listener of w.chrome.runtime.onMessage.listeners) listener({type:'media-controller:get-tab-state',queryFrame:true,mediaId:id,sourceKey:source},{},(value:unknown)=>{reply=value;});
    return reply;
  }
}

(globalThis as unknown as Record<string, unknown>).PrinciplesFixture = PrinciplesFixture;
