const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createRecorder(t, { fetch, playEvent, events, timeoutCap = Infinity } = {}) {
  const timers = new Set();
  const listeners = new Map();
  const clicks = [];
  const storage = new Map();
  const sessions = ["first", "second"].map((id) => ({
    id,
    recordedAt: Date.now(),
    events: events || [{ type: "click", selector: `#${id}`, at: 0, page: "/test" }],
  }));
  storage.set(
    "response-mapping-user-flow-recording:v1",
    JSON.stringify({ sessions }),
  );

  class FakeXhr extends EventTarget {
    open() {}
    send() {}
    complete() {
      this.status = 200;
      this.statusText = "OK";
      this.dispatchEvent(new Event("load"));
    }
  }

  const window = {
    location: new URL("https://example.test/test"),
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
    },
    fetch: fetch || (async () => ({ ok: true, status: 200 })),
    XMLHttpRequest: FakeXhr,
    focus() {},
    addEventListener: (type, callback) => listeners.set(type, callback),
    setTimeout(callback, ms) {
      const timer = setTimeout(callback, Math.min(ms, timeoutCap));
      timers.add(timer);
      return timer;
    },
    clearTimeout: (timer) => clearTimeout(timer),
    setInterval(callback, ms) {
      const timer = setInterval(callback, ms);
      timers.add(timer);
      return timer;
    },
    clearInterval: (timer) => clearInterval(timer),
    UserFlowRecorderEvents: {
      create: () => ({
        createReplayEvents: (events) => events,
        handleClick() {},
        handleFormChange() {},
        handleScroll() {},
        resetScrollTracking() {},
        sleep: delay,
        waitForRenderFrame: () => delay(1),
        playEvent: playEvent || (async (event) => clicks.push({ selector: event.selector, at: performance.now() })),
      }),
    },
  };
  const context = vm.createContext({
    window,
    document: { querySelector: () => null, readyState: "complete", addEventListener() {} },
    URL,
    performance,
    console,
  });
  for (const file of ["user-flow-request-tracker.js", "user-flow-recorder.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../js", file), "utf8"), context);
  }
  t.after(() => {
    for (const timer of timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
  });
  return { window, recorder: window.UserFlowRecorder, clicks, listeners };
}

test("each test item waits for a parent's outstanding Ajax request", async (t) => {
  const { window, recorder, clicks } = createRecorder(t);
  for (const [index, sessionId] of ["first", "second"].entries()) {
    const xhr = new window.XMLHttpRequest();
    xhr.open("GET", "/api/panel");
    xhr.send();
    const replay = recorder.replay(sessionId, { waitForNetworkIdle: true });
    await delay(80);
    assert.equal(clicks.length, index);
    const completedAt = performance.now();
    xhr.complete();
    await replay;
    assert.equal(recorder.getState().completedReplaySessionId, sessionId);
    assert.equal(clicks[index].selector, `#${sessionId}`);
    assert.ok(clicks[index].at - completedAt >= 490);
  }
});

test("fetch body consumption is pending after response headers arrive", async (t) => {
  let finishBody;
  const response = {
    ok: true,
    status: 200,
    json: () => new Promise((resolve) => { finishBody = resolve; }),
  };
  const { window, recorder, clicks } = createRecorder(t, { fetch: async () => response });
  const body = window.fetch("/api/body").then((result) => result.json());
  await delay(1);
  assert.equal(recorder.getState().pendingRequestCount, 1);
  const replay = recorder.replay("first", { waitForNetworkIdle: true });
  await delay(650);
  assert.equal(clicks.length, 0);
  const completedAt = performance.now();
  finishBody({ ready: true });
  assert.deepEqual(await body, { ready: true });
  await replay;
  assert.ok(clicks[0].at - completedAt >= 490);
});

test("a new request in the idle gap restarts the test's quiet period", async (t) => {
  const { recorder, clicks } = createRecorder(t);
  const first = recorder.requestStart("fetch:GET:https://example.test/api/first");
  const replay = recorder.replay("first", { waitForNetworkIdle: true });
  recorder.requestEnd(first, { status: 200 });
  await delay(250);
  const chained = recorder.requestStart("fetch:GET:https://example.test/api/chained");
  await delay(300);
  assert.equal(clicks.length, 0);
  const completedAt = performance.now();
  recorder.requestEnd(chained, { status: 200 });
  await replay;
  assert.ok(clicks[0].at - completedAt >= 490);
});

test("five identical outstanding requests cannot bypass a test wait", async (t) => {
  const { recorder, clicks } = createRecorder(t);
  const requestIds = Array.from({ length: 5 }, () => recorder.requestStart("same-request"));
  const replay = recorder.replay("first", { waitForNetworkIdle: true });
  assert.equal(recorder.getState().blockingRequestCount, 0);
  assert.equal(recorder.getState().pendingRequestCount, 5);
  await delay(70);
  assert.equal(clicks.length, 0);
  requestIds.forEach((id) => recorder.requestEnd(id, { status: 200 }));
  await replay;
  assert.equal(clicks.length, 1);
});

