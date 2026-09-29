(() => {
  "use strict";

  const STORAGE_KEY = "pageElementEraserRulesV1";
  const STYLE_ID = "__page_element_eraser_persistent_style__";
  const SESSION_STYLE_ID = "__page_element_eraser_session_style__";

  function getSiteKey() {
    try {
      const url = new URL(globalThis.location.href);
      if (url.protocol !== "http:" && url.protocol !== "https:") return "";
      return url.origin;
    } catch {
      return "";
    }
  }

  const settingsJournal = new ToolboxShared.SettingsReadJournal([STORAGE_KEY]);

  function normalizeRules(value: unknown, siteKey: string): string[] {
    const rulesBySite = ToolboxShared.isRecord(value) ? value : {};
    const candidate = rulesBySite[siteKey];
    const rules: unknown[] = Array.isArray(candidate) ? candidate : [];
    const selectors: string[] = [];
    const seen = new Set<string>();

    for (const rule of rules) {
      if (!ToolboxShared.isRecord(rule)) continue;
      const selector = String(rule.selector || "").trim();
      if (!ToolboxShared.isSafePersistentSelector(selector) || seen.has(selector)) continue;

      try {
        document.querySelector(selector);
      } catch {
        continue;
      }

      seen.add(selector);
      selectors.push(selector);
    }

    return selectors;
  }

  function getStyleParent() {
    return document.documentElement || document.head || document.body;
  }

  function applySelectors(selectors: readonly string[]) {
    document.getElementById(SESSION_STYLE_ID)?.remove();

    const existingStyle = document.getElementById(STYLE_ID);
    if (selectors.length === 0) {
      existingStyle?.remove();
      return;
    }

    const parent = getStyleParent();
    if (!parent) return;

    const style = existingStyle || document.createElement("style");
    style.id = STYLE_ID;
    style.setAttribute("data-page-element-eraser", "persistent");
    style.textContent = selectors
      .map((selector) => `${selector} { display: none !important; }`)
      .join("\n");

    if (!style.isConnected) {
      parent.appendChild(style);
    }
  }

  const siteKey = getSiteKey();
  const storageArea = globalThis.chrome?.storage?.local;
  if (!siteKey || !storageArea || typeof storageArea.get !== "function") return;

  const storageChanged = globalThis.chrome?.storage?.onChanged;
  if (storageChanged && typeof storageChanged.addListener === "function") {
    storageChanged.addListener((changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName !== "local" || !Object.prototype.hasOwnProperty.call(changes || {}, STORAGE_KEY)) {
        return;
      }

      settingsJournal.record(changes);
      applySelectors(normalizeRules(changes[STORAGE_KEY]?.newValue, siteKey));
    });
  }
  const readRevision = settingsJournal.mark();
  void ToolboxShared.readStorage(storageArea, chrome.runtime, [STORAGE_KEY]).then(values => {
    const latest = settingsJournal.merge(values, readRevision);
    applySelectors(normalizeRules(latest[STORAGE_KEY], siteKey));
  }).catch(error => console.warn("Could not read saved element hiding rules:", error));
})();
