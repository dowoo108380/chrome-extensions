"""Local Chromium component tests, real DOM/input; Chrome APIs are mocked.
No real YouTube playlist/server requests, VSR, Windows, or BFCache navigation.
"""
import argparse, hashlib, json, re, sys, zipfile
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.test_results'; OUT.mkdir(exist_ok=True)
ap=argparse.ArgumentParser(); ap.add_argument('--chromium',default='/usr/bin/chromium'); ap.add_argument('--baseline-archive'); args=ap.parse_args()
result={'environment':{'scope':'local Chromium component tests; actual DOM/CSS/mouse/keyboard; Chrome APIs mocked; fixture-owned native playlist handlers', 'productionCode':'compiled output, only host/watch predicates replaced in memory', 'targetYouTube':'not tested','WindowsRTX':'not tested'},'tests':[],'errors':[],'passed':False}
SETTINGS={'youtubeLayoutTabsEnabled':True,'youtubeCommentStatusEnabled':True,'youtubePanelScrollEnabled':True,'youtubeNativePanelsEnabled':True}
def record(name,obs):result['tests'].append({'name':name,'passed':True,'observed':obs})
def layout_source(archive=None):
 if archive:
  with zipfile.ZipFile(archive) as z:code=z.read('browser_toolbox_extension/dist/youtube_layout.js').decode()
 else:code=(ROOT/'dist/youtube_layout.js').read_text()
 for name in ['isYouTubePage','isWatchPage']:
  code,n=re.subn(r'    function '+name+r'\(\) \{.*?(?:\n    \}| \})',f'    function {name}() {{ return true; }}',code,count=1,flags=re.S)
  assert n==1,name
 return code
def setup(browser,opts=None,width=1440,baseline=False):
 p=browser.new_page(viewport={'width':width,'height':900});p.set_default_timeout(7000)
 p.on('pageerror',lambda e:result['errors'].append(str(e)))
 p.set_content('''<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="require-trusted-types-for 'script'; trusted-types 'none';"></head><body></body></html>''')
 for n in ['layout_regression_fixture','scroll_regression_fixture','playlist_fixture','browser_harness']:p.evaluate((ROOT/'.test_dist'/f'{n}.js').read_text())
 p.evaluate('o=>PlaylistFixture.build(o)',opts or {})
 p.evaluate('s=>Object.assign(__test.settings,s)',SETTINGS)
 p.evaluate((ROOT/'dist/toolbox_shared.js').read_text())
 if baseline:
  with zipfile.ZipFile(args.baseline_archive) as z:css=z.read('browser_toolbox_extension/youtube_layout.css').decode()
 else:css=(ROOT/'youtube_layout.css').read_text()
 p.evaluate('css=>{const s=document.createElement("style");s.textContent=css;document.head.append(s)}',css)
 return p
