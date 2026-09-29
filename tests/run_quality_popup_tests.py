"""Actual popup files/rendering/input with Chrome API doubles, not an installed extension."""
from pathlib import Path
import argparse,json,re,shutil,traceback
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parents[1]
a=argparse.ArgumentParser(description=__doc__);a.add_argument('--chromium',default=shutil.which('chromium'));args=a.parse_args()
if not args.chromium:a.error('Provide an installed browser.')
O=R/'.test_results';O.mkdir(exist_ok=True)
h=(R/'popup.html').read_text();scripts=re.findall(r'<script\b[^>]*\bsrc="([^"]+)"[^>]*>',h)
h=re.sub(r'<script\b[^>]*>\s*</script>','',h);h=re.sub(r'<link\b[^>]*href="popup.css"[^>]*>',lambda _:'<style>'+(R/'popup.css').read_text()+'</style>',h)
r={'environment':{'scope':'local Chromium actual popup HTML/CSS/compiled TypeScript; Chrome APIs/selected quality are mocked'},'tests':{},'errors':[],'passed':False}
def record(k,v=True):r['tests'][k]=v;print('PASS',k,flush=True)
def load(b,dark=False):
 p=b.new_page(viewport={'width':780,'height':600},color_scheme='dark' if dark else 'light');p.set_default_timeout(5000);p.on('pageerror',lambda e:r['errors'].append(str(e)));p.set_content(h)
 for f in ['browser_harness.js','popup_harness.js']:p.evaluate((R/'.test_dist'/f).read_text())
 p.evaluate('''()=>{window.__qualityPopupCalls=[];window.__qualityPopupReply={state:'selected',detail:'YouTube 메뉴에서 1080p 선택을 확인했습니다.',selectedLabel:'1080p',selectionVerified:true,decodedWidth:1280,decodedHeight:720,availableChoices:[{height:1080,label:'1080p'},{height:720,label:'720p'}]};chrome.tabs.sendMessage=(id,m,o,cb)=>{__qualityPopupCalls.push({id,message:m,options:o});queueMicrotask(()=>cb({ok:true,result:__qualityPopupReply}))};}''')
 p.evaluate('(v)=>{chrome.runtime.getManifest=()=>({version:v,name:"Browser Toolbox"})}',json.loads((R/'manifest.json').read_text())['version'])
 for f in scripts:p.evaluate((R/f).read_text())
 p.wait_for_timeout(200);p.locator('#nav-youtube').click();p.wait_for_timeout(120);return p
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox']);r['environment']['browser']=b.version
  p=load(b);assert p.locator('#youtube-quality-auto').is_checked()==False;assert p.locator('#youtube-quality-height').input_value()=='1080';assert p.locator('#youtube-quality-height option').count()==9;record('defaults_off_and_nine_preferred_resolutions')
  p.locator('#youtube-quality-height').focus()
  for _ in range(2):p.locator('#youtube-quality-height').focus();p.keyboard.press('ArrowDown');p.wait_for_timeout(100)
  assert p.evaluate('__test.settings.youtubePreferredQualityHeight')==2160
  p.locator('label.switch:has(#youtube-quality-auto)').click();p.wait_for_timeout(80);assert p.evaluate('__test.settings.youtubePreferredQualityEnabled')==True
  p.locator('label.switch:has(#youtube-quality-premium)').click();p.wait_for_timeout(80);assert p.evaluate('__test.settings.youtubeQualityPremiumPreferred')==False;record('trusted_inputs_save_individual_preference_keys')
  p.evaluate('__test.update({youtubePreferredQualityHeight:4320,youtubeQualityPremiumPreferred:true})');p.wait_for_timeout(80);assert p.locator('#youtube-quality-height').input_value()=='4320';assert p.locator('#youtube-quality-premium').is_checked();record('storage_changed_updates_menu_without_reopen')
  p.evaluate('__test.faults.write=true');p.locator('#youtube-quality-height').focus();p.keyboard.press('ArrowUp');p.wait_for_timeout(100);assert p.locator('#youtube-quality-status').get_attribute('data-error')=='true';assert p.locator('#youtube-quality-height').input_value()=='4320';assert p.evaluate('__test.settings.youtubePreferredQualityHeight')==4320;p.evaluate('__test.faults.write=false');record('failed_save_keeps_actual_stored_preference_and_reports_error')
  p.locator('#youtube-quality-details > summary').click();p.locator('#youtube-quality-inspect').click();p.wait_for_timeout(100);s=p.locator('#youtube-quality-status').inner_text();assert '1080p' in s and '1280 × 720' in s;assert p.evaluate('__qualityPopupCalls.at(-1).message.type')=='youtube-quality:status';record('native_menu_selection_and_decoded_size_reported_separately')
  p.locator('#youtube-quality-reapply').click();p.wait_for_timeout(100);assert p.evaluate('__qualityPopupCalls.at(-1).message.type')=='youtube-quality:reapply';record('only_explicit_reapply_button_requests_restart')
  p.locator('#popup-search').fill('선호 해상도');p.get_by_role('button',name='선호 해상도 YouTube',exact=False).first.click();p.wait_for_timeout(100);assert p.locator('#youtube-quality-height').is_visible();record('search_reveals_preferred_quality_without_changing_settings')
  for dark in [False,True]:
   q=load(b,dark);q.evaluate('__test.update({youtubePreferredQualityEnabled:true,youtubePreferredQualityHeight:2160})');q.wait_for_timeout(100)
   g=q.locator('#view-youtube').evaluate('(e)=>({clientWidth:e.clientWidth,scrollWidth:e.scrollWidth,documentWidth:document.documentElement.scrollWidth,card:document.querySelector("#youtube-quality-card").getBoundingClientRect().toJSON()})')
   assert g['scrollWidth']<=g['clientWidth'] and g['documentWidth']==780;record('quality_popup_'+('dark' if dark else 'light')+'_geometry',g)
   q.screenshot(path=str(O/('popup_quality_dark.png' if dark else 'popup_quality_light.png')));q.close()
  p.close();b.close();r['passed']=not r['errors']
except Exception:r['failure']=traceback.format_exc();print(r['failure'],flush=True)
finally:
 (O/'quality_popup_results.json').write_text(json.dumps(r,ensure_ascii=False,indent=2))
 if not r['passed']:raise SystemExit(1)
