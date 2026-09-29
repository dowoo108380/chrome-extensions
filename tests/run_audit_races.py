"""Local Chromium state-race regressions. Actual DOM/media/input, mocked Chrome API.
Test-only guards: isYouTubeWatchPage in A/B; getSiteKey in element-rule restoration.
All DOM/media and selector rules are otherwise the actual compiled output.
--source-dir can point to an extracted earlier dist for a reproducible comparison.
"""
from pathlib import Path
import argparse, json, base64, re, shutil, traceback
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parents[1]
a=argparse.ArgumentParser(description=__doc__)
a.add_argument('--source-dir',type=Path,default=R/'dist')
a.add_argument('--output',type=Path,default=R/'.test_results/audit_races.json')
a.add_argument('--chromium',default=shutil.which('chromium'))
args=a.parse_args(); report={'scope':__doc__,'tests':{},'pageErrors':[]}
V='data:video/webm;base64,'+base64.b64encode((R/'tests/fixtures/test.webm').read_bytes()).decode()
def script(p,n):p.evaluate((args.source_dir/n).read_text())
def fixture(b):
 p=b.new_page(viewport={'width':1200,'height':900});p.set_default_timeout(5000)
 p.on('pageerror',lambda e:report['pageErrors'].append(str(e)))
 p.set_content('<!doctype html><video muted style="width:640px;height:360px"></video><div id="target">Target</div>')
 p.evaluate((R/'.test_dist/browser_harness.js').read_text());script(p,'toolbox_shared.js')
 p.evaluate('s=>{document.querySelector("video").src=s}',V)
 p.wait_for_function('document.querySelector("video").readyState>=2')
 return p
# Capture a real API-double read at dispatch; deliver that old snapshot only when released.
def hold_read(p):
 p.evaluate('''() => {const native=chrome.storage.local.get;globalThis.__heldReads=[];
 chrome.storage.local.get=(keys,cb)=>native(keys,values=>__heldReads.push(()=>cb(values)));
 globalThis.__releaseReads=()=>{const reads=__heldReads.splice(0);for(const cb of reads)cb()};}''')
def observe(b,name,test):
 p=fixture(b)
 try: report['tests'][name]={'passed':True,'observed':test(p)};print('PASS',name,flush=True)
 except Exception as e: report['tests'][name]={'passed':False,'error':str(e)[:1600]};print('FAIL',name,str(e)[:700],flush=True)
 finally:p.close()
def late_media(p):
 hold_read(p);script(p,'media_controller.js');p.wait_for_function('__heldReads.length===1')
 p.evaluate('__test.update({mediaControllerEnabled:false,mediaSpeedStep:0.25})');p.evaluate('__releaseReads()');p.wait_for_timeout(160)
 state=p.evaluate('__chatgptBrowserToolsMediaControllerV1__.getSettings()');assert state['mediaControllerEnabled'] is False and state['mediaSpeedStep']==.25,state
 return {'enabled':state['mediaControllerEnabled'],'step':state['mediaSpeedStep']}
def late_tab_state(p):
 p.evaluate('''() => {const native=chrome.runtime.sendMessage;globalThis.__heldTabReply=null;
 chrome.runtime.sendMessage=(m,cb)=>{if(m.type==='media-controller:get-tab-state')__heldTabReply=()=>cb({ok:true,rate:1,templateRate:1,hasMedia:false});else native(m,cb)}}''')
 script(p,'media_controller.js');p.wait_for_function('__heldTabReply!==null')
 p.evaluate('__test.update({mediaControllerEnabled:false,mediaSpeedStep:0.35})');p.evaluate('__heldTabReply()');p.wait_for_timeout(150)
 state=p.evaluate('__chatgptBrowserToolsMediaControllerV1__.getSettings()');assert not state['mediaControllerEnabled'] and state['mediaSpeedStep']==.35,state
 return {'enabled':state['mediaControllerEnabled'],'step':state['mediaSpeedStep']}
def stale_caption(p):
 hold_read(p);script(p,'youtube_synced_caption_overlay.js');p.wait_for_function('__heldReads.length===1')
 p.evaluate('__test.update({youtubeSyncedCaptionFontSizePx:48})');p.evaluate('__releaseReads()');p.evaluate('__test.addCaptions([[0,6,"Visible caption"]])');p.evaluate('document.querySelector("video").play()');p.wait_for_function('document.querySelector("video").currentTime>0.15');p.wait_for_timeout(100)
 state=p.evaluate('__test.caption()');assert state['fontSize']=='48px',state;return state
def stale_ab(p):
 p.evaluate('''()=>{const box=document.createElement('div');box.id='movie_player';box.style.cssText='position:relative;width:640px';const controls=document.createElement('div');controls.className='ytp-right-controls';controls.style.height='48px';document.body.prepend(box);box.append(document.querySelector('video'),controls)}''')
 hold_read(p);s=(args.source_dir/'youtube_ab_loop.js').read_text()
 s,n=re.subn(r'function isYouTubeWatchPage\(\) \{.*?\n    \}', 'function isYouTubeWatchPage() { return true; }',s,count=1,flags=re.S);assert n==1;p.evaluate(s)
 p.wait_for_function('__heldReads.length===1');p.evaluate('__test.update({youtubeAbLoopShortcutACode:"KeyQ"})');p.evaluate('__releaseReads()')
 p.wait_for_selector('#__browser_toolbox_youtube_ab_loop_button__');p.wait_for_timeout(100)
 hints=p.evaluate('__test.keys()');assert hints[0]=='Q',hints;return hints
