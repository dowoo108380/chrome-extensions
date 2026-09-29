/** Local, controlled responsive CSS, NOT a captured YouTube page.
 * Change styles through CSSOM rather than dispatching fabricated resize events.
 * There is no extension-specific success logic in this fixture.
 */
namespace WidthReadinessFixture {
  const w = globalThis as unknown as Record<string, any>;
  export type Mode = 'late-container' | 'position-transition' | 'primary-hidden' | 'native-narrow';
  let sheet: CSSStyleSheet;
  export let windowResizeEvents = 0;
  export let syntheticResizeEvents = 0;
  export function build(mode: Mode = 'late-container'): void {
    w.WidthFixture.build({});
    windowResizeEvents = 0; syntheticResizeEvents = 0;
    window.addEventListener('resize', event => {
      windowResizeEvents++;
      if (!event.isTrusted) syntheticResizeEvents++;
    });
    const style = document.createElement('style'); style.id = 'fixture-ready-sheet';
    style.textContent = mode === 'late-container' ? `
      #fixture-app-content { width:1100px; }
      ytd-watch-flexy:not([theater]) > #columns { flex-wrap:wrap; }
      ytd-watch-flexy:not([theater]) #primary { flex:1 0 850px; }
    ` : mode === 'position-transition' ? `
      ytd-watch-flexy:not([theater]) #primary { transform:translateX(300px); transition:transform 120ms linear; }
    ` : mode === 'primary-hidden' ? `
      #primary { display:none; }
    ` : `
      #movie_player { width:800px; margin-inline:auto; }
    `;
    document.head.append(style); sheet = style.sheet!;
  }
  export function ready(): void {
    const rule = sheet.cssRules[0] as CSSStyleRule;
    if (rule.selectorText === '#fixture-app-content') rule.style.width = '1920px';
    else if (rule.style.transform) rule.style.transform = 'none';
    else if (rule.style.display === 'none') rule.style.display = 'block';
    else rule.style.width = '100%';
  }
  export function width(value: number): void {
    (sheet.cssRules[0] as CSSStyleRule).style.width = `${value}px`;
  }
  export function read(): Record<string, any> {
    return { ...w.WidthFixture.read(), resizeEvents: windowResizeEvents, syntheticResizeEvents };
  }
}
(globalThis as unknown as Record<string, unknown>).WidthReadinessFixture = WidthReadinessFixture;
