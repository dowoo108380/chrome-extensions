"use strict";
/** Popup presentation only: navigation and search reuse existing controls and handlers. */
(() => {
    "use strict";
    const SECTION_LABELS = Object.freeze({
        media: "재생 속도", youtube: "YouTube", captions: "자막", tabs: "탭 관리",
        page: "페이지 도구", chat: "ChatGPT", settings: "설정과 진단"
    });
    const ITEMS = [
        { section: "media", label: "미디어 속도 조절 사용", target: "media-controller-toggle", words: "HTML5 동영상 오디오 켜기" },
        { section: "media", label: "현재 재생 속도", target: "media-rate-input", words: "배속 직접 입력 영상" },
        { section: "media", label: "1배속으로 초기화", target: "media-rate-reset" },
        { section: "media", label: "속도 변경 간격", target: "media-speed-step-input", words: "빠르게 느리게 증가 감소" },
        { section: "media", label: "앞뒤 이동 간격", target: "media-seek-step-input", words: "탐색 초" },
        { section: "media", label: "R 키 기본 복원 배속", target: "media-reset-fallback-rate-input" },
        { section: "media", label: "새 미디어에 마지막 속도 유지", target: "media-keep-rate-toggle" },
        { section: "media", label: "영상 위 속도 표시창", target: "media-overlay-toggle", words: "플로팅 인디케이터" },
        { section: "media", label: "속도 표시창 위치 초기화", target: "media-overlay-position-reset" },
        { section: "media", label: "미디어 단축키 변경", target: "media-shortcut-heading", words: "S D R Z X V 키보드" },
        { section: "media", label: "미디어 키보드 단축키 사용", target: "media-keyboard-toggle" },
        { section: "media", label: "A/B 반복 단축키", target: "youtube-ab-keyboard-toggle", words: "루프 A B" },
        { section: "media", label: "단축키 기본값 복원", target: "media-shortcut-reset" },
        ...ToolboxShared.YOUTUBE_FEATURES.map(feature => ({
            section: "youtube", label: feature.label, target: `btx-option-${feature.key}`, words: feature.description
        })),
        { section: "youtube", label: "선호 화질 자동 선택", target: "youtube-quality-auto", words: "해상도 자동 차선 144p 4320p" },
        { section: "youtube", label: "선호 해상도", target: "youtube-quality-height", words: "화질 1080p 1440p 2160p 4K 8K" },
        { section: "youtube", label: "Premium 화질 우선", target: "youtube-quality-premium", words: "프리미엄 비트레이트" },
        { section: "youtube", label: "현재 영상 화질 상태 확인", target: "youtube-quality-inspect", words: "해상도 디코딩" },
        { section: "youtube", label: "이 영상의 자동 화질 선택 다시 시작", target: "youtube-quality-reapply", words: "수동 변경" },
        { section: "youtube", label: "레이아웃 상태 확인", target: "youtube-tools-inspect", words: "영화관 재생목록 스크롤" },
        { section: "youtube", label: "레이아웃 진단 복사", target: "youtube-tools-copy-layout" },
        { section: "captions", label: "자막을 적용할 영상 탭 선택", target: "youtube-transcript-tab-list", words: "트랙 원본 자동 번역 언어" },
        { section: "captions", label: "배속 동기화 자막 적용", target: "youtube-synced-caption-apply" },
        { section: "captions", label: "배속 동기화 자막 해제", target: "youtube-synced-caption-remove" },
        { section: "captions", label: "자막 글자 크기", target: "youtube-synced-caption-font-size" },
        { section: "captions", label: "자막 표시창 최대 너비", target: "youtube-synced-caption-max-width" },
        { section: "captions", label: "자막 줄 수", target: "youtube-synced-caption-line-count", words: "한줄 두줄 줄바꿈" },
        { section: "captions", label: "큰 자막의 넘침 처리", target: "caption-overflow-mode", words: "스크롤 확대" },
        { section: "captions", label: "자막 위치 초기화", target: "youtube-synced-caption-position-reset" },
        { section: "captions", label: "자막 텍스트 복사", target: "youtube-transcript-copy" },
        { section: "captions", label: "자막을 한 파일로 저장", target: "youtube-transcript-download", words: "TXT 합본 다운로드" },
        { section: "captions", label: "자막을 개별 파일로 저장", target: "youtube-transcript-download-separate", words: "TXT 일괄 다운로드" },
        { section: "captions", label: "자막에 영상 제목 포함", target: "youtube-transcript-title-toggle" },
        { section: "captions", label: "자막에 재생 시간 포함", target: "youtube-transcript-time-toggle" },
        { section: "captions", label: "자막 문장 사이 빈 줄", target: "youtube-transcript-spacing" },
        { section: "tabs", label: "열린 탭 선택", target: "tab-list" },
        { section: "tabs", label: "선택한 탭의 URL 복사", target: "copy-tab-urls-button", words: "주소 링크" },
        { section: "tabs", label: "모든 탭의 활성 상태 유지", target: "tab-keep-active-global-toggle", words: "일괄 백그라운드 새탭" },
        { section: "tabs", label: "선택한 탭의 활성 상태 유지", target: "enable-selected-tab-keep-active", words: "백그라운드" },
        { section: "tabs", label: "선택한 탭의 활성 상태 복원", target: "disable-selected-tab-keep-active" },
        { section: "tabs", label: "선택한 사이트의 쿠키와 캐시 삭제", target: "clear-site-data-button", words: "사이트 데이터" },
        { section: "page", label: "현재 페이지 전체 캡처", target: "full-page-button", words: "스크린샷 PNG" },
        { section: "page", label: "드래그 영역 캡처", target: "area-button", words: "스크린샷 PNG" },
        { section: "page", label: "파일 포함 이미지 만들기", target: "file-to-image-button", words: "ZIP" },
        { section: "page", label: "클릭하여 요소 숨기기", target: "element-eraser-heading", words: "지우기 사이트 기억" },
        { section: "page", label: "기억한 요소 숨김 규칙 복원", target: "clear-element-eraser-rules" },
        { section: "page", label: "입력 제한 해제 일괄 설정", target: "page-unlock-master-toggle" },
        { section: "page", label: "우클릭 메뉴 허용", target: "right-click-toggle" },
        { section: "page", label: "텍스트 드래그 및 선택 허용", target: "text-selection-toggle" },
        { section: "page", label: "복사 차단 및 문구 변경 방지", target: "copy-unlock-toggle" },
        { section: "page", label: "클립보드 덧붙이기 방지", target: "clipboard-protection-toggle", words: "출처" },
        { section: "page", label: "이미지 드래그 허용", target: "image-drag-toggle" },
        { section: "page", label: "Ctrl+클릭 및 가운데 버튼 허용", target: "middle-click-toggle", words: "휠 새탭 자동 스크롤" },
        { section: "page", label: "뒤로 가기 방해 차단", target: "back-navigation-toggle" },
        { section: "chat", label: "새 메시지 Ctrl + Enter 전송", target: "composer-toggle" },
        { section: "chat", label: "편집한 메시지 Ctrl + Enter 전송", target: "message-edit-toggle" },
        { section: "chat", label: "대화 기록 너비", target: "chat-width-slider" },
        { section: "chat", label: "새 메시지 입력란 너비", target: "composer-width-slider" },
        { section: "settings", label: "설정 ZIP 백업", target: "settings-export", words: "내보내기 저장" },
        { section: "settings", label: "설정 ZIP 복원", target: "settings-import-file", words: "가져오기" },
        { section: "settings", label: "요소 숨김 규칙 백업과 복원", target: "settings-include-rules" },
        { section: "settings", label: "전체 탭 활성 유지 설정 복원", target: "settings-include-global" },
        { section: "settings", label: "현재 탭 진단 정보 복사", target: "settings-copy-diagnostics", words: "오류 VSR 상태" }
    ];
    const nav = document.querySelector(".section-nav");
    const input = document.getElementById("popup-search");
    const results = document.getElementById("popup-search-results");
    const items = document.getElementById("popup-search-items");
    const summary = document.getElementById("popup-search-summary");
    if (!nav || !input || !results || !items || !summary)
        return;
    const navButtons = [...nav.querySelectorAll("[role=tab]")];
    const panels = [...document.querySelectorAll(".workspace-panel")];
    let activeSection = "media";
    let pendingTarget = null;
    let highlight = null;
    let highlightTimer = 0;
    let matches = [];
    function enterCurrentSection() {
        const panel = document.getElementById(`view-${activeSection}`);
        if (!panel)
            return;
        // Root disclosures retain their original controllers, data loading, and error handling.
        const toggleId = panel.dataset.entryToggle;
        const ready = activeSection === "media" ? document.documentElement.dataset.popupControlsReady === "true"
            : activeSection === "captions" ? document.documentElement.dataset.popupCaptionsReady === "true" : true;
        if (toggleId && !ready)
            return;
        const toggle = toggleId ? document.getElementById(toggleId) : null;
        if (toggle && !toggle.disabled && toggle.getAttribute("aria-expanded") !== "true")
            toggle.click();
        panel.querySelectorAll(":scope > details").forEach(d => { d.open = true; });
        if (pendingTarget?.section === activeSection)
            revealTarget(pendingTarget);
    }
    function activate(section) {
        if (!Object.hasOwn(SECTION_LABELS, section))
            return;
        pendingTarget = null;
        activeSection = section;
        for (const button of navButtons) {
            const active = button.dataset.section === section;
            button.setAttribute("aria-selected", String(active));
            button.tabIndex = active ? 0 : -1;
        }
        for (const panel of panels)
            panel.hidden = panel.dataset.section !== section;
        document.dispatchEvent(new CustomEvent("browser-toolbox-section-change", { detail: section }));
        enterCurrentSection();
    }
    function closeSearch() { results.hidden = true; }
    function revealTarget(item) {
        const target = document.getElementById(item.target);
        const panel = document.getElementById(`view-${item.section}`);
        if (!target || !panel)
            return;
        // Open enclosing, existing details/dropdown UIs, never click the setting or action itself.
        const parents = [];
        for (let p = target.parentElement; p && p !== panel; p = p.parentElement)
            parents.unshift(p);
        for (const parent of parents) {
            if (parent instanceof HTMLDetailsElement)
                parent.open = true;
            if (!parent.hidden || !parent.id)
                continue;
            const disclosure = [...panel.querySelectorAll("button[aria-controls]")]
                .find(button => button.getAttribute("aria-controls") === parent.id);
            if (disclosure && !disclosure.disabled)
                disclosure.click();
        }
        if (parents.some(p => p.hidden)) {
            pendingTarget = item;
            return;
        }
        pendingTarget = null;
        window.clearTimeout(highlightTimer);
        highlight?.classList.remove("search-target");
        const row = target.closest(".setting-row,.youtube-tools-row,.media-number-setting,.chat-width-setting,.youtube-synced-caption-setting,.media-shortcut-editor")
            ?? (target.matches(":disabled") ? target.parentElement ?? target : target);
        // Checkbox inputs are visually hidden; focus remains on the real accessible input.
        const disabled = target.matches(":disabled");
        if (!disabled && target.matches("button,input,select,textarea"))
            target.focus({ preventScroll: true });
        else {
            row.tabIndex = -1;
            row.focus({ preventScroll: true });
        }
        row.scrollIntoView({ block: "center", behavior: "instant" });
        highlight = row;
        row.classList.add("search-target");
        highlightTimer = window.setTimeout(() => { row.classList.remove("search-target"); if (highlight === row)
            highlight = null; }, 2400);
    }
    function selectResult(item) {
        closeSearch();
        input.value = "";
        activate(item.section);
        pendingTarget = item;
        enterCurrentSection();
    }
    function normalize(text) { return text.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, ""); }
    function search() {
        const tokens = input.value.trim().split(/\s+/).filter(Boolean).map(normalize);
        items.replaceChildren();
        if (!tokens.length) {
            closeSearch();
            matches = [];
            return;
        }
        matches = ITEMS.filter(item => {
            const text = normalize(`${SECTION_LABELS[item.section]} ${item.label} ${item.words ?? ""}`);
            return tokens.every(token => text.includes(token));
        });
        results.hidden = false;
        summary.textContent = matches.length ? `${matches.length}개 기능 · 선택하면 해당 설정으로 이동합니다.` : "일치하는 기능이 없습니다. 다른 단어로 검색해 주세요.";
        for (const item of matches) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "search-result";
            const label = document.createElement("span");
            label.textContent = item.label;
            const path = document.createElement("small");
            path.textContent = SECTION_LABELS[item.section];
            button.append(label, path);
            button.addEventListener("click", () => selectResult(item));
            items.append(button);
        }
    }
    nav.addEventListener("click", event => {
        const button = event.target.closest("button[data-section]");
        if (!button || !nav.contains(button))
            return;
        closeSearch();
        activate(button.dataset.section);
    });
    nav.addEventListener("keydown", event => {
        if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey)
            return;
        const index = navButtons.indexOf(document.activeElement);
        if (index < 0)
            return;
        let next = index;
        switch (event.key) {
            case "ArrowDown":
                next = (index + 1) % navButtons.length;
                break;
            case "ArrowUp":
                next = (index - 1 + navButtons.length) % navButtons.length;
                break;
            case "Home":
                next = 0;
                break;
            case "End":
                next = navButtons.length - 1;
                break;
            default: return;
        }
        event.preventDefault();
        event.stopPropagation();
        navButtons.forEach((b, i) => { b.tabIndex = i === next ? 0 : -1; });
        navButtons[next].focus();
        // Manual activation: Enter/Space use the native button click, avoiding unwanted loads on arrows.
    });
    input.addEventListener("input", search);
    input.addEventListener("focus", () => { if (input.value.trim())
        search(); });
    input.addEventListener("keydown", event => {
        if (event.isComposing)
            return;
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            closeSearch();
            input.value = "";
        }
        if (event.key === "ArrowDown" && !results.hidden) {
            event.preventDefault();
            event.stopPropagation();
            items.querySelector("button")?.focus();
        }
        if (event.key === "Enter" && !results.hidden && matches.length) {
            event.preventDefault();
            event.stopPropagation();
            selectResult(matches[0]);
        }
    });
    results.addEventListener("keydown", event => {
        if (event.isComposing)
            return;
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            input.focus();
            closeSearch();
            return;
        }
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown")
            return;
        const buttons = [...items.querySelectorAll("button")];
        const i = buttons.indexOf(document.activeElement);
        if (i < 0)
            return;
        event.preventDefault();
        event.stopPropagation();
        const next = i + (event.key === "ArrowDown" ? 1 : -1);
        if (next < 0)
            input.focus();
        else
            buttons[Math.min(next, buttons.length - 1)].focus();
    });
    document.addEventListener("pointerdown", event => {
        if (!(event.target instanceof Node))
            return;
        if (!results.contains(event.target) && !input.closest(".feature-search")?.contains(event.target))
            closeSearch();
    });
    document.addEventListener("keydown", event => {
        if (event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey)
            return;
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
            event.preventDefault();
            event.stopPropagation();
            input.focus();
            input.select();
        }
    });
    // Existing modules keep their local reports. Also surface their actual new messages
    // in the fixed footer, so an error cannot be missed below a long settings list.
    const footerStatus = document.getElementById("status");
    const statusObservers = [];
    for (const [section, id] of [["youtube", "youtube-tools-status"], ["settings", "settings-tools-status"]]) {
        const local = document.getElementById(id);
        if (!local || !footerStatus)
            continue;
        const observer = new MutationObserver(() => {
            const error = local.dataset.error === "true";
            if (section !== activeSection && !error)
                return;
            const text = local.textContent?.trim();
            if (!text)
                return;
            footerStatus.textContent = text;
            footerStatus.dataset.state = error ? "error" : "ready";
        });
        observer.observe(local, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["data-error"] });
        statusObservers.push(observer);
    }
    window.addEventListener("pagehide", () => {
        window.clearTimeout(highlightTimer);
        for (const observer of statusObservers)
            observer.disconnect();
    }, { once: true });
    document.addEventListener("browser-toolbox-popup-ready", enterCurrentSection);
    const version = document.getElementById("popup-version");
    if (version) {
        try {
            version.textContent = `버전 ${chrome.runtime.getManifest().version}`;
        }
        catch {
            version.textContent = "버전을 확인할 수 없습니다.";
        }
    }
    activate("media");
})();
