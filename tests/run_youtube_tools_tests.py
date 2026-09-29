"""Local Chromium component tests, not an installed MV3 or live YouTube test.
Chrome APIs are the existing explicit doubles. Only host/watch URL predicates are
changed in memory. Layout, ownership, UI, playback and CSP code are unmodified.
"""
from pathlib import Path
import argparse, base64, json, re, shutil, time, traceback
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--chromium', default=shutil.which('chromium') or shutil.which('chrome'))
args = p.parse_args()
if not args.chromium: p.error('Provide --chromium pointing to an existing browser.')
OUT = ROOT / '.test_results'; OUT.mkdir(exist_ok=True)
MEDIA = 'data:video/webm;base64,' + base64.b64encode((ROOT/'tests/fixtures/test.webm').read_bytes()).decode()
results = {'environment': {'scope':'local Chromium DOM/media components, NOT installed extension/live YouTube/Windows/NVIDIA',
 'chrome_apis':'mocked with browser_harness.ts', 'patches':'YouTube host/watch predicates only, in-memory test copies',
 'security':"real require-trusted-types-for 'script'; trusted-types 'none' on strict cases", 'miniplayer':'not implemented; no simulated success'}, 'tests':{},'errors':[], 'passed':False}
FIXTURE = '''<!doctype html><html lang="ko"><head><meta charset="utf-8">__CSP__<title>YouTube layout local fixture</title><style>
*{box-sizing:border-box}body{margin:0;font:14px/1.6 Arial,sans-serif;background:#fafafa;color:#161616}html[dark] body{background:#0f0f0f;color:#eee}
header.fixture{height:64px;padding:18px 32px;border-bottom:1px solid #8884;font-size:18px}button{cursor:pointer}ytd-watch-flexy,ytd-comments,ytd-watch-metadata,ytd-text-inline-expander,ytd-comments-header-renderer,ytd-live-chat-frame,ytd-playlist-panel-renderer,ytd-engagement-panel-section-list-renderer{display:block}
#columns{display:flex;gap:24px;padding:24px;align-items:flex-start;max-width:1480px;margin:auto}#primary{flex:1;min-width:0}#secondary{width:380px;flex:none;min-width:0}
#movie_player{position:relative;background:#111;width:100%;aspect-ratio:16/9}video{display:block;width:100%;height:100%;object-fit:contain}
.ytp-chrome-bottom{position:absolute;bottom:0;left:12px;right:12px;height:54px}.ytp-right-controls{position:absolute;right:0;bottom:0;height:40px;display:flex}.ytp-right-controls>.native-button{width:40px;border:0;background:transparent;color:#fff}.ytp-progress-bar-container{height:4px;position:relative;cursor:pointer}.ytp-progress-list{height:4px;position:relative;background:#555}.ytp-play-progress{background:red;width:40%;height:100%;position:absolute;left:0}.ytp-load-progress{position:absolute;width:70%;height:100%;background:#888}.ytp-scrubber-button{position:absolute;left:40%;width:12px;height:12px;background:red;border-radius:50%;top:-4px}
h1{font-size:20px;line-height:1.5}.fixture-channel{display:flex;gap:12px;align-items:center;margin:12px 0}#upload-info{max-width:160px}#channel-name,#channel-name #text,#channel-name a{display:block;max-width:150px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:inherit}#description{padding:12px;background:#8881;border-radius:12px;margin-bottom:24px}#description:not([data-btx-layout-owned]){max-width:100%}#description [data-description-full]{display:none}#description [is-expanded] [data-description-full]{display:block}#description [is-expanded] #expand{display:none}#description #collapse{display:none}#description [is-expanded] #collapse{display:inline-block}
[hidden]{display:none!important}.comment{padding:14px 0;border-bottom:1px solid #8883}.recommendation{display:flex;gap:10px;margin-bottom:12px;min-height:80px}.thumbnail{width:128px;height:72px;background:#7c869466;border-radius:10px;flex:none}.recommendation a{color:inherit;text-decoration:none}#chat,#playlist,ytd-engagement-panel-section-list-renderer{margin-bottom:16px;padding:12px;border:1px solid #8885}#chat[collapsed],#playlist[collapsed]{height:32px;padding:4px}#chat[collapsed] iframe{display:none}
@media(max-width:980px){#columns{flex-direction:column;padding:14px}#secondary{width:100%}#primary{width:100%}}
</style></head><body><header class="fixture">YouTube · Browser Toolbox 로컬 시험 화면</header>
<ytd-watch-flexy><div id="columns"><div id="primary"><div id="movie_player" class="html5-video-player"><video muted preload="auto" class="html5-main-video" src="__MEDIA__"></video><div class="ytp-chrome-bottom"><div class="ytp-progress-bar-container"><div class="ytp-progress-list"><div class="ytp-load-progress"></div><div class="ytp-play-progress"></div><div class="ytp-scrubber-button"></div></div></div><div class="ytp-right-controls"><button class="native-button" aria-label="설정">⚙</button><button class="native-button" aria-label="전체 화면">⛶</button></div></div></div>
<div id="below"><ytd-watch-metadata><h1>영상과 설명, 댓글을 편리하게 정리하는 레이아웃</h1><div id="owner" class="fixture-channel"><div id="upload-info"><div id="channel-name"><span id="text"><a href="https://www.youtube.com/@sample">아주 긴 채널 이름을 그대로 읽을 수 있는 테스트 채널</a></span></div></div><button id="subscribe">구독</button></div><div id="description"><ytd-text-inline-expander><p>설명과 원래 링크, 입력 상태를 그대로 유지합니다.</p><p data-description-full>자막과 배속은 기존 컨트롤러를 사용하며, 레이아웃 코드는 YouTube의 내부 데이터와 실험 설정을 변경하지 않습니다.</p><input id="saved-description-input" value="보존할 입력 내용"><button id="expand" type="button">더보기</button><button id="collapse" type="button">간략히</button></ytd-text-inline-expander></div></ytd-watch-metadata><ytd-comments id="comments"><ytd-comments-header-renderer><h2 id="count">댓글 128개</h2></ytd-comments-header-renderer>__COMMENTS__</ytd-comments></div></div>
<div id="secondary"><div id="secondary-inner"><ytd-live-chat-frame id="chat" collapsed hidden><span>실시간 채팅</span><iframe srcdoc="&lt;p id='chat-value'&gt;실제 프레임 상태&lt;/p&gt;"></iframe></ytd-live-chat-frame><ytd-playlist-panel-renderer id="playlist" collapsed hidden>재생목록</ytd-playlist-panel-renderer><ytd-engagement-panel-section-list-renderer visibility="ENGAGEMENT_PANEL_VISIBILITY_HIDDEN" hidden>기존 부가 패널</ytd-engagement-panel-section-list-renderer><div id="related">__RELATED__</div></div></div></div></ytd-watch-flexy><p id="unrelated">관계없는 문구</p><button id="outside">바깥 영역</button></body></html>'''
FIXTURE=FIXTURE.replace('__MEDIA__',MEDIA).replace('__COMMENTS__',''.join(f'<div class="comment">댓글 {i+1} · 실제 기존 DOM과 이벤트를 유지하는 시험 문장입니다.</div>' for i in range(18))).replace('__RELATED__',''.join(f'<div class="recommendation"><div class="thumbnail"></div><a href="https://www.youtube.com/watch?v=fixture{i}">관련 동영상 {i+1}<br><small>기존 링크와 Chrome 탐색</small></a></div>' for i in range(12)))
def record(name,value):
    results['tests'][name]=value; print('PASS:',name,flush=True)
