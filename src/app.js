import Anthropic from "@anthropic-ai/sdk";
import { buildRequest, CATEGORIES, EXECUTIVES, MEETING_TYPES } from "./prompt.js";
import { toMarkdown, verifyQuotes } from "./result.js";

const $ = (id) => /** @type {any} */ (document.getElementById(id));
const KEY_STORE = "eqa.apiKey";
const LAST_STORE = "eqa.last";
const MAX_PDF_BYTES = 24 * 1024 * 1024; // 요청 한도(32MB)를 base64 증가분까지 고려해 넉넉히 제한

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 저장 불가 환경 무시 */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* 무시 */ } },
};

/** @type {{name: string, base64: string, size: number}[]} */
let pdfs = [];
/** @type {any} */
let current = null; // { result, meta }
/** @type {any} */
let activeStream = null;

// DOM 생성 도우미. 모델 출력은 항상 textContent로만 넣는다.
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}

// ---------- 초기화 ----------
for (const m of MEETING_TYPES) $("meeting").append(el("option", { value: m, text: m }));
EXECUTIVES.forEach((name, i) => {
  const input = el("input", { type: "checkbox", value: name, id: `exec-${i}` });
  if (name === "CEO" || name === "CFO") input.checked = true;
  $("execs").append(el("label", { class: "chip", for: `exec-${i}` }, input, el("span", { text: name })));
});

const savedKey = store.get(KEY_STORE);
if (savedKey) {
  $("api-key").value = savedKey;
  $("remember-key").checked = true;
} else {
  $("settings").open = true;
}
$("remember-key").addEventListener("change", () => {
  if ($("remember-key").checked) store.set(KEY_STORE, $("api-key").value.trim());
  else store.del(KEY_STORE);
});
$("api-key").addEventListener("input", () => {
  if ($("remember-key").checked) store.set(KEY_STORE, $("api-key").value.trim());
});

const updateCount = () => {
  const n = $("material").value.length;
  $("material-count").textContent = n ? `${n.toLocaleString()}자` : "";
};
$("material").addEventListener("input", updateCount);

// ---------- 파일 불러오기 ----------
$("file-btn").addEventListener("click", () => $("file").click());
$("file").addEventListener("change", async () => {
  for (const file of $("file").files) {
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (isPdf) {
      const total = pdfs.reduce((s, p) => s + p.size, 0) + file.size;
      if (total > MAX_PDF_BYTES) {
        showMessage("error", `PDF는 합계 ${MAX_PDF_BYTES / 1024 / 1024}MB까지 첨부할 수 있습니다. (${file.name} 제외)`);
        continue;
      }
      pdfs.push({ name: file.name, base64: await toBase64(file), size: file.size });
    } else {
      const text = await file.text();
      const ta = $("material");
      ta.value = (ta.value.trim() ? ta.value.trimEnd() + "\n\n" : "") + text;
      updateCount();
    }
  }
  $("file").value = "";
  renderFiles();
});

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function renderFiles() {
  const list = $("file-list");
  list.replaceChildren();
  pdfs.forEach((p, i) => {
    const rm = el("button", { type: "button", "aria-label": `${p.name} 제거`, text: "✕" });
    rm.addEventListener("click", () => { pdfs.splice(i, 1); renderFiles(); });
    list.append(el("span", { class: "file-tag" }, `📄 ${p.name}`, rm));
  });
}

// ---------- 생성 ----------
function showMessage(kind, text) {
  $("message").replaceChildren(text ? el("div", { class: `notice ${kind}`, text }) : "");
}

function setBusy(busy, text = "") {
  $("go").disabled = busy;
  $("status").hidden = !busy;
  $("status-text").textContent = text;
}

