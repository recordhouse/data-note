const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../js/user-flow-popup.js"), "utf8");
const storageKey = "response-mapping-user-flow-tabs:v1";
const plain = (value) => JSON.parse(JSON.stringify(value));

function extract(first, next) {
  const start = source.indexOf(`  function ${first}(`);
  const end = source.indexOf(`  function ${next}(`, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

function createOrdering({ view = "test", failSave = false } = {}) {
  const storage = new Map();
  const animations = [];
  const notices = [];
  const renderedList = { innerHTML: "" };
  let renders = 0;
  let writes = 0;
  function makeList(id) {
    const list = {
      id,
      scrollTop: 100,
      closest: () => null,
      getBoundingClientRect: () => ({ left: 0, right: 300, top: 100, bottom: 500 }),
      contains: (node) => node === list || list.sessions.includes(node),
      querySelectorAll: () => list.sessions,
    };
    const sessionIds = id === "userFlowSessionList"
      ? ["third", "second", "first"]
      : ["first", "second", "third"];
    list.sessions = sessionIds.map((sessionId, index) => {
      const classes = new Set();
      const session = {
        dataset: { userFlowSessionId: sessionId },
        draggable: true,
        closest: (selector) => selector === "[data-user-flow-session-id]" ? session : null,
        getBoundingClientRect: () => ({ top: 120 + index * 90, height: 70 }),
        classList: {
          add: (...names) => names.forEach((name) => classes.add(name)),
          remove: (...names) => names.forEach((name) => classes.delete(name)),
          contains: (name) => classes.has(name),
          toggle(name, enabled) {
            if (enabled) classes.add(name);
            else classes.delete(name);
          },
        },
      };
      return session;
    });
    return list;
  }
  const lists = {
    recordings: makeList("userFlowSessionList"),
    test: makeList("userFlowTestSessionList"),
  };
  const context = vm.createContext({
    document: {
      querySelector(selector) {
        if (selector === "#userFlowTestSessionList") return lists.test;
        if (selector === "#userFlowSessionList") return lists.recordings;
        return null;
      },
      querySelectorAll: () => [],
    },
    window: {
      localStorage: {
        setItem(key, value) {
          writes += 1;
          if (failSave) throw new Error("Storage unavailable");
          storage.set(key, value);
        },
      },
    },
    USER_FLOW_TAB_STORAGE_KEY: storageKey,
    USER_FLOW_VIEW_TEST: "test",
    USER_FLOW_DRAG_SCROLL_EDGE_PX: 48,
    USER_FLOW_DRAG_SCROLL_STEP_PX: 18,
    activeUserFlowView: view,
    draggedUserFlowSessionId: "",
    replayNavigationSessionId: "",
    syncingUserFlowTabsFromStorage: false,
    renderedUserFlowTestSignature: "",
    userFlowTestReplayCompletedSessionIds: new Set(),
    userFlowTestReplayFailedSessionIds: new Set(),
    userFlowTestReplayWindows: new Map(),
    userFlowTestReplayCurrentSessionId: "",
    currentUserFlowState: { isRecording: false, isReplaying: false },
    userFlowTabs: {
      sessionOrder: ["third", "second", "first"],
      testSessionIds: ["first", "second", "third"],
      sessionTabs: { first: "default", second: "default", third: "default" },
    },
    isUserFlowOrganizationBlocked: () => context.currentUserFlowState.isRecording || context.currentUserFlowState.isReplaying,
    isUserFlowTestReplayRunning: () => Boolean(context.userFlowTestReplayCurrentSessionId),
    captureUserFlowSessionPositions: () => new Map([["first", { top: 120 }]]),
    clearUserFlowSessionDropIndicators() {
      lists[view].sessions.forEach((session) => session.classList.remove("is-drop-before", "is-drop-after"));
    },
    resetUserFlowSessionDrag() {
      context.draggedUserFlowSessionId = "";
      lists[view].sessions.forEach((session) => session.classList.remove("is-dragging", "is-drop-before", "is-drop-after"));
    },
    rerenderUserFlowOrganization: () => { renders += 1; },
    animateUserFlowSessionMove: (_positions, id) => animations.push(id),
    showUserFlowImportStatus: (text) => notices.push(text),
    formatUserFlowRecordedAt: () => "26.09.17. 13:33:00",
    formatUserFlowSessionTitle: (session) => session.id,
    formatUserFlowSessionSubtitle: () => "",
    getUserFlowSessionMeta: () => "1개 행동",
    renderUserFlowSessionReplayProgress: () => "",
    escapeHtml: String,
  });
  vm.runInContext(extract("persistUserFlowTabs", "resetUserFlowOrganization"), context);
  vm.runInContext(extract("hasDraggedFiles", "captureUserFlowSessionPositions"), context);
  vm.runInContext(extract("handleUserFlowSessionDragStart", "handleUserFlowTabDragOver"), context);
  vm.runInContext(extract("getActiveUserFlowSessionList", "handleUserFlowTestDrop"), context);
  vm.runInContext(extract("handleUserFlowSessionOrderDrop", "handleUserFlowSessionDrop"), context);
  vm.runInContext(extract("renderUserFlowTestReplayResult", "renderUserFlowNotice"), context);
  function event(y, target = lists[view], types = []) {
    return {
      target, clientX: 150, clientY: y, prevented: false,
      preventDefault() { this.prevented = true; },
      dataTransfer: { types, setData() {}, setDragImage() {} },
    };
  }
  function dispatch(handler, value) {
    context.dragEvent = value;
    vm.runInContext(`${handler}(dragEvent)`, context);
  }
  return {
    context, lists, storage, animations, notices, event,
    get writes() { return writes; },
    get renders() { return renders; },
    start(id) {
      const value = event(150, lists[view].sessions.find((session) => session.dataset.userFlowSessionId === id));
      dispatch("handleUserFlowSessionDragStart", value);
      return value;
    },
    dragOver: (value) => dispatch("handleUserFlowSessionOrderDragOver", value),
    drop: (value) => dispatch("handleUserFlowSessionOrderDrop", value),
    markup(flowState = {}) {
      context.document.querySelector = () => renderedList;
      context.renderState = flowState;
      vm.runInContext('renderUserFlowTestSessions(renderState, [{ id: "first", eventCount: 1 }], "changed")', context);
      context.renderedUserFlowTestSignature = "";
      return renderedList.innerHTML;
    },
  };
}

test("test lists can be dragged to the end without changing normal log order", () => {
  const fixture = createOrdering();
  const originalOrder = plain(fixture.context.userFlowTabs.sessionOrder);
  fixture.start("first");
  const event = fixture.event(390);
  fixture.dragOver(event);
  assert.equal(event.dataTransfer.dropEffect, "move");
  assert.ok(fixture.lists.test.sessions[2].classList.contains("is-drop-after"));
  fixture.drop(event);
  assert.deepEqual(plain(fixture.context.userFlowTabs.testSessionIds), ["second", "third", "first"]);
  assert.deepEqual(plain(fixture.context.userFlowTabs.sessionOrder), originalOrder);
  assert.deepEqual(JSON.parse(fixture.storage.get(storageKey)).testSessionIds, ["second", "third", "first"]);
  assert.deepEqual(fixture.animations, ["first"]);
  assert.equal(fixture.context.draggedUserFlowSessionId, "");
});

test("test lists can move to the top or between other lists", () => {
  for (const [y, expected] of [[110, ["third", "first", "second"]], [230, ["first", "third", "second"]]]) {
    const fixture = createOrdering();
    fixture.start("third");
    fixture.drop(fixture.event(y));
    assert.deepEqual(plain(fixture.context.userFlowTabs.testSessionIds), expected);
  }
});

test("test reordering rolls back when saving fails", () => {
  const fixture = createOrdering({ failSave: true });
  fixture.start("first");
  fixture.drop(fixture.event(390));
  assert.deepEqual(plain(fixture.context.userFlowTabs.testSessionIds), ["first", "second", "third"]);
  assert.equal(fixture.storage.size, 0);
  assert.match(fixture.notices[0], /저장하지 못했습니다/);
});

test("normal list reordering still changes only normal order", () => {
  const fixture = createOrdering({ view: "recordings" });
  fixture.start("first");
  fixture.drop(fixture.event(110));
  assert.deepEqual(plain(fixture.context.userFlowTabs.sessionOrder), ["first", "third", "second"]);
  assert.deepEqual(plain(fixture.context.userFlowTabs.testSessionIds), ["first", "second", "third"]);
});

test("drag scrolling uses only the active test list", () => {
  const fixture = createOrdering();
  fixture.start("first");
  fixture.dragOver(fixture.event(110));
  assert.equal(fixture.lists.test.scrollTop, 82);
  assert.equal(fixture.lists.recordings.scrollTop, 100);
});

test("file drops and unavailable session IDs cannot alter test order", () => {
  const fixture = createOrdering();
  fixture.start("first");
  fixture.drop(fixture.event(390, fixture.lists.test, ["Files"]));
  assert.equal(fixture.writes, 0);
  fixture.context.draggedUserFlowSessionId = "missing";
  fixture.drop(fixture.event(390));
  assert.equal(fixture.writes, 0);
  assert.deepEqual(plain(fixture.context.userFlowTabs.testSessionIds), ["first", "second", "third"]);
});

test("reordering is blocked during recording, replay, queued tests, and navigation", () => {
  for (const state of [
    { currentUserFlowState: { isRecording: true } },
    { currentUserFlowState: { isReplaying: true } },
    { userFlowTestReplayCurrentSessionId: "second" },
    { replayNavigationSessionId: "second" },
  ]) {
    const fixture = createOrdering();
    fixture.start("first");
    Object.assign(fixture.context, state);
    fixture.drop(fixture.event(390));
    assert.equal(fixture.writes, 0);
  }
});

test("test rows enable dragging only while editing the order is safe", () => {
  const fixture = createOrdering();
  assert.match(fixture.markup(), /draggable="true"/);
  assert.match(fixture.markup({ isRecording: true }), /draggable="false"/);
  assert.match(fixture.markup({ isReplaying: true }), /draggable="false"/);
  fixture.context.userFlowTestReplayCurrentSessionId = "first";
  assert.match(fixture.markup(), /draggable="false"/);
  fixture.context.userFlowTestReplayCurrentSessionId = "";
  fixture.context.replayNavigationSessionId = "first";
  assert.match(fixture.markup(), /draggable="false"/);
});

test("failed test rows retain the shared result layout and result-view button", () => {
  const fixture = createOrdering();
  fixture.context.userFlowTestReplayFailedSessionIds.add("first");
  fixture.context.userFlowTestReplayWindows.set("first", {});
  const markup = fixture.markup();
  assert.match(markup, /data-test-state="failed"/);
  assert.match(markup, /class="user-flow-test-replay-complete" data-result="failed"/);
  assert.match(markup, /<strong>끝까지 재생 실패<\/strong>/);
  assert.match(markup, /data-user-flow-test-result-view="first"/);
  assert.doesNotMatch(markup, /재생 완료/);
});
