const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

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
  assert.match(popupSource, /window\.USER_FLOW_LOGIN_URL = "\/login";/);
  assert.match(
    popupSource,
    /window\.USER_FLOW_COMMUNICATION_URL = "\/communication";/,
  );
  assert.match(
    importSource,
    /configureExternalLink\(\s*"#userFlowCommunicationButton",\s*window\.USER_FLOW_COMMUNICATION_URL/,
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
