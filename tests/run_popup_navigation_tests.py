"""Actual popup HTML/CSS and compiled TypeScript in Chromium, with explicit Chrome API doubles.
No production selectors/predicates are patched. This is not an installed extension/live-site test.
Uses an already installed Python Playwright and Chromium; downloads nothing.
"""
from pathlib import Path
import argparse,base64,json,re,shutil,sys,traceback
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--chromium',default=shutil.which('chromium') or shutil.which('chrome'));args=parser.parse_args()
if not args.chromium:parser.error('Provide the path to an installed Chrome/Chromium.')
O=R/'.test_results';O.mkdir(exist_ok=True)
html=(R/'popup.html').read_text();scripts=re.findall(r'<script\b[^>]*\bsrc="([^"]+)"[^>]*>',html)
html=re.sub(r'<script\b[^>]*>\s*</script>','',html)
html=re.sub(r'<link\b[^>]*href="popup.css"[^>]*>',lambda _: '<style>'+(R/'popup.css').read_text()+'</style>',html)
results={'environment':{'scope':'Local Chromium popup, real HTML/CSS/JS and user inputs, mocked Chrome extension APIs and clipboard; NOT Windows/installed extension/live sites/GPU','source_changes':'None. Production popup files run without modifications; external script/link tags are replaced by their exact local content for in-memory loading.'},'tests':{},'errors':[],'passed':False}
sections=['media','youtube','captions','tabs','page','chat','settings']
def record(name,value=True):results['tests'][name]=value;print('PASS',name,flush=True)
def wait(p,ms=120):p.wait_for_timeout(ms)
def load(browser,dark=False,delayed=False):
 p=browser.new_page(viewport={'width':780,'height':600},color_scheme='dark' if dark else 'light');p.set_default_timeout(7000)
 p.on('pageerror',lambda error:results['errors'].append(str(error)));p.set_content(html)
 for f in ['browser_harness.js','popup_harness.js']:p.evaluate((R/'.test_dist'/f).read_text())
 if delayed:p.evaluate('''() => {const get=chrome.storage.local.get;chrome.storage.local.get=(keys,callback)=>setTimeout(()=>get(keys,callback),250);}''')
 for f in scripts:p.evaluate((R/f).read_text())
 return p
