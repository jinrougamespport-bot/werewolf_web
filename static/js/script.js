var socket = io();


// アイコン画像の名前リスト（あなたが用意するファイル名と完全に一致させてください）
const iconImages = {};
for (let i = 1; i <= 13; i++) {
    const filename = `icon${i}.png`;
    const img = new Image();
    img.src = `/static/icons/${filename}`;
    iconImages[filename] = img;
}

// --- 1. グローバル変数の定義 ---
let currentRoomName = "待機室";
let currentRoomUrl = "";
let currentMapUrl = "";
let myRole = "";
let isGM = false;
let currentPhase = "day";
let canMoveList = [];
let playerList = []; 
let myName = "";
let currentAuthMode = 'login'; // 'login' または 'register'
let questProgress = 0;
let questEnabled = false;
let isDoingQuest = false;
let myTeam = "";

// クエストデータ定義
const QUEST_DATA = {
    "貯水タンク": { id: "repair_tank", name: "タンクを直す", time: 5000 },
    "電気室":     { id: "repair_generator", name: "発電機を直す", time: 8000 },
    "畑":         { id: "harvest_field", name: "畑の収穫", time: 3000 },
    "風車":       { id: "grind_wheat", name: "風車で小麦を挽く", time: 5000 },
    "パン屋":     { id: "bake_bread", name: "パンを焼く", time: 10000 }
};

// 地図上の点の位置設定
const ROOM_COORDINATES = {
    "広場":        { top: "48%", left: "50%" },
    "畑":          { top: "9%",  left: "22%" },
    "貯水タンク":  { top: "9%",  left: "50%" },
    "村長の家":    { top: "9%",  left: "77%" },
    "電気室":      { top: "48%", left: "12%" },
    "風車":        { top: "48%", left: "82%" },
    "Mさんの家":   { top: "76%", left: "11%" },
    "Aさんの家":   { top: "76%", left: "30%" },
    "Sさんの家":   { top: "76%", left: "73%" },
    "パン屋":      { top: "76%", left: "91%" },
    "待機室":      { top: "50%", left: "50%" }
};

const ROLE_IMAGES = {
    "村人": "/static/村人.png",
    "占い師": "/static/占い師.png",
    "守り人": "/static/守り人.png",
    "人狼": "/static/人狼.png"
};

const MAP_IMAGES = {
    "day": "/static/マップ画像昼.png",   
    "night": "/static/マップ画像夜.png", 
    "待機室": "/static/待機室.png",
    "広場": "/static/広場.png",
    "Aさんの家": "/static/Aさんの家.png",
    "Mさんの家": "/static/Mさんの家.png",
    "Sさんの家": "/static/Sさんの家.png",
    "パン屋": "/static/パン屋.png",
    "貯水タンク": "/static/貯水タンク.png",
    "電気室": "/static/電気室.png",
    "畑": "/static/畑.png",
    "風車": "/static/風車.png",
    "村長の家": "/static/村長の家.png"
};

// --- 2. フェーズ切り替え処理の一本化 ---
const handlePhaseChange = (data) => {
    if (!data || !data.phase) return;
    console.log("フェーズ切り替え実行:", data.phase);
    currentPhase = data.phase;

    // 1. 背景色の切り替え
    if (data.phase === 'night') {
        document.body.classList.add('night-mode');
    } else {
        document.body.classList.remove('night-mode');
    }

    // 2. マップ画像の更新
    const mapDisplay = document.getElementById('map-display');
    if (mapDisplay) {
        mapDisplay.src = data.map_url || `/static/マップ画像${data.phase === 'day' ? '昼' : '夜'}.png`;
    }

    // 3. クエストフラグのリセットと位置更新
    questEnabled = false; 
    isDoingQuest = false;
    
    if (typeof updateDotPosition === 'function') updateDotPosition(); 
    if (typeof updateSkillButtons === 'function') updateSkillButtons();
};

// 重複登録を防ぐため解除してから再登録
socket.off('phase_changed');
socket.off('phase_update');
socket.on('phase_changed', handlePhaseChange);
socket.on('phase_update', handlePhaseChange);


// --- 3. 認証関連の関数 ---

