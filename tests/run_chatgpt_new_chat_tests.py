"""New-chat width from the user's anonymized 1.67.0 report.
Real Chromium CSS, DOM and user input; mocked Chrome APIs and fixture form actions.
Not a complete ChatGPT capture, authenticated service test, or actual SPA navigation.
Production content_script is unmodified in this test. No installs or downloads.
"""
from pathlib import Path
import argparse, json, re, shutil, traceback
from playwright.sync_api import sync_playwright

R = Path(__file__).resolve().parents[1]
O = R / '.test_results'
O.mkdir(exist_ok=True)
ap = argparse.ArgumentParser(description=__doc__)
ap.add_argument('--chromium', default=shutil.which('chromium') or shutil.which('chrome'))
args = ap.parse_args()
if not args.chromium:
    ap.error('Supply an existing Chrome/Chromium executable with --chromium.')
result = {'scope': __doc__, 'tests': {}, 'errors': [], 'passed': False}

def record(name, value=True):
    result['tests'][name] = value
    print('PASS', name, flush=True)

def settle(p):
    p.evaluate('() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')

def update(p, conversation, composer):
    p.evaluate('([a,b])=>__test.update({chatConversationWidthPx:a,chatComposerWidthPx:b})', [conversation, composer])
    settle(p)

def measure(p):
    return p.evaluate('__newChatFixture.measure()')

def report(p, kind='chatgpt-width:inspect'):
    return p.evaluate('(k)=>__newChatFixture.request(k)', kind)

def load(browser, old=False, delayed=False, conversation=2000, composer=2000):
    p = browser.new_page(viewport={'width': 3072, 'height': 1559})
    p.set_default_timeout(6000)
    p.on('pageerror', lambda e: result['errors'].append(str(e)))
    p.set_content('''<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="require-trusted-types-for 'script'; trusted-types 'none'"></head><body></body></html>''')
    for f in ['browser_harness', 'chatgpt_new_chat_fixture']:
        p.evaluate((R / '.test_dist' / f'{f}.js').read_text())
    version = json.loads((R / 'manifest.json').read_text())['version']
    p.evaluate('(v)=>chrome.runtime.getManifest=()=>({version:v})', '1.67.0' if old else version)
    p.evaluate('(d)=>__newChatFixture.build(d)', delayed)
    update(p, conversation, composer)
    code = R / '.test_new_chat_baseline/fixtures/legacy_new_chat_width.js' if old else R / 'dist/content_script.js'
    p.evaluate(code.read_text())
    settle(p)
    return p

