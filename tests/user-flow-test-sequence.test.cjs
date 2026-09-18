const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../js/user-flow-popup.js"), "utf8");
const toPlain = (value) => JSON.parse(JSON.stringify(value));
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/150.0.0.0 Safari/537.36";
const MOBILE_UA = "Mozilla/5.0 (Linux; Android 13) Chrome/150.0.0.0 Mobile Safari/537.36";

function extract(firstFunction, nextFunction) {
  const start = source.indexOf(`  function ${firstFunction}(`);
  const end = source.indexOf(`  function ${nextFunction}(`, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

function createSequence({
  sendSucceeds = true,
  eventCount = 1,
  openSucceeds = true,
  autoConnect = true,
  environment,
} = {}) {
  const timers = new Map();
  const commands = [];
  const commandTargets = [];
  const windows = [];
  const openOptions = [];
  const statuses = [];
  const warnings = [];
  const commandUserAgents = [];
  let activeParent = { id: "original", closed: false, navigator: { userAgent: DESKTOP_UA } };
  let nextTimer = 0;
  const context = vm.createContext({
    console: { warn: (...args) => warnings.push(args) },
    window: {
      location: { origin: "https://example.test" },
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
      sessions: ["first", "second", "third"].map((id) => ({ id, eventCount, environment })),
    },
    userFlowTabs: { testSessionIds: ["first", "second", "third"] },
    userFlowTestReplayAdvanceTimer: 0,
    userFlowTestReplayCurrentSessionId: "",
    userFlowTestReplayCompletedSessionIds: new Set(),
    userFlowTestReplayFailedSessionIds: new Set(),
    userFlowTestReplayWindows: new Map(),
    userFlowTestReplayIndex: -1,
    userFlowTestReplayQueue: [],
    userFlowTestReplayStarted: false,
    renderedUserFlowTestSignature: "",
    replayNavigationAutoStart: false,
    replayNavigationIdleTimer: 0,
    replayNavigationTimer: 0,
    replayNavigationParentReady: false,
    replayNavigationSessionId: "",
    getActiveParentWindow: () => activeParent,
    isParentWindowOpen: (target) => Boolean(target && !target.closed),
    openParentForReplay(sessionId, options) {
      openOptions.push(options);
      if (!openSucceeds) {
        statuses.push("사이트 화면이 차단되었습니다. 이 사이트의 팝업을 허용해주세요.");
        return false;
      }
      const tab = {
        sessionId,
        navigator: { userAgent: DESKTOP_UA, userAgentData: { mobile: false } },
        closed: false,
        focusCount: 0,
        closeCount: 0,
        focus() { this.focusCount += 1; },
        close() { this.closeCount += 1; this.closed = true; },
      };
      windows.push(tab);
      activeParent = tab;
      return tab;
    },
    willReplayNavigate: () => false,
    sendUserFlowCommand(command, payload) {
      commands.push({ command, ...toPlain(payload || {}) });
      commandTargets.push(activeParent);
      commandUserAgents.push(activeParent.navigator?.userAgent);
      return sendSucceeds;
    },
    renderUserFlowState() {},
    rerenderUserFlowOrganization() {},
    showUserFlowImportStatus: (message) => statuses.push(message),
    escapeHtml: (value) => String(value).replaceAll('"', "&quot;"),
  });
  vm.runInContext(extract("isUserFlowTestReplayRunning", "handleUserFlowControl"), context);
  vm.runInContext(extract("handleUserFlowControl", "isUserFlowOrganizationBlocked"), context);
  vm.runInContext(extract("renderUserFlowTestReplayResult", "renderUserFlowTestSessions"), context);
  function ready(state = {}) {
    context.replayNavigationParentReady = true;
    context.readyState = { ...context.currentUserFlowState, ...state };
    vm.runInContext("updateReplayNavigationState(readyState)", context);
  }
  function runIdle() {
    const entry = [...timers].find(([, timer]) => timer.ms === 500);
    assert.ok(entry);
    timers.delete(entry[0]);
    entry[1].callback();
  }
  function connectIfNeeded() {
    if (autoConnect && context.replayNavigationSessionId) {
      ready();
      runIdle();
    }
  }
  function update(state) {
    context.nextState = state;
    vm.runInContext("updateUserFlowTestReplayState(currentUserFlowState, nextState)", context);
    context.currentUserFlowState = { ...context.currentUserFlowState, ...state };
  }
  return {
    context,
    commands,
    commandTargets,
    windows,
    openOptions,
    warnings,
    commandUserAgents,
    statuses,
    timers,
    ready,
    runIdle,
    getActiveParent: () => activeParent,
    clickNewWindow(id = "first", disabled = false) {
      context.controlEvent = {
        target: {
          closest: () => ({
            disabled,
            dataset: { userFlowCommand: "replay-session-new-window", sessionId: id },
          }),
        },
      };
      vm.runInContext("handleUserFlowControl(controlEvent)", context);
    },
    resultMarkup(id) {
      context.resultId = id;
      return vm.runInContext("renderUserFlowTestReplayResult(resultId)", context);
    },
    viewResult(id) {
      context.resultEvent = {
        target: { closest: () => ({ dataset: { userFlowTestResultView: id } }) },
      };
      vm.runInContext("handleUserFlowTestResultView(resultEvent)", context);
    },
    start: (id = "first") => {
      context.startId = id;
      vm.runInContext("startUserFlowTestReplay(startId)", context);
      connectIfNeeded();
    },
    update,
    runAdvance() {
      const entry = [...timers].find(([, timer]) => timer.ms === 350);
      assert.ok(entry);
      timers.delete(entry[0]);
      entry[1].callback();
      connectIfNeeded();
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
  const fixture = createSequence();
  fixture.start();
  assert.equal(fixture.resultMarkup("first"), "");
  fixture.update({ isReplaying: true, replaySessionId: "first" });
  fixture.update({ isReplaying: false, replaySessionId: "", completedReplaySessionId: "first" });
  const markup = fixture.resultMarkup("first");
  assert.match(markup, /<strong>재생 완료<\/strong>/);
  assert.match(markup, /data-user-flow-test-result-view="first"/);
  assert.match(markup, /결과 화면 보기/);
  assert.equal(fixture.resultMarkup("second"), "");
});

test("an unrecoverable replay displays failure and retains its result tab through the sequence", () => {
  const fixture = createSequence();
  fixture.start();
  fixture.update({ isReplaying: true, replaySessionId: "first" });
  fixture.update({ isReplaying: false, replaySessionId: "", error: "Missing target", completedReplaySessionId: "", failedReplaySessionId: "first" });
  assert.equal(fixture.commands.length, 1);
  assert.equal(fixture.context.userFlowTestReplayCompletedSessionIds.size, 0);
  assert.ok(fixture.context.userFlowTestReplayFailedSessionIds.has("first"));
  const markup = fixture.resultMarkup("first");
  assert.match(markup, /class="user-flow-test-replay-complete" data-result="failed"/);
  assert.match(markup, /<strong>끝까지 재생 실패<\/strong>/);
  assert.match(markup, /data-user-flow-test-result-view="first"/);
  assert.doesNotMatch(markup, /재생 완료/);
  fixture.runAdvance();
  assert.equal(fixture.commands[1].sessionId, "second");
  fixture.viewResult("first");
  assert.equal(fixture.windows[0].focusCount, 1);
  assert.equal(fixture.getActiveParent(), fixture.windows[1]);
  for (const sessionId of ["second", "third"]) {
    fixture.update({ isReplaying: true, replaySessionId: sessionId });
    fixture.update({ isReplaying: false, replaySessionId: "", completedReplaySessionId: sessionId });
    fixture.runAdvance();
  }
  assert.equal(fixture.context.userFlowTestReplayCurrentSessionId, "");
  assert.equal(fixture.resultMarkup("first"), markup);
  assert.equal(fixture.windows[0].closed, false);
});

test("a failed final list remains visible after the test queue finishes", () => {
  const fixture = createSequence();
  fixture.start("third");
  fixture.update({ isReplaying: true, replaySessionId: "third" });
  fixture.update({ isReplaying: false, replaySessionId: "", failedReplaySessionId: "third" });
  fixture.runAdvance();
  assert.equal(fixture.context.userFlowTestReplayCurrentSessionId, "");
  assert.equal(fixture.timers.size, 0);
  assert.match(fixture.resultMarkup("third"), /끝까지 재생 실패/);
  assert.match(fixture.resultMarkup("third"), /data-user-flow-test-result-view="third"/);
  assert.equal(fixture.windows[0].closed, false);
});

test("retesting clears prior failure and success replaces it with the new result tab", () => {
  const fixture = createSequence();
  fixture.start();
  fixture.update({ isReplaying: false, replaySessionId: "", failedReplaySessionId: "first" });
  assert.match(fixture.resultMarkup("first"), /끝까지 재생 실패/);
  fixture.start();
  assert.equal(fixture.context.userFlowTestReplayFailedSessionIds.size, 0);
  assert.equal(fixture.resultMarkup("first"), "");
  assert.equal(fixture.windows[0].closed, false);
  fixture.update({ isReplaying: true, replaySessionId: "first" });
  fixture.update({ isReplaying: false, replaySessionId: "", completedReplaySessionId: "first" });
  assert.match(fixture.resultMarkup("first"), /data-result="completed"/);
  assert.match(fixture.resultMarkup("first"), /재생 완료/);
  assert.doesNotMatch(fixture.resultMarkup("first"), /끝까지 재생 실패/);
  fixture.viewResult("first");
  assert.equal(fixture.windows[0].focusCount, 0);
  assert.equal(fixture.windows[1].focusCount, 1);
});

test("failure updates the rendering signature only when the result changes", () => {
  const fixture = createSequence();
  fixture.context.editingUserFlowSessionId = "";
  vm.runInContext(extract("getUserFlowSessionSignature", "updateUserFlowSessionProgress"), fixture.context);
  const before = vm.runInContext("getUserFlowSessionSignature(currentUserFlowState, [])", fixture.context);
  vm.runInContext('setUserFlowTestReplayFailed("first")', fixture.context);
  const after = vm.runInContext("getUserFlowSessionSignature(currentUserFlowState, [])", fixture.context);
  assert.notEqual(before, after);
  assert.deepEqual(JSON.parse(after).testReplayFailedSessionIds, ["first"]);
  assert.equal(vm.runInContext('setUserFlowTestReplayFailed("first")', fixture.context), false);
  assert.equal(vm.runInContext("getUserFlowSessionSignature(currentUserFlowState, [])", fixture.context), after);
});

test("response errors have no separate skip logic while ordinary replay continues", () => {
  const fixture = createSequence();
  fixture.start();
  fixture.update({ isReplaying: true, replaySessionId: "first", responseError: "HTTP 500" });
  assert.equal(fixture.commands.length, 1);
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.context.userFlowTestReplayFailedSessionIds.size, 0);
  assert.equal(fixture.resultMarkup("first"), "");
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
  assert.match(fixture.resultMarkup("first"), /끝까지 재생 실패/);
  assert.match(fixture.resultMarkup("first"), /data-user-flow-test-result-view="first"/);
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
  const fixture = createSequence({ autoConnect: false });
  fixture.start();
  const entry = [...fixture.timers].find(([, timer]) => timer.ms === 60000);
  assert.ok(entry);
  fixture.timers.delete(entry[0]);
  entry[1].callback();
  assert.deepEqual(fixture.commands, [{ command: "get-state" }]);
  assert.match(fixture.resultMarkup("first"), /끝까지 재생 실패/);
  assert.match(fixture.resultMarkup("first"), /data-user-flow-test-result-view="first"/);
  fixture.runAdvance();
  assert.equal(fixture.windows[1].sessionId, "second");
  assert.equal(fixture.commands.length, 1);
});

test("manual stop is not treated as a fatal failure and stops the sequence", () => {
  const fixture = createSequence();
  fixture.start();
  fixture.update({ isReplaying: true, replaySessionId: "first" });
  fixture.update({ isReplaying: false, replaySessionId: "", completedReplaySessionId: "", failedReplaySessionId: "" });
  assert.equal(fixture.context.userFlowTestReplayCurrentSessionId, "");
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.commands.length, 1);
  assert.equal(fixture.context.userFlowTestReplayFailedSessionIds.size, 0);
  assert.equal(fixture.resultMarkup("first"), "");
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
  assert.match(sequenceHandler, /requestUserFlowReplay\(sessionId, \{ openInNewTab: true \}\)/);
  assert.doesNotMatch(source, /setUserFlowTestReplayError|userFlowTestReplayErrors|user-flow-test-replay-error/);
  const css = fs.readFileSync(path.join(__dirname, "../css/popup.css"), "utf8");
  assert.doesNotMatch(css, /user-flow-test-replay-error/);
});

test("each test list gets a separate tab and completed tabs stay open", () => {
  const fixture = createSequence();
  fixture.start();
  const firstTab = fixture.windows[0];
  assert.equal(fixture.commandTargets[0], firstTab);
  fixture.update({ isReplaying: true, replaySessionId: "first" });
  fixture.update({ isReplaying: false, replaySessionId: "", completedReplaySessionId: "first" });
  fixture.runAdvance();
  const secondTab = fixture.windows[1];
  assert.notEqual(firstTab, secondTab);
  assert.equal(fixture.commandTargets[1], secondTab);
  fixture.update({ isReplaying: true, replaySessionId: "second" });
  fixture.update({ isReplaying: false, replaySessionId: "", completedReplaySessionId: "second" });
  fixture.runAdvance();
  fixture.update({ isReplaying: true, replaySessionId: "third" });
  fixture.update({ isReplaying: false, replaySessionId: "", completedReplaySessionId: "third" });
  fixture.runAdvance();
  assert.deepEqual(fixture.windows.map((tab) => tab.sessionId), ["first", "second", "third"]);
  assert.ok(fixture.windows.every((tab) => !tab.closed && tab.closeCount === 0));
  assert.equal(fixture.context.userFlowTestReplayWindows.get("first"), firstTab);
  assert.equal(fixture.context.userFlowTestReplayWindows.size, 3);
});

test("viewing a result focuses its tab without changing the current replay connection", () => {
  const fixture = createSequence();
  fixture.start();
  fixture.update({ isReplaying: true, replaySessionId: "first" });
  fixture.update({ isReplaying: false, replaySessionId: "", completedReplaySessionId: "first" });
  fixture.runAdvance();
  fixture.update({ isReplaying: true, replaySessionId: "second" });
  fixture.viewResult("first");
  assert.equal(fixture.windows[0].focusCount, 1);
  assert.equal(fixture.getActiveParent(), fixture.windows[1]);
  assert.equal(fixture.context.userFlowTestReplayCurrentSessionId, "second");
  assert.equal(fixture.commands.length, 2);
  fixture.windows[0].closed = true;
  fixture.viewResult("first");
  assert.equal(fixture.windows[0].focusCount, 1);
  assert.match(fixture.statuses[0], /결과 화면 탭이 닫혀/);
  assert.equal(fixture.windows.length, 2);
});

test("new test tabs wait for connection and outstanding requests before replay", () => {
  const fixture = createSequence({ autoConnect: false });
  fixture.start();
  assert.equal(fixture.windows.length, 1);
  assert.equal(fixture.commands.length, 0);
  fixture.ready({ pendingRequestCount: 1, isWaitingForRequests: true });
  assert.ok(![...fixture.timers.values()].some((timer) => timer.ms === 500));
  fixture.ready({ pendingRequestCount: 0, isWaitingForRequests: false });
  fixture.runIdle();
  assert.deepEqual(fixture.commands, [{ command: "toggle-replay-session", sessionId: "first" }]);
  assert.equal(fixture.windows.length, 1);
  fixture.update({ isReplaying: true, replaySessionId: "first" });
  fixture.update({ isReplaying: false, replaySessionId: "", completedReplaySessionId: "first" });
  fixture.runAdvance();
  fixture.ready({ pendingRequestCount: 2 });
  assert.equal(fixture.commands.length, 1);
  fixture.ready({ pendingRequestCount: 0, isWaitingForRequests: false });
  fixture.runIdle();
  assert.equal(fixture.commands[1].sessionId, "second");
  assert.equal(fixture.windows.length, 2);
});

test("a blocked tab stops the test queue and preserves earlier result tabs", () => {
  const fixture = createSequence();
  fixture.start();
  fixture.update({ isReplaying: true, replaySessionId: "first" });
  fixture.update({ isReplaying: false, replaySessionId: "", completedReplaySessionId: "first" });
  fixture.context.openParentForReplay = () => {
    fixture.statuses.push("팝업을 허용해주세요.");
    return false;
  };
  fixture.runAdvance();
  assert.equal(fixture.context.userFlowTestReplayCurrentSessionId, "");
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.commands.length, 1);
  assert.equal(fixture.windows.length, 1);
  assert.equal(fixture.windows[0].closed, false);
  assert.match(fixture.resultMarkup("first"), /재생 완료/);
  assert.match(fixture.statuses[0], /팝업.*허용/);
});

