"""Actual Chromium DOM/CSS/media/input, model player owns resize and cached seek state.
Chrome APIs are controlled doubles. Not actual YouTube or an installed extension.
--baseline reads unchanged prior dist and CSS; no source predicates except the
YouTube URL guard are adapted. Captured source inputs are not modified to pass.
"""
from pathlib import Path
import argparse,base64,json,re,shutil,traceback
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--baseline',type=Path);p.add_argument('--chromium',default=shutil.which('chromium'));p.add_argument('--output',type=Path,default=R/'.test_results/foundation.json');a=p.parse_args()
S=a.baseline or R
report={'scope':__doc__,'baseline':bool(a.baseline),'tests':{},'pageErrors':[]}
vid='data:video/webm;base64,'+base64.b64encode((R/'tests/fixtures/player_geometry.webm').read_bytes()).decode()
fixtures=['layout_regression_fixture','scroll_regression_fixture','playlist_fixture','theater_fixture','width_fixture','player_viewport_fixture','foundation_fixture']
def code(page,name):page.evaluate((S/'dist'/name).read_text())
def record(name,fn):
 try: report['tests'][name]={'passed':True,'observed':fn()};print('PASS',name,flush=True)
 except Exception: report['tests'][name]={'passed':False,'error':traceback.format_exc()};print('FAIL',name,report['tests'][name]['error'],flush=True)
def setup(b,html='<!doctype html><html><head></head><body></body></html>',viewport=None):
 q=b.new_page(viewport=viewport or {'width':1920,'height':1100});q.set_default_timeout(6000);q.on('pageerror',lambda e:report['pageErrors'].append(str(e)));q.set_content(html);q.evaluate((R/'.test_dist/browser_harness.js').read_text());return q
def wait_for_player_sync(q):
 # Await the final observed geometry, not a cached state-machine phase from
 # before set_viewport_size(). Native ResizeObserver updates are asynchronous.
 q.wait_for_function("""()=>{
  const m=FoundationFixture.read();
  return m.status.pageFlow.playerSizing.viewportFit.widthPhase==='accepted' &&
   Math.abs(m.video.width-m.player.width)<2 &&
   Math.abs(m.controls.width-(m.player.width-24))<2 &&
   Math.abs(m.progress.width-m.controls.width)<2 &&
   Math.abs(m.row.width-m.controls.width)<2;
 }""")
