import { test } from "node:test";
import assert from "node:assert/strict";
import { OUTPUT_SCHEMA, buildRequest, buildUserContent } from "../src/prompt.js";
import { toMarkdown, verifyQuotes } from "../src/result.js";
import { SAMPLE_RESULT, SAMPLE_MATERIAL } from "./fixture.js";

// 구조화 출력이 지원하지 않는 키워드 (shared docs: JSON Schema Limitations)
const UNSUPPORTED = ["minimum", "maximum", "multipleOf", "minLength", "maxLength", "minItems", "maxItems"];

function walk(node, path, visit) {
  visit(node, path);
  if (node.properties) for (const [k, v] of Object.entries(node.properties)) walk(v, `${path}.${k}`, visit);
  if (node.items) walk(node.items, `${path}[]`, visit);
}

test("스키마: 모든 object는 additionalProperties:false이고 모든 키가 required", () => {
  walk(OUTPUT_SCHEMA, "$", (n, p) => {
    if (n.type === "object") {
      assert.equal(n.additionalProperties, false, p);
      assert.deepEqual([...n.required].sort(), Object.keys(n.properties).sort(), p);
    }
    for (const kw of UNSUPPORTED) assert.ok(!(kw in n), `${p} uses ${kw}`);
  });
});

test("스키마: 샘플 결과가 스키마 구조와 일치", () => {
  const check = (schema, value, p) => {
    if (schema.enum) assert.ok(schema.enum.includes(value), `${p}=${value}`);
    if (schema.type === "string") assert.equal(typeof value, "string", p);
    if (schema.type === "array") {
      assert.ok(Array.isArray(value), p);
      value.forEach((v, i) => check(schema.items, v, `${p}[${i}]`));
    }
    if (schema.type === "object") {
      assert.deepEqual(Object.keys(value).sort(), Object.keys(schema.properties).sort(), p);
      for (const k of Object.keys(schema.properties)) check(schema.properties[k], value[k], `${p}.${k}`);
    }
  };
  check(OUTPUT_SCHEMA, SAMPLE_RESULT, "$");
});

const baseInput = {
  topic: "테스트 주제",
  material: "본문",
  pdfs: [],
  executives: ["CEO", "CFO"],
  meetingType: "예산 심의",
  count: 5,
  extra: "",
};

test("요청: 모델·폴백·구조화 출력 설정", () => {
  const req = buildRequest(baseInput, "high");
  assert.equal(req.model, "claude-opus-5-5");
  assert.equal(req.fallbacks, "default");
  assert.deepEqual(req.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(req.output_config.effort, "high");
  assert.equal(req.output_config.format.type, "json_schema");
  assert.ok(!("thinking" in req), "Opus 5.5는 thinking을 생략");
  assert.ok(!("temperature" in req));
});

test("사용자 메시지: PDF가 텍스트보다 앞, 자료·임원·개수 포함", () => {
  const blocks = buildUserContent({ ...baseInput, pdfs: [{ name: "a.pdf", base64: "QUJD" }] });
  assert.equal(blocks[0].type, "document");
  assert.equal(blocks.at(-1).type, "text");
  const text = blocks.at(-1).text;
  assert.match(text, /CEO, CFO/);
  assert.match(text, /5개/);
  assert.match(text, /<보고_자료>\n본문\n<\/보고_자료>/);
});

test("사용자 메시지: 자료가 없으면 '확인 필요' 지시", () => {
  const [only] = buildUserContent({ ...baseInput, material: "  " });
  assert.match(only.text, /보고 자료가 첨부되지 않았습니다/);
});

test("인용 검증: 원문에 있으면 ok, 없으면 missing, PDF면 pdf", () => {
  const r = structuredClone(SAMPLE_RESULT);
  const res = verifyQuotes(r, SAMPLE_MATERIAL, false);
  const pts = r.questions.flatMap((q) => q.answer.supporting_points);
  assert.equal(pts[0].check, "ok"); // 띄어쓰기·줄바꿈 차이는 허용
  assert.equal(pts[1].check, "missing"); // 원문에 없는 수치
  assert.equal(pts[2].check, "none");
  assert.deepEqual(res, { ok: 1, unverified: 1 });

  const r2 = structuredClone(SAMPLE_RESULT);
  verifyQuotes(r2, SAMPLE_MATERIAL, true);
  assert.equal(r2.questions[0].answer.supporting_points[1].check, "pdf");
});

test("마크다운: 주요 섹션과 검증 표시 포함", () => {
  const r = structuredClone(SAMPLE_RESULT);
  verifyQuotes(r, SAMPLE_MATERIAL, false);
  const md = toMarkdown(r, { topic: "물류센터", meetingType: "예산 심의", executives: ["CFO"] });
  for (const s of ["# 임원 예상 질문: 물류센터", "## Q1.", "**답변:**", "원문에서 찾지 못함", "## 확인이 필요한 정보", "- [ ] "]) {
    assert.ok(md.includes(s), s);
  }
});
