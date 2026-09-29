"""Caption parsing regressions with real browser-enforced Trusted Types.

This is an explicit COMPONENT test: the host guard alone is changed in in-memory
copies, player/fetch are fixtures, Chrome scripting is covered by Node doubles,
and cross-world transport is relayed to a separate browser document. The parser
and the pipeline are the actual compiled code. It does not claim a live YouTube
or an installed MV3 integration test. No policy is disabled or bypassed.
"""
from pathlib import Path
import argparse, base64, json, re, shutil, traceback, uuid, time
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
args_parser = argparse.ArgumentParser(description=__doc__)
args_parser.add_argument('--chromium', default=shutil.which('chromium') or shutil.which('chrome'))
args = args_parser.parse_args()
if not args.chromium:
    args_parser.error('Provide --chromium with an existing Chrome/Chromium executable.')
OUT = ROOT / '.test_results'
OUT.mkdir(exist_ok=True)
fixture_source = (ROOT / '.test_dist/caption_security_fixture.js').read_text()
helper_source = (ROOT / 'dist/youtube_caption_text_bridge.js').read_text()
legacy_source = (ROOT / '.test_dist/caption_baseline/legacy_caption_page_task.js').read_text()
new_source = (ROOT / 'dist/youtube_transcript_page_task.js').read_text()

def local_copy(source):
    changed, count = re.subn(r'function isYoutubePage\(\) \{.*?\n    \}',
        'function isYoutubePage() { return true; }', source, count=1, flags=re.S)
    assert count == 1, 'The only in-memory test patch must be the unique host guard.'
    return changed

media = 'data:video/webm;base64,' + base64.b64encode((ROOT/'tests/fixtures/test.webm').read_bytes()).decode()
STRICT = "require-trusted-types-for 'script'; trusted-types 'none'"
# The helper document represents the extension's separate CSP. It is not a real
# extension ISOLATED world and must never be reported as such.
HELPER_CSP = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
TEMPLATE = '''<!doctype html><html><head><meta charset="utf-8">{csp}<title>Caption security test</title></head><body>
<div id="movie_player" class="html5-video-player" style="position:relative;width:640px;height:360px">
<video muted preload="auto" src="{media}" style="width:640px;height:360px"></video></div><div id="counter"></div></body></html>'''
expected = [
    {'startMs': 0, 'durationMs': 2000, 'text': '첫 자막 & 한국어'},
    {'startMs': 2000, 'durationMs': 2000, 'text': 'Second © "quote" 😀'},
    {'startMs': 4000, 'durationMs': 3000, 'text': '셋째 자막'}
]
cases = {
 'json3': {'mime':'application/json', 'format':'json3', 'text': json.dumps({'events':[
     {'tStartMs':0,'dDurationMs':2000,'segs':[{'utf8':'첫 <b>자막</b> &amp; 한국어'}]},
     {'tStartMs':2000,'dDurationMs':2000,'segs':[{'utf8':'Second &copy; &quot;quote&quot; &#x1F600;'}]},
     {'tStartMs':4000,'dDurationMs':3000,'segs':[{'utf8':'셋째 자막'}]}
 ]}, ensure_ascii=False)},
 'xml': {'mime':'text/xml', 'format':'srv1', 'text': '<transcript><text start="0" dur="2">첫 자막 &amp; 한국어</text><text start="2" dur="2">Second &#169; &quot;quote&quot; &#x1F600;</text><text start="4" dur="3">셋째 자막</text></transcript>'},
 'srv3': {'mime':'text/xml', 'format':'srv3', 'text': '<timedtext><body><p t="0" d="2000"><s>첫 자막 &amp; </s><s>한국어</s></p><p t="2000" d="2000">Second &#169; &quot;quote&quot; &#x1F600;</p><p t="4000" d="3000">셋째 자막</p></body></timedtext>'},
 'vtt': {'mime':'text/vtt', 'format':'vtt', 'text': 'WEBVTT\n\n00:00.000 --> 00:02.000\n<v speaker>첫 <b>자막</b> &amp; 한국어</v>\n\n00:02.000 --> 00:04.000\n<c.style>Second &copy; &quot;quote&quot; &#x1F600;</c>\n\n00:04.000 --> 00:07.000\n셋째 자막\n'}
}
results = {'environment': {'scope':'local Chromium components, NOT installed MV3 / actual YouTube',
    'page_csp':STRICT, 'parser_csp':HELPER_CSP,
    'transport':'mocked across two real browser documents; production uses same-document MAIN/ISOLATED CustomEvents',
    'fixtures':'mocked player and fetch; real video/TextTrack/cues; only isYoutubePage patched in memory',
    'csp_bypassed':False, 'trusted_type_policy_created':False}, 'tests':{}, 'errors':[], 'passed':False}

