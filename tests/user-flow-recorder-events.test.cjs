const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createEvents(t, { allowCoordinateClickFallback = true } = {}) {
  const timers = new Set();
  const recorded = [];
  const played = [];
  const scrolls = [];
  const queries = [];
  const pointQueries = [];
  const nodes = new Map();
  const storage = new Map();
  let now = 100;
  let queryOverride = null;
  let pointTarget = null;

  class FakeMouseEvent extends Event {
    constructor(type, options = {}) {
      super(type, options);
      this.clientX = options.clientX;
      this.clientY = options.clientY;
    }
  }
  class FakeElement {
    constructor(tagName) {
      this.tagName = tagName;
      this.nodeType = 1;
      this.attributes = new Map();
      this.dispatched = [];
      this.children = [];
      this.scrollWidth = 1000;
      this.scrollHeight = 2000;
      this.clientWidth = 1000;
      this.clientHeight = 800;
      this.scrollLeft = 0;
      this.scrollTop = 0;
      this.clickCount = 0;
      this.isConnected = true;
    }
    closest() { return null; }
    getAttribute(name) { return this.attributes.get(name) || null; }
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 1000, height: 2000 };
    }
    dispatchEvent(event) {
      this.dispatched.push(event);
      if (event.type === "click") {
        this.clickCount += 1;
        played.push(this);
        if (this.type === "checkbox") this.checked = !this.checked;
      }
      return true;
    }
    click() {
      this.dispatchEvent(new FakeMouseEvent("click"));
    }
    scrollTo(options) {
      this.scrollLeft = options.left;
      this.scrollTop = options.top;
    }
  }
  class FakeInput extends FakeElement {}
  class FakeTextArea extends FakeElement {}
  class FakeSelect extends FakeElement {}
  const body = new FakeElement("BODY");
  const html = new FakeElement("HTML");
  body.parentElement = html;
  html.children.push(body);
  const document = {
    body, documentElement: html, scrollingElement: html,
    readyState: "complete",
    addEventListener() {},
    elementFromPoint(x, y) {
      pointQueries.push([x, y]);
      return pointTarget;
    },
    querySelector(selector) {
      queries.push(selector);
      if (selector === "body") return this.body;
      if (selector === "html") return this.documentElement;
      return queryOverride ? queryOverride(selector, now) : nodes.get(selector) || null;
    },
    querySelectorAll(selector) {
      const node = this.querySelector(selector);
      return node ? [node] : [];
    },
  };
  const window = {
    location: new URL("https://example.test/test"),
    innerWidth: 1000, innerHeight: 800, scrollX: 0, scrollY: 0,
    focus() {},
    addEventListener() {},
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
    },
    setTimeout(callback, ms) {
      const timer = setTimeout(() => {
        now += Math.max(0, ms);
        callback();
      }, 0);
      timers.add(timer);
      return timer;
    },
    clearTimeout,
    setInterval(callback, ms) {
      const timer = setInterval(callback, ms);
      timers.add(timer);
      return timer;
    },
    clearInterval,
    requestAnimationFrame(callback) { return this.setTimeout(callback, 16); },
    scrollTo: (options) => scrolls.push(options),
    UserFlowRequestTracker: { create: () => ({ install() {} }) },
  };
  const context = vm.createContext({
    window, document, URL, console,
    performance: { now: () => now },
    Element: FakeElement, Node: { ELEMENT_NODE: 1 },
    HTMLInputElement: FakeInput,
    HTMLTextAreaElement: FakeTextArea,
    HTMLSelectElement: FakeSelect,
    MouseEvent: FakeMouseEvent, Event,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/user-flow-recorder-events.js"), "utf8"), context);
  const api = window.UserFlowRecorderEvents.create({
    allowCoordinateClickFallback,
    recordEvent: (event) => recorded.push(event),
    isRecording: () => true,
  });
  t.after(() => {
    for (const timer of timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
  });
  return {
    api, body, html, window, document, recorded, played, scrolls, queries, pointQueries,
    get now() { return now; },
    queryWith: (callback) => { queryOverride = callback; },
    pointAt: (target) => { pointTarget = target; },
    input(id) {
      const input = new FakeInput("INPUT");
      if (id) nodes.set(`#${id}`, input);
      return input;
    },
    button(id = "button") {
      const button = new FakeElement("BUTTON");
      button.id = id;
      nodes.set(`#${id}`, button);
      return button;
    },
    recordClick: (target) => api.handleClick({ target, button: 0, clientX: 100, clientY: 400 }),
    recorder(events) {
      storage.set("response-mapping-user-flow-recording:v1", JSON.stringify({
        version: 4,
        sessions: [{ id: "first", recordedAt: Date.now(), events }],
      }));
      vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/user-flow-recorder.js"), "utf8"), context);
      return window.UserFlowRecorder;
    },
  };
}

function coordinateClick(overrides = {}) {
  return {
    type: "click", selector: "#missing", at: 0, page: "/test",
    pointer: {
      clientX: 100, clientY: 400,
      viewportWidth: 1000, viewportHeight: 800, scrollX: 0, scrollY: 0,
      xPercent: 90, yPercent: 90,
      ...overrides,
    },
  };
}

test("body and html clicks are recorded with element selectors, not the scroll marker", (t) => {
  const fixture = createEvents(t);
  fixture.recordClick(fixture.body);
  fixture.recordClick(fixture.html);
  assert.deepEqual(fixture.recorded.map((event) => event.selector), ["body", "html"]);
});

test("new root clicks replay on their original body or html element", async (t) => {
  const fixture = createEvents(t);
  fixture.recordClick(fixture.body);
  fixture.recordClick(fixture.html);
  for (const event of fixture.recorded) await fixture.api.playEvent(event);
  assert.deepEqual(fixture.played, [fixture.body, fixture.html]);
  assert.equal(fixture.body.dispatched[0].clientX, 100);
  assert.equal(fixture.body.dispatched[0].clientY, 400);
});

test("legacy window-marker clicks replay on body instead of failing", async (t) => {
  const fixture = createEvents(t);
  const event = { type: "click", selector: "__window__", pointer: { xPercent: 10, yPercent: 20 } };
  await fixture.api.playEvent(event);
  assert.equal(fixture.body.clickCount, 1);
  assert.equal(fixture.html.clickCount, 0);
  assert.equal(fixture.body.dispatched[0].clientX, 100);
  assert.equal(fixture.body.dispatched[0].clientY, 400);
  assert.equal(event.selector, "__window__");
});

test("legacy window-marker clicks fall back to html when body is absent", async (t) => {
  const fixture = createEvents(t);
  fixture.document.body = null;
  await fixture.api.playEvent({ type: "click", selector: "__window__" });
  assert.equal(fixture.html.clickCount, 1);
});

test("root scroll recording still uses the window marker", (t) => {
  const fixture = createEvents(t);
  fixture.api.handleScroll({ target: fixture.document });
  assert.equal(fixture.recorded[0].type, "scroll");
  assert.equal(fixture.recorded[0].selector, "__window__");
  fixture.api.resetScrollTracking();
});

test("window-marker scroll replay still scrolls Window, not body", async (t) => {
  const fixture = createEvents(t);
  await fixture.api.playEvent({ type: "scroll", selector: "__window__", scrollXPercent: 0, scrollYPercent: 50 });
  assert.equal(fixture.scrolls.length, 1);
  assert.equal(fixture.scrolls[0].top, 600);
  assert.equal(fixture.body.scrollTop, 0);
});

test("editable body events get an element selector and legacy inputs remain compatible", async (t) => {
  const fixture = createEvents(t);
  fixture.body.isContentEditable = true;
  fixture.body.textContent = "original";
  fixture.api.handleFormChange({ type: "input", target: fixture.body });
  assert.equal(fixture.recorded[0].selector, "body");
  await fixture.api.playEvent({ type: "input", selector: "__window__", detail: { text: "continued" } });
  assert.equal(fixture.body.textContent, "continued");
  assert.equal(fixture.body.dispatched[0].type, "input");
});

test("ordinary dynamic elements still wait for their selector before replay", async (t) => {
  const fixture = createEvents(t);
  const button = fixture.button("dynamic");
  fixture.queryWith((selector, now) => selector === "#dynamic" && now >= 250 ? button : null);
  await fixture.api.playEvent({ type: "click", selector: "#dynamic" });
  assert.equal(button.clickCount, 1);
  assert.equal(fixture.body.clickCount, 0);
  assert.ok(fixture.now >= 250);
  assert.ok(fixture.queries.length >= 4);
});

test("genuinely missing element selectors still fail after the existing wait", async (t) => {
  const fixture = createEvents(t);
  const started = fixture.now;
  await assert.rejects(fixture.api.playEvent({ type: "click", selector: "#missing" }), /재생 대상 요소를 찾지 못했습니다.*#missing/);
  assert.ok(fixture.now - started >= 5000);
  assert.equal(fixture.body.clickCount, 0);
});

test("legacy root clicks do not terminate the remaining actions of a recording", async (t) => {
  const fixture = createEvents(t);
  const button = fixture.button();
  const recorder = fixture.recorder([
    { type: "click", selector: "__window__", at: 0, page: "/test" },
    { type: "click", selector: "#button", at: 1, page: "/test" },
    { type: "scroll", selector: "__window__", at: 2, page: "/test", scrollYPercent: 50 },
  ]);
  await recorder.replay("first");
  assert.deepEqual(fixture.played, [fixture.body, button]);
  assert.equal(fixture.scrolls.length, 1);
  assert.equal(recorder.getState().completedReplaySessionId, "first");
  assert.equal(recorder.getState().failedReplaySessionId, "");
  assert.equal(recorder.getState().error, "");
});

test("new clicks record viewport coordinates and scroll context alongside local percentages", (t) => {
  const fixture = createEvents(t);
  fixture.window.scrollX = 20;
  fixture.window.scrollY = 300;
  fixture.recordClick(fixture.button());
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.recorded[0].pointer)), {
    clientX: 100, clientY: 400,
    viewportWidth: 1000, viewportHeight: 800, scrollX: 20, scrollY: 300,
    xPercent: 10, yPercent: 20, pointerType: "mouse",
  });
});