test("a blocked first tab does not run tests in the existing parent", () => {
  const fixture = createSequence({ openSucceeds: false });
  fixture.start();
  assert.equal(fixture.commands.length, 0);
  assert.equal(fixture.windows.length, 0);
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.context.userFlowTestReplayCurrentSessionId, "");
  assert.match(fixture.statuses[0], /팝업.*허용/);
  assert.match(fixture.statuses.at(-1), /로그 테스트를 중지/);
  assert.match(fixture.statuses.at(-1), /현재 팝업 주소의 사이트\(https:\/\/example\.test\)/);
});

test("ordinary log replay continues using the original tab", () => {
  const fixture = createSequence();
  const originalTab = fixture.getActiveParent();
  vm.runInContext('requestUserFlowReplay("first")', fixture.context);
  assert.deepEqual(fixture.commands, [{ command: "toggle-replay-session", sessionId: "first" }]);
  assert.equal(fixture.commandTargets[0], originalTab);
  assert.equal(fixture.windows.length, 0);
  assert.equal(fixture.context.userFlowTestReplayWindows.size, 0);
});

function createTabOpener({
  blocked = false,
  startPage = "/recorded?state=test",
  viewport,
  environment,
} = {}) {
  const originalTab = { closed: false, closeCount: 0 };
  const tab = {
    closed: false,
    focusCount: 0,
    location: { replace: (url) => { tab.url = url; } },
    focus() { this.focusCount += 1; },
    close() { this.closed = true; },
  };
  const opens = [];
  const connections = [];
  const reconnects = [];
  const statuses = [];
  const context = vm.createContext({
    URL,
    window: {
      location: { href: "https://example.test/popup.html", origin: "https://example.test" },
      open(url, target, features) {
        opens.push(features ? { url, target, features } : { url, target });
        return blocked ? null : tab;
      },
      PopupCore: { connectParent: (target) => connections.push(target) },
    },
    activeParentWindow: originalTab,
    currentUserFlowState: { sessions: [{ id: "first", eventCount: 1, startPage, viewport, environment }] },
    startParentReconnect: (target) => reconnects.push(target),
    stopParentReconnect() {},
    showUserFlowImportStatus: (message) => statuses.push(message),
  });
  vm.runInContext(extract("getUserFlowReplayWindowFeatures", "willReplayNavigate"), context);
  return {
    tab, originalTab, opens, connections, reconnects, statuses, context,
    open(options) {
      context.openerOptions = options;
      return vm.runInContext('openParentForReplay("first", openerOptions)', context);
    },
  };
}

