"""Installed MV3 + real toolbar popup/storage/messages/navigation; simulated YouTube menu and media."""
from pathlib import Path
import argparse
import base64
import json
import tempfile
import time
import traceback
from playwright.sync_api import sync_playwright
from popup_session import PopupSession

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--chromium', required=True)
parser.add_argument('--extension', type=Path, default=ROOT)
parser.add_argument('--output', type=Path, default=ROOT / '.test_results/quality_integration.json')
args = parser.parse_args()
report = {'scope': __doc__, 'passed': False, 'tests': {}, 'pageErrors': [],
          'limitations': 'Local routed watch pages; no live YouTube streaming, subscription or other extension behavior is simulated.'}
OUT = ROOT / '.test_results'
OUT.mkdir(exist_ok=True)
setup = '''
__qualityFixture.configure({extraPreferences:true,realNavigation:true,closeTransitionDelay:120,
  items:['4320p 8K','2160p 4K','1080p HD','720p','360p','144p']});
let nextVideo=0;
document.getElementById('next-video').addEventListener('click',()=>{
  __qualityFixture.configure({items:['2160p 4K','1080p HD','720p','360p','144p']});
  __qualityFixture.next('quality_next_'+(++nextVideo));
});
'''
files = {
    '/watch': ('text/html', (ROOT / 'tests/fixtures/quality/modern_watch.html').read_bytes()),
    '/quality-fixture.js': ('text/javascript', (ROOT / '.test_dist/quality_fixture.js').read_bytes()),
    '/quality-fixture-setup.js': ('text/javascript', setup.encode()),
    '/quality-fixture.webm': ('video/webm', (ROOT / 'tests/fixtures/quality/video_256x144.webm').read_bytes()),
}


def record(name, result=True):
    report['tests'][name] = result
    print('PASS', name, flush=True)


def wait_until(page, condition, description):
    deadline = time.monotonic() + 12
    while not condition():
        assert time.monotonic() < deadline, description() if callable(description) else description
        page.wait_for_timeout(40)


