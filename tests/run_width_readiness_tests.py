"""Regression for 1.62's missing size-readiness observation.
Real Chromium DOM/CSS/media/ResizeObserver; native site & Chrome APIs are fixtures.
NOT a live YouTube/Windows/installed-MV3/NVIDIA or real BFCache test.
Host/watch guards only are changed in memory. Security policy remains enforced.
Build production/tests and tests/tsconfig.readiness_baseline.json before running.
"""
from pathlib import Path
import argparse, base64, hashlib, json, re, shutil, time, traceback
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.test_results'; OUT.mkdir(exist_ok=True)
ap = argparse.ArgumentParser(description=__doc__)
ap.add_argument('--chromium', default=shutil.which('chromium') or shutil.which('chrome'))
args = ap.parse_args()
if not args.chromium: ap.error('Use --chromium with an existing executable.')
result = {'passed': False, 'environment': {'scope': __doc__, 'target_site': 'not tested'}, 'tests': [], 'errors': []}
VIDEO = 'data:video/webm;base64,' + base64.b64encode((ROOT/'tests/fixtures/test.webm').read_bytes()).decode()
SETTINGS = {'youtubeLayoutTabsEnabled': True, 'youtubePanelScrollEnabled': True, 'youtubeCommentStatusEnabled': True, 'youtubeNativePanelsEnabled': True}

def source(old=False):
    name = '.test_readiness_baseline/tests/fixtures/legacy_width_readiness_layout.js' if old else 'dist/youtube_layout.js'
    code = (ROOT/name).read_text()
    for predicate in ['isYouTubePage', 'isWatchPage']:
        code, n = re.subn(r'    function '+predicate+r'\(\) \{.*?(?:\n    \}| \})', f'    function {predicate}() {{ return true; }}', code, count=1, flags=re.S)
        assert n == 1, predicate
    return code

def setup(browser, mode='late-container', old=False):
    p = browser.new_page(viewport={'width':1920, 'height':1200}); p.set_default_timeout(6500)
    p.on('pageerror', lambda e: result['errors'].append(str(e)))
    p.set_content('''<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="require-trusted-types-for 'script'; trusted-types 'none';"></head><body></body></html>''')
    for n in ['layout_regression_fixture','scroll_regression_fixture','playlist_fixture','theater_fixture','width_fixture','width_readiness_fixture','browser_harness']:
        p.evaluate((ROOT/'.test_dist'/f'{n}.js').read_text())
    # Flush initial viewport layout/resize before the stimulus counters are installed.
    p.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    p.wait_for_timeout(100)
    p.evaluate('m=>WidthReadinessFixture.build(m)', mode)
    p.evaluate('WidthFixture.installNativeControls()')
    p.evaluate('s=>Object.assign(__test.settings,s)', SETTINGS)
    p.evaluate((ROOT/'dist/toolbox_shared.js').read_text())
    css = ROOT/('tests/fixtures/legacy_width_readiness_layout.css' if old else 'youtube_layout.css')
    p.evaluate('css=>{const s=document.createElement("style");s.textContent=css;document.head.append(s)}', css.read_text())
    p.evaluate(source(old)); p.wait_for_timeout(450)
    return p

def read(p): return p.evaluate('WidthReadinessFixture.read()')
def ready(p): p.evaluate('WidthReadinessFixture.ready()'); p.wait_for_timeout(500)
def record(name, value):
    result['tests'].append({'name':name,'observed':value}); print('PASS', name, flush=True)
def require_compact(p):
    r=read(p)
    assert r['status']['pageFlow']['widthSizingReason']=='compact', r
    assert r['status']['pageFlow']['playerSizing']['state']=='matches-primary', r
    assert r['horizontalRange']==0 and r['originalVideo'] and r['hostCount']==1, r
    assert r['player']['style'] is None and r['video']['style'] is None, r
    assert r['syntheticResizeEvents']==0, r
    return r

def short(r):
    return {k:r[k] for k in ['player','primary','secondary','markers','resizeEvents','syntheticResizeEvents']} | {'flow':r['status']['pageFlow'], 'reconciliations':r['status']['reconciliationCount']}