test("the real opener returns the new tab and leaves the existing browser open", () => {
  const fixture = createTabOpener();
  assert.equal(fixture.open(), fixture.tab);
  assert.deepEqual(fixture.opens, [{ url: "about:blank", target: "_blank" }]);
  assert.equal(fixture.tab.url, "https://example.test/recorded?state=test");
  assert.equal(fixture.tab.focusCount, 1);
  assert.equal(fixture.context.activeParentWindow, fixture.tab);
  assert.deepEqual(fixture.connections, [fixture.tab]);
  assert.deepEqual(fixture.reconnects, [fixture.tab]);
  assert.equal(fixture.originalTab.closed, false);
  assert.equal(fixture.originalTab.closeCount, 0);
});

test("the real opener keeps the old connection when a new tab is blocked", () => {
  const fixture = createTabOpener({ blocked: true });
  assert.equal(fixture.open(), false);
  assert.equal(fixture.context.activeParentWindow, fixture.originalTab);
  assert.equal(fixture.connections.length, 0);
  assert.equal(fixture.reconnects.length, 0);
  assert.match(fixture.statuses[0], /팝업.*허용/);
  assert.match(fixture.statuses[0], /https:\/\/example\.test/);
});

test("the real opener retains the existing same-origin restriction", () => {
  const fixture = createTabOpener({ startPage: "https://different.test/recorded" });
  assert.equal(fixture.open(), false);
  assert.equal(fixture.opens.length, 0);
  assert.equal(fixture.context.activeParentWindow, fixture.originalTab);
  assert.match(fixture.statuses[0], /다른 사이트/);
});