function switchAuthMode() {
    const title = document.getElementById('auth-title');
    const btn = document.getElementById('auth-submit-btn');
    const desc = document.getElementById('toggle-desc');
    const link = document.getElementById('toggle-link');
    const msg = document.getElementById('auth-msg');

    if (msg) msg.innerText = ""; 

    if (currentAuthMode === 'login') {
        currentAuthMode = 'register';
        title.innerText = "新規登録";
        btn.innerText = "登録して入村";
        desc.innerText = "既にアカウントをお持ちですか？";
        link.innerText = "ログインはこちら";
    } else {
        currentAuthMode = 'login';
        title.innerText = "ログイン";
        btn.innerText = "ログイン";
        desc.innerText = "アカウントをお持ちでないですか？";
        link.innerText = "新規登録はこちら";
    }
}

function submitAuth() {
    const usernameInput = document.getElementById('auth-username');
    const passwordInput = document.getElementById('auth-password');
    if (!usernameInput || !passwordInput) return;

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {
        alert('名前とパスワードを入力してください。');
        return;
    }

    // Python側の /login_api に、現在のモード（ログインか新規登録か）を添えて送る
    fetch('/login_api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            username: username, 
            password: password,
            action: currentAuthMode  // 'login' または 'register'
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // ログイン・新規登録のどちらが成功しても、アイコン設定画面へジャンプ！
            window.location.href = "/icon_set";
        } else {
            alert(data.msg || '認証に失敗しました。');
        }
    })
    .catch(err => {
        console.error('Error:', err);
        alert('通信エラーが発生しました。');
    });
}

function joinGame() {
    const nameInput = document.getElementById('username');
    const name = nameInput.value.trim();
    if (!name) return;
    
    myName = name; 
    document.getElementById('login-overlay').style.display = 'none';
    document.getElementById('game-container').style.display = 'flex';
    socket.emit('join_game', { username: name });
}


// --- 4. UI更新関連の関数 ---

function updateRoleUI(role) {
    myRole = role;
    const roleImg = document.getElementById('role-image');
    const roleText = document.getElementById('role-name-text');
    const gmConsole = document.getElementById('gm-console');

    if (role === 'GM' || myName === 'gm_jinrouGM') {
        isGM = true;
        document.body.classList.add('gm-active');
        if (gmConsole) {
            gmConsole.style.setProperty('display', 'block', 'important');
        }
        if (roleText) roleText.innerText = "あなたはGMです";
        if (roleImg) roleImg.style.display = 'none'; 
    } else {
        isGM = false;
        if (gmConsole) gmConsole.style.display = 'none';
        document.body.classList.remove('gm-active');

        if (roleImg && roleText) {
            const imgPath = ROLE_IMAGES[myRole] || "/static/村人.png";
            roleImg.src = imgPath;
            roleImg.style.display = "block";
            roleText.innerText = myRole;
            roleText.style.color = (myRole === "人狼") ? "#ff4d4d" : "#ffffff";
        }
    }
}

function refreshButtons() {
    const container = document.getElementById('scroll-actions');
    if (!container) return;
    container.innerHTML = ""; 

    if (canMoveList && canMoveList.length > 0) {
        canMoveList.forEach(roomName => {
            const btn = document.createElement('button');
            btn.className = "qr-btn";
            btn.innerText = roomName + "へ移動";
            btn.onclick = () => {
                console.log("移動ボタン押下:", roomName); 
                socket.emit('move', { room: roomName });
            };
            container.appendChild(btn);
        });
    }
}

function updateDotPosition() {
    const miniDot = document.getElementById('location-dot');
    const fullDot = document.getElementById('fullscreen-dot');
    const coords = ROOM_COORDINATES[currentRoomName];
    
    [miniDot, fullDot].forEach(dot => {
        if (dot && coords) {
            dot.style.top = coords.top;
            dot.style.left = coords.left;
            dot.style.display = 'block';
        } else if (dot) {
            dot.style.display = 'none';
        }
    });

    const questContainer = document.getElementById('quest-container');
    const questBtn = document.getElementById('quest-btn');
    if (!questContainer || !questBtn) return;

    const quest = QUEST_DATA[currentRoomName];

    if (currentPhase === 'night' && questEnabled && quest && !isDoingQuest) {
        questContainer.style.display = 'block';
        questBtn.innerText = quest.name + "を開始";
        questBtn.onclick = () => executeQuest(quest); 
    } else {
        questContainer.style.display = 'none';
    }
}

