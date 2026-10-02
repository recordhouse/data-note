const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../js/popup-core.js"), "utf8");
const styleId = "data-note-replay-window-scrollbars";
const parentReady = "response-mapping-popup-parent-ready";

function createDocument() {
  const nodes = new Map();
  const appended = [];
  const container = {
    append(node) {
      appended.push(node);
      if (node.id) nodes.set(node.id, node);
    },
  };
  return {
    nodes, appended,
    head: container, documentElement: container, scripts: [],
    getElementById: (id) => nodes.get(id) || null,
    createElement: (tagName) => ({ tagName: tagName.toUpperCase() }),
  };
}

function createSite(url = "https://example.test/site") {
  return {
    closed: false,
    location: new URL(url),
    document: createDocument(),
    PopupCore: {},
    postMessage() {},
  };
}

async function createPopup() {
  const originalSite = createSite();
  const popupDocument = createDocument();
  const listeners = new Map();
  let monitor;
  popupDocument.currentScript = { src: "https://example.test/js/popup-core.js", dataset: {} };
  popupDocument.querySelector = (selector) => selector === "[data-popup-tab]" ? {} : null;
  popupDocument.addEventListener = () => {};
  popupDocument.dispatchEvent = () => {};
  const window = {
    opener: originalSite,
    location: new URL("https://example.test/popup.html"),
    UserFlowArchive: {}, UserFlowImport: {}, UserFlowPopup: {}, ResponseMappingFeature: {},
    addEventListener: (type, callback) => listeners.set(type, callback),
    setInterval(callback) { monitor = callback; return 1; },
    clearInterval() {},
  };
  class CustomEvent extends Event {
    constructor(type, options = {}) { super(type); this.detail = options.detail; }
  }
  vm.runInContext(source, vm.createContext({ window, document: popupDocument, URL, CustomEvent, console }));
  await window.PopupCore.ready;
  return {
    core: window.PopupCore,
    originalSite,
    popupDocument,
    monitor: () => monitor(),
    ready(site, origin = "https://example.test") {
      listeners.get("message")({ source: site, origin, data: { type: parentReady } });
    },
  };
}

test("new-window styling hides only page scrollbars without disabling scrolling or nested regions", async () => {
  const fixture = await createPopup();
  const site = createSite("about:blank");
  assert.equal(fixture.core.connectParent(site, { hideScrollbars: true }), true);
  const style = site.document.getElementById(styleId);
  assert.ok(style);
  assert.match(style.textContent, /html, body\s*\{ scrollbar-width: none !important;/);
  assert.match(style.textContent, /html::-webkit-scrollbar, body::-webkit-scrollbar/);
  assert.match(style.textContent, /display: none !important/);
  assert.doesNotMatch(style.textContent, /overflow|touch-action|pointer-events|\*/);
  assert.equal(fixture.originalSite.document.getElementById(styleId), null);
  assert.equal(fixture.popupDocument.getElementById(styleId), null);
});

test("ordinary site connections and result tabs retain page scrollbars", async () => {
  const fixture = await createPopup();
  const site = createSite();
  assert.equal(fixture.core.connectParent(site), true);
  fixture.ready(site);
  fixture.monitor();
  assert.equal(site.document.getElementById(styleId), null);
  const result = createSite();
  assert.equal(fixture.core.connectParent(result, { hideScrollbars: false }), true);
  fixture.monitor();
  assert.equal(result.document.getElementById(styleId), null);
});

test("repeated connection monitoring and readiness messages do not recreate the stylesheet", async () => {
  const fixture = await createPopup();
  const site = createSite();
  fixture.core.connectParent(site, { hideScrollbars: true });
  for (let index = 0; index < 20; index += 1) {
    fixture.monitor();
    fixture.ready(site);
    fixture.core.connectParent(site);
  }
  assert.equal(site.document.appended.length, 1);
});

test("a new-window navigation or refresh gets the page scrollbar style again", async () => {
  const fixture = await createPopup();
  const site = createSite("about:blank");
  fixture.core.connectParent(site, { hideScrollbars: true });
  site.location = new URL("https://example.test/recorded");
  site.document = createDocument();
  fixture.monitor();
  assert.ok(site.document.getElementById(styleId));
  site.document = createDocument();
  fixture.ready(site);
  assert.ok(site.document.getElementById(styleId));
  fixture.monitor();
  assert.equal(site.document.appended.length, 1);
});

test("switching to a test tab and back preserves the selected new-window policy only", async () => {
  const fixture = await createPopup();
  const site = createSite();
  fixture.core.connectParent(site, { hideScrollbars: true });
  const result = createSite();
  fixture.core.connectParent(result);
  fixture.monitor();
  assert.equal(result.document.getElementById(styleId), null);
  site.document = createDocument();
  fixture.core.connectParent(site);
  assert.ok(site.document.getElementById(styleId));
});

test("closed or cross-origin windows cannot opt in or receive injected styles", async () => {
  const fixture = await createPopup();
  const site = createSite("https://other.test/site");
  assert.equal(fixture.core.connectParent(site, { hideScrollbars: true }), false);
  fixture.ready(site, "https://other.test");
  fixture.monitor();
  assert.equal(site.document.getElementById(styleId), null);
  site.location = new URL("https://example.test/site");
  assert.equal(fixture.core.connectParent(site), true);
  assert.equal(site.document.getElementById(styleId), null);
  const closed = createSite();
  closed.closed = true;
  assert.equal(fixture.core.connectParent(closed, { hideScrollbars: true }), false);
  assert.equal(closed.document.getElementById(styleId), null);
});

test("an unavailable document head is retried without adding duplicate styles", async () => {
  const fixture = await createPopup();
  const site = createSite();
  const container = site.document.head;
  site.document.head = null;
  site.document.documentElement = null;
  assert.equal(fixture.core.connectParent(site, { hideScrollbars: true }), true);
  assert.equal(site.document.getElementById(styleId), null);
  site.document.head = container;
  fixture.monitor();
  fixture.monitor();
  assert.equal(site.document.appended.length, 1);
});