test("test replay no longer requests viewport sizing for new result tabs", () => {
  const fixture = createSequence();
  fixture.start();
  fixture.update({ isReplaying: true, replaySessionId: "first" });
  fixture.update({ isReplaying: false, replaySessionId: "", completedReplaySessionId: "first" });
  fixture.runAdvance();
  assert.equal(fixture.openOptions.length, 2);
  assert.ok(fixture.openOptions.every((options) => options === undefined));
});

test("recorded mobile and desktop viewports both open ordinary new tabs", () => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 720 }]) {
    const fixture = createTabOpener({ viewport });
    assert.equal(fixture.open(), fixture.tab);
    assert.deepEqual(fixture.opens, [{
      url: "about:blank",
      target: "_blank",
    }]);
    assert.equal(fixture.tab.url, "https://example.test/recorded?state=test");
    assert.deepEqual(fixture.connections, [fixture.tab]);
    assert.deepEqual(fixture.reconnects, [fixture.tab]);
  }
});

test("missing or invalid viewport metadata retains ordinary new-tab behavior", () => {
  for (const viewport of [
    undefined, null, {}, { width: 390 }, { width: 0, height: 844 },
    { width: 390, height: -844 }, { width: "390", height: 844 },
    { width: "390,noopener=yes", height: 844 }, { width: NaN, height: 844 },
    { width: 390, height: Infinity }, { width: 16385, height: 844 },
  ]) {
    const fixture = createTabOpener({ viewport });
    assert.equal(fixture.open(), fixture.tab);
    assert.deepEqual(fixture.opens, [{ url: "about:blank", target: "_blank" }]);
  }
});

