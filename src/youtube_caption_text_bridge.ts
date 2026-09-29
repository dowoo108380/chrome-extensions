"use strict";

/**
 * Short-lived, data-only caption parser in the extension's ISOLATED world.
 * This function is serialized by chrome.scripting: keep all dependencies inside it.
 * Page/MAIN code never receives parsed nodes, extension API access, or a TrustedHTML policy.
 */
function youtubeCaptionTextBridge(rawOptions: unknown): { ok: true; installed: boolean } {
  type Request = { requestId: string; operation: "decode-texts" | "parse-xml"; texts?: string[]; text?: string };
  type Entry = { startMs: number; durationMs: number; text: string };
  const options = rawOptions as { action?: unknown; channelId?: unknown } | null;
  const channelId = options?.channelId;
  if (typeof channelId !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(channelId)) {
    throw new Error("자막 텍스트 처리 작업의 식별자가 올바르지 않습니다.");
  }
  if (options?.action !== "install" && options?.action !== "dispose") {
    throw new Error("지원하지 않는 자막 텍스트 처리 작업입니다.");
  }

  const registryKey = "__browserToolboxCaptionTextBridgesV1";
  const scope = globalThis as typeof globalThis & { __browserToolboxCaptionTextBridgesV1?: Map<string, () => void> };
  const registry = scope[registryKey] ?? new Map<string, () => void>();
  if (options.action === "dispose") {
    registry.get(channelId)?.();
    return { ok: true, installed: false };
  }
  if (registry.has(channelId)) return { ok: true, installed: true };
  scope[registryKey] = registry;

  const MAX_TEXT_LENGTH = 8_000_000;
  const MAX_ITEMS = 50_000;
  const requestEvent = `browser-toolbox-caption-text-request:${channelId}`;
  const responseEvent = `browser-toolbox-caption-text-response:${channelId}`;
  const parser = new DOMParser();
  // A template is an inert fragment: parsing never attaches scripts, frames, images,
  // styles, or other source markup to the live page. Only its textContent is returned.
  const template = document.createElement("template");
  let active = true;
  let expiry: ReturnType<typeof setTimeout> | undefined;

  function cleanup(): void {
    if (!active) return;
    active = false;
    document.removeEventListener(requestEvent, handleRequest, true);
    window.removeEventListener("pagehide", cleanup, true);
    if (expiry !== undefined) clearTimeout(expiry);
    template.content.replaceChildren();
    registry.delete(channelId as string);
    if (registry.size === 0 && scope[registryKey] === registry) delete scope[registryKey];
  }

  function parseXml(text: string): Entry[] {
    // Caption formats do not require a DTD. Never expand arbitrary entity declarations.
    if (/<!DOCTYPE\b/i.test(text)) throw new Error("DOCTYPE 선언이 있는 XML 자막은 지원하지 않습니다.");
    const parsed = parser.parseFromString(text, "text/xml");
    if (parsed.querySelector("parsererror")) throw new Error("자막 XML의 형식이 올바르지 않습니다.");
    const entries: Entry[] = [];
    const oldNodes = parsed.querySelectorAll("transcript > text, text[start]");
    const nodes = oldNodes.length > 0 ? oldNodes : parsed.querySelectorAll("p");
    if (nodes.length > MAX_ITEMS) throw new Error("자막 문장 수가 텍스트 처리 한도를 넘었습니다.");
    function timeValue(node: Element, name: string, scale: number, required: boolean): number {
      const raw = node.getAttribute(name);
      if (raw === null && !required) return 0;
      if (raw === null || raw.trim() === "") throw new Error(`자막 XML에 유효한 ${name} 시각이 없습니다.`);
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(Math.round(value * scale))) {
        throw new Error(`자막 XML의 ${name} 시각이 올바르지 않습니다.`);
      }
      return Math.round(value * scale);
    }
    for (const node of nodes) {
      entries.push({
        startMs: timeValue(node, oldNodes.length > 0 ? "start" : "t", oldNodes.length > 0 ? 1000 : 1, true),
        durationMs: timeValue(node, oldNodes.length > 0 ? "dur" : "d", oldNodes.length > 0 ? 1000 : 1, false),
        text: node.textContent || ""
      });
    }
    return entries;
  }

  function handleRequest(event: Event): void {
    if (!active || !(event instanceof CustomEvent) || typeof event.detail !== "string") return;
    // JSON escaping can expand each code unit to six characters. Bound work before parsing.
    if (event.detail.length > (MAX_TEXT_LENGTH * 6) + 1_000_000) return;
    let request: Request;
    try { request = JSON.parse(event.detail) as Request; } catch { return; }
    if (!request || typeof request.requestId !== "string" ||
        !request.requestId.startsWith(`${channelId}:`) ||
        !/^[1-9]\d{0,8}$/.test(request.requestId.slice((channelId as string).length + 1))) return;

    let response: Record<string, unknown>;
    try {
      if (request.operation === "decode-texts") {
        if (!Array.isArray(request.texts) || request.texts.length > MAX_ITEMS) {
          throw new Error("자막 텍스트 목록이 올바르지 않거나 처리 한도를 넘었습니다.");
        }
        let size = 0;
        const texts: string[] = [];
        for (const text of request.texts) {
          if (typeof text !== "string" || (size += text.length) > MAX_TEXT_LENGTH) {
            throw new Error("자막 텍스트가 올바르지 않거나 처리 한도를 넘었습니다.");
          }
          template.innerHTML = text;
          texts.push(template.content.textContent || "");
        }
        response = { requestId: request.requestId, ok: true, texts };
      } else if (request.operation === "parse-xml") {
        if (typeof request.text !== "string" || request.text.length > MAX_TEXT_LENGTH) {
          throw new Error("자막 XML이 올바르지 않거나 처리 한도를 넘었습니다.");
        }
        response = { requestId: request.requestId, ok: true, entries: parseXml(request.text) };
      } else {
        throw new Error("지원하지 않는 자막 텍스트 처리 요청입니다.");
      }
    } catch (error) {
      response = {
        requestId: request.requestId,
        ok: false,
        error: error instanceof Error ? error.message : "자막 텍스트를 처리하지 못했습니다."
      };
    } finally {
      template.content.replaceChildren();
    }
    // The channel ID prevents accidental cross-job collisions; it is not an authorization
    // secret. The page already owns the source data, and this handler has no privileged actions.
    document.dispatchEvent(new CustomEvent(responseEvent, { detail: JSON.stringify(response) }));
  }

  document.addEventListener(requestEvent, handleRequest, true);
  window.addEventListener("pagehide", cleanup, true);
  // Cleanup normally comes from the service worker's finally. This is a bounded watchdog
  // for a worker restart, closed popup, or interrupted operation, not a polling loop.
  expiry = setTimeout(cleanup, 180_000);
  registry.set(channelId, cleanup);
  return { ok: true, installed: true };
}
