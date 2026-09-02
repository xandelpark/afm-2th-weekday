// 코워크 서비스워커 — 브라우저 창을 내려도 알림을 띄운다
self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = { title: '코워크', body: '알림', tag: 'default' };
  try { d = { ...d, ...event.data.json() }; } catch (e) { d.body = '(본문 해석 실패)'; }

  event.waitUntil((async () => {
    // 푸시가 브라우저까지 도달했음을 서버에 알린다 (알림이 안 뜰 때 어디서 끊겼는지 구분용)
    const ack = (stage, detail) =>
      fetch('/api/push/ack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: d.ack || null, stage, detail: detail || '' }),
      }).catch(() => {});

    await ack('received');
    try {
      // 아이콘은 넣지 않는다 — SVG data URI를 크롬이 거부하면 알림 자체가 안 뜬다
      await self.registration.showNotification(d.title, {
        body: d.body,
        tag: d.tag,
        renotify: true,
        requireInteraction: !!d.requireInteraction,
      });
      const shown = await self.registration.getNotifications({ tag: d.tag });
      await ack('shown', `count=${shown.length}`);
    } catch (e) {
      await ack('show_failed', String(e && e.message || e));
    }
  })());
});

// 알림 클릭 → 앱 창으로 이동(이미 열려 있으면 그 창을 앞으로)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) return c.focus();
      }
      return self.clients.openWindow('/');
    })
  );
});
