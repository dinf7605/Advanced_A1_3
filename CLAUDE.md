# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트

**되새김 (Doesaegim) — 학습노트 요약·퀴즈 생성 웹 서비스** — 2026년 AI활용학습 A1-3 과제 (작성자: 김재민).

학습 노트를 붙여넣으면 **Claude가 3줄 요약 · 핵심 용어 3~5개 · 퀴즈 5문항으로 되돌려주는**
웹 서비스입니다. 프론트는 순수 HTML/CSS/JS, 백엔드는 Vercel Serverless Functions(Python).

**상세 명세는 [doesaegim_PRD.md](doesaegim_PRD.md)에 있습니다.** 스키마·오류 코드표·프롬프트 설계·
타임아웃 사다리·테스트 시나리오가 전부 거기 있으므로, 작업 전에 해당 절을 먼저 읽으십시오.

## 확정된 결정 (되돌리지 말 것)

| 항목 | 확정 | PRD |
|------|------|-----|
| AI API | **교육용 게이트웨이** `https://copa.codyssey.kr/v1/messages` — **`requests`로 직접 호출** (`anthropic` SDK 미사용) | §0, §1.3 |
| 모델 | `claude-sonnet-4` (env `CLAUDE_MODEL`로 교체, 대안 `claude-haiku-4`) | §0, §9.5 |
| 프론트 | **바닐라 HTML/CSS/JS.** 프레임워크·빌드 도구 없음 (과제 제약) | §0 |
| 페이지 구성 | **단일 `index.html` + 해시 라우팅 4개 섹션** (홈/되새김/내 기록/가이드·문의) | §3.3 |
| 백엔드 | **`api/*.py` 파일 기반 함수** — `class handler(BaseHTTPRequestHandler)` | §4.4, §7.5 |
| 응답 방식 | **비스트리밍.** 한 번에 JSON 반환 | §0 |
| JSON 강제 | **프롬프트 기반** + 코드블록 벗기기 + **파싱 실패 시 1회만** 재시도 (`output_config` 미사용) | §6.3, §6.4 |
| 요청 필드 | `model`·`max_tokens`·`system`·`messages` **넷만** | §6.3 |
| 보너스 | **A. 다크 모드 + 마이크로 인터랙션 / B. localStorage 기록 + 웹훅** 둘 다 | §10, §11 |
| 결과 저장 | localStorage(본문 포함) + 웹훅(요약 제목만, 동의 시) — **노트 원문은 외부로 보내지 않음** | §11.3 |

## 이 과제의 핵심 규칙

- **화면이 아무 말 없이 멈추는 경우는 0이어야 한다.** 로딩이 끝났는데 결과도 오류도 없는 상태가
  가장 나쁜 실패입니다. 모든 실패 경로는 PRD §8.4의 한국어 문구 중 하나로 끝나야 합니다.
- **`js/api.js`의 `callApi`는 절대 예외를 던지지 않는다.** 항상
  `{ok: true, data}` 또는 `{ok: false, code, message}`를 반환합니다. 이 계약 하나가
  실패 처리를 개인의 주의력이 아니라 구조로 보장합니다. (A2-1의 `llm.generate_json`과 같은 방식)
- **화면 문구는 서버의 `message`가 아니라 `code`로 고른다.** 서버 문구가 그대로 화면에 나가면
  영어·내부 용어가 새어 나옵니다. 문구는 `js/api.js`의 `MESSAGES` 한 군데에서만 관리합니다.
- **입력 검증은 프론트와 백엔드 양쪽에서 한다.** 프론트 검증은 UX, **백엔드 검증은 보안**입니다.
  프론트만 있으면 `curl`로 20만 자를 보낼 수 있고 그건 곧 쿼터 소진입니다. (PRD §6.1)
- **파싱 성공 ≠ 검증 성공.** `json.loads`가 통과해도 키·개수·타입을 따로 봅니다.
  `answer`가 `options` 안에 있는지, O/X 문항이 있는지는 **코드로 확인**합니다. (PRD §6.4)
- **재시도는 파싱 실패에만, 정확히 1회.** 의미 검증 실패는 재시도하지 않고
  `INVALID_AI_OUTPUT`으로 안내한 뒤 "다시 시도" 버튼을 사용자에게 맡깁니다.
  둘을 같이 재시도하면 응답 시간과 쿼터 소모가 2배가 됩니다.
