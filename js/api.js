/* api.js — fetch 래퍼 (PRD §4.3, §8.4)

   ★ callApi는 절대 예외를 던지지 않는다 ★
   항상 { ok:true, data, meta } 또는 { ok:false, code } 를 반환합니다.
   이 계약 하나가 실패 처리를 개인의 주의력이 아니라 구조로 보장합니다.
   호출하는 쪽(study.js, feedback.js)에 try/catch가 흩어지지 않습니다.

   ★ 화면 문구는 서버의 message가 아니라 code로 고른다 ★
   서버 문구를 그대로 쓰면 영어·내부 용어가 화면에 새어 나옵니다. */

/* 사용자 안내 문구 — 여기 한 군데에서만 관리한다 (PRD §8.4) */
const MESSAGES = {
  EMPTY_INPUT:           "되새길 노트를 먼저 붙여넣어 주세요.",
  TOO_SHORT:             "내용이 너무 짧아요. 100자 이상 붙여넣으면 요약과 퀴즈를 만들 수 있어요.",
  TOO_LONG:              "한 번에 4,000자까지 가능해요. 나눠서 되새겨 보세요.",
  INVALID_FIELD:         "입력한 내용을 다시 확인해 주세요.",
  RATE_LIMITED:          "잠시 쉬어갈까요? 1분 뒤에 다시 시도할 수 있어요.",
  UPSTREAM_RATE_LIMITED: "지금 이용이 많아요. 30초 뒤에 다시 눌러주세요.",
  UPSTREAM_TIMEOUT:      "생각이 길어졌어요. 노트를 조금 줄이면 훨씬 빨라져요.",
  CLIENT_TIMEOUT:        "생각이 길어졌어요. 노트를 조금 줄이면 훨씬 빨라져요.",
  UPSTREAM_ERROR:        "지금은 되새김이 잠시 쉬고 있어요. 잠시 후 다시 시도해 주세요.",
  UPSTREAM_AUTH:         "지금은 되새김이 잠시 쉬고 있어요. 잠시 후 다시 시도해 주세요.",
  NO_API_KEY:            "지금은 되새김이 잠시 쉬고 있어요. 잠시 후 다시 시도해 주세요.",
  INTERNAL:              "지금은 되새김이 잠시 쉬고 있어요. 잠시 후 다시 시도해 주세요.",
  INVALID_AI_OUTPUT:     "결과를 다듬는 데 실패했어요. 한 번 더 시도하면 대개 잘 나와요.",
  AI_REFUSED:            "이 내용으로는 퀴즈를 만들기 어려워요. 다른 노트로 시도해 주세요.",
  BAD_JSON_BODY:         "요청을 보내지 못했어요. 새로고침 후 다시 시도해 주세요.",
  METHOD_NOT_ALLOWED:    "요청을 보내지 못했어요. 새로고침 후 다시 시도해 주세요.",
  WEBHOOK_NOT_CONFIGURED:"문의 채널이 아직 연결되지 않았어요. 저장소 이슈로 남겨주세요.",
  OFFLINE:               "인터넷 연결을 확인해 주세요."
};

/* 이 코드들은 "다시 시도" 버튼을 보여준다 */
const RETRYABLE = new Set([
  "RATE_LIMITED", "UPSTREAM_RATE_LIMITED", "UPSTREAM_TIMEOUT", "CLIENT_TIMEOUT",
  "UPSTREAM_ERROR", "UPSTREAM_AUTH", "NO_API_KEY", "INTERNAL", "INVALID_AI_OUTPUT", "OFFLINE"
]);

function messageFor(code) {
  return MESSAGES[code] || MESSAGES.INTERNAL;
}

function isRetryable(code) {
  return RETRYABLE.has(code);
}

/**
 * 우리 서버(/api/...)를 호출한다.
 * ★ copa.codyssey.kr을 여기서 직접 부르지 않는다 ★ — 키가 노출된다 (PRD §9.1)
 *
 * @returns {Promise<{ok:true,data:any,meta:any} | {ok:false,code:string}>}
 */
async function callApi(path, payload, { timeoutMs = 90000 } = {}) {
  // 목업 모드면 네트워크를 타지 않는다 (PRD §12.3)
  if (typeof Mock !== "undefined" && Mock.enabled() && path === "/api/summarize") {
    return Mock.respond();
  }

  // 프론트 타임아웃 90초 — 서버(40×2=80초)보다 길어야 한다 (PRD §8.3)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") return { ok: false, code: "CLIENT_TIMEOUT" };
    return { ok: false, code: navigator.onLine ? "INTERNAL" : "OFFLINE" };
  }
  clearTimeout(timer);

  // 서버는 성공·실패 모두 JSON을 준다. 아니라면 그 자체가 이상 신호다.
  let body;
  try {
    body = await res.json();
  } catch {
    return { ok: false, code: "INTERNAL" };
  }

  if (!res.ok || !body.ok) {
    return { ok: false, code: body.code || "INTERNAL" };
  }
  return body;
}

/* 토스트 (마이크로 인터랙션 — PRD §10.2) */
let toastTimer = null;
function showToast(text) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add("is-visible"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("is-visible");
    setTimeout(() => { el.hidden = true; }, 220);
  }, 2000);
}