test("ordinary log replay does not force a sized popup when reopening the parent", () => {
  const fixture = createTabOpener({ viewport: { width: 390, height: 844 } });
  assert.equal(fixture.open(), fixture.tab);
  assert.deepEqual(fixture.opens, [{ url: "about:blank", target: "_blank" }]);
  const sequence = createSequence();
  sequence.context.getActiveParentWindow = () => null;
  vm.runInContext('requestUserFlowReplay("first")', sequence.context);
  assert.deepEqual(sequence.openOptions, [undefined]);
});

test("mobile logs wait for page readiness and network idle without overriding the native UA", () => {
  const fixture = createSequence({
    autoConnect: false,
    environment: { isMobile: true, userAgent: MOBILE_UA },
  });
  fixture.start();
  assert.equal(fixture.windows[0].navigator.userAgent, DESKTOP_UA);
  fixture.ready({ pendingRequestCount: 1, isWaitingForRequests: true });
  assert.equal(fixture.windows[0].navigator.userAgent, DESKTOP_UA);
  assert.equal(fixture.commands.length, 0);
  fixture.ready({ pendingRequestCount: 0, isWaitingForRequests: false });
  fixture.runIdle();
  assert.equal(fixture.windows[0].navigator.userAgent, DESKTOP_UA);
  assert.equal(fixture.commandUserAgents[0], DESKTOP_UA);
  assert.equal(fixture.windows[0].navigator.userAgentData.mobile, false);
  assert.deepEqual(toPlain(fixture.context.currentUserFlowState.sessions[0].environment), {
    isMobile: true,
    userAgent: MOBILE_UA,
  });
});

