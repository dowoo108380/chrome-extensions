"""Owned information-pane colors under native inline hover updates in real Chromium.
YouTube structure and pointer handlers are controlled fixtures based on observed inline
color changes. Chrome APIs and address predicates use the existing component harness.
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
parser.add_argument('--layout-css', type=Path, default=ROOT/'youtube_layout.css')
parser.add_argument('--output', type=Path, default=ROOT/'.test_results/info_hover.json')
args = parser.parse_args()
report = {'scope': __doc__, 'tests': {}, 'errors': [], 'passed': False}

NATIVE = r'''dark => {
  const f=LayoutRegressionFixture, root=f.description, expander=root.querySelector('ytd-text-inline-expander');
  const style=document.createElement('style');
  style.textContent=`
    :root {--fixture-text:#0f0f0f;--fixture-link:#065fd4;--fixture-card:#eee}
    :root[dark] {--fixture-text:#f1f1f1;--fixture-link:#3ea6ff;--fixture-card:#272727}
    #description {background:var(--fixture-card)}
    #description ytd-text-inline-expander {color:var(--fixture-text)}
    #description .fixture-native-link {color:var(--fixture-link)}
    #description .fixture-native-link:hover {text-decoration:underline}
  `;
  document.head.append(style);
  const paragraph=document.createElement('p'), body=document.createElement('span');
  body.id='hover-body';body.className='ytAttributedStringLinkInheritColor';body.textContent='Native description text ';
  const strong=document.createElement('strong');strong.id='hover-bold';strong.textContent='with emphasis';body.append(strong);
  const timestamp=document.createElement('a');timestamp.id='hover-timestamp';timestamp.className='fixture-native-link';
  timestamp.href='https://www.youtube.com/watch?v=fixture&t=35';timestamp.textContent='0:35';
  const chip=document.createElement('a');chip.id='hover-chip';chip.className='fixture-native-link';
  chip.href='https://www.youtube.com/watch?v=fixture_related';
  const label=document.createElement('span');label.id='hover-chip-label';label.className='ytAttributedStringLinkInheritColor';
  label.textContent='Linked video';chip.append(label);
  const accent=document.createElement('span');accent.id='hover-accent';accent.style.color='rgb(160, 85, 20)';accent.textContent='Authored accent';
  paragraph.append(body,document.createTextNode(' '),timestamp,document.createTextNode(' '),chip,document.createTextNode(' '),accent);
  expander.prepend(paragraph);
  const nativeColor=dark?'rgb(255, 255, 255)':'rgb(19, 19, 19)';
  const hoverColor=dark?'rgb(224, 251, 241)':'rgb(9, 54, 39)';
  const state=window.__hover={body,label,root,expander,nativeColor,hoverColor,clicks:0,entered:0};
  const paint=color=>{body.style.color=color;label.style.color=color};
  paint(nativeColor);
  root.addEventListener('mouseenter',()=>{state.entered++;paint(hoverColor)});
  root.addEventListener('mouseleave',()=>paint(nativeColor));
  for(const link of [timestamp,chip]) link.addEventListener('click',e=>{e.preventDefault();state.clicks++});
  const outside=document.createElement('span');outside.id='hover-outside';outside.className='ytAttributedStringLinkInheritColor';
  outside.textContent='Independent native card';outside.style.color='rgb(170, 60, 110)';
  document.querySelector('.native-card-outside').append(outside);
}'''
READ = r'''() => {
  const color=id=>getComputedStyle(document.getElementById(id)).color;
  return {colors:Object.fromEntries(['hover-body','hover-bold','hover-timestamp','hover-chip-label','hover-accent','hover-outside'].map(id=>[id,color(id)])),
    nativeParentColor:getComputedStyle(__hover.expander).color,
    inline:__hover.body.style.color,entered:__hover.entered,clicks:__hover.clicks,
    owned:__hover.root.getAttribute('data-btx-layout-owned'),parent:__hover.root.parentElement.id,
    expanded:__hover.expander.hasAttribute('is-expanded'),same:__hover.root===document.querySelector('#description'),
    background:getComputedStyle(__hover.root).backgroundColor,
    linkParentColor:getComputedStyle(document.getElementById('hover-chip')).color};
}'''

code=(ROOT/'dist/youtube_layout.js').read_text(encoding='utf-8')
for name in ['isYouTubePage','isWatchPage']:
    code,count=re.subn(r'    function '+name+r'\(\) \{.*?(?:\n    \}| \})',
                       f'    function {name}() {{ return true; }}',code,count=1,flags=re.S)
    assert count==1,name

with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=args.chromium,headless=True)
    report['browser']=browser.version
    for dark in [False,True]:
        for width in [1440,720]:
            name=('dark' if dark else 'light')+'_'+str(width)
            page=browser.new_page(viewport={'width':width,'height':960})
            page.set_default_timeout(6000)
            page.on('pageerror',lambda error:report['errors'].append(str(error)))
            try:
                page.set_content('''<!doctype html><html><head><meta charset="utf-8">
                  <meta http-equiv="Content-Security-Policy" content="require-trusted-types-for 'script'; trusted-types 'none';">
                  </head><body></body></html>''')
                for script in ['layout_regression_fixture','browser_harness']:
                    page.evaluate((ROOT/'.test_dist'/f'{script}.js').read_text(encoding='utf-8'))
                page.evaluate('dark=>LayoutRegressionFixture.build({dark})',dark)
                page.evaluate(NATIVE,dark)
                page.evaluate('Object.assign(__test.settings,{youtubeLayoutTabsEnabled:true,youtubeDescriptionExpandedEnabled:true,youtubePanelScrollEnabled:true})')
                page.evaluate((ROOT/'dist/toolbox_shared.js').read_text(encoding='utf-8'))
                page.evaluate('css=>{const s=document.createElement("style");s.textContent=css;document.head.append(s)}',args.layout_css.read_text(encoding='utf-8'))
                page.evaluate(code)
                page.wait_for_selector('#btx-pane-info > [data-btx-layout-owned="info"] ytd-text-inline-expander[is-expanded]')
                page.locator('#btx-youtube-tabs').scroll_into_view_if_needed()
                page.mouse.move(1,1)
                before=page.evaluate(READ)
                for target in ['#hover-body','#hover-timestamp','#hover-chip-label']:
                    page.locator(target).hover()
                    hover=page.evaluate(READ)
                    assert hover['colors']==before['colors'],{'before':before,'hover':hover,'target':target}
                    assert hover['inline']==page.evaluate('__hover.hoverColor'),hover
                assert hover['colors']['hover-body']==hover['nativeParentColor'],hover
                assert hover['colors']['hover-chip-label']==hover['linkParentColor'],hover
                assert hover['background']=='rgba(0, 0, 0, 0)' and hover['same'],hover
                for target in ['#hover-timestamp','#hover-chip']:
                    page.locator(target).click()
                assert page.evaluate('__hover.clicks')==2
                page.mouse.move(1,1)
                assert page.evaluate(READ)['colors']==before['colors']
                # Late inline writes must not re-tint an idle pane either.
                page.evaluate('__hover.body.style.color=__hover.hoverColor')
                assert page.evaluate(READ)['colors']==before['colors']
                page.locator('#collapse').click()
                page.wait_for_timeout(100)
                collapsed=page.evaluate(READ)
                assert not collapsed['expanded'] and collapsed['colors']==before['colors'],collapsed
                page.locator('#expand').click()
                page.locator('#btx-tab-comments').click()
                page.locator('#btx-tab-info').click()
                assert page.evaluate(READ)['colors']==before['colors']
                page.locator('#hover-timestamp').focus()
                assert page.locator('#hover-timestamp').evaluate('n=>n===document.activeElement')
                # Disabling layout releases the CSS scope and preserves native nodes/handlers.
                page.evaluate('__test.update({youtubeLayoutTabsEnabled:false})')
                page.wait_for_selector('ytd-watch-metadata #description')
                page.locator('#hover-body').hover()
                restored=page.evaluate(READ)
                assert restored['owned'] is None and restored['same'],restored
                assert restored['colors']['hover-body']==page.evaluate('__hover.hoverColor'),restored
                assert restored['colors']['hover-outside']==before['colors']['hover-outside'],restored
                report['tests'][name]={'passed':True,'before':before,'hover':hover,'restored':restored}
                print('PASS',name,flush=True)
            except Exception:
                report['tests'][name]={'passed':False,'error':traceback.format_exc()}
                print('FAIL',name,flush=True)
            finally:
                page.close()
    browser.close()

report['passed']=all(test['passed'] for test in report['tests'].values()) and not report['errors']
args.output.parent.mkdir(parents=True,exist_ok=True)
args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(f"{sum(test['passed'] for test in report['tests'].values())}/{len(report['tests'])} hover cases passed.",flush=True)
raise SystemExit(0 if report['passed'] else 1)
