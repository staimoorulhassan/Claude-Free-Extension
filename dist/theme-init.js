(function () {
  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.setAttribute("data-mode", isDark ? "dark" : "light");
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function (e) {
    document.documentElement.setAttribute("data-mode", e.matches ? "dark" : "light");
  });
})();
