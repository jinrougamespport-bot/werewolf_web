const socket = io();

// グローバル変数の定義
let currentRoomName = "";
let currentRoomUrl = "";
let currentMapUrl = "";
let myRole = "";
let isGM = false;
let currentPhase = "day";
let canMoveList = [];
let playerList = []; // プレイヤーリストを保持する変数を追加

// 地図上の点の位置設定 (画像に合わせて数値を微調整してください)
const ROOM_COORDINATES = {
    // 中央
    "広場":        { top: "48%", left: "50%" },

    // 上段
    "畑":          { top: "9%",  left: "22%" },
    "貯水タンク":  { top: "9%",  left: "50%" }, // 画像内「タンク」
    "村長の家":    { top: "9%",  left: "77%" },

    // 中段
    "配電室":      { top: "48%", left: "12%" }, // 画像内「発電所」
    "風車":        { top: "48%", left: "82%" },

    // 下段
    "Mさんの家":   { top: "76%", left: "11%" },
    "Aさんの家":   { top: "76%", left: "30%" },
    "Sさんの家":   { top: "76%", left: "73%" },
    "パン屋":      { top: "76%", left: "91%" },

    // 待機室（画像外の設定。とりあえず広場と同じか中央に）
    "待機室":      { top: "50%", left: "50%" }
};

const ROLE_IMAGES = {
    "村人": "/static/村人テキスト付.png",
    "占い師": "/static/占い師テキスト付.png",
    "守り人": "/static/守り人テキスト付.png",
    "人狼": "/static/人狼テキスト付.png"
};

// 入村処理
function joinGame() {
    const name = document.getElementById('username').value.trim();
    if (!name) return;
    document.getElementById('login-overlay').style.display = 'none';
    document.getElementById('game-container').style.display = 'flex';
    socket.emit('join_game', { username: name });
}

// 役職割当 (修正版)
socket.on('role_assigned', (data) => {
    myRole = data.role;
    isGM = data.is_gm;

    const roleCard = document.getElementById('role-card');
    const roleImg = document.getElementById('role-img');

    // GM以外は全員、役職画像を表示する設定に変更
    if (!isGM) {
        roleCard.style.display = 'block';
        // 役職に応じた画像を設定。リストにない場合は「村人」を予備として出す
        const imagePath = ROLE_IMAGES[myRole] || "/static/村人テキスト付.png";
        roleImg.src = imagePath;
    } else {
        roleCard.style.display = 'none';
    }

    if (isGM) {
        document.getElementById('gm-console').style.display = 'block';
    }
});

// 部屋移動・更新
socket.on('room_update', (data) => {
    currentRoomName = data.room;
    currentRoomUrl = data.url;
    canMoveList = data.can_move_to || [];

    refreshButtons(); // ボタン更新
    updateDotPosition(); // ★ドット更新関数を呼び出す

    // 赤い点の位置を更新
    const dot = document.getElementById('location-dot');
    const coord = ROOM_COORDINATES[currentRoomName];
    if (dot && coord) {
        dot.style.display = "block";
        dot.style.top = coord.top;
        dot.style.left = coord.left;
    } else if (dot) {
        dot.style.display = "none";
    }
});

function updateDotPosition() {
    const coord = ROOM_COORDINATES[currentRoomName];
    const miniDot = document.getElementById('location-dot');
    const fullDot = document.getElementById('fullscreen-dot');

    [miniDot, fullDot].forEach(dot => {
        if (dot && coord) {
            dot.style.display = "block";
            dot.style.top = coord.top;
            dot.style.left = coord.left;
        } else if (dot) {
            dot.style.display = "none";
        }
    });
}


// フェーズ更新
socket.on('phase_update', (data) => {
    currentPhase = data.phase;
    currentMapUrl = data.url;
    document.getElementById('map-display').src = data.url;
    document.body.style.backgroundColor = (data.phase === 'night') ? "#1a1a2e" : "#7494C0";
    
    // チャット欄に通知を出す
    const area = document.getElementById('chat-area');
    const message = (data.phase === 'day') ? "☀️ 朝になりました。" : "🌙 夜になりました。";
    area.innerHTML += `
        <div class="msg-container">
            <div class="msg-item" style="background: #ffeb3b; font-weight: bold;">${message}</div>
        </div>`;
    area.scrollTop = area.scrollHeight;

    refreshButtons();
});


// ボタン類の再描画
function refreshButtons() {
    const container = document.getElementById('scroll-actions');
    if (!container) return;
    container.innerHTML = "";

    // 夜フェーズならスキルボタンを先に追加
    if (currentPhase === 'night' && !isGM) {
        if (myRole === "人狼") addSkillBtn("襲撃する");
        else if (myRole === "占い師") addSkillBtn("占う");
        else if (myRole === "守り人") addSkillBtn("守る");
    }

    // 移動可能リストからボタンを作成
    if (canMoveList) {
        canMoveList.forEach(roomName => {
            const btn = document.createElement('button');
            btn.className = "qr-btn";
            btn.innerText = roomName;
            btn.onclick = () => socket.emit('move', { room: roomName });
            container.appendChild(btn);
        });
    }
}

