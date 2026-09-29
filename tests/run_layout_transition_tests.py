"""Mode-return and watch-to-watch regressions using real Chromium DOM/media/input.
The native-player model and Chrome APIs are test doubles. Production host,
pathname and video-key address checks are adapted for about:blank; URL history is real.
"""
from pathlib import Path
import argparse, base64, json, re, shutil, traceback
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--baseline-script',type=Path)
p.add_argument('--chromium',default=shutil.which('chromium'))
p.add_argument('--output',type=Path,default=R/'.test_results/layout_transition.json')
a=p.parse_args()
report={'scope':__doc__,'baseline':bool(a.baseline_script),'tests':{},'observationsOnFailure':{},'pageErrors':[]}
video='data:video/webm;base64,'+base64.b64encode((R/'tests/fixtures/player_geometry.webm').read_bytes()).decode()
fixtures=['browser_harness','layout_regression_fixture','scroll_regression_fixture','playlist_fixture','theater_fixture','width_fixture','player_viewport_fixture','foundation_fixture','layout_transition_fixture']
def make(b):
 q=b.new_page(viewport={'width':1920,'height':1100});q.set_default_timeout(6500)
 q.on('pageerror',lambda e:report['pageErrors'].append(str(e)))
 q.set_content('<!doctype html><html><head></head><body></body></html>')
 for f in fixtures:q.evaluate((R/'.test_dist'/f'{f}.js').read_text())
 q.evaluate('LayoutTransitionFixture.build()')
 q.evaluate((R/'dist/toolbox_shared.js').read_text())
 q.evaluate('css=>{const s=document.createElement("style");s.textContent=css;document.head.append(s)}',(R/'youtube_layout.css').read_text())
 q.evaluate('u=>PlayerViewportFixture.video.src=u',video)
 q.wait_for_function('PlayerViewportFixture.video.readyState>=2')
 source=(a.baseline_script or R/'dist/youtube_layout.js').read_text()
 for n in ['isYouTubePage','isWatchPage']:
  source,count=re.subn(r'    function '+n+r'\(\) \{.*?(?:\n    \}| \})',f'    function {n}() {{ return true; }}',source,count=1,flags=re.S);assert count==1
 # This fixture deliberately uses about:blank?v=..., not a production watch route.
 source,count=re.subn(r'const videoKey = \(\) => [^\n]+;', 'const videoKey = () => new URL(location.href).searchParams.get("v") || "";',source,count=1);assert count==1
 q.evaluate(source);q.evaluate('__test.update({youtubeLayoutTabsEnabled:true})')
 accepted(q)
 return q
PHASE="__browserToolboxYouTubeLayoutV1__.getStatus().pageFlow?.playerSizing?.viewportFit?.widthPhase"
def accepted(q):q.wait_for_function(PHASE+"==='accepted'")
def read(q):return q.evaluate('LayoutTransitionFixture.read()')
def healthy(q):
 s=read(q); assert s['hosts']==1 and s['sameVideo'] and s['nativeStyleMarkers']==0,s
 assert s['status']['pageFlow']['playerSizing']['viewportFit']['widthPhase']=='accepted',s
 assert abs(s['video']['width']-s['player']['width'])<2,s
 assert abs(s['controls']['width']-(s['player']['width']-24))<2,s
 assert abs(s['row']['width']-s['controls']['width'])<2 and abs(s['progress']['width']-s['controls']['width'])<2,s
 return s
def seek(q):
 q.evaluate('PlayerViewportFixture.video.pause()')
 for f in [.25,.75,.95]:
  # A product diagnostic measures DOM geometry. The native fixture updates its
  # separate seek cache in ResizeObserver, so wait for that callback as well.
  q.wait_for_function('(()=>{const s=LayoutTransitionFixture.read();return s.settled && Math.abs(s.cachedSeekWidth-s.progress.width)<.5})()')
  r=q.locator('.ytp-progress-bar').bounding_box();q.mouse.click(r['x']+r['width']*f,r['y']+5)
  q.wait_for_function('(f)=>Math.abs(PlayerViewportFixture.video.currentTime/PlayerViewportFixture.video.duration-f)<.015',arg=f)
 return read(q)['seekCalls']
