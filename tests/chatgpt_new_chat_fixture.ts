/** User-provided 1.67.0 new-chat structural snapshot, not live ChatGPT HTML.
 * Relevant ancestors: editor(0)..form(10)..carrier(17)>relative(18)>
 * div(19)>basis-5/9(20)>contents(21)>flex column(22)>role=main(23).
 * The first-message thread/dock below uses the earlier reported 1.64.1 paths.
 * Only these relationships/classes and widths come from the reports. Text,
 * native CSS, buttons, transition actions, and surrounding UI are test fixtures.
 */
(() => {
  const w = globalThis as unknown as Record<string, any>;
  const bodyToken = 'max-w-(--thread-body-max-width)';
  const classes = `mx-auto w-full ${bodyToken} px-toolbar relative flex flex-col`;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag); e.className = cls; e.textContent = text; return e;
  };
  const style = el('style');
  style.textContent = `
    :root { --thread-body-max-width:calc(48rem + 16px * 2); --thread-content-max-width:48rem; font-size:16px; color-scheme:dark; }
    * {box-sizing:border-box} html,body{margin:0;width:100%;height:100%} body{font:16px/1.6 system-ui,sans-serif;background:#101114;color:#edeef0}
    .fx-shell{display:flex;width:100%;height:100%}.fx-sidebar{width:340px;flex:none;background:#191a1e;padding:20px}.fx-host{flex:1;min-width:0;height:100%}
    .fx-split{width:0;flex:none;background:#222}.relative{position:relative}.absolute{position:absolute}.flex{display:flex}
    .flex-col{flex-direction:column}.flex-col-reverse{flex-direction:column-reverse}.flex-1{flex:1 1 0%}.h-full{height:100%}
    .min-h-full{min-height:100%}.min-h-0{min-height:0}.min-w-0{min-width:0}.w-full{width:100%}.mx-auto{margin-inline:auto}
    .contents{display:contents}.overflow-y-auto{overflow-y:auto}.overflow-x-clip{overflow-x:clip}.overflow-hidden{overflow:hidden}
    .px-toolbar{padding-inline:16px}[class~="${bodyToken}"]{max-width:var(--thread-body-max-width)}[hidden]{display:none!important}
    .fx-scroll{padding-inline:10.4px}.fx-landing{--thread-content-max-width:42rem;padding-top:24vh}
    .fx-title{text-align:center;max-width:800px;margin:0 auto 30px}.fx-suggestions{max-width:600px;margin:20px auto;display:flex;gap:10px;flex-wrap:wrap}
    .fx-grid{width:100%;display:grid;grid-template-columns:36px minmax(0,1fr) auto;gap:8px;padding:8px;border-radius:24px;background:#282a30}
    .fx-row{display:flex;position:relative;flex:1;min-width:0}.ProseMirror{min-height:36px;outline:none;overflow-x:hidden;flex:1 1 0%;position:relative;padding:4px}
    form{margin:0}button,input{font:inherit}button{border:0;border-radius:18px;padding:6px 12px;background:#373d46;color:inherit;cursor:pointer}
    .fx-dock{bottom:24px;left:0;right:0}.fx-flow{padding-top:25px;padding-bottom:140px}.fx-message{padding:12px 0;border-bottom:1px solid #383b40}
    .fx-unrelated{max-width:600px}.fx-unrelated[role=dialog],dialog.fx-unrelated{position:fixed;inset:10px auto auto 10px;background:#222;padding:12px}
    @media(max-width:900px){.fx-sidebar{display:none}}`;
  document.head.append(style);
  const refs: Record<string, HTMLElement> = {};
  let submissions = 0;
  const carrier = (): HTMLElement => {
    const box = el('div', classes); let parent = box;
    // Report indices 16..11; the index-13 element remains flex even with contents in its class list.
    for (let i = 16; i >= 11; i--) {
      const wrap = el('div', i === 13 ? 'flex flex-col contents' : 'contents');
      if (i === 13) wrap.style.display = 'flex'; parent.append(wrap); parent = wrap;
    }
    const form = el('form','relative flex flex-col'); parent.append(form);
    const presentation = el('div','w-full fx-row'); presentation.setAttribute('role','presentation'); form.append(presentation);
    const stack = el('div','relative w-full flex-col flex'), row = el('div','fx-row'), flex = el('div','fx-row');
    presentation.append(stack); stack.append(row); row.append(flex);
    const grid = el('div','fx-grid'); flex.append(grid);
    const upload = el('button','','+'); upload.type='button'; upload.setAttribute('aria-label','시험 파일 선택');
    const input = el('input'); input.type='file'; input.hidden=true; upload.addEventListener('click',()=>input.click());
    const outer = el('div','min-w-0'), contents = el('div','contents'), inner = el('div','min-w-0'); inner.style.display='flow-root';
    const wrapper = el('div','flex overflow-hidden h-[1lh]'); wrapper.setAttribute('role','presentation');
    const editor = el('div','ProseMirror'); editor.contentEditable='true'; editor.setAttribute('role','textbox');
    wrapper.append(editor); inner.append(wrapper); contents.append(inner); outer.append(contents);
    const send = el('button','','보내기'); send.type='submit'; send.setAttribute('aria-label','Send message');
    grid.append(upload,outer,send); form.append(input);
    form.addEventListener('submit',event=>{event.preventDefault();submissions++;toThread();});
    Object.assign(refs,{composer:box,form,grid,editor,upload,send}); return box;
  };
  const makeStage = (): HTMLElement => {
    const scroll = el('div','relative flex min-h-0 w-full flex-1 flex-col overflow-y-auto fx-scroll'); scroll.setAttribute('role','main');
    const stage = el('div','relative flex min-h-0 w-full flex-1 flex-col max-sm:flex-auto fx-landing');
    const heading = el('h1','fx-title','새 채팅 · 첫 메시지 전 너비 재현');
    const contents=el('div','contents'), column=el('div','flex min-w-0 flex-col min-h-0 basis-5/9 max-sm:flex-none sm:basis-auto');
    const outer=el('div'),dock=el('div','relative');dock.append(refs.composer);outer.append(dock);column.append(outer);contents.append(column);
    const suggestions=el('div','fx-suggestions');suggestions.append(el('button','','아이디어 정리'),el('button','','문장 다듬기'));
    stage.append(heading,contents,suggestions);scroll.append(stage);Object.assign(refs,{scroll,stage,column,dock,heading,suggestions});return scroll;
  };
  const build = (delayed = false): void => {
    document.body.replaceChildren(); submissions=0;
    const shell=el('div','fx-shell'),side=el('aside','fx-sidebar','로컬 구조 재현\nBrowser Toolbox'),main=el('main','fx-host relative flex flex-col'),split=el('aside','fx-split');
    Object.assign(refs,{shell,side,main,split});carrier();
    const stage=makeStage();if(!delayed)main.append(stage);
    // The diagnostic also observed three non-rendered width carriers.
    for(let i=0;i<3;i++){const hidden=el('div');hidden.hidden=true;hidden.append(el('div',classes));main.append(hidden);}
    shell.append(side,main,split);document.body.append(shell);refs.delayedStage=stage;
  };
  function toThread(): void {
    const scroll=el('div','overflow-y-auto h-full flex flex-col-reverse');scroll.setAttribute('role','presentation');
    const flow=el('div','flex min-h-full flex-col overflow-x-clip fx-flow'),conversation=el('div',classes+' flex-1');
    for(let i=0;i<3;i++){const p=el('p','fx-message',`첫 메시지 이후 시험 문장 ${i+1}. `.repeat(10));conversation.append(p);}
    flow.append(conversation);const dock=el('div','absolute fx-dock');dock.append(refs.composer);scroll.append(flow,dock);
    refs.main.replaceChildren(scroll);Object.assign(refs,{scroll,dock,conversation});
  }
  const toNewChat = ():void => {const stage=makeStage();refs.main.replaceChildren(stage);delete refs.conversation;};
  const request=(type='chatgpt-width:inspect'):unknown=>{let value:unknown;for(const f of w.chrome.runtime.onMessage.listeners)f({type},{id:w.chrome.runtime.id},(v:unknown)=>value=v);return value;};
  const rect=(e:HTMLElement | undefined)=>{if(!e)return null;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {width:r.width,height:r.height,x:r.x,y:r.y,maxWidth:s.maxWidth,display:s.display,paddingLeft:s.paddingLeft,paddingRight:s.paddingRight};};
  const measure=()=>({composer:rect(refs.composer),form:rect(refs.form),editor:rect(refs.editor),conversation:rect(refs.conversation),column:rect(refs.dock),heading:rect(refs.heading),suggestions:rect(refs.suggestions),submissions,
    overflow:Math.max(0,document.documentElement.scrollWidth-document.documentElement.clientWidth),sheets:[...document.querySelectorAll('style[id^="chatgpt-ctrl-enter-"]')].map(e=>e.id),
    bodyVariable:getComputedStyle(refs.composer).getPropertyValue('--thread-body-max-width'),contentVariable:getComputedStyle(refs.composer).getPropertyValue('--thread-content-max-width')});
  const addUnrelated=(tag:'aside'|'nav'|'section'|'dialog',role=''):HTMLElement=>{
    const copy=refs.scroll.cloneNode(true) as HTMLElement,box=el(tag,'fx-unrelated'); if(role)box.setAttribute('role',role);
    box.append(copy);if(box instanceof HTMLDialogElement)box.open=true;document.body.append(box);return box;
  };
  w.__newChatFixture={refs,build,toThread,toNewChat,request,measure,addUnrelated}; build();
})();
