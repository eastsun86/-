// 테스트용 보고 자료와 모의 모델 출력. 수치는 테스트 목적의 가상 값이다.
export const SAMPLE_MATERIAL = `동남아 물류센터 투자안
총 투자비는 1,200억 원이며
회수기간은 6년으로 추정한다.
2027년 3분기 착공 예정.`;

export const SAMPLE_RESULT = {
  overview: {
    core_message: "동남아 물류 거점 확보를 위한 1,200억 원 투자 승인 요청",
    weak_points: ["회수기간 6년의 근거가 약함", "현지 파트너 리스크 언급 없음"],
  },
  questions: [
    {
      category: "재무·투자",
      asker: "CFO",
      difficulty: "상",
      question: "회수기간 6년, 어떤 가정에서 나온 숫자입니까?",
      intent: "수익 가정의 보수성을 확인하려는 의도",
      answer: {
        conclusion: "기본 시나리오 기준 6년이며, 가정별 민감도는 보완하겠습니다.",
        supporting_points: [
          // 원문과 줄바꿈 위치가 다르지만 같은 문장 → ok
          { point: "총 투자비와 회수기간", basis: "보고자료", quote: "총 투자비는 1,200억 원이며 회수기간은 6년으로 추정한다." },
          // 원문에 없는 수치 → missing
          { point: "연 매출 300억 원", basis: "보고자료", quote: "연 매출은 300억 원이다." },
          { point: "가동률 가정 확인", basis: "확인 필요", quote: "" },
        ],
      },
      follow_ups: [{ question: "비관 시나리오에서는요?", answer_hint: "민감도 분석 수치로 답변" }],
      prep: ["시나리오별 회수기간 표"],
      pitfalls: "근거 없이 '충분히 보수적'이라고만 답하기",
    },
    {
      category: "실행·일정",
      asker: "CEO",
      difficulty: "중",
      question: "착공 일정은 현실적입니까?",
      intent: "일정 지연 리스크 점검",
      answer: {
        conclusion: "2027년 3분기 착공을 목표로 합니다.",
        supporting_points: [
          { point: "인허가 소요 기간은 일반적으로 변동성이 큼", basis: "일반 원칙", quote: "" },
        ],
      },
      follow_ups: [],
      prep: [],
      pitfalls: "",
    },
  ],
  data_gaps: [{ item: "현지 인허가 일정", why: "착공 시점의 현실성 판단에 필요" }],
};
