"""Intermittent layout regressions: actual Chromium DOM/observer/resize lifetime.
YouTube routing, page structure and Chrome APIs are controlled test doubles.
Only host/watch/videoKey address predicates are adapted in memory to about:blank.
No security policy is disabled, no production selectors are changed.
"""
import argparse, json, re, shutil, time, traceback
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'.test_results'; OUT.mkdir(exist_ok=True)
p=argparse.ArgumentParser(description=__doc__); p.add_argument('--chromium',default=shutil.which('chromium'));p.add_argument('--baseline-only',action='store_true');args=p.parse_args()
START=time.monotonic()
result={'passed':False,'environment':{'scope':'local Chromium components, not live YouTube/installed extension/Windows', 'addressAdaptation':'host/watch/videoKey only; route commits and native video-id reflected by explicit fixture', 'chromeAPIs':'browser_harness doubles','BFCache':'synthetic, not real back-forward-cache'},'tests':{},'errors':[]}
def emit(k,v):
 result['tests'][k]={'passed':True,'observed':v}; print(f'PASS {time.monotonic()-START:.1f}s {k}',flush=True)
def source(legacy=False):
 f=ROOT/('.test_lifecycle_baseline/tests/fixtures/legacy_layout_lifecycle.js' if legacy else 'dist/youtube_layout.js');s=f.read_text()
 for name,value in [('isYouTubePage','true'),('isWatchPage','globalThis.__lifecycleRoute.watch')]:
  s,n=re.subn(r'    function '+name+r'\(\) \{.*?(?:\n    \}| \})',f'    function {name}() {{ return {value}; }}',s,count=1,flags=re.S); assert n==1,name
 s,n=re.subn(r'const videoKey = \(\) => [^\n]+;', 'const videoKey = () => globalThis.__lifecycleRoute.key;',s,count=1);assert n==1
 return s
def setup(b,legacy=False,prepare=''):
 p=b.new_page(viewport={'width':1440,'height':900});p.set_default_timeout(5000)
 p.on('pageerror',lambda e:result['errors'].append(str(e)))
 p.set_content('''<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="require-trusted-types-for 'script'; trusted-types 'none';"></head><body></body></html>''')
 for f in ['layout_regression_fixture','layout_lifecycle_fixture','browser_harness']:
  p.evaluate((ROOT/'.test_dist'/f'{f}.js').read_text())
 p.evaluate('LayoutLifecycleFixture.build()')
 p.evaluate('Object.assign(__test.settings,{youtubeLayoutTabsEnabled:true,youtubePanelScrollEnabled:true,youtubeCommentStatusEnabled:true})')
 p.evaluate((ROOT/'dist/toolbox_shared.js').read_text())
 p.evaluate('css=>{let s=document.createElement("style");s.textContent=css;document.head.append(s)}',(ROOT/'youtube_layout.css').read_text())
 if prepare:p.evaluate(prepare)
 p.evaluate(source(legacy));p.wait_for_timeout(240)
 return p
def read(p): return p.evaluate('LayoutLifecycleFixture.read()')
def full(p):
 p.wait_for_function('()=>LayoutLifecycleFixture.read().status.layout==="applied"')
 r=read(p);assert r['hosts']==1 and r['sourceSame'] and r['infoSame'] and r['commentSame'],r
 return r
