"""Read-only diagnostic collector/popup tests. DOM/storage/clipboard are local doubles.
The unknown scene is intentionally NOT represented as a captured live ChatGPT layout.
No live width fix is tested or claimed.
"""
from pathlib import Path
import json, re, shutil, traceback, argparse
from playwright.sync_api import sync_playwright
R = Path(__file__).resolve().parents[1]
O = R / '.test_results'; O.mkdir(exist_ok=True)
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--chromium',default=shutil.which('chromium') or shutil.which('chrome'));args=parser.parse_args()
if not args.chromium:parser.error('Provide an installed --chromium executable.')
result = {'scope': __doc__, 'passed': False, 'tests': {}, 'pageErrors': []}
def record(name, data=True):
    result['tests'][name] = data; print('PASS', name, flush=True)
def settle(p): p.evaluate('() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
def request(p, name='chatgpt-width:diagnose'):
    return p.evaluate('(type)=>__diagnosticFixture.request(type)', name)
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=args.chromium, args=['--no-sandbox'])
        p = b.new_page(viewport={'width':1600,'height':900})
        p.on('pageerror', lambda error: result['pageErrors'].append(str(error)))
        p.set_content('<!doctype html><html><head></head><body></body></html>')
        for name in ['browser_harness', 'chatgpt_width_fixture', 'chatgpt_diagnostics_fixture']:
            p.evaluate((R/'.test_dist'/f'{name}.js').read_text())
        p.evaluate('__test.update({chatConversationWidthPx:1200,chatComposerWidthPx:960})')
        p.evaluate((R/'dist/content_script.js').read_text()); settle(p)
        report = request(p)
        assert report['ok'] and report['counts']['conversationTarget']['total'] > 0
        assert report['counts']['composerTarget']['total'] > 0
        assert all(s['present'] and s['ruleCount'] > 0 for s in report['sheets'])
        record('known_layout_reports_matched_selectors_and_parsed_styles')
        assert p.evaluate('__diagnosticFixture.request("chatgpt-width:diagnose", "other")').get('ok') is False
        record('foreign_sender_rejected')
        p.evaluate('__diagnosticFixture.makeUnknown()'); settle(p)
        basic = request(p, 'chatgpt-width:inspect')
        assert basic['conversation']==[] and basic['composer']==[]
        p.evaluate('__diagnosticEditor.focus();getSelection().selectAllChildren(__diagnosticEditor)')
        before = p.evaluate('({html:document.documentElement.outerHTML,settings:JSON.stringify(__test.settings),selection:getSelection().toString(),active:document.activeElement.id})')
        report = request(p)
        after = p.evaluate('({html:document.documentElement.outerHTML,settings:JSON.stringify(__test.settings),selection:getSelection().toString(),active:document.activeElement.id})')
        assert before == after
        assert report['counts']['composerTarget']['total']==0
        assert report['counts']['editable']['rendered']==1 and report['counts']['widthClasses']['rendered']==2
        assert any(a['css']['maxWidth']=='768px' for a in report['elements'])
        record('no_targets_still_reports_actual_editable_and_limiting_ancestors', report['counts'])
        record('collector_does_not_change_DOM_settings_focus_selection')
        assert 'PRIVATE_SENTINEL' not in json.dumps(report)
        assert 'textContent' not in json.dumps(report) and 'outerHTML' not in json.dumps(report)
        assert all(len(e['ancestors'])<=16 for e in report['examples']) and len(report['examples'])<=18
        record('private_text_input_id_data_values_omitted_and_size_bounded')
        # A hidden/inert ancestor is observable separately from missing selectors.
        p.evaluate('__widthFixture.setScene("modern");document.getElementById("workspace").inert=true');settle(p)
        report = request(p)
        assert report['counts']['composerTarget']['total']>0
        assert report['counts']['composerTarget']['visibleUnderInspectionRules']==0
        assert any(a['flags']['inert'] for a in report['elements'])
        record('existing_but_inert_targets_distinguished_from_zero_matches')
        p.close()
        # Real compiled popup, with explicit extension/clipboard test doubles.
        html = (R/'popup.html').read_text(); scripts=re.findall(r'<script\b[^>]*\bsrc="([^"]+)"[^>]*>',html)
        html=re.sub(r'<script\b[^>]*>\s*</script>','',html)
        html=re.sub(r'<link\b[^>]*href="popup.css"[^>]*>',lambda _: '<style>'+(R/'popup.css').read_text()+'</style>',html)
        p=b.new_page(viewport={'width':780,'height':600});p.on('pageerror', lambda e: result['pageErrors'].append(str(e)));p.set_content(html)
        for name in ['browser_harness','popup_harness']:p.evaluate((R/'.test_dist'/f'{name}.js').read_text())
        p.evaluate('(version)=>{chrome.runtime.getManifest=()=>({version})}', json.loads((R/'manifest.json').read_text())['version'])
        p.evaluate('''() => {chrome.tabs.query=(_q,cb)=>cb([{id:11,windowId:1,active:true,url:'https://chatgpt.com/c/local-test'}]);chrome.tabs.sendMessage=(_id,m,o,cb)=>{__test.sent.push(m);cb({ok:true,scope:'chatgpt-width-structure',schemaVersion:1,examples:[]})};Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedDiagnostic=text}}});}''')
        for script in scripts:p.evaluate((R/script).read_text())
        p.wait_for_function('document.documentElement.dataset.popupControlsReady === "true"')
        p.click('#nav-chat');p.locator('#chat-width-copy-diagnostics').evaluate('(e)=>e.closest("details").open=true')
        p.click('#chat-width-copy-diagnostics');settle(p)
        assert json.loads(p.evaluate('copiedDiagnostic'))['scope']=='chatgpt-width-structure'
        assert '복사했습니다' in p.locator('#chat-width-copy-status').inner_text()
        assert p.evaluate('document.documentElement.scrollWidth')==780
        record('popup_trusted_click_copies_report_and_has_no_horizontal_overflow')
        p.screenshot(path=str(O/'chatgpt_diagnostics_popup.png'))
        p.evaluate('() => {navigator.clipboard.writeText=async()=>{throw new Error("Injected clipboard failure")}}')
        p.click('#chat-width-copy-diagnostics');settle(p)
        assert 'Injected clipboard failure' in p.locator('#chat-width-copy-status').inner_text()
        assert not p.locator('#chat-width-copy-diagnostics').is_disabled()
        record('clipboard_failure_not_reported_as_success')
        p.evaluate('() => {chrome.tabs.sendMessage=(_i,_m,_o,cb)=>cb()}')
        p.click('#chat-width-copy-diagnostics');settle(p)
        assert '새로 고친' in p.locator('#chat-width-copy-status').inner_text()
        record('old_content_script_requires_refresh_instead_of_empty_success')
        p.close();b.close()
    assert not result['pageErrors'], result['pageErrors']
    result['passed']=True
except Exception:
    result['failure']=traceback.format_exc();raise
finally:
    (O/'chatgpt_diagnostics_results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