- **결과 렌더링에 `innerHTML`을 쓰지 않는다.** 모델 출력에 `<script>`가 섞이면 그대로 실행됩니다.
  `document.createElement` + `textContent`만 씁니다.
- **입력을 조용히 자르지 않는다.** 4,000자를 넘으면 잘라서 보내지 말고 사용자에게 알립니다.
  자르면 뒷부분이 요약에서 빠진 이유를 사용자가 알 수 없습니다.
- **오류 메시지는 사용자가 할 수 있는 행동을 준다.** "타임아웃이 발생했습니다"(X) →
  "생각이 길어졌어요. 노트를 조금 줄이면 훨씬 빨라져요"(O).

## 교육용 API 규격 — 여기서 실패하기 쉽다

```python
requests.post(
    "https://copa.codyssey.kr/v1/messages",
    headers={"x-api-key": KEY, "anthropic-version": "2023-06-01"},
    json={"model": "claude-sonnet-4", "max_tokens": 4096,
          "system": SYSTEM_PROMPT,                       # ★ 최상위 필드 ★
          "messages": [{"role": "user", "content": user_prompt}]},
    timeout=25,
)
# 응답: data["content"][0]["text"]   (OpenAI의 choices[0].message.content 가 아니다)
```

A1-2·A2-1은 **Gemini SDK**를 썼습니다. 그 습관도, OpenAI 습관도 여기선 안 통합니다.

| 하면 안 되는 것 | 결과 |
|-----------------|------|
| `max_tokens` 생략 | **Anthropic 규격에서는 필수** → 400 |
| `messages`에 `{"role":"system"}` | 시스템 프롬프트는 **최상위 `system` 필드**다 |
| `Authorization: Bearer ...` | 인증은 **`x-api-key`** 헤더 |
| `anthropic-version` 생략·임의 변경 | `2023-06-01` 고정 |
| `temperature` / `thinking` / `output_config` | **규격에 없다.** 400이거나 조용히 무시된다 |
| `data["choices"][0]["message"]["content"]` | OpenAI 규격. 여기선 `data["content"][0]["text"]` |
| `data["content"][0]["text"]`로 바로 집기 | 타입을 확인하고 꺼낸다 — `next(b["text"] for b in ... if b["type"]=="text")` |
| `stop_reason` 확인 전에 `content` 읽기 | `"max_tokens"`면 JSON이 잘려 있고, `"refusal"`이면 텍스트가 없다 |
| **`js/`에서 `copa.codyssey.kr` 직접 호출** | **virtual key가 네트워크 탭에 노출된다.** 과정이 준 JS 예시를 그대로 옮기지 말 것 |

- **과정이 준 JavaScript(`fetch`) 예시는 API 모양 설명용입니다.** 우리 프론트의 `fetch`는
  `/api/summarize`(우리 서버)로 갑니다. 이 구분이 이 과제의 핵심입니다.
- 예외는 종류별로 잡습니다: `requests.exceptions.Timeout` / `RequestException` →
  그다음 `status_code`로 401·403 / 429 / 그 외 4xx·5xx를 나눕니다.
  `except Exception: pass`는 오타(NameError)까지 삼켜서 디버깅을 불가능하게 만듭니다.
- **`requests`는 자동 재시도를 하지 않습니다.** 재시도는 §6.4 3단계(파싱 실패)에서만 1회입니다.
  타임아웃·5xx는 재시도하지 않습니다 — 같은 이유로 또 실패하고 대기만 2배가 됩니다.
- **`usage`는 `.get()`으로 꺼냅니다.** 게이트웨이가 필드를 안 줄 수도 있습니다.
  `meta`에 담아 Vercel 로그에서 실제 소비량을 확인합니다.

## Vercel — 여기서 배포가 깨진다

| 규칙 | 이유 |
|------|------|
| 클래스 이름은 **소문자 `handler`** | `Handler`로 쓰면 인식되지 않아 404 |
| `requirements.txt`에 **`fastapi`/`flask`/`django` 금지** | 프레임워크 프리셋이 감지되면 `/api` 파일이 함수가 되지 않아 **전부 404** |
| `self.rfile.read(length)` — 인자 없이 부르지 말 것 | 요청이 끝날 때까지 블록됨 |
| `Content-Type: application/json; charset=utf-8` | `charset` 없으면 한글이 깨져 보일 수 있음 |
| `json.dumps(..., ensure_ascii=False)` | 빼면 한글이 `\uXXXX`로 나가 응답이 3배 커짐 |
| 파일명은 **전부 소문자·하이픈** | Vercel은 Linux라 대소문자를 구분한다. Windows에서만 되는 코드가 나온다 |
| `maxDuration`은 **`vercel.json`**에 | Python은 Node처럼 `export const maxDuration`이 통하지 않는다 |
| 환경 변수 저장 후 **반드시 재배포** | 저장만으로는 반영되지 않는다 |

