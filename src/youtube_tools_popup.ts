/** UI for opt-in YouTube features. Preferences are verified after storage completion. */
(() => {
  "use strict";
  const options = document.getElementById("youtube-tools-options");
  const status = document.getElementById("youtube-tools-status");
  const inspect = document.getElementById("youtube-tools-inspect") as HTMLButtonElement | null;
  const copyLayout = document.getElementById("youtube-tools-copy-layout") as HTMLButtonElement | null;
  const layoutJson = document.getElementById("youtube-tools-layout-json") as HTMLTextAreaElement | null;
  if (!options || !status || !inspect || !copyLayout || !layoutJson) return;
  const entries = new Map<string, { input: HTMLInputElement; row: HTMLElement; dependency?: string }>();
  let settings: Record<string, unknown> = { ...ToolboxShared.YOUTUBE_DEFAULTS, mediaControllerEnabled: false };
  let loaded = false, busy = false;
  const journal = new ToolboxShared.SettingsReadJournal([...Object.keys(ToolboxShared.YOUTUBE_DEFAULTS), "mediaControllerEnabled"]);
  let readGeneration = 0;
  function message(value: string, error = false): void { status!.textContent = value; status!.dataset.error = String(error); }
  function render(): void {
    for (const [key, entry] of entries) {
      const blocked = Boolean(entry.dependency && settings[entry.dependency] !== true);
      entry.input.checked = settings[key] === true; entry.input.disabled = !loaded || busy || blocked;
      entry.row.dataset.dependentOff = String(blocked);
      entry.input.title = blocked ? (entry.dependency === "mediaControllerEnabled" ? "먼저 HTML5 미디어 속도 조절을 켜 주세요." : "먼저 오른쪽 탭형 패널을 켜 주세요.") : "";
    }
  }
  for (const [group, title] of [["layout", "시청 페이지 레이아웃"], ["player", "플레이어 도구"]]) {
    const heading = document.createElement("h3"); heading.className = "youtube-tools-group"; heading.textContent = title; options.append(heading);
    for (const feature of ToolboxShared.YOUTUBE_FEATURES.filter(f => f.group === group)) {
      const row = document.createElement("div"); row.className = "youtube-tools-row";
      const copy = document.createElement("div"); copy.className = "youtube-tools-copy";
      const name = document.createElement("label"), description = document.createElement("p");
      const input = document.createElement("input"); input.type = "checkbox"; input.id = `btx-option-${feature.key}`; input.disabled = true;
      name.htmlFor = input.id; name.textContent = feature.label; description.textContent = feature.description;
      description.id = `${input.id}-help`; input.setAttribute("aria-describedby", description.id);
      copy.append(name, description);
      const wrap = document.createElement("label"); wrap.className = "switch"; wrap.htmlFor = input.id; wrap.setAttribute("aria-label", feature.label);
      const track = document.createElement("span"); track.className = "switch__track"; track.setAttribute("aria-hidden", "true");
      const thumb = document.createElement("span"); thumb.className = "switch__thumb"; track.append(thumb); wrap.append(input, track);
      row.append(copy, wrap); options.append(row);
      entries.set(feature.key, { input, row, dependency: "dependsOn" in feature ? feature.dependsOn : undefined });
      input.addEventListener("change", event => {
        if (!event.isTrusted || busy || !loaded) { render(); return; }
        const value = input.checked; busy = true; render(); message("설정을 저장하는 중입니다.");
        void ToolboxShared.writeStorage(chrome.storage.local, chrome.runtime, { [feature.key]: value })
          .then(async () => {
            const start = journal.mark();
            const values = await ToolboxShared.readStorage(chrome.storage.local, chrome.runtime, [feature.key]);
            return journal.merge(values, start);
          })
          .then(values => {
            settings[feature.key] = values[feature.key] === true;
            if (values[feature.key] !== value) throw new Error("저장된 값이 요청과 다릅니다. 다른 설정 변경이 있었는지 확인해 주세요.");
            settings[feature.key] = value; message(`${feature.label}: ${value ? "켬" : "끔"}. 실제 페이지 적용 상태는 아래 버튼으로 확인할 수 있습니다.`);
          })
          .catch(error => message(ToolboxShared.errorMessage(error), true))
          .finally(() => { busy = false; render(); });
      });
    }
  }
  const defaults = { ...ToolboxShared.YOUTUBE_DEFAULTS, mediaControllerEnabled: false };
  chrome.storage.onChanged.addListener((changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== "local") return;
    journal.record(changes);
    for (const key of Object.keys(defaults)) if (Object.hasOwn(changes, key)) settings[key] = changes[key].newValue ?? false;
    render();
  });
  async function read(): Promise<void> {
    const start = journal.mark(), generation = ++readGeneration;
    try {
      const values = await ToolboxShared.readStorage(chrome.storage.local, chrome.runtime, defaults);
      if (generation !== readGeneration) return;
      settings = journal.merge(values, start); loaded = true; render(); message("기능별로 켜고 끌 수 있습니다. 의존하는 기능이 꺼져 있으면 해당 항목은 비활성화됩니다.");
    } catch (error) { message(ToolboxShared.errorMessage(error), true); }
  }
  let readingLayout = false;
  async function readCurrentLayout(): Promise<Record<string, unknown>> {
    const tabId = await new Promise<number>((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs: { id?: number }[]) => {
        const error = chrome.runtime.lastError;
        if (error || !Number.isInteger(tabs[0]?.id)) reject(new Error(error?.message || "현재 탭을 찾지 못했습니다."));
        else resolve(tabs[0].id!);
      });
    });
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { type: ToolboxShared.YOUTUBE_STATUS_MESSAGE }, { frameId: 0 }, (reply: unknown) => {
        const error = chrome.runtime.lastError;
        if (error || !ToolboxShared.isRecord(reply) || reply.ok !== true || !ToolboxShared.isRecord(reply.result)) {
          reject(new Error("현재 탭의 YouTube 레이아웃 상태를 읽지 못했습니다. 일반 시청 페이지인지 확인하고 업데이트 후 새로 고쳐 주세요."));
        } else resolve(reply.result);
      });
    });
  }
  function describeLayout(result: Record<string, unknown>): string {
    const labels: Record<string, string> = { applied: "적용됨", partial: "확인된 일부 영역만 적용됨", waiting: "대상 정보가 아직 없음", unavailable: "지원 구조를 확인하지 못함", off: "꺼짐", expanded: "펼침 확인", "user-controlled": "사용자가 직접 제어함", unverified: "결과 미확인" };
    const sections = Array.isArray(result.movedSections) ? result.movedSections.map(n => ({ info: "정보", comments: "댓글", chat: "실시간 채팅", playlist: "재생목록", videos: "동영상" }[String(n)] || "확인 필요")).join(", ") : "";
    const sectionIssues = ToolboxShared.isRecord(result.sections) ? Object.entries(result.sections)
      .filter(([key, value]) => key !== (result.discussion === "chat" ? "comments" : "chat") &&
        ToolboxShared.isRecord(value) && value.state !== "mounted" && value.reason)
      .map(([key, value]) => `${({ info: "정보", comments: "댓글", chat: "실시간 채팅", playlist: "재생목록", videos: "동영상" } as Record<string, string>)[key] || key}: ${(value as Record<string, unknown>).reason}`) : [];
    const flow = ToolboxShared.isRecord(result.pageFlow) ? result.pageFlow : null;
    const playerSize = flow && ToolboxShared.isRecord(flow.playerSizing) ? flow.playerSizing : null;
    const playerLabels: Record<string, string> = { "matches-primary": "본문 폭과 일치", "narrower-than-primary": "본문보다 작음 · 내부 크기 제한 확인 필요", "wider-than-primary": "본문보다 큼 · 내부 크기 확인 필요", "native-mode": "영화관·전체 화면의 기본 크기", "width-not-applied": "일반 두 열 너비 조정이 적용되지 않음", "player-not-ready": "플레이어 준비 대기", "ambiguous-player": "플레이어를 하나로 확인하지 못함" };
    const viewportFit = playerSize && ToolboxShared.isRecord(playerSize.viewportFit) ? playerSize.viewportFit : null;
    const viewportLabels: Record<string, string> = {
      "native-boxes-match": "YouTube가 갱신한 영상·진행 막대·버튼 줄의 배치 일치 확인 (실제 탐색 검증과 별개)",
      "waiting-for-native-size": "YouTube의 기본 크기 갱신 대기",
      "waiting-for-media-metadata": "영상 초기화 대기 · 준비되면 크기를 다시 확인합니다",
      "waiting-for-native-controls": "넓은 배치 유지 · 기본 조작부가 표시되기를 기다리는 중",
      "playback-ended-width-retained": "재생 종료 · 넓은 배치 유지 (종료 화면은 일반 조작부와 구분)",
      "native-size-unconfirmed-width-retained": "넓은 배치 유지 · 현재 영상과 조작부의 배치 일치는 미확인",
      "waiting-for-navigation": "넓은 배치 유지 · 다음 영상 준비 대기",
      "native-size-update-unconfirmed": "기본 조작부의 동시 갱신을 확인하지 못해 폭 확장만 복원",
      "unverified-geometry": "현재 영상·진행 막대·버튼 줄의 배치가 일치하지 않음",
      "pending": "기본 플레이어 배치 확인 대기"
    };
    const ambientLabels: Record<string, string> = { contained: "장식 영역만 격리됨", "native-containment": "사이트의 기존 격리 유지", "not-present": "대상 없음", ambiguous: "대상을 확정하지 못함", "native-mode": "영화관·전체 화면의 원래 배치 사용", "unverified-decoration": "장식 전용 구조를 확인하지 못함", "style-not-applied": "격리 CSS가 적용되지 않음" };
    const lifecycle = ToolboxShared.isRecord(result.lifecycle) ? result.lifecycle : null;
    return [`탭형 패널: ${labels[String(result.layout)] || "미확인"}`,
      lifecycle ? `연결 상태: ${lifecycle.suspended ? "페이지 보관 중" : lifecycle.navigating ? "다음 영상의 실제 구조 대기" : lifecycle.blockedReason ? "충돌 해소 또는 새 영상 대기" : lifecycle.observerConnected ? "페이지 변경 관찰 중" : "관찰 해제"} · 코드 ${String(lifecycle.revision || "미확인")}` : "",
      lifecycle?.nativeVideoMatchesLocation === false ? "현재 주소와 페이지에 표시된 영상 식별자가 아직 일치하지 않습니다." : "",
      sections ? `실제로 이동한 영역: ${sections}` : "", `설명: ${labels[String(result.description)] || "미확인"}`,
      result.commentStatus ? `댓글: ${String(result.commentStatus)}` : "",
      result.yieldingToNativePanel ? "현재 YouTube 패널에 공간을 양보하고 있습니다." : "",
      flow ? `문서 / 화면 높이: ${flow.documentHeight} / ${flow.viewportHeight}px` : "",
      flow && typeof flow.viewportWidth === "number" && typeof flow.documentWidth === "number" ? `문서 / 화면 너비: ${flow.documentWidth} / ${flow.viewportWidth}px · 가로 스크롤: ${flow.horizontalScrollRange}px` : "",
      flow ? `좌우 여백: ${flow.widthSizingReason === "compact" ? "16px 적용 확인" : flow.widthSizingReason === "native-width-restored" ? "폭 확장 해제 · 원래 크기 복원 여부는 별도 확인" : flow.widthSizingReason === "native-player-not-ready" ? "기본 영상·조작부 준비 확인 전 · 폭 미변경" : flow.widthSizingReason === "native-mode" ? "영화관·전체 화면의 기본 배치" : flow.widthSizingReason === "narrow-window" || flow.widthSizingReason === "single-column" ? "좁은 창 또는 한 열의 기본 배치" : "현재 구조의 너비 적용 미확인"}` : "",
      playerSize ? `플레이어 크기: ${playerLabels[String(playerSize.state)] || "미확인"}${typeof playerSize.playerWidth === "number" ? ` · 플레이어 ${playerSize.playerWidth}px / 본문 ${playerSize.primaryContentWidth}px` : ""}` : "",
      viewportFit ? `내부 영상 배치: ${viewportLabels[String(viewportFit.state)] || "미확인"}` : "",
      viewportFit ? "기본 영상·진행 막대·조작부의 CSS와 내부 상태는 변경하지 않습니다." : "",
      viewportFit?.widthPhase === "blocked" ? `원래 영상·조작부 크기 복원: ${viewportFit.restoreVerified === true ? "확인" : "미확인"}` : "",
      playerSize && ToolboxShared.isRecord(playerSize.video) ? `실제 영상 요소: ${playerSize.video.width} × ${playerSize.video.height}px${viewportFit?.videoFitsPlayer === false ? " · 플레이어와 크기 불일치" : ""}` : "",
      flow ? `실제 페이지 스크롤 범위: ${flow.scrollRange}px (본문이 길면 정상입니다.)` : "",
      flow ? `배경 효과: ${ambientLabels[String(flow.ambientState)] || "미확인"}` : "",
      ...sectionIssues, result.issue ? String(result.issue) : "", result.descriptionIssue ? String(result.descriptionIssue) : ""].filter(Boolean).join("\n");
  }
  async function inspectLayout(copy: boolean): Promise<void> {
    if (readingLayout) return;
    readingLayout = true; inspect!.disabled = true; copyLayout!.disabled = true;
    message("현재 탭의 실제 레이아웃 크기를 읽는 중입니다.");
    try {
      const result = await readCurrentLayout();
      const description = describeLayout(result);
      if (copy) {
        // Only structural measurements; omit actual comment text and messages.
        const data = { extensionVersion: chrome.runtime.getManifest().version, measurement: "read-only-layout-geometry",
          layout: result.layout, movedSections: result.movedSections, lifecycle: result.lifecycle, sections: result.sections, issue: result.issue, pageFlow: result.pageFlow };
        layoutJson!.value = JSON.stringify(data, null, 2); layoutJson!.hidden = false;
        try { await navigator.clipboard.writeText(layoutJson!.value); }
        catch { throw new Error("진단은 생성했지만 클립보드에 복사하지 못했습니다. 표시된 텍스트 상자에서 직접 복사해 주세요."); }
        message("레이아웃 진단을 복사했습니다. URL·제목·자막·댓글 본문은 포함하지 않습니다.\n" + description, Boolean(result.issue || result.descriptionIssue));
      } else message(description, Boolean(result.issue || result.descriptionIssue));
    } catch (error) { message(ToolboxShared.errorMessage(error), true); }
    finally { readingLayout = false; inspect!.disabled = false; copyLayout!.disabled = false; }
  }
  inspect.addEventListener("click", event => { if (event.isTrusted) void inspectLayout(false); });
  copyLayout.addEventListener("click", event => { if (event.isTrusted) void inspectLayout(true); });
  void read();
})();
