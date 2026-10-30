// 프롬프트, 출력 스키마, 요청 본문 구성.
// 브라우저와 Node(테스트) 양쪽에서 쓰기 위해 DOM에 의존하지 않는다.

export const MODEL = "claude-opus-5-5";

export const CATEGORIES = [
  "전략",
  "재무·투자",
  "리스크",
  "실행·일정",
  "조직·인력",
  "고객·시장",
  "기술",
  "법무·규제",
  "기타",
];

export const DIFFICULTIES = ["상", "중", "하"];

// 근거 출처. "보고자료"는 반드시 원문 인용(quote)을 동반해야 한다.
export const BASIS = ["보고자료", "일반 원칙", "확인 필요"];

export const EXECUTIVES = [
  "CEO",
  "CFO",
  "COO",
  "CTO",
  "CHRO",
  "CMO",
  "CSO(전략)",
  "이사회·사외이사",
];

export const MEETING_TYPES = [
  "정기 업무보고",
  "신규 사업·투자 승인",
  "예산 심의",
  "문제·사고 보고",
  "성과 리뷰",
  "이사회 보고",
];

const str = (description) => ({ type: "string", description });
const obj = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const arr = (items, description) => ({ type: "array", items, description });

export const OUTPUT_SCHEMA = obj({
  overview: obj({
    core_message: str("보고의 핵심 메시지를 임원 관점에서 한 문장으로 요약"),
    weak_points: arr(
      str("임원이 파고들 가능성이 높은 보고 내용의 약점"),
      "가장 공격받기 쉬운 지점 2~5개",
    ),
  }),
  questions: arr(
    obj({
      category: { type: "string", enum: CATEGORIES },
      asker: str("이 질문을 할 가능성이 가장 높은 임원 (입력된 임원 중 하나)"),
      difficulty: { type: "string", enum: DIFFICULTIES },
      question: str("임원이 실제로 할 법한 말투의 질문"),
      intent: str("질문 뒤에 숨은 의도·우려"),
      answer: obj({
        conclusion: str("결론부터 말하는 1~2문장 답변"),
        supporting_points: arr(
          obj({
            point: str("답변을 뒷받침하는 내용"),
            basis: { type: "string", enum: BASIS },
            quote: str(
              "basis가 '보고자료'면 보고 자료 원문을 글자 그대로 짧게 인용. 그 외에는 빈 문자열",
            ),
          }),
        ),
      }),
      follow_ups: arr(
        obj({
          question: str("답변 후 이어질 수 있는 꼬리 질문"),
          answer_hint: str("꼬리 질문 대응 요령"),
        }),
      ),
      prep: arr(str("보고 전에 준비해 둘 자료·숫자")),
      pitfalls: str("이 질문에서 피해야 할 답변 방식"),
    }),
  ),
  data_gaps: arr(
    obj({
      item: str("보고 자료에 없어서 확인이 필요한 정보"),
      why: str("왜 필요한지"),
    }),
  ),
});

