"""Native Chrome MV3/storage/media with local pages and a simulated YouTube caption player.
Assert visible results, raw session state, next documents and later user choices.
The optional extension path also permits running these assertions against a pre-fix build.
"""
from pathlib import Path
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from threading import Thread
import argparse
import json
import tempfile
import time
import traceback
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--chromium', required=True)
parser.add_argument('--extension', type=Path, default=ROOT)
parser.add_argument('--output', type=Path, default=ROOT / '.test_results/state_preservation.json')
args = parser.parse_args()
report = {'scope': __doc__, 'tests': {}, 'pageErrors': [], 'passed': False}
video_bytes = (ROOT / 'tests/fixtures/test.webm').read_bytes()
html = b'''<!doctype html><meta charset="utf-8"><title>State preservation</title>
<div id="movie_player" class="html5-video-player" style="width:640px;height:360px">
<video class="html5-main-video" muted controls style="width:640px;height:360px" src="/sample.webm"></video></div>'''


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        media = self.path.startswith('/sample.webm')
        self.send_response(200)
        self.send_header('Content-Type', 'video/webm' if media else 'text/html')
        self.end_headers()
        self.wfile.write(video_bytes if media else html)

    def log_message(self, *_args):
        pass


def poll(page, read, description, timeout=10):
    until = time.monotonic() + timeout
    while not read():
        assert time.monotonic() < until, description
        page.wait_for_timeout(25)


def run_case(name, action):
    try:
        report['tests'][name] = {'passed': True, 'observed': action()}
        print('PASS', name, flush=True)
    except Exception:
        report['tests'][name] = {'passed': False, 'failure': traceback.format_exc()}
        print('FAIL', name, report['tests'][name]['failure'], flush=True)


