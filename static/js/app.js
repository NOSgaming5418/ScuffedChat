// App.js - Main application logic with Supabase

let currentUser = null;
let currentUserProfile = null;
let currentChat = null; // { type: 'dm' | 'group', id: string, user?: object, group?: object }
let conversations = [];
let groups = [];
let friends = [];
let friendRequests = [];
let disappearingMode = false;
let messageSubscription = null;
let replyingToMessage = null; // Track message being replied to
let mentionAutocomplete = null; // Track mention autocomplete state

// Online status tracking
const onlineUsers = new Map();

// Notification Manager for sound playback (works on mobile/desktop)
const NotificationManager = {
    audioContext: null,
    audioBuffer: null,
    customSoundLoaded: false,
    enabled: true,
    soundPath: '/static/sounds/notification.mp3',

    init() {
        // Initialize on first user interaction for mobile compatibility
        if (!this.audioContext) {
            try {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                // Try to load custom sound file
                this.loadCustomSound();
            } catch (e) {
                console.warn('AudioContext not supported:', e);
            }
        }
    },

    async loadCustomSound() {
        if (!this.audioContext || this.customSoundLoaded) return;

        try {
            const response = await fetch(this.soundPath);
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
                this.customSoundLoaded = true;
                console.log('Custom notification sound loaded successfully');
            }
        } catch (e) {
            console.log('Custom sound not found, using generated sound:', e.message);
        }
    },

    async playNotificationSound() {
        if (!this.enabled) return;

        try {
            // Initialize if needed
            if (!this.audioContext) {
                this.init();
            }

            if (this.audioContext && this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            if (!this.audioContext) return;

            // Play custom sound if loaded
            if (this.audioBuffer) {
                const source = this.audioContext.createBufferSource();
                const gainNode = this.audioContext.createGain();
                source.buffer = this.audioBuffer;
                gainNode.gain.setValueAtTime(0.5, this.audioContext.currentTime);
                source.connect(gainNode);
                gainNode.connect(this.audioContext.destination);
                source.start();
                return;
            }

            // Fallback: Create a pleasant notification sound using oscillators
            const ctx = this.audioContext;
            const now = ctx.currentTime;

            // First tone
            const osc1 = ctx.createOscillator();
            const gain1 = ctx.createGain();
            osc1.type = 'sine';
            osc1.frequency.setValueAtTime(880, now); // A5
            gain1.gain.setValueAtTime(0.3, now);
            gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
            osc1.connect(gain1);
            gain1.connect(ctx.destination);
            osc1.start(now);
            osc1.stop(now + 0.15);

            // Second tone (higher)
            const osc2 = ctx.createOscillator();
            const gain2 = ctx.createGain();
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(1320, now + 0.1); // E6
            gain2.gain.setValueAtTime(0.25, now + 0.1);
            gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
            osc2.connect(gain2);
            gain2.connect(ctx.destination);
            osc2.start(now + 0.1);
            osc2.stop(now + 0.3);

        } catch (e) {
            console.warn('Failed to play notification sound:', e);
        }
    }
};

// Initialize audio on first user interaction
document.addEventListener('click', () => NotificationManager.init(), { once: true });
document.addEventListener('touchstart', () => NotificationManager.init(), { once: true });

// Wait for Supabase to be initialized before running app
if (window.supabaseClient) {
    initializeApp();
} else {
    window.addEventListener('supabase-ready', initializeApp);
}

async function initializeApp() {
    // Check authentication
    try {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (!session) {
            window.location.href = '/';
            return;
        }
        currentUser = session.user;

        // Get user profile
        const { data: profile } = await window.supabaseClient
            .from('profiles')
            .select('*')
            .eq('id', currentUser.id)
            .single();

        if (profile) {
            currentUserProfile = profile;
            // Check if username needs to be set (for Google sign-in users)
            if (!profile.username || profile.username.includes('@') || profile.username === '') {
                showUsernameSetupModal();
                return; // Don't load app until username is set
            }
        } else {
            // Create profile if doesn't exist - trigger username setup
            const tempUsername = currentUser.email.split('@')[0];
            const { data: newProfile } = await window.supabaseClient
                .from('profiles')
                .insert({
                    id: currentUser.id,
                    username: tempUsername,
                    email: currentUser.email,
                    avatar: '',
                    created_at: new Date().toISOString()
                })
                .select()
                .single();
            currentUserProfile = newProfile;
            showUsernameSetupModal();
            return; // Don't load app until username is set
        }

        updateUserProfile();
    } catch (error) {
        console.error('Auth error:', error);
        window.location.href = '/';
        return;
    }

    // Load initial data
    await Promise.all([
        loadConversations(),
        loadGroups(),
        loadFriends(),
        loadFriendRequests()
    ]);

    // Setup real-time subscription for messages
    setupRealtimeSubscription();

    // Setup event listeners
    setupEventListeners();

    // Setup WebSocket for online status
    setupWebSocket();

    // Initialize Push Notifications
    initPushNotifications();
}

async function initPushNotifications() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        console.log('Push notifications not supported');
        return;
    }

    try {
        // Register Service Worker
        const registration = await navigator.serviceWorker.register('/static/sw.js');
        console.log('Service Worker registered');

        // Get VAPID key from backend
        const response = await fetch('/api/config');
        const config = await response.json();

        if (!config.vapidPublicKey) {
            console.warn('VAPID Public Key not found in config');
            return;
        }

        const serverKey = urlBase64ToUint8Array(config.vapidPublicKey);

        // Check if we already have a subscription
        let subscription = await registration.pushManager.getSubscription();

        if (subscription) {
            // Check if the key matches
            const currentKey = subscription.options.applicationServerKey;

            // Convert ArrayBuffers to verify equality if possible, or just re-subscribe if unsure
            // Easier way: Unsubscribe and resubscribe if keys might have changed
            // But we can check keys using strings comparison or byte comparison

            const existingKeyArray = new Uint8Array(currentKey);
            const serverKeyArray = new Uint8Array(serverKey);

            let keysMatch = true;
            if (existingKeyArray.length !== serverKeyArray.length) {
                keysMatch = false;
            } else {
                for (let i = 0; i < existingKeyArray.length; i++) {
                    if (existingKeyArray[i] !== serverKeyArray[i]) {
                        keysMatch = false;
                        break;
                    }
                }
            }

            if (!keysMatch) {
                console.log('VAPID key changed, unsubscribing...');
                await subscription.unsubscribe();
                subscription = null;
            }
        }

        if (!subscription) {
            // Check permission
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                console.log('Notification permission denied');
                return;
            }

            // Subscribe
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: serverKey
            });
            console.log('Subscribed to push notifications');
        }

        // Always save to Supabase to ensure it's up to date
        await savePushSubscription(subscription);

    } catch (error) {
        console.error('Push notification initialization failed:', error);
    }
}

