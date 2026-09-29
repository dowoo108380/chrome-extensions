"""Real Chromium, intercepted YouTube routes and fixture-owned native behavior.
Production route checks, DOM moves and CSS are unchanged; Chrome storage is mocked.
This suite does not assert coverage of YouTube's live servers.
"""
import argparse
import json
import math
import traceback
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--chromium', required=True)
parser.add_argument('--source', type=Path, default=ROOT)
parser.add_argument('--case', default='')
parser.add_argument('--output', type=Path)
args = parser.parse_args()
OUT = ROOT / '.test_results/live-chat-20260930'
OUT.mkdir(parents=True, exist_ok=True)
report = {'scope': __doc__, 'tests': {}, 'pageErrors': [], 'passed': False}
SETTINGS = dict(youtubeLayoutTabsEnabled=True, youtubePanelScrollEnabled=True,
                youtubeCommentStatusEnabled=True, youtubeNativePanelsEnabled=True)
CHAT_HTML = '''<!doctype html><meta charset="utf-8"><style>
html,body{height:100%;margin:0;background:#161616;color:#eee;font:14px Arial}
body{display:flex;flex-direction:column}h3{margin:0;padding:14px}
#messages{flex:1;min-height:0;overflow:auto}p{padding:10px;margin:0}
input{box-sizing:border-box;width:100%;padding:14px;flex:none}
</style><h3>Local chat fixture</h3><div id="messages">''' + ''.join(
    f'<p>Fixture message {n}</p>' for n in range(80)) + '</div><input id="draft" aria-label="Draft">'
CHAT_SETUP = r'''() => {
  const host = document.createElement('ytd-live-chat-frame'); host.id = 'chat';
  const frame = document.createElement('iframe'); frame.id = 'chatframe';frame.title='Local live chat';
  window.chatLoads=0;frame.addEventListener('load',()=>window.chatLoads++);
  const toggle=document.createElement('button');toggle.id='show-hide-button';toggle.textContent='Show / hide chat';
  toggle.onclick=()=>host.toggleAttribute('collapsed');host.append(frame,toggle);
  const origin=document.querySelector('#secondary-inner');origin.insertBefore(host,origin.firstChild);
  window.chatHost=host;window.chatFrame=frame;window.chatOrigin=origin;window.chatNext=host.nextSibling;
  // Native navigation of the existing context, with no iframe src attribute.
  frame.contentWindow.location.replace('/live_chat?continuation=fixture');
}'''
SNAPSHOT = r'''() => {
  const status=window.__browserToolboxYouTubeLayoutV1__?.getStatus();
  const host=window.chatHost,frame=window.chatFrame,root=document.scrollingElement;
  const box=n=>{if(!n)return null;const r=n.getBoundingClientRect();return {
    left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
  return {status,tabs:[...document.querySelectorAll('.btx-tabs-header button')].filter(n=>!n.hidden).map(n=>n.id),
    chatParent:host?.parentElement?.id,sameFrame:host?.querySelector('iframe')===frame,
    sameDocument:frame?.contentDocument===window.chatDocument,
    draft:frame?.contentDocument?.querySelector('#draft')?.value,
    innerScroll:frame?.contentDocument?.querySelector('#messages')?.scrollTop,
    loads:window.chatLoads,initialLoads:window.initialChatLoads,
    restored:host?.parentElement===window.chatOrigin&&host?.nextSibling===window.chatNext,
    chat:box(host),frame:box(frame),width:root.scrollWidth,viewportWidth:root.clientWidth,
    mediaRate:LayoutRegressionFixture.mainVideo.playbackRate,
    originalMedia:LayoutRegressionFixture.mainVideo===document.querySelector('#movie_player video')};
}'''


def route_request(route):
    route.fulfill(status=200, content_type='text/html', body=CHAT_HTML
                  if urlsplit(route.request.url).path == '/live_chat' else
                  '<!doctype html><meta charset="utf-8"><title>Local live layout fixture</title>')


def remember_chat(page):
    page.wait_for_function("window.chatFrame?.contentDocument?.querySelector('#draft')")
    page.evaluate('''()=>{window.chatDocument=chatFrame.contentDocument;window.initialChatLoads=chatLoads;
      chatDocument.querySelector('#draft').value='unsent fixture draft'}''')


