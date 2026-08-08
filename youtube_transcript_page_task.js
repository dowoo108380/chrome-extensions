"use strict";

async function youtubeTranscriptPageTask(rawTask) {
  "use strict";

  const task = rawTask && typeof rawTask === "object" ? rawTask : {};
  const CAPTION_REQUEST_TIMEOUT_MS = 12000;
  const PANEL_REQUEST_TIMEOUT_MS = 10000;

  function textFromRuns(value) {
    if (!value) return "";
    if (typeof value.simpleText === "string") return value.simpleText.trim();
    if (Array.isArray(value.runs)) {
      return value.runs.map((run) => String(run?.text || "")).join("").trim();
    }
    if (typeof value.content === "string") return value.content.trim();
    return "";
  }

  function normalizeVisibleText(value) {
    return String(value || "")
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
      .replace(/\u00A0/g, " ")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeLanguageCode(value) {
    const code = String(value || "").trim();
    return /^[A-Za-z0-9]{2,8}(?:-[A-Za-z0-9]{1,8}){0,3}$/.test(code) ? code : "";
  }

  function parseMaybeJson(value) {
    if (!value) return null;
    if (typeof value === "object") return value;
    if (typeof value !== "string") return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function getUrlVideoId() {
    try {
      const url = new URL(location.href);
      const host = url.hostname.toLowerCase();
      if (!(host === "youtube.com" || host.endsWith(".youtube.com"))) return "";

      if (url.pathname === "/watch") {
        return String(url.searchParams.get("v") || "").trim();
      }

      const match = url.pathname.match(/^\/(?:shorts|live|embed)\/([^/?#]+)/i);
      return match ? decodeURIComponent(match[1]).trim() : "";
    } catch {
      return "";
    }
  }

  function isYoutubePage() {
    try {
      const host = new URL(location.href).hostname.toLowerCase();
      return host === "youtube.com" || host.endsWith(".youtube.com");
    } catch {
      return false;
    }
  }

  function getElementArea(element) {
    if (!(element instanceof Element)) return 0;
    const rect = element.getBoundingClientRect();
    const visibleWidth = Math.max(0, Math.min(innerWidth, rect.right) - Math.max(0, rect.left));
    const visibleHeight = Math.max(0, Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top));
    return visibleWidth * visibleHeight;
  }

  function scoreVideo(video) {
    if (!(video instanceof HTMLVideoElement)) return -1;
    let score = getElementArea(video);
    if (!video.paused && !video.ended) score += 1_000_000_000;
    if (video.closest("ytd-reel-video-renderer[is-active], ytd-reel-video-renderer[active]")) {
      score += 700_000_000;
    }
    if (video.readyState >= 2) score += 10_000_000;
    return score;
  }

  function safePlayerResponse(player) {
    if (!player) return null;
    try {
      if (typeof player.getPlayerResponse === "function") {
        const response = parseMaybeJson(player.getPlayerResponse());
        if (response) return response;
      }
    } catch {
      // Continue with other sources.
    }
    return null;
  }

  function safeVideoData(player) {
    if (!player || typeof player.getVideoData !== "function") return null;
    try {
      const data = player.getVideoData();
      return data && typeof data === "object" ? data : null;
    } catch {
      return null;
    }
  }

  function safePlayerOption(player, moduleName, optionName) {
    if (!player || typeof player.getOption !== "function") return null;
    try {
      return player.getOption(moduleName, optionName);
    } catch {
      return null;
    }
  }

  function getResponseVideoId(response) {
    return String(
      response?.videoDetails?.videoId ||
      response?.currentVideoEndpoint?.watchEndpoint?.videoId ||
      ""
    ).trim();
  }

  function hasCaptionRenderer(response) {
    return Boolean(response?.captions?.playerCaptionsTracklistRenderer);
  }

  function collectPlayerResponses() {
    const candidates = [];
    const seenPlayers = new Set();
    const videos = Array.from(document.querySelectorAll("video"))
      .sort((first, second) => scoreVideo(second) - scoreVideo(first));

    function addPlayer(player, score, source, video = null) {
      if (!player || seenPlayers.has(player)) return;
      seenPlayers.add(player);
      const response = safePlayerResponse(player);
      if (!response) return;
      const data = safeVideoData(player);
      candidates.push({
        response,
        videoId: getResponseVideoId(response) || String(data?.video_id || data?.videoId || "").trim(),
        score: Number(score) || 0,
        source,
        player,
        video: video || player.querySelector?.("video") || null
      });
    }

    for (const video of videos) {
      addPlayer(video.closest(".html5-video-player"), scoreVideo(video), "visible-player", video);
    }

    for (const player of document.querySelectorAll(".html5-video-player")) {
      addPlayer(player, getElementArea(player), "player", player.querySelector?.("video") || null);
    }

    function safeYtcfgGet(key) {
      try {
        return typeof globalThis.ytcfg?.get === "function" ? globalThis.ytcfg.get(key) : null;
      } catch {
        return null;
      }
    }

    const globals = [
      globalThis.ytInitialPlayerResponse,
      globalThis.ytplayer?.config?.args?.player_response,
      safeYtcfgGet("PLAYER_RESPONSE"),
      safeYtcfgGet("PLAYER_CONFIG")?.args?.player_response
    ];

    for (const value of globals) {
      const response = parseMaybeJson(value);
      if (!response) continue;
      candidates.push({
        response,
        videoId: getResponseVideoId(response),
        score: -1,
        source: "page-data",
        player: null,
        video: null
      });
    }

    return candidates;
  }

  function choosePlayerResponse() {
    const urlVideoId = getUrlVideoId();
    const candidates = collectPlayerResponses()
      .filter((candidate) => candidate.response && typeof candidate.response === "object")
      .sort((first, second) => second.score - first.score);

    if (urlVideoId) {
      const exact = candidates.find((candidate) => candidate.videoId === urlVideoId && hasCaptionRenderer(candidate.response));
      if (exact) return exact;

      const exactWithoutCaptions = candidates.find((candidate) => candidate.videoId === urlVideoId);
      if (exactWithoutCaptions) return exactWithoutCaptions;
    }

    const visibleWithCaptions = candidates.find((candidate) => hasCaptionRenderer(candidate.response));
    if (visibleWithCaptions) return visibleWithCaptions;

    return candidates[0] || null;
  }

  function isAutoGeneratedTrack(track) {
    const kind = String(track?.kind || "").toLowerCase();
    const vssId = String(track?.vssId || "").toLowerCase();
    return kind === "asr" || vssId.startsWith("a.") || vssId.includes(".asr");
  }

  function makeTrackLabel(track, index) {
    const languageCode = normalizeLanguageCode(track?.languageCode) || "und";
    const name = textFromRuns(track?.name) || languageCode || `자막 ${index + 1}`;
    const automatic = isAutoGeneratedTrack(track);
    const alreadyMentionsAutomatic = /auto|automatic|자동|自動|自动|automatisch|automatique|automático|автомат/i.test(name);
    return automatic && !alreadyMentionsAutomatic ? `${name} · 자동 생성` : name;
  }

  function buildCaptionInfo(candidate) {
    const response = candidate?.response || {};
    const renderer = response?.captions?.playerCaptionsTracklistRenderer;
    const rawTracks = Array.isArray(renderer?.captionTracks) ? renderer.captionTracks : [];
    const rawLanguages = Array.isArray(renderer?.translationLanguages) ? renderer.translationLanguages : [];
    const videoId = getResponseVideoId(response) || candidate?.videoId || getUrlVideoId();
    const title = normalizeVisibleText(response?.videoDetails?.title) ||
      normalizeVisibleText(document.title.replace(/\s*-\s*YouTube\s*$/i, "")) ||
      "YouTube 영상";

    const tracks = rawTracks.map((track, index) => ({
      index,
      id: String(track?.vssId || `${track?.languageCode || "und"}:${index}`),
      languageCode: normalizeLanguageCode(track?.languageCode) || "und",
      name: textFromRuns(track?.name) || normalizeLanguageCode(track?.languageCode) || `자막 ${index + 1}`,
      label: makeTrackLabel(track, index),
      isAutoGenerated: isAutoGeneratedTrack(track),
      isTranslatable: track?.isTranslatable !== false,
      isDefault: track?.isDefault === true,
      kind: String(track?.kind || "")
    }));

    const translationLanguages = [];
    const seenLanguages = new Set();
    for (const language of rawLanguages) {
      const languageCode = normalizeLanguageCode(language?.languageCode);
      if (!languageCode || seenLanguages.has(languageCode)) continue;
      seenLanguages.add(languageCode);
      translationLanguages.push({
        languageCode,
        name: textFromRuns(language?.languageName) || languageCode
      });
    }

    return {
      response,
      renderer,
      rawTracks,
      videoId,
      title,
      tracks,
      translationLanguages,
      pageUrl: location.href
    };
  }

  function normalizeCaptionEntry(entry) {
    const startMs = Math.max(0, Math.round(Number(entry?.startMs) || 0));
    const durationMs = Math.max(0, Math.round(Number(entry?.durationMs) || 0));
    const text = normalizeVisibleText(entry?.text);
    return text ? { startMs, durationMs, text } : null;
  }

  function finalizeEntries(rawEntries) {
    const entries = [];
    for (const rawEntry of rawEntries || []) {
      const entry = normalizeCaptionEntry(rawEntry);
      if (!entry) continue;

      const previous = entries[entries.length - 1];
      if (
        previous &&
        previous.text === entry.text &&
        Math.abs(previous.startMs - entry.startMs) <= 250
      ) {
        previous.durationMs = Math.max(previous.durationMs, entry.durationMs);
        continue;
      }

      entries.push(entry);
    }
    return entries;
  }

  function decodeHtmlText(value) {
    const parser = new DOMParser();
    const documentObject = parser.parseFromString(`<body>${String(value || "")}</body>`, "text/html");
    return documentObject.body?.textContent || "";
  }

  function parseJson3(text) {
    const payload = JSON.parse(text);
    const events = Array.isArray(payload?.events) ? payload.events : [];
    const entries = [];

    for (const event of events) {
      if (!Array.isArray(event?.segs)) continue;
      const captionText = decodeHtmlText(
        event.segs.map((segment) => String(segment?.utf8 || "")).join("")
      );
      entries.push({
        startMs: Number(event?.tStartMs) || 0,
        durationMs: Number(event?.dDurationMs) || 0,
        text: captionText
      });
    }

    return finalizeEntries(entries);
  }

  function parseXml(text) {
    const documentObject = new DOMParser().parseFromString(text, "text/xml");
    if (documentObject.querySelector("parsererror")) return [];

    const entries = [];
    const oldNodes = Array.from(documentObject.querySelectorAll("transcript > text, text[start]"));
    if (oldNodes.length > 0) {
      for (const node of oldNodes) {
        entries.push({
          startMs: Math.round((Number(node.getAttribute("start")) || 0) * 1000),
          durationMs: Math.round((Number(node.getAttribute("dur")) || 0) * 1000),
          text: node.textContent || ""
        });
      }
      return finalizeEntries(entries);
    }

    for (const node of documentObject.querySelectorAll("p")) {
      entries.push({
        startMs: Number(node.getAttribute("t")) || 0,
        durationMs: Number(node.getAttribute("d")) || 0,
        text: node.textContent || ""
      });
    }
    return finalizeEntries(entries);
  }

  function parseVttTime(value) {
    const parts = String(value || "").trim().split(":").map(Number);
    if (parts.some((part) => !Number.isFinite(part))) return 0;
    if (parts.length === 3) return Math.round(((parts[0] * 3600) + (parts[1] * 60) + parts[2]) * 1000);
    if (parts.length === 2) return Math.round(((parts[0] * 60) + parts[1]) * 1000);
    return 0;
  }

  function parseVtt(text) {
    const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/);
    const entries = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index].trim();
      if (!line || line === "WEBVTT" || /^(?:NOTE|STYLE|REGION)(?:\s|$)/.test(line)) {
        index += 1;
        continue;
      }

      let timingLine = line;
      if (!timingLine.includes("-->")) {
        index += 1;
        timingLine = String(lines[index] || "").trim();
      }
      if (!timingLine.includes("-->")) {
        index += 1;
        continue;
      }

      const timingMatch = timingLine.match(/^([^\s]+)\s+-->\s+([^\s]+)/);
      index += 1;
      const cueLines = [];
      while (index < lines.length && lines[index].trim() !== "") {
        cueLines.push(lines[index]);
        index += 1;
      }

      if (!timingMatch) continue;
      const startMs = parseVttTime(timingMatch[1]);
      const endMs = parseVttTime(timingMatch[2]);
      const cueText = decodeHtmlText(
        cueLines.join(" ")
          .replace(/<\/?(?:c|v|lang)(?:\.[^ >]+|\s+[^>]*)?>/gi, "")
          .replace(/<\d{2}:\d{2}(?::\d{2})?\.\d{3}>/g, "")
      );
      entries.push({ startMs, durationMs: Math.max(0, endMs - startMs), text: cueText });
    }

    return finalizeEntries(entries);
  }

  function readRichText(value) {
    if (!value) return "";
    if (typeof value === "string") return value;
    if (typeof value.simpleText === "string") return value.simpleText;
    if (typeof value.content === "string") return value.content;
    if (Array.isArray(value.runs)) return value.runs.map((run) => String(run?.text || "")).join("");
    if (value.elementsAttributedString?.content) return String(value.elementsAttributedString.content);
    return "";
  }

  function parseTimestampLabelToMs(value) {
    const label = normalizeVisibleText(readRichText(value) || value);
    if (!label) return null;
    const parts = label.split(":").map((part) => Number(part));
    if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isFinite(part))) return null;
    let seconds = 0;
    for (const part of parts) seconds = (seconds * 60) + part;
    return Math.max(0, Math.round(seconds * 1000));
  }

  function parseTranscriptRendererNode(rawNode, inheritedStartMs = null) {
    const node = rawNode?.transcriptSegmentRenderer || rawNode?.transcriptCueRenderer || rawNode;
    if (!node || node.transcriptSectionHeaderRenderer) return null;

    let startMs = Number(node.startMs);
    if (!Number.isFinite(startMs)) startMs = Number(node.startTimeMs);
    if (!Number.isFinite(startMs)) startMs = parseTimestampLabelToMs(node.startTimeText);
    if (!Number.isFinite(startMs)) startMs = parseTimestampLabelToMs(node.startOffsetText);
    if (!Number.isFinite(startMs)) startMs = Number(inheritedStartMs);
    if (!Number.isFinite(startMs)) return null;

    let durationMs = Number(node.durationMs);
    if (!Number.isFinite(durationMs)) {
      const endMs = Number(node.endMs);
      durationMs = Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : 0;
    }

    const text = normalizeVisibleText(
      readRichText(node.snippet) ||
      readRichText(node.cue) ||
      readRichText(node.text) ||
      readRichText(node)
    );
    return text ? { startMs, durationMs, text } : null;
  }

  function parseActualTranscriptResponse(payload) {
    const rawEntries = [];
    const seen = new WeakSet();

    function visit(node, depth = 0) {
      if (!node || typeof node !== "object" || depth > 24 || seen.has(node)) return;
      seen.add(node);

      if (node.transcriptSegmentRenderer) {
        const parsed = parseTranscriptRendererNode(node.transcriptSegmentRenderer);
        if (parsed) rawEntries.push(parsed);
      }
      if (node.transcriptCueRenderer) {
        const parsed = parseTranscriptRendererNode(node.transcriptCueRenderer);
        if (parsed) rawEntries.push(parsed);
      }
      if (node.transcriptCueGroupRenderer) {
        const group = node.transcriptCueGroupRenderer;
        const groupStart = parseTimestampLabelToMs(group.formattedStartOffset) ?? Number(group.startMs);
        for (const cue of Array.isArray(group.cues) ? group.cues : []) {
          const parsed = parseTranscriptRendererNode(cue?.transcriptCueRenderer || cue, groupStart);
          if (parsed) rawEntries.push(parsed);
        }
      }

      if (Array.isArray(node)) {
        for (const item of node) visit(item, depth + 1);
        return;
      }
      for (const value of Object.values(node)) {
        if (value && typeof value === "object") visit(value, depth + 1);
      }
    }

    visit(payload);
    const entries = finalizeEntries(rawEntries).sort((first, second) => first.startMs - second.startMs);
    for (let index = 0; index < entries.length; index += 1) {
      if (entries[index].durationMs > 0) continue;
      const next = entries[index + 1];
      if (next && next.startMs > entries[index].startMs) {
        entries[index].durationMs = next.startMs - entries[index].startMs;
      }
    }
    return entries;
  }

  function parseCaptionPayload(text, sourceUrl = "", contentType = "") {
    const normalized = String(text || "").trim().replace(/^\)\]\}'\s*\n?/, "");
    if (!normalized) return [];

    if (normalized.startsWith("WEBVTT") || /(?:^|\n)\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}\s+-->/.test(normalized)) {
      const entries = parseVtt(normalized.replace(/,(\d{3})(?=\s+-->)/g, ".$1"));
      if (entries.length > 0) return entries;
    }

    try {
      const payload = JSON.parse(normalized);
      const json3Entries = parseJson3(normalized);
      if (json3Entries.length > 0) return json3Entries;
      const transcriptEntries = parseActualTranscriptResponse(payload);
      if (transcriptEntries.length > 0) return transcriptEntries;
    } catch {
      // Continue with XML.
    }

    if (/xml|html/i.test(contentType) || normalized.startsWith("<")) {
      const entries = parseXml(normalized);
      if (entries.length > 0) return entries;
    }

    void sourceUrl;
    return [];
  }

  function isTimedTextUrl(rawUrl) {
    return /\/api\/timedtext(?:[?#]|$)|\/timedtext(?:[?#]|$)/i.test(String(rawUrl || ""));
  }

  function isTranscriptApiUrl(rawUrl) {
    return /\/youtubei\/v1\/get_transcript(?:[?#]|$)/i.test(String(rawUrl || ""));
  }

  function getUrlParameter(rawUrl, name) {
    try {
      return new URL(String(rawUrl || ""), location.href).searchParams.get(name) || "";
    } catch {
      return "";
    }
  }

  function captionUrlScore(rawUrl, videoId, rawTrack, translationLanguageCode) {
    const url = String(rawUrl || "");
    if (!isTimedTextUrl(url) && !isTranscriptApiUrl(url)) return -Infinity;
    let score = isTimedTextUrl(url) ? 20 : 5;

    const requestVideoId = getUrlParameter(url, "v");
    if (requestVideoId) score += requestVideoId === videoId ? 30 : -80;

    const trackLanguage = normalizeLanguageCode(rawTrack?.languageCode).toLowerCase();
    const requestLanguage = normalizeLanguageCode(getUrlParameter(url, "lang")).toLowerCase();
    if (requestLanguage) score += requestLanguage === trackLanguage ? 20 : -15;

    const requestedTranslation = normalizeLanguageCode(translationLanguageCode).toLowerCase();
    const requestTranslation = normalizeLanguageCode(getUrlParameter(url, "tlang")).toLowerCase();
    if (requestedTranslation) {
      score += requestTranslation === requestedTranslation ? 30 : (requestTranslation ? -30 : -5);
    } else if (requestTranslation) {
      score -= 25;
    }

    const requestKind = String(getUrlParameter(url, "kind") || "").toLowerCase();
    if (requestKind) {
      score += isAutoGeneratedTrack(rawTrack) === (requestKind === "asr") ? 8 : -8;
    }

    if (getUrlParameter(url, "pot")) score += 15;
    if (getUrlParameter(url, "fmt") === "json3") score += 5;
    return score;
  }

  function requiresPlayerIssuedToken(rawUrl) {
    try {
      const url = new URL(String(rawUrl || ""), location.href);
      return url.searchParams.get("exp") === "xpe" && !url.searchParams.has("pot");
    } catch {
      return /(?:[?&])exp=xpe(?:&|$)/i.test(String(rawUrl || "")) && !/(?:[?&])pot=/.test(String(rawUrl || ""));
    }
  }

  function buildCaptionRequestUrls(baseUrl, translationLanguageCode, exactOnly = false) {
    const normalizedTranslationCode = normalizeLanguageCode(translationLanguageCode);
    const output = [];
    const seen = new Set();

    function add(url) {
      const value = String(url || "").trim();
      if (!value || seen.has(value)) return;
      seen.add(value);
      output.push(value);
    }

    try {
      const original = new URL(baseUrl, location.href);
      if (exactOnly) {
        // A player-issued request can contain signatures and playback proof.
        // Use it byte-for-byte instead of rebuilding query parameters.
        add(original.toString());
        return output;
      }

      if (normalizedTranslationCode) original.searchParams.set("tlang", normalizedTranslationCode);
      else original.searchParams.delete("tlang");
      add(original.toString());
      for (const format of ["json3", "srv3", "vtt"]) {
        const next = new URL(original.toString());
        next.searchParams.set("fmt", format);
        add(next.toString());
      }
    } catch {
      add(baseUrl);
    }

    return output;
  }

  async function fetchCaptionUrl(rawUrl, translationLanguageCode, exactOnly = false) {
    let lastStatus = 0;
    for (const url of buildCaptionRequestUrls(rawUrl, translationLanguageCode, exactOnly)) {
      try {
        const response = await fetch(url, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          redirect: "follow",
          referrer: location.href,
          referrerPolicy: "strict-origin-when-cross-origin"
        });
        lastStatus = response.status;
        if (!response.ok) continue;
        const contentType = response.headers.get("content-type") || "";
        const text = await response.text();
        if (!text.trim()) continue;
        const entries = parseCaptionPayload(text, response.url || url, contentType);
        if (entries.length > 0) {
          const format = getUrlParameter(response.url || url, "fmt") ||
            (contentType.includes("json") ? "json3" : contentType.includes("vtt") ? "vtt" : "captions");
          return { entries, format: `timedtext-${format}`, url: response.url || url };
        }
      } catch {
        // Try the next URL supplied by the player.
      }
    }
    return { entries: [], status: lastStatus };
  }

  async function fetchCaptionEntries(baseUrl, translationLanguageCode) {
    if (!baseUrl) return null;
    const result = await fetchCaptionUrl(baseUrl, translationLanguageCode, false);
    return result.entries.length > 0 ? result : null;
  }

  function collectUrlsFromObject(value, output, seen = new WeakSet(), depth = 0) {
    if (value == null || depth > 12) return;
    if (typeof value === "string") {
      if (isTimedTextUrl(value) || isTranscriptApiUrl(value)) output.add(value);
      return;
    }
    if (typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) collectUrlsFromObject(item, output, seen, depth + 1);
      return;
    }
    for (const item of Object.values(value)) collectUrlsFromObject(item, output, seen, depth + 1);
  }

  function createActualYouTubeRequestCapture(info, rawTrack, translationLanguageCode) {
    const records = [];
    const urlSet = new Set();
    const addUrl = (url) => {
      const value = String(url || "");
      if (isTimedTextUrl(value) || isTranscriptApiUrl(value)) urlSet.add(value);
    };
    const addBody = (url, text, contentType = "") => {
      const value = String(text || "");
      addUrl(url);
      if (!value.trim()) return;
      records.push({ url: String(url || ""), text: value, contentType: String(contentType || "") });
    };

    try {
      for (const entry of performance.getEntriesByType("resource")) addUrl(entry?.name);
    } catch {
      // Resource timing is optional.
    }

    let observer = null;
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) addUrl(entry?.name);
      });
      observer.observe({ type: "resource", buffered: true });
    } catch {
      observer = null;
    }

    const originalFetch = globalThis.fetch;
    let wrappedFetch = null;
    if (typeof originalFetch === "function") {
      wrappedFetch = async function (...args) {
        const response = await originalFetch.apply(this, args);
        try {
          const requestedUrl = typeof args[0] === "string" ? args[0] : String(args[0]?.url || "");
          const responseUrl = String(response?.url || requestedUrl);
          if (isTimedTextUrl(responseUrl) || isTranscriptApiUrl(responseUrl)) {
            addUrl(responseUrl);
            response.clone().text().then((text) => {
              addBody(responseUrl, text, response.headers?.get?.("content-type") || "");
            }).catch(() => {});
          }
        } catch {
          // Monitoring must never interfere with the page request.
        }
        return response;
      };
      globalThis.fetch = wrappedFetch;
    }

    const xhrPrototype = globalThis.XMLHttpRequest?.prototype;
    const originalOpen = xhrPrototype?.open;
    const originalSend = xhrPrototype?.send;
    const xhrUrls = new WeakMap();
    let wrappedOpen = null;
    let wrappedSend = null;
    if (xhrPrototype && originalOpen && originalSend) {
      wrappedOpen = function (method, url, ...rest) {
        const requestUrl = String(url || "");
        xhrUrls.set(this, requestUrl);
        addUrl(requestUrl);
        return originalOpen.call(this, method, url, ...rest);
      };
      wrappedSend = function (...args) {
        const requestUrl = String(xhrUrls.get(this) || "");
        if (!isTimedTextUrl(requestUrl) && !isTranscriptApiUrl(requestUrl)) {
          return originalSend.apply(this, args);
        }

        this.addEventListener("load", function () {
          const url = String(xhrUrls.get(this) || this.responseURL || "");
          try {
            let body = "";
            if (typeof this.responseText === "string") body = this.responseText;
            else if (typeof this.response === "string") body = this.response;
            else if (this.response && typeof this.response === "object") body = JSON.stringify(this.response);
            addBody(this.responseURL || url, body, this.getResponseHeader?.("content-type") || "");
          } catch {
            // Some responseType values do not expose responseText.
          }
        }, { once: true });
        return originalSend.apply(this, args);
      };
      xhrPrototype.open = wrappedOpen;
      xhrPrototype.send = wrappedSend;
    }

    return {
      addUrlsFrom(value) {
        collectUrlsFromObject(value, urlSet);
      },
      getParsedResult() {
        const ordered = records
          .map((record) => ({
            ...record,
            score: captionUrlScore(record.url, info.videoId, rawTrack, translationLanguageCode)
          }))
          .sort((first, second) => second.score - first.score);
        for (const record of ordered) {
          const entries = parseCaptionPayload(record.text, record.url, record.contentType);
          if (entries.length > 0) {
            return {
              entries,
              format: isTranscriptApiUrl(record.url) ? "youtube-player-transcript-response" : "youtube-player-timedtext-response",
              url: record.url
            };
          }
        }
        return null;
      },
      getUrls() {
        return [...urlSet]
          .map((url) => ({ url, score: captionUrlScore(url, info.videoId, rawTrack, translationLanguageCode) }))
          .filter((item) => Number.isFinite(item.score) && item.score > -50)
          .sort((first, second) => second.score - first.score)
          .map((item) => item.url);
      },
      cleanup() {
        try { observer?.disconnect(); } catch { /* Ignore. */ }
        if (wrappedFetch && globalThis.fetch === wrappedFetch) globalThis.fetch = originalFetch;
        if (xhrPrototype?.open === wrappedOpen) xhrPrototype.open = originalOpen;
        if (xhrPrototype?.send === wrappedSend) xhrPrototype.send = originalSend;
      }
    };
  }

  function findPlayerForVideoId(videoId) {
    for (const player of document.querySelectorAll(".html5-video-player")) {
      const data = safeVideoData(player);
      const response = safePlayerResponse(player);
      const id = String(data?.video_id || data?.videoId || getResponseVideoId(response) || "").trim();
      if (!videoId || id === videoId) return player;
    }
    return null;
  }

  function findVideoForPlayer(player, candidate) {
    return candidate?.video || player?.querySelector?.("video") || document.querySelector("video");
  }

  function getCaptionButton(player) {
    return player?.querySelector?.(".ytp-subtitles-button, .ytp-caption-button") || null;
  }

  function clonePlayerOptionValue(value) {
    if (value == null || typeof value !== "object") return value;
    try {
      if (typeof structuredClone === "function") return structuredClone(value);
    } catch {
      // Some YouTube player objects contain non-cloneable values.
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      try { return Array.isArray(value) ? [...value] : { ...value }; } catch { return value; }
    }
  }

  function readPlayerOptionSnapshot(player, moduleName, optionName) {
    if (!player || typeof player.getOption !== "function") {
      return { available: false, value: null };
    }
    try {
      return { available: true, value: clonePlayerOptionValue(player.getOption(moduleName, optionName)) };
    } catch {
      return { available: false, value: null };
    }
  }

  function readCaptionsModuleLoaded(player) {
    if (!player || typeof player.isModuleLoaded !== "function") return null;
    try {
      return player.isModuleLoaded("captions") === true;
    } catch {
      return null;
    }
  }

  function captureTextTrackModes(video) {
    if (!(video instanceof HTMLMediaElement) || !video.textTracks) return [];
    try {
      return Array.from(video.textTracks).map((track) => ({ track, mode: track.mode }));
    } catch {
      return [];
    }
  }

  function restoreTextTrackModes(video, snapshots) {
    const originalTracks = new Set();
    for (const snapshot of snapshots || []) {
      if (!snapshot?.track) continue;
      originalTracks.add(snapshot.track);
      try {
        if (snapshot.track.mode !== snapshot.mode) snapshot.track.mode = snapshot.mode;
      } catch {
        // Some browser-managed tracks reject mode changes while the source is changing.
      }
    }

    if (!(video instanceof HTMLMediaElement) || !video.textTracks) return;
    try {
      for (const track of Array.from(video.textTracks)) {
        if (originalTracks.has(track)) continue;
        try {
          if (track.mode !== "disabled") track.mode = "disabled";
        } catch {
          // Newly created browser tracks are best-effort only.
        }
      }
    } catch {
      // Ignore a transient TextTrackList.
    }
  }

  function captureTranscriptScrollPositions() {
    const snapshots = [];
    const seen = new Set();
    for (const root of findTranscriptPanelRoots()) {
      if (!elementIsVisible(root)) continue;
      const candidates = [root, ...deepQueryAll(root, (element) => {
        try {
          return element.scrollHeight > element.clientHeight + 1 ||
            element.scrollWidth > element.clientWidth + 1;
        } catch {
          return false;
        }
      })];
      for (const element of candidates) {
        if (!(element instanceof Element) || seen.has(element)) continue;
        seen.add(element);
        snapshots.push({
          element,
          scrollTop: Number(element.scrollTop) || 0,
          scrollLeft: Number(element.scrollLeft) || 0
        });
      }
    }
    return snapshots;
  }

  function restoreTranscriptScrollPositions(snapshots) {
    for (const snapshot of snapshots || []) {
      const element = snapshot?.element;
      if (!(element instanceof Element) || !element.isConnected) continue;
      try {
        element.scrollTop = snapshot.scrollTop;
        element.scrollLeft = snapshot.scrollLeft;
      } catch {
        // A virtualized panel may replace its scroll container while loading.
      }
    }
  }

  function findDescriptionContainer(element = null) {
    const fromElement = element?.closest?.(
      "ytd-text-inline-expander, ytd-expandable-video-description-body-renderer, #description-inline-expander, #description"
    );
    if (fromElement) return fromElement;
    return document.querySelector(
      "ytd-watch-metadata ytd-text-inline-expander, ytd-watch-metadata #description-inline-expander, " +
      "#above-the-fold ytd-text-inline-expander, #above-the-fold #description-inline-expander"
    );
  }

  function captureYouTubeInteractionState(candidate, info) {
    const player = candidate?.player || findPlayerForVideoId(info.videoId);
    const video = findVideoForPlayer(player, candidate);
    const button = getCaptionButton(player);
    const pressedAttribute = button?.getAttribute?.("aria-pressed");
    const descriptionContainer = findDescriptionContainer();
    return {
      player,
      video,
      captionButton: button,
      captionButtonWasPressed: pressedAttribute === "true"
        ? true
        : pressedAttribute === "false" ? false : null,
      previousTrack: readPlayerOptionSnapshot(player, "captions", "track"),
      captionsModuleWasLoaded: readCaptionsModuleLoaded(player),
      captionsModuleLoadedByExtension: false,
      textTrackModes: captureTextTrackModes(video),
      transcriptPanelWasOpen: transcriptPanelIsOpen(),
      transcriptPanelOpenedByExtension: false,
      transcriptScrollPositions: captureTranscriptScrollPositions(),
      descriptionContainer,
      descriptionWasExpanded: descriptionIsExpanded(descriptionContainer),
      descriptionExpandedByExtension: false,
      activeElement: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      pageScrollX: Number(window.scrollX) || 0,
      pageScrollY: Number(window.scrollY) || 0
    };
  }

  function ensureCaptionsModuleForTask(state) {
    const player = state?.player;
    if (!player || typeof player.loadModule !== "function") return;
    if (state.captionsModuleWasLoaded !== false || state.captionsModuleLoadedByExtension) return;
    try {
      player.loadModule("captions");
      state.captionsModuleLoadedByExtension = true;
    } catch {
      // setOption or the ordinary captions button may still load the module.
    }
  }

  function makeCaptionTrackDescriptor(player, rawTrack, translationLanguageCode) {
    const requestedVssId = String(rawTrack?.vssId || "");
    const requestedLanguage = normalizeLanguageCode(rawTrack?.languageCode).toLowerCase();
    const requestedKind = String(rawTrack?.kind || "").toLowerCase();
    const trackList = safePlayerOption(player, "captions", "tracklist");
    const matchingPlayerTrack = Array.isArray(trackList)
      ? trackList.find((track) => {
        const vssId = String(track?.vssId || track?.vss_id || "");
        if (requestedVssId && vssId === requestedVssId) return true;
        const language = normalizeLanguageCode(track?.languageCode).toLowerCase();
        const kind = String(track?.kind || "").toLowerCase();
        return Boolean(requestedLanguage) && language === requestedLanguage && kind === requestedKind;
      })
      : null;

    const descriptor = matchingPlayerTrack && typeof matchingPlayerTrack === "object"
      ? { ...matchingPlayerTrack }
      : {};
    descriptor.languageCode = normalizeLanguageCode(
      descriptor.languageCode || rawTrack?.languageCode
    );
    descriptor.kind = String(descriptor.kind ?? rawTrack?.kind ?? "");
    descriptor.name = descriptor.name || textFromRuns(rawTrack?.name);
    descriptor.vssId = String(descriptor.vssId || descriptor.vss_id || rawTrack?.vssId || "");
    descriptor.vss_id = String(descriptor.vss_id || descriptor.vssId || rawTrack?.vssId || "");

    const target = normalizeLanguageCode(translationLanguageCode);
    if (target) descriptor.translationLanguage = target;
    else delete descriptor.translationLanguage;
    return descriptor;
  }

  function applyCaptionTrack(player, rawTrack, translationLanguageCode, interactionState = null) {
    if (!player || typeof player.setOption !== "function") return false;
    if (interactionState) ensureCaptionsModuleForTask(interactionState);
    try {
      player.setOption("captions", "track", makeCaptionTrackDescriptor(player, rawTrack, translationLanguageCode));
      try { player.setOption("captions", "reload", true); } catch { /* Optional API. */ }
      return true;
    } catch {
      return false;
    }
  }

  function collectPlayerCaptionUrls(player, candidate, capture) {
    if (!capture) return;
    capture.addUrlsFrom(safePlayerResponse(player));
    capture.addUrlsFrom(candidate?.response);
    capture.addUrlsFrom(safePlayerOption(player, "captions", "track"));
    capture.addUrlsFrom(safePlayerOption(player, "captions", "tracklist"));
    capture.addUrlsFrom(safePlayerOption(player, "captions", "translationLanguages"));
    try {
      for (const entry of performance.getEntriesByType("resource")) capture.addUrlsFrom(entry?.name);
    } catch {
      // Ignore resource timing failures.
    }
  }

  function getTextTrackEntries(video, rawTrack, translationLanguageCode) {
    if (!(video instanceof HTMLMediaElement) || !video.textTracks?.length) return [];
    const targetLanguage = normalizeLanguageCode(translationLanguageCode || rawTrack?.languageCode).toLowerCase();
    const tracks = Array.from(video.textTracks);
    const sorted = tracks.sort((first, second) => {
      const firstLanguage = normalizeLanguageCode(first.language).toLowerCase();
      const secondLanguage = normalizeLanguageCode(second.language).toLowerCase();
      return Number(secondLanguage === targetLanguage) - Number(firstLanguage === targetLanguage);
    });

    for (const track of sorted) {
      try {
        if (track.mode === "disabled") track.mode = "hidden";
      } catch {
        // Read whatever the browser exposes.
      }
      const cues = track.cues;
      if (!cues || cues.length === 0) continue;
      const entries = [];
      for (let index = 0; index < cues.length; index += 1) {
        const cue = cues[index];
        entries.push({
          startMs: Math.round(Number(cue.startTime || 0) * 1000),
          durationMs: Math.max(0, Math.round((Number(cue.endTime || 0) - Number(cue.startTime || 0)) * 1000)),
          text: String(cue.text || "").replace(/<[^>]+>/g, " ")
        });
      }
      const finalized = finalizeEntries(entries);
      if (finalized.length > 0) return finalized;
    }
    return [];
  }

  function playerIssuedUrlMatchesRequest(url, rawTrack, translationLanguageCode) {
    if (!isTimedTextUrl(url)) return false;
    const requestedSource = normalizeLanguageCode(rawTrack?.languageCode).toLowerCase();
    const actualSource = normalizeLanguageCode(getUrlParameter(url, "lang")).toLowerCase();
    if (requestedSource && actualSource && requestedSource !== actualSource) return false;

    const requestedTranslation = normalizeLanguageCode(translationLanguageCode).toLowerCase();
    const actualTranslation = normalizeLanguageCode(getUrlParameter(url, "tlang")).toLowerCase();
    return requestedTranslation ? actualTranslation === requestedTranslation : !actualTranslation;
  }

  async function fetchCapturedUrls(capture, rawTrack, translationLanguageCode, attemptedUrls) {
    for (const url of capture.getUrls()) {
      if (attemptedUrls.has(url)) continue;
      attemptedUrls.add(url);
      if (!playerIssuedUrlMatchesRequest(url, rawTrack, translationLanguageCode)) continue;
      const result = await fetchCaptionUrl(url, translationLanguageCode, true);
      if (result.entries.length > 0) {
        return { ...result, format: "youtube-player-issued-timedtext" };
      }
    }
    return null;
  }

  async function fetchTranscriptViaPlayerRequest(
    candidate,
    info,
    rawTrack,
    translationLanguageCode,
    interactionState
  ) {
    const player = interactionState?.player || candidate?.player || findPlayerForVideoId(info.videoId);
    if (!player) return null;
    const video = interactionState?.video || findVideoForPlayer(player, candidate);
    const button = interactionState?.captionButton || getCaptionButton(player);
    const capture = createActualYouTubeRequestCapture(info, rawTrack, translationLanguageCode);
    const attemptedUrls = new Set();

    try {
      applyCaptionTrack(player, rawTrack, translationLanguageCode, interactionState);
      if (button && button.getAttribute("aria-pressed") !== "true") {
        try {
          button.click();
          await sleep(80);
          applyCaptionTrack(player, rawTrack, translationLanguageCode, interactionState);
        } catch {
          // setOption may still load the track without clicking the button.
        }
      }

      let forcedReload = false;
      const startedAt = Date.now();
      while (Date.now() - startedAt < CAPTION_REQUEST_TIMEOUT_MS) {
        collectPlayerCaptionUrls(player, candidate, capture);

        const captured = capture.getParsedResult();
        if (captured?.entries?.length) return captured;

        const fetched = await fetchCapturedUrls(capture, rawTrack, translationLanguageCode, attemptedUrls);
        if (fetched?.entries?.length) return fetched;

        const cueEntries = getTextTrackEntries(video, rawTrack, translationLanguageCode);
        if (cueEntries.length >= 3) {
          return { entries: cueEntries, format: "html5-text-track" };
        }

        if (!forcedReload && Date.now() - startedAt > 2200) {
          forcedReload = true;
          try { player.setOption("captions", "reload", true); } catch { /* Optional API. */ }
          applyCaptionTrack(player, rawTrack, translationLanguageCode, interactionState);
        }

        await sleep(220);
      }
      return null;
    } finally {
      capture.cleanup();
    }
  }

  function deepElementIterator(root) {
    const stack = [root || document];
    const visited = new Set();
    return {
      [Symbol.iterator]() { return this; },
      next() {
        while (stack.length > 0) {
          const node = stack.pop();
          if (!node || visited.has(node)) continue;
          visited.add(node);
          if (node.shadowRoot) stack.push(node.shadowRoot);
          const children = node.children ? Array.from(node.children) : [];
          for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
          if (node.nodeType === Node.ELEMENT_NODE) return { value: node, done: false };
        }
        return { value: undefined, done: true };
      }
    };
  }

  function deepQueryAll(root, predicate) {
    const output = [];
    for (const element of deepElementIterator(root)) {
      try {
        if (predicate(element)) output.push(element);
      } catch {
        // Ignore inaccessible or transient elements.
      }
    }
    return output;
  }

  function isTranscriptPanelElement(element) {
    if (!(element instanceof Element)) return false;
    const tag = element.tagName.toLowerCase();
    const targetId = String(element.getAttribute("target-id") || "").toLowerCase();
    const identifier = String(element.getAttribute("panel-identifier") || "").toLowerCase();
    return tag.includes("transcript") || targetId.includes("transcript") || identifier.includes("transcript");
  }

  function findTranscriptPanelRoots() {
    return [...new Set(deepQueryAll(document, isTranscriptPanelElement))];
  }

  function elementIsVisible(element) {
    if (!(element instanceof Element)) return false;
    try {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" &&
        style.visibility !== "hidden" && style.opacity !== "0" &&
        element.getAttribute("aria-hidden") !== "true" && !element.hidden;
    } catch {
      return false;
    }
  }

  function transcriptPanelIsOpen() {
    return findTranscriptPanelRoots().some(elementIsVisible);
  }

  function descriptionIsExpanded(container = null) {
    const scope = container instanceof Element ? container : document;
    const expandedContainer = scope.matches?.(
      "ytd-text-inline-expander[is-expanded], ytd-expandable-video-description-body-renderer[is-expanded]"
    )
      ? scope
      : scope.querySelector?.(
        "ytd-text-inline-expander[is-expanded], ytd-expandable-video-description-body-renderer[is-expanded]"
      );
    if (expandedContainer && elementIsVisible(expandedContainer)) return true;
    const collapse = scope.querySelector?.(
      "#collapse, tp-yt-paper-button#collapse, button[aria-label*='Show less'], button[aria-label*='간략히'], button[aria-label*='접기']"
    );
    return elementIsVisible(collapse);
  }

  function markTranscriptUiChanges(interactionState) {
    if (!interactionState) return;
    if (!interactionState.transcriptPanelWasOpen && transcriptPanelIsOpen()) {
      interactionState.transcriptPanelOpenedByExtension = true;
    }
    if (
      !interactionState.descriptionWasExpanded &&
      descriptionIsExpanded(interactionState.descriptionContainer)
    ) {
      interactionState.descriptionExpandedByExtension = true;
    }
  }

  function findTranscriptPanelCloseButton() {
    for (const root of findTranscriptPanelRoots()) {
      if (!elementIsVisible(root)) continue;
      const direct = root.querySelector?.(
        "#visibility-button button, button[aria-label*='Close transcript'], button[aria-label*='Close Transcript'], button[aria-label*='스크립트 닫기'], button[aria-label*='대본 닫기'], button[aria-label*='자막 닫기'], button[title*='Close transcript'], button[title*='Close Transcript'], button[title*='스크립트 닫기'], button[title*='대본 닫기'], button[title*='자막 닫기']"
      );
      if (direct && elementIsVisible(direct)) return direct;
    }
    return null;
  }

  async function restoreTranscriptUi(interactionState) {
    if (!interactionState) return;

    if (interactionState.transcriptPanelOpenedByExtension && !interactionState.transcriptPanelWasOpen) {
      const closeButton = findTranscriptPanelCloseButton();
      if (closeButton) {
        try { closeButton.click(); } catch { /* Ignore a transient panel. */ }
        await sleep(80);
      }
    }

    if (interactionState.descriptionExpandedByExtension && !interactionState.descriptionWasExpanded) {
      const scope = interactionState.descriptionContainer instanceof Element &&
        interactionState.descriptionContainer.isConnected
        ? interactionState.descriptionContainer
        : findDescriptionContainer();
      const collapse = scope?.querySelector?.(
        "#collapse, tp-yt-paper-button#collapse, button[aria-label*='Show less'], button[aria-label*='간략히'], button[aria-label*='접기']"
      );
      if (collapse && elementIsVisible(collapse)) {
        try { collapse.click(); } catch { /* Ignore a transient description. */ }
        await sleep(60);
      }
    }

    if (interactionState.transcriptPanelWasOpen) {
      restoreTranscriptScrollPositions(interactionState.transcriptScrollPositions);
    }
  }

  async function restoreYouTubeInteractionState(interactionState) {
    if (!interactionState) return;
    const player = interactionState.player;

    if (interactionState.previousTrack?.available && player && typeof player.setOption === "function") {
      try {
        const previous = interactionState.previousTrack.value;
        player.setOption("captions", "track", previous == null ? {} : clonePlayerOptionValue(previous));
        try { player.setOption("captions", "reload", true); } catch { /* Optional API. */ }
      } catch {
        // The captions button and text-track restoration below still restore visible state.
      }
    }

    const button = interactionState.captionButton?.isConnected
      ? interactionState.captionButton
      : getCaptionButton(player);
    if (button && typeof interactionState.captionButtonWasPressed === "boolean") {
      const currentlyPressed = button.getAttribute("aria-pressed") === "true";
      if (currentlyPressed !== interactionState.captionButtonWasPressed) {
        try { button.click(); } catch { /* Ignore restore failure. */ }
        await sleep(60);
      }
    }

    restoreTextTrackModes(interactionState.video, interactionState.textTrackModes);
    await restoreTranscriptUi(interactionState);

    if (
      interactionState.captionsModuleLoadedByExtension &&
      interactionState.captionsModuleWasLoaded === false &&
      player && typeof player.unloadModule === "function"
    ) {
      try { player.unloadModule("captions"); } catch { /* Ignore restore failure. */ }
    }

    try {
      window.scrollTo(interactionState.pageScrollX, interactionState.pageScrollY);
    } catch {
      // Ignore pages that temporarily replace their scrolling element.
    }
    const activeElement = interactionState.activeElement;
    if (activeElement?.isConnected && typeof activeElement.focus === "function") {
      try { activeElement.focus({ preventScroll: true }); } catch { try { activeElement.focus(); } catch { /* Ignore. */ } }
    }
  }

  function transcriptPanelHasRows() {
    return deepQueryAll(document, (element) => {
      const tag = element.tagName.toLowerCase();
      const className = String(element.className || "").toLowerCase();
      if (tag === "transcript-segment-view-model" || tag === "ytd-transcript-segment-renderer") return true;
      if (className.includes("segment-text")) {
        return Boolean(element.closest?.('[target-id*="transcript"], ytd-transcript-renderer, ytd-transcript-search-panel-renderer'));
      }
      if (element.id === "segments-container") {
        return Boolean(element.closest?.('[target-id*="transcript"], ytd-transcript-renderer, ytd-transcript-search-panel-renderer')) &&
          element.children.length > 0;
      }
      return false;
    }).length > 0;
  }

  function transcriptPanelIsReady() {
    return transcriptPanelIsOpen() && (transcriptPanelHasRows() || findTranscriptPanelRoots().some(elementIsVisible));
  }

  async function waitForTranscriptPanelReady(timeoutMs = 1800) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (transcriptPanelIsReady()) return true;
      await sleep(120);
    }
    return transcriptPanelIsReady();
  }

  function parseDomTimestamp(value) {
    const text = normalizeVisibleText(value);
    const match = text.match(/(?:^|\s)(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)(?:\s|$)/);
    return match ? parseTimestampLabelToMs(match[1]) : null;
  }

  function extractDomTranscriptRow(row) {
    const timestampCandidates = deepQueryAll(row, (element) => {
      const className = String(element.className || "").toLowerCase();
      return className.includes("timestamp") || element.tagName === "BUTTON";
    });
    let startMs = null;
    for (const element of timestampCandidates) {
      startMs = parseDomTimestamp(element.textContent || element.getAttribute("aria-label") || "");
      if (startMs != null) break;
    }
    if (startMs == null) startMs = parseDomTimestamp(row.textContent || "");
    if (startMs == null) return null;

    const textCandidates = deepQueryAll(row, (element) => {
      const className = String(element.className || "").toLowerCase();
      const tag = element.tagName.toLowerCase();
      return className.includes("segment-text") || className.includes("attributed-string") || tag === "yt-formatted-string";
    });
    let text = "";
    for (const element of textCandidates) {
      const candidate = normalizeVisibleText(element.textContent || element.getAttribute("aria-label") || "");
      if (!candidate || parseDomTimestamp(candidate) != null) continue;
      text = candidate;
      break;
    }
    if (!text) {
      const timestampText = timestampCandidates.map((element) => normalizeVisibleText(element.textContent || "")).find(Boolean) || "";
      text = normalizeVisibleText(row.textContent || "");
      if (timestampText && text.startsWith(timestampText)) text = normalizeVisibleText(text.slice(timestampText.length));
      text = text.replace(/^\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?\s*/, "").trim();
    }
    return text ? { startMs, durationMs: 0, text } : null;
  }

  function collectDomTranscriptEntries() {
    const entries = [];
    const rows = deepQueryAll(document, (element) => {
      const tag = element.tagName.toLowerCase();
      const role = String(element.getAttribute("role") || "").toLowerCase();
      return tag === "transcript-segment-view-model" || tag === "ytd-transcript-segment-renderer" ||
        (role === "listitem" && Boolean(element.closest?.('[target-id*="transcript"], ytd-transcript-renderer, ytd-transcript-search-panel-renderer')));
    });
    for (const row of rows) {
      const parsed = extractDomTranscriptRow(row);
      if (parsed) entries.push(parsed);
    }
    return finalizeEntries(entries).sort((first, second) => first.startMs - second.startMs);
  }

  async function scrollTranscriptPanelsAndCollect() {
    const collected = new Map();
    const collect = () => {
      for (const entry of collectDomTranscriptEntries()) {
        collected.set(`${entry.startMs}|${entry.text}`, entry);
      }
    };
    collect();

    const scrollContainers = deepQueryAll(document, (element) => {
      if (!element.closest?.('[target-id*="transcript"], ytd-transcript-renderer, ytd-transcript-search-panel-renderer')) return false;
      return element.scrollHeight > element.clientHeight + 8;
    }).sort((first, second) => second.scrollHeight - first.scrollHeight).slice(0, 2);

    for (const container of scrollContainers) {
      const originalScrollTop = container.scrollTop;
      let stablePasses = 0;
      let previousSize = collected.size;
      try {
        container.scrollTop = 0;
        await sleep(100);
        collect();
        for (let pass = 0; pass < 30; pass += 1) {
          const nextTop = Math.min(container.scrollHeight, container.scrollTop + Math.max(240, container.clientHeight * 0.85));
          container.scrollTop = nextTop;
          await sleep(120);
          collect();
          if (collected.size === previousSize) stablePasses += 1;
          else {
            previousSize = collected.size;
            stablePasses = 0;
          }
          const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 4;
          if (atBottom && stablePasses >= 2) break;
        }
      } finally {
        container.scrollTop = originalScrollTop;
      }
    }

    const entries = [...collected.values()].sort((first, second) => first.startMs - second.startMs);
    for (let index = 0; index < entries.length; index += 1) {
      const next = entries[index + 1];
      if (entries[index].durationMs <= 0 && next && next.startMs > entries[index].startMs) {
        entries[index].durationMs = next.startMs - entries[index].startMs;
      }
    }
    return entries;
  }

  async function openTranscriptPanel(interactionState = null) {
    if (transcriptPanelIsOpen()) return true;

    const directCandidates = [];
    const addCandidate = (element) => {
      if (element instanceof Element && !directCandidates.includes(element)) directCandidates.push(element);
    };

    for (const selector of [
      "ytd-video-description-transcript-section-renderer button",
      "ytd-video-description-transcript-section-renderer",
      "button[aria-label='Show transcript']",
      "button[aria-label*='Show transcript']",
      "button[aria-label*='스크립트 표시']",
      "button[aria-label*='대본 표시']",
      "button[aria-label*='文字起こし']",
      "button[aria-label*='Transcripción']"
    ]) {
      try { document.querySelectorAll(selector).forEach(addCandidate); } catch { /* Ignore selector changes. */ }
    }

    for (const item of document.querySelectorAll("ytd-menu-service-item-renderer, tp-yt-paper-item")) {
      const html = String(item.outerHTML || "");
      if (html.includes("getTranscriptEndpoint") || html.includes("searchable-transcript")) addCandidate(item);
    }

    for (const candidate of directCandidates) {
      if (!elementIsVisible(candidate)) continue;
      try {
        (candidate.closest?.("button, ytd-menu-service-item-renderer, tp-yt-paper-item") || candidate).click();
        if (await waitForTranscriptPanelReady()) {
          markTranscriptUiChanges(interactionState);
          return true;
        }
      } catch {
        // Try the next explicit transcript control.
      }
    }

    const expand = document.querySelector(
      "ytd-text-inline-expander #expand, #description-inline-expander #expand, ytd-watch-metadata #description #expand"
    );
    if (expand && elementIsVisible(expand)) {
      if (interactionState && !interactionState.descriptionContainer) {
        interactionState.descriptionContainer = findDescriptionContainer(expand);
      }
      try { expand.click(); } catch { /* Ignore. */ }
      await sleep(350);
      markTranscriptUiChanges(interactionState);
      const section = document.querySelector("ytd-video-description-transcript-section-renderer");
      if (section && elementIsVisible(section)) {
        try { section.click(); } catch { /* Ignore. */ }
        if (await waitForTranscriptPanelReady()) {
          markTranscriptUiChanges(interactionState);
          return true;
        }
      }
    }

    const moreButton = document.querySelector(
      "ytd-watch-metadata #actions ytd-menu-renderer button[aria-label*='More actions'], " +
      "#above-the-fold #actions ytd-menu-renderer button[aria-label*='More actions'], " +
      "ytd-watch-metadata #actions ytd-menu-renderer button[aria-label*='작업 더보기'], " +
      "#above-the-fold #actions ytd-menu-renderer button[aria-label*='작업 더보기']"
    );
    if (moreButton && elementIsVisible(moreButton)) {
      try { moreButton.click(); } catch { /* Ignore. */ }
      await sleep(350);
      const menuItems = [...document.querySelectorAll("ytd-menu-service-item-renderer, tp-yt-paper-item")];
      const item = menuItems.find((element) => {
        if (!elementIsVisible(element)) return false;
        const html = String(element.outerHTML || "");
        const text = normalizeVisibleText(element.textContent || element.getAttribute("aria-label") || "").toLowerCase();
        return html.includes("getTranscriptEndpoint") || html.includes("searchable-transcript") ||
          /^(?:show transcript|transcript|스크립트 표시|대본 표시|文字起こし|字幕|transcripción|transcrição)$/.test(text);
      });
      if (item) {
        try { item.click(); } catch { /* Ignore. */ }
        if (await waitForTranscriptPanelReady()) {
          markTranscriptUiChanges(interactionState);
          return true;
        }
      } else {
        try { moreButton.click(); } catch { /* Close the menu best-effort. */ }
      }
    }

    markTranscriptUiChanges(interactionState);
    return transcriptPanelIsReady();
  }

  async function fetchTranscriptViaPanel(
    candidate,
    info,
    rawTrack,
    translationLanguageCode,
    interactionState
  ) {
    const player = interactionState?.player || candidate?.player || findPlayerForVideoId(info.videoId);
    const capture = createActualYouTubeRequestCapture(info, rawTrack, translationLanguageCode);
    const attemptedUrls = new Set();

    try {
      applyCaptionTrack(player, rawTrack, translationLanguageCode, interactionState);
      await openTranscriptPanel(interactionState);

      const startedAt = Date.now();
      while (Date.now() - startedAt < PANEL_REQUEST_TIMEOUT_MS) {
        collectPlayerCaptionUrls(player, candidate, capture);

        const captured = capture.getParsedResult();
        if (captured?.entries?.length) return { ...captured, format: "youtube-panel-issued-response" };

        const fetched = await fetchCapturedUrls(capture, rawTrack, translationLanguageCode, attemptedUrls);
        if (fetched?.entries?.length) return { ...fetched, format: "youtube-panel-issued-timedtext" };

        const domEntries = await scrollTranscriptPanelsAndCollect();
        if (domEntries.length > 0) {
          const currentTrack = safePlayerOption(player, "captions", "track");
          const currentTranslation = normalizeLanguageCode(
            currentTrack?.translationLanguage?.languageCode ||
            currentTrack?.translationLanguageCode ||
            currentTrack?.translationLanguage ||
            ""
          );
          if (!translationLanguageCode || currentTranslation.toLowerCase() === translationLanguageCode.toLowerCase()) {
            return { entries: domEntries, format: "youtube-transcript-panel" };
          }
        }
        await sleep(350);
      }
      return null;
    } finally {
      capture.cleanup();
    }
  }

  async function fetchTranscriptWithFallbacks(
    candidate,
    info,
    rawTrack,
    translationLanguageCode,
    interactionState
  ) {
    const baseUrl = String(rawTrack?.baseUrl || "").trim();

    if (baseUrl && !requiresPlayerIssuedToken(baseUrl)) {
      const direct = await fetchCaptionEntries(baseUrl, translationLanguageCode);
      if (direct?.entries?.length) return direct;
    }

    const playerIssued = await fetchTranscriptViaPlayerRequest(
      candidate, info, rawTrack, translationLanguageCode, interactionState
    );
    if (playerIssued?.entries?.length) return playerIssued;

    const panel = await fetchTranscriptViaPanel(
      candidate, info, rawTrack, translationLanguageCode, interactionState
    );
    if (panel?.entries?.length) return panel;

    throw new Error(
      "유튜브가 실제로 발급한 자막 요청에서도 자막 본문을 받지 못했습니다. 영상의 자막을 한 번 켠 뒤 목록을 새로고침하고 다시 시도하세요."
    );
  }

  if (!isYoutubePage()) {
    return { ok: false, error: "유튜브 영상 또는 Shorts 페이지에서 사용하세요." };
  }

  const candidate = choosePlayerResponse();
  if (!candidate) {
    return { ok: false, error: "현재 유튜브 플레이어 정보를 찾지 못했습니다. 페이지를 새로 고친 뒤 다시 시도하세요." };
  }

  const info = buildCaptionInfo(candidate);
  if (!info.videoId) {
    return { ok: false, error: "현재 영상의 식별 정보를 확인하지 못했습니다." };
  }

  if (info.tracks.length === 0) {
    return {
      ok: false,
      error: "이 영상에서 사용할 수 있는 자막을 찾지 못했습니다. 유튜브 자막이 제공되는 영상인지 확인하세요.",
      videoId: info.videoId,
      title: info.title
    };
  }

  if (task.operation === "transcript") {
    const expectedVideoId = String(task.expectedVideoId || "").trim();
    if (expectedVideoId && expectedVideoId !== info.videoId) {
      return { ok: false, error: "영상이 변경되었습니다. 자막 목록을 새로고침한 뒤 다시 시도하세요." };
    }
  }

  if (task.operation !== "transcript") {
    return {
      ok: true,
      videoId: info.videoId,
      title: info.title,
      pageUrl: info.pageUrl,
      tracks: info.tracks,
      translationLanguages: info.translationLanguages
    };
  }

  const requestedIndex = Number(task.trackIndex);
  const requestedTrackId = String(task.trackId || "");
  let trackIndex = Number.isInteger(requestedIndex) ? requestedIndex : -1;
  if (
    trackIndex < 0 ||
    trackIndex >= info.rawTracks.length ||
    (requestedTrackId && String(info.rawTracks[trackIndex]?.vssId || `${info.rawTracks[trackIndex]?.languageCode || "und"}:${trackIndex}`) !== requestedTrackId)
  ) {
    trackIndex = info.rawTracks.findIndex((track, index) => (
      String(track?.vssId || `${track?.languageCode || "und"}:${index}`) === requestedTrackId
    ));
  }

  if (trackIndex < 0 || trackIndex >= info.rawTracks.length) {
    return { ok: false, error: "선택한 자막 트랙을 현재 영상에서 다시 찾지 못했습니다." };
  }

  const rawTrack = info.rawTracks[trackIndex];
  const publicTrack = info.tracks[trackIndex];
  const translationLanguageCode = normalizeLanguageCode(task.translationLanguageCode);
  if (translationLanguageCode && publicTrack?.isTranslatable === false) {
    return { ok: false, error: "선택한 자막 트랙은 유튜브 자동 번역을 지원하지 않습니다." };
  }

  const interactionState = captureYouTubeInteractionState(candidate, info);
  try {
    const fetched = await fetchTranscriptWithFallbacks(
      candidate, info, rawTrack, translationLanguageCode, interactionState
    );
    const translationLanguage = info.translationLanguages.find(
      (language) => language.languageCode.toLowerCase() === translationLanguageCode.toLowerCase()
    );

    return {
      ok: true,
      videoId: info.videoId,
      title: info.title,
      pageUrl: info.pageUrl,
      sourceTrack: publicTrack,
      translationLanguageCode,
      translationLanguageName: translationLanguage?.name || translationLanguageCode,
      format: fetched.format,
      entries: fetched.entries
    };
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || "자막 데이터를 읽지 못했습니다."),
      videoId: info.videoId,
      title: info.title
    };
  } finally {
    await restoreYouTubeInteractionState(interactionState);
  }
}