async function savePushSubscription(subscription) {
    if (!currentUser) return;

    const subscriptionJson = subscription.toJSON();
    const endpoint = subscriptionJson.endpoint;
    const p256dh = subscriptionJson.keys.p256dh;
    const auth = subscriptionJson.keys.auth;

    try {
        // Upsert subscription
        const { error } = await window.supabaseClient
            .from('push_subscriptions')
            .upsert({
                user_id: currentUser.id,
                endpoint: endpoint,
                p256dh: p256dh,
                auth: auth
            }, { onConflict: 'user_id, endpoint' });

        if (error) throw error;
        console.log('Push subscription saved to Supabase');
    } catch (error) {
        console.error('Failed to save push subscription:', error);
    }
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/\-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

// Setup WebSocket connection and online status listeners
function setupWebSocket() {
    if (!window.wsClient) {
        console.warn('WebSocket client not available');
        return;
    }

    // Connect WebSocket
    window.wsClient.connect();
    
    // Start heartbeat to update last_seen (for online status)
    startOnlineStatusHeartbeat();
    
    // When connected, load online friends status
    window.wsClient.on('connected', async () => {
        console.log('WebSocket connected, updating online status');
        await updateLastSeen();
        await loadOnlineStatus();
    });

    // Listen for online status changes
    window.wsClient.on('online_status', (payload) => {
        const { user_id, online } = payload;

        if (online) {
            onlineUsers.set(user_id, true);
        } else {
            onlineUsers.delete(user_id);
        }

        // Update UI for friends list
        renderFriends();

        // Update UI for conversations
        renderConversations();

        // Update chat header if currently chatting with this user
        if (currentChat && currentChat.id === user_id) {
            updateChatOnlineStatus(online);
        }
    });
}

// Update last_seen timestamp in database (heartbeat)
async function updateLastSeen() {
    if (!currentUser) return;
    
    try {
        await window.supabaseClient
            .from('profiles')
            .update({ last_seen: new Date().toISOString() })
            .eq('id', currentUser.id);
    } catch (error) {
        console.error('Failed to update last_seen:', error);
    }
}

// Start periodic heartbeat to update last_seen
function startOnlineStatusHeartbeat() {
    // Update immediately
    updateLastSeen();
    
    // Update every 30 seconds
    setInterval(updateLastSeen, 30000);
    
    // Update when page becomes visible (tab switching)
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            updateLastSeen();
        }
    });
}

// Load online status for friends based on last_seen
async function loadOnlineStatus() {
    if (!friends || friends.length === 0) return;
    
    try {
        const friendIds = friends.map(f => f.id);
        
        // Consider users online if last_seen within last 2 minutes
        const onlineThreshold = new Date(Date.now() - 2 * 60 * 1000).toISOString();
        
        const { data, error } = await window.supabaseClient
            .from('profiles')
            .select('id, last_seen')
            .in('id', friendIds)
            .gte('last_seen', onlineThreshold);
        
        if (error) throw error;
        
        // Update onlineUsers map
        onlineUsers.clear();
        if (data) {
            data.forEach(profile => {
                onlineUsers.set(profile.id, true);
            });
        }
        
        // Update UI
        renderFriends();
        renderConversations();
        
        // Update chat if viewing someone
        if (currentChat && currentChat.type === 'dm') {
            const isOnline = onlineUsers.has(currentChat.id);
            updateChatOnlineStatus(isOnline);
        }
        
    } catch (error) {
        console.error('Failed to load online status:', error);
    }
}

// Periodically refresh online status
setInterval(loadOnlineStatus, 30000); // Check every 30 seconds

// Fetch online status for all friends from backend
async function updateOnlineStatusForFriends() {
    // This function is now replaced by loadOnlineStatus
    await loadOnlineStatus();
}

// Update chat header online status
function updateChatOnlineStatus(online) {
    const indicator = document.getElementById('chat-online-indicator');
    const status = document.getElementById('chat-status');

    if (indicator) {
        indicator.classList.toggle('offline', !online);
    }
    if (status) {
        status.textContent = online ? 'Online' : 'Offline';
        status.classList.toggle('online', online);
    }
}

