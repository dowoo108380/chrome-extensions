"""Actual installed MV3 APIs, isolated profile and local/synthetic pages. No live YouTube or GPU claim."""
from pathlib import Path
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from threading import Thread
import argparse, base64, json, tempfile, time, traceback
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__); parser.add_argument('--chromium',required=True); parser.add_argument('--extension',type=Path,default=ROOT); args=parser.parse_args()
report={'scope':__doc__,'passed':False,'tests':{},'pageErrors':[]}
video=base64.b64encode((ROOT/'tests/fixtures/test.webm').read_bytes()).decode()
html=('<!doctype html><meta charset="utf-8"><title>Installed extension fixture</title><div id="movie_player" class="html5-video-player" style="width:640px;height:360px"><video class="html5-main-video" muted controls style="width:640px;height:360px" src="data:video/webm;base64,'+video+'"></video></div>').encode()
class Handler(BaseHTTPRequestHandler):
 def do_GET(self):
  self.send_response(200); self.send_header('Content-Type','text/html; charset=utf-8'); self.send_header('Content-Length',str(len(html))); self.end_headers(); self.wfile.write(html)
 def log_message(self,*_args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler); Thread(target=server.serve_forever,daemon=True).start()
def record(name, value):report['tests'][name]=value; print('PASS',name,flush=True)
try:
 with tempfile.TemporaryDirectory(prefix='browser-toolbox-mv3-',ignore_cleanup_errors=True) as temporary, sync_playwright() as pw:
  context=pw.chromium.launch_persistent_context(str(Path(temporary)/'profile'),executable_path=args.chromium,headless=True,ignore_default_args=['--disable-extensions'],args=['--enable-unsafe-extension-debugging','--autoplay-policy=no-user-gesture-required'],accept_downloads=True,downloads_path=str(Path(temporary)/'downloads'))
  context.set_default_timeout(10000)
  try:
   cdp=context.browser.new_browser_cdp_session(); extension_id=cdp.send('Extensions.loadUnpacked',{'path':str(args.extension.resolve())})['id']
   report['browser']=context.browser.version
   popup=context.new_page(); popup.on('pageerror',lambda e:report['pageErrors'].append(str(e))); popup.goto(f'chrome-extension://{extension_id}/popup.html')
   manifest=popup.evaluate('chrome.runtime.getManifest()'); assert manifest['version']==json.loads((ROOT/'manifest.json').read_text())['version']
   assert popup.evaluate("chrome.runtime.sendMessage({type:'settings-tools:export'})")['ok']
   popup.evaluate('chrome.storage.local.set({mediaControllerEnabled:true,mediaKeyboardEnabled:true})')
   page=context.new_page(); page.on('pageerror',lambda e:report['pageErrors'].append(str(e))); page.goto(f'http://127.0.0.1:{server.server_port}/')
   page.wait_for_function('document.querySelector("video").readyState>=2'); page.wait_for_timeout(500); page.keyboard.press('d'); page.wait_for_function('document.querySelector("video").playbackRate===1.1')
   tab_id=popup.evaluate('async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id',page.url)
   state=popup.evaluate("id=>chrome.runtime.sendMessage({type:'media-controller:get-tab-state',tabId:id})",tab_id); assert state['ok'] and state['rate']==1.1,state
   record('manifest_injection_storage_and_messages',{'version':manifest['version'],'rate':state['rate']})
   # Stop the actual worker; the next API request must wake it and recover session storage.
   worker_cdp=context.new_cdp_session(popup)
   versions=[]; worker_cdp.on('ServiceWorker.workerVersionUpdated',lambda e:versions.extend(e['versions'])); worker_cdp.send('ServiceWorker.enable')
   popup.wait_for_timeout(200)
   worker=next(v for v in reversed(versions) if v.get('scriptURL')==f'chrome-extension://{extension_id}/dist/background.js' and v.get('runningStatus')=='running')
   worker_cdp.send('ServiceWorker.stopWorker',{'versionId':worker['versionId']}); popup.wait_for_timeout(200)
   restored=popup.evaluate("id=>chrome.runtime.sendMessage({type:'media-controller:get-tab-state',tabId:id})",tab_id)
   assert restored['ok'] and restored['rate']==1.1,restored
   record('service_worker_restart_preserves_session_rate',{'rate':restored['rate']})
   # Capture success and failure both release the temporary debugger attachment.
   captured=popup.evaluate("id=>chrome.runtime.sendMessage({type:'capture-full-page',tabId:id})",tab_id); assert captured['ok'] and isinstance(captured['downloadId'],int),captured
   popup.wait_for_function('async id=>!(await chrome.debugger.getTargets()).some(t=>t.tabId===id&&t.attached)',arg=tab_id)
   popup.wait_for_function('async id=>(await chrome.downloads.search({id}))[0]?.state==="complete"',arg=captured['downloadId'])
   downloads_root=(Path(temporary)/'downloads').resolve()
   # Chrome may report complete before the asynchronous filesystem rename is visible.
   deadline=time.monotonic()+3
   while True:
    downloaded=[p.resolve() for p in downloads_root.rglob('*') if p.is_file() and p.suffix!='.crdownload']
    if downloaded or time.monotonic()>=deadline:break
    popup.wait_for_timeout(25)
   assert len(downloaded)==1, {'files':[str(p.relative_to(downloads_root)) for p in downloaded],'download':popup.evaluate('async id=>{const d=(await chrome.downloads.search({id}))[0];return {filename:d.filename,exists:d.exists,fileSize:d.fileSize,state:d.state}}',captured['downloadId'])}
   assert downloaded[0].is_relative_to(downloads_root) and downloaded[0].read_bytes()[:8]==b'\x89PNG\r\n\x1a\n'
   page.evaluate('document.body.style.height="40000px"')
   rejected=popup.evaluate("id=>chrome.runtime.sendMessage({type:'capture-full-page',tabId:id})",tab_id); assert not rejected['ok'] and '캡처' in rejected['error'],rejected
   popup.wait_for_function('async id=>!(await chrome.debugger.getTargets()).some(t=>t.tabId===id&&t.attached)',arg=tab_id)
   record('capture_and_oversize_failure_release_debugger',{'downloadCompleted':True,'validPNG':True,'oversizeRejected':True})
   # A real selector message carries Chrome's documentId, not a fixture identity.
   page.evaluate('document.body.style.height=""'); page.bring_to_front()
   selection=popup.evaluate("id=>chrome.runtime.sendMessage({type:'start-area-selection',tabId:id})",tab_id)
   assert selection['ok'],selection
   page.locator('#__drag_area_screenshot_host__').wait_for(state='visible')
   page.mouse.move(80,80); page.mouse.down(); page.mouse.move(380,280,steps=5); page.mouse.up()
   popup.wait_for_function('async ()=>(await chrome.downloads.search({})).some(d=>d.filename.includes("selected_area_screenshots")&&d.state==="complete")')
   popup.wait_for_function('async id=>!(await chrome.debugger.getTargets()).some(t=>t.tabId===id&&t.attached)',arg=tab_id)
   deadline=time.monotonic()+3
   while True:
    selected_pngs=[]
    for candidate in downloads_root.rglob('*'):
     if not candidate.is_file() or candidate.suffix=='.crdownload':continue
     header=candidate.read_bytes()[:24]
     if header[:8]==b'\x89PNG\r\n\x1a\n' and int.from_bytes(header[16:20],'big')==300 and int.from_bytes(header[20:24],'big')==200:selected_pngs.append(candidate)
    if selected_pngs or time.monotonic()>=deadline:break
    popup.wait_for_timeout(25)
   assert len(selected_pngs)==1
   record('selection_capture_validates_real_document_and_downloads_exact_area',{'width':300,'height':200,'debuggerReleased':True})
   # Only synthetic cookies in this test-owned, temporary profile are affected.
   local_origin=f'http://127.0.0.1:{server.server_port}'
   page.evaluate('document.cookie="btx_local=fixture; SameSite=Lax; path=/"')
   context.add_cookies([{'name':'btx_unrelated','value':'keep','url':'https://untouched.invalid/'}])
   refused=popup.evaluate("targets=>chrome.runtime.sendMessage({type:'tab-tools:clear-site-data',targets})",[{'tabId':tab_id,'origin':'https://untouched.invalid'}])
   assert not refused['ok'] and any(c['name']=='btx_local' for c in context.cookies(local_origin)),refused
   cleared=popup.evaluate("targets=>chrome.runtime.sendMessage({type:'tab-tools:clear-site-data',targets})",[{'tabId':tab_id,'origin':local_origin}])
   assert cleared['ok'] and not any(c['name']=='btx_local' for c in context.cookies(local_origin)),cleared
   assert any(c['name']=='btx_unrelated' for c in context.cookies('https://untouched.invalid/'))
   record('site_data_revalidates_target_and_preserves_unrelated_cookies',{'wrongOriginRejected':True,'selectedCookieRemoved':True,'unrelatedCookiePreserved':True})
   # Real MAIN/ISOLATED worlds and runtime.Port; only page content/network are fixtures.
   await_url='https://www.youtube.com/watch?v=fixture'
   context.route('https://www.youtube.com/**',lambda route:route.fulfill(status=200,content_type='text/html',body=html))
   caption=context.new_page(); caption.on('pageerror',lambda e:report['pageErrors'].append(str(e))); caption.goto(await_url)
   caption.wait_for_function('document.querySelector("video").readyState>=2')
   caption.evaluate((ROOT/'.test_dist/caption_security_fixture.js').read_text())
   caption.evaluate('__captionFixture({format:"json3",mime:"application/json",text:JSON.stringify({events:[{tStartMs:0,dDurationMs:1000,segs:[{utf8:"installed world"}]}]})})')
   caption_id=popup.evaluate('async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id',await_url)
   transcript=popup.evaluate("id=>chrome.runtime.sendMessage({type:'youtube-transcript:get-transcript',tabId:id,trackIndex:0,trackId:'.en',expectedVideoId:'fixture'})",caption_id)
   assert transcript['ok'] and transcript['entries'][0]['text']=='installed world',transcript
   record('caption_real_world_bridge',{'text':transcript['entries'][0]['text']})
   caption.evaluate('()=>{window.fetch=(_url,options)=>{window.pendingSignal=options.signal;return new Promise(()=>{})}}')
   popup.evaluate("id=>{window.testPort=chrome.runtime.connect({name:'browser-toolbox:caption-tasks'});testPort.postMessage({requestId:crypto.randomUUID(),message:{type:'youtube-transcript:get-transcript',tabId:id,trackIndex:0,trackId:'.en',expectedVideoId:'fixture'}})}",caption_id)
   caption.wait_for_function('!!window.pendingSignal'); popup.evaluate('testPort.disconnect()'); caption.wait_for_function('pendingSignal.aborted && !globalThis.__browserToolboxCaptionTasksV1?.size')
   assert caption.locator('.ytp-subtitles-button').get_attribute('aria-pressed')=='true'
   later=popup.evaluate("id=>chrome.runtime.sendMessage({type:'youtube-transcript:get-info',tabId:id})",caption_id); assert later['ok'],later
   record('port_disconnect_aborts_and_releases_queue',{'restoredCC':True,'nextTaskSucceeded':True})
   report['passed']=not report['pageErrors']
  finally:context.close()
except Exception:
 report['failure']=traceback.format_exc();print(report['failure'],flush=True)
finally:
 server.shutdown();out=ROOT/'.test_results/installed_extension.json';out.parent.mkdir(exist_ok=True);out.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
raise SystemExit(0 if report['passed'] else 1)
