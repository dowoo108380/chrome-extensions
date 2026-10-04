"""Chromium reproduction of the user's 1.64.1 anonymized ChatGPT DOM relationships.
Not a complete HTML/CSS capture and NOT an authenticated/live ChatGPT test.
Production code/selectors unmodified. Chrome APIs mocked, DOM/CSS/input real.
"""
from pathlib import Path
import argparse,json,shutil,traceback,re
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parents[1];O=R/'.test_results';O.mkdir(exist_ok=True)
ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--chromium',default=shutil.which('chromium') or shutil.which('chrome'));args=ap.parse_args()
if not args.chromium:ap.error('Use an existing Chromium executable.')
result={'scope':__doc__,'tests':{},'errors':[],'passed':False}
def record(k,v=True):result['tests'][k]=v;print('PASS',k,flush=True)
def settle(p):p.evaluate('() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
def update(p,a,b):p.evaluate('([a,b])=>__test.update({chatConversationWidthPx:a,chatComposerWidthPx:b})',[a,b]);settle(p)
def measure(p):return p.evaluate('__reportedWidthFixture.measure()')
def report(p,kind='chatgpt-width:inspect'):return p.evaluate('(k)=>__reportedWidthFixture.request(k)',kind)
def load(b,old=False,**options):
 p=b.new_page(viewport={'width':3072,'height':1559});p.set_default_timeout(6000)
 p.on('pageerror',lambda e:result['errors'].append(str(e)))
 p.set_content('<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="require-trusted-types-for \'script\'; trusted-types \'none\'"></head><body></body></html>')
 for f in ['browser_harness','chatgpt_reported_structure_fixture']:p.evaluate((R/'.test_dist'/f'{f}.js').read_text())
 p.evaluate('(o)=>__reportedWidthFixture.build(o)',options)
 update(p,2000,2000)
 f=R/'.test_chatgpt_baseline/fixtures/legacy_chatgpt_identifiers.js' if old else R/'dist/content_script.js'
 p.evaluate(f.read_text());settle(p);return p
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(executable_path=args.chromium,args=['--no-sandbox']);result['browser']=b.version
  p=load(b,old=True);before=measure(p);old_report=report(p)
  assert before['conversation']['width']==800 and before['composer']['width']==800,before
  assert before['form']['width']==768 and before['oldMarkerCount']==0,before
  assert old_report['conversation']==[] and old_report['composer']==[],old_report
  p.screenshot(path=str(O/'chatgpt_structure_before.png'));p.close()
  p=load(b);after=measure(p);fixed_report=report(p)
  assert after['conversation']['width']==after['composer']['width']==2000,after
  assert after['form']['width']==after['message']['width']==1968,after
  assert after['editor']['width']>before['editor']['width']+1000,after
  assert fixed_report['conversation'][0]['width']==fixed_report['composer'][0]['width']==2000,fixed_report
  assert after['overflow']==0 and after['oldMarkerCount']==0,after
  p.screenshot(path=str(O/'chatgpt_structure_after.png'))
  record('user_relationships_1641_failure_vs_fix_actual_geometry',{'before':before,'after':after,'beforeInspection':old_report,'afterInspection':fixed_report})
  full=report(p,'chatgpt-width:diagnose')
  assert full['counts']['reportedConversationLane']['total']==full['counts']['reportedComposerLane']['total']==1,full['counts']
  assert all(full['counts'][n]['selectorSupported'] for n in ['main','editable','widthClasses']),full['counts']
  # Content-script and package revisions are independent on YouTube-only releases.
  expected_revision=re.search(r"contentScriptRevision: '([^']+)'",(R/'src/content_script.ts').read_text()).group(1)
  assert full['contentScriptRevision']==expected_revision
  assert '보존할 작성 문장' not in json.dumps(full,ensure_ascii=False)
  record('diagnostic_valid_selector_lists_and_real_lane_counts',full['counts'])
  for a,c in [(1280,1040),(0,2000),(2000,0),(640,1600),(1600,640),(0,0)]:
   update(p,a,c);g=measure(p)
   assert g['conversation']['width']==(a or 800) and g['composer']['width']==(c or 800),g
   assert g['form']['width']==(c or 800)-32,g
  assert g['sheets']==[] and g['nativeBodyVariable']==before['nativeBodyVariable'] and g['nativeContentVariable']==before['nativeContentVariable']
  record('independent_sizes_and_native_styles_restored',g)
  update(p,1280,1040);p.evaluate('__reportedWidthFixture.refs.editor.focus()');p.keyboard.press('Control+End');p.keyboard.type(' PRESERVED')
  p.evaluate('window.savedEditor=__reportedWidthFixture.refs.editor')
  state=lambda:p.evaluate('({same:savedEditor===__reportedWidthFixture.refs.editor,focused:document.activeElement===savedEditor,text:savedEditor.textContent,offset:getSelection().anchorOffset})')
  initial=state();update(p,2000,1600);assert state()==initial
  record('editor_identity_draft_focus_caret_preserved',state())
  with p.expect_file_chooser() as chooser:p.get_by_role('button',name='시험 파일 선택').click()
  assert not chooser.value.is_multiple();record('real_file_chooser_still_opens')
  p.evaluate('__reportedWidthFixture.addEdit()');settle(p)
  assert p.evaluate('__reportedWidthFixture.refs.editForm.getBoundingClientRect().width')==360
  update(p,2000,640)
  assert p.evaluate('__reportedWidthFixture.refs.editForm.getBoundingClientRect().width')==360
  assert len(report(p)['composer'])==1
  record('unlabelled_previous_message_rich_editor_not_composer')
  update(p,0,0)
  for tag,role in [('aside',''),('nav',''),('dialog',''),('section','dialog')]:p.evaluate('([t,r])=>__reportedWidthFixture.addUnrelated(t,r)',[tag,role])
  snapshot=lambda:p.locator('.fixture-independent').evaluate_all('(es)=>es.map(e=>({width:e.getBoundingClientRect().width,children:[...e.querySelectorAll("[class*=max-w-]")].map(x=>x.getBoundingClientRect().width)}))')
  native=snapshot();update(p,2000,1600);assert snapshot()==native
  assert len(report(p)['composer'])==len(report(p)['conversation'])==1
  record('sidebar_navigation_dialog_rich_editors_excluded',native)
  p.close()
  p=load(b,outsideMain=True)
  assert measure(p)['conversation']['width']==measure(p)['composer']['width']==2000
  record('reported_paths_do_not_require_unproven_main_ancestry');p.close()
  p=load(b,nestedLimit=True)
  g=measure(p);assert g['message']['width']==1968,g
  update(p,0,2000);g=measure(p);assert g['message']['width']==768,g
  record('explicit_nested_thread_content_limit_tracks_column_and_restores');p.close()
  p=load(b)
  for width in [360,480,900,1280,1920,2560,3072]:
   p.set_viewport_size({'width':width,'height':1000});settle(p);g=measure(p)
   expected=min(2000,g['host']['width'])
   assert abs(g['conversation']['width']-expected)<1 and abs(g['composer']['width']-expected)<1,g
   assert g['overflow']==0,g
  record('actual_available_width_360_to_3072_no_horizontal_overflow')
  p.evaluate('__reportedWidthFixture.refs.split.style.width="900px"');settle(p);g=measure(p)
  assert g['host']['width']==1832 and g['conversation']['width']==g['composer']['width']==1832,g
  record('split_pane_clamps_to_parent_not_viewport',g)
  p.evaluate('__reportedWidthFixture.build()');settle(p);assert measure(p)['conversation']['width']==2000
  record('SPA_replacement_new_nodes_use_existing_CSS')
  p.evaluate('__reportedWidthFixture.build({empty:true})');settle(p)
  assert measure(p)['composer']['width']==2000
  p.evaluate('__reportedWidthFixture.refs.proseContainer.appendChild(document.createElement("p")).textContent="later message"');settle(p)
  assert measure(p)['message']['width']==1968
  record('empty_thread_then_first_message_with_no_old_markers')
  p.evaluate('__reportedWidthFixture.refs.scroll.classList.remove("flex-col-reverse")');settle(p)
  assert report(p)['composer']==report(p)['conversation']==[]
  untouched=measure(p);update(p,0,0);native=measure(p)
  for key in ['conversation','composer','form','editor']:
   assert untouched[key]==native[key],(key,untouched,native)
  record('unsupported_relationship_not_guessed', {'withSheets':untouched,'native':native})
  p.close()
  # Live 2026-10-04 layout: the same lanes now use variable-based inline padding.
  # Verify geometry with the native 808px carrier, independent settings, and reset.
  p=load(b,responsivePadding=True,nestedLimit=True)
  update(p,0,0);native=measure(p)
  assert native['conversation']['width']==native['composer']['width']==808,native
  update(p,2000,2000);g=measure(p)
  assert g['conversation']['width']==g['composer']['width']==2000,g
  assert g['message']['width']==g['form']['width']==1960 and g['overflow']==0,g
  assert len(report(p)['conversation'])==len(report(p)['composer'])==1
  record('responsive_inline_padding_live_layout_expands_both_lanes',{'native':native,'configured':g})
  for a,c in [(1280,1040),(0,2000),(2000,0),(640,1600),(0,0)]:
   update(p,a,c);g=measure(p)
   assert g['conversation']['width']==(a or 808) and g['composer']['width']==(c or 808),g
   assert g['form']['width']==(c or 808)-40,g
  assert g['sheets']==[] and g['nativeBodyVariable']==native['nativeBodyVariable']
  record('responsive_inline_padding_independent_settings_and_reset')
  update(p,2000,1600)
  for width in [360,900,1920,3072]:
   p.set_viewport_size({'width':width,'height':1000});settle(p);g=measure(p)
   assert abs(g['conversation']['width']-min(2000,g['host']['width']))<1,g
   assert abs(g['composer']['width']-min(1600,g['host']['width']))<1 and g['overflow']==0,g
  p.evaluate('__reportedWidthFixture.build({responsivePadding:true})');settle(p)
  assert measure(p)['conversation']['width']==2000 and measure(p)['composer']['width']==1600
  # A sticky footer uses the same carrier token but is outside either lane.
  p.evaluate('''() => {
    const f=__reportedWidthFixture.refs;
    const grid=document.createElement('div'),sticky=document.createElement('div');
    const footer=f.conversation.cloneNode(false);footer.textContent='Fixture footer';
    grid.className='grid';sticky.className='sticky bottom-0';
    sticky.append(footer);grid.append(sticky);f.flow.append(grid);f.footer=footer;
  }''');settle(p)
  assert p.evaluate('__reportedWidthFixture.refs.footer.getBoundingClientRect().width')==808
  assert len(report(p)['conversation'])==len(report(p)['composer'])==1
  record('responsive_inline_padding_responsive_replacement_and_footer_scope')
  p.close();b.close()
 assert not result['errors'],result['errors'];result['passed']=True
except Exception:
 result['failure']=traceback.format_exc();print(result['failure'],flush=True);raise
finally:
 (O/'chatgpt_structure_results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
