const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createEvents(t) {
  const timers = new Set();
  const recorded = [];
  const played = [];
  const scrolls = [];
  const queries = [];
  const nodes = new Map();
  const storage = new Map();
  let now = 100;
  let queryOverride = null;

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
    }
    closest() { return null; }
    getAttribute(name) { return this.attributes.get(name) || null; }
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 1000, height: 2000 };
    }
    dispatchEvent(event) {
      this.dispatched.push(event);
      return true;
    }
    click() {
      this.clickCount += 1;
      played.push(this);
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
    api, body, html, window, document, recorded, played, scrolls, queries,
    get now() { return now; },
    queryWith: (callback) => { queryOverride = callback; },
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
