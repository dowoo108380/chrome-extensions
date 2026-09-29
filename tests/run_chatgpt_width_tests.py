"""Actual compiled ChatGPT code in local Chromium DOM fixtures; Chrome APIs are doubles.
No production host/selector is patched. No authenticated/live ChatGPT result is claimed.
Requires an existing Chromium and Python Playwright; installs/downloads nothing.
"""
from pathlib import Path
import argparse,json,shutil,traceback,re
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--chromium',default=shutil.which('chromium') or shutil.which('chrome'));args=parser.parse_args()
if not args.chromium:parser.error('Supply an installed Chrome/Chromium executable.')
O=R/'.test_results';O.mkdir(exist_ok=True)
results={'scope':'Local Chromium DOM/CSS/user-input tests; mocked Chrome extension APIs. NOT authenticated ChatGPT or Windows Chrome.','tests':{},'errors':[],'passed':False}
def record(name,value=True):results['tests'][name]=value;print('PASS',name,flush=True)
def settle(p):p.evaluate('() => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
def update(p,**vals):p.evaluate('(v)=>__test.update(v)',vals);settle(p)
def inspect(p):return p.evaluate('''() => {let reply=null;for(const f of chrome.runtime.onMessage.listeners)f({type:'chatgpt-width:inspect'},{id:chrome.runtime.id},v=>reply=v);return reply;}''')
def load(b,kind='modern',old=False,width=1920,height=1000,conv=1280,comp=1040):
 p=b.new_page(viewport={'width':width,'height':height});p.set_default_timeout(5000)
 p.on('pageerror',lambda e:results['errors'].append(str(e)))
 p.set_content('<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="require-trusted-types-for \'script\'; trusted-types \'none\'"></head><body></body></html>')
 for name in ['browser_harness.js','chatgpt_width_fixture.js']:p.evaluate((R/'.test_dist'/name).read_text())
 p.evaluate('(kind)=>__widthFixture.setScene(kind)',kind)
 update(p,chatConversationWidthPx=conv,chatComposerWidthPx=comp)
 f=R/'.test_chatgpt_baseline/fixtures/legacy_chatgpt_width.js' if old else R/'dist/content_script.js'
 p.evaluate(f.read_text());settle(p)
 return p
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox']);results['browser']=b.version
  # Document the real access restriction rather than claiming a fixture is live.
  live=b.new_page()
  try:
   live.goto('https://chatgpt.com/',timeout=15000);results['target_access']={'url':'https://chatgpt.com/','loaded':True,'note':'No account; no authenticated conversation test.'}
  except Exception as e:results['target_access']={'loaded':False,'error':str(e).split('Call log:')[0].strip()}
  live.close()
  for kind in ['modern','per-turn','group','shared']:
   old=load(b,kind,old=True);before=old.evaluate('__widthFixture.measure()');old.close()
   p=load(b,kind);after=p.evaluate('__widthFixture.measure()')
   assert abs(after['conversation']['width']-1280)<1,(kind,after)
   assert abs(after['composer']['width']-1040)<1,(kind,after)
   assert after['overflow']==0,after
   if kind!='shared':assert before['conversation']['width']!=1280,before
   assert before['composer']['width']!=1040,before
   record('legacy_vs_fixed_'+kind,{'before':before,'after':after})
   p.close()
  p=load(b,'legacy');g=p.evaluate('__widthFixture.measure()');assert g['conversation']['width']==1280 and g['composer']['width']==1040,g
  record('old_markup_compatibility',g);p.close()
  for kind in ['modern','legacy','shared','per-turn']:
   p=load(b,kind,conv=0,comp=0);native=p.evaluate('__widthFixture.measure()')
   for conv,comp in [(1280,0),(0,1040),(640,1600),(1600,640),(0,0)]:
    update(p,chatConversationWidthPx=conv,chatComposerWidthPx=comp);g=p.evaluate('__widthFixture.measure()')
    ec=conv or native['conversation']['width'];ef=comp or native['composer']['width']
    assert abs(g['conversation']['width']-ec)<1,(kind,conv,comp,g,ec)
    assert abs(g['composer']['width']-ef)<1,(kind,conv,comp,g,ef)
   assert g['styles']==[],g
   assert g['nativeBodyWidth']==native['nativeBodyWidth'],g
   record('independent_defaults_and_restore_'+kind,g);p.close()
  p=load(b)
  # Real editor state survives CSS setting changes, including selection and focus.
  p.locator('#prompt-textarea').click();p.keyboard.press('Control+End');p.keyboard.type(' preserved')
  before=p.evaluate('({node:document.activeElement.id,offset:getSelection().anchorOffset,text:document.activeElement.textContent})')
  update(p,chatConversationWidthPx=1600,chatComposerWidthPx=1200)
  after=p.evaluate('({node:document.activeElement.id,offset:getSelection().anchorOffset,text:document.activeElement.textContent})');assert before==after
  record('input_focus_text_selection_not_replaced',after)
  p.keyboard.press('Control+Enter');assert p.evaluate('__widthFixture.measure().sent')==1
  with p.expect_file_chooser() as chooser:p.locator('#upload-button').click()
  assert chooser.value.is_multiple() is False
  record('trusted_CtrlEnter_and_real_file_chooser')
  p.evaluate('__widthFixture.addEdit()');settle(p)
  edit=p.locator('#edit-wrapper').bounding_box();assert edit['width']==min(1600,p.evaluate('document.querySelector("#thread").clientWidth')),edit
  assert p.locator('#edit-wrapper').evaluate('(e)=>getComputedStyle(e).maxWidth')!='1200px'
  p.locator('#edit-text').click();p.keyboard.press('Control+Enter');assert p.evaluate('__widthFixture.measure().saved')==1
  record('previous_message_edit_is_not_main_composer',edit)
  base=load(b,conv=0,comp=0);g0=base.evaluate('__widthFixture.measure()');g=p.evaluate('__widthFixture.measure()')
  for name in ['unrelated','aside','dialog']:assert g0[name]['width']==g[name]['width'],(name,g0,g)
  record('settings_dialog_sidebar_search_untouched');base.close()
  p.evaluate('__widthFixture.setScene("modern")');settle(p)
  assert p.evaluate('__widthFixture.measure().conversation.width')==1600
  assert p.evaluate('__widthFixture.measure().composer.width')==1200
  record('SPA_replacement_uses_existing_css_without_observer')
  p.locator('#thread').evaluate('(e)=>{e.replaceChildren();}')
  settle(p)
  p.evaluate("""() => {const a=document.createElement('article');a.dataset.turn='assistant';const t=document.createElement('div');t.id='message-box-2';t.dataset.messageAuthorRole='assistant';t.textContent='Delayed actual DOM content';a.id='turn-2';a.append(t);document.getElementById('thread').append(a);}""")
  settle(p)
  assert p.evaluate('__widthFixture.measure().conversation.width')==1600
  record('late_message_insertion_recalculates_CSS_without_polling')
  p.evaluate("""() => {const a=document.querySelector('[data-turn]');a.removeAttribute('data-turn');a.setAttribute('data-scroll-anchor','true');}""")
  settle(p)
  assert p.evaluate('__widthFixture.measure().conversation.width')==1600
  record('legacy_scroll_anchor_still_supported')

  p.evaluate('''() => {let e=document.getElementById('thread');e.className='max-w-[var(--thread-body-max-width)]';let c=document.getElementById('composer-box');c.className='max-w-[var(--thread-body-max-width)]';}''');settle(p)
  assert p.evaluate('__widthFixture.measure().conversation.width')==1600
  record('both_CSS_variable_utility_spellings')
  measurements=[]
  for width in [480,720,1100,1440,1920,2560]:
   p.set_viewport_size({'width':width,'height':900});update(p,chatConversationWidthPx=2000,chatComposerWidthPx=2000)
   g=p.evaluate('__widthFixture.measure()');available=p.locator('#chat-main').evaluate('(e)=>e.clientWidth-parseFloat(getComputedStyle(e).paddingLeft)-parseFloat(getComputedStyle(e).paddingRight)')
   assert abs(g['conversation']['width']-min(available,2000))<1,g
   assert abs(g['composer']['width']-min(available,2000))<1,g
   assert g['overflow']==0,g
   measurements.append({'viewport':width,'available':available,'conversation':g['conversation']['width'],'composer':g['composer']['width']})
  record('narrow_sidebar_wide_viewports_real_layout',measurements)
  p.set_viewport_size({'width':1440,'height':900});p.locator('#split-view').evaluate('(e)=>e.style.width="480px"');settle(p)
  g=p.evaluate('__widthFixture.measure()');assert g['overflow']==0 and g['conversation']['width']<1000,g
  record('split_view_bounds_parent_not_entire_viewport',g)
  update(p,chatConversationWidthPx=0,chatComposerWidthPx=0)
  p.evaluate('document.documentElement.style.setProperty("--thread-body-max-width","700px");document.documentElement.style.setProperty("--composer-max-width","700px")');settle(p)
  assert p.locator('style[id^=chatgpt-ctrl-enter-]').count()==0
  assert p.evaluate('__widthFixture.measure().composer.width')==min(700,656)
  record('default_restores_current_site_css_without_stale_snapshot')
  p.close()
  p=load(b,'home');g=p.evaluate('__widthFixture.measure()');assert g['composer']['width']==1040 and g['conversation'] is None
  d=inspect(p);assert d['ok'] and d['conversation']==[] and d['composer'],d
  record('new_conversation_composer_and_absent_turn_diagnostics',d)
  p.evaluate('__widthFixture.setScene("modern")');settle(p);d=inspect(p)
  assert d['ok'] and d['conversation'] and d['composer']
  assert d['configured']=={'conversation':1280,'composer':1040}
  assert all(sample['width']==1280 for sample in d['conversation']),d
  assert all(sample['width']==1040 for sample in d['composer']),d
  assert 'preserved' not in json.dumps(d) and 'URL' not in json.dumps(d)
  record('inspection_reads_actual_geometry_not_settings',d)
  p.locator('#composer-box').evaluate('(e)=>e.style.setProperty("width","700px","important")');settle(p)
  d=inspect(p);assert d['configured']['composer']==1040 and min(s['width'] for s in d['composer'])==700,d
  record('inspection_does_not_report_requested_width_as_actual',d)
  p.evaluate('document.body.replaceChildren()');settle(p);d=inspect(p);assert not d['conversation'] and not d['composer'],d
  record('unknown_DOM_is_reported_missing_not_success')
  p.evaluate('__widthFixture.setScene("modern")');update(p,chatConversationWidthPx=1200,chatComposerWidthPx=960);settle(p)
  p.screenshot(path=str(O/'chatgpt_width_fixed.png'),full_page=True);p.close()
  # Popup rendering and read-only request/error paths.
  html=(R/'popup.html').read_text();scripts=re.findall(r'<script\b[^>]*\bsrc="([^"]+)"[^>]*>',html)
  html=re.sub(r'<script\b[^>]*>\s*</script>','',html)
  html=re.sub(r'<link\b[^>]*href="popup.css"[^>]*>',lambda m:'<style>'+(R/'popup.css').read_text()+'</style>',html)
  p=b.new_page(viewport={'width':780,'height':600});p.set_content(html)
  for name in ['browser_harness.js','popup_harness.js']:p.evaluate((R/'.test_dist'/name).read_text())
  p.evaluate('(version)=>{chrome.runtime.getManifest=()=>({version});}',json.loads((R/'manifest.json').read_text())['version'])
  update(p,chatConversationWidthPx=1200,chatComposerWidthPx=960)
  p.evaluate('''() => {chrome.tabs.query=(_q,cb)=>cb([{id:11,windowId:1,active:true,url:'https://chatgpt.com/c/local-test'}]);chrome.tabs.sendMessage=(_id,m,opt,cb)=>{__test.sent.push(m);cb({ok:true,scope:'matched-visible-width-containers',configured:{conversation:1200,composer:960},conversation:[{width:1100}],composer:[{width:960}],viewportWidth:1440,horizontalOverflow:0});};}''')
  for f in scripts:p.evaluate((R/f).read_text())
  p.wait_for_function('document.documentElement.dataset.popupControlsReady === "true"');p.click('#nav-chat');p.locator('#chat-width-inspect').locator('..').evaluate('(e)=>e.open=true');p.click('#chat-width-inspect');settle(p)
  report=p.locator('#chat-width-inspection').inner_text();assert '1200' in report and '1100' in report and '960' in report
  assert p.evaluate('document.documentElement.scrollWidth')==780
  p.screenshot(path=str(O/'popup_chatgpt_width.png'));record('popup_readonly_measurement_rendered_without_overflow',report)
  p.evaluate('() => {chrome.tabs.sendMessage=(_i,m,opt,cb)=>{chrome.runtime.lastError={message:"No receiving end"};cb();delete chrome.runtime.lastError};}')
  p.click('#chat-width-inspect');settle(p);assert '새로 고친' in p.locator('#chat-width-inspection').inner_text()
  record('popup_missing_content_script_visible_error');p.close()
  b.close()
 assert not results['errors'],results['errors'];results['passed']=True
except Exception:
 results['failure']=traceback.format_exc();print(results['failure']);raise
finally:
 (O/'chatgpt_width_results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
