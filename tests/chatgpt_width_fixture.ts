/** Controlled DOM/CSS fixtures, NOT a capture of a logged-in ChatGPT page.
 * Sizing tokens come from public 2026-09-26 author observations (README).
 * Native layout, storage, and app actions below are explicitly test doubles.
 */
(() => {
  type Kind = "modern" | "legacy" | "per-turn" | "shared" | "group" | "home";
  const w = globalThis as unknown as Record<string, any>;
  const modern = 'max-w-(--thread-body-max-width)';
  const legacy = '[--thread-content-max-width:40rem]';
  function make<K extends keyof HTMLElementTagNameMap>(name: K, id = '', text = ''): HTMLElementTagNameMap[K] {
    const element = document.createElement(name);
    if (id) element.id = id;
    if (text) element.textContent = text;
    return element;
  }
  const style = make('style');
  style.textContent = `
    :root{--thread-body-max-width:768px;--thread-content-max-width:768px;--composer-max-width:768px;color-scheme:light}
    *{box-sizing:border-box}body{margin:0;background:#fafafa;color:#21252a;font:16px/1.65 system-ui,sans-serif}
    #workspace{display:flex;width:100%;min-height:100vh}#sidebar{width:256px;flex:none;padding:20px;background:#ededee}
    #chat-main{flex:1;min-width:0;padding:24px}h1{font-size:21px;font-weight:600;margin:0 0 20px}
    [data-turn]{width:100%;margin-bottom:20px} [data-message-author-role=user]{background:#e8e8eb;border-radius:14px;padding:16px}
    [data-message-author-role=assistant]{padding:16px 0}.markdown{max-width:65ch}pre{white-space:pre-wrap;overflow-wrap:anywhere}
    [class~="max-w-(--thread-body-max-width)"],[class~="max-w-[var(--thread-body-max-width)]"]{width:100%;max-width:var(--thread-body-max-width);margin-inline:auto}
    [class*="[--thread-content-max-width:"]{--thread-content-max-width:640px;width:100%;max-width:var(--thread-content-max-width);margin-inline:auto}
    .composer-rail{width:100%;padding-top:32px;margin-bottom:36px}form{margin:0}#composer-form{width:100%;border:1px solid #c9cdd2;border-radius:20px;padding:16px;background:white}
    #prompt-textarea{min-height:60px;outline:none}.actions{display:flex;justify-content:space-between;gap:8px;padding-top:12px}button{font:inherit;cursor:pointer}
    .card{width:200px}.offscreen-fixtures{margin-top:28px}dialog[open]{position:relative;width:320px;margin:0;padding:8px}aside.probe{width:240px}
    #editor-turn form{width:100%}#editor-turn textarea{width:100%;min-height:70px}#split-view{flex:none;width:0;background:#ececec}
    @media(max-width:900px){#sidebar{display:none}#chat-main{padding:16px}}
  `;
  document.head.append(style);
  let kind: Kind = 'modern';
  let sent = 0, saved = 0;
  const setScene = (next: Kind): void => {
    kind = next; sent=0; saved=0;
    document.body.replaceChildren();
    const workspace = make('div','workspace'), sidebar = make('nav','sidebar','Browser Toolbox\nChatGPT width fixture');
    sidebar.setAttribute('aria-label','Test sidebar');
    const main = make('main','chat-main');
    main.append(make('h1','','대화와 입력란 너비 · 로컬 재현 화면'));
    const host = make('div','thread-shell'), thread=make('section','thread');
    host.append(thread);
    if (next==='shared') host.className=modern;
    if (next==='modern' || next==='group') thread.className=modern;
    if (next==='group') thread.setAttribute('aria-label','Local group thread');
    const makeTurn=(role:'user'|'assistant', index:number):HTMLElement => {
      const turn=make('article',`turn-${index}`);turn.dataset.turn=role;turn.dataset.testid=`conversation-turn-${index}`;
      const box=make('div',`message-box-${index}`);if(next==='legacy')box.className=legacy;
      if(next==='per-turn')box.className=modern;
      const message=make('div','',role==='user'?'대화 영역과 입력란을 독립적인 너비로 설정합니다.':'이 문장은 실서비스 답변이 아닌 시험용 문장입니다. 표시된 너비를 브라우저의 최종 레이아웃에서 확인합니다.');
      message.dataset.messageAuthorRole=role;
      if(role==='assistant')message.className='markdown prose';
      box.append(message);turn.append(box);return turn;
    };
    if(next!=='home')thread.append(makeTurn('user',1),makeTurn('assistant',2));
    const rail=make('div',next==='legacy'?'thread-bottom-container':'composer-rail');rail.className='composer-rail';
    const composeBox=make('div','composer-box');composeBox.className=next==='legacy'?legacy:modern;
    const form=make('form','composer-form');form.dataset.type='unified-composer';
    const editor=make('div','prompt-textarea');editor.contentEditable='true';editor.className='ProseMirror';editor.setAttribute('role','textbox');editor.setAttribute('aria-multiline','true');
    editor.textContent='보존할 작성 중인 문장';
    const action=make('div','','');action.className='actions';
    const input=make('input','upload-input');input.type='file';input.hidden=true;
    const upload=make('button','upload-button','파일 추가');upload.type='button';upload.addEventListener('click',()=>input.click());
    const send=make('button','send-button','보내기');send.dataset.testid='send-button';send.type='submit';
    form.addEventListener('submit',e=>{e.preventDefault();sent++;});
    action.append(upload,send);form.append(editor,input,action);composeBox.append(form);rail.append(composeBox);host.append(rail);main.append(host);
    // These contain the SAME width token but are unrelated settings/dialogs.
    const probes=make('div','probes');probes.className='offscreen-fixtures';
    const unrelated=make('form','unrelated-form');unrelated.className=modern;unrelated.append(make('input','search-input'));probes.append(unrelated);
    const aside=make('aside','aside-probe');aside.className='probe';
    const sidebarBox=make('div','aside-box','Sidebar');sidebarBox.className=modern;sidebarBox.dataset.turn='sidebar';aside.append(sidebarBox);probes.append(aside);
    const dialog=make('dialog','dialog-probe');dialog.open=true;
    const dialogBox=make('div','dialog-box','Dialog');dialogBox.className=modern;dialogBox.dataset.turn='dialog';dialog.append(dialogBox);probes.append(dialog);
    main.append(probes);workspace.append(sidebar,main,make('aside','split-view'));document.body.append(workspace);
  };
  const measure = () => {
    const dim=(id:string) => {const e=document.getElementById(id)!;const r=e.getBoundingClientRect();return {width:r.width,left:r.left,height:r.height,maxWidth:getComputedStyle(e).maxWidth};};
    const messageId=(kind==='legacy'||kind==='per-turn')?'message-box-2':'turn-2';
    return {
      kind,conversation:document.getElementById(messageId)?dim(messageId):null,
      composer:dim('composer-form'),composerBox:dim('composer-box'),main:dim('chat-main'),
      unrelated:dim('unrelated-form'),aside:dim('aside-box'),dialog:dim('dialog-box'),
      viewport:document.documentElement.clientWidth,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
      editorText:document.getElementById('prompt-textarea')!.textContent,
      nativeBodyWidth:getComputedStyle(document.documentElement).getPropertyValue('--thread-body-max-width'),
      sent,saved,
      styles:[...document.querySelectorAll('style[id^="chatgpt-ctrl-enter-"]')].map(s=>s.id)
    };
  };
  const addEdit=() => {
    const turn=make('article','editor-turn');turn.dataset.turn='user';
    const wrap=make('div','edit-wrapper');wrap.className=kind==='legacy'?legacy:modern;
    const form=make('form','edit-form');const input=make('textarea','edit-text','Edit previous message');input.dataset.testid='composer-text-input';
    const save=make('button','edit-save','저장');save.type='submit';
    form.addEventListener('submit',e=>{e.preventDefault();saved++;});
    form.append(input,save);wrap.append(form);turn.append(wrap);document.getElementById('thread')!.append(turn);
  };
  w.__widthFixture={setScene,measure,addEdit,sendCount:()=>sent};
  setScene('modern');
})();
