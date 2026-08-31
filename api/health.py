"""GET /api/health — 배포 진단용 (PRD §7.3)

배포 후 /api/summarize 가 실패할 때, 원인이 "키 미설정"인지 "함수 배포 실패"인지를
1초 만에 가릅니다.

★ 키 값을 절대 내보내지 않습니다. 존재 여부(boolean)만 반환합니다. ★
   앞 4글자도 금지 — 그 순간 이 진단 도구가 유출 경로가 됩니다. (PRD §9.4)
"""

import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _shared import fail, json_response  # noqa: E402

DEFAULT_API_URL = "https://copa.codyssey.kr/v1/messages"


class handler(BaseHTTPRequestHandler):  # ★ 소문자 handler — 대문자면 404 ★

    def do_GET(self):
        api_url = os.environ.get("COPA_API_URL") or DEFAULT_API_URL
        try:
            import requests

            requests_version = requests.__version__
        except ImportError:
            requests_version = None

        json_response(self, 200, {
            "ok": True,
            "python": sys.version.split()[0],
            "requests": requests_version,
            # 존재 여부만. 값도, 앞자리도 넣지 않는다.
            "has_api_key": bool(os.environ.get("ANTHROPIC_API_KEY")),
            "model": os.environ.get("CLAUDE_MODEL") or "claude-haiku-4",
            # URL 자체가 아니라 "기본값을 쓰는지"만 알린다.
            "custom_api_url": api_url != DEFAULT_API_URL,
        })

    def do_POST(self):
        fail(self, "METHOD_NOT_ALLOWED")