try:
    with sync_playwright() as pw:
        b=pw.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
        result['environment']['browser']=b.version
        for mode in ['late-container','position-transition','primary-hidden']:
            old=setup(b,mode,True); before=read(old); ready(old); stuck=read(old)
            assert stuck['markers']==0, (mode, stuck)
            assert stuck['resizeEvents']==0, stuck
            p=setup(b,mode); initial=read(p); ready(p); after=require_compact(p)
            assert after['status']['layout']=='applied' and after['resizeEvents']==0, after
            assert after['player']['width']>stuck['player']['width'], (stuck,after)
            if mode=='late-container':
                old.screenshot(path=str(OUT/'player_size_before.png')); p.screenshot(path=str(OUT/'player_size_after.png'))
            record('baseline_failure_and_recovery_'+mode, {'oldInitial':short(before),'oldSettled':short(stuck),'newInitial':short(initial),'newSettled':short(after)})
            old.close();p.close()

        p=setup(b);ready(p);start=require_compact(p)
        for width in [2000,1600,2300,1920]:
            # The fixture's containing block only; the viewport remains unchanged.
            # Values larger than viewport deliberately cause overflow, not clipped.
            p.evaluate('n=>WidthReadinessFixture.width(n)',width);p.wait_for_timeout(250)
            r=read(p);assert r['status']['pageFlow']['widthSizingReason']=='compact'
            assert abs(r['player']['width']-(width-448))<2, r
            assert r['resizeEvents']==0
        record('containing_block_changes_without_window_resize',short(require_compact(p)))
        p.wait_for_timeout(350);a=read(p);p.wait_for_timeout(700);c=read(p)
        assert a['status']['pageFlow']['sizingChecks']==c['status']['pageFlow']['sizingChecks'], (a,c)
        assert a['status']['reconciliationCount']==c['status']['reconciliationCount']
        assert c['status']['pageFlow']['observedSizingElements']<=12, c
        record('settled_page_has_no_polling', {'sizingChecks':c['status']['pageFlow']['sizingChecks'],'observedElements':c['status']['pageFlow']['observedSizingElements']})
        p.evaluate('''() => {const n=document.createElement('span');n.id='unrelated-status';n.style.position='fixed';document.body.append(n);}''')
        p.wait_for_timeout(150);a=read(p)
        for i in range(20):p.evaluate('i=>document.getElementById("unrelated-status").textContent=String(i)',i)
        p.wait_for_timeout(180);c=read(p)
        assert c['status']['reconciliationCount']==a['status']['reconciliationCount']
        assert c['status']['pageFlow']['sizingChecks']==a['status']['pageFlow']['sizingChecks']
        record('unrelated_mutations_do_not_reconcile', {'reconciliations':c['status']['reconciliationCount'],'sizingChecks':c['status']['pageFlow']['sizingChecks']})
        p.evaluate('''() => {const outer=document.createElement('div');outer.id='player-container-outer';const inner=document.createElement('div');inner.id='player-container-inner';const movie=document.getElementById('movie_player');movie.before(outer);outer.append(inner);inner.moveBefore(movie,null);}''')
        p.wait_for_timeout(300);r=require_compact(p)
        assert r['status']['pageFlow']['observedSizingElements']>=start['status']['pageFlow']['observedSizingElements']+2
        record('late_player_wrappers_are_observed',short(r))
        p.evaluate('''() => {const outer=document.getElementById('player-container-outer');outer.parentElement.moveBefore(document.getElementById('movie_player'),outer);outer.remove();}''');p.wait_for_timeout(250)
        r=require_compact(p);assert r['status']['pageFlow']['observedSizingElements']==start['status']['pageFlow']['observedSizingElements']
        record('detached_wrappers_are_unobserved',short(r));p.close()

        p=setup(b,'native-narrow');r=read(p)
        assert r['status']['pageFlow']['widthSizingReason']=='compact'
        observed=r['status']['pageFlow']['playerSizing'];assert observed['state']=='narrower-than-primary' and observed['playerWidth']==800 and observed['primaryContentWidth']==1472, observed
        assert p.evaluate('document.querySelector("#movie_player").getAttribute("style")') is None
        record('inner_constraint_is_reported_not_overridden',observed)
        diagnostic=read(p)['status']
        popup=b.new_page(viewport={'width':780,'height':600})
        popup.on('pageerror',lambda e:result['errors'].append(str(e)))
        html=(ROOT/'popup.html').read_text()
        html=re.sub(r'<script\s+src="[^"]+"[^>]*></script>','',html)
        html=html.replace('<link rel="stylesheet" href="popup.css">','<style>'+(ROOT/'popup.css').read_text()+'</style>')
        popup.set_content(html)
        for n in ['browser_harness','ambient_scroll_fixture']:popup.evaluate((ROOT/'.test_dist'/f'{n}.js').read_text())
        popup.evaluate('r=>AmbientScrollFixture.popupChrome(r)',diagnostic)
        popup.evaluate('version=>chrome.runtime.getManifest=()=>({version})', json.loads((ROOT/'manifest.json').read_text())['version'])
        for n in ['toolbox_shared','youtube_tools_popup','popup_navigation']:popup.evaluate((ROOT/'dist'/f'{n}.js').read_text())
        popup.click('#nav-youtube');popup.locator('#youtube-layout-diagnostics > summary').click()
        popup.locator('#youtube-tools-inspect').click();popup.wait_for_timeout(120)
        message=popup.locator('#youtube-tools-status').inner_text()
        assert '본문보다 작음' in message and '800px' in message and '1472px' in message,message
        popup.locator('#youtube-tools-copy-layout').click();popup.wait_for_timeout(120)
        copied=json.loads(popup.evaluate('copiedLayout'))
        assert copied['pageFlow']['playerSizing']==observed
        assert popup.evaluate('document.documentElement.scrollWidth<=innerWidth')
        popup.screenshot(path=str(OUT/'player_size_diagnostics.png'))
        record('actual_popup_reports_inner_size_mismatch',{'message':message,'copiedState':copied['pageFlow']['playerSizing']['state']})
        popup.close()
        ready(p);r=require_compact(p);record('native_player_size_change_observed',r['status']['pageFlow']['playerSizing'])
        p.evaluate('u=>{const v=LayoutRegressionFixture.mainVideo;v.src=u;v.playbackRate=3;}',VIDEO)
        deadline=time.monotonic()+6
        while not p.evaluate('LayoutRegressionFixture.mainVideo.readyState>=2'):
            assert time.monotonic()<deadline, 'Real WebM did not load'
            p.wait_for_timeout(50)
        p.evaluate('LayoutRegressionFixture.mainVideo.play()');p.wait_for_timeout(200)
        live=read(p);p.set_viewport_size({'width':1600,'height':1200});p.wait_for_timeout(200);r=require_compact(p)
        assert r['media']['time']>live['media']['time'] and r['media']['rate']==3 and r['media']['src']==live['media']['src'] and not r['media']['paused'], r
        record('real_media_keeps_playing_during_resize',{'before':live['media'],'after':r['media']})
        # Use real browser input; the fixture implements YouTube's native mode.
        p.locator('#btx-tab-playlist').click()
        for i in range(3):
            p.keyboard.press('t');p.wait_for_timeout(250)
            r=read(p);assert r['markers']>0 and r['status']['selected']=='playlist' and r['status']['displayMode']=='theater' and r['horizontalRange']==0,r
            p.keyboard.press('t');p.wait_for_timeout(250);require_compact(p)
        record('trusted_T_roundtrips_preserve_selected_tab',short(read(p)))
        p.evaluate('''() => {const b=document.createElement('button');b.id='request-fullscreen';b.textContent='Fullscreen';b.onclick=()=>document.getElementById('movie_player').requestFullscreen();document.getElementById('movie_player').append(b);}''')
        p.locator('#request-fullscreen').click();p.wait_for_timeout(250)
        assert p.evaluate('document.fullscreenElement?.id')=='movie_player'
        r=read(p);assert r['markers']>0 and r['status']['displayMode']=='fullscreen' and r['horizontalRange']==0,r
        p.evaluate('document.exitFullscreen()');p.wait_for_timeout(250);require_compact(p)
        record('real_Fullscreen_API_roundtrip',short(read(p)))
        p.evaluate('''() => {const secret=document.createElement('span');secret.textContent='PRIVATE_CAPTION_SENTINEL';secret.id='private-secret-id';document.getElementById('movie_player').append(secret);}''')
        snapshot=read(p)['status']['pageFlow'];encoded=json.dumps(snapshot)
        assert 'PRIVATE_CAPTION_SENTINEL' not in encoded and 'private-secret-id' not in encoded and 'data:video/' not in encoded
        record('diagnostics_have_no_content_or_source_URL',{'playerState':snapshot['playerSizing']['state'],'sourceRedacted':True})
        p.close()

        p=setup(b);p.evaluate('WidthReadinessFixture.ready(); __test.update({youtubeLayoutTabsEnabled:false})');p.wait_for_timeout(450)
        r=read(p);assert r['markers']==0 and r['hostCount']==0 and r['status']['pageFlow']['observedSizingElements']==0
        p.evaluate('WidthReadinessFixture.width(1600)');p.wait_for_timeout(220);assert read(p)['markers']==0
        record('disable_cancels_pending_sizing_and_observers',short(read(p)))
        p.evaluate('__test.update({youtubeLayoutTabsEnabled:true})');p.wait_for_timeout(350);require_compact(p)
        record('reenable_uses_current_native_layout',short(read(p)))
        # Synthetic lifecycle only; this is NOT a real BFCache restoration.
        p.evaluate('dispatchEvent(new PageTransitionEvent("pagehide",{persisted:true}))');p.wait_for_timeout(150)
        assert read(p)['hostCount']==0 and read(p)['markers']==0
        p.evaluate('dispatchEvent(new PageTransitionEvent("pageshow",{persisted:true}))');p.wait_for_timeout(350);require_compact(p)
        record('synthetic_persisted_lifecycle_cleanup',short(read(p)));p.close()
        b.close()
    result['passed']=not result['errors']
except Exception as e:
    result['failure']=str(e);result['traceback']=traceback.format_exc(); print(result['traceback'],flush=True)
finally:
    result['sourceHashes']={n:hashlib.sha256((ROOT/n).read_bytes()).hexdigest() for n in ['src/youtube_layout.ts','dist/youtube_layout.js','youtube_layout.css','src/youtube_tools_popup.ts','dist/youtube_tools_popup.js']}
    (OUT/'width_readiness_results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
    print('RESULT',result['passed'],len(result['tests']),'groups',flush=True)
    if not result['passed']:raise SystemExit(1)