try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=args.chromium, headless=True, args=['--no-sandbox'])
        result['browser'] = b.version
        p = load(b, old=True)
        before, before_report = measure(p), report(p)
        d = report(p, 'chatgpt-width:diagnose')
        assert before['composer']['width'] == 800 and before['form']['width'] == 768, before
        assert before_report['composer'] == [] and before_report['conversation'] == [], before_report
        assert d['counts']['main']['total'] == 2 and d['counts']['modernWidthToken']['total'] == 4, d['counts']
        assert d['counts']['modernWidthToken']['rendered'] == 1, d['counts']
        assert d['counts']['forms']['total'] == d['counts']['editable']['total'] == 1
        p.screenshot(path=str(O / 'new_chat_before.png'))
        p.locator('button[type=submit]').click(); settle(p)
        old_thread = measure(p)
        assert old_thread['composer']['width'] == old_thread['conversation']['width'] == 2000, old_thread
        record('legacy_fails_before_message_but_works_after_message', {'newChat': before, 'inspection': before_report, 'thread': old_thread})
        p.close()

        p = load(b)
        after, after_report = measure(p), report(p)
        assert after['composer']['width'] == 2000 and after['form']['width'] == 1968, after
        assert after['editor']['width'] > before['editor']['width'] + 1100
        assert after_report['conversation'] == [] and len(after_report['composer']) == 1, after_report
        assert after_report['composer'][0]['width'] == 2000 and after['overflow'] == 0
        assert after['heading'] == before['heading'] and after['suggestions'] == before['suggestions']
        p.screenshot(path=str(O / 'new_chat_after.png'))
        record('new_chat_real_carrier_form_editor_expand_before_first_message', {'before': before, 'after': after, 'inspection': after_report})
        d = report(p, 'chatgpt-width:diagnose')
        assert d['counts']['reportedNewChatComposerLane']['visibleUnderInspectionRules'] == 1
        assert d['counts']['reportedComposerLane']['total'] == d['counts']['reportedConversationLane']['total'] == 0
        expected_version = json.loads((R / 'manifest.json').read_text())['version']
        # The code revision is the last change to this module, not every extension release.
        revision = re.search(r"contentScriptRevision:\s*['\"]([^'\"]+)", (R / 'src/content_script.ts').read_text())
        assert revision is not None
        assert d['contentScriptRevision'] == revision.group(1) and d['extensionVersion'] == expected_version
        assert all(item['selectorSupported'] for item in d['counts'].values())
        record('diagnostics_distinguish_landing_and_thread', d['counts'])

        for a,c in [(2000,0),(0,2000),(640,1600),(1600,640),(0,0),(1280,1040)]:
            update(p,a,c);g=measure(p)
            assert g['composer']['width'] == (c or 800) and g['form']['width'] == (c or 800)-32, g
            assert report(p)['conversation'] == [], report(p)
        record('composer_setting_independent_of_conversation_on_landing')
        p.locator('.ProseMirror').click(); p.keyboard.type('KEEP_DRAFT_ABC')
        p.evaluate('window.savedEditor=__newChatFixture.refs.editor')
        state = lambda: p.evaluate('({same:savedEditor===__newChatFixture.refs.editor,focus:document.activeElement===savedEditor,text:savedEditor.textContent,offset:getSelection().anchorOffset})')
        initial = state(); update(p,2000,2000)
        assert state() == initial
        assert 'KEEP_DRAFT_ABC' not in json.dumps(report(p,'chatgpt-width:diagnose'))
        record('draft_node_focus_caret_preserved_and_diagnostic_has_no_text')
        with p.expect_file_chooser() as chooser:
            p.get_by_role('button',name='시험 파일 선택').click()
        assert not chooser.value.is_multiple()
        record('real_file_chooser_unaffected')

        p.locator('button[type=submit]').click(); settle(p);g=measure(p)
        assert g['composer']['width'] == g['conversation']['width'] == 2000 and g['submissions'] == 1, g
        assert p.evaluate('savedEditor===__newChatFixture.refs.editor')
        assert len(report(p)['composer']) == len(report(p)['conversation']) == 1
        update(p,1280,1040);g=measure(p)
        assert g['conversation']['width'] == 1280 and g['composer']['width'] == 1040, g
        record('first_submission_uses_existing_thread_css_and_same_form',g)
        for _ in range(3):
            p.evaluate('__newChatFixture.toNewChat()');settle(p)
            assert measure(p)['composer']['width'] == 1040 and report(p)['conversation'] == []
            p.evaluate('__newChatFixture.toThread()');settle(p)
            assert measure(p)['conversation']['width'] == 1280 and measure(p)['composer']['width'] == 1040
        assert len(measure(p)['sheets']) == 2
        record('three_landing_thread_roundtrips_no_duplicate_styles')
        p.close()

        p = load(b, delayed=True)
        assert report(p)['composer'] == []
        p.evaluate('__newChatFixture.refs.main.append(__newChatFixture.refs.delayedStage)');settle(p)
        assert measure(p)['composer']['width'] == 2000
        record('late_landing_insertion_uses_css_without_new_observer');p.close()

        p = load(b)
        sizes=[]
        for width in [360,480,900,1280,1920,2560,3072]:
            p.set_viewport_size({'width':width,'height':1000});settle(p);g=measure(p)
            assert abs(g['composer']['width']-min(2000,g['column']['width']))<1,g
            assert g['overflow']==0,g
            sizes.append({'viewport':width,'available':g['column']['width'],'composer':g['composer']['width'],'form':g['form']['width']})
        record('narrow_to_wide_measured_parent_width_no_overflow',sizes)
        p.evaluate('__newChatFixture.refs.split.style.width="900px"');settle(p);g=measure(p)
        assert g['composer']['width'] < 2000 and abs(g['composer']['width']-g['column']['width'])<1 and g['overflow']==0,g
        record('split_pane_parent_bound_not_viewport',g);p.close()

        p = load(b)
        for tag,role in [('aside',''),('nav',''),('dialog',''),('section','dialog'),('section','navigation')]:
            p.evaluate('([t,r])=>__newChatFixture.addUnrelated(t,r)',[tag,role])
        snapshot=lambda:p.locator('.fx-unrelated').evaluate_all('(es)=>es.map(e=>[...e.querySelectorAll("[class*=max-w-]")].map(x=>x.getBoundingClientRect().width))')
        native=snapshot();update(p,640,640)
        assert snapshot()==native and len(report(p)['composer'])==1
        record('matching_structures_in_sidebar_dialog_navigation_untouched')
        p.close()

        p = load(b)
        # Previous-message editors and arbitrary forms do not acquire composer sizing.
        p.evaluate('''() => {const f=__newChatFixture,turn=document.createElement('article');turn.dataset.turn='user';const copy=f.refs.dock.cloneNode(true);turn.append(copy);f.refs.column.append(turn);window.editCopy=copy;}''')
        unchanged=p.evaluate('editCopy.querySelector("[class*=max-w-]").getBoundingClientRect().width')
        update(p,2000,640)
        assert p.evaluate('editCopy.querySelector("[class*=max-w-]").getBoundingClientRect().width')==unchanged
        assert len(report(p)['composer'])==1
        record('previous_message_edit_is_not_new_chat_composer');p.close()

        for case,command in [
            ('not_role_main', '__newChatFixture.refs.scroll.removeAttribute("role")'),
            ('not_landing_column', '__newChatFixture.refs.column.classList.remove("basis-5/9")'),
            ('not_editor_role', '__newChatFixture.refs.editor.removeAttribute("role")'),
            ('not_width_carrier', '__newChatFixture.refs.composer.classList.remove("px-toolbar")')]:
            p=load(b);p.evaluate(command);settle(p)
            assert report(p)['composer']==[] and measure(p)['composer']['width']==800,measure(p)
            record('unverified_relationship_'+case);p.close()

        p=load(b)
        p.evaluate('__newChatFixture.refs.editor.contentEditable="false"');settle(p)
        assert measure(p)['composer']['width']==2000
        p.evaluate('__newChatFixture.refs.editor.setAttribute("contenteditable", "")');settle(p)
        assert measure(p)['composer']['width']==2000
        p.evaluate('__newChatFixture.refs.editor.removeAttribute("contenteditable");__newChatFixture.refs.editor.parentElement.contentEditable="true"');settle(p)
        assert measure(p)['composer']['width']==2000
        assert p.evaluate('__newChatFixture.refs.editor.isContentEditable')
        record('temporarily_readonly_empty_and_inherited_editability_keep_composer_width');p.close()

        p=load(b);p.evaluate('__newChatFixture.refs.stage.hidden=true');settle(p)
        assert report(p)['composer']==[]
        p.evaluate('__newChatFixture.refs.stage.hidden=false');settle(p)
        assert report(p)['composer'][0]['width']==2000
        record('hidden_landing_is_not_reported_and_reappears_at_saved_width')
        update(p,0,0)
        p.evaluate('document.documentElement.style.setProperty("--thread-body-max-width","920px")');settle(p)
        assert measure(p)['composer']['width']==920 and measure(p)['sheets']==[]
        update(p,2000,1600);update(p,0,0)
        assert measure(p)['composer']['width']==920 and measure(p)['sheets']==[]
        record('reset_uses_current_site_default_not_historical_800')
        p.close(); b.close()
    assert not result['errors'],result['errors']
    result['passed']=True
except Exception:
    result['failure']=traceback.format_exc();print(result['failure'],flush=True);raise
finally:
    (O/'chatgpt_new_chat_results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