function updateStatsUI(wins, losses) {
    const statsArea = document.getElementById('user-stats-display');
    if (statsArea) {
        statsArea.innerHTML = `👤 ${myName}<br>🏆 勝利: ${wins} / 💀 敗北: ${losses}`;
    }
}


// --- 5. チャット・メッセージ関連 ---

function sendMessage() {
    const input = document.getElementById('message-input');
    const msgContent = input.value.trim();

    console.log("【JS送信前チェック】入力された文字:", msgContent, "送信者:", myName);

    if (msgContent && myName) {
        socket.emit('chat_message', { 
            name: myName, 
            msg: msgContent  
        });
        input.value = "";
    }
}




// 🟢 script.js 内の addSystemMessage 関数を探して、これに差し替えます
function addSystemMessage(msg) {
    const area = document.getElementById('chat-log');
    if (!area) return;
    
    // システムメッセージ用のdivとして綺麗に中央に配置します
    area.innerHTML += `
        <div style="text-align: center; color: #ffeb3b; font-size: 13px; margin: 5px 0; font-weight: bold; text-shadow: 1px 1px 2px rgba(0,0,0,0.6); width: 100%;">
            ${msg}
        </div>
    `;
    
    area.scrollTop = area.scrollHeight;
}



function displaySystemMessage(name, msg) {
    const chatLog = document.getElementById('chat-log');
    if (!chatLog) return;

    const div = document.createElement('div');
    div.className = 'chat-message system-message'; 
    div.innerHTML = `<span style="font-weight:bold; color:#ff9800;">[${name}]</span> ${msg}`;
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
}

function addMessageToLog(name, msg, className = "") {
    const chatLog = document.getElementById('chat-log');
    if (!chatLog) return;

    const div = document.createElement('div');
    div.className = 'chat-message ' + className;
    div.innerHTML = `<strong>${name}:</strong> ${msg}`;
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight; 
}


// --- 6. 役職スキル関連の処理 ---

function updateSkillButtons() {
    if (isGM) return;

    let skillContainer = document.getElementById('skill-container');
    if (!skillContainer) {
        skillContainer = document.createElement('div');
        skillContainer.id = 'skill-container';
        skillContainer.style = "position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%); z-index: 9999; display: flex; gap: 10px;";
        document.body.appendChild(skillContainer);
    }
    skillContainer.innerHTML = ""; 

    if (currentPhase === 'night') {
        if (myRole === '占い師') {
            const btn = document.createElement('button');
            btn.innerText = "🔮 占う";
            btn.className = "qr-btn";
            btn.style = "background-color: #9b59b6 !important; color: white; font-weight: bold; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer;";
            btn.onclick = () => useRoleSkill('fortune');
            skillContainer.appendChild(btn);
        } else if (myRole === '守り人') {
            const btn = document.createElement('button');
            btn.innerText = "🛡️ 守る";
            btn.className = "qr-btn";
            btn.style = "background-color: #2980b9 !important; color: white; font-weight: bold; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer;";
            btn.onclick = () => useRoleSkill('guard');
            skillContainer.appendChild(btn);
        } else if (myRole === '人狼') {
            const btn = document.createElement('button');
            btn.innerText = "🐺 襲撃する";
            btn.className = "qr-btn";
            btn.style = "background-color: #c0392b !important; color: white; font-weight: bold; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer;";
            btn.onclick = () => useRoleSkill('attack');
            skillContainer.appendChild(btn);
        }
    }
}

function useRoleSkill(skillType) {
    let targets = playerList.filter(p => p.name !== myName && p.alive);
    if (targets.length === 0) {
        alert("対象に選べるプレイヤーがいません。");
        return;
    }

    let msg = "スキルを使う対象の番号を入力してください:\n";
    targets.forEach((t, i) => {
        msg += `${i + 1}: ${t.name}\n`;
    });

    let choice = prompt(msg);
    if (choice === null) return; 

    let idx = parseInt(choice) - 1;
    if (isNaN(idx) || idx < 0 || idx >= targets.length) {
        alert("正しい番号を入力してください。");
        return;
    }

    let targetPlayer = targets[idx];
    
    socket.emit('use_skill', {
        type: skillType,
        user: myName,
        target: targetPlayer.name
    });
    alert(`${targetPlayer.name} にスキルを送信しました。`);
}


