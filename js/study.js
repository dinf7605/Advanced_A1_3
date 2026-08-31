/* study.js — AI 폼 제출 · 결과 렌더 · 퀴즈 채점 (PRD §4.3, §6.5)

   ★ innerHTML을 쓰지 않는다 ★
   모델 출력에 <script>가 섞여 들어오면 그대로 실행됩니다(XSS).
   createElement + textContent로만 DOM을 만듭니다. (PRD §9.4 점검 항목) */

const MIN_LEN = 100;
const MAX_LEN = 4000;
const COOLDOWN_MS = 10000;    // 제출 후 10초 쿨다운 (PRD §9.6 호출 빈도 통제)

let cooldownTimer = null;

const SAMPLE_NOTE = `HTTP는 웹에서 클라이언트와 서버가 데이터를 주고받는 규칙이다.
클라이언트가 요청(request)을 보내면 서버가 응답(response)을 돌려주는 구조이며,
서버가 먼저 클라이언트에게 말을 걸 수는 없다.

요청은 메서드, 경로, 헤더, 본문으로 구성된다. 메서드는 요청의 목적을 나타내는 동사로
GET은 조회에, POST는 데이터를 만들거나 보낼 때 쓴다. 헤더는 본문에 대한 부가 정보를 담는데,
Content-Type 헤더로 본문이 어떤 형식인지 알린다. JSON을 보낼 때는 application/json을 쓴다.

응답은 상태 코드, 헤더, 본문으로 구성된다. 상태 코드는 세 자리 숫자이고 첫 자리로 분류한다.
2xx는 성공, 4xx는 클라이언트 잘못, 5xx는 서버 잘못을 뜻한다.
대표적으로 200은 성공, 404는 요청한 자원을 찾을 수 없음, 500은 서버 내부 오류를 나타낸다.
따라서 오류가 났을 때 상태 코드의 첫 자리만 봐도 내 잘못인지 서버 잘못인지 나눌 수 있다.`;

/* ── 입력 검증 (프론트 = UX. 백엔드 검증이 따로 있다 = 보안) ──── */
function validateNote(note) {
  const trimmed = note.trim();
  if (!trimmed) return "EMPTY_INPUT";
  if (trimmed.length < MIN_LEN) return "TOO_SHORT";
  if (trimmed.length > MAX_LEN) return "TOO_LONG";
  return null;
}

function updateCounter() {
  const note = document.getElementById("note").value;
  const counter = document.getElementById("counter");
  const len = note.trim().length;
  counter.textContent = `${len.toLocaleString()} / 4,000자`;
  counter.classList.toggle("is-over", len > MAX_LEN);
}

/* ── 화면 상태 ───────────────────────────────────────────────── */
function setLoading(on) {
  const btn = document.getElementById("submit-btn");
  document.getElementById("loading").hidden = !on;
  btn.disabled = on;
  if (on) {
    btn.setAttribute("aria-busy", "true");
    btn.textContent = "되새기는 중…";
    document.getElementById("error-box").hidden = true;
    document.getElementById("result").textContent = "";
  } else {
    btn.removeAttribute("aria-busy");
    btn.textContent = "되새기기";
  }
}

