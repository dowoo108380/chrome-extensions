"""Caption cancellation/deadline/resource bounds against the actual page task.
Only the YouTube host guard is adapted; local player/fetch are controlled fixtures.
This is a component test, not a live YouTube request.
"""
from pathlib import Path
import argparse, json, re, shutil, time, uuid
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--chromium',default=shutil.which('chromium') or shutil.which('chrome'))
args=parser.parse_args()
if not args.chromium: parser.error('Provide --chromium.')
report={'scope':__doc__,'tests':{},'pageErrors':[]}
source=(ROOT/'dist/youtube_transcript_page_task.js').read_text(encoding='utf-8')
source,count=re.subn(r'function isYoutubePage\(\) \{.*?\n    \}', 'function isYoutubePage() { return true; }', source,count=1,flags=re.S)
assert count==1
source+='\nglobalThis.youtubeTranscriptPageTask=youtubeTranscriptPageTask;globalThis.abortYouTubeCaptionTask=abortYouTubeCaptionTask;void 0;'
fixture=(ROOT/'.test_dist/caption_security_fixture.js').read_text(encoding='utf-8')
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path=args.chromium,headless=True)
 report['browser']=browser.version
 for mode in ['headers_deadline','body_deadline','navigation_cancel','explicit_cancel','cancel_before_start','declared_size_limit','stream_size_limit']:
  page=browser.new_page();page.set_default_timeout(2500)
  page.on('pageerror',lambda error:report['pageErrors'].append(str(error)))
  try:
   page.set_content('<!doctype html><div id="movie_player" class="html5-video-player"><video></video></div>')
   page.evaluate(fixture);page.evaluate('__captionFixture({format:"json3",mime:"application/json",text:"{}"})')
   page.evaluate("""mode=>{
    window.auditFetchCalls=0;window.auditStreamCancelled=false;window.auditSignal=null;
    window.fetch=(_url,options)=>{
     auditFetchCalls++;auditSignal=options?.signal;
     if(mode==='headers_deadline'||mode==='navigation_cancel'||mode==='explicit_cancel'||mode==='cancel_before_start') return new Promise(()=>{});
     if(mode==='declared_size_limit') return Promise.resolve(new Response('x',{headers:{'content-length':String(9*1024*1024)}}));
     const body=new ReadableStream({
      start(controller){ if(mode==='stream_size_limit')controller.enqueue(new Uint8Array(8*1024*1024+1)); },
      cancel(){auditStreamCancelled=true;}
     });
     return Promise.resolve(new Response(body));
    };window.auditOriginalFetch=fetch;
   }""",mode)
   page.evaluate(source)
   task_id=str(uuid.uuid4())
   task={'operation':'transcript','trackIndex':0,'trackId':'.en','expectedVideoId':'fixture','taskId':task_id}
   start=time.monotonic()
   page.evaluate("""args=>{
    const [task,mode]=args;task.deadline=Date.now()+(mode.endsWith('deadline')?250:1800);
    if(mode==='cancel_before_start')abortYouTubeCaptionTask(task.taskId);
    window.auditResult=null;
    void youtubeTranscriptPageTask(task).then(result=>window.auditResult=result);
    if(mode==='navigation_cancel')setTimeout(()=>document.dispatchEvent(new Event('yt-navigate-start')),60);
    if(mode==='explicit_cancel')setTimeout(()=>abortYouTubeCaptionTask(task.taskId),60);
   }""",[task,mode])
   page.wait_for_function('auditResult!==null')
   observed=page.evaluate("""()=>({result:auditResult,fetchCalls:auditFetchCalls,signalAborted:auditSignal?.aborted??null,streamCancelled:auditStreamCancelled,registrySize:globalThis.__browserToolboxCaptionTasksV1?.size??0,fetchRestored:fetch===auditOriginalFetch,cc:document.querySelector('.ytp-subtitles-button').getAttribute('aria-pressed')})""")
   observed['elapsedMs']=round((time.monotonic()-start)*1000)
   assert observed['result']['ok'] is False,observed
   assert observed['registrySize']==0 and observed['fetchRestored'] and observed['cc']=='true',observed
   assert observed['elapsedMs']<1500,observed
   if mode=='cancel_before_start':assert observed['fetchCalls']==0,observed
   if mode.endswith('deadline') or mode in ['navigation_cancel','explicit_cancel']:assert observed['signalAborted'],observed
   if mode in ['body_deadline','stream_size_limit']:assert observed['streamCancelled'],observed
   if mode.endswith('size_limit'):assert '크기' in observed['result']['error'],observed
   report['tests'][mode]={'passed':True,'observed':observed};print('PASS',mode,flush=True)
  except Exception as error:
   report['tests'][mode]={'passed':False,'error':str(error)};print('FAIL',mode,str(error)[:1200],flush=True)
  finally:page.close()
 browser.close()
report['passed']=all(item['passed'] for item in report['tests'].values()) and not report['pageErrors']
out=ROOT/'.test_results/caption_lifecycle.json';out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
raise SystemExit(0 if report['passed'] else 1)