// --- 7. クエスト関連の関数 ---

function checkQuestAvailable() {
    const questContainer = document.getElementById('quest-container');
    const questBtn = document.getElementById('quest-btn');
    const quest = QUEST_DATA[currentRoomName];

    if (quest && !isDoingQuest) {
        questContainer.style.display = 'block';
        questBtn.innerText = quest.name + "を開始";
        questBtn.onclick = () => executeQuest(quest);
    } else {
        questContainer.style.display = 'none';
    }
}

function executeQuest(quest) {
    isDoingQuest = true;
    let progressValue = 0; 
    
    const btn = document.getElementById('quest-btn');
    const progressDiv = document.getElementById('quest-progress');
    const bar = document.getElementById('quest-bar');

    if (progressDiv) progressDiv.style.display = 'block';
    btn.innerText = "連打！！";
    
    btn.onclick = (e) => {
        e.preventDefault();
        if (!isDoingQuest) return;

        progressValue += 5; 
        if (progressValue >= 99) {
            progressValue = 100;
            if (bar) bar.style.width = "100%";
            finishQuest(quest); 
        } else {
            if (bar) bar.style.width = progressValue + "%";
            updateBarColor(bar, progressValue);
        }
    };

    const drainInterval = setInterval(() => {
        if (!isDoingQuest) {
            clearInterval(drainInterval);
            return;
        }
        progressValue -= 1.0; 
        if (progressValue < 0) progressValue = 0;
        if (bar) bar.style.width = progressValue + "%";
    }, 100);
}

function updateBarColor(bar, val) {
    if (val < 30) bar.style.background = "#e74c3c";
    else if (val < 70) bar.style.background = "#f1c40f";
    else bar.style.background = "#2ecc71";
}

function finishQuest(quest) {
    isDoingQuest = false;
    alert(quest.name + " 完了！");
    
    const progressDiv = document.getElementById('quest-progress');
    if (progressDiv) progressDiv.style.display = 'none';
    
    socket.emit('quest_complete', { quest_id: quest.id });
    updateDotPosition(); 
}


// --- 8. 全画面表示・GMコマンド関連の関数 ---

function changePhase(phase) {
    socket.emit('change_phase', { phase: phase });
}

function endGame() {
    if (confirm("試合を終了して役職データをリセットしますか？")) {
        socket.emit('game_end_signal', {});
    }
}

function openPlayerList() { document.getElementById('gm-player-modal').style.display = 'flex'; }
function closePlayerList() { document.getElementById('gm-player-modal').style.display = 'none'; }

function showRoleFullscreen() { showFull(ROLE_IMAGES[myRole], "あなたの役職: " + myRole); }

function showFullMap() { 
    const url = currentMapUrl || MAP_IMAGES["day"];
    showFull(url, "🗺️ 全体図"); 
}

function showCurrentLocation() { 
    const url = currentRoomUrl || MAP_IMAGES[currentRoomName] || MAP_IMAGES["待機室"];
    showFull(url, "📍 現在地：" + currentRoomName); 
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
    
    if (fullDot) {
        fullDot.style.visibility = title.includes("全体図") ? "visible" : "hidden";
    }
}

function closeFullscreen() { 
    document.getElementById('fullscreen-overlay').style.display = 'none'; 
}

function checkNearbyPlayers() {
    socket.emit('request_nearby_players');
}


// --- 9. 演出・エンドロール・評価関連 ---

function showEndRoll() {
    const endRoll = document.getElementById('end-roll-overlay');
    if (endRoll) {
        endRoll.style.display = 'flex';
        console.log("エンドロールを開始しました");
    }
}

let selectedRating = 0;
function showReview() {
    document.getElementById('end-roll-overlay').style.display = 'none';
    document.getElementById('review-overlay').style.display = 'block';
}