$("cancel").addEventListener("click", () => activeStream?.abort());

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  showMessage("", "");
  const apiKey = $("api-key").value.trim();
  const topic = $("topic").value.trim();
  if (!apiKey) {
    $("settings").open = true;
    $("api-key").focus();
    return showMessage("error", "Claude API 키를 먼저 입력해 주세요.");
  }
  if (!topic) {
    $("topic").focus();
    return showMessage("error", "보고 주제를 입력해 주세요.");
  }

  const input = {
    topic,
    material: $("material").value,
    pdfs: pdfs.map(({ name, base64 }) => ({ name, base64 })),
    executives: [...document.querySelectorAll("#execs input:checked")].map((x) => /** @type {HTMLInputElement} */ (x).value),
    meetingType: $("meeting").value,
    count: Number($("count").value),
    extra: $("extra").value,
  };
  if (!input.executives.length) input.executives = ["CEO"];

  const started = Date.now();
  setBusy(true, "자료를 분석하고 있습니다…");
  const tick = setInterval(() => {
    const sec = Math.round((Date.now() - started) / 1000);
    const base = $("status-text").dataset.chars
      ? `답변 작성 중… ${$("status-text").dataset.chars}자`
      : "자료를 분석하고 있습니다…";
    $("status-text").textContent = `${base} (${sec}초)`;
  }, 1000);

  try {
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    activeStream = client.beta.messages.stream(buildRequest(input, $("effort").value));
    activeStream.on("text", (_delta, snapshot) => {
      $("status-text").dataset.chars = snapshot.length.toLocaleString();
    });
    const message = await activeStream.finalMessage();

    if (message.stop_reason === "refusal") {
      throw new UserFacingError("요청이 안전 정책에 의해 처리되지 않았습니다. 자료 내용을 확인하고 다시 시도해 주세요.");
    }
    if (message.stop_reason === "max_tokens") {
      throw new UserFacingError("답변이 너무 길어 중간에 끊겼습니다. 질문 개수를 줄여 다시 시도해 주세요.");
    }
    const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      throw new UserFacingError("응답을 해석하지 못했습니다. 다시 시도해 주세요.");
    }
    const fallback = message.content.find((b) => b.type === "fallback");
    const meta = {
      topic: input.topic,
      meetingType: input.meetingType,
      executives: input.executives,
      material: input.material,
      hasPdf: input.pdfs.length > 0,
      fallbackModel: fallback ? fallback.to.model : null,
      createdAt: new Date().toISOString(),
    };
    current = { result, meta };
    store.set(LAST_STORE, JSON.stringify(current));
    showResult();
    $("result-section").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    showMessage("error", describeError(err));
  } finally {
    clearInterval(tick);
    delete $("status-text").dataset.chars;
    activeStream = null;
    setBusy(false);
  }
});

class UserFacingError extends Error {}

function describeError(err) {
  if (err instanceof UserFacingError) return err.message;
  if (err instanceof Anthropic.APIUserAbortError) return "생성을 중단했습니다.";
  if (err instanceof Anthropic.AuthenticationError) return "API 키가 올바르지 않습니다. 키를 다시 확인해 주세요.";
  if (err instanceof Anthropic.PermissionDeniedError) return "이 API 키로는 해당 모델을 사용할 권한이 없습니다.";
  if (err instanceof Anthropic.RateLimitError) return "요청이 많아 잠시 제한되었습니다. 잠시 후 다시 시도해 주세요.";
  if (err instanceof Anthropic.BadRequestError) return `요청 오류: ${err.message}`;
  if (err instanceof Anthropic.InternalServerError) return "Anthropic 서버 오류입니다. 잠시 후 다시 시도해 주세요.";
  if (err instanceof Anthropic.APIConnectionError) return "네트워크 연결에 실패했습니다. 인터넷 연결을 확인해 주세요.";
  if (err instanceof Anthropic.APIError) return `API 오류 (${err.status ?? "?"}): ${err.message}`;
  console.error(err);
  return `알 수 없는 오류: ${err?.message ?? err}`;
}

// ---------- 결과 표시 ----------
function showResult() {
  const { result, meta } = current;
  const { unverified } = verifyQuotes(result, meta.material ?? "", meta.hasPdf);
  $("result-section").hidden = false;

  const notes = [];
  if (unverified) {
    notes.push(el("div", { class: "notice warn", text: `원문에서 자동 확인되지 않은 인용이 ${unverified}건 있습니다. 노란 표시 항목은 직접 대조해 주세요.` }));
  }
  if (meta.fallbackModel) {
    notes.push(el("div", { class: "notice info", text: `일부 답변은 대체 모델(${meta.fallbackModel})이 이어서 작성했습니다.` }));
  }
  $("verify-note").replaceChildren(...notes);

  const ov = result.overview;
  $("overview").replaceChildren(
    el("h2", { text: "핵심 메시지" }),
    el("p", { text: ov.core_message }),
    ov.weak_points.length ? el("div", { class: "sub", text: "공격받기 쉬운 지점" }) : null,
    ov.weak_points.length ? el("ul", {}, ...ov.weak_points.map((w) => el("li", { text: w }))) : null,
  );

  const cats = CATEGORIES.filter((c) => result.questions.some((q) => q.category === c));
  $("f-cat").replaceChildren(el("option", { value: "", text: "분야 전체" }), ...cats.map((c) => el("option", { value: c, text: c })));
  const askers = [...new Set(result.questions.map((q) => q.asker))];
  $("f-asker").replaceChildren(el("option", { value: "", text: "질문자 전체" }), ...askers.map((a) => el("option", { value: a, text: a })));

  $("gaps").hidden = !result.data_gaps.length;
  $("gaps").replaceChildren(
    el("h2", { text: "확인이 필요한 정보" }),
    el("ul", {}, ...result.data_gaps.map((g) => el("li", {}, el("strong", { text: g.item }), ` — ${g.why}`))),
  );
  renderQuestions();
}

