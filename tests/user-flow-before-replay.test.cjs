const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "../js/user-flow-before-replay.js"),
  "utf8",
);

function createModule() {
  const popupWindow = {
    location: { href: "https://example.test/popup.html" },
    setTimeout,
  };
  vm.runInContext(
    source,
    vm.createContext({
      Date,
      Object,
      Promise,
      URL,
      window: popupWindow,
    }),
  );
  return popupWindow.UserFlowBeforeReplay;
}

test("a replay value comes from the first parenthesized title value that starts with A-Z", () => {
  const beforeReplay = createModule();
  assert.equal(beforeReplay.extractValue("상품 (ABC123) 재생"), "ABC123");
  assert.equal(beforeReplay.extractValue("(한글) 다음 (VALUE-02)"), "VALUE-02");
  assert.equal(beforeReplay.extractValue("(abc) (9VALUE)"), "");
  assert.equal(beforeReplay.extractValue("( ABC)"), "");
});

test("the preparation page must use the popup's origin", () => {
  const beforeReplay = createModule();
  assert.equal(
    beforeReplay.resolvePreparationUrl(
      { url: "/prepare" },
      "https://example.test/popup.html",
    ).href,
    "https://example.test/prepare",
  );
  assert.throws(
    () =>
      beforeReplay.resolvePreparationUrl(
        { url: "https://other.test/prepare" },
        "https://example.test/popup.html",
      ),
    /같은 사이트/,
  );
});

test("the preparation flow selects the third option, accepts dialogs, fills the title value and submits", async () => {
  const beforeReplay = createModule();
  const actions = [];
  class FakeEvent {
    constructor(type) {
      this.type = type;
    }
  }
  const select = {
    disabled: false,
    options: [{}, {}, {}],
    selectedIndex: -1,
    dispatchEvent: (event) => actions.push(`select:${event.type}`),
  };
  const input = {
    click: () => actions.push("input:click"),
    disabled: false,
    dispatchEvent: (event) => actions.push(`input:${event.type}`),
    focus: () => actions.push("input:focus"),
    value: "",
  };
  const targetWindow = {
    alert: () => {
      throw new Error("native alert should have been intercepted");
    },
    closed: false,
    confirm: () => false,
    Event: FakeEvent,
    location: {
      href: "https://example.test/prepare",
      replace(href) {
        this.href = href;
      },
    },
    UserFlowRecorder: {
      async waitForRequests(options) {
        actions.push(`network:${options.idleMs}`);
        return true;
      },
    },
  };
  const originalAlert = targetWindow.alert;
  const originalConfirm = targetWindow.confirm;
  const elements = {
    "#first": {
      disabled: false,
      click() {
        actions.push("first:click");
        targetWindow.alert("확인");
      },
    },
    "#input": input,
    "#select": select,
    "#submit": {
      disabled: false,
      click: () => actions.push("submit:click"),
    },
  };
  targetWindow.document = {
    querySelector: (selector) => elements[selector] || null,
    readyState: "complete",
  };

  const result = await beforeReplay.run({
    baseUrl: "https://example.test/popup.html",
    config: {
      url: "/prepare",
      selectors: {
        firstButton: "#first",
        input: "#input",
        select: "#select",
        submitButton: "#submit",
      },
    },
    elementTimeoutMs: 100,
    networkIdleMs: 0,
    networkTimeoutMs: 100,
    pageSettleMs: 0,
    pageTimeoutMs: 500,
    targetWindow,
    value: "ABC123",
  });

  assert.equal(select.selectedIndex, 2);
  assert.equal(input.value, "ABC123");
  assert.deepEqual(actions, [
    "select:input",
    "select:change",
    "first:click",
    "input:click",
    "input:focus",
    "input:input",
    "input:change",
    "submit:click",
    "network:0",
  ]);
  assert.equal(result.value, "ABC123");
  assert.equal(targetWindow.alert, originalAlert);
  assert.equal(targetWindow.confirm, originalConfirm);
});
