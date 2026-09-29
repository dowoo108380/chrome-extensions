"""Description behavior in real Chromium DOM. YouTube markup/lifecycle and Chrome APIs are fixtures.
Only host/watch/video identity predicates are adapted in memory. Native click results,
trusted manual input, visibility, observers and timers run unchanged under Trusted Types CSP.
"""
from pathlib import Path
import argparse
import json
import re
import traceback
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--chromium', required=True)
parser.add_argument('--source-dir', type=Path, default=ROOT / 'dist')
parser.add_argument('--output', type=Path, default=ROOT / '.test_results/description.json')
args = parser.parse_args()
report = {'scope': __doc__, 'tests': {}, 'pageErrors': [], 'passed': False}

BUILD = r'''options => {
  window.__descriptionRoute = {key:'description_a',watch:true};
  const root=LayoutRegressionFixture.description;
  root.replaceChildren();
  const d=window.__desc={root,opens:0,closes:0,nestedClicks:0,ready:true,delay:options.delay||0};
  const style=document.createElement('style');
  style.textContent=`
    .description-fixture {display:block}
    .description-fixture > [data-full] {display:none!important}
    .description-fixture[is-expanded] > [data-full],
    ytd-expander.description-fixture:not([collapsed]) > [data-full] {display:block!important}
    .description-fixture > #collapse,.description-fixture > #less {display:none!important}
    .description-fixture[is-expanded] > #expand,
    ytd-expander.description-fixture:not([collapsed]) > #more {display:none!important}
    .description-fixture[is-expanded] > #collapse,
    ytd-expander.description-fixture:not([collapsed]) > #less {display:inline-block!important}
  `;
  document.head.append(style);
  d.make=(legacy=false,canonical=true)=>{
    const node=document.createElement(legacy?'ytd-expander':'ytd-text-inline-expander');
    node.className='description-fixture';
    if(canonical && !legacy) node.id='description-inline-expander';
    if(legacy) node.setAttribute('collapsed','');
    const preview=document.createElement('p');preview.textContent='Description preview';
    const full=document.createElement('p');full.setAttribute('data-full','');full.textContent='Complete description';
    const open=document.createElement('button');open.id=legacy?'more':'expand';open.textContent='Show more';
    const close=document.createElement('button');close.id=legacy?'less':'collapse';close.textContent='Show less';
    const set=value=>legacy?node.toggleAttribute('collapsed',!value):node.toggleAttribute('is-expanded',value);
    open.addEventListener('click',()=>{
      d.opens++;
      if(d.ready) {if(d.delay) setTimeout(()=>set(true),d.delay);else set(true);}
    });
    close.addEventListener('click',()=>{d.closes++;set(false)});
    node.append(preview,full,open,close);
    return {node,open,close,full,set};
  };
  d.replace=()=>{
    const next=d.make(!!options.legacy,options.canonical!==false);
    if(d.node)d.node.replaceWith(next.node);else root.append(next.node);
    Object.assign(d,next);
  };
  d.replace();
  if(options.expanded)d.set(true);
}'''
READ = '''() => ({opens:__desc.opens,closes:__desc.closes,nestedClicks:__desc.nestedClicks,
  expanded:__desc.node.localName==='ytd-expander'?!__desc.node.hasAttribute('collapsed'):__desc.node.hasAttribute('is-expanded'),
  fullVisible:__desc.full.getClientRects().length>0,
  status:globalThis.__browserToolboxYouTubeLayoutV1__?.getStatus()})'''


def source():
    code = (args.source_dir / 'youtube_layout.js').read_text(encoding='utf-8')
    for name, value in [('isYouTubePage', 'true'), ('isWatchPage', 'globalThis.__descriptionRoute.watch')]:
        code, count = re.subn(r'    function ' + name + r'\(\) \{.*?(?:\n    \}| \})',
                             f'    function {name}() {{ return {value}; }}', code, count=1, flags=re.S)
        assert count == 1, name
    code, count = re.subn(r'const videoKey = \(\) => [^\n]+;',
                         'const videoKey = () => globalThis.__descriptionRoute.key;', code, count=1)
    assert count == 1
    return code


