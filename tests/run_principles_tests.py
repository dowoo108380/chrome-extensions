"""Real local Chromium DOM/media/input, explicitly mocked Chrome storage/messages/downloads.
YouTube host/path predicates only are adapted to about:blank. No production handler
or CSS selector is replaced. --source-dir supports unchanged baseline comparison.
No live YouTube/ChatGPT, installed-extension, Windows or NVIDIA verification.
"""
from pathlib import Path
import argparse,base64,json,re,shutil,traceback
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source-dir',type=Path,default=R/'dist');p.add_argument('--output',type=Path,default=R/'.test_results/principles.json');p.add_argument('--chromium',default=shutil.which('chromium'))
a=p.parse_args();result={'scope':__doc__,'tests':{},'pageErrors':[]}
V='data:video/webm;base64,'+base64.b64encode((R/'tests/fixtures/test.webm').read_bytes()).decode()
BUTTON='#__browser_toolbox_youtube_ab_loop_button__';PANEL='#__browser_toolbox_youtube_ab_loop_panel__';TOGGLE='.btx-yt-ab-loop-toggle'
def source(page,name):page.evaluate((a.source_dir/name).read_text())
def setup(browser):
 page=browser.new_page(viewport={'width':1280,'height':900});page.set_default_timeout(5000)
 page.on('pageerror',lambda e:result['pageErrors'].append(str(e)))
 page.set_content('<!doctype html><html><body><video muted style="width:640px;height:360px"></video></body></html>')
 for f in ['browser_harness','principles_fixture']:page.evaluate((R/'.test_dist'/f'{f}.js').read_text())
 source(page,'toolbox_shared.js');return page
def ab(page,prepare=''):
 page.evaluate('PrinciplesFixture.preparePlayer()');page.evaluate('(src)=>document.querySelector("video").src=src',V)
 page.wait_for_function('document.querySelector("video").readyState>=2')
 if prepare:page.evaluate(prepare)
 code=(a.source_dir/'youtube_ab_loop.js').read_text();code,n=re.subn(r'function isYouTubeWatchPage\(\) \{.*?\n    \}', 'function isYouTubeWatchPage() { return true; }',code,count=1,flags=re.S);assert n==1
 page.evaluate(code);page.wait_for_selector(BUTTON);page.wait_for_timeout(80)
 page.evaluate('PrinciplesFixture.spyPlayback()')
def full(page):
 ab(page);page.click(BUTTON);page.locator('.btx-yt-ab-loop-mode').filter(has_text='전체 영상').click();page.click(TOGGLE)
def state(page):return page.evaluate('PrinciplesFixture.mediaState()')
def layout_race(page):
 for f in ['layout_regression_fixture','layout_lifecycle_fixture']:page.evaluate((R/'.test_dist'/f'{f}.js').read_text())
 page.evaluate('LayoutLifecycleFixture.build()');page.evaluate('Object.assign(__test.settings,{youtubeLayoutTabsEnabled:true,youtubePanelScrollEnabled:true})')
 page.evaluate('css=>{let s=document.createElement("style");s.textContent=css;document.head.append(s)}',(R/'youtube_layout.css').read_text())
 page.evaluate('PrinciplesFixture.holdLocalReads()')
 code=(a.source_dir/'youtube_layout.js').read_text()
 for name,value in [('isYouTubePage','true'),('isWatchPage','globalThis.__lifecycleRoute.watch')]:
  code,n=re.subn(r'    function '+name+r'\(\) \{.*?(?:\n    \}| \})',f'    function {name}() {{ return {value}; }}',code,count=1,flags=re.S);assert n==1
 code,n=re.subn(r'const videoKey = \(\) => [^\n]+;', 'const videoKey = () => globalThis.__lifecycleRoute.key;',code,count=1);assert n==1
 page.evaluate(code);page.wait_for_function('__auditReadCount()===1')
 page.evaluate('__test.update({youtubeProgressThemeEnabled:true})');page.evaluate('__auditReleaseRead()')
 page.wait_for_timeout(180)
 observed=page.evaluate('LayoutLifecycleFixture.read()');assert observed['status']['layout']=='applied',observed
 assert observed['hosts']==1 and observed['sourceSame'] and observed['infoSame'] and observed['commentSame'],observed
 return {'layout':observed['status']['layout'],'hosts':observed['hosts'],'nodesPreserved':True}
