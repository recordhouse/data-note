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
const readmeSource = fs.readFileSync(
  path.join(__dirname, "../README.md"),
  "utf8",
);

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
    /configureExternalLink\(\s*"#userFlowCommunicationButton",\s*readmeConfig\.communicationUrl/,
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

test("popup paths are parsed from the marked README JSON block", () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(importSource, context);
  const config = JSON.parse(JSON.stringify(
    context.window.UserFlowImport.parseReadmeConfig(readmeSource),
  ));

  assert.deepEqual(config, {
    communicationUrl: "/communication",
    importUrls: [],
    loginUrl: "/login",
  });
  assert.match(importSource, /const README_CONFIG_PATH = "\.\/README\.md";/);
  assert.match(importSource, /fetch\(readmeUrl\.href,[\s\S]*?cache: "no-store"/);
  assert.match(readmeSource, /<!-- DATA_NOTE_POPUP_CONFIG_START -->[\s\S]*?<!-- DATA_NOTE_POPUP_CONFIG_END -->/);
});

test("controller loads README paths before enabling configured links", async () => {
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
        text: async () => readmeSource,
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
  await controller.loadReadmeConfig();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://example.test/README.md");
  assert.equal(requests[0].options.cache, "no-store");
  assert.equal(elements["#userFlowLoginButton"].href, "https://example.test/login");
  assert.equal(
    elements["#userFlowCommunicationButton"].href,
    "https://example.test/communication",
  );
  assert.equal(elements["#userFlowLoginButton"].getAttribute("aria-disabled"), null);
  assert.equal(elements["#userFlowUrlImportButton"].disabled, true);
});
