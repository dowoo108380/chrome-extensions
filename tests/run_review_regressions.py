"""1.67 local regression suite for the user-supplied review and multi-tab layout.
Real Chromium DOM, media, custom element callbacks, decoding and trusted input.
YouTube structure/events and extension APIs are explicit doubles. No live-site/GPU
or installed-extension claims. BFCache below is synthetic and labelled as such.
"""
from pathlib import Path
import argparse, ast, base64, json, re, shutil, time, traceback
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parents[1];O=R/'.test_results';O.mkdir(exist_ok=True)
ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--chromium',default=shutil.which('chromium') or shutil.which('chrome'));args=ap.parse_args()
report={'scope':__doc__,'passed':False,'tests':{},'pageErrors':[]};start=time.monotonic()
def emit(name,value=True):report['tests'][name]={'passed':True,'observed':value};print('PASS',round(time.monotonic()-start,1),name,flush=True)
def helpers(filename):
 # Reuse existing fixture builders WITHOUT running the suites' top-level test blocks.
 f=R/'tests'/filename;tree=ast.parse(f.read_text());nodes=[]
 for n in tree.body:
  if isinstance(n,ast.Try):break
  nodes.append(n)
 ns={'__file__':str(f)};exec(compile(ast.Module(body=nodes,type_ignores=[]),str(f),'exec'),ns);return ns
P=helpers('run_popup_navigation_tests.py');Q=helpers('run_quality_tests.py')
L=helpers('run_layout_lifecycle_tests.py')
V='data:video/webm;base64,'+base64.b64encode((R/'tests/fixtures/test.webm').read_bytes()).decode()
BAD={'name':'bad.gif','mimeType':'image/gif','buffer':b'GIF89a'}
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jDdMAAAAASUVORK5CYII=')
# A valid browser image fixture already in the extension.
JPEG=(R/'assets/file_to_image_default.jpg').read_bytes()
FN=json.loads((R/'.test_dist/review_helpers.json').read_text())
def code(p,name):p.evaluate((R/'dist'/name).read_text())
def fixture(b,html='',media=False):
 p=b.new_page(viewport={'width':1200,'height':900});p.set_default_timeout(7000);p.on('pageerror',lambda e:report['pageErrors'].append(str(e)))
 p.set_content(html or '<!doctype html><body></body>')
 p.evaluate((R/'.test_dist/browser_harness.js').read_text());code(p,'toolbox_shared.js');p.evaluate((R/'.test_dist/review_fixture.js').read_text())
 if media:
  p.evaluate('''src=>{const box=document.createElement('div');box.id='movie_player';box.className='html5-video-player';box.style.cssText='position:relative;width:640px;height:360px';const v=document.createElement('video');v.className='html5-main-video';v.muted=true;v.src=src;v.style.cssText='width:640px;height:360px';const controls=document.createElement('div');controls.className='ytp-right-controls';controls.style.cssText='position:absolute;bottom:0;right:0;height:48px';box.append(v,controls);document.body.prepend(box)}''',V)
  p.wait_for_function('document.querySelector("video").readyState>=2')
 return p
def inject_ab(p):
 s=(R/'dist/youtube_ab_loop.js').read_text();s,n=re.subn(r'function isYouTubeWatchPage\(\) \{.*?\n    \}', 'function isYouTubeWatchPage() { return true; }',s,count=1,flags=re.S);assert n==1;p.evaluate(s)
 p.wait_for_selector('#__browser_toolbox_youtube_ab_loop_button__')
def wait(p,ms=180):p.wait_for_timeout(ms)
def layout_code(old=False):
 s=(R/('.test_review_baseline/tests/fixtures/legacy_review_layout.js' if old else 'dist/youtube_layout.js')).read_text()
 for name,value in [('isYouTubePage','true'),('isWatchPage','globalThis.__lifecycleRoute.watch')]:
  s,n=re.subn(r'    function '+name+r'\(\) \{.*?(?:\n    \}| \})',f'    function {name}() {{ return {value}; }}',s,count=1,flags=re.S);assert n==1
 s,n=re.subn(r'const videoKey = \(\) => [^\n]+;','const videoKey = () => globalThis.__lifecycleRoute.key;',s,count=1);assert n==1;return s
