/** Test only: native quality UI and stream responses are simulated; DOM and video decoding are real. */
(() => {
  type Obj = Record<string, any>;
  const w = globalThis as unknown as Obj;
  const player = document.getElementById("movie_player")!;
  const video = document.querySelector("video")!;
  const gear = document.querySelector<HTMLButtonElement>(".ytp-settings-button")!;
  const menu = document.querySelector<HTMLElement>(".ytp-settings-menu")!;
  const state: Obj = { href: "https://www.youtube.com/watch?v=quality_fixture", calls: [], gearCalls: 0, qualityOpens: 0,
    items: ["1080p", "720p", "360p", "144p"], selected: "360p", enabledPremium: false, disabledLabels: [], upsellLabels: [],
    delay: 0, selectionDelay: 0, closeDelay: 0, closeTransitionDelay: 0, closingGearClicks: 0, refuseMenuClose: false, refuse: false, closeOnSelect: true, qualityName: "화질", mode: "", streamSources: {}, nativeClicks: [] };
  w.__qualityFixture = state;
  function element<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag); el.className = cls; el.textContent = text; return el;
  }
  function open(show: boolean): void { menu.hidden = !show; menu.removeAttribute("aria-hidden"); gear.setAttribute("aria-expanded", String(show)); }
  function panel(title: string): HTMLElement {
    const p = element("div", "ytp-panel"); const header = element("div", "ytp-panel-header");
    const back = element("button", "ytp-panel-back-button", "‹"); back.addEventListener("click", root);
    header.append(back, element("span", "ytp-panel-title", title)); p.append(header);
    const rows = element("div", "ytp-panel-menu"); rows.setAttribute("role", "menu"); p.append(rows); menu.replaceChildren(p); return rows;
  }
  function root(): void {
    state.mode = "settings";
    const rows = panel("설정");
    for (const label of ["재생 속도", state.qualityName, ...(state.duplicate ? [state.qualityName] : [])]) {
      const row = element("div", "ytp-menuitem"); row.setAttribute("role", "menuitem"); row.tabIndex = 0;
      row.append(element("div", "ytp-menuitem-label", label), element("div", "ytp-menuitem-content", label === state.qualityName ? state.selected : "1.25"));
      row.addEventListener("click", () => { if (label === state.qualityName) { state.qualityOpens++; window.setTimeout(quality, state.delay); } }); rows.append(row);
    }
    // Unrelated added menu rows observed beside YouTube's native Quality row.
    // They must never be used as the extension's preference or selection API.
    if (state.extraPreferences) for (const label of ["Preferred Premium", "Preferred Quality"]) {
      const row = element("div", "ytp-menuitem");
      row.append(element("div", "ytp-menuitem-icon ythdp-icon"), element("div", "ytp-menuitem-label", label),
        element("div", "ytp-menuitem-content", label === "Preferred Quality" ? "< 4320p >" : ""));
      row.addEventListener("click", () => { state.extraPreferenceClicks = (state.extraPreferenceClicks || 0) + 1; }); rows.append(row);
    }
  }
  function quality(): void {
    state.mode = "quality";
    const rows = panel(state.qualityName);
    for (const label of [...state.items, "자동"]) {
      const row = element("div", "ytp-menuitem"); row.setAttribute("role", "menuitemradio"); row.tabIndex = 0;
      row.setAttribute("aria-checked", String(label === state.selected));
      if (state.disabledLabels.includes(label)) row.setAttribute("aria-disabled", "true");
      else if (label.includes("Premium") && state.enabledPremium) row.setAttribute("aria-disabled", "false");
      if (state.upsellLabels.includes(label)) row.setAttribute("aria-haspopup", "dialog");
      row.append(element("div", "ytp-menuitem-label", label));
      row.addEventListener("click", (e) => {
        if (state.disabledLabels.includes(label)) return;
        state.nativeClicks.push({ label, trusted: e.isTrusted });
        if (state.upsellLabels.includes(label)) { state.upsellOpened = true; return; }
        state.calls.push(label);
        window.setTimeout(() => {
          if (!state.refuse) {
            state.selected = label;
            const source = state.streamSources[label];
            if (source && video.src !== source) { video.src = source; video.load(); }
          }
          if (state.closeOnSelect && state.closeTransitionDelay > 0) {
            // Real YouTube leaves the old panel box present while aria-hidden
            // already says true. Reopening must wait for this close to finish.
            menu.setAttribute("aria-hidden", "true");
            window.setTimeout(() => { open(false); menu.replaceChildren(); }, state.closeTransitionDelay);
          }
          else if (state.closeOnSelect) { open(false); menu.replaceChildren(); }
          else quality();
        }, state.selectionDelay);
      });
      row.addEventListener("keydown", e => { if (["Enter", " "].includes(e.key)) { e.preventDefault(); row.click(); } });
      rows.append(row);
    }
  }
  gear.addEventListener("click", () => {
    state.gearCalls++;
    if (menu.getAttribute("aria-hidden") === "true") state.closingGearClicks++;
    if (!menu.hidden) { if (!state.refuseMenuClose) window.setTimeout(() => open(false), state.closeDelay); }
    else { open(true); root(); }
  });
  state.showQuality = () => { open(true); quality(); };
  state.close = () => open(false);
  state.configure = (values: Obj) => { Object.assign(state, values); };
  state.next = (id: string) => {
    document.dispatchEvent(new Event("yt-navigate-start"));
    state.href = `https://www.youtube.com/watch?v=${id}`;
    if (state.realNavigation) history.pushState({}, "", state.href);
    document.querySelector("ytd-watch-flexy")!.setAttribute("video-id", id);
    open(false); menu.replaceChildren(); state.selected = "360p";
    document.dispatchEvent(new Event("yt-navigate-finish"));
  };
  state.status = () => new Promise(resolve => {
    const listeners = w.chrome.runtime.onMessage.listeners;
    for (const handler of listeners) handler({ type: "youtube-quality:status" }, { id: w.chrome.runtime.id, url: w.chrome.runtime.getURL("popup.html") }, (r: Obj) => resolve(r.result));
  });
  state.reapply = () => new Promise(resolve => {
    for (const handler of w.chrome.runtime.onMessage.listeners) handler({ type: "youtube-quality:reapply" }, { id: w.chrome.runtime.id, url: w.chrome.runtime.getURL("popup.html") }, resolve);
  });
})();
