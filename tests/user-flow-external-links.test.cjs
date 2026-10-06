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
  const productImportIndex = popupSource.indexOf('id="userFlowUrlImportButton"');
  const recordIndex = popupSource.indexOf('id="userFlowRecordButton"');
  const externalActionsIndex = popupSource.indexOf(
    'class="user-flow-external-actions"',
  );
  const loginIndex = popupSource.indexOf('id="userFlowLoginButton"');
  const productIndex = popupSource.indexOf('id="userFlowProductButton"');
  const communicationIndex = popupSource.indexOf(
    'id="userFlowCommunicationButton"',
  );

  assert.ok(importIndex >= 0);
  assert.ok(productImportIndex >= 0);
  assert.ok(productImportIndex < importIndex);
  assert.ok(recordIndex > importIndex);
  assert.ok(externalActionsIndex > recordIndex);
  assert.ok(loginIndex > externalActionsIndex);
  assert.ok(productIndex > loginIndex);
  assert.ok(communicationIndex > productIndex);
  assert.doesNotMatch(popupSource, /userFlowResizePopupButton|data-popup-window-resize|팝업 재배치/);
  assert.doesNotMatch(
    popupSource,
    /USER_FLOW_(?:LOGIN|PRODUCT|COMMUNICATION|IMPORT)_URL/,
  );
  assert.doesNotMatch(importSource, /window\.USER_FLOW_/);
  assert.match(
    importSource,
    /configureExternalLink\(\s*"#userFlowCommunicationButton",\s*pathConfig\.communicationUrl/,
  );
  assert.match(
    importSource,
    /configureExternalLink\("#userFlowProductButton", pathConfig\.productUrl\)/,
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
  assert.match(
    cssSource,
    /#userFlowUrlImportButton\s*\{[^}]*border-color: #7c3aed;[^}]*color: #6d28d9;/,
  );
  assert.doesNotMatch(
    cssSource.match(/#userFlowUrlImportButton\s*\{([^}]*)\}/)?.[1] || "",
    /background/,
  );
  assert.match(
    cssSource,
    /#userFlowImportButton,\s*#userFlowExportAllButton\s*\{[^}]*border-color: #64748b;[^}]*color: #475569;/,
  );
  assert.match(
    cssSource,
    /\.user-flow-action:hover:not\(:disabled\):not\(\[aria-disabled="true"\]\)\s*\{[^}]*background: #f1f5f9;/,
  );
});

test("popup paths are stored in a dedicated root JSON file", () => {
  assert.deepEqual(pathConfig, {
    communicationUrl: "/communication",
    importUrls: [],
    loginUrl: "/login",
    productUrl: "/product",
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
    "#userFlowProductButton": createElement(),
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
  assert.equal(elements["#userFlowProductButton"].getAttribute("aria-disabled"), "true");
  await controller.loadPathConfig();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://example.test/popup-paths.json");
  assert.equal(requests[0].options.cache, "no-store");
  assert.equal(elements["#userFlowLoginButton"].href, "https://example.test/login");
  assert.equal(elements["#userFlowProductButton"].href, "https://example.test/product");
  assert.equal(
    elements["#userFlowCommunicationButton"].href,
    "https://example.test/communication",
  );
  assert.equal(elements["#userFlowLoginButton"].getAttribute("aria-disabled"), null);
  assert.equal(elements["#userFlowProductButton"].getAttribute("aria-disabled"), null);
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

function createProductArchiveEntries() {
  return [
    { isDirectory: true, name: "상품 A/" },
    {
      isDirectory: false,
      name: "상품 A/a.json",
      text: () =>
        JSON.stringify({
          session: {
            events: [{ at: 0, page: "/products/a", type: "click" }],
            id: "product-a",
          },
        }),
    },
    { isDirectory: true, name: "상품 B/" },
    {
      isDirectory: false,
      name: "상품 B/b.json",
      text: () =>
        JSON.stringify({
          session: {
            events: [{ at: 0, page: "/products/b", type: "click" }],
            id: "product-b",
          },
        }),
    },
  ];
}

test("ZIP product import keeps each folder mapping after a standalone popup connects", async () => {
  const initialTabs = {
    activeTabId: "before-connect",
    notice: "",
    sessionOrder: [],
    sessionTabs: {},
    tabs: [{ id: "before-connect", name: "연결 전" }],
    testEntryIds: [],
    testSessionIds: [],
  };
  let tabs = initialTabs;
  const commands = [];
  const protectedSessionIds = [];
  const releasedSessionIds = [];
  const archiveEntries = createProductArchiveEntries();
  const context = vm.createContext({
    URL,
    document: { querySelector: () => null },
    window: {
      location: { href: "https://example.test/popup.html" },
      UserFlowArchive: {
        readArchive: async () => archiveEntries,
      },
    },
  });
  vm.runInContext(importSource, context);
  const controller = context.window.UserFlowImport.createController({
    getState: () => ({ sessions: [] }),
    getTabCounts: () => new Map(tabs.tabs.map((tab) => [tab.id, 0])),
    getTabs: () => tabs,
    persistTabs: () => true,
    protectSessionTabs: (sessionIds) => {
      protectedSessionIds.push(...sessionIds);
    },
    prepareImportTarget: async () => {
      tabs = {
        activeTabId: "connected",
        notice: "",
        sessionOrder: [],
        sessionTabs: {},
        tabs: [{ id: "connected", name: "연결 후" }],
        testEntryIds: [],
        testSessionIds: [],
      };
      return true;
    },
    sendCommand: (command, payload) => {
      commands.push({ command, payload });
      return true;
    },
    releaseSessionTabs: (sessionIds) => {
      releasedSessionIds.push(...sessionIds);
    },
    setTabs: (nextTabs) => {
      tabs = nextTabs;
    },
  });
  const imported = await controller.importFile({
    name: "products.zip",
    size: 1024,
    type: "application/zip",
  });
  const firstProductTab = tabs.tabs.find((tab) => tab.name === "상품 A");
  const secondProductTab = tabs.tabs.find((tab) => tab.name === "상품 B");

  assert.equal(imported, true);
  assert.ok(firstProductTab);
  assert.ok(secondProductTab);
  assert.equal(tabs.sessionTabs["product-a"], firstProductTab.id);
  assert.equal(tabs.sessionTabs["product-b"], secondProductTab.id);
  assert.deepEqual(protectedSessionIds, ["product-a", "product-b"]);
  assert.deepEqual(releasedSessionIds, []);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].command, "import-recordings");
  assert.equal(commands[0].payload.importData.sessions.length, 2);
});

test("reimporting a product ZIP repairs existing logs without duplicating them", async () => {
  const state = {
    sessions: [
      { id: "product-a", importSourceZipName: "products.zip" },
      { id: "product-b", importSourceZipName: "products.zip" },
    ],
  };
  let tabs = {
    activeTabId: "tab-a",
    notice: "",
    sessionOrder: ["product-a", "product-b"],
    sessionTabs: {
      "product-a": "tab-a",
      "product-b": "tab-a",
    },
    tabs: [
      { id: "tab-a", name: "상품 A" },
      { id: "tab-b", name: "상품 B" },
    ],
    testEntryIds: [],
    testSessionIds: [],
  };
  const commands = [];
  const protectedSessionIds = [];
  const statuses = [];
  let renders = 0;
  const context = vm.createContext({
    URL,
    document: { querySelector: () => null },
    window: {
      location: { href: "https://example.test/popup.html" },
      UserFlowArchive: {
        readArchive: async () => createProductArchiveEntries(),
      },
    },
  });
  vm.runInContext(importSource, context);
  const controller = context.window.UserFlowImport.createController({
    getState: () => state,
    getTabCounts: () => {
      const counts = new Map(tabs.tabs.map((tab) => [tab.id, 0]));

      state.sessions.forEach((session) => {
        const tabId = tabs.sessionTabs[session.id] || tabs.tabs[0].id;
        counts.set(tabId, Number(counts.get(tabId) || 0) + 1);
      });

      return counts;
    },
    getTabs: () => tabs,
    persistTabs: () => true,
    protectSessionTabs: (sessionIds) => {
      protectedSessionIds.push(...sessionIds);
    },
    rerender: () => {
      renders += 1;
    },
    sendCommand: (command, payload) => {
      commands.push({ command, payload });
      return true;
    },
    setTabs: (nextTabs) => {
      tabs = nextTabs;
    },
    showStatus: (message) => {
      statuses.push(message);
    },
  });
  const imported = await controller.importFile(
    {
      name: "products.zip",
      size: 1024,
      type: "application/zip",
    },
    { skipZipNameDuplicateCheck: true },
  );

  assert.equal(imported, true);
  assert.equal(tabs.sessionTabs["product-a"], "tab-a");
  assert.equal(tabs.sessionTabs["product-b"], "tab-b");
  assert.deepEqual(protectedSessionIds, ["product-a", "product-b"]);
  assert.equal(commands.length, 0);
  assert.equal(renders, 1);
  assert.match(statuses.at(-1), /기존 로그 2개의 탭 배치를 복구했습니다/);
});