def closed_panel(page):
 ab(page);page.locator(TOGGLE).focus()
 observed=page.evaluate('({hidden:document.querySelector("'+PANEL+'").getAttribute("aria-hidden"),focusedInside:document.querySelector("'+PANEL+'").contains(document.activeElement)})')
 assert not observed['focusedInside'],observed
 page.click(BUTTON);page.locator(TOGGLE).focus();assert page.locator(TOGGLE).evaluate('(e)=>e===document.activeElement')
 page.click('#outside');assert page.locator('#outside').evaluate('(e)=>e===document.activeElement')
 return observed

def paused_tail(page):
 full(page);page.evaluate('()=>{const v=document.querySelector("video");v.pause();v.currentTime=v.duration-.1;}');page.wait_for_timeout(220)
 observed=state(page);assert observed['paused'] and observed['time']>observed['duration']-.2,observed
 return observed

def full_tail(page):
 full(page);page.evaluate('()=>{const v=document.querySelector("video");v.currentTime=v.duration-.5;__auditSeeks.length=0;return v.play()}')
 page.wait_for_function('__auditSeeks.some(s=>s.to===0)',timeout=5000);observed=state(page)
 rewinds=[s for s in observed['seeks'] if s['to']==0];assert rewinds[0]['ended'],observed
 page.evaluate('document.querySelector("video").pause()');return observed

def ab_ended(page):
 ab(page);page.click(BUTTON)
 page.evaluate('document.querySelector("video").currentTime=1');page.wait_for_function('!document.querySelector("video").seeking');page.locator('.btx-yt-ab-loop-set').nth(0).click()
 page.evaluate('()=>{const v=document.querySelector("video");v.currentTime=v.duration}');page.wait_for_function('!document.querySelector("video").seeking');page.locator('.btx-yt-ab-loop-set').nth(1).click()
 page.evaluate('()=>{const v=document.querySelector("video");v.currentTime=v.duration-.4}');page.wait_for_function('!document.querySelector("video").seeking');page.click(TOGGLE)
 page.evaluate('()=>{__auditSeeks.length=0;return document.querySelector("video").play()}');page.wait_for_function('__auditSeeks.some(s=>s.to===1)',timeout=5000);page.wait_for_timeout(150)
 observed=state(page);assert not observed['paused'] and observed['time']>1,observed
 return observed

def player_identity(page):
 ab(page,'''()=>{const controls=document.createElement('div');controls.className='ytp-right-controls';controls.id='decoy-controls';controls.style.cssText='height:48px;width:80px';document.body.prepend(controls);}''')
 observed=page.locator(BUTTON).evaluate('(e)=>({inPlayer:!!e.closest("#movie_player"),inDecoy:!!e.closest("#decoy-controls")})')
 assert observed['inPlayer'] and not observed['inDecoy'],observed;return observed

def preserve_position(page):
 ab(page,'document.querySelector("#movie_player").style.position="static"')
 page.evaluate('document.querySelector("#movie_player").style.position="sticky"');page.evaluate('__browserToolboxYouTubeAbLoopV1__.destroy()')
 observed=page.locator('#movie_player').evaluate('(e)=>e.style.position');assert observed=='sticky',observed;return {'position':observed}

def settings_popup(page):
 page.set_content((R/'popup.html').read_text());page.evaluate('PrinciplesFixture.holdLocalReads()');source(page,'settings_transfer.js');source(page,'settings_tools_popup.js')
 page.wait_for_function('__auditReadCount()===1');page.evaluate('__test.update({youtubeSyncedCaptionOverflowMode:"expand"})');page.evaluate('__auditReleaseRead()');page.wait_for_timeout(30)
 observed=page.locator('#caption-overflow-mode').input_value();assert observed=='expand',observed;return {'overflow':observed}

def missing_source(page):
 page.evaluate('(src)=>document.querySelector("video").src=src',V);page.wait_for_function('document.querySelector("video").readyState>=2');source(page,'media_controller.js');page.wait_for_function('__chatgptBrowserToolsMediaControllerV1__.getMediaCount()===1');page.wait_for_timeout(100)
 before=page.evaluate('__test.media()');observed=page.evaluate('PrinciplesFixture.queryMedia("removed-media","url:removed")');after=page.evaluate('__test.media()')
 assert observed['hasMedia'] is False,observed;assert before['rate']==after['rate'];return {'reply':observed,'rateBefore':before['rate'],'rateAfter':after['rate']}

