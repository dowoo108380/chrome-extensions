"""1.55 layout regressions. Real Chromium DOM/styles/inputs; explicit Chrome API doubles.
The DOM variants are controlled fixtures, not captured from the user's YouTube page.
No page CSP or enterprise policy is disabled. Only host/watch predicates in an
in-memory copy are adapted to about:blank, never production files.
"""
from pathlib import Path
import argparse, base64, hashlib, json, re, shutil, traceback, time
from playwright.sync_api import sync_playwright
STARTED = time.monotonic()
ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--chromium', default=shutil.which('chromium') or shutil.which('chrome'))
args = parser.parse_args()
if not args.chromium: parser.error('Use an installed Chrome/Chromium with --chromium.')
OUT = ROOT / '.test_results'; OUT.mkdir(exist_ok=True)
VIDEO = 'data:video/webm;base64,' + base64.b64encode((ROOT/'tests/fixtures/test.webm').read_bytes()).decode()
LAYOUT = {'youtubeLayoutTabsEnabled':True,'youtubeDescriptionExpandedEnabled':True,'youtubeCommentStatusEnabled':True,'youtubePanelScrollEnabled':True,'youtubeNativePanelsEnabled':True}
result = {'passed':False,'environment':{'scope':'Linux Chromium components, not installed MV3/live YouTube/Windows/GPU',
 'chrome_apis':'explicit browser_harness doubles','fixtures':'controlled multiple/empty/hidden related containers, native description card CSS, media previews, iframes, lazy content',
 'source_changes':'only host and watch predicates in in-memory execution copies',
 'security':"require-trusted-types-for 'script'; trusted-types 'none'",
 'live_youtube':'not executed by this suite'},'tests':{},'errors':[]}

def record(name, details):
    result['tests'][name] = details; print(f'PASS {time.monotonic()-STARTED:.1f}s:',name,flush=True)

def source(legacy=False):
    path = ROOT/('.test_layout_baseline/tests/fixtures/legacy_youtube_layout.js' if legacy else 'dist/youtube_layout.js')
    code = path.read_text()
    for predicate in ['isYouTubePage','isWatchPage']:
        first = re.search(r'^    function '+predicate+r'\(\) \{[^\n]*',code,re.M)
        assert first, predicate
        pattern = r'^    function '+predicate+(r'\(\) \{[^\n]*\}' if first.group(0).rstrip().endswith('}') else r'\(\) \{.*?\n    \}')
        code, n = re.subn(pattern, f'    function {predicate}() {{ return true; }}',code,count=1,flags=re.S|re.M)
        assert n==1
    return code

def fixture(browser, options=None, width=1440, legacy=False):
    p=browser.new_page(viewport={'width':width,'height':960});p.set_default_timeout(6000)
    p.on('pageerror',lambda error:result['errors'].append(str(error)))
    p.set_content('''<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="require-trusted-types-for &#39;script&#39;; trusted-types &#39;none&#39;"></head><body></body></html>''')
    p.evaluate((ROOT/'.test_dist/layout_regression_fixture.js').read_text());p.evaluate('o=>LayoutRegressionFixture.build(o)',options or {'dark':True})
    p.evaluate((ROOT/'.test_dist/browser_harness.js').read_text());p.evaluate('v=>Object.assign(__test.settings,v)',LAYOUT)
    p.evaluate((ROOT/'dist/toolbox_shared.js').read_text())
    css=(ROOT/('tests/fixtures/legacy_youtube_layout.css' if legacy else 'youtube_layout.css')).read_text()
    p.evaluate('css=>{const s=document.createElement("style");s.textContent=css;document.head.append(s)}',css)
    return p

def apply(p, legacy=False):
    p.evaluate(source(legacy));p.wait_for_timeout(650)

def read(p):return p.evaluate('LayoutRegressionFixture.read()')
def stat(p):return read(p)['status']