test("stopping a waiting test never executes its first action", async (t) => {
  const { recorder, clicks } = createRecorder(t);
  recorder.requestStart("still-pending");
  const replay = recorder.replay("first", { waitForNetworkIdle: true });
  await delay(60);
  recorder.stopReplay();
  await replay;
  assert.equal(clicks.length, 0);
  assert.equal(recorder.getState().pendingRequestCount, 1);
  assert.equal(recorder.getState().completedReplaySessionId, "");
  assert.equal(recorder.getState().failedReplaySessionId, "");
});

test("timeout leaves real requests pending and subsequent tests cannot bypass them", async (t) => {
  const { recorder, clicks } = createRecorder(t, { timeoutCap: 180 });
  recorder.requestStart("never-finished");
  for (const sessionId of ["first", "second"]) {
    await recorder.replay(sessionId, { waitForNetworkIdle: true });
    assert.match(recorder.getState().error, /통신 대기 시간/);
    assert.equal(recorder.getState().pendingRequestCount, 1);
    assert.equal(clicks.length, 0);
    assert.equal(recorder.getState().completedReplaySessionId, "");
  }
});

test("normal replay and the public request wait retain their existing behavior", async (t) => {
  const { recorder, clicks } = createRecorder(t);
  const startedAt = performance.now();
  await recorder.replay("first");
  assert.equal(clicks.length, 1);
  assert.ok(clicks[0].at - startedAt < 250);
  const request = recorder.requestStart("ordinary-request");
  let completed = false;
  const waiting = recorder.waitForRequests().then((result) => { completed = result; });
  await delay(20);
  assert.equal(completed, false);
  recorder.requestEnd(request, { status: 200 });
  await waiting;
  assert.equal(completed, true);
});

test("explicit replay commands can request the strict parent-side wait", async (t) => {
  const { recorder, clicks, listeners, window } = createRecorder(t);
  const request = recorder.requestStart("parent-busy");
  listeners.get("message")({
    origin: window.location.origin,
    source: { postMessage() {} },
    data: {
      type: "response-mapping-user-flow-command",
      command: "toggle-replay-session",
      sessionId: "first",
      waitForNetworkIdle: true,
    },
  });
  await delay(80);
  assert.equal(clicks.length, 0);
  assert.equal(recorder.getState().isWaitingForRequests, true);
  recorder.requestEnd(request, { status: 200 });
  await delay(650);
  assert.equal(clicks.length, 1);
  recorder.stopReplay();
});

test("unrecoverable playback reports failure rather than a completed session", async (t) => {
  const { recorder } = createRecorder(t, {
    playEvent: async () => { throw new Error("Missing click target"); },
  });
  await recorder.replay("first");
  assert.equal(recorder.getState().isReplaying, false);
  assert.equal(recorder.getState().completedReplaySessionId, "");
  assert.equal(recorder.getState().failedReplaySessionId, "first");
  assert.match(recorder.getState().error, /Missing click target/);
});

test("HTTP response errors do not interrupt remaining replay actions", async (t) => {
  const played = [];
  let recorder;
  ({ recorder } = createRecorder(t, {
    events: [
      { type: "click", selector: "#first-step", at: 0, page: "/test" },
      { type: "click", selector: "#second-step", at: 1, page: "/test" },
    ],
    playEvent: async (event) => {
      played.push(event.selector);
      if (played.length === 1) {
        const request = recorder.requestStart("fetch:GET:https://example.test/api/fail");
        recorder.requestEnd(request, { status: 500, ok: false });
        assert.match(recorder.getState().responseError, /500/);
      }
    },
  }));
  await recorder.replay("first");
  assert.deepEqual(played, ["#first-step", "#second-step"]);
  assert.equal(recorder.getState().completedReplaySessionId, "first");
  assert.equal(recorder.getState().failedReplaySessionId, "");
});

test("ordinary communication timeout continues playback instead of reporting fatal failure", async (t) => {
  const { recorder, clicks } = createRecorder(t, { timeoutCap: 180 });
  recorder.requestStart("slow-parent-request");
  await recorder.replay("first");
  assert.equal(clicks.length, 1);
  assert.equal(recorder.getState().completedReplaySessionId, "first");
  assert.equal(recorder.getState().failedReplaySessionId, "");
});

test("missing recording reports a failed replay without attempting an action", async (t) => {
  const { recorder, clicks } = createRecorder(t);
  await recorder.replay("missing-session");
  assert.equal(clicks.length, 0);
  assert.equal(recorder.getState().failedReplaySessionId, "missing-session");
  assert.equal(recorder.getState().completedReplaySessionId, "");
});

test("native cloned fetch responses retain body semantics and release pending reads", async (t) => {
  const response = new Response('{"ready":true}', {
    headers: { "Content-Type": "application/json" },
  });
  const { window, recorder } = createRecorder(t, { fetch: async () => response });
  const trackedResponse = await window.fetch("/api/clone");
  assert.equal(trackedResponse, response);
  const clone = trackedResponse.clone();
  const body = clone.json();
  assert.equal(recorder.getState().pendingRequestCount, 1);
  assert.deepEqual(await body, { ready: true });
  assert.equal(recorder.getState().pendingRequestCount, 0);
  assert.equal(await trackedResponse.text(), '{"ready":true}');
  await assert.rejects(() => trackedResponse.json(), TypeError);
  assert.equal(recorder.getState().pendingRequestCount, 0);
  assert.equal(recorder.getState().responseError, "");
});
