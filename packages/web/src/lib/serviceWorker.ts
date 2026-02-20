declare const __CODEPIPER_WEB_BUILD_ID__: string | undefined;

const DEFAULT_BUILD_ID = "dev";

function resolveBuildId(): string {
  const compileTimeBuildId =
    typeof __CODEPIPER_WEB_BUILD_ID__ === "string" ? __CODEPIPER_WEB_BUILD_ID__.trim() : "";
  const runtimeBuildId = (globalThis as typeof globalThis & { __CODEPIPER_WEB_BUILD_ID__?: string })
    .__CODEPIPER_WEB_BUILD_ID__;
  const runtimeBuildIdTrimmed = typeof runtimeBuildId === "string" ? runtimeBuildId.trim() : "";
  const buildId = compileTimeBuildId || runtimeBuildIdTrimmed;
  return buildId.length > 0 ? buildId : DEFAULT_BUILD_ID;
}

export function getServiceWorkerUrl(): string {
  return `/sw.js?v=${encodeURIComponent(resolveBuildId())}`;
}

export function sendSkipWaiting(registration: ServiceWorkerRegistration): void {
  if (registration.waiting) {
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
  }
}