test("missing selectors fall back after five seconds to the recorded point, not local percentages", async (t) => {
  const fixture = createEvents(t);
  const button = fixture.button("replacement");
  fixture.pointAt(button);
  const started = fixture.now;
  await fixture.api.playEvent(coordinateClick());
  assert.ok(fixture.now - started >= 5000);
  assert.deepEqual(fixture.pointQueries, [[100, 400]]);
  assert.equal(button.clickCount, 1);
  assert.ok(button.dispatched.every((event) => event.clientX === 100 && event.clientY === 400));
});

test("a delayed selector still replays normally when it is visible at the recorded point", async (t) => {
  const fixture = createEvents(t);
  const original = fixture.button("missing");
  const replacement = fixture.button("replacement");
  fixture.pointAt(original);
  fixture.queryWith((selector, now) => selector === "#missing" && now >= 250 ? original : null);
  await fixture.api.playEvent(coordinateClick());
  assert.equal(original.clickCount, 1);
  assert.equal(replacement.clickCount, 0);
  assert.deepEqual(fixture.pointQueries, [[100, 400]]);
});

test("a selector covered by a layer clicks the element actually under the recorded point", async (t) => {
  const fixture = createEvents(t);
  const background = fixture.button("missing");
  const layer = fixture.button("layer");
  fixture.pointAt(layer);
  await fixture.api.playEvent(coordinateClick());
  assert.equal(background.clickCount, 0);
  assert.equal(layer.clickCount, 1);
  assert.equal(layer.dispatched[0].clientX, 100);
  assert.equal(layer.dispatched[0].clientY, 400);
  assert.deepEqual(fixture.pointQueries, [[100, 400]]);
});