def player_test(b,mode):
 q=setup(b)
 for f in fixtures:q.evaluate((R/'.test_dist'/f'{f}.js').read_text())
 q.evaluate('(m)=>FoundationFixture.player(m)',mode);code(q,'toolbox_shared.js')
 q.evaluate('css=>{const s=document.createElement("style");s.textContent=css;document.head.append(s)}',(S/'youtube_layout.css').read_text())
 q.evaluate('u=>PlayerViewportFixture.video.src=u',vid);q.wait_for_function('PlayerViewportFixture.video.readyState>=2')
 source=(S/'dist/youtube_layout.js').read_text()
 for n in ['isYouTubePage','isWatchPage']:
  source,count=re.subn(r'    function '+n+r'\(\) \{.*?(?:\n    \}| \})',f'    function {n}() {{ return true; }}',source,count=1,flags=re.S);assert count==1
 q.evaluate(source);q.evaluate('__test.update({youtubeLayoutTabsEnabled:true})');q.wait_for_function("__browserToolboxYouTubeLayoutV1__.getStatus().layout==='applied'")
 responsive=mode in ['responsive-css','native-resizes']
 if not a.baseline:q.wait_for_function("__browserToolboxYouTubeLayoutV1__.getStatus().pageFlow.playerSizing.viewportFit.widthPhase === '"+('accepted' if responsive else 'blocked')+"'")
 else:q.wait_for_timeout(1400)
 state=q.evaluate('FoundationFixture.read()');ref=state['reference']
 assert state['overriddenNativeNodes']==0,state
 assert state['videoSame'] and state['hosts']==1,state
 assert state['syntheticResize'] == (0 if responsive else 1),state
 if responsive:
  assert state['player']['width']>ref['player']+200,state
  assert abs(state['video']['width']-state['player']['width'])<2,state
  assert abs(state['controls']['width']-(state['player']['width']-24))<2,state
  assert abs(state['progress']['width']-state['controls']['width'])<2,state
 else:
  assert abs(state['player']['width']-ref['player'])<2,state
  assert abs(state['controls']['width']-ref['controls'])<2,state
  assert state['status']['pageFlow']['widthSizingReason']=='native-width-restored',state
  assert '폭 확장' in state['note'],state
 # Actual pointer input evaluated against the model's independent cached width.
 q.evaluate('PlayerViewportFixture.video.pause()')
 for frac in [.25,.75,.95]:
  r=q.locator('.ytp-progress-bar').bounding_box();q.mouse.click(r['x']+r['width']*frac,r['y']+5)
  q.wait_for_function('(f)=>Math.abs(PlayerViewportFixture.video.currentTime/PlayerViewportFixture.video.duration-f)<.015',arg=frac)
 q.evaluate('PlayerViewportFixture.video.currentTime=1;PlayerViewportFixture.video.playbackRate=3');q.locator('#native-play').click();q.wait_for_function('PlayerViewportFixture.video.currentTime>0 && !PlayerViewportFixture.video.paused')
 rate=q.evaluate('PlayerViewportFixture.video.playbackRate');assert rate==3
 q.evaluate('async()=>{await PlayerViewportFixture.video.play();PlayerViewportFixture.video.pause()}')  # Await actual start before the test pause; natural end has dedicated coverage.
 if responsive and not a.baseline:
  for width in [2560,1200,1920]:
   q.set_viewport_size({'width':width,'height':1100})
   wait_for_player_sync(q)
   measured=q.evaluate('FoundationFixture.read()')
   assert abs(measured['video']['width']-measured['player']['width'])<2 and measured['overriddenNativeNodes']==0
  for _ in range(2):
   q.keyboard.press('t');q.wait_for_function("!!document.querySelector('ytd-watch-flexy[theater]')")
   q.wait_for_function("__browserToolboxYouTubeLayoutV1__.getStatus().pageFlow.widthSizingReason==='native-mode'")
   assert q.locator('[data-btx-layout-width]').count()>0
   q.keyboard.press('t');q.wait_for_function("!document.querySelector('ytd-watch-flexy[theater]')")
   wait_for_player_sync(q)
  if mode=='native-resizes':
   q.evaluate("()=>{FoundationFixture.nativeObserver.disconnect();const f=PlayerViewportFixture,r=FoundationFixture.reference;f.video.style.width=r.player+'px';f.video.style.height=r.height+'px';f.controls.style.width=r.controls+'px';f.controls.querySelector('.ytp-progress-bar').style.width=r.controls+'px';f.controls.querySelector('.ytp-chrome-controls').style.width=r.controls+'px'}")
   q.wait_for_function("__browserToolboxYouTubeLayoutV1__.getStatus().pageFlow.playerSizing.viewportFit.widthPhase==='unconfirmed'")
   observed=q.evaluate('FoundationFixture.read()')
   assert observed['status']['pageFlow']['playerSizing']['viewportFit']['widthExpansionApplied']
   assert observed['video']['width'] < observed['player']['width']-2 and observed['overriddenNativeNodes']==0
   assert q.locator('#btx-youtube-tabs').count()==1
 q.evaluate('__test.update({youtubeLayoutTabsEnabled:false})');q.wait_for_function("!document.querySelector('#btx-youtube-tabs')")
 assert q.locator('[data-btx-layout-width]').count()==0 and q.locator('[data-btx-player-viewport]').count()==0
 q.close();return {k:state[k] for k in ['reference','player','video','controls','progress','row','note','overriddenNativeNodes','syntheticResize']}|{'seekFractions':[.25,.75,.95],'rate':rate}
def popup(q):
 for f in ['popup_harness.js','foundation_fixture.js']:q.evaluate((R/'.test_dist'/f).read_text())
 code(q,'toolbox_shared.js')
