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

  const SAFE_ANCHOR_ATTRIBUTES = Object.freeze([
    "data-testid",
    "data-test-id",
    "data-test",
    "data-qa",
    "data-cy",
    "data-component",
    "aria-label",
    "name",
    "role"
  ]);

  function splitSafeSelector(rawSelector) {
    const selector = String(rawSelector || "").trim();
    if (!selector || selector.length > 1200) return null;

    const segments = [];
    let current = "";
    let quote = "";
    let bracketDepth = 0;
    let escaped = false;

    for (const character of selector) {
      if (escaped) {
        current += character;
        escaped = false;
        continue;
      }
      if (character === "\\") {
        current += character;
        escaped = true;
        continue;
      }
      if (quote) {
        current += character;
        if (character === quote) quote = "";
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        current += character;
        continue;
      }
      if (character === "[") {
        bracketDepth += 1;
        current += character;
        continue;
      }
      if (character === "]") {
        bracketDepth -= 1;
        if (bracketDepth < 0) return null;
        current += character;
        continue;
      }
      if (bracketDepth === 0 && character === ">") {
        const segment = current.trim();
        if (!segment) return null;
        segments.push(segment);
        current = "";
        continue;
      }
      if (
        bracketDepth === 0 &&
        (character === "," || character === "+" || character === "~" ||
          character === "*" || character === ":" || character === "{" ||
          character === "}" || character === "\n" || character === "\r")
      ) {
        return null;
      }
      current += character;
    }

    if (escaped || quote || bracketDepth !== 0) return null;
    const finalSegment = current.trim();
    if (!finalSegment) return null;
    segments.push(finalSegment);
    return segments.length <= 7 ? segments : null;
  }

  function isSafePersistentSelector(rawSelector) {
    const segments = splitSafeSelector(rawSelector);
    if (!segments?.length) return false;

    const anchorAttributes = SAFE_ANCHOR_ATTRIBUTES
      .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");
    const attributeAnchorPattern = new RegExp(
      `^[a-z][a-z0-9-]*\\[(?:${anchorAttributes})\\s*=`,
      "i"
    );
    const root = segments[0];
    if (!/^#[a-zA-Z_][a-zA-Z0-9_-]{0,79}$/.test(root) && !attributeAnchorPattern.test(root)) {
      return false;
    }

    for (const segment of segments) {
      if (!segment || segment.length > 360) return false;
      if (/^(?:html|body|head)(?:$|[.#\[])/i.test(segment)) return false;

      let quote = "";
      let bracketDepth = 0;
      let escaped = false;
      for (const character of segment) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (character === "\\") {
          escaped = true;
          continue;
        }
        if (quote) {
          if (character === quote) quote = "";
          continue;
        }
        if (character === '"' || character === "'") {
          quote = character;
          continue;
        }
        if (character === "[") bracketDepth += 1;
        else if (character === "]") bracketDepth -= 1;
        else if (bracketDepth === 0 && /\s/.test(character)) return false;
      }
      if (escaped || quote || bracketDepth !== 0) return false;
    }

    return true;
  }

  function normalizeRules(value, siteKey) {
    const rulesBySite = value && typeof value === "object" ? value : {};
    const rules = Array.isArray(rulesBySite[siteKey]) ? rulesBySite[siteKey] : [];
    const selectors = [];
    const seen = new Set();

    for (const rule of rules) {
      const selector = String(rule?.selector || "").trim();
      if (!isSafePersistentSelector(selector) || seen.has(selector)) continue;

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

  function applySelectors(selectors) {
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

  storageArea.get([STORAGE_KEY], (values) => {
    void globalThis.chrome?.runtime?.lastError;
    applySelectors(normalizeRules(values?.[STORAGE_KEY], siteKey));
  });

  const storageChanged = globalThis.chrome?.storage?.onChanged;
  if (storageChanged && typeof storageChanged.addListener === "function") {
    storageChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !Object.prototype.hasOwnProperty.call(changes || {}, STORAGE_KEY)) {
        return;
      }

      applySelectors(normalizeRules(changes[STORAGE_KEY]?.newValue, siteKey));
    });
  }
})();
