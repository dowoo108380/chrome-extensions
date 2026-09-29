"""Local Chromium component regressions. Chrome APIs are mocked, never a live-site/GPU claim.
Requires an existing Python Playwright installation and an existing Chrome/Chromium executable.
Run after pnpm test; no packages or browsers are downloaded by this script.
"""
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from threading import Thread
import argparse, base64, json, re, shutil, sys, time, traceback
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--chromium', default=shutil.which('chromium') or shutil.which('chrome'))
parser.add_argument("--in-memory", action="store_true", help="Use about:blank and inline media when browser policy prohibits local HTTP. Real BFCache/clipboard tests are explicitly skipped.")
args = parser.parse_args()
if not args.chromium:
    parser.error('Pass --chromium with the path to an existing Chrome/Chromium executable.')
HARNESS = ROOT / '.test_dist/browser_harness.js'
if not HARNESS.exists():
    parser.error('Compile first: pnpm test:compile')
OUT = ROOT / '.test_results'
OUT.mkdir(exist_ok=True)
FIXTURE = '''<!doctype html><html><head><meta charset="utf-8"><title>Local regression fixture</title></head><body>
<div id="movie_player" class="html5-video-player" style="position:relative;width:640px;height:360px;margin:20px">
<video class="html5-main-video" style="width:640px;height:360px" muted preload="auto" src="/tests/fixtures/test.webm"></video>
<div class="ytp-right-controls" style="position:absolute;bottom:0;right:0;height:48px"></div></div>
<div id="counter"></div><button id="outside">Outside</button></body></html>'''
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *values, **kwargs): super().__init__(*values, directory=str(ROOT), **kwargs)
    def log_message(self, *_args): pass
    def do_GET(self):
        if self.path.startswith('/fixture') or self.path == '/other':
            content = (FIXTURE if self.path.startswith('/fixture') else '<!doctype html><title>Other page</title><p>Other page</p>').encode()
            self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8'); self.send_header('Content-Length', str(len(content))); self.end_headers(); self.wfile.write(content)
        elif self.path == '/tests/fixtures/test.webm':
            # Media seeking needs byte ranges; SimpleHTTPRequestHandler ignores Range.
            data = (ROOT/'tests/fixtures/test.webm').read_bytes()
            match = re.fullmatch(r'bytes=(\d*)-(\d*)', self.headers.get('Range', ''))
            start, end = 0, len(data)-1
            if match:
                first, last = match.groups()
                start = int(first) if first else max(0, len(data)-int(last or '0'))
                end = min(end, int(last)) if first and last else end
                if start > end or start >= len(data):
                    self.send_response(416); self.send_header('Content-Range', f'bytes */{len(data)}'); self.end_headers(); return
            self.send_response(206 if match else 200)
            self.send_header('Content-Type', 'video/webm'); self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Content-Length', str(end-start+1))
            if match: self.send_header('Content-Range', f'bytes {start}-{end}/{len(data)}')
            self.end_headers(); self.wfile.write(data[start:end+1])
        else: super().do_GET()
