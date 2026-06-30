self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
    let data = { title: 'New Message', body: 'You have a new message on Jellychat', icon: '/icon-192.png' };
    
    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data.body = event.data.text();
        }
    }
    
    const options = {
        body: data.body,
        icon: data.icon,
        badge: '/icon-192.png',
        data: data.url || '/'
    };
    
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (let i = 0; i < clientList.length; i++) {
                if (clientList[i].focused) {
                    return; // Don't show notification if app is open
                }
            }
            return self.registration.showNotification(data.title, options);
        })
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then(windowClients => {
            for (var i = 0; i < windowClients.length; i++) {
                var client = windowClients[i];
                if ('focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow('/');
            }
        })
    );
});
