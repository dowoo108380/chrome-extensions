"use strict";
/** Shared, dependency-free contracts. Loaded before consumers in each extension world. */
var ToolboxShared;
(function (ToolboxShared) {
    /** Storage may contain null or malformed legacy values. Only numbers and
     * nonempty numeric input strings may reach numeric preference normalizers. */
    function numericSetting(value) {
        return typeof value === "number" || (typeof value === "string" && value.trim() !== "") ? Number(value) : NaN;
    }
    ToolboxShared.numericSetting = numericSetting;
    ToolboxShared.CAPTION_PORT_NAME = "browser-toolbox:caption-tasks";
    ToolboxShared.CAPTION_OPERATIONS = Object.freeze({
        "youtube-transcript:get-info": "info",
        "youtube-transcript:get-transcript": "transcript",
        "youtube-synced-captions:apply": "synced-caption-apply",
        "youtube-synced-captions:remove": "synced-caption-remove"
    });
    function isCaptionMessage(value) {
        return isRecord(value) && typeof value.type === "string" && Object.hasOwn(ToolboxShared.CAPTION_OPERATIONS, value.type);
    }
    ToolboxShared.isCaptionMessage = isCaptionMessage;
    function captionRequest(value) {
        if (!isCaptionMessage(value) || !Number.isInteger(value.tabId) || Number(value.tabId) < 0)
            throw new Error("자막 작업의 탭 번호가 올바르지 않습니다.");
        const task = { operation: ToolboxShared.CAPTION_OPERATIONS[value.type] };
        if (value.trackIndex !== undefined) {
            if (!Number.isInteger(value.trackIndex) || Number(value.trackIndex) < 0 || Number(value.trackIndex) > 1000)
                throw new Error("자막 트랙 번호가 올바르지 않습니다.");
            task.trackIndex = Number(value.trackIndex);
        }
        for (const key of ["trackId", "translationLanguageCode", "expectedVideoId"]) {
            if (value[key] === undefined)
                continue;
            if (typeof value[key] !== "string" || value[key].length > 256 || /[\u0000-\u001f\u007f]/.test(value[key]))
                throw new Error("자막 작업의 식별 정보가 올바르지 않습니다.");
            task[key] = value[key];
        }
        return { tabId: Number(value.tabId), task };
    }
    ToolboxShared.captionRequest = captionRequest;
    /** YouTube enhancements are opt-in. All are plain DOM/CSS features, not player-state overrides. */
    ToolboxShared.YOUTUBE_FEATURES = Object.freeze([
        { key: "youtubeLayoutTabsEnabled", label: "오른쪽 탭형 패널", description: "기존 설명·댓글·관련 동영상을 탭으로 정리합니다. 라이브에서는 댓글 대신 실시간 채팅을 표시하며, 실제 재생목록이 있으면 동영상 앞에 추가합니다.", group: "layout" },
        { key: "youtubeDescriptionExpandedEnabled", label: "영상 설명 자동 펼치기", description: "확인된 설명의 더보기 버튼으로 펼칩니다. 직접 접으면 다시 펼치지 않습니다.", group: "layout" },
        { key: "youtubeCommentStatusEnabled", label: "댓글 수와 상태 표시", description: "댓글 탭에 YouTube가 표시한 댓글 수나 안내 문구를 표시합니다.", group: "layout", dependsOn: "youtubeLayoutTabsEnabled" },
        { key: "youtubePanelScrollEnabled", label: "패널 내부 스크롤", description: "탭 내용만 스크롤합니다. 좁은 창에서는 기존 한 열 배치를 유지합니다.", group: "layout", dependsOn: "youtubeLayoutTabsEnabled" },
        { key: "youtubeNativePanelsEnabled", label: "채팅·부가 패널과 배치 연동", description: "외부 YouTube 패널이 열리면 공간을 양보합니다. 탭 안에 연결한 채팅·재생목록에는 적용하지 않습니다.", group: "layout", dependsOn: "youtubeLayoutTabsEnabled" },
        { key: "youtubeFullChannelNameEnabled", label: "긴 채널 이름 펼쳐 보기", description: "채널 정보에 마우스를 올리거나 키보드로 선택하면 이름의 줄바꿈을 허용합니다.", group: "layout" },
        { key: "youtubeSpeedNoticeEnabled", label: "배속 변경 알림", description: "실제로 바뀐 배속을 영상 중앙에 잠깐 표시합니다.", group: "player", dependsOn: "mediaControllerEnabled" },
        { key: "youtubeProgressThemeEnabled", label: "무지개 진행 막대와 픽셀 고양이", description: "원본의 무지개 진행률·애니메이션·고양이 손잡이를 적용합니다. 탐색 동작은 바꾸지 않습니다.", group: "player" }
    ]);
    ToolboxShared.YOUTUBE_DEFAULTS = Object.freeze(Object.fromEntries(ToolboxShared.YOUTUBE_FEATURES.map(f => [f.key, false])));
    ToolboxShared.YOUTUBE_STATUS_MESSAGE = "youtube-layout:get-status";
    function youtubeSettings(values) {
        return Object.fromEntries(ToolboxShared.YOUTUBE_FEATURES.map(f => [f.key, values[f.key] === true]));
    }
    ToolboxShared.youtubeSettings = youtubeSettings;
    ToolboxShared.MEDIA_KEYS = Object.freeze({
        enabled: "mediaControllerEnabled", speedStep: "mediaSpeedStep", seekStep: "mediaSeekStepSeconds",
        resetFallbackRate: "mediaResetFallbackRate", keepRateForNewMedia: "mediaKeepRateForNewMedia",
        overlayEnabled: "mediaOverlayEnabled", keyboardEnabled: "mediaKeyboardEnabled", overlayPosition: "mediaOverlayPosition",
        shortcutSlower: "mediaShortcutSlowerCode", shortcutFaster: "mediaShortcutFasterCode", shortcutReset: "mediaShortcutResetCode",
        shortcutBackward: "mediaShortcutBackwardCode", shortcutForward: "mediaShortcutForwardCode", shortcutOverlay: "mediaShortcutOverlayCode"
    });
    ToolboxShared.AB_ENABLED_KEY = "youtubeAbLoopKeyboardEnabled";
    ToolboxShared.MEDIA_SHORTCUTS = Object.freeze([
        { command: "slower", storageKey: ToolboxShared.MEDIA_KEYS.shortcutSlower, defaultCode: "KeyS", label: "느리게" },
        { command: "faster", storageKey: ToolboxShared.MEDIA_KEYS.shortcutFaster, defaultCode: "KeyD", label: "빠르게" },
        { command: "reset", storageKey: ToolboxShared.MEDIA_KEYS.shortcutReset, defaultCode: "KeyR", label: "기본 배속 전환" },
        { command: "backward", storageKey: ToolboxShared.MEDIA_KEYS.shortcutBackward, defaultCode: "KeyZ", label: "뒤로 이동" },
        { command: "forward", storageKey: ToolboxShared.MEDIA_KEYS.shortcutForward, defaultCode: "KeyX", label: "앞으로 이동" },
        { command: "overlay", storageKey: ToolboxShared.MEDIA_KEYS.shortcutOverlay, defaultCode: "KeyV", label: "속도 표시창 전환" }
    ]);
    ToolboxShared.AB_SHORTCUTS = Object.freeze([
        { command: "loopA", storageKey: "youtubeAbLoopShortcutACode", defaultCode: "KeyA", label: "반복 A 지점 설정" },
        { command: "loopB", storageKey: "youtubeAbLoopShortcutBCode", defaultCode: "KeyB", label: "반복 B 지점 설정" }
    ]);
    ToolboxShared.SHORTCUTS = Object.freeze([...ToolboxShared.MEDIA_SHORTCUTS, ...ToolboxShared.AB_SHORTCUTS]);
    ToolboxShared.SHORTCUT_DEFAULTS = Object.freeze({
        ...Object.fromEntries(ToolboxShared.SHORTCUTS.map(d => [d.storageKey, d.defaultCode])), [ToolboxShared.AB_ENABLED_KEY]: true
    });
    const BLOCKED_CODES = new Set(["Escape", "Tab", "Enter", "NumpadEnter", "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight", "CapsLock", "NumLock", "ScrollLock", "Pause", "PrintScreen", "Unidentified", "Process"]);
    function normalizeShortcutCode(value, fallback = "") {
        const code = typeof value === "string" ? value.trim() : "";
        return code.length <= 32 && /^[A-Za-z][A-Za-z0-9]*$/.test(code) && !BLOCKED_CODES.has(code) ? code : fallback;
    }
    ToolboxShared.normalizeShortcutCode = normalizeShortcutCode;
    function shortcutSettings(source) {
        return { ...Object.fromEntries(ToolboxShared.SHORTCUTS.map(d => [d.storageKey, normalizeShortcutCode(source[d.storageKey], d.defaultCode)])),
            [ToolboxShared.AB_ENABLED_KEY]: source[ToolboxShared.AB_ENABLED_KEY] !== false };
    }
    ToolboxShared.shortcutSettings = shortcutSettings;
    function shortcutBindings(source, code, includeMedia = true, includeAb = true) {
        return ToolboxShared.SHORTCUTS.filter(d => (d.command.startsWith("loop") ? includeAb && source[ToolboxShared.AB_ENABLED_KEY] !== false : includeMedia)
            && normalizeShortcutCode(source[d.storageKey], d.defaultCode) === code);
    }
    ToolboxShared.shortcutBindings = shortcutBindings;
    function shortcutConflicts(source) {
        const conflicts = [];
        for (const code of new Set(ToolboxShared.SHORTCUTS.map(d => normalizeShortcutCode(source[d.storageKey], d.defaultCode)))) {
            const bindings = shortcutBindings(source, code);
            if (bindings.length > 1)
                conflicts.push(`${code}: ${bindings.map(d => d.label).join(" / ")}`);
        }
        return conflicts;
    }
    ToolboxShared.shortcutConflicts = shortcutConflicts;
    /** Inspect the composed path, not only its retargeted host. A closed custom
     * focus target is intentionally not eligible for global media shortcuts. */
    function keyboardInputContext(event) {
        const path = event.composedPath();
        for (const entry of path) {
            if (!(entry instanceof Element))
                continue;
            if (entry.matches("input,textarea,select,[contenteditable]:not([contenteditable='false']),[role='textbox'],[role='searchbox'],[role='combobox'],[role='spinbutton']") ||
                entry.closest("[data-browser-toolbox-synced-caption-overlay],[data-btx-media-control]"))
                return true;
        }
        const origin = path.find((entry) => entry instanceof Element);
        // If the path starts at a focused custom element, a closed shadow tree may
        // hide its real input. Do not consume typing that cannot be inspected.
        if (origin === document.activeElement && origin !== document.body && origin !== document.documentElement) {
            if (origin?.localName.includes("-"))
                return true;
            // A closed shadow root may also belong to a standard div/span. Without
            // an inspectable media surface, a focused container is not a safe global
            // shortcut target. Native video-player containers remain eligible.
            if (origin?.matches("div,span,section,article,main,aside,header,footer,nav,p") &&
                !origin.querySelector("video,audio") && !origin.shadowRoot)
                return true;
        }
        let active = document.activeElement;
        while (active?.shadowRoot?.activeElement)
            active = active.shadowRoot.activeElement;
        return !!active && (active.matches("input,textarea,select,[contenteditable]:not([contenteditable='false']),[role='textbox']") ||
            (!!active.localName.includes("-") && active === origin));
    }
    ToolboxShared.keyboardInputContext = keyboardInputContext;
    /** Preferences are nominal menu resolutions, not fabricated player quality tokens. */
    ToolboxShared.QUALITY_HEIGHTS = Object.freeze([144, 240, 360, 480, 720, 1080, 1440, 2160, 4320]);
    ToolboxShared.QUALITY_DEFAULTS = Object.freeze({
        youtubePreferredQualityEnabled: false,
        youtubePreferredQualityHeight: 1080,
        youtubeQualityPremiumPreferred: true
    });
    ToolboxShared.QUALITY_MESSAGES = Object.freeze({ STATUS: "youtube-quality:status", REAPPLY: "youtube-quality:reapply" });
    function qualitySettings(values) {
        const result = { ...ToolboxShared.QUALITY_DEFAULTS, ...Object.fromEntries(Object.keys(ToolboxShared.QUALITY_DEFAULTS).filter(k => Object.hasOwn(values, k)).map(k => [k, values[k]])) };
        if (typeof result.youtubePreferredQualityEnabled !== "boolean" || typeof result.youtubeQualityPremiumPreferred !== "boolean" ||
            !ToolboxShared.QUALITY_HEIGHTS.some(h => h === result.youtubePreferredQualityHeight))
            throw new Error("선호 화질 설정의 형식 또는 범위가 올바르지 않습니다.");
        return result;
    }
    ToolboxShared.qualitySettings = qualitySettings;
    function parseQualityLabel(value) {
        // FPS/HDR suffixes belong to the actual menu label; do not confuse them with resolution.
        const match = /^\s*(\d{3,4})p(?:\d{2,3})?(?=$|\s|(?:HDR|HD|4K|8K|Premium|프리미엄)\b)/i.exec(value.normalize("NFKC"));
        if (!match)
            return null;
        const height = Number(match[1]);
        if (height < 144 || height > 4320)
            return null;
        return { height, premium: /premium\b|프리미엄/i.test(value) };
    }
    ToolboxShared.parseQualityLabel = parseQualityLabel;
    function chooseQuality(choices, preferred, premiumFirst) {
        const available = choices.filter(c => c.available && Number.isInteger(c.height) && c.height >= 144 && c.height <= 4320);
        if (!available.length)
            return null;
        const below = available.filter(c => c.height <= preferred);
        const height = below.length ? Math.max(...below.map(c => c.height)) : Math.min(...available.map(c => c.height));
        const same = available.filter(c => c.height === height);
        // Within the same class, preserve a real current selection, then the player's menu order.
        return [...same].sort((a, b) => Number(b.premium === premiumFirst) - Number(a.premium === premiumFirst) ||
            Number(b.checked) - Number(a.checked) || a.index - b.index)[0];
    }
    ToolboxShared.chooseQuality = chooseQuality;
    ToolboxShared.MEDIA_MESSAGES = Object.freeze({ GET_TAB_STATE: "media-controller:get-tab-state", REPORT_TAB_RATE: "media-controller:report-tab-rate", APPLY_TAB_RATE: "media-controller:apply-tab-rate", SET_TAB_RATE: "media-controller:set-tab-rate", UPDATED: "media-controller:tab-rate-updated" });
    function isRecord(value) {
        return value !== null && typeof value === "object" && !Array.isArray(value);
    }
    ToolboxShared.isRecord = isRecord;
    function errorMessage(error) {
        return error instanceof Error ? error.message : isRecord(error) && typeof error.message === "string" ? error.message : String(error);
    }
    ToolboxShared.errorMessage = errorMessage;
    function isRate(value) { return typeof value === "number" && Number.isFinite(value) && value > 0; }
    ToolboxShared.isRate = isRate;
    function mediaReply(value) {
        if (!isRecord(value))
            return false;
        if (value.ok === false)
            return typeof value.error === "string";
        return value.ok === true && typeof value.hasMedia === "boolean" && isRate(value.rate) && isRate(value.templateRate);
    }
    ToolboxShared.mediaReply = mediaReply;
    /** Change only the current rate. Never change the element's default rate or report an unobserved request as applied. */
    function applyPlaybackRate(media, requestedRate) {
        let previousRate = null;
        let setterAttempted = false;
        try {
            previousRate = media.playbackRate;
            if (!media.isConnected)
                throw new Error("선택한 미디어가 페이지에서 제거되었습니다.");
            if (!isRate(requestedRate) || requestedRate < 0.07 || requestedRate > 16)
                throw new Error("재생 속도는 0.07부터 16 사이의 숫자여야 합니다.");
            if (!isRate(previousRate))
                throw new Error("실제 재생 속도를 읽을 수 없습니다.");
            if (Math.abs(previousRate - requestedRate) > 0.0001) {
                setterAttempted = true;
                media.playbackRate = requestedRate;
            }
            const actualRate = media.playbackRate;
            if (!isRate(actualRate) || Math.abs(actualRate - requestedRate) > 0.0001) {
                throw new Error(`요청한 ${requestedRate}배속이 적용되지 않았습니다. 실제 배속: ${actualRate}.`);
            }
            return { ok: true, requestedRate, actualRate, previousRate };
        }
        catch (error) {
            let actualRate = null;
            let restored = false;
            let restoreError = "";
            try {
                actualRate = media.playbackRate;
                if (setterAttempted && isRate(previousRate) && actualRate !== previousRate)
                    media.playbackRate = previousRate;
                actualRate = media.playbackRate;
                restored = isRate(previousRate) && actualRate === previousRate;
            }
            catch (failure) {
                restoreError = ` 기존 배속 복원도 실패했습니다: ${errorMessage(failure)}`;
            }
            return { ok: false, requestedRate, previousRate, actualRate, restored,
                error: `${errorMessage(error)}${restoreError || (restored ? " 기존 배속을 유지했습니다." : " 기존 배속의 복원을 확인하지 못했습니다.")}` };
        }
    }
    ToolboxShared.applyPlaybackRate = applyPlaybackRate;
    /** A rejected task rejects its caller without poisoning the following task. */
    class SerialTaskQueue {
        tail = Promise.resolve();
        run(task) {
            const operation = this.tail.then(task);
            this.tail = operation.then(() => undefined, () => undefined);
            return operation;
        }
        idle() { return this.tail; }
    }
    ToolboxShared.SerialTaskQueue = SerialTaskQueue;
    /** Per-resource FIFO. Unrelated tabs remain independent and idle keys are released. */
    class KeyedTaskQueue {
        queues = new Map();
        run(key, task) {
            let queue = this.queues.get(key);
            if (!queue) {
                queue = new SerialTaskQueue();
                this.queues.set(key, queue);
            }
            const operation = queue.run(task), tail = queue.idle(), owner = queue;
            void tail.then(() => {
                if (this.queues.get(key) === owner && owner.idle() === tail)
                    this.queues.delete(key);
            });
            return operation;
        }
    }
    ToolboxShared.KeyedTaskQueue = KeyedTaskQueue;
    /** Do not release a control queue while a failed batch still has running writes. */
    async function mapConcurrent(items, task, concurrency) {
        if (!Number.isInteger(concurrency) || concurrency < 1)
            throw new Error("동시 작업 수는 양의 정수여야 합니다.");
        const results = new Array(items.length);
        let next = 0, failed = false, failure;
        async function worker() {
            while (!failed && next < items.length) {
                const index = next++;
                try {
                    results[index] = await task(items[index]);
                }
                catch (error) {
                    if (!failed) {
                        failed = true;
                        failure = error;
                    }
                }
            }
        }
        await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
        if (failed)
            throw failure;
        return results;
    }
    ToolboxShared.mapConcurrent = mapConcurrent;
    /** Reconcile a delayed storage snapshot with only the real changes since its read began.
     * Missing/deleted values are represented as undefined so each consumer keeps its own defaults.
     * Memory is bounded by the declared setting keys, not by the number of changes. */
    class SettingsReadJournal {
        revision = 0;
        allowed;
        changes = new Map();
        constructor(keys) { this.allowed = new Set(keys); }
        mark() { return this.revision; }
        record(changes) {
            for (const key of Object.keys(changes)) {
                if (this.allowed.has(key))
                    this.changes.set(key, { revision: ++this.revision, value: changes[key]?.newValue });
            }
        }
        merge(snapshot, since) {
            const result = { ...snapshot };
            for (const [key, change] of this.changes)
                if (change.revision > since)
                    result[key] = change.value;
            return result;
        }
    }
    ToolboxShared.SettingsReadJournal = SettingsReadJournal;
    function readStorage(area, runtime, keys) {
        return new Promise((resolve, reject) => {
            if (!area?.get) {
                reject(new Error("Chrome 저장소를 사용할 수 없습니다."));
                return;
            }
            area.get(keys, values => { const error = runtime.lastError; if (error)
                reject(new Error(error.message || "설정을 읽지 못했습니다."));
            else
                resolve(values); });
        });
    }
    ToolboxShared.readStorage = readStorage;
    function writeStorage(area, runtime, values) {
        return new Promise((resolve, reject) => {
            if (!area?.set) {
                reject(new Error("Chrome 저장소를 사용할 수 없습니다."));
                return;
            }
            area.set(values, () => { const error = runtime.lastError; if (error)
                reject(new Error(error.message || "설정을 저장하지 못했습니다."));
            else
                resolve(); });
        });
    }
    ToolboxShared.writeStorage = writeStorage;
    function removeStorage(area, runtime, keys) {
        return new Promise((resolve, reject) => {
            if (!area?.remove) {
                reject(new Error("Chrome 저장소를 사용할 수 없습니다."));
                return;
            }
            area.remove(typeof keys === "string" ? keys : [...keys], () => { const error = runtime.lastError; if (error)
                reject(new Error(error.message || "설정을 제거하지 못했습니다."));
            else
                resolve(); });
        });
    }
    ToolboxShared.removeStorage = removeStorage;
    // Shared validation for stored selectors: service worker and page restoration use one grammar.
    const PERSISTENT_ANCHOR_ATTRIBUTES = Object.freeze([
        "data-testid",
        "data-test-id",
        "data-test",
        "data-qa",
        "data-cy",
        "data-component",
        "aria-label",
        "name",
        "role"
    ]);
    function splitSafePersistentSelector(rawSelector) {
        const selector = String(rawSelector || "").trim();
        if (!selector || selector.length > 1200)
            return null;
        const segments = [];
        let current = "";
        let quote = "";
        let bracketDepth = 0;
        let escaped = false;
        for (const character of selector) {
            if (escaped) {
                current += character;
                escaped = false;
                continue;
            }
            if (character === "\\") {
                current += character;
                escaped = true;
                continue;
            }
            if (quote) {
                current += character;
                if (character === quote)
                    quote = "";
                continue;
            }
            if (character === '"' || character === "'") {
                quote = character;
                current += character;
                continue;
            }
            if (character === "[") {
                bracketDepth += 1;
                current += character;
                continue;
            }
            if (character === "]") {
                bracketDepth -= 1;
                if (bracketDepth < 0)
                    return null;
                current += character;
                continue;
            }
            if (bracketDepth === 0 && character === ">") {
                const segment = current.trim();
                if (!segment)
                    return null;
                segments.push(segment);
                current = "";
                continue;
            }
            if (bracketDepth === 0 &&
                (character === "," || character === "+" || character === "~" ||
                    character === "*" || character === ":" || character === "{" ||
                    character === "}" || character === "\n" || character === "\r")) {
                return null;
            }
            current += character;
        }
        if (escaped || quote || bracketDepth !== 0)
            return null;
        const finalSegment = current.trim();
        if (!finalSegment)
            return null;
        segments.push(finalSegment);
        return segments.length <= 7 ? segments : null;
    }
    function isSafePersistentSelector(rawSelector) {
        const segments = splitSafePersistentSelector(rawSelector);
        if (!segments?.length)
            return false;
        const anchorAttributes = PERSISTENT_ANCHOR_ATTRIBUTES
            .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join("|");
        const attributeAnchorPattern = new RegExp(`^[a-z][a-z0-9-]*\\[(?:${anchorAttributes})\\s*=`, "i");
        const root = segments[0];
        if (!/^#[a-zA-Z_][a-zA-Z0-9_-]{0,79}$/.test(root) && !attributeAnchorPattern.test(root)) {
            return false;
        }
        for (const segment of segments) {
            if (!segment || segment.length > 360)
                return false;
            if (/^(?:html|body|head)(?:$|[.#\[])/i.test(segment))
                return false;
            let quote = "";
            let bracketDepth = 0;
            let escaped = false;
            for (const character of segment) {
                if (escaped) {
                    escaped = false;
                    continue;
                }
                if (character === "\\") {
                    escaped = true;
                    continue;
                }
                if (quote) {
                    if (character === quote)
                        quote = "";
                    continue;
                }
                if (character === '"' || character === "'") {
                    quote = character;
                    continue;
                }
                if (character === "[")
                    bracketDepth += 1;
                else if (character === "]")
                    bracketDepth -= 1;
                else if (bracketDepth === 0 && /\s/.test(character))
                    return false;
            }
            if (escaped || quote || bracketDepth !== 0)
                return false;
        }
        return true;
    }
    ToolboxShared.isSafePersistentSelector = isSafePersistentSelector;
})(ToolboxShared || (ToolboxShared = {}));
// Keep the classic-script contract explicit under strict eval in component tests.
globalThis.ToolboxShared = ToolboxShared;
