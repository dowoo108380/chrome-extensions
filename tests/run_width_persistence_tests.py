"""Uninterrupted wide-shell ownership over modes, navigation and natural playback end.
Actual Chromium DOM/media/input; page-owned layout timing and Chrome APIs are
independent test doubles, not captured YouTube internals or a live-site test.
Host, pathname and video-key address checks are adapted for about:blank.
"""
from pathlib import Path
import argparse,base64,json,re,shutil,traceback,time
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--baseline-script',type=Path)
p.add_argument('--chromium',default=shutil.which('chromium'))
p.add_argument('--output',type=Path,default=R/'.test_results/width_persistence.json')
p.add_argument('--only',default='')
a=p.parse_args();a.output.parent.mkdir(parents=True,exist_ok=True)
report={'scope':__doc__,'baseline':bool(a.baseline_script),'tests':{},'pageErrors':[]}
video='data:video/webm;base64,'+base64.b64encode((R/'tests/fixtures/player_geometry.webm').read_bytes()).decode()
fixtures=['browser_harness','layout_regression_fixture','scroll_regression_fixture','playlist_fixture','theater_fixture','width_fixture','player_viewport_fixture','foundation_fixture','width_persistence_fixture']
PHASE="__browserToolboxYouTubeLayoutV1__.getStatus().pageFlow?.playerSizing?.viewportFit?.widthPhase"
READ='WidthPersistenceFixture.read()'
def make(b, initial_completion=True):
 q=b.new_page(viewport={'width':1920,'height':1100});q.set_default_timeout(5500)
 q.on('pageerror',lambda e:report['pageErrors'].append(str(e)))
 q.set_content('<!doctype html><html><head></head><body></body></html>')
 for f in fixtures:q.evaluate((R/'.test_dist'/f'{f}.js').read_text())
 q.evaluate('WidthPersistenceFixture.build()');q.evaluate((R/'dist/toolbox_shared.js').read_text())
 q.evaluate('version=>{chrome.runtime.getManifest=()=>({version})}', '1.75.0' if a.baseline_script else json.loads((R/'manifest.json').read_text())['version'])
 q.evaluate('css=>{const s=document.createElement("style");s.textContent=css;document.head.append(s)}',(R/'youtube_layout.css').read_text())
 q.evaluate('u=>{PlayerViewportFixture.video.muted=true;PlayerViewportFixture.video.src=u}',video)
 q.wait_for_function('PlayerViewportFixture.video.readyState>=2')
 source=(a.baseline_script or R/'dist/youtube_layout.js').read_text()
 for n in ['isYouTubePage','isWatchPage']:
  body='return true;' if n=='isYouTubePage' else 'return new URL(location.href).searchParams.has("v");'
  source,count=re.subn(r'    function '+n+r'\(\) \{.*?(?:\n    \}| \})',f'    function {n}() {{ {body} }}',source,count=1,flags=re.S);assert count==1
 # Keep the synthetic about:blank query in sync with the fixture's video-id.
 source,count=re.subn(r'const videoKey = \(\) => [^\n]+;', 'const videoKey = () => new URL(location.href).searchParams.get("v") || "";',source,count=1);assert count==1
 q.evaluate(source);q.evaluate('__test.update({youtubeLayoutTabsEnabled:true})')
 q.wait_for_function("document.querySelector('ytd-watch-flexy').getAttribute('data-btx-layout-width')==='watch'")
 # Both versions receive the same single native initial-layout completion.
 if initial_completion:
  q.evaluate("WidthPersistenceFixture.commit('initial-wide')")
  q.wait_for_function(PHASE+"==='accepted'");q.wait_for_timeout(100)
 q.evaluate('WidthPersistenceFixture.beginTrace()');return q

def read(q):return q.evaluate(READ)
def healthy(q):
 q.wait_for_function("""()=>{const s=WidthPersistenceFixture.read();return s.wide==='watch'&&s.hosts===1&&
   s.player.width>1400&&Math.abs(s.video.width-s.player.width)<2&&Math.abs(s.progress.width-(s.player.width-24))<2&&
   s.status.pageFlow.playerSizing.viewportFit.widthPhase==='accepted'}""")
 s=read(q);assert s['sameVideo'] and not s['forbiddenMarkers'],s
 return s

def seek(q):
 q.evaluate('PlayerViewportFixture.video.pause()')
 results=[]
 for f in [.25,.75,.95]:
  r=q.locator('.ytp-progress-bar').bounding_box();q.mouse.click(r['x']+r['width']*f,r['y']+5)
  q.wait_for_function('f=>Math.abs(PlayerViewportFixture.video.currentTime/PlayerViewportFixture.video.duration-f)<.015',arg=f)
  results.append({'requested':f,'observed':q.evaluate('PlayerViewportFixture.video.currentTime/PlayerViewportFixture.video.duration')})
 return results

