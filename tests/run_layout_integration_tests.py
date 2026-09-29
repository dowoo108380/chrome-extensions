"""Actual installed MV3 storage/UI -> isolated content script -> MAIN resize handler.
Local routed YouTube-shaped fixture, with independently cached native seek width;
not a claim that this fixture implements the live YouTube player.
"""
from pathlib import Path
from urllib.parse import urlsplit
import argparse, json, re, tempfile, time, traceback
from playwright.sync_api import sync_playwright

R = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--chromium', required=True)
p.add_argument('--extension', type=Path, default=R)
a = p.parse_args(); O = R/'.test_results'; O.mkdir(exist_ok=True)
report = {'scope': __doc__, 'passed': False, 'tests': {}, 'errors': []}
fixtures = ['layout_regression_fixture','scroll_regression_fixture','playlist_fixture','theater_fixture','width_fixture','player_viewport_fixture','foundation_fixture']
setup = '''
globalThis.__test={settings:{}}; FoundationFixture.player('window-resizes');
const f=PlayerViewportFixture,watch=document.querySelector('ytd-watch-flexy');
watch.setAttribute('video-id','layout_fixture'); f.video.muted=true;f.video.src='/sample.webm';
const gear=document.createElement('button');gear.className='ytp-settings-button';gear.textContent='Settings';
gear.setAttribute('aria-label','설정');gear.setAttribute('data-tooltip-title','설정');
f.controls.querySelector('.ytp-chrome-controls').append(gear);
const next=document.createElement('button');next.id='next-video';next.textContent='Next fixture video';document.body.append(next);
next.addEventListener('click',()=>{
 document.dispatchEvent(new Event('yt-navigate-start'));
 history.pushState({},'', '/watch?v=layout_next');watch.setAttribute('video-id','layout_next');
 const ref=FoundationFixture.reference;
 f.video.style.width=ref.player+'px';f.video.style.height=ref.height+'px';
 f.controls.style.width=ref.controls+'px';
 f.controls.querySelector('.ytp-progress-bar').style.width=ref.controls+'px';
 f.controls.querySelector('.ytp-chrome-controls').style.width=ref.controls+'px';
 FoundationFixture.cachedSeekWidth=ref.controls;
 document.dispatchEvent(new Event('yt-navigate-finish'));
});
globalThis.layoutMeasure=()=>{
 const box=n=>{const b=n.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height}};
 return {player:box(f.player),video:box(f.video),progress:box(f.controls.querySelector('.ytp-progress-bar')),
 cachedSeekWidth:FoundationFixture.cachedSeekWidth,notifications:f.syntheticResize,reference:FoundationFixture.reference,
 marker:watch.getAttribute('data-btx-layout-width'),nativeLabel:gear.getAttribute('aria-label'),nativeTooltip:gear.getAttribute('data-tooltip-title')};
};
'''
html = '<!doctype html><html><head><meta charset=utf-8><title>Installed layout regression</title></head><body>' + ''.join(f'<script src="/{f}.js"></script>' for f in fixtures) + '<script src="/setup.js"></script></body></html>'
files = {'/watch': ('text/html', html.encode()), '/setup.js': ('text/javascript', setup.encode()), '/sample.webm': ('video/webm', (R/'tests/fixtures/player_geometry.webm').read_bytes())}
files.update({'/'+f+'.js': ('text/javascript',(R/'.test_dist'/f'{f}.js').read_bytes()) for f in fixtures})

def record(name, value=True):
    report['tests'][name] = value; print('PASS', name, flush=True)

def wait(q, predicate, description):
    deadline = time.monotonic()+10
    while not predicate():
        assert time.monotonic()<deadline, description
        q.wait_for_timeout(40)

