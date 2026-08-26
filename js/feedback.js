/* feedback.js — 문의 폼 (보너스 B, PRD §7.2, §11.3)

   ★ 노트 원문은 절대 보내지 않는다 ★
   사용자는 "문의를 보낸다"고 생각했지 "내 필기를 보낸다"고 생각하지 않았습니다.
   최근 결과의 '제목'만, 그것도 체크박스로 동의했을 때만 함께 보냅니다. */

function initFeedbackForm() {
  const form = document.getElementById("feedback-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const errorEl = document.getElementById("fb-error");
    const btn = document.getElementById("fb-submit");
    const name = document.getElementById("fb-name").value.trim();
    const email = document.getElementById("fb-email").value.trim();
    const message = document.getElementById("fb-message").value.trim();
    const includeTopic = document.getElementById("fb-include-topic").checked;

    // 차단 — 네트워크 요청을 보내지 않는다
    if (!name || !email || !message) {
      errorEl.textContent = "이름 · 이메일 · 내용을 모두 채워주세요.";
      errorEl.hidden = false;
      return;
    }
    if (!email.includes("@")) {
      errorEl.textContent = "이메일 주소를 다시 확인해 주세요.";
      errorEl.hidden = false;
      return;
    }
    if (message.length < 5) {
      errorEl.textContent = "내용을 조금 더 적어주세요. (5자 이상)";
      errorEl.hidden = false;
      return;
    }
    errorEl.hidden = true;

    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    btn.textContent = "보내는 중…";

    const payload = { name, email, message, include_topic: includeTopic };
    // 제목만. 요약·용어·퀴즈 전체나 노트 원문은 담지 않는다.
    if (includeTopic && typeof lastResult !== "undefined" && lastResult) {
      payload.topic = lastResult.topic;
    }

    const res = await callApi("/api/feedback", payload, { timeoutMs: 15000 });

    btn.disabled = false;
    btn.removeAttribute("aria-busy");
    btn.textContent = "보내기";

    if (!res.ok) {
      errorEl.textContent = messageFor(res.code);
      errorEl.hidden = false;
      return;
    }

    form.reset();
    showToast("문의를 보냈어요. 읽고 답장드릴게요.");
  });
}
