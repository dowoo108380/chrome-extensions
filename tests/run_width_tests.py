"""Real Chromium width/layout tests. Native site is a controlled fixture; Chrome
APIs are doubles. Not live YouTube, Windows, GPU/VSR or installed-MV3 validation.
Only hostname/watch predicates are replaced in memory. No security policy bypass.
Optionally compare the unmodified previous release using --baseline-archive.
"""
from pathlib import Path
import argparse, base64, hashlib, json, re, shutil, time, traceback, zipfile
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.test_results';OUT.mkdir(exist_ok=True)
ap=argparse.ArgumentParser(description=__doc__)
ap.add_argument('--chromium',default=shutil.which('chromium'))
ap.add_argument('--baseline-archive')
args=ap.parse_args()
result={'passed':False,'environment':{'scope':__doc__,'target_youtube':'not tested','tests_use_captured_site_css':False},'tests':[], 'errors':[]}
SETTINGS={'youtubeLayoutTabsEnabled':True,'youtubePanelScrollEnabled':True,'youtubeCommentStatusEnabled':True,'youtubeNativePanelsEnabled':True}
VIDEO='data:video/webm;base64,'+base64.b64encode((ROOT/'tests/fixtures/test.webm').read_bytes()).decode()
def record(name,obs):
 result['tests'].append({'name':name,'observed':obs});print('PASS',name,flush=True)
def read(p):return p.evaluate('WidthFixture.read()')
def change(p,s):p.evaluate('s=>__test.update(s)',s);p.wait_for_timeout(220)
def source(old=False):
 if old:
  with zipfile.ZipFile(args.baseline_archive) as z: code=z.read('browser_toolbox_extension/dist/youtube_layout.js').decode()
 else:code=(ROOT/'dist/youtube_layout.js').read_text()
 for name in ['isYouTubePage','isWatchPage']:
  code,n=re.subn(r'    function '+name+r'\(\) \{.*?(?:\n    \}| \})',f'    function {name}() {{ return true; }}',code,count=1,flags=re.S);assert n==1
 return code

def setup(b,options=None,width=1920,old=False,enabled=True):
 p=b.new_page(viewport={'width':width,'height':1200});p.set_default_timeout(6500)
 p.on('pageerror',lambda e:result['errors'].append(str(e)))
 p.set_content('''<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="require-trusted-types-for 'script'; trusted-types 'none';"></head><body></body></html>''')
 for n in ['layout_regression_fixture','scroll_regression_fixture','playlist_fixture','theater_fixture','width_fixture','browser_harness']:
  p.evaluate((ROOT/'.test_dist'/f'{n}.js').read_text())
 p.evaluate('o=>WidthFixture.build(o)',options or {})
 p.evaluate('WidthFixture.installNativeControls()')
 p.evaluate('s=>Object.assign(__test.settings,s)',{**SETTINGS,'youtubeLayoutTabsEnabled':enabled})
 p.evaluate((ROOT/'dist/toolbox_shared.js').read_text())
 if old:
  with zipfile.ZipFile(args.baseline_archive) as z:css=z.read('browser_toolbox_extension/youtube_layout.css').decode()
 else:css=(ROOT/'youtube_layout.css').read_text()
 p.evaluate('css=>{const s=document.createElement("style");s.textContent=css;document.head.append(s)}',css)
 p.evaluate(source(old));p.wait_for_timeout(400)
 return p