def record(name, value):
    results['tests'][name] = value
    print('PASS:', name, flush=True)

def configure(browser, source, case, strict=True, overlay=False):
    page = browser.new_page(viewport={'width':900,'height':650})
    page.set_default_timeout(10000)
    page.on('pageerror', lambda err: results['errors'].append(str(err)))
    page.set_content(TEMPLATE.format(csp=f'<meta http-equiv="Content-Security-Policy" content="{STRICT}">' if strict else '', media=media))
    page.wait_for_function('document.querySelector("video").readyState >= 2')
    page.evaluate('''() => {window.__policyViolations=[]; document.addEventListener("securitypolicyviolation", e => __policyViolations.push(e.violatedDirective));}''')
    if overlay:
        page.evaluate((ROOT/'.test_dist/browser_harness.js').read_text())
        page.evaluate((ROOT/'dist/toolbox_shared.js').read_text())
        page.evaluate((ROOT/'dist/youtube_synced_caption_overlay.js').read_text())
    page.evaluate(fixture_source)
    page.evaluate('__captionFixture', case)
    page.evaluate(local_copy(source) + "\nglobalThis.youtubeTranscriptPageTask = youtubeTranscriptPageTask; void 0;")
    return page

def helper(browser):
    page=browser.new_page()
    page.set_content(f'<!doctype html><meta http-equiv="Content-Security-Policy" content="{HELPER_CSP}"><title>Parser fixture</title>')
    page.evaluate(fixture_source)
    page.evaluate(helper_source + "\nglobalThis.youtubeCaptionTextBridge = youtubeCaptionTextBridge; void 0;")
    return page

connections = {}

def connect(page, parser_page):
    channel=str(uuid.uuid4())
    assert parser_page.evaluate('o => youtubeCaptionTextBridge(o)', {'action':'install','channelId':channel}) == {'ok':True,'installed':True}
    connections[page] = parser_page
    page.evaluate('__captionRelay', channel)
    return channel

def operation(page, op, channel=None):
    task={'operation':op,'trackIndex':0,'trackId':'.en','expectedVideoId':'fixture'}
    if channel: task['captionTextChannelId']=channel
    page.evaluate("""task => {
      window.__captionResult = null;
      window.__captionFailure = null;
      void youtubeTranscriptPageTask(task).then(result => {window.__captionResult=result;}, error => {window.__captionFailure=String(error);});
    }""", task)
    deadline = time.monotonic() + 28
    while time.monotonic() < deadline:
        requests = page.evaluate('(window.__captionRequests ?? []).splice(0)')
        for request in requests:
            reply = connections[page].evaluate('a => __captionParse(a[0],a[1])', [request['channelId'],request['detail']])
            page.evaluate("""a => document.dispatchEvent(new CustomEvent(`browser-toolbox-caption-text-response:${a[0]}`,{detail:a[1]}))""", [request['channelId'],reply])
        state = page.evaluate('({result:window.__captionResult,error:window.__captionFailure})')
        if state['error']: raise AssertionError(state['error'])
        if state['result'] is not None: return state['result']
        page.wait_for_timeout(20)
    raise AssertionError('Caption operation did not finish in 28 seconds.')

def dispose(parser_page, channel):
    value=parser_page.evaluate('o => youtubeCaptionTextBridge(o)', {'action':'dispose','channelId':channel})
    assert value == {'ok':True,'installed':False}
    assert parser_page.evaluate('globalThis.__browserToolboxCaptionTextBridgesV1?.size ?? 0') == 0