def setup(browser, prepare='', **options):
    page = browser.new_page(viewport={'width': 1440, 'height': 960})
    page.set_default_timeout(4500)
    page.on('pageerror', lambda error: report['pageErrors'].append(str(error)))
    page.set_content('''<!doctype html><html><head><meta charset="utf-8">
      <meta http-equiv="Content-Security-Policy" content="require-trusted-types-for 'script'; trusted-types 'none';">
      </head><body></body></html>''')
    for name in ['layout_regression_fixture', 'browser_harness']:
        page.evaluate((ROOT / '.test_dist' / f'{name}.js').read_text(encoding='utf-8'))
    page.evaluate('LayoutRegressionFixture.build()')
    page.evaluate(BUILD, options)
    page.evaluate('tabs=>Object.assign(__test.settings,{youtubeDescriptionExpandedEnabled:true,youtubeLayoutTabsEnabled:tabs})', options.get('tabs', False))
    page.evaluate((ROOT / 'dist/toolbox_shared.js').read_text(encoding='utf-8'))
    page.evaluate('css=>{const s=document.createElement("style");s.textContent=css;document.head.append(s)}',
                  (ROOT / 'youtube_layout.css').read_text(encoding='utf-8'))
    if prepare:
        page.evaluate(prepare)
    page.evaluate(source())
    return page


def opened(page):
    page.wait_for_function('''() => __desc.node.localName==='ytd-expander'
        ?!__desc.node.hasAttribute('collapsed'):__desc.node.hasAttribute('is-expanded')''')
    state = page.evaluate(READ)
    assert state['fullVisible'], state
    return state


def quiet(page, milliseconds=900):
    page.wait_for_timeout(milliseconds)
    return page.evaluate(READ)


def case(name, action):
    try:
        report['tests'][name] = {'passed': True, 'observed': action()}
        print('PASS', name, flush=True)
    except Exception:
        report['tests'][name] = {'passed': False, 'error': traceback.format_exc()}
        print('FAIL', name, flush=True)
    finally:
        for context in list(browser.contexts):
            context.close()