test("a selector covered by a layer does not break the remaining replay actions", async (t) => {
  const fixture = createEvents(t);
  const background = fixture.button("missing");
  const layer = fixture.button("layer");
  const next = fixture.button("next");
  fixture.pointAt(layer);
  const recorder = fixture.recorder([
    coordinateClick(),
    { type: "click", selector: "#next", at: 1, page: "/test" },
  ]);
  await recorder.replay("first");
  assert.deepEqual(fixture.played, [layer, next]);
  assert.equal(background.clickCount, 0);
  assert.equal(recorder.getState().completedReplaySessionId, "first");
  assert.equal(recorder.getState().failedReplaySessionId, "");
});

test("a click without saved screen coordinates keeps selector-based replay", async (t) => {
  const fixture = createEvents(t);
  const background = fixture.button("background");
  const layer = fixture.button("layer");
  fixture.pointAt(layer);
  await fixture.api.playEvent({
    type: "click", selector: "#background", pointer: { xPercent: 10, yPercent: 20 },
  });
  assert.equal(background.clickCount, 1);
  assert.equal(layer.clickCount, 0);
  assert.deepEqual(fixture.pointQueries, []);
});

test("disabling coordinate fallback also preserves selector-based clicks behind overlays", async (t) => {
  const fixture = createEvents(t, { allowCoordinateClickFallback: false });
  const background = fixture.button("missing");
  const layer = fixture.button("layer");
  fixture.pointAt(layer);
  await fixture.api.playEvent(coordinateClick());
  assert.equal(background.clickCount, 1);
  assert.equal(layer.clickCount, 0);
  assert.deepEqual(fixture.pointQueries, []);
});

