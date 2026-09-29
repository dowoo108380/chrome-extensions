/** Test-only DOM variants. These are controlled fixtures, NOT captured live YouTube DOM.
 * Based on the supported #related / watch-next renderer boundaries, with independent
 * empty/hidden responsive containers, native styles, previews and delayed content.
 * No production settings or network endpoints are changed by this file.
 */
namespace LayoutRegressionFixture {
  export type Options = { dark?: boolean; duplicate?: "hidden" | "empty" | "visible"; deferred?: boolean; bareRenderer?: boolean };
  export let watch: HTMLElement, primary: HTMLElement, secondary: HTMLElement, origin: HTMLElement;
  export let description: HTMLElement, comments: HTMLElement, related: HTMLElement, renderer: HTMLElement;
  export let duplicate: HTMLElement | null = null;
  export let mainVideo: HTMLVideoElement, preview: HTMLVideoElement | null = null, frame: HTMLIFrameElement | null = null;
  export let clicks = 0, filterClicks = 0;
  export let savedLinks: HTMLAnchorElement[] = [];
  export let nativeLoadCount = 0;
  export const scriptErrors: string[] = [];
  function element(tag: string, id = "", text = ""): HTMLElement {
    const node = document.createElement(tag);
    if (id) node.id = id;
    if (text) node.textContent = text;
    return node;
  }
  function link(label: string, id: string): HTMLAnchorElement {
    const node = document.createElement("a"); node.href = `https://www.youtube.com/watch?v=${id}`; node.textContent = label;
    return node;
  }
  export function fill(target: HTMLElement): void {
    renderer = element("ytd-watch-next-secondary-results-renderer");
    const filters = element("yt-chip-cloud-renderer");
    for (const label of ["모두", "게임 개발", "감상한 동영상"]) {
      const button = document.createElement("button"); button.type = "button"; button.textContent = label;
      button.addEventListener("click", () => { filterClicks++; }); filters.append(button);
    }
    const items = element("div", "items");
    for (let i = 0; i < 16; i++) {
      const card = element("ytd-compact-video-renderer");
      const thumbnail = element("div", "", `영상 ${i + 1}`); thumbnail.className = "fixture-thumbnail";
      const copy = element("div");
      const anchor = link(["작은 장면에서 시작하는 게임 개발", "빛과 움직임으로 만드는 공간", "캐릭터 표현과 인터랙션을 살펴봅니다"][i % 3], `fixture_${i}`);
      anchor.addEventListener("click", event => { clicks++; event.preventDefault(); }); // Test-only: do not navigate away from the fixture.
      copy.append(anchor, element("p", "", `개발 이야기 · 조회수 ${(i + 1) * 3}천회`));
      card.append(thumbnail, copy); items.append(card); savedLinks.push(anchor);
    }
    const continuation = element("ytd-continuation-item-renderer", "fixture-continuation", "실제 목록 끝의 시험용 요소");
    renderer.append(filters, items, continuation); target.append(renderer);
  }
  export function build(options: Options = {}): void {
    clicks = 0; filterClicks = 0; savedLinks = []; duplicate = null; preview = null; frame = null;
    document.documentElement.lang = "ko";
    document.documentElement.toggleAttribute("dark", Boolean(options.dark));
    const style = document.createElement("style");
    style.textContent = `
      * { box-sizing:border-box; } body { margin:0; background:#fafafa; color:#181818; font:14px/1.6 Arial,sans-serif; }
      html[dark] body { background:#0f0f0f; color:#eee; }
      [hidden] { display:none!important; } ytd-watch-flexy,ytd-watch-metadata,ytd-text-inline-expander,ytd-comments,ytd-comments-header-renderer,ytd-watch-next-secondary-results-renderer,yt-chip-cloud-renderer { display:block; }
      .fixture-heading { height:64px; padding:18px 28px; border-bottom:1px solid #8884; font-size:17px; }
      #columns { display:grid; grid-template-columns:minmax(0,1fr) minmax(320px,42%); align-items:start; gap:24px; margin:auto; padding:24px; max-width:1680px; }
      #primary,#secondary,#secondary-inner { min-width:0; }
      #movie_player { background:#16191d; aspect-ratio:16/9; position:relative; }
      #movie_player>video { width:100%;height:100%;object-fit:contain; }
      h1 { font-size:22px;line-height:1.4; } #description { background:#eee; border-radius:12px; padding:12px; }
      html[dark] #description { background:#272727; }
      #description-inner { padding:6px; border-radius:10px; background:inherit; }
      #description p { margin:0 0 18px; } #description a { color:#3ea6ff; }
      #description .meta { font-weight:600; margin-bottom:14px; }
      #description [data-more] { display:none; } #description [is-expanded] [data-more] { display:block; }
      #collapse,#description [is-expanded] #expand { display:none; } #description [is-expanded] #collapse { display:inline; }
      #description button { background:transparent;border:0;color:inherit;font-size:14px;font-weight:600;padding:6px 0;cursor:pointer; }
      .comment { padding:16px 0;border-bottom:1px solid #8882; } .comment p { margin:8px 0; }
      ytd-compact-video-renderer { display:flex;gap:12px;margin:0 0 14px;min-width:0; }
      ytd-compact-video-renderer>div:last-child { flex:1;min-width:0; }
      ytd-compact-video-renderer a { display:block;font-weight:600;line-height:1.5;text-decoration:none;color:inherit; }
      ytd-compact-video-renderer p { margin:5px 0;color:#888;font-size:12px; }
      .fixture-thumbnail { display:flex;align-items:center;justify-content:center;flex:0 0 42%;aspect-ratio:16/9;align-self:flex-start;background:#527567;border-radius:8px;color:#fff; }
      ytd-compact-video-renderer:nth-child(3n+2) .fixture-thumbnail { background:#5f678c; }
      ytd-compact-video-renderer:nth-child(3n) .fixture-thumbnail { background:#806950; }
      yt-chip-cloud-renderer { display:flex;gap:7px;flex-wrap:wrap;margin:0 0 16px; }
      yt-chip-cloud-renderer button { background:#ddd;border:0;border-radius:7px;padding:6px 10px;font-size:12px;cursor:pointer;color:inherit; }
      html[dark] yt-chip-cloud-renderer button { background:#292929; }
      ytd-continuation-item-renderer { display:block;color:#888;padding:20px 0;text-align:center; }
      .native-card-outside { margin:24px;padding:16px;background:rgb(39,39,39);color:white;border-radius:12px; }
      #fixture-unrelated { margin:24px; }
      @media(max-width:980px) { #columns { display:block;padding:14px; } #secondary { margin-top:24px; } }
    `;
    document.head.append(style);
    const heading = element("div", "", "Browser Toolbox · 로컬 레이아웃 재현 시험"); heading.className = "fixture-heading";
    watch = element("ytd-watch-flexy"); const columns = element("div", "columns");
    primary = element("div", "primary"); secondary = element("div", "secondary"); origin = element("div", "secondary-inner");
    const player = element("div", "movie_player"); player.className = "html5-video-player";
    mainVideo = document.createElement("video"); mainVideo.muted = true; mainVideo.preload = "auto"; player.append(mainVideo);
    const below = element("div", "below"), metadata = element("ytd-watch-metadata");
    metadata.append(element("h1", "", "작은 장면부터 살펴보는 게임 제작 이야기"));
    description = element("div", "description"); const inner = element("div", "description-inner"), expander = element("ytd-text-inline-expander");
    const meta = element("p", "", "조회수 11회 · 9분 전 · #게임개발"); meta.className = "meta";
    expander.append(meta, element("p", "", "기차도 퇴근하면 모닥불 앞에서 쉬고, 하늘을 달리고, 방을 꾸미러 들어갔다가 낚시까지 합니다."));
    const more = element("div"); more.setAttribute("data-more", "");
    for (let i = 0; i < 12; i++) {
      const paragraph = element("p", "", `설명 ${i + 1}. 원래 페이지의 문장과 링크를 보존하면서 한 겹의 배경 안에서 읽습니다. `);
      paragraph.append(link(`${String(i).padStart(2, "0")}:00 영상의 해당 부분`, `chapter_${i}`)); more.append(paragraph);
    }
    const input = document.createElement("input"); input.id = "fixture-input"; input.value = "편집 중인 원래 값";
    input.style.maxWidth = "100%"; more.append(input);
    const expand = document.createElement("button"), collapse = document.createElement("button"); expand.id = "expand"; collapse.id = "collapse";
    expand.textContent = "더보기"; collapse.textContent = "간략히";
    expand.addEventListener("click", () => expander.setAttribute("is-expanded", ""));
    collapse.addEventListener("click", () => expander.removeAttribute("is-expanded"));
    expander.append(more, expand, collapse); inner.append(expander); description.append(inner); metadata.append(description);
    comments = element("ytd-comments", "comments"); const commentHeader = element("ytd-comments-header-renderer");
    commentHeader.append(element("h2", "count", "댓글 0개")); comments.append(commentHeader);
    for (let i = 0; i < 16; i++) { const comment = element("div", "", `표시 상태 보존 시험 ${i + 1}`); comment.className = "comment"; comment.append(element("p", "", "댓글의 실제 노드와 읽던 위치를 유지합니다.")); comments.append(comment); }
    below.append(metadata, comments); primary.append(player, below);
    if (options.duplicate) {
      duplicate = element("div", "related");
      if (options.duplicate !== "empty") fill(duplicate);
      if (options.duplicate === "hidden") duplicate.hidden = true;
      primary.append(duplicate);
    }
    related = element("div", "related"); if (!options.deferred) fill(related);
    if (options.bareRenderer) { related = renderer; }
    origin.append(related); secondary.append(origin); columns.append(primary, secondary); watch.append(columns);
    const outside = element("div", "", "이 원래 카드의 배경과 테두리는 변경하지 않습니다."); outside.className = "native-card-outside";
    document.body.replaceChildren(heading, watch, outside, element("p", "fixture-unrelated", "관련 없는 내용"));
  }
  export function addPreview(url: string): void {
    preview = document.createElement("video"); preview.muted = true; preview.src = url; preview.style.width = "120px"; preview.style.height = "70px";
    related.append(preview);
  }
  export function addFrame(): void {
    frame = document.createElement("iframe"); frame.src = "about:blank"; frame.style.width = "120px"; frame.style.height = "70px";
    frame.addEventListener("load", () => { nativeLoadCount++; }); related.append(frame);
  }
  export function read(): Record<string, unknown> {
    const w = globalThis as unknown as Record<string, { getStatus?: () => unknown }>;
    const pane = document.getElementById("btx-pane-videos");
    return {
      status: w.__browserToolboxYouTubeLayoutV1__?.getStatus?.(),
      relatedParent: related.parentElement?.id, relatedIdentity: pane?.firstElementChild === related,
      linksInPane: pane?.querySelectorAll("a[href]").length || 0,
      outsideRecommendations: [...secondary.querySelectorAll<HTMLAnchorElement>("ytd-compact-video-renderer a[href]")].filter(a => !a.closest("#btx-pane-videos")).length,
      descriptionBackground: getComputedStyle(description).backgroundColor,
      innerBackground: getComputedStyle(description.querySelector("#description-inner")!).backgroundColor,
      descriptionPadding: getComputedStyle(description).padding,
      outsideBackground: getComputedStyle(document.querySelector(".native-card-outside")!).backgroundColor,
      descriptionText: description.textContent,
      viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
      nativeLoadCount, mainRate: mainVideo.playbackRate, clicks, filterClicks
    };
  }
}

(globalThis as unknown as Record<string, unknown>).LayoutRegressionFixture = LayoutRegressionFixture;
