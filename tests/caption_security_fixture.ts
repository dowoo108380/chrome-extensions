/** Local fixture only. No YouTube server or internal request is contacted. */
(() => {
  type Obj = Record<string, any>;
  const w = globalThis as unknown as Obj;
  w.__captionFixture = (options: Obj) => {
    const player = document.getElementById("movie_player") as HTMLElement & Obj;
    const video = player.querySelector("video")!;
    const cc = document.createElement("button");
    cc.className = "ytp-subtitles-button";
    cc.setAttribute("aria-pressed", "true");
    cc.textContent = "CC";
    player.appendChild(cc);
    cc.addEventListener("click", () => cc.setAttribute("aria-pressed", String(cc.getAttribute("aria-pressed") !== "true")));
    const issued = "https://www.youtube.com/api/timedtext?v=fixture&lang=en&fmt=" + options.format;
    const track = { vssId: ".en", languageCode: "en", name: { simpleText: "English" },
      baseUrl: issued + (options.captured ? "&exp=xpe" : ""), isTranslatable: true };
    let chosen: Obj | null = track;
    const calls: string[] = [];
    let issuedOnce = false;
    w.fetch = async (url: unknown) => {
      calls.push(String(url));
      return new Response(options.text, { status: 200, headers: { "content-type": options.mime } });
    };
    player.getPlayerResponse = () => ({ videoDetails: { videoId: "fixture", title: "Local caption security fixture" },
      captions: { playerCaptionsTracklistRenderer: { captionTracks: [track], translationLanguages: [{ languageCode: "ko", languageName: { simpleText: "한국어" } }] } } });
    player.getVideoData = () => ({ video_id: "fixture" });
    player.isModuleLoaded = () => true;
    player.getOption = (_name: string, key: string) => key === "track" ? chosen : null;
    player.setOption = (_name: string, key: string, value: unknown) => {
      if (key === "track") {
        chosen = value as Obj;
        if (options.captured && !issuedOnce) {
          issuedOnce = true;
          // Models an actual player-issued request for exercising the existing capture path.
          void w.fetch(issued);
        }
      }
    };
    w.__captionSnapshot = () => {
      const track = Array.from(video.textTracks).find(t => t.label === "Browser Toolbox 동기화 자막");
      return { cc: cc.getAttribute("aria-pressed"), rate: video.playbackRate,
        mode: track?.mode ?? null, cues: Array.from(track?.cues || []).map((c: TextTrackCue) => ({
          text: (c as VTTCue).text, start: c.startTime, end: c.endTime
        })), active: Array.from(track?.activeCues || []).map(c => (c as VTTCue).text), calls: [...calls] };
    };
  };
  // Explicit test double for the cross-world transport. Production uses same-document
  // CustomEvents; this constrained environment uses a second browser page for the helper.
  w.__captionRelay = (channelId: string) => {
    document.addEventListener(`browser-toolbox-caption-text-request:${channelId}`, (event: Event) => {
      (w.__captionRequests ??= []).push({ channelId, detail: (event as CustomEvent).detail });
    }, true);
  };
  w.__captionParse = (channelId: string, detail: string) => new Promise<string>(resolve => {
    const name = `browser-toolbox-caption-text-response:${channelId}`;
    const requestId = JSON.parse(detail).requestId;
    const handler = (event: Event) => {
      const raw = (event as CustomEvent).detail;
      if (JSON.parse(raw).requestId !== requestId) return;
      document.removeEventListener(name, handler, true);
      resolve(raw);
    };
    document.addEventListener(name, handler, true);
    document.dispatchEvent(new CustomEvent(`browser-toolbox-caption-text-request:${channelId}`, { detail }));
  });
})();
