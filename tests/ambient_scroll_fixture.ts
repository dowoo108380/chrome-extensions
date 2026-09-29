/** Test-owned ambient decorations; not captured YouTube DOM or CSS. */
namespace AmbientScrollFixture {
  const env = globalThis as unknown as Record<string, any>;
  export let canvas: HTMLCanvasElement;
  export let decoration: HTMLElement;
  export function attach(kind = "absolute-canvas"): void {
    const watch = document.querySelector<HTMLElement>("ytd-watch-flexy")!;
    watch.style.position = "relative";
    const columns = document.getElementById("columns")!;
    columns.style.position = "relative"; columns.style.zIndex = "1";
    decoration = document.createElement("div"); decoration.id = "cinematics";
    decoration.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:0;overflow:visible";
    const surface = document.createElement("div");
    canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 1160;
    canvas.style.cssText = "display:block;width:100%;height:1160px";
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createLinearGradient(0, 0, 0, 1160);
    gradient.addColorStop(0, "#243b45"); gradient.addColorStop(1, "#112631");
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 640, 1160);
    surface.append(canvas); decoration.append(surface);
    if (kind === "transformed-canvas") {
      canvas.style.height = "700px"; surface.style.cssText = "transform:scaleY(1.8);transform-origin:top left";
    } else if (kind === "zero-size-root") decoration.style.height = "0px";
    else if (kind === "nested-absolute") {
      surface.style.cssText = "position:absolute;left:0;top:0;width:100%;height:720px";
      canvas.style.position = "absolute";
    } else if (kind === "paint-contained") decoration.style.contain = "paint";
    else if (kind === "important-override") decoration.style.setProperty("contain", "none", "important");
    if (kind === "outside-watch") document.body.append(decoration);
    else watch.insertBefore(decoration, columns);
    if (kind === "interactive") addControl();
  }
  export function addControl(): void {
    const button = document.createElement("button"); button.id = "fixture-decoration-button";
    button.textContent = "This is not decoration only"; decoration.append(button);
  }
  export function read(): Record<string, unknown> {
    const root = document.scrollingElement!;
    const state = env.__browserToolboxYouTubeLayoutV1__?.getStatus();
    const rect = (element: Element) => {
      const r = element.getBoundingClientRect();
      return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
    };
    return { documentHeight: root.scrollHeight, viewportHeight: root.clientHeight, scrollRange: root.scrollHeight - root.clientHeight,
      state, contain: getComputedStyle(decoration).contain, overflow: getComputedStyle(decoration).overflow,
      decoration: rect(decoration), canvas: rect(canvas), player: rect(document.querySelector("#movie_player")!),
      sameCanvas: decoration.contains(canvas), marker: decoration.getAttribute("data-btx-layout-ambient"),
      rate: (document.querySelector("video") as HTMLVideoElement).playbackRate,
      rootOverflow: getComputedStyle(document.documentElement).overflow, bodyOverflow: getComputedStyle(document.body).overflow };
  }
  export function popupChrome(result: Record<string, unknown>): void {
    env.chrome.tabs.sendMessage = (_id: number, _message: unknown, _options: unknown, done: (reply: unknown) => void) => done({ ok: true, result });
    env.chrome.runtime.getManifest = () => ({ version: "1.57.0" });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (value: string) => { if (env.failCopy) throw new Error("Injected clipboard failure"); env.copiedLayout = value; }
    } });
  }
}
(globalThis as unknown as Record<string, unknown>).AmbientScrollFixture = AmbientScrollFixture;