def nav(p,key):p.click('#nav-'+key);wait(p)
def search(p,word,label):
 p.locator('#popup-search').fill(word);p.get_by_role('button',name=label,exact=False).filter(has=p.locator('span')).last.click();wait(p)
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox']);results['environment']['browser']=b.version
  p=load(b);p.wait_for_function('document.documentElement.dataset.popupControlsReady === "true"');wait(p,250)
  baseline=json.loads((R/'tests/fixtures/popup_controls_baseline.json').read_text())
  snapshot=p.evaluate('''() => Object.fromEntries([...document.querySelectorAll('[id]')].map(e=>[e.id,{tag:e.tagName.toLowerCase(),type:e.getAttribute('type'),min:e.getAttribute('min'),max:e.getAttribute('max'),step:e.getAttribute('step')}]))''')
  for key,value in baseline.items():
   assert key in snapshot,key
   assert snapshot[key]==value,(key,value,snapshot[key])
  assert p.locator('[id]').count()==len(set(p.locator('[id]').evaluate_all('(nodes)=>nodes.map(e=>e.id)')))
  assert p.locator('.section-nav [role=tab]').count()==7
  assert p.locator('#media-dropdown').is_visible();assert p.locator('#media-rate-input').input_value()=='1.75'
  record('all_original_identified_elements_and_control_ranges_preserved',len(baseline))
  initial=p.evaluate('structuredClone(__test.settings)')
  geometry=[]
  for key in sections:
   nav(p,key);assert p.locator('.workspace-panel:visible').count()==1
   assert p.locator('#view-'+key).is_visible()
   assert p.locator('#nav-'+key).get_attribute('aria-selected')=='true'
   g=p.locator('#view-'+key).evaluate('(e)=>({key:e.dataset.section,width:e.clientWidth,scrollWidth:e.scrollWidth,docWidth:document.documentElement.scrollWidth,footer:document.querySelector(".app-footer").getBoundingClientRect().bottom})')
   assert g['width']>=g['scrollWidth'] and g['docWidth']==780 and g['footer']<=600,g
   geometry.append(g);p.screenshot(path=str(O/f'popup_{key}_light.png'))
  assert p.evaluate('JSON.stringify(__test.settings)')==json.dumps(initial,separators=(',',':'),ensure_ascii=False), 'Category changes wrote feature preferences'
  record('seven_categories_real_render_and_no_preference_writes',geometry)
  p.click('#nav-media');p.keyboard.press('ArrowDown');assert p.locator('#nav-youtube').evaluate('(e)=>e===document.activeElement')
  assert p.locator('#view-media').is_visible();p.keyboard.press('Enter');assert p.locator('#view-youtube').is_visible()
  p.keyboard.press('End');assert p.locator('#nav-settings').evaluate('(e)=>e===document.activeElement');p.keyboard.press('Space');assert p.locator('#view-settings').is_visible()
  p.keyboard.press('Home');assert p.locator('#nav-media').evaluate('(e)=>e===document.activeElement')
  record('keyboard_manual_tabs_arrows_home_end_enter_space')
  p.keyboard.press('Control+k');assert p.locator('#popup-search').evaluate('(e)=>e===document.activeElement')
  p.locator('#popup-search').fill('자막 크기');wait(p);assert p.locator('.search-result').count()==1
  sent_before=p.evaluate('__test.sent.length');p.keyboard.press('Enter');wait(p)
  assert p.locator('#view-captions').is_visible();assert p.locator('#caption-appearance-settings').get_attribute('open') is not None
  assert p.locator('#youtube-synced-caption-font-size').is_visible()
  assert p.evaluate('__test.sent.slice('+str(sent_before)+').every(m=>m.type!=="youtube-synced-captions:apply")')
  record('search_routes_to_original_caption_setting_without_applying')
  p.locator('#popup-search').fill('<img src=x onerror=alert(1)>');wait(p);assert p.locator('.search-result').count()==0 and '일치하는' in p.locator('#popup-search-summary').inner_text()
  assert p.locator('#popup-search-results img').count()==0
  p.keyboard.press('Escape');assert not p.locator('#popup-search-results').is_visible()
  p.locator('#popup-search').fill('속도');wait(p);p.screenshot(path=str(O/'popup_search.png'))
  p.keyboard.press('ArrowDown');assert p.locator('.search-result').first.evaluate('(e)=>e===document.activeElement')
  p.keyboard.press('Escape');assert p.locator('#popup-search').evaluate('(e)=>e===document.activeElement')
  record('search_empty_result_safe_text_keyboard_dismissal')
  nav(p,'media');p.locator('#media-controller-toggle').uncheck();wait(p);assert p.evaluate('__test.settings.mediaControllerEnabled') is False
  assert p.locator('#media-rate-input').is_disabled();p.locator('#media-controller-toggle').check();wait(p)
  p.locator('#media-rate-input').fill('2.25');p.locator('#media-rate-input').press('Tab');wait(p,350)
  assert p.evaluate('__popupTest.rate')==2.25 and p.locator('#media-rate-input').input_value()=='2.25'
  p.evaluate('__popupTest.rateFailure=true');p.locator('#media-rate-input').fill('3.5');p.locator('#media-rate-input').press('Tab');wait(p,350)
  assert p.locator('#status').get_attribute('data-state')=='error';assert p.locator('#media-rate-input').input_value()=='2.25'
  p.evaluate('__popupTest.rateFailure=false');record('media_toggle_apply_and_rejection_use_existing_handlers')
  p.locator('#media-behavior-settings > summary').click();p.locator('#media-speed-step-input').fill('0.25');p.locator('#media-speed-step-input').press('Tab');wait(p)
  assert p.evaluate('__test.settings.mediaSpeedStep')==.25
  p.locator('#media-display-settings > summary').click();p.locator('#media-overlay-toggle').check();wait(p);assert p.evaluate('__test.settings.mediaOverlayEnabled') is True
  p.locator('#media-keyboard-settings > summary').click();p.locator('[data-media-shortcut-command="faster"]').click();p.keyboard.press('q');wait(p)
  assert p.evaluate('__test.settings.mediaShortcutFasterCode')=='KeyQ'
  p.locator('[data-media-shortcut-command="faster"]').click();nav(p,'chat');p.keyboard.press('w');wait(p)
  assert p.evaluate('__test.settings.mediaShortcutFasterCode')=='KeyQ'
  nav(p,'media');assert p.locator('#media-keyboard-settings').get_attribute('open') is not None
  p.locator('#media-keyboard-settings').scroll_into_view_if_needed();p.screenshot(path=str(O/'popup_shortcuts.png'))
  record('advanced_settings_original_storage_and_key_capture_cancelled_on_navigation')
  nav(p,'youtube');assert p.locator('#youtube-tools-options input[type=checkbox]').count()==8
  panel=p.locator('#btx-option-youtubeLayoutTabsEnabled');panel.check();wait(p)
  assert p.evaluate('__test.settings.youtubeLayoutTabsEnabled') is True
  assert not p.locator('#btx-option-youtubePanelScrollEnabled').is_disabled()
  p.evaluate('__test.faults.write=true');p.locator('#btx-option-youtubeDescriptionExpandedEnabled').click();wait(p)
  assert p.locator('#youtube-tools-status').get_attribute('data-error')=='true'
  assert p.locator('#status').get_attribute('data-state')=='error' and 'Injected' in p.locator('#status').inner_text()
  assert p.locator('#btx-option-youtubeDescriptionExpandedEnabled').is_checked() is False
  p.evaluate('__test.faults.write=false');record('youtube_dependencies_and_write_error_preserved')
  nav(p,'captions');assert p.locator('.youtube-transcript-tab').count()==1
  assert p.locator('.youtube-transcript-tab__field select').count()==2
  assert not p.locator('#youtube-synced-caption-apply').is_disabled()
  p.locator('#youtube-synced-caption-apply').click();wait(p,220);assert p.evaluate('__popupTest.synced') is True
  assert '3개 문장' in p.locator('.youtube-transcript-tab').inner_text()
  p.locator('#youtube-synced-caption-remove').click();wait(p);assert p.evaluate('__popupTest.synced') is False
  p.evaluate('__popupTest.captionFailure=true');p.locator('#youtube-synced-caption-apply').click();wait(p)
  assert p.locator('#status').get_attribute('data-state')=='error' and not p.locator('#youtube-synced-caption-apply').is_disabled()
  p.evaluate('__popupTest.captionFailure=false');record('caption_source_language_apply_remove_error_UI')
  p.locator('#caption-appearance-settings').evaluate('(e)=>e.open=true')
  p.locator('#youtube-synced-caption-font-size').focus();p.locator('#youtube-synced-caption-font-size').press('ArrowRight');wait(p,280)
  assert p.evaluate('__test.settings.youtubeSyncedCaptionFontSizePx')==29
  p.select_option('#youtube-synced-caption-line-count','2');wait(p);assert p.evaluate('__test.settings.youtubeSyncedCaptionPreferredLineCount')==2
  p.select_option('#caption-overflow-mode','expand');wait(p);assert p.evaluate('__test.settings.youtubeSyncedCaptionOverflowMode')=='expand'
  p.locator('#caption-export-settings > summary').click();p.locator('#youtube-transcript-copy').click();wait(p,200)
  assert '첫 번째 시험 문장' in p.evaluate('__popupTest.copied')
  record('caption_appearance_and_text_copy_handlers_preserved')
  nav(p,'tabs');p.locator('#select-all-tabs-button').click();wait(p)
  assert p.locator('#selected-tabs-count').inner_text().startswith('3개 선택')
  p.locator('#copy-tab-urls-button').click();wait(p)
  assert p.evaluate('__popupTest.copied').splitlines()==['https://www.youtube.com/watch?v=popup_fixture','https://example.com/article','chrome://settings/']
  nav(p,'chat');nav(p,'tabs');assert p.locator('#selected-tabs-count').inner_text().startswith('3개 선택')
  button=p.locator('#clear-site-data-button');button.scroll_into_view_if_needed()
  assert p.locator('.danger-zone p').is_visible()
  p.screenshot(path=str(O/'popup_site_data.png'));button.click();wait(p)
  request=p.evaluate('__test.sent.findLast(m=>m.type==="tab-tools:clear-selected-site-data")')
  if request is None:request=p.evaluate('__test.sent.findLast(m=>m.targets)')
  assert len(request['targets'])==2 and {t['tabId'] for t in request['targets']}=={11,12}
  record('tab_selection_persists_and_site_deletion_scope_warning',request)
  nav(p,'page');p.locator('#page-unlock-toggle').click();wait(p)
  p.locator('#page-unlock-master-toggle').check();wait(p)
  assert all(p.locator('#'+key).is_checked() for key in ['right-click-toggle','text-selection-toggle','copy-unlock-toggle','clipboard-protection-toggle','image-drag-toggle','middle-click-toggle','back-navigation-toggle'])
  p.locator('#element-eraser-toggle').click();wait(p);assert p.locator('.element-eraser-mode').count()==2
  p.locator('#full-page-button').click();wait(p);assert p.evaluate('__test.sent.some(m=>m.type==="capture:full-page")') or p.evaluate('__test.sent.some(m=>m.type.includes("capture")&&m.type.includes("full"))')
  record('page_unlock_master_eraser_and_capture_handler')
  nav(p,'chat');p.locator('#composer-toggle').uncheck();wait(p);assert p.evaluate('__test.settings.composerCtrlEnterEnabled') is False
  p.locator('#chat-width-slider').focus();p.locator('#chat-width-slider').press('ArrowRight');p.locator('#chat-width-slider').press('Tab');wait(p,350)
  assert p.evaluate('__test.settings.chatConversationWidthPx')==1000
  record('chat_settings_and_width_original_handlers')
  nav(p,'settings');p.locator('#settings-export').click();wait(p);download=p.evaluate('__test.downloads.at(-1)')
  assert download['filename']=='browser_toolbox_settings.zip'
  raw=base64.b64decode(download['url'].split(',',1)[1]);p.set_input_files('#settings-import-file',{'name':'browser_toolbox_settings.zip','mimeType':'application/zip','buffer':raw});wait(p,250)
  assert p.locator('#settings-import-preview').is_visible() and not p.locator('#settings-import-apply').is_disabled()
  assert p.evaluate('__test.sent.filter(m=>m.type===ToolboxSettings.MESSAGES.APPLY).length')==0
  p.locator('#settings-import-apply').click();wait(p);assert p.evaluate('__test.settings.mediaSpeedStep')==.2
  p.locator('#settings-copy-diagnostics').click();wait(p);assert 'not-measured' in p.evaluate('__popupTest.copied')
  record('settings_backup_preview_confirmation_diagnostics_preserved')
  # Each panel keeps its own native scroll offset when visiting another category.
  nav(p,'youtube');p.locator('#view-youtube').evaluate('(e)=>e.scrollTop=230');old=p.locator('#view-youtube').evaluate('(e)=>e.scrollTop')
  nav(p,'chat');nav(p,'youtube');new=p.locator('#view-youtube').evaluate('(e)=>e.scrollTop');assert old==new
  record('per_category_scroll_preserved',{'before':old,'after':new})
  dark=[];p.emulate_media(color_scheme='dark',reduced_motion='reduce')
  for key in sections:
   nav(p,key);p.locator('#view-'+key).evaluate('(e)=>e.scrollTop=0');wait(p)
   g=p.locator('#view-'+key).evaluate('(e)=>({key:e.dataset.section,width:e.clientWidth,scrollWidth:e.scrollWidth,background:getComputedStyle(document.body).backgroundColor})')
   assert g['width']>=g['scrollWidth'];dark.append(g);p.screenshot(path=str(O/f'popup_{key}_dark.png'))
  record('dark_scheme_and_reduced_motion_all_sections',dark)
  p.evaluate('document.getElementById("status").textContent="저장에 실패했습니다. ".repeat(55);document.getElementById("status").dataset.state="error"');wait(p)
  status=p.locator('#status').evaluate('(e)=>({scroll:e.scrollHeight,client:e.clientHeight,bottom:e.getBoundingClientRect().bottom,overflow:getComputedStyle(e).overflowY})')
  assert status['bottom']<=600 and status['overflow']=='auto' and status['scroll']>status['client']
  record('long_error_message_remains_readable_not_ellipsized',status);p.close()
  p=load(b,delayed=True);p.click('#nav-captions');p.wait_for_function('document.documentElement.dataset.popupCaptionsReady==="true"');wait(p,250)
  assert p.locator('#youtube-transcript-dropdown').is_visible() and p.locator('.youtube-transcript-tab').count()==1
  record('early_navigation_waits_for_caption_controller_ready');p.close()
  p=load(b);wait(p,250);p.evaluate('__popupTest.hasMedia=false');nav(p,'tabs');nav(p,'media')
  assert p.locator('#media-rate-input').is_disabled()
  assert not p.locator('#media-controller-toggle').is_disabled()
  record('no_media_state_disables_rate_not_global_preferences');p.close()
  b.close()
 if results['errors']:raise AssertionError(results['errors'])
 results['passed']=True
except Exception as e:results['failure']=str(e);results['traceback']=traceback.format_exc();print(results['traceback'])
finally:
 (O/'popup_navigation_results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
 print('RESULT',results['passed'],'GROUPS',len(results['tests']))
sys.exit(0 if results['passed'] else 1)
