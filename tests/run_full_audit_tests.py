"""Regression cases found during the 1.77.4 audit.
Actual Chromium DOM/media/input; controlled Chrome APIs and page-owned player.
The window-resize case models the measured live YouTube cache mismatch.
"""
from pathlib import Path
import argparse, base64, json, re, shutil, time, traceback
from playwright.sync_api import sync_playwright

R = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--chromium', default=shutil.which('chromium'))
parser.add_argument('--baseline', type=Path)
parser.add_argument('--output', type=Path, default=R/'.test_results/full_audit.json')
a = parser.parse_args(); S = a.baseline or R
report = {'scope': __doc__, 'baseline': bool(a.baseline), 'tests': {}, 'pageErrors': []}
video = 'data:video/webm;base64,' + base64.b64encode((R/'tests/fixtures/player_geometry.webm').read_bytes()).decode()

def record(name, fn):
    try:
        report['tests'][name] = {'passed': True, 'observed': fn()}; print('PASS', name, flush=True)
    except Exception:
        report['tests'][name] = {'passed': False, 'error': traceback.format_exc()}; print('FAIL', name, report['tests'][name]['error'], flush=True)

def wait_evaluate(q, expression):
    deadline = time.monotonic() + 4
    while not q.evaluate(expression):
        assert time.monotonic() < deadline, expression
        q.wait_for_timeout(40)

def page(b):
    q = b.new_page(viewport={'width': 1920, 'height': 1100}); q.set_default_timeout(4000)
    q.on('pageerror', lambda e: report['pageErrors'].append(str(e)))
    q.set_content('<!doctype html><html><head></head><body></body></html>')
    q.evaluate((R/'.test_dist/browser_harness.js').read_text())
    q.evaluate((S/'dist/toolbox_shared.js').read_text())
    return q

