let currentUser = null;
let isLoginMode = true;

const authScreen = document.getElementById('auth-screen');
const appShell = document.getElementById('app-shell');
const bottomNav = document.getElementById('bottom-nav');

// ---------- AUTH ----------
document.getElementById('auth-switch-link').addEventListener('click', () => {
    isLoginMode = !isLoginMode;
    document.getElementById('auth-title').textContent = isLoginMode ? 'Welcome to Void' : 'Join Void';
    document.getElementById('auth-subtitle').textContent = isLoginMode ? 'Sign in to continue' : 'Create your account';
    document.getElementById('auth-submit').textContent = isLoginMode ? 'Sign In' : 'Create Account';
    document.getElementById('auth-switch-text').textContent = isLoginMode ? "Don't have an account?" : 'Already have an account?';
    document.getElementById('auth-switch-link').textContent = isLoginMode ? 'Create one' : 'Sign In';
    hideError();
});

document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const submitBtn = document.getElementById('auth-submit');
    submitBtn.disabled = true;
    hideError();

    try {
        const endpoint = isLoginMode ? '/api/auth/login' : '/api/auth/register';
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!res.ok) {
            showError(data.error || 'Something went wrong');
            submitBtn.disabled = false;
            return;
        }
        currentUser = data.user;
        enterApp();
    } catch (err) {
        showError('Network error. Please try again.');
        submitBtn.disabled = false;
    }
});

function showError(msg) {
    const el = document.getElementById('auth-error');
    el.textContent = msg;
    el.classList.remove('hidden');
}
function hideError() {
    document.getElementById('auth-error').classList.add('hidden');
}

async function checkSession() {
    try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
            const data = await res.json();
            currentUser = data.user;
            enterApp();
        }
    } catch (err) { /* not logged in */ }
}

function enterApp() {
    authScreen.classList.add('hidden');
    appShell.classList.remove('hidden');
    bottomNav.classList.remove('hidden');
    renderProfileHeader();
    loadFeed();
    connectSocket();
}

function renderProfileHeader() {
    document.getElementById('my-name').innerHTML = currentUser.display_name || currentUser.username;
    const avatar = document.getElementById('my-avatar');
    if (currentUser.profile_picture) {
        avatar.style.backgroundImage = `url(${currentUser.profile_picture})`;
        avatar.textContent = '';
    } else {
        avatar.textContent = (currentUser.username[0] || '?').toUpperCase();
    }
    if (currentUser.cover_photo) {
        document.getElementById('cover-photo').style.backgroundImage = `url(${currentUser.cover_photo})`;
    }

    if (currentUser.is_premium) {
        avatar.classList.add('premium-frame');
        if (currentUser.accent_color) avatar.style.setProperty('--accent-1', currentUser.accent_color);
        if (currentUser.accent_color_secondary) avatar.style.setProperty('--accent-2', currentUser.accent_color_secondary);

        const panel = document.getElementById('premium-panel');
        panel.classList.remove('hidden');
        if (currentUser.accent_color) {
            document.getElementById('accent-color-picker').value = currentUser.accent_color;
            document.getElementById('accent-color-text').value = currentUser.accent_color;
        }
        if (currentUser.accent_color_secondary) {
            document.getElementById('accent-color-secondary-picker').value = currentUser.accent_color_secondary;
            document.getElementById('accent-color-secondary-text').value = currentUser.accent_color_secondary;
        }
    }
}

const hexPattern = /^#[0-9a-fA-F]{6}$/;

function syncColorInputs(picker, text) {
    picker.addEventListener('input', () => { text.value = picker.value; });
    text.addEventListener('input', () => {
        if (hexPattern.test(text.value)) picker.value = text.value;
    });
}
syncColorInputs(document.getElementById('accent-color-picker'), document.getElementById('accent-color-text'));
syncColorInputs(document.getElementById('accent-color-secondary-picker'), document.getElementById('accent-color-secondary-text'));

document.getElementById('save-premium-customization').addEventListener('click', async () => {
    const accent_color = document.getElementById('accent-color-text').value.trim();
    const accent_color_secondary = document.getElementById('accent-color-secondary-text').value.trim();

    if (accent_color && !hexPattern.test(accent_color)) return alert('Primary color must be a valid hex code, e.g. #cf0c18');
    if (accent_color_secondary && !hexPattern.test(accent_color_secondary)) return alert('Secondary color must be a valid hex code, e.g. #0d0304');

    const res = await fetch('/api/users/me/premium-customization', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accent_color, accent_color_secondary })
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'Failed to save customization');

    currentUser.accent_color = data.customization.accent_color;
    currentUser.accent_color_secondary = data.customization.accent_color_secondary;
    renderProfileHeader();
    loadFeed();
});

document.getElementById('logout-btn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.reload();
});

// ---------- TABS ----------
document.querySelectorAll('.tab-pill, .nav-item[data-tab]').forEach(el => {
    el.addEventListener('click', () => switchTab(el.dataset.tab));
});

