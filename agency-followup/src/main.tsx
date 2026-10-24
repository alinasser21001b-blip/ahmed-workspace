import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  // A tap on a notification while the app is open: go to the task inside the app.
  navigator.serviceWorker.addEventListener("message", (e) => {
    const url = e.data?.type === "open" ? String(e.data.url ?? "") : "";
    if (url.startsWith("/") && !url.startsWith("//")) {
      history.pushState(null, "", url);
      dispatchEvent(new PopStateEvent("popstate"));
    }
  });
}
