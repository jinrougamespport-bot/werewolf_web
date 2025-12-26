const socket = io();
let currentRoomName = "";
let currentRoomUrl = "";
let currentMapUrl = "";
let myRole = "";
let currentPhase = "day";
let canMoveList = [];

function joinGame() {
    const name = document.getElementById('username').value.trim();
    if(!name) return;
    document.getElementById('login-overlay').style.display = 'none';
    document.getElementById('game-container').style.display = 'flex';
    socket.emit('join_game', {username: name});
}

// 役職の受信
socket.on('role_assigned', (data) => {
    myRole = data.role;
    document.getElementById('role-display').innerText = "役職: " + myRole;
});

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

function closeFullscreen() { document.getElementById('fullscreen-overlay').style.display = 'none'; }

function sendMessage() {
    const input = document.getElementById('chat-input');
    if(!input.value.trim()) return;
    socket.emit('chat_message', {message: input.value});
    input.value = "";
}

function changePhase(p) { socket.emit('change_phase', {phase: p}); }

// ボタンエリアを更新する統合関数
function refreshButtons() {
    const container = document.getElementById('scroll-actions');
    container.innerHTML = "";

    // 1. 夜フェーズならスキルボタンを最初に出す
    if (currentPhase === 'night') {
        if (myRole === "人狼") addSkillBtn("襲撃する");
        else if (myRole === "占い師") addSkillBtn("占う");
        else if (myRole === "守り人") addSkillBtn("守る");
    }

    // 2. 移動ボタンを出す
    canMoveList.forEach(roomName => {
        const btn = document.createElement('button');
        btn.className = "qr-btn";
        btn.innerText = roomName;
        btn.onclick = () => socket.emit('move', {room: roomName});
        container.appendChild(btn);
    });
}

function addSkillBtn(label) {
    const container = document.getElementById('scroll-actions');
    const btn = document.createElement('button');
    btn.className = "qr-btn skill-btn";
    btn.innerText = "✨ " + label;
    btn.onclick = () => alert(label + "対象を選んでください（開発中）");
    container.appendChild(btn);
}

socket.on('room_update', (data) => {
    currentRoomName = data.room;
    currentRoomUrl = data.url;
    canMoveList = data.can_move_to || [];
    refreshButtons();
});

socket.on('phase_update', (data) => {
    currentPhase = data.phase;
    currentMapUrl = data.url;
    document.getElementById('map-display').src = data.url;
    document.body.style.backgroundColor = (data.phase === 'night') ? "#1a1a2e" : "#7494C0";
    refreshButtons();
});

socket.on('new_chat', (data) => {
    const area = document.getElementById('chat-area');
    area.innerHTML += `<div class="msg-container"><div class="user-name">${data.name}</div><div class="msg-item">${data.msg}</div></div>`;
    area.scrollTop = area.scrollHeight;
});