server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
Thread(target=server.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{server.server_port}'
VIDEO = 'data:video/webm;base64,' + base64.b64encode((ROOT/'tests/fixtures/test.webm').read_bytes()).decode()
if args.in_memory: FIXTURE = FIXTURE.replace('/tests/fixtures/test.webm', VIDEO)
results = {'environment': {'chrome_apis': 'mocked', 'site': ('about:blank with inline local media' if args.in_memory else 'local HTTP fixture')+'; not actual YouTube', 'gpu': 'not measured',
    'test_copy_changes': ['isYouTubeDocument returns true in media controller only in site-specific tests', 'isYouTubeWatchPage returns true in A/B component tests'],
    'lifecycle': 'synthetic persisted events plus a separate real history navigation observation'}, 'tests': {}, 'errors': []}

def inject(p, name, youtube=False):
    script=(ROOT/'dist'/name).read_text()
    predicate = 'isYouTubeWatchPage' if name == 'youtube_ab_loop.js' else 'isYouTubeDocument' if name == 'media_controller.js' and youtube else None
    if predicate:
        condition = 'globalThis.__abWatchPage !== false' if name == 'youtube_ab_loop.js' else 'true'
        script,n = re.subn(r'function '+predicate+r'\(\) \{.*?\n    \}', 'function '+predicate+'() { return '+condition+'; }', script, count=1, flags=re.S)
        assert n == 1, f'Host guard was not uniquely located: {predicate}'
    p.add_script_tag(content=script)

def fixture(browser, settings=None, popup=False):
    p=browser.new_page(viewport={'width':780,'height':600} if popup else {'width':1000,'height':800})
    p.set_default_timeout(8000)
    p.on('pageerror', lambda e: results['errors'].append(str(e)))
    if args.in_memory: p.set_content(FIXTURE)
    else: p.goto(BASE+'/fixture', wait_until='load')
    p.wait_for_function("document.querySelector('video').readyState >= 2")
    if popup:
        html=(ROOT/'popup.html').read_text()
        html=re.sub(r'<script\s+src="[^"]+"[^>]*></script>', '', html)
        html=re.sub(r'<link[^>]*href="popup.css"[^>]*>', '<style>'+(ROOT/'popup.css').read_text()+'</style>', html)
        p.set_content(html)
    p.add_script_tag(content=HARNESS.read_text())
    if settings: p.evaluate('values => Object.assign(__test.settings, values)', settings)
    inject(p,'toolbox_shared.js')
    return p

def wait(p, ms=250): p.wait_for_timeout(ms)
def record(name, value):
    results['tests'][name]=value
    print('PASS/OBSERVED:',name,flush=True)

try:
  with sync_playwright() as api:
    browser=api.chromium.launch(executable_path=args.chromium, headless=True, ignore_default_args=[] if args.in_memory else ['--disable-back-forward-cache'], args=['--no-sandbox'])
    results['environment']['browser']=browser.version
    p=fixture(browser); inject(p,'media_controller.js');wait(p)
    p.keyboard.press('d');wait(p)
    before=p.evaluate('__test.media()');assert abs(before['rate']-1.1)<1e-6
    p.evaluate('__test.rejectSetter()'); response=p.evaluate('__test.requestRate(4)');after=p.evaluate('__test.media()')
    assert response['ok'] is False and abs(after['rate']-1.1)<1e-6 and after['defaultRate']==1
    assert abs(after['state']['templateRate']-1.1)<1e-6
    p.evaluate('__test.restoreSetter()');p.keyboard.press('r');wait(p);assert p.evaluate('__test.media().rate')==1
    p.keyboard.press('r');wait(p);assert abs(p.evaluate('__test.media().rate')-1.1)<1e-6
    record('rejected_rate_and_R_restore',{'before':before,'response':response,'after':after,'R_restored':p.evaluate('__test.media().rate')})
    p.evaluate('__test.faults.report = true');p.keyboard.press('d');wait(p,450)
    fail=p.evaluate('__test.media()');assert fail['diagnostic']['persistence']=='failed'
    assert p.locator('#__browser_toolbox_media_error__').is_visible()
    record('session_failure_visible_not_saved',fail)
    p.evaluate('__test.faults.report = false');p.keyboard.press('d');wait(p)
    assert p.evaluate('__test.media().diagnostic.persistence')=='saved'
    assert p.locator('#__browser_toolbox_media_error__').count()==0
    record('session_failure_clears_after_success',p.evaluate('__test.media()'));p.close()

    p=fixture(browser);inject(p,'media_controller.js');wait(p)
    p.evaluate('''() => {
      window.restoreSendMessage = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = () => { throw new Error('Injected transport rejection'); };
    }''')
    p.keyboard.press('d');wait(p)
    assert 'Injected transport rejection' in p.locator('#__browser_toolbox_media_error__').inner_text()
    assert p.evaluate('__test.media().diagnostic.runtimeDisconnected') is False
    p.evaluate('()=>{chrome.runtime.sendMessage = restoreSendMessage}');p.keyboard.press('d');wait(p)
    assert p.evaluate('__test.media().diagnostic.persistence')=='saved'
    assert p.locator('#__browser_toolbox_media_error__').count()==0
    record('transport_exception_preserves_cause_and_can_recover',p.evaluate('__test.media()'));p.close()

    p=fixture(browser);inject(p,'media_controller.js');wait(p)
    p.evaluate('''() => {
      window.heldReports = [];
      const send = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = (message, callback) => message.type === 'media-controller:report-tab-rate'
        ? heldReports.push(callback) : send(message, callback);
    }''')
    p.keyboard.press('d');wait(p)
    p.evaluate('delete chrome.runtime.id');p.keyboard.press('d');wait(p)
    lost=p.evaluate('__test.media()')
    assert lost['rate']==1.1 and lost['count']==0 and lost['diagnostic']['runtimeDisconnected'],lost
    assert '페이지를 새로고침' in p.locator('#__browser_toolbox_media_error__').inner_text()
    p.evaluate('''() => {
      window.firstReloadNotice = document.getElementById('__browser_toolbox_media_error__');
      for (const callback of heldReports) callback({ok:true,templateRate:1.1});
      __test.update({mediaControllerEnabled:true,mediaKeyboardEnabled:true});
      __test.lifecycle();
    }''')
    p.keyboard.press('d');wait(p)
    after=p.evaluate('__test.media()')
    assert after['rate']==1.1 and after['count']==0 and after['diagnostic']['persistence']=='failed',after
    record('invalid_context_stops_old_writers_and_ignores_late_replies',after);p.close()

    p=fixture(browser);inject(p,'media_controller.js');wait(p)
    p.evaluate('()=>{chrome.runtime.sendMessage = () => { throw new Error("Extension context invalidated."); }}')
    p.keyboard.press('d');wait(p)
    assert p.evaluate('__test.media().diagnostic.runtimeDisconnected')
    assert '페이지를 새로고침' in p.locator('#__browser_toolbox_media_error__').inner_text()
    p.evaluate('window.firstReloadNotice=document.getElementById("__browser_toolbox_media_error__")')
    p.keyboard.press('d');wait(p)
    assert p.evaluate('__test.media().rate')==1.1
    assert p.evaluate('firstReloadNotice===document.getElementById("__browser_toolbox_media_error__")')
    record('invalidation_during_send_preserves_playback_and_notifies_once',p.evaluate('__test.media()'));p.close()

    p=fixture(browser);inject(p,'media_controller.js');wait(p);p.keyboard.press('d');wait(p)
    rounds=[]
    for _ in range(2):
        rate=p.evaluate('__test.media().rate');p.evaluate('__test.lifecycle()');wait(p)
        restored=p.evaluate('__test.media()');assert restored['count']==1 and abs(restored['rate']-rate)<1e-6
        p.keyboard.press('d');wait(p);assert abs(p.evaluate('__test.media().rate')-(rate+0.1))<1e-6
        rounds.append(p.evaluate('__test.media()'))
    record('synthetic_cache_restore_twice',rounds);p.close()

    if args.in_memory:
        record('actual_history_navigation',{'result':'Not run: browser policy blocks HTTP navigation, including localhost. Synthetic lifecycle tests are separate.'})
    else:
        p=fixture(browser);inject(p,'media_controller.js');wait(p);p.keyboard.press('d');wait(p)
        p.evaluate('window.__persistedEvents=[];addEventListener("pageshow",e=>__persistedEvents.push(e.persisted))')
        p.goto(BASE+'/other');p.go_back(wait_until='commit');p.wait_for_function('document.readyState === "complete"');wait(p)
        history=p.evaluate('({persisted:window.__persistedEvents ?? null,controllerPresent:!!window.__chatgptBrowserToolsMediaControllerV1__})')
        if history['persisted'] and history['persisted'][-1] is True:
            state=p.evaluate('__test.media()');p.keyboard.press('d');wait(p)
            history['before']=state;history['after']=p.evaluate('__test.media()')
            assert state['count']==1 and abs(history['after']['rate']-(state['rate']+0.1))<1e-6
        else: history['result']='This launch did not restore BFCache; real BFCache functionality remains unverified.'
        record('actual_history_navigation',history);p.close()
    p=fixture(browser);inject(p,'youtube_synced_caption_overlay.js');wait(p)
    scans=p.evaluate('__test.stats.documentVideoScans')
    for i in range(20): p.evaluate('i => document.getElementById("counter").textContent=String(i)',i);wait(p,20)
    count=p.evaluate('__test.stats.documentVideoScans')-scans;assert count==0
    record('unrelated_mutations_full_video_scans',{'mutations':20,'additional_scans':count})
    long='이 자막은 크기와 너비를 바꾸었을 때 문장이 전부 보이는지 확인하기 위한 실제 테스트 문장입니다.'
    p.evaluate('text => {document.querySelector("video").currentTime=1;__test.addCaptions([[0,8,text]])}',long);wait(p)
    normal=p.evaluate('__test.caption()');assert normal['display']!='none' and normal['text']==long
    p.evaluate('__test.update({youtubeSyncedCaptionFontSizePx:64,youtubeSyncedCaptionMaxWidthPercent:30,youtubeSyncedCaptionPreferredLineCount:1})');wait(p)
    large=p.evaluate('__test.caption()');assert large['display']!='none' and large['warning'] and large['text']==long
    assert large['textScrollHeight']>large['textClientHeight'] and large['rect']['height']<=361 and large['fontSize']=='64px'
    p.screenshot(path=str(OUT/'caption_overflow.png'))
    p.evaluate('__test.update({youtubeSyncedCaptionOverflowMode:"expand"})');wait(p)
    expanded=p.evaluate('__test.caption()');assert expanded['rect']['width']>large['rect']['width'] and expanded['text']==long
    record('caption_overflow',{'normal':normal,'large':large,'expanded':expanded})
    p.evaluate('__test.update({youtubeSyncedCaptionFontSizePx:28,youtubeSyncedCaptionMaxWidthPercent:92,youtubeSyncedCaptionPreferredLineCount:0,youtubeSyncedCaptionOverflowMode:"scroll"})');wait(p)
    a=p.evaluate('__test.caption()');r=a['rect'];p.mouse.move(r['x']+r['width']/2,r['y']+r['height']/2);p.mouse.down();p.mouse.move(r['x']+r['width']/2+45,r['y']+r['height']/2-70,steps=8);p.mouse.up();wait(p,500)
    b=p.evaluate('__test.caption()');assert abs(b['rect']['y']-a['rect']['y'])>20
    assert b['backdropFilter']=='none';record('caption_drag_preserved',{'before':a['rect'],'after':b['rect'],'position':p.evaluate('__test.settings.youtubeSyncedCaptionPosition')})
    p.evaluate('__test.addCaptions([[0,2,"first"],[2,4,"second"],[4,8,"third"]]);document.querySelector("video").currentTime=0;document.querySelector("video").playbackRate=4;document.querySelector("video").play()')
    p.wait_for_function('document.querySelector("video").currentTime > 2.2 && document.querySelector("video").currentTime < 3.8')
    playback=p.evaluate('__test.caption()');assert playback['rate']==4 and playback['active']==['second'] and playback['text']=='second'
    record('actual_four_speed_caption_time',playback)
    p.evaluate('document.querySelector("video").pause();document.querySelector("video").remove()');wait(p);assert p.evaluate('__test.caption().display')=='none'
    p.evaluate('source=>{const v=document.createElement("video");v.muted=true;v.src=source;v.style.cssText="width:640px;height:360px";document.getElementById("movie_player").appendChild(v)}',VIDEO if args.in_memory else '/tests/fixtures/test.webm');p.wait_for_function('document.querySelector("video").readyState>=2')
    p.evaluate('document.querySelector("video").currentTime=1;__test.addCaptions([[0,8,"late video cue"]])');wait(p)
    late=p.evaluate('__test.caption()');assert late['display']!='none' and late['text']=='late video cue';record('late_media_replacement_detected',late);p.close()

    for order in [('youtube_ab_loop.js','media_controller.js'),('media_controller.js','youtube_ab_loop.js')]:
        p=fixture(browser,{'mediaShortcutFasterCode':'KeyA'})
        for script in order: inject(p,script,youtube=True)
        wait(p,600);assert p.locator('#__browser_toolbox_youtube_ab_loop_button__').count()==1
        p.evaluate('document.querySelector("video").currentTime=1');wait(p);p.keyboard.press('a');wait(p)
        conflict={'media':p.evaluate('__test.media()'),'points':p.evaluate('__test.ab()')};assert conflict['media']['rate']==1 and not any(x['set']=='true' for x in conflict['points'])
        p.evaluate('__test.update({youtubeAbLoopShortcutACode:"KeyQ"})');wait(p);p.keyboard.press('a');wait(p);assert abs(p.evaluate('__test.media().rate')-1.1)<1e-6
        p.keyboard.press('q');wait(p);points=p.evaluate('__test.ab()');assert points[0]['set']=='true'
        hints=p.evaluate('__test.keys()');assert 'Q' in hints
        p.evaluate('__test.update({youtubeAbLoopKeyboardEnabled:false,mediaShortcutFasterCode:"KeyB"})');wait(p);p.keyboard.press('b');wait(p)
        assert abs(p.evaluate('__test.media().rate')-1.2)<1e-6 and p.evaluate('__test.ab()[1].set')!='true'
        record('shortcut_order_'+'_'.join(order),{'collision':conflict,'remapped':points,'hints':hints,'disabledABRate':p.evaluate('__test.media().rate')});p.close()

    p=fixture(browser)
    p.evaluate('''() => {const start=window.setTimeout,stop=window.clearTimeout;globalThis.__abClock={active:new Set(),scheduled:0};window.setTimeout=function(fn,ms,...args){if(ms!==750)return start(fn,ms,...args);__abClock.scheduled++;const id=start(()=>{__abClock.active.delete(id);fn(...args)},ms);__abClock.active.add(id);return id};window.clearTimeout=function(id){__abClock.active.delete(id);stop(id)}}''')
    inject(p,'youtube_ab_loop.js');wait(p,500)
    p.click('#__browser_toolbox_youtube_ab_loop_button__');wait(p)
    initial=p.evaluate('__test.stats.rafRuns');wait(p,1100);idle=p.evaluate('__test.stats.rafRuns')-initial;assert idle==0
    p.evaluate('document.querySelector("video").currentTime=1');wait(p);p.keyboard.press('a');wait(p)
    p.evaluate('document.querySelector("video").currentTime=2');wait(p);p.keyboard.press('b');wait(p)
    p.click('.btx-yt-ab-loop-toggle');wait(p)
    points=p.evaluate('__test.ab()');assert p.evaluate('__abClock.active.size')==1
    p.evaluate('Object.defineProperty(document,"visibilityState",{configurable:true,value:"hidden"});document.dispatchEvent(new Event("visibilitychange"))')
    stopped=p.evaluate('__abClock.scheduled');wait(p,850)
    assert p.evaluate('__abClock.active.size')==0 and p.evaluate('__abClock.scheduled')==stopped
    p.evaluate('Object.defineProperty(document,"visibilityState",{configurable:true,value:"visible"});document.dispatchEvent(new Event("visibilitychange"))')
    assert p.evaluate('__abClock.active.size')==1 and p.evaluate('__test.ab()')==points
    record('AB_visibility_watchdog_suspends_without_losing_points',{'hiddenScheduledTimers':0,'restoredPoints':points})
    initial=p.evaluate('__test.stats.rafRuns');wait(p,600);paused=p.evaluate('__test.stats.rafRuns')-initial;assert paused==0
    p.evaluate('window.__seeks=0;document.querySelector("video").addEventListener("seeking",()=>__seeks++);document.querySelector("video").playbackRate=4;document.querySelector("video").play()');wait(p,1700)
    looping=p.evaluate('({seeks:__seeks,time:document.querySelector("video").currentTime,paused:document.querySelector("video").paused})');assert looping['seeks']>=3 and not looping['paused'] and looping['time']<2.2
    p.evaluate('document.querySelector("video").pause()');wait(p);initial=p.evaluate('__test.stats.rafRuns');wait(p,500);assert p.evaluate('__test.stats.rafRuns')-initial==0
    record('AB_idle_and_real_playback',{'paused_panel_1100ms_raf_runs':idle,'paused_loop_600ms_raf_runs':paused,'playing':looping})
    p.evaluate('__abWatchPage=false;document.dispatchEvent(new Event("yt-navigate-finish"))');wait(p,400)
    stopped=p.evaluate('__abClock.scheduled');wait(p,850)
    assert p.evaluate('__abClock.active.size')==0 and p.evaluate('__abClock.scheduled')==stopped
    record('AB_non_watch_page_has_no_URL_polling',{'scheduledTimers':0});p.close()

    p=fixture(browser,{'mediaOverlayEnabled':True});inject(p,'youtube_ab_loop.js');inject(p,'media_controller.js',youtube=True);wait(p,600)
    p.evaluate('document.querySelector("video").playbackRate=3.5');wait(p)
    assert p.locator('#__browser_toolbox_youtube_speed_indicator__').count()==0
    assert p.locator('#btx-youtube-speed-menu-button').count()==0
    assert p.evaluate('__test.ownFilters()')==[]
    record('passive_speed_indicator_removed_no_filters',{'old_indicator_count':0,'opt_in_menu_count':0,'actual_rate':p.evaluate('__test.media().rate'),'filtering_nodes':p.evaluate('__test.ownFilters()')});p.close()

    p=fixture(browser,popup=True);inject(p,'popup.js');inject(p,'youtube_transcript_popup.js');inject(p,'settings_transfer.js');inject(p,'settings_tools_popup.js');inject(p,'popup_navigation.js');wait(p,600)
    assert p.evaluate('document.documentElement.scrollWidth')<=780
    p.click('#nav-settings')
    p.evaluate('''() => { window.__browserTestResponse = m => {
      if(m.type === ToolboxSettings.MESSAGES.EXPORT) return {ok:true,result:{app:"Browser Toolbox Extension",schemaVersion:1,extensionVersion:"1.52.0",exportedAt:new Date().toISOString(),settings:{mediaSpeedStep:0.2}}};
      if(m.type === ToolboxSettings.MESSAGES.PREVIEW) return {ok:true,result:{digest:"test-ui-digest-not-backend-verification",changedKeys:["mediaSpeedStep"],ruleSiteCount:0,ruleCount:0,includesGlobal:false}};
      if(m.type === ToolboxSettings.MESSAGES.APPLY) { __test.update({mediaSpeedStep:0.2});return {ok:true,result:{changedCount:1}}; }
      if(m.type === ToolboxSettings.MESSAGES.DIAGNOSTICS) return {ok:true,result:{environment:"UI response fixture; backend independently tested",gpuVideoSuperResolution:"not-measured"}};
    }; }''')
    p.click('#settings-export');wait(p);download=p.evaluate('__test.downloads[0]');assert download['filename']=='browser_toolbox_settings.zip'
    import base64
    raw=base64.b64decode(download['url'].split(',',1)[1]);(OUT/'ui_settings_export.zip').write_bytes(raw)
    p.set_input_files('#settings-import-file',{'name':'browser_toolbox_settings.zip','mimeType':'application/zip','buffer':raw});wait(p)
    assert p.locator('#settings-import-preview').is_visible() and not p.locator('#settings-import-apply').is_disabled()
    assert p.evaluate('__test.sent.filter(m=>m.type===ToolboxSettings.MESSAGES.APPLY).length')==0
    p.click('#settings-import-apply');wait(p);assert p.evaluate('__test.settings.mediaSpeedStep')==0.2
    p.click('#settings-copy-diagnostics');wait(p);assert 'not-measured' in p.locator('#settings-diagnostics-text').input_value()
    p.screenshot(path=str(OUT/'settings_tools.png'));assert p.evaluate('document.documentElement.scrollWidth')<=780
    record('popup_backup_preview_and_apply_UI',{'downloadFilename':download['filename'],'previewRequired':True,'confirmedSetting':p.evaluate('__test.settings.mediaSpeedStep'),'width':p.evaluate('document.documentElement.scrollWidth'),'diagnostic':p.locator('#settings-diagnostics-text').input_value()})
    p.close();print('Closing browser',flush=True);browser.close();print('Browser closed',flush=True)
  print('Browser test driver closed',flush=True)
  if results['errors']: raise AssertionError(results['errors'])
  results['passed']=True
except Exception as error:
  results['passed']=False;results['failure']=str(error);results['traceback']=traceback.format_exc()
finally:
  server.shutdown();(OUT/'browser_results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
  print(json.dumps(results,ensure_ascii=False,indent=2))
if not results['passed']: sys.exit(1)
