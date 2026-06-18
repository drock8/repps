self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  const title = data.title || "REPPs";
  const options = {
    body: data.body || "Time to hit your daily minimum!",
    icon: "/repps-icon-192.png",
    badge: "/repps-icon-192.png",
    tag: data.tag || "daily-reminder",
    data: { url: data.url || "/home" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/home";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SHOW_NOTIFICATION") {
    const { title, body, tag } = event.data;
    self.registration.showNotification(title || "REPPs", {
      body: body || "You haven't hit your daily minimum yet. Let's go!",
      icon: "/repps-icon-192.png",
      badge: "/repps-icon-192.png",
      tag: tag || "daily-reminder",
      data: { url: "/home" },
    });
  }
});
