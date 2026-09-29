/** Test-only exposure of actual inner functions; no product branch/body is changed. */
export {};
declare function require(name: string): any;
declare const process: { cwd(): string; argv: string[] };
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const root = process.cwd();
function expose(file: string, outer: string | null, boundary: string, names: string[]): string {
  const source = fs.readFileSync(path.join(root,'dist',file),'utf8');
  const tree = ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  let block: any = null;
  function visit(n: any): void {
    if (outer && ts.isFunctionDeclaration(n) && n.name?.text === outer) block=n.body;
    if (!outer && ts.isArrowFunction(n) && ts.isBlock(n.body) && !block) block=n.body;
    ts.forEachChild(n,visit);
  }
  visit(tree);
  if (!block) throw new Error('Missing product function: '+file);
  const declarations=new Set(block.statements.filter((n:any)=>ts.isFunctionDeclaration(n)).map((n:any)=>n.name.text));
  for(const name of names) if(!declarations.has(name)) throw new Error('Missing product helper '+name);
  const pos=source.indexOf(boundary,block.pos);
  if(pos<0) throw new Error('Missing test export boundary');
  return source.slice(0,pos)+`return {${names.join(',')}};\n`+source.slice(pos);
}
const captions=expose('youtube_transcript_page_task.js','youtubeTranscriptPageTask','    if (!isYoutubePage())',[
  'getTextTrackEntries','captureYouTubeInteractionState','restoreYouTubeInteractionState','parseActualTranscriptResponse','verifiedCaptionUrl'
]);
// Eraser returns its helpers before setting up the picker (all function declarations are hoisted).
const eraser=expose('element_eraser.js',null,'    if (scope[CONTROLLER_KEY])', ['buildPersistentSelector']);
fs.writeFileSync(path.join(root,'.test_dist/review_helpers.json'),JSON.stringify({captions,eraser}));