def width(b, late=False):
    q = page(b)
    for name in ['layout_regression_fixture', 'scroll_regression_fixture', 'playlist_fixture', 'theater_fixture', 'width_fixture', 'player_viewport_fixture', 'foundation_fixture']:
        q.evaluate((R/'.test_dist'/f'{name}.js').read_text())
    q.evaluate("FoundationFixture.player('window-resizes')")
    q.evaluate("css=>{const s=document.createElement('style');s.textContent=css;document.head.append(s)}", (S/'youtube_layout.css').read_text())
    if not late:
        q.evaluate('src=>{PlayerViewportFixture.video.muted=true;PlayerViewportFixture.video.src=src}', video)
        q.wait_for_function('PlayerViewportFixture.video.readyState>=2')
    else: q.evaluate('FoundationFixture.windowUpdatesReady=false')
    q.evaluate("()=>{const b=document.createElement('button');b.className='ytp-settings-button';b.setAttribute('aria-label','설정');b.setAttribute('data-tooltip-title','설정');PlayerViewportFixture.controls.querySelector('.ytp-chrome-controls').append(b)}")
    source = (S/'dist/youtube_layout.js').read_text()
    for name in ['isYouTubePage', 'isWatchPage']:
        source, count = re.subn(r'    function '+name+r'\(\) \{.*?(?:\n    \}| \})', f'    function {name}() {{ return true; }}', source, count=1, flags=re.S); assert count == 1
    q.evaluate(source); q.evaluate('__test.update({youtubeLayoutTabsEnabled:true})')
    if late:
        q.wait_for_function("!!document.querySelector('[data-btx-layout-width]')")
        q.wait_for_timeout(1300)
        assert q.evaluate("__browserToolboxYouTubeLayoutV1__.getStatus().pageFlow.playerSizing.viewportFit.widthPhase") != 'blocked', 'An uninitialized player was permanently blocked'
        q.evaluate('src=>{FoundationFixture.windowUpdatesReady=true;PlayerViewportFixture.video.src=src}', video)
    q.wait_for_function("__browserToolboxYouTubeLayoutV1__.getStatus().pageFlow?.playerSizing?.viewportFit?.widthPhase==='accepted'")
    state = q.evaluate('FoundationFixture.read()')
    assert state['player']['width'] > state['reference']['player'] + 200, state
    assert abs(state['video']['width'] - state['player']['width']) < 2, state
    assert abs(state['progress']['width'] - state['cachedSeekWidth']) < 2, state
    assert state['overriddenNativeNodes'] == 0 and 1 <= state['syntheticResize'] <= 2, state
    seeks = []
    for fraction in [.25, .75, .95]:
        rect = q.locator('.ytp-progress-bar').bounding_box()
        q.mouse.click(rect['x'] + rect['width'] * fraction, rect['y'] + 5)
        q.wait_for_function('f=>Math.abs(PlayerViewportFixture.video.currentTime/PlayerViewportFixture.video.duration-f)<.015', arg=fraction)
        seeks.append(q.evaluate('PlayerViewportFixture.video.currentTime/PlayerViewportFixture.video.duration'))
    sent = q.evaluate('PlayerViewportFixture.syntheticResize')
    q.evaluate("()=>{for(let i=0;i<20;i++){const n=document.createElement('span');n.textContent='ordinary update';document.querySelector('#below').append(n);n.remove()}}")
    q.wait_for_timeout(1300)
    assert q.evaluate('PlayerViewportFixture.syntheticResize') == sent, 'Notification loop'
    assert q.locator('.ytp-settings-button').get_attribute('aria-label') == '설정'
    assert q.locator('.ytp-settings-button').get_attribute('data-tooltip-title') == '설정'
    q.evaluate('__test.update({youtubeLayoutTabsEnabled:false})')
    q.wait_for_function("!document.querySelector('#btx-youtube-tabs')")
    q.wait_for_function('Math.abs(PlayerViewportFixture.video.getBoundingClientRect().width-FoundationFixture.reference.player)<2')
    assert q.locator('[data-btx-layout-width]').count() == 0
    assert q.evaluate('PlayerViewportFixture.syntheticResize') <= sent + 1
    q.close(); return {'wide': state['player']['width'], 'video': state['video']['width'], 'progress': state['progress']['width'], 'seekFractions': seeks, 'notifications': sent, 'restored': True, 'nativeLabelsPreserved': True, 'delayedMetadata': late}

def invalid_settings(b, value):
    q = page(b)
    html = re.sub(r'<script\b[^>]*>\s*</script>', '', (R/'popup.html').read_text())
    q.set_content(html)
    q.evaluate((R/'.test_dist/popup_harness.js').read_text())
    q.evaluate("value=>{for(const key of ['chatConversationWidthPx','mediaSpeedStep','mediaSeekStepSeconds','mediaResetFallbackRate','youtubeSyncedCaptionFontSizePx','youtubeSyncedCaptionMaxWidthPercent']) __test.settings[key]=value}", value)
    q.evaluate((S/'dist/popup.js').read_text()); q.evaluate((S/'dist/youtube_transcript_popup.js').read_text())
    q.wait_for_function("!document.querySelector('#media-speed-step-input').disabled && !document.querySelector('#youtube-synced-caption-font-size').disabled")
    actual = {selector: q.locator(selector).input_value() for selector in ['#media-speed-step-input','#media-seek-step-input','#media-reset-fallback-rate-input','#youtube-synced-caption-font-size','#youtube-synced-caption-max-width']}
    assert [float(v) for v in actual.values()] == [0.1, 10, 2, 28, 92], actual
    assert '960' in q.locator('#chat-width-value').inner_text()
    q.close(); return actual

