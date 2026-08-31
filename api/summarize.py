"""POST /api/summarize — 학습 노트를 요약·용어·퀴즈로 변환한다. (PRD §6, §7.1)

계약:
    성공 → 200 {"ok": true, "data": {...}, "meta": {...}}
    실패 → 4xx/5xx {"ok": false, "code": "...", "message": "..."}
    ★ 어떤 경우에도 HTML 오류 페이지나 예외 원문을 내보내지 않는다 ★

호출 형태는 교육용 게이트웨이 규격(PRD §1.3)을 그대로 따릅니다.
"""

import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _shared import client_ip, fail, json_response, rate_limited, read_json_body  # noqa: E402

# ★ .get(키, 기본값) 이 아니라 .get(키) or 기본값 ★
#   Vercel 대시보드에서 변수 이름만 만들고 값을 비워 두면 키가 "존재하되 빈 문자열"이 된다.
#   .get(키, 기본값) 은 키가 "없을 때만" 기본값을 쓰므로 "" 가 그대로 흘러 들어간다.
#   실제로 배포 후 model="" 로 나가 호출이 즉시 실패했다. (2026-08-26)
API_URL = os.environ.get("COPA_API_URL") or "https://copa.codyssey.kr/v1/messages"
MODEL = os.environ.get("CLAUDE_MODEL") or "claude-haiku-4"
MIN_LEN, MAX_LEN = 100, 4000
TIMEOUT = 40  # 초 (PRD §8.3 타임아웃 사다리: 40×2 < 90(프론트) < 100(Vercel))
#  실측(3,950자): claude-haiku-4 10.5초 / claude-sonnet-4 19~24초.
#  sonnet 은 편차가 커서 25초로는 부족했다 — 실측으로 40초까지 올렸다.
MAX_TOKENS = 4096

CATEGORIES = ("일반", "IT", "경영", "과학", "어학")
LEVELS = ("쉬움", "보통", "어려움")

# 과목·난이도는 "이름만" 넘기면 모델이 아무것도 다르게 하지 않는다.
# 실측(2026-08-31): 같은 노트로 일반/IT/어학을 돌렸더니 주제·용어·문항이 사실상 동일했다.
# → 라벨이 아니라 **무엇을 다르게 할지 지시**를 넘긴다.
CATEGORY_HINT = {
    "일반": "일상적인 말로 풀어 쓴다. 배경지식 없이 노트만 읽고도 풀 수 있는 문항을 낸다.",
    "IT": "기술 용어는 원어를 함께 적는다(예: 메서드(method)). "
          "동작 순서와 원인·결과를 묻는 문항을 우선한다.",
    "경영": "정의보다 '어떤 상황에 쓰는가'를 묻는다. "
            "노트의 개념을 구체적인 사례에 적용하는 문항을 우선한다.",
    "과학": "원리와 인과 관계를 묻는다. "
            "조건이 바뀌면 결과가 어떻게 되는지 묻는 문항을 하나 이상 넣는다.",
    "어학": "표현의 쓰임과 뜻 구분에 집중한다. "
            "노트에 나온 표현을 그대로 활용해 용법을 묻는 문항을 우선한다.",
}

LEVEL_HINT = {
    "쉬움": "노트에 그대로 적힌 사실을 확인하는 수준. 용어와 정의를 묻는다.",
    "보통": "개념을 이해했는지 확인하는 수준. 두 개념의 차이나 '왜 그런가'를 묻는다.",
    "어려움": "적용·비교 수준. 노트의 개념을 새로운 상황에 적용하거나 "
              "여러 개념을 연결해야 풀리는 문항을 넣는다.",
}

# ── 프롬프트 (PRD §6.2, §6.3) ────────────────────────────────────
# ★ 예시 JSON 블록을 넣지 않는다 ★ — A1-2 실측: 예시를 넣으면 모델이 예시를 먼저
#   출력하고 진짜 답을 이어 붙여 JSON 객체가 두 개가 된다.
SYSTEM_PROMPT = """너는 한국 학습자를 돕는 학습 코치다. 사용자가 준 학습 노트만을 근거로
요약·핵심 용어·확인 퀴즈를 만든다.

규칙
1. 노트에 없는 사실을 추가하지 않는다. 노트에서 확인할 수 없으면 만들지 않는다.
2. 요약은 정확히 3개이며, 각 항목은 한 문장(공백 포함 80자 이내)이다.
3. 핵심 용어는 3~5개다. 노트에 실제로 등장한 표현만 쓴다.
4. 퀴즈는 정확히 5문항이고, O/X 2문항 + 객관식 3문항이다.
5. 객관식 오답은 노트의 다른 내용에서 가져와 그럴듯하게 만든다.
   "위 보기 모두" 같은 회피형 보기를 쓰지 않는다.
6. 해설은 왜 그 답인지 노트의 근거를 들어 한두 문장으로 쓴다.
7. 모든 출력은 한국어다.
8. 요청에 적힌 과목 지시와 난이도 지시를 문항 설계에 실제로 반영한다.
   과목 지시는 '무엇을 묻느냐'를, 난이도 지시는 '얼마나 깊이 묻느냐'를 정한다.

출력 형식
반드시 아래 키를 가진 JSON 객체 하나만 출력한다.
코드블록 표시, 설명, 인사말을 앞뒤에 붙이지 않는다.
  topic     : 문자열 (노트의 주제 한 줄)
  summary   : 문자열 3개 배열
  keywords  : {term, meaning} 객체 3~5개 배열
  quizzes   : {type, question, options, answer, explanation} 객체 5개 배열
              type 은 "ox" 또는 "choice"
              O/X 문항도 options 는 ["O", "X"] 로 채운다
              answer 는 반드시 options 안의 값과 정확히 같아야 한다"""


