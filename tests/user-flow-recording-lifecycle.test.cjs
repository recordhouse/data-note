const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const storageKey = "response-mapping-user-flow-recording:v1";
const toPlain = (value) => JSON.parse(JSON.stringify(value));

function createRecorder(t, sessions = []) {
  const timers = new Set();
  const clock = { now: 100, wall: 1800000000000 };
  const storage = new Map([[storageKey, JSON.stringify({ version: 4, sessions })]]);
  let recordEvent;
  let failWrites = false;
  class TestDate extends Date {
    static now() { return clock.wall; }
  }
  const window = {
    location: new URL("https://example.test/test?state=initial"),
    localStorage: {
      getItem: (key) => storage.get(key) || null,
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
    document: { querySelector: () => null, readyState: "complete", addEventListener() {} },
    URL,
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
