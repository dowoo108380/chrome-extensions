(() => {
  const HOST_ID = "__drag_area_screenshot_host__";
  const CANCEL_EVENT = "drag-area-screenshot:force-cancel";
  const CAPTURE_MESSAGE = "drag-area-screenshot:capture";
  const READY_MESSAGE = "drag-area-screenshot:ready";
  const CANCEL_MESSAGE = "drag-area-screenshot:cancel";
  const MIN_SELECTION_SIZE = 8;
  const EDGE_ZONE = 72;
  const MAX_SCROLL_PER_FRAME = 30;
  const ELEMENT_ERASER_HOST_ID = "__page_element_eraser_host__";
  const ELEMENT_ERASER_EXIT_EVENT = "page-element-eraser:force-exit";

  document.getElementById(ELEMENT_ERASER_HOST_ID)?.dispatchEvent(
    new CustomEvent(ELEMENT_ERASER_EXIT_EVENT)
  );

  const existingHost = document.getElementById(HOST_ID);
  if (existingHost) {
    existingHost.dispatchEvent(new CustomEvent(CANCEL_EVENT));
    return;
  }

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = [
    "all: initial",
    "position: fixed",
    "inset: 0",
    "z-index: 2147483647",
    "display: block",
    "cursor: crosshair",
    "user-select: none",
    "touch-action: none",
    "pointer-events: auto"
  ].join(";");

  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .surface {
        position: absolute;
        inset: 0;
        background: rgba(15, 23, 42, 0.12);
        cursor: crosshair;
      }
      .selection {
        position: absolute;
        display: none;
        box-sizing: border-box;
        border: 2px solid #1a73e8;
        background: rgba(255, 255, 255, 0.04);
        box-shadow: 0 0 0 999999px rgba(15, 23, 42, 0.38);
        pointer-events: none;
      }
      .size {
        position: absolute;
        display: none;
        padding: 4px 7px;
        border-radius: 5px;
        background: rgba(15, 23, 42, 0.92);
        color: #ffffff;
        font: 12px/1.2 Arial, sans-serif;
        white-space: nowrap;
        pointer-events: none;
      }
      .hint {
        position: absolute;
        top: 18px;
        left: 50%;
        transform: translateX(-50%);
        padding: 8px 12px;
        border-radius: 7px;
        background: rgba(15, 23, 42, 0.92);
        color: #ffffff;
        font: 13px/1.35 Arial, sans-serif;
        white-space: nowrap;
        pointer-events: none;
      }
      .edge {
        position: absolute;
        display: none;
        pointer-events: none;
        background: rgba(26, 115, 232, 0.18);
      }
      .edge.top, .edge.bottom { left: 0; right: 0; height: 24px; }
      .edge.left, .edge.right { top: 0; bottom: 0; width: 24px; }
      .edge.top { top: 0; }
      .edge.bottom { bottom: 0; }
      .edge.left { left: 0; }
      .edge.right { right: 0; }
    </style>
    <div class="surface"></div>
    <div class="selection"></div>
    <div class="size"></div>
    <div class="hint">드래그하여 영역을 선택하세요 · Esc 키로 취소</div>
    <div class="edge top"></div>
    <div class="edge right"></div>
    <div class="edge bottom"></div>
    <div class="edge left"></div>
  `;

  const surface = shadow.querySelector(".surface");
  const selection = shadow.querySelector(".selection");
  const sizeLabel = shadow.querySelector(".size");
  const hint = shadow.querySelector(".hint");
  const edgeElements = {
    top: shadow.querySelector(".edge.top"),
    right: shadow.querySelector(".edge.right"),
    bottom: shadow.querySelector(".edge.bottom"),
    left: shadow.querySelector(".edge.left")
  };

  let dragging = false;
  let finished = false;
  let pointerId = null;
  let startPageX = 0;
  let startPageY = 0;
  let currentPageX = 0;
  let currentPageY = 0;
  let lastClientX = 0;
  let lastClientY = 0;
  let animationFrameId = 0;

  function sendRuntimeMessage(message) {
    try {
      return chrome.runtime.sendMessage(message);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  function nextPaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }

  function getRectangle() {
    const left = Math.min(startPageX, currentPageX);
    const top = Math.min(startPageY, currentPageY);
    const right = Math.max(startPageX, currentPageX);
    const bottom = Math.max(startPageY, currentPageY);

    return {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top
    };
  }

  function drawRectangle() {
    const rectangle = getRectangle();
    const viewportLeft = rectangle.x - window.scrollX;
    const viewportTop = rectangle.y - window.scrollY;

    selection.style.display = "block";
    selection.style.left = `${viewportLeft}px`;
    selection.style.top = `${viewportTop}px`;
    selection.style.width = `${rectangle.width}px`;
    selection.style.height = `${rectangle.height}px`;

    sizeLabel.textContent = `${Math.round(rectangle.width)} × ${Math.round(rectangle.height)}`;
    sizeLabel.style.display = "block";

    const labelLeft = Math.max(8, Math.min(window.innerWidth - 110, viewportLeft + 6));
    const labelTopCandidate = viewportTop + rectangle.height + 7;
    const labelTop = labelTopCandidate + 30 < window.innerHeight
      ? labelTopCandidate
      : Math.max(8, viewportTop - 27);

    sizeLabel.style.left = `${labelLeft}px`;
    sizeLabel.style.top = `${labelTop}px`;
  }

  function edgeSpeed(position, viewportSize) {
    const zone = Math.min(EDGE_ZONE, Math.max(32, viewportSize * 0.16));

    if (position < zone) {
      const ratio = (zone - Math.max(0, position)) / zone;
      return -MAX_SCROLL_PER_FRAME * ratio * ratio;
    }

    if (position > viewportSize - zone) {
      const ratio = (Math.min(viewportSize, position) - (viewportSize - zone)) / zone;
      return MAX_SCROLL_PER_FRAME * ratio * ratio;
    }

    return 0;
  }

  function updateEdgeIndicators(horizontalSpeed, verticalSpeed) {
    edgeElements.left.style.display = horizontalSpeed < -0.2 ? "block" : "none";
    edgeElements.right.style.display = horizontalSpeed > 0.2 ? "block" : "none";
    edgeElements.top.style.display = verticalSpeed < -0.2 ? "block" : "none";
    edgeElements.bottom.style.display = verticalSpeed > 0.2 ? "block" : "none";
  }

  function stopAutoScroll() {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = 0;
    }

    for (const edge of Object.values(edgeElements)) {
      edge.style.display = "none";
    }
  }

  function autoScrollFrame() {
    if (!dragging || finished) {
      stopAutoScroll();
      return;
    }

    const horizontalSpeed = edgeSpeed(lastClientX, window.innerWidth);
    const verticalSpeed = edgeSpeed(lastClientY, window.innerHeight);
    updateEdgeIndicators(horizontalSpeed, verticalSpeed);

    if (Math.abs(horizontalSpeed) > 0.2 || Math.abs(verticalSpeed) > 0.2) {
      const beforeX = window.scrollX;
      const beforeY = window.scrollY;
      window.scrollBy(horizontalSpeed, verticalSpeed);

      if (window.scrollX !== beforeX || window.scrollY !== beforeY) {
        currentPageX = lastClientX + window.scrollX;
        currentPageY = lastClientY + window.scrollY;
        drawRectangle();
      }
    }

    animationFrameId = requestAnimationFrame(autoScrollFrame);
  }

  function resetSelection(message) {
    dragging = false;
    pointerId = null;
    stopAutoScroll();
    selection.style.display = "none";
    sizeLabel.style.display = "none";
    hint.textContent = message || "드래그하여 영역을 선택하세요 · Esc 키로 취소";
  }

  function cleanup(notifyCancellation) {
    if (finished) return;
    finished = true;
    dragging = false;
    stopAutoScroll();
    window.removeEventListener("keydown", onKeyDown, true);
    host.removeEventListener(CANCEL_EVENT, onForcedCancel);
    host.remove();

    if (notifyCancellation) {
      sendRuntimeMessage({ type: CANCEL_MESSAGE }).catch(() => {});
    }
  }

  function showToast(text, successful) {
    const toastHost = document.createElement("div");
    toastHost.style.cssText = [
      "all: initial",
      "position: fixed",
      "left: 50%",
      "bottom: 24px",
      "transform: translateX(-50%)",
      "z-index: 2147483647",
      "pointer-events: none"
    ].join(";");

    const toastShadow = toastHost.attachShadow({ mode: "closed" });
    const toast = document.createElement("div");
    toast.textContent = text;
    toast.style.cssText = [
      "padding: 9px 13px",
      "border-radius: 7px",
      `background: ${successful ? "rgba(21, 128, 61, 0.95)" : "rgba(185, 28, 28, 0.95)"}`,
      "color: white",
      "font: 13px/1.35 Arial, sans-serif",
      "box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25)",
      "white-space: nowrap"
    ].join(";");

    toastShadow.appendChild(toast);
    document.documentElement.appendChild(toastHost);
    setTimeout(() => toastHost.remove(), 2200);
  }

  async function finishSelection() {
    const rectangle = getRectangle();

    if (rectangle.width < MIN_SELECTION_SIZE || rectangle.height < MIN_SELECTION_SIZE) {
      resetSelection("영역이 너무 작습니다. 다시 드래그하세요 · Esc 키로 취소");
      return;
    }

    finished = true;
    dragging = false;
    stopAutoScroll();
    window.removeEventListener("keydown", onKeyDown, true);
    host.removeEventListener(CANCEL_EVENT, onForcedCancel);
    host.remove();

    try {
      await nextPaint();
      const response = await sendRuntimeMessage({
        type: CAPTURE_MESSAGE,
        rectangle
      });

      if (!response?.ok) {
        throw new Error(response?.error || "화면 캡처에 실패했습니다.");
      }

      showToast("선택한 영역을 PNG로 저장했습니다.", true);
    } catch (error) {
      showToast(error?.message || "화면 캡처에 실패했습니다.", false);
    }
  }

  function onPointerDown(event) {
    if (!event.isTrusted || finished || event.button !== 0 || !event.isPrimary) return;

    event.preventDefault();
    event.stopPropagation();

    dragging = true;
    pointerId = event.pointerId;
    startPageX = event.clientX + window.scrollX;
    startPageY = event.clientY + window.scrollY;
    currentPageX = startPageX;
    currentPageY = startPageY;
    lastClientX = event.clientX;
    lastClientY = event.clientY;
    hint.textContent = "마우스를 놓으면 PNG로 저장됩니다 · Esc 키로 취소";

    try {
      host.setPointerCapture(pointerId);
    } catch {
      // Pointer capture is only a convenience. Selection still works without it.
    }

    drawRectangle();
    animationFrameId = requestAnimationFrame(autoScrollFrame);
  }

  function onPointerMove(event) {
    if (!event.isTrusted || !dragging || finished || event.pointerId !== pointerId) return;

    event.preventDefault();
    event.stopPropagation();
    lastClientX = event.clientX;
    lastClientY = event.clientY;
    currentPageX = event.clientX + window.scrollX;
    currentPageY = event.clientY + window.scrollY;
    drawRectangle();
  }

  function onPointerUp(event) {
    if (!event.isTrusted || !dragging || finished || event.pointerId !== pointerId) return;

    event.preventDefault();
    event.stopPropagation();
    lastClientX = event.clientX;
    lastClientY = event.clientY;
    currentPageX = event.clientX + window.scrollX;
    currentPageY = event.clientY + window.scrollY;

    try {
      host.releasePointerCapture(pointerId);
    } catch {
      // Ignore release errors.
    }

    finishSelection();
  }

  function onPointerCancel(event) {
    if (!event.isTrusted || !dragging || event.pointerId !== pointerId) return;
    resetSelection("선택이 취소되었습니다. 다시 드래그하세요 · Esc 키로 종료");
  }

  function onKeyDown(event) {
    if (!event.isTrusted || event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    cleanup(true);
  }

  function onForcedCancel() {
    cleanup(true);
  }

  function onContextMenu(event) {
    if (!event.isTrusted) return;
    event.preventDefault();
    event.stopPropagation();
    cleanup(true);
  }

  host.addEventListener("pointerdown", onPointerDown, true);
  host.addEventListener("pointermove", onPointerMove, true);
  host.addEventListener("pointerup", onPointerUp, true);
  host.addEventListener("pointercancel", onPointerCancel, true);
  host.addEventListener("contextmenu", onContextMenu, true);
  host.addEventListener(CANCEL_EVENT, onForcedCancel);
  window.addEventListener("keydown", onKeyDown, true);

  document.documentElement.appendChild(host);
  surface.focus?.();
  sendRuntimeMessage({ type: READY_MESSAGE }).catch(() => {});
})();
