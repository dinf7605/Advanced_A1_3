/* history.js — 내 기록 (보너스 B, PRD §11.1)

   저장소는 localStorage 하나입니다. 서버 DB를 쓰지 않는 이유:
   이 서비스에는 로그인이 없습니다. 로그인 없이 서버에 저장하면 누구의 기록인지
   구분할 수 없고, 남의 노트를 볼 수 있는 구조가 됩니다.
   "저장은 하되 서버에 두지 않는다"가 로그인 없는 서비스의 정직한 선택입니다. */

const HISTORY_KEY = "doesaegim.history.v1";   // 버전을 키에 넣어 스키마 변경 시 충돌 방지
const HISTORY_MAX = 10;

function listResults() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];   // 저장된 값이 깨졌어도 화면은 떠야 한다
  }
}

function writeAll(items) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
}

/* ── 캐시 (PRD §12.5 응답 지연 개선) ──────────────────────────────
   같은 노트 + 같은 과목 + 같은 난이도면 결과도 같습니다.
   기록이 이미 localStorage에 있으므로, 입력 지문(fingerprint)만 함께 저장하면
   **재요청 자체를 없앨 수 있습니다.** 10초 → 0초, 쿼터 소비 0.

   실측(2026-08-31): 응답 시간 ≈ 출력 토큰 × 약 6.7ms.
   출력 분량이 고정이라 프롬프트를 줄여도 지연이 줄지 않습니다.
   그래서 이 서비스에서 지연을 실제로 줄이는 방법은 **호출을 안 하는 것**뿐입니다. */
function fingerprint(note, category, level) {
  // 암호용이 아니라 캐시 키용이다. 충돌해도 길이가 함께 걸러준다.
  const s = `${category}|${level}|${note.trim()}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${s.length}-${(h >>> 0).toString(36)}`;
}

/** 같은 입력의 이전 결과를 찾는다. 없으면 null. */
function findCached(note, category, level) {
  const fp = fingerprint(note, category, level);
  return listResults().find((it) => it.fp === fp) || null;
}

function saveResult(data, meta, fp) {
  const item = {
    id: String(Date.now()),
    created_at: new Date().toISOString(),
    category: (meta && meta.category) || "일반",
    level: (meta && meta.level) || "보통",
    fp: fp || null,
    data
  };
  let items = [item, ...listResults()].slice(0, HISTORY_MAX);

  try {
    writeAll(items);
  } catch {
    // QuotaExceededError — 가장 오래된 것을 버리고 1회 재시도 (PRD §8.2 E18)
    try {
      items = items.slice(0, Math.max(1, Math.floor(items.length / 2)));
      writeAll(items);
    } catch {
      showToast("저장 공간이 부족해 기록을 남기지 못했어요.");
      return null;
    }
  }
  return item.id;
}

function removeResult(id) {
  writeAll(listResults().filter((it) => it.id !== id));
  renderHistory();
}

function clearResults() {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
}

function formatDate(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/* ── 화면 ────────────────────────────────────────────────────── */
function renderHistory() {
  const box = document.getElementById("history-list");
  const clearBtn = document.getElementById("clear-history");
  if (!box) return;

  box.textContent = "";
  const items = listResults();
  clearBtn.hidden = items.length === 0;

  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.append("아직 기록이 없어요. ");
    const link = document.createElement("a");
    link.href = "#/study";
    link.textContent = "되새김에서 시작하기 →";
    empty.append(link);
    box.append(empty);
    return;
  }

  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "history-item";

    const main = document.createElement("div");
    main.className = "history-main";
    const title = document.createElement("p");
    title.className = "history-title";
    title.textContent = item.data.topic || "제목 없음";
    const meta = document.createElement("p");
    meta.className = "history-meta";
    meta.textContent = `${item.category} · ${item.level} · ${formatDate(item.created_at)}`;
    main.append(title, meta);

    const actions = document.createElement("div");
    actions.className = "history-actions";

    const viewBtn = document.createElement("button");
    viewBtn.type = "button";
    viewBtn.className = "btn btn-secondary btn-sm";
    viewBtn.textContent = "보기";
    viewBtn.addEventListener("click", () => {
      // study.js의 렌더 함수를 재사용한다. 기록에서 연 것도 '저장된 결과'다.
      renderResult(item.data, { fromCache: true });
      navigateTo("#/study");
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn btn-ghost btn-sm";
    delBtn.textContent = "삭제";
    delBtn.addEventListener("click", () => removeResult(item.id));

    actions.append(viewBtn, delBtn);
    row.append(main, actions);
    box.append(row);
  });
}

function initHistory() {
  const clearBtn = document.getElementById("clear-history");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (confirm("저장된 기록을 모두 지울까요? 되돌릴 수 없습니다.")) {
        clearResults();
        showToast("기록을 모두 비웠어요.");
      }
    });
  }
  renderHistory();
}
