const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const popupSource = fs.readFileSync(
  path.join(__dirname, "../popup.html"),
  "utf8",
);
const importSource = fs.readFileSync(
  path.join(__dirname, "../js/user-flow-import.js"),
  "utf8",
);
const cssSource = fs.readFileSync(
  path.join(__dirname, "../css/popup.css"),
  "utf8",
);
const pathConfigSource = fs.readFileSync(
  path.join(__dirname, "../popup-paths.json"),
  "utf8",
);
const pathConfig = JSON.parse(pathConfigSource);

test("login and communication links sit in a smaller lower-right action row", () => {
  const importIndex = popupSource.indexOf('id="userFlowImportButton"');
  const recordIndex = popupSource.indexOf('id="userFlowRecordButton"');
  const externalActionsIndex = popupSource.indexOf(
    'class="user-flow-external-actions"',
  );
  const loginIndex = popupSource.indexOf('id="userFlowLoginButton"');
  const communicationIndex = popupSource.indexOf(
    'id="userFlowCommunicationButton"',
  );

  assert.ok(importIndex >= 0);
  assert.ok(recordIndex > importIndex);
  assert.ok(externalActionsIndex > recordIndex);
  assert.ok(loginIndex > externalActionsIndex);
  assert.ok(communicationIndex > loginIndex);
  assert.doesNotMatch(popupSource, /USER_FLOW_(?:LOGIN|COMMUNICATION|IMPORT)_URL/);
  assert.doesNotMatch(importSource, /window\.USER_FLOW_/);
  assert.match(
    importSource,
    /configureExternalLink\(\s*"#userFlowCommunicationButton",\s*pathConfig\.communicationUrl/,
  );
  const externalLinkRule = cssSource.match(
    /\.user-flow-external-link\s*\{([^}]*)\}/,
  );
  assert.ok(externalLinkRule);
  assert.doesNotMatch(externalLinkRule[1], /border-color|background|color:/);
  assert.doesNotMatch(cssSource, /\.user-flow-external-link:hover/);
  assert.match(
    cssSource,
    /\.user-flow-external-actions\s*\{[^}]*flex: 0 0 100%;[^}]*justify-content: flex-end;/,
  );
  assert.match(
    cssSource,
    /\.user-flow-external-actions \.user-flow-external-link\s*\{[^}]*min-width: 54px;[^}]*height: 26px;[^}]*font-size: 11px;/,
  );
});

test("popup paths are stored in a dedicated root JSON file", () => {
  assert.deepEqual(pathConfig, {
    communicationUrl: "/communication",
    importUrls: [],
    loginUrl: "/login",
  });
  assert.match(importSource, /const PATH_CONFIG_PATH = "\.\/popup-paths\.json";/);
  assert.match(importSource, /fetch\(configUrl\.href,[\s\S]*?cache: "no-store"/);
  assert.doesNotMatch(importSource, /README_CONFIG|parseReadmeConfig/);
});

test("controller loads the root path config before enabling configured links", async () => {
  function createElement() {
    const attributes = new Map();
    return {
      appendChild(child) {
        this.children.push(child);
      },
      children: [],
      disabled: false,
      hidden: false,
      removeAttribute(name) {
        attributes.delete(name);
      },
      replaceChildren() {
        this.children = [];
      },
      setAttribute(name, value) {
        attributes.set(name, String(value));
      },
      getAttribute(name) {
        return attributes.get(name) ?? null;
      },
    };
  }

  const elements = {
    "#userFlowCommunicationButton": createElement(),
    "#userFlowImportButton": createElement(),
    "#userFlowLoginButton": createElement(),
    "#userFlowUrlImportButton": createElement(),
    "#userFlowUrlImportPanel": createElement(),
    "#userFlowUrlImportSelect": createElement(),
  };
  const requests = [];
  const context = vm.createContext({
    URL,
    document: {
      addEventListener() {},
      body: { classList: { remove() {} } },
      createElement: () => createElement(),
      querySelector: (selector) => elements[selector] || null,
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () => pathConfig,
      };
    },
    window: {
      addEventListener() {},
      location: { href: "https://example.test/popup.html" },
      setTimeout() {},
    },
  });
  vm.runInContext(importSource, context);
  const controller = context.window.UserFlowImport.createController();

  controller.attach();
  assert.equal(elements["#userFlowLoginButton"].getAttribute("aria-disabled"), "true");
  await controller.loadPathConfig();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://example.test/popup-paths.json");
  assert.equal(requests[0].options.cache, "no-store");
  assert.equal(elements["#userFlowLoginButton"].href, "https://example.test/login");
  assert.equal(
    elements["#userFlowCommunicationButton"].href,
    "https://example.test/communication",
  );
  assert.equal(elements["#userFlowLoginButton"].getAttribute("aria-disabled"), null);
  assert.equal(elements["#userFlowUrlImportButton"].disabled, true);
});

