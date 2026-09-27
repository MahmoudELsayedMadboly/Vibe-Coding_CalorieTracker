import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.jsx";

// autoUpdate: the new service worker skips waiting and claims clients, and
// registerSW reloads open tabs onto the new bundle once it takes over. Check
// for a new deploy hourly and whenever the tab comes back into view, not
// only on navigation.
registerSW({
  immediate: true,
  onRegisteredSW(swUrl, registration) {
    if (!registration) return;
    setInterval(() => registration.update(), 60 * 60 * 1000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") registration.update();
    });
  },
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
