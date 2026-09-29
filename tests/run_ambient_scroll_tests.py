"""Real Chromium ambient-overflow regressions; synthetic page, explicit Chrome doubles.
Production JS is unchanged except two host/watch predicates in memory. No live
YouTube, Windows, NVIDIA or installed-MV3 verification is claimed.
"""
from pathlib import Path
import argparse, hashlib, json, re, shutil, time, traceback
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.test_results'; OUT.mkdir(exist_ok=True)
ap = argparse.ArgumentParser(description=__doc__)
ap.add_argument('--chromium', default=shutil.which('chromium') or shutil.which('chrome'))
args = ap.parse_args()
if not args.chromium: ap.error('Pass --chromium with an installed browser.')
result = {'passed':False, 'environment':{'scope':'local Chromium components, not live YouTube/Windows/installed MV3/NVIDIA',
 'fixture':'test-owned canvas and transformed descendants; not captured site CSS',
 'chrome_apis':'browser_harness doubles', 'csp':"require-trusted-types-for 'script'; trusted-types 'none'",
 'source_changes':'two URL predicates only, in-memory', 'clipboard':'explicit double, not OS clipboard'}, 'tests':{}, 'errors':[]}
SETTINGS = {'youtubeLayoutTabsEnabled':True,'youtubePanelScrollEnabled':True,'youtubeNativePanelsEnabled':True,'youtubeDescriptionExpandedEnabled':False}
def record(name, value):
 result['tests'][name]=value;print('PASS:',name,flush=True)
def source(old=False):
 code=(ROOT/('.test_ambient_baseline/tests/fixtures/legacy_ambient_layout.js' if old else 'dist/youtube_layout.js')).read_text()
 for predicate in ['isYouTubePage','isWatchPage']:
  first=re.search(r'^    function '+predicate+r'\(\) \{[^\n]*',code,re.M);assert first
  pattern=r'^    function '+predicate+(r'\(\) \{[^\n]*\}' if first.group(0).rstrip().endswith('}') else r'\(\) \{.*?\n    \}')
  code,n=re.subn(pattern,f'    function {predicate}() {{ return true; }}',code,count=1,flags=re.S|re.M);assert n==1
 return code
def build(browser,kind='absolute-canvas',old=False,attach=True):
 p=browser.new_page(viewport={'width':1440,'height':900});p.set_default_timeout(6000)
 p.on('pageerror',lambda e:result['errors'].append(str(e)))
 p.set_content('''<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="require-trusted-types-for &#39;script&#39;; trusted-types &#39;none&#39;"></head><body></body></html>''')
 for name in ['layout_regression_fixture','scroll_regression_fixture','ambient_scroll_fixture','browser_harness']:p.evaluate((ROOT/'.test_dist'/f'{name}.js').read_text())
 p.evaluate('ScrollRegressionFixture.build("none")')
 if attach:p.evaluate('k=>AmbientScrollFixture.attach(k)',kind)
 p.evaluate('s=>Object.assign(__test.settings,s)',SETTINGS)
 p.evaluate((ROOT/'dist/toolbox_shared.js').read_text())
 css=(ROOT/('tests/fixtures/legacy_ambient_layout.css' if old else 'youtube_layout.css')).read_text()
 p.evaluate('css=>{const s=document.createElement("style");s.textContent=css;document.head.append(s)}',css)
 return p
