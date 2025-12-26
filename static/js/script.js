const socket = io();
let currentRoomName = "";
let currentRoomUrl = "";
let currentMapUrl = "";
let myRole = "";
let isGM = false;
let currentPhase = "day";
let canMoveList = [];

const ROLE_IMAGES = {
    "村人": "/static/村人テキスト付.png",
    "占い師": "/static/占い師テキスト付.png",
    "守り人": "/static/守り人テキスト付.png"
};

function joinGame() {
    const name = document.getElementById('username').value.trim();
    if(!name) return;
    document.getElementById('login-overlay').style.display = 'none';
    document.getElementById('game-container').style.display = 'flex';
    socket.emit('join_game', {username: name});
}

socket.on('role_assigned', (data) => {
    myRole = data.role;
    isGM = data.is_gm;
    
    const roleCard = document.getElementById('role-card');
    const roleImg = document.getElementById('role-img');

    if (!isGM && myRole !== "人狼") {
        roleCard.style.display = 'block';
        roleImg.src = ROLE_IMAGES[myRole] || "/static/村人テキスト付.png";
    } else {
        roleCard.style.display = 'none';
    }

    if (isGM) {
        document.getElementById('gm-console').style.display = 'block';
    }
});

function showRoleFullscreen() {
    const overlay = document.getElementById('fullscreen-overlay');
    document.getElementById('fullscreen-img').src = document.getElementById('role-img').src;
    document.getElementById('fullscreen-title').innerText = "あなたの役職: " + myRole;
    overlay.style.display = 'flex';
}

function showFullMap() {
    const overlay = document.getElementById('fullscreen-overlay');
    document.getElementById('fullscreen-img').src = currentMapUrl;
    document.getElementById('fullscreen-title').innerText = "🗺️ 全体図";
    overlay.style.display = 'flex';
}

function showCurrentLocation() {
    const overlay = document.getElementById('fullscreen-overlay');
    document.getElementById('fullscreen-img').src = currentRoomUrl;
    document.getElementById('fullscreen-title').innerText = "📍 現在地：" + currentRoomName;
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

function refreshButtons() {
    const container = document.getElementById('scroll-actions');
    container.innerHTML = "";
    if (currentPhase === 'night' && !isGM) {
        if (myRole === "人狼") addSkillBtn("襲撃する");
        else if (myRole === "占い師") addSkillBtn("占う");
        else if (myRole === "守り人") addSkillBtn("守る");
    }
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
    btn.onclick = () => alert(label + "対象を選んでください");
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

socket.on('update_player_list', (players) => {
    const listArea = document.getElementById('player-list-area');
    if (listArea) {
        listArea.innerHTML = players.map(p => `<div style="padding:5px; border-bottom:1px solid #444;">${p.name}: ${p.role} (${p.alive ? '生' : '死'})</div>`).join('');
    }
});

function openPlayerList() { document.getElementById('gm-player-modal').style.display = 'flex'; }
function closePlayerList() { document.getElementById('gm-player-modal').style.display = 'none'; }
