"""Real MV3 content-script invalidation and recovery in a temporary Chrome profile."""
from pathlib import Path
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from threading import Thread
import argparse
import base64
import json
import tempfile
import time
import traceback
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--chromium', required=True)
parser.add_argument('--extension', type=Path, default=ROOT)
args = parser.parse_args()
report = {'scope': __doc__, 'passed': False, 'tests': {}, 'pageErrors': []}
video = base64.b64encode((ROOT / 'tests/fixtures/test.webm').read_bytes()).decode()
html = ('<!doctype html><meta charset="utf-8"><title>Media runtime fixture</title>'
        '<video controls muted style="width:640px;height:360px" src="data:video/webm;base64,'
        + video + '"></video>').encode()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(html)))
        self.end_headers()
        self.wfile.write(html)

    def log_message(self, *_args):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
Thread(target=server.serve_forever, daemon=True).start()


def record(name, result):
    report['tests'][name] = result
    print('PASS', name, flush=True)


def wait_until(page, condition):
    deadline = time.monotonic() + 10
    while not condition():
        assert time.monotonic() < deadline, 'Media runtime condition timed out'
        page.wait_for_timeout(25)


try:
    with tempfile.TemporaryDirectory(prefix='btx-media-runtime-', ignore_cleanup_errors=True) as temporary, sync_playwright() as pw:
        context = pw.chromium.launch_persistent_context(
            temporary, executable_path=args.chromium, headless=True,
            ignore_default_args=['--disable-extensions'], args=['--enable-unsafe-extension-debugging'])
        try:
            context.set_default_timeout(10000)
            browser_cdp = context.browser.new_browser_cdp_session()
            extension_id = browser_cdp.send('Extensions.loadUnpacked', {'path': str(args.extension.resolve())})['id']
            popup_url = f'chrome-extension://{extension_id}/popup.html'
            control = context.new_page()
            control.goto(popup_url)
            control.evaluate('chrome.storage.local.set({mediaControllerEnabled:true,mediaKeyboardEnabled:true,mediaOverlayEnabled:true})')
            page = context.new_page()
            page.on('pageerror', lambda error: report['pageErrors'].append(str(error)))
            cdp = context.new_cdp_session(page)
            worlds = []
            cdp.on('Runtime.executionContextCreated', lambda event: worlds.append(event['context']))
            cdp.send('Runtime.enable')
            page.goto(f'http://127.0.0.1:{server.server_port}/')
            page.wait_for_function('document.querySelector("video").readyState>=2')

            def evaluate(world, expression):
                value = cdp.send('Runtime.evaluate', {
                    'contextId': world['id'], 'expression': expression,
                    'returnByValue': True, 'awaitPromise': True})
                assert 'exceptionDetails' not in value, value
                return value['result'].get('value')

            def current_world():
                return next(world for world in reversed(worlds)
                            if world.get('origin') == f'chrome-extension://{extension_id}')

            def state(world):
                return evaluate(world, '({rate:document.querySelector("video").playbackRate,'
                                'diagnostic:__chatgptBrowserToolsMediaControllerV1__.getDiagnosticState()})')

            wait_until(page, lambda: any(world.get('origin') == f'chrome-extension://{extension_id}' for world in worlds))
            world = current_world()
            wait_until(page, lambda: state(world)['diagnostic']['registeredCount'] == 1)
            page.keyboard.press('d')
            wait_until(page, lambda: state(world)['rate'] == 1.1 and state(world)['diagnostic']['persistence'] == 'saved')
            record('real_content_script_rate_saved', state(world))

            # Worker suspension is recoverable and must not be treated as context loss.
            worker_cdp = context.new_cdp_session(control)
            versions = []
            worker_cdp.on('ServiceWorker.workerVersionUpdated', lambda event: versions.extend(event['versions']))
            worker_cdp.send('ServiceWorker.enable')
            wait_until(page, lambda: any(v.get('scriptURL') == f'chrome-extension://{extension_id}/dist/background.js'
                                        and v.get('runningStatus') == 'running' for v in versions))
            worker = next(v for v in reversed(versions) if v.get('scriptURL') == f'chrome-extension://{extension_id}/dist/background.js'
                          and v.get('runningStatus') == 'running')
            worker_cdp.send('ServiceWorker.stopWorker', {'versionId': worker['versionId']})
            page.keyboard.press('d')
            wait_until(page, lambda: state(world)['rate'] == 1.2 and state(world)['diagnostic']['persistence'] == 'saved')
            assert not state(world)['diagnostic']['runtimeDisconnected']
            record('shortcut_wakes_worker_and_saves', state(world))

            # Invalidate the actual ISOLATED world, without navigating its host page.
            control.evaluate('()=>{setTimeout(()=>chrome.runtime.reload(),50)}')
            wait_until(page, lambda: not evaluate(world, 'Boolean(chrome.runtime?.id)'))
            page.keyboard.press('d')
            lost = state(world)
            assert lost['rate'] == 1.2 and lost['diagnostic']['runtimeDisconnected'], lost
            assert lost['diagnostic']['registeredCount'] == 0 and lost['diagnostic']['persistence'] == 'failed', lost
            assert '페이지를 새로고침' in page.locator('#__browser_toolbox_media_error__').inner_text()
            evaluate(world, 'window.firstReloadNotice=document.getElementById("__browser_toolbox_media_error__")')
            for key in ['d', 's', 'r', 'v']:
                page.keyboard.press(key)
            assert state(world)['rate'] == 1.2
            assert evaluate(world, 'firstReloadNotice===document.getElementById("__browser_toolbox_media_error__")')
            record('extension_reload_stops_old_controls_and_explains_recovery', lost)

            # Branded Chrome marks CDP-installed extensions as unsupported developer
            # extensions after runtime.reload. Reinstall only this test-owned extension
            # and set the fixture preference before testing a fresh host-page context.
            browser_cdp.send('Extensions.uninstall', {'id': extension_id})
            loaded_id = browser_cdp.send('Extensions.loadUnpacked', {'path': str(args.extension.resolve())})['id']
            assert loaded_id == extension_id
            control = context.new_page()
            control.goto(popup_url)
            control.evaluate('chrome.storage.local.set({mediaControllerEnabled:true,mediaKeyboardEnabled:true,mediaOverlayEnabled:true})')
            report['recoverySetup'] = 'Reinstalled the test-owned CDP extension and enabled media controls; no personal profile or saved-settings migration tested.'
            previous_world_count = len(worlds)
            page.reload()
            wait_until(page, lambda: len(worlds) > previous_world_count and current_world()['id'] != world['id'])
            world = current_world()
            wait_until(page, lambda: state(world)['diagnostic']['registeredCount'] == 1)
            page.keyboard.press('d')
            wait_until(page, lambda: state(world)['rate'] == 1.1 and state(world)['diagnostic']['persistence'] == 'saved')
            assert not state(world)['diagnostic']['runtimeDisconnected']
            assert page.locator('#__browser_toolbox_media_error__').count() == 0
            tab_id = control.evaluate('async url=>(await chrome.tabs.query({})).find(tab=>tab.url===url).id', page.url)
            saved = control.evaluate('async id=>(await chrome.storage.session.get("mediaControllerTabStatesV3")).mediaControllerTabStatesV3[id]', str(tab_id))
            assert saved['active']['rate'] == 1.1 and saved['templateRate'] == 1.1, saved
            record('host_page_reload_restores_actual_session_writes', state(world))
            report['browser'] = context.browser.version
            report['passed'] = not report['pageErrors']
        finally:
            context.close()
except Exception:
    report['failure'] = traceback.format_exc()
    print(report['failure'], flush=True)
finally:
    server.shutdown()
    output = ROOT / '.test_results/media_runtime.json'
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
raise SystemExit(0 if report['passed'] else 1)
