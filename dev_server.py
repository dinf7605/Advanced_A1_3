"""로컬 개발 서버 — Vercel 없이 /api 까지 테스트한다.

    python dev_server.py          →  http://localhost:8000

`vercel dev` 가 정식 방법이지만 Node/Vercel CLI 설치가 필요합니다.
이 스크립트는 **Vercel이 배포 환경에서 해 주는 일을 흉내 낸 것**입니다.

    정적 파일        index.html, css/, js/, images/  →  그대로 서빙
    api/summarize.py →  /api/summarize
    api/health.py    →  /api/health
    api/feedback.py  →  /api/feedback

★ 이것은 로컬 편의 도구입니다. 배포 환경에서는 실행되지 않습니다. ★
   Vercel은 `api/*.py` 를 각각 독립된 서버리스 함수로 띄우고, 이 파일은 쓰지 않습니다.
   "로컬 환경과 배포 환경의 차이"(과제 목표 5번)를 눈으로 보기에 좋은 대비입니다.

환경 변수는 .env.local 에서 읽습니다 (python-dotenv 없이 직접 파싱).
"""

from __future__ import annotations

import importlib.util
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).parent
PORT = int(os.environ.get("PORT", 8000))


# 이 파일이 관리하는 환경 변수. 여기 없는 이름은 건드리지 않는다.
MANAGED_KEYS = ("ANTHROPIC_API_KEY", "CLAUDE_MODEL", "COPA_API_URL",
                "WEBHOOK_URL", "RATE_LIMIT_PER_MIN")


def load_env_local() -> None:
    """.env.local 을 os.environ 에 넣는다. Vercel은 이 일을 대신 해 준다.

    ★ 셸에 이미 있는 값을 쓰지 않고, 먼저 지운 뒤 .env.local 값만 넣는다 ★

    setdefault 로 두면 셸 환경에 남아 있는 다른 프로젝트의 ANTHROPIC_API_KEY 가
    그대로 쓰입니다. 그 키는 교육용 게이트웨이의 것이 아니므로 401 이 나는 데서
    끝나지 않고, **내 개인 키가 제3자 서버로 전송됩니다.**
    "어디서 온 키인지 모르는 채로 밖으로 내보내지 않는다"가 이 함수의 목적입니다.
    """
    for key in MANAGED_KEYS:                        # 먼저 비운다
        os.environ.pop(key, None)

    path = ROOT / ".env.local"
    if not path.exists():
        print("⚠️  .env.local 이 없습니다. AI 기능은 NO_API_KEY 로 실패합니다.")
        print("    cp .env.example .env.local  후 키를 채우세요.")
        print("    (셸에 남아 있는 키를 대신 쓰지 않습니다 — 의도된 동작입니다.)\n")
        return

    loaded = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if value and key in MANAGED_KEYS:           # 빈 값은 넣지 않는다 (기본값 유지)
            os.environ[key] = value
            loaded.append(key)

    # ★ 값이 아니라 "이름"만 출력한다 ★ 로그도 유출 경로다 (PRD §9.4)
    print(f"   .env.local 에서 읽음: {', '.join(loaded) or '(없음)'}")


def load_handler(name: str):
    """api/{name}.py 의 handler 클래스를 가져온다."""
    path = ROOT / "api" / f"{name}.py"
    if not path.exists():
        return None
    spec = importlib.util.spec_from_file_location(f"api_{name}", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return getattr(module, "handler", None)


class DevHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _route(self, method: str) -> bool:
        """/api/xxx 요청이면 해당 함수로 넘긴다. 아니면 False."""
        path = self.path.split("?")[0]
        if not path.startswith("/api/"):
            return False

        name = path[len("/api/"):].strip("/")
        # Vercel과 동일하게: 밑줄로 시작하는 파일은 라우트가 아니다
        if not name or name.startswith("_") or "/" in name:
            self.send_error(404)
            return True

        handler_cls = load_handler(name)
        if handler_cls is None:
            self.send_error(404, "Function not found")
            return True

        # 실제 Vercel 함수와 같은 인터페이스로 호출한다
        proxy = handler_cls.__new__(handler_cls)
        proxy.rfile = self.rfile
        proxy.wfile = self.wfile
        proxy.headers = self.headers
        proxy.path = self.path
        proxy.request_version = self.request_version
        proxy.send_response = self.send_response
        proxy.send_header = self.send_header
        proxy.end_headers = self.end_headers
        proxy.send_error = self.send_error

        fn = getattr(proxy, f"do_{method}", None)
        if fn is None:
            self.send_error(405)
            return True
        try:
            fn()
        except Exception as exc:                    # noqa: BLE001
            print(f"[dev] {name} 에서 예외: {type(exc).__name__}: {exc}")
            self.send_error(500)
        return True

    def do_GET(self):
        if not self._route("GET"):
            super().do_GET()

    def do_POST(self):
        if not self._route("POST"):
            self.send_error(405)

    def end_headers(self):
        # 로컬에서는 캐시가 없어야 수정이 바로 보인다 (배포 환경과 다른 점!)
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        print(f"[dev] {fmt % args}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")        # cp949 터미널에서 이모지 깨짐 방지
    load_env_local()
    print(f"🌀 되새김 개발 서버  →  http://localhost:{PORT}")
    print(f"   목업 모드        →  http://localhost:{PORT}/?mock=1")
    print(f"   진단             →  http://localhost:{PORT}/api/health")
    print("   Ctrl+C 로 종료\n")
    ThreadingHTTPServer(("localhost", PORT), DevHandler).serve_forever()
