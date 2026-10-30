// 브라우저 E2E: 실제 페이지를 띄우고 Anthropic API 응답만 모의(SSE)로 대체한다.
// 실행: node tests/e2e.mjs  (Playwright와 Chromium이 설치된 환경)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { SAMPLE_RESULT, SAMPLE_MATERIAL } from "./fixture.js";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("..", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

const server = createServer(async (req, res) => {
  const path = normalize(join(root, decodeURIComponent(new URL(req.url, "http://x").pathname)));
  if (!path.startsWith(root)) return res.writeHead(403).end();
  try {
    const file = path.endsWith("/") ? join(path, "index.html") : path;
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

function sse(resultJson) {
  const text = JSON.stringify(resultJson);
  const chunks = text.match(/[\s\S]{1,200}/g);
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  return [
    ev("message_start", { message: { id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } }),
    ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
    ...chunks.map((c) => ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: c } })),
    ev("content_block_stop", { index: 0 }),
    ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 100 } }),
    ev("message_stop", {}),
  ].join("");
}

const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
const browser = await chromium.launch({ proxy: proxy && { ...proxy, bypass: "localhost" } });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

let captured = null;
let mode = "ok";
await page.route("https://api.anthropic.com/**", async (route) => {
  const req = route.request();
  if (req.method() === "OPTIONS") {
    return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST" } });
  }
  captured = { url: req.url(), headers: req.headers(), body: JSON.parse(req.postData()) };
  const cors = { "access-control-allow-origin": "*" };
  if (mode === "401") {
    return route.fulfill({ status: 401, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }) });
  }
  return route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: sse(SAMPLE_RESULT) });
});

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll("#execs input").length > 0, null, { timeout: 30000 });

  // 1) 키 없이 제출 → 안내
  await page.fill("#topic", "동남아 물류센터 투자");
  await page.click("#go");
  assert.match(await page.textContent("#message"), /API 키를 먼저/);

  // 2) 정상 생성
  await page.fill("#api-key", "sk-ant-test");
  await page.fill("#material", SAMPLE_MATERIAL);
  await page.selectOption("#count", "5");
  await page.click("#go");
  await page.waitForSelector("#result-section:not([hidden]) .q", { timeout: 30000 });

  assert.equal(captured.url, "https://api.anthropic.com/v1/messages?beta=true");
  assert.equal(captured.headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.match(captured.headers["anthropic-beta"], /server-side-fallback-2026-07-01/);
  assert.equal(captured.headers["x-api-key"], "sk-ant-test");
  assert.equal(captured.body.model, "claude-opus-5-5");
  assert.equal(captured.body.fallbacks, "default");
  assert.equal(captured.body.stream, true);
  assert.equal(captured.body.output_config.format.type, "json_schema");
  assert.ok(!("betas" in captured.body), "betas는 헤더로만 전송");
  assert.match(captured.body.messages[0].content.at(-1).text, /5개/);

  assert.equal(await page.locator(".q").count(), 2);
  assert.match(await page.textContent("#overview"), /1,200억/);
  assert.equal(await page.locator(".check.ok").count(), 1);
  assert.equal(await page.locator(".check.missing").count(), 1);
  assert.match(await page.textContent("#verify-note"), /1건/);
  assert.match(await page.textContent("#gaps"), /현지 인허가 일정/);

  // 3) 필터·연습 모드
  await page.selectOption("#f-asker", "CEO");
  assert.equal(await page.locator(".q").count(), 1);
  await page.selectOption("#f-asker", "");
  await page.check("#practice");
  assert.equal(await page.locator(".q details[open]").count(), 0);
  assert.equal(await page.locator(".q-intent").count(), 0);
  await page.uncheck("#practice");

  // 4) 마크다운 저장
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#save-md")]);
  assert.match(dl.suggestedFilename(), /^executive-qa-\d{8}-\d{4}\.md$/);

  // 5) 모바일 폭에서 가로 스크롤 없음
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `horizontal overflow ${overflow}px`);
  await page.screenshot({ path: join(root, "test-results", "result-mobile.png"), fullPage: true });

  // 6) 새로고침 시 지난 결과 복원
  await page.reload();
  await page.waitForSelector("#result-section:not([hidden]) .q", { timeout: 30000 });

  // 7) 잘못된 키 → 오류 문구
  // 키를 저장하지 않았으므로 새로고침 후 비어 있어야 한다
  assert.equal(await page.inputValue("#api-key"), "");
  await page.fill("#api-key", "sk-ant-wrong");
  mode = "401";
  await page.click("#go");
  await page.waitForFunction(() => /API 키가 올바르지/.test(document.querySelector("#message").textContent), null, { timeout: 30000 });

  assert.deepEqual(errors, []);
  console.log("E2E OK");
} finally {
  await browser.close();
  server.close();
}