def cancel_report(p):
 script(p,'media_controller.js');p.wait_for_function('__chatgptBrowserToolsMediaControllerV1__.getMediaCount()===1');p.wait_for_timeout(180)
 p.evaluate('''async()=>{__test.sent.length=0;document.querySelector('video').dispatchEvent(new Event('play'));await __test.update({mediaControllerEnabled:false})}''')
 p.wait_for_timeout(180);messages=p.evaluate('__test.sent.filter(m=>m.type==="media-controller:report-tab-rate")')
 assert messages==[],messages;return {'laterReports':len(messages),'registered':p.evaluate('__chatgptBrowserToolsMediaControllerV1__.getMediaCount()')}
def late_media_template(p):
 p.evaluate('''() => {const native=chrome.runtime.sendMessage;globalThis.__heldTabReply=null;
 chrome.runtime.sendMessage=(m,cb)=>{if(m.type==='media-controller:get-tab-state')__heldTabReply=()=>cb({ok:true,rate:2,templateRate:2,hasMedia:false});else native(m,cb)}}''')
 script(p,'media_controller.js');p.wait_for_function('__heldTabReply!==null')
 p.evaluate('__test.update({mediaControllerEnabled:true,mediaKeepRateForNewMedia:true})')
 p.wait_for_function('__chatgptBrowserToolsMediaControllerV1__.getMediaCount()===1')
 p.keyboard.press('d');p.wait_for_timeout(50);before=p.evaluate('__test.media()')
 p.evaluate('__heldTabReply()');p.wait_for_timeout(150);after=p.evaluate('__test.media()')
 assert after['state']['templateRate']==before['state']['templateRate'],{'before':before,'after':after}
 return {'before':before,'after':after}
def chatgpt_storage_error(p):
 p.evaluate((R/'.test_dist/chatgpt_width_fixture.js').read_text())
 p.evaluate('__test.update({chatConversationWidthPx:1800,chatComposerWidthPx:1600})')
 script(p,'content_script.js');p.wait_for_selector('#chatgpt-ctrl-enter-conversation-width',state='attached')
 before=p.evaluate('Array.from(document.querySelectorAll("style[id^=chatgpt-ctrl-enter-]")).map(s=>[s.id,s.textContent])')
 p.evaluate('__test.faults.read=true;__test.lifecycle()');p.wait_for_timeout(100)
 after=p.evaluate('Array.from(document.querySelectorAll("style[id^=chatgpt-ctrl-enter-]")).map(s=>[s.id,s.textContent])')
 assert after==before,{'beforeSheets':[v[0] for v in before],'afterSheets':[v[0] for v in after],'stylesEqual':after==before}
 return {'stylesUnchanged':after==before}
def eraser_code(p):
 code=(args.source_dir/'element_eraser_restore.js').read_text()
 code,n=re.subn(r'function getSiteKey\(\) \{.*?\n    \}', 'function getSiteKey() { return "https://fixture.test"; }',code,count=1,flags=re.S)
 assert n==1;p.evaluate(code)
def stale_eraser(p):
 p.evaluate('__test.settings.pageElementEraserRulesV1={"https://fixture.test":[{selector:"#target"}]}')
 hold_read(p);eraser_code(p);p.wait_for_function('__heldReads.length===1')
 p.evaluate('__test.update({pageElementEraserRulesV1:{}})');p.evaluate('__releaseReads()');p.wait_for_timeout(30)
 display=p.locator('#target').evaluate('(e)=>getComputedStyle(e).display')
 assert display!='none',display
 return {'display':display,'oldRuleWasNotReapplied':True}
def eraser_read_failure(p):
 p.evaluate('''()=>{const s=document.createElement('style');s.id='__page_element_eraser_persistent_style__';s.textContent='#target{display:none!important}';document.head.append(s);__test.faults.read=true}''')
 eraser_code(p);p.wait_for_timeout(30);display=p.locator('#target').evaluate('(e)=>getComputedStyle(e).display')
 assert display=='none',display;return {'previousRulePreserved':True}

def late_popup_settings(p):
 html=(R/'popup.html').read_text(encoding='utf-8')
 p.set_content(re.sub(r'<script\b[^>]*>\s*</script>', '', html))
 p.evaluate((R/'.test_dist/browser_harness.js').read_text())
 p.evaluate((R/'.test_dist/popup_harness.js').read_text())
 script(p,'toolbox_shared.js');hold_read(p);script(p,'popup.js')
 p.wait_for_function('__heldReads.length>0')
 p.evaluate('__test.update({mediaControllerEnabled:false,chatConversationWidthPx:1200,mediaSpeedStep:.25,mediaShortcutFasterCode:"KeyQ"})')
 before=p.evaluate('({enabled:document.querySelector("#media-controller-toggle").checked,width:document.querySelector("#chat-width-slider").value})')
 p.evaluate('__releaseReads()');p.wait_for_timeout(50)
 after=p.evaluate('({enabled:document.querySelector("#media-controller-toggle").checked,width:document.querySelector("#chat-width-slider").value})')
 assert not after['enabled'] and after==before,{'before':before,'after':after}
 return {'before':before,'after':after,'stored':p.evaluate('__test.settings.mediaControllerEnabled')}
with sync_playwright() as pw:
 b=pw.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox']);report['browser']=b.version
 for name,fn in [('late_media_settings',late_media),('late_media_session_reply',late_tab_state),('late_caption_style',stale_caption),('late_ab_shortcut',stale_ab),('cancel_disabled_report',cancel_report),('late_media_template',late_media_template),('chatgpt_storage_error',chatgpt_storage_error),('stale_element_rule',stale_eraser),('element_rule_read_failure',eraser_read_failure),('late_popup_settings',late_popup_settings)]:observe(b,name,fn)
 b.close()
report['passed']=all(t['passed'] for t in report['tests'].values()) and not report['pageErrors']
args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
raise SystemExit(0 if report['passed'] else 1)
