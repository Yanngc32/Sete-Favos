// Aplica o tema salvo (ou o do sistema) e a densidade antes do primeiro desenho, pra não piscar.
// Arquivo externo porque a CSP da central não aceita script inline.
// Mantenha as chaves iguais às de src/lib/theme.ts ("casa-tema") e src/lib/density.ts ("casa-densidade").
(function () {
  try {
    var saved = localStorage.getItem("casa-tema");
    var dark = saved ? saved === "escuro" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = dark ? "escuro" : "claro";
    if (localStorage.getItem("casa-densidade") === "compacta") document.documentElement.dataset.density = "compacta";
  } catch (e) {
    /* sem localStorage: fica no claro, confortável */
  }
})();