function showError(code, { onRetry } = {}) {
  const box = document.getElementById("error-box");
  const retry = document.getElementById("retry-btn");
  document.getElementById("error-message").textContent = messageFor(code);
  retry.hidden = !isRetryable(code) || !onRetry;
  retry.onclick = onRetry || null;
  box.hidden = false;
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function startCooldown() {
  const btn = document.getElementById("submit-btn");
  let left = Math.ceil(COOLDOWN_MS / 1000);
  btn.disabled = true;
  btn.textContent = `${left}초 후 다시 가능`;
  clearInterval(cooldownTimer);
  cooldownTimer = setInterval(() => {
    left -= 1;
    if (left <= 0) {
      clearInterval(cooldownTimer);
      btn.disabled = false;
      btn.textContent = "되새기기";
    } else {
      btn.textContent = `${left}초 후 다시 가능`;
    }
  }, 1000);
}

/* ── 결과 렌더 (내 기록의 '보기'에서도 재사용한다) ───────────── */
function renderResult(data) {
  const root = document.getElementById("result");
  root.textContent = "";
  document.getElementById("error-box").hidden = true;

  let delay = 0;
  const card = (title) => {
    const el = document.createElement("section");
    el.className = "card result-card";
    el.style.animationDelay = `${delay}ms`;
    delay += 40;                                   // 카드마다 40ms씩 지연
    if (title) {
      const h = document.createElement("h2");
      h.textContent = title;
      el.append(h);
    }
    root.append(el);
    return el;
  };

  /* 주제 */
  const head = card();
  const headRow = document.createElement("div");
  headRow.className = "result-head";
  const topic = document.createElement("h2");
  topic.textContent = data.topic || "요약 결과";
  headRow.append(topic);
  head.append(headRow);

  /* 요약 */
  const sum = card("요약");
  const ol = document.createElement("ol");
  ol.className = "summary-list";
  (data.summary || []).forEach((line) => {
    const li = document.createElement("li");
    li.textContent = line;
    ol.append(li);
  });
  sum.append(ol);

  /* 핵심 용어 */
  const kw = card("핵심 용어");
  const dl = document.createElement("dl");
  dl.className = "keyword-grid";
  (data.keywords || []).forEach((item) => {
    const wrap = document.createElement("div");
    wrap.className = "keyword";
    const dt = document.createElement("dt");
    dt.textContent = item.term;
    const dd = document.createElement("dd");
    dd.textContent = item.meaning;
    wrap.append(dt, dd);
    dl.append(wrap);
  });
  kw.append(dl);

  /* 퀴즈 */
  const quizCard = card("확인 퀴즈");
  const form = document.createElement("form");
  form.id = "quiz-form";

  (data.quizzes || []).forEach((q, i) => {
    const block = document.createElement("div");
    block.className = "quiz";
    block.dataset.answer = q.answer;
    block.dataset.explanation = q.explanation || "";

    const question = document.createElement("p");
    question.className = "quiz-q";
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = q.type === "ox" ? "O/X" : "객관식";
    question.append(`${i + 1}. `, badge, ` ${q.question}`);
    block.append(question);

    const options = document.createElement("div");
    options.className = "quiz-options";
    (q.options || []).forEach((opt, j) => {
      const label = document.createElement("label");
      label.className = "quiz-option";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = `q${i}`;
      input.value = opt;
      input.id = `q${i}o${j}`;
      const span = document.createElement("span");
      span.textContent = opt;
      label.append(input, span);
      options.append(label);
    });
    block.append(options);
    form.append(block);
  });

  const gradeBtn = document.createElement("button");
  gradeBtn.type = "submit";
  gradeBtn.className = "btn btn-primary";
  gradeBtn.textContent = "채점하기";
  form.append(gradeBtn);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    gradeQuiz(form, quizCard);
    gradeBtn.disabled = true;
  });
  quizCard.append(form);

  /* 액션 */
  const actions = card();
  const wrap = document.createElement("div");
  wrap.className = "result-actions";

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "btn btn-secondary";
  copyBtn.textContent = "Markdown 복사";
  copyBtn.addEventListener("click", () => copyAsMarkdown(data));

  const againBtn = document.createElement("button");
  againBtn.type = "button";
  againBtn.className = "btn btn-ghost";
  againBtn.textContent = "다시 만들기";
  againBtn.addEventListener("click", () => {
    root.textContent = "";
    document.getElementById("note").focus();
  });

  wrap.append(copyBtn, againBtn);
  actions.append(wrap);
}