def run(b,name):
 q=make(b,name!='initial_failure_guard')
 try:
  if name=='initial_wide':healthy(q)
  elif name=='theater_roundtrip':
   for _ in range(3):
    q.keyboard.press('t');q.wait_for_function("!!document.querySelector('ytd-watch-flexy[theater]')")
    q.wait_for_timeout(100)
    q.keyboard.press('t');q.wait_for_function("!document.querySelector('ytd-watch-flexy[theater]')")
    q.wait_for_timeout(1300);healthy(q)
   s=read(q);assert not s['removed'],s
  elif name=='immediate_normal_mode_width':
   q.keyboard.press('t');q.wait_for_timeout(100);q.keyboard.press('t');q.wait_for_timeout(150)
   s=read(q);normal=[v for v in s['reads'] if v['reason']=='normal-return']
   assert normal and all(v['width']>1400 and v['wide'] for v in normal),s
  elif name=='recommendation_routes':
   for _ in range(3):
    q.locator('#btx-tab-videos').click();q.locator('#persistence-next').click()
    q.wait_for_timeout(1300);healthy(q)
   assert read(q)['routes']==3 and not read(q)['removed'],read(q)
  elif name=='natural_end_replay':
   q.evaluate('()=>{PlayerViewportFixture.video.currentTime=PlayerViewportFixture.video.duration-.35;return PlayerViewportFixture.video.play()}')
   q.wait_for_function('PlayerViewportFixture.video.ended');q.wait_for_timeout(1350)
   s=read(q);assert s['endedTrusted'] and s['wide']=='watch' and s['player']['width']>1400 and not s['removed'],s
   q.evaluate('()=>{PlayerViewportFixture.video.currentTime=0;return PlayerViewportFixture.video.play()}')
   healthy(q);q.evaluate('PlayerViewportFixture.video.pause()')
  elif name=='end_to_next_video':
   q.evaluate('()=>{PlayerViewportFixture.video.currentTime=PlayerViewportFixture.video.duration-.25;return PlayerViewportFixture.video.play()}')
   q.wait_for_function('PlayerViewportFixture.video.ended');q.wait_for_timeout(1250)
   q.locator('#btx-tab-videos').click();q.locator('#persistence-next').click()
   q.evaluate('()=>{PlayerViewportFixture.video.currentTime=0;return PlayerViewportFixture.video.play()}');q.wait_for_timeout(1250)
   healthy(q);assert not read(q)['removed'],read(q)
  elif name=='navigation_without_finish':
   q.evaluate('WidthPersistenceFixture.navigate(false)');q.wait_for_timeout(1300);healthy(q)
   assert not read(q)['removed'],read(q)
  elif name=='navigation_cancel':
   q.evaluate("document.dispatchEvent(new Event('yt-navigate-start'))")
   q.wait_for_timeout(1300);s=read(q);assert s['wide']=='watch' and s['player']['width']>1400,s
   q.evaluate("document.dispatchEvent(new Event('yt-navigate-finish'))");healthy(q)
  elif name=='same_video_navigation':
   q.evaluate("document.dispatchEvent(new Event('yt-navigate-start'));document.dispatchEvent(new Event('yt-navigate-finish'))")
   healthy(q);q.wait_for_timeout(100);assert not read(q)['removed'],read(q)
  elif name=='disabled_during_navigation':
   q.evaluate("document.dispatchEvent(new Event('yt-navigate-start'));__test.update({youtubeLayoutTabsEnabled:false})")
   q.wait_for_timeout(1350);s=read(q);assert s['markers']==0 and s['hosts']==0,s
   q.close();return s
  elif name=='leave_watch_page':
   q.evaluate("document.dispatchEvent(new Event('yt-navigate-start'));history.pushState({},'','about:blank');document.dispatchEvent(new Event('yt-navigate-finish'))")
   q.wait_for_timeout(1300);s=read(q);assert s['markers']==0 and s['hosts']==0,s
   q.close();return s
  elif name=='pagehide_during_navigation':
   q.evaluate("document.dispatchEvent(new Event('yt-navigate-start'));window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}))")
   q.wait_for_timeout(100);s=read(q);assert s['markers']==0 and s['hosts']==0,s
   q.close();return s
  elif name=='diagnosis_never_invents_success':
   q.evaluate('WidthPersistenceFixture.breakControls()');q.wait_for_timeout(1350)
   s=read(q);fit=s['status']['pageFlow']['playerSizing']['viewportFit']
   assert s['wide']=='watch' and fit['state']=='native-size-unconfirmed-width-retained' and fit['widthPhase']=='unconfirmed',s
   assert not fit['pendingCheck'],s
   q.evaluate('WidthPersistenceFixture.repairControls()');healthy(q)
  elif name=='initial_failure_guard':
   q.wait_for_function(PHASE+"==='blocked'");s=read(q)
   assert s['wide'] is None and s['markers']==0 and not s['status']['pageFlow']['playerSizing']['viewportFit'].get('previouslyVerifiedWide',False),s
   q.close();return s
  elif name=='url_precedes_native_identity':
   q.evaluate("history.pushState({},'','about:blank?v=Persistent_late')")
   q.wait_for_timeout(150)
   s=read(q);assert s['wide']=='watch' and s['player']['width']>1400 and not s['removed'],s
   q.evaluate("LayoutRegressionFixture.watch.setAttribute('video-id','Persistent_late');WidthPersistenceFixture.commit('late-native-commit')")
   healthy(q);assert not read(q)['removed'],read(q)
  elif name=='remove_watch_during_navigation':
   q.evaluate("document.dispatchEvent(new Event('yt-navigate-start'));LayoutRegressionFixture.watch.remove()")
   q.wait_for_timeout(150)
   assert q.evaluate("!LayoutRegressionFixture.watch.querySelector('[data-btx-layout-width]')&&!LayoutRegressionFixture.watch.hasAttribute('data-btx-layout-width')")
   q.close();return {'detachedMarkersReleased':True}
  elif name=='disable_in_theater':
   q.keyboard.press('t');q.wait_for_timeout(100)
   q.evaluate('__test.update({youtubeLayoutTabsEnabled:false})');q.wait_for_timeout(100)
   assert read(q)['markers']==0 and read(q)['hosts']==0,read(q)
   q.keyboard.press('t');q.wait_for_timeout(1350);assert read(q)['markers']==0,read(q)
   q.close();return {'disabledRemainsDisabled':True}
  elif name=='disable_restores':
   q.evaluate('__test.update({youtubeLayoutTabsEnabled:false})');q.wait_for_function("!document.querySelector('#btx-youtube-tabs')")
   s=read(q);assert s['markers']==0 and s['sameVideo'],s
   q.close();return s
  elif name=='native_fullscreen_roundtrip':
   q.locator('#native-fullscreen').click();q.wait_for_function('document.fullscreenElement!==null');q.wait_for_timeout(80)
   q.evaluate('document.exitFullscreen()');q.wait_for_function('document.fullscreenElement===null')
   q.wait_for_timeout(1300);healthy(q);assert not read(q)['removed'],read(q)
  elif name=='idle_no_polling':
   q.wait_for_timeout(300);count=read(q)['status']['pageFlow']['sizingChecks'];q.wait_for_timeout(1400)
   assert read(q)['status']['pageFlow']['sizingChecks']==count
  elif name=='rate_and_cue_preserved':
   q.evaluate("""()=>{const v=PlayerViewportFixture.video;v.playbackRate=3;const t=v.addTextTrack('captions','Test','en');t.mode='hidden';t.addCue(new VTTCue(0,6,'test'));return v.play()}""")
   q.keyboard.press('t');q.wait_for_timeout(80);q.keyboard.press('t');q.wait_for_timeout(200);healthy(q)
   assert q.evaluate("PlayerViewportFixture.video.playbackRate===3 && PlayerViewportFixture.video.textTracks[0].activeCues.length===1")
   q.evaluate('PlayerViewportFixture.video.pause()')
  else:raise ValueError(name)
  s=healthy(q);s['seekChecks']=seek(q)
  if name in ['theater_roundtrip','recommendation_routes','natural_end_replay']:q.screenshot(path=str(a.output.parent/(a.output.stem+'_'+name+'.png')))
  q.close();return s
 except Exception:
  report.setdefault('observationsOnFailure',{})[name]=read(q)
  q.screenshot(path=str(a.output.parent/(a.output.stem+'_'+name+'_failure.png')));q.close();raise
