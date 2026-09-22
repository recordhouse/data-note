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

test("login and communication links keep adjacent editable URL settings", () => {
  const loginIndex = popupSource.indexOf('id="userFlowLoginButton"');
  const communicationIndex = popupSource.indexOf(
    'id="userFlowCommunicationButton"',
  );
  const importIndex = popupSource.indexOf('id="userFlowImportButton"');

  assert.ok(loginIndex >= 0);
  assert.ok(communicationIndex > loginIndex);
  assert.ok(importIndex > communicationIndex);
  assert.match(popupSource, /window\.USER_FLOW_LOGIN_URL = "\/login";/);
  assert.match(
    popupSource,
    /window\.USER_FLOW_COMMUNICATION_URL = "\/communication";/,
  );
  assert.match(
    importSource,
    /configureExternalLink\(\s*"#userFlowCommunicationButton",\s*window\.USER_FLOW_COMMUNICATION_URL/,
  );
  assert.match(
    cssSource,
    /\.user-flow-external-link\s*\{[^}]*border-color: #c4b5fd;[^}]*background: #f5f3ff;[^}]*color: #6d28d9;/,
  );
});
