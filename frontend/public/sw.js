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
        icon: data.icon || '/icon-192.png',
        badge: '/icon-192.png',
        vibrate: [100, 50, 100, 50, 200],
        data: data.url || '/',
        tag: data.tag || 'jellychat-notification',
        renotify: true,
        actions: [
            { action: 'open', title: 'Open Chat' },
            { action: 'dismiss', title: 'Dismiss' }
        ],
        // iOS requires these for proper display
        silent: false
    };
    
    // Always show the notification — don't suppress when app is focused
    // iOS PWAs need this to work at all
    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    
    if (event.action === 'dismiss') return;
    
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            // Focus existing window if found
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                if ('focus' in client) {
                    return client.focus();
                }
            }
            // Otherwise open a new window
            if (clients.openWindow) {
                return clients.openWindow(event.notification.data || '/');
            }
        })
    );
});

// Handle background sync for offline message queue
self.addEventListener('sync', (event) => {
    if (event.tag === 'send-pending-messages') {
        // Future: handle offline message queue
    }
});