function switchTab(tab) {
    document.querySelectorAll('[id^="tab-"]').forEach(el => el.classList.add('hidden'));
    document.getElementById(`tab-${tab}`).classList.remove('hidden');
    document.querySelectorAll('.tab-pill').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
    document.querySelectorAll('.nav-item[data-tab]').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
    if (tab === 'notifications') loadNotifications();
}

// ---------- FEED ----------
async function loadFeed() {
    const res = await fetch('/api/posts/feed');
    if (!res.ok) return;
    const data = await res.json();
    const list = document.getElementById('feed-list');
    if (data.posts.length === 0) {
        list.innerHTML = '<div class="empty-state">No posts yet. Be the first to share something!</div>';
        return;
    }
    list.innerHTML = data.posts.map(renderPost).join('');
    attachPostListeners();
}

function renderPost(p) {
    const avatarHtml = p.profile_picture
        ? `background-image:url(${p.profile_picture})`
        : '';
    const initial = (p.username[0] || '?').toUpperCase();
    const premiumBadge = p.is_premium ? '<span class="premium-badge">Premium</span>' : '';
    const mediaHtml = p.media_url
        ? (p.media_type === 'video'
            ? `<video src="${p.media_url}" class="post-media" controls></video>`
            : `<img src="${p.media_url}" class="post-media">`)
        : '';
    const time = new Date(p.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

    const cardClass = p.is_premium ? 'post-card premium-post' : 'post-card';
    const avatarClass = p.is_premium ? 'avatar premium-frame' : 'avatar';
    let cardStyle = '';
    if (p.is_premium) {
        const c1 = p.accent_color || '#e11d2e';
        const c2 = p.accent_color_secondary || 'rgba(225,29,46,0.35)';
        cardStyle = `style="--accent-1:${c1};--accent-2:${c2};"`;
    }

    return `
    <div class="${cardClass}" data-post-id="${p.id}" ${cardStyle}>
        <div class="post-header">
            <div class="${avatarClass}" style="${avatarHtml}">${p.profile_picture ? '' : initial}</div>
            <div class="meta">
                <div class="username">${escapeHtml(p.display_name || p.username)}${premiumBadge}</div>
                <div class="timestamp">${time}</div>
            </div>
        </div>
        ${p.content ? `<div class="post-content">${escapeHtml(p.content)}</div>` : ''}
        ${mediaHtml}
        <div class="post-actions">
            <button class="post-action like-btn ${p.liked_by_me ? 'liked' : ''}" data-post-id="${p.id}">
                ${p.liked_by_me ? '❤️' : '🤍'} <span class="like-count">${p.like_count}</span>
            </button>
            <button class="post-action">💬 <span>${p.comment_count}</span></button>
        </div>
    </div>`;
}

function attachPostListeners() {
    document.querySelectorAll('.like-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const postId = btn.dataset.postId;
            const res = await fetch(`/api/posts/${postId}/like`, { method: 'POST' });
            const data = await res.json();
            const countEl = btn.querySelector('.like-count');
            let count = parseInt(countEl.textContent);
            if (data.liked) {
                btn.classList.add('liked');
                btn.innerHTML = `❤️ <span class="like-count">${count + 1}</span>`;
            } else {
                btn.classList.remove('liked');
                btn.innerHTML = `🤍 <span class="like-count">${count - 1}</span>`;
            }
        });
    });
}

document.getElementById('post-submit').addEventListener('click', async () => {
    const content = document.getElementById('post-content').value.trim();
    const fileInput = document.getElementById('post-media');
    if (!content && fileInput.files.length === 0) return;

    const formData = new FormData();
    formData.append('content', content);
    if (fileInput.files[0]) formData.append('media', fileInput.files[0]);

    const res = await fetch('/api/posts', { method: 'POST', body: formData });
    if (res.ok) {
        document.getElementById('post-content').value = '';
        fileInput.value = '';
        loadFeed();
    }
});

// ---------- NOTIFICATIONS ----------
async function loadNotifications() {
    const res = await fetch('/api/notifications');
    if (!res.ok) return;
    const data = await res.json();
    const list = document.getElementById('notifications-list');
    if (data.notifications.length === 0) {
        list.innerHTML = '<div class="empty-state">No notifications yet.</div>';
        return;
    }
    list.innerHTML = data.notifications.map(n => {
        const verb = { like: 'liked your post', comment: 'commented on your post', follow: 'started following you', message: 'sent you a message', mention: 'mentioned you' }[n.type] || 'interacted with you';
        const time = new Date(n.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        return `<div class="post-card">
            <div class="post-header">
                <div class="avatar">${(n.actor_username[0] || '?').toUpperCase()}</div>
                <div class="meta">
                    <div class="username">${escapeHtml(n.actor_display_name || n.actor_username)} ${verb}</div>
                    <div class="timestamp">${time}</div>
                </div>
            </div>
        </div>`;
    }).join('');
    fetch('/api/notifications/read', { method: 'POST' });
}

// ---------- SOCKET.IO ----------
let socket;
function connectSocket() {
    socket = io();
    socket.on('connect_error', (err) => console.warn('Socket connect error:', err.message));
}

// ---------- UTIL ----------
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

checkSession();
