"""Real Chromium document-height regressions with explicit, synthetic CSS reserves.
Chrome APIs are doubles; only the host/watch checks in an in-memory script copy
are adapted to about:blank. No production code, CSP or browser policy is changed.
No claim is made that the test CSS was measured from the user's live YouTube page.
"""
from pathlib import Path
import argparse, base64, hashlib, json, re, shutil, time, traceback
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.test_results'; OUT.mkdir(exist_ok=True)
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--chromium',default=shutil.which('chromium') or shutil.which('chrome'))
args=parser.parse_args()
if not args.chromium: parser.error('Specify an installed browser with --chromium.')
result={'passed':False,'environment':{'scope':'Linux Chromium local layout components, not Windows/live YouTube/installed MV3',
 'chrome_apis':'existing browser_harness doubles','fixture':'synthetic min-height/height/padding/margin reserves, not captured site CSS',
 'lifecycle':'synthetic navigation/cache events; separate real Fullscreen API exercise',
 'security':"require-trusted-types-for 'script'; trusted-types 'none'",'source_changes':'only two address predicates in memory'},'tests':{},'errors':[]}
VIDEO='data:video/webm;base64,'+base64.b64encode((ROOT/'tests/fixtures/test.webm').read_bytes()).decode()
SETTINGS={'youtubeLayoutTabsEnabled':True,'youtubePanelScrollEnabled':True,'youtubeCommentStatusEnabled':True,'youtubeDescriptionExpandedEnabled':False,'youtubeNativePanelsEnabled':True}
def record(name,value):
 result['tests'][name]=value; print('PASS:',name,flush=True)
def source(old=False):
 path=ROOT/('.test_scroll_baseline/tests/fixtures/legacy_scroll_layout.js' if old else 'dist/youtube_layout.js')
 code=path.read_text()
 for predicate in ['isYouTubePage','isWatchPage']:
  first=re.search(r'^    function '+predicate+r'\(\) \{[^\n]*',code,re.M);assert first
  pattern=r'^    function '+predicate+(r'\(\) \{[^\n]*\}' if first.group(0).rstrip().endswith('}') else r'\(\) \{.*?\n    \}')
  code,n=re.subn(pattern,f'    function {predicate}() {{ return true; }}',code,count=1,flags=re.S|re.M);assert n==1
 return code
def fixture(browser,reserve='below-minimum',old=False,width=1440,settings=None):
 p=browser.new_page(viewport={'width':width,'height':900});p.set_default_timeout(6000)
 p.on('pageerror',lambda e:result['errors'].append(str(e)))
 p.set_content('''<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="require-trusted-types-for &#39;script&#39;; trusted-types &#39;none&#39;"></head><body></body></html>''')
 for name in ['layout_regression_fixture.js','scroll_regression_fixture.js','browser_harness.js']:p.evaluate((ROOT/'.test_dist'/name).read_text())
 p.evaluate('r=>ScrollRegressionFixture.build(r)',reserve)
 p.evaluate('s=>Object.assign(__test.settings,s)',{**SETTINGS,**(settings or {})})
 p.evaluate((ROOT/'dist/toolbox_shared.js').read_text())
 css=(ROOT/('tests/fixtures/legacy_scroll_layout.css' if old else 'youtube_layout.css')).read_text()
 p.evaluate('css=>{const s=document.createElement("style");s.textContent=css;document.head.append(s)}',css)
 return p
def apply(p,old=False):p.evaluate(source(old));p.wait_for_timeout(500)
def read(p):return p.evaluate('ScrollRegressionFixture.read()')
def change(p,settings):p.evaluate('s=>__test.update(s)',settings);p.wait_for_timeout(220)
def wait_state(p, expression, timeout=5):
 end=time.monotonic()+timeout
 while time.monotonic()<end:
  if p.evaluate(expression):return
  p.wait_for_timeout(40)
 raise AssertionError('Timed out waiting for actual state: '+expression)

def assert_flow(p,on=True):
 s=read(p);assert bool(s['state']['pageFlow']['contentSized'])==on,s
 assert bool(s['marked'])==on,s
 return s