def compact(p):
 r=read(p);flow=r['status']['pageFlow'];assert flow['widthSizingReason']=='compact',r
 boxes=sorted([r['primary'],r['secondary']],key=lambda x:x['left']);a,b=boxes
 for actual in [a['left']-r['columns']['left'],r['columns']['right']-b['right'],b['left']-a['right']]:assert abs(actual-16)<1,r
 assert abs(r['watch']['width']-r['app']['width'])<1,r
 assert r['horizontalRange']==0 and r['hostCount']==1 and r['originalVideo'],r
 assert abs(r['player']['width']/r['player']['height']-16/9)<.02,r
 assert r['video']['style'] is None,r
 assert r['status']['layout']=='applied',r
 return r
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
  result['environment']['browser']=b.version
  if args.baseline_archive:
   for opt in [{},{'rootLimit':True},{'innerLimit':True}]:
    old=setup(b,opt,old=True);before=read(old)
    p=setup(b,opt);after=compact(p)
    assert before['primary']['left']>after['primary']['left']+20,(before,after)
    assert after['player']['width']>before['player']['width'],(before,after)
    assert after['sidebar']['width']==before['sidebar']['width'],(before,after)
    if not opt:
     old.screenshot(path=str(OUT/'width_before.png'));p.screenshot(path=str(OUT/'width_after.png'))
    record('baseline_comparison_'+str(opt),{'before':before,'after':after});old.close();p.close()
  for width in [1100,1280,1440,1920,2560,3840]:
   p=setup(b,width=width);record('viewport_'+str(width),compact(p));p.close()
  for opts in [{'kind':'grid'},{'sidebar':True},{'rtl':True},{'playlist':False}]:
   p=setup(b,opts);record('supported_variant_'+str(opts),compact(p));p.close()
  for width in [390,720,980]:
   p=setup(b,width=width);r=read(p);assert r['markers']==0 and r['horizontalRange']==0,r
   before=r['player'];change(p,{'youtubeLayoutTabsEnabled':False});assert read(p)['player']==before
   record('narrow_native_'+str(width),r);p.close()
  p=setup(b,{'rootLimit':True,'innerLimit':True},enabled=False);before=read(p)
  change(p,{'youtubeLayoutTabsEnabled':True});compact(p)
  change(p,{'youtubeLayoutTabsEnabled':False});after=read(p)
  assert after['markers']==0
  for name in ['watch','columns','player','sidebar','video']:assert after[name]==before[name],(name,before,after)
  # Disabling reveals CURRENT native CSS, not stale styles captured at activation.
  change(p,{'youtubeLayoutTabsEnabled':True});compact(p)
  p.evaluate('document.querySelector("#fixture-native-width").sheet.insertRule("ytd-watch-flexy:not([theater]) > #columns { max-width:1400px; }", document.querySelector("#fixture-native-width").sheet.cssRules.length)')
  change(p,{'youtubeLayoutTabsEnabled':False});assert read(p)['columns']['width']==1400
  record('disable_restores_original_then_updated_native_rules',after);p.close()
  p=setup(b);compact(p)
  p.set_viewport_size({'width':720,'height':1200});p.wait_for_timeout(300);r=read(p)
  # Existing normal-mode markers persist; CSS gates their effect in native modes.
  assert r['markers']>0 and r['horizontalRange']==0 and r['status']['pageFlow']['widthSizingReason']=='narrow-window',r
  p.set_viewport_size({'width':1920,'height':1200});p.wait_for_timeout(300);record('resize_roundtrip',compact(p))
  # Original videos/list nodes and selection survive actual trusted T input;
  # the fixture, not production code, implements site mode changes/reparenting.
  p.locator('#btx-tab-playlist').click();p.wait_for_timeout(100)
  for _ in range(3):
   p.keyboard.press('t');p.wait_for_timeout(400);r=read(p)
   assert r['markers']>0 and r['status']['displayMode']=='theater' and r['status']['selected']=='playlist' and r['horizontalRange']==0,r
   p.keyboard.press('t');p.wait_for_timeout(400);compact(p)
  record('T_roundtrips_and_playlist_preserved',read(p))
  p.evaluate('''() => {const button=document.createElement('button');button.id='width-fullscreen';button.textContent='전체 화면';button.onclick=()=>document.querySelector('#movie_player').requestFullscreen();document.querySelector('#movie_player').append(button);}''')
  p.locator('#width-fullscreen').click();p.wait_for_timeout(300)
  assert p.evaluate('document.fullscreenElement?.id')=='movie_player'
  r=read(p);assert r['markers']>0 and r['status']['displayMode']=='fullscreen' and r['horizontalRange']==0,r
  p.evaluate('document.exitFullscreen()');p.wait_for_timeout(300);record('real_fullscreen_exit_restores_width',compact(p))
  # Switching contents does not change the video size or the gap.
  for name in ['comments','videos','info','playlist']:
   p.locator('#btx-tab-'+name).click();p.wait_for_timeout(130);compact(p)
  record('all_tabs_keep_width',read(p))
  p.evaluate('''() => {const node=document.createElement('section');node.id='width-long-content';node.style.height='1500px';node.textContent='실제 긴 내용';const end=document.createElement('button');end.id='width-last';end.textContent='마지막';end.onclick=()=>window.widthLastClicked=true;document.querySelector('#below').append(node,end);}''')
  p.locator('#width-last').click();assert p.evaluate('window.widthLastClicked && scrollY>0')
  record('long_content_not_clipped',{'scrollY':p.evaluate('scrollY'),'geometry':read(p)})
  p.evaluate('document.querySelector("#width-long-content").remove(); document.querySelector("#width-last").remove();scrollTo(0,0)')
  p.evaluate('u=>{const v=LayoutRegressionFixture.mainVideo;v.src=u;v.playbackRate=3;}',VIDEO)
  deadline=time.monotonic()+6
  while not p.evaluate('LayoutRegressionFixture.mainVideo.readyState>=2'):
   assert time.monotonic()<deadline,'Real WebM did not load'
   p.wait_for_timeout(50)
  p.evaluate('LayoutRegressionFixture.mainVideo.play()');p.wait_for_timeout(400)
  live=read(p);assert live['media']['time']>.3 and live['media']['rate']==3 and live['originalVideo']
  # Never change the source or media state during width updates.
  p.set_viewport_size({'width':1600,'height':1200});p.wait_for_timeout(250);r=compact(p)
  assert r['media']['src']==live['media']['src'] and r['media']['rate']==3 and not r['media']['paused']
  record('real_video_playback_survives_resize',{'time':r['media']['time'],'rate':r['media']['rate'],'originalVideo':r['originalVideo']})
  p.wait_for_timeout(400);start=read(p)['status']['reconciliationCount'];p.wait_for_timeout(400);assert read(p)['status']['reconciliationCount']==start
  record('no_idle_layout_polling',{'reconciliations':start});p.close()
  # A one-column native breakpoint on a wide viewport must not be forced back.
  p=setup(b);compact(p)
  p.evaluate('document.querySelector("#columns").style.flexDirection="column"');p.wait_for_timeout(300)
  r=read(p);assert r['markers']==0 and r['status']['pageFlow']['widthSizingReason']=='unsupported-columns',r
  record('native_one_column_direction_is_respected',r);p.close()
  # Hidden comments are not a prerequisite for horizontal width handling.
  p=setup(b,enabled=False);p.evaluate('LayoutRegressionFixture.comments.hidden=true')
  change(p,{'youtubeLayoutTabsEnabled':True});r=read(p)
  assert r['status']['layout']=='partial' and r['status']['pageFlow']['widthSizingReason']=='compact',r
  record('width_does_not_wait_for_comments',r);p.close()
  b.close()
 result['passed']=not result['errors']
except Exception as e:
 result['failure']=str(e);result['traceback']=traceback.format_exc();print(result['traceback'],flush=True)
finally:
 result['sourceHashes']={n:hashlib.sha256((ROOT/n).read_bytes()).hexdigest() for n in ['src/youtube_layout.ts','dist/youtube_layout.js','youtube_layout.css']}
 (OUT/'width_results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
 print('RESULT',result['passed'],len(result['tests']),'groups',flush=True)
 if not result['passed']:raise SystemExit(1)