server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
Thread(target=server.serve_forever, daemon=True).start()
try:
    with tempfile.TemporaryDirectory(prefix='btx-state-preservation-', ignore_cleanup_errors=True) as profile, sync_playwright() as pw:
        context = pw.chromium.launch_persistent_context(profile, executable_path=args.chromium, headless=True,
            ignore_default_args=['--disable-extensions'], args=['--enable-unsafe-extension-debugging', '--autoplay-policy=no-user-gesture-required'])
        try:
            report['browser'] = context.browser.version
            cdp = context.browser.new_browser_cdp_session()
            eid = cdp.send('Extensions.loadUnpacked', {'path': str(args.extension.resolve())})['id']
            ui = context.new_page()
            ui.goto(f'chrome-extension://{eid}/popup.html')

            def settings(values):
                ui.evaluate('values=>chrome.storage.local.set(values)', values)

            def tab_id(page):
                return ui.evaluate('async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id', page.url)

            def send(tab, message):
                return ui.evaluate('message=>chrome.runtime.sendMessage(message)', {'tabId': tab, **message})

            def stored(tab):
                return ui.evaluate('async id=>(await chrome.storage.session.get("mediaControllerTabStatesV3")).mediaControllerTabStatesV3[String(id)]', tab)

            def media_page(keep=True):
                settings({'mediaControllerEnabled': True, 'mediaKeepRateForNewMedia': keep})
                page = context.new_page()
                page.on('pageerror', lambda error: report['pageErrors'].append(str(error)))
                page.goto(f'http://127.0.0.1:{server.server_port}/?case={time.monotonic_ns()}')
                poll(page, lambda: page.evaluate('document.querySelector("video").readyState>=2'), 'Video not ready')
                tab = tab_id(page)
                poll(page, lambda: send(tab, {'type': 'media-controller:get-tab-state'}).get('hasMedia'), 'Controller not ready')
                return page, tab

            def restart_worker():
                versions = []
                session = context.new_cdp_session(ui)
                session.on('ServiceWorker.workerVersionUpdated', lambda event: versions.extend(event['versions']))
                session.send('ServiceWorker.enable')
                poll(ui, lambda: any(v.get('scriptURL') == f'chrome-extension://{eid}/dist/background.js' and v.get('runningStatus') == 'running' for v in versions), 'Worker not discovered')
                worker = next(v for v in reversed(versions) if v.get('scriptURL') == f'chrome-extension://{eid}/dist/background.js' and v.get('runningStatus') == 'running')
                session.send('ServiceWorker.stopWorker', {'versionId': worker['versionId']})
                session.detach()

            def fast_external_rates():
                observations = []
                for delay in (0, 50, 150):
                    page, tab = media_page()
                    try:
                        page.evaluate('''delay=>{const v=document.querySelector('video');window.rateEvents=[];let armed=false;
                          v.addEventListener('ratechange',()=>{rateEvents.push({rate:v.playbackRate,at:performance.now()});
                            if(!armed && v.playbackRate===2.5){armed=true;setTimeout(()=>v.playbackRate=1.75,delay)}})}''', delay)
                        assert send(tab, {'type': 'media-controller:set-tab-rate', 'rate': 2.5})['ok']
                        page.wait_for_timeout(600)
                        actual = page.evaluate('document.querySelector("video").playbackRate')
                        raw = stored(tab)
                        state = send(tab, {'type': 'media-controller:get-tab-state'})
                        observation = {'delay': delay, 'actual': actual, 'rawSession': raw, 'state': state, 'events': page.evaluate('rateEvents')}
                        assert actual == raw['active']['rate'] == raw['templateRate'] == state['rate'] == state['templateRate'] == 1.75, observation
                        restart_worker()
                        restored = send(tab, {'type': 'media-controller:get-tab-state'})
                        assert restored['rate'] == restored['templateRate'] == 1.75, restored
                        page.goto(f'http://127.0.0.1:{server.server_port}/next?delay={delay}')
                        poll(page, lambda: page.evaluate('document.querySelector("video").readyState>=2'), 'Next document not ready')
                        page.wait_for_timeout(400)
                        observation['nextDocumentRate'] = page.evaluate('document.querySelector("video").playbackRate')
                        observation['afterWorkerRestart'] = restored
                        assert observation['nextDocumentRate'] == 1.75, observation
                        observations.append(observation)
                    finally:
                        page.close()
                return observations

            def reenable(keep, replace_source=False):
                page, tab = media_page(keep)
                try:
                    observations = []
                    for cycle in range(2):
                        assert send(tab, {'type': 'media-controller:set-tab-rate', 'rate': 2})['ok']
                        page.wait_for_timeout(220)
                        settings({'mediaControllerEnabled': False})
                        page.wait_for_timeout(200)
                        page.evaluate('document.querySelector("video").playbackRate=1.5')
                        if replace_source:
                            page.evaluate('cycle=>{const v=document.querySelector("video");v.src="/sample.webm?new="+cycle;v.load()}', cycle)
                            poll(page, lambda: page.evaluate('document.querySelector("video").readyState>=2'), 'Replacement source not ready')
                        page.wait_for_timeout(100)
                        settings({'mediaControllerEnabled': True})
                        page.wait_for_timeout(400)
                        expected = (2 if keep else 1) if replace_source else 1.5
                        actual = page.evaluate('document.querySelector("video").playbackRate')
                        state = send(tab, {'type': 'media-controller:get-tab-state'})
                        raw = stored(tab)
                        observation = {'cycle': cycle, 'expected': expected, 'actual': actual, 'state': state, 'rawSession': raw}
                        assert actual == state['rate'] == raw['active']['rate'] == expected, observation
                        if not replace_source:
                            assert state['templateRate'] == raw['templateRate'] == expected, observation
                        observations.append(observation)
                    return observations
                finally:
                    page.close()

            run_case('external_rate_reaches_session_worker_restart_and_next_document', fast_external_rates)
            for keep in (False, True):
                run_case(f'reenable_same_source_keep_{keep}', lambda keep=keep: reenable(keep))
                run_case(f'reenable_new_source_keep_{keep}', lambda keep=keep: reenable(keep, True))

            def caption_route(route):
                media = '/sample.webm' in route.request.url
                route.fulfill(status=200, content_type='video/webm' if media else 'text/html', body=video_bytes if media else html)

            context.route('https://www.youtube.com/**', caption_route)

            def captions(fallback, concurrent, cancel=False):
                page = context.new_page()
                try:
                    page.goto(f'https://www.youtube.com/watch?v=fixture&case={time.monotonic_ns()}')
                    poll(page, lambda: page.evaluate('document.querySelector("video").readyState>=2'), 'Caption media not ready')
                    page.evaluate((ROOT / '.test_dist/caption_security_fixture.js').read_text(encoding='utf-8'))
                    page.evaluate('''__captionFixture({format:'json3',mime:'application/json',text:JSON.stringify({events:[{tStartMs:0,dDurationMs:1000,segs:[{utf8:'State preservation transcript'}]}]})})''')
                    page.evaluate('''fallback=>{
                      const player=document.querySelector('#movie_player');
                      window.initialNativeTrack=document.querySelector('video').addTextTrack('captions','Site original','en');
                      initialNativeTrack.mode=fallback?'disabled':'showing';
                      if(fallback){document.querySelector('.ytp-subtitles-button').click();player.setOption('captions','track',{vssId:'.ko',languageCode:'ko'})}
                      const set=player.setOption.bind(player),fetchOriginal=window.fetch;
                      window.fallbackSelected=false;
                      player.setOption=(module,option,value)=>{if(module==='captions'&&option==='track')window.fallbackSelected=true;return set(module,option,value)};
                      window.fetch=async(...args)=>{
                        if(fallback&&!window.fallbackSelected)return new Response('Force player fallback',{status:404});
                        window.fetchPending=true;await new Promise(resolve=>window.releaseCaptionFetch=resolve);return fetchOriginal(...args)
                      };
                    }''', fallback)
                    snapshot = '''()=>({cc:document.querySelector('.ytp-subtitles-button').getAttribute('aria-pressed'),originalMode:initialNativeTrack.mode,newMode:window.userTrack?.mode??null,chosen:document.querySelector('#movie_player').getOption('captions','track')})'''
                    original = page.evaluate(snapshot)
                    tab = tab_id(page)
                    ui.evaluate('id=>{window.captionJob=chrome.runtime.sendMessage({type:"youtube-transcript:get-transcript",tabId:id,trackIndex:0,trackId:".en",expectedVideoId:"fixture"})}', tab)
                    poll(page, lambda: page.evaluate('window.fetchPending===true'), 'Delayed caption fetch did not begin')
                    if concurrent:
                        if concurrent != 'native-only':
                            page.locator('.ytp-subtitles-button').click()
                        page.evaluate('''nativeOnly=>{initialNativeTrack.mode='disabled';window.userTrack=document.querySelector('video').addTextTrack('captions','User Korean','ko');userTrack.mode='showing';if(!nativeOnly)document.querySelector('#movie_player').setOption('captions','track',{vssId:'.ko',languageCode:'ko'})}''', concurrent == 'native-only')
                    expected = page.evaluate(snapshot) if concurrent else original
                    if cancel:
                        page.evaluate("document.dispatchEvent(new Event('yt-navigate-start'))")
                    page.evaluate('releaseCaptionFetch()')
                    reply = ui.evaluate('window.captionJob')
                    page.wait_for_timeout(100)
                    actual = page.evaluate(snapshot)
                    observed = {'fallback': fallback, 'concurrent': concurrent, 'cancel': cancel, 'original': original, 'expected': expected, 'actual': actual, 'reply': reply}
                    if cancel:
                        assert reply.get('ok') is False, observed
                    else:
                        assert reply.get('ok') is True and reply['entries'][0]['text'] == 'State preservation transcript', observed
                    assert actual == expected, observed
                    return observed
                finally:
                    page.close()

            for fallback in (False, True):
                for concurrent in (False, True):
                    run_case(f'captions_fallback_{fallback}_concurrent_{concurrent}', lambda f=fallback, c=concurrent: captions(f, c))
                run_case(f'captions_fallback_{fallback}_native_track_choice', lambda f=fallback: captions(f, 'native-only'))
                run_case(f'captions_fallback_{fallback}_cancel_preserves_choice', lambda f=fallback: captions(f, True, True))
            report['passed'] = bool(report['tests']) and all(item['passed'] for item in report['tests'].values()) and not report['pageErrors']
        finally:
            context.close()
except Exception:
    report['failure'] = traceback.format_exc()
    print(report['failure'], flush=True)
finally:
    server.shutdown()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
raise SystemExit(0 if report['passed'] else 1)