def ab_suspended(b):
    q = page(b)
    q.evaluate("document.body.innerHTML='<div id=movie_player class=html5-video-player style=\"width:640px;height:360px\"><video class=html5-main-video></video><div class=ytp-right-controls></div></div>'")
    source, count = re.subn(r'function isYouTubeWatchPage\(\) \{.*?\n    \}', 'function isYouTubeWatchPage() { return true; }', (S/'dist/youtube_ab_loop.js').read_text(), count=1, flags=re.S); assert count == 1
    q.evaluate(source); q.wait_for_selector('#__browser_toolbox_youtube_ab_loop_button__', state='attached')
    q.evaluate("()=>{document.dispatchEvent(new Event('yt-navigate-finish'));window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}))}")
    q.wait_for_timeout(700)
    assert q.locator('#__browser_toolbox_youtube_ab_loop_button__').count() == 0, 'A pending navigation timer remounted controls on the suspended page'
    q.evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))")
    q.wait_for_selector('#__browser_toolbox_youtube_ab_loop_button__', state='attached')
    assert q.locator('#__browser_toolbox_youtube_ab_loop_button__').count() == 1
    q.close(); return {'suspendedControls': 0, 'resumedControls': 1, 'lifecycle': 'synthetic BFCache lifecycle boundary'}

def quality_recovery(b):
    q = page(b)
    q.set_content(re.sub(r'<script\b[^>]*>\s*</script>', '', (R/'popup.html').read_text()))
    q.evaluate((R/'.test_dist/popup_harness.js').read_text())
    q.evaluate("Object.assign(__test.settings,{youtubePreferredQualityEnabled:true,youtubePreferredQualityHeight:null,youtubeQualityPremiumPreferred:false});document.querySelector('#view-youtube').hidden=false;document.querySelector('#youtube-quality-card').open=true")
    q.evaluate((S/'dist/youtube_quality_popup.js').read_text())
    q.wait_for_function("!document.querySelector('#youtube-quality-height').disabled")
    assert q.locator('#youtube-quality-height').input_value() == '1080'
    assert q.locator('#youtube-quality-status').get_attribute('data-error') == 'true'
    q.locator('#youtube-quality-height').focus(); q.keyboard.press('End')
    q.wait_for_function("!document.querySelector('#youtube-quality-height').disabled")
    q.keyboard.press('ArrowUp')
    q.wait_for_function('__test.settings.youtubePreferredQualityHeight===2160')
    assert q.evaluate('__test.settings.youtubePreferredQualityEnabled') is True
    assert q.evaluate('__test.settings.youtubeQualityPremiumPreferred') is False
    q.evaluate('__test.update({youtubePreferredQualityHeight:999})')
    assert not q.locator('#youtube-quality-height').is_disabled()
    q.evaluate('__test.update({youtubePreferredQualityHeight:1440})')
    assert q.locator('#youtube-quality-height').input_value() == '1440'
    assert not q.locator('#youtube-quality-height').is_disabled()
    q.close(); return {'nullRecoverable': True, 'otherPreferencesPreserved': True, 'laterStorageChangeRecovered': True}

def capture_pagehide_after_release(b):
    q = page(b)
    q.evaluate("()=>{chrome.runtime.sendMessage=m=>{__test.sent.push(m);return Promise.resolve({ok:true})}}")
    q.evaluate((S/'dist/selector.js').read_text())
    q.mouse.move(250,250); q.mouse.down(); q.mouse.move(500,400)
    # Deliver pagehide after the complete pointer dispatch but before the
    # selector's second paint. A microtask can run between native listeners,
    # accidentally cancelling before pointer release and missing this race.
    q.evaluate("window.addEventListener('pointerup',()=>requestAnimationFrame(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}))),{once:true,capture:true})")
    q.mouse.up(); q.wait_for_timeout(100)
    q.evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))"); q.wait_for_timeout(100)
    captures = q.evaluate("__test.sent.filter(m=>m.type==='drag-area-screenshot:capture').length")
    assert captures == 0, 'An old document selection was sent after pagehide'
    q.close(); return {'capturesAfterNavigation': captures, 'boundary': 'trusted pointer release followed by synthetic pagehide before next paint'}

