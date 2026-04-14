import type { KeywordContextType, RetrievalIssueDefinition } from "./types.js";

export const RETRIEVAL_ISSUE_CATALOG: RetrievalIssueDefinition[] = [
  {
    type: "명예훼손",
    severity: "high",
    chargeLabel: "사이버 명예훼손",
    keywords: ["명예훼손", "허위사실", "사기꾼", "소문", "퍼뜨리", "망신"],
    lawQueries: ["명예훼손", "허위사실 적시", "형법 제307조"]
  },
  {
    type: "협박/공갈",
    severity: "high",
    chargeLabel: "협박",
    keywords: ["협박", "죽여", "가만 안", "찾아가", "해코지", "돈 보내"],
    lawQueries: ["협박", "공갈", "형법 제283조"]
  },
  {
    type: "모욕",
    severity: "medium",
    chargeLabel: "모욕",
    keywords: ["모욕", "병신", "쓰레기", "개새", "멍청", "정신병자", "패드립"],
    lawQueries: ["모욕", "형법 제311조", "온라인 모욕"]
  },
  {
    type: "개인정보 유출",
    severity: "high",
    chargeLabel: "개인정보 유출",
    keywords: ["신상", "전화번호", "주소", "개인정보", "실명", "사진 올릴", "유출"],
    lawQueries: ["개인정보 유출", "개인정보보호법", "실명 공개"]
  },
  {
    type: "스토킹",
    severity: "high",
    chargeLabel: "스토킹",
    keywords: ["계속 따라", "지켜보", "스토킹", "계속 연락", "찾아가겠다"],
    lawQueries: ["스토킹", "스토킹범죄처벌법"]
  },
  {
    type: "사기",
    severity: "high",
    chargeLabel: "사기",
    keywords: ["먹튀", "환불 안", "입금해", "송금", "돈만 받고", "기망"],
    lawQueries: ["사기", "형법 제347조", "게임 아이템 사기"]
  }
];

export const CONTEXT_PRECEDENT_HINTS: Record<KeywordContextType, string[]> = {
  community: ["온라인 게시글", "커뮤니티 게시글"],
  game_chat: ["게임 채팅", "인게임 채팅"],
  messenger: ["메신저 대화", "카카오톡 대화"],
  other: ["온라인 대화"]
};