names=['initial_wide','theater_roundtrip','immediate_normal_mode_width','recommendation_routes','natural_end_replay','end_to_next_video','navigation_without_finish','navigation_cancel','same_video_navigation','disabled_during_navigation','leave_watch_page','pagehide_during_navigation','diagnosis_never_invents_success','disable_restores','native_fullscreen_roundtrip','idle_no_polling','rate_and_cue_preserved','initial_failure_guard','url_precedes_native_identity','remove_watch_during_navigation','disable_in_theater']
if a.only:names=a.only.split(',')
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=a.chromium,headless=True,args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
 report['browserVersion']=b.version
 for n in names:
  started=time.monotonic();print('START',n,flush=True)
  try:report['tests'][n]={'passed':True,'observed':run(b,n)};print('PASS',n,flush=True)
  except Exception:report['tests'][n]={'passed':False,'error':traceback.format_exc()};print('FAIL',n,report['tests'][n]['error'][-1000:],flush=True)
  report['tests'][n]['elapsedSeconds']=round(time.monotonic()-started,3)
  a.output.write_text(json.dumps(report,indent=2,ensure_ascii=False))
 b.close()
a.output.write_text(json.dumps(report,indent=2,ensure_ascii=False))
raise SystemExit(0 if all(t['passed'] for t in report['tests'].values()) and not report['pageErrors'] else 1)