test("a covered checkbox does not force its recorded checked state onto another checkbox", async (t) => {
  const fixture = createEvents(t);
  const original = fixture.input("original");
  original.type = "checkbox";
  original.checked = false;
  const layerCheckbox = fixture.input("layer");
  layerCheckbox.type = "checkbox";
  layerCheckbox.checked = true;
  fixture.pointAt(layerCheckbox);
  await fixture.api.playEvent({ ...coordinateClick(), selector: "#original", replayChecked: true });
  assert.equal(original.clickCount, 0);
  assert.equal(original.checked, false);
  assert.equal(layerCheckbox.clickCount, 1);
  assert.equal(layerCheckbox.checked, false);
});

test("coordinate fallback can be disabled without affecting selector replay", async (t) => {
  const fixture = createEvents(t, { allowCoordinateClickFallback: false });
  const button = fixture.button();
  fixture.pointAt(button);
  await assert.rejects(fixture.api.playEvent(coordinateClick()), /재생 대상 요소를 찾지 못했습니다/);
  assert.equal(button.clickCount, 0);
  assert.deepEqual(fixture.pointQueries, []);
  await fixture.api.playEvent({ type: "click", selector: "#button" });
  assert.equal(button.clickCount, 1);
});

test("legacy and malformed coordinates never click an arbitrary point", async (t) => {
  const fixture = createEvents(t);
  const button = fixture.button();
  fixture.pointAt(button);
  const pointers = [undefined, { xPercent: 10, yPercent: 20 }, ...[
    { clientX: null }, { clientX: "100" }, { clientX: NaN },
    { clientX: -1 }, { clientX: 1000 }, { clientY: 800 },
  ].map((override) => coordinateClick(override).pointer)];
  for (const pointer of pointers) {
    await assert.rejects(fixture.api.playEvent({ ...coordinateClick(), pointer }), /재생 대상 요소를 찾지 못했습니다/);
  }
  assert.equal(button.clickCount, 0);
  assert.deepEqual(fixture.pointQueries, []);
});

test("coordinate replay clicks the original screen point despite viewport or scroll differences", async (t) => {
  const fixture = createEvents(t);
  const button = fixture.button();
  fixture.pointAt(button);
  fixture.window.innerWidth = 640;
  fixture.window.innerHeight = 640;
  fixture.window.scrollY = 200;
  for (const pointer of [
    { viewportWidth: 390, viewportHeight: 844 }, { scrollX: 300 }, { scrollY: 800 },
    { viewportWidth: undefined, viewportHeight: undefined, scrollX: undefined, scrollY: undefined },
  ]) {
    await fixture.api.playEvent(coordinateClick(pointer));
  }
  assert.deepEqual(fixture.pointQueries, Array.from({ length: 4 }, () => [100, 400]));
  assert.equal(button.clickCount, 4);
  assert.ok(button.dispatched.every((event) => event.clientX === 100 && event.clientY === 400));
});

test("coordinate fallback clicks body, html and the element actually occupying the point", async (t) => {
  const fixture = createEvents(t);
  const iframe = fixture.button("iframe");
  iframe.tagName = "IFRAME";
  const disabled = fixture.button("disabled");
  disabled.closest = (selector) => selector.includes(":disabled") ? disabled : null;
  for (const target of [fixture.body, fixture.html, iframe, disabled]) {
    fixture.pointAt(target);
    await fixture.api.playEvent(coordinateClick());
    assert.equal(target.clickCount, 1);
  }
  assert.deepEqual(fixture.played, [fixture.body, fixture.html, iframe, disabled]);
});

test("coordinate fallback still excludes the recorder's own controls and absent point targets", async (t) => {
  const fixture = createEvents(t);
  const ignored = fixture.button("ignored");
  ignored.closest = (selector) => selector === "[data-user-flow-ignore]" ? ignored : null;
  for (const target of [null, ignored]) {
    fixture.pointAt(target);
    await assert.rejects(fixture.api.playEvent(coordinateClick()), /저장된 클릭 좌표에서 클릭할 요소를 찾지 못했습니다/);
  }
  assert.deepEqual(fixture.played, []);
});

