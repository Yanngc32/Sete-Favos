// index.css vem PRIMEIRO: fixa a ordem das camadas (theme, base, components, utilities) antes do CSS das telas.
import "./index.css";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, Outlet, RouterProvider } from "react-router";
import { Gate } from "@/app/Gate";
import { Shell, type RouteHandle } from "@/app/Shell";
import { FavosSprite } from "@/components/favos";
import { Toaster } from "@/components/toast";
import { useDensitySync } from "@/lib/density";
import { useThemeSync } from "@/lib/theme";
import { AjustesAcesso } from "@/screens/acesso/AjustesAcesso";
import { Ajustes } from "@/screens/ajustes/Ajustes";
import { Adicionar } from "@/screens/aparelhos/Adicionar";
import { Aparelhos } from "@/screens/aparelhos/Aparelhos";
import { Automacoes } from "@/screens/automacoes/Automacoes";
import { Detalhe } from "@/screens/detalhe/Detalhe";
import { Editor } from "@/screens/editor/Editor";
import { Inicio } from "@/screens/inicio/Inicio";

const noTabbar: RouteHandle = { noTabbar: true };

// Vitrine da base Sete Favos (components/favos): só em dev, fora do build de produção.
const FavosPreview = import.meta.env.DEV
  ? lazy(() => import("@/components/favos/FavosPreview").then((m) => ({ default: m.FavosPreview })))
  : null;

function Root() {
  useThemeSync();
  useDensitySync();
  return (
    <div className="mk">
      <FavosSprite />
      <Gate>
        <Outlet />
      </Gate>
      <Toaster />
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: "parear", element: <Navigate to="/" replace /> },
      {
        element: <Shell />,
        children: [
          // O detalhe abre por cima da Início (sheet no desktop, folha de baixo no celular).
          { path: "/", element: <Inicio />, children: [{ path: "aparelho/:id", element: <Detalhe /> }] },
          { path: "automacoes", element: <Automacoes /> },
          { path: "automacoes/:id", element: <Editor />, handle: noTabbar },
          { path: "dispositivos", element: <Aparelhos /> },
          { path: "dispositivos/novo", element: <Adicionar />, handle: noTabbar },
          // Endereços antigos (favoritos, PWA instalada): continuam abrindo a mesma tela.
          { path: "aparelhos", element: <Navigate to="/dispositivos" replace /> },
          { path: "aparelhos/novo", element: <Navigate to="/dispositivos/novo" replace /> },
          { path: "ajustes", element: <Ajustes /> },
          { path: "ajustes/acesso", element: <AjustesAcesso /> },
          ...(FavosPreview ? [{ path: "_favos", element: <Suspense><FavosPreview /></Suspense> }] : []),
          { path: "*", element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

// PWA: só registra em contexto seguro (HTTPS ou localhost); no HTTP da LAN o navegador recusa mesmo.
if ("serviceWorker" in navigator && window.isSecureContext && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