/* ── 채점 (전부 프론트에서. 정답이 이미 응답에 들어 있다) ────── */
function gradeQuiz(form, container) {
  const blocks = form.querySelectorAll(".quiz");
  let correct = 0;

  blocks.forEach((block, i) => {
    const chosen = form.querySelector(`input[name="q${i}"]:checked`);
    const answer = block.dataset.answer;

    block.querySelectorAll(".quiz-option").forEach((label) => {
      const input = label.querySelector("input");
      input.disabled = true;
      const mark = document.createElement("span");
      mark.className = "quiz-mark";

      if (input.value === answer) {
        label.classList.add("is-correct");
        mark.textContent = "✅ 정답";        // 색만으로 구분하지 않는다
        label.append(mark);
      } else if (chosen && input.value === chosen.value) {
        label.classList.add("is-wrong");
        mark.textContent = "❌";
        label.append(mark);
      }
    });

    if (chosen && chosen.value === answer) correct += 1;

    // 해설은 채점 후에 DOM에 넣는다 (미리 넣으면 개발자 도구로 보인다)
    const explain = document.createElement("p");
    explain.className = "quiz-explain";
    const b = document.createElement("b");
    b.textContent = "해설 ";
    explain.append(b, block.dataset.explanation);
    block.append(explain);
  });

  const score = document.createElement("p");
  score.className = "score";
  score.textContent = `${blocks.length}문항 중 ${correct}개 정답`;
  container.insertBefore(score, container.querySelector("#quiz-form"));
  score.scrollIntoView({ behavior: "smooth", block: "center" });
}

/* ── Markdown 복사 ───────────────────────────────────────────── */
function toMarkdown(data) {
  const lines = [`# ${data.topic}`, "", "## 요약"];
  (data.summary || []).forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  lines.push("", "## 핵심 용어");
  (data.keywords || []).forEach((k) => lines.push(`- **${k.term}** — ${k.meaning}`));
  lines.push("", "## 확인 퀴즈");
  (data.quizzes || []).forEach((q, i) => {
    lines.push(`${i + 1}. ${q.question}`);
    (q.options || []).forEach((o) => lines.push(`   - ${o}`));
    lines.push(`   - 정답: ${q.answer}`);
    lines.push(`   - 해설: ${q.explanation}`);
  });
  return lines.join("\n");
}

async function copyAsMarkdown(data) {
  try {
    await navigator.clipboard.writeText(toMarkdown(data));
    showToast("클립보드에 복사했어요.");
  } catch {
    showToast("복사에 실패했어요. 직접 선택해 주세요.");
  }
}

/* ── 제출 ────────────────────────────────────────────────────── */
async function submitNote() {
  const note = document.getElementById("note").value;
  const errorEl = document.getElementById("note-error");

  const invalid = validateNote(note);
  if (invalid) {
    // ★ 차단: 네트워크 요청을 보내지 않는다 ★
    errorEl.textContent = messageFor(invalid);
    errorEl.hidden = false;
    document.getElementById("note").focus();
    return;
  }
  errorEl.hidden = true;

  const category = document.getElementById("category").value;
  const level = document.querySelector('input[name="level"]:checked').value;

  setLoading(true);
  const res = await callApi("/api/summarize", { note: note.trim(), category, level });
  setLoading(false);

  if (!res.ok) {
    showError(res.code, { onRetry: submitNote });
    return;
  }

  renderResult(res.data);
  saveResult(res.data, res.meta);
  startCooldown();

  // 쿼터 소비를 눈으로 보기 위한 값 — 화면이 아니라 콘솔에만 (PRD §9.6)
  if (res.meta) console.info("[되새김] meta:", res.meta);
}

function initStudyForm() {
  const form = document.getElementById("study-form");
  if (!form) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();        // 폼의 기본 동작(페이지 새로고침)을 막는다
    submitNote();
  });

  document.getElementById("note").addEventListener("input", updateCounter);
  document.getElementById("sample-btn").addEventListener("click", () => {
    document.getElementById("note").value = SAMPLE_NOTE;
    updateCounter();
  });

  updateCounter();
}

/* ── 시작 ────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initRouter();
  initHistory();
  initStudyForm();

  if (typeof Mock !== "undefined" && Mock.enabled()) {
    console.info("[되새김] 목업 모드입니다. 서버를 호출하지 않습니다.");
  }
});