function setRating(n) {
    selectedRating = n;
    const stars = document.querySelectorAll('.star');
    stars.forEach((star, index) => {
        if (index < n) {
            star.style.color = '#f1c40f'; 
        } else {
            star.style.color = '#555';     
        }
    });
}

function submitReview() {
    location.reload(); 
}


// --- 10. Socket.io イベント受信処理の一本化 ---

// --- GM専用のスキルログ受信処理 ---
socket.on('gm_skill_log', function(data) {
    // 自分がGM（gm_jinrouGM）の場合のみ、チャットエリアにログを表示する
    if (isGM || myName === 'gm_jinrouGM') {
        const area = document.getElementById('chat-log'); // 🌟 'chat-log' に修正
        if (!area) return;
        
        const msgHtml = `
            <div class="msg-container">
                <div class="user-name" style="color: #e74c3c;">[GM限定ログ]</div>
                <div class="msg-item" style="border: 1px solid #e74c3c; background: rgba(231, 76, 60, 0.2); color: #fff;">
                    ${data.msg}
                </div>
            </div>`;
        area.innerHTML += msgHtml;
        area.scrollTop = area.scrollHeight;
    }
});

// タイマー更新
socket.on('timer_update', function(data) {
    const timeLeftElement = document.getElementById('time-left');
    const phaseLabelElement = document.getElementById('phase-label');

    if (timeLeftElement) {
        const minutes = Math.floor(data.remaining_time / 60);
        const seconds = data.remaining_time % 60;
        timeLeftElement.innerText = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    if (phaseLabelElement) {
        phaseLabelElement.innerText = (currentPhase === 'day') ? "☀️昼" : "🌙夜";
        phaseLabelElement.style.color = (currentPhase === 'day') ? "#f39c12" : "#5dade2";
    }
});

// 認証・メッセージ関連
socket.on('auth_success', (data) => {
    const url = `/dashboard?name=${data.username}&wins=${data.wins}&losses=${data.losses}`;
    window.location.href = url;
});

socket.on('auth_error', (data) => {
    const msgEl = document.getElementById('auth-msg');
    if (msgEl) msgEl.innerText = data.msg;
});

socket.on('new_message', (data) => {
    const chatLog = document.getElementById('chat-log');
    if (!chatLog) return;

    const div = document.createElement('div');
    div.className = 'chat-entry';
    div.innerHTML = `<strong>[${data.name}]</strong>: ${data.msg}`;
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight; 
});

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

// 役職割り当て・更新（修正版）
const handleRoleUpdate = (data) => {
    if (!data || !data.role) return;
    console.log("役職データを受信・更新:", data.role);
    
    // すでに定義されているこの関数が、正しい要素（role-image）に画像をセットしてくれます
    updateRoleUI(data.role);

    // 【修正】存在しない role-card や role-img への誤った操作を削除しました

    // 役職が決定・変更されたのでスキルボタンを更新
    updateSkillButtons();
};

// リスナーの再登録
socket.off('role_assigned');
socket.off('role_update');
socket.on('role_assigned', handleRoleUpdate);
socket.on('role_update', handleRoleUpdate);




// 部屋移動の同期
socket.on('room_update', (data) => {
    console.log("サーバーから移動完了を受信:", data);
    currentRoomName = data.room;
    currentRoomUrl = data.url || MAP_IMAGES[data.room] || MAP_IMAGES["待機室"];
    canMoveList = data.can_move_to || [];

    refreshButtons(); 
    updateDotPosition(); 
});

// プレイヤーリスト更新の受信
const handlePlayerListUpdate = (data) => {
    console.log("プレイヤーリストを受信:", data);
    if (Array.isArray(data)) {
        playerList = data;
    } else if (data && data.players) {
        playerList = data.players;
    } else {
        return;
    }

    const listArea = document.getElementById('player-list-area');
    if (listArea) {
        listArea.innerHTML = playerList.map(p => `
            <div style="padding:8px; border-bottom:1px solid #444; color: ${p.alive ? '#fff' : '#ff4444'}">
                ${p.name} [${p.role}] - ${p.alive ? '生存' : '死亡'}
            </div>`).join('');
    }
    updateSkillButtons();
};

socket.off('update_player_list');
socket.off('player_list_update');
socket.on('update_player_list', handlePlayerListUpdate);
socket.on('player_list_update', handlePlayerListUpdate);

socket.on('player_died', (data) => {
    // 【追加】死んだターゲットの名前が「自分」のときだけ、ゲームオーバー画面を表示する
    if (data.target_name === myName) {
        const deadOverlay = document.createElement('div');
        deadOverlay.style.position = 'fixed';
        deadOverlay.style.top = '0';
        deadOverlay.style.left = '0';
        deadOverlay.style.width = '100%';
        deadOverlay.style.height = '100%';
        deadOverlay.style.background = 'rgba(139, 0, 0, 0.9)'; // 真っ赤な背景
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

        // チャット入力と送信ボタンを無効化
        if(document.getElementById('message-input')) document.getElementById('message-input').disabled = true;
        if(document.getElementById('send-btn')) document.getElementById('send-btn').disabled = true;
    }
});

// クエスト有効化信号
//socket.on('enable_quest', function() {
//    console.log("★クエスト信号が届きました！"); 
//    if (currentPhase === 'night') {
//        questEnabled = true;
//        updateDotPosition(); 
//        alert("⚠️ 異常発生！施設を修理してください！"); 
//    }
//});

// 周辺プレイヤーの確認結果
socket.on('nearby_players_list', function(data) {
    const members = data.members;
    const room = data.room;
    
    let message = "";
    if (members.length <= 1) {
        message = `【${room}】には、あなたの他に誰もいないようです。`;
    } else {
        const others = members.filter(name => name !== myName);
        message = `【${room}】にいる人: ${others.join(", ")}`;
    }

    const area = document.getElementById('chat-area');
    if (area) {
        const msgHtml = `
            <div class="msg-container">
                <div class="user-name" style="color: #ff9800;">システム</div>
                <div class="msg-item" style="border: 1px solid #ff9800; background: rgba(255, 153, 0, 0.88); color: #fff;">
                    ${message}
                </div>
            </div>`;
        area.innerHTML += msgHtml;
        area.scrollTop = area.scrollHeight;
    }
});

// スタッフロールの開始合図
socket.off('start_end_roll');
socket.on('start_end_roll', function() {
    const endRoll = document.getElementById('end-roll-overlay');
    if (endRoll) {
        endRoll.style.display = 'block'; 
    }
});


// --- 11. イベントリスナー・初期化設定 ---

document.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const activeEl = document.activeElement;
        if (activeEl && activeEl.id === 'message-input') {
            sendMessage();
        } else if (activeEl && activeEl.classList.contains('auth-input')) {
            submitAuth();
        }
    }
});


