"""Theater-mode regression: real Chromium DOM/media/input, explicit Chrome API doubles.
The native mode handler is a fixture, NOT YouTube's production player.
Only host/watch predicates in in-memory copies are adapted to about:blank.
"""
import argparse, base64, json, re, time, traceback
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.test_results'; OUT.mkdir(exist_ok=True)
ap=argparse.ArgumentParser(description=__doc__); ap.add_argument('--chromium',default='/usr/bin/chromium'); args=ap.parse_args()
START=time.monotonic()
result={'passed':False,'environment':{'scope':'local Chromium component tests; actual DOM/CSS/media/keyboard/mouse; mocked Chrome APIs',
 'nativeHandler':'test-only T and size button handlers set theater/full-bleed attributes and move actual nodes',
 'adaptation':'only isYouTubePage/isWatchPage predicates in memory',
 'targetYouTube':'not tested','WindowsRTX':'not tested'},'tests':{},'errors':[]}
SETTINGS={'youtubeLayoutTabsEnabled':True,'youtubePanelScrollEnabled':True,'youtubeCommentStatusEnabled':True,'youtubeNativePanelsEnabled':True}
def record(name,obs):
 result['tests'][name]={'passed':True,'observed':obs};print(f'PASS {time.monotonic()-START:.1f}s {name}',flush=True)
def source(legacy=False):
 path=ROOT/('.test_theater_baseline/tests/fixtures/legacy_theater_layout.js' if legacy else 'dist/youtube_layout.js')
 s=path.read_text()
 for name in ['isYouTubePage','isWatchPage']:
  s,n=re.subn(r'    function '+name+r'\(\) \{.*?(?:\n    \}| \})',f'    function {name}() {{ return true; }}',s,count=1,flags=re.S);assert n==1,name
 return s
def setup(browser,opts=None,legacy=False):
 p=browser.new_page(viewport={'width':1440,'height':900});p.set_default_timeout(7000)
 p.on('pageerror',lambda e:result['errors'].append(str(e)))
 p.set_content('''<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="require-trusted-types-for 'script'; trusted-types 'none';"></head><body></body></html>''')
 for n in ['layout_regression_fixture','scroll_regression_fixture','playlist_fixture','theater_fixture','browser_harness']:
  p.evaluate((ROOT/'.test_dist'/f'{n}.js').read_text())
 p.evaluate('o=>TheaterFixture.build(o)',opts or {})
 p.evaluate('s=>Object.assign(__test.settings,s)',SETTINGS)
 p.evaluate((ROOT/'dist/toolbox_shared.js').read_text())
 css=(ROOT/('tests/fixtures/legacy_theater_layout.css' if legacy else 'youtube_layout.css')).read_text()
 p.evaluate('css=>{const s=document.createElement("style");s.textContent=css;document.head.append(s)}',css)
 return p
def apply(p,legacy=False):p.evaluate(source(legacy));p.wait_for_timeout(250)
def read(p):return p.evaluate('TheaterFixture.read()')
def toggle(p,button=False):
 if button:p.locator('.fixture-size-button').click()
 else:p.keyboard.press('t')
 p.wait_for_timeout(320)
def select(p,name):p.locator('#btx-tab-'+name).click();p.wait_for_timeout(90)
def attached(p,selected=None):
 r=read(p)
 assert r['hosts']==1 and not r['orphan'] and r['status']['layout']=='applied',r
 assert all(s['sameNode'] and s['connected'] for s in r['sections'].values()),r
 assert r['hostParent']=='secondary-inner' and not r['status']['issue'],r
 if selected:assert r['selected']==['btx-tab-'+selected],r
 return r