**타임아웃 사다리 — 순서를 바꾸지 말 것 (PRD §8.3)**

```
requests.post(timeout=25)  × (파싱 실패 재호출 1회) ≈ 최악 50초
프론트 AbortController                                60초
Vercel maxDuration                                    70초
```

바깥쪽이 항상 더 길어야 합니다. 프론트가 먼저 끊으면 서버는 **아무도 안 받는 곳으로**
성공 응답을 보내고, 사용자는 실패로 보는데 **쿼터는 소모됩니다.**

## 보안 (필수 요건)

- API 키는 **`os.environ`으로만** 읽습니다. 코드·README·PRD·로그·스크린샷 어디에도 값이 없어야 합니다.
- **브라우저에서 Claude를 직접 호출하지 않습니다.** 브라우저로 내려간 것은 전부 사용자가 볼 수 있습니다.
  난독화해도 최종 번들에 문자열로 들어가면 끝입니다. `api/` 폴더는 **키를 숨길 수 있는 유일한 장소**입니다.
- **오류 응답에 예외 원문(`str(e)`)을 넣지 마십시오.** 요청 URL·헤더가 딸려 나옵니다.
  로그에는 `type(e).__name__`과 상태 코드만 남깁니다.
- `/api/health`는 **키의 존재 여부(boolean)만** 반환합니다. 앞 4글자도 금지 —
  그 순간 진단 도구가 유출 경로가 됩니다.
- `.gitignore`는 **`.env*`**로 적습니다. `.env`만 적으면 `.env.local`이 걸리지 않습니다.
- **키가 커밋되면 파일 수정으로 해결되지 않습니다.** ① 과정 담당자에게 알리고 virtual key 폐기·재발급
  → ② Vercel 환경 변수 교체 → ③ 재배포 → ④ 이력 정리 순서입니다.
  **폐기 없이 이력만 지우는 건 무의미합니다.**
- 점검 항목 전체는 PRD §9.4. **Day 6과 제출 직전 2회** 실행합니다.
- 유출 시 조치 순서와 **커밋 이력 정리 3안**은 PRD §9.5. 긴급 조치(①~③)를 먼저 끝내고
  이력 정리(④)는 그다음입니다.

## 쿼터

교육용 virtual key는 **과정에서 정한 한도** 안에서 동작합니다.
정확한 한도·과금 기준은 **과정 안내를 따릅니다** — 이 문서에 임의의 금액을 적지 마십시오.

우리가 통제할 수 있는 것은 **호출 1회의 크기**(입력 4,000자 상한)와 **호출 횟수**(프론트 쿨다운
10초 + 서버 IP 제한) 둘뿐입니다. 쿼터가 부족해지면 Vercel 환경 변수 `CLAUDE_MODEL`을
**`claude-haiku-4`**로 바꾸고 재배포합니다. 코드는 한 줄도 고치지 않습니다 —
모델을 상수가 아니라 환경 변수로 뺀 이유가 이것입니다 (PRD §9.5).

**실제 소비량은 매 응답의 `usage`로만 알 수 있습니다.** `meta.input_tokens` /
`output_tokens`를 응답에 담아 Vercel 로그에서 확인하십시오. 추정만 하고 넘어가면
마감 전날 한도에 걸립니다.

> 서버 측 IP 호출 제한은 **인스턴스 메모리 기반이라 완벽하지 않습니다.** 콜드 스타트마다
> 초기화되므로 "실수로 연타하는 사용자"는 막지만 "작정한 사람"은 못 막습니다.
> 제대로 하려면 외부 저장소가 필요한데 과제 범위 밖이라 **의도적으로 넣지 않았습니다.**
> 교육용 키에는 우리가 걸 수 있는 콘솔 한도도 없으므로, 배포 URL은 **동료 검증용으로만**
> 공유합니다. 이 한계를 없애려 하지 말고, 설명할 수 있게 두십시오.

## 실행

**전체 확인 (AI 기능 포함) — 배포 전 반드시 1회**