function updateUserProfile() {
    if (currentUserProfile) {
        document.getElementById('username').textContent = currentUserProfile.username;

        // Update avatar display
        const avatarEl = document.getElementById('user-avatar');
        if (currentUserProfile.avatar && currentUserProfile.avatar.trim() !== '') {
            avatarEl.innerHTML = `<img src="${currentUserProfile.avatar}" alt="Avatar" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
        } else {
            avatarEl.textContent = currentUserProfile.username.charAt(0).toUpperCase();
        }
    }
}

function setupRealtimeSubscription() {
    // Subscribe to new messages
    messageSubscription = window.supabaseClient
        .channel('messages')
        .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'messages' },
            (payload) => {
                const message = payload.new;
                const isDirect = message.receiver_id && (message.receiver_id === currentUser.id || message.sender_id === currentUser.id);
                const isGroup = message.group_id && groups.some(g => g.id === message.group_id);

                if (!isDirect && !isGroup) return;

                const chatMatchesCurrent = currentChat && (
                    (currentChat.type === 'dm' && (message.sender_id === currentChat.id || message.receiver_id === currentChat.id)) ||
                    (currentChat.type === 'group' && message.group_id === currentChat.id)
                );

                if (chatMatchesCurrent && message.sender_id !== currentUser.id) {
                    appendMessage(message, true);
                }

                // Reload conversation lists
                loadConversations();
                loadGroups();

                if (message.sender_id !== currentUser.id) {
                    NotificationManager.playNotificationSound();
                }
            }
        )
        .on('postgres_changes',
            { event: 'DELETE', schema: 'public', table: 'messages' },
            (payload) => {
                const messageId = payload.old.id;
                // Remove from UI
                const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
                if (messageElement) {
                    messageElement.remove();
                }
                // Reload conversations
                loadConversations();
            }
        )
        .on('postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'messages' },
            (payload) => {
                const message = payload.new;
                // Update message in UI if it's in the current chat
                const matchesChat = currentChat && (
                    (currentChat.type === 'dm' && (message.sender_id === currentChat.id || message.receiver_id === currentChat.id)) ||
                    (currentChat.type === 'group' && message.group_id === currentChat.id)
                );

                if (matchesChat) {
                    const messageElement = document.querySelector(`[data-message-id="${message.id}"]`);
                    if (messageElement && message.edited) {
                        const contentDiv = messageElement.querySelector('.message-content');
                        if (contentDiv) {
                            contentDiv.textContent = message.content;

                            // Add or update edited indicator
                            let editedSpan = messageElement.querySelector('.message-edited');
                            if (!editedSpan) {
                                editedSpan = document.createElement('span');
                                editedSpan.className = 'message-edited';
                                editedSpan.textContent = '(edited)';
                                const timeDiv = messageElement.querySelector('.message-time');
                                if (timeDiv) {
                                    timeDiv.insertBefore(editedSpan, timeDiv.firstChild);
                                }
                            }
                        }
                    }
                }
                // Reload conversations to update preview
                loadConversations();
            }
        )
        .subscribe();

    // Subscribe to friend requests
    window.supabaseClient
        .channel('friends')
        .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'friends', filter: `friend_id=eq.${currentUser.id}` },
            () => {
                loadFriendRequests();
                showToast('New friend request!', 'success');
            }
        )
        .subscribe();
}

function setupEventListeners() {
    // Profile click to edit
    document.getElementById('user-profile').addEventListener('click', () => {
        openProfileEditModal();
    });

    // Logout
    document.getElementById('logout-btn').addEventListener('click', async () => {
        try {
            await window.supabaseClient.auth.signOut();
            window.location.href = '/';
        } catch (error) {
            console.error('Logout failed:', error);
        }
    });

    // Navigation tabs
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const view = tab.dataset.view;

            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            document.getElementById('chats-view').classList.toggle('hidden', view !== 'chats');
            document.getElementById('groups-view').classList.toggle('hidden', view !== 'groups');
            document.getElementById('friends-view').classList.toggle('hidden', view !== 'friends');
        });
    });

    // Search conversations
    document.getElementById('search-conversations').addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        filterConversations(query);
    });

    // Add friend
    document.getElementById('add-friend-btn').addEventListener('click', addFriend);
    document.getElementById('add-friend-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addFriend();
        }
    });

    // Groups
    document.getElementById('add-group-btn').addEventListener('click', () => {
        openCreateGroupModal();
    });
    document.getElementById('search-groups').addEventListener('input', (e) => {
        filterGroups(e.target.value.toLowerCase());
    });
    document.getElementById('create-group-btn').addEventListener('click', createGroup);

    // Back button (mobile)
    document.getElementById('btn-back').addEventListener('click', () => {
        document.getElementById('chat-empty').classList.remove('hidden');
        document.getElementById('chat-active').classList.add('hidden');
        document.getElementById('sidebar').classList.remove('hidden');
        currentChat = null;
    });

    // Chat user info click (open group settings for groups)
    document.getElementById('chat-user-info').addEventListener('click', () => {
        if (currentChat && currentChat.type === 'group') {
            openGroupSettings(currentChat.id);
        }
    });

    // Toggle disappearing messages
    document.getElementById('toggle-disappear').addEventListener('click', () => {
        disappearingMode = !disappearingMode;
        document.getElementById('toggle-disappear').classList.toggle('active', disappearingMode);
        document.getElementById('disappear-badge').classList.toggle('hidden', !disappearingMode);
    });

    // Send message
    document.getElementById('send-btn').addEventListener('click', sendMessage);
    document.getElementById('message-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Image upload
    document.getElementById('image-btn').addEventListener('click', () => {
        document.getElementById('image-input').click();
    });

    document.getElementById('image-input').addEventListener('change', handleImageUpload);

    // Context menu for messages
    document.addEventListener('click', () => {
        document.getElementById('message-context-menu').style.display = 'none';
    });
}

// API Functions using Supabase

async function loadConversations() {
    try {
        // Get messages where user is sender or receiver
        const { data: messages, error } = await window.supabaseClient
            .from('messages')
            .select('*, sender:profiles!messages_sender_id_fkey(*), receiver:profiles!messages_receiver_id_fkey(*)')
            .or(`sender_id.eq.${currentUser.id},receiver_id.eq.${currentUser.id}`)
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Group by conversation partner
        const convMap = new Map();
        for (const msg of messages || []) {
            const partnerId = msg.sender_id === currentUser.id ? msg.receiver_id : msg.sender_id;
            const partner = msg.sender_id === currentUser.id ? msg.receiver : msg.sender;

            if (!convMap.has(partnerId)) {
                convMap.set(partnerId, {
                    user: partner,
                    last_message: msg,
                    unread_count: 0
                });
            }

            // Count unread
            if (msg.sender_id === partnerId && !msg.read_at) {
                const conv = convMap.get(partnerId);
                conv.unread_count++;
            }
        }

        conversations = Array.from(convMap.values());
        renderConversations();
    } catch (error) {
        console.error('Failed to load conversations:', error);
    }
}

async function loadGroups() {
    try {
        const { data, error } = await window.supabaseClient
            .from('group_members')
            .select('group:group_chats(*)')
            .eq('member_id', currentUser.id);

        if (error) throw error;

        groups = (data || []).map(entry => entry.group || {});

        renderGroups();
    } catch (error) {
        console.error('Failed to load groups:', error);
    }
}

async function loadFriends() {
    try {
        const { data, error } = await window.supabaseClient
            .from('friends')
            .select('*, friend:profiles!friends_friend_id_fkey(*), user:profiles!friends_user_id_fkey(*)')
            .or(`user_id.eq.${currentUser.id},friend_id.eq.${currentUser.id}`)
            .eq('status', 'accepted');

        if (error) throw error;

        // Get the friend's profile (not current user's)
        friends = (data || []).map(f => {
            return f.user_id === currentUser.id ? f.friend : f.user;
        }).filter(f => f && f.id !== currentUser.id);

        renderFriends();
    } catch (error) {
        console.error('Failed to load friends:', error);
    }
}

async function loadFriendRequests() {
    try {
        const { data, error } = await window.supabaseClient
            .from('friends')
            .select('*, user:profiles!friends_user_id_fkey(*)')
            .eq('friend_id', currentUser.id)
            .eq('status', 'pending');

        if (error) throw error;

        friendRequests = (data || []).map(req => ({
            id: req.id,
            from: req.user,
            status: req.status,
            created_at: req.created_at
        }));

        renderFriendRequests();
    } catch (error) {
        console.error('Failed to load friend requests:', error);
    }
}

async function loadMessagesForChat() {
    if (!currentChat) return;

    if (currentChat.type === 'dm') {
        await loadDirectMessages(currentChat.id);
    } else if (currentChat.type === 'group') {
        await loadGroupMessages(currentChat.id);
    }
}

async function loadDirectMessages(partnerId) {
    try {
        const { data: messages, error } = await window.supabaseClient
            .from('messages')
            .select('*, sender:profiles!messages_sender_id_fkey(*)')
            .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${currentUser.id})`)
            .order('created_at', { ascending: true });

        if (error) throw error;

        renderMessages(messages || []);

        // Mark messages as read
        await window.supabaseClient
            .from('messages')
            .update({ read_at: new Date().toISOString() })
            .eq('sender_id', partnerId)
            .eq('receiver_id', currentUser.id)
            .is('read_at', null);

    } catch (error) {
        console.error('Failed to load messages:', error);
    }
}

async function loadGroupMessages(groupId) {
    try {
        const { data: messages, error } = await window.supabaseClient
            .from('messages')
            .select('*, sender:profiles!messages_sender_id_fkey(*)')
            .eq('group_id', groupId)
            .order('created_at', { ascending: true });

        if (error) throw error;

        renderMessages(messages || []);

    } catch (error) {
        console.error('Failed to load group messages:', error);
    }
}

async function sendMessage() {
    const input = document.getElementById('message-input');
    const content = input.value.trim();

    if (!content || !currentChat) return;

    try {
        const messageData = {
            sender_id: currentUser.id,
            content: content,
            type: 'text',
            created_at: new Date().toISOString()
        };

        if (currentChat.type === 'dm') {
            messageData.receiver_id = currentChat.id;
        } else if (currentChat.type === 'group') {
            messageData.group_id = currentChat.id;
        }

        if (disappearingMode) {
            messageData.expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        }

        // Add reply context if replying
        if (replyingToMessage) {
            messageData.replied_to_message_id = replyingToMessage.id;
        }

        // Extract @mentions from content
        const mentions = extractMentions(content);
        if (mentions.length > 0) {
            messageData.mentions = mentions;
        }

        const { data: message, error } = await window.supabaseClient
            .from('messages')
            .insert(messageData)
            .select()
            .single();

        if (error) throw error;

        appendMessage(message, false);
        input.value = '';
        
        // Clear reply context
        clearReplyContext();

        // Scroll to bottom
        const container = document.getElementById('messages-container');
        container.scrollTop = container.scrollHeight;

    } catch (error) {
        console.error('Failed to send message:', error);
        showToast('Failed to send message', 'error');
    }
}

async function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file || !currentChat) {
        showToast('No file selected or chat not open', 'error');
        return;
    }

    // Check file size (10MB limit)
    if (file.size > 10 * 1024 * 1024) {
        showToast('Image must be less than 10MB', 'error');
        e.target.value = '';
        return;
    }

    // Check if it's an image
    if (!file.type.startsWith('image/')) {
        showToast('Please select an image file', 'error');
        e.target.value = '';
        return;
    }

    try {
        showToast('Uploading image...', 'success');

        // Convert image to base64 and send directly in message
        const reader = new FileReader();
        reader.onload = async function (event) {
            try {
                const base64Image = event.target.result;

                // Send message with base64 image
                const messageData = {
                    sender_id: currentUser.id,
                    content: base64Image,
                    type: 'image',
                    created_at: new Date().toISOString()
                };

                if (currentChat.type === 'dm') {
                    messageData.receiver_id = currentChat.id;
                } else if (currentChat.type === 'group') {
                    messageData.group_id = currentChat.id;
                }

                if (disappearingMode) {
                    messageData.expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
                }

                const { data: message, error } = await window.supabaseClient
                    .from('messages')
                    .insert(messageData)
                    .select()
                    .single();

                if (error) {
                    console.error('Database error:', error);
                    throw error;
                }

                appendMessage(message, false);

                // Scroll to bottom
                const container = document.getElementById('messages-container');
                container.scrollTop = container.scrollHeight;

            } catch (error) {
                console.error('Failed to send image:', error);
                showToast('Failed to send image: ' + error.message, 'error');
            }
        };

        reader.onerror = function () {
            showToast('Failed to read image file', 'error');
        };

        reader.readAsDataURL(file);

    } catch (error) {
        console.error('Failed to upload image:', error);
        showToast('Failed to upload image: ' + error.message, 'error');
    } finally {
        e.target.value = '';
    }
}