def layout_setup(context,old=False,delay=50,synchronous=False,repeated=False,deferred=False):
 p=context.new_page();p.set_default_timeout(7000);p.on('pageerror',lambda e:report['pageErrors'].append(str(e)))
 p.set_content('''<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="require-trusted-types-for 'script'; trusted-types 'none';"></head><body></body></html>''')
 for n in ['browser_harness','layout_regression_fixture','layout_lifecycle_fixture','review_fixture']:p.evaluate((R/'.test_dist'/f'{n}.js').read_text())
 p.evaluate('LayoutLifecycleFixture.build()');code(p,'toolbox_shared.js');p.evaluate('Object.assign(__test.settings,{youtubeLayoutTabsEnabled:true,youtubePanelScrollEnabled:true})')
 p.evaluate('css=>{const s=document.createElement("style");s.textContent=css;document.head.append(s)}',(R/'youtube_layout.css').read_text())
 p.evaluate('ReviewFixture.synchronousStartupRelocation()' if synchronous else f'ReviewFixture.startupRelocation({delay},{str(repeated).lower()})')
 p.evaluate("() => {globalThis.__startLayout=()=>{"+layout_code(old)+"};}" if deferred else layout_code(old));return p
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox']);report['browser']=b.version
  # Baseline failure is produced by actual original-node relocation, not an injected error.
  for sync in [False,True]:
   oldctx=b.new_context(viewport={'width':1440,'height':900});p=layout_setup(oldctx,True,synchronous=sync);wait(p,800);before=L['read'](p)
   assert before['status']['layout']=='unavailable',before
   oldctx.close();ctx=b.new_context(viewport={'width':1440,'height':900});p=layout_setup(ctx,False,synchronous=sync);wait(p,800);after=L['full'](p)
   assert after['sourceSame'] and after['hosts']==1 and after['status']['lifecycle']['blockedReason'] is None,after
   emit('layout_'+('synchronous_move_callback' if sync else 'delayed_initial_relocation'),{'baseline':before,'fixed':after});ctx.close()
  ctx=b.new_context(viewport={'width':1440,'height':900});pages=[]
  for i in range(13):pages.append(layout_setup(ctx,delay=20+i*65,deferred=True))
  for page in pages:page.evaluate("__startLayout()")
  wait(pages[-1],1600);states=[L['full'](p) for p in pages]
  assert len(states)==13 and all(s['sourceSame'] and s['infoSame'] and s['commentSame'] and s['hosts']==1 for s in states)
  emit('thirteen_pages_different_startup_delays_final_actual_DOM',{'pages':len(states),'finalLayout':[s['status']['layout'] for s in states],'nativeRelocations':[p.evaluate('__nativeRelocations') for p in pages],'visibility':[p.evaluate('document.visibilityState') for p in pages]})
  ctx.close()
  ctx=b.new_context(viewport={'width':1440,'height':900});p=layout_setup(ctx,repeated=True);wait(p,1000);r=L['read'](p)
  assert r['status']['layout']=='unavailable' and r['status']['lifecycle']['lastFailure']['code']=='repeated-native-relocation',r
  moves=p.evaluate('__nativeRelocations');wait(p,350);assert moves==p.evaluate('__nativeRelocations')
  emit('persistent_relocation_stops_with_specific_diagnostic',r['status']['lifecycle']);ctx.close()
  # Review 2: restore same document on synthetic persisted lifecycle, no re-injection.
  p=fixture(b);p.evaluate((R/'.test_dist/chatgpt_width_fixture.js').read_text());code(p,'content_script.js');wait(p)
  counts=[]
  for i in range(4):
   p.locator('#prompt-textarea').click();p.keyboard.press('Control+Enter');wait(p);counts.append(p.evaluate('__widthFixture.sendCount()'))
   p.evaluate('dispatchEvent(new PageTransitionEvent("pagehide",{persisted:true}));dispatchEvent(new PageTransitionEvent("pageshow",{persisted:true}))');wait(p)
  assert counts==[1,2,3,4],counts;emit('review_2_ChatGPT_synthetic_BFCache_four_inputs',counts);p.close()
  p=fixture(b,'<!doctype html><div id="target" style="padding:100px">Right click here</div>');p.evaluate('__test.update({rightClickEnabled:true})');code(p,'right_click.js');wait(p)
  p.evaluate('globalThis.blocked=0;document.addEventListener("contextmenu",e=>{blocked++;e.preventDefault()})')
  for i in range(3):
   p.locator('#target').click(button='right');wait(p,50);assert p.evaluate('blocked')==0
   p.evaluate('dispatchEvent(new PageTransitionEvent("pagehide",{persisted:true}));dispatchEvent(new PageTransitionEvent("pageshow",{persisted:true}))');wait(p)
  p.evaluate('__test.update({rightClickEnabled:false})');wait(p);p.locator('#target').click(button='right');wait(p);assert p.evaluate('blocked')==1
  emit('review_2_right_click_restore_and_off');p.close()
  # Review 4: actual input through open/closed shadow roots.
  p=fixture(b,media=True);code(p,'media_controller.js');inject_ab(p);p.evaluate('ReviewFixture.shadowEditors()');wait(p)
  for i in [0,1,2]:
   p.evaluate('i=>__shadowInputs[i].focus()',i);p.keyboard.type('daz');wait(p);assert p.evaluate('i=>__shadowInputs[i].value',i)=='daz'
  assert p.evaluate('document.querySelector("video").playbackRate')==1
  assert p.locator('.btx-yt-ab-loop-card[data-point="a"]').count()==0 or '–' in p.locator('#__browser_toolbox_youtube_ab_loop_panel__').inner_text()
  p.evaluate('document.activeElement.blur()');p.keyboard.press('d');wait(p);assert abs(p.evaluate('document.querySelector("video").playbackRate')-1.1)<1e-5
  emit('review_4_open_closed_Shadow_DOM_preserve_typing_and_body_shortcut');p.close()
  # Review 5: old actual popup response lands while a newer edit is debouncing.
  p=P['load'](b);p.wait_for_function('document.documentElement.dataset.popupControlsReady==="true"');wait(p)
  p.evaluate((R/'.test_dist/review_fixture.js').read_text());p.evaluate('ReviewFixture.delayPopupRates()')
  p.locator('#media-rate-input').fill('2');p.locator('#media-rate-input').press('Tab');p.wait_for_function('__delayedRates.length===1')
  box=p.locator('#media-rate-slider').bounding_box()
  # Real drag input, held before pointerup/change, while the debounce timer is pending.
  p.mouse.move(box['x']+8+(300-7)/(1600-7)*(box['width']-16),box['y']+box['height']/2);p.mouse.down()
  user_rate=p.locator('#media-rate-slider').evaluate('(e)=>Number(e.value)/100');assert user_rate>2.5,user_rate
  p.evaluate('__releaseRate()');wait(p,250)
  assert p.evaluate('__delayedRates')==[2,user_rate] and float(p.locator('#media-rate-input').input_value())==user_rate,(p.evaluate('__delayedRates'),p.locator('#media-rate-input').input_value())
  p.mouse.up();wait(p)
  emit('review_5_latest_popup_input_survives_late_previous_reply',p.evaluate('__delayedRates'));p.close()
  # Review 7 + 11: expose actual function bodies, never substitute their logic.
  p=fixture(b,'<!doctype html><input id="first"><input id="later"><div style="height:2400px"></div>',media=True)
  p.evaluate(FN['captions']+';globalThis.youtubeTranscriptPageTask=youtubeTranscriptPageTask;');p.evaluate('async()=>{globalThis.cf=await youtubeTranscriptPageTask({});const v=document.querySelector("video");const t=v.addTextTrack("subtitles","English","en");t.mode="hidden";for(let i=0;i<3;i++)t.addCue(new VTTCue(i,i+1,"line "+i));globalThis.origTrack=t;}')
  bad=p.evaluate('cf.getTextTrackEntries(document.querySelector("video"),{languageCode:"en",name:{simpleText:"English"}},"ko")');assert bad==[]
  good=p.evaluate('cf.getTextTrackEntries(document.querySelector("video"),{languageCode:"en",name:{simpleText:"English"}},"")');assert len(good)==3
  p.evaluate('globalThis.__browserToolboxYouTubeSyncedCaptionsV1={trackByVideo:new WeakMap([[document.querySelector("video"),origTrack]])}')
  assert p.evaluate('cf.getTextTrackEntries(document.querySelector("video"),{languageCode:"en",name:{simpleText:"English"}},"")')==[]
  emit('review_7_wrong_language_and_own_output_rejected_exact_native_track_accepted')
  p.locator('#first').focus();p.evaluate('globalThis.saved=cf.captureYouTubeInteractionState({player:document.querySelector("#movie_player"),video:document.querySelector("video")},{videoId:""})')
  p.mouse.wheel(0,800);wait(p);p.evaluate('document.querySelector("#later").focus({preventScroll:true})');before=p.evaluate('scrollY');assert before>0
  p.evaluate('cf.restoreYouTubeInteractionState(saved)');after=p.evaluate('({y:scrollY,focus:document.activeElement.id,took:saved.viewControl.userTookView})')
  assert after['y']==before and after['focus']=='later' and after['took'];p.evaluate('saved.viewControl.abort.abort()')
  emit('review_11_real_user_scroll_and_focus_preserved',after)
  p.evaluate('scrollTo(0,0);globalThis.saved=cf.captureYouTubeInteractionState({player:document.querySelector("#movie_player"),video:document.querySelector("video")},{videoId:""});saved.transcriptPanelOpenedByExtension=true;scrollTo(0,250)')
  p.evaluate('cf.restoreYouTubeInteractionState(saved)');assert p.evaluate('scrollY')==0;p.evaluate('saved.viewControl.abort.abort()')
  emit('review_11_own_view_changes_restored_when_user_did_not_take_control');p.close()
  # Review 9: actual media emptied/loadedmetadata on a new ad source.
  p=fixture(b,media=True);inject_ab(p);wait(p);p.locator('#__browser_toolbox_youtube_ab_loop_button__').click()
  p.evaluate('document.querySelector("video").currentTime=2');wait(p);p.keyboard.press('a');p.evaluate('document.querySelector("video").currentTime=4');wait(p);p.keyboard.press('b')
  p.evaluate('document.querySelector("video").loop=true')
  p.locator('#__browser_toolbox_youtube_ab_loop_panel__ button[aria-pressed]').first.click();wait(p)
  p.evaluate('src=>{document.querySelector("#movie_player").classList.add("ad-showing");const v=document.querySelector("video");globalThis.mainSrc=v.src;v.src=src;v.load()}',Q['MEDIA']['640x360'])
  p.wait_for_function('document.querySelector("video").readyState>=2');wait(p,250);ad=p.evaluate('({time:document.querySelector("video").currentTime,mode:document.querySelector("#__browser_toolbox_youtube_ab_loop_panel__").textContent})')
  assert ad['time']<.1,ad
  p.evaluate('const v=document.querySelector("video");v.src=mainSrc;v.load();document.querySelector("#movie_player").classList.remove("ad-showing")');p.wait_for_function('document.querySelector("video").readyState>=2');wait(p)
  assert abs(p.evaluate('document.querySelector("video").currentTime')-2)<.1
  emit('review_9_real_source_load_ad_untouched_main_loop_resumed',ad)
  p.evaluate('src=>{document.querySelector("#movie_player").classList.add("ad-showing");const v=document.querySelector("video");v.src=src;v.load()}',Q['MEDIA']['640x360'])
  p.wait_for_function('document.querySelector("video").readyState>=2');wait(p)
  p.locator('#__browser_toolbox_youtube_ab_loop_panel__ button[aria-pressed]').first.click();wait(p)
  assert p.evaluate('document.querySelector("video").loop') is False
  p.evaluate('const v=document.querySelector("video");v.src=mainSrc;v.load();document.querySelector("#movie_player").classList.remove("ad-showing")');p.wait_for_function('document.querySelector("video").readyState>=2');wait(p)
  assert p.evaluate('document.querySelector("video").loop') is True
  emit('review_9_disable_during_ad_restores_native_loop_only_on_original_source');p.close()
  p=fixture(b,'<!doctype html><div id="container"><span class="advert">Example</span></div>');p.evaluate('code=>globalThis.eraser=(0,eval)(code)',FN['eraser'])
  sel=p.evaluate('eraser.buildPersistentSelector(document.querySelector("span"))');assert sel=='#container > span.advert',sel
  assert p.locator(sel).count()==1;emit('review_10_unique_classless_ID_parent_selector',sel);p.close()
  # Reviews 12-14: actual image decoder and UI with only fetch/download APIs controlled.
  html=(R/'file_to_image.html').read_text();scripts=re.findall(r'<script\b[^>]*\bsrc="([^"]+)"[^>]*>',html);html=re.sub(r'<script\b[^>]*>\s*</script>','',html);html=re.sub(r'<link[^>]*href="file_to_image.css"[^>]*>',lambda _:'<style>'+(R/'file_to_image.css').read_text()+'</style>',html)
  def filepage(deferred=False):
   p=fixture(b,html);p.evaluate('data=>{const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));globalThis.fetch=async()=>new Response(bytes,{status:200})}',base64.b64encode(JPEG).decode())
   if deferred:p.evaluate('() => {globalThis.fetch=()=>new Promise(resolve=>{globalThis.releaseDefaultCover=()=>resolve(new Response(Uint8Array.from(atob(globalThis.coverBase),c=>c.charCodeAt(0)),{status:200}))});}')
   p.evaluate('data=>globalThis.coverBase=data',base64.b64encode(JPEG).decode())
   for s in scripts:code(p,s.replace('dist/',''))
   if not deferred:p.wait_for_function('document.querySelector("#cover-preview").naturalWidth>0')
   return p
  p=filepage();assert p.locator('#progress-panel').is_hidden();emit('review_14_hidden_progress_panel_no_layout_box')
  # Pause the first chunk read to deliver a real cancel click during pending I/O.
  p.locator('#files-input').set_input_files({'name':'large.bin','mimeType':'application/octet-stream','buffer':bytes(2*1024*1024)})
  p.evaluate('''() => {const original=Blob.prototype.arrayBuffer;Blob.prototype.arrayBuffer=function(){if(this.size===1024*1024){const blob=this;return new Promise(resolve=>{globalThis.releaseArchiveRead=()=>{Blob.prototype.arrayBuffer=original;resolve(original.call(blob))}})}return original.call(this)}}''')
  p.locator('#build-button').click();p.wait_for_function('typeof releaseArchiveRead==="function"')
  p.locator('#cancel-build-button').click();p.evaluate('releaseArchiveRead()')
  p.wait_for_function('document.querySelector("#status").textContent.includes("취소")')
  assert p.evaluate('__test.downloads.length')==0 and p.locator('#build-button').is_enabled() and p.locator('#cancel-build-button').is_hidden()
  emit('archive_cancel_pending_read_prevents_download_and_restores_controls')
  p.locator('#files-input').set_input_files({'name':'after.txt','mimeType':'text/plain','buffer':b'after cancellation'})
  p.locator('#build-button').click();p.wait_for_function('__test.downloads.length===1')
  emit('archive_successful_download_after_cancellation');p.close()
  p=filepage()
  p.locator('#files-input').set_input_files({'name':'payload.txt','mimeType':'text/plain','buffer':b'payload'})
  p.locator('#cover-input').set_input_files(BAD);wait(p);assert p.locator('#build-button').is_disabled() and p.evaluate('__test.downloads.length')==0
  assert p.locator('#cover-preview').evaluate('(e)=>e.naturalWidth')==0;emit('review_12_invalid_GIF_rejected_before_download');p.close()
  p=filepage();p.evaluate('ReviewFixture.delayedCoverRead()');p.locator('#cover-input').set_input_files({'name':'older.jpg','mimeType':'image/jpeg','buffer':JPEG});p.wait_for_function('typeof __releaseOldCover==="function"')
  p.locator('#cover-input').set_input_files({'name':'newest.jpg','mimeType':'image/jpeg','buffer':JPEG});p.wait_for_function('document.querySelector("#cover-name").textContent==="newest.jpg"');p.evaluate('__releaseOldCover()');wait(p)
  assert p.locator('#cover-name').inner_text()=='newest.jpg' and p.locator('#cover-preview').evaluate('(e)=>e.naturalWidth')>0
  emit('review_13_late_old_cover_cannot_replace_valid_new_cover');p.close()
  p=filepage(True);p.locator('#cover-input').set_input_files({'name':'user_cover.jpg','mimeType':'image/jpeg','buffer':JPEG});p.wait_for_function('document.querySelector("#cover-name").textContent==="user_cover.jpg"')
  p.evaluate('releaseDefaultCover()');wait(p);assert p.locator('#cover-name').inner_text()=='user_cover.jpg'
  emit('review_13_late_default_fetch_cannot_override_user_cover');p.close()
  p=Q['fixture'](b);Q['wait_state'](p,'selected');p.evaluate('document.dispatchEvent(new Event("yt-navigate-start"));__test.update({youtubePreferredQualityEnabled:false})');wait(p)
  p.evaluate('__qualityFixture.next("next_after_disable")');wait(p);p.evaluate('__test.update({youtubePreferredQualityEnabled:true})');status=Q['wait_state'](p,'selected')
  assert status['selectedLabel']=='1080p';emit('review_16_disabled_finish_then_reenabled_quality',status);p.close()
  assert not report['pageErrors'],report['pageErrors'];b.close();report['passed']=True
except Exception:
 report['failure']=traceback.format_exc();print(report['failure'],flush=True);raise
finally:
 (O/'review_browser_results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