def setup(browser, path='/live/live_fixture', live=True, chat=True, no_dvr=False, collapsed=False, apply=True):
    page = browser.new_page(viewport={'width': 1800, 'height': 1000})
    page.set_default_timeout(7000)
    page.on('pageerror', lambda error: report['pageErrors'].append(str(error)))
    page.route('**/*', route_request)
    page.goto('https://www.youtube.com' + path)
    for name in ['layout_regression_fixture', 'scroll_regression_fixture', 'playlist_fixture',
                 'theater_fixture', 'width_fixture', 'player_viewport_fixture', 'browser_harness']:
        page.evaluate((ROOT / '.test_dist' / f'{name}.js').read_text(encoding='utf-8'))
    page.evaluate("PlayerViewportFixture.build({mode:'responsive'})")
    route = urlsplit(path)
    key = route.path.split('/')[2] if route.path.startswith('/live/') else parse_qs(route.query)['v'][0]
    page.evaluate('''o=>{
      const f=LayoutRegressionFixture;f.watch.setAttribute('video-id',o.key);f.mainVideo.playbackRate=1.75;
      if(o.live){f.watch.setAttribute('should-stamp-chat','');f.comments.remove()}
      if(o.noDvr)document.querySelector('.ytp-progress-bar').hidden=true;
      const style=document.createElement('style');style.textContent=`
        ytd-live-chat-frame#chat{display:flex;flex-direction:column;height:780px;min-height:700px;border:1px solid #555}
        ytd-live-chat-frame#chat>iframe{width:100%;height:100%;min-height:0;flex:1;border:0}
        ytd-live-chat-frame#chat>button{flex:none;height:32px}
        ytd-live-chat-frame#chat[collapsed]{height:32px;min-height:32px}
        ytd-live-chat-frame#chat[collapsed]>iframe{display:none}`;document.head.append(style);
    }''', {'key': key, 'live': live, 'noDvr': no_dvr})
    if chat:
        page.evaluate(CHAT_SETUP)
        remember_chat(page)
        if collapsed:
            page.evaluate("chatHost.setAttribute('collapsed','')")
    page.evaluate('s=>Object.assign(__test.settings,s)', SETTINGS)
    page.evaluate((args.source / 'dist/toolbox_shared.js').read_text(encoding='utf-8'))
    page.evaluate('css=>{const s=document.createElement("style");s.textContent=css;document.head.append(s)}',
                  (args.source / 'youtube_layout.css').read_text(encoding='utf-8'))
    if apply:
        page.evaluate((args.source / 'dist/youtube_layout.js').read_text(encoding='utf-8'))
        page.wait_for_timeout(350)
    return page


def snapshot(page):
    return page.evaluate(SNAPSHOT)


def attached(page):
    r = snapshot(page)
    assert r['status']['supportedWatchPage'] and r['chatParent'] == 'btx-pane-chat', r
    assert r['tabs'] == ['btx-tab-info', 'btx-tab-chat', 'btx-tab-playlist', 'btx-tab-videos'], r
    assert r['status']['layout'] == 'applied' and not r['status']['yieldingToNativePanel'], r
    assert r['sameFrame'] and r['sameDocument'] and r['loads'] == r['initialLoads'], r
    assert r['draft'] == 'unsent fixture draft', r
    assert r['status']['pageFlow']['contentSized'] and r['status']['pageFlow']['widthSizingReason'] == 'compact', r
    assert r['width'] == r['viewportWidth'] and r['mediaRate'] == 1.75 and r['originalMedia'], r
    return r


def select(page, name):
    page.locator('#btx-tab-' + name).click()
    page.wait_for_timeout(70)


def check(name, action):
    if args.case and args.case not in name:
        return
    try:
        report['tests'][name] = {'passed': True, 'observed': action()}
        print('PASS', name, flush=True)
    except Exception:
        failure = traceback.format_exc()
        report['tests'][name] = {'passed': False, 'failure': failure}
        print('FAIL', name, failure, flush=True)