test("mobile, PC and legacy result tabs retain their native UA throughout the sequence", () => {
  const fixture = createSequence();
  fixture.context.currentUserFlowState.sessions[0].environment = { isMobile: true, userAgent: MOBILE_UA };
  fixture.context.currentUserFlowState.sessions[1].environment = { isMobile: false, userAgent: DESKTOP_UA };
  fixture.start();
  for (const sessionId of ["first", "second", "third"]) {
    fixture.update({ isReplaying: true, replaySessionId: sessionId });
    fixture.update({ isReplaying: false, replaySessionId: "", completedReplaySessionId: sessionId });
    fixture.runAdvance();
  }
  assert.deepEqual(fixture.commandUserAgents, [DESKTOP_UA, DESKTOP_UA, DESKTOP_UA]);
  fixture.viewResult("first");
  assert.equal(fixture.windows[0].navigator.userAgent, DESKTOP_UA);
  assert.equal(fixture.windows[0].closed, false);
  assert.equal(fixture.windows[0].focusCount, 1);
});

test("a replacement Navigator retains its native UA after another page readiness cycle", () => {
  const fixture = createSequence({ environment: { isMobile: true, userAgent: MOBILE_UA } });
  fixture.start();
  fixture.windows[0].navigator = { userAgent: DESKTOP_UA };
  vm.runInContext('startReplayNavigationState("first")', fixture.context);
  fixture.ready();
  fixture.runIdle();
  assert.equal(fixture.commandUserAgents.at(-1), DESKTOP_UA);
  assert.equal(fixture.windows[0].navigator.userAgent, DESKTOP_UA);
});

test("nonconfigurable native UA is left untouched during mobile log replay", () => {
  const fixture = createSequence({
    autoConnect: false,
    environment: { isMobile: true, userAgent: MOBILE_UA },
  });
  fixture.start();
  Object.defineProperty(fixture.windows[0].navigator, "userAgent", {
    configurable: false,
    value: DESKTOP_UA,
  });
  fixture.ready();
  fixture.runIdle();
  assert.equal(fixture.commandUserAgents[0], DESKTOP_UA);
  assert.equal(fixture.commands[0].sessionId, "first");
  assert.equal(fixture.warnings.length, 0);
  assert.equal(Object.getOwnPropertyDescriptor(fixture.windows[0].navigator, "userAgent").configurable, false);
  assert.equal(fixture.context.userFlowTestReplayFailedSessionIds.size, 0);
});

