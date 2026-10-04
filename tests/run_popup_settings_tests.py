"""Exercise the real popup DOM and compiled code with controlled Chrome API replies.

Timers, storage callbacks and change events are released explicitly to reproduce
save races without timing-dependent sleeps. This is not an installed-extension test.
"""
from pathlib import Path
import argparse
import json
import re
import shutil
import traceback

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--chromium", default=shutil.which("chromium"))
args = parser.parse_args()
if not args.chromium:
    parser.error("Provide an installed Chrome/Chromium executable.")

html = (ROOT / "popup.html").read_text(encoding="utf-8")
html = re.sub(r"<script\b[^>]*>\s*</script>", "", html)
html = re.sub(
    r'<link\b[^>]*href="popup.css"[^>]*>',
    lambda _: "<style>" + (ROOT / "popup.css").read_text(encoding="utf-8") + "</style>",
    html,
)
results = {
    "environment": {"scope": "Actual popup HTML/compiled TypeScript; mocked Chrome storage and deterministic timers"},
    "tests": {}, "errors": [], "passed": False,
}


def load(browser):
    page = browser.new_page()
    page.set_default_timeout(5000)
    page.on("pageerror", lambda error: results["errors"].append(str(error)))
    page.set_content(html)
    for name in ["browser_harness.js", "popup_harness.js"]:
        page.evaluate((ROOT / ".test_dist" / name).read_text(encoding="utf-8"))
    page.evaluate("""() => {
      Object.assign(__test.settings, {
        chatConversationWidthPx: 800, chatComposerWidthPx: 800,
        mediaShortcutFasterCode: 'KeyQ'
      });
      const nativeSetTimeout = window.setTimeout.bind(window);
      const nativeClearTimeout = window.clearTimeout.bind(window);
      const timers = new Map();
      let timerId = 100000;
      window.setTimeout = (callback, delay, ...args) => {
        if (delay !== 120) return nativeSetTimeout(callback, delay, ...args);
        const id = ++timerId;
        timers.set(id, () => callback(...args));
        return id;
      };
      window.clearTimeout = id => {
        if (!timers.delete(id)) nativeClearTimeout(id);
      };
      const emit = changes => {
        for (const listener of chrome.storage.onChanged.listeners) listener(changes, 'local');
      };
      const state = window.__settingsTest = {
        writes: [], reads: [], holdReads: false, throwWrites: false,
        flush() {
          const callbacks = [...timers.values()];
          timers.clear();
          for (const callback of callbacks) callback();
        },
        commit(index) {
          const request = this.writes[index];
          request.changes = {};
          for (const [key, value] of Object.entries(request.values)) {
            request.changes[key] = {oldValue: __test.settings[key], newValue: value};
            __test.settings[key] = value;
          }
        },
        notify(index) { emit(this.writes[index].changes); },
        reply(index, fail = false) {
          if (fail) chrome.runtime.lastError = {message: 'Injected storage save failure'};
          try { this.writes[index].callback?.(); }
          finally { delete chrome.runtime.lastError; }
        },
        external(key, value) {
          const oldValue = __test.settings[key];
          if (value === undefined) delete __test.settings[key];
          else __test.settings[key] = value;
          emit({[key]: {oldValue, newValue: value}});
        },
        releaseRead() { this.holdReads = false; this.reads.shift()(); }
      };
      const get = chrome.storage.local.get;
      chrome.storage.local.get = (keys, callback) => get(keys, values => {
        if (state.holdReads) state.reads.push(() => callback(values));
        else callback(values);
      });
      chrome.storage.local.set = (values, callback) => {
        if (state.throwWrites) throw new Error('Injected synchronous storage save failure');
        state.writes.push({values: structuredClone(values), callback});
      };
    }""")
    for name in ["toolbox_shared.js", "popup.js"]:
        page.evaluate((ROOT / "dist" / name).read_text(encoding="utf-8"))
    page.wait_for_function("document.documentElement.dataset.popupControlsReady === 'true'")
    return page