test("old logs without a screen point report missing coordinate data explicitly", async (t) => {
  const fixture = createEvents(t);
  fixture.pointAt(fixture.button());
  await assert.rejects(fixture.api.playEvent({
    type: "click", selector: "#missing", pointer: { xPercent: 10, yPercent: 20 },
  }), /로그에 저장된 클릭 좌표가 없습니다/);
  assert.deepEqual(fixture.pointQueries, []);
  assert.deepEqual(fixture.played, []);
});

test("main recorder completes after coordinate fallback with a different saved viewport and scroll", async (t) => {
  const fixture = createEvents(t);
  fixture.pointAt(fixture.body);
  const recorder = fixture.recorder([coordinateClick({
    viewportWidth: 390, viewportHeight: 844, scrollY: 1200,
  })]);
  await recorder.replay("first");
  assert.deepEqual(fixture.pointQueries, [[100, 400]]);
  assert.equal(fixture.body.clickCount, 1);
  assert.equal(recorder.getState().completedReplaySessionId, "first");
  assert.equal(recorder.getState().failedReplaySessionId, "");
});

test("input, change and scroll events never use coordinate click fallback", async (t) => {
  const fixture = createEvents(t);
  fixture.pointAt(fixture.button());
  for (const type of ["input", "change", "scroll"]) {
    await assert.rejects(fixture.api.playEvent({ ...coordinateClick(), type }), /재생 대상 요소를 찾지 못했습니다/);
  }
  assert.deepEqual(fixture.pointQueries, []);
  assert.deepEqual(fixture.played, []);
});

test("stopping a target wait prevents a later coordinate click", async (t) => {
  const fixture = createEvents(t);
  fixture.pointAt(fixture.button());
  await fixture.api.playEvent(coordinateClick(), { shouldAbort: () => fixture.now >= 250 });
  assert.equal(fixture.now, 250);
  assert.deepEqual(fixture.pointQueries, []);
  assert.deepEqual(fixture.played, []);
});

test("coordinate fallback retains checkbox replay state", async (t) => {
  const fixture = createEvents(t);
  const checkbox = fixture.input();
  checkbox.type = "checkbox";
  checkbox.checked = true;
  fixture.pointAt(checkbox);
  await fixture.api.playEvent({ ...coordinateClick(), replayChecked: true });
  assert.equal(checkbox.clickCount, 1);
  assert.equal(checkbox.checked, true);
  assert.equal(checkbox.dispatched.find((event) => event.type === "click").clientX, 100);
});

test("the main recorder continues remaining actions after a coordinate fallback", async (t) => {
  const fixture = createEvents(t);
  const replacement = fixture.button("replacement");
  const next = fixture.button("next");
  fixture.pointAt(replacement);
  const recorder = fixture.recorder([
    coordinateClick(),
    { type: "click", selector: "#next", at: 1, page: "/test" },
  ]);
  await recorder.replay("first");
  assert.deepEqual(fixture.played, [replacement, next]);
  assert.equal(recorder.getState().completedReplaySessionId, "first");
  assert.equal(recorder.getState().failedReplaySessionId, "");
  assert.equal(recorder.getState().error, "");
});

test("the main recorder reports a failure when neither selector nor coordinates resolve", async (t) => {
  const fixture = createEvents(t);
  const next = fixture.button("next");
  const recorder = fixture.recorder([
    coordinateClick(),
    { type: "click", selector: "#next", at: 1, page: "/test" },
  ]);
  await recorder.replay("first");
  assert.equal(next.clickCount, 0);
  assert.equal(recorder.getState().completedReplaySessionId, "");
  assert.equal(recorder.getState().failedReplaySessionId, "first");
  assert.match(recorder.getState().error, /재생 대상 요소를 찾지 못했습니다/);
});

test("stopping the main recorder during target lookup cancels coordinate fallback and remaining actions", async (t) => {
  const fixture = createEvents(t);
  fixture.pointAt(fixture.button("replacement"));
  const recorder = fixture.recorder([
    coordinateClick(),
    { type: "click", selector: "#next", at: 1, page: "/test" },
  ]);
  fixture.queryWith((selector, now) => {
    if (now >= 250) recorder.stopReplay();
    return null;
  });
  await recorder.replay("first");
  assert.deepEqual(fixture.pointQueries, []);
  assert.deepEqual(fixture.played, []);
  assert.equal(recorder.getState().isReplaying, false);
  assert.equal(recorder.getState().completedReplaySessionId, "");
  assert.equal(recorder.getState().failedReplaySessionId, "");
});
