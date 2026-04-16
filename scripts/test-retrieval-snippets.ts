import assert from "node:assert/strict";

import { selectBestEvidenceSnippet } from "../apps/api/src/retrieval/snippets.js";
import type { EvidenceQueryRef } from "../apps/api/src/retrieval/types.js";

function main() {
  const lawMatchedQueries: EvidenceQueryRef[] = [
    {
      text: "허위사실 적시",
      bucket: "precise",
      channel: "law",
      issue_types: ["명예훼손"]
    }
  ];

  const lawSnippet = selectBestEvidenceSnippet({
    sources: [
      {
        field: "content",
        text: "공연히 사실 또는 허위사실을 적시하여 사람의 명예를 훼손한 자는 처벌한다. 단순한 의견 표명은 여기에서 제외된다."
      },
      {
        field: "article_title",
        text: "명예훼손"
      }
    ],
    matchedQueries: lawMatchedQueries,
    issueTypes: ["명예훼손"]
  });

  assert.ok(lawSnippet, "law snippet should exist");
  assert.equal(lawSnippet?.field, "content");
  assert.match(lawSnippet?.text ?? "", /허위사실|명예/);

  const precedentMatchedQueries: EvidenceQueryRef[] = [
    {
      text: "반복 연락",
      bucket: "precise",
      channel: "precedent",
      issue_types: ["스토킹"]
    }
  ];

  const precedentSnippet = selectBestEvidenceSnippet({
    sources: [
      {
        field: "summary",
        text: "피고인은 피해자에게 여러 차례 연락하였다. 피해자는 두려움을 느꼈다."
      },
      {
        field: "key_reasoning",
        text: "반복 연락과 접근이 결합되면 스토킹 행위로 평가할 수 있다. 단발성 연락만으로는 부족하다."
      }
    ],
    matchedQueries: precedentMatchedQueries,
    issueTypes: ["스토킹"]
  });

  assert.ok(precedentSnippet, "precedent snippet should exist");
  assert.equal(precedentSnippet?.field, "key_reasoning");
  assert.match(precedentSnippet?.text ?? "", /반복 연락|스토킹/);

  console.log("Retrieval snippet checks passed.");
}

main();