def finish(q):
 s=healthy(q);s['seekCallsAfter']=seek(q)
 q.screenshot(path=str(a.output.parent/'current_success.png'))
 q.evaluate('__test.update({youtubeLayoutTabsEnabled:false})');q.wait_for_function("!document.querySelector('#btx-youtube-tabs')")
 assert q.locator('[data-btx-layout-width]').count()==0
 q.close();return s

def case(b,name):
 q=make(b)
 try:
  if name=='initial': return finish(q)
  if name.startswith('replace_'):
   q.evaluate('(k)=>LayoutTransitionFixture.replaceControls(k)',name[8:]);q.wait_for_timeout(1400)
  elif name=='theater_return':
   for _ in range(3):
    q.keyboard.press('t');q.wait_for_function("!!document.querySelector('ytd-watch-flexy[theater]')")
    q.wait_for_function("__browserToolboxYouTubeLayoutV1__.getStatus().pageFlow.widthSizingReason==='native-mode'")
    assert q.locator('[data-btx-layout-width]').count()>0
    q.keyboard.press('t');q.wait_for_function('LayoutTransitionFixture.settled')
    q.wait_for_timeout(1200);healthy(q)
  elif name=='recommendation_navigation':
   for _ in range(3):
    q.locator('#btx-tab-videos').click();q.locator('#fixture-recommendation').click()
    q.wait_for_function('LayoutTransitionFixture.settled');q.wait_for_timeout(1200);healthy(q)
   assert read(q)['trustedVisits']==3
  elif name=='unavailable_controls':
   q.evaluate('LayoutTransitionFixture.hideControls(true)');q.wait_for_timeout(1400)
   during=read(q)
   assert during['status']['pageFlow']['playerSizing']['viewportFit']['widthPhase']!='blocked',during
   q.evaluate('LayoutTransitionFixture.hideControls(false)');accepted(q)
  elif name=='staged_geometry':
   q.evaluate('LayoutTransitionFixture.stagedNativeResize()');q.wait_for_function('LayoutTransitionFixture.settled');accepted(q)
  elif name=='resize_after_replacement':
   q.evaluate("LayoutTransitionFixture.replaceControls('controls')")
   for width in [1200,2560,1920]:
    q.set_viewport_size({'width':width,'height':1100});accepted(q);healthy(q)
  elif name=='rapid_theater_round_trip':
   for _ in range(3):
    q.keyboard.press('t');q.keyboard.press('t')
    q.wait_for_function('LayoutTransitionFixture.settled');q.wait_for_timeout(1200);healthy(q)
  elif name=='full_screen_return':
   q.locator('#native-fullscreen').click();q.wait_for_function('document.fullscreenElement!==null')
   q.wait_for_function("__browserToolboxYouTubeLayoutV1__.getStatus().pageFlow.widthSizingReason==='native-mode'")
   assert q.locator('[data-btx-layout-width]').count()>0
   q.evaluate("document.exitFullscreen()")
   q.wait_for_function('document.fullscreenElement===null');accepted(q)
   q.evaluate("LayoutTransitionFixture.replaceControls('row')");q.wait_for_timeout(1200)
  elif name=='background_clock':
   # Controlled visibility notification, NOT a real background-tab test.
   q.evaluate("""()=>{
    LayoutTransitionFixture.breakProgress();
    Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
    document.dispatchEvent(new Event('visibilitychange'));
   }""")
   q.wait_for_timeout(1400)
   assert read(q)['status']['pageFlow']['playerSizing']['viewportFit']['widthPhase']!='blocked'
   q.evaluate("""()=>{
    const p=PlayerViewportFixture.player;
    p.querySelector('.ytp-progress-bar').style.removeProperty('width');p.querySelector('.ytp-chrome-controls').style.removeProperty('width');
    delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));
   }""")
   accepted(q)
  elif name=='mode_during_mismatch':
   q.evaluate('LayoutTransitionFixture.breakProgress()');q.wait_for_timeout(650)
   q.keyboard.press('t');q.wait_for_function("!!document.querySelector('ytd-watch-flexy[theater]')")
   q.wait_for_timeout(1300)
   assert q.locator('[data-btx-layout-width]').count()>0
   q.evaluate("()=>{const p=PlayerViewportFixture.player;p.querySelector('.ytp-progress-bar').style.removeProperty('width');p.querySelector('.ytp-chrome-controls').style.removeProperty('width')}")
   q.keyboard.press('t');q.wait_for_function('LayoutTransitionFixture.settled');accepted(q)
  elif name=='replaced_but_wrong_size':
   q.evaluate("LayoutTransitionFixture.replaceControls('controls');LayoutTransitionFixture.breakProgress()")
   q.wait_for_function(PHASE+"==='unconfirmed'");s=read(q)
   assert s['status']['pageFlow']['playerSizing']['viewportFit']['widthExpansionApplied']
   assert s['progress']['width'] < s['controls']['width']-2
   q.close();return s
  elif name=='idle_no_polling':
   q.wait_for_timeout(600);start=read(q)['status']['pageFlow']['sizingChecks']
   q.wait_for_timeout(1400);end=read(q)['status']['pageFlow']['sizingChecks']
   assert end==start,(start,end)
  elif name=='persistent_mismatch':
   q.evaluate('LayoutTransitionFixture.breakProgress()')
   q.wait_for_function(PHASE+"==='unconfirmed'")
   s=read(q);assert s['hosts']==1 and s['nativeStyleMarkers']==0 and s['status']['pageFlow']['playerSizing']['viewportFit']['widthExpansionApplied'],s
   assert s['progress']['width'] < s['controls']['width']-2,s
   q.wait_for_timeout(1300);assert read(q)['status']['pageFlow']['playerSizing']['viewportFit']['widthPhase']=='unconfirmed'
   assert not read(q)['status']['pageFlow']['playerSizing']['viewportFit']['pendingCheck']
   q.close();return s
  elif name=='disabled_during_wait':
   q.evaluate('LayoutTransitionFixture.breakProgress();__test.update({youtubeLayoutTabsEnabled:false})')
   q.wait_for_timeout(1400);assert q.locator('[data-btx-layout-width]').count()==0 and q.locator('#btx-youtube-tabs').count()==0
   q.close();return {'restored':True}
  else:raise ValueError(name)
  return finish(q)
 except Exception:
  report['observationsOnFailure'][name]=read(q)
  q.screenshot(path=str(a.output.parent/(name+'_failure.png')))
  q.close();raise
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=a.chromium,headless=True,args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
 report['browserVersion']=b.version
 a.output.parent.mkdir(parents=True,exist_ok=True)
 for name in ['initial','replace_controls','replace_progress','replace_row','theater_return','recommendation_navigation','unavailable_controls','staged_geometry','persistent_mismatch','disabled_during_wait','resize_after_replacement','rapid_theater_round_trip','full_screen_return','background_clock','mode_during_mismatch','replaced_but_wrong_size','idle_no_polling']:
  try:report['tests'][name]={'passed':True,'observed':case(b,name)};print('PASS',name,flush=True)
  except Exception:report['tests'][name]={'passed':False,'error':traceback.format_exc()};print('FAIL',name,report['tests'][name]['error'][-1400:],flush=True)
 b.close()
a.output.write_text(json.dumps(report,indent=2,ensure_ascii=False))
raise SystemExit(0 if all(v.get('passed',True) for v in report['tests'].values()) and not report['pageErrors'] else 1)