def popup_race(b,quality):
 html=(R/'popup.html').read_text();html=re.sub(r'<script\b[^>]*>\s*</script>','',html);html=re.sub(r'<link\b[^>]*href="popup.css"[^>]*>',lambda _:'<style>'+(R/'popup.css').read_text()+'</style>',html)
 q=setup(b,html,{'width':780,'height':600});popup(q)
 module='youtube_quality_popup.js' if quality else 'youtube_tools_popup.js';code(q,module)
 q.evaluate('document.querySelector("#view-youtube").hidden=false; document.querySelector("#youtube-tools-card").open=true')
 target='#youtube-quality-auto' if quality else '#btx-option-youtubeLayoutTabsEnabled'
 q.wait_for_function('(s)=>!document.querySelector(s).disabled',arg=target)
 q.evaluate('FoundationFixture.holdReadback()')
 # Chromium trusted input, hidden view geometry is not relevant to storage order.
 q.locator(target).focus();q.keyboard.press('Space')
 q.wait_for_function('foundationReadCount()===1')
 key='youtubePreferredQualityEnabled' if quality else 'youtubeLayoutTabsEnabled'
 q.evaluate('(k)=>__test.update({[k]:false})',key);q.evaluate('foundationReleaseRead()')
 q.wait_for_function('(s)=>!document.querySelector(s).disabled',arg=target)
 observed=q.locator(target).is_checked();stored=q.evaluate('(k)=>__test.settings[k]',key)
 assert observed==stored==False,{'ui':observed,'stored':stored}
 q.close();return {'ui':observed,'stored':stored}
def xml_test(b,payload,expected_ok):
 q=setup(b);q.evaluate((S/'dist/youtube_caption_text_bridge.js').read_text()+';globalThis.youtubeCaptionTextBridge=youtubeCaptionTextBridge;void 0;')
 reply=q.evaluate('''payload=>{const id='abcdef12-1234-1234-1234-123456789abc';youtubeCaptionTextBridge({action:'install',channelId:id});let result;
 document.addEventListener('browser-toolbox-caption-text-response:'+id,e=>result=JSON.parse(e.detail),{once:true});
 document.dispatchEvent(new CustomEvent('browser-toolbox-caption-text-request:'+id,{detail:JSON.stringify({requestId:id+':1',operation:'parse-xml',text:payload})}));
 youtubeCaptionTextBridge({action:'dispose',channelId:id});return result;}''',payload)
 assert reply['ok']==expected_ok,reply
 if expected_ok:assert reply['entries'][0]['startMs']==0,reply
 q.close();return reply
def selection(q):
 q.evaluate("()=>{chrome.runtime.sendMessage=m=>{__test.sent.push(m);return Promise.resolve({ok:true})}}");code(q,'selector.js')
def selection_lifecycle(b):
 q=setup(b);selection(q);assert q.locator('#__drag_area_screenshot_host__').count()==1
 q.mouse.move(200,200);q.mouse.down();q.mouse.move(300,500)
 q.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))")
 assert q.locator('#__drag_area_screenshot_host__').count()==0
 q.mouse.up();assert not q.evaluate("__test.sent.some(m=>m.type==='drag-area-screenshot:capture')")
 q.close();return {'selectionCancelled':True,'capturedAfterPageReturn':False,'lifecycle':'synthetic pagehide/pageshow, not actual BFCache'}
def caption_reset_failure(b):
 html=(R/'popup.html').read_text();html=re.sub(r'<script\b[^>]*>\s*</script>','',html)
 q=setup(b,html,{'width':780,'height':600});popup(q);code(q,'youtube_transcript_popup.js')
 q.evaluate("document.querySelector('#view-captions').hidden=false;document.querySelectorAll('details').forEach(d=>d.open=true)")
 q.wait_for_function("!document.querySelector('#youtube-synced-caption-position-reset').disabled")
 q.locator('#youtube-transcript-toggle').click();q.evaluate('__test.faults.write=true');q.locator('#youtube-synced-caption-position-reset').click()
 q.wait_for_timeout(60)
 state=q.evaluate("({text:document.querySelector('#status').textContent,kind:document.querySelector('#status').dataset.state})")
 assert '저장하지 못' in state['text'] and '되돌렸습니다' not in state['text'],state
 q.close();return state
