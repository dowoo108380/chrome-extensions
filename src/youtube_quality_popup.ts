/** Popup preferences only. Shared through the existing extension storage, not YouTube cookies. */
(() => {
  "use strict";
  const auto = document.getElementById("youtube-quality-auto") as HTMLInputElement | null;
  const height = document.getElementById("youtube-quality-height") as HTMLSelectElement | null;
  const premium = document.getElementById("youtube-quality-premium") as HTMLInputElement | null;
  const inspect = document.getElementById("youtube-quality-inspect") as HTMLButtonElement | null;
  const reapply = document.getElementById("youtube-quality-reapply") as HTMLButtonElement | null;
  const status = document.getElementById("youtube-quality-status");
  if (!auto || !height || !premium || !inspect || !reapply || !status) return;
  for (const value of ToolboxShared.QUALITY_HEIGHTS) {
    const option = document.createElement("option"); option.value = String(value);
    option.textContent = `${value}p${value === 2160 ? " · 4K" : value === 4320 ? " · 8K" : ""}`; height.append(option);
  }
  let settings = ToolboxShared.qualitySettings({}), loaded = false, busy = false, reading = false;
  let storedValues: Record<string, unknown> = {};
  const invalidKeys = new Set<keyof ToolboxShared.QualitySettings>();
  const journal = new ToolboxShared.SettingsReadJournal(Object.keys(ToolboxShared.QUALITY_DEFAULTS));
  let readGeneration = 0;
  function message(value: string, error = false): void { status!.textContent = value; status!.dataset.error = String(error); }
  function adoptStoredValues(values: Record<string, unknown>): void {
    storedValues = { ...values }; invalidKeys.clear();
    const effective: Record<string, unknown> = {};
    for (const key of Object.keys(ToolboxShared.QUALITY_DEFAULTS) as Array<keyof ToolboxShared.QualitySettings>) {
      if (!Object.hasOwn(values, key) || values[key] === undefined) continue;
      try { effective[key] = ToolboxShared.qualitySettings({ [key]: values[key] })[key]; }
      catch { invalidKeys.add(key); }
    }
    settings = ToolboxShared.qualitySettings(effective); loaded = true; render();
  }
  function showInvalidSettings(): boolean {
    if (!invalidKeys.size) return false;
    message("저장된 화질 설정 일부가 올바르지 않아 기본값으로 표시합니다. 이 패널에서 값을 선택하면 잘못된 항목을 함께 복구합니다.", true);
    return true;
  }
  function render(): void {
    auto!.checked = settings.youtubePreferredQualityEnabled;
    height!.value = String(settings.youtubePreferredQualityHeight);
    premium!.checked = settings.youtubeQualityPremiumPreferred;
    auto!.disabled = height!.disabled = premium!.disabled = !loaded || busy;
    inspect!.disabled = reading;
    reapply!.disabled = !loaded || busy || reading || !settings.youtubePreferredQualityEnabled;
  }
  async function read(): Promise<void> {
    const start = journal.mark(), generation = ++readGeneration;
    try {
      const data = await ToolboxShared.readStorage(chrome.storage.local, chrome.runtime, { ...ToolboxShared.QUALITY_DEFAULTS });
      if (generation !== readGeneration) return;
      adoptStoredValues(journal.merge(data, start));
      if (showInvalidSettings()) return;
      message(settings.youtubePreferredQualityEnabled ? "자동 선택 설정이 켜져 있습니다. 실제 영상의 선택 결과는 ‘현재 상태 확인’에서 확인하세요." : "자동 선택이 꺼져 있습니다. 켜면 준비된 일반 YouTube 영상에 적용합니다.");
    } catch (error) {
      if (generation !== readGeneration) return;
      loaded = false; render(); message(ToolboxShared.errorMessage(error), true);
    }
  }
  async function save(key: keyof ToolboxShared.QualitySettings, value: boolean | number): Promise<void> {
    if (!loaded || busy) { render(); return; }
    busy = true; render();
    try {
      ToolboxShared.qualitySettings({ ...settings, [key]: value });
      // Repair only invalid fields plus the user's actual change. Valid sibling
      // preferences remain untouched, including changes from another popup.
      const repairs = Object.fromEntries([...invalidKeys].map(k => [k, settings[k]]));
      await ToolboxShared.writeStorage(chrome.storage.local, chrome.runtime, { ...repairs, [key]: value });
      const start = journal.mark();
      const data = await ToolboxShared.readStorage(chrome.storage.local, chrome.runtime, { ...ToolboxShared.QUALITY_DEFAULTS });
      const actual = journal.merge(data, start);
      // A later onChanged value supersedes this request, including while readback waits.
      adoptStoredValues(actual);
      if (actual[key] !== value) throw new Error("저장 결과가 요청값과 다릅니다. 다른 탭의 변경 여부를 확인하세요.");
      if (showInvalidSettings()) return;
      message("설정을 저장했습니다. 다른 탭에도 공유하며, 화질을 수동 변경한 영상은 그대로 유지합니다.");
    } catch (error) { message(ToolboxShared.errorMessage(error), true); }
    finally { busy = false; render(); }
  }
  auto.addEventListener("change", e => { if (e.isTrusted) void save("youtubePreferredQualityEnabled", auto.checked); });
  premium.addEventListener("change", e => { if (e.isTrusted) void save("youtubeQualityPremiumPreferred", premium.checked); });
  height.addEventListener("change", e => { if (e.isTrusted) void save("youtubePreferredQualityHeight", Number(height.value)); });
  chrome.storage.onChanged.addListener((changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== "local") return;
    const next: Record<string, unknown> = { ...storedValues }; let changed = false;
    for (const key of Object.keys(ToolboxShared.QUALITY_DEFAULTS)) if (Object.hasOwn(changes, key)) {
      changed = true; next[key] = changes[key].newValue;
    }
    if (!changed) return;
    journal.record(changes);
    try {
      adoptStoredValues(next);
      if (showInvalidSettings()) return;
      if (!busy && !reading) message(settings.youtubePreferredQualityEnabled
        ? "공유된 설정을 반영했습니다. 실제 적용 결과는 현재 상태 확인에서 확인하세요."
        : "자동 선택이 꺼져 있습니다. 현재 영상의 화질은 그대로 유지합니다.");
    }
    catch (error) { loaded = false; render(); message(ToolboxShared.errorMessage(error), true); }
  });
  async function current(restart: boolean): Promise<void> {
    if (reading) return;
    reading = true; render(); message(restart ? "현재 영상의 자동 선택을 다시 시작합니다." : "현재 영상의 화질 상태를 읽습니다.");
    try {
      const tabId = await new Promise<number>((resolve, reject) => chrome.tabs.query({ active: true, currentWindow: true }, (tabs: { id?: number }[]) => {
        const error = chrome.runtime.lastError;
        if (error || !Number.isInteger(tabs[0]?.id)) reject(new Error(error?.message || "현재 탭을 찾지 못했습니다."));
        else resolve(tabs[0].id!);
      }));
      const result = await new Promise<Record<string, unknown>>((resolve, reject) => chrome.tabs.sendMessage(tabId,
        { type: restart ? ToolboxShared.QUALITY_MESSAGES.REAPPLY : ToolboxShared.QUALITY_MESSAGES.STATUS }, { frameId: 0 }, (reply: unknown) => {
          const error = chrome.runtime.lastError;
          if (error) reject(new Error("현재 YouTube 화질 상태를 읽지 못했습니다. 일반 영상 탭인지 확인하고 업데이트 후 새로 고쳐 주세요."));
          else if (!ToolboxShared.isRecord(reply) || reply.ok !== true || !ToolboxShared.isRecord(reply.result)) reject(new Error(ToolboxShared.isRecord(reply) && typeof reply.error === "string" ? reply.error : "화질 상태 응답이 올바르지 않습니다."));
          else resolve(reply.result);
        }));
      const labels: Record<string, string> = { off: "꺼짐", waiting: "대기", selecting: "선택 중", selected: "메뉴 선택 확인", manual: "수동 변경 유지", error: "확인 실패", unsupported: "지원 대상 아님" };
      const entries = Array.isArray(result.availableChoices) ? result.availableChoices.filter(ToolboxShared.isRecord) : [];
      message([`상태: ${labels[String(result.state)] || "미확인"}`, String(result.detail || ""),
        result.selectionVerified && result.selectedLabel ? `확인한 메뉴 선택: ${result.selectedLabel}` : "",
        result.decodedWidth && result.decodedHeight ? `지금 디코딩 중인 영상: ${result.decodedWidth} × ${result.decodedHeight}px` : "실제 디코딩 해상도: 아직 확인되지 않음",
        entries.length ? `읽은 해상도: ${[...new Set(entries.map(e => `${e.height}p`))].join(", ")}` : "",
        String(result.premiumNote || ""), restart ? "적용 완료 여부는 잠시 뒤 현재 상태 확인을 눌러 확인하세요." : ""].filter(Boolean).join("\n"), result.state === "error");
    } catch (error) { message(ToolboxShared.errorMessage(error), true); }
    finally { reading = false; render(); }
  }
  inspect.addEventListener("click", e => { if (e.isTrusted) void current(false); });
  reapply.addEventListener("click", e => { if (e.isTrusted) void current(true); });
  void read();
})();
