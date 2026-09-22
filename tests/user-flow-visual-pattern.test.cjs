const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "../js/user-flow-recorder-visuals.js"),
  "utf8",
);

test("recording and replay share one dot layer confined to the edge gradients", () => {
  const patternCount = (source.match(/radial-gradient\(\s*circle,/g) || []).length;
  assert.equal(patternCount, 1);
  assert.match(
    source,
    /\.user-flow-screen-mask-layer\[data-layer="primary"\]::after\s*\{[\s\S]*?background-repeat: repeat;/,
  );
  assert.match(
    source,
    /\.user-flow-screen-mask-layer\[data-layer="primary"\]::after\s*\{[\s\S]*?background-size: 12px 12px;/,
  );
  assert.match(
    source,
    /-webkit-mask-image:[\s\S]*?linear-gradient\(to bottom,[\s\S]*?transparent 90px\),[\s\S]*?linear-gradient\(to top,[\s\S]*?transparent 90px\),[\s\S]*?linear-gradient\(to right,[\s\S]*?transparent 90px\),[\s\S]*?linear-gradient\(to left,[\s\S]*?transparent 90px\);/,
  );
  assert.match(source, /data-mode="recording"[\s\S]*?--user-flow-screen-mask-dot-color: rgba\(255, 235, 242, 0\.62\)/);
  assert.match(source, /data-mode="replaying"[\s\S]*?--user-flow-screen-mask-dot-color: rgba\(218, 255, 242, 0\.62\)/);
});