test("mobile flags without a usable recorded UA leave the native UA alone", () => {
  for (const environment of [null, {}, { isMobile: true }, { isMobile: true, userAgent: " " }]) {
    const fixture = createSequence({ environment });
    fixture.start();
    assert.equal(fixture.commandUserAgents[0], DESKTOP_UA);
    assert.equal(fixture.warnings.length, 0);
  }
});

test("new-window playback is rendered beside ordinary replay only in the log list", () => {
  const renderer = extract("renderUserFlowState", "isParentWindowOpen");
  assert.match(renderer, /data-user-flow-command="toggle-replay-session"[\s\S]*?data-user-flow-command="replay-session-new-window"[\s\S]*?>새창재생<\/button>/);
  assert.doesNotMatch(extract("renderUserFlowTestSessions", "renderUserFlowNotice"), /replay-session-new-window/);
  assert.match(renderer, /newWindowReplayDisabled =\s*replayDisabled \|\| flowState\.isReplaying \|\| isUserFlowTestReplayRunning\(\)/);
});

test("the new-window button opens once and waits for connection and network idle before replay", () => {
  const fixture = createSequence({ environment: { isMobile: true, userAgent: MOBILE_UA } });
  const originalTab = fixture.getActiveParent();
  fixture.clickNewWindow();
  assert.deepEqual(toPlain(fixture.openOptions), [{ openInNewWindow: true }]);
  assert.equal(fixture.windows.length, 1);
  assert.equal(originalTab.closed, false);
  assert.equal(fixture.context.replayNavigationAutoStart, true);
  assert.equal(fixture.commands.length, 0);
  assert.equal(fixture.context.userFlowTestReplayWindows.size, 0);
  assert.equal(fixture.context.userFlowTestReplayCurrentSessionId, "");

  fixture.ready({ pendingRequestCount: 2, isWaitingForRequests: true });
  assert.ok(![...fixture.timers.values()].some((timer) => timer.ms === 500));
  assert.equal(fixture.commands.length, 0);
  fixture.ready({ pendingRequestCount: 0, isWaitingForRequests: false });
  fixture.runIdle();
  assert.deepEqual(fixture.commands, [{ command: "toggle-replay-session", sessionId: "first" }]);
  assert.equal(fixture.commandTargets[0], fixture.windows[0]);
  assert.equal(fixture.commandUserAgents[0], DESKTOP_UA);
  assert.equal(fixture.context.replayNavigationSessionId, "");
  assert.equal(fixture.context.replayNavigationAutoStart, false);
  fixture.ready();
  assert.equal(fixture.commands.length, 1);
  assert.equal(fixture.windows[0].closed, false);
});

test("new-window playback is ignored while recording, replaying, navigating, or testing", () => {
  for (const state of ["recording", "replaying", "navigating", "testing", "disabled"]) {
    const fixture = createSequence();
    if (state === "recording") fixture.context.currentUserFlowState.isRecording = true;
    if (state === "replaying") fixture.context.currentUserFlowState.isReplaying = true;
    if (state === "navigating") fixture.context.replayNavigationSessionId = "second";
    if (state === "testing") fixture.context.userFlowTestReplayCurrentSessionId = "second";
    fixture.clickNewWindow("first", state === "disabled");
    assert.equal(fixture.windows.length, 0, state);
    assert.equal(fixture.commands.length, 0, state);
  }
});

test("a blocked new window never falls back to replaying in the original site", () => {
  const fixture = createSequence({ openSucceeds: false });
  const originalTab = fixture.getActiveParent();
  fixture.clickNewWindow();
  assert.equal(fixture.getActiveParent(), originalTab);
  assert.equal(fixture.commands.length, 0);
  assert.equal(fixture.windows.length, 0);
  assert.equal(fixture.context.replayNavigationSessionId, "");
  assert.equal(fixture.context.replayNavigationAutoStart, false);
});

test("a new-window connection timeout reports no replay and does not start a test queue", () => {
  const fixture = createSequence();
  fixture.clickNewWindow();
  const entry = [...fixture.timers].find(([, timer]) => timer.ms === 60000);
  assert.ok(entry);
  fixture.timers.delete(entry[0]);
  entry[1].callback();
  assert.deepEqual(fixture.commands, [{ command: "get-state" }]);
  assert.match(fixture.statuses.at(-1), /새 창.*재생을 시작하지 않았습니다/);
  assert.equal(fixture.context.replayNavigationAutoStart, false);
  assert.equal(fixture.context.userFlowTestReplayFailedSessionIds.size, 0);
  assert.equal(fixture.windows[0].closed, false);
});