def build_user_prompt(note: str, category: str, level: str) -> str:
    return (
        f"과목: {category}\n"
        f"  → {CATEGORY_HINT[category]}\n"
        f"난이도: {level}\n"
        f"  → {LEVEL_HINT[level]}\n\n"
        "--- 학습 노트 시작 ---\n"
        f"{note}\n"
        "--- 학습 노트 끝 ---"
    )


# ── 게이트웨이 호출 (PRD §1.3 규격) ──────────────────────────────
def call_claude(user_prompt: str) -> tuple[dict | None, str | None]:
    """성공 → (응답 JSON, None) / 실패 → (None, 오류코드)

    ★ 예외를 호출자에게 던지지 않는다 ★
    이 계약 하나가 실패 처리를 개인의 주의력이 아니라 구조로 보장한다.
    """
    try:
        r = requests.post(
            API_URL,
            headers={
                "x-api-key": os.environ["ANTHROPIC_API_KEY"],  # ★ 코드에 값을 쓰지 않는다 ★
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": MODEL,
                "max_tokens": MAX_TOKENS,          # 규격상 필수
                "system": SYSTEM_PROMPT,           # ★ messages 가 아니라 최상위 필드 ★
                "messages": [{"role": "user", "content": user_prompt}],
                # ❌ temperature / thinking / output_config 는 규격에 없다 (PRD §6.3)
            },
            timeout=(5, TIMEOUT),                  # (연결 5초, 읽기 40초)
        )
    except requests.exceptions.Timeout:
        return None, "UPSTREAM_TIMEOUT"
    except (requests.exceptions.MissingSchema,
            requests.exceptions.InvalidURL,
            requests.exceptions.InvalidSchema):
        # 네트워크 문제가 아니라 "설정이 틀렸다". 0.3초 만에 실패하는데
        # UPSTREAM_TIMEOUT 으로 뭉뚱그리면 로그를 봐도 원인을 알 수 없다.
        print("[summarize] COPA_API_URL 이 비었거나 형식이 잘못됐다 — 환경 변수 확인")
        return None, "BAD_CONFIG"
    except requests.exceptions.RequestException:
        return None, "UPSTREAM_TIMEOUT"            # 연결 실패도 사용자에겐 같은 안내

    # 상태 코드 분기 — 로그에 코드만 남긴다 (응답 body를 통째로 찍지 않는다)
    if r.status_code in (401, 403):
        print("[summarize] 인증 실패 — Vercel 환경 변수의 virtual key 를 확인하십시오")
        return None, "UPSTREAM_AUTH"
    if r.status_code == 429:
        print("[summarize] 429 — 쿼터 또는 호출 빈도 초과")
        return None, "UPSTREAM_RATE_LIMITED"
    if r.status_code >= 400:
        print(f"[summarize] 게이트웨이 오류 status={r.status_code}")
        return None, "UPSTREAM_ERROR"

    try:
        return r.json(), None
    except ValueError:
        # 200 인데 JSON 이 아님 (프록시 오류 페이지 등)
        print("[summarize] 200 이지만 JSON 이 아님")
        return None, "UPSTREAM_ERROR"


# ── 응답 처리 (PRD §6.4 1~2단계) ─────────────────────────────────
def strip_fence(s: str) -> str:
    """```json ... ``` 껍데기를 벗긴다. 지시는 요청이지 보장이 아니다."""
    s = s.strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[-1]      # 첫 줄(```json)을 버린다
        s = s.rsplit("```", 1)[0]     # 마지막 ```를 버린다
    return s.strip()


def extract_text(payload: dict) -> str | None:
    """응답 껍데기에서 텍스트를 꺼낸다.

    [0] 으로 바로 집지 않는 이유: 블록 배열의 첫 원소가 항상 텍스트라는 보장이 없다.
    타입을 확인하고 꺼내면 조용한 KeyError 가 사라진다.
    """
    text = next(
        (b.get("text") for b in payload.get("content", []) if b.get("type") == "text"),
        None,
    )
    return strip_fence(text) if text else None


