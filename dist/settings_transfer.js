"use strict";
/** A versioned preferences format and a narrowly scoped, single-entry ZIP32 codec. No browsing data is serialized. */
var ToolboxSettings;
(function (ToolboxSettings) {
    ToolboxSettings.MAX_BACKUP_BYTES = 8 * 1024 * 1024;
    ToolboxSettings.GLOBAL_KEY = "tabKeepActiveGlobalEnabledV1";
    ToolboxSettings.RULES_KEY = "pageElementEraserRulesV1";
    ToolboxSettings.MESSAGES = Object.freeze({ EXPORT: "settings-tools:export", PREVIEW: "settings-tools:preview", APPLY: "settings-tools:apply", DIAGNOSTICS: "settings-tools:diagnostics" });
    const bool = value => typeof value === "boolean";
    const number = (min, max, integer = false) => value => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
    const position = value => ToolboxShared.isRecord(value) && Object.keys(value).length === 2 && number(0, 1)(value.x) && number(0, 1)(value.y);
    const text = value => typeof value === "string" && value.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(value);
    const width = value => value === 0 || number(640, 2000, true)(value);
    ToolboxSettings.VALIDATORS = Object.freeze({
        composerCtrlEnterEnabled: bool, messageEditCtrlEnterEnabled: bool, chatConversationWidthPx: width, chatComposerWidthPx: width,
        mediaControllerEnabled: bool, mediaSpeedStep: number(0.01, 2), mediaSeekStepSeconds: number(1, 600, true), mediaResetFallbackRate: number(0.07, 16),
        mediaKeepRateForNewMedia: bool, mediaOverlayEnabled: bool, mediaKeyboardEnabled: bool, mediaOverlayPosition: position,
        ...Object.fromEntries(ToolboxShared.SHORTCUTS.map(d => [d.storageKey, (value) => typeof value === "string" && ToolboxShared.normalizeShortcutCode(value) === value])),
        [ToolboxShared.AB_ENABLED_KEY]: bool,
        ...Object.fromEntries(ToolboxShared.YOUTUBE_FEATURES.map(f => [f.key, bool])),
        youtubePreferredQualityEnabled: bool, youtubeQualityPremiumPreferred: bool,
        youtubePreferredQualityHeight: value => ToolboxShared.QUALITY_HEIGHTS.some(h => h === value),
        rightClickEnabled: bool, textSelectionEnabled: bool, copyUnlockEnabled: bool, clipboardProtectionEnabled: bool,
        imageDragEnabled: bool, middleClickEnabled: bool, backNavigationProtectionEnabled: bool,
        youtubeTranscriptIncludeTitle: bool, youtubeTranscriptIncludeTimestamps: bool, youtubeTranscriptBlankLines: number(0, 3, true),
        youtubeTranscriptSourcePreference: text, youtubeTranscriptTranslationLanguage: text,
        youtubeSyncedCaptionFontSizePx: number(14, 64, true), youtubeSyncedCaptionPosition: position,
        youtubeSyncedCaptionMaxWidthPercent: number(30, 100, true), youtubeSyncedCaptionPreferredLineCount: number(0, 6, true),
        youtubeSyncedCaptionOverflowMode: value => value === "scroll" || value === "expand",
        [ToolboxSettings.GLOBAL_KEY]: bool
    });
    /** Effective defaults at schema 2 export time. Schema 1 keeps its historical
     * sparse-patch semantics; never invent missing values in an old backup. */
    ToolboxSettings.EXPORT_DEFAULTS = Object.freeze({
        composerCtrlEnterEnabled: true, messageEditCtrlEnterEnabled: true, chatConversationWidthPx: 960, chatComposerWidthPx: 0,
        mediaControllerEnabled: false, mediaSpeedStep: 0.1, mediaSeekStepSeconds: 10, mediaResetFallbackRate: 2,
        mediaKeepRateForNewMedia: false, mediaOverlayEnabled: true, mediaKeyboardEnabled: true, mediaOverlayPosition: { x: 0.5, y: 0.02 },
        ...ToolboxShared.SHORTCUT_DEFAULTS, ...ToolboxShared.YOUTUBE_DEFAULTS, ...ToolboxShared.QUALITY_DEFAULTS,
        rightClickEnabled: false, textSelectionEnabled: false, copyUnlockEnabled: false, clipboardProtectionEnabled: false,
        imageDragEnabled: false, middleClickEnabled: false, backNavigationProtectionEnabled: false,
        youtubeTranscriptIncludeTitle: true, youtubeTranscriptIncludeTimestamps: false, youtubeTranscriptBlankLines: 0,
        youtubeTranscriptSourcePreference: "", youtubeTranscriptTranslationLanguage: "",
        youtubeSyncedCaptionFontSizePx: 28, youtubeSyncedCaptionPosition: { x: 0.5, y: 0.83 },
        youtubeSyncedCaptionMaxWidthPercent: 92, youtubeSyncedCaptionPreferredLineCount: 0, youtubeSyncedCaptionOverflowMode: "scroll",
        [ToolboxSettings.GLOBAL_KEY]: false
    });
    function selectSettings(stored) {
        const selected = {};
        for (const key of Object.keys(ToolboxSettings.VALIDATORS)) {
            const value = Object.hasOwn(stored, key) ? stored[key] :
                key === "copyUnlockEnabled" && stored.textSelectionEnabled === true ? true : ToolboxSettings.EXPORT_DEFAULTS[key];
            if (!ToolboxSettings.VALIDATORS[key](value))
                throw new Error(`현재 ${key} 설정의 형식이 올바르지 않습니다. 패널에서 먼저 수정해 주세요.`);
            selected[key] = structuredClone(value);
        }
        return selected;
    }
    ToolboxSettings.selectSettings = selectSettings;
    function validateBackup(raw) {
        if (!ToolboxShared.isRecord(raw) || raw.app !== "Browser Toolbox Extension" || (raw.schemaVersion !== 1 && raw.schemaVersion !== 2))
            throw new Error("지원하는 Browser Toolbox 설정 백업 형식이 아닙니다.");
        if (Object.keys(raw).some(key => !["app", "schemaVersion", "extensionVersion", "exportedAt", "settings", "rules"].includes(key)))
            throw new Error("백업에 알 수 없는 최상위 항목이 있습니다.");
        if (typeof raw.extensionVersion !== "string" || !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(raw.extensionVersion) || typeof raw.exportedAt !== "string" || !Number.isFinite(Date.parse(raw.exportedAt)))
            throw new Error("백업 버전 또는 작성 시각이 올바르지 않습니다.");
        if (!ToolboxShared.isRecord(raw.settings))
            throw new Error("백업 설정이 올바르지 않습니다.");
        if (raw.schemaVersion === 2 && Object.keys(ToolboxSettings.EXPORT_DEFAULTS).some(key => !Object.hasOwn(raw.settings, key)))
            throw new Error("전체 설정 백업에 필요한 설정값이 누락되어 있습니다.");
        for (const [key, value] of Object.entries(raw.settings)) {
            // Retired in 1.77.5. Accept old backups without restoring a removed UI.
            if (key === "youtubeSpeedMenuEnabled" && bool(value))
                continue;
            if (!Object.prototype.hasOwnProperty.call(ToolboxSettings.VALIDATORS, key))
                throw new Error(`허용되지 않은 설정 항목입니다: ${key}`);
            if (!ToolboxSettings.VALIDATORS[key](value))
                throw new Error(`설정값의 형식 또는 범위가 올바르지 않습니다: ${key}`);
        }
        if (raw.rules !== undefined && !ToolboxShared.isRecord(raw.rules))
            throw new Error("사이트 숨김 규칙의 형식이 올바르지 않습니다.");
        const settings = { ...raw.settings };
        delete settings.youtubeSpeedMenuEnabled;
        return { ...raw, settings };
    }
    ToolboxSettings.validateBackup = validateBackup;
    function canonical(value) {
        if (Array.isArray(value))
            return `[${value.map(canonical).join(",")}]`;
        if (ToolboxShared.isRecord(value))
            return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
        return JSON.stringify(value) ?? "null";
    }
    ToolboxSettings.canonical = canonical;
    async function digest(values) {
        const result = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(values)));
        return Array.from(new Uint8Array(result), value => value.toString(16).padStart(2, "0")).join("");
    }
    ToolboxSettings.digest = digest;
    const FILE_NAME = new TextEncoder().encode("settings.json");
    const crcTable = Array.from({ length: 256 }, (_, index) => {
        let v = index;
        for (let i = 0; i < 8; i++)
            v = (v & 1) ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
        return v >>> 0;
    });
    function crc32(bytes) {
        let crc = 0xffffffff;
        for (const byte of bytes)
            crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
        return (crc ^ 0xffffffff) >>> 0;
    }
    ToolboxSettings.crc32 = crc32;
    function createZip(backup) {
        validateBackup(backup);
        const data = new TextEncoder().encode(JSON.stringify(backup, null, 2));
        const localSize = 30 + FILE_NAME.length;
        const centralSize = 46 + FILE_NAME.length;
        const centralOffset = localSize + data.length;
        const bytes = new Uint8Array(centralOffset + centralSize + 22);
        if (bytes.length > ToolboxSettings.MAX_BACKUP_BYTES)
            throw new Error("설정 백업이 허용 크기인 8 MiB를 초과합니다.");
        const view = new DataView(bytes.buffer);
        const crc = crc32(data);
        const u16 = (offset, value) => view.setUint16(offset, value, true);
        const u32 = (offset, value) => view.setUint32(offset, value, true);
        // STORE method, UTF-8 filename, no data descriptor, no encryption, one entry, one disk.
        u32(0, 0x04034b50);
        u16(4, 20);
        u16(6, 0x0800);
        u16(12, 0x21);
        u32(14, crc);
        u32(18, data.length);
        u32(22, data.length);
        u16(26, FILE_NAME.length);
        bytes.set(FILE_NAME, 30);
        bytes.set(data, localSize);
        const c = centralOffset;
        u32(c, 0x02014b50);
        u16(c + 4, 20);
        u16(c + 6, 20);
        u16(c + 8, 0x0800);
        u16(c + 14, 0x21);
        u32(c + 16, crc);
        u32(c + 20, data.length);
        u32(c + 24, data.length);
        u16(c + 28, FILE_NAME.length);
        bytes.set(FILE_NAME, c + 46);
        const end = c + centralSize;
        u32(end, 0x06054b50);
        u16(end + 8, 1);
        u16(end + 10, 1);
        u32(end + 12, centralSize);
        u32(end + 16, centralOffset);
        return bytes;
    }
    ToolboxSettings.createZip = createZip;
    function readZip(bytes) {
        if (bytes.byteLength < 22 + 30 + 46 + FILE_NAME.length * 2 || bytes.byteLength > ToolboxSettings.MAX_BACKUP_BYTES)
            throw new Error("설정 ZIP 파일의 크기가 올바르지 않습니다.");
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const u16 = (at) => view.getUint16(at, true);
        const u32 = (at) => view.getUint32(at, true);
        const fail = () => { throw new Error("손상되었거나 지원하지 않는 설정 ZIP입니다. 이 확장 프로그램에서 내보낸 원본 ZIP을 선택해 주세요."); };
        const end = bytes.length - 22;
        if (u32(end) !== 0x06054b50 || u16(end + 4) || u16(end + 6) || u16(end + 8) !== 1 || u16(end + 10) !== 1 || u16(end + 20))
            fail();
        const central = u32(end + 16), centralSize = u32(end + 12);
        if (central < 30 + FILE_NAME.length || central + centralSize !== end || centralSize !== 46 + FILE_NAME.length)
            fail();
        if (u32(central) !== 0x02014b50 || u16(central + 6) > 20 || u16(central + 8) !== 0x0800 || u16(central + 10) !== 0 || u16(central + 28) !== FILE_NAME.length || u16(central + 30) || u16(central + 32) || u16(central + 34) || u32(central + 42))
            fail();
        if (u32(0) !== 0x04034b50 || u16(4) > 20 || u16(6) !== 0x0800 || u16(8) !== 0 || u16(26) !== FILE_NAME.length || u16(28))
            fail();
        const start = 30 + FILE_NAME.length, size = u32(22);
        if (size !== u32(18) || size !== u32(central + 20) || size !== u32(central + 24) || start + size !== central || u32(14) !== u32(central + 16))
            fail();
        if (!FILE_NAME.every((byte, i) => bytes[30 + i] === byte && bytes[central + 46 + i] === byte))
            fail();
        const data = bytes.subarray(start, central);
        if (crc32(data) !== u32(14))
            fail();
        return validateBackup(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)));
    }
    ToolboxSettings.readZip = readZip;
})(ToolboxSettings || (ToolboxSettings = {}));
globalThis.ToolboxSettings = ToolboxSettings;