def failed_download(page):
 page.set_content((R/'file_to_image.html').read_text());source(page,'file_to_image_core.js');page.evaluate('PrinciplesFixture.trackObjectUrls()')
 cover=base64.b64encode((R/'assets/file_to_image_default.jpg').read_bytes()).decode()
 page.evaluate('s=>{globalThis.fetch=async()=>new Response(Uint8Array.from(atob(s),c=>c.charCodeAt(0)),{status:200})}',cover)
 source(page,'file_to_image.js');page.wait_for_function('document.querySelector("#cover-preview").naturalWidth>0')
 page.set_input_files('#files-input',{'name':'hello.txt','mimeType':'text/plain','buffer':b'not a mock archive'})
 page.evaluate('''()=>{const prior=chrome.downloads.download;chrome.downloads.download=(opts,cb)=>{chrome.runtime.lastError={message:'Injected download start denial'};try{cb()}finally{delete chrome.runtime.lastError}}}''')
 page.click('#build-button');page.wait_for_function('document.querySelector("#status").dataset.state==="error"')
 observed=page.evaluate('({created:__auditCreated,revoked:__auditRevoked,status:document.querySelector("#status").textContent})')
 assert observed['created'][-1] in observed['revoked'],observed;return observed

def query_is_read_only(page):
 page.evaluate('document.querySelector("video").playbackRate=2')
 page.wait_for_timeout(30)  # Deliver the native ratechange before registering a new controller.
 source(page,'media_controller.js');page.wait_for_function('__chatgptBrowserToolsMediaControllerV1__.getMediaCount()===1');page.wait_for_timeout(100)
 before=page.evaluate('__test.media()');identity=before['state']
 observed=page.evaluate('([id,source])=>PrinciplesFixture.queryMedia(id,source)',[identity['mediaId'],identity['sourceKey']]);after=page.evaluate('__test.media()')
 assert before['rate']==2 and after['rate']==2 and observed['rate']==2,{'before':before,'reply':observed,'after':after}
 return {'rateBefore':before['rate'],'rateAfter':after['rate'],'reply':observed}

def overflow_recovery(page):
 page.set_content((R/'popup.html').read_text());source(page,'settings_transfer.js');source(page,'settings_tools_popup.js')
 page.wait_for_timeout(50);page.evaluate('PrinciplesFixture.holdLocalReads();__test.faults.write=true')
 page.evaluate('()=>{for(let e=document.querySelector("#caption-overflow-mode");e;e=e.parentElement){e.hidden=false;if(e instanceof HTMLDetailsElement)e.open=true}}')
 page.locator('#caption-overflow-mode').select_option('expand');page.wait_for_function('__auditReadCount()===1')
 held=page.locator('#caption-overflow-mode').is_disabled()
 assert held,{'disabledWhileRecoveryPending':held}
 page.evaluate('__auditReleaseRead()');page.wait_for_function('!document.querySelector("#caption-overflow-mode").disabled')
 observed=page.locator('#caption-overflow-mode').input_value();assert observed=='scroll',observed
 return {'disabledWhileRecoveryPending':held,'restoredValue':observed}

def replay_rejection(page):
 full(page);page.evaluate('()=>{const v=document.querySelector("video");v.currentTime=v.duration-.4;return v.play()}')
 page.evaluate('''()=>{const v=document.querySelector('video');globalThis.__replayCalls=0;v.play=()=>{__replayCalls++;return Promise.reject(new DOMException('Injected replay denial','NotAllowedError'))}}''')
 page.wait_for_function('__replayCalls>0');page.wait_for_timeout(120)
 observed=state(page);assert observed['enabled']=='false' and 'Injected replay denial' in observed['label'],observed
 calls=page.evaluate('__replayCalls');page.wait_for_timeout(200);assert page.evaluate('__replayCalls')==calls
 return {'state':observed,'playCalls':calls}