async function addFriend() {
    const input = document.getElementById('add-friend-input');
    const username = input.value.trim();

    if (!username) return;

    try {
        // Find user by username
        const { data: user, error: findError } = await window.supabaseClient
            .from('profiles')
            .select('*')
            .eq('username', username)
            .single();

        if (findError || !user) {
            showToast('User not found', 'error');
            return;
        }

        if (user.id === currentUser.id) {
            showToast('You cannot add yourself', 'error');
            return;
        }

        // Check if already friends or pending
        const { data: existing } = await window.supabaseClient
            .from('friends')
            .select('*')
            .or(`and(user_id.eq.${currentUser.id},friend_id.eq.${user.id}),and(user_id.eq.${user.id},friend_id.eq.${currentUser.id})`)
            .single();

        if (existing) {
            showToast(existing.status === 'accepted' ? 'Already friends' : 'Request already pending', 'error');
            return;
        }

        // Create friend request
        const { error: insertError } = await window.supabaseClient
            .from('friends')
            .insert({
                user_id: currentUser.id,
                friend_id: user.id,
                status: 'pending',
                created_at: new Date().toISOString()
            });

        if (insertError) throw insertError;

        input.value = '';
        showToast('Friend request sent!', 'success');

    } catch (error) {
        console.error('Failed to add friend:', error);
        showToast('Failed to send friend request', 'error');
    }
}

async function acceptFriendRequest(requestId) {
    try {
        const { error } = await window.supabaseClient
            .from('friends')
            .update({ status: 'accepted' })
            .eq('id', requestId);

        if (error) throw error;

        showToast('Friend request accepted!', 'success');
        await Promise.all([loadFriends(), loadFriendRequests()]);

    } catch (error) {
        showToast('Failed to accept request', 'error');
    }
}

async function declineFriendRequest(requestId) {
    try {
        const { error } = await window.supabaseClient
            .from('friends')
            .delete()
            .eq('id', requestId);

        if (error) throw error;

        showToast('Friend request declined', 'success');
        await loadFriendRequests();

    } catch (error) {
        showToast('Failed to decline request', 'error');
    }
}

// Render Functions