try:
  with sync_playwright() as api:
    browser=api.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox'])
    results['environment']['browser']=browser.version
    # First reproduce the reported failure using the UNCHANGED 1.51/1.52 pipeline.
    p=configure(browser, legacy_source, {**cases['xml'],'captured':True})
    legacy=operation(p,'transcript')
    assert legacy['ok'] is False and 'TrustedHTML' in legacy['error'], legacy
    record('legacy_full_capture_pipeline_reproduces_TrustedHTML',legacy)
    p.close()
    for name,case in cases.items():
        p=configure(browser,legacy_source,case,strict=False)
        baseline=operation(p,'transcript')
        assert baseline.get('entries')==expected, (name,baseline)
        p.close()
        for captured in [False,True]:
            p=configure(browser,new_source,{**case,'captured':captured})
            h=helper(browser);channel=connect(p,h)
            result=operation(p,'transcript',channel)
            assert result.get('entries')==baseline['entries'], (name,result)
            p.wait_for_timeout(30)
            assert p.evaluate('__policyViolations') == [], p.evaluate('__policyViolations')
            assert p.evaluate('trustedTypes.defaultPolicy === null') is True
            dispose(h,channel)
            record(f'{name}_strict_'+('captured' if captured else 'direct'),{'entries':result['entries'],'format':result['format'],'legacy_normal_policy_equal':True,'security_violations':[],'helper_cleaned':True})
            p.close();h.close()
    # Test the REAL same-document CustomEvent boundary between two V8 worlds too.
    # Generic CDP worlds inherit page CSP, unlike extension ISOLATED worlds, so
    # this additional boundary check deliberately has no TT policy. The strict
    # MAIN pipeline / independent parser policy is checked separately above.
    for name in ["json3", "xml"]:
        p=configure(browser,new_source,cases[name],strict=False)
        cdp=p.context.new_cdp_session(p)
        frame=cdp.send('Page.getFrameTree')['frameTree']['frame']['id']
        world=cdp.send('Page.createIsolatedWorld',{'frameId':frame,'worldName':'Caption parser transport regression'})['executionContextId']
        channel=str(uuid.uuid4())
        install=helper_source+'\nyoutubeCaptionTextBridge('+json.dumps({'action':'install','channelId':channel})+');'
        installed=cdp.send('Runtime.evaluate',{'contextId':world,'expression':install,'returnByValue':True})
        assert installed.get('result',{}).get('value')=={'ok':True,'installed':True},installed
        assert p.evaluate('typeof globalThis.__browserToolboxCaptionTextBridgesV1')=='undefined'
        parsed=operation(p,'transcript',channel)
        assert parsed.get('entries')==expected,parsed
        cleaned=cdp.send('Runtime.evaluate',{'contextId':world,'expression':'youtubeCaptionTextBridge('+json.dumps({'action':'dispose','channelId':channel})+');','returnByValue':True})
        assert cleaned.get('result',{}).get('value')=={'ok':True,'installed':False},cleaned
        record('same_document_two_worlds_native_events_'+name,{'entries':parsed['entries'],'transport':'real same-document CustomEvents','csp':'not enforced in this boundary-only check','not_an_installed_extension':True})
        p.close()
    # Actual TextTrack installation, cue activation during 4x playback and rendered text.
    p=configure(browser,new_source,cases['json3'],overlay=True)
    h=helper(browser);channel=connect(p,h)
    applied=operation(p,'synced-caption-apply',channel)
    assert applied.get('ok') is True and applied['syncedCaption']['active'],applied
    initial=p.evaluate('__captionSnapshot()')
    assert initial['mode']=='hidden' and len(initial['cues'])==3 and initial['cc']=='false',initial
    dispose(h,channel)
    p.evaluate('''async () => { const v=document.querySelector('video');v.currentTime=0;v.playbackRate=4;await v.play(); }''')
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        current = p.evaluate('() => document.querySelector("video").currentTime')
        if 2.3 < current < 3.8: break
        p.wait_for_timeout(20)
    else: raise AssertionError('Actual 4x media playback did not reach the second cue.')
    p.evaluate('document.querySelector("video").pause()')
    p.wait_for_timeout(60)
    observed=p.evaluate('__test.caption()')
    assert observed['text']==expected[1]['text'] and observed['active']==[expected[1]['text']] and observed['rate']==4,observed
    p.screenshot(path=str(OUT/'caption_trusted_types.png'))
    removed=operation(p,'synced-caption-remove')
    assert removed['ok'] and p.evaluate('__captionSnapshot().cc')=='true'
    assert p.evaluate('__captionSnapshot().cues.length')==0
    assert p.evaluate('__policyViolations')==[]
    record('strict_extract_apply_actual_four_speed_render_and_remove',{'applied':applied,'observed':observed,'removed':removed,'security_violations':[]})
    p.close();h.close()
    # Missing bridge is an explicit failure, not "no subtitles" or automatic UI fallback.
    p=configure(browser,new_source,cases['json3'])
    missing=operation(p,'transcript')
    assert missing['ok'] is False and '준비되지' in missing['error']
    assert len(p.evaluate('__captionSnapshot().calls'))==1
    record('missing_parser_fails_without_format_or_UI_fallback',missing);p.close()
    # Malformed XML is reported, not silently treated as a successful empty response.
    p=configure(browser,new_source,{**cases['xml'],'text':'<transcript><text>broken</transcript>'})
    h=helper(browser);channel=connect(p,h)
    malformed=operation(p,'transcript',channel)
    assert malformed['ok'] is False and 'XML' in malformed['error'], malformed
    dispose(h,channel)
    record('malformed_XML_explicit_failure_and_cleanup',malformed);p.close();h.close()
    # Data decoder must not execute scripts, fetch images/frames or upgrade custom elements.
    h=helper(browser);requests=[];h.on('request',lambda request:requests.append(request.url))
    channel=str(uuid.uuid4());h.evaluate('o=>youtubeCaptionTextBridge(o)',{'action':'install','channelId':channel})
    h.evaluate('''()=>{window.__executions=0;customElements.define('x-caption-probe',class extends HTMLElement{constructor(){super();window.__executions++}})}''')
    attack='<b>Safe</b> &amp; &#x1F600;<img src="https://caption-probe.invalid/image" onerror="window.__executions++"><iframe src="https://caption-probe.invalid/frame"></iframe><script>window.__executions++</script><x-caption-probe></x-caption-probe>'
    req={'requestId':channel+':1','operation':'decode-texts','texts':[attack]}
    reply=json.loads(h.evaluate('a=>__captionParse(a[0],a[1])',[channel,json.dumps(req)]))
    h.wait_for_timeout(100)
    assert reply['ok'] and h.evaluate('__executions')==0 and requests==[]
    assert h.locator('img,iframe,script,x-caption-probe').count()==0
    dtd={'requestId':channel+':2','operation':'parse-xml','text':'<!DOCTYPE transcript [<!ENTITY x "x">]><transcript><text start="0">&x;</text></transcript>'}
    denied=json.loads(h.evaluate('a=>__captionParse(a[0],a[1])',[channel,json.dumps(dtd)]))
    assert not denied['ok'] and 'DOCTYPE' in denied['error']
    # Reinstallation is idempotent and explicit disposal removes the registry.
    h.evaluate('o=>youtubeCaptionTextBridge(o)',{'action':'install','channelId':channel})
    assert h.evaluate('__browserToolboxCaptionTextBridgesV1.size')==1
    dispose(h,channel)
    record('inert_decoder_no_execution_requests_live_nodes_or_DTD',{'executions':0,'requests':requests,'live_source_nodes':0,'dtd_response':denied,'registry_after_dispose':0})
    h.close()
    assert results['errors']==[],results['errors']
    results['passed']=True
    browser.close()
except Exception:
    results['errors'].append(traceback.format_exc())
    traceback.print_exc()
finally:
    (OUT/'caption_security_results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
    print('RESULT:', results['passed'], 'checks:',len(results['tests']),flush=True)
if not results['passed']:
    raise SystemExit(1)