def width_input(page, slider, width, event="input"):
    page.evaluate("""({slider, width, event}) => {
      const control = document.getElementById(slider);
      control.value = String(width === 0 ? 0 : 1 + (width - 640) / 40);
      control.dispatchEvent(new Event(event, {bubbles: true}));
    }""", {"slider": slider, "width": width, "event": event})


def assert_width(page, slider, width):
    expected = str(0 if width == 0 else 1 + (width - 640) // 40)
    assert page.locator("#" + slider).input_value() == expected
    value_id = slider.replace("-slider", "-value")
    label = page.locator("#" + value_id).inner_text()
    assert ("기본 너비" in label) if width == 0 else (f"{width:,}" in label)
    assert page.locator("#" + slider).get_attribute("aria-valuetext") == label


def width_race(page, slider, key, phase, notification_first):
    width_input(page, slider, 1000, "change")
    page.wait_for_function("__settingsTest.writes.length === 1")
    width_input(page, slider, 1200)
    if phase == "queued":
        page.evaluate("__settingsTest.flush()")
    page.evaluate("""notificationFirst => {
      __settingsTest.commit(0);
      if (notificationFirst) __settingsTest.notify(0);
      __settingsTest.reply(0);
      if (!notificationFirst) __settingsTest.notify(0);
    }""", notification_first)
    assert_width(page, slider, 1200)
    if phase == "debouncing":
        # A real change event reads the current DOM value, so stale rendering
        # would corrupt even an otherwise correctly captured debounce value.
        page.locator("#" + slider).dispatch_event("change")
    page.wait_for_function("__settingsTest.writes.length === 2")
    assert page.evaluate("__settingsTest.writes[1].values") == {key: 1200}
    page.evaluate("__settingsTest.commit(1); __settingsTest.reply(1); __settingsTest.notify(1)")
    assert_width(page, slider, 1200)
    assert page.evaluate("key => __test.settings[key]", key) == 1200
    page.evaluate("key => __settingsTest.external(key, 1360)", key)
    assert_width(page, slider, 1360)
    page.evaluate("key => __settingsTest.external(key, 0)", key)
    assert_width(page, slider, 0)
    page.evaluate("key => __settingsTest.external(key, undefined)", key)
    assert_width(page, slider, 960 if key == "chatConversationWidthPx" else 0)


def old_failure(page, slider, key):
    width_input(page, slider, 1000, "change")
    page.wait_for_function("__settingsTest.writes.length === 1")
    width_input(page, slider, 1200)
    page.evaluate("__settingsTest.reply(0, true)")
    assert_width(page, slider, 1200)
    assert page.locator("#status").get_attribute("data-state") != "error"
    page.evaluate("__settingsTest.flush()")
    page.wait_for_function("__settingsTest.writes.length === 2")
    assert page.evaluate("__settingsTest.writes[1].values") == {key: 1200}
    page.evaluate("__settingsTest.commit(1); __settingsTest.notify(1); __settingsTest.reply(1)")
    assert_width(page, slider, 1200)


FAILURE_ACTIONS = {
    "toggle": ("composer-toggle", "checked", False, True, "change", "설정을 저장하지 못했습니다."),
    "chat_width": ("chat-width-slider", "value", "10", "5", "change", "대화 너비를 저장하지 못했습니다."),
    "composer_width": ("composer-width-slider", "value", "10", "5", "change", "입력란 너비를 저장하지 못했습니다."),
    "media_value": ("media-speed-step-input", "value", "0.25", "0.10", "change", "미디어 설정을 저장하지 못했습니다."),
    "bulk_toggle": ("page-unlock-master-toggle", "checked", True, False, "change", "전체 설정을 저장하지 못했습니다."),
    "shortcut_reset": ("media-shortcut-reset", None, None, None, "click", "미디어 단축키를 되돌리지 못했습니다."),
}


def save_failure(page, action, synchronous):
    control, prop, value, restored, event, message = FAILURE_ACTIONS[action]
    page.evaluate("""synchronous => {
      __settingsTest.holdReads = true;
      __settingsTest.throwWrites = synchronous;
    }""", synchronous)
    page.evaluate("""({control, prop, value, event}) => {
      const element = document.getElementById(control);
      if (prop) element[prop] = value;
      element.dispatchEvent(new Event(event, {bubbles: true}));
    }""", {"control": control, "prop": prop, "value": value, "event": event})
    if not synchronous:
        page.wait_for_function("__settingsTest.writes.length === 1")
        page.evaluate("__settingsTest.reply(0, true)")
    page.wait_for_function("__settingsTest.reads.length === 1")
    assert page.locator("#status").get_attribute("data-state") == "error"
    assert page.locator("#status").inner_text() == message
    page.evaluate("__settingsTest.releaseRead()")
    assert page.locator("#status").get_attribute("data-state") == "error"
    assert page.locator("#status").inner_text() == message
    if prop:
        assert page.locator("#" + control).evaluate("(element, prop) => element[prop]", prop) == restored
        assert page.locator("#" + control).is_enabled()
    else:
        assert "Q" in page.locator('[data-media-shortcut-command="faster"]').inner_text()


def recovery_during_edit(page, slider, key):
    page.evaluate("""() => {
      __settingsTest.holdReads = true;
      const toggle = document.getElementById('composer-toggle');
      toggle.checked = false;
      toggle.dispatchEvent(new Event('change', {bubbles: true}));
      __settingsTest.reply(0, true);
    }""")
    page.wait_for_function("__settingsTest.reads.length === 1")
    width_input(page, slider, 1200)
    page.evaluate("__settingsTest.releaseRead()")
    assert_width(page, slider, 1200)
    assert page.locator("#status").get_attribute("data-state") == "error"
    page.evaluate("__settingsTest.flush()")
    page.wait_for_function("__settingsTest.writes.length === 2")
    assert page.evaluate("__settingsTest.writes[1].values") == {key: 1200}
    page.evaluate("__settingsTest.commit(1); __settingsTest.notify(1); __settingsTest.reply(1)")
    assert_width(page, slider, 1200)
    assert page.locator("#status").get_attribute("data-state") == "success"


def run_case(browser, name, operation, *values):
    page = None
    try:
        page = load(browser)
        operation(page, *values)
        results["tests"][name] = {"passed": True}
        print("PASS", name, flush=True)
    except Exception:
        results["tests"][name] = {"passed": False, "failure": traceback.format_exc()}
        print("FAIL", name, flush=True)
    finally:
        if page:
            page.close()


try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.chromium, headless=True, args=["--no-sandbox"])
        results["environment"]["browser"] = browser.version
        for slider, key in [
            ("chat-width-slider", "chatConversationWidthPx"),
            ("composer-width-slider", "chatComposerWidthPx"),
        ]:
            for phase in ["debouncing", "queued"]:
                for notification_first in [False, True]:
                    run_case(browser, f"{key}_{phase}_notification_first_{notification_first}",
                             width_race, slider, key, phase, notification_first)
            run_case(browser, f"{key}_obsolete_failure", old_failure, slider, key)
            run_case(browser, f"{key}_recovery_during_edit", recovery_during_edit, slider, key)
        for action in FAILURE_ACTIONS:
            for synchronous in [False, True]:
                run_case(browser, f"{action}_save_failure_synchronous_{synchronous}", save_failure, action, synchronous)
        browser.close()
    results["passed"] = bool(results["tests"]) and all(test["passed"] for test in results["tests"].values()) and not results["errors"]
except Exception:
    results["failure"] = traceback.format_exc()
finally:
    output = ROOT / ".test_results"
    output.mkdir(exist_ok=True)
    (output / "popup_settings_results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{sum(test['passed'] for test in results['tests'].values())}/{len(results['tests'])} popup settings cases passed.", flush=True)
    if not results["passed"]:
        raise SystemExit(1)