def inject(page,name):
    s=(ROOT/'dist'/name).read_text()
    predicates = ['isYouTubePage', 'isWatchPage'] if name=='youtube_layout.js' else ['isYouTubeDocument'] if name=='media_controller.js' else ['isYouTubeWatchPage'] if name=='youtube_ab_loop.js' else []
    for predicate in predicates:
        line=re.search(r'^    function '+predicate+r'\(\) \{[^\n]*',s,re.M)
        assert line, 'Missing guarded function: '+predicate
        pattern = r'^    function '+predicate+(r'\(\) \{[^\n]*\}' if line.group(0).rstrip().endswith('}') else r'\(\) \{.*?\n    \}')
        s,count=re.subn(pattern,f'    function {predicate}() {{ return true; }}',s,count=1,flags=re.S|re.M)
        assert count == 1, 'Only a single guarded function may be changed: '+predicate
    if name == 'youtube_layout.js': assert 'let settings = ' in s and 'const LAYOUT_KEYS' in s
    page.evaluate(s)
def fixture(browser,settings=None,strict=False,width=1280,dark=False):
    page=browser.new_page(viewport={'width':width,'height':900});page.set_default_timeout(8000)
    page.on('pageerror', lambda error: results['errors'].append(str(error)))
    csp='<meta http-equiv="Content-Security-Policy" content="require-trusted-types-for &#39;script&#39;; trusted-types &#39;none&#39;">' if strict else ''
    page.set_content(FIXTURE.replace('__CSP__',csp))
    page.wait_for_function('document.querySelector("video").readyState>=2')
    if dark: page.evaluate('document.documentElement.setAttribute("dark","")')
    page.evaluate((ROOT/'.test_dist/browser_harness.js').read_text())
    if settings: page.evaluate('v=>Object.assign(__test.settings,v)',settings)
    page.evaluate('''() => {
      window.nativeState = {expandedClicks:0,collapsedClicks:0,progressClicks:0,rateWrites:[],description:document.querySelector('#description'),comments:document.querySelector('#comments'),related:document.querySelector('#related')};
      const expander=document.querySelector('ytd-text-inline-expander');
      document.querySelector('#expand').addEventListener('click',()=>{nativeState.expandedClicks++;expander.setAttribute('is-expanded','')});
      document.querySelector('#collapse').addEventListener('click',()=>{nativeState.collapsedClicks++;expander.removeAttribute('is-expanded')});
      document.querySelector('.ytp-progress-bar-container').addEventListener('click',()=>nativeState.progressClicks++);
      const video=document.querySelector('video'), d=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'playbackRate');
      Object.defineProperty(video,'playbackRate',{configurable:true,get:()=>d.get.call(video),set:v=>{nativeState.rateWrites.push(v);d.set.call(video,v)}});
      window.__layoutState = () => ({status:globalThis.__browserToolboxYouTubeLayoutV1__?.getStatus(),descriptionParent:nativeState.description.parentElement?.id,commentsParent:nativeState.comments.parentElement?.id,relatedParent:nativeState.related.parentElement?.id,rate:video.playbackRate,writes:[...nativeState.rateWrites]});
    }''')
    inject(page,'toolbox_shared.js')
    # Styles are shipped as manifest CSS; the test installs that same CSS as text without any markup parser.
    for file in ['youtube_layout.css','youtube_progress_theme.css']:
        page.evaluate('css=>{const s=document.createElement("style");s.textContent=css;document.head.append(s)}',(ROOT/file).read_text())
    return page
