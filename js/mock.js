/* mock.js — 서버·키·네트워크 없이 화면을 확인하기 위한 고정 응답 (PRD §12.3)
   A2-1의 USE_MOCK을 프론트로 옮긴 것.

   URL에 붙여서 씁니다.
     ?mock=1        정상 결과 (1.2초 지연 후)
     ?mock=timeout  타임아웃 안내 화면
     ?mock=error    API 오류 안내 화면

   실패 화면 스크린샷을 인위적으로 만들 수 있어서 증빙(§14.3의 08번)에 씁니다. */

const Mock = (() => {
  const mode = new URLSearchParams(location.search).get("mock");

  const SAMPLE = {
    topic: "HTTP 요청과 응답의 구조",
    summary: [
      "HTTP는 클라이언트가 요청을 보내면 서버가 응답을 돌려주는 단방향 요청-응답 프로토콜이다.",
      "요청은 메서드·경로·헤더·본문으로, 응답은 상태 코드·헤더·본문으로 구성된다.",
      "상태 코드는 첫 자리로 분류되며 2xx는 성공, 4xx는 클라이언트 잘못, 5xx는 서버 잘못을 뜻한다."
    ],
    keywords: [
      { term: "메서드", meaning: "요청의 목적을 나타내는 동사. GET은 조회, POST는 생성·전송에 쓴다." },
      { term: "상태 코드", meaning: "응답의 결과를 세 자리 숫자로 나타낸 값. 200, 404, 500 등." },
      { term: "헤더", meaning: "본문에 대한 부가 정보. Content-Type으로 본문 형식을 알린다." },
      { term: "본문(body)", meaning: "실제로 주고받는 데이터. GET 요청에는 보통 없다." }
    ],
    quizzes: [
      { type: "ox", question: "HTTP에서 서버가 먼저 클라이언트에게 요청을 보낼 수 있다.",
        options: ["O", "X"], answer: "X",
        explanation: "HTTP는 클라이언트가 요청하면 서버가 응답하는 구조다. 서버가 먼저 말을 걸 수 없다." },
      { type: "choice", question: "상태 코드 404가 뜻하는 것은?",
        options: ["요청이 성공했다", "요청한 자원을 찾을 수 없다", "서버 내부에 오류가 있다", "권한이 없다"],
        answer: "요청한 자원을 찾을 수 없다",
        explanation: "404는 4xx(클라이언트 잘못)에 속하며, 경로에 해당하는 자원이 없다는 뜻이다." },
      { type: "choice", question: "본문의 형식을 서버에 알려주는 헤더는?",
        options: ["Content-Length", "Content-Type", "Authorization", "User-Agent"],
        answer: "Content-Type",
        explanation: "Content-Type이 본문 형식을 알린다. JSON을 보낼 때는 application/json을 쓴다." },
      { type: "ox", question: "5xx 상태 코드는 클라이언트의 잘못을 뜻한다.",
        options: ["O", "X"], answer: "X",
        explanation: "5xx는 서버 잘못이다. 클라이언트 잘못은 4xx다." },
      { type: "choice", question: "새 데이터를 서버에 보내 만들 때 주로 쓰는 메서드는?",
        options: ["GET", "POST", "HEAD", "OPTIONS"],
        answer: "POST",
        explanation: "GET은 조회, POST는 생성·전송에 쓴다. 노트에서 메서드를 '요청의 목적을 나타내는 동사'로 설명했다." }
    ]
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  return {
    /** 목업 모드가 켜져 있는가 */
    enabled() { return mode !== null; },

    /** api.js의 callApi 대신 반환할 응답 */
    async respond() {
      await sleep(1200);                       // 로딩 스켈레톤을 볼 수 있도록
      if (mode === "timeout") return { ok: false, code: "UPSTREAM_TIMEOUT" };
      if (mode === "error")   return { ok: false, code: "UPSTREAM_ERROR" };
      if (mode === "invalid") return { ok: false, code: "INVALID_AI_OUTPUT" };
      if (mode === "limit")   return { ok: false, code: "RATE_LIMITED" };
      return {
        ok: true,
        data: SAMPLE,
        meta: { model: "mock", elapsed_ms: 1200, input_tokens: null, output_tokens: null }
      };
    }
  };
})();
