const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const storageKey = "response-mapping-user-flow-recording:v1";
const toPlain = (value) => JSON.parse(JSON.stringify(value));
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/150.0.0.0 Safari/537.36";
const MOBILE_UA = "Mozilla/5.0 (Linux; Android 13) Chrome/150.0.0.0 Mobile Safari/537.36";

function createRecorder(t, sessions = []) {
  const timers = new Set();
  const clock = { now: 100, wall: 1800000000000 };
  const storage = new Map([[storageKey, JSON.stringify({ version: 4, sessions })]]);
  const downloads = [];
  const archives = [];
  const blobs = new Map();
  let recordEvent;
  let failWrites = false;
  class TestDate extends Date {
    static now() { return clock.wall; }
  }
  class TestURL extends URL {
    static createObjectURL(blob) {
      const url = `blob:test-${blobs.size}`;
      blobs.set(url, blob);
      return url;
    }
    static revokeObjectURL() {}
  }
  const window = {
    location: new URL("https://example.test/test?state=initial"),
    navigator: { userAgent: DESKTOP_UA, userAgentData: { mobile: false } },
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      removeItem: (key) => storage.delete(key),
      setItem(key, value) {
        if (failWrites) throw new Error("Storage unavailable");
        storage.set(key, value);
      },
    },
    addEventListener() {},
    setTimeout(callback, ms) {
      const timer = setTimeout(callback, ms);
      timers.add(timer);
      return timer;
    },
    clearTimeout,
    UserFlowRequestTracker: { create: () => ({ install() {} }) },
    UserFlowArchive: {
      createArchive(entries) {
        archives.push(entries);
        return new Blob([]);
      },
    },
    UserFlowRecorderEvents: {
      create(options) {
        recordEvent = options.recordEvent;
        return {
          handleClick() {},
          handleFormChange() {},
          handleScroll() {},
          resetScrollTracking() {},
        };
      },
    },
  };
  const context = vm.createContext({
    window,
    document: {
      querySelector: () => null,
      readyState: "complete",
      addEventListener() {},
      body: { append() {} },
      createElement: () => ({
        setAttribute() {},
        click() { downloads.push({ fileName: this.download, blob: blobs.get(this.href) }); },
        remove() {},
      }),
    },
    URL: TestURL,
    Blob,
    Date: TestDate,
    performance: { now: () => clock.now },
    console,
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../js/user-flow-recorder.js"), "utf8"),
    context,
  );
  t.after(() => timers.forEach(clearTimeout));
  return {
    window,
    clock,
    downloads,
    archives,
    recorder: window.UserFlowRecorder,
    record: (event = {}) => recordEvent({ type: "click", selector: "#button", ...event }),
    storedSessions: () => JSON.parse(storage.get(storageKey)).sessions,
    failWrites: (fail) => { failWrites = fail; },
  };
}

test("stopping keeps one list and repeated stop does not create a duplicate", (t) => {
  const { recorder, clock, record, window, storedSessions } = createRecorder(t);
  assert.equal(recorder.start(), true);
  const originalId = recorder.getState().activeRecordingSessionId;
  clock.now += 40;
  record();
  window.location.search = "?state=stopped";
  recorder.stop();
  recorder.stop();
  const stopped = recorder.getState();
  assert.equal(stopped.sessions.length, 1);
  assert.equal(stopped.sessions[0].id, originalId);
  assert.equal(stopped.sessions[0].titlePrefix, "stopped");
  assert.equal(stopped.resumeRecordingSessionId, originalId);
  assert.equal(storedSessions().length, 1);
});

test("resuming creates a new log and preserves the renamed original and its events", (t) => {
  const { recorder, clock, record, window, storedSessions } = createRecorder(t);
  recorder.start();
  const originalId = recorder.getState().activeRecordingSessionId;
  clock.now += 30;
  record({ target: { text: "original" } });
  clock.now += 70;
  recorder.stop();
  assert.equal(recorder.renameSession(originalId, "원본 이름"), true);
  const original = toPlain(storedSessions()[0]);
  clock.now += 10000;
  clock.wall += 10000;
  window.location.search = "?state=continued";
  assert.equal(recorder.resume(), true);
  const active = recorder.getState();
  const continuedId = active.activeRecordingSessionId;
  assert.notEqual(continuedId, originalId);
  assert.equal(active.continuedRecordingSourceSessionId, originalId);
  assert.equal(active.sessions.length, 2);
  assert.equal(active.sessions[0].id, continuedId);
  assert.equal(active.sessions[0].recordedAt, clock.wall);
  assert.equal(active.sessions[0].name, "");
  assert.deepEqual(toPlain(recorder.getEvents(continuedId)), original.events);
  clock.now += 20;
  record({ selector: "#continued" });
  recorder.stop();
  assert.equal(recorder.getState().sessions.length, 2);
  assert.equal(recorder.getEvents(continuedId).length, 2);
  assert.equal(recorder.getEvents(continuedId)[1].at, 120);
  assert.deepEqual(storedSessions().find((session) => session.id === originalId), original);
  assert.equal(recorder.getState().resumeRecordingSessionId, continuedId);
});