test("clearing pending navigation prevents a delayed new-window replay", () => {
  const fixture = createSequence();
  fixture.clickNewWindow();
  fixture.ready();
  const callback = [...fixture.timers.values()].find((timer) => timer.ms === 500).callback;
  vm.runInContext("clearReplayNavigationState()", fixture.context);
  callback();
  assert.equal(fixture.commands.length, 0);
  assert.equal(fixture.context.replayNavigationAutoStart, false);
  assert.equal(fixture.timers.size, 0);
});

test("failed new-window replay commands report failure without advancing another list", () => {
  const fixture = createSequence({ sendSucceeds: false });
  fixture.clickNewWindow();
  fixture.ready();
  fixture.runIdle();
  assert.match(fixture.statuses.at(-1), /새 창에서 로그 재생을 시작하지 못했습니다/);
  assert.equal(fixture.commands.length, 1);
  assert.equal(fixture.context.userFlowTestReplayFailedSessionIds.size, 0);
  assert.ok(![...fixture.timers.values()].some((timer) => timer.ms === 350));
});

test("mobile and desktop new-window playback requests the recorded content dimensions", () => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 720 }]) {
    const fixture = createTabOpener({ viewport });
    assert.equal(fixture.open({ openInNewWindow: true }), fixture.tab);
    assert.deepEqual(fixture.opens, [{
      url: "about:blank", target: "_blank",
      features: `popup=yes,width=${viewport.width},height=${viewport.height}`,
    }]);
    assert.equal(fixture.tab.url, "https://example.test/recorded?state=test");
    assert.equal(fixture.originalTab.closed, false);
  }
});

test("new-window viewport dimensions are rounded and invalid metadata cannot inject features", () => {
  const rounded = createTabOpener({ viewport: { width: 390.4, height: 844.6 } });
  rounded.open({ openInNewWindow: true });
  assert.equal(rounded.opens[0].features, "popup=yes,width=390,height=845");
  for (const viewport of [
    undefined, null, {}, { width: 390 }, { width: 0, height: 844 },
    { width: 390, height: -844 }, { width: "390", height: 844 },
    { width: "390,noopener=yes", height: 844 }, { width: NaN, height: 844 },
    { width: 390, height: Infinity }, { width: 16385, height: 844 },
  ]) {
    const fixture = createTabOpener({ viewport });
    assert.equal(fixture.open({ openInNewWindow: true }), fixture.tab);
    assert.equal(fixture.opens[0].features, "popup=yes");
  }
});

test("blocked new windows retain the original connection and identify new-window blocking", () => {
  const fixture = createTabOpener({ blocked: true, viewport: { width: 390, height: 844 } });
  assert.equal(fixture.open({ openInNewWindow: true }), false);
  assert.equal(fixture.context.activeParentWindow, fixture.originalTab);
  assert.equal(fixture.connections.length, 0);
  assert.equal(fixture.reconnects.length, 0);
  assert.match(fixture.statuses[0], /새 창이 차단되었습니다/);
});

test("new-window replay retains the same-origin restriction", () => {
  const fixture = createTabOpener({ startPage: "https://different.test/recorded" });
  assert.equal(fixture.open({ openInNewWindow: true }), false);
  assert.equal(fixture.opens.length, 0);
  assert.equal(fixture.context.activeParentWindow, fixture.originalTab);
});

test("closing the new window in the idle gap cannot replay in another connected site", () => {
  const fixture = createSequence();
  const originalTab = fixture.getActiveParent();
  fixture.clickNewWindow();
  fixture.ready();
  fixture.windows[0].closed = true;
  fixture.context.getActiveParentWindow = () => originalTab;
  fixture.runIdle();
  assert.equal(fixture.commands.length, 0);
  assert.equal(fixture.context.replayNavigationAutoStart, false);
  assert.match(fixture.statuses.at(-1), /새 창이 닫혔거나 연결이 변경되어/);
});

test("ordinary log navigation still requires explicit replay after page readiness", () => {
  const fixture = createSequence();
  fixture.context.willReplayNavigate = () => true;
  vm.runInContext('requestUserFlowReplay("first")', fixture.context);
  assert.equal(fixture.context.replayNavigationAutoStart, false);
  assert.equal(fixture.commands.length, 1);
  fixture.ready();
  fixture.runIdle();
  assert.equal(fixture.commands.length, 1);
  assert.equal(fixture.windows.length, 0);
});
