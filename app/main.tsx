import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { initTheme } from "@/lib/theme";
import { App } from "./App";
import "./index.css";

// The page itself is a static file the Worker doesn't see, so it moves itself to https before
// anyone types a password on it (the Worker redirects /api and /feed itself).
if (location.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) {
  location.replace(`https://${location.host}${location.pathname}${location.search}${location.hash}`);
}

initTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <App />
      <Toaster position="top-center" />
    </TooltipProvider>
  </StrictMode>,
);