def shortcut_case(b,scenario):
 html='<main><form id="own"><textarea id="prompt-textarea">draft</textarea></form><div id="outside"></div></main>'
 q=setup(b,html)
 q.evaluate('''scenario=>{globalThis.shortcutProbe={clicks:0,plainEnter:0,ctrlEnter:0};const f=document.querySelector('#own'),e=document.querySelector('textarea');
 const button=(root,attrs,label)=>{const b=document.createElement('button');b.type='button';for(const [k,v] of Object.entries(attrs))b.setAttribute(k,v);b.textContent=label;b.addEventListener('click',()=>shortcutProbe.clicks++);root.append(b);return b};
 if(scenario==='outside')button(document.querySelector('#outside'),{'data-testid':'send-button'},'Send');
 if(scenario==='native-send')button(f,{'data-testid':'send-button'},'Send');
 if(scenario==='hidden-send'){const h=document.createElement('div');h.hidden=true;f.append(h);button(h,{'data-testid':'send-button'},'Send')}
 if(scenario==='edit-ambiguous'){f.setAttribute('data-turn','user');button(f,{},'Cancel');button(f,{'class':'btn-primary'},'Preview')}
 e.addEventListener('keydown',ev=>{if(ev.key==='Enter'){if(ev.ctrlKey)shortcutProbe.ctrlEnter++;else {shortcutProbe.plainEnter++;ev.preventDefault()}}});
 }''',scenario)
 code(q,'content_script.js');q.wait_for_selector('#chatgpt-ctrl-enter-conversation-width',state='attached');q.locator('textarea').focus();q.keyboard.press('Control+Enter')
 value=q.evaluate('shortcutProbe')
 if scenario=='native-send':assert value['clicks']==1 and value['plainEnter']==0,value
 else:assert value['clicks']==0 and value['plainEnter']==0 and value['ctrlEnter']==1,value
 q.close();return value

def caption_read_state(b,failed):
 html=(R/'popup.html').read_text();html=re.sub(r'<script\b[^>]*>\s*</script>','',html)
 q=setup(b,html,{'width':780,'height':600});popup(q)
 if failed:q.evaluate('__test.faults.read=true')
 else:q.evaluate('FoundationFixture.holdReadback()')
 code(q,'youtube_transcript_popup.js')
 if failed:
  q.wait_for_timeout(60);state=q.evaluate("({disabled:document.querySelector('#youtube-synced-caption-font-size').disabled,text:document.querySelector('#status').textContent})")
  assert state['disabled'] and '읽지 못' in state['text'],state
 else:
  q.wait_for_function('foundationReadCount()===1');q.evaluate('__test.update({youtubeSyncedCaptionFontSizePx:48})');q.evaluate('foundationReleaseRead()')
  q.wait_for_function("document.documentElement.dataset.popupCaptionsReady==='true'")
  state={'fontSize':q.locator('#youtube-synced-caption-font-size').input_value()};assert state['fontSize']=='48',state
  q.evaluate('__test.update({youtubeSyncedCaptionFontSizePx:36})');assert q.locator('#youtube-synced-caption-font-size').input_value()=='36'
 q.close();return state

def eraser_case(b,scenario):
 q=setup(b,'<!doctype html><html><body><div id="target" style="position:absolute;left:200px;top:160px;width:250px;height:100px">Test element</div></body></html>')
 code(q,'toolbox_shared.js')
 restore=(S/'dist/element_eraser_restore.js').read_text()
 restore,n=re.subn(r'function getSiteKey\(\) \{.*?\n    \}', 'function getSiteKey() { return "https://fixture.test"; }',restore,count=1,flags=re.S);assert n==1;q.evaluate(restore)
 q.evaluate('''()=>{const prior=chrome.runtime.sendMessage;globalThis.eraseReplies=[];chrome.runtime.sendMessage=(m,cb)=>{if(m.type!=='page-element-eraser:add-rule')return prior(m,cb);
 __test.update({pageElementEraserRulesV1:{'https://fixture.test':[{selector:m.selector}]}}).then(()=>eraseReplies.push(cb));}}''')
 code(q,'element_eraser.js');q.evaluate('__pageElementEraserControllerV1__.start("persistent")')
 if scenario=='pagehide':
  q.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}))");state={'hosts':q.locator('#__page_element_eraser_host__').count()};assert state['hosts']==0,state
 else:
  q.mouse.move(240,200);q.mouse.click(240,200);q.wait_for_function('eraseReplies.length===1')
  if scenario=='cleared':q.evaluate('__test.update({pageElementEraserRulesV1:{}})')
  if scenario=='style-changed':q.evaluate('''()=>{document.querySelector('#target').style.setProperty('display','grid','important');eraseReplies.shift()({ok:false,error:'Injected rejected save'})}''')
  else:q.evaluate('eraseReplies.shift()({ok:true})')
  q.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))')
  state=q.locator('#target').evaluate('(e)=>({display:getComputedStyle(e).display,inline:e.style.display,priority:e.style.getPropertyPriority("display"),sessionSheet:!!document.querySelector("#__page_element_eraser_session_style__")})')
  if scenario=='cleared':assert state['display']!='none',state
  elif scenario=='style-changed':assert state['display']=='grid' and state['priority']=='important',state
  else:assert state['display']=='none',state
 q.close();return state

