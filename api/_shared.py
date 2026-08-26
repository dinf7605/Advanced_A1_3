"""api/ 공용 헬퍼 — 응답 규약 · 호출 제한 (PRD §4.4, §7.4, §9.6)

★ 파일명이 밑줄(_)로 시작하므로 Vercel 함수(라우트)가 되지 않습니다. ★
   `_`·`.`으로 시작하는 파일은 함수로 만들어지지 않는다 — Vercel 공식 문서.

이 모듈을 쓰는 쪽은 아래 두 줄을 먼저 실행합니다.

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from _shared import json_response, fail, ...

sys.path 보정을 넣은 이유: 배포 환경에서 함수 파일의 디렉터리가 import 경로에
들어 있다는 보장이 없습니다. 두 줄로 그 불확실성을 없앨 수 있으므로,
"되는지 보고 안 되면 고친다"보다 처음부터 넣는 편이 낫습니다.
"""

from __future__ import annotations

import json
import os
import time

# ── 오류 코드 → HTTP 상태 (PRD §7.4) ─────────────────────────────
STATUS: dict[str, int] = {
    "METHOD_NOT_ALLOWED": 405,
    "BAD_JSON_BODY": 400,
    "EMPTY_INPUT": 400,
    "TOO_SHORT": 400,
    "TOO_LONG": 400,
    "INVALID_FIELD": 400,
    "RATE_LIMITED": 429,
    "NO_API_KEY": 500,
    "UPSTREAM_AUTH": 500,
    "UPSTREAM_RATE_LIMITED": 429,
    "UPSTREAM_TIMEOUT": 504,
    "UPSTREAM_ERROR": 502,
    "INVALID_AI_OUTPUT": 502,
    "AI_REFUSED": 422,
    "WEBHOOK_NOT_CONFIGURED": 503,
    "INTERNAL": 500,
}


# ── 응답 헬퍼 ────────────────────────────────────────────────────
def json_response(handler, status: int, payload: dict) -> None:
    """성공/실패 모두 JSON으로 응답한다. HTML 오류 페이지를 내지 않는다.

    ensure_ascii=False  — 빼면 한글이 \\uXXXX 로 나가 응답이 3배 커진다.
    charset=utf-8       — 빼면 브라우저가 한글을 깨뜨려 보여줄 수 있다.
    """
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)


def fail(handler, code: str) -> None:
    """오류 코드만 내보낸다.

    ★ 예외 원문(str(e))을 절대 넣지 않는다 ★ — 요청 URL·헤더가 딸려 나온다 (PRD §9.4).
    화면 문구는 프론트가 code 로 고른다 (PRD §8.4).
    """
    json_response(handler, STATUS.get(code, 500), {"ok": False, "code": code, "message": code})


def read_json_body(handler) -> dict | None:
    """요청 body를 dict로 읽는다. 실패하면 None.

    self.rfile.read() 를 인자 없이 부르면 요청이 끝날 때까지 블록된다.
    반드시 Content-Length 만큼만 읽는다.
    """
    try:
        length = int(handler.headers.get("Content-Length") or 0)
    except ValueError:
        return None
    if length <= 0:
        return {}
    try:
        payload = json.loads(handler.rfile.read(length))
    except (ValueError, UnicodeDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


# ── 호출 제한 (PRD §9.6) ─────────────────────────────────────────
# ⚠️ 인스턴스 메모리 기반이라 완벽하지 않습니다. 서버리스는 요청마다 다른
#    인스턴스가 뜰 수 있고 콜드 스타트 때 이 딕셔너리가 비워집니다.
#    "실수로 연타하는 사용자"는 막지만 "작정한 사람"은 못 막습니다.
#    제대로 하려면 외부 저장소가 필요한데, 그건 이 과제의 범위 밖입니다.
_hits: dict[str, list[float]] = {}


def client_ip(handler) -> str:
    """Vercel은 원래 클라이언트 IP를 x-forwarded-for 첫 번째 값에 넣는다."""
    forwarded = handler.headers.get("x-forwarded-for") or ""
    return forwarded.split(",")[0].strip() or "unknown"


def rate_limited(ip: str, per_min: int | None = None) -> bool:
    limit = per_min or int(os.environ.get("RATE_LIMIT_PER_MIN") or 5)
    now = time.time()
    recent = [t for t in _hits.get(ip, []) if now - t < 60]
    if len(recent) >= limit:
        _hits[ip] = recent
        return True
    recent.append(now)
    _hits[ip] = recent
    return False