function createUrlImportController({ prepareSucceeds = true } = {}) {
  const importData = {
    sessions: [
      {
        events: [{ at: 0, page: "/sample/start", type: "click" }],
        id: "sample-session",
      },
    ],
  };
  const serializedImport = JSON.stringify(importData);
  const calls = [];
  const commands = [];

  class FakeFile {
    constructor(parts, name, options = {}) {
      [this.source] = parts;
      this.name = name;
      this.type = options.type || "";
      this.size = serializedImport.length;
    }

    async text() {
      return this.source.text();
    }
  }

  const context = vm.createContext({
    File: FakeFile,
    URL,
    document: { querySelector: () => null },
    fetch: async () => {
      calls.push("fetch");
      return {
        blob: async () => ({
          size: serializedImport.length,
          text: async () => serializedImport,
          type: "application/json",
        }),
        headers: { get: () => "" },
        ok: true,
        url: "https://example.test/samples/basic.json",
      };
    },
    window: {
      location: { href: "https://example.test/popup.html" },
    },
  });
  vm.runInContext(importSource, context);
  const tabs = {
    activeTabId: "tab-1",
    notice: "",
    sessionTabs: {},
    tabs: [{ id: "tab-1", name: "기본" }],
  };
  const controller = context.window.UserFlowImport.createController({
    cancelImportTarget: () => calls.push("cancel"),
    completeImportTarget: () => calls.push("complete"),
    getState: () => ({ sessions: [] }),
    getTabSessionCount: () => 0,
    getTabs: () => tabs,
    prepareImportTarget: async (startPage) => {
      calls.push(`prepare:${startPage}`);
      return prepareSucceeds;
    },
    reserveImportTarget: () => {
      calls.push("reserve");
      return true;
    },
    sendCommand: (command, payload) => {
      calls.push("send");
      commands.push({ command, payload });
      return true;
    },
  });

  return { calls, commands, controller, importData };
}

test("sample URL import reserves a site window before fetching and connects it before sending logs", async () => {
  const fixture = createUrlImportController();
  const imported = await fixture.controller.importUrl({
    url: "https://example.test/samples/basic.json",
  });

  assert.equal(imported, true);
  assert.deepEqual(fixture.calls, [
    "reserve",
    "fetch",
    "prepare:/sample/start",
    "send",
    "complete",
  ]);
  assert.equal(fixture.commands.length, 1);
  assert.equal(fixture.commands[0].command, "import-recordings");
  assert.deepEqual(
    JSON.parse(JSON.stringify(fixture.commands[0].payload.importData)),
    fixture.importData,
  );
});

test("sample URL import closes its reserved window when the sample site cannot connect", async () => {
  const fixture = createUrlImportController({ prepareSucceeds: false });
  const imported = await fixture.controller.importUrl({
    url: "https://example.test/samples/basic.json",
  });

  assert.equal(imported, false);
  assert.deepEqual(fixture.calls, [
    "reserve",
    "fetch",
    "prepare:/sample/start",
    "cancel",
  ]);
  assert.equal(fixture.commands.length, 0);
});