test("each subsequent continuation creates exactly one new independent list", (t) => {
  const { recorder, clock, record } = createRecorder(t);
  recorder.start();
  record();
  recorder.stop();
  const originalId = recorder.getState().resumeRecordingSessionId;
  clock.wall += 1000;
  assert.equal(recorder.resume(), true);
  const firstContinuationId = recorder.getState().activeRecordingSessionId;
  clock.now += 10;
  record();
  recorder.stop();
  assert.equal(recorder.getState().sessions.length, 2);
  clock.wall += 1000;
  assert.equal(recorder.resume(), true);
  const secondContinuationId = recorder.getState().activeRecordingSessionId;
  assert.equal(recorder.getState().continuedRecordingSourceSessionId, firstContinuationId);
  clock.now += 10;
  record();
  recorder.stop();
  assert.equal(recorder.getState().sessions.length, 3);
  assert.equal(recorder.getEvents(originalId).length, 1);
  assert.equal(recorder.getEvents(firstContinuationId).length, 2);
  assert.equal(recorder.getEvents(secondContinuationId).length, 3);
});

test("failed continuation save does not leave a phantom list or change the original", (t) => {
  const { recorder, clock, record, failWrites, storedSessions } = createRecorder(t);
  recorder.start();
  record();
  recorder.stop();
  const originalId = recorder.getState().resumeRecordingSessionId;
  const original = toPlain(storedSessions()[0]);
  failWrites(true);
  assert.equal(recorder.resume(), false);
  assert.equal(recorder.getState().isRecording, false);
  assert.equal(recorder.getState().sessions.length, 1);
  assert.equal(recorder.getState().resumeRecordingSessionId, originalId);
  assert.deepEqual(storedSessions()[0], original);
  failWrites(false);
  clock.wall += 1000;
  assert.equal(recorder.resume(), true);
  assert.equal(recorder.getState().sessions.length, 2);
});

test("the last available slot can be used and stopping needs no extra slot", (t) => {
  const sessions = Array.from({ length: 149 }, (_, index) => ({
    id: `existing-${index}`,
    recordedAt: 1700000000000 + index,
    events: [],
  }));
  const { recorder, record, storedSessions } = createRecorder(t, sessions);
  assert.equal(recorder.start(), true);
  record();
  recorder.stop();
  const originalId = recorder.getState().resumeRecordingSessionId;
  assert.equal(storedSessions().length, 150);
  assert.equal(recorder.getState().error, "");
  assert.equal(recorder.resume(), false);
  assert.equal(recorder.getState().resumeRecordingSessionId, originalId);
  assert.equal(storedSessions().length, 150);
});

test("recording captures its initial viewport once and retains it after reload", (t) => {
  const fixture = createRecorder(t);
  fixture.window.innerWidth = 390;
  fixture.window.innerHeight = 844;
  assert.equal(fixture.recorder.start(), true);
  fixture.record();
  fixture.window.innerWidth = 1280;
  fixture.window.innerHeight = 720;
  fixture.recorder.stop();
  const expected = { width: 390, height: 844 };
  assert.deepEqual(toPlain(fixture.recorder.getState().sessions[0].viewport), expected);
  assert.deepEqual(fixture.storedSessions()[0].viewport, expected);
  const reloaded = createRecorder(t, fixture.storedSessions());
  assert.deepEqual(toPlain(reloaded.recorder.getState().sessions[0].viewport), expected);
});

test("legacy logs keep unknown viewport metadata instead of borrowing the current page size", (t) => {
  const fixture = createRecorder(t, [{ id: "legacy", recordedAt: 1, events: [] }]);
  fixture.window.innerWidth = 390;
  fixture.window.innerHeight = 844;
  assert.equal(fixture.recorder.getState().sessions[0].viewport, null);
  assert.equal(fixture.recorder.renameSession("legacy", "renamed"), true);
  assert.equal(fixture.storedSessions()[0].viewport, null);
});

