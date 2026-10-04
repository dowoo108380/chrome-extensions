"use strict";
/** Repair invalid settings-button labels and select an actual native quality menu item.
 * No private player API, network replay,
 * stream replacement, entitlement guessing, CSS hiding of menus, or quality lock. */
(() => {
    "use strict";
    if (window !== window.top || !isYouTubeDocument())
        return;
    function pageUrl() { return new URL(location.href); }
    function isYouTubeDocument() { return /(^|\.)youtube\.com$/i.test(pageUrl().hostname); }
    const sentinel = "__browserToolboxQualityV1__";
    if (Object.hasOwn(globalThis, sentinel))
        return;
    Reflect.set(globalThis, sentinel, true);
    const QUALITY_NAMES = new Set(["quality", "화질"]);
    const AUTO_NAMES = /^(auto(?:matic)?|자동)(?:\s*\([^)]*\))?$/i;
    const UPSELL = /\b(?:upgrade|subscribe|purchase|buy|try premium|get premium|join premium|members only)\b|가입|구매|결제|무료 체험|회원 전용/i;
    class Interrupted extends Error {
        constructor() { super("화질 선택 작업이 취소되었습니다."); }
    }
    const settingsJournal = new ToolboxShared.SettingsReadJournal(Object.keys(ToolboxShared.QUALITY_DEFAULTS));
    let values = { ...ToolboxShared.QUALITY_DEFAULTS };
    let settings = ToolboxShared.qualitySettings(values);
    let revision = 0, loaded = false, settingsValid = false, pageHidden = false, navigating = false, activeKey = "", manualForKey = false;
    let session = null, task = null;
    let refreshTimer = 0, readGeneration = 0, enabledEvents = null;
    let observer = null, rootObserver = null;
    let topState = "off", topDetail = "선호 화질 자동 선택이 꺼져 있습니다.";
    function text(node) { return (node?.textContent || "").replace(/\s+/g, " ").trim(); }
    function visible(node) {
        if (!node.isConnected || node.closest("[hidden],[inert],[aria-hidden=true]"))
            return false;
        const style = getComputedStyle(node);
        return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && node.getClientRects().length > 0;
    }
    function unique(items, reason) {
        if (items.length > 1)
            throw new Error(reason);
        return items[0] ?? null;
    }
    function watchKey(watch) {
        const url = pageUrl();
        if (url.pathname !== "/watch")
            return "";
        const fromUrl = url.searchParams.get("v") || "";
        const fromDom = watch.getAttribute("video-id");
        // A stale watch renderer during SPA navigation must never receive the new video's settings.
        if (!fromUrl || (fromDom !== null && fromDom !== fromUrl))
            return "";
        return fromUrl;
    }
    function findTarget() {
        if (pageUrl().pathname !== "/watch")
            return null;
        const players = [...document.querySelectorAll("ytd-watch-flexy #movie_player")].filter(visible);
        const player = unique(players, "현재 본 영상 플레이어가 하나인지 확인하지 못했습니다.");
        const watch = player?.closest("ytd-watch-flexy");
        if (!player || !watch)
            return null;
        const videos = [...player.querySelectorAll("video.html5-main-video")].filter(visible);
        const video = unique(videos, "현재 본 영상 요소가 하나인지 확인하지 못했습니다.");
        const key = watchKey(watch);
        return video && key ? { watch, player, video, key } : null;
    }
    function menuOpen(player) {
        return [...player.querySelectorAll(".ytp-settings-menu")].some(visible);
    }
    function settledMenuState(player) {
        const menus = [...player.querySelectorAll(".ytp-settings-menu")];
        if (menus.some(visible))
            return "open";
        // YouTube sets aria-hidden before its closing animation removes the box.
        // Clicking the gear during that interval toggles a still-closing menu.
        if (menus.every(menu => !menu.isConnected || menu.hidden ||
            getComputedStyle(menu).display === "none" || menu.getClientRects().length === 0))
            return "closed";
        return null;
    }
    function gearOf(player) {
        // The native button can have an empty or literal "null" accessible name.
        // Its player-scoped class identifies it; openQuality still verifies the
        // native Quality row, panel and checked radio item before reporting success.
        return unique([...player.querySelectorAll("button.ytp-settings-button")].filter(b => visible(b) && !b.matches(":disabled,[disabled],[aria-disabled=true]")), "설정 버튼을 하나로 확정하지 못했습니다.");
    }
    function validSettingsLabel(value) {
        return value !== null && value.trim() !== "" && !/^(null|undefined)$/i.test(value.trim());
    }
    function repairSettingsLabel(event) {
        const gear = event.target instanceof Element
            ? event.target.closest("#movie_player button.ytp-settings-button") : null;
        if (!gear)
            return;
        const attributes = ["data-tooltip-title", "data-title-no-tooltip", "aria-label", "title"];
        const language = document.documentElement.lang || navigator.language;
        const label = attributes.map(name => gear.getAttribute(name)).find(validSettingsLabel)
            ?? (/^ko(?:-|$)/i.test(language) ? "설정" : "Settings");
        for (const name of attributes) {
            const value = gear.getAttribute(name);
            // Preserve native names and a deliberately empty title (avoids a second,
            // browser-owned tooltip). Only modern controls need data-tooltip-title.
            const needed = name === "aria-label" ||
                (name === "data-tooltip-title" && gear.hasAttribute("data-tooltip-target-id")) ||
                (value !== null && (name !== "title" || value.trim() !== ""));
            if (needed && !validSettingsLabel(value))
                gear.setAttribute(name, label);
        }
    }
    function qualityPanel(player, includeHidden = false) {
        const panels = [...player.querySelectorAll(".ytp-settings-menu .ytp-panel")].filter(panel => {
            if (!includeHidden && !visible(panel))
                return false;
            const header = panel.querySelector(".ytp-panel-header");
            const label = header?.querySelector(".ytp-panel-title") || header;
            return QUALITY_NAMES.has(text(label).toLowerCase()) && !!panel.querySelector(".ytp-panel-menu [role=menuitemradio]");
        });
        return unique(panels, "화질 하위 메뉴를 하나로 확정하지 못했습니다.");
    }
    function qualityEntry(player) {
        return unique([...player.querySelectorAll(".ytp-settings-menu .ytp-menuitem")].filter(row => visible(row) && row.getAttribute("role") === "menuitem" && row.getAttribute("aria-disabled") !== "true" &&
            QUALITY_NAMES.has(text(row.querySelector(".ytp-menuitem-label")).toLowerCase())), "화질 메뉴 항목을 하나로 확정하지 못했습니다.");
    }
    function readItems(panel) {
        const rows = [...panel.querySelectorAll(".ytp-panel-menu [role=menuitemradio]")];
        return rows.flatMap((node, index) => {
            const label = text(node.querySelector(".ytp-menuitem-label") || node);
            const parsed = ToolboxShared.parseQualityLabel(label);
            if (!parsed)
                return [];
            const checked = node.getAttribute("aria-checked") === "true";
            const disabled = node.matches(":disabled,[disabled]") || !!node.closest("[inert],[aria-disabled=true],[hidden],[aria-hidden=true]");
            const upsell = UPSELL.test(`${text(node)} ${node.getAttribute("aria-label") || ""}`) ||
                !!node.querySelector("a[href]") || node.matches("a[href]") ||
                ["true", "dialog"].includes(node.getAttribute("aria-haspopup") || "");
            // Presence of 'Premium' does NOT prove entitlement. Require an actual checked
            // selection or explicit enabled ARIA semantics, and never click purchase rows.
            const premiumConfirmed = !parsed.premium || checked || node.getAttribute("aria-disabled") === "false";
            const available = !disabled && !upsell && premiumConfirmed;
            return [{ index, ...parsed, label, node, checked, available,
                    unavailableReason: disabled ? "사용 불가" : upsell ? "가입·구매 항목" : !premiumConfirmed ? "Premium 이용 가능 상태 미확인" : "" }];
        });
    }
    function sameChoice(a, b) {
        return a.height === b.height && a.premium === b.premium && a.label === b.label;
    }
    function setState(s, state, detail) {
        topState = state;
        topDetail = detail;
        if (s) {
            s.state = state;
            s.detail = detail;
        }
    }
    function cancel() { task?.abort.abort(); }
    function assertTask(t) {
        if (t.abort.signal.aborted || task !== t || session !== t.session || revision !== t.revision ||
            !settingsValid || !settings.youtubePreferredQualityEnabled || navigating || pageHidden ||
            !t.session.player.isConnected || !t.session.video.isConnected || watchKey(t.session.watch) !== t.session.key ||
            t.session.manual || t.session.player.matches(".ad-showing,.ad-interrupting"))
            throw new Interrupted();
        if (performance.now() > t.deadline)
            throw new Error("화질 메뉴 작업의 제한 시간을 넘겼습니다. 반복해서 강제 선택하지 않았습니다.");
    }
    async function waitFor(t, read, description, timeout = 1800) {
        const until = Math.min(performance.now() + timeout, t.deadline);
        for (;;) {
            assertTask(t);
            const result = read();
            if (result !== null)
                return result;
            if (performance.now() >= until)
                throw new Error(description);
            await new Promise((resolve, reject) => {
                const aborted = () => { window.clearTimeout(timer); reject(new Interrupted()); };
                const timer = window.setTimeout(() => { t.abort.signal.removeEventListener("abort", aborted); resolve(); }, 60);
                t.abort.signal.addEventListener("abort", aborted, { once: true });
            });
        }
    }
    function click(t, element) {
        assertTask(t);
        if (!visible(element) || element.matches(":disabled,[disabled],[aria-disabled=true]"))
            throw new Error("선택 직전에 메뉴 항목이 사라졌거나 비활성화되었습니다.");
        element.click();
    }
    async function openQuality(t) {
        const state = await waitFor(t, () => settledMenuState(t.session.player), "YouTube 설정 메뉴의 열기·닫기 전환이 끝나지 않았습니다.");
        if (state === "closed") {
            t.menuOwned = true;
            click(t, t.gear);
            await waitFor(t, () => menuOpen(t.session.player) ? true : null, "YouTube 설정 메뉴가 열렸는지 확인하지 못했습니다.");
        }
        const existing = qualityPanel(t.session.player);
        if (existing)
            return existing;
        const row = await waitFor(t, () => qualityEntry(t.session.player), "화질 메뉴를 확인하지 못했습니다. 한국어·영어의 데스크톱 화질 메뉴를 지원합니다.");
        click(t, row);
        return waitFor(t, () => qualityPanel(t.session.player), "해상도 목록과 실제 선택 상태가 있는 화질 메뉴를 확인하지 못했습니다.");
    }
    async function verifySelection(t, chosen) {
        for (let reopen = 0; reopen <= 1; reopen++) {
            const result = await waitFor(t, () => {
                const menuState = settledMenuState(t.session.player);
                if (menuState === "closed")
                    return "closed";
                if (menuState === null)
                    return null;
                const panel = qualityPanel(t.session.player);
                if (!panel)
                    return null;
                const checked = readItems(panel).filter(item => item.checked);
                return checked.length === 1 && sameChoice(checked[0], chosen) ? checked[0] : null;
            }, "요청한 화질이 실제 선택되었는지 확인하지 못했습니다. 요청값을 적용값으로 표시하지 않았습니다.", 2400);
            if (result !== "closed")
                return result;
            if (reopen === 0)
                await openQuality(t);
        }
        throw new Error("선택 상태를 확인하기 전에 화질 메뉴가 다시 닫혔습니다.");
    }
    async function restoreUi(t) {
        // Never close a menu which the user has taken over; never restore focus after input.
        if (!t.menuOwned || t.userTookMenu || !t.gear.isConnected || !t.session.player.isConnected ||
            navigating || watchKey(t.session.watch) !== t.session.key)
            return;
        if (settledMenuState(t.session.player) !== "closed") {
            const until = performance.now() + 1200;
            let closeRequested = false;
            while (settledMenuState(t.session.player) !== "closed") {
                if (t.userTookMenu || navigating || !t.gear.isConnected || watchKey(t.session.watch) !== t.session.key)
                    return;
                if (!closeRequested && settledMenuState(t.session.player) === "open") {
                    closeRequested = true;
                    t.gear.click();
                }
                if (performance.now() >= until)
                    throw new Error("화질 메뉴를 원래의 닫힌 상태로 복원하지 못했습니다.");
                await new Promise(resolve => window.setTimeout(resolve, 60));
            }
        }
        if (!t.interacted && t.focus instanceof HTMLElement && t.focus.isConnected &&
            (t.session.player.querySelector(".ytp-settings-menu")?.contains(document.activeElement) || document.activeElement === t.gear)) {
            t.focus.focus({ preventScroll: true });
        }
    }
    async function run(t) {
        const s = t.session;
        s.attempted = t.revision;
        setState(s, "selecting", "YouTube의 실제 화질 메뉴에서 항목을 읽는 중입니다.");
        try {
            const panel = await openQuality(t);
            let items = readItems(panel);
            if (!items.length)
                items = await waitFor(t, () => { const result = readItems(panel); return result.length ? result : null; }, "현재 영상의 해상도 목록을 읽지 못했습니다.");
            s.choices = items.map(({ node: _node, unavailableReason: _reason, ...choice }) => choice);
            s.premiumNote = settings.youtubeQualityPremiumPreferred && items.some(i => i.premium && !i.available)
                ? "이용 가능 여부가 불명확하거나 가입이 필요한 Premium 항목은 제외했습니다." : "";
            const chosen = ToolboxShared.chooseQuality(items, settings.youtubePreferredQualityHeight, settings.youtubeQualityPremiumPreferred);
            if (!chosen)
                throw new Error("실제로 선택 가능한 화질을 확인하지 못했습니다. 가입·구매 항목은 누르지 않았습니다.");
            assertTask(t);
            const current = readItems(panel);
            const target = unique(current.filter(i => sameChoice(i, chosen) && i.available), "동일한 화질 항목이 여러 개여서 선택 대상을 확정하지 못했습니다.");
            if (!target)
                throw new Error("작업 도중 화질 목록이 바뀌었습니다. 이전 항목을 사용하지 않았습니다.");
            if (!target.checked)
                click(t, target.node);
            // A native selection may close and rebuild the menu asynchronously.
            const selected = await verifySelection(t, chosen);
            assertTask(t);
            s.selected = selected.label;
            s.choices = readItems(qualityPanel(s.player, true)).map(({ node: _node, unavailableReason: _reason, ...choice }) => choice);
            setState(s, "selected", `YouTube 메뉴에서 ${selected.label} 선택을 확인했습니다.`);
        }
        catch (error) {
            if (error instanceof Interrupted) {
                if (session === s && s.state !== "manual" && s.state !== "error") {
                    s.attempted = -1;
                    setState(s, settings.youtubePreferredQualityEnabled ? "waiting" : "off", settings.youtubePreferredQualityEnabled
                        ? "사용자 조작 또는 페이지 변경으로 자동 작업을 중단했습니다." : "자동 선택을 중단했습니다. 현재 화질은 그대로 유지합니다.");
                }
            }
            else if (session === s) {
                s.selected = null;
                setState(s, "error", ToolboxShared.errorMessage(error));
            }
        }
        finally {
            try {
                await restoreUi(t);
            }
            catch (error) {
                if (session === s)
                    setState(s, "error", `${s.detail} ${ToolboxShared.errorMessage(error)}`);
            }
            if (task === t)
                task = null;
            // Only a changed preference/navigation is retried. A failed selection is never locked in a loop.
            if (revision !== t.revision || session !== s)
                schedule();
        }
    }
    function onNativeInput(event) {
        if (!event.isTrusted || !settings.youtubePreferredQualityEnabled || !session)
            return;
        if (event instanceof PointerEvent && (event.button !== 0 || !event.isPrimary))
            return;
        if (event instanceof MouseEvent && event.type === "click" && event.button !== 0)
            return;
        const path = event.composedPath();
        const element = path.find(n => n instanceof HTMLElement);
        if (!element)
            return;
        const player = session.player;
        if (task) {
            task.interacted = true;
            task.userTookMenu = !!element.closest(".ytp-settings-menu,.ytp-settings-button");
            cancel();
        }
        const row = element.closest("[role=menuitemradio]");
        if (!row || !player.contains(row) || !visible(row) || row.matches(":disabled,[disabled],[aria-disabled=true]"))
            return;
        let panel;
        try {
            panel = qualityPanel(player);
        }
        catch (error) {
            setState(session, "error", ToolboxShared.errorMessage(error));
            return;
        }
        if (!panel?.contains(row))
            return;
        const label = text(row.querySelector(".ytp-menuitem-label") || row);
        if (!ToolboxShared.parseQualityLabel(label) && !AUTO_NAMES.test(label))
            return;
        if (event instanceof KeyboardEvent && !["Enter", " "].includes(event.key))
            return;
        // Pointer down cancels pending automation before the user's native click executes.
        manualForKey = true;
        session.manual = true;
        session.selected = null;
        setState(session, "manual", "사용자가 화질을 직접 선택했습니다. 이 영상에서는 자동 선택을 중단하며 다음 영상부터 다시 시작합니다.");
    }
    function schedule() {
        if (refreshTimer || !settingsValid || !settings.youtubePreferredQualityEnabled || !loaded || pageHidden)
            return;
        refreshTimer = window.setTimeout(() => { refreshTimer = 0; reconcile(); }, 80);
    }
    function reconcile() {
        if (!settingsValid || !settings.youtubePreferredQualityEnabled || !loaded || pageHidden || navigating)
            return;
        try {
            const found = findTarget();
            if (!found) {
                cancel();
                setState(null, pageUrl().pathname === "/watch" ? "waiting" : "unsupported", "일반 YouTube 시청 페이지의 본 영상이 준비되기를 기다립니다.");
                return;
            }
            if (found.key !== activeKey) {
                activeKey = found.key;
                manualForKey = false;
            }
            if (!session || session.key !== found.key || session.player !== found.player || session.video !== found.video) {
                cancel();
                session = { ...found, manual: manualForKey, attempted: -1,
                    selected: null, choices: [], premiumNote: "", state: "waiting", detail: "화질 선택을 준비합니다." };
                observeTarget();
            }
            const s = session;
            if (s.manual) {
                setState(s, "manual", "수동 화질 선택을 유지합니다. 다음 영상부터 자동 선택을 다시 시작합니다.");
                return;
            }
            if (task || s.attempted === revision)
                return;
            if (document.visibilityState === "hidden") {
                setState(s, "waiting", "이 탭을 표시하면 화질을 선택합니다.");
                return;
            }
            if (s.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || s.player.matches(".ad-showing,.ad-interrupting")) {
                setState(s, "waiting", "본 영상 재생 데이터가 준비되기를 기다립니다. 광고의 화질은 변경하지 않습니다.");
                return;
            }
            if (menuOpen(s.player)) {
                setState(s, "waiting", "사용자가 열어 둔 설정 메뉴가 닫힐 때까지 기다립니다.");
                return;
            }
            const focused = document.activeElement;
            if (focused instanceof HTMLElement && (focused.isContentEditable || focused.matches("input,textarea,select"))) {
                setState(s, "waiting", "입력 중인 내용을 방해하지 않도록 기다립니다.");
                return;
            }
            const gear = gearOf(s.player);
            if (!gear) {
                setState(s, "waiting", "확인 가능한 YouTube 설정 버튼을 기다립니다.");
                return;
            }
            const t = { session: s, abort: new AbortController(), revision, menuOwned: false, userTookMenu: false,
                interacted: false, gear, focus: document.activeElement, deadline: performance.now() + 8500 };
            task = t;
            void run(t);
        }
        catch (error) {
            setState(session, "error", ToolboxShared.errorMessage(error));
        }
    }
    function observeTarget() {
        observer?.disconnect();
        if (!session || !observer)
            return;
        observer.observe(session.watch, { attributes: true, attributeFilter: ["video-id", "hidden"] });
        observer.observe(session.player, { attributes: true, childList: true, subtree: true,
            attributeFilter: ["class", "style", "hidden", "inert", "disabled", "aria-hidden", "aria-expanded", "aria-checked", "aria-disabled"] });
    }
    function enableEvents() {
        if (enabledEvents)
            return;
        enabledEvents = new AbortController();
        const signal = enabledEvents.signal;
        for (const type of ["pointerdown", "click", "keydown"])
            document.addEventListener(type, onNativeInput, { capture: true, signal });
        for (const type of ["loadedmetadata", "loadeddata", "canplay", "playing"])
            document.addEventListener(type, e => { if (e.target instanceof HTMLVideoElement)
                schedule(); }, { capture: true, signal });
        document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden")
            cancel();
        else
            schedule(); }, { signal });
        document.addEventListener("focusout", schedule, { signal });
        window.addEventListener("popstate", schedule, { signal });
        observer = new MutationObserver(records => {
            if (!session) {
                schedule();
                return;
            }
            // Subtitles, clocks and other unrelated player mutations never trigger another quality write.
            if (records.some(r => r.target === session.watch || r.target === session.player ||
                (r.target instanceof Element && (!!r.target.closest(".ytp-settings-menu,.ytp-settings-button") ||
                    (r.type === "attributes" && !!r.target.querySelector(".ytp-settings-button")))) ||
                [...r.addedNodes, ...r.removedNodes].some(n => n instanceof Element &&
                    (n.matches("video,.ytp-settings-menu,.ytp-settings-button") || !!n.querySelector("video,.ytp-settings-menu,.ytp-settings-button")))))
                schedule();
        });
        rootObserver = new MutationObserver(records => {
            if (pageUrl().pathname !== "/watch")
                return;
            if (!session?.player.isConnected || !session.video.isConnected) {
                schedule();
                return;
            }
            if (records.some(r => (r.type === "attributes" && r.target instanceof Element && r.target.matches("ytd-watch-flexy")) ||
                [...r.addedNodes].some(n => n instanceof Element &&
                    (n.matches("ytd-watch-flexy,#movie_player") || !!n.querySelector("ytd-watch-flexy,#movie_player")))))
                schedule();
        });
        rootObserver.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["video-id"] });
        observeTarget();
        schedule();
    }
    document.addEventListener("yt-navigate-start", () => { navigating = true; cancel(); });
    document.addEventListener("yt-navigate-finish", () => { navigating = false; if (enabledEvents)
        schedule(); });
    function disableEvents() {
        cancel();
        enabledEvents?.abort();
        enabledEvents = null;
        observer?.disconnect();
        observer = null;
        rootObserver?.disconnect();
        rootObserver = null;
        window.clearTimeout(refreshTimer);
        refreshTimer = 0;
    }
    function settingsChanged() {
        try {
            const next = ToolboxShared.qualitySettings(values);
            const changed = !settingsValid || JSON.stringify(next) !== JSON.stringify(settings);
            settingsValid = true;
            if (changed) {
                revision++;
                cancel();
            }
            settings = next;
            if (loaded && settings.youtubePreferredQualityEnabled && !pageHidden) {
                if (changed && !session?.manual) {
                    if (session)
                        session.selected = null;
                    setState(session, "waiting", "변경된 선호 화질 설정의 적용을 기다립니다.");
                }
                enableEvents();
                schedule();
            }
            else {
                disableEvents();
                setState(session, "off", "자동 선택이 꺼져 있습니다. 현재 화질은 그대로 유지합니다.");
            }
        }
        catch (error) {
            settingsValid = false;
            revision++;
            disableEvents();
            if (session)
                session.selected = null;
            setState(session, "error", ToolboxShared.errorMessage(error));
        }
    }
    async function readSettings() {
        const start = ++readGeneration;
        const snapshotRevision = settingsJournal.mark();
        try {
            const stored = await ToolboxShared.readStorage(chrome.storage.local, chrome.runtime, { ...ToolboxShared.QUALITY_DEFAULTS });
            if (start !== readGeneration)
                return;
            values = settingsJournal.merge(stored, snapshotRevision);
            for (const [key, fallback] of Object.entries(ToolboxShared.QUALITY_DEFAULTS))
                if (values[key] === undefined)
                    values[key] = fallback;
            loaded = true;
            settingsChanged();
        }
        catch (error) {
            if (start !== readGeneration)
                return;
            loaded = false;
            disableEvents();
            setState(session, "error", ToolboxShared.errorMessage(error));
        }
    }
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local")
            return;
        settingsJournal.record(changes);
        let changed = false;
        for (const key of Object.keys(ToolboxShared.QUALITY_DEFAULTS))
            if (Object.hasOwn(changes, key)) {
                values[key] = changes[key].newValue === undefined ? ToolboxShared.QUALITY_DEFAULTS[key] : changes[key].newValue;
                changed = true;
            }
        if (changed) {
            if (!loaded)
                void readSettings();
            else
                settingsChanged();
        }
    });
    function report() {
        const current = session && !navigating && session.player.isConnected && watchKey(session.watch) === session.key ? session : null;
        const video = current?.video;
        // Menu selection and actual decoded dimensions are different observations. Never label one as the other.
        return { state: current?.state || topState, detail: current?.detail || topDetail, settings, settingsValid,
            selectedLabel: current?.selected ?? null, selectionVerified: current?.state === "selected",
            manualForCurrentVideo: current?.manual ?? false, availableChoices: current?.choices ?? [],
            premiumNote: current?.premiumNote || "", decodedWidth: video?.videoWidth || null, decodedHeight: video?.videoHeight || null,
            readyState: video?.readyState ?? null, streamQuality: "dimensions-only-premium-bitrate-not-measured" };
    }
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (!ToolboxShared.isRecord(message))
            return;
        if (message.type === ToolboxShared.QUALITY_MESSAGES.STATUS)
            sendResponse({ ok: true, result: report() });
        if (message.type === ToolboxShared.QUALITY_MESSAGES.REAPPLY) {
            if (!ToolboxShared.isRecord(_sender) || _sender.id !== chrome.runtime.id || _sender.url !== chrome.runtime.getURL("popup.html")) {
                sendResponse({ ok: false, error: "확장 프로그램 패널에서 요청한 작업만 실행합니다." });
                return;
            }
            if (!loaded || !settingsValid) {
                sendResponse({ ok: false, error: "화질 설정을 읽고 올바른 값으로 저장한 뒤 다시 적용해 주세요." });
                return;
            }
            if (!settings.youtubePreferredQualityEnabled) {
                sendResponse({ ok: false, error: "먼저 선호 화질 자동 선택을 켜 주세요." });
                return;
            }
            cancel();
            revision++;
            manualForKey = false;
            if (session) {
                session.manual = false;
                session.attempted = -1;
                session.selected = null;
            }
            setState(session, "waiting", "이 영상의 수동 선택 중단 상태를 해제했습니다. 실제 메뉴를 확인한 후 적용합니다.");
            schedule();
            sendResponse({ ok: true, result: report() });
        }
    });
    window.addEventListener("pagehide", () => { pageHidden = true; disableEvents(); });
    window.addEventListener("pageshow", e => { if (e.persisted || pageHidden) {
        pageHidden = false;
        navigating = false;
        void readSettings();
    } });
    // Repair the public label attributes before native tooltip handlers read them.
    // Delegation also covers SPA-replaced controls, independently of quality settings.
    for (const type of ["pointerover", "mouseover", "focus"])
        document.addEventListener(type, repairSettingsLabel, true);
    void readSettings();
})();
