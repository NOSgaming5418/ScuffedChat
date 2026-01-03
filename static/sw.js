self.addEventListener('push', function(event) {
    if (event.data) {
        const payload = event.data.json();
        
        const options = {
            body: payload.body,
            icon: '/static/faviconV2.png',
            badge: '/static/faviconV2.png',
            vibrate: [200, 100, 200, 100, 200],
            sound: '/static/sounds/notification.mp3',
            requireInteraction: false,
            silent: false,
            tag: 'message-notification',
            renotify: true,
            data: {
                url: payload.url || '/',
                timestamp: Date.now()
            }
        };

        event.waitUntil(
            Promise.all([
                // Show notification with sound
                self.registration.showNotification(payload.title, options),
                // Try to notify any open clients to play sound
                notifyClients(payload)
            ])
        );
    }
});

// Helper function to notify clients to play sound
async function notifyClients(payload) {
    try {
        const clients = await self.clients.matchAll({
            type: 'window',
            includeUncontrolled: true
        });
        
        // Send message to all clients (even background ones) to play sound
        for (const client of clients) {
            client.postMessage({
                type: 'PLAY_NOTIFICATION_SOUND',
                payload: payload
            });
        }
    } catch (error) {
        console.log('Could not notify clients:', error);
    }
}

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