function renderConversations() {
    const container = document.getElementById('conversations-list');

    if (!conversations || conversations.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">💬</div>
                <p>No conversations yet</p>
                <span>Add friends to start chatting!</span>
            </div>
        `;
        return;
    }

    container.innerHTML = conversations.map(conv => {
        const isOnline = onlineUsers.has(conv.user.id);
        const unreadDisplay = conv.unread_count > 9 ? '9+' : conv.unread_count;

        return `
        <button class="conversation-item ${currentChat && currentChat.type === 'dm' && currentChat.id === conv.user.id ? 'active' : ''}" 
                data-user-id="${conv.user.id}"
                onclick="openChat('${conv.user.id}')">
            <div class="avatar">
                ${conv.user.avatar ?
                `<img src="${conv.user.avatar}" alt="${escapeHtml(conv.user.username)}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">` :
                `<span>${conv.user.username.charAt(0).toUpperCase()}</span>`
            }
                <span class="online-indicator ${isOnline ? '' : 'offline'}"></span>
            </div>
            <div class="conversation-info">
                <div class="conversation-name">
                    <span class="conversation-username">${escapeHtml(conv.user.username)}</span>
                    ${conv.last_message ? `
                        <span class="conversation-time">${formatTime(conv.last_message.created_at)}</span>
                    ` : ''}
                </div>
                <div class="conversation-preview">
                    <span>${conv.last_message ? escapeHtml(truncate(conv.last_message.content, 30)) : 'Start a conversation'}</span>
                    ${conv.unread_count > 0 ? `<span class="unread-badge">${unreadDisplay}</span>` : ''}
                </div>
            </div>
        </button>
    `;
    }).join('');
}

function renderGroups() {
    const container = document.getElementById('groups-list');

    if (!groups || groups.length === 0) {
        container.innerHTML = `
            <div class="empty-state small">
                <p>No groups yet</p>
                <span>Create one to start!</span>
            </div>
        `;
        return;
    }

    container.innerHTML = groups.map(group => {
        const memberCount = group.member_count || 0;
        const activeClass = currentChat && currentChat.type === 'group' && currentChat.id === group.id ? 'active' : '';
        return `
        <button class="conversation-item ${activeClass}" data-group-id="${group.id}" onclick="openGroupChat('${group.id}')">
            <div class="avatar">
                ${group.avatar ?
                `<img src="${group.avatar}" alt="${escapeHtml(group.name)}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">` :
                `<span>${escapeHtml(group.name.charAt(0).toUpperCase())}</span>`
            }
                <span class="online-indicator offline"></span>
            </div>
            <div class="conversation-info">
                <div class="conversation-name">
                    <span class="conversation-username">${escapeHtml(group.name)}</span>
                    <span class="conversation-time">${memberCount} member${memberCount === 1 ? '' : 's'}</span>
                </div>
                <div class="conversation-preview">
                    <span>${group.last_message ? escapeHtml(truncate(group.last_message.content || '', 30)) : 'Start a conversation'}</span>
                    ${group.unread_count && group.unread_count > 0 ? `<span class="unread-badge">${group.unread_count > 9 ? '9+' : group.unread_count}</span>` : ''}
                </div>
            </div>
        </button>
    `;
    }).join('');
}

function filterGroups(query) {
    const items = document.querySelectorAll('.groups-list .conversation-item');
    items.forEach(item => {
        const name = item.querySelector('.conversation-username').textContent.toLowerCase();
        item.style.display = name.includes(query) ? '' : 'none';
    });
}

function openCreateGroupModal() {
    const modal = document.getElementById('create-group-modal');
    document.getElementById('group-name-input').value = '';
    document.getElementById('group-members-input').value = '';
    document.getElementById('group-error').style.display = 'none';
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeCreateGroupModal() {
    const modal = document.getElementById('create-group-modal');
    modal.style.display = 'none';
    document.body.style.overflow = '';
}

async function createGroup() {
    const nameInput = document.getElementById('group-name-input');
    const membersInput = document.getElementById('group-members-input');
    const errorDiv = document.getElementById('group-error');
    const saveBtn = document.getElementById('create-group-btn');

    const groupName = nameInput.value.trim();
    const usernames = membersInput.value
        .split(',')
        .map(u => u.trim())
        .filter(u => u.length > 0);

    if (groupName.length < 3) {
        errorDiv.textContent = 'Group name must be at least 3 characters';
        errorDiv.style.display = 'block';
        return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Creating...';
    errorDiv.style.display = 'none';

    try {
        // Fetch member profiles
        let memberProfiles = [];
        if (usernames.length > 0) {
            const { data: profiles, error: profileError } = await window.supabaseClient
                .from('profiles')
                .select('id, username')
                .in('username', usernames);

            if (profileError) throw profileError;
            memberProfiles = profiles || [];
        }

        // Create group
        const { data: group, error: groupError } = await window.supabaseClient
            .from('group_chats')
            .insert({
                name: groupName,
                creator_id: currentUser.id,
                created_at: new Date().toISOString()
            })
            .select()
            .single();

        if (groupError) throw groupError;

        // Build members list (ensure creator included)
        const memberRows = [currentUser.id, ...memberProfiles.map(p => p.id)]
            .filter((id, index, arr) => arr.indexOf(id) === index)
            .map(id => ({ group_id: group.id, member_id: id, joined_at: new Date().toISOString() }));

        if (memberRows.length > 0) {
            const { error: memberError } = await window.supabaseClient
                .from('group_members')
                .insert(memberRows);
            if (memberError) throw memberError;
        }

        await loadGroups();
        closeCreateGroupModal();
        showToast('Group created', 'success');

    } catch (error) {
        console.error('Failed to create group:', error);
        errorDiv.textContent = 'Failed to create group';
        errorDiv.style.display = 'block';
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Create';
    }
}

function filterConversations(query) {
    const items = document.querySelectorAll('.conversation-item');
    items.forEach(item => {
        const username = item.querySelector('.conversation-username').textContent.toLowerCase();
        item.style.display = username.includes(query) ? '' : 'none';
    });
}

function renderFriends() {
    const container = document.getElementById('friends-list');

    if (!friends || friends.length === 0) {
        container.innerHTML = `
            <div class="empty-state small">
                <p>No friends yet</p>
            </div>
        `;
        return;
    }

    container.innerHTML = friends.map(friend => {
        const isOnline = onlineUsers.has(friend.id);

        return `
        <div class="friend-item">
            <div class="avatar">
                ${friend.avatar ?
                `<img src="${friend.avatar}" alt="${escapeHtml(friend.username)}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">` :
                `<span>${friend.username.charAt(0).toUpperCase()}</span>`
            }
                <span class="online-indicator ${isOnline ? '' : 'offline'}"></span>
            </div>
            <div class="friend-info">
                <span class="friend-name">${escapeHtml(friend.username)}</span>
                <span class="friend-status ${isOnline ? 'online' : ''}">${isOnline ? 'Online' : 'Offline'}</span>
            </div>
            <div class="friend-actions">
                <button class="btn-message" onclick="openChat('${friend.id}')">Message</button>
            </div>
        </div>
    `;
    }).join('');
}

function renderFriendRequests() {
    const container = document.getElementById('friend-requests-list');
    const section = document.getElementById('friend-requests-section');
    const badge = document.getElementById('friend-requests-badge');

    if (!friendRequests || friendRequests.length === 0) {
        section.style.display = 'none';
        badge.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    badge.style.display = 'flex';
    badge.textContent = friendRequests.length;

    container.innerHTML = friendRequests.map(req => {
        const username = escapeHtml(req.from.username);
        const initial = req.from.username.charAt(0).toUpperCase();
        return `
            <div class="friend-item" data-request-id="${req.id}" data-username="${username}" style="cursor: pointer;">
                <div class="avatar">
                    ${req.from.avatar ?
                `<img src="${req.from.avatar}" alt="${username}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">` :
                `<span>${initial}</span>`
            }
                </div>
                <div class="friend-info">
                    <span class="friend-name">${username}</span>
                    <span class="friend-status">Wants to be friends</span>
                </div>
                <div class="friend-actions" onclick="event.stopPropagation();">
                    <button class="btn-accept" onclick="acceptFriendRequest(${req.id})">Accept</button>
                    <button class="btn-decline" onclick="declineFriendRequest(${req.id})">Decline</button>
                </div>
            </div>
        `;
    }).join('');

    // Add click handlers
    container.querySelectorAll('.friend-item').forEach(item => {
        item.addEventListener('click', () => {
            const requestId = item.getAttribute('data-request-id');
            const username = item.getAttribute('data-username');
            showFriendRequestModal(requestId, username);
        });
    });
}

function renderMessages(messages) {
    const container = document.getElementById('messages-list');

    if (!messages || messages.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>No messages yet</p>
                <span>Say hello! 👋</span>
            </div>
        `;
        return;
    }

    container.innerHTML = messages.map(msg => createMessageHTML(msg, msg.sender_id !== currentUser.id)).join('');

    // Scroll to bottom
    const messagesContainer = document.getElementById('messages-container');
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function appendMessage(message, received) {
    const container = document.getElementById('messages-list');
    const emptyState = container.querySelector('.empty-state');

    if (emptyState) {
        emptyState.remove();
    }

    container.insertAdjacentHTML('beforeend', createMessageHTML(message, received));

    // Scroll to bottom
    const messagesContainer = document.getElementById('messages-container');
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function createMessageHTML(message, received) {
    const hasExpiry = message.expires_at != null;
    const isImage = message.type === 'image';
    const isEdited = message.edited || false;
    const hasReply = message.replied_to_message_id != null;

    let contentHTML;
    if (isImage) {
        contentHTML = `<img src="${escapeHtml(message.content)}" alt="Image" class="message-image" loading="lazy" onclick="openImageViewer('${escapeHtml(message.content)}')">`;
    } else {
        // Apply mention highlighting
        const highlightedContent = highlightMentions(escapeHtml(message.content));
        contentHTML = `<div class="message-content">${highlightedContent}</div>`;
    }
    
    // Reply preview HTML (if message is a reply)
    let replyHTML = '';
    if (hasReply) {
        // Note: In a full implementation, you'd fetch the replied-to message
        // For now, we'll show a simple indicator
        replyHTML = `
            <div class="message-reply-preview">
                <div class="reply-indicator"></div>
                <div class="reply-text">Replying to a message</div>
            </div>
        `;
    }

    return `
        <div class="message ${received ? 'received' : 'sent'}" 
             data-message-id="${message.id}" 
             oncontextmenu="showMessageContextMenu(event, ${message.id}, ${!received})"
             ontouchstart="handleLongPressStart(event, ${message.id}, ${!received})"
             ontouchend="handleLongPressEnd()"
             ontouchmove="handleLongPressEnd()">
            <div class="message-bubble">
                ${replyHTML}
                ${contentHTML}
                <div class="message-time">
                    ${isEdited ? '<span class="message-edited">(edited)</span>' : ''}
                    ${hasExpiry ? `
                        <span class="message-disappear">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"/>
                                <polyline points="12 6 12 12 16 14"/>
                            </svg>
                        </span>
                    ` : ''}
                    ${formatTime(message.created_at)}
                </div>
            </div>
        </div>
    `;
}

window.openChat = async function (partnerId) {
    // Find user info
    let user = conversations.find(c => c.user.id === partnerId)?.user;
    if (!user) {
        user = friends.find(f => f.id === partnerId);
    }

    if (!user) {
        // Try to fetch from supabase
        const { data } = await window.supabaseClient
            .from('profiles')
            .select('*')
            .eq('id', partnerId)
            .single();
        user = data;
    }

    if (!user) {
        showToast('User not found', 'error');
        return;
    }

    currentChat = { type: 'dm', id: user.id, user };

    // Update UI
    document.getElementById('chat-empty').classList.add('hidden');
    document.getElementById('chat-active').classList.remove('hidden');
    document.getElementById('sidebar').classList.add('hidden'); // Mobile

    // Update chat header
    const chatAvatar = document.getElementById('chat-avatar');
    if (user.avatar) {
        chatAvatar.innerHTML = `<img src="${user.avatar}" alt="${user.username}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
    } else {
        chatAvatar.textContent = user.username.charAt(0).toUpperCase();
    }
    document.getElementById('chat-username').textContent = user.username;

    // Set online status
    const isOnline = onlineUsers.has(user.id);
    updateChatOnlineStatus(isOnline);

    // Update active conversation
    document.querySelectorAll('.conversation-item').forEach(item => {
        item.classList.toggle('active', item.dataset.userId === partnerId);
    });

    // Load messages
    await loadMessagesForChat();

    // Refresh conversations to update unread count
    loadConversations();
}

window.openGroupChat = async function (groupId) {
    const group = groups.find(g => `${g.id}` === `${groupId}`);
    if (!group) {
        showToast('Group not found', 'error');
        return;
    }

    currentChat = { type: 'group', id: group.id, group };

    // Update UI
    document.getElementById('chat-empty').classList.add('hidden');
    document.getElementById('chat-active').classList.remove('hidden');
    document.getElementById('sidebar').classList.add('hidden');

    // Update chat header (no online indicator for groups)
    const chatAvatar = document.getElementById('chat-avatar');
    if (group.avatar) {
        chatAvatar.innerHTML = `<img src="${group.avatar}" alt="${group.name}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
    } else {
        chatAvatar.textContent = group.name.charAt(0).toUpperCase();
    }
    document.getElementById('chat-username').textContent = group.name;
    updateChatOnlineStatus(false);
    document.getElementById('chat-status').textContent = `${group.member_count || 0} members`;

    document.querySelectorAll('.conversation-item').forEach(item => {
        const isGroupItem = item.getAttribute('data-group-id');
        item.classList.toggle('active', isGroupItem && `${isGroupItem}` === `${group.id}`);
    });

    await loadMessagesForChat();
};

// Utility Functions

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function truncate(text, length) {
    if (text.length <= length) return text;
    return text.substring(0, length) + '...';
}

function formatTime(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;

    // Less than 1 minute
    if (diff < 60000) return 'now';

    // Less than 1 hour
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;

    // Less than 24 hours
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;

    // Same year
    if (date.getFullYear() === now.getFullYear()) {
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${type === 'success' ? '✓' : '✕'}</span>
        <span class="toast-message">${escapeHtml(message)}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'toastIn 0.3s ease-out reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function showFriendRequestModal(requestId, username) {
    const modal = document.getElementById('friend-request-modal');
    const avatarText = document.getElementById('modal-avatar-text');
    const usernameEl = document.getElementById('modal-username');
    const acceptBtn = document.getElementById('modal-accept-btn');
    const declineBtn = document.getElementById('modal-decline-btn');

    avatarText.textContent = username.charAt(0).toUpperCase();
    usernameEl.textContent = username;

    acceptBtn.onclick = () => {
        acceptFriendRequest(requestId);
        closeFriendRequestModal();
    };

    declineBtn.onclick = () => {
        declineFriendRequest(requestId);
        closeFriendRequestModal();
    };

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeFriendRequestModal() {
    const modal = document.getElementById('friend-request-modal');
    modal.style.display = 'none';
    document.body.style.overflow = '';
}

let selectedMessageId = null;
let longPressTimer = null;

function showMessageContextMenu(event, messageId, isSentByMe) {
    event.preventDefault();

    selectedMessageId = messageId;
    const menu = document.getElementById('message-context-menu');

    menu.style.display = 'block';

    // Position menu to the left of cursor
    const menuWidth = 180; // min-width from CSS
    menu.style.left = (event.pageX - menuWidth - 10) + 'px';
    menu.style.top = event.pageY + 'px';

    // Set up button handlers
    const replyBtn = document.getElementById('reply-message-btn');
    const deleteBtn = document.getElementById('delete-message-btn');
    const editBtn = document.getElementById('edit-message-btn');

    replyBtn.onclick = () => {
        replyToMessage(messageId);
        menu.style.display = 'none';
    };
    
    // Only show edit/delete for own messages
    if (isSentByMe) {
        deleteBtn.style.display = 'flex';
        editBtn.style.display = 'flex';
        deleteBtn.onclick = () => deleteMessage(messageId);
        editBtn.onclick = () => editMessage(messageId);
    } else {
        deleteBtn.style.display = 'none';
        editBtn.style.display = 'none';
    }
}

function handleLongPressStart(event, messageId, isSentByMe) {
    longPressTimer = setTimeout(() => {
        // Trigger context menu on long press
        showMessageContextMenu(event, messageId, isSentByMe);
    }, 500); // 500ms long press
}

function handleLongPressEnd() {
    if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
    }
}

let editingMessageId = null;

async function editMessage(messageId) {
    try {
        // Hide context menu
        document.getElementById('message-context-menu').style.display = 'none';

        // Get the message element
        const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
        if (!messageElement) return;

        // Get current message content
        const contentDiv = messageElement.querySelector('.message-content');
        if (!contentDiv) return; // Can't edit image messages

        const currentContent = contentDiv.textContent;

        // Show modal with current content
        const modal = document.getElementById('edit-message-modal');
        const textarea = document.getElementById('edit-message-textarea');
        const errorDiv = document.getElementById('edit-error');
        const saveBtn = document.getElementById('edit-message-save-btn');

        textarea.value = currentContent;
        errorDiv.style.display = 'none';
        editingMessageId = messageId;

        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';

        // Focus textarea
        textarea.focus();
        textarea.select();

        // Setup save handler
        saveBtn.onclick = async () => {
            const newContent = textarea.value.trim();

            if (newContent === '' || newContent === currentContent) {
                closeEditMessageModal();
                return;
            }

            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';

            try {
                // Update in database
                const { error } = await window.supabaseClient
                    .from('messages')
                    .update({
                        content: newContent,
                        edited: true,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', messageId)
                    .eq('sender_id', currentUser.id);

                if (error) {
                    console.error('Edit error:', error);
                    throw error;
                }

                // Update UI
                contentDiv.textContent = newContent;

                // Add edited indicator if not present
                let editedSpan = messageElement.querySelector('.message-edited');
                if (!editedSpan) {
                    editedSpan = document.createElement('span');
                    editedSpan.className = 'message-edited';
                    editedSpan.textContent = ' (edited)';
                    const timeDiv = messageElement.querySelector('.message-time');
                    if (timeDiv) {
                        timeDiv.appendChild(editedSpan);
                    }
                }

                showToast('Message edited', 'success');

                // Reload conversations to update preview
                loadConversations();
                closeEditMessageModal();

            } catch (error) {
                console.error('Failed to edit message:', error);
                errorDiv.textContent = 'Failed to edit message';
                errorDiv.style.display = 'block';
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save';
            }
        };

    } catch (error) {
        console.error('Failed to edit message:', error);
        showToast('Failed to edit message', 'error');
    }
}

function closeEditMessageModal() {
    const modal = document.getElementById('edit-message-modal');
    modal.style.display = 'none';
    document.body.style.overflow = '';
    editingMessageId = null;
    const saveBtn = document.getElementById('edit-message-save-btn');
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
}

async function deleteMessage(messageId) {
    try {
        // Delete from database - only if you're the sender
        const { error } = await window.supabaseClient
            .from('messages')
            .delete()
            .eq('id', messageId)
            .eq('sender_id', currentUser.id);

        if (error) {
            console.error('Delete error:', error);
            throw error;
        }

        // Remove from UI
        const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
        if (messageElement) {
            messageElement.remove();
        }

        // Hide context menu
        document.getElementById('message-context-menu').style.display = 'none';

        showToast('Message deleted', 'success');

        // Reload conversations to update preview
        loadConversations();
    } catch (error) {
        console.error('Failed to delete message:', error);
        showToast('Failed to delete message', 'error');
    }
}

window.showMessageContextMenu = showMessageContextMenu;
window.handleLongPressStart = handleLongPressStart;
window.handleLongPressEnd = handleLongPressEnd;

function openImageViewer(imageSrc) {
    const viewer = document.getElementById('image-viewer');
    const img = document.getElementById('image-viewer-img');
    img.src = imageSrc;
    viewer.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeImageViewer() {
    const viewer = document.getElementById('image-viewer');
    viewer.style.display = 'none';
    document.body.style.overflow = '';
}

window.openImageViewer = openImageViewer;
window.closeImageViewer = closeImageViewer;
window.closeEditMessageModal = closeEditMessageModal;
window.openCreateGroupModal = openCreateGroupModal;
window.closeCreateGroupModal = closeCreateGroupModal;

// ========================================
// Username Setup Modal (for Google Sign-In)
// ========================================

function showUsernameSetupModal() {
    const modal = document.getElementById('username-setup-modal');
    const input = document.getElementById('setup-username');
    const errorDiv = document.getElementById('username-error');

    // Pre-fill with current username if exists
    if (currentUserProfile && currentUserProfile.username) {
        input.value = currentUserProfile.username.replace('@', '');
    }

    modal.style.display = 'flex';
    errorDiv.style.display = 'none';

    // Setup submit handler
    const confirmBtn = document.getElementById('confirm-username-btn');
    confirmBtn.onclick = async () => {
        const username = input.value.trim();

        // Validate username
        if (username.length < 3 || username.length > 20) {
            errorDiv.textContent = 'Username must be 3-20 characters';
            errorDiv.style.display = 'block';
            return;
        }

        if (!/^[a-zA-Z0-9_]+$/.test(username)) {
            errorDiv.textContent = 'Username can only contain letters, numbers, and underscores';
            errorDiv.style.display = 'block';
            return;
        }

        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Saving...';

        try {
            // Check if username is taken
            const { data: existing } = await window.supabaseClient
                .from('profiles')
                .select('id')
                .eq('username', username)
                .neq('id', currentUser.id)
                .single();

            if (existing) {
                errorDiv.textContent = 'Username is already taken';
                errorDiv.style.display = 'block';
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Continue';
                return;
            }

            // Update profile
            const { error } = await window.supabaseClient
                .from('profiles')
                .update({ username: username })
                .eq('id', currentUser.id);

            if (error) throw error;

            // Update local profile
            currentUserProfile.username = username;
            updateUserProfile();

            // Close modal and load app
            modal.style.display = 'none';

            // Now load the app data
            await Promise.all([
                loadConversations(),
                loadFriends(),
                loadFriendRequests()
            ]);

            setupRealtimeSubscription();
            setupEventListeners();

        } catch (error) {
            console.error('Failed to set username:', error);
            errorDiv.textContent = 'Failed to save username. Please try again.';
            errorDiv.style.display = 'block';
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Continue';
        }
    };
}

// ========================================
// Profile Edit Modal
// ========================================

function openProfileEditModal() {
    const modal = document.getElementById('profile-edit-modal');
    const input = document.getElementById('edit-username');
    const errorDiv = document.getElementById('profile-error');
    const avatarPreview = document.getElementById('avatar-preview-img');
    const avatarText = document.getElementById('avatar-preview-text');

    // Pre-fill with current data
    input.value = currentUserProfile.username;

    // Show current avatar
    if (currentUserProfile.avatar && currentUserProfile.avatar.trim() !== '') {
        avatarPreview.src = currentUserProfile.avatar;
        avatarPreview.style.display = 'block';
        avatarText.style.display = 'none';
    } else {
        avatarPreview.style.display = 'none';
        avatarText.style.display = 'flex';
        avatarText.textContent = currentUserProfile.username.charAt(0).toUpperCase();
    }

    modal.style.display = 'flex';
    errorDiv.style.display = 'none';
}

function closeProfileEditModal() {
    const modal = document.getElementById('profile-edit-modal');
    modal.style.display = 'none';
    // Reset file input
    document.getElementById('avatar-upload').value = '';
}

window.closeProfileEditModal = closeProfileEditModal;
window.openProfileEditModal = openProfileEditModal;

// ========================================
// Profile Modal (View/Save)
// ========================================

function openProfileModal() {
    const modal = document.getElementById('profile-modal');
    if (!modal) {
        console.warn('Profile modal not found');
        return;
    }
    
    // Setup save handler if not already done
    const saveBtn = document.getElementById('save-profile-btn');
    if (saveBtn && !saveBtn.hasAttribute('data-handler-set')) {
        saveBtn.setAttribute('data-handler-set', 'true');
        saveBtn.onclick = async () => {
            const username = document.getElementById('edit-username').value.trim();
            const fileInput = document.getElementById('avatar-upload');
            const errorDiv = document.getElementById('profile-error');

            // Validate username
            if (username.length < 3 || username.length > 20) {
                errorDiv.textContent = 'Username must be 3-20 characters';
                errorDiv.style.display = 'block';
                return;
            }

            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';
            errorDiv.style.display = 'none';

            try {
                let avatarUrl = currentUserProfile.avatar;

                // Upload avatar if file selected
                if (fileInput.files.length > 0) {
                    const file = fileInput.files[0];
                    const fileExt = file.name.split('.').pop();
                    const fileName = `${Date.now()}.${fileExt}`;
                    const filePath = `${currentUser.id}/${fileName}`;

                    const { data: uploadData, error: uploadError } = await window.supabaseClient.storage
                        .from('avatars')
                        .upload(filePath, file, {
                            cacheControl: '3600',
                            upsert: true
                        });

                    if (uploadError) throw uploadError;

                    const { data: urlData } = window.supabaseClient.storage
                        .from('avatars')
                        .getPublicUrl(filePath);

                    avatarUrl = urlData.publicUrl;
                }

                // Check if username changed and is taken
                if (username !== currentUserProfile.username) {
                    const { data: existing } = await window.supabaseClient
                        .from('profiles')
                        .select('id')
                        .eq('username', username)
                        .neq('id', currentUser.id)
                        .single();

                    if (existing) {
                        errorDiv.textContent = 'Username is already taken';
                        errorDiv.style.display = 'block';
                        saveBtn.disabled = false;
                        saveBtn.textContent = 'Save Changes';
                        return;
                    }
                }

                // Update profile
                const { error } = await window.supabaseClient
                    .from('profiles')
                    .update({
                        username: username,
                        avatar: avatarUrl
                    })
                    .eq('id', currentUser.id);

                if (error) throw error;

                // Update local profile
                currentUserProfile.username = username;
                currentUserProfile.avatar = avatarUrl;
                updateUserProfile();

                // Refresh conversations to update display names
                await loadConversations();

                showToast('Profile updated successfully', 'success');
                closeProfileModal();

            } catch (error) {
                console.error('Failed to update profile:', error);
                errorDiv.textContent = 'Failed to update profile: ' + error.message;
                errorDiv.style.display = 'block';
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save Changes';
            }
        };
    }

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeProfileModal() {
    const modal = document.getElementById('profile-modal');
    modal.style.display = 'none';
    document.body.style.overflow = '';
}

window.openProfileModal = openProfileModal;
window.closeProfileModal = closeProfileModal;

// ========================================
// REPLY FUNCTIONALITY
// ========================================

function replyToMessage(messageId) {
    // Find the message
    const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!messageElement) return;

    const contentDiv = messageElement.querySelector('.message-content, .message-image');
    const senderDiv = messageElement.querySelector('.message-sender');
    
    let content = '';
    let type = 'text';
    
    if (contentDiv && contentDiv.classList.contains('message-content')) {
        content = contentDiv.textContent;
    } else if (contentDiv && contentDiv.classList.contains('message-image')) {
        content = '[Image]';
        type = 'image';
    }
    
    const sender = senderDiv ? senderDiv.textContent : 'Unknown';
    
    replyingToMessage = {
        id: messageId,
        sender: sender,
        content: content.substring(0, 50), // Truncate to 50 chars
        type: type
    };
    
    showReplyPreview();
    
    // Focus input
    document.getElementById('message-input').focus();
}

function showReplyPreview() {
    if (!replyingToMessage) return;
    
    let previewHtml = `
        <div class=\"reply-preview\" id=\"reply-preview\">
            <div class=\"reply-preview-content\">
                <div class=\"reply-preview-label\">Replying to ${escapeHtml(replyingToMessage.sender)}</div>
                <div class=\"reply-preview-text\">${escapeHtml(replyingToMessage.content)}</div>
            </div>
            <button class=\"reply-preview-close\" onclick=\"clearReplyContext()\">
                <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\">
                    <line x1=\"18\" y1=\"6\" x2=\"6\" y2=\"18\" />
                    <line x1=\"6\" y1=\"6\" x2=\"18\" y2=\"18\" />
                </svg>
            </button>
        </div>
    `;
    
    // Add to input container
    const inputContainer = document.querySelector('.message-input-wrapper');
    const existingPreview = document.getElementById('reply-preview');
    if (existingPreview) {
        existingPreview.remove();
    }
    
    inputContainer.insertAdjacentHTML('beforebegin', previewHtml);
}

function clearReplyContext() {
    replyingToMessage = null;
    const preview = document.getElementById('reply-preview');
    if (preview) {
        preview.remove();
    }
}

window.clearReplyContext = clearReplyContext;
window.replyToMessage = replyToMessage;

// ========================================
// @MENTIONS FUNCTIONALITY
// ========================================

function extractMentions(text) {
    // Extract all @username patterns
    const mentionPattern = /@([a-zA-Z0-9_]+)/g;
    const matches = text.matchAll(mentionPattern);
    const mentionedUsernames = [];
    
    for (const match of matches) {
        mentionedUsernames.push(match[1]);
    }
    
    if (mentionedUsernames.length === 0) return [];
    
    // Get member IDs (for now return empty, will be populated by backend or separate lookup)
    // In a full implementation, you'd look up these usernames and get their IDs
    return []; // Placeholder - implement username to ID lookup if needed
}

function highlightMentions(text) {
    // Replace @username with highlighted version
    return text.replace(/@([a-zA-Z0-9_]+)/g, '<span class=\"mention\">@$1</span>');
}

// ========================================
// GROUP SETTINGS MODAL
// ========================================

async function openGroupSettings(groupId) {
    const group = groups.find(g => `${g.id}` === `${groupId}`);
    if (!group) return;
    
    // Load group members
    try {
        const { data: memberData, error } = await window.supabaseClient
            .from('group_members')
            .select('member:profiles(*)')
            .eq('group_id', groupId);
        
        if (error) throw error;
        
        const members = memberData.map(m => m.member);
        
        showGroupSettingsModal(group, members);
    } catch (error) {
        console.error('Failed to load group members:', error);
        showToast('Failed to load group settings', 'error');
    }
}

function showGroupSettingsModal(group, members) {
    const modal = document.getElementById('group-settings-modal');
    if (!modal) {
        console.error('Group settings modal not found');
        return;
    }
    
    // Populate modal
    document.getElementById('group-settings-name').value = group.name;
    document.getElementById('current-group-id').value = group.id;
    
    // Render members list
    const membersList = document.getElementById('group-members-list');
    membersList.innerHTML = members.map(member => `
        <div class=\"group-member-item\">
            <div class=\"member-avatar\">${member.username.charAt(0).toUpperCase()}</div>
            <span class=\"member-username\">${escapeHtml(member.username)}</span>
            ${member.id !== group.creator_id && member.id !== currentUser.id ? `
                <button class=\"btn-remove-member\" onclick=\"removeMemberFromGroup('${group.id}', '${member.id}')\">Remove</button>
            ` : ''}
            ${member.id === group.creator_id ? '<span class=\"member-badge\">Creator</span>' : ''}
        </div>
    `).join('');
    
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeGroupSettingsModal() {
    const modal = document.getElementById('group-settings-modal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = '';
    }
}

async function updateGroupName() {
    const groupId = document.getElementById('current-group-id').value;
    const newName = document.getElementById('group-settings-name').value.trim();
    
    if (!newName || newName.length < 1 || newName.length > 100) {
        showToast('Group name must be 1-100 characters', 'error');
        return;
    }
    
    try {
        const { error } = await window.supabaseClient
            .from('group_chats')
            .update({ name: newName, updated_at: new Date().toISOString() })
            .eq('id', groupId)
            .eq('creator_id', currentUser.id); // Only creator can rename
        
        if (error) throw error;
        
        // Update local groups array
        const group = groups.find(g => `${g.id}` === `${groupId}`);
        if (group) {
            group.name = newName;
        }
        
        // Update UI
        renderGroups();
        
        // Update UI
        renderGroups();
        if (currentChat && currentChat.type === 'group' && `${currentChat.id}` === `${groupId}`) {
            document.getElementById('chat-username').textContent = newName;
        }
        
        showToast('Group name updated', 'success');
        closeGroupSettingsModal();
    } catch (error) {
        console.error('Failed to update group name:', error);
        showToast('Failed to update group name', 'error');
    }
}

async function addMemberToGroup() {
    const groupId = document.getElementById('current-group-id').value;
    const username = document.getElementById('add-member-input').value.trim();
    
    if (!username) return;
    
    try {
        // Find user by username
        const { data: user, error: findError } = await window.supabaseClient
            .from('profiles')
            .select('*')
            .eq('username', username)
            .single();
        
        if (findError || !user) {
            showToast('User not found', 'error');
            return;
        }
        
        // Check if already a member
        const { data: existing } = await window.supabaseClient
            .from('group_members')
            .select('*')
            .eq('group_id', groupId)
            .eq('member_id', user.id)
            .single();
        
        if (existing) {
            showToast('User is already a member', 'error');
            return;
        }
        
        // Add member
        const { error: insertError } = await window.supabaseClient
            .from('group_members')
            .insert({
                group_id: groupId,
                member_id: user.id,
                joined_at: new Date().toISOString()
            });
        
        if (insertError) throw insertError;
        
        showToast('Member added', 'success');
        document.getElementById('add-member-input').value = '';
        
        // Reload modal
        closeGroupSettingsModal();
        setTimeout(() => openGroupSettings(groupId), 300);
        
    } catch (error) {
        console.error('Failed to add member:', error);
        showToast('Failed to add member', 'error');
    }
}

async function removeMemberFromGroup(groupId, memberId) {
    if (!confirm('Remove this member from the group?')) return;
    
    try {
        const { error } = await window.supabaseClient
            .from('group_members')
            .delete()
            .eq('group_id', groupId)
            .eq('member_id', memberId);
        
        if (error) throw error;
        
        showToast('Member removed', 'success');
        
        // Reload modal
        closeGroupSettingsModal();
        setTimeout(() => openGroupSettings(groupId), 300);
        
    } catch (error) {
        console.error('Failed to remove member:', error);
        showToast('Failed to remove member', 'error');
    }
}

async function deleteGroup() {
    const groupId = document.getElementById('current-group-id').value;
    
    if (!confirm('Are you sure you want to delete this group? This cannot be undone.')) return;
    
    try {
        // Delete group (cascade will handle members and messages)
        const { error } = await window.supabaseClient
            .from('group_chats')
            .delete()
            .eq('id', groupId)
            .eq('creator_id', currentUser.id); // Only creator can delete
        
        if (error) throw error;
        
        // Remove from local array
        groups = groups.filter(g => `${g.id}` !== `${groupId}`);
        renderGroups();
        
        // Close chat if currently open
        
        // Close chat if currently open
        if (currentChat && currentChat.type === 'group' && `${currentChat.id}` === `${groupId}`) {
            document.getElementById('btn-back').click();
        }
        
        showToast('Group deleted', 'success');
        closeGroupSettingsModal();
        
    } catch (error) {
        console.error('Failed to delete group:', error);
        showToast('Failed to delete group', 'error');
    }
}

window.openGroupSettings = openGroupSettings;
window.closeGroupSettingsModal = closeGroupSettingsModal;
window.updateGroupName = updateGroupName;
window.addMemberToGroup = addMemberToGroup;
window.removeMemberFromGroup = removeMemberFromGroup;
window.deleteGroup = deleteGroup;

