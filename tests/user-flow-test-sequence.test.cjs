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
  beforeReplayConfig = { url: "" },
  sendSucceeds = true,
  eventCount = 1,
  openSucceeds = true,
  autoConnect = true,
  environment,
} = {}) {
  const timers = new Map();
  const commands = [];
  const commandTargets = [];
  const connections = [];
  const windows = [];
  const openOptions = [];
  const statuses = [];
  const toasts = [];
  const warnings = [];
  const commandUserAgents = [];
  const beforeReplayRuns = [];
  let organizationResetCount = 0;
  let activeParent = {
    id: "original",
    closed: false,
    focusCount: 0,
    navigator: { userAgent: DESKTOP_UA },
    location: {
      href: "https://example.test/current",
      replace(href) { this.href = href; },
    },
    focus() { this.focusCount += 1; },
  };
  let nextTimer = 0;
  const context = vm.createContext({
    console: { warn: (...args) => warnings.push(args) },
    URL,
    window: {
      location: {
        href: "https://example.test/popup.html",
        origin: "https://example.test",
      },
      confirm: () => true,
      PopupCore: {
        connectParent(target) {
          connections.push(target);
          activeParent = target;
        },
      },
      UserFlowBeforeReplay: {
        extractValue(title) {
          return String(title || "").match(/\(([A-Z][^()]*)\)/)?.[1] || "";
        },
        isConfigured: (config) => Boolean(config?.url),
        resolvePreparationUrl: (config, baseUrl) => new URL(config.url, baseUrl),
        run(options) {
          beforeReplayRuns.push(options);
          return Promise.resolve();
        },
      },
      setTimeout(callback, ms) {
        timers.set(++nextTimer, { callback, ms });
        return nextTimer;
      },
      clearTimeout: (id) => timers.delete(id),
    },
    USER_FLOW_TEST_REPLAY_ADVANCE_MS: 350,
    USER_FLOW_MOVE_TOAST_CLEAR_MS: 160,
    USER_FLOW_MOVE_TOAST_VISIBLE_MS: 1200,
    MAX_USER_FLOW_SESSIONS: 20,
    REPLAY_NAVIGATION_TIMEOUT_MS: 60000,
    REPLAY_NAVIGATION_IDLE_MS: 500,
    currentUserFlowState: {
      isReplaying: false,
      sessions: ["first", "second", "third"].map((id) => ({
        id,
        eventCount,
        environment,
        name: `${id} (VALUE)`,
        startPage: `/${id}`,
      })),
    },
    userFlowTabs: {
      tabs: [{ id: "default", name: "Tab 01" }],
      testEntryIds: ["first", "second", "third"],
      testSessionIds: ["first", "second", "third"],
    },
    userFlowTestReplayAdvanceTimer: 0,
    userFlowTestReplayCurrentSessionId: "",
    userFlowTestReplayCurrentEntryId: "",
    userFlowTestReplayCompletedSessionIds: new Set(),
    userFlowTestReplayFailedSessionIds: new Set(),
    userFlowTestReplayStartedSessionIds: new Set(),
    userFlowTestReplayWindows: new Map(),
    userFlowOpenedWindows: new Set(),
    userFlowSessionWindows: new Map(),
    userFlowTestReplayIndex: -1,
    userFlowTestReplayQueue: [],
    userFlowTestReplayStarted: false,
    userFlowTestReplayOpenedWindowCount: 0,
    userFlowTestAddToastCount: 0,
    userFlowTestAddToastResetTimer: 0,
    beforeReplayRunId: 0,
    beforeReplaySessionId: "",
    renderedUserFlowSessionSignature: "",
    renderedUserFlowTestSignature: "",
    replayNavigationRequestedReplay: false,
    replayNavigationIdleTimer: 0,
    replayNavigationTimer: 0,
    replayNavigationParentReady: false,
    replayNavigationSessionId: "",
    userFlowReplayWindow: null,
    activeParentWindow: activeParent,
    userFlowImportController: {
      getPathConfig: () => ({ beforeReplay: beforeReplayConfig }),
    },
    startParentReconnect() {},
    stopParentReconnect() {},
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
        location: {
          href: options?.targetPage || `https://example.test/${sessionId}`,
          replace(href) { this.href = href; },
        },
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
    resetUserFlowOrganization() {
      organizationResetCount += 1;
    },
    persistUserFlowTabs: () => true,
    showUserFlowMoveToast: (message) => toasts.push(message),
    showUserFlowImportStatus: (message) => statuses.push(message),
    escapeHtml: (value) => String(value).replaceAll('"', "&quot;"),
  });
  vm.runInContext(extract("normalizeUserFlowTestEntryIds", "normalizeUserFlowNotice"), context);
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
    connections,
    windows,
    openOptions,
    warnings,
    commandUserAgents,
    beforeReplayRuns,
    statuses,
    toasts,
    timers,
    ready,
    runIdle,
    getActiveParent: () => activeParent,
    getOrganizationResetCount: () => organizationResetCount,
    clickNewWindow(id = "first", disabled = false) {
      context.controlEvent = {
        target: {
          closest: () => ({
            disabled,
            dataset: { userFlowCommand: "open-session-window", sessionId: id },
          }),
        },
      };
      vm.runInContext("handleUserFlowControl(controlEvent)", context);
    },
    clickReplay(id = "first") {
      context.controlEvent = {
        target: {
          closest: () => ({
            disabled: false,
            dataset: { userFlowCommand: "toggle-replay-session", sessionId: id },
            closest: () => null,
          }),
        },
      };
      vm.runInContext("handleUserFlowControl(controlEvent)", context);
    },
    clickSessionView(id = "first") {
      context.controlEvent = {
        target: {
          closest: () => ({
            disabled: false,
            dataset: { userFlowCommand: "view-session-window", sessionId: id },
          }),
        },
      };
      vm.runInContext("handleUserFlowControl(controlEvent)", context);
    },
    clickCloseWindows() {
      context.controlEvent = {
        target: {
          closest: () => ({
            disabled: false,
            dataset: { userFlowCommand: "close-opened-windows" },
          }),
        },
      };
      vm.runInContext("handleUserFlowControl(controlEvent)", context);
    },
    clickClear() {
      context.controlEvent = {
        target: {
          closest: () => ({
            disabled: false,
            dataset: { userFlowCommand: "clear" },
            closest: () => null,
          }),
        },
      };
      vm.runInContext("handleUserFlowControl(controlEvent)", context);
    },
    clickAddTest(id = "first", disabled = false) {
      context.controlEvent = {
        target: {
          closest: () => ({
            disabled,
            dataset: { userFlowCommand: "add-test-session", sessionId: id },
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
    {
      command: "toggle-replay-session",
      sessionId: "second",
      waitForNetworkIdle: true,
    },
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

test("duplicate entries of one log replay and retain results independently", () => {
  const fixture = createSequence();
  const entryIds = ["first", "first::2", "first::3"];
  fixture.context.userFlowTabs.testSessionIds = ["first", "first", "first"];
  fixture.context.userFlowTabs.testEntryIds = entryIds;
  fixture.start(entryIds[0]);

  entryIds.forEach((entryId, index) => {
    assert.equal(fixture.context.userFlowTestReplayCurrentEntryId, entryId);
    assert.equal(fixture.commands.at(-1).sessionId, "first");
    fixture.update({ isReplaying: true, replaySessionId: "first" });
    fixture.update({
      isReplaying: false,
      replaySessionId: "",
      completedReplaySessionId: "first",
    });
    assert.ok(fixture.context.userFlowTestReplayCompletedSessionIds.has(entryId));
    fixture.runAdvance();
    assert.equal(fixture.windows[index].closed, false);
  });

  assert.equal(fixture.commands.length, 3);
  assert.equal(fixture.context.userFlowTestReplayCurrentEntryId, "");
  assert.deepEqual(
    [...fixture.context.userFlowTestReplayWindows.keys()],
    entryIds,
  );
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
  assert.equal(fixture.resultMarkup("first"), "");
  fixture.update({ isReplaying: false, replaySessionId: "", completedReplaySessionId: "first" });
  const markup = fixture.resultMarkup("first");
  assert.match(markup, /<strong>재생 완료<\/strong>/);
  assert.doesNotMatch(markup, /data-user-flow-test-result-view|결과 화면 보기|>보기<\/button>/);
  assert.equal(fixture.resultMarkup("second"), "");
});

test("an unrecoverable replay displays failure and retains its result window through the sequence", () => {
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
  assert.doesNotMatch(markup, /data-user-flow-test-result-view|>보기<\/button>/);
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
  assert.doesNotMatch(fixture.resultMarkup("third"), /data-user-flow-test-result-view/);
  assert.equal(fixture.windows[0].closed, false);
});

test("retesting clears prior failure and success replaces it with the new result window", () => {
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
      beforeReplaySessionId: "",
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

test("the replay progress bar disables interpolation while communication is waiting", () => {
  const progressRenderer = extract(
    "getUserFlowSessionReplayProgress",
    "getUserFlowSessionSignature",
  );
  assert.match(progressRenderer, /isWaiting = Boolean\(isActive && flowState\.isWaitingForRequests\)/);
  assert.match(progressRenderer, /data-waiting="\$\{String\(progress\.isWaiting\)\}"/);
  const css = fs.readFileSync(path.join(__dirname, "../css/popup.css"), "utf8");
  assert.match(
    css,
    /\.user-flow-session-replay-progress\[data-waiting="true"\][\s\S]*?\.user-flow-session-replay-progress-fill\s*\{\s*transition: none;/,
  );
});

test("failed replay commands move to the next list", () => {
  const fixture = createSequence({ sendSucceeds: false });
  fixture.start();
  assert.equal(fixture.commands.length, 1);
  assert.match(fixture.resultMarkup("first"), /끝까지 재생 실패/);
  assert.doesNotMatch(fixture.resultMarkup("first"), /data-user-flow-test-result-view/);
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
  assert.doesNotMatch(fixture.resultMarkup("first"), /data-user-flow-test-result-view/);
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

test("normal and test replay buttons use the same replay function with different window behavior", () => {
  const normalHandler = extract("handleUserFlowControl", "isUserFlowOrganizationBlocked");
  const sequenceHandler = extract("playCurrentUserFlowTestReplay", "scheduleNextUserFlowTestReplay");
  assert.match(normalHandler, /requestPreparedUserFlowReplay\(payload.sessionId, \{[\s\S]*?resumeAfterNavigation: true,[\s\S]*?waitForNetworkIdle: true/);
  assert.match(sequenceHandler, /requestPreparedUserFlowReplay\(sessionId, \{[\s\S]*?openInNewWindow: true,[\s\S]*?positionOffset: userFlowTestReplayOpenedWindowCount \* 20/);
  assert.doesNotMatch(sequenceHandler, /openInNewTab/);
  assert.doesNotMatch(source, /setUserFlowTestReplayError|userFlowTestReplayErrors|user-flow-test-replay-error/);
  const css = fs.readFileSync(path.join(__dirname, "../css/popup.css"), "utf8");
  assert.doesNotMatch(css, /user-flow-test-replay-error/);
});

test("test rows render only one replay button and no separate new-window control", () => {
  const renderer = extract("renderUserFlowTestSessions", "renderUserFlowNotice");
  assert.match(renderer, /data-user-flow-command="toggle-replay-session"/);
  assert.doesNotMatch(renderer, /start-test-session-window|새창 재생|user-flow-new-window/);
});

test("test replay always opens sequential result windows with 20px diagonal offsets", () => {
  const fixture = createSequence();
  fixture.start("second");
  assert.deepEqual(toPlain(fixture.openOptions), [
    { openInNewWindow: true, positionOffset: 0 },
  ]);
  assert.deepEqual(fixture.commands, [{
    command: "toggle-replay-session",
    sessionId: "second",
    waitForNetworkIdle: true,
  }]);
  fixture.update({ isReplaying: true, replaySessionId: "second" });
  fixture.update({ isReplaying: false, replaySessionId: "", completedReplaySessionId: "second" });
  fixture.runAdvance();
  assert.deepEqual(toPlain(fixture.openOptions), [
    { openInNewWindow: true, positionOffset: 0 },
    { openInNewWindow: true, positionOffset: 20 },
  ]);
  assert.equal(fixture.commands[1].sessionId, "third");
  fixture.update({ isReplaying: true, replaySessionId: "third" });
  fixture.update({ isReplaying: false, replaySessionId: "", completedReplaySessionId: "third" });
  fixture.runAdvance();
  assert.equal(fixture.context.userFlowTestReplayOpenedWindowCount, 0);
  assert.deepEqual([...fixture.context.userFlowTestReplayWindows.keys()], ["second", "third"]);
  assert.ok(fixture.windows.every((window) => !window.closed));
});

test("canceling and restarting a test resets its window offset", () => {
  const fixture = createSequence();
  fixture.start("first");
  assert.deepEqual(toPlain(fixture.openOptions), [
    { openInNewWindow: true, positionOffset: 0 },
  ]);
  vm.runInContext("cancelUserFlowTestReplay()", fixture.context);
  fixture.start("second");
  assert.deepEqual(toPlain(fixture.openOptions), [
    { openInNewWindow: true, positionOffset: 0 },
    { openInNewWindow: true, positionOffset: 0 },
  ]);
});

test("a blocked test window stops the queue with a new-window message", () => {
  const fixture = createSequence({ openSucceeds: false });
  fixture.start();
  assert.equal(fixture.context.userFlowTestReplayCurrentSessionId, "");
  assert.equal(fixture.context.userFlowTestReplayOpenedWindowCount, 0);
  assert.equal(fixture.commands.length, 0);
  assert.match(fixture.statuses.at(-1), /새 창을 열지 못해 로그 테스트를 중지/);
});

test("each test list gets a separate window and completed windows stay open", () => {
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

test("viewing a result focuses its window without changing the current replay connection", () => {
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
  assert.match(fixture.statuses[0], /결과 화면 창이 닫혀/);
  assert.equal(fixture.windows.length, 2);
});

test("new test windows wait for connection and outstanding requests before replay", () => {
  const fixture = createSequence({ autoConnect: false });
  fixture.start();
  assert.equal(fixture.windows.length, 1);
  assert.equal(fixture.commands.length, 0);
  fixture.ready({ pendingRequestCount: 1, isWaitingForRequests: true });
  assert.ok(![...fixture.timers.values()].some((timer) => timer.ms === 500));
  fixture.ready({ pendingRequestCount: 0, isWaitingForRequests: false });
  fixture.runIdle();
  assert.deepEqual(fixture.commands, [{
    command: "toggle-replay-session",
    sessionId: "first",
    waitForNetworkIdle: true,
  }]);
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

test("a blocked window stops the test queue and preserves earlier result windows", () => {
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

test("a blocked first window does not run tests in the existing parent", () => {
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
  fixture.clickReplay("first");
  assert.deepEqual(fixture.commands, [{
    command: "toggle-replay-session",
    sessionId: "first",
    waitForNetworkIdle: true,
  }]);
  assert.equal(fixture.commandTargets[0], originalTab);
  assert.equal(fixture.context.userFlowSessionWindows.get("first"), originalTab);
  fixture.clickSessionView("first");
  assert.equal(originalTab.focusCount, 1);
  assert.equal(fixture.windows.length, 0);
  assert.equal(fixture.context.userFlowTestReplayWindows.size, 0);
});

test("configured preparation uses the uppercase parenthesized title value before replay", async () => {
  const fixture = createSequence({
    beforeReplayConfig: {
      url: "/prepare",
      selectors: {
        firstButton: "#first",
        input: "#input",
        select: "#select",
        submitButton: "#submit",
      },
    },
  });
  fixture.clickReplay("first");
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(fixture.beforeReplayRuns.length, 1);
  assert.equal(fixture.beforeReplayRuns[0].value, "VALUE");
  assert.equal(fixture.commands.length, 0);
  assert.equal(fixture.getActiveParent().location.href, "https://example.test/first");
  assert.equal(fixture.context.replayNavigationSessionId, "first");

  fixture.ready();
  fixture.runIdle();
  assert.equal(fixture.commands.length, 1);
  assert.equal(fixture.commands[0].sessionId, "first");
  assert.equal(fixture.commands[0].waitForNetworkIdle, true);
});

test("configured preparation keeps log-test playback in its newly opened result window", async () => {
  const fixture = createSequence({
    beforeReplayConfig: {
      url: "/prepare",
      selectors: {
        firstButton: "#first",
        input: "#input",
        select: "#select",
        submitButton: "#submit",
      },
    },
  });
  fixture.start("first");
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(fixture.windows.length, 1);
  assert.equal(fixture.beforeReplayRuns[0].targetWindow, fixture.windows[0]);
  assert.equal(
    fixture.openOptions[0].targetPage,
    "https://example.test/prepare",
  );
  assert.equal(fixture.windows[0].location.href, "https://example.test/first");
  assert.equal(fixture.commands.length, 0);

  fixture.ready();
  fixture.runIdle();
  assert.equal(fixture.commands.length, 1);
  assert.equal(fixture.commandTargets[0], fixture.windows[0]);
});

function createTabOpener({
  blocked = false,
  startPage = "/recorded?state=test",
  viewport,
  environment,
  popupGeometry = {},
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
  const connectionOptions = [];
  const reconnects = [];
  const statuses = [];
  const context = vm.createContext({
    URL,
    window: {
      ...popupGeometry,
      location: { href: "https://example.test/popup.html", origin: "https://example.test" },
      open(url, target, features) {
        opens.push(features ? { url, target, features } : { url, target });
        return blocked ? null : tab;
      },
      PopupCore: {
        connectParent(target, options) {
          connections.push(target);
          connectionOptions.push(toPlain(options));
        },
      },
    },
    activeParentWindow: originalTab,
    currentUserFlowState: { sessions: [{ id: "first", eventCount: 1, startPage, viewport, environment }] },
    startParentReconnect: (target) => reconnects.push(target),
    stopParentReconnect() {},
    showUserFlowImportStatus: (message) => statuses.push(message),
  });
  vm.runInContext(extract("getUserFlowReplayWindowFeatures", "willReplayNavigate"), context);
  return {
    tab, originalTab, opens, connections, connectionOptions, reconnects, statuses, context,
    open(options) {
      context.openerOptions = options;
      return vm.runInContext('openParentForReplay("first", openerOptions)', context);
    },
  };
}

function createStandaloneSampleImporter({ blocked = false } = {}) {
  const timers = new Map();
  const connections = [];
  const reconnects = [];
  const statuses = [];
  const opens = [];
  let popupFocusCount = 0;
  let nextTimerId = 0;
  const siteWindow = {
    closed: false,
    closeCount: 0,
    blurCount: 0,
    focusCount: 0,
    location: {
      href: "about:blank",
      replace(url) {
        this.href = url;
      },
    },
    close() {
      this.closeCount += 1;
      this.closed = true;
    },
    blur() {
      this.blurCount += 1;
    },
    focus() {
      this.focusCount += 1;
    },
  };
  const context = vm.createContext({
    URL,
    USER_FLOW_IMPORT_CONNECTION_TIMEOUT_MS: 60000,
    activeParentWindow: null,
    reservedUserFlowImportWindow: null,
    userFlowImportConnectionResolve: null,
    userFlowImportConnectionTimer: 0,
    userFlowOpenedWindows: new Set(),
    getActiveParentWindow() {
      return context.activeParentWindow && !context.activeParentWindow.closed
        ? context.activeParentWindow
        : null;
    },
    isParentWindowOpen: (target) => Boolean(target && !target.closed),
    showUserFlowImportStatus: (message) => statuses.push(message),
    startParentReconnect: (target) => reconnects.push(target),
    stopParentReconnect() {},
    window: {
      location: {
        href: "https://example.test/popup.html",
        origin: "https://example.test",
      },
      open(url, target, features) {
        opens.push({ features, target, url });
        return blocked ? null : siteWindow;
      },
      focus() {
        popupFocusCount += 1;
      },
      PopupCore: {
        connectParent(target) {
          connections.push(target);
          return true;
        },
      },
      setTimeout(callback, ms) {
        timers.set(++nextTimerId, { callback, ms });
        return nextTimerId;
      },
      clearTimeout(timerId) {
        timers.delete(timerId);
      },
    },
  });
  vm.runInContext(
    extract("settleUserFlowImportConnection", "getUserFlowReplayWindowFeatures"),
    context,
  );
  return {
    connections,
    context,
    getPopupFocusCount: () => popupFocusCount,
    opens,
    reconnects,
    siteWindow,
    statuses,
    timers,
  };
}

test("a directly opened popup reserves and connects the sample's same-origin site before import", async () => {
  const fixture = createStandaloneSampleImporter();

  assert.equal(vm.runInContext("reserveUserFlowImportTarget()", fixture.context), true);
  assert.deepEqual(fixture.opens, [
    { features: undefined, target: "_blank", url: "about:blank" },
  ]);
  assert.equal(fixture.context.activeParentWindow, null);
  const ready = vm.runInContext(
    'prepareUserFlowImportTarget("/sample/start?mode=test")',
    fixture.context,
  );

  assert.equal(
    fixture.siteWindow.location.href,
    "https://example.test/sample/start?mode=test",
  );
  assert.equal(fixture.siteWindow.focusCount, 0);
  assert.equal(fixture.siteWindow.blurCount, 2);
  assert.equal(fixture.getPopupFocusCount(), 2);
  assert.deepEqual(fixture.connections, [fixture.siteWindow]);
  assert.deepEqual(fixture.reconnects, [fixture.siteWindow]);
  assert.equal(fixture.timers.size, 1);
  vm.runInContext("settleUserFlowImportConnection(true)", fixture.context);
  assert.equal(await ready, true);
  vm.runInContext("completeUserFlowImportTarget()", fixture.context);
  assert.equal(fixture.siteWindow.closed, false);
  assert.equal(fixture.context.reservedUserFlowImportWindow, null);
  assert.equal(fixture.context.userFlowOpenedWindows.has(fixture.siteWindow), true);
});

test("standalone sample import rejects another origin and cleans up its reserved window", async () => {
  const fixture = createStandaloneSampleImporter();

  assert.equal(vm.runInContext("reserveUserFlowImportTarget()", fixture.context), true);
  await assert.rejects(
    vm.runInContext(
      'prepareUserFlowImportTarget("https://different.test/sample")',
      fixture.context,
    ),
    /같은 사이트/,
  );
  vm.runInContext("cancelUserFlowImportTarget()", fixture.context);
  assert.equal(fixture.siteWindow.closed, true);
  assert.equal(fixture.siteWindow.closeCount, 1);
  assert.equal(fixture.context.userFlowOpenedWindows.size, 0);
});

test("standalone sample import reports popup blocking before it fetches the sample", () => {
  const fixture = createStandaloneSampleImporter({ blocked: true });

  assert.equal(vm.runInContext("reserveUserFlowImportTarget()", fixture.context), false);
  assert.match(fixture.statuses[0], /사이트 창이 차단/);
  assert.match(fixture.statuses[0], /팝업 및 리디렉션/);
});

test("product import waits for the connected site's initial log state", () => {
  assert.match(
    source,
    /const completesImportConnection =\s*event\.source === reservedUserFlowImportWindow;[\s\S]*?renderUserFlowState\(nextUserFlowState\);[\s\S]*?if \(completesImportConnection\) \{\s*settleUserFlowImportConnection\(true\);/,
  );
  const parentReadySource = extract("handleParentReady", "pruneClosedUserFlowWindows");
  assert.doesNotMatch(parentReadySource, /settleUserFlowImportConnection\(true\)/);
  assert.match(source, /reserveImportTarget: reserveUserFlowImportTarget/);
  assert.match(source, /prepareImportTarget: prepareUserFlowImportTarget/);
  assert.match(source, /completeImportTarget: completeUserFlowImportTarget/);
  assert.match(source, /cancelImportTarget: cancelUserFlowImportTarget/);
});

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

test("test replay always requests sized result windows instead of ordinary tabs", () => {
  const fixture = createSequence();
  fixture.start();
  fixture.update({ isReplaying: true, replaySessionId: "first" });
  fixture.update({ isReplaying: false, replaySessionId: "", completedReplaySessionId: "first" });
  fixture.runAdvance();
  assert.equal(fixture.openOptions.length, 2);
  assert.deepEqual(toPlain(fixture.openOptions), [
    { openInNewWindow: true, positionOffset: 0 },
    { openInNewWindow: true, positionOffset: 20 },
  ]);
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

test("mobile, PC and legacy result windows retain their native UA throughout the sequence", () => {
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

test("log-list title actions use rename and export icons while controls expose test addition", () => {
  const renderer = extract("renderUserFlowState", "isParentWindowOpen");
  assert.match(renderer, /class="user-flow-replay user-flow-new-window"[\s\S]*?data-user-flow-command="open-session-window"[\s\S]*?>새창<\/button>\s*<button[\s\S]*?data-user-flow-command="toggle-replay-session"/);
  assert.match(renderer, /class="user-flow-session-title-row"[\s\S]*?class="user-flow-title-icon user-flow-name-edit-icon"[\s\S]*?data-user-flow-name-edit[\s\S]*?class="user-flow-title-icon user-flow-export-icon"[\s\S]*?data-user-flow-command="export-recording"/);
  assert.match(renderer, /class="user-flow-window-view"[\s\S]*?data-user-flow-command="view-session-window"[\s\S]*?>페이지 보기<\/button>/);
  assert.match(renderer, /class="user-flow-test-add"[\s\S]*?data-user-flow-command="add-test-session"[\s\S]*?>로그 테스트 추가<\/button>/);
  assert.match(
    renderer,
    /class="user-flow-session-controls user-flow-session-controls-stacked"[\s\S]*?class="user-flow-session-primary-controls"[\s\S]*?data-user-flow-command="toggle-replay-session"[\s\S]*?data-user-flow-command="delete-session"[\s\S]*?class="user-flow-session-secondary-controls"[\s\S]*?data-user-flow-command="view-session-window"[\s\S]*?data-user-flow-command="add-test-session"/,
  );
  assert.doesNotMatch(renderer, /class="user-flow-export"|>내보내기<\/button>/);
  assert.doesNotMatch(renderer, /class="user-flow-name-action"/);
  assert.doesNotMatch(extract("renderUserFlowTestSessions", "renderUserFlowNotice"), /open-session-window/);
  assert.match(renderer, /newWindowDisabled =\s*replayDisabled \|\| flowState\.isReplaying \|\| isUserFlowTestReplayRunning\(\)/);
  const css = fs.readFileSync(path.join(__dirname, "../css/popup.css"), "utf8");
  assert.match(css, /\.user-flow-new-window\s*\{\s*border-color: #1266d6;\s*color: #1266d6;\s*\}/);
  assert.match(css, /\.user-flow-replay\s*\{[^}]*background: #ffffff;/);
  assert.match(
    css,
    /\.user-flow-window-view,\s*\.user-flow-test-add\s*\{[^}]*min-width: 48px;[^}]*height: 24px;[^}]*border: 1px solid #cbd5e1;[^}]*font-size: 11px;/,
  );
  assert.match(
    css,
    /\.user-flow-window-view:disabled,\s*\.user-flow-test-add:disabled\s*\{[^}]*border-color: #cbd5e1;[^}]*opacity: 1;/,
  );
  assert.match(
    css,
    /\.user-flow-action\.user-flow-new-window:hover:not\(:disabled\),[\s\S]*?background: #eff6ff;/,
  );
  assert.doesNotMatch(css, /\.user-flow-name-action/);
});

test("the test button adds the same log repeatedly and ignores disabled or missing clicks", () => {
  const fixture = createSequence();
  fixture.context.userFlowTabs.testSessionIds = [];
  fixture.context.userFlowTabs.testEntryIds = [];

  fixture.clickAddTest("second");
  assert.deepEqual(toPlain(fixture.context.userFlowTabs.testSessionIds), ["second"]);
  assert.deepEqual(fixture.toasts, ["로그 테스트에 추가됨"]);

  fixture.clickAddTest("second");
  fixture.clickAddTest("third", true);
  fixture.clickAddTest("missing");
  assert.deepEqual(toPlain(fixture.context.userFlowTabs.testSessionIds), ["second", "second"]);
  assert.deepEqual(toPlain(fixture.context.userFlowTabs.testEntryIds), ["second", "second::2"]);
  assert.deepEqual(fixture.toasts, [
    "로그 테스트에 추가됨",
    "로그 테스트에 추가됨 · 2회",
  ]);

  const resetEntry = [...fixture.timers].find(([, timer]) => timer.ms === 1360);
  assert.ok(resetEntry);
  fixture.timers.delete(resetEntry[0]);
  resetEntry[1].callback();
  fixture.clickAddTest("second");
  assert.equal(fixture.toasts.at(-1), "로그 테스트에 추가됨");
});

test("list view raises its linked window and close-windows closes every popup opened by Data Note", () => {
  const fixture = createSequence();
  fixture.start();
  const firstWindow = fixture.windows[0];
  fixture.clickSessionView("first");
  assert.equal(firstWindow.focusCount, 1);
  fixture.update({ isReplaying: true, replaySessionId: "first" });
  fixture.update({ isReplaying: false, replaySessionId: "", completedReplaySessionId: "first" });
  fixture.runAdvance();
  const secondWindow = fixture.windows[1];
  assert.equal(fixture.context.userFlowOpenedWindows.size, 2);
  assert.equal(fixture.context.userFlowSessionWindows.get("second"), secondWindow);

  fixture.clickCloseWindows();

  assert.equal(firstWindow.closed, true);
  assert.equal(secondWindow.closed, true);
  assert.equal(firstWindow.closeCount, 1);
  assert.equal(secondWindow.closeCount, 1);
  assert.equal(fixture.context.userFlowOpenedWindows.size, 0);
  assert.equal(fixture.context.userFlowSessionWindows.size, 0);
  assert.equal(fixture.context.userFlowTestReplayWindows.size, 0);
  assert.match(fixture.statuses.at(-1), /새창 2개를 닫았습니다/);
});

test("the top close-windows control follows export and the clear border is fully opaque", () => {
  const html = fs.readFileSync(path.join(__dirname, "../popup.html"), "utf8");
  assert.match(
    html,
    /id="userFlowExportAllButton"[\s\S]*?>모두 내보내기<\/button>\s*<button\s+class="user-flow-action user-flow-new-window"[\s\S]*?id="userFlowCloseWindowsButton"[\s\S]*?data-user-flow-command="close-opened-windows"[\s\S]*?>새창 닫기<\/button>\s*<button[\s\S]*?id="userFlowClearAllButton"/,
  );
  const css = fs.readFileSync(path.join(__dirname, "../css/popup.css"), "utf8");
  assert.match(
    css,
    /\.user-flow-action\[data-action="clear-all"\]\s*\{[^}]*border-color: #b42345;/,
  );
});

test("clear removes popup tab organization even when no site is connected", () => {
  const fixture = createSequence({ sendSucceeds: false });

  fixture.clickClear();
  assert.equal(fixture.getOrganizationResetCount(), 1);
  assert.deepEqual(fixture.commands.at(-1), {
    command: "clear",
    sessionId: "",
  });
  assert.match(fixture.statuses.at(-1), /탭 구성을 모두 삭제/);
  assert.match(fixture.statuses.at(-1), /사이트 연결 후/);
});

test("opening a new window never replays until the user clicks replay, even after readiness", () => {
  const fixture = createSequence({ environment: { isMobile: true, userAgent: MOBILE_UA } });
  const originalTab = fixture.getActiveParent();
  fixture.clickNewWindow();
  assert.deepEqual(toPlain(fixture.openOptions), [{ openInNewWindow: true }]);
  assert.equal(fixture.windows.length, 1);
  assert.equal(originalTab.closed, false);
  assert.equal(fixture.context.replayNavigationRequestedReplay, false);
  assert.equal(fixture.context.userFlowReplayWindow, fixture.windows[0]);
  assert.equal(fixture.commands.length, 0);
  assert.equal(fixture.context.userFlowTestReplayWindows.size, 0);
  assert.equal(fixture.context.userFlowTestReplayCurrentSessionId, "");

  fixture.ready({ pendingRequestCount: 2, isWaitingForRequests: true });
  assert.ok(![...fixture.timers.values()].some((timer) => timer.ms === 500));
  assert.equal(fixture.commands.length, 0);
  fixture.ready({ pendingRequestCount: 0, isWaitingForRequests: false });
  fixture.runIdle();
  assert.equal(fixture.commands.length, 0);
  assert.equal(fixture.context.replayNavigationSessionId, "");
  assert.equal(fixture.context.replayNavigationRequestedReplay, false);
  fixture.ready();
  assert.equal(fixture.commands.length, 0);
  fixture.clickReplay();
  assert.deepEqual(fixture.commands, [{
    command: "toggle-replay-session",
    sessionId: "first",
    waitForNetworkIdle: true,
  }]);
  assert.equal(fixture.commandTargets[0], fixture.windows[0]);
  assert.equal(fixture.commandUserAgents[0], DESKTOP_UA);
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
  assert.equal(fixture.context.replayNavigationRequestedReplay, false);
});

test("a new-window connection timeout never starts playback or a test queue", () => {
  const fixture = createSequence();
  fixture.clickNewWindow();
  const entry = [...fixture.timers].find(([, timer]) => timer.ms === 60000);
  assert.ok(entry);
  fixture.timers.delete(entry[0]);
  entry[1].callback();
  assert.deepEqual(fixture.commands, [{ command: "get-state" }]);
  assert.equal(fixture.context.replayNavigationRequestedReplay, false);
  assert.equal(fixture.context.userFlowTestReplayFailedSessionIds.size, 0);
  assert.equal(fixture.windows[0].closed, false);
});

test("clearing pending navigation prevents a delayed new-window replay", () => {
  const fixture = createSequence();
  fixture.clickNewWindow();
  fixture.ready();
  fixture.runIdle();
  fixture.context.willReplayNavigate = () => true;
  fixture.clickReplay("second");
  fixture.ready();
  const callback = [...fixture.timers.values()].find((timer) => timer.ms === 500).callback;
  vm.runInContext("clearReplayNavigationState()", fixture.context);
  callback();
  assert.equal(fixture.commands.length, 1);
  assert.equal(fixture.context.replayNavigationRequestedReplay, false);
  assert.equal(fixture.timers.size, 0);
});

test("other log lists replay in the same opened window without opening or resizing another", () => {
  const fixture = createSequence();
  fixture.clickNewWindow();
  fixture.ready();
  fixture.runIdle();
  for (const sessionId of ["first", "second", "third"]) fixture.clickReplay(sessionId);
  assert.deepEqual(fixture.commands.map((command) => command.sessionId), ["first", "second", "third"]);
  assert.ok(fixture.commandTargets.every((target) => target === fixture.windows[0]));
  assert.equal(fixture.windows.length, 1);
  assert.deepEqual(toPlain(fixture.openOptions), [{ openInNewWindow: true }]);
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
    assert.deepEqual(fixture.connectionOptions, [{ hideScrollbars: true }]);
  }
});

test("ordinary non-test tabs do not request hidden page scrollbars", () => {
  const fixture = createTabOpener();
  fixture.open();
  assert.deepEqual(fixture.connectionOptions, [{ hideScrollbars: false }]);
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

test("closing the selected replay window during a requested navigation cannot replay in another site", () => {
  const fixture = createSequence();
  const originalTab = fixture.getActiveParent();
  fixture.clickNewWindow();
  fixture.ready();
  fixture.runIdle();
  fixture.context.willReplayNavigate = () => true;
  fixture.clickReplay("second");
  assert.equal(fixture.context.replayNavigationRequestedReplay, true);
  fixture.ready();
  fixture.windows[0].closed = true;
  fixture.context.getActiveParentWindow = () => originalTab;
  fixture.runIdle();
  assert.equal(fixture.commands.length, 1);
  assert.equal(fixture.context.replayNavigationRequestedReplay, false);
  assert.match(fixture.statuses.at(-1), /새 창이 닫혔거나 연결이 변경되어/);
});

test("ordinary log navigation waits for readiness and communication before replaying", () => {
  const fixture = createSequence();
  fixture.context.willReplayNavigate = () => true;
  fixture.clickReplay("first");
  assert.equal(fixture.context.replayNavigationRequestedReplay, true);
  assert.equal(fixture.commands.length, 1);
  assert.equal(fixture.commands[0].waitForNetworkIdle, true);
  fixture.ready({ pendingRequestCount: 1, isWaitingForRequests: true });
  assert.ok(![...fixture.timers.values()].some((timer) => timer.ms === 500));
  fixture.ready({ pendingRequestCount: 0, isWaitingForRequests: false });
  fixture.runIdle();
  assert.deepEqual(fixture.commands[1], {
    command: "toggle-replay-session",
    sessionId: "first",
    waitForNetworkIdle: true,
  });
  assert.equal(fixture.commands.length, 2);
  assert.equal(fixture.context.replayNavigationRequestedReplay, false);
  assert.equal(fixture.windows.length, 0);
});

test("the opened window is placed flush with the Data Note popup's right edge and top", () => {
  const fixture = createTabOpener({
    viewport: { width: 390, height: 844 },
    popupGeometry: { screenX: 100, screenY: 60, outerWidth: 800 },
  });
  fixture.open({ openInNewWindow: true });
  assert.equal(fixture.opens[0].features, "popup=yes,width=390,height=844,left=900,top=60");
});

test("sequential test window offsets move right and down together", () => {
  const fixture = createTabOpener({
    viewport: { width: 390, height: 844 },
    popupGeometry: { screenX: 100, screenY: 60, outerWidth: 800 },
  });
  fixture.open({ openInNewWindow: true, positionOffset: 40 });
  assert.equal(fixture.opens[0].features, "popup=yes,width=390,height=844,left=940,top=100");
  const invalidOffset = createTabOpener({
    popupGeometry: { screenX: 100, screenY: 60, outerWidth: 800 },
  });
  invalidOffset.open({ openInNewWindow: true, positionOffset: "20,left=0" });
  assert.equal(invalidOffset.opens[0].features, "popup=yes,left=900,top=60");
});

test("positioning supports negative monitor coordinates and legacy screen-position aliases", () => {
  const fixture = createTabOpener({
    popupGeometry: { screenLeft: -1500, screenTop: -20, outerWidth: 400 },
  });
  fixture.open({ openInNewWindow: true });
  assert.equal(fixture.opens[0].features, "popup=yes,left=-1100,top=-20");
  const rounded = createTabOpener({
    popupGeometry: { screenX: 100.4, screenY: 60.6, outerWidth: 800.4 },
  });
  rounded.open({ openInNewWindow: true });
  assert.equal(rounded.opens[0].features, "popup=yes,left=901,top=61");
});

test("ordinary new tabs do not inherit new-window positioning features", () => {
  const fixture = createTabOpener({
    viewport: { width: 390, height: 844 },
    popupGeometry: { screenX: 100, screenY: 60, outerWidth: 800 },
  });
  fixture.open();
  assert.deepEqual(fixture.opens, [{ url: "about:blank", target: "_blank" }]);
});

test("an explicit replay request continues after another list navigates the same selected window", () => {
  const fixture = createSequence();
  fixture.clickNewWindow();
  fixture.ready();
  fixture.runIdle();
  const selectedWindow = fixture.windows[0];
  fixture.context.willReplayNavigate = () => true;
  fixture.clickReplay("second");
  assert.equal(fixture.context.replayNavigationSessionId, "second");
  assert.equal(fixture.context.replayNavigationRequestedReplay, true);
  assert.equal(fixture.commands.length, 1);
  fixture.ready({ pendingRequestCount: 1 });
  assert.ok(![...fixture.timers.values()].some((timer) => timer.ms === 500));

  fixture.context.willReplayNavigate = () => false;
  fixture.ready({ pendingRequestCount: 0 });
  fixture.runIdle();
  assert.equal(fixture.commands.length, 2);
  assert.ok(fixture.commands.every((command) => command.sessionId === "second"));
  assert.ok(fixture.commandTargets.every((target) => target === selectedWindow));
  assert.equal(fixture.windows.length, 1);
  assert.equal(fixture.context.replayNavigationRequestedReplay, false);
  fixture.ready();
  assert.equal(fixture.commands.length, 2);
});

test("log playback returns to the selected window after separate log-test result windows finish", () => {
  const fixture = createSequence();
  fixture.clickNewWindow();
  fixture.ready();
  fixture.runIdle();
  const selectedWindow = fixture.windows[0];
  fixture.start();
  for (const sessionId of ["first", "second", "third"]) {
    assert.notEqual(fixture.commandTargets.at(-1), selectedWindow);
    fixture.update({ isReplaying: true, replaySessionId: sessionId });
    fixture.update({ isReplaying: false, replaySessionId: "", completedReplaySessionId: sessionId });
    fixture.runAdvance();
  }
  fixture.clickReplay("second");
  assert.equal(fixture.commandTargets.at(-1), selectedWindow);
  assert.equal(fixture.connections.at(-1), selectedWindow);
  assert.equal(fixture.windows.length, 4);
  assert.ok(fixture.windows.every((target) => !target.closed));
});