try:
    with tempfile.TemporaryDirectory(prefix='btx-quality-integration-', ignore_cleanup_errors=True) as temporary, sync_playwright() as pw:
        context = pw.chromium.launch_persistent_context(
            temporary, executable_path=args.chromium, headless=True, no_viewport=True,
            ignore_default_args=['--disable-extensions'],
            args=['--enable-unsafe-extension-debugging', '--window-size=1280,900'])
        try:
            context.set_default_timeout(10000)
            report['browser'] = context.browser.version
            cdp = context.browser.new_browser_cdp_session()
            extension_id = cdp.send('Extensions.loadUnpacked', {'path': str(args.extension.resolve())})['id']
            popup_url = f'chrome-extension://{extension_id}/popup.html'
            control = context.new_page()
            control.goto(popup_url)
            # Clean initial preferences only. Every preference change under test
            # below comes from trusted input in the actual action popup.
            control.evaluate('chrome.storage.local.set({youtubePreferredQualityEnabled:false,youtubePreferredQualityHeight:1080})')
            from urllib.parse import urlsplit

            def route_fixture(route):
                kind, body = files.get(urlsplit(route.request.url).path, ('text/plain', b''))
                route.fulfill(status=200, content_type=kind, body=body)

            context.route('https://www.youtube.com/**', route_fixture)
            page = context.new_page()
            page.on('pageerror', lambda error: report['pageErrors'].append(str(error)))
            page.goto('https://www.youtube.com/watch?v=quality_fixture')
            page.wait_for_function('document.querySelector("video").readyState>=2 && !!window.__qualityFixture')
            tab_id = control.evaluate('async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id', page.url)

            def status():
                return control.evaluate('async id=>(await chrome.tabs.sendMessage(id,{type:"youtube-quality:status"},{frameId:0})).result', tab_id)

            def selected(label):
                wait_until(page, lambda: status().get('selectedLabel') == label and status()['selectionVerified'], lambda: f'Expected verified {label}; actual: {status()}; closing gear clicks: {page.evaluate("__qualityFixture.closingGearClicks")}')
                wait_until(page, lambda: page.locator('.ytp-settings-menu').is_hidden(), 'Automation left the menu open')
                assert page.evaluate('__qualityFixture.selected') == label
                assert page.evaluate('__qualityFixture.extraPreferenceClicks || 0') == 0
                assert page.evaluate('__qualityFixture.closingGearClicks') == 0, 'Gear was clicked during the close transition'
                return status()

            def popup_read(expression):
                return control.evaluate('()=>{const w=chrome.extension.getViews({type:"popup"})[0];return (' + expression + ')}')

            def open_popup():
                page.bring_to_front()
                previous = {target['targetId'] for target in cdp.send('Target.getTargets')['targetInfos']}
                control.evaluate('chrome.action.openPopup()')
                wait_until(control, lambda: control.evaluate('chrome.extension.getViews({type:"popup"}).some(w=>w.document.documentElement.dataset.popupControlsReady==="true")'), 'Popup not ready')
                target = next(target for target in cdp.send('Target.getTargets')['targetInfos']
                              if target['targetId'] not in previous and target['url'] == popup_url)
                return PopupSession(cdp, control, target['targetId'])

            def popup_click(selector):
                point = control.evaluate('''selector=>{const d=chrome.extension.getViews({type:"popup"})[0].document;
                    const e=d.querySelector(selector);e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();
                    return {x:r.x+r.width/2,y:r.y+r.height/2}}''', selector)
                popup.click(point['x'], point['y'])

            def close_popup():
                control.evaluate('chrome.extension.getViews({type:"popup"})[0].close()')
                wait_until(control, lambda: control.evaluate('chrome.extension.getViews({type:"popup"}).length===0'), 'Popup did not close')

            def saved(key, value):
                wait_until(control, lambda: control.evaluate('async key=>(await chrome.storage.local.get(key))[key]', key) == value, f'{key} was not saved from the popup')
                wait_until(control, lambda: not popup_read('w.document.getElementById("youtube-quality-height").disabled'), 'Popup save did not finish')

            assert status()['state'] == 'off'
            popup = open_popup()
            popup_click('#nav-youtube')
            popup_click('#youtube-quality-height')
            popup.key('End', 35)
            popup.key('Enter', 13)
            saved('youtubePreferredQualityHeight', 4320)
            popup_click('label[for="youtube-quality-auto"]')
            saved('youtubePreferredQualityEnabled', True)
            record('real_popup_preferences_reach_current_content_script_with_null_label', selected('4320p 8K'))
            popup_click('#youtube-quality-details > summary')
            popup_click('#youtube-quality-inspect')
            wait_until(control, lambda: '확인한 메뉴 선택: 4320p 8K' in popup_read('w.document.getElementById("youtube-quality-status").textContent'), 'Popup status missed selection')
            text = popup_read('w.document.getElementById("youtube-quality-status").textContent')
            assert '256 × 144px' in text
            popup_read('w.document.getElementById("youtube-quality-status").scrollIntoView({block:"center"})')
            screenshot = popup.send('Page.captureScreenshot', {'format': 'png', 'captureBeyondViewport': False})
            (OUT / 'quality_installed_popup.png').write_bytes(base64.b64decode(screenshot['data']))
            record('real_popup_status_separates_verified_menu_from_decoded_dimensions', text)
            close_popup()

            page.locator('#next-video').click()
            page.wait_for_url('**?v=quality_next_1')
            record('next_video_in_same_document_uses_saved_preference_and_available_fallback', selected('2160p 4K'))
            page.locator('.ytp-settings-button').click()
            page.locator('[role=menuitem]').filter(has_text='화질').click()
            page.locator('[role=menuitemradio]').filter(has_text='1080p HD').click()
            wait_until(page, lambda: status()['state'] == 'manual', 'Trusted manual selection was not preserved')
            record('real_native_manual_selection_suspends_automation')

            popup = open_popup()
            popup_click('#nav-youtube')
            popup_click('#youtube-quality-height')
            popup.key('Home', 36)
            for _ in range(4):
                popup.key('ArrowDown', 40)
            popup.key('Enter', 13)
            saved('youtubePreferredQualityHeight', 720)
            assert status()['state'] == 'manual' and page.evaluate('__qualityFixture.selected') == '1080p HD'
            record('popup_save_preserves_explicit_current_video_override')
            popup_click('#youtube-quality-details > summary')
            popup_click('#youtube-quality-reapply')
            record('actual_popup_reapply_clears_manual_override', selected('720p'))
            close_popup()
            page.locator('#next-video').click()
            page.wait_for_url('**?v=quality_next_2')
            record('next_video_automatically_receives_updated_popup_preference', selected('720p'))
            page.goto('https://www.youtube.com/watch?v=quality_fixture')
            record('new_document_load_automatically_reads_persisted_preference', selected('720p'))
            popup = open_popup()
            assert popup_read('w.document.getElementById("youtube-quality-auto").checked')
            assert popup_read('w.document.getElementById("youtube-quality-height").value') == '720'
            record('reopened_toolbar_popup_retains_saved_preferences')
            close_popup()
            report['passed'] = not report['pageErrors']
        finally:
            context.close()
except Exception:
    report['failure'] = traceback.format_exc()
    print(report['failure'], flush=True)
finally:
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
raise SystemExit(0 if report['passed'] else 1)
