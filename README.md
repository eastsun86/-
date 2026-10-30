# 임원 예상 질문 생성기

보고 자료를 넣으면 임원이 던질 **예상 질문과 답변 초안**을 만들어 주는 웹앱입니다. Claude API(`claude-opus-5-5`)를 씁니다.

## 만들어 주는 것

- **핵심 메시지**와 **공격받기 쉬운 지점**
- 질문별: 예상 질문자(CEO·CFO 등), 분야, 난이도, 질문 의도
- **결론부터 쓴 답변 초안**과 근거
- **꼬리 질문**과 대응 요령, **준비할 자료**, **피해야 할 답변**
- 자료에 없어 **확인이 필요한 정보** 목록

## 틀린 정보를 막는 장치

- 숫자·사실은 보고 자료에 있는 것만 쓰도록 지시하고, 자료에 없으면 `확인 필요`로 표시합니다.
- 근거가 `보고자료`이면 원문을 그대로 인용하게 하고, **앱이 그 인용문이 실제 원문에 있는지 자동으로 대조**합니다.
  - ✓ 원문 확인됨 / ⚠ 원문에서 찾지 못함 / PDF 인용(자동 대조 불가)
- 그래도 AI 초안이므로, 보고 전에 숫자와 사실은 반드시 원문과 대조하세요.

## 사용법

1. [Anthropic Console](https://console.anthropic.com)에서 API 키를 발급받습니다.
2. `index.html`을 웹 서버로 엽니다. (파일을 바로 열면 모듈 로딩이 막히므로 서버가 필요합니다)
   ```bash
   python3 -m http.server 8000   # 또는 npm run serve
   # 브라우저에서 http://localhost:8000
   ```
   GitHub Pages 배포는 아래 "배포" 항목을 보세요.
3. API 키, 보고 주제, 회의 성격, 대상 임원, 보고 자료(붙여넣기 또는 PDF·TXT·MD 파일)를 넣고 **예상 질문 만들기**를 누릅니다.
4. 결과는 분야·난이도·질문자로 거르거나, **연습 모드**(답변 가리기)로 리허설할 수 있고, 마크다운 복사·`.md` 저장·인쇄(PDF)가 됩니다.

## 배포 (GitHub Pages)

`.github/workflows/pages.yml`이 이 브랜치에 푸시될 때마다 단위 테스트 후 `index.html`과 `src/`만 Pages에 배포합니다.

처음 한 번은 설정이 필요합니다.
1. 무료 플랜이면 레포를 **공개(Public)**로 바꿉니다. (Settings → General → Danger Zone → Change visibility) 무료 플랜의 Pages는 공개 레포에서만 됩니다.
2. **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 바꿉니다.
3. **Actions** 탭에서 "Deploy to GitHub Pages"를 다시 실행합니다(Re-run).

배포 주소: `https://eastsun86.github.io/-/`

Pages 사이트는 레포 공개 여부와 관계없이 누구나 접속할 수 있습니다. API 키는 사이트에 들어 있지 않고 각 사용자가 직접 입력하므로 사이트 공개 자체로 키가 노출되지는 않습니다.

## 보안·비용 참고

- API 키는 브라우저에서 `api.anthropic.com`으로만 직접 전송됩니다. "이 브라우저에 저장"을 켜면 localStorage에 남으니 공용 PC에서는 끄세요.
- 사용료는 입력한 키의 Anthropic 계정에 청구됩니다. 자료가 길거나 "정밀" 모드일수록 비용과 시간이 늘어납니다.
- 사내 기밀 자료를 넣기 전에 회사의 외부 AI 사용 정책을 확인하세요.
- 거절(refusal) 시 서버가 다른 모델로 이어서 처리하는 `fallbacks: "default"`가 켜져 있습니다. 대체 모델이 쓰이면 결과 화면에 표시됩니다.

## 개발

```bash
npm install
npm run typecheck   # SDK 타입으로 요청 형식 검사
npm test            # 단위 테스트 + 브라우저 E2E(Playwright, API는 모의 응답)
```

| 파일 | 역할 |
|---|---|
| `index.html` | 화면과 스타일 |
| `src/app.js` | 입력 처리, API 호출(스트리밍), 결과 렌더링 |
| `src/prompt.js` | 시스템 프롬프트, 출력 JSON 스키마, 요청 본문 |
| `src/result.js` | 인용 대조, 마크다운 변환 |
| `tests/` | 단위·E2E 테스트 |

SDK는 `@anthropic-ai/sdk@0.135.0`을 CDN(jsDelivr)에서 불러옵니다.