LAYOUT={'youtubeLayoutTabsEnabled':True,'youtubeDescriptionExpandedEnabled':True,'youtubeCommentStatusEnabled':True,'youtubePanelScrollEnabled':True,'youtubeNativePanelsEnabled':True,'youtubeFullChannelNameEnabled':True}
try:
 with sync_playwright() as api:
    browser=api.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox'])
    results['environment']['browser']=browser.version
    page=fixture(browser);inject(page,'youtube_layout.js');page.wait_for_timeout(150)
    assert page.locator('#btx-youtube-tabs').count()==0
    assert page.locator('[data-btx-layout-owned]').count()==0
    record('all_features_off_no_layout_or_progress',page.evaluate('__layoutState()'));page.close()

    page=fixture(browser,LAYOUT,strict=True,dark=True);inject(page,'youtube_layout.js');page.wait_for_timeout(700)
    state=page.evaluate('__layoutState()');assert state['status']['layout']=='applied',state
    assert len(state['status']['movedSections'])==3
    assert state['descriptionParent']=='btx-pane-info' and state['commentsParent']=='btx-pane-comments' and state['relatedParent']=='btx-pane-videos'
    assert page.evaluate('nativeState.description===document.querySelector("#description")&&nativeState.comments===document.querySelector("#comments")&&nativeState.related===document.querySelector("#related")')
    assert page.evaluate('nativeState.expandedClicks')==1 and page.locator('ytd-text-inline-expander').get_attribute('is-expanded')==''
    assert page.locator('#btx-tab-comments').inner_text()=='댓글 128개'
    assert page.evaluate("typeof trustedTypes==='undefined'||trustedTypes.defaultPolicy===null")
    page.locator('#saved-description-input').fill('수정한 입력 상태도 보존합니다')
    page.locator('#btx-tab-comments').click();page.wait_for_timeout(60)
    assert page.locator('#btx-tab-comments').get_attribute('aria-selected')=='true'
    assert page.evaluate('document.querySelector("#btx-pane-comments").scrollHeight>document.querySelector("#btx-pane-comments").clientHeight')
    page.evaluate('document.querySelector("#count").textContent="댓글 129개"');page.wait_for_timeout(120)
    assert page.locator('#btx-tab-comments').inner_text()=='댓글 129개'
    page.keyboard.press('ArrowRight');assert page.locator('#btx-tab-videos').get_attribute('aria-selected')=='true'
    page.keyboard.press('Home');assert page.locator('#btx-tab-info').get_attribute('aria-selected')=='true'
    page.locator('#btx-tab-videos').click();page.screenshot(path=str(OUT/'youtube_layout_dark.png'))
    assert page.evaluate('document.documentElement.scrollWidth')<=1280
    record('strict_CSP_state_preserving_tabs_comments_keyboard',page.evaluate('__layoutState()'))
    page.evaluate('__test.update({youtubeLayoutTabsEnabled:false,youtubeDescriptionExpandedEnabled:false,youtubeFullChannelNameEnabled:false})');page.wait_for_timeout(700)
    assert page.locator('#btx-youtube-tabs').count()==0
    assert page.evaluate('document.querySelector("#description").parentElement.tagName')=='YTD-WATCH-METADATA'
    assert page.evaluate('document.querySelector("#comments").parentElement.id')=='below'
    assert page.evaluate('document.querySelector("#related").parentElement.id')=='secondary-inner'
    assert page.locator('#saved-description-input').input_value()=='수정한 입력 상태도 보존합니다'
    assert page.evaluate('nativeState.collapsedClicks')==1
    assert page.locator('[data-btx-layout-owned],[data-btx-channel-name]').count()==0
    record('off_restores_original_nodes_order_input_and_expansion',page.evaluate('__layoutState()'));page.close()

    page=fixture(browser,LAYOUT);inject(page,'youtube_layout.js');page.wait_for_timeout(650)
    page.locator('#collapse').click();page.wait_for_timeout(650)
    assert page.evaluate('nativeState.expandedClicks')==1
    assert page.evaluate('__layoutState().status.description')=='user-controlled'
    page.evaluate('__test.update({youtubeDescriptionExpandedEnabled:false})');page.wait_for_timeout(100)
    assert page.evaluate('nativeState.collapsedClicks')==1
    record('manual_collapse_not_forced_open',page.evaluate('__layoutState().status'));page.close()

    page=fixture(browser,LAYOUT);inject(page,'youtube_layout.js');page.wait_for_timeout(650)
    page.evaluate('document.querySelector("#chat").hidden=false;document.querySelector("#chat").removeAttribute("collapsed")');page.wait_for_timeout(150)
    assert page.evaluate('__layoutState().status.yieldingToNativePanel')
    assert page.evaluate('document.querySelector("#chat").parentElement.id')=='secondary-inner'
    page.locator('#btx-tab-comments').click();assert not page.evaluate('__layoutState().status.yieldingToNativePanel')
    page.evaluate('document.querySelector("#chat").setAttribute("collapsed","")');page.wait_for_timeout(100)
    assert not page.evaluate('__layoutState().status.yieldingToNativePanel')
    page.evaluate('document.querySelector("#playlist").hidden=false;document.querySelector("#playlist").removeAttribute("collapsed")');page.wait_for_timeout(100)
    assert page.evaluate('__layoutState().status.yieldingToNativePanel')
    page.evaluate('__test.update({youtubeNativePanelsEnabled:false})');page.wait_for_timeout(100)
    assert not page.evaluate('__layoutState().status.yieldingToNativePanel')
    assert page.evaluate('document.querySelector("#playlist").hasAttribute("collapsed")') is False
    record('native_panels_yield_without_clicking_or_reparenting',page.evaluate('__layoutState().status'));page.close()

    page=fixture(browser,LAYOUT,width=720);inject(page,'youtube_layout.js');page.wait_for_timeout(650)
    page.locator('#btx-tab-comments').click();page.wait_for_timeout(60)
    assert page.evaluate('document.documentElement.scrollWidth')<=720
    page.locator('#btx-youtube-tabs').screenshot(path=str(OUT/'youtube_layout_narrow.png'))
    record('single_column_no_horizontal_overflow',page.evaluate('({viewport:innerWidth,width:document.documentElement.scrollWidth,panel:document.querySelector("#btx-youtube-tabs").getBoundingClientRect().width})'));page.close()

    page=fixture(browser,LAYOUT);inject(page,'youtube_layout.js');page.wait_for_timeout(700)
    start=page.evaluate('__layoutState().status.reconciliationCount')
    for i in range(20): page.evaluate('i=>document.querySelector("#unrelated").textContent=String(i)',i);page.wait_for_timeout(40)
    after=page.evaluate('__layoutState().status.reconciliationCount');assert after==start,(start,after)
    page.evaluate('''() => {const node=document.createElement('ytd-comments-header-renderer');const h=document.createElement('h2');h.id='count';h.textContent='댓글 321개';node.append(h);document.querySelector('ytd-comments-header-renderer').replaceWith(node);}''');page.wait_for_timeout(100)
    assert page.locator('#btx-tab-comments').inner_text()=='댓글 321개'
    page.evaluate('document.dispatchEvent(new Event("yt-navigate-start"))');assert page.locator('#btx-youtube-tabs').count()==0
    page.evaluate('document.dispatchEvent(new Event("yt-navigate-finish"))');page.wait_for_timeout(700)
    assert page.locator('#btx-youtube-tabs').count()==1
    page.evaluate('window.dispatchEvent(new PageTransitionEvent("pagehide",{persisted:true}));window.dispatchEvent(new PageTransitionEvent("pageshow",{persisted:true}))');page.wait_for_timeout(700)
    assert page.locator('#btx-youtube-tabs').count()==1
    record('unrelated_mutations_ignored_SPA_and_synthetic_cache_restore',{'unrelatedReconciliations':after-start,'final':page.evaluate('__layoutState().status')});page.close()

    page=fixture(browser,{'youtubeDescriptionExpandedEnabled':True,'youtubeFullChannelNameEnabled':True},strict=True)
    inject(page,'youtube_layout.js');page.wait_for_timeout(700)
    assert page.locator('#btx-youtube-tabs').count()==0
    assert page.evaluate('nativeState.expandedClicks')==1
    page.locator('#upload-info').hover();page.wait_for_timeout(80)
    assert page.evaluate('getComputedStyle(document.querySelector("#channel-name a")).whiteSpace')=='normal'
    assert page.locator('#subscribe').is_visible()
    page.evaluate('__test.update({youtubeDescriptionExpandedEnabled:false,youtubeFullChannelNameEnabled:false})');page.wait_for_timeout(650)
    assert page.evaluate('nativeState.collapsedClicks')==1
    assert page.evaluate('getComputedStyle(document.querySelector("#channel-name a")).whiteSpace')=='nowrap'
    record('independent_description_channel_toggles_restore_without_sidebar',page.evaluate('__layoutState()'));page.close()

    page=fixture(browser,LAYOUT);inject(page,'youtube_layout.js');page.wait_for_timeout(650)
    page.locator('#btx-tab-comments').click();page.evaluate('__test.update({youtubeDescriptionExpandedEnabled:false})');page.wait_for_timeout(650)
    assert page.evaluate('nativeState.collapsedClicks')==1
    assert page.evaluate('__layoutState().status.selected')=='comments'
    assert not page.locator('#btx-pane-info').is_visible()
    assert page.locator('#btx-pane-comments').is_visible()
    assert page.evaluate('__layoutState().status.descriptionIssue')==''
    record('hidden_info_pane_real_expansion_restored_without_changing_selected_tab',page.evaluate('__layoutState().status'));page.close()

    page=fixture(browser,LAYOUT);page.evaluate('nativeState.description.remove();nativeState.comments.remove();nativeState.related.remove()');inject(page,'youtube_layout.js');page.wait_for_timeout(650)
    state=page.evaluate('__layoutState().status');assert state['layout']=='waiting' and state['movedSections']==[]
    assert page.locator('.btx-native-note').is_visible()
    record('no_source_sections_reports_waiting_not_success',state);page.close()

    page=fixture(browser,LAYOUT);page.evaluate('document.querySelector("#secondary-inner").id="unsupported-secondary"');inject(page,'youtube_layout.js');page.wait_for_timeout(600)
    state=page.evaluate('__layoutState().status');assert state['layout']=='unavailable' and state['issue']
    assert page.locator('[data-btx-layout-owned]').count()==0
    record('unsupported_layout_explicit_no_guess',state);page.close()

    page=fixture(browser,LAYOUT);page.evaluate('document.querySelector("#comments").remove()');inject(page,'youtube_layout.js');page.wait_for_timeout(600)
    assert page.locator('#btx-tab-comments').get_attribute('aria-disabled')=='true'
    assert page.locator('#btx-tab-comments').inner_text()=='댓글 · 미로드'
    record('absent_comments_not_fabricated_as_zero',page.evaluate('__layoutState().status'));page.close()

    page=fixture(browser,LAYOUT);inject(page,'youtube_layout.js');page.wait_for_timeout(600)
    # One verified startup relocation is recoverable; a repeated reclaim must still stop.
    page.evaluate('document.querySelector("#below").moveBefore(nativeState.comments,null)');page.wait_for_timeout(160)
    state=page.evaluate('__layoutState()');assert state['status']['layout']=='applied' and state['commentsParent']=='btx-pane-comments',state
    page.evaluate('document.querySelector("#below").moveBefore(nativeState.comments,null)');page.wait_for_timeout(160)
    state=page.evaluate('__layoutState()');assert state['status']['layout']=='unavailable' and state['status']['issue']
    assert state['commentsParent']=='below' and page.locator('#btx-youtube-tabs').count()==0
    record('site_reparent_conflict_stops_and_restores',state);page.close()

    # An old enabled preference must no longer create a control beside A/B.
    page=fixture(browser,{'youtubeSpeedMenuEnabled':True,'youtubeSpeedNoticeEnabled':True,'mediaSpeedStep':0.25},strict=True,dark=True);inject(page,'youtube_ab_loop.js');inject(page,'media_controller.js');page.wait_for_timeout(700)
    assert page.locator('#__browser_toolbox_youtube_speed_indicator__,#btx-youtube-speed-menu-button,#btx-youtube-speed-tools').count()==0
    assert page.locator('#__browser_toolbox_youtube_ab_loop_button__').count()==1
    page.locator('#__browser_toolbox_youtube_ab_loop_button__').click();assert page.locator('.btx-yt-ab-loop-panel').is_visible()
    page.locator('#outside').click();page.keyboard.press('d');page.wait_for_timeout(150)
    assert page.evaluate('__test.media().rate')==1.25
    page.keyboard.press('d');page.wait_for_timeout(150)
    first=page.evaluate('__test.media().rate');assert abs(first-1.5)<1e-5,first
    for i in range(20): page.evaluate('i=>document.querySelector("#unrelated").textContent=String(i)',i);page.wait_for_timeout(15)
    assert abs(page.evaluate('__test.media().rate')-first)<1e-5
    assert page.locator('#btx-youtube-speed-toast').inner_text()=='1.50×'
    page.locator('#movie_player').screenshot(path=str(OUT/'youtube_speed_selector_removed.png'))
    page.evaluate('document.querySelector("video").playbackRate=1.75');page.wait_for_timeout(300)
    assert page.locator('#btx-youtube-speed-toast').inner_text()=='1.75×'
    page.evaluate('document.querySelector("#unrelated").append(document.createElement("span"))');page.wait_for_timeout(150)
    assert page.evaluate('__test.media().rate')==1.75
    page.evaluate('__test.rejectSetter()');page.keyboard.press('d');page.wait_for_timeout(150)
    assert page.evaluate('__test.media().rate')==1.75
    assert page.locator('#__browser_toolbox_media_error__').is_visible()
    record('speed_selector_removed_loop_and_shortcuts_work_errors_truthful',page.evaluate('__layoutState()'))
    page.evaluate('__test.restoreSetter();__test.update({youtubeSpeedMenuEnabled:false})');page.wait_for_timeout(150)
    page.keyboard.press('d');page.wait_for_timeout(150)
    assert page.evaluate('__test.media().rate')==2 and page.locator('#btx-youtube-speed-toast').inner_text()=='2.00×'
    page.evaluate('__test.update({youtubeSpeedMenuEnabled:true})');page.wait_for_timeout(150)
    assert page.locator('#btx-youtube-speed-menu-button,#btx-youtube-speed-tools').count()==0
    record('retired_speed_preference_cannot_recreate_selector',{'rate':page.evaluate('__test.media().rate'),'remaining_selector':0})
    page.evaluate('__test.update({youtubeSpeedNoticeEnabled:false})');page.wait_for_timeout(180)
    assert page.locator('#btx-youtube-speed-toast').count()==0
    record('speed_notice_toggle_off_removes_UI',{'remaining_ui':0,'rate':page.evaluate('__test.media().rate')});page.close()

    page=fixture(browser,{'youtubeProgressThemeEnabled':True},strict=True);inject(page,'youtube_layout.js');page.wait_for_timeout(200)
    theme=page.evaluate('''() => ({progress:getComputedStyle(document.querySelector('.ytp-play-progress')).backgroundImage,thumb:getComputedStyle(document.querySelector('.ytp-scrubber-button')).backgroundImage,height:getComputedStyle(document.querySelector('.ytp-progress-list')).height,filter:getComputedStyle(document.querySelector('#movie_player')).filter,backdrop:getComputedStyle(document.querySelector('#movie_player')).backdropFilter})''')
    assert 'linear-gradient' in theme['progress'] and 'data:image/gif;base64' in theme['thumb'] and theme['height']=='12px'
    assert theme['filter']=='none' and theme['backdrop']=='none'
    page.locator('.ytp-progress-bar-container').click();assert page.evaluate('nativeState.progressClicks')==1
    before=page.evaluate('document.querySelector("video").playbackRate')
    page.evaluate('__test.update({youtubeProgressThemeEnabled:false})');page.wait_for_timeout(100)
    assert page.evaluate('getComputedStyle(document.querySelector(".ytp-progress-list")).height')=='4px'
    assert page.evaluate('getComputedStyle(document.querySelector(".ytp-scrubber-button")).backgroundImage')=='none'
    assert page.evaluate('document.querySelector("video").playbackRate')==before
    theme['thumb']='original inline GIF (full base64 omitted from report)'
    record('original_progress_decoration_reversible_native_seek_untouched',theme);page.close()

    page=fixture(browser,{**LAYOUT,'mediaSpeedStep':2,'youtubeSpeedNoticeEnabled':True,'youtubeProgressThemeEnabled':True},strict=True,dark=True)
    for name in ['youtube_synced_caption_overlay.js','youtube_ab_loop.js','media_controller.js','youtube_layout.js']: inject(page,name)
    page.wait_for_timeout(700)
    page.evaluate('__test.addCaptions([[0,2,"첫 번째 통합 시험 자막"],[2,4,"두 번째 통합 시험 자막"],[4,8,"세 번째 통합 시험 자막"]]);document.querySelector("video").currentTime=0')
    page.locator('#outside').click();page.keyboard.press('d')
    page.evaluate('document.querySelector("video").play()')
    # Playwright's wait_for_function compiles predicates via page eval, which strict
    # Trusted Types rejects. Read actual state through the driver, without weakening CSP.
    deadline=time.monotonic()+5
    while True:
        media_time=page.evaluate('document.querySelector("video").currentTime')
        if 2.15 < media_time < 3.7: break
        assert time.monotonic()<deadline, ('Media time not reached',media_time)
        page.wait_for_timeout(20)
    page.evaluate('document.querySelector("video").pause()');page.wait_for_timeout(80)
    combined=page.evaluate('({caption:__test.caption(),layout:__layoutState(),abButtons:document.querySelectorAll("#__browser_toolbox_youtube_ab_loop_button__").length,filters:__test.ownFilters()})')
    assert combined['caption']['rate']==3 and combined['caption']['active']==['두 번째 통합 시험 자막']
    assert combined['caption']['text']=='두 번째 통합 시험 자막' and combined['layout']['status']['layout']=='applied'
    assert combined['abButtons']==1 and combined['filters']==[]
    page.locator('#__browser_toolbox_youtube_ab_loop_button__').click();assert page.locator('.btx-yt-ab-loop-panel').is_visible()
    page.evaluate('__test.update({youtubeLayoutTabsEnabled:false})');page.wait_for_timeout(150)
    assert page.evaluate('__test.media().rate')==3 and page.evaluate('__test.caption().text')=='두 번째 통합 시험 자막'
    record('combined_layout_speed_AB_progress_and_actual_three_speed_caption',combined);page.close()

    page=browser.new_page(viewport={'width':780,'height':600});page.on('pageerror',lambda e:results['errors'].append(str(e)))
    html=(ROOT/'popup.html').read_text();html=re.sub(r'<script\s+src="[^"]+"[^>]*></script>','',html);html=html.replace('<link rel="stylesheet" href="popup.css">','<style>'+(ROOT/'popup.css').read_text()+'</style>')
    page.set_content(html);page.evaluate((ROOT/'.test_dist/browser_harness.js').read_text());inject(page,'toolbox_shared.js');inject(page,'youtube_tools_popup.js');page.wait_for_timeout(120)
    inject(page,'popup_navigation.js');page.click('#nav-youtube')
    assert page.locator('#youtube-tools-options input[type="checkbox"]').count()==8
    assert page.locator('#btx-option-youtubeCommentStatusEnabled').is_disabled()
    page.locator('label[for="btx-option-youtubeLayoutTabsEnabled"]').first.click();page.wait_for_timeout(180)
    assert page.evaluate('__test.settings.youtubeLayoutTabsEnabled') is True
    assert not page.locator('#btx-option-youtubeCommentStatusEnabled').is_disabled()
    assert page.locator('#btx-option-youtubeSpeedMenuEnabled').count()==0
    page.locator('label[for="btx-option-youtubeSpeedNoticeEnabled"]').first.click();page.wait_for_timeout(180)
    assert page.evaluate('__test.settings.youtubeSpeedNoticeEnabled') is True
    page.evaluate('__test.faults.write=true');page.locator('label[for="btx-option-youtubeProgressThemeEnabled"]').first.click();page.wait_for_timeout(180)
    assert page.locator('#btx-option-youtubeProgressThemeEnabled').is_checked() is False
    assert page.locator('#youtube-tools-status').get_attribute('data-error')=='true'
    assert page.evaluate('document.documentElement.scrollWidth')==780
    page.evaluate('__test.faults.write=false')
    # Capture the actual fixed-size popup viewport, not an oversized element clipped
    # by its nested scroll container (which is not a faithful popup screenshot).
    failure_message=page.locator('#youtube-tools-status').inner_text()
    page.locator('label[for="btx-option-youtubeCommentStatusEnabled"]').first.click();page.wait_for_timeout(150)
    page.evaluate('document.querySelector("#view-youtube").scrollTop=0')
    page.screenshot(path=str(OUT/'youtube_tools_settings.png'))
    page.evaluate('''() => {const scroller=document.querySelector('#view-youtube'), heading=document.querySelectorAll('.youtube-tools-group')[1];scroller.scrollTop += heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top;}''')
    page.screenshot(path=str(OUT/'youtube_tools_player_settings.png'))
    record('popup_eight_opt_in_toggles_dependencies_and_failed_storage',{'count':8,'width':page.evaluate('document.documentElement.scrollWidth'),'message':failure_message});page.close()
    assert not results['errors'],results['errors']
    results['passed']=True;browser.close()
except Exception as e:
    results['failure']=str(e);traceback.print_exc();raise
finally:
    (OUT/'youtube_tools_results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
