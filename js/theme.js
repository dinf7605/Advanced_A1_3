/* theme.js — 다크 모드 토글 (보너스 A, PRD §10.1)

   우선순위: 저장된 사용자 선택 > 시스템 설정 > 라이트
   ★ 최초 적용은 index.html <head>의 인라인 스크립트가 담당한다 ★
     여기서만 하면 화면이 그려진 뒤에 적용돼 흰 화면이 한 번 번쩍인다(FOUC). */

const THEME_KEY = "doesaegim.theme";

function currentTheme() {
  const saved = document.documentElement.dataset.theme;
  if (saved) return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* 시크릿 모드 등에서 저장이 막혀도 화면 전환은 되어야 한다 */
  }
  const btn = document.getElementById("theme-toggle");
  if (btn) {
    btn.firstElementChild.textContent = theme === "dark" ? "☀️" : "🌙";
    btn.setAttribute("aria-label", theme === "dark" ? "라이트 모드 전환" : "다크 모드 전환");
  }
}

function toggleTheme() {
  applyTheme(currentTheme() === "dark" ? "light" : "dark");
}

function initTheme() {
  applyTheme(currentTheme());
  const btn = document.getElementById("theme-toggle");
  if (btn) btn.addEventListener("click", toggleTheme);
}
