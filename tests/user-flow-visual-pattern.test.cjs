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
  const dotRuleStart = source.indexOf(
    '    .user-flow-screen-mask-layer::after {',
  );
  const dotRuleEnd = source.indexOf(
    '\n    .user-flow-screen-mask[data-mode="recording"]',
    dotRuleStart,
  );
  const dotRule = source.slice(dotRuleStart, dotRuleEnd);
  const webkitMaskImage = dotRule.match(
    /-webkit-mask-image:\s*(radial-gradient\([\s\S]*?\));/,
  );
  const maskImage = dotRule.match(
    /\n\s*mask-image:\s*(radial-gradient\([\s\S]*?\));/,
  );
  const webkitMaskSize = dotRule.match(
    /-webkit-mask-size:\s*([^;]+);/,
  );
  const maskSize = dotRule.match(/\n\s*mask-size:\s*([^;]+);/);

  assert.equal(patternCount, 2);
  assert.ok(dotRuleStart >= 0 && dotRuleEnd > dotRuleStart);
  assert.match(
    source,
    /\.user-flow-screen-mask-layer::after\s*\{[\s\S]*?background-image: var\(--user-flow-screen-mask-dot-gradient\);/,
  );
  assert.match(dotRule, /-webkit-mask-repeat: repeat;/);
  assert.match(dotRule, /\n\s*mask-repeat: repeat;/);
  assert.ok(webkitMaskImage && maskImage);
  assert.equal(
    webkitMaskImage[1].replace(/\s+/g, " "),
    maskImage[1].replace(/\s+/g, " "),
  );
  assert.ok(webkitMaskSize && maskSize);
  assert.equal(webkitMaskSize[1].trim(), maskSize[1].trim());
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
