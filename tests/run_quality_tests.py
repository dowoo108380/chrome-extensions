"""Native-menu component tests. Real Chromium DOM/input/video; simulated YouTube menu,
Chrome APIs and stream server. One URL-provider substitution permits memory pages under
this environment's network policy. No quality, eligibility or manual override branch is patched.
"""
from pathlib import Path
import argparse,base64,json,re,shutil,traceback,time
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--chromium',default=shutil.which('chromium'))
parser.add_argument('--smoke',action='store_true')
args=parser.parse_args()
if not args.chromium: parser.error('Provide an already installed --chromium.')
OUT=ROOT/'.test_results';OUT.mkdir(exist_ok=True)
REPORT={'environment':{'scope':'local Chromium native-menu components, NOT live YouTube or installed extension',
 'chrome_apis':'browser_harness.ts mocks','youtube_menu':'quality_fixture.ts simulated menu and response',
 'url':'only pageUrl() returns the fixture URL; all route matching is otherwise production code',
 'premium':'explicit enabled/selected/disabled/unknown ARIA cases, not real subscription entitlement',
 'streams':'real generated WebM decoding; not network or Premium bitrate verification'},'tests':{},'errors':[],'passed':False}
MEDIA={size:'data:video/webm;base64,'+base64.b64encode((ROOT/f'tests/fixtures/quality/video_{size}.webm').read_bytes()).decode() for size in ['256x144','640x360']}
HTML='''<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="require-trusted-types-for 'script'; trusted-types 'none';"><style>
body{margin:0;background:#171e23;color:#eee;font:14px Arial}ytd-watch-flexy{display:block}#movie_player{position:relative;width:900px;height:506px;margin:24px auto;background:#080a0d}video{width:100%;height:100%}.ytp-right-controls{position:absolute;right:18px;bottom:12px}button{cursor:pointer}button.ytp-settings-button{width:44px;height:36px;font-size:18px}.ytp-settings-menu{position:absolute;right:16px;bottom:58px;width:280px;background:#252b32;border:1px solid #48555f;border-radius:10px;color:#eef2f5;z-index:40;max-height:430px;overflow:auto}.ytp-panel-header{display:flex;gap:12px;align-items:center;padding:14px;border-bottom:1px solid #62676c}.ytp-panel-menu{padding:4px}.ytp-menuitem{padding:10px 16px;display:flex;justify-content:space-between;gap:12px;cursor:pointer}.ytp-menuitem:hover{background:#38414b}.ytp-menuitem[aria-checked=true]{color:#72dbc5}.ytp-menuitem[aria-disabled=true]{color:#888}[hidden]{display:none!important}#outside{margin:16px}input{margin:16px}
</style></head><body><ytd-watch-flexy video-id="quality_fixture"><div id="movie_player" class="html5-video-player"><video class="html5-main-video" muted preload="auto"></video><div class="ytp-right-controls"><button type="button" class="ytp-settings-button" aria-label="설정" aria-expanded="false">⚙</button></div><div class="ytp-settings-menu" hidden></div></div></ytd-watch-flexy><button id="outside">메뉴 바깥</button><input id="editor" value="작성 중인 내용"><p id="unrelated">다른 문구</p></body></html>'''
def emit(name,value=True):REPORT['tests'][name]=value;print('PASS',name,flush=True)
def code(name):return (ROOT/'dist'/name).read_text()
def inject(p):
 s=code('youtube_quality.js');a='function pageUrl() { return new URL(location.href); }'
 assert s.count(a)==1
 p.evaluate(s.replace(a,'function pageUrl() { return new URL(globalThis.__qualityFixture.href); }'))
def wait_expr(p,expression,timeout=7000):
 end=time.monotonic()+timeout/1000
 while time.monotonic()<end:
  if p.evaluate(expression):return
  p.wait_for_timeout(40)
 raise AssertionError(expression)
