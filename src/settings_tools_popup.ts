(() => {
  "use strict";
  function element<T extends HTMLElement>(id: string): T {
    const found = document.getElementById(id);
    if (!found) throw new Error(`설정 도구 요소가 없습니다: ${id}`);
    return found as T;
  }
  const exportButton = element<HTMLButtonElement>("settings-export");
  const importInput = element<HTMLInputElement>("settings-import-file");
  const rulesToggle = element<HTMLInputElement>("settings-include-rules");
  const globalToggle = element<HTMLInputElement>("settings-include-global");
  const applyButton = element<HTMLButtonElement>("settings-import-apply");
  const previewElement = element<HTMLElement>("settings-import-preview");
  const diagnosticButton = element<HTMLButtonElement>("settings-copy-diagnostics");
  const diagnosticText = element<HTMLTextAreaElement>("settings-diagnostics-text");
  const status = element<HTMLElement>("settings-tools-status");
  const overflowMode = element<HTMLSelectElement>("caption-overflow-mode");
  let backup: ToolboxSettings.Backup | null = null;
  let preview: ToolboxSettings.Preview | null = null;
  let busy = false;
  function options(): ToolboxSettings.ImportOptions { return { includeRules: rulesToggle.checked, includeGlobal: globalToggle.checked }; }
  function setStatus(text: string, error = false): void { status.textContent = text; status.dataset.error = String(error); }
  function setBusy(value: boolean): void {
    busy = value;
    for (const control of [exportButton, importInput, rulesToggle, globalToggle, diagnosticButton]) control.disabled = value;
    applyButton.disabled = value || !preview;
  }
  async function request(type: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, ...payload }, (raw: unknown) => {
        const error = chrome.runtime.lastError;
        if (error) { reject(new Error(error.message || "확장 프로그램 응답을 받지 못했습니다.")); return; }
        if (!ToolboxShared.isRecord(raw) || raw.ok !== true) {
          reject(new Error(ToolboxShared.isRecord(raw) && typeof raw.error === "string" ? raw.error : "올바른 응답을 받지 못했습니다.")); return;
        }
        resolve(raw.result);
      });
    });
  }
  async function updatePreview(): Promise<void> {
    preview = null;
    applyButton.disabled = true;
    if (!backup || busy) return;
    setBusy(true);
    try {
      const result = await request(ToolboxSettings.MESSAGES.PREVIEW, { backup, ...options() });
      if (!ToolboxShared.isRecord(result) || typeof result.digest !== "string" || !Array.isArray(result.changedKeys) || !result.changedKeys.every(k => typeof k === "string")) throw new Error("가져오기 미리보기 응답이 올바르지 않습니다.");
      preview = result as unknown as ToolboxSettings.Preview;
      previewElement.textContent = `백업 버전: ${backup.extensionVersion}\n변경되는 항목: ${preview.changedKeys.length}개\n${preview.changedKeys.join("\n")}\n숨김 규칙: ${preview.ruleSiteCount}개 사이트, ${preview.ruleCount}개 규칙\n전체 탭 활성 유지 설정: ${preview.includesGlobal ? "복원함 (디버거 연결 상태가 바뀔 수 있습니다)" : "변경하지 않음"}`;
      previewElement.hidden = false;
      applyButton.hidden = false;
      setStatus("미리보기만 완료했습니다. 내용을 확인한 뒤 ‘확인한 설정 적용’을 눌러야 저장됩니다.");
    } catch (error) {
      previewElement.hidden = true;
      setStatus(ToolboxShared.errorMessage(error), true);
    } finally { setBusy(false); }
  }
  exportButton.addEventListener("click", () => {
    if (busy) return;
    setBusy(true);
    void (async () => {
      const exported = ToolboxSettings.validateBackup(await request(ToolboxSettings.MESSAGES.EXPORT, { includeRules: rulesToggle.checked }));
      const bytes = ToolboxSettings.createZip(exported);
      ToolboxSettings.readZip(bytes); // Verify the emitted container before starting the download.
      const blob = new Blob([bytes], { type: "application/zip" });
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error || new Error("ZIP 파일을 읽지 못했습니다."));
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("ZIP 데이터 형식 오류"));
        reader.readAsDataURL(blob);
      });
      await new Promise<void>((resolve, reject) => {
        chrome.downloads.download({ url: dataUrl, filename: "browser_toolbox_settings.zip", saveAs: true, conflictAction: "uniquify" }, (id?: number) => {
          const error = chrome.runtime.lastError;
          if (error || !Number.isInteger(id)) reject(new Error(error?.message || "설정 ZIP 저장이 시작되지 않았습니다.")); else resolve();
        });
      });
      setStatus("설정 ZIP 다운로드를 시작했습니다. Chrome 다운로드 목록에서 저장 완료 여부를 확인할 수 있습니다.");
    })().catch(error => setStatus(ToolboxShared.errorMessage(error), true)).finally(() => setBusy(false));
  });
  importInput.addEventListener("change", () => {
    if (busy) return;
    backup = null; preview = null; applyButton.hidden = true; previewElement.hidden = true;
    const file = importInput.files?.[0];
    if (!file) return;
    setBusy(true);
    void (async () => {
      if (file.size > ToolboxSettings.MAX_BACKUP_BYTES) throw new Error("설정 ZIP은 8 MiB 이하여야 합니다.");
      backup = ToolboxSettings.readZip(new Uint8Array(await file.arrayBuffer()));
    })().catch(error => setStatus(ToolboxShared.errorMessage(error), true)).finally(() => {
      setBusy(false);
      // Allow selecting the same file again after a stale preview or a failed application.
      importInput.value = "";
      if (backup) void updatePreview();
    });
  });
  rulesToggle.addEventListener("change", () => void updatePreview());
  globalToggle.addEventListener("change", () => void updatePreview());
  applyButton.addEventListener("click", () => {
    if (busy || !backup || !preview) return;
    setBusy(true);
    const candidate = backup, digest = preview.digest;
    void request(ToolboxSettings.MESSAGES.APPLY, { backup: candidate, digest, ...options() }).then(raw => {
      if (!ToolboxShared.isRecord(raw) || typeof raw.changedCount !== "number") throw new Error("최종 설정 적용 결과를 확인하지 못했습니다.");
      setStatus(`${raw.changedCount}개 설정 항목을 적용하고 저장값을 다시 확인했습니다. 기존 페이지의 설정도 저장 변경 이벤트로 갱신됩니다.`);
      preview = null; applyButton.hidden = true; previewElement.hidden = true;
      window.dispatchEvent(new Event("browser-toolbox-settings-imported"));
    }).catch(error => {
      preview = null;
      setStatus(ToolboxShared.errorMessage(error), true);
    }).finally(() => setBusy(false));
  });
  diagnosticButton.addEventListener("click", () => {
    if (busy) return;
    setBusy(true);
    void request(ToolboxSettings.MESSAGES.DIAGNOSTICS).then(async result => {
      if (!ToolboxShared.isRecord(result)) throw new Error("진단 응답이 올바르지 않습니다.");
      diagnosticText.value = JSON.stringify(result, null, 2);
      diagnosticText.hidden = false;
      await navigator.clipboard.writeText(diagnosticText.value);
      setStatus("현재 탭의 진단 정보를 복사했습니다. URL·제목·쿠키·자막 내용은 포함하지 않으며 GPU의 VSR 적용 여부는 측정하지 않습니다.");
    }).catch(error => setStatus(`진단 정보 복사 실패: ${ToolboxShared.errorMessage(error)}. 생성된 내용이 있다면 아래에서 직접 선택할 수 있습니다.`, true)).finally(() => setBusy(false));
  });

  const OVERFLOW_KEY = "youtubeSyncedCaptionOverflowMode";
  const overflowJournal = new ToolboxShared.SettingsReadJournal([OVERFLOW_KEY]);
  let overflowReadGeneration = 0, overflowLoaded = false, overflowWriting = false;
  let confirmedOverflowMode = "scroll";
  function renderOverflowMode(): void {
    overflowMode.value = confirmedOverflowMode;
    overflowMode.disabled = !overflowLoaded || overflowWriting;
  }
  async function readOverflowMode(): Promise<void> {
    const generation = ++overflowReadGeneration, revision = overflowJournal.mark();
    try {
      const values = await ToolboxShared.readStorage(chrome.storage?.local, chrome.runtime, { [OVERFLOW_KEY]: "scroll" });
      if (generation !== overflowReadGeneration) return;
      const latest = overflowJournal.merge(values, revision);
      confirmedOverflowMode = latest[OVERFLOW_KEY] === "expand" ? "expand" : "scroll";
      overflowLoaded = true;
    } catch (error) {
      if (generation !== overflowReadGeneration) return;
      // A real storage event received during a failed read is still a confirmed value.
      if (overflowJournal.mark() === revision) overflowLoaded = false;
      setStatus(ToolboxShared.errorMessage(error), true);
    } finally { renderOverflowMode(); }
  }
  overflowMode.addEventListener("change", () => {
    if (!overflowLoaded || overflowWriting) { renderOverflowMode(); return; }
    const requested = overflowMode.value;
    overflowWriting = true; renderOverflowMode();
    void (async () => {
      try {
        await ToolboxShared.writeStorage(chrome.storage?.local, chrome.runtime, { [OVERFLOW_KEY]: requested });
      } catch (error) {
        setStatus(ToolboxShared.errorMessage(error), true);
      }
      // Await recovery/readback before enabling the control; never re-enable an unknown value.
      await readOverflowMode();
    })().finally(() => { overflowWriting = false; renderOverflowMode(); });
  });
  chrome.storage.onChanged.addListener((changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== "local" || !Object.prototype.hasOwnProperty.call(changes, OVERFLOW_KEY)) return;
    overflowJournal.record(changes);
    confirmedOverflowMode = changes[OVERFLOW_KEY].newValue === "expand" ? "expand" : "scroll";
    overflowLoaded = true; renderOverflowMode();
  });
  renderOverflowMode();
  void readOverflowMode();
})();