// 💡 サーバーから「ゲームの初期化」や「役職の割り当て」通知を受け取る処理
socket.on('game_init', function(data) {
    console.log("game_initを受信しました:", data);
    console.log("ゲーム初期化データを受信:", data);
    
    if (!data) return;

    if (data.role) {
        myRole = data.role; // "市民" などを保存
        
        // 🌟 HTML側の役職画像要素（ID: role-image）を書き換える
        const roleImgEl = document.getElementById('role-image');
        if (roleImgEl) {
            // 例: /static/市民.png または /static/icons/市民.png など、お使いのパスに合わせてください
            roleImgEl.src = `/static/${data.role}.png`; 
            roleImgEl.style.display = 'block'; // 非表示になっていたら表示する
            console.log("役職画像をセットしました:", roleImgEl.src);
        }
    }

    if (data.phase) {
        currentPhase = data.phase;
    }
    if (data.room_name) {
        currentRoomName = data.room_name;
    }
    if (data.can_move) {
        canMoveList = data.can_move;
    }

    // ─── 💡 1. マップ画像の反映（index.htmlの 'map-image' に確実に流し込む） ───
    if (data.map_url) {
        currentMapUrl = data.map_url;
        try {
            const mapImgEl = document.getElementById('map-image') || document.getElementById('map-img');
            if (mapImgEl) {
                mapImgEl.src = data.map_url;
                console.log("マップ画像をセットしました:", data.map_url);
            }
        } catch (e) {
            console.log("マップ画像反映エラー:", e);
        }
    }

    // ─── 💡 2. 部屋画像の反映 ───
    if (data.room_url) {
        currentRoomUrl = data.room_url;
        try {
            const roomImgEl = document.getElementById('room-image') || document.getElementById('room-img');
            if (roomImgEl) roomImgEl.src = data.room_url;
        } catch (e) {
            console.log("部屋画像反映エラー:", e);
        }
    }

    // ─── 💡 3. あなたの index.html のID（role-popup）に完全に合わせた制御 ───
    try {
        // HTMLの実際のID名に合わせて取得
        const targetOverlay = document.getElementById('role-popup');
        const targetImg = document.getElementById('role-card');
        const targetNameEl = document.getElementById('role-name');

        if (targetOverlay) {
            // 役職テキストを「あなたの役職: 市民」に変更
            if (targetNameEl) {
                targetNameEl.textContent = `あなたの役職: ${myRole}`;
            }

            // 役職画像をセット（/static/roles/市民.png など）
            if (targetImg && myRole) {
                targetImg.src = `/static/roles/${myRole}.png`;
                targetImg.style.display = 'block'; // 画像を強制表示
            }

            // 💡 最初にしっかり最前面に表示させる
            targetOverlay.style.setProperty('display', 'flex', 'important');

            // 💡 【超重要】3秒後にこのポップアップを非表示にして、裏のマップやボタンを見せる！
            setTimeout(() => {
                targetOverlay.style.setProperty('display', 'none', 'important');
                console.log("役職確認画面（role-popup）を閉じました。メイン画面を表示します。");
            }, 3000); 
        }
    } catch (e) {
        console.log("役職画面の処理でエラーが発生したため、安全のために強制非表示にします:", e);
        const targetOverlay = document.getElementById('role-popup');
        if (targetOverlay) targetOverlay.style.setProperty('display', 'none', 'important');
    }

    // ─── 💡 4. ボタンとプレイヤー位置の同期 ───
    try {
        if (typeof updateDotPosition === 'function') updateDotPosition();
    } catch(e) {}

    try {
        if (typeof refreshButtons === 'function') refreshButtons();
    } catch(e) {}
    
    console.log("ゲーム画面の初期化・復旧がすべて完了しました。");
});