def apply(p,old=False):p.evaluate(source(old));p.wait_for_timeout(500)
def read(p):return p.evaluate('AmbientScrollFixture.read()')
def change(p,v):p.evaluate('v=>__test.update(v)',v);p.wait_for_timeout(300)
def expect_contained(p):
 r=read(p);assert r['state']['pageFlow']['ambientState']=='contained',r
 assert r['contain']=='size layout style' and r['overflow']=='visible',r
 assert r['rootOverflow']=='visible' and r['bodyOverflow']=='visible',r
 return r
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox'])
  result['environment']['browser']=browser.version
  for kind in ['absolute-canvas','transformed-canvas','zero-size-root','nested-absolute']:
   old=build(browser,kind,True);apply(old,True);before=read(old)
   assert before['state']['pageFlow']['contentSized'] is True and before['scrollRange']>200,before
   p=build(browser,kind);apply(p);after=expect_contained(p)
   assert after['scrollRange']==0 and after['sameCanvas'] is True,after
   # 1.62 expands horizontal space intentionally; verify proportional player
   # growth while retaining the unchanged canvas and identical glow pixels.
   dw=after['player']['width']-before['player']['width']
   dh=after['player']['height']-before['player']['height']
   assert dw>=0 and abs(dh-dw*9/16)<0.05 and before['canvas']==after['canvas'],(before,after)
   region={'x':0,'y':790,'width':24,'height':50}
   before_paint=old.screenshot(clip=region);after_paint=p.screenshot(clip=region)
   assert before_paint==after_paint, 'Ambient paint changed in the outside-box test region'
   # A negative control proves that this is the decoration, not a blank sample.
   old.evaluate('AmbientScrollFixture.decoration.style.visibility="hidden"')
   assert old.screenshot(clip=region)!=after_paint
   old.evaluate('AmbientScrollFixture.decoration.style.visibility="visible"')
   p.mouse.move(20,780);p.mouse.wheel(0,1200);p.wait_for_timeout(120);assert p.evaluate('scrollY')==0
   if kind=='absolute-canvas':
    old.evaluate('scrollTo(0,document.scrollingElement.scrollHeight)');old.wait_for_timeout(80)
    old.screenshot(path=str(OUT/'ambient_before_bottom.png'));p.screenshot(path=str(OUT/'ambient_after_top.png'))
   record('previous_release_fails_'+kind,{'before':before,'after':after,'paintRegion':region,'paintBeforeSha256':hashlib.sha256(before_paint).hexdigest(),'paintAfterSha256':hashlib.sha256(after_paint).hexdigest()})
   old.close();p.close()

  p=build(browser);apply(p);expect_contained(p)
  p.evaluate('''() => {const section=document.createElement('section');section.style.cssText='height:1250px;display:flex;flex-direction:column;justify-content:flex-end';const button=document.createElement('button');button.id='real-footer';button.textContent='real content';button.addEventListener('click',()=>window.clickedFooter=true);section.append(button);document.querySelector('#below').append(section);}''')
  p.wait_for_timeout(250);long=read(p);assert long['scrollRange']>800,long
  p.locator('#real-footer').click();assert p.evaluate('clickedFooter') is True
  assert p.evaluate('scrollY')>500
  record('real_content_remains_scrollable',{'beforeClick':long,'afterLastButtonClick':read(p)});p.close()

  p=build(browser);apply(p);expect_contained(p)
  p.evaluate('AmbientScrollFixture.canvas.style.height="1500px"');p.wait_for_timeout(200)
  assert read(p)['scrollRange']==0
  for i in range(3):
   change(p,{'youtubeLayoutTabsEnabled':False});off=read(p);assert off['marker'] is None and off['contain']=='none',off
   change(p,{'youtubeLayoutTabsEnabled':True});expect_contained(p);assert read(p)['scrollRange']==0
  p.evaluate('AmbientScrollFixture.decoration.style.contain="paint"')
  change(p,{'youtubeLayoutTabsEnabled':False});assert read(p)['contain']=='paint'
  record('cleanup_preserves_current_site_style_and_canvas',read(p));p.close()

  for kind,reason in [('interactive','unverified-decoration'),('outside-watch','not-present'),('paint-contained','native-containment'),('important-override','style-not-applied')]:
   p=build(browser,kind);apply(p);r=read(p);assert r['state']['pageFlow']['ambientState']==reason,r
   if kind!='important-override':assert r['marker'] is None,r
   if kind=='important-override':assert r['scrollRange']>200 and r['contain']=='none',r
   record('safety_'+kind,r);p.close()

  p=build(browser);apply(p);expect_contained(p)
  p.evaluate('AmbientScrollFixture.addControl()');p.wait_for_timeout(250)
  r=read(p);assert r['marker'] is None and r['state']['pageFlow']['ambientState']=='unverified-decoration',r
  p.evaluate('document.getElementById("fixture-decoration-button").remove()');p.wait_for_timeout(250);expect_contained(p)
  record('new_interactive_content_releases_containment',read(p));p.close()

  p=build(browser,attach=False);apply(p)
  p.evaluate('AmbientScrollFixture.attach()');p.wait_for_timeout(250);expect_contained(p)
  p.evaluate('AmbientScrollFixture.canvas.remove()');p.wait_for_timeout(200);assert read(p)['marker'] is None
  p.evaluate('AmbientScrollFixture.decoration.firstChild.append(AmbientScrollFixture.canvas)');p.wait_for_timeout(250);expect_contained(p)
  record('late_ambient_root_and_canvas',read(p));p.close()

  p=build(browser);p.evaluate('LayoutRegressionFixture.related.remove()');apply(p)
  r=expect_contained(p);assert r['state']['layout']=='partial' and r['state']['pageFlow']['contentSized'] is False,r
  record('ambient_not_dependent_on_all_sections_ready',r);p.close()

  p=build(browser);apply(p);expect_contained(p)
  p.evaluate('LayoutRegressionFixture.watch.setAttribute("theater","")');p.wait_for_timeout(180)
  assert read(p)['marker'] is None and read(p)['state']['pageFlow']['ambientState']=='native-mode'
  p.evaluate('LayoutRegressionFixture.watch.removeAttribute("theater")');p.wait_for_timeout(180);expect_contained(p)
  p.evaluate('''() => {const button=document.createElement('button');button.id='fixture-fullscreen';button.textContent='전체 화면';button.addEventListener('click',()=>document.querySelector('#movie_player').requestFullscreen());document.querySelector('#fixture-owner').append(button);}''')
  p.locator('#fixture-fullscreen').click();p.wait_for_function('document.fullscreenElement!==null');p.wait_for_timeout(150)
  assert read(p)['marker'] is None
  p.evaluate('document.exitFullscreen()');p.wait_for_function('document.fullscreenElement===null');p.wait_for_timeout(250);expect_contained(p)
  record('real_fullscreen_api_releases_and_restores_containment',read(p))
  for event in ['navigation','cache']:
   if event=='navigation':
    p.evaluate('document.dispatchEvent(new Event("yt-navigate-start"))');assert read(p)['marker'] is None
    p.evaluate('document.dispatchEvent(new Event("yt-navigate-finish"))')
   else:
    p.evaluate('window.dispatchEvent(new PageTransitionEvent("pagehide",{persisted:true}))');assert read(p)['marker'] is None
    p.evaluate('window.dispatchEvent(new PageTransitionEvent("pageshow",{persisted:true}))')
   p.wait_for_timeout(300);expect_contained(p)
  start=p.evaluate('__browserToolboxYouTubeLayoutV1__.getStatus().reconciliationCount');p.wait_for_timeout(400)
  assert start==p.evaluate('__browserToolboxYouTubeLayoutV1__.getStatus().reconciliationCount')
  record('mode_and_synthetic_lifecycle_no_idle_work',read(p))
  raw=p.evaluate('__browserToolboxYouTubeLayoutV1__.getStatus()')
  p.evaluate('document.querySelector("video").playbackRate=2.25');p.wait_for_timeout(80);assert read(p)['rate']==2.25
  change(p,{'youtubeLayoutTabsEnabled':False});assert read(p)['rate']==2.25
  record('media_rate_is_not_changed',read(p));p.close()

  p=browser.new_page(viewport={'width':780,'height':600});p.on('pageerror',lambda e:result['errors'].append(str(e)))
  html=(ROOT/'popup.html').read_text();html=re.sub(r'<script\s+src="[^"]+"[^>]*></script>','',html);html=html.replace('<link rel="stylesheet" href="popup.css">','<style>'+(ROOT/'popup.css').read_text()+'</style>')
  p.set_content(html)
  for name in ['browser_harness','ambient_scroll_fixture']:p.evaluate((ROOT/'.test_dist'/f'{name}.js').read_text())
  p.evaluate('r=>AmbientScrollFixture.popupChrome(r)',raw)
  p.evaluate((ROOT/'dist/toolbox_shared.js').read_text());p.evaluate((ROOT/'dist/youtube_tools_popup.js').read_text());p.wait_for_timeout(100)
  p.evaluate((ROOT/'dist/popup_navigation.js').read_text());p.click('#nav-youtube');p.locator('#youtube-layout-diagnostics > summary').click();p.locator('#youtube-tools-inspect').click();p.wait_for_timeout(100)
  assert '스크롤 범위: 0px' in p.locator('#youtube-tools-status').inner_text()
  p.locator('#youtube-tools-copy-layout').click();p.wait_for_timeout(100)
  copied=json.loads(p.evaluate('copiedLayout'));assert copied['pageFlow']['ambientState']=='contained'
  assert 'URL' not in json.dumps(copied) and '댓글 37' not in json.dumps(copied)
  assert p.evaluate('document.documentElement.scrollWidth<=innerWidth')
  p.screenshot(path=str(OUT/'ambient_diagnostics_popup.png'))
  p.evaluate('window.failCopy=true');p.locator('#youtube-tools-copy-layout').click();p.wait_for_timeout(100)
  assert '복사하지 못했습니다' in p.locator('#youtube-tools-status').inner_text()
  assert p.locator('#youtube-tools-layout-json').input_value()
  record('popup_geometry_display_copy_and_visible_copy_failure',{'copied':copied,'copyFailure':p.locator('#youtube-tools-status').inner_text()});p.close()
  assert not result['errors'],result['errors'];result['passed']=True;browser.close()
except Exception as error:
 result['failure']=str(error);traceback.print_exc();raise
finally:
 result['baseline_sha256']={name:hashlib.sha256((ROOT/'tests/fixtures'/name).read_bytes()).hexdigest() for name in ['legacy_ambient_layout.ts','legacy_ambient_layout.css']}
 (OUT/'ambient_scroll_results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
