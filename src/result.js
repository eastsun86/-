// 결과 후처리: 인용 검증, 마크다운 변환. DOM에 의존하지 않는다.

const norm = (s) =>
  String(s)
    .replace(/[“”"'‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * '보고자료' 근거의 인용문이 실제 원문에 있는지 확인해 각 근거에 check 값을 붙인다.
 *  - "ok": 붙여넣은 텍스트에서 찾음
 *  - "pdf": 텍스트에는 없지만 PDF가 첨부돼 있어 자동 확인 불가
 *  - "missing": 원문에서 찾지 못함 (모델이 지어냈거나 바꿔 쓴 인용일 수 있음)
 *  - "none": '보고자료' 근거가 아님
 * @param {any} result 모델 출력 JSON
 * @param {string} material 붙여넣은 보고 자료
 * @param {boolean} hasPdf PDF 첨부 여부
 */
export function verifyQuotes(result, material, hasPdf) {
  const haystack = norm(material);
  let ok = 0;
  let unverified = 0;
  for (const q of result.questions ?? []) {
    for (const sp of q.answer?.supporting_points ?? []) {
      if (sp.basis !== "보고자료") {
        sp.check = "none";
        continue;
      }
      const needle = norm(sp.quote ?? "");
      if (needle && haystack.includes(needle)) {
        sp.check = "ok";
        ok++;
      } else if (hasPdf) {
        sp.check = "pdf";
        unverified++;
      } else {
        sp.check = "missing";
        unverified++;
      }
    }
  }
  return { ok, unverified };
}

const CHECK_LABEL = {
  ok: "원문 확인됨",
  pdf: "PDF 인용 · 직접 확인 필요",
  missing: "⚠ 원문에서 찾지 못함 · 직접 확인 필요",
};

/**
 * @param {any} result
 * @param {{topic: string, meetingType: string, executives: string[]}} meta
 */
export function toMarkdown(result, meta) {
  const out = [];
  out.push(`# 임원 예상 질문: ${meta.topic}`);
  out.push("");
  out.push(`- 회의: ${meta.meetingType}`);
  out.push(`- 대상: ${meta.executives.join(", ")}`);
  out.push("");
  out.push("## 핵심 메시지");
  out.push(result.overview.core_message);
  out.push("");
  if (result.overview.weak_points.length) {
    out.push("## 공격받기 쉬운 지점");
    for (const w of result.overview.weak_points) out.push(`- ${w}`);
    out.push("");
  }
  result.questions.forEach((q, i) => {
    out.push(`## Q${i + 1}. ${q.question}`);
    out.push(`*${q.asker} · ${q.category} · 난이도 ${q.difficulty}*`);
    out.push("");
    out.push(`**의도:** ${q.intent}`);
    out.push("");
    out.push(`**답변:** ${q.answer.conclusion}`);
    for (const sp of q.answer.supporting_points) {
      let line = `- ${sp.point} _(${sp.basis})_`;
      if (sp.quote) line += `\n  > ${sp.quote}`;
      if (CHECK_LABEL[sp.check]) line += `\n  - ${CHECK_LABEL[sp.check]}`;
      out.push(line);
    }
    if (q.follow_ups.length) {
      out.push("");
      out.push("**꼬리 질문**");
      for (const f of q.follow_ups) out.push(`- ${f.question} → ${f.answer_hint}`);
    }
    if (q.prep.length) {
      out.push("");
      out.push("**준비할 자료**");
      for (const p of q.prep) out.push(`- [ ] ${p}`);
    }
    if (q.pitfalls) {
      out.push("");
      out.push(`**피할 답변:** ${q.pitfalls}`);
    }
    out.push("");
  });
  if (result.data_gaps.length) {
    out.push("## 확인이 필요한 정보");
    for (const g of result.data_gaps) out.push(`- [ ] **${g.item}**: ${g.why}`);
    out.push("");
  }
  out.push("---");
  out.push("AI가 만든 초안입니다. 숫자와 사실은 보고 전에 원문과 대조하세요.");
  return out.join("\n");
}
