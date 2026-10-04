"use strict";
/** Service-worker domain functions. Chrome API adapters and queues are owned by background.ts.
 * Loaded as a classic worker script before handlers can invoke these functions. */
function isCapturableUrl(url) {
    const value = String(url || "");
    return Boolean(value)
        && !/^(?:chrome|chrome-search|chrome-untrusted|edge|about|devtools|chrome-extension):/i.test(value)
        && !/^https:\/\/chromewebstore\.google\.com\//i.test(value);
}
function validateTab(tab) {
    if (typeof tab.id !== "number" || !Number.isInteger(tab.id) || !isCapturableUrl(tab.url)) {
        throw new Error("이 페이지에서는 화면을 캡처할 수 없습니다.");
    }
}
function makeTimestamp() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return [
        now.getFullYear(),
        pad(now.getMonth() + 1),
        pad(now.getDate()),
        "_",
        pad(now.getHours()),
        pad(now.getMinutes()),
        pad(now.getSeconds())
    ].join("");
}
function makeEnglishPageName(url) {
    try {
        return new URL(url).hostname
            .replace(/^www\./i, "")
            .replace(/[^a-zA-Z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "")
            .slice(0, 60) || "page";
    }
    catch {
        return "page";
    }
}
function normalizeRectangle(rectangle, contentSize) {
    const rawX = Number(rectangle?.x);
    const rawY = Number(rectangle?.y);
    const rawWidth = Number(rectangle?.width);
    const rawHeight = Number(rectangle?.height);
    if (![rawX, rawY, rawWidth, rawHeight].every(Number.isFinite)) {
        throw new Error("선택 영역 좌표가 올바르지 않습니다.");
    }
    const contentWidth = Math.max(1, Math.ceil(Number(contentSize?.width) || 0));
    const contentHeight = Math.max(1, Math.ceil(Number(contentSize?.height) || 0));
    const left = Math.max(0, Math.min(rawX, contentWidth));
    const top = Math.max(0, Math.min(rawY, contentHeight));
    const right = Math.max(left, Math.min(rawX + rawWidth, contentWidth));
    const bottom = Math.max(top, Math.min(rawY + rawHeight, contentHeight));
    const width = right - left;
    const height = bottom - top;
    if (width < 2 || height < 2) {
        throw new Error("선택 영역이 너무 작습니다.");
    }
    validateCaptureSize(width, height);
    return { x: left, y: top, width, height };
}
function validateCaptureSize(width, height) {
    // A project resource budget, not a promise about every GPU's texture limits.
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 ||
        width > 32767 || height > 32767 || width * height > 64 * 1024 * 1024) {
        throw new Error("캡처 영역이 너무 큽니다. 한 변 32,767 CSS 픽셀, 전체 64 Mi 픽셀 이하의 영역을 선택하세요.");
    }
}
async function saveScreenshot(data, folder, tabUrl) {
    if (!data) {
        throw new Error("Chrome에서 이미지 데이터를 받지 못했습니다.");
    }
    const pageName = makeEnglishPageName(tabUrl);
    const filename = `${folder}/${makeTimestamp()}_${pageName}.png`;
    const downloadId = await downloadFile({
        url: `data:image/png;base64,${data}`,
        filename,
        conflictAction: "uniquify",
        saveAs: false
    });
    return { filename, downloadId };
}
function captureDocumentChanged() {
    return new Error("캡처 도중 페이지가 변경되었습니다. 현재 페이지에서 다시 캡처하세요.");
}
function captureDocumentUrl(value) {
    const url = new URL(value);
    url.hash = "";
    return url.href;
}
// Observe reloads even while another debugger operation owns this tab's queue.
// The frame checks below also cover navigations whose tab event arrives later.
function watchCaptureNavigation(tab) {
    let changed = Boolean(tab.pendingUrl && captureDocumentUrl(tab.pendingUrl) !== captureDocumentUrl(tab.url));
    const onUpdated = (tabId, change) => {
        if (tabId === tab.id && (change.status === "loading" ||
            (change.url && captureDocumentUrl(change.url) !== captureDocumentUrl(tab.url))))
            changed = true;
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    return {
        assertCurrent() { if (changed)
            throw captureDocumentChanged(); },
        dispose() { chrome.tabs.onUpdated.removeListener(onUpdated); }
    };
}
async function verifyCaptureFrame(target, url, expected) {
    const result = await sendCommand(target, "Page.getFrameTree");
    const frame = result?.frameTree?.frame;
    if (typeof frame?.id !== "string" || !frame.id || typeof frame?.loaderId !== "string" || !frame.loaderId ||
        typeof frame?.url !== "string" || captureDocumentUrl(frame.url) !== captureDocumentUrl(url) ||
        (expected && (frame.id !== expected.id || frame.loaderId !== expected.loaderId)))
        throw captureDocumentChanged();
    return { id: frame.id, loaderId: frame.loaderId };
}
async function verifySelectionDocument(tabId, documentId) {
    // Read the current main document, not an old selection retained in history.
    const results = await executeScript({ target: { tabId, frameIds: [0] }, func: () => true });
    if (!results.some(result => result.frameId === 0 && result.documentId === documentId && result.result === true)) {
        throw captureDocumentChanged();
    }
}
async function releaseCaptureDebugger(tabId, downloadStarted, captureError) {
    if (await shouldKeepDebuggerAttachedAfterTemporaryOperation(tabId))
        return;
    try {
        await detachExtensionDebugger(tabId);
    }
    catch (error) {
        const resultMessage = downloadStarted
            ? "이미지 다운로드는 시작했습니다. "
            : captureError ? `${makeUserMessage(captureError, "화면 캡처에 실패했습니다.")} ` : "";
        throw new Error(`${resultMessage}캡처 후 디버거 연결을 해제하지 못했습니다. 탭에 디버거 연결이 남아 있을 수 있습니다.`, { cause: error });
    }
}
async function captureFullPage(tabId) {
    const tab = await getTab(tabId);
    validateTab(tab);
    if (capturingTabs.has(tab.id)) {
        throw new Error("이 탭에서 이미 화면을 캡처하고 있습니다.");
    }
    const navigation = watchCaptureNavigation(tab);
    capturingTabs.add(tab.id);
    try {
        const result = await queueTabDebuggerOperation(tab.id, async () => {
            const target = { tabId: tab.id };
            let debuggerReady = false;
            let downloadStarted = false;
            let captureError;
            try {
                navigation.assertCurrent();
                await setBadge(tab.id, "...", "#2563eb");
                await ensureExtensionDebuggerAttached(tab.id);
                debuggerReady = true;
                await sendCommand(target, "Page.enable");
                const frame = await verifyCaptureFrame(target, tab.url);
                const metrics = await sendCommand(target, "Page.getLayoutMetrics");
                const contentSize = metrics.cssContentSize || metrics.contentSize;
                const width = Math.ceil(Number(contentSize?.width));
                const height = Math.ceil(Number(contentSize?.height));
                if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
                    throw new Error("페이지 전체 크기를 확인할 수 없습니다.");
                }
                validateCaptureSize(width, height);
                await verifyCaptureFrame(target, tab.url, frame);
                navigation.assertCurrent();
                const screenshot = await sendCommand(target, "Page.captureScreenshot", {
                    format: "png",
                    fromSurface: true,
                    captureBeyondViewport: true,
                    clip: {
                        x: 0,
                        y: 0,
                        width,
                        height,
                        scale: 1
                    }
                });
                await verifyCaptureFrame(target, tab.url, frame);
                navigation.assertCurrent();
                const saved = await saveScreenshot(screenshot.data, "full_page_screenshots", tab.url);
                downloadStarted = true;
                return { ...saved, width, height };
            }
            catch (error) {
                captureError = error;
                throw error;
            }
            finally {
                if (debuggerReady) {
                    await releaseCaptureDebugger(tab.id, downloadStarted, captureError);
                }
            }
        });
        await setBadge(tab.id, "OK", "#15803d", BADGE_CLEAR_DELAY_MS);
        return result;
    }
    finally {
        navigation.dispose();
        capturingTabs.delete(tab.id);
    }
}
async function captureSelection(tab, rectangle, documentId) {
    validateTab(tab);
    if (capturingTabs.has(tab.id)) {
        throw new Error("이 탭에서 이미 화면을 캡처하고 있습니다.");
    }
    const navigation = watchCaptureNavigation(tab);
    capturingTabs.add(tab.id);
    try {
        const result = await queueTabDebuggerOperation(tab.id, async () => {
            const target = { tabId: tab.id };
            let debuggerReady = false;
            let downloadStarted = false;
            let captureError;
            try {
                navigation.assertCurrent();
                await verifySelectionDocument(tab.id, documentId);
                await setBadge(tab.id, "...", "#2563eb");
                await ensureExtensionDebuggerAttached(tab.id);
                debuggerReady = true;
                await sendCommand(target, "Page.enable");
                const frame = await verifyCaptureFrame(target, tab.url);
                const metrics = await sendCommand(target, "Page.getLayoutMetrics");
                const contentSize = metrics.cssContentSize || metrics.contentSize;
                const clip = normalizeRectangle(rectangle, contentSize);
                await verifyCaptureFrame(target, tab.url, frame);
                navigation.assertCurrent();
                const screenshot = await sendCommand(target, "Page.captureScreenshot", {
                    format: "png",
                    fromSurface: true,
                    captureBeyondViewport: true,
                    clip: {
                        x: clip.x,
                        y: clip.y,
                        width: clip.width,
                        height: clip.height,
                        scale: 1
                    }
                });
                await verifySelectionDocument(tab.id, documentId);
                await verifyCaptureFrame(target, tab.url, frame);
                navigation.assertCurrent();
                const saved = await saveScreenshot(screenshot.data, "selected_area_screenshots", tab.url);
                downloadStarted = true;
                return { ok: true, ...saved, clip };
            }
            catch (error) {
                captureError = error;
                throw error;
            }
            finally {
                if (debuggerReady) {
                    await releaseCaptureDebugger(tab.id, downloadStarted, captureError);
                }
            }
        });
        await setBadge(tab.id, "OK", "#15803d", BADGE_CLEAR_DELAY_MS);
        return result;
    }
    finally {
        navigation.dispose();
        capturingTabs.delete(tab.id);
    }
}
async function startAreaSelection(tabId) {
    const tab = await getTab(tabId);
    validateTab(tab);
    await executeScript({
        target: { tabId: tab.id },
        files: ["dist/selector.js"]
    });
    return { tabId: tab.id };
}