def assert_original_content(p):
 assert p.evaluate('''() => ['info','comments','videos'].every(name=>document.querySelector('[data-btx-layout-owned="'+name+'"]').parentElement.id==='btx-pane-'+name)''')
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
  result['environment']['browser']=b.version
  # Positive cases compare actual old/new document geometry, not setter arguments.
  for reserve in ['below-minimum','outer-minimum','inner-fixed','bottom-padding','bottom-margin','combined']:
   old=fixture(b,reserve,old=True);apply(old,True);before=read(old)
   assert before['scrollRange']>100,before
   old.evaluate('scrollTo(0,document.scrollingElement.scrollHeight)');old.wait_for_timeout(120)
   assert old.evaluate('scrollY')>100
   if reserve=='below-minimum':old.screenshot(path=str(OUT/'scroll_before_bottom.png'))
   p=fixture(b,reserve);apply(p);after=assert_flow(p)
   assert after['scrollRange']==0,after
   # 1.62 intentionally uses more horizontal space. Keep the vertical regression
   # assertion above and check proportional growth rather than the obsolete
   # requirement that player dimensions equal the narrower historical layout.
   dw=after['player']['width']-before['player']['width']
   dh=after['player']['height']-before['player']['height']
   assert dw>=0 and abs(dh-dw*9/16)<0.05,(before,after)
   assert_original_content(p)
   for n in ['body','html']:assert after[n]['overflowY']==before[n]['overflowY'] and after[n]['inlineStyle']==before[n]['inlineStyle']
   p.mouse.move(20,750);p.mouse.wheel(0,1100);p.wait_for_timeout(130);assert p.evaluate('scrollY')==0
   if reserve=='below-minimum':p.screenshot(path=str(OUT/'scroll_after_compact.png'))
   record('old_new_document_range_'+reserve,{'old':before,'new':after});old.close();p.close()

  p=fixture(b,'none');apply(p);baseline=assert_flow(p);assert baseline['scrollRange']==0
  # Long real content outside the relocated sections must grow the page naturally.
  p.evaluate('''() => {const n=document.createElement('section');n.id='fixture-extra';n.style.cssText='height:1200px;background:#20463d';n.textContent='실제로 남아 있는 본문';const end=document.createElement('button');end.id='fixture-end';end.textContent='본문의 마지막 버튼';end.addEventListener('click',()=>window.endClicked=true);document.querySelector('#below').append(n,end);}''')
  p.wait_for_timeout(180);long=read(p);assert long['scrollRange']>800,long
  p.locator('#fixture-end').click();assert p.evaluate('window.endClicked===true')
  p.evaluate('document.querySelector("#fixture-extra").remove();document.querySelector("#fixture-end").remove()');p.wait_for_timeout(200)
  assert read(p)['scrollRange']==0
  record('real_remaining_content_grows_page_and_stays_reachable',{'before':baseline,'long':long,'buttonClicked':True,'after':read(p)});p.close()

  p=fixture(b);apply(p)
  p.locator('#btx-tab-videos').click();p.wait_for_timeout(120)
  inner=p.locator('#btx-pane-videos').evaluate('e=>({height:e.clientHeight,scroll:e.scrollHeight})');assert inner['scroll']>inner['height']
  p.locator('#btx-pane-videos').evaluate('e=>e.scrollTop=e.scrollHeight');p.wait_for_timeout(160)
  assert p.locator('#btx-pane-videos').evaluate('e=>e.scrollTop')>0
  assert read(p)['scrollRange']==0,read(p)
  saved=p.locator('#btx-pane-videos').evaluate('e=>e.scrollTop')
  p.locator('#btx-tab-comments').click();p.locator('#btx-tab-videos').click();p.wait_for_timeout(120)
  assert p.locator('#btx-pane-videos').evaluate('e=>e.scrollTop')==saved
  change(p,{'youtubePanelScrollEnabled':False})
  noinner=read(p);assert noinner['scrollRange']>1000,noinner
  p.locator('#fixture-continuation').scroll_into_view_if_needed();assert p.locator('#fixture-continuation').is_visible()
  change(p,{'youtubePanelScrollEnabled':True});p.locator('#btx-tab-info').click();p.wait_for_timeout(200)
  assert read(p)['scrollRange']==0
  record('internal_scrolling_and_scroll_disabled_content_preserved',{'inner':inner,'savedInnerPosition':saved,'noInnerScroll':noinner,'final':read(p)});p.close()

  p=fixture(b);apply(p);assert_flow(p)
  p.evaluate('''() => {const below=document.getElementById('below');below.style.minHeight='480px';below.style.paddingBottom='55px';}''');p.wait_for_timeout(180)
  assert read(p)['scrollRange']==0
  change(p,{'youtubeLayoutTabsEnabled':False});restored=read(p)
  assert not restored['marked'] and restored['below']['minHeight']=='480px' and restored['below']['paddingBottom']=='55px',restored
  assert p.evaluate('LayoutRegressionFixture.related.parentElement.id==="secondary-inner"')
  for i in range(3):
   change(p,{'youtubeLayoutTabsEnabled':True});assert_flow(p);assert read(p)['scrollRange']==0
   change(p,{'youtubeLayoutTabsEnabled':False});assert not read(p)['marked']
  record('restore_current_site_style_and_repeated_enable_disable',restored);p.close()

  for width in [1600,1200,980,720,390]:
   p=fixture(b,width=width);apply(p);s=assert_flow(p,width>980)
   assert p.evaluate('document.documentElement.scrollWidth<=innerWidth'),s
   if width<=980:assert s['below']['minHeight']=='380px',s
   record('responsive_native_one_column_'+str(width),s);p.close()
  p=fixture(b);apply(p);assert_flow(p)
  p.set_viewport_size({'width':700,'height':900});p.wait_for_timeout(250);assert_flow(p,False)
  p.set_viewport_size({'width':1440,'height':900});p.wait_for_timeout(250);assert_flow(p);assert read(p)['scrollRange']==0
  record('window_resize_releases_and_reapplies_sizing',read(p));p.close()

  p=fixture(b);apply(p);assert_flow(p)
  p.evaluate('LayoutRegressionFixture.watch.setAttribute("theater","")');p.wait_for_timeout(150)
  assert_flow(p,False);assert read(p)['below']['minHeight']=='380px'
  p.evaluate('LayoutRegressionFixture.watch.removeAttribute("theater")');p.wait_for_timeout(150);assert_flow(p)
  p.evaluate('''() => {const button=document.createElement('button');button.id='fixture-fullscreen';button.textContent='전체 화면 시험';button.addEventListener('click',()=>document.querySelector('#movie_player').requestFullscreen());document.querySelector('#fixture-owner').append(button);}''')
  p.locator('#fixture-fullscreen').click();wait_state(p,'document.fullscreenElement!==null');p.wait_for_timeout(150);assert_flow(p,False)
  p.evaluate('document.exitFullscreen()');wait_state(p,'document.fullscreenElement===null');p.wait_for_timeout(180);assert_flow(p)
  record('theater_and_real_Fullscreen_API_restore_site_sizing',read(p));p.close()

  p=fixture(b);apply(p);assert_flow(p)
  p.evaluate('''() => {const n=document.createElement('ytd-playlist-panel-renderer');n.id='playlist';n.style.cssText='display:block;height:900px';n.textContent='실제 시험용 재생목록';document.querySelector('#secondary-inner').append(n);}''');p.wait_for_timeout(150);assert_flow(p,False)
  assert p.locator('#playlist').evaluate('e=>e.getBoundingClientRect().height')==900
  p.evaluate('document.getElementById("playlist").remove()');p.wait_for_timeout(150);assert_flow(p)
  record('open_native_panel_not_resized_or_clipped',read(p));p.close()

  p=fixture(b);p.evaluate('LayoutRegressionFixture.related.remove()');apply(p)
  partial=assert_flow(p,False);assert partial['state']['layout']=='partial';assert partial['below']['minHeight']=='380px'
  record('incomplete_relocation_does_not_restyle_outer_page',partial);p.close()
  p=fixture(b,settings={'youtubeLayoutTabsEnabled':False});apply(p);off=assert_flow(p,False)
  assert off['below']['minHeight']=='380px';record('disabled_feature_has_no_flow_styles',off);p.close()

  p=fixture(b);apply(p);assert_flow(p)
  for event in ['navigation','cache']:
   if event=='navigation':
    p.evaluate('document.dispatchEvent(new Event("yt-navigate-start"))');assert not read(p)['marked']
    p.evaluate('document.dispatchEvent(new Event("yt-navigate-finish"))')
   else:
    p.evaluate('window.dispatchEvent(new PageTransitionEvent("pagehide",{persisted:true}))');assert not read(p)['marked']
    p.evaluate('window.dispatchEvent(new PageTransitionEvent("pageshow",{persisted:true}))')
   p.wait_for_timeout(500);assert_flow(p);assert read(p)['scrollRange']==0
  record('synthetic_navigation_and_cache_lifecycle_cleanup',read(p));p.close()

  p=fixture(b);p.evaluate('u=>{LayoutRegressionFixture.mainVideo.src=u;LayoutRegressionFixture.mainVideo.playbackRate=2.25;}',VIDEO)
  wait_state(p,'LayoutRegressionFixture.mainVideo.readyState>=2')
  p.evaluate('LayoutRegressionFixture.mainVideo.currentTime=1.5');p.wait_for_timeout(100)
  before=p.evaluate('({rate:LayoutRegressionFixture.mainVideo.playbackRate,time:LayoutRegressionFixture.mainVideo.currentTime,ready:LayoutRegressionFixture.mainVideo.readyState})')
  apply(p);assert_flow(p)
  after=p.evaluate('({rate:LayoutRegressionFixture.mainVideo.playbackRate,time:LayoutRegressionFixture.mainVideo.currentTime,ready:LayoutRegressionFixture.mainVideo.readyState})')
  assert before==after,(before,after)
  start=p.evaluate('__browserToolboxYouTubeLayoutV1__.getStatus().reconciliationCount')
  p.wait_for_timeout(500);end=p.evaluate('__browserToolboxYouTubeLayoutV1__.getStatus().reconciliationCount');assert start==end,(start,end)
  record('native_media_state_preserved_no_idle_reconciliation',{'before':before,'after':after,'idleReconciliations':end-start});p.close()
  assert not result['errors'],result['errors']
  result['passed']=True;b.close()
except Exception as error:
 result['failure']=str(error);traceback.print_exc();raise
finally:
 result['baseline_sha256']={name:hashlib.sha256((ROOT/'tests/fixtures'/name).read_bytes()).hexdigest() for name in ['legacy_scroll_layout.ts','legacy_scroll_layout.css']}
 (OUT/'scroll_regression_results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
