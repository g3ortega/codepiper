import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { getServiceWorkerUrl, sendSkipWaiting } from "./lib/serviceWorker";
import "./styles/globals.css";

const SW_UPDATE_INTERVAL_MS = 60_000;
let swReloadHandled = false;

function setupRegistrationAutoActivation(registration: ServiceWorkerRegistration): void {
  const handleInstallingWorker = () => {
    const installing = registration.installing;
    if (!installing) {
      return;
    }

    installing.addEventListener("statechange", () => {
      if (installing.state === "installed" && navigator.serviceWorker.controller) {
        sendSkipWaiting(registration);
      }
    });
  };

  registration.addEventListener("updatefound", handleInstallingWorker);
  handleInstallingWorker();
  sendSkipWaiting(registration);
}

function setupRegistrationUpdateChecks(registration: ServiceWorkerRegistration): void {
  const checkForUpdate = () => {
    void registration.update().catch(() => {
      // Keep update checks non-blocking.
    });
  };

  checkForUpdate();
  window.setInterval(checkForUpdate, SW_UPDATE_INTERVAL_MS);
  window.addEventListener("focus", checkForUpdate);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      checkForUpdate();
    }
  });
}

function registerServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (swReloadHandled) {
      return;
    }
    swReloadHandled = true;
    window.location.reload();
  });

  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register(getServiceWorkerUrl())
      .then((registration) => {
        setupRegistrationAutoActivation(registration);
        setupRegistrationUpdateChecks(registration);
      })
      .catch(() => {
        // Keep registration failures non-blocking for app boot.
      });
  });
}

registerServiceWorker();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
