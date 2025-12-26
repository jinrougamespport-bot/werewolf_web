const socket = io();
let currentRoomName = "";
let currentRoomUrl = "";
let currentMapUrl = "";

function joinGame() {
    const name = document.getElementById('username').value.trim();
    if(!name) return;
    document.getElementById('login-overlay').style.display = 'none';
    document.getElementById('game-container').style.display = 'flex';
    socket.emit('join_game', {username: name});
}

function showCurrentLocation() {
    const overlay = document.getElementById('fullscreen-overlay');
    document.getElementById('fullscreen-img').src = currentRoomUrl;
    document.getElementById('fullscreen-title').innerText = "📍 現在地：" + currentRoomName;
    overlay.style.display = 'flex';
}

function showFullMap() {
    const overlay = document.getElementById('fullscreen-overlay');
    document.getElementById('fullscreen-img').src = currentMapUrl;
    document.getElementById('fullscreen-title').innerText = "🗺️ 全体図";
    overlay.style.display = 'flex';
}

function closeFullscreen() {
    document.getElementById('fullscreen-overlay').style.display = 'none';
}

function sendMessage() {
    const input = document.getElementById('chat-input');
    if(!input.value.trim()) return;
    socket.emit('chat_message', {message: input.value});
    input.value = "";
}

function changePhase(p) { socket.emit('change_phase', {phase: p}); }

// 受信処理
socket.on('room_update', (data) => {
    currentRoomName = data.room;
    currentRoomUrl = data.url;
    const container = document.getElementById('scroll-actions');
    container.innerHTML = ""; 
    if (data.can_move_to) {
        data.can_move_to.forEach(roomName => {
            const btn = document.createElement('button');
            btn.className = "qr-btn";
            btn.innerText = roomName;
            btn.onclick = () => socket.emit('move', {room: roomName});
            container.appendChild(btn);
        });
    }
});

socket.on('phase_update', (data) => {
    currentMapUrl = data.url;
    document.getElementById('map-display').src = data.url;
    document.body.style.backgroundColor = (data.phase === 'night') ? "#1a1a2e" : "#7494C0";
});

socket.on('new_chat', (data) => {
    const area = document.getElementById('chat-area');
    area.innerHTML += `<div class="msg-container"><div class="user-name">${data.name}</div><div class="msg-item">${data.msg}</div></div>`;
    area.scrollTop = area.scrollHeight;
});