with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=args.chromium, headless=True)
    report['browser'] = browser.version

    def direct_routes():
        results = []
        for path in ['/live/live_fixture', '/live/live_fixture/?v=wrong', '/watch?v=live_fixture']:
            page = setup(browser, path)
            r = attached(page)
            assert r['status']['selected'] == 'chat' and r['chat']['height'] > 300 and r['chat']['bottom'] < 1000, r
            assert r['frame']['bottom'] <= r['chat']['bottom'] + 1, r
            results.append(r)
            page.close()
        return results
    check('live_and_watch_routes_replace_comments_without_gutters', direct_routes)

    def state_preserved():
        page = setup(browser)
        attached(page)
        page.frame_locator('#chatframe').locator('#messages').evaluate('n=>n.scrollTop=360')
        for name in ['info', 'videos', 'playlist', 'chat']:
            select(page, name)
        r = attached(page)
        assert r['innerScroll'] == 360, r
        page.locator('#btx-tab-info').focus()
        page.keyboard.press('ArrowRight')
        assert snapshot(page)['status']['selected'] == 'chat'
        page.keyboard.press('ArrowRight')
        assert snapshot(page)['status']['selected'] == 'playlist'
        select(page, 'chat')
        page.screenshot(path=str(OUT / 'live-chat-layout.png'))
        for _ in range(2):
            page.evaluate('__test.update({youtubeLayoutTabsEnabled:false})')
            page.wait_for_timeout(100)
            restored = snapshot(page)
            assert restored['restored'] and restored['sameDocument'] and restored['loads'] == restored['initialLoads'], restored
            page.evaluate('__test.update({youtubeLayoutTabsEnabled:true})')
            page.wait_for_timeout(150)
            attached(page)
        page.close()
        return r
    check('iframe_draft_scroll_keyboard_and_exact_restore', state_preserved)

    def no_dvr():
        page = setup(browser, no_dvr=True)
        r = attached(page)
        assert r['status']['pageFlow']['playerSizing']['viewportFit']['state'] == 'native-boxes-match', r
        page.close()
        return r
    check('live_without_seek_bar_still_expands', no_dvr)

    def native_collapse():
        page = setup(browser, collapsed=True)
        attached(page)
        assert not page.locator('#chatframe').is_visible()
        for visible in [True, False]:
            page.locator('#show-hide-button').click()
            page.wait_for_timeout(100)
            assert page.locator('#chatframe').is_visible() == visible
        r = attached(page)
        page.close()
        return r
    check('native_collapsed_chat_is_not_forced_open', native_collapse)

    def absent_and_late():
        results = []
        for manual in [False, True]:
            page = setup(browser, chat=False)
            first = snapshot(page)
            assert first['status']['pageFlow']['contentSized'] and 'btx-tab-comments' not in first['tabs'], first
            assert page.locator('#btx-tab-chat').get_attribute('aria-disabled') == 'true'
            assert '댓글' not in page.locator('.btx-layout-status').inner_text()
            if manual:
                select(page, 'info')
            page.evaluate(CHAT_SETUP)
            remember_chat(page)
            page.wait_for_timeout(180)
            r = attached(page)
            assert r['status']['selected'] == ('info' if manual else 'chat'), r
            results.append(r)
            page.close()
        return results
    check('missing_and_delayed_chat_preserve_flow_and_user_selection', absent_and_late)

    def normal_video():
        page = setup(browser, '/watch?v=recorded', live=False, chat=False)
        r = snapshot(page)
        assert r['tabs'] == ['btx-tab-info', 'btx-tab-comments', 'btx-tab-playlist', 'btx-tab-videos'], r
        assert r['status']['layout'] == 'applied' and r['status']['discussion'] == 'comments', r
        page.close()
        return r
    check('ordinary_video_keeps_comments', normal_video)

    def native_modes():
        page = setup(browser)
        attached(page)
        for theater in [True, False, True, False]:
            page.evaluate('v=>{LayoutRegressionFixture.watch.toggleAttribute("theater",v);chatOrigin.moveBefore(chatHost,null)}', theater)
            page.wait_for_timeout(160)
            r = snapshot(page)
            assert r['chatParent'] == 'btx-pane-chat' and r['sameDocument'] and r['loads'] == r['initialLoads'], r
        r = attached(page)
        page.set_viewport_size({'width': 800, 'height': 900})
        page.wait_for_timeout(150)
        narrow = snapshot(page)
        assert narrow['sameDocument'] and narrow['width'] == narrow['viewportWidth'], narrow
        assert narrow['chat']['height'] <= 900 * .65 + 1, narrow
        page.set_viewport_size({'width': 1800, 'height': 1000})
        page.wait_for_timeout(180)
        attached(page)
        page.close()
        return {'normal': r, 'narrow': narrow}
    check('theater_relocations_and_responsive_chat_preserve_frame', native_modes)

    def spa_navigation():
        page = setup(browser, '/watch?v=recorded', live=False, chat=False)
        page.evaluate('''()=>{document.dispatchEvent(new Event('yt-navigate-start'));
          history.pushState({},'', '/live/next_live');
          LayoutRegressionFixture.watch.setAttribute('video-id','next_live');
          LayoutRegressionFixture.watch.setAttribute('should-stamp-chat','');LayoutRegressionFixture.comments.remove()}''')
        page.evaluate(CHAT_SETUP)
        remember_chat(page)
        page.evaluate("document.dispatchEvent(new Event('yt-navigate-finish'))")
        page.wait_for_timeout(200)
        live = attached(page)
        page.evaluate('''()=>{document.dispatchEvent(new Event('yt-navigate-start'));chatHost.remove();
          history.pushState({},'', '/watch?v=recorded_again');const f=LayoutRegressionFixture;
          f.watch.setAttribute('video-id','recorded_again');f.watch.removeAttribute('should-stamp-chat');
          document.querySelector('#below').append(f.comments);document.dispatchEvent(new Event('yt-navigate-finish'))}''')
        page.wait_for_timeout(200)
        recorded = snapshot(page)
        assert recorded['status']['layout'] == 'applied' and recorded['status']['discussion'] == 'comments', recorded
        assert 'btx-tab-chat' not in recorded['tabs'] and 'btx-tab-comments' in recorded['tabs'], recorded
        assert page.locator('#btx-youtube-tabs').count() == 1
        page.close()
        return {'live': live, 'recorded': recorded}
    check('spa_recorded_live_recorded_rebinds_discussion', spa_navigation)

    def protected_chat():
        page = setup(browser, apply=False)
        page.evaluate("chatHost.append(document.createElement('video'))")
        page.evaluate((args.source / 'dist/youtube_layout.js').read_text(encoding='utf-8'))
        page.wait_for_timeout(150)
        r = snapshot(page)
        assert r['chatParent'] == 'secondary-inner' and r['status']['sections']['chat']['state'] == 'protected', r
        assert r['sameDocument'] and r['loads'] == r['initialLoads'], r
        page.close()
        return r
    check('unexpected_media_is_preserved_in_native_chat_location', protected_chat)

    def scroll_metrics(page):
        return page.evaluate('''() => {
          const root=document.scrollingElement,host=document.querySelector('#btx-youtube-tabs');
          const metadata=document.querySelector('ytd-watch-metadata');
          return {range:root.scrollHeight-root.clientHeight,scrollY,
            paneHeight:host?.style.getPropertyValue('--btx-pane-height'),
            metadataMargin:getComputedStyle(metadata).marginBottom,
            metadataBottom:metadata.getBoundingClientRect().bottom+scrollY,
            bodyOverflow:getComputedStyle(document.body).overflowY,
            rootOverflow:getComputedStyle(root).overflowY,
            frameSame:chatFrame.contentDocument===chatDocument,loads:chatLoads-initialChatLoads};
        }''')

    def trailing_scroll_space():
        page = setup(browser, apply=False)
        # A native metadata margin can collapse through wrappers and empty
        # siblings. The visible content fits; only the reserved tail overflows.
        page.evaluate('''() => {
          const metadata=document.querySelector('ytd-watch-metadata');
          metadata.style.marginBottom='24px';
          const wrapper=document.createElement('div');metadata.before(wrapper);wrapper.append(metadata);
          wrapper.after(document.createElement('div'));
          const teaser=document.createElement('button');teaser.id='fixture-chat-entry';
          teaser.textContent='Existing native chat entry';teaser.style.cssText='display:block;height:68px;width:100%';
          metadata.append(teaser);
        }''')
        page.evaluate((args.source / 'dist/youtube_layout.js').read_text(encoding='utf-8'))
        page.wait_for_timeout(250)
        bottom = page.locator('ytd-watch-metadata').evaluate('n=>n.getBoundingClientRect().bottom+scrollY')
        page.set_viewport_size({'width': 1800, 'height': math.ceil(bottom + 14)})
        page.evaluate('window.scrollTo(0,0)')
        page.wait_for_timeout(180)
        fitted = scroll_metrics(page)
        assert fitted['range'] == 0, fitted
        page.mouse.move(200, 200)
        page.mouse.wheel(0, 1400)
        page.wait_for_timeout(100)
        assert scroll_metrics(page)['scrollY'] == 0
        assert page.locator('#fixture-chat-entry').is_visible()
        # The chat's existing message scroller remains independently usable.
        messages=page.frame_locator('#chatframe').locator('#messages')
        messages.hover()
        page.mouse.wheel(0, 400)
        page.wait_for_timeout(150)
        assert messages.evaluate('n=>n.scrollTop') > 0
        assert scroll_metrics(page)['scrollY'] == 0
        page.evaluate('__test.update({youtubeLayoutTabsEnabled:false})')
        page.wait_for_timeout(120)
        restored = scroll_metrics(page)
        assert restored['metadataMargin'] == '24px' and restored['frameSame'] and restored['loads'] == 0, restored
        page.evaluate('__test.update({youtubeLayoutTabsEnabled:true})')
        page.wait_for_timeout(160)
        assert scroll_metrics(page)['range'] == 0, scroll_metrics(page)
        page.close()
        return {'fitted':fitted,'restored':restored}
    check('scroll_space_from_collapsed_metadata_margin_removed', trailing_scroll_space)

    def stable_scroll_height():
        page=setup(browser)
        page.evaluate('''() => {
          const content=document.createElement('div');content.id='fixture-real-extra-content';
          content.style.height='700px';content.textContent='Real page content that must remain reachable';
          document.querySelector('#below').append(content);
        }''')
        page.wait_for_timeout(120)
        before=scroll_metrics(page)
        assert before['range'] > 100, before
        page.mouse.move(200,200)
        page.mouse.wheel(0,450)
        page.wait_for_timeout(160)
        after=scroll_metrics(page)
        assert after['scrollY'] > 0, after
        assert after['paneHeight'] == before['paneHeight'], {'before':before,'after':after}
        assert after['range'] == before['range'], {'before':before,'after':after}
        assert after['frameSame'] and after['loads'] == 0, after
        assert after['rootOverflow'] not in ['hidden','clip'] and after['bodyOverflow'] not in ['hidden','clip'], after
        page.locator('#fixture-real-extra-content').scroll_into_view_if_needed()
        assert page.locator('#fixture-real-extra-content').is_visible()
        page.close()
        return {'before':before,'after':after}
    check('scroll_does_not_grow_chat_or_clip_real_content', stable_scroll_height)

    def scroll_margin_mode_restore():
        page=setup(browser)
        page.locator('ytd-watch-metadata').evaluate("n=>n.style.marginBottom='24px'")
        page.wait_for_timeout(100)
        normal=scroll_metrics(page)
        assert normal['metadataMargin'] == '0px', normal
        page.evaluate("LayoutRegressionFixture.watch.setAttribute('theater','')")
        page.wait_for_timeout(120)
        theater=scroll_metrics(page)
        assert theater['metadataMargin'] == '24px', theater
        page.evaluate("LayoutRegressionFixture.watch.removeAttribute('theater')")
        page.wait_for_timeout(140)
        assert scroll_metrics(page)['metadataMargin'] == '0px'
        page.set_viewport_size({'width':800,'height':900})
        page.wait_for_timeout(140)
        narrow=scroll_metrics(page)
        assert narrow['metadataMargin'] == '24px', narrow
        page.set_viewport_size({'width':1800,'height':1000})
        page.wait_for_timeout(140)
        restored=scroll_metrics(page)
        assert restored['metadataMargin'] == '0px' and restored['frameSame'] and restored['loads'] == 0, restored
        page.close()
        return {'normal':normal,'theater':theater,'narrow':narrow,'restored':restored}
    check('scroll_margin_policy_restores_on_theater_and_narrow_views', scroll_margin_mode_restore)
    browser.close()

report['passed'] = bool(report['tests']) and all(t['passed'] for t in report['tests'].values()) and not report['pageErrors']
filename = 'results.json' if args.source.resolve() == ROOT else 'baseline-results.json'
output = args.output or OUT / filename
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'passed': report['passed'], 'cases': len(report['tests']), 'pageErrors': report['pageErrors']}, ensure_ascii=False))
raise SystemExit(0 if report['passed'] else 1)