test("continued recording preserves the source viewport for its original actions", (t) => {
  const fixture = createRecorder(t);
  fixture.window.innerWidth = 390;
  fixture.window.innerHeight = 844;
  fixture.recorder.start();
  fixture.record();
  fixture.recorder.stop();
  fixture.window.innerWidth = 1280;
  fixture.window.innerHeight = 720;
  fixture.clock.wall += 1000;
  assert.equal(fixture.recorder.resume(), true);
  fixture.recorder.stop();
  assert.equal(fixture.storedSessions().length, 2);
  assert.ok(fixture.storedSessions().every((session) =>
    session.viewport.width === 390 && session.viewport.height === 844,
  ));
});

test("continued recording without a known source viewport captures the current size", (t) => {
  const fixture = createRecorder(t);
  fixture.recorder.start();
  fixture.record();
  fixture.recorder.stop();
  const originalId = fixture.recorder.getState().resumeRecordingSessionId;
  fixture.window.innerWidth = 390;
  fixture.window.innerHeight = 844;
  fixture.clock.wall += 1000;
  assert.equal(fixture.recorder.resume(), true);
  fixture.recorder.stop();
  assert.deepEqual(fixture.storedSessions()[0].viewport, { width: 390, height: 844 });
  assert.equal(fixture.storedSessions().find((session) => session.id === originalId).viewport, null);
});

test("JSON export and import preserve viewport, mobile environment and click coordinate metadata", async (t) => {
  const fixture = createRecorder(t);
  fixture.window.innerWidth = 390;
  fixture.window.innerHeight = 844;
  fixture.window.navigator = { userAgent: MOBILE_UA, userAgentData: { mobile: true } };
  fixture.recorder.start();
  const pointer = {
    clientX: 100, clientY: 400, viewportWidth: 390, viewportHeight: 844,
    scrollX: 0, scrollY: 200, xPercent: 25, yPercent: 50, pointerType: "touch",
  };
  fixture.record({ pointer });
  fixture.recorder.stop();
  const sessionId = fixture.recorder.getState().sessions[0].id;
  assert.equal(fixture.recorder.exportRecording(sessionId), true);
  const exported = JSON.parse(await fixture.downloads[0].blob.text());
  assert.equal(exported.version, 7);
  assert.deepEqual(exported.session.viewport, { width: 390, height: 844 });
  const imported = createRecorder(t);
  assert.equal(imported.recorder.importRecordings(exported), true);
  assert.deepEqual(imported.storedSessions()[0].viewport, exported.session.viewport);
  assert.deepEqual(toPlain(imported.recorder.getState().sessions[0].viewport), exported.session.viewport);
  assert.deepEqual(exported.session.environment, { isMobile: true, userAgent: MOBILE_UA });
  assert.deepEqual(imported.storedSessions()[0].environment, exported.session.environment);
  assert.deepEqual(exported.session.events[0].pointer, pointer);
  assert.deepEqual(imported.storedSessions()[0].events[0].pointer, pointer);
});

test("ZIP session entries retain viewport, mobile environment and click coordinates for re-import", (t) => {
  const fixture = createRecorder(t);
  fixture.window.innerWidth = 390;
  fixture.window.innerHeight = 844;
  fixture.window.navigator = { userAgent: MOBILE_UA, userAgentData: { mobile: true } };
  fixture.recorder.start();
  const pointer = {
    clientX: 100, clientY: 400, viewportWidth: 390, viewportHeight: 844,
    scrollX: 0, scrollY: 200, xPercent: 25, yPercent: 50, pointerType: "touch",
  };
  fixture.record({ pointer });
  fixture.recorder.stop();
  assert.equal(fixture.recorder.exportAllRecordings(), true);
  const sessionEntry = fixture.archives[0].find((entry) => entry.name.endsWith(".json") && entry.name.includes("/"));
  assert.ok(sessionEntry);
  const exported = JSON.parse(sessionEntry.data);
  assert.deepEqual(exported.session.viewport, { width: 390, height: 844 });
  const imported = createRecorder(t);
  assert.equal(imported.recorder.importRecordings(exported), true);
  assert.deepEqual(imported.storedSessions()[0].viewport, exported.session.viewport);
  assert.deepEqual(exported.session.environment, { isMobile: true, userAgent: MOBILE_UA });
  assert.deepEqual(imported.storedSessions()[0].environment, exported.session.environment);
  assert.deepEqual(exported.session.events[0].pointer, pointer);
  assert.deepEqual(imported.storedSessions()[0].events[0].pointer, pointer);
});

