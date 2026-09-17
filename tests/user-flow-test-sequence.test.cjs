const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../js/user-flow-popup.js"), "utf8");
const toPlain = (value) => JSON.parse(JSON.stringify(value));

function extract(firstFunction, nextFunction) {
  const start = source.indexOf(`  function ${firstFunction}(`);
  const end = source.indexOf(`  function ${nextFunction}(`, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

function createSequence({ sendSucceeds = true, eventCount = 1 } = {}) {
  const timers = new Map();
  const commands = [];
  let nextTimer = 0;
  const context = vm.createContext({
    window: {
      setTimeout(callback, ms) {
        timers.set(++nextTimer, { callback, ms });
        return nextTimer;
      },
      clearTimeout: (id) => timers.delete(id),
    },
    USER_FLOW_TEST_REPLAY_ADVANCE_MS: 350,
    REPLAY_NAVIGATION_TIMEOUT_MS: 60000,
    REPLAY_NAVIGATION_IDLE_MS: 500,
    currentUserFlowState: {
      isReplaying: false,
      sessions: ["first", "second", "third"].map((id) => ({ id, eventCount })),
    },
    userFlowTabs: { testSessionIds: ["first", "second", "third"] },
    userFlowTestReplayAdvanceTimer: 0,
    userFlowTestReplayCurrentSessionId: "",
    userFlowTestReplayCompletedSessionIds: new Set(),
    userFlowTestReplayIndex: -1,
    userFlowTestReplayQueue: [],
    userFlowTestReplayStarted: false,
    renderedUserFlowTestSignature: "",
    replayNavigationIdleTimer: 0,
    replayNavigationTimer: 0,
    replayNavigationParentReady: false,
    replayNavigationSessionId: "",
    getActiveParentWindow: () => ({}),
    openParentForReplay: () => false,
    willReplayNavigate: () => false,
    sendUserFlowCommand(command, payload) {
      commands.push({ command, ...toPlain(payload || {}) });
      return sendSucceeds;
    },
    renderUserFlowState() {},
    rerenderUserFlowOrganization() {},
    showUserFlowImportStatus() {},
  });
  vm.runInContext(extract("isUserFlowTestReplayRunning", "handleUserFlowControl"), context);
  function update(state) {
    context.nextState = state;
    vm.runInContext("updateUserFlowTestReplayState(currentUserFlowState, nextState)", context);
    context.currentUserFlowState = { ...context.currentUserFlowState, ...state };
  }
  return {
    context,
    commands,
    timers,
    start: (id = "first") => {
      context.startId = id;
      vm.runInContext("startUserFlowTestReplay(startId)", context);
    },
    update,
    runAdvance() {
      const entry = [...timers].find(([, timer]) => timer.ms === 350);
      assert.ok(entry);
      timers.delete(entry[0]);
      entry[1].callback();
    },
  };
}

test("completed sessions advance through the test list in order", () => {
  const fixture = createSequence();
  fixture.start("second");
  assert.deepEqual(fixture.commands, [
    { command: "toggle-replay-session", sessionId: "second" },
  ]);
  fixture.update({ isReplaying: true, replaySessionId: "second" });
  fixture.update({ isReplaying: false, replaySessionId: "", completedReplaySessionId: "second" });
  assert.ok(fixture.context.userFlowTestReplayCompletedSessionIds.has("second"));
  fixture.runAdvance();
  assert.equal(fixture.commands[1].sessionId, "third");
  fixture.update({ isReplaying: true, replaySessionId: "third" });
  fixture.update({ isReplaying: false, replaySessionId: "", completedReplaySessionId: "third" });
  fixture.runAdvance();
  assert.equal(fixture.context.userFlowTestReplayCurrentSessionId, "");
  assert.equal(fixture.commands.length, 2);
  assert.deepEqual([...fixture.context.userFlowTestReplayCompletedSessionIds], ["second", "third"]);
});

test("test playback follows the saved reordered list", () => {
  const fixture = createSequence();
  fixture.context.userFlowTabs.testSessionIds = ["third", "first", "second"];
  fixture.start("third");
  for (const sessionId of ["third", "first", "second"]) {
    assert.equal(fixture.commands.at(-1).sessionId, sessionId);
    fixture.update({ isReplaying: true, replaySessionId: sessionId });
    fixture.update({ isReplaying: false, replaySessionId: "", completedReplaySessionId: sessionId });
    fixture.runAdvance();
  }
  assert.deepEqual(fixture.commands.map((command) => command.sessionId), ["third", "first", "second"]);
  assert.equal(fixture.context.userFlowTestReplayCurrentSessionId, "");
});

test("completed test sessions display the replay complete label", () => {
  assert.match(source, /isTestReplayCompleted\s*\?\s*'<p class="user-flow-test-replay-complete"[^>]*><strong>재생 완료<\/strong><\/p>'\s*:\s*""/);
});

test("an unrecoverable replay advances to the next list without marking success", () => {
  const fixture = createSequence();
  fixture.start();
  fixture.update({ isReplaying: true, replaySessionId: "first" });
  fixture.update({ isReplaying: false, replaySessionId: "", error: "Missing target", completedReplaySessionId: "", failedReplaySessionId: "first" });
  assert.equal(fixture.commands.length, 1);
  assert.equal(fixture.context.userFlowTestReplayCompletedSessionIds.size, 0);
  fixture.runAdvance();
  assert.equal(fixture.commands[1].sessionId, "second");
});

test("response errors have no separate skip logic while ordinary replay continues", () => {
  const fixture = createSequence();
  fixture.start();
  fixture.update({ isReplaying: true, replaySessionId: "first", responseError: "HTTP 500" });
  assert.equal(fixture.commands.length, 1);
  assert.equal(fixture.timers.size, 0);
  fixture.update({ isReplaying: false, replaySessionId: "", completedReplaySessionId: "first" });
  fixture.runAdvance();
  assert.equal(fixture.commands[1].sessionId, "second");
});

test("top status ignores response errors and retains replay, waiting, and fatal error messages", () => {
  const renderStart = source.indexOf("  function renderUserFlowState(");
  const statusStart = source.indexOf("    const hasUserFlowTabs =", renderStart);
  const statusEnd = source.indexOf("    const canContinueRecording =", statusStart);
  assert.ok(renderStart >= 0 && statusStart > renderStart && statusEnd > statusStart);
  assert.doesNotMatch(source, /flowState\.responseError/);

  const cases = [
    [{ isReplaying: true }, "", "저장된 로그를 재생하고 있습니다", "replaying"],
    [{ isReplaying: true, isWaitingForRequests: true }, "", "통신이 완료될 때까지 재생을 기다리고 있습니다", "replaying"],
    [{ pendingRequestCount: 1 }, "first", "통신 중입니다", "communicating"],
    [{}, "first", "로그 시작 페이지로 이동 중입니다", "navigating"],
    [{ isRecording: true }, "", "로그를 저장하고 있습니다", "recording"],
    [{ canReplay: true }, "", "로그 재생을 준비했습니다", "ready"],
    [{ error: "재생 대상을 찾지 못했습니다." }, "", "재생 대상을 찾지 못했습니다.", "error"],
  ];

  for (const [flowState, navigationSessionId, expectedText, expectedState] of cases) {
    let displayedStatus;
    const context = vm.createContext({
      flowState: { ...flowState, responseError: "응답 오류: 404 · GET /background" },
      userFlowTabs: { tabs: [{ id: "default" }] },
      replayNavigationSessionId: navigationSessionId,
      USER_FLOW_ANIMATED_STATUS_STATES: new Set(["communicating", "navigating", "recording", "replaying"]),
      status: {},
      setUserFlowStatus(_element, text, state) {
        displayedStatus = { text, state };
      },
    });
    vm.runInContext(source.slice(statusStart, statusEnd), context);
    assert.deepEqual(displayedStatus, { text: expectedText, state: expectedState });
  }
});

test("failed replay commands move to the next list", () => {
  const fixture = createSequence({ sendSucceeds: false });
  fixture.start();
  assert.equal(fixture.commands.length, 1);
  fixture.runAdvance();
  assert.equal(fixture.commands[1].sessionId, "second");
});

test("empty test sessions are skipped and the sequence finishes at the end", () => {
  const fixture = createSequence({ eventCount: 0 });
  fixture.start();
  assert.equal(fixture.commands.length, 0);
  fixture.runAdvance();
  assert.equal(fixture.context.userFlowTestReplayCurrentSessionId, "second");
  fixture.runAdvance();
  assert.equal(fixture.context.userFlowTestReplayCurrentSessionId, "third");
  fixture.runAdvance();
  assert.equal(fixture.context.userFlowTestReplayCurrentSessionId, "");
  assert.equal(fixture.timers.size, 0);
});

test("manual cancellation prevents a scheduled next replay", () => {
  const fixture = createSequence();
  fixture.start();
  fixture.update({ isReplaying: true, replaySessionId: "first" });
  fixture.update({ isReplaying: false, replaySessionId: "", completedReplaySessionId: "first" });
  vm.runInContext("cancelUserFlowTestReplay()", fixture.context);
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.commands.length, 1);
});

test("page connection timeout advances to the next test session", () => {
  const fixture = createSequence();
  fixture.context.willReplayNavigate = () => true;
  fixture.start();
  const entry = [...fixture.timers].find(([, timer]) => timer.ms === 60000);
  assert.ok(entry);
  fixture.timers.delete(entry[0]);
  entry[1].callback();
  assert.equal(fixture.commands.length, 2);
  assert.deepEqual(fixture.commands[1], { command: "get-state" });
  fixture.runAdvance();
  assert.equal(fixture.commands[2].sessionId, "second");
});

test("manual stop is not treated as a fatal failure and stops the sequence", () => {
  const fixture = createSequence();
  fixture.start();
  fixture.update({ isReplaying: true, replaySessionId: "first" });
  fixture.update({ isReplaying: false, replaySessionId: "", completedReplaySessionId: "", failedReplaySessionId: "" });
  assert.equal(fixture.context.userFlowTestReplayCurrentSessionId, "");
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.commands.length, 1);
});

test("a fatal failure before playback starts advances exactly once", () => {
  const fixture = createSequence();
  fixture.start();
  fixture.update({ isReplaying: false, replaySessionId: "", failedReplaySessionId: "first" });
  fixture.update({ isReplaying: false, replaySessionId: "", failedReplaySessionId: "first" });
  assert.equal(fixture.timers.size, 1);
  fixture.runAdvance();
  assert.equal(fixture.commands.length, 2);
  assert.equal(fixture.commands[1].sessionId, "second");
});

test("list and test replay buttons both use the same replay function", () => {
  const normalHandler = extract("handleUserFlowControl", "isUserFlowOrganizationBlocked");
  const sequenceHandler = extract("playCurrentUserFlowTestReplay", "scheduleNextUserFlowTestReplay");
  assert.match(normalHandler, /requestUserFlowReplay\(payload.sessionId\)/);
  assert.match(sequenceHandler, /requestUserFlowReplay\(sessionId\)/);
  assert.doesNotMatch(source, /setUserFlowTestReplayError|userFlowTestReplayErrors|user-flow-test-replay-error/);
  const css = fs.readFileSync(path.join(__dirname, "../css/popup.css"), "utf8");
  assert.doesNotMatch(css, /user-flow-test-replay-error/);
});
