"""Real Chromium keyboard, zoom-equivalent CSS viewports and forced-colors checks; Chrome APIs are fixtures."""
from pathlib import Path
import argparse,json,re,traceback
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--chromium',required=True);args=parser.parse_args()
report={'scope':__doc__,'passed':False,'tests':{},'errors':[]}
html=(ROOT/'popup.html').read_text(encoding='utf-8');scripts=re.findall(r'<script\s+src="([^"]+)"',html)
html=re.sub(r'<script\s+src="[^"]+"[^>]*></script>','',html)
html=html.replace('<link rel="stylesheet" href="popup.css">','<style>'+(ROOT/'popup.css').read_text(encoding='utf-8')+'</style>')
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path=args.chromium,headless=True);report['browser']=browser.version
  for width,height,forced in [(780,600,False),(390,300,False),(390,600,True)]:
   page=browser.new_page(viewport={'width':width,'height':height},forced_colors='active' if forced else 'none');page.on('pageerror',lambda e:report['errors'].append(str(e)))
   page.set_content(html)
   for file in ['browser_harness.js','popup_harness.js']:page.evaluate((ROOT/'.test_dist'/file).read_text(encoding='utf-8'))
   for file in scripts:page.evaluate((ROOT/file).read_text(encoding='utf-8'))
   page.wait_for_function('document.documentElement.dataset.popupControlsReady==="true"')
   observations=[]
   for section in ['media','youtube','captions','tabs','page','chat','settings']:
    page.locator('#nav-'+section).click()
    # The document bootstraps popup auto-sizing; its inner panel adapts to the viewport.
    box=page.locator('#view-'+section).evaluate('(e)=>{const r=e.getBoundingClientRect(),panel=document.querySelector(".panel").getBoundingClientRect(),footer=document.querySelector(".app-footer").getBoundingClientRect();return {width:e.clientWidth,scroll:e.scrollWidth,right:r.right,panelWidth:panel.width,panelHeight:panel.height,footerBottom:footer.bottom,x:scrollX,y:scrollY}}')
    assert box['scroll']<=box['width']+1 and box['right']<=width and box['panelWidth']<=width, (width,section,box)
    assert box['panelHeight']<=height and box['footerBottom']<=height and box['x']==0 and box['y']==0, (height,section,box)
    observations.append(box)
   page.locator('#nav-media').focus();page.keyboard.press('End');assert page.locator('#nav-settings').evaluate('(e)=>document.activeElement===e')
   page.keyboard.press('Home');assert page.locator('#nav-media').evaluate('(e)=>document.activeElement===e')
   focus=page.locator('#nav-media').evaluate('(e)=>({style:getComputedStyle(e).outlineStyle,width:getComputedStyle(e).outlineWidth})');assert focus['style']!='none' and focus['width']!='0px',focus
   page.keyboard.press('Control+k');assert page.locator('#popup-search').evaluate('(e)=>document.activeElement===e')
   page.locator('#popup-search').fill('배속');page.keyboard.press('Escape');assert not page.locator('.search-results').is_visible()
   report['tests'][f'{width}x{height}_forced_{forced}']={'passed':True,'sections':observations,'focus':focus};print('PASS',width,height,forced,flush=True)
   page.screenshot(path=str(ROOT/f'.test_results/accessibility_{width}_{height}_{forced}.png'));page.close()
  browser.close();report['passed']=not report['errors']
except Exception:report['failure']=traceback.format_exc();print(report['failure'],flush=True)
(ROOT/'.test_results/accessibility.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
raise SystemExit(0 if report['passed'] else 1)
