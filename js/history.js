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

function saveResult(data, meta) {
  const item = {
    id: String(Date.now()),
    created_at: new Date().toISOString(),
    category: (meta && meta.category) || "일반",
    level: (meta && meta.level) || "보통",
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
      renderResult(item.data);           // study.js의 렌더 함수를 재사용한다
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
