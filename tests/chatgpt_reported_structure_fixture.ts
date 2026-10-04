/** Local reproduction of the USER'S 1.64.1 anonymized structural report.
 * Observed: element 26 -> 27 -> 18; element 0 -> ... -> 16 -> 17 -> 18.
 * These are width carriers under a reverse scrollport, with a ProseMirror
 * textbox/form in the absolute dock; old turn IDs and prompt IDs are absent.
 * The diagnostic does not contain text or a complete page/stylesheet. Native
 * styling, sample text, siblings outside those paths, and form actions below
 * are controlled fixtures, NOT a full/live ChatGPT capture.
 */
(() => {
  const w = globalThis as unknown as Record<string, any>;
  const bodyToken = 'max-w-(--thread-body-max-width)';
  const contentToken = 'max-w-(--thread-content-max-width)';
  // Observed on the live conversation page on 2026-10-04; replaces px-toolbar.
  const responsivePaddingToken = 'px-[var(--thread-body-inline-padding,var(--padding-toolbar))]';
  const carrierClasses = `relative flex flex-col mx-auto w-full ${bodyToken} px-toolbar`;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, classes = '', text = ''): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag); e.className = classes; e.textContent = text; return e;
  };
  const style = el('style');
  style.textContent = `
    :root { --thread-content-max-width:48rem; --thread-body-max-width:calc(48rem + 16px * 2); font-size:16px; color-scheme:dark; }
    * { box-sizing:border-box } html,body { margin:0; width:100%; height:100%; }
    body { background:#101114; color:#e9eaed; font:16px/1.6 system-ui,sans-serif; }
    .fixture-shell { display:flex; width:100%; height:100%; }
    .fixture-sidebar { width:340px; flex:none; padding:20px; background:#191a1e; }
    .fixture-host { flex:1; min-width:0; height:100%; }
    .fixture-main { display:flex; width:100%; height:100%; min-width:0; }
    .relative {position:relative} .absolute{position:absolute} .flex{display:flex} .flex-col{flex-direction:column}
    .flex-col-reverse{flex-direction:column-reverse} .h-full{height:100%} .min-h-full{min-height:100%}
    .min-h-0{min-height:0}.min-w-0{min-width:0}.flex-1{flex:1 1 0%}.w-full{width:100%}.mx-auto{margin-inline:auto}
    .overflow-y-auto{overflow-y:auto}.overflow-x-hidden{overflow-x:hidden}.overflow-x-clip{overflow-x:clip}.overflow-hidden{overflow:hidden}
    .contents{display:contents}.px-toolbar{padding-inline:16px}
    [class~="${bodyToken}"] { max-width:var(--thread-body-max-width); }
    [class~="${responsivePaddingToken}"] {
      --thread-body-max-width:calc(var(--thread-content-max-width) + var(--thread-body-inline-padding,20px) * 2);
      padding-inline:var(--thread-body-inline-padding,var(--padding-toolbar,20px));
    }
    [class~="${contentToken}"] { max-width:var(--thread-content-max-width); width:100%; margin-inline:auto; }
    .fixture-thread-flow {padding-top:40px;padding-bottom:130px;}
    .fixture-dock {bottom:20px;left:0;right:0;}
    .fixture-message {line-height:1.7;padding:20px 0;border-bottom:1px solid #32343a;}
    .fixture-message p{margin:8px 0;} .fixture-message h2{font-size:20px;}
    .fixture-grid { width:100%;display:grid;grid-template-columns:36px minmax(0,1fr) auto;gap:8px;padding:8px;background:#282a30;border-radius:24px; }
    .ProseMirror {min-height:36px;outline:none;padding:4px;flex:1 1 0%;position:relative;overflow-x:hidden;}
    form{margin:0}button{cursor:pointer;color:inherit;background:#393e48;border:0;border-radius:20px;padding:6px 14px;font:inherit;}
    .fixture-side-sheet{flex:none;width:0;min-width:0;background:#24272f;}
    .fixture-extra-form{max-width:360px;width:100%;margin:12px 0;}
    .fixture-independent{position:fixed;left:12px;bottom:20px;width:280px;height:140px;overflow:auto;}
    .fixture-independent .fixture-dock{position:relative;bottom:auto}
    @media(max-width:900px){.fixture-sidebar{display:none}}
  `;
  document.head.append(style);
  let refs: Record<string, HTMLElement> = {};
  let fileSelections = 0;
  const build = (options: {outsideMain?: boolean; nestedLimit?: boolean; empty?: boolean; responsivePadding?: boolean} = {}): void => {
    document.body.replaceChildren();refs={};fileSelections=0;
    const widthClasses = options.responsivePadding ? carrierClasses.replace('px-toolbar', responsivePaddingToken) : carrierClasses;
    const shell=el('div','fixture-shell');
    const side=el('aside','fixture-sidebar','Browser Toolbox\n구조 진단 기반 · 로컬 시험');
    const host=el('div','fixture-host');
    const main=el('main','fixture-main');
    const position=el('div','relative h-full flex-1 min-w-0');
    const scroll=el('div','overflow-x-hidden overflow-y-auto h-full flex flex-col-reverse');scroll.setAttribute('role','presentation');
    const flow=el('div','flex min-h-full flex-col overflow-x-clip fixture-thread-flow');
    const conversation=el('div',widthClasses+' flex-1');
    const proseContainer=el('div',options.nestedLimit?contentToken:'');
    if(!options.empty) for(let i=0;i<4;i++){
      const message=el('section','fixture-message');
      message.append(el('h2','',`대화 ${i+1} · 구조에 기반한 너비 조절`));
      message.append(el('p','','테스트 문장입니다. 대화와 작성 영역은 같은 너비 클래스지만 서로 다른 컨테이너에 있습니다. '.repeat(3)));
      proseContainer.append(message);
    }
    conversation.append(proseContainer);flow.append(conversation);
    const dock=el('div','absolute fixture-dock');const composer=el('div',widthClasses+' extension:px-2');
    let parent:HTMLElement=composer;
    for(let i=0;i<5;i++){const wrapper=el('div','contents');parent.append(wrapper);parent=wrapper;}
    const form=el('form','relative flex flex-col');parent.append(form);
    const stack=el('div','relative w-full flex-col flex');form.append(stack);
    const wrap=el('div');wrap.style.display='flex';stack.append(wrap);
    const presentation=el('div');presentation.setAttribute('role','presentation');presentation.style.cssText='display:flex;position:relative;flex:1';wrap.append(presentation);
    const flex=el('div');flex.style.cssText='display:flex;flex:1;position:relative';presentation.append(flex);
    const contents=el('div','contents');flex.append(contents);
    const grid=el('div','fixture-grid');contents.append(grid);
    const upload=el('button','','+');upload.type='button';upload.setAttribute('aria-label','시험 파일 선택');
    const input=el('input');input.type='file';input.hidden=true;input.addEventListener('change',()=>fileSelections++);
    upload.addEventListener('click',()=>input.click());grid.append(upload);
    const first=el('div','min-w-0'),second=el('div','min-w-0'),editorWrap=el('div','flex overflow-hidden');editorWrap.setAttribute('role','presentation');
    const editor=el('div','ProseMirror','보존할 작성 문장');editor.contentEditable='true';editor.setAttribute('role','textbox');
    editorWrap.append(editor);second.append(editorWrap);first.append(second);grid.append(first);
    const send=el('button','','보내기');send.type='submit';grid.append(send);form.append(input);
    form.addEventListener('submit',e=>e.preventDefault());
    dock.append(composer);scroll.append(flow,dock);position.append(scroll);main.append(position);
    if(options.outsideMain){main.hidden=true;host.append(main,position);}else host.append(main);
    const split=el('aside','fixture-side-sheet');shell.append(side,host,split);document.body.append(shell);
    refs={shell,side,host,main,position,scroll,flow,conversation,proseContainer,dock,composer,form,editor,grid,upload,input,send,split};
  };
  const bounds=(e:HTMLElement)=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {width:r.width,height:r.height,x:r.x,y:r.y,maxWidth:s.maxWidth,display:s.display,paddingLeft:s.paddingLeft,paddingRight:s.paddingRight};};
  const measure=()=>({conversation:bounds(refs.conversation),message:bounds(refs.proseContainer),composer:bounds(refs.composer),form:bounds(refs.form),editor:bounds(refs.editor),host:bounds(refs.host),
    viewport:document.documentElement.clientWidth,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
    nativeBodyVariable:getComputedStyle(refs.composer).getPropertyValue('--thread-body-max-width'),nativeContentVariable:getComputedStyle(refs.conversation).getPropertyValue('--thread-content-max-width'),
    editorText:refs.editor.textContent,editorId:refs.editor.id,fileSelections,
    oldMarkerCount:document.querySelectorAll('#prompt-textarea,[data-testid^="conversation-turn-"],[data-turn],[data-message-author-role],[data-scroll-anchor],[data-type="unified-composer"]').length,
    sheets:[...document.querySelectorAll('style[id^="chatgpt-ctrl-enter-"]')].map(s=>s.id)});
  const request=(type='chatgpt-width:inspect')=>{let response:unknown=null;for(const f of w.chrome.runtime.onMessage.listeners)f({type},{id:w.chrome.runtime.id},(r:unknown)=>response=r);return response;};
  const addEdit=()=>{const section=el('section','fixture-message'), form=el('form','fixture-extra-form'),editor=el('div','ProseMirror','과거 메시지 편집');editor.contentEditable='true';editor.setAttribute('role','textbox');form.append(editor);section.append(form);refs.proseContainer.append(section);refs.editForm=form;};
  const addUnrelated=(tag:'aside'|'dialog'|'nav'|'section',role='')=>{
    const box=el(tag,'fixture-independent');if(role)box.setAttribute('role',role);
    if(box instanceof HTMLDialogElement)box.open=true;
    const scroll=el('div','overflow-y-auto flex-col-reverse');scroll.setAttribute('role','presentation');
    const flow=el('div','min-h-full flex-col overflow-x-clip'),conversation=el('div',carrierClasses,'다른 영역');flow.append(conversation);
    const dock=el('div','absolute fixture-dock'),composer=el('div',carrierClasses),form=el('form'),editor=el('div','ProseMirror','다른 입력란');editor.setAttribute('role','textbox');editor.contentEditable='true';form.append(editor);composer.append(form);dock.append(composer);scroll.append(flow,dock);box.append(scroll);document.body.append(box);return box;
  };
  w.__reportedWidthFixture={build,measure,request,addEdit,addUnrelated,get refs(){return refs}};
  build();
})();
