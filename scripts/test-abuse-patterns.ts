import assert from "node:assert/strict";

import { findMatchedKeywords, matchesKeywordText } from "../apps/api/src/lib/abuse-patterns.mjs";

const positiveCases = [
  { text: "니애미", keyword: "패드립" },
  { text: "니 애미", keyword: "패드립" },
  { text: "니.애미", keyword: "패드립" },
  { text: "느금마", keyword: "패드립" },
  { text: "니엄마", keyword: "패드립" },
  { text: "너거매", keyword: "패드립" },
  { text: "너검마", keyword: "패드립" },
  { text: "너거 엄마", keyword: "패드립" },
  { text: "븅신", keyword: "병신" },
  { text: "개새끼", keyword: "개새" }
];

const negativeCases = [
  { text: "엄마가 오신다", keyword: "패드립" },
  { text: "애미야 밥먹자", keyword: "패드립" },
  { text: "내 엄마는 집에 계신다", keyword: "패드립" },
  { text: "너 거 매일 온다며", keyword: "패드립" }
];

for (const testCase of positiveCases) {
  assert.equal(
    matchesKeywordText(testCase.text, testCase.keyword),
    true,
    `${testCase.text} should match ${testCase.keyword}`
  );
}

for (const testCase of negativeCases) {
  assert.equal(
    matchesKeywordText(testCase.text, testCase.keyword),
    false,
    `${testCase.text} should not match ${testCase.keyword}`
  );
}

assert.deepEqual(findMatchedKeywords("니 애미 진짜 왜 그러냐", ["패드립", "모욕"]), ["패드립"]);

process.stdout.write("Abuse pattern checks passed.\n");