def quality_invalid_during_selection(b):
    q = page(b)
    html = re.sub(r'<script\b[^>]*>\s*</script>', '', (R/'tests/fixtures/quality/modern_watch.html').read_text())
    q.set_content(html.replace('/quality-fixture.webm', video))
    q.evaluate((R/'.test_dist/quality_fixture.js').read_text())
    q.evaluate("__qualityFixture.configure({delay:500});__test.update({youtubePreferredQualityEnabled:true,youtubePreferredQualityHeight:1080})")
    source = (S/'dist/youtube_quality.js').read_text().replace('function pageUrl() { return new URL(location.href); }', 'function pageUrl() { return new URL(globalThis.__qualityFixture.href); }')
    q.evaluate(source); wait_evaluate(q, '__qualityFixture.qualityOpens>0')
    q.evaluate('__test.update({youtubePreferredQualityHeight:null})'); q.wait_for_timeout(700)
    status = q.evaluate('__qualityFixture.status()'); assert status['state'] == 'error', status
    assert q.evaluate('__qualityFixture.calls') == []
    reply = q.evaluate('__qualityFixture.reapply()'); assert reply['ok'] is False, reply
    q.evaluate('__test.update({youtubePreferredQualityHeight:720})')
    wait_evaluate(q, "async()=>(await __qualityFixture.status()).selectedLabel==='720p'")
    assert q.locator('.ytp-settings-button').get_attribute('aria-label') == 'null'
    assert q.locator('.ytp-settings-button').get_attribute('data-tooltip-title') == 'null'
    q.close(); return {'invalidState': status['state'], 'reapplyRejected': True, 'repairedSelection': '720p', 'nativeAttributesUntouched': True}

def image_restore(b, site_changed):
    q = page(b)
    q.evaluate("()=>{document.body.innerHTML='<img id=photo draggable=false src=\"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7\" style=\"display:block;width:120px;height:80px;-webkit-user-drag:none\" alt=sample>';Object.assign(__test.settings,{imageDragEnabled:true,textSelectionEnabled:false})}")
    q.evaluate((S/'dist/right_click.js').read_text())
    q.wait_for_timeout(50)
    box = q.locator('#photo').bounding_box(); q.mouse.move(box['x'] + box['width']/2, box['y'] + box['height']/2); q.mouse.down()
    assert q.locator('#photo').get_attribute('draggable') == 'true'
    if site_changed:
        q.evaluate("()=>{const n=document.querySelector('#photo');n.setAttribute('draggable','false');n.style.setProperty('-webkit-user-drag','none','important')}")
    q.mouse.up(); q.wait_for_timeout(50)
    actual = q.locator('#photo').evaluate("n=>({draggable:n.getAttribute('draggable'),value:n.style.getPropertyValue('-webkit-user-drag'),priority:n.style.getPropertyPriority('-webkit-user-drag')})")
    assert actual == {'draggable': 'false', 'value': 'none', 'priority': 'important' if site_changed else ''}, actual
    q.close(); return actual

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=a.chromium, headless=True, args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
    report['browser'] = b.version
    record('window_resize_owned_player_and_seek_restore', lambda: width(b))
    record('window_resize_late_player_initialization', lambda: width(b, True))
    for changed in [True, False]: record('image_restore_' + ('site_change' if changed else 'original'), lambda c=changed: image_restore(b, c))
    for value in [None, '', True, []]: record('invalid_numeric_setting_' + repr(value), lambda v=value: invalid_settings(b, v))
    record('ab_pending_navigation_pagehide', lambda: ab_suspended(b))
    record('quality_null_setting_recovery', lambda: quality_recovery(b))
    record('capture_pagehide_between_release_and_paint', lambda: capture_pagehide_after_release(b))
    record('quality_invalid_setting_cancels_inflight_selection', lambda: quality_invalid_during_selection(b))
    b.close()
a.output.parent.mkdir(parents=True, exist_ok=True)
a.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
raise SystemExit(0 if all(v['passed'] for v in report['tests'].values()) and not report['pageErrors'] else 1)