// 🟢 script.js の 880行目付近（socket.on('chat_message')）をこれに差し替えます
socket.on('chat_message', function(data) {
    console.log("【JS受信チェック】サーバーから届いたチャット:", data);
    const area = document.getElementById('chat-area');
    if (!area) return;
    
    // 💡 届いたメッセージの「名前」が「自分の名前（myName）」と同じなら my-msg、違うなら other-msg にする
    const isMyMessage = (data.name === myName);
    const msgClass = isMyMessage ? 'my-msg' : 'other-msg';
    
    // 💡 あなたの style.css にある「chat-entry」と、判定した「msgClass」を両方適用させます
    area.innerHTML += `
        <div class="chat-entry ${msgClass}">
            <strong>${data.name}</strong>: ${data.msg}
        </div>
    `;
        
    // 画面を自動で一番下までスクロールさせる
    area.scrollTop = area.scrollHeight;
});




// 💡 役職画像を変更する関数の例
function refreshRoleImage() {
    const roleImgEl = document.getElementById('role-image'); // HTML側の役職画像のID
    if (roleImgEl && myRole) {
        // 役職名に応じた画像に切り替える
        roleImgEl.src = `/static/roles/${myRole}.png`; 
    }
}

function moveRoom(roomName) {
    console.log("移動ボタン押下:", roomName);
    // 💡 サーバーへ destination だけでなく、自分の名前も一緒に送る
    socket.emit('move_to', { 
        name: myName,
        username: myName,
        destination: roomName 
    });
}