def history_descriptor(b):
 q=setup(b);q.evaluate("()=>{globalThis.originalHistoryDescriptors=Object.fromEntries(['pushState','forward','go'].map(k=>[k,Object.getOwnPropertyDescriptor(History.prototype,k)]));history.pushState({},'', '#first');history.pushState({},'', '#second')}")
 q.evaluate((S/'dist/navigation_guard.js').read_text()+";globalThis.applyNavigationGuardMain=applyNavigationGuardMain;void 0;")
 q.evaluate("applyNavigationGuardMain('__cbt_guard_'+ 'a'.repeat(32),{backNavigationProtectionEnabled:true})")
 q.evaluate("()=>new Promise(resolve=>{window.addEventListener('popstate',()=>resolve(true),{once:true});history.back()})")
 q.evaluate("globalThis['__cbt_guard_'+ 'a'.repeat(32)].cleanup()")
 result=q.evaluate("()=>Object.fromEntries(Object.entries(originalHistoryDescriptors).map(([k,v])=>{const n=Object.getOwnPropertyDescriptor(History.prototype,k);return [k,{sameValue:v.value===n.value,enumerableBefore:v.enumerable,enumerableAfter:n.enumerable,writableBefore:v.writable,writableAfter:n.writable,configurableBefore:v.configurable,configurableAfter:n.configurable}]}))")
 assert all(v['sameValue'] and v['enumerableBefore']==v['enumerableAfter'] and v['writableBefore']==v['writableAfter'] and v['configurableBefore']==v['configurableAfter'] for v in result.values()),result
 q.close();return result

try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(executable_path=a.chromium,headless=True,args=['--no-sandbox','--autoplay-policy=no-user-gesture-required']);report['browser']=b.version
  for mode in ['responsive-css','native-resizes','cached-native','stale-child']:record('player_'+mode,lambda mode=mode:player_test(b,mode))
  record('quality_readback_late_result',lambda:popup_race(b,True));record('youtube_tools_readback_late_result',lambda:popup_race(b,False))
  for name,payload,ok in [('missing_time','<transcript><text dur="1">missing</text></transcript>',False),('invalid_time','<transcript><text start="bad">bad</text></transcript>',False),('negative_time','<timedtext><body><p t="-1">bad</p></body></timedtext>',False),('zero_time','<transcript><text start="0" dur="1">zero</text></transcript>',True)]:record('xml_'+name,lambda p=payload,k=ok:xml_test(b,p,k))
  record('selection_pagehide_cancel',lambda:selection_lifecycle(b));record('caption_reset_write_failure',lambda:caption_reset_failure(b))
  record('history_descriptor_restored',lambda:history_descriptor(b))
  for scenario in ['cleared','style-changed','pagehide','saved']:record('eraser_'+scenario,lambda scenario=scenario:eraser_case(b,scenario))
  for failed in [False,True]:record('caption_read_'+('error' if failed else 'latest'),lambda failed=failed:caption_read_state(b,failed))
  for scenario in ['outside','missing','hidden-send','edit-ambiguous','native-send']:record('shortcut_'+scenario,lambda scenario=scenario:shortcut_case(b,scenario))
  b.close()
finally:
 report['passed']=all(x['passed'] for x in report['tests'].values()) and not report['pageErrors'];a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(report,ensure_ascii=False,indent=2))
 if not report['passed']:raise SystemExit(1)
