const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "../js/user-flow-recorder-visuals.js"),
  "utf8",
);

test("recording and replay colors are visible only through the shared dot mask", () => {
  const patternCount = (source.match(/radial-gradient\(\s*circle,/g) || []).length;
  assert.equal(patternCount, 2);
  assert.match(
    source,
    /\.user-flow-screen-mask-layer::after\s*\{[\s\S]*?background-image: var\(--user-flow-screen-mask-dot-gradient\);/,
  );
  assert.match(
    source,
    /\.user-flow-screen-mask-layer::after\s*\{[\s\S]*?-webkit-mask-image: radial-gradient\([\s\S]*?-webkit-mask-repeat: repeat;[\s\S]*?-webkit-mask-size: 9px 9px;/,
  );
  assert.match(source, /#000 0 1\.45px,[\s\S]*?transparent 2\.05px/);
  assert.match(
    source,
    /data-mode="recording"[\s\S]*?data-layer="primary"[\s\S]*?--user-flow-screen-mask-dot-gradient:[\s\S]*?rgba\(255, 24, 78, 0\.95\)/,
  );
  assert.match(source, /data-mode="recording"[\s\S]*?data-layer="secondary"[\s\S]*?--user-flow-screen-mask-dot-gradient:[\s\S]*?rgba\(139, 61, 246, 0\.95\)/);
  assert.match(source, /data-mode="replaying"[\s\S]*?data-layer="primary"[\s\S]*?--user-flow-screen-mask-dot-gradient:[\s\S]*?rgba\(0, 190, 112, 0\.95\)/);
  assert.match(source, /data-mode="replaying"[\s\S]*?data-layer="secondary"[\s\S]*?--user-flow-screen-mask-dot-gradient:[\s\S]*?rgba\(0, 178, 214, 0\.95\)/);
  assert.match(source, /rgba\(255, 24, 78, 0\) 90px/);
  assert.match(source, /rgba\(0, 190, 112, 0\) 90px/);
  assert.doesNotMatch(source, /--user-flow-screen-mask-dot-color/);
});