def apply(p,baseline=False):p.evaluate(layout_source(args.baseline_archive if baseline else None));p.wait_for_timeout(300)
def read(p):return p.evaluate('PlaylistFixture.read()')
def update(p,s):p.evaluate('s=>__test.update(s)',s);p.wait_for_timeout(220)
def select(p,n='playlist'):p.locator('#btx-tab-'+n).click();p.wait_for_timeout(140)
def attached(p):
 r=read(p);assert r['identity'] and r['parent']=='btx-pane-playlist' and r['outsideVisibleItems']==0,r
 assert r['tabOrder']==['btx-tab-info','btx-tab-comments','btx-tab-playlist','btx-tab-videos'],r
 assert r['status']['layout']=='applied' and not r['status']['yieldingToNativePanel'],r
 return r
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox'])
  result['environment']['browser']=browser.version
  if args.baseline_archive:
   p=setup(browser,baseline=True);apply(p,True);r=read(p)
   assert r['parent']=='secondary-inner' and r['count']==0 and r['outsideItems']==36,r
   record('previous_release_keeps_playlist_outside',r);p.close()
  p=setup(browser,{'attach':False});apply(p)
  r=read(p);assert r['tabOrder']==['btx-tab-info','btx-tab-comments','btx-tab-videos'] and r['status']['layout']=='applied',r
  p.locator('#btx-tab-comments').focus();p.keyboard.press('ArrowRight');assert read(p)['status']['selected']=='videos'
  record('optional_tab_absent_and_keyboard_skips_it',r);p.close()

  p=setup(browser);apply(p);r=attached(p);assert r['events']==[] and r['linksPreserved'],r
  select(p);r=attached(p);assert r['selected']=='true' and r['list']['height']>0 and r['documentRange']==0,r
  assert r['pane']['scrollHeight']<=r['pane']['clientHeight']+1,r
  assert r['header']['bottom']<=r['list']['top']+1,r
  p.screenshot(path=str(OUT/'playlist_tab_dark.png'))
  record('native_playlist_inside_ordered_tab_no_outer_blank_scroll',r)
  p.locator('#fixture-playlist-shuffle').click();p.locator('#fixture-playlist-repeat').click()
  assert p.locator('#fixture-playlist-repeat').get_attribute('aria-pressed')=='true'
  assert p.locator('#fixture-playlist-shuffle').get_attribute('aria-pressed')=='true'
  p.locator('.fixture-playlist-link').nth(2).click()
  r=read(p);assert [e['kind'] for e in r['events']]==['shuffle','repeat','link'],r
  assert all(e['trusted'] for e in r['events']) and not r['events'][-1]['prevented'],r
  assert 'index=3' in r['events'][-1]['href'];record('original_controls_and_links_receive_real_input',r)
  box=p.locator('#btx-pane-playlist #items').bounding_box();p.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);p.mouse.wheel(0,650);p.wait_for_timeout(180)
  scrolled=read(p);assert scrolled['list']['scroll']>300 and p.evaluate('scrollY')==0,scrolled
  select(p,'comments');select(p);assert abs(read(p)['list']['scroll']-scrolled['list']['scroll'])<2,(read(p),scrolled)
  p.locator('.fixture-playlist-link').last.click();r=read(p);assert r['events'][-1]['href'].endswith('index=36'),r
  assert p.evaluate('scrollY')==0;record('internal_wheel_scroll_position_and_last_native_link',r)
  p.locator('#btx-tab-comments').focus();p.keyboard.press('ArrowRight');assert read(p)['status']['selected']=='playlist'
  p.keyboard.press('ArrowRight');assert read(p)['status']['selected']=='videos'
  p.keyboard.press('Home');assert read(p)['status']['selected']=='info'
  p.keyboard.press('End');assert read(p)['status']['selected']=='videos'
  record('keyboard_order_includes_playlist',read(p))
  select(p);p.locator('#fixture-playlist-collapse').click();r=read(p);assert r['collapsed'] and r['identity'],r
  p.locator('#fixture-playlist-collapse').click();r=attached(p);assert not r['collapsed'],r
  record('native_collapse_is_not_overwritten',r)
  p.evaluate('LayoutRegressionFixture.mainVideo.playbackRate=2.25')
  for _ in range(2):
   update(p,{'youtubeLayoutTabsEnabled':False});r=read(p);assert r['originalPosition'] and not r['identity'],r
   assert p.locator('#playlist').get_attribute('data-btx-layout-owned') is None
   update(p,{'youtubeLayoutTabsEnabled':True});attached(p)
  assert read(p)['mainRate']==2.25
  record('toggle_restores_same_node_controls_and_exact_original_position',read(p));p.close()

  p=setup(browser,{'empty':True});apply(p);r=read(p);assert 'btx-tab-playlist' not in r['tabOrder'] and r['parent']=='secondary-inner',r
  p.evaluate('PlaylistFixture.fill()');p.wait_for_timeout(230);attached(p)
  record('delayed_actual_items_enable_tab',read(p));p.close()
  p=setup(browser,{'hidden':True});apply(p);assert 'btx-tab-playlist' not in read(p)['tabOrder']
  p.evaluate('PlaylistFixture.panel.hidden=false');p.wait_for_timeout(230);attached(p);select(p)
  p.locator('#fixture-playlist-close').click();p.wait_for_timeout(180);r=read(p);assert 'btx-tab-playlist' not in r['tabOrder'] and r['status']['selected']=='info',r
  p.evaluate('PlaylistFixture.panel.hidden=false');p.wait_for_timeout(230);attached(p)
  record('native_hide_close_and_show_without_forced_reopening',read(p));p.close()
  p=setup(browser,{'collapsed':True});apply(p);r=attached(p);assert r['collapsed'] and r['events']==[],r
  select(p);p.locator('#fixture-playlist-collapse').click();assert not read(p)['collapsed']
  record('initial_collapsed_state_preserved',read(p));p.close()

  for hidden in [True,False]:
   p=setup(browser)
   p.evaluate('h=>{const n=PlaylistFixture.panel.cloneNode(true);n.hidden=h;document.querySelector("#primary").append(n)}',hidden)
   apply(p);r=read(p)
   if hidden:attached(p)
   else:
    assert 'btx-tab-playlist' not in r['tabOrder'] and r['parent']=='secondary-inner',r
    assert r['status']['sections']['playlist']['state']=='ambiguous' and r['status']['layout']=='partial',r
   record('duplicate_playlist_'+('hidden' if hidden else 'ambiguous_visible'),r);p.close()
  p=setup(browser);apply(p);attached(p)
  p.evaluate('PlaylistFixture.panel.remove()');p.wait_for_timeout(180);r=read(p);assert 'btx-tab-playlist' not in r['tabOrder'] and r['status']['layout']=='applied',r
  p.evaluate('PlaylistFixture.attach()');p.wait_for_timeout(230);attached(p)
  record('removed_playlist_not_resurrected_and_replacement_mounted',read(p));p.close()
  p=setup(browser);apply(p);attached(p)
  p.evaluate('PlaylistFixture.items.replaceChildren();PlaylistFixture.attach()');p.wait_for_timeout(230);attached(p)
  assert p.locator('#btx-youtube-tabs [data-btx-layout-owned="playlist"]').count()==1
  record('empty_old_playlist_can_be_replaced',read(p));p.close()

  p=setup(browser);p.evaluate('PlaylistFixture.addFrame()');p.wait_for_function('PlaylistFixture.frameLoads===1')
  p.evaluate('window.savedPlaylistFrame=PlaylistFixture.frame.contentWindow;PlaylistFixture.frame.contentWindow.preserved=17')
  apply(p);attached(p);select(p)
  assert p.evaluate('savedPlaylistFrame===PlaylistFixture.frame.contentWindow&&savedPlaylistFrame.preserved===17')
  update(p,{'youtubeLayoutTabsEnabled':False});assert p.evaluate('PlaylistFixture.frameLoads===1 && savedPlaylistFrame===PlaylistFixture.frame.contentWindow')
  record('iframe_state_survives_move_and_restore',read(p));p.close()

  p=setup(browser);apply(p);attached(p)
  for e in ['navigation','cache']:
   if e=='navigation':
    p.evaluate('document.dispatchEvent(new Event("yt-navigate-start"))');assert read(p)['originalPosition']
    p.evaluate('document.dispatchEvent(new Event("yt-navigate-finish"))')
   else:
    p.evaluate('window.dispatchEvent(new PageTransitionEvent("pagehide",{persisted:true}))');assert read(p)['originalPosition']
    p.evaluate('window.dispatchEvent(new PageTransitionEvent("pageshow",{persisted:true}))')
   p.wait_for_timeout(240);attached(p)
  select(p);start=read(p)['status']['reconciliationCount'];p.wait_for_timeout(450);assert start==read(p)['status']['reconciliationCount']
  record('synthetic_lifecycle_and_no_idle_reconciliation_loop',read(p));p.close()

  for width in [1100,780,520]:
   p=setup(browser,width=width);apply(p);attached(p);select(p);r=read(p)
   assert r['documentWidth']<=width,r
   assert all(p.locator('#'+n).bounding_box()['width']>25 for n in r['tabOrder'])
   if width==520:p.screenshot(path=str(OUT/'playlist_tab_narrow.png'))
   record('responsive_width_'+str(width),r);p.close()
  p=setup(browser);apply(p);select(p);p.evaluate('document.documentElement.removeAttribute("dark")');p.wait_for_timeout(100)
  p.screenshot(path=str(OUT/'playlist_tab_light.png'));record('light_theme_layout',read(p));p.close()

  p=setup(browser,{'rawList':True});apply(p);select(p);r=attached(p)
  assert r['pane']['height']<850,r
  record('alternate_native_tree_keeps_pane_bounds',r);p.close()
  p=setup(browser);apply(p);select(p);update(p,{'youtubePanelScrollEnabled':False});r=attached(p)
  assert r['list']['overflow']=='auto',r
  update(p,{'youtubeLayoutTabsEnabled':False});r=read(p);assert r['originalPosition'],r
  record('disabled_internal_scroll_keeps_native_playlist_scroller',r);p.close()
  # Verify an opened, unmanaged chat still receives the existing space-yield policy.
  p=setup(browser);apply(p);select(p)
  p.evaluate('''() => {const chat=document.createElement('ytd-live-chat-frame');chat.id='chat';chat.textContent='시험용 채팅';chat.style.display='block';document.querySelector('#secondary-inner').append(chat);}''')
  p.wait_for_timeout(220);assert read(p)['status']['yieldingToNativePanel']
  select(p);assert not read(p)['status']['yieldingToNativePanel'];record('chat_yield_is_separate_from_managed_playlist',read(p));p.close()
  p=setup(browser,{'empty':True});apply(p)
  p.evaluate("() => {const a=document.createElement('a');a.id='late-playlist-link';a.textContent='늦게 준비한 실제 링크';PlaylistFixture.items.append(a)}")
  p.wait_for_timeout(100);assert 'btx-tab-playlist' not in read(p)['tabOrder']
  p.evaluate("document.getElementById('late-playlist-link').setAttribute('href','https://www.youtube.com/watch?v=late_item&list=fixture')")
  p.wait_for_timeout(200);attached(p);record('late_href_hydration_without_node_insertion',read(p));p.close()
  p=setup(browser);p.evaluate("PlaylistFixture.panel.append(document.createElement('ytd-player'))");apply(p)
  r=read(p);assert r['parent']=='secondary-inner' and r['status']['sections']['playlist']['state']=='protected',r
  assert 'btx-tab-playlist' not in r['tabOrder'];record('main_player_container_is_never_moved',r);p.close()

  p=setup(browser);apply(p);raw=attached(p)['status'];p.close()
  p=browser.new_page(viewport={'width':780,'height':600});p.on('pageerror',lambda e:result['errors'].append(str(e)))
  html=(ROOT/'popup.html').read_text();html=re.sub(r'<script\s+src="[^"]+"[^>]*></script>','',html)
  html=html.replace('<link rel="stylesheet" href="popup.css">','<style>'+(ROOT/'popup.css').read_text()+'</style>')
  p.set_content(html)
  for n in ['browser_harness','ambient_scroll_fixture']:p.evaluate((ROOT/'.test_dist'/f'{n}.js').read_text())
  p.evaluate('r=>AmbientScrollFixture.popupChrome(r)',raw)
  p.evaluate('chrome.runtime.getManifest=()=>({version:"1.58.0"})')
  p.evaluate((ROOT/'dist/toolbox_shared.js').read_text());p.evaluate((ROOT/'dist/youtube_tools_popup.js').read_text());p.wait_for_timeout(100)
  p.evaluate((ROOT/'dist/popup_navigation.js').read_text());p.click('#nav-youtube');p.locator('#youtube-layout-diagnostics > summary').click();p.locator('#youtube-tools-inspect').click();p.wait_for_timeout(100)
  label=p.locator('#youtube-tools-status').inner_text()
  assert '정보, 댓글, 재생목록, 동영상' in label and '확인 필요' not in label,label
  p.locator('#youtube-tools-copy-layout').click();p.wait_for_timeout(100)
  report=json.loads(p.evaluate('copiedLayout'));assert 'playlist' in report['movedSections']
  assert p.evaluate('document.documentElement.scrollWidth<=innerWidth')
  p.screenshot(path=str(OUT/'playlist_diagnostics_popup.png'));record('popup_labels_and_readonly_diagnostics',{'label':label,'diagnostics':report});p.close()
  browser.close()
 result['passed']=not result['errors']
except Exception as e:
 result['errors'].append(str(e));raise
finally:
 (OUT/'playlist_results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
 print(json.dumps({'passed':result['passed'],'groups':len(result['tests']),'errors':result['errors']},ensure_ascii=False))
 if not result['passed']:sys.exit(1)