def fixture(b,conf=None,prefs=None,enable=True):
 p=b.new_page(viewport={'width':1100,'height':760});p.set_default_timeout(10000)
 p.on('pageerror',lambda e:REPORT['errors'].append(str(e)))
 p.set_content(HTML);p.locator('video').evaluate('(v,src)=>{v.src=src}',MEDIA['256x144']);wait_expr(p,'document.querySelector("video").readyState>=2')
 p.evaluate((ROOT/'.test_dist/browser_harness.js').read_text());p.evaluate(code('toolbox_shared.js'));p.evaluate((ROOT/'.test_dist/quality_fixture.js').read_text())
 if conf:p.evaluate('(v)=>__qualityFixture.configure(v)',conf)
 p.evaluate('(v)=>__test.update(v)',{'youtubePreferredQualityEnabled':enable,'youtubePreferredQualityHeight':1080,'youtubeQualityPremiumPreferred':True,**(prefs or {})})
 inject(p);return p
def st(p):return p.evaluate('__qualityFixture.status()')
def wait_state(p,state,timeout=8000):
 end=time.monotonic()+timeout/1000
 while time.monotonic()<end:
  s=st(p)
  if s['state']==state:return s
  if s['state']=='error' and state!='error':raise AssertionError(s)
  p.wait_for_timeout(75)
 raise AssertionError(st(p))
