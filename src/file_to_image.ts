(() => {
  type StatusState = "ready" | "working" | "success" | "error";

  interface ImageFormatInfo {
    extension: "jpg" | "png" | "gif";
    mimeType: string;
    label: string;
  }

  interface BuildProgressInfo {
    phase: "hashing" | "building" | "verifying";
    processedBytes: number;
    totalBytes: number;
    currentFileName: string;
    currentFileIndex: number;
    fileCount: number;
  }

  interface BuildResultInfo {
    blob: Blob;
    format: ImageFormatInfo;
    entries: Array<{ archiveName: string; size: number; crc32: number }>;
    coverBytes: number;
    archiveBytes: number;
    outputBytes: number;
  }

  interface FileToImageCoreApi {
    detectImageFormat(blob: Blob): Promise<ImageFormatInfo>;
    buildImageArchive(options: {
      cover: Blob;
      files: File[];
      onProgress?: (progress: BuildProgressInfo) => void;
      signal?: AbortSignal;
    }): Promise<BuildResultInfo>;
  }

  const availableCore = (globalThis as any).FileToImageCore as FileToImageCoreApi | undefined;
  if (!availableCore) {
    throw new Error("파일 포함 이미지 생성 모듈을 불러오지 못했습니다.");
  }

  const core: FileToImageCoreApi = availableCore;

  const DEFAULT_COVER_PATH = "assets/file_to_image_default.jpg";
  const MAX_RENDERED_FILES = 500;

  const coverDropZone = document.getElementById("cover-drop-zone") as HTMLElement;
  const coverPreview = document.getElementById("cover-preview") as HTMLImageElement;
  const coverInput = document.getElementById("cover-input") as HTMLInputElement;
  const resetCoverButton = document.getElementById("reset-cover-button") as HTMLButtonElement;
  const coverName = document.getElementById("cover-name") as HTMLElement;
  const coverFormat = document.getElementById("cover-format") as HTMLElement;
  const coverSize = document.getElementById("cover-size") as HTMLElement;
  const filesDropZone = document.getElementById("files-drop-zone") as HTMLElement;
  const filesInput = document.getElementById("files-input") as HTMLInputElement;
  const clearFilesButton = document.getElementById("clear-files-button") as HTMLButtonElement;
  const selectedFilesCount = document.getElementById("selected-files-count") as HTMLElement;
  const selectedFilesSize = document.getElementById("selected-files-size") as HTMLElement;
  const selectedFilesList = document.getElementById("selected-files-list") as HTMLElement;
  const outputNameInput = document.getElementById("output-name-input") as HTMLInputElement;
  const buildButton = document.getElementById("build-button") as HTMLButtonElement;
  const buildButtonLabel = document.getElementById("build-button-label") as HTMLElement;
  const progressPanel = document.getElementById("progress-panel") as HTMLElement;
  const progressTitle = document.getElementById("progress-title") as HTMLElement;
  const progressDetail = document.getElementById("progress-detail") as HTMLElement;
  const buildProgress = document.getElementById("build-progress") as HTMLProgressElement;
  const status = document.getElementById("status") as HTMLElement;
  const closeToolButton = document.getElementById("close-tool-button") as HTMLButtonElement;
  const cancelBuildButton = document.getElementById("cancel-build-button") as HTMLButtonElement;
  let buildAbort: AbortController | null = null;

  let coverFile: File | null = null;
  let coverFormatInfo: ImageFormatInfo | null = null;
  let coverPreviewUrl = "";
  let selectedFiles: File[] = [];
  let busy = false;
  let coverGeneration = 0;
  let coverLoading = false;
  const pendingDownloadUrls = new Set<string>();

  function setStatus(message: string, state: StatusState = "ready"): void {
    status.textContent = message;
    status.dataset.state = state;
  }

  function formatBytes(value: number): string {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes < 1024) return `${bytes.toLocaleString()}바이트`;

    const units = ["KB", "MB", "GB", "TB"];
    let size = bytes / 1024;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }

    const digits = size >= 100 ? 0 : size >= 10 ? 1 : 2;
    return `${size.toFixed(digits)} ${units[unitIndex]}`;
  }

  function sanitizeOutputBaseName(rawValue: string): string {
    const sanitized = String(rawValue || "")
      .trim()
      .replace(/[^A-Za-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64);
    return sanitized || "file_bundle";
  }

  function makeTimestamp(): string {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
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

  function updateControls(): void {
    const ready = Boolean(!coverLoading && coverFile && coverFormatInfo && selectedFiles.length > 0);
    buildButton.disabled = busy || !ready;
    coverInput.disabled = busy;
    filesInput.disabled = busy;
    resetCoverButton.disabled = busy;
    clearFilesButton.disabled = busy || selectedFiles.length === 0;
    outputNameInput.disabled = busy;
    closeToolButton.disabled = busy;
    cancelBuildButton.hidden = !busy;
    buildButton.setAttribute("aria-busy", String(busy));
    buildButtonLabel.textContent = busy
      ? "파일 포함 이미지를 만드는 중입니다"
      : "파일 포함 이미지 만들기";
  }

  function revokeCoverPreviewUrl(): void {
    if (!coverPreviewUrl) return;
    URL.revokeObjectURL(coverPreviewUrl);
    coverPreviewUrl = "";
  }

  async function setCoverFile(file: File, displayName = file.name, generation = ++coverGeneration): Promise<void> {
    if (busy || generation !== coverGeneration) return;
    coverLoading = true;
    updateControls();
    let previewUrl = "";
    try {
      const format = await core.detectImageFormat(file);
      if (generation !== coverGeneration) return;
      previewUrl = URL.createObjectURL(file);
      const decoded = new Image();
      decoded.src = previewUrl;
      await decoded.decode();
      if (!decoded.naturalWidth || !decoded.naturalHeight) throw new Error("표지 이미지를 디코딩하지 못했습니다.");
      if (generation !== coverGeneration) return;
      coverFile = file;
      coverFormatInfo = format;
      revokeCoverPreviewUrl();
      coverPreviewUrl = previewUrl;
      previewUrl = "";
      coverPreview.src = coverPreviewUrl;
      coverName.textContent = displayName || file.name || "표지 이미지";
      coverFormat.textContent = format.label;
      coverSize.textContent = formatBytes(file.size);
      setStatus("표지 이미지를 준비했습니다. 이미지 안에 담을 파일을 선택하십시오.", "ready");
    } catch (error) {
      if (generation !== coverGeneration) return;
      // An invalid current selection must not silently produce the previous cover.
      coverFile = null; coverFormatInfo = null;
      revokeCoverPreviewUrl(); coverPreview.removeAttribute("src");
      coverName.textContent = "표지 이미지 오류"; coverFormat.textContent = "-"; coverSize.textContent = "-";
      setStatus(`표지 이미지를 사용할 수 없습니다: ${String((error as Error)?.message || error)}`, "error");
    } finally {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      if (generation === coverGeneration) { coverLoading = false; coverInput.value = ""; updateControls(); }
    }
  }

  async function loadDefaultCover(): Promise<void> {
    if (busy) return;
    const generation = ++coverGeneration;
    coverLoading = true; updateControls();
    try {
      const runtimeUrl = globalThis.chrome?.runtime?.getURL
        ? globalThis.chrome.runtime.getURL(DEFAULT_COVER_PATH) : DEFAULT_COVER_PATH;
      const response = await fetch(runtimeUrl);
      if (!response.ok) throw new Error(`기본 표지 파일을 불러오지 못했습니다. HTTP ${response.status}`);
      const blob = await response.blob();
      if (generation !== coverGeneration) return;
      await setCoverFile(new File([blob], "default_cover.jpg", { type: "image/jpeg", lastModified: Date.now() }), "기본 표지 이미지", generation);
    } catch (error) {
      if (generation !== coverGeneration) return;
      coverFile = null; coverFormatInfo = null;
      revokeCoverPreviewUrl(); coverPreview.removeAttribute("src");
      coverName.textContent = "불러오기 실패"; coverFormat.textContent = "-"; coverSize.textContent = "-";
      setStatus(String((error as Error)?.message || "기본 표지를 불러오지 못했습니다."), "error");
    } finally {
      if (generation === coverGeneration) { coverLoading = false; updateControls(); }
    }
  }

  function addFiles(files: FileList | File[]): void {
    if (busy) return;
    const incoming = Array.from(files || []).filter((file): file is File => file instanceof File);
    if (incoming.length === 0) {
      setStatus("추가할 수 있는 파일을 찾지 못했습니다. 폴더는 먼저 압축한 뒤 파일로 추가하십시오.", "error");
      return;
    }

    selectedFiles = [...selectedFiles, ...incoming];
    filesInput.value = "";
    renderSelectedFiles();
    setStatus(`${incoming.length.toLocaleString()}개 파일을 목록에 추가했습니다.`, "ready");
  }

  function removeFile(index: number): void {
    if (busy || index < 0 || index >= selectedFiles.length) return;
    selectedFiles.splice(index, 1);
    renderSelectedFiles();
  }

  function renderSelectedFiles(): void {
    const totalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);
    selectedFilesCount.textContent = `${selectedFiles.length.toLocaleString()}개 파일`;
    selectedFilesSize.textContent = `총 ${formatBytes(totalSize)}`;
    clearFilesButton.disabled = busy || selectedFiles.length === 0;

    if (selectedFiles.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-message";
      empty.textContent = "아직 선택한 파일이 없습니다.";
      selectedFilesList.replaceChildren(empty);
      updateControls();
      return;
    }

    const fragment = document.createDocumentFragment();
    const renderCount = Math.min(MAX_RENDERED_FILES, selectedFiles.length);

    for (let index = 0; index < renderCount; index += 1) {
      const file = selectedFiles[index];
      const row = document.createElement("div");
      row.className = "selected-file";

      const copy = document.createElement("span");
      copy.className = "selected-file__copy";

      const name = document.createElement("span");
      name.className = "selected-file__name";
      name.textContent = file.name || `file_${index + 1}`;
      name.title = file.name || `file_${index + 1}`;

      const type = document.createElement("span");
      type.className = "selected-file__type";
      type.textContent = file.type || "형식 정보 없음";

      const size = document.createElement("span");
      size.className = "selected-file__size";
      size.textContent = formatBytes(file.size);

      const remove = document.createElement("button");
      remove.className = "file-remove-button";
      remove.type = "button";
      remove.textContent = "×";
      remove.title = `${file.name || "파일"} 제거`;
      remove.setAttribute("aria-label", `${file.name || "파일"} 제거`);
      remove.disabled = busy;
      remove.addEventListener("click", () => removeFile(index));

      copy.append(name, type);
      row.append(copy, size, remove);
      fragment.appendChild(row);
    }

    if (selectedFiles.length > renderCount) {
      const remaining = document.createElement("p");
      remaining.className = "empty-message";
      remaining.textContent = `목록 성능을 위해 나머지 ${(selectedFiles.length - renderCount).toLocaleString()}개 파일은 표시하지 않았습니다. 생성 결과에는 모두 포함됩니다.`;
      fragment.appendChild(remaining);
    }

    selectedFilesList.replaceChildren(fragment);
    updateControls();
  }

  function setDragState(element: HTMLElement, active: boolean): void {
    element.dataset.dragActive = String(active);
  }

  function preventDragDefaults(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  function handleCoverDrop(event: DragEvent): void {
    preventDragDefaults(event);
    setDragState(coverDropZone, false);
    const files = Array.from(event.dataTransfer?.files || []);
    const file = files[0];
    if (!file) {
      setStatus("표지로 사용할 이미지 파일을 찾지 못했습니다.", "error");
      return;
    }
    void setCoverFile(file);
  }

  function handleFilesDrop(event: DragEvent): void {
    preventDragDefaults(event);
    setDragState(filesDropZone, false);
    addFiles(event.dataTransfer?.files || []);
  }

  function updateProgress(progress: BuildProgressInfo): void {
    progressPanel.hidden = false;
    const total = Math.max(0, progress.totalBytes);

    if (progress.phase === "hashing") {
      const ratio = total > 0
        ? Math.min(1, progress.processedBytes / total)
        : Math.min(1, (progress.currentFileIndex + 1) / Math.max(1, progress.fileCount));
      buildProgress.value = Math.round(ratio * 94);
      progressTitle.textContent = "파일 무결성 값을 계산하고 있습니다.";
      progressDetail.textContent = progress.currentFileName
        ? `${progress.currentFileIndex + 1}/${progress.fileCount} · ${progress.currentFileName}`
        : `${progress.currentFileIndex + 1}/${progress.fileCount}`;
      return;
    }

    if (progress.phase === "building") {
      buildProgress.value = 97;
      progressTitle.textContent = "이미지와 ZIP 구조를 결합하고 있습니다.";
      progressDetail.textContent = `${progress.fileCount.toLocaleString()}개 파일`;
      return;
    }

    buildProgress.value = 99;
    progressTitle.textContent = "결과 파일의 ZIP 구조를 검증하고 있습니다.";
    progressDetail.textContent = "저장 직전 검사";
  }

  function downloadBlob(url: string, filename: string): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const downloadsApi = globalThis.chrome?.downloads;
      if (!downloadsApi || typeof downloadsApi.download !== "function") {
        reject(new Error("Chrome 다운로드 API를 사용할 수 없습니다."));
        return;
      }

      downloadsApi.download({
        url,
        filename,
        conflictAction: "uniquify",
        saveAs: false
      }, (downloadId: number | undefined) => {
        const runtimeError = globalThis.chrome?.runtime?.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message || "다운로드를 시작하지 못했습니다."));
          return;
        }
        if (!Number.isInteger(downloadId)) {
          reject(new Error("다운로드 식별자를 받지 못했습니다."));
          return;
        }
        resolve(downloadId as number);
      });
    });
  }

  function scheduleDownloadUrlCleanup(url: string): void {
    pendingDownloadUrls.add(url);
    window.setTimeout(() => {
      if (!pendingDownloadUrls.delete(url)) return;
      URL.revokeObjectURL(url);
    }, 300_000);
  }

  async function buildAndDownload(): Promise<void> {
    if (busy || coverLoading || !coverFile || !coverFormatInfo || selectedFiles.length === 0) return;

    busy = true;
    const controller = new AbortController();
    buildAbort = controller;
    progressPanel.hidden = false;
    buildProgress.value = 0;
    setStatus("선택한 파일을 읽고 있습니다. 파일이 크면 시간이 걸릴 수 있습니다.", "working");
    updateControls();

    try {
      const result = await core.buildImageArchive({
        cover: coverFile,
        files: [...selectedFiles],
        signal: controller.signal,
        onProgress: updateProgress
      });

      controller.signal.throwIfAborted();
      const baseName = sanitizeOutputBaseName(outputNameInput.value);
      outputNameInput.value = baseName;
      const filename = `file_bundles/${baseName}_${makeTimestamp()}.${result.format.extension}`;
      const objectUrl = URL.createObjectURL(result.blob);
      scheduleDownloadUrlCleanup(objectUrl);

      try {
        await downloadBlob(objectUrl, filename);
      } catch (error) {
        if (pendingDownloadUrls.delete(objectUrl)) URL.revokeObjectURL(objectUrl);
        throw error;
      }
      buildProgress.value = 100;
      progressTitle.textContent = "파일 포함 이미지 생성을 완료했습니다.";
      progressDetail.textContent = `${result.entries.length.toLocaleString()}개 파일 · ${formatBytes(result.outputBytes)}`;
      setStatus(
        `${filename} 저장을 시작했습니다. 이미지로 열거나 복사본의 확장자를 .zip으로 바꾸어 파일을 꺼낼 수 있습니다.`,
        "success"
      );
    } catch (error) {
      progressPanel.hidden = true;
      setStatus(controller.signal.aborted ? "파일 만들기를 취소했습니다." :
        error instanceof Error ? error.message : "파일 포함 이미지를 만들지 못했습니다.", controller.signal.aborted ? "ready" : "error");
    } finally {
      busy = false;
      buildAbort = null;
      updateControls();
    }
  }

  function handleKeyboardActivation(event: KeyboardEvent, action: () => void): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    action();
  }

  coverDropZone.addEventListener("click", () => {
    if (!busy) coverInput.click();
  });
  coverDropZone.addEventListener("keydown", (event) => {
    handleKeyboardActivation(event, () => {
      if (!busy) coverInput.click();
    });
  });
  coverDropZone.addEventListener("dragenter", (event) => {
    preventDragDefaults(event);
    setDragState(coverDropZone, true);
  });
  coverDropZone.addEventListener("dragover", (event) => {
    preventDragDefaults(event);
    setDragState(coverDropZone, true);
  });
  coverDropZone.addEventListener("dragleave", (event) => {
    preventDragDefaults(event);
    if (!coverDropZone.contains(event.relatedTarget as Node | null)) {
      setDragState(coverDropZone, false);
    }
  });
  coverDropZone.addEventListener("drop", handleCoverDrop);
  coverInput.addEventListener("change", () => {
    const file = coverInput.files?.[0];
    if (file) void setCoverFile(file);
  });
  resetCoverButton.addEventListener("click", () => void loadDefaultCover());

  filesDropZone.addEventListener("click", () => {
    if (!busy) filesInput.click();
  });
  filesDropZone.addEventListener("keydown", (event) => {
    handleKeyboardActivation(event, () => {
      if (!busy) filesInput.click();
    });
  });
  filesDropZone.addEventListener("dragenter", (event) => {
    preventDragDefaults(event);
    setDragState(filesDropZone, true);
  });
  filesDropZone.addEventListener("dragover", (event) => {
    preventDragDefaults(event);
    setDragState(filesDropZone, true);
  });
  filesDropZone.addEventListener("dragleave", (event) => {
    preventDragDefaults(event);
    if (!filesDropZone.contains(event.relatedTarget as Node | null)) {
      setDragState(filesDropZone, false);
    }
  });
  filesDropZone.addEventListener("drop", handleFilesDrop);
  filesInput.addEventListener("change", () => {
    if (filesInput.files) addFiles(filesInput.files);
  });
  clearFilesButton.addEventListener("click", () => {
    if (busy) return;
    selectedFiles = [];
    renderSelectedFiles();
    setStatus("선택한 파일 목록을 비웠습니다.", "ready");
  });

  outputNameInput.addEventListener("change", () => {
    outputNameInput.value = sanitizeOutputBaseName(outputNameInput.value);
  });
  async function closeCurrentToolTab(): Promise<void> {
    if (busy) return;

    const tabsApi = globalThis.chrome?.tabs;
    if (!tabsApi || typeof tabsApi.getCurrent !== "function" || typeof tabsApi.remove !== "function") {
      window.close();
      return;
    }

    tabsApi.getCurrent((tab: { id?: number } | undefined) => {
      const runtimeError = globalThis.chrome?.runtime?.lastError;
      if (runtimeError || typeof tab?.id !== "number" || !Number.isInteger(tab.id)) {
        window.close();
        return;
      }
      tabsApi.remove(tab.id);
    });
  }

  buildButton.addEventListener("click", () => void buildAndDownload());
  closeToolButton.addEventListener("click", () => void closeCurrentToolTab());
  cancelBuildButton.addEventListener("click", () => buildAbort?.abort());
  window.addEventListener("pagehide", () => buildAbort?.abort());

  window.addEventListener("beforeunload", () => {
    revokeCoverPreviewUrl();
  });

  renderSelectedFiles();
  void loadDefaultCover();
})();
