/* router.js — 해시 라우팅 + 네비 활성화 + 모바일 메뉴 (PRD §3.3, §4.3)

   JS의 역할이 가장 잘 드러나는 파일입니다.
   HTML에는 4개 <section>이 전부 들어 있고, "지금 어느 것을 보여줄지"를 JS가 정합니다. */

const ROUTES = ["/", "/study", "/history", "/guide"];

function currentRoute() {
  const hash = location.hash.replace(/^#/, "") || "/";
  return ROUTES.includes(hash) ? hash : "/";   // 알 수 없는 해시는 홈으로 폴백
}

function render() {
  const route = currentRoute();

  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("is-active", view.dataset.route === route);
  });

  // 현재 메뉴 강조 — 색뿐 아니라 aria-current로도 알린다 (스크린리더)
  document.querySelectorAll(".site-nav a").forEach((link) => {
    const target = link.getAttribute("href").replace(/^#/, "");
    if (target === route) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  closeNav();
  window.scrollTo({ top: 0, behavior: "instant" });

  // 기록 화면은 열 때마다 다시 그린다 (다른 탭에서 만든 결과가 있을 수 있다)
  if (route === "/history" && typeof renderHistory === "function") renderHistory();
}

function navigateTo(hash) {
  location.hash = hash;   // hashchange가 발생해 render()가 불린다
}

/* ── 모바일 메뉴 ─────────────────────────────────────────────── */
function openNav() {
  document.getElementById("site-nav").classList.add("is-open");
  document.getElementById("nav-toggle").setAttribute("aria-expanded", "true");
  document.body.classList.add("nav-open");
}

function closeNav() {
  document.getElementById("site-nav").classList.remove("is-open");
  document.getElementById("nav-toggle").setAttribute("aria-expanded", "false");
  document.body.classList.remove("nav-open");
}

function initRouter() {
  const toggle = document.getElementById("nav-toggle");
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") === "true";
    open ? closeNav() : openNav();
  });

  // Esc로도 닫힌다
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeNav();
  });

  // 화면을 키우면 오버레이 메뉴 상태가 남지 않도록 정리한다
  window.matchMedia("(min-width: 600px)").addEventListener("change", (e) => {
    if (e.matches) closeNav();
  });

  // ★ 뒤로 가기로도 섹션이 바뀌어야 한다 ★
  window.addEventListener("hashchange", render);
  render();
}