try:
    with tempfile.TemporaryDirectory(prefix='btx-layout-integration-', ignore_cleanup_errors=True) as profile, sync_playwright() as pw:
        context = pw.chromium.launch_persistent_context(profile, executable_path=a.chromium, headless=True, no_viewport=True,
            ignore_default_args=['--disable-extensions'], args=['--enable-unsafe-extension-debugging','--window-size=1920,1100'])
        try:
            context.set_default_timeout(10000); report['browser'] = context.browser.version
            cdp = context.browser.new_browser_cdp_session()
            extension = cdp.send('Extensions.loadUnpacked', {'path': str(a.extension.resolve())})['id']
            control = context.new_page(); control.goto(f'chrome-extension://{extension}/popup.html')
            def route_fixture(route):
                path = urlsplit(route.request.url).path
                kind, body = files.get(path, ('text/plain', b''))
                headers = {}; status_code = 200
                if path == '/sample.webm':
                    headers['Accept-Ranges'] = 'bytes'
                    requested = re.fullmatch(r'bytes=(\d+)-(\d*)',route.request.headers.get('range',''))
                    if requested:
                        start = int(requested[1]); end = min(int(requested[2]) if requested[2] else len(body)-1,len(body)-1)
                        headers['Content-Range'] = f'bytes {start}-{end}/{len(body)}'
                        body = body[start:end+1]; status_code = 206
                route.fulfill(status=status_code, content_type=kind, headers=headers, body=body)
            context.route('https://www.youtube.com/**', route_fixture)
            q = context.new_page(); q.on('pageerror', lambda e: report['errors'].append(str(e)))
            q.goto('https://www.youtube.com/watch?v=layout_fixture'); q.wait_for_function('!!window.layoutMeasure && PlayerViewportFixture.video.readyState>=2')
            tab_id = control.evaluate('async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id', q.url)
            def status():
                return control.evaluate('async id=>(await chrome.tabs.sendMessage(id,{type:"youtube-layout:get-status"},{frameId:0})).result', tab_id)
            control.locator('#nav-youtube').click()
            control.locator('#btx-option-youtubeLayoutTabsEnabled').check()
            q.bring_to_front()
            def healthy():
                s = status(); m = q.evaluate('layoutMeasure()')
                return s.get('pageFlow',{}).get('playerSizing',{}).get('viewportFit',{}).get('widthPhase')=='accepted' and abs(m['player']['width']-m['video']['width'])<2 and abs(m['progress']['width']-m['cachedSeekWidth'])<2
            wait(q, healthy, 'Installed content script did not synchronize MAIN player size')
            first = q.evaluate('layoutMeasure()'); assert first['player']['width']>first['reference']['player']+200, first
            assert first['marker']=='watch' and 1<=first['notifications']<=2, first
            record('real_preference_and_isolated_to_main_resize', first)
            seeks = []
            for fraction in [.25,.75,.95]:
                q.locator('.ytp-progress-bar').scroll_into_view_if_needed()
                r = q.locator('.ytp-progress-bar').bounding_box(); q.mouse.click(r['x']+r['width']*fraction,r['y']+5)
                try: q.wait_for_function('f=>Math.abs(PlayerViewportFixture.video.currentTime/PlayerViewportFixture.video.duration-f)<.015',arg=fraction)
                except Exception:
                    report['seekFailure'] = q.evaluate('({...layoutMeasure(),time:PlayerViewportFixture.video.currentTime,duration:PlayerViewportFixture.video.duration,seeks:FoundationFixture.seeks,viewportHeight:innerHeight})'); raise
                seeks.append(q.evaluate('PlayerViewportFixture.video.currentTime/PlayerViewportFixture.video.duration'))
            record('real_pointer_seek_with_independent_native_cache', seeks)
            q.locator('#next-video').click(); q.wait_for_url('**?v=layout_next'); wait(q, healthy, 'New video reused stale native dimensions')
            record('same_document_navigation_rechecks_native_size', q.evaluate('layoutMeasure()'))
            before = q.evaluate('layoutMeasure().notifications'); q.wait_for_timeout(1400)
            assert q.evaluate('layoutMeasure().notifications')==before
            record('no_recurring_resize_notifications')
            assert q.locator('.ytp-settings-button').get_attribute('aria-label')=='설정'
            assert q.locator('.ytp-settings-button').get_attribute('data-tooltip-title')=='설정'
            record('native_settings_accessibility_attributes_preserved')
            q.screenshot(path=str(O/'layout_installed_wide.png'))
            control.locator('#btx-option-youtubeLayoutTabsEnabled').uncheck(); q.bring_to_front()
            q.wait_for_function("!document.querySelector('[data-btx-layout-width]') && Math.abs(PlayerViewportFixture.video.getBoundingClientRect().width-FoundationFixture.reference.player)<2")
            restored = q.evaluate('layoutMeasure()')
            assert abs(restored['progress']['width']-restored['reference']['controls'])<2, restored
            record('turning_off_restores_video_and_native_controls', restored)
            report['passed'] = not report['errors']
        finally: context.close()
except Exception:
    report['failure'] = traceback.format_exc(); print(report['failure'], flush=True)
(O/'layout_integration_results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
raise SystemExit(0 if report['passed'] else 1)