def verify_full(p):
    state=read(p)
    assert state['status']['layout']=='applied',state
    assert state['relatedParent']=='btx-pane-videos',state
    assert state['relatedIdentity'] and state['outsideRecommendations']==0,state
    assert state['linksInPane']==16,state
    assert p.locator('#btx-tab-videos').get_attribute('aria-disabled')=='false'
    return state

def restore(p):
    p.evaluate('__test.update({youtubeLayoutTabsEnabled:false,youtubeDescriptionExpandedEnabled:false})');p.wait_for_timeout(650)
    assert p.locator('#btx-youtube-tabs').count()==0
    assert p.locator('[data-btx-layout-owned]').count()==0
    assert p.evaluate('LayoutRegressionFixture.related.parentNode===LayoutRegressionFixture.origin')

try:
  with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
    result['environment']['browser']=browser.version
    # 1. Old binary really fails these fixtures. A passing replacement alone is not enough.
    baseline={}
    for variant in ['hidden','empty']:
      p=fixture(browser,{'dark':True,'duplicate':variant},legacy=True);apply(p,legacy=True)
      s=read(p);assert s['status']['layout']=='partial' and s['relatedParent']=='secondary-inner',s
      assert p.locator('#btx-tab-videos').get_attribute('aria-disabled')=='true'
      baseline[variant]=s;p.close()
    p=fixture(browser,legacy=True);p.evaluate('LayoutRegressionFixture.addFrame()');p.wait_for_timeout(80);apply(p,legacy=True)
    s=read(p);assert s['relatedParent']=='secondary-inner' and '프레임' in s['status']['issue'],s
    baseline['frame']=s;p.close()
    record('legacy_duplicate_ID_and_frame_rejection_reproduced',baseline)

    # 2. Distinct disabled/empty responsive containers do not veto the real list.
    for variant in ['hidden','empty']:
      p=fixture(browser,{'dark':True,'duplicate':variant});apply(p);s=verify_full(p)
      assert p.evaluate('LayoutRegressionFixture.duplicate.parentNode===LayoutRegressionFixture.primary')
      p.locator('#btx-tab-comments').click();p.wait_for_timeout(80)
      assert not p.locator('#btx-pane-videos').is_visible()
      assert p.evaluate('LayoutRegressionFixture.related.getClientRects().length')==0
      p.locator('#btx-tab-videos').click();p.wait_for_timeout(80)
      assert p.locator('#btx-pane-videos').is_visible()
      p.locator('#btx-pane-videos yt-chip-cloud-renderer button').first.click()
      p.locator('#btx-pane-videos ytd-compact-video-renderer a').first.click()
      assert p.evaluate('LayoutRegressionFixture.clicks')==1 and p.evaluate('LayoutRegressionFixture.filterClicks')==1
      assert p.evaluate('LayoutRegressionFixture.savedLinks.every(a=>a.isConnected)')
      p.locator('#btx-youtube-tabs').screenshot(path=str(OUT/f'layout_repaired_videos_{variant}.png'))
      restore(p);record('unique_populated_recommendations_'+variant,s);p.close()

    # 3. Native backgrounds flatten only in the owned pane and restore with identity.
    p=fixture(browser);before=read(p);p.locator('#fixture-input').evaluate('e=>e.value="작성 중인 값을 유지"');apply(p)
    after=verify_full(p)
    assert after['descriptionBackground']=='rgba(0, 0, 0, 0)' and after['innerBackground']=='rgba(0, 0, 0, 0)',after
    assert after['descriptionPadding']=='0px' and after['outsideBackground']==before['outsideBackground']
    assert after['descriptionText']==before['descriptionText']
    p.locator('#btx-youtube-tabs').screenshot(path=str(OUT/'layout_repaired_information.png'))
    restore(p);end=read(p)
    assert end['descriptionBackground']==before['descriptionBackground'] and end['innerBackground']==before['innerBackground']
    assert p.locator('#fixture-input').input_value()=='작성 중인 값을 유지'
    record('single_surface_original_text_and_style_restoration',{'before':before,'applied':after,'restored':end});p.close()

    # 4. iframe state is real, not a mock; moveBefore must preserve the browsing context.
    p=fixture(browser);p.evaluate('LayoutRegressionFixture.addFrame()');p.wait_for_timeout(120)
    p.evaluate('''() => {window.originalFrame=LayoutRegressionFixture.frame.contentWindow;originalFrame.preservedValue="native-state";}''')
    loaded=p.evaluate('LayoutRegressionFixture.nativeLoadCount');assert loaded>=1
    apply(p);verify_full(p);p.locator('#btx-tab-videos').click();p.wait_for_timeout(100)
    assert p.evaluate('LayoutRegressionFixture.frame.contentWindow===originalFrame && originalFrame.preservedValue==="native-state"')
    assert p.evaluate('LayoutRegressionFixture.nativeLoadCount')==loaded
    restore(p)
    assert p.evaluate('LayoutRegressionFixture.frame.contentWindow===originalFrame && originalFrame.preservedValue==="native-state"')
    assert p.evaluate('LayoutRegressionFixture.nativeLoadCount')==loaded
    record('iframe_context_identity_preserved_on_mount_and_restore',{'loadCountBefore':loaded,'loadCountAfter':p.evaluate('LayoutRegressionFixture.nativeLoadCount')});p.close()

    p=fixture(browser);p.evaluate('url=>{LayoutRegressionFixture.mainVideo.src=url;LayoutRegressionFixture.addPreview(url);}',VIDEO)
    # Wait for actual decoding, not a fixed sleep that can expire during parallel suites.
    p.wait_for_function('() => LayoutRegressionFixture.mainVideo.readyState>=4 && LayoutRegressionFixture.preview.readyState>=4')
    p.evaluate('''() => { LayoutRegressionFixture.mainVideo.playbackRate=2.25; LayoutRegressionFixture.preview.currentTime=1.5; LayoutRegressionFixture.preview.playbackRate=1.75; }''')
    p.wait_for_function('() => !LayoutRegressionFixture.preview.seeking && LayoutRegressionFixture.preview.readyState>=4')
    before=p.evaluate('({main:LayoutRegressionFixture.mainVideo.playbackRate,time:LayoutRegressionFixture.preview.currentTime,rate:LayoutRegressionFixture.preview.playbackRate,ready:LayoutRegressionFixture.preview.readyState})');assert before['ready']>=2
    apply(p);verify_full(p)
    after=p.evaluate('({main:LayoutRegressionFixture.mainVideo.playbackRate,time:LayoutRegressionFixture.preview.currentTime,rate:LayoutRegressionFixture.preview.playbackRate,ready:LayoutRegressionFixture.preview.readyState})')
    assert before==after,(before,after)
    restore(p);record('real_preview_media_state_preserved_without_speed_writes',{'before':before,'after':after});p.close()

    # 5. Ambiguity is reported, never guessed or disguised by hiding the live list.
    p=fixture(browser,{'dark':True,'duplicate':'visible'});apply(p)
    s=read(p);assert s['status']['layout']=='partial' and s['status']['sections']['videos']['state']=='ambiguous',s
    assert s['relatedParent']=='secondary-inner'
    assert p.locator('.btx-layout-status').is_visible() and '확정하지 못했습니다' in p.locator('.btx-layout-status').inner_text()
    assert p.evaluate('LayoutRegressionFixture.related.getClientRects().length>0 && LayoutRegressionFixture.duplicate.getClientRects().length>0')
    record('two_populated_visible_lists_are_not_guessed_or_hidden',s);p.close()

    # 6. Late lists and renderer-only structures, with no whole-document timer loop.
    p=fixture(browser,{'dark':True,'duplicate':'empty','deferred':True});apply(p)
    assert stat(p)['sections']['videos']['state']=='waiting'
    p.evaluate('LayoutRegressionFixture.fill(LayoutRegressionFixture.related)');p.wait_for_timeout(160)
    s=verify_full(p);record('late_renderer_content_reconnects_existing_empty_container',s);p.close()

    p=fixture(browser);p.evaluate('LayoutRegressionFixture.related.style.display="none"');apply(p)
    assert stat(p)['layout']=='partial'
    p.evaluate('LayoutRegressionFixture.related.style.display="block"');p.wait_for_timeout(160)
    record('native_css_visibility_change_rechecks_pending_source',verify_full(p));p.close()

    p=fixture(browser,{'dark':True,'bareRenderer':True});apply(p);s=verify_full(p);restore(p)
    record('documented_renderer_boundary_without_related_ID',s);p.close()

    # 7. Replaced or emptied native containers: use actual new nodes, never resurrect old content.
    p=fixture(browser);apply(p);verify_full(p)
    p.evaluate('''() => {const f=LayoutRegressionFixture;window.removedSource=f.related;f.related.remove();f.related=document.createElement('div');f.related.id='related';f.origin.append(f.related);f.fill(f.related);}''');p.wait_for_timeout(200)
    s=verify_full(p);assert p.evaluate('!removedSource.isConnected');restore(p)
    assert p.evaluate('!removedSource.isConnected');record('replaced_recommendation_container_rebinds_and_restores',s);p.close()

    p=fixture(browser);apply(p);verify_full(p)
    p.evaluate('''() => {const f=LayoutRegressionFixture;window.emptiedSource=f.related;f.related.replaceChildren();f.related=document.createElement('div');f.related.id='related';f.origin.append(f.related);f.fill(f.related);}''');p.wait_for_timeout(200)
    s=verify_full(p);assert p.evaluate('emptiedSource.parentNode===LayoutRegressionFixture.origin');restore(p)
    record('empty_old_source_yields_to_uniquely_populated_replacement',s);p.close()

    p=fixture(browser);apply(p);verify_full(p)
    p.evaluate('''() => {const f=LayoutRegressionFixture;const other=document.createElement('div');other.id='related';f.fill(other);f.origin.append(other);}''');p.wait_for_timeout(180)
    state=read(p);assert state['status']['layout']=='unavailable' and '별도의 동영상 목록' in state['status']['issue'],state
    assert p.locator('#btx-youtube-tabs').count()==0 and state['relatedParent']=='secondary-inner'
    record('populated_site_rival_is_reported_and_native_layout_restored',state);p.close()

    p=fixture(browser);apply(p);verify_full(p)
    p.evaluate('''() => {window.continuationSeen=false;window.continuationObserver=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)) continuationSeen=true;});continuationObserver.observe(document.querySelector('#fixture-continuation'));}''');p.wait_for_timeout(120)
    assert not p.evaluate('continuationSeen')
    p.locator('#btx-tab-videos').click();p.wait_for_timeout(100)
    assert not p.evaluate('continuationSeen')
    p.locator('#btx-pane-videos').evaluate('e=>e.scrollTop=e.scrollHeight');p.wait_for_timeout(200)
    assert p.evaluate('continuationSeen')
    p.evaluate('''() => {const node=document.createElement('ytd-compact-video-renderer');const a=document.createElement('a');a.href='https://www.youtube.com/watch?v=late_item';a.textContent='나중에 추가된 원래 동영상 링크';node.append(a);LayoutRegressionFixture.related.querySelector('#items').append(node);}''');p.wait_for_timeout(100)
    assert p.locator('#btx-pane-videos ytd-compact-video-renderer').count()==17
    assert read(p)['outsideRecommendations']==0
    p.locator('#btx-tab-comments').click();assert not p.locator('#btx-pane-videos').is_visible()
    record('inner_scroll_exposes_native_continuation_and_keeps_appended_content_inside',{'intersectionObserved':True,'cards':17,'network':'no request issued; continuation callback and later DOM append are fixture behavior'});p.close()

    # 8. Scroll state, keyboard semantics, repeated disable/enable and live actual counts.
    p=fixture(browser);apply(p);p.locator('#btx-tab-videos').click()
    p.locator('#btx-pane-videos').evaluate('e=>e.scrollTop=280')
    video_scroll=p.locator('#btx-pane-videos').evaluate('e=>e.scrollTop');assert video_scroll>0
    p.locator('#btx-tab-comments').click();p.locator('#btx-pane-comments').evaluate('e=>e.scrollTop=160')
    p.locator('#btx-tab-videos').click();assert p.locator('#btx-pane-videos').evaluate('e=>e.scrollTop')==video_scroll
    p.keyboard.press('Home');assert p.locator('#btx-tab-info').get_attribute('aria-selected')=='true'
    p.keyboard.press('End');assert p.locator('#btx-tab-videos').get_attribute('aria-selected')=='true'
    p.evaluate('document.querySelector("#count").textContent="댓글 42개"');p.wait_for_timeout(140)
    assert p.locator('#btx-tab-comments').inner_text()=='댓글 42개'
    for _ in range(3):
      restore(p);p.evaluate('v=>__test.update(v)',LAYOUT);p.wait_for_timeout(650);verify_full(p)
      assert p.locator('#btx-youtube-tabs').count()==1
    record('independent_scroll_keyboard_count_and_repeated_restore',{'videosScrollTop':video_scroll,'cycles':3,'comments':p.locator('#btx-tab-comments').inner_text()});p.close()

    for width,dark in [(1600,True),(1000,False),(720,True),(390,False)]:
      p=fixture(browser,{'dark':dark,'duplicate':'hidden'},width=width);apply(p)
      for tab in ['info','comments','videos']:
        p.locator('#btx-tab-'+tab).click();p.wait_for_timeout(50)
        assert p.evaluate('document.documentElement.scrollWidth<=innerWidth'),(width,tab,read(p))
      if width==390:p.locator('#btx-youtube-tabs').screenshot(path=str(OUT/'layout_repaired_narrow.png'))
      record('responsive_no_horizontal_overflow_'+str(width),{'width':width,'dark':dark,'actual':read(p)['documentWidth']});p.close()

    p=fixture(browser);apply(p);start=stat(p)['reconciliationCount']
    for i in range(20):p.evaluate('i=>document.querySelector("#fixture-unrelated").textContent=String(i)',i);p.wait_for_timeout(35)
    end=stat(p)['reconciliationCount'];assert start==end,(start,end)
    record('unrelated_DOM_mutations_do_not_restart_layout',{'changes':20,'additionalReconciliations':end-start});p.close()

    p=fixture(browser);p.evaluate('LayoutRegressionFixture.related.append(LayoutRegressionFixture.mainVideo.parentElement)');apply(p)
    s=read(p);assert s['status']['sections']['videos']['state']=='protected',s
    assert s['relatedParent']=='secondary-inner' and p.locator('#movie_player').count()==1
    record('main_player_is_never_relocated_as_a_recommendation',s);p.close()

    p=fixture(browser);apply(p);p.evaluate('document.dispatchEvent(new Event("yt-navigate-start"))');assert p.locator('#btx-youtube-tabs').count()==0
    p.evaluate('document.dispatchEvent(new Event("yt-navigate-finish"))');p.wait_for_timeout(650);verify_full(p)
    p.evaluate('window.dispatchEvent(new PageTransitionEvent("pagehide",{persisted:true}));window.dispatchEvent(new PageTransitionEvent("pageshow",{persisted:true}))');p.wait_for_timeout(650);verify_full(p)
    assert p.locator('#btx-youtube-tabs').count()==1
    record('synthetic_navigation_and_BFCache_restore_no_duplicates',{'scope':'synthetic lifecycle events, not real history navigation','panels':1});p.close()

    assert not result['errors'],result['errors']
    result['passed']=True;browser.close()
except Exception as error:
    result['failure']=str(error);traceback.print_exc();raise
finally:
    result['baseline_source_sha256']=hashlib.sha256((ROOT/'tests/fixtures/legacy_youtube_layout.ts').read_bytes()).hexdigest()
    (OUT/'layout_regression_results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
