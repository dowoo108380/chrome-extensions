"use strict";
/** Service-worker domain functions. Chrome API adapters and queues are owned by background.ts.
 * Loaded as a classic worker script before handlers can invoke these functions. */
function isYouTubeVideoPageUrl(rawUrl) {
    try {
        const url = new URL(String(rawUrl || ""));
        const host = url.hostname.toLowerCase();
        if (!(host === "youtube.com" || host.endsWith(".youtube.com")))
            return false;
        if (url.pathname === "/watch")
            return Boolean(url.searchParams.get("v"));
        return /^\/(?:shorts|live|embed)\/[^/?#]+/i.test(url.pathname);
    }
    catch {
        return false;
    }
}
function runYouTubeTranscriptPageTask(tabId, task, signal) {
    const deadline = Date.now() + 45_000;
    return captionOperationQueues.run(tabId, () => {
        signal?.throwIfAborted();
        if (Date.now() >= deadline)
            throw new Error("자막 작업 대기 시간이 초과되었습니다.");
        return performYouTubeTranscriptPageTask(tabId, { ...task, taskId: crypto.randomUUID(), deadline }, signal);
    });
}
async function performYouTubeTranscriptPageTask(tabId, task, signal) {
    const tab = await getTab(tabId);
    if (typeof tab.id !== "number" || !Number.isInteger(tab.id) || !isYouTubeVideoPageUrl(tab.url)) {
        throw new Error("유튜브 영상 또는 Shorts 페이지에서 사용하세요.");
    }
    const pageTask = task && typeof task === "object" ? { ...task } : {};
    // A page cannot supply an existing parser channel via a popup message.
    delete pageTask.captionTextChannelId;
    const needsParser = pageTask.operation === "transcript" || pageTask.operation === "synced-caption-apply";
    const channelId = needsParser ? crypto.randomUUID() : "";
    let target = { tabId: tab.id, frameIds: [0] };
    let parserInstalled = false;
    let operationError = null;
    let pageStarted = false;
    const abortPage = () => {
        if (!pageStarted)
            return;
        void executeScript({ target, world: "MAIN", func: abortYouTubeCaptionTask, args: [pageTask.taskId] })
            .catch(() => { });
    };
    signal?.addEventListener("abort", abortPage, { once: true });
    try {
        signal?.throwIfAborted();
        if (needsParser) {
            const prepared = await executeScript({
                target,
                world: "ISOLATED",
                func: youtubeCaptionTextBridge,
                args: [{ action: "install", channelId }]
            });
            const primary = prepared.find((entry) => entry?.frameId === 0);
            if (primary?.result?.ok !== true || primary.result.installed !== true) {
                throw new Error("자막 텍스트 처리기를 준비하지 못했습니다.");
            }
            parserInstalled = true;
            // Keep parsing, player access and cleanup in the same document across navigations.
            if (typeof primary.documentId === "string" && primary.documentId) {
                target = { tabId: tab.id, documentIds: [primary.documentId] };
            }
            pageTask.captionTextChannelId = channelId;
        }
        signal?.throwIfAborted();
        pageStarted = true;
        const results = await executeScript({
            target,
            world: "MAIN",
            func: youtubeTranscriptPageTask,
            args: [pageTask]
        });
        signal?.throwIfAborted();
        const result = results.find((entry) => entry?.frameId === 0)?.result ?? results[0]?.result;
        if (!result || result.ok !== true) {
            throw new Error(result?.error || "유튜브 자막 정보를 읽지 못했습니다.");
        }
        return result;
    }
    catch (error) {
        operationError = error;
        throw error;
    }
    finally {
        signal?.removeEventListener("abort", abortPage);
        if (parserInstalled) {
            try {
                const disposed = await executeScript({
                    target,
                    world: "ISOLATED",
                    func: youtubeCaptionTextBridge,
                    args: [{ action: "dispose", channelId }]
                });
                if (!disposed.some((entry) => entry?.result?.ok === true && entry.result.installed === false)) {
                    throw new Error("자막 텍스트 처리기의 정리 결과를 확인하지 못했습니다.");
                }
            }
            catch (error) {
                if (!isNavigationGuardTargetUnavailableError(error)) {
                    if (!operationError)
                        throw new Error("자막 처리는 끝났지만 텍스트 처리기를 정리하지 못했습니다. 페이지를 새로 고치세요.");
                    console.warn("Could not dispose caption text parser:", error);
                }
            }
        }
    }
}
async function saveYouTubeTranscriptText(rawText, rawTitle, rawVideoId, options = {}) {
    const text = String(rawText || "");
    if (!text.trim())
        throw new Error("저장할 자막 내용이 없습니다.");
    if (text.length > 8_000_000)
        throw new Error("자막 내용이 너무 커서 텍스트 파일로 저장할 수 없습니다.");
    void rawTitle;
    const videoId = String(rawVideoId || "video")
        .replace(/[^a-zA-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 32) || "video";
    const timestamp = String(options.timestamp || makeTimestamp());
    const combinedCount = Math.max(0, Math.round(Number(options.combinedCount) || 0));
    const filename = options.filename || (combinedCount > 1
        ? `youtube_transcripts/${timestamp}_youtube_transcripts_${combinedCount}_videos.txt`
        : `youtube_transcripts/${timestamp}_youtube_transcript_${videoId}.txt`);
    const dataUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(`\uFEFF${text}`)}`;
    const downloadId = await downloadFile({
        url: dataUrl,
        filename,
        conflictAction: "uniquify",
        saveAs: false
    });
    return { filename, downloadId };
}
async function saveYouTubeTranscriptBatch(rawFiles) {
    const files = Array.isArray(rawFiles) ? rawFiles : [];
    if (files.length === 0)
        throw new Error("저장할 자막 파일이 없습니다.");
    if (files.length > MAX_YOUTUBE_TRANSCRIPT_BATCH_FILES) {
        throw new Error(`한 번에 최대 ${MAX_YOUTUBE_TRANSCRIPT_BATCH_FILES}개의 자막 파일을 저장할 수 있습니다.`);
    }
    const totalLength = files.reduce((sum, file) => sum + String(file?.text || "").length, 0);
    if (totalLength > MAX_YOUTUBE_TRANSCRIPT_BATCH_TOTAL_LENGTH) {
        throw new Error("선택한 자막 전체의 크기가 너무 커서 한 번에 저장할 수 없습니다.");
    }
    const timestamp = makeTimestamp();
    const folder = `youtube_transcripts/batch_${timestamp}`;
    const results = [];
    for (let index = 0; index < files.length; index += 1) {
        const file = files[index] || {};
        const videoId = String(file.videoId || "video")
            .replace(/[^a-zA-Z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "")
            .slice(0, 32) || "video";
        const sequence = String(index + 1).padStart(2, "0");
        const filename = `${folder}/${sequence}_youtube_transcript_${videoId}.txt`;
        results.push(await saveYouTubeTranscriptText(file.text, file.title, videoId, { timestamp, filename }));
    }
    return { folder, results };
}