// スキルボタン作成 (script.js の addSkillBtn 関数を差し替え)
function addSkillBtn(label) {
    const container = document.getElementById('scroll-actions');
    const btn = document.createElement('button');
    btn.className = "qr-btn skill-btn";
    btn.innerText = "✨ " + label;
    btn.onclick = () => {
        const myName = document.getElementById('username').value;
        
        // 【重要】自分以外、かつ生存、かつ「GMではない」プレイヤーのみをリストアップ
        const targets = playerList.filter(p => p.name !== myName && p.alive && !p.is_gm);

        if (targets.length === 0) {
            alert("対象となるプレイヤーがいません");
            return;
        }

        const namesString = targets.map(p => p.name).join(", ");
        const choice = prompt(`${label}対象の名前を入力してください:\n【対象者】\n${namesString}`);

        // 入力された名前が対象リストに存在するかチェック
        if (choice && targets.find(p => p.name === choice)) {
            socket.emit('use_skill', { skill: label, target: choice });
            alert(choice + " にスキルを送信しました。");
        } else if (choice) {
            alert("名前を正しく入力してください（全角・半角も一致させる必要があります）");
        }
    };
    container.appendChild(btn);
}

// チャット受信
socket.on('new_chat', (data) => {
    const area = document.getElementById('chat-area');
    if (!area) return;
    area.innerHTML += `
        <div class="msg-container">
            <div class="user-name">${data.name}</div>
            <div class="msg-item">${data.msg}</div>
        </div>`;
    area.scrollTop = area.scrollHeight;
});

// プレイヤーリストの更新
socket.on('update_player_list', (data) => {
    playerList = data; // グローバル変数に保存
    const listArea = document.getElementById('player-list-area');
    if (listArea) {
        listArea.innerHTML = data.map(p => `
            <div style="padding:5px; border-bottom:1px solid #444;">
                ${p.name}: ${p.role} (${p.alive ? '生存' : '死亡'})
            </div>`).join('');
    }
});

// チャット送信
function sendMessage() {
    const input = document.getElementById('chat-input');
    if (!input || !input.value.trim()) return;
    socket.emit('chat_message', { message: input.value });
    input.value = "";
}

// 各種表示関数
function changePhase(p) { socket.emit('change_phase', { phase: p }); }
function closeFullscreen() { document.getElementById('fullscreen-overlay').style.display = 'none'; }
function openPlayerList() { document.getElementById('gm-player-modal').style.display = 'flex'; }
function closePlayerList() { document.getElementById('gm-player-modal').style.display = 'none'; }

function showRoleFullscreen() {
    const roleImg = document.getElementById('role-img');
    if (roleImg) showFull(roleImg.src, "あなたの役職: " + myRole);
}

function showFullMap() {
    showFull(currentMapUrl, "🗺️ 全体図");
}

function showCurrentLocation() {
    showFull(currentRoomUrl, "📍 現在地：" + currentRoomName);
}

function showFull(src, title) {
    const overlay = document.getElementById('fullscreen-overlay');
    const img = document.getElementById('fullscreen-img');
    const titleEl = document.getElementById('fullscreen-title');
    const fullDot = document.getElementById('fullscreen-dot');
    
    if (!overlay || !img || !titleEl) return;
    
    img.src = src;
    titleEl.innerText = title;
    overlay.style.display = 'flex';

    // 全体図を表示しているときだけドットを表示する
    if (fullDot) {
        fullDot.style.visibility = title.includes("全体図") ? "visible" : "hidden";
    }
}

socket.on('player_died', (data) => {
    // 画面全体を覆うゲームオーバー画面を動的に作成
    const deadOverlay = document.createElement('div');
    deadOverlay.style.position = 'fixed';
    deadOverlay.style.top = '0';
    deadOverlay.style.left = '0';
    deadOverlay.style.width = '100%';
    deadOverlay.style.height = '100%';
    deadOverlay.style.background = 'rgba(139, 0, 0, 0.9)'; // 暗い赤
    deadOverlay.style.color = 'white';
    deadOverlay.style.display = 'flex';
    deadOverlay.style.flexDirection = 'column';
    deadOverlay.style.justifyContent = 'center';
    deadOverlay.style.alignItems = 'center';
    deadOverlay.style.zIndex = '10000';
    deadOverlay.style.fontSize = '40px';
    deadOverlay.style.fontWeight = 'bold';
    
    deadOverlay.innerHTML = `
        <div>GAME OVER</div>
        <div style="font-size: 18px; margin-top: 20px;">${data.msg}</div>
        <div style="font-size: 14px; margin-top: 40px; color: #ccc;">(観戦モード)</div>
    `;
    
    document.body.appendChild(deadOverlay);

    // 操作不能にするための処理
    document.getElementById('chat-input').disabled = true;
    document.getElementById('quick-reply').style.pointerEvents = 'none';
    document.getElementById('quick-reply').style.opacity = '0.5';
});