window.onload = function() {
    const urlParams = new URLSearchParams(window.location.search);
    const urlName = urlParams.get('name');
    const urlTeam = urlParams.get('team');

    if (urlName && urlTeam) {
        // 💡 1. ユーザー情報をグローバル変数に即時セット
        myName = urlName;
        myTeam = urlTeam;

        // 💡 2. ログイン用の画面を完全に非表示にする
        const loginOverlay = document.getElementById('login-overlay');
        if (loginOverlay) {
            loginOverlay.style.setProperty('display', 'none', 'important');
        }

        // 💡 3. 画面がずれるのを防ぐため、body全体の表示スタイルを強制リセット
        document.body.style.display = 'flex';
        document.body.style.flexDirection = 'column';
        document.body.style.height = '100vh';
        document.body.style.margin = '0';
        document.body.style.padding = '0';
        document.body.style.overflow = 'hidden'; // 余計な全体スクロールを禁止してズレを防ぐ

        // 💡 4. 【復活！】メインのコンテナ要素を画面いっぱいに広げて表示する
        const gameContainer = document.getElementById('game-container') || document.querySelector('.container') || document.getElementById('main-content');
        if (gameContainer) {
            gameContainer.style.display = 'flex';
            gameContainer.style.flexDirection = 'column';
            gameContainer.style.height = '100%';
            gameContainer.style.width = '100%';
        }

        // 💡 5. 【復活！】チャットエリアや入力欄のズレを無理やり引っ張り戻す補正
        const chatControls = document.querySelector('.chat-controls');
        if (chatControls) {
            chatControls.style.position = 'relative';
            chatControls.style.bottom = '0';
            chatControls.style.width = '100%';
            chatControls.style.boxSizing = 'border-box';
        }

        currentRoomName = "待機室";
        if (typeof updateDotPosition === 'function') updateDotPosition();
        if (typeof refreshButtons === 'function') refreshButtons();


        // 💡 6. 【地図・役職画像を強制表示する安全装置】
        socket.on('game_init', (data) => {
            console.log("【URL入室】初期化データを受信しました:", data);
                
            // ─── 1. グローバル変数へのデータ受け取り ───
            if (data.role) myRole = data.role;
            if (data.phase) currentPhase = data.phase;
            if (data.room_name) currentRoomName = data.room_name;
            if (data.room_url) currentRoomUrl = data.room_url;
            if (data.map_url) currentMapUrl = data.map_url;
            if (data.can_move) canMoveList = data.can_move;
                
            // ─── 2. 地図画像の強制セット ───
            const mapImgEl = document.getElementById('map-image') || document.getElementById('map-img') || document.querySelector('.map-section img');
            if (mapImgEl && data.map_url) {
                mapImgEl.src = data.map_url;
            }
        
            // ─── 3. 【大修正！】HTMLの役職表示エリアにデータを正しく反映する ───
            try {
                // あなたのHTMLにある正しいID名で要素を取得
                const roleImgEl = document.getElementById('role-image');
                const roleNameEl = document.getElementById('role-name-text');
            
                // ①「役職確認中...」の文字を「村人」などに書き換える
                if (roleNameEl && myRole) {
                    roleNameEl.textContent = myRole; // 👈 ここで「村人」に切り替わります！
                    console.log("役職テキストを更新しました:", myRole);
                }
            
                // ② 画像のパスをセットして、非表示(display: none)を解除して表示する
                if (roleImgEl && myRole) {
                    roleImgEl.src = `/static/${myRole}.png`; // /static/村人.png を読み込む
                    roleImgEl.style.display = 'block';       // 👈 ここで画像が表示されます！
                    console.log("役職画像をセットしました:", roleImgEl.src);
                }
            } catch (e) {
                console.log("【警告】役職表示の更新でエラーが出ました:", e);
            }
        
            // ─── 4. ボタンとプレイヤー位置の同期 ───
            try { if (typeof updateDotPosition === 'function') updateDotPosition(); } catch(e) {}
            try { if (typeof refreshButtons === 'function') refreshButtons(); } catch(e) {}
            
            console.log("ゲーム画面の初期化・表示の反映が完了しました。");
        });


        // 💡 7. 【復活！】0.5秒待ってから、サーバーに参加リクエストを送信
        // ※Socketがまだ接続されていない場合は、接続完了(connect)を待ってから0.5秒後に送信します
        const sendJoin = () => {
            setTimeout(() => {
                console.log("サーバーに参加リクエストを送信:", myName, "チーム:", myTeam);
                socket.emit('join_game', { name: myName, team: myTeam });
            }, 500);
        };

        if (socket.connected) {
            sendJoin();
        } else {
            socket.on('connect', () => {
                sendJoin();
            });
        }
    }
};