def layout_manual_off(page):
 # Same delayed read as the positive race, but a later explicit OFF must win.
 for f in ['layout_regression_fixture','layout_lifecycle_fixture']:page.evaluate((R/'.test_dist'/f'{f}.js').read_text())
 page.evaluate('LayoutLifecycleFixture.build()');page.evaluate('Object.assign(__test.settings,{youtubeLayoutTabsEnabled:true,youtubePanelScrollEnabled:true})')
 page.evaluate('PrinciplesFixture.holdLocalReads()')
 code=(a.source_dir/'youtube_layout.js').read_text()
 for name,value in [('isYouTubePage','true'),('isWatchPage','globalThis.__lifecycleRoute.watch')]:
  code,n=re.subn(r'    function '+name+r'\(\) \{.*?(?:\n    \}| \})',f'    function {name}() {{ return {value}; }}',code,count=1,flags=re.S);assert n==1
 code,n=re.subn(r'const videoKey = \(\) => [^\n]+;', 'const videoKey = () => globalThis.__lifecycleRoute.key;',code,count=1);assert n==1
 page.evaluate(code);page.wait_for_function('__auditReadCount()===1');page.evaluate('__test.update({youtubeLayoutTabsEnabled:false})');page.evaluate('__auditReleaseRead()');page.wait_for_timeout(100)
 observed=page.evaluate('LayoutLifecycleFixture.read()');assert observed['hosts']==0 and observed['status']['layout']=='off',observed
 return {'layout':observed['status']['layout'],'hosts':observed['hosts']}


def external_native_loop(page):
 full(page);page.evaluate('document.querySelector("video").loop=true');page.wait_for_timeout(80)
 page.evaluate('document.querySelector("video").currentTime=.25');page.wait_for_timeout(80)
 observed=state(page);observed['nativeLoop']=page.evaluate('document.querySelector("video").loop')
 assert observed['nativeLoop'] and observed['enabled']=='false',observed
 return observed

def restore_position_priority(page):
 ab(page,'document.querySelector("#movie_player").style.setProperty("position","static","important")')
 page.evaluate('__browserToolboxYouTubeAbLoopV1__.destroy()')
 observed=page.locator('#movie_player').evaluate('(e)=>({value:e.style.position,priority:e.style.getPropertyPriority("position")})')
 assert observed=={'value':'static','priority':'important'},observed;return observed


def navigation_native_validation(page):
 # Real same-document browser history traversal, not a synthetic PopStateEvent.
 code=(a.source_dir/'navigation_guard.js').read_text()
 page.evaluate(code+';globalThis.__testApplyNavigationGuard=applyNavigationGuardMain;')
 observed=page.evaluate("""() => {
   const failure=()=>{try{history.pushState({},'', 'http://[');return 'no-error'}catch(e){return e.name}};
   const before=failure();
   const token='__cbt_guard_'+'a'.repeat(48);
   const native=History.prototype.pushState;
   __testApplyNavigationGuard(token,{backNavigationProtectionEnabled:true});
   history.pushState({},'', '#one');history.pushState({},'', '#two');
   return new Promise(resolve=>{
     addEventListener('popstate', e=>{
       const after=failure(), length=history.length;
       history.pushState({auditTrapMarker:true},'',location.href);
       // History length alone is insufficient after back(): native pushState may replace a forward entry.
       const trapSuppressed=history.length===length && history.state?.auditTrapMarker!==true;
       globalThis[token].cleanup();
       resolve({before,after,trustedPop:e.isTrusted,trapSuppressed,nativeRestored:History.prototype.pushState===native});
     },{once:true});
     history.back();
   });
 }""")
 assert observed=={'before':'SecurityError','after':'SecurityError','trustedPop':True,'trapSuppressed':True,'nativeRestored':True},observed
 return observed


tests=[('layout_settings_read_merge',layout_race),('closed_panel_focus',closed_panel),('full_loop_respects_paused_tail',paused_tail),('full_loop_plays_to_actual_end',full_tail),('ab_loop_resumes_from_actual_end',ab_ended),('ab_player_identity',player_identity),('ab_preserves_new_position',preserve_position),('overflow_delayed_read',settings_popup),('media_query_missing_identity',missing_source),('failed_download_releases_blob',failed_download),('media_query_is_read_only',query_is_read_only),('overflow_failed_write_recovery',overflow_recovery),('loop_replay_failure_is_explicit',replay_rejection),('layout_manual_off_wins',layout_manual_off),('ab_external_native_loop_wins',external_native_loop),('ab_original_position_priority',restore_position_priority),('native_history_validation',navigation_native_validation)]
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path=a.chromium,headless=True,args=['--no-sandbox']);result['browser']=browser.version
 for name,fn in tests:
  page=setup(browser)
  try:result['tests'][name]={'passed':True,'observed':fn(page)};print('PASS',name,flush=True)
  except Exception as e:result['tests'][name]={'passed':False,'error':str(e)[:3000]};print('FAIL',name,str(e)[:1200],flush=True)
  finally:page.close()
 browser.close()
result['passed']=all(v['passed'] for v in result['tests'].values()) and not result['pageErrors']
a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
raise SystemExit(0 if result['passed'] else 1)