# ── 의미 검증 (PRD §6.4 4단계) — 파싱 성공 ≠ 검증 성공 ───────────
def validate(data) -> str | None:
    """문제가 있으면 사유 문자열, 없으면 None."""
    if not isinstance(data, dict):
        return "최상위가 객체가 아님"
    for key in ("topic", "summary", "keywords", "quizzes"):
        if key not in data:
            return f"필수 키 없음: {key}"
    if not isinstance(data["summary"], list) or len(data["summary"]) != 3:
        return "요약이 3개가 아님"
    if not isinstance(data["keywords"], list) or not (3 <= len(data["keywords"]) <= 5):
        return "용어 개수 범위 밖"
    for kw in data["keywords"]:
        if not isinstance(kw, dict) or "term" not in kw or "meaning" not in kw:
            return "용어 항목 형식 오류"
    if not isinstance(data["quizzes"], list) or len(data["quizzes"]) != 5:
        return "퀴즈가 5개가 아님"
    if not any(q.get("type") == "ox" for q in data["quizzes"]):
        return "ox 문항 없음"
    for q in data["quizzes"]:
        options = q.get("options")
        if not isinstance(options, list) or len(options) < 2:
            return "보기 형식 오류"
        if q.get("answer") not in options:      # ← 가장 자주 깨지는 곳
            return "정답이 보기 안에 없음"
        if len(set(options)) != len(options):
            return "보기 중복"
        if not q.get("question") or not q.get("explanation"):
            return "문항 또는 해설 비어 있음"
    return None


class handler(BaseHTTPRequestHandler):  # ★ 소문자 handler ★

    def do_GET(self):
        fail(self, "METHOD_NOT_ALLOWED")

    def do_POST(self):
        started = time.time()

        # 1) body 읽기
        payload = read_json_body(self)
        if payload is None:
            return fail(self, "BAD_JSON_BODY")

        # 2) 입력 검증 (PRD §6.1) — 프론트를 신뢰하지 않는다.
        #    프론트 검증은 UX, 백엔드 검증은 보안이다.
        note = (payload.get("note") or "").strip()
        if not note:
            return fail(self, "EMPTY_INPUT")
        if len(note) < MIN_LEN:
            return fail(self, "TOO_SHORT")
        if len(note) > MAX_LEN:
            return fail(self, "TOO_LONG")

        category = payload.get("category")
        category = category if category in CATEGORIES else "일반"
        level = payload.get("level")
        level = level if level in LEVELS else "보통"

        # 3) 호출 제한 (PRD §9.6) — best-effort
        if rate_limited(client_ip(self)):
            return fail(self, "RATE_LIMITED")

        # 4) 키 확인 — 없는 걸 먼저 알면 40초 기다릴 필요가 없다
        if not MODEL:
            print("[summarize] CLAUDE_MODEL 이 비어 있다 — 환경 변수를 지우거나 값을 채우십시오")
            return fail(self, "BAD_CONFIG")

        if not os.environ.get("ANTHROPIC_API_KEY"):
            print("[summarize] ANTHROPIC_API_KEY 미설정 — Vercel 환경 변수를 확인하고 재배포")
            return fail(self, "NO_API_KEY")

        user_prompt = build_user_prompt(note, category, level)

        # 5) 호출 → 파싱. 파싱 실패에 한해 정확히 1회 재시도 (PRD §6.4 3단계)
        result = None
        resp = None
        for attempt in range(2):
            resp, code = call_claude(user_prompt)
            if code:
                return fail(self, code)

            # stop_reason 을 content 보다 먼저 본다
            if resp.get("stop_reason") == "refusal":
                return fail(self, "AI_REFUSED")
            if resp.get("stop_reason") == "max_tokens":
                print("[summarize] max_tokens 도달 — 출력이 잘려 JSON 이 깨졌다")
                return fail(self, "INVALID_AI_OUTPUT")

            text = extract_text(resp)
            if text:
                try:
                    result = json.loads(text)
                    break
                except json.JSONDecodeError:
                    pass

            if attempt == 0:
                print("[summarize] JSON 파싱 실패 — 1회 재시도")
                user_prompt += "\n\n※ 반드시 JSON 객체 하나만 출력한다. 코드블록을 붙이지 않는다."
            else:
                # 재시도는 여기서 끝. 과제 제약에 무한 재시도 금지가 명시돼 있다.
                return fail(self, "INVALID_AI_OUTPUT")

        # 6) 의미 검증 — ★ 여기서는 재시도하지 않는다 ★
        #    파싱 실패와 검증 실패를 다르게 취급한다. 둘 다 재시도하면
        #    응답 시간과 쿼터 소모가 2배가 된다.
        reason = validate(result)
        if reason is not None:
            print(f"[summarize] 결과 검증 실패: {reason}")
            return fail(self, "INVALID_AI_OUTPUT")

        # 7) 성공
        usage = resp.get("usage") or {}   # 게이트웨이가 안 줄 수도 있으니 .get
        json_response(self, 200, {
            "ok": True,
            "data": result,
            "meta": {
                "model": MODEL,
                "category": category,
                "level": level,
                "elapsed_ms": int((time.time() - started) * 1000),
                "input_tokens": usage.get("input_tokens"),
                "output_tokens": usage.get("output_tokens"),
            },
        })
