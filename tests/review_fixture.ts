/** Controlled stress fixtures. Real DOM/inputs; API response delays are explicit doubles. */
namespace ReviewFixture {
  const w = globalThis as unknown as Record<string, any>;
  export function shadowEditors(): void {
    w.__shadowInputs = [];
    for (const [mode, tag] of [['open','review-editor'],['closed','review-editor'],['closed','div']] as const) {
      const host = document.createElement(tag);host.style.cssText='display:block;padding:10px';
      const root=host.attachShadow({mode}),input=document.createElement('input');input.id='editor-'+mode;
      root.append(input);document.body.append(host);w.__shadowInputs.push(input);
    }
  }
  export function delayPopupRates(): void {
    const send=w.chrome.runtime.sendMessage;
    w.__delayedRates=[];w.__rateCompletions=[];
    w.chrome.runtime.sendMessage=(m:Record<string,any>,cb:(r:any)=>void)=>{
      if(m.type!=='media-controller:set-tab-rate')return send(m,cb);
      w.__delayedRates.push(m.rate);
      if(m.rate===2){w.__releaseRate=()=>{w.__popupTest.rate=2;cb({ok:true,hasMedia:true,rate:2,label:'동영상'});};}
      else {w.__popupTest.rate=m.rate;cb({ok:true,hasMedia:true,rate:m.rate,label:'동영상'});}
    };
  }
  export function delayedCoverRead(): void {
    const read=Blob.prototype.arrayBuffer;let held=false;
    Blob.prototype.arrayBuffer=function(){
      if(!held && (held=true)) return new Promise<ArrayBuffer>(resolve=>{w.__releaseOldCover=()=>{void read.call(this).then(resolve);};});
      return read.call(this);
    };
  }
  export function startupRelocation(delay=50, repeated=false): void {
    // Models a native component returning its original node to its original parent.
    // No extension methods or expected results are changed.
    const source=w.LayoutRegressionFixture.related;
    const origin=source.parentElement;
    w.__nativeRelocations=0;
    const observer=new MutationObserver(()=>{
      if(source.closest('#btx-pane-videos')&&(!w.__nativeRelocations||repeated)) {
        observer.disconnect();
        setTimeout(()=>{origin.moveBefore(source,null);w.__nativeRelocations++;if(repeated)observer.observe(document,{childList:true,subtree:true});},delay);
      }
    });observer.observe(document,{childList:true,subtree:true});
  }
  export function synchronousStartupRelocation(): void {
    // A real custom-element connectedMoveCallback can run within moveBefore.
    const source=w.LayoutRegressionFixture.related, origin=source.parentElement;
    w.__syncMoves=0;
    class NativeSample extends HTMLElement { connectedMoveCallback():void {
      if(source.closest('#btx-pane-videos') && !w.__syncMoves) { w.__syncMoves++;origin.moveBefore(source,null); }
    } }
    if(!customElements.get('native-relocation-sample'))customElements.define('native-relocation-sample',NativeSample);
    source.append(document.createElement('native-relocation-sample'));
  }
}
(globalThis as unknown as Record<string, unknown>).ReviewFixture=ReviewFixture;