def off(p):p.evaluate('__test.update({youtubeLayoutTabsEnabled:false})');p.wait_for_timeout(200)
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox'])
  result['environment']['browser']=b.version
  p=setup(b,{'reclaim':['videos']},True);apply(p,True);attached(p)
  toggle(p);entered=read(p);assert entered['status']['layout']=='unavailable',entered
  toggle(p);exited=read(p);assert exited['status']['layout']=='unavailable' and exited['hosts']==0,exited
  record('baseline_native_reparent_stops_layout_and_exit_does_not_resume',{'entered':entered,'exited':exited});p.close()

  p=setup(b,legacy=True);apply(p,True);toggle(p);toggle(p);attached(p)
  record('baseline_attribute_only_test_would_miss_this_failure',read(p));p.close()

  for playlist in [True,False]:
   p=setup(b,{'playlist':playlist,'reclaim':['info','comments','playlist','videos']});apply(p);attached(p)
   chosen='playlist' if playlist else 'comments';select(p,chosen)
   observations=[]
   for _ in range(4):
    toggle(p);r=attached(p,chosen);assert r['theater'] and r['playerParent']=='full-bleed-container';observations.append(r['status']['modeReattachments'])
    toggle(p);r=attached(p,chosen);assert not r['theater'];observations.append(r['status']['modeReattachments'])
   assert all(e['trusted'] for e in r['events'])
   off(p);restored=read(p);assert restored['hosts']==0 and all(s['atOrigin'] and s['owned'] is None for s in restored['sections'].values()),restored
   record('repeat_real_T_round_trips_'+str(playlist),{'repairs':observations,'restored':restored});p.close()

  for opts in [{'reclaim':['videos'],'delayed':True},{'reclaim':['playlist'],'replaceSidebar':True}]:
   p=setup(b,opts);apply(p);select(p,'videos')
   toggle(p,True);entered=attached(p,'videos');toggle(p,True);exited=attached(p,'videos')
   assert len(exited['events'])==2 and all(e['via']=='button' and e['trusted'] for e in exited['events'])
   record('button_round_trip_'+('delayed' if opts.get('delayed') else 'new_sidebar'),{'entered':entered,'exited':exited});p.close()

  p=setup(b,{'reclaim':['videos']});p.evaluate('TheaterFixture.change(true)');apply(p);attached(p)
  toggle(p);attached(p);record('loaded_in_theater_then_exit',read(p));p.close()

  p=setup(b,{'reclaim':['videos']});apply(p);select(p,'comments')
  p.evaluate('TheaterFixture.hideWatch(true)');toggle(p);hidden=read(p);assert hidden['hosts']==1
  p.evaluate('TheaterFixture.hideWatch(false)');p.wait_for_timeout(200);attached(p,'comments')
  toggle(p);attached(p,'comments');record('temporary_hidden_watch_is_not_torn_down',read(p));p.close()

  p=setup(b,{'reclaim':['videos']});apply(p);p.evaluate('TheaterFixture.hideSource("videos",true)');toggle(p)
  r=read(p);assert r['hosts']==1 and r['status']['sections']['videos']['state']=='waiting',r
  p.evaluate('TheaterFixture.hideSource("videos",false)');p.wait_for_timeout(200);attached(p)
  record('temporarily_hidden_native_section_waits_then_reconnects',read(p));p.close()

  p=setup(b);apply(p);select(p,'playlist');p.evaluate('TheaterFixture.reclaim("videos")');p.wait_for_timeout(200)
  attached(p,'playlist');p.evaluate('TheaterFixture.reclaim("videos")');p.wait_for_timeout(200)
  r=read(p);assert r['status']['layout']=='unavailable',r
  start=r['status']['reconciliationCount'];p.wait_for_timeout(400);assert read(p)['status']['reconciliationCount']==start
  toggle(p);attached(p,'playlist');record('unrelated_conflict_stops_but_real_mode_boundary_resumes',read(p));p.close()

  p=setup(b,{'reclaim':['videos']});apply(p);select(p,'comments');toggle(p);attached(p,'comments')
  p.evaluate('TheaterFixture.reclaim("videos")');p.wait_for_timeout(200)
  r=read(p);assert r['status']['layout']=='unavailable',r
  p.wait_for_timeout(250);assert read(p)['hosts']==0
  toggle(p);attached(p,'comments');record('repeated_same_mode_reparent_does_not_fight_site',read(p));p.close()

  p=setup(b);apply(p);toggle(p)
  p.evaluate('TheaterFixture.moveToNewOrigin("videos")');p.wait_for_timeout(200);attached(p)
  off(p);r=read(p);assert all(s['atOrigin'] for s in r['sections'].values()),r
  record('restore_uses_new_observed_native_position_not_stale_marker',r);p.close()

  p=setup(b,{'reclaim':['info','comments','playlist','videos']});apply(p);select(p,'playlist')
  box=p.locator('#btx-pane-playlist #items').bounding_box();p.mouse.move(box['x']+50,box['y']+80);p.mouse.wheel(0,600);p.wait_for_timeout(160)
  before=p.evaluate('PlaylistFixture.items.scrollTop');assert before>300
  toggle(p);after_in=p.evaluate('PlaylistFixture.items.scrollTop');toggle(p);after_out=p.evaluate('PlaylistFixture.items.scrollTop')
  assert abs(before-after_in)<2 and abs(before-after_out)<2,(before,after_in,after_out)
  select(p,'comments');box=p.locator('#btx-pane-comments').bounding_box();p.mouse.move(box['x']+60,box['y']+80);p.mouse.wheel(0,450);p.wait_for_timeout(160)
  cbefore=p.locator('#btx-pane-comments').evaluate('(n)=>n.scrollTop');assert cbefore>100
  toggle(p);toggle(p);cafter=p.locator('#btx-pane-comments').evaluate('(n)=>n.scrollTop');assert abs(cbefore-cafter)<2,(cbefore,cafter)
  record('playlist_native_and_comment_pane_offsets_preserved',{'playlist':[before,after_in,after_out],'comments':[cbefore,cafter]});p.close()

  p=setup(b,{'reclaim':['info','comments','playlist','videos']});apply(p)
  # The input and iframe carry real browser state; no production values forged.
  p.evaluate('PlaylistFixture.addFrame()')
  p.wait_for_timeout(180);loads=p.evaluate('PlaylistFixture.frameLoads')
  p.evaluate('PlaylistFixture.frame.contentWindow.testToken="still-present"')
  p.evaluate('document.querySelector("#fixture-input").value="unsent comment"')
  toggle(p);toggle(p);attached(p)
  assert p.evaluate('PlaylistFixture.frameLoads')==loads
  assert p.evaluate('PlaylistFixture.frame.contentWindow.testToken')=='still-present'
  assert read(p)['inputValue']=='unsent comment'
  p.screenshot(path=str(OUT/'theater_restored_normal.png'))
  toggle(p);p.screenshot(path=str(OUT/'theater_panel.png'))
  record('same_native_iframe_and_edit_state_preserved',{'loads':loads,'read':read(p)});p.close()

  p=setup(b,{'reclaim':['videos','playlist']});apply(p)
  video='data:video/webm;base64,'+base64.b64encode((ROOT/'tests/fixtures/test.webm').read_bytes()).decode()
  p.evaluate('s=>{const v=LayoutRegressionFixture.mainVideo;v.src=s;v.load();}',video)
  p.wait_for_function('()=>LayoutRegressionFixture.mainVideo.readyState>=2')
  p.evaluate('()=>{const v=LayoutRegressionFixture.mainVideo;const t=v.addTextTrack("subtitles","Test","ko");t.addCue(new VTTCue(0,10,"caption"));t.mode="hidden";v.playbackRate=3;return v.play();}')
  before=read(p)['video'];toggle(p);toggle(p);r=attached(p)
  assert r['video']['sameNode'] and r['video']['rate']==3 and not r['video']['paused'] and r['video']['time']>before['time'],(before,r)
  assert p.evaluate('LayoutRegressionFixture.mainVideo.textTracks[0].activeCues[0].text')=='caption'
  record('real_media_and_native_cues_continue_through_mode_moves',{'before':before,'after':r['video']});p.close()

  p=setup(b,{'reclaim':['videos','playlist']});apply(p);select(p,'playlist')
  p.evaluate('()=>{TheaterFixture.change(true);TheaterFixture.change(false)}');p.wait_for_timeout(200);attached(p,'playlist')
  record('rapid_round_trip_before_reconcile_uses_actual_mutation_history',read(p));p.close()

  p=setup(b,{'reclaim':['videos']});apply(p);toggle(p);attached(p)
  p.evaluate('()=>{LayoutRegressionFixture.watch.setAttribute("theater","");TheaterFixture.reclaim("videos")}');p.wait_for_timeout(220)
  r=read(p);assert r['status']['layout']=='unavailable',r
  record('redundant_mode_attribute_does_not_grant_endless_moves',r);p.close()

  p=setup(b,{'replaceSidebar':True});apply(p);select(p,'playlist')
  p.evaluate('()=>{TheaterFixture.change(true);__test.update({youtubeLayoutTabsEnabled:false})}');p.wait_for_timeout(250)
  r=read(p);assert r['hosts']==0 and not r['orphan'] and all(v['atOrigin'] for v in r['sections'].values()),r
  record('disable_during_native_sidebar_move_follows_real_restore_anchors',r);p.close()

  p=setup(b);apply(p);p.evaluate('()=>{TheaterFixture.hideWatch(true);__test.update({youtubeLayoutTabsEnabled:false})}');p.wait_for_timeout(200)
  r=read(p);assert r['hosts']==0 and r['status']['layout']=='off',r
  p.evaluate('TheaterFixture.hideWatch(false)');p.wait_for_timeout(120);assert read(p)['hosts']==0
  record('disable_while_watch_temporarily_hidden_stays_disabled',r);p.close()

  p=setup(b,{'reclaim':['info','comments','playlist','videos']});apply(p);select(p,'videos')
  before=p.evaluate('ScrollRegressionFixture.read()')
  toggle(p);toggle(p);after=p.evaluate('ScrollRegressionFixture.read()');attached(p,'videos')
  assert before['player']==after['player'] and after['scrollRange']==before['scrollRange']==0,(before,after)
  record('return_restores_actual_player_dimensions_and_content_sized_scroll',{'before':before,'after':after});p.close()

  p=setup(b,{'reclaim':['videos']});apply(p);select(p,'playlist');toggle(p);toggle(p)
  before=read(p)['status']['reconciliationCount'];p.wait_for_timeout(500);after=read(p)['status']['reconciliationCount'];assert after==before,(before,after)
  record('stable_mode_has_no_idle_reconciliation_loop',{'before':before,'after':after});p.close()
  b.close()
 if result['errors']:raise AssertionError(result['errors'])
 result['passed']=True
except Exception:
 result['failure']=traceback.format_exc();print(result['failure'],flush=True)
finally:
 result['durationSeconds']=round(time.monotonic()-START,3)
 (OUT/'theater_results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
if not result['passed']:raise SystemExit(1)