```bash
vercel dev
```

**화면만 (`/api`는 404)**

```bash
python -m http.server 8000
```

**목업 모드 — 키도 네트워크도 없이 결과·실패 화면 확인**

| URL | 결과 |
|-----|------|
| `?mock=1` | 정상 결과 (1.2초 지연 후) |
| `?mock=timeout` | 타임아웃 안내 화면 |
| `?mock=error` | API 오류 안내 화면 |

목업 모드로 **실패 화면 스크린샷을 인위적으로 만들 수 있습니다** (PRD §14.3의 08번).
A2-1의 `USE_MOCK`을 프론트로 옮긴 것입니다.

**환경 변수 내려받기**

```bash
vercel env pull .env.local
```

## 진단 — 증상별로 볼 곳이 정해져 있다

```
/api/... 가 404  → ① 파일명·경로 (api/summarize.py → /api/summarize)
                   ② requirements.txt에 프레임워크가 들어갔는가
                   ③ 클래스 이름이 소문자 handler 인가
/api/... 가 500  → /api/health 호출
                   has_api_key: false → 환경 변수 미설정 또는 재배포 누락
                   true인데 500      → Vercel Runtime Logs에서 예외 확인
로컬은 되는데 배포만 → 환경 변수 / 패키지 / 파일명 대소문자
CSS·JS가 옛날 것  → 강력 새로고침(Ctrl+Shift+R)
```

## 작업 관례 (A1-1~A2-1에서 이어짐)

- 모든 산출물(README, 커밋 메시지, 주석, 문구)은 **한국어**로 작성합니다.
- 커밋 메시지는 `type: 한국어 설명` — `feat`/`fix`/`docs`/`style`/`refactor`/`chore`/`deploy`.
  **이번 과제는 커밋 이력이 채점 요건입니다** (제출물 2번). Day별로 최소 1회 커밋합니다.
- README는 기능 표 + 스크린샷 + **"설계 결정 (왜 이렇게 만들었는가)"** 절로 구성합니다.
  대안을 표로 나열하고 각각의 문제점을 적은 뒤 채택안을 표시하는 형식입니다.
  기준선은 `../AI활용학습_A1_1/README.md`입니다.
- 스크린샷은 `docs/screenshots/NN_이름.png`로 번호를 붙입니다 (계획: PRD §14.3).
- **배포는 마지막이 아니라 Day 2에 끝냅니다.** 빈 껍데기라도 먼저 배포해 두면,
  이후 실패의 원인이 항상 "방금 내가 쓴 코드"로 좁혀집니다.

## 구조

- **`api/_shared.py`는 밑줄로 시작하므로 라우트가 되지 않습니다** (Vercel 문서 확인).
  다만 **`from _shared import ...` import가 되는지는 실제 배포로 확인해야 합니다.**
  Day 2에 가장 단순한 `api/health.py`에서 먼저 시도하고, 실패하면
  ① `sys.path.append(os.path.dirname(__file__))` → ② 그래도 안 되면 **세 파일을 자체 완결로
  되돌립니다** (중복 30줄이 배포 실패보다 낫습니다). 결과는 아래 "측정으로 확정된 것"에 기록합니다.
- **JS 파일 간 계약은 PRD §4.3에 있습니다.** 파일 하나를 고쳐도 나머지가 안 깨지도록
  노출 함수만 정해져 있습니다. 새 함수를 다른 파일에서 직접 부르지 말고 계약을 먼저 늘리십시오.
- **O/X 문항도 `options: ["O","X"]`를 갖습니다.** 스키마에 `oneOf`가 생기지 않고
  렌더링·채점 코드가 하나로 끝나기 때문입니다. `type`은 화면 배지 표시용입니다.
  **"O/X는 options가 필요 없다"며 정리하지 마십시오.**
- 테마 스크립트만 `<head>`에 인라인으로 둡니다. `js/theme.js`를 `</body>` 앞에서 로드하면
  화면이 그려진 뒤에 적용돼 **흰 화면이 한 번 번쩍입니다**(FOUC).
- 다크 모드 CSS의 `:root:not([data-theme="light"])` 가드를 빼지 마십시오.
  없으면 시스템이 다크인 사용자의 토글이 **한쪽 방향으로만** 작동합니다.
- `@media (prefers-reduced-motion: reduce)`에서 모든 애니메이션을 끕니다.

## 측정으로 확정된 것 (되돌리지 말 것)