test("recording captures browser mobile hints independently of viewport width", (t) => {
  const fixture = createRecorder(t);
  fixture.window.innerWidth = 390;
  fixture.window.innerHeight = 844;
  fixture.recorder.start();
  fixture.record();
  fixture.recorder.stop();
  assert.deepEqual(fixture.storedSessions()[0].environment, { isMobile: false, userAgent: DESKTOP_UA });
  fixture.window.navigator = { userAgent: MOBILE_UA, userAgentData: { mobile: true } };
  fixture.clock.wall += 1000;
  // A fresh save, not continuation, must capture the current environment.
  fixture.recorder.clear();
  fixture.recorder.start();
  fixture.record();
  fixture.recorder.stop();
  assert.deepEqual(fixture.storedSessions()[0].environment, { isMobile: true, userAgent: MOBILE_UA });
  const reloaded = createRecorder(t, fixture.storedSessions());
  assert.deepEqual(toPlain(reloaded.recorder.getState().sessions[0].environment), { isMobile: true, userAgent: MOBILE_UA });
});

test("recording falls back to UA detection when mobile client hints are unavailable", (t) => {
  for (const [userAgent, isMobile] of [[MOBILE_UA, true], [DESKTOP_UA, false]]) {
    const fixture = createRecorder(t);
    fixture.window.navigator = { userAgent };
    fixture.recorder.start();
    fixture.record();
    fixture.recorder.stop();
    assert.deepEqual(fixture.storedSessions()[0].environment, { isMobile, userAgent });
  }
});

test("legacy logs retain an unknown environment instead of guessing from the current browser", (t) => {
  const fixture = createRecorder(t, [{ id: "legacy", recordedAt: 1, events: [] }]);
  fixture.window.navigator = { userAgent: MOBILE_UA, userAgentData: { mobile: true } };
  assert.equal(fixture.recorder.getState().sessions[0].environment, null);
  fixture.recorder.renameSession("legacy", "renamed");
  assert.equal(fixture.storedSessions()[0].environment, null);
});

test("continued recordings preserve the original environment even when the browser mode changes", (t) => {
  const fixture = createRecorder(t);
  fixture.window.navigator = { userAgent: MOBILE_UA, userAgentData: { mobile: true } };
  fixture.recorder.start();
  fixture.record();
  fixture.recorder.stop();
  fixture.window.navigator = { userAgent: DESKTOP_UA, userAgentData: { mobile: false } };
  fixture.clock.wall += 1000;
  assert.equal(fixture.recorder.resume(), true);
  fixture.recorder.stop();
  assert.ok(fixture.storedSessions().every((session) =>
    session.environment.isMobile && session.environment.userAgent === MOBILE_UA,
  ));
});

test("imported viewport sizes are normalized and malformed metadata does not reject valid logs", (t) => {
  const fixture = createRecorder(t);
  const viewports = [
    { width: 390.4, height: 843.6, ignored: "extra" },
    undefined, null, {}, { width: 390 }, { width: "390", height: 844 },
    { width: 0, height: 844 }, { width: 390, height: -844 },
    { width: NaN, height: 844 }, { width: 390, height: Infinity },
    { width: 16385, height: 844 },
  ];
  assert.equal(fixture.recorder.importRecordings({ sessions: viewports.map((viewport, index) => ({
    id: `import-${index}`,
    recordedAt: 100 + index,
    viewport,
    events: [{ type: "click", selector: "#button", at: 10 }],
  })) }), true);
  const sessions = fixture.storedSessions();
  assert.equal(sessions.length, viewports.length);
  assert.deepEqual(sessions.find((session) => session.id === "import-0").viewport, { width: 390, height: 844 });
  assert.ok(sessions.filter((session) => session.id !== "import-0").every((session) => session.viewport === null));
});

test("continued log goes to the top of its original tab without being added to tests", () => {
  const source = fs.readFileSync(path.join(__dirname, "../js/user-flow-popup.js"), "utf8");
  const start = source.indexOf("  function placeNewRecordingAtTop(");
  const end = source.indexOf("  function getOrderedUserFlowSessions(", start);
  assert.ok(start >= 0 && end > start);
  let writes = 0;
  const tabs = {
    activeTabId: "other-tab",
    sessionOrder: ["other", "original", "continued"],
    sessionTabs: { original: "source-tab", continued: "other-tab" },
    testSessionIds: ["original"],
  };
  const context = vm.createContext({
    userFlowTabs: tabs,
    getUserFlowSessionTabId: (id) => tabs.sessionTabs[id],
    persistUserFlowTabs: () => { writes += 1; },
  });
  vm.runInContext(source.slice(start, end), context);
  vm.runInContext('placeNewRecordingAtTop("continued", "original")', context);
  assert.deepEqual(toPlain(tabs.sessionOrder), ["continued", "other", "original"]);
  assert.equal(tabs.sessionTabs.continued, "source-tab");
  assert.equal(tabs.activeTabId, "source-tab");
  assert.deepEqual(tabs.testSessionIds, ["original"]);
  assert.equal(writes, 1);
  vm.runInContext('placeNewRecordingAtTop("", "original")', context);
  assert.equal(writes, 1);
});