const CHECK_TEXT = {
  ok: "✓ 원문 확인됨",
  pdf: "PDF 인용 · 직접 확인 필요",
  missing: "⚠ 원문에서 찾지 못함 · 직접 확인 필요",
};

function renderQuestions() {
  const { result } = current;
  const fc = $("f-cat").value, fd = $("f-diff").value, fa = $("f-asker").value;
  const practice = $("practice").checked;
  const box = $("questions");
  box.replaceChildren();

  result.questions.forEach((q, i) => {
    if ((fc && q.category !== fc) || (fd && q.difficulty !== fd) || (fa && q.asker !== fa)) return;

    const points = el("ul", { class: "points" }, ...q.answer.supporting_points.map((sp) => {
      const basisKey = sp.basis.split(" ")[0];
      return el("li", {},
        sp.point,
        el("span", { class: `basis b-${basisKey}`, text: `· ${sp.basis}` }),
        sp.quote ? el("blockquote", { text: sp.quote }) : null,
        CHECK_TEXT[sp.check] ? el("span", { class: `check ${sp.check}`, text: CHECK_TEXT[sp.check] }) : null,
      );
    }));

    const answer = el("div", { class: "answer" },
      el("p", { class: "conclusion", text: q.answer.conclusion }),
      points,
      q.follow_ups.length ? el("div", { class: "sub", text: "꼬리 질문" }) : null,
      q.follow_ups.length ? el("ul", {}, ...q.follow_ups.map((f) => el("li", {}, el("strong", { text: f.question }), el("br"), `→ ${f.answer_hint}`))) : null,
      q.prep.length ? el("div", { class: "sub", text: "준비할 자료" }) : null,
      q.prep.length ? el("ul", {}, ...q.prep.map((p) => el("li", { text: p }))) : null,
      q.pitfalls ? el("p", { class: "pitfall", text: `피할 답변: ${q.pitfalls}` }) : null,
    );

    const details = el("details", {}, el("summary", { text: practice ? "답변 보기" : "답변 접기/펼치기" }), answer);
    details.open = !practice;

    box.append(el("article", { class: "q" },
      el("div", { class: "q-meta" },
        el("span", { class: "badge", text: `Q${i + 1}` }),
        el("span", { class: `badge d-${q.difficulty}`, text: `난이도 ${q.difficulty}` }),
        el("span", { class: "badge", text: q.category }),
        el("span", { class: "badge", text: q.asker }),
      ),
      el("p", { class: "q-text", text: q.question }),
      practice ? null : el("p", { class: "q-intent", text: `의도: ${q.intent}` }),
      details,
    ));
  });
  if (!box.children.length) box.append(el("p", { class: "empty", text: "조건에 맞는 질문이 없습니다." }));
}

for (const id of ["f-cat", "f-diff", "f-asker", "practice"]) $(id).addEventListener("change", renderQuestions);

// ---------- 내보내기 ----------
$("copy-md").addEventListener("click", async () => {
  const btn = $("copy-md");
  try {
    await navigator.clipboard.writeText(toMarkdown(current.result, current.meta));
    btn.textContent = "복사됨 ✓";
  } catch {
    btn.textContent = "복사 실패";
  }
  setTimeout(() => (btn.textContent = "마크다운 복사"), 1500);
});

$("save-md").addEventListener("click", () => {
  const blob = new Blob([toMarkdown(current.result, current.meta)], { type: "text/markdown;charset=utf-8" });
  // 일부 브라우저는 한글 파일명을 무시하므로 ASCII 이름을 쓴다.
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  const a = el("a", { href: URL.createObjectURL(blob), download: `executive-qa-${stamp}.md` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$("print").addEventListener("click", () => {
  for (const d of document.querySelectorAll("#questions details")) /** @type {HTMLDetailsElement} */ (d).open = true;
  window.print();
});

// ---------- 지난 결과 복원 ----------
try {
  const last = JSON.parse(store.get(LAST_STORE) ?? "null");
  if (last?.result?.questions) {
    current = last;
    $("topic").value = last.meta.topic;
    showResult();
  }
} catch { /* 손상된 저장값 무시 */ }
