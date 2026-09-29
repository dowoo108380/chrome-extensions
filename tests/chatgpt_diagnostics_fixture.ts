/** Test-only unknown structure; NOT an authenticated ChatGPT DOM capture. */
(() => {
  const w = globalThis as unknown as Record<string, any>;
  const secret = 'PRIVATE_SENTINEL_7c99';
  function makeUnknown(): void {
    const style = document.createElement('style');
    style.textContent = '.max-w-3xl {width:100%;max-width:768px;margin-inline:auto} .test-editor{min-height:40px}';
    document.head.append(style);
    const main = document.createElement('main');
    main.id = secret;
    const conversation = document.createElement('section');
    conversation.className = 'max-w-3xl';
    conversation.id = secret + '-conversation';
    conversation.textContent = secret + '-message';
    const form = document.createElement('form');
    form.className = 'max-w-3xl';
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    editor.setAttribute('role', 'textbox');
    editor.id = secret + '-editor';
    editor.dataset.testid = secret;
    editor.className = 'test-editor';
    editor.textContent = secret + '-draft';
    form.append(editor);main.append(conversation,form);document.body.replaceChildren(main);
    w.__diagnosticEditor = editor;
  }
  function request(type: string, sender = w.chrome.runtime.id): any {
    let response: any = null;
    for (const f of w.chrome.runtime.onMessage.listeners) f({type},{id:sender},(r:unknown) => {response=r});
    return response;
  }
  w.__diagnosticFixture = {makeUnknown,request,secret};
})();