def manual(p,label):
 p.evaluate('__qualityFixture.showQuality()');p.locator('[role=menuitemradio]').filter(has_text=re.compile('^'+re.escape(label)+'$')).click();p.wait_for_timeout(120)
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
  REPORT['environment']['browser']=b.version
  p=fixture(b,enable=False);p.wait_for_timeout(350);assert p.evaluate('__qualityFixture.gearCalls')==0;assert st(p)['state']=='off';emit('off_has_no_menu_actions');p.close()
  p=fixture(b);s=wait_state(p,'selected');assert s['selectedLabel']=='1080p';p.wait_for_timeout(150);assert p.locator('.ytp-settings-menu').is_hidden();assert p.evaluate('__qualityFixture.calls')==['1080p'];emit('exact_resolution_selected_and_menu_closed',s);p.close()
  if args.smoke:
   b.close();REPORT['passed']=True
  else:
   # Actual desktop YouTube was observed with aria-label="null" and modern
   # nested controls. Accessible labels are not a prerequisite for native UI.
   for name,label in [('literal_null','null'),('empty',''),('missing',None),('decorated','Settings (8K)')]:
    p=fixture(b,enable=False)
    p.locator('.ytp-settings-button').evaluate('(b,label)=>{if(label===null)b.removeAttribute("aria-label");else b.setAttribute("aria-label",label);b.title=""}',label)
    p.evaluate('__test.update({youtubePreferredQualityEnabled:true})')
    assert wait_state(p,'selected')['selectedLabel']=='1080p';emit('native_gear_'+name+'_label');p.close()
   for name,selector,attribute,value in [('disabled_button','.ytp-settings-button','disabled',''),('aria_disabled_button','.ytp-settings-button','aria-disabled','true'),('hidden_controls','.ytp-right-controls','hidden',''),('inert_controls','.ytp-right-controls','inert',''),('aria_hidden_controls','.ytp-right-controls','aria-hidden','true'),('display_none_controls','.ytp-right-controls','style','display:none')]:
    p=fixture(b,enable=False);p.locator(selector).evaluate('(e,a)=>e.setAttribute(a[0],a[1])',[attribute,value])
    p.evaluate('__test.update({youtubePreferredQualityEnabled:true})');p.wait_for_timeout(250)
    assert st(p)['state']=='waiting' and p.evaluate('__qualityFixture.gearCalls')==0
    # No media/navigation event follows: the readiness mutation must wake it.
    p.locator(selector).evaluate('(e,a)=>e.removeAttribute(a)',attribute)
    assert wait_state(p,'selected')['selectedLabel']=='1080p';emit('gear_readiness_'+name);p.close()
   p=fixture(b,enable=False);p.locator('.ytp-settings-button').evaluate('(b)=>b.after(b.cloneNode(true))');p.evaluate('__test.update({youtubePreferredQualityEnabled:true})')
   assert '하나로 확정' in wait_state(p,'error')['detail'];assert p.evaluate('__qualityFixture.gearCalls')==0;emit('ambiguous_native_gears_not_clicked');p.close()
   p=fixture(b,{'items':['720p','360p','144p']}, {'youtubePreferredQualityHeight':1440});assert wait_state(p,'selected')['selectedLabel']=='720p';emit('fallback_highest_below_preference');p.close()
   p=fixture(b,{'items':['1080p','720p','360p']}, {'youtubePreferredQualityHeight':144});assert wait_state(p,'selected')['selectedLabel']=='360p';assert p.evaluate('__qualityFixture.calls')==[];emit('fallback_minimum_without_unnecessary_click');p.close()
   p=fixture(b,{'items':['2160p','1080p Premium','1080p','720p'],'enabledPremium':True});assert wait_state(p,'selected')['selectedLabel']=='1080p Premium';emit('premium_explicitly_enabled_is_preferred_at_same_height');p.close()
   p=fixture(b,{'items':['1080p Premium','1080p','720p'],'enabledPremium':True},{'youtubeQualityPremiumPreferred':False});assert wait_state(p,'selected')['selectedLabel']=='1080p';emit('premium_preference_off_selects_regular');p.close()
   for name,conf in [('unknown',{}),('disabled',{'disabledLabels':['1080p Premium']}),('upsell',{'upsellLabels':['1080p Premium'],'enabledPremium':True})]:
    p=fixture(b,{'items':['1080p Premium','1080p','720p'],**conf});s=wait_state(p,'selected');assert s['selectedLabel']=='1080p';assert p.evaluate('__qualityFixture.upsellOpened||false')==False;assert 'Premium' in s['premiumNote'];emit('premium_'+name+'_not_clicked');p.close()
   p=fixture(b,{'items':['1080p Premium','1080p'],'selected':'1080p Premium'});assert wait_state(p,'selected')['selectedLabel']=='1080p Premium';assert p.evaluate('__qualityFixture.calls')==[];emit('already_selected_premium_kept_without_entitlement_guess');p.close()
   p=fixture(b);wait_state(p,'selected');manual(p,'720p');assert wait_state(p,'manual')['manualForCurrentVideo'];calls=p.evaluate('__qualityFixture.calls.slice()')
   p.evaluate('__test.update({youtubePreferredQualityHeight:2160,youtubeQualityPremiumPreferred:false})')
   for i in range(20):p.locator('#unrelated').evaluate('(e,i)=>e.textContent="변경 "+i',i)
   p.wait_for_timeout(450);assert p.evaluate('__qualityFixture.calls')==calls;assert p.evaluate('__qualityFixture.selected')=='720p';emit('trusted_manual_choice_survives_settings_and_unrelated_dom_changes')
   p.evaluate('__qualityFixture.next("next_video")');s=wait_state(p,'selected');assert not s['manualForCurrentVideo'];assert s['selectedLabel']=='1080p';emit('same_video_element_new_video_restarts_automation');p.close()
   p=fixture(b);wait_state(p,'selected');manual(p,'자동');assert wait_state(p,'manual')['manualForCurrentVideo'];emit('manual_auto_is_respected');p.close()
   p=fixture(b,enable=False);p.evaluate('__qualityFixture.showQuality()');p.evaluate('__test.update({youtubePreferredQualityEnabled:true})');p.wait_for_timeout(300);assert st(p)['state']=='waiting';assert p.evaluate('__qualityFixture.calls')==[];assert p.locator('.ytp-settings-menu').is_visible()
   p.locator('[role=menuitemradio]').filter(has_text='720p').focus();p.keyboard.press('Enter');assert wait_state(p,'manual')['manualForCurrentVideo'];emit('preopened_menu_and_keyboard_choice_are_respected');p.close()
   p=fixture(b,{'delay':450});wait_expr(p,'__qualityFixture.qualityOpens===1');p.evaluate('__test.update({youtubePreferredQualityEnabled:false})');p.wait_for_timeout(750);assert st(p)['state']=='off';assert p.evaluate('__qualityFixture.calls')==[];assert p.locator('.ytp-settings-menu').is_hidden();emit('disable_during_work_cancels_and_restores_menu');p.close()
   p=fixture(b,{'delay':300});wait_expr(p,'__qualityFixture.qualityOpens===1');p.evaluate('__test.update({youtubePreferredQualityHeight:720})');s=wait_state(p,'selected');assert s['selectedLabel']=='720p';assert '1080p' not in p.evaluate('__qualityFixture.calls');emit('settings_change_cancels_stale_pending_selection');p.close()
   p=fixture(b,{'refuse':True});s=wait_state(p,'error');assert not s['selectionVerified'];assert s['selectedLabel'] is None;p.wait_for_timeout(500);assert p.evaluate('__qualityFixture.calls')==['1080p'];assert p.locator('.ytp-settings-menu').is_hidden();emit('refused_selection_reports_error_without_retry_loop',s);p.close()
   p=fixture(b,{'duplicate':True});s=wait_state(p,'error');assert p.evaluate('__qualityFixture.calls')==[];emit('ambiguous_quality_menu_fails_closed');p.close()
   p=fixture(b,{'qualityName':'Unrecognized menu'});s=wait_state(p,'error');assert p.evaluate('__qualityFixture.calls')==[];emit('unknown_menu_label_not_guessed');p.close()
   p=fixture(b,enable=False);p.locator('#movie_player').evaluate('(p)=>p.classList.add("ad-showing")');p.evaluate('__test.update({youtubePreferredQualityEnabled:true})');p.wait_for_timeout(350);assert p.evaluate('__qualityFixture.calls')==[]
   p.locator('#movie_player').evaluate('(p)=>p.classList.remove("ad-showing")');wait_state(p,'selected');emit('ad_state_waits_for_actual_main_player');p.close()
   p=fixture(b,enable=False);p.evaluate('(sources)=>__qualityFixture.streamSources=sources',{'360p':MEDIA['640x360']});p.evaluate('__qualityFixture.selected="144p"');p.locator('video').evaluate('(v)=>{v.playbackRate=2.5;const d=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,"playbackRate");__qualityFixture.rateWrites=[];Object.defineProperty(v,"playbackRate",{get(){return d.get.call(v)},set(x){__qualityFixture.rateWrites.push(x);d.set.call(v,x)},configurable:true})}');p.evaluate('__test.update({youtubePreferredQualityEnabled:true,youtubePreferredQualityHeight:360})');s=wait_state(p,'selected');wait_expr(p,'document.querySelector("video").videoHeight===360');s=st(p)
   assert (s['decodedWidth'],s['decodedHeight'])==(640,360);assert p.evaluate('__qualityFixture.rateWrites')==[];s['observedRateAfterNativeLoad']=p.locator('video').evaluate('(v)=>v.playbackRate');emit('actual_webm_decoding_changes_without_extension_playback_rate_writes',s);p.close()
   p=fixture(b,{'closeOnSelect':False});wait_state(p,'selected');p.wait_for_timeout(200);assert p.locator('.ytp-settings-menu').is_hidden();emit('menu_stays_open_after_selection_is_restored_by_owner');p.close()
   p=fixture(b,{'closeDelay':240});wait_state(p,'selected');p.wait_for_timeout(420);assert p.locator('.ytp-settings-menu').is_hidden();assert st(p)['state']=='selected';emit('animated_menu_close_verified_without_fixed_delay_assumption');p.close()
   p=fixture(b,{'refuseMenuClose':True});s=wait_state(p,'error');assert '복원' in s['detail'];assert not s['selectionVerified'];emit('menu_cleanup_failure_is_not_hidden_as_success');p.close()
   p=fixture(b,{'selectionDelay':140});s=wait_state(p,'selected');assert s['selectedLabel']=='1080p';emit('asynchronous_native_selection_verified');p.close()
   p=fixture(b,{'delay':350});wait_expr(p,'__qualityFixture.qualityOpens===1');p.locator('.ytp-panel-title').click();p.wait_for_timeout(480);assert p.locator('.ytp-settings-menu').is_visible();manual(p,'720p');wait_state(p,'manual');emit('user_takes_over_menu_during_automation_without_being_closed');p.close()
   p=fixture(b,{'delay':350});wait_expr(p,'__qualityFixture.qualityOpens===1');p.locator('.ytp-settings-button').focus();p.keyboard.press('ArrowDown');p.wait_for_timeout(480);assert p.locator('.ytp-settings-menu').is_visible();assert p.evaluate('__qualityFixture.calls')==[];manual(p,'720p');wait_state(p,'manual');emit('trusted_arrow_navigation_takes_over_pending_menu');p.close()
   p=fixture(b,enable=False);p.locator('ytd-watch-flexy').evaluate('(w)=>w.setAttribute("video-id","old_video")');p.evaluate('__test.update({youtubePreferredQualityEnabled:true})');p.wait_for_timeout(200);assert p.evaluate('__qualityFixture.calls')==[];p.locator('ytd-watch-flexy').evaluate('(w)=>w.setAttribute("video-id",new URL(__qualityFixture.href).searchParams.get("v"))');assert wait_state(p,'selected')['selectedLabel']=='1080p';emit('late_video_identity_attribute_starts_without_synthetic_media_event');p.close()
   p=fixture(b);wait_state(p,'selected');manual(p,'720p');p.evaluate('__qualityFixture.reapply()');assert wait_state(p,'selected')['selectedLabel']=='1080p';emit('explicit_reapply_clears_only_this_video_manual_stop');p.close()
   p=fixture(b);wait_state(p,'selected');manual(p,'720p');p.evaluate('__test.lifecycle()');p.wait_for_timeout(300);assert st(p)['state']=='manual';emit('synthetic_bfcache_resume_preserves_manual_override');p.close()
   # Actual DOM radio state can claim 1080p while stream is still low resolution: report both, never conflate.
   p=fixture(b);s=wait_state(p,'selected');assert s['selectedLabel']=='1080p' and s['decodedHeight']==144;assert s['streamQuality']=='dimensions-only-premium-bitrate-not-measured';emit('menu_selection_not_mislabeled_as_decoded_quality');p.close()
   p=fixture(b,{'qualityName':'Quality'},enable=False);p.locator('.ytp-settings-button').evaluate('(b)=>b.setAttribute("aria-label","Settings")');p.evaluate('__test.update({youtubePreferredQualityEnabled:true})');assert wait_state(p,'selected')['selectedLabel']=='1080p';emit('english_native_menu_labels');p.close()
   p=fixture(b,enable=False);p.locator('#editor').focus();p.evaluate('__test.update({youtubePreferredQualityEnabled:true})');p.wait_for_timeout(250);assert p.evaluate('__qualityFixture.calls')==[];p.locator('#outside').click();wait_state(p,'selected');emit('editing_focus_defers_automatic_menu');p.close()
   p=fixture(b);wait_state(p,'selected');manual(p,'720p');p.locator('video').evaluate('(v)=>{const n=v.cloneNode(true);v.replaceWith(n)}');p.wait_for_timeout(250);assert st(p)['state']=='manual';emit('manual_override_survives_same_video_element_replacement');p.close()
   p=fixture(b,{'delay':300});wait_expr(p,'__qualityFixture.qualityOpens===1');p.evaluate('__qualityFixture.next("changed_during_selection")');s=wait_state(p,'selected');assert s['selectedLabel']=='1080p';emit('navigation_invalidates_inflight_task');p.close()
   p=fixture(b,enable=False);p.locator('ytd-watch-flexy').evaluate('(w)=>w.setAttribute("video-id","stale_video")');p.evaluate('__test.update({youtubePreferredQualityEnabled:true})');p.wait_for_timeout(250);assert p.evaluate('__qualityFixture.calls')==[];p.locator('ytd-watch-flexy').evaluate('(w)=>w.setAttribute("video-id","quality_fixture")')
   p.locator('video').evaluate('(v)=>v.dispatchEvent(new Event("loadedmetadata"))');wait_state(p,'selected');emit('stale_watch_identity_waits_for_matching_video');p.close()
   # storage.onChanged is explicitly simulated across two page contexts.
   p1=fixture(b);p2=fixture(b);wait_state(p1,'selected');wait_state(p2,'selected');manual(p2,'720p')
   shared_values={'youtubePreferredQualityHeight':360,'youtubeQualityPremiumPreferred':False}
   for p in [p1,p2]:p.evaluate('(values)=>__test.update(values)',shared_values)
   assert wait_state(p1,'selected')['selectedLabel']=='360p';assert st(p2)['state']=='manual';assert p2.evaluate('__qualityFixture.selected')=='720p';emit('shared_settings_apply_in_other_tab_but_preserve_manual_tab');p1.close();p2.close()
   # Coexist with the original media controller; only its URL predicate is adapted.
   p=fixture(b,enable=False);media=code('media_controller.js');pattern=r'^    function isYouTubeDocument\(\) \{.*?\n    \}'
   media,n=re.subn(pattern,'    function isYouTubeDocument() { return true; }',media,count=1,flags=re.S|re.M);assert n==1
   p.evaluate('__test.update({mediaControllerEnabled:true,mediaSpeedStep:0.25})');p.evaluate(media);p.wait_for_timeout(200)
   p.evaluate('__test.requestRate(1.25)');p.evaluate('__test.update({youtubePreferredQualityEnabled:true})');wait_state(p,'selected');p.locator('#outside').click();p.keyboard.press('d');p.wait_for_timeout(200)
   assert p.locator('video').evaluate('(v)=>v.playbackRate')==1.5
   for i in range(20):p.locator('#unrelated').evaluate('(e,i)=>e.textContent=String(i)',i)
   assert p.locator('video').evaluate('(v)=>v.playbackRate')==1.5;assert p.evaluate('__qualityFixture.calls')==['1080p'];emit('existing_speed_controller_D_and_dom_updates_do_not_trigger_quality_rewrites');p.close()
   # Real isolated/main execution worlds; Chrome extension API remains a test double.
   p=fixture(b,enable=False);client=p.context.new_cdp_session(p);frame=client.send('Page.getFrameTree')['frameTree']['frame']['id']
   world=client.send('Page.createIsolatedWorld',{'frameId':frame,'worldName':'quality-isolation-regression'})['executionContextId']
   def iso(expression):
    result=client.send('Runtime.evaluate',{'contextId':world,'expression':expression,'returnByValue':True,'awaitPromise':True})
    assert 'exceptionDetails' not in result,result
    return result.get('result',{}).get('value')
   iso((ROOT/'.test_dist/browser_harness.js').read_text());iso(code('toolbox_shared.js'));iso('globalThis.__qualityFixture={href:"https://www.youtube.com/watch?v=quality_fixture"};void 0')
   iso('__test.update({youtubePreferredQualityEnabled:true,youtubePreferredQualityHeight:1080})')
   source=code('youtube_quality.js');iso(source.replace('function pageUrl() { return new URL(location.href); }','function pageUrl() { return new URL(globalThis.__qualityFixture.href); }'))
   wait_expr(p,'__qualityFixture.selected==="1080p"');p.wait_for_timeout(250);manual(p,'720p')
   result=iso('new Promise(resolve=>chrome.runtime.onMessage.listeners.forEach(f=>f({type:"youtube-quality:status"},{},r=>resolve(r.result))))')
   assert result['state']=='manual';emit('isolated_world_controls_main_world_native_menu_and_observes_real_user_input');p.close()
   b.close();REPORT['passed']=not REPORT['errors']
except Exception:
 REPORT['failure']=traceback.format_exc();print(REPORT['failure'],flush=True)
finally:
 (OUT/'quality_results.json').write_text(json.dumps(REPORT,ensure_ascii=False,indent=2))
 if not REPORT['passed']:raise SystemExit(1)
