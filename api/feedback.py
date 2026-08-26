"""POST /api/feedback — 문의를 외부 웹훅으로 전달한다. (보너스 B, PRD §7.2, §11.2)

★ 노트 원문은 절대 보내지 않는다 ★
   사용자는 "문의를 보낸다"고 생각했지 "내 필기를 보낸다"고 생각하지 않았습니다.
   동의하지 않은 데이터를 함께 보내는 것이 이 구조에서 가장 흔한 사고입니다. (PRD §11.3)
"""

import os
import sys
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _shared import client_ip, fail, json_response, rate_limited, read_json_body  # noqa: E402

WEBHOOK_TIMEOUT = 5  # 초. 재시도 없음.


class handler(BaseHTTPRequestHandler):  # ★ 소문자 handler ★

    def do_GET(self):
        fail(self, "METHOD_NOT_ALLOWED")

    def do_POST(self):
        payload = read_json_body(self)
        if payload is None:
            return fail(self, "BAD_JSON_BODY")

        name = (payload.get("name") or "").strip()
        email = (payload.get("email") or "").strip()
        message = (payload.get("message") or "").strip()

        # 검증 (PRD §7.2)
        if not name or not email or not message:
            return fail(self, "EMPTY_INPUT")
        if len(name) > 40 or len(email) > 40 or "@" not in email:
            return fail(self, "INVALID_FIELD")
        if len(message) < 5:
            return fail(self, "TOO_SHORT")
        if len(message) > 1000:
            return fail(self, "TOO_LONG")

        if rate_limited(client_ip(self)):
            return fail(self, "RATE_LIMITED")

        webhook_url = os.environ.get("WEBHOOK_URL")
        if not webhook_url:
            # 정직하게 안내한다. "접수됐습니다"라고 거짓말하지 않는다.
            return fail(self, "WEBHOOK_NOT_CONFIGURED")

        # 보낼 필드는 최소한으로. topic 은 사용자가 체크박스로 동의했을 때만.
        body = {
            "source": "되새김 (doesaegim)",
            "name": name,
            "email": email,
            "message": message,
            "received_at": datetime.now(timezone.utc).isoformat(),
        }
        if payload.get("include_topic") and payload.get("topic"):
            body["topic"] = str(payload["topic"])[:100]

        try:
            r = requests.post(webhook_url, json=body, timeout=WEBHOOK_TIMEOUT)
        except requests.exceptions.RequestException:
            print("[feedback] 웹훅 전송 실패 — 네트워크 또는 타임아웃")
            return fail(self, "INTERNAL")

        if r.status_code >= 400:
            # ★ 응답에 웹훅 URL 이나 상태 코드를 넣지 않는다 ★
            #   사용자에게 웹훅의 존재를 노출할 이유가 없다.
            print(f"[feedback] 웹훅이 오류를 반환 status={r.status_code}")
            return fail(self, "INTERNAL")

        json_response(self, 200, {"ok": True})
