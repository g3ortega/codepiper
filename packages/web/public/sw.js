const SW_VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE_NAME = `codepiper-v${SW_VERSION}`;
const PRECACHE = ["/logo.svg"];
const DEFAULT_NOTIFICATION_TITLE = "CodePiper";
const DEFAULT_NOTIFICATION_BODY = "A session update is ready.";
const DEFAULT_NOTIFICATION_URL = "/sessions";

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parsePushPayload(event) {
  if (!event.data) {
    return {};
  }

  try {
    const parsed = event.data.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Fall through to plain-text payload handling.
  }

  try {
    const text = event.data.text();
    if (text) {
      return { body: text };
    }
  } catch {
    // Ignore and fallback to defaults.
  }

  return {};
}

function resolveNotificationUrl(payload) {
  if (typeof payload.url === "string" && payload.url.trim() !== "") {
    return payload.url;
  }

  if (typeof payload.sessionId === "string" && payload.sessionId.trim() !== "") {
    return `/sessions/${encodeURIComponent(payload.sessionId)}/terminal`;
  }

  return DEFAULT_NOTIFICATION_URL;
}

function toAbsoluteUrl(urlOrPath) {
  try {
    return new URL(urlOrPath, self.location.origin).toString();
  } catch {
    return new URL(DEFAULT_NOTIFICATION_URL, self.location.origin).toString();
  }
}

async function focusOrOpenClient(urlOrPath) {
  const targetUrl = toAbsoluteUrl(urlOrPath);
  const targetOrigin = new URL(targetUrl).origin;
  const windowClients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });

  for (const client of windowClients) {
    if (!(client && typeof client.url === "string")) {
      continue;
    }

    let clientOrigin;
    try {
      clientOrigin = new URL(client.url).origin;
    } catch {
      continue;
    }

    if (clientOrigin !== targetOrigin) {
      continue;
    }

    if ("navigate" in client && typeof client.navigate === "function" && client.url !== targetUrl) {
      try {
        await client.navigate(targetUrl);
      } catch {
        // If navigation fails, still attempt to focus the existing client.
      }
    }

    if (typeof client.focus === "function") {
      await client.focus();
      return;
    }
  }

  await self.clients.openWindow(targetUrl);
}

async function markNotificationRead(notificationId) {
  if (!Number.isInteger(notificationId)) {
    return;
  }

  try {
    await fetch(`/api/notifications/${notificationId}/read`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({ readSource: "click" }),
    });
  } catch {
    // Ignore read-sync failures; navigation is still the primary action.
  }
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((c) => c.addAll(PRECACHE))
      .catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
  );
  self.clients.claim();
});

self.addEventListener("push", (event) => {
  const payload = parsePushPayload(event);
  const title =
    typeof payload.title === "string" && payload.title.trim() !== ""
      ? payload.title
      : DEFAULT_NOTIFICATION_TITLE;
  const body =
    typeof payload.body === "string" && payload.body.trim() !== ""
      ? payload.body
      : DEFAULT_NOTIFICATION_BODY;
  const tag =
    typeof payload.tag === "string" && payload.tag.trim() !== ""
      ? payload.tag
      : "codepiper:notification";
  const url = resolveNotificationUrl(payload);

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon: "/apple-touch-icon.png",
      badge: "/logo.svg",
      data: {
        url,
        sessionId: typeof payload.sessionId === "string" ? payload.sessionId : null,
        notificationId: typeof payload.notificationId === "number" ? payload.notificationId : null,
      },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data;
  const targetUrl =
    data && typeof data.url === "string" && data.url.trim() !== ""
      ? data.url
      : DEFAULT_NOTIFICATION_URL;
  const notificationId =
    data && typeof data.notificationId === "number" ? data.notificationId : null;
  event.waitUntil(
    Promise.all([
      focusOrOpenClient(targetUrl),
      notificationId !== null ? markNotificationRead(notificationId) : Promise.resolve(),
    ])
  );
});

self.addEventListener("message", (event) => {
  if (!(isRecord(event.data) && event.data.type === "SKIP_WAITING")) {
    return;
  }
  self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(e.request.url);

  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  // Skip API, WebSocket, and auth routes entirely (never cache)
  if (
    requestUrl.pathname.startsWith("/api/") ||
    requestUrl.pathname === "/ws" ||
    requestUrl.pathname.startsWith("/auth/")
  ) {
    return;
  }

  // Navigation requests should always prefer fresh HTML to avoid stale mobile PWA shells.
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request, { cache: "no-store" }).catch(async () => {
        const cached = await caches.match(e.request);
        return cached || Response.error();
      })
    );
    return;
  }

  const CACHEABLE_EXTENSIONS = /\.(js|css|png|jpg|jpeg|gif|svg|woff2?|ttf|eot|ico|webmanifest)$/;
  const destination = e.request.destination;
  const isStaticAsset =
    destination === "script" ||
    destination === "style" ||
    destination === "image" ||
    destination === "font" ||
    destination === "manifest" ||
    CACHEABLE_EXTENSIONS.test(requestUrl.pathname);

  if (!isStaticAsset) {
    return;
  }

  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(e.request);
        if (response.ok) {
          await cache.put(e.request, response.clone());
        }
        return response;
      } catch {
        const cached = await cache.match(e.request);
        if (cached) {
          return cached;
        }
        return Response.error();
      }
    })()
  );
});
