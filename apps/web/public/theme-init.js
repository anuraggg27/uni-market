(() => {
  const saved = globalThis.localStorage.getItem("uni-market-theme");
  const theme =
    saved === "light" || saved === "dark"
      ? saved
      : globalThis.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  globalThis.document.documentElement.classList.toggle("dark", theme === "dark");
  globalThis.document.documentElement.dataset.theme = theme;
  globalThis.document.documentElement.style.colorScheme = theme;
  globalThis.document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#101211" : "#f8f2ea");
})();