export const SYSTEM_PROMPT = `당신은 대기업 경영진 보고를 오래 준비해 온 전략기획 담당자입니다. 사용자가 임원 보고를 앞두고 있으며, 임원이 던질 예상 질문과 답변 초안을 준비하도록 돕습니다.

정확성 원칙 (가장 중요):
- 숫자, 날짜, 고유명사, 사실관계는 보고 자료에 있는 것만 사용합니다. 자료에 없는 수치나 사실을 지어내지 않습니다.
- 답변에 필요한 정보가 자료에 없으면 그 근거의 basis를 "확인 필요"로 표시하고, point에 무엇을 확인해야 하는지 적습니다. data_gaps에도 올립니다.
- basis가 "보고자료"인 근거는 quote에 자료 원문을 글자 그대로(띄어쓰기 포함) 짧게 인용합니다. 요약하거나 바꿔 쓰지 않습니다. 인용할 원문이 없다면 "보고자료"로 표시하지 않습니다.
- "일반 원칙"은 업계 상식이나 보고 요령처럼 특정 사실에 기대지 않는 내용에만 씁니다.

질문 작성 요령:
- 입력된 임원 역할별 관심사(예: CFO는 투자 대비 수익과 현금흐름, CEO는 전략적 의미와 의사결정 포인트)를 반영하고, 질문마다 가장 그럴듯한 질문자를 asker에 적습니다.
- 회의 성격에 맞춰 승인 여부, 리스크, 대안, 실패 시 대응, 일정 현실성, 책임 소재처럼 실제 회의에서 나오는 날카로운 질문을 우선합니다. 자료 내용을 그대로 되묻는 쉬운 질문은 줄입니다.
- 질문은 임원의 실제 말투로, 답변은 결론부터 짧게 씁니다.
- 요청된 개수만큼 질문을 만들고, 중요하고 어려운 질문을 앞에 둡니다.

모든 출력은 한국어로 작성합니다.`;

/**
 * @typedef {Object} GenerateInput
 * @property {string} topic 보고 주제
 * @property {string} material 붙여넣은 보고 자료 텍스트
 * @property {{name: string, base64: string}[]} pdfs 첨부 PDF
 * @property {string[]} executives 보고 대상 임원
 * @property {string} meetingType 회의 성격
 * @property {number} count 질문 개수
 * @property {string} extra 추가 맥락
 */

/**
 * 사용자 메시지 content 블록을 만든다. PDF는 텍스트보다 앞에 둔다.
 * @param {GenerateInput} input
 */
export function buildUserContent(input) {
  /** @type {import("@anthropic-ai/sdk/resources/beta/messages/messages").BetaContentBlockParam[]} */
  const blocks = [];
  for (const pdf of input.pdfs) {
    blocks.push({
      type: "document",
      title: pdf.name,
      source: { type: "base64", media_type: "application/pdf", data: pdf.base64 },
    });
  }

  const execs = input.executives.length ? input.executives.join(", ") : "CEO";
  const lines = [
    `보고 주제: ${input.topic.trim()}`,
    `회의 성격: ${input.meetingType}`,
    `보고 대상 임원: ${execs}`,
    `만들 질문 개수: ${input.count}개`,
  ];
  if (input.extra.trim()) {
    lines.push("", "<추가_맥락>", input.extra.trim(), "</추가_맥락>");
  }
  if (input.material.trim()) {
    lines.push("", "<보고_자료>", input.material.trim(), "</보고_자료>");
  }
  if (!input.material.trim() && input.pdfs.length === 0) {
    lines.push(
      "",
      "보고 자료가 첨부되지 않았습니다. 주제만으로 질문을 만들되, 구체적 사실이 필요한 근거는 모두 \"확인 필요\"로 표시하세요.",
    );
  } else if (input.pdfs.length) {
    lines.push("", `첨부 PDF(${input.pdfs.map((p) => p.name).join(", ")})도 보고 자료입니다.`);
  }
  lines.push("", `위 보고에 대해 임원 예상 질문 ${input.count}개와 답변 초안을 만들어 주세요.`);

  blocks.push({ type: "text", text: lines.join("\n") });
  return blocks;
}

/**
 * Messages API 요청 본문. 브라우저 앱과 테스트가 같은 값을 쓴다.
 * @param {GenerateInput} input
 * @param {"medium"|"high"|"xhigh"} effort
 * @returns {import("@anthropic-ai/sdk/resources/beta/messages/messages").BetaMessageStreamParams}
 */
export function buildRequest(input, effort) {
  return {
    model: MODEL,
    max_tokens: 64000,
    // Opus 5.5는 거절(refusal) 시 서버가 다른 모델로 이어서 처리하도록 한다.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM_PROMPT,
    output_config: {
      effort,
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
    messages: [{ role: "user", content: buildUserContent(input) }],
  };
}
