self.addEventListener('push', function(event) {
    if (event.data) {
        const payload = event.data.json();
        
        const options = {
            body: payload.body,
            icon: '/static/faviconV2.png',
            badge: '/static/faviconV2.png',
            vibrate: [100, 50, 100],
            sound: '/static/sounds/notification.mp3',
            requireInteraction: false,
            silent: false,
            data: {
                url: payload.url || '/'
            }
        };

        event.waitUntil(
            self.registration.showNotification(payload.title, options)
        );
    }
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();

    event.waitUntil(
        clients.matchAll({type: 'window'}).then(windowClients => {
            // Check if there is already a window/tab open with the target URL
            for (var i = 0; i < windowClients.length; i++) {
                var client = windowClients[i];
                // If so, just focus it.
                if (client.url === event.notification.data.url && 'focus' in client) {
                    return client.focus();
                }
            }
            // If not, then open the target URL in a new window/tab.
            if (clients.openWindow) {
                return clients.openWindow(event.notification.data.url);
            }
        })
    );
});