SCENARIOS={
 'ancestor_visibility':('LayoutLifecycleFixture.hideShell(true)','LayoutLifecycleFixture.hideShell(false)'),
 'css_only_sidebar':('LayoutLifecycleFixture.hideSidebar(true)','LayoutLifecycleFixture.lateSidebarStyles()'),
 'delayed_recommendation_href':('LayoutLifecycleFixture.resetRecommendations()','LayoutLifecycleFixture.readyLink()'),
 'missing_finish_new_document_parts':('', 'LayoutLifecycleFixture.start();LayoutLifecycleFixture.commit("lifecycle_next");LayoutLifecycleFixture.reflectKey()'),
 'popstate_then_late_watch':('', 'LayoutLifecycleFixture.start();LayoutLifecycleFixture.detachWatch();window.dispatchEvent(new PopStateEvent("popstate"));setTimeout(()=>LayoutLifecycleFixture.attachWatch(),160)'),
}
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox'])
  result['environment']['browser']=b.version
  for name,(prep,act) in SCENARIOS.items():
   p=setup(b,True,prep);before=read(p);p.evaluate(act);p.wait_for_timeout(600);after=read(p)
   assert after['status']['layout']!='applied',(name,after)
   emit('baseline_'+name,{'before':before,'after':after});p.close()
  # A short-lived second list currently blocks the entire watch lifetime.
  p=setup(b,True);full(p);p.evaluate('LayoutLifecycleFixture.addRival()');p.wait_for_timeout(200)
  p.evaluate('LayoutLifecycleFixture.rival.remove()');p.wait_for_timeout(250);r=read(p)
  assert r['status']['layout']=='unavailable',r
  emit('baseline_temporary_ambiguity_stays_blocked',r);p.close()
  p=setup(b,True);full(p);p.evaluate('LayoutLifecycleFixture.reclaim()');p.wait_for_timeout(200)
  p.evaluate('LayoutLifecycleFixture.commit("new_after_conflict");LayoutLifecycleFixture.reflectKey()');p.wait_for_timeout(250);r=read(p)
  assert r['status']['layout']=='unavailable',r
  emit('baseline_reused_watch_new_video_stays_blocked',r);p.close()
  if not args.baseline_only:
   for name,(prep,act) in SCENARIOS.items():
    p=setup(b,False,prep);p.evaluate(act);r=full(p);emit('fixed_'+name,r);p.close()
   p=setup(b);full(p);p.evaluate('LayoutLifecycleFixture.addRival()');p.wait_for_timeout(180)
   r=read(p);assert r['status']['layout']=='unavailable',r
   p.evaluate('LayoutLifecycleFixture.rival.remove()');r=full(p);emit('temporary_ambiguity_resumes_only_after_actual_resolution',r);p.close()
   p=setup(b);full(p);p.evaluate('LayoutLifecycleFixture.reclaim()');p.wait_for_timeout(180)
   full(p) # One verified startup placement is now recoverable; a repeated reclaim still blocks.
   p.evaluate('LayoutLifecycleFixture.reclaim()');p.wait_for_timeout(180)
   before=read(p);assert before['status']['layout']=='unavailable',before
   p.evaluate('LayoutLifecycleFixture.commit("new_after_conflict");LayoutLifecycleFixture.reflectKey()');r=full(p)
   emit('new_video_on_same_watch_is_new_context',{'before':before,'after':r});p.close()
  if not args.baseline_only:
   for event in ['navigateerror','navigatesuccess']:
    p=setup(b);full(p);p.evaluate('LayoutLifecycleFixture.start()');p.wait_for_timeout(80)
    assert read(p)['hosts']==0
    # Synthetic delivery to the real EventTarget, not a claim of an actual navigation.
    p.evaluate('kind=>navigation.dispatchEvent(new Event(kind))',event);r=full(p)
    emit('synthetic_standard_'+event+'_same_video_resumes_observation',r);p.close()
   # Early CSS visibility and source construction are actual DOM transitions.
   p=setup(b,False,'LayoutLifecycleFixture.hideShell(true)')
   p.evaluate('__test.update({youtubeLayoutTabsEnabled:false})');p.wait_for_timeout(100)
   p.evaluate('LayoutLifecycleFixture.hideShell(false)');p.wait_for_timeout(180)
   r=read(p);assert r['hosts']==0 and r['status']['layout']=='off' and r['status']['lifecycle']['readinessObservedElements']==0,r
   emit('disabled_while_waiting_never_mounts_later',r);p.close()

   p=setup(b);full(p);p.evaluate('LayoutLifecycleFixture.start();LayoutLifecycleFixture.commit("not_ready_yet")');p.wait_for_timeout(200)
   r=read(p);assert r['hosts']==0 and r['status']['lifecycle']['navigating'] and r['status']['lifecycle']['nativeVideoMatchesLocation'] is False,r
   p.evaluate('LayoutLifecycleFixture.reflectKey()');end=full(p)
   emit('committed_url_does_not_authorize_old_native_video',{'waiting':r,'ready':end});p.close()

   p=setup(b);full(p);p.evaluate('LayoutLifecycleFixture.start();LayoutLifecycleFixture.commit("abandoned");LayoutLifecycleFixture.start();LayoutLifecycleFixture.commit("final_video");LayoutLifecycleFixture.reflectKey()')
   r=full(p);assert r['hosts']==1;emit('superseded_navigation_uses_current_native_identity',r);p.close()

   p=setup(b);full(p);p.evaluate('LayoutLifecycleFixture.start();LayoutLifecycleFixture.commit("finished_early");LayoutLifecycleFixture.finish()');p.wait_for_timeout(150)
   assert read(p)['hosts']==0
   p.evaluate('LayoutLifecycleFixture.reflectKey()');r=full(p);emit('finish_before_new_DOM_waits_for_matching_native_identity',r);p.close()

   for what in ['watch','host']:
    p=setup(b);full(p);p.locator('#btx-tab-comments').click();p.wait_for_timeout(80)
    p.evaluate("document.querySelector('#btx-pane-comments').scrollTop=120");p.wait_for_timeout(80)
    p.evaluate('what=>{globalThis.__detached=what==="watch"?LayoutRegressionFixture.watch:document.getElementById("btx-youtube-tabs");globalThis.__parent=__detached.parentElement;__detached.remove()}',what)
    p.wait_for_timeout(180)
    assert read(p)['hosts']==0 and read(p)['status']['layout']!='applied'
    p.evaluate('__parent.append(__detached)');r=full(p)
    assert r['status']['selected']=='comments' and r['sourceSame'],r
    emit('temporary_'+what+'_detachment_retains_exact_original_nodes',r);p.close()

   p=setup(b);full(p);p.evaluate('LayoutLifecycleFixture.reclaim()');p.wait_for_timeout(180)
   full(p) # One verified startup placement is now recoverable; a repeated reclaim still blocks.
   p.evaluate('LayoutLifecycleFixture.reclaim()');p.wait_for_timeout(180)
   before=read(p);assert before['status']['layout']=='unavailable'
   for _ in range(5):p.evaluate('document.querySelector("#fixture-unrelated").textContent+=" ."');p.wait_for_timeout(40)
   after=read(p);assert after['hosts']==0 and after['nativeAtOrigin'],after
   emit('same_context_relocation_does_not_fight_site',{'before':before,'after':after});p.close()

   p=setup(b);full(p);p.evaluate('LayoutLifecycleFixture.addRival()');p.wait_for_timeout(200)
   before=read(p);p.wait_for_timeout(400);after=read(p)
   assert before['status']['reconciliationCount']==after['status']['reconciliationCount'] and after['hosts']==0,(before,after)
   emit('persistent_ambiguity_is_not_retried_on_a_timer',after);p.close()

   p=setup(b);full(p);p.wait_for_timeout(200);before=read(p)['status']['reconciliationCount'];p.wait_for_timeout(400);after=read(p)['status']['reconciliationCount']
   assert before==after and read(p)['status']['lifecycle']['readinessObservedElements']==0,(before,after)
   emit('applied_layout_releases_discovery_resize_observer_and_idles',{'before':before,'after':after});p.close()

   p=setup(b);full(p)
   for _ in range(3):
    p.evaluate('window.dispatchEvent(new PageTransitionEvent("pagehide",{persisted:true}))');p.wait_for_timeout(80)
    assert read(p)['hosts']==0
    p.evaluate('window.dispatchEvent(new PageTransitionEvent("pageshow",{persisted:true}))');full(p)
   emit('synthetic_BFCache_round_trips_rearm_discovery',read(p));p.close()

   p=setup(b);full(p);p.evaluate('LayoutLifecycleFixture.start();LayoutLifecycleFixture.commit("off_during_navigation");__test.update({youtubeLayoutTabsEnabled:false});LayoutLifecycleFixture.reflectKey()');p.wait_for_timeout(200)
   r=read(p);assert r['hosts']==0 and r['status']['layout']=='off',r
   emit('disable_during_navigation_does_not_restart_layout',r);p.close()

   p=setup(b);r=full(p);p.locator('#btx-tab-videos').click();p.wait_for_timeout(100)
   p.locator('#btx-youtube-tabs').screenshot(path=str(OUT/'layout_lifecycle_after.png'))
   p.evaluate('__test.update({youtubeLayoutTabsEnabled:false})');p.wait_for_timeout(150)
   r=read(p);assert r['hosts']==0 and r['nativeAtOrigin'] and p.locator('[data-btx-layout-owned]').count()==0,r
   emit('explicit_disable_restores_native_nodes_and_markers',r);p.close()
  if not args.baseline_only:
   p=setup(b);full(p);p.evaluate('LayoutLifecycleFixture.start()');p.wait_for_timeout(100)
   diagnostic=read(p)['status'];popup=b.new_page(viewport={'width':780,'height':600})
   popup.on('pageerror',lambda e:result['errors'].append(str(e)))
   html=(ROOT/'popup.html').read_text();html=re.sub(r'<script\s+src="[^"]+"[^>]*></script>','',html)
   html=html.replace('<link rel="stylesheet" href="popup.css">','<style>'+(ROOT/'popup.css').read_text()+'</style>')
   popup.set_content(html)
   for n in ['browser_harness','ambient_scroll_fixture']:popup.evaluate((ROOT/'.test_dist'/f'{n}.js').read_text())
   popup.evaluate('r=>AmbientScrollFixture.popupChrome(r)',diagnostic)
   popup.evaluate('version=>chrome.runtime.getManifest=()=>({version})',json.loads((ROOT/'manifest.json').read_text())['version'])
   for n in ['toolbox_shared','youtube_tools_popup','popup_navigation']:popup.evaluate((ROOT/'dist'/f'{n}.js').read_text())
   popup.click('#nav-youtube');popup.locator('#youtube-layout-diagnostics > summary').click()
   popup.locator('#youtube-tools-inspect').click();popup.wait_for_timeout(100)
   message=popup.locator('#youtube-tools-status').inner_text();assert '다음 영상의 실제 구조 대기' in message,message
   popup.locator('#youtube-tools-copy-layout').click();popup.wait_for_timeout(100)
   copied=popup.evaluate('copiedLayout');payload=json.loads(copied)
   assert payload['lifecycle']==diagnostic['lifecycle'],payload
   assert 'lifecycle_first' not in copied and 'https://' not in copied,copied
   assert popup.evaluate('document.documentElement.scrollWidth<=innerWidth')
   popup.screenshot(path=str(OUT/'layout_lifecycle_diagnostics.png'))
   emit('popup_copies_actual_lifetime_without_video_identifiers',{'message':message,'lifecycle':payload['lifecycle']});popup.close();p.close()
  b.close()
 if result['errors']:raise AssertionError(result['errors'])
 result['passed']=True
except Exception:
 result['failure']=traceback.format_exc();print(result['failure'],flush=True)
finally:
 result['durationSeconds']=round(time.monotonic()-START,2)
 (OUT/('layout_lifecycle_baseline.json' if args.baseline_only else 'layout_lifecycle_results.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
if not result['passed']:raise SystemExit(1)
