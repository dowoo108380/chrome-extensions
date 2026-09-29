"""Real chrome.action popup auto-sizing in isolated Chrome profiles; no viewport override or API mocks."""
from pathlib import Path
import argparse, base64, json, tempfile, time, traceback
from playwright.sync_api import sync_playwright
from popup_session import PopupSession

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.test_results'
OUT.mkdir(exist_ok=True)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--chromium', required=True)
parser.add_argument('--extension', type=Path, default=ROOT)
args = parser.parse_args()
report = {'scope': __doc__, 'passed': False, 'tests': [], 'errors': []}


def wait_until(page, predicate, arg=None):
    # Poll from the driver: wait_for_function injects eval into the extension's
    # page, which can be rejected by its CSP after a popup renderer detaches.
    deadline = time.monotonic() + 5
    while not page.evaluate(predicate, arg):
        assert time.monotonic() < deadline, 'Popup condition timed out: ' + predicate
        page.wait_for_timeout(25)




try:
    with sync_playwright() as pw:
        for scale in [1, 1.25, 2]:
            with tempfile.TemporaryDirectory(prefix='btx-popup-window-', ignore_cleanup_errors=True) as temporary:
                context = pw.chromium.launch_persistent_context(str(Path(temporary) / 'profile'), executable_path=args.chromium,
                    headless=True, no_viewport=True, ignore_default_args=['--disable-extensions'],
                    args=['--enable-unsafe-extension-debugging', f'--force-device-scale-factor={scale}', '--window-size=1280,900'])
                try:
                    report['browser'] = context.browser.version
                    cdp = context.browser.new_browser_cdp_session()
                    extension_id = cdp.send('Extensions.loadUnpacked', {'path': str(args.extension.resolve())})['id']
                    url = f'chrome-extension://{extension_id}/popup.html'
                    control = context.new_page()
                    control.goto(url)
                    control.on('pageerror', lambda error: report['errors'].append(str(error)))
                    for opening in range(2):
                        previous = {target['targetId'] for target in cdp.send('Target.getTargets')['targetInfos']}
                        control.evaluate('chrome.action.openPopup()')
                        wait_until(control, '()=>chrome.extension.getViews({type:"popup"}).some(w=>w.document.documentElement.dataset.popupControlsReady==="true")')
                        wait_until(control, '()=>chrome.extension.getViews({type:"popup"}).some(w=>w.innerWidth>=350 && w.innerHeight>=150)')
                        view = control.evaluate('''() => {const w=chrome.extension.getViews({type:"popup"})[0];const box=w.document.querySelector('.panel').getBoundingClientRect();return {width:w.innerWidth,height:w.innerHeight,dpr:w.devicePixelRatio,panel:{left:box.left,top:box.top,width:box.width,height:box.height},version:w.chrome.runtime.getManifest().version}}''')
                        assert 350 <= view['width'] <= 810 and 150 <= view['height'] <= 610, view
                        assert view['panel']['left'] == 0 and view['panel']['top'] == 0, view
                        assert abs(view['panel']['width'] - min(780, view['width'])) <= 1, view
                        assert abs(view['panel']['height'] - min(600, view['height'])) <= 1, view
                        target = next(target for target in cdp.send('Target.getTargets')['targetInfos'] if target['targetId'] not in previous and target['url'] == url)
                        session = PopupSession(cdp, control, target['targetId'])
                        control.evaluate('''() => {const w=chrome.extension.getViews({type:"popup"})[0];w.document.addEventListener('pointerdown',e=>{w.lastTestPointer={x:e.clientX,y:e.clientY,id:e.target.closest('button')?.id,trusted:e.isTrusted}})}''')
                        for section in ['media', 'youtube', 'captions', 'tabs', 'page', 'chat', 'settings']:
                            point = control.evaluate('''section => {const w=chrome.extension.getViews({type:"popup"})[0];const nav=w.document.getElementById('nav-'+section);nav.scrollIntoView({block:'nearest'});const r=nav.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}}''', section)
                            session.click(point['x'], point['y'])
                            try:
                                wait_until(control, 'section => {const d=chrome.extension.getViews({type:"popup"})[0].document;return d.getElementById("nav-"+section).getAttribute("aria-selected")==="true"&&!d.getElementById("view-"+section).hidden}', section)
                            except Exception:
                                print('INPUT_DIAGNOSTIC', scale, section, point, view, session.send('Page.getLayoutMetrics'), control.evaluate('chrome.extension.getViews({type:"popup"})[0].lastTestPointer'), flush=True)
                                raise
                            pointer = control.evaluate('chrome.extension.getViews({type:"popup"})[0].lastTestPointer')
                            assert pointer['trusted'] and pointer['id'] == 'nav-' + section, pointer
                            geometry = control.evaluate('''section => {const w=chrome.extension.getViews({type:"popup"})[0],el=w.document.getElementById('view-'+section),r=el.getBoundingClientRect(),footer=w.document.querySelector('.app-footer').getBoundingClientRect();return {right:r.right,bottom:r.bottom,width:el.clientWidth,scroll:el.scrollWidth,footerBottom:footer.bottom,x:w.scrollX,y:w.scrollY}}''', section)
                            assert geometry['scroll'] <= geometry['width'] + 1 and geometry['right'] <= view['width'] + 1, (section, geometry, view)
                            assert geometry['footerBottom'] <= view['height'] + 1 and geometry['bottom'] <= geometry['footerBottom'], geometry
                            assert geometry['x'] == 0 and geometry['y'] == 0, geometry
                        screenshot = session.send('Page.captureScreenshot', {'format': 'png', 'captureBeyondViewport': False})
                        name = f'popup_window_{scale}_{opening}.png'
                        (OUT / name).write_bytes(base64.b64decode(screenshot['data']))
                        report['tests'].append({'scale': scale, 'opening': opening + 1, 'passed': True, 'geometry': view, 'sections': 7, 'screenshot': name})
                        print('PASS actual toolbar popup', scale, opening + 1, view, flush=True)
                        control.evaluate('chrome.extension.getViews({type:"popup"})[0].close()')
                        wait_until(control, '()=>chrome.extension.getViews({type:"popup"}).length===0')
                finally:
                    context.close()
        report['passed'] = not report['errors']
except Exception:
    report['failure'] = traceback.format_exc()
    print(report['failure'], flush=True)
finally:
    (OUT / 'popup_window.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
raise SystemExit(0 if report['passed'] else 1)