with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=args.chromium, headless=True)
    report['browser'] = browser.version

    def normal():
        page = setup(browser)
        state = opened(page)
        assert state['opens'] == 1, state
        page.evaluate('__test.update({youtubeDescriptionExpandedEnabled:false})')
        state = quiet(page)
        assert not state['expanded'] and state['closes'] == 1, state
        return state
    case('normal_expands_and_disable_restores', normal)

    def nested():
        page = setup(browser, '''() => {
          const nested=__desc.make();nested.node.removeAttribute('id');
          nested.open.addEventListener('click',()=>__desc.nestedClicks++);
          __desc.node.insertBefore(nested.node,__desc.open);
        }''')
        state = opened(page)
        assert state['opens'] == 1 and state['nestedClicks'] == 0, state
        return state
    case('nested_expander_does_not_veto_description', nested)

    def hidden_duplicate():
        page = setup(browser, '''() => {
          const more=document.createElement('button');more.id='more';more.hidden=true;
          more.addEventListener('click',()=>__desc.nestedClicks++);__desc.node.append(more);
        }''')
        state = opened(page)
        assert state['opens'] == 1 and state['nestedClicks'] == 0, state
        return state
    case('hidden_duplicate_control_is_ignored', hidden_duplicate)

    case('nested_legacy_expander_supported', lambda: opened(setup(browser, legacy=True)))

    def delayed_attribute(attribute):
        page = setup(browser, f'__desc.open.setAttribute("{attribute}","true")')
        assert quiet(page, 180)['opens'] == 0
        page.evaluate('attribute=>__desc.open.removeAttribute(attribute)', attribute)
        return opened(page)
    case('disabled_control_becomes_ready', lambda: delayed_attribute('disabled'))
    case('aria_disabled_control_becomes_ready', lambda: delayed_attribute('aria-disabled'))

    def delayed_wrapper():
        page = setup(browser, '''() => {
          const wrapper=document.createElement('div');wrapper.hidden=true;
          __desc.open.before(wrapper);wrapper.append(__desc.open);__desc.wrapper=wrapper;
        }''')
        assert quiet(page, 180)['opens'] == 0
        page.evaluate('__desc.wrapper.hidden=false')
        return opened(page)
    case('native_button_wrapper_becomes_visible', delayed_wrapper)

    def stylesheet_ready():
        page = setup(browser, '''() => {
          const s=document.createElement('style');s.textContent='.description-fixture{display:none!important}';
          document.head.append(s);__desc.sheet=s;
        }''')
        assert quiet(page, 180)['opens'] == 0
        page.evaluate('__desc.sheet.sheet.deleteRule(0)')
        return opened(page)
    case('stylesheet_only_readiness_without_layout_tabs', stylesheet_ready)

    def early_click():
        page = setup(browser, '__desc.ready=false')
        assert quiet(page, 180)['opens'] == 1
        page.evaluate('__desc.ready=true')
        state = opened(page)
        assert state['opens'] == 2, state
        return state
    case('early_ignored_click_recovers_after_initialization', early_click)

    def delayed_result():
        page = setup(browser, delay=450)
        opened(page)
        state = quiet(page)
        assert state['opens'] == 1, state
        return state
    case('asynchronous_success_is_not_clicked_twice', delayed_result)

    def bounded():
        page = setup(browser, '__desc.ready=false')
        first = quiet(page, 3300)
        state = quiet(page, 1200)
        assert 1 <= state['opens'] <= 3 and state['opens'] == first['opens'], state
        assert not state['expanded'] and state['status']['description'] == 'unverified', state
        assert state['status']['descriptionIssue'], state
        return state
    case('unresponsive_control_stops_with_truthful_status', bounded)

    def manual_replacement():
        page = setup(browser)
        opened(page)
        page.locator('#description-inline-expander > #collapse').click()
        page.evaluate('__desc.replace()')
        state = quiet(page)
        assert state['opens'] == 1 and not state['expanded'], state
        assert state['status']['description'] == 'user-controlled', state
        page.evaluate('__test.update({youtubeDescriptionExpandedEnabled:false})')
        quiet(page, 80)
        page.evaluate('__test.update({youtubeDescriptionExpandedEnabled:true})')
        state = quiet(page)
        assert state['opens'] == 1 and not state['expanded'], state
        return state
    case('manual_collapse_survives_node_replacement_and_settings', manual_replacement)

    def same_video_navigation():
        page = setup(browser)
        opened(page)
        page.locator('#description-inline-expander > #collapse').click()
        page.evaluate('document.dispatchEvent(new Event("yt-navigate-start"));document.dispatchEvent(new Event("yt-navigate-finish"))')
        state = quiet(page)
        assert state['opens'] == 1 and not state['expanded'], state
        page.evaluate('''document.dispatchEvent(new Event('yt-navigate-start'));
            __descriptionRoute.key='description_b';__desc.replace();
            document.dispatchEvent(new Event('yt-navigate-finish'));''')
        state = opened(page)
        assert state['opens'] == 2, state
        return state
    case('same_video_keeps_manual_choice_next_video_expands', same_video_navigation)

    def native_reset():
        page = setup(browser, expanded=True)
        assert quiet(page, 180)['opens'] == 0
        page.evaluate('__desc.set(false)')
        state = opened(page)
        assert state['opens'] == 1, state
        return state
    case('initial_expanded_state_does_not_mask_native_reset', native_reset)

    def hidden_info():
        page = setup(browser, tabs=True)
        opened(page)
        page.locator('#btx-tab-comments').click()
        page.evaluate('__desc.replace()')
        quiet(page, 200)
        page.locator('#btx-tab-info').click()
        state = opened(page)
        assert state['opens'] == 2, state
        page.locator('#btx-tab-comments').click()
        page.evaluate('__test.update({youtubeDescriptionExpandedEnabled:false})')
        state = quiet(page)
        assert not state['expanded'] and state['status']['selected'] == 'comments', state
        return state
    case('deferred_info_tab_expands_and_hidden_restore_preserves_selection', hidden_info)

    def ambiguous():
        page = setup(browser, '''() => {
          const rival=__desc.make(false,false);__desc.root.append(rival.node);
        }''', canonical=False)
        state = quiet(page)
        assert state['opens'] == 0 and not state['expanded'], state
        return state
    case('two_visible_description_candidates_are_not_guessed', ambiguous)

    def media():
        page = setup(browser, '''() => {
          const video=document.createElement('video');__desc.node.append(video);
          __desc.originalVideo=video;
        }''')
        state = opened(page)
        assert page.evaluate('__desc.originalVideo.parentElement===__desc.node')
        return state
    case('description_with_media_can_expand_without_relocation', media)

    def disable_pending():
        page = setup(browser, '__desc.ready=false')
        first = quiet(page, 180)
        page.evaluate('__test.update({youtubeDescriptionExpandedEnabled:false});__desc.ready=true')
        state = quiet(page, 1800)
        assert state['opens'] == first['opens'] and not state['expanded'], state
        return state
    case('disable_cancels_pending_retry', disable_pending)

    browser.close()

report['passed'] = all(case['passed'] for case in report['tests'].values()) and not report['pageErrors']
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f"{sum(case['passed'] for case in report['tests'].values())}/{len(report['tests'])} description cases passed.", flush=True)
raise SystemExit(0 if report['passed'] else 1)