> 아직 비어 있습니다. **실제로 호출·배포해 확인한 사실만** 여기에 적습니다.
> 추측은 적지 않습니다. 아래는 채워야 할 자리입니다.

**Day 1 — 교육용 게이트웨이 (§1.3). 여기가 가장 먼저 채워져야 합니다.**

- [ ] `claude-sonnet-4` 호출이 200을 반환하는가?
- [ ] `claude-haiku-4` 호출이 200을 반환하는가? (한쪽만 열려 있을 수 있다 → 열린 쪽을 기본값으로)
- [ ] **키를 틀렸을 때** 오는 상태 코드와 body 모양은? → PRD §7.4 매핑을 이 관찰로 확정
- [ ] 쿼터 초과 시 오는 상태 코드는? (429인가, 다른 코드인가)
- [ ] 응답에 `usage`가 실제로 들어오는가? 필드 이름은 `input_tokens`/`output_tokens`인가?
- [ ] `stop_reason` 필드가 오는가? 어떤 값들이 오는가?

**Day 2 — Vercel**

- [ ] `api/_shared.py` import가 배포에서 동작하는가? (되면 그대로, 안 되면 대안 기록)
- [ ] Vercel이 이 프로젝트를 `Other` 프리셋으로 잡는가? (`requirements.txt`에 `requests`만 있을 때)

**Day 4~5 — 실측치**

- [ ] 노트 4,000자 기준 실제 응답 시간. **25초 타임아웃이 충분한가?**
- [ ] 실제 `input_tokens` / `output_tokens` → PRD §9.5 표를 채운다
- [ ] JSON 파싱이 1차에서 실패하는 빈도 (10회 중 몇 회) — 재시도 1회로 충분한가?
- [ ] `answer not in options` 검증이 걸리는 빈도 (10회 중 몇 회)
- [ ] 코드블록(```` ```json ````)을 붙여 오는 빈도 — `strip_fence`가 실제로 필요한가?
- [ ] 콜드 스타트 시 첫 응답이 얼마나 느린가

**아래는 확인된 사실입니다 (2026-08-26). 추측이 아닙니다.**

교육용 게이트웨이 규격 (과정 제공):

- URL `https://copa.codyssey.kr/v1/messages`, 헤더 `x-api-key` + `anthropic-version: 2023-06-01`
- 요청 필수: `model`, `max_tokens`, `messages`. 시스템 프롬프트는 **최상위 `system` 필드**
- 응답: `data["content"][0]["text"]` + `usage` (OpenAI의 `choices[...]`가 아님)

Vercel 공식 문서:

- Vercel Python `/api`: 파일에 **`handler`**(BaseHTTPRequestHandler 하위) 또는 `app`/`application`을 정의.
  `api/summarize.py` → `/api/summarize`.
- `_`·`.`으로 시작하거나 `.d.ts`로 끝나는 파일은 **함수로 만들어지지 않는다.**
- **프레임워크 프리셋이 감지되면 `/api` 파일은 함수가 되지 않는다.**
- Python 버전: **3.12(기본)** / 3.13 / 3.14. `.python-version`으로 고정.
- Hobby 플랜 함수 최대 실행 시간: 기본 **300초**, 최대 300초 (Fluid compute 기본 활성).
- Python은 `maxDuration`을 **`vercel.json`의 `functions`**에서만 설정할 수 있다.

## 테스트

테스트 프레임워크는 없습니다. PRD §14.1의 **T1~T18을 직접 실행**해 확인합니다.
코드를 고쳤으면 최소한 아래 셋은 다시 돌리십시오.

| ID | 내용 | 왜 이것인가 |
|----|------|-------------|
| **T9** | 정상 노트 800자 → 요약 3 · 용어 3~5 · 퀴즈 5 | 과제 요건 "입력 → 결과 출력"의 증명 |
| **T13·T14** | `?mock=timeout` / `?mock=error` | 과제 요건 5의 실패 처리 증명. **서버 없이 확인 가능** |
| **T15** | 환경 변수를 **일부러 틀린 키로** 바꾸고 재배포 | "키가 틀렸을 때 사용자 화면"을 채점 당일 처음 보지 않기 위함 |

> T15 확인 후 **반드시 올바른 키로 되돌리고 재배포**하십시오.

서버 없이 확인 가능한 것: T1~T5(라우팅·다크모드), T6~T8(입력 검증), T12(기록 삭제), T13~T14(실패 화면).
