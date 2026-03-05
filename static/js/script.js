var socket = io();

// --- 2. グローバル変数の定義 ---
let currentRoomName = "";
let currentRoomUrl = "";
let currentMapUrl = "";
let myRole = "";
let isGM = false;
let currentPhase = "day";
let canMoveList = [];
let playerList = []; 
let myName = "";
let currentAuthMode = 'login'; // 'login' または 'register'

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
    "day": "/static/マップ画像昼.png",   // 朝のマップ画像ファイル名
    "night": "/static/マップ画像夜.png", // 夜のマップ画像ファイル名
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

// script.js のどこか一箇所にまとめる
const handlePhaseChange = (data) => {
    console.log("背景色切り替え実行:", data.phase);
    currentPhase = data.phase;

    // body要素に対してクラスを付け外しする
    if (data.phase === 'night') {
        document.body.classList.add('night-mode');
    } else {
        document.body.classList.remove('night-mode');
    }

    // マップ画像の更新
    const mapDisplay = document.getElementById('map-display');
    if (mapDisplay) {
        // app.py から送られてくる MAP_URLS または生成したパスを使用
        mapDisplay.src = data.map_url || `/static/マップ画像${data.phase === 'day' ? '昼' : '夜'}.png`;
    }
};

// 重複を避けるため、既存の socket.on('phase_update') や 'phase_changed' は消してこれに統一
socket.off('phase_changed'); // 念のため古い設定を解除
socket.off('phase_update');
socket.on('phase_changed', handlePhaseChange);
socket.on('phase_update', handlePhaseChange);


// --- 3. 認証関連の関数 ---

// ログイン・新規登録の切り替え
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


function updateRoleUI(role) {
    myRole = role;
    const roleImg = document.getElementById('role-image');
    const roleText = document.getElementById('role-name-text');
    const gmConsole = document.getElementById('gm-console');

    // GMの場合の処理を強化
    if (role === 'GM' || myName === 'gm_jinrouGM') {
        document.body.classList.add('gm-active');
        if (gmConsole) {
            gmConsole.style.setProperty('display', 'block', 'important');
        }
        if (roleText) roleText.innerText = "あなたはGMです";
        if (roleImg) roleImg.style.display = 'none'; // GMに役職画像は不要
    } else {
        // ... 他の役職の処理 ...
        if (gmConsole) gmConsole.style.display = 'none';
        document.body.classList.remove('gm-active');
    }
}


function submitAuth() {
    const name = document.getElementById('auth-username').value.trim();
    const pass = document.getElementById('auth-password').value.trim();
    const msg = document.getElementById('auth-msg');

    if (!name || !pass) {
        if (msg) msg.innerText = "名前とパスワードを入力してください";
        return;
    }

    // サーバーに送るデータ（action: 'login' か 'register' かを明示する）
    const authData = { 
        username: name, 
        password: pass, 
        action: currentAuthMode // 現在選択されているモード（login/register）
    };

    fetch('/login_api', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'ngrok-skip-browser-warning': 'true' // これで警告をスキップ
        },
        body: JSON.stringify(authData)
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            console.log("認証成功:", data);
            // 成功したらゲーム画面へ（URLに名前を乗せて移動）
            window.location.href = `/game?name=${encodeURIComponent(name)}`;
        } else {
            // 失敗したらエラーメッセージを表示
            if (msg) msg.innerText = data.msg || "認証に失敗しました";
        }
    })
    .catch(err => {
        console.error("Auth Error:", err);
        if (msg) msg.innerText = "サーバーとの通信に失敗しました";
    });
}


function joinGame() {
    const nameInput = document.getElementById('username');
    const name = nameInput.value.trim();
    if (!name) return;
    
    myName = name; // グローバル変数に保存
    document.getElementById('login-overlay').style.display = 'none';
    document.getElementById('game-container').style.display = 'flex';
    socket.emit('join_game', { username: name });
}


socket.on('timer_update', function(data) {
    const timeLeftElement = document.getElementById('time-left');
    const phaseLabelElement = document.getElementById('phase-label');

    if (timeLeftElement) {
        const minutes = Math.floor(data.remaining_time / 60);
        const seconds = data.remaining_time % 60;
        // 00:00 の形式に整形
        timeLeftElement.innerText = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    if (phaseLabelElement) {
        phaseLabelElement.innerText = (currentPhase === 'day') ? "☀️昼" : "🌙夜";
        phaseLabelElement.style.color = (currentPhase === 'day') ? "#f39c12" : "#5dade2";
    }
});


// 認証成功時
socket.on('auth_success', (data) => {
    // URLに情報をくっつけてダッシュボードに移動
    const url = `/dashboard?name=${data.username}&wins=${data.wins}&losses=${data.losses}`;
    window.location.href = url;
});

socket.on('new_message', (data) => {
    const chatLog = document.getElementById('chat-log');
    if (!chatLog) return;

    const div = document.createElement('div');
    div.className = 'chat-entry';
    // 自分のメッセージか、他人のメッセージかで見た目を変える工夫も可能
    div.innerHTML = `<strong>[${data.name}]</strong>: ${data.msg}`;
    
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight; // 常に最新へスクロール
});


// 認証エラー受信
socket.on('auth_error', (data) => {
    const msgEl = document.getElementById('auth-msg');
    if (msgEl) msgEl.innerText = data.msg;
});

// --- 4. ゲームイベント受信 (サーバーからの通知) ---

socket.on('role_assigned', function(data) {
    console.log("役職を受信:", data.role);
    myRole = data.role;
    
    const roleCard = document.getElementById('role-card');
    const roleImg = document.getElementById('role-img');
    
    if (roleCard && roleImg) {
        // 画像リストからパスを取得して表示
        if (typeof ROLE_IMAGES !== 'undefined' && ROLE_IMAGES[data.role]) {
            roleImg.src = ROLE_IMAGES[data.role];
            roleCard.style.display = 'block'; 
        } else {
            // 画像がない場合はテキストで表示
            roleCard.innerHTML = `<h3>役職: ${data.role}</h3>`;
            roleCard.style.display = 'block';
        }
    }
});


socket.on('room_update', (data) => {
    currentRoomName = data.room;
    // サーバーからのURL、または MAP_IMAGES からその部屋の画像を取得
    currentRoomUrl = data.url || MAP_IMAGES[data.room] || MAP_IMAGES["待機室"];
    canMoveList = data.can_move_to || [];

    console.log("サーバーから移動完了を受信:", data); // これを追加
    currentRoomName = data.room;

    // 1. 移動ボタンを再描画
    refreshButtons(); 
    
    // 2. 赤い点の位置を更新
    updateDotPosition(); 

    console.log("現在地を更新しました:", currentRoomName, "移動可能:", canMoveList);
});


socket.on('role_update', (data) => {
    console.log("役職データを受信:", data);
    myRole = data.role;

    const roleImg = document.getElementById('role-image');
    const roleText = document.getElementById('role-name-text');

    if (roleImg && roleText) {
        // 画像をセット
        const imgPath = ROLE_IMAGES[myRole] || "/static/村人.png";
        roleImg.src = imgPath;
        roleImg.style.display = "block";
        
        // テキストを更新
        roleText.innerText = myRole;
        
        // CSSを少し調整して見やすくする
        roleText.style.color = (myRole === "人狼") ? "#ff4d4d" : "#ffffff";
    }
});

// チャットの受信
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
    playerList = data; 
    const listArea = document.getElementById('player-list-area');
    if (listArea) {
        listArea.innerHTML = data.map(p => `
            <div style="padding:8px; border-bottom:1px solid #444; color: ${p.alive ? '#fff' : '#ff4444'}">
                ${p.name} [${p.role}] - ${p.alive ? '生存' : '死亡'}
            </div>`).join('');
    }
});

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

// --- 5. プレイヤー操作関連の関数 ---


function sendMessage() {
    const input = document.getElementById('message-input');
        const msgContent = input.value.trim();

        if (msgContent && myName) {
            // ここで送るデータの名前を "msg" に統一します
            socket.emit('chat_message', { 
                name: myName, 
                msg: msgContent  // ここを "message" などにしていると Python側で null になります
            });
            input.value = "";
        }
}




// Enterキーでも送信できるようにする
document.getElementById('message-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

function refreshButtons() {
    const container = document.getElementById('scroll-actions');
    if (!container) return;
    container.innerHTML = ""; 

    // 移動ボタンの生成
    if (canMoveList && canMoveList.length > 0) {
        canMoveList.forEach(roomName => {
            const btn = document.createElement('button');
            btn.className = "qr-btn";
            btn.innerText = roomName + "へ移動";
            
            btn.onclick = () => {
                console.log("移動ボタン押下:", roomName); // ログで確認
                // サーバー側の引数名が 'room' か 'destination' か確認が必要ですが、
                // 一般的には {'room': roomName} で送ります
                socket.emit('move', { room: roomName });
            };
            
            container.appendChild(btn);
        });
    }
}
// 補助関数：スキルボタン作成用
function addSkillBtn(actionName) {
    const container = document.getElementById('scroll-actions');
    const btn = document.createElement('button');
    btn.className = "qr-btn skill-btn";
    btn.innerText = actionName;
    btn.onclick = () => {
        const target = prompt(actionName + "対象のプレイヤー名を入力してください");
        if (target) socket.emit('use_skill', { action: actionName, target: target });
    };
    container.appendChild(btn);
}

// --- 6. UI表示・画像関連 ---

// 現在地のドット移動
function updateDotPosition() {
    const coord = ROOM_COORDINATES[currentRoomName];
    const miniDot = document.getElementById('location-dot');
    
    // 全画面用のドットがある場合も考慮
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

// プレイヤー統計の表示
function updateStatsUI(wins, losses) {
    const statsArea = document.getElementById('user-stats-display');
    if (statsArea) {
        statsArea.innerHTML = `👤 ${myName}<br>🏆 勝利: ${wins} / 💀 敗北: ${losses}`;
    }
}

// システムメッセージをチャット欄に追加
function addSystemMessage(msg) {
    const area = document.getElementById('chat-area');
    if (!area) return;
    area.innerHTML += `
        <div class="msg-container">
            <div class="msg-item" style="background: #ffeb3b; color: #000; font-weight: bold; border: none;">${msg}</div>
        </div>`;
    area.scrollTop = area.scrollHeight;
}

function changePhase(phase) {
    socket.emit('change_phase', { phase: phase });
}

// GM用：試合終了（JSONリセット）関数
function endGame() {
    if (confirm("試合を終了して役職データをリセットしますか？")) {
        socket.emit('game_end_signal', {});
    }
}

function openPlayerList() { document.getElementById('gm-player-modal').style.display = 'flex'; }
function closePlayerList() { document.getElementById('gm-player-modal').style.display = 'none'; }

// 全画面表示機能
function showRoleFullscreen() { showFull(ROLE_IMAGES[myRole], "あなたの役職: " + myRole); }

function showFullMap() { 
    // 変数が空ならデフォルトの昼マップを指定
    const url = currentMapUrl || MAP_IMAGES["day"];
    showFull(url, "🗺️ 全体図"); 
}
function showCurrentLocation() { 
    // currentRoomUrl が空なら現在の部屋名から画像を探す
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
    
    // 地図の時だけ現在地ドットを表示
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

function displaySystemMessage(name, msg) {
    const chatLog = document.getElementById('chat-log');
    if (!chatLog) return;

    const div = document.createElement('div');
    // 既存のチャットデザインに合わせたクラスを付ける（例：system-msg）
    div.className = 'chat-message system-message'; 
    div.innerHTML = `<span style="font-weight:bold; color:#ff9800;">[${name}]</span> ${msg}`;
    
    chatLog.appendChild(div);
    
    // 一番下までスクロール
    chatLog.scrollTop = chatLog.scrollHeight;
}

// script.js の socket.on('nearby_players_list', ...) を以下に差し替え
// 周辺確認の結果を「いつもの会話（左上）」に流す修正
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

    // 左上の「いつもの場所」を取得
    const area = document.getElementById('chat-area');
    if (area) {
        // いつものチャットと同じ HTML構造で作成
        const msgHtml = `
            <div class="msg-container">
                <div class="user-name" style="color: #ff9800;">システム</div>
                <div class="msg-item" style="border: 1px solid #ff9800; background: rgba(255, 153, 0, 0.88); color: #fff;">
                    ${message}
                </div>
            </div>`;
        
        area.innerHTML += msgHtml;
        area.scrollTop = area.scrollHeight;

        // もし一定時間で消したい場合はここに追加（任意）
        // 178行目付近の new_chat と同じ消去処理を入れることも可能です
    }
});

function addMessageToLog(name, msg, className = "") {
    const chatLog = document.getElementById('chat-log');
    if (!chatLog) return;

    const div = document.createElement('div');
    div.className = 'chat-message ' + className;
    // 他のメッセージと同じHTML構造にする
    div.innerHTML = `<strong>${name}:</strong> ${msg}`;
    
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight; // 自動スクロール
}

// エンターキーでの送信・ログイン対応
document.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const activeEl = document.activeElement;
        if (activeEl.id === 'chat-input') {
            sendMessage();
        } else if (activeEl.classList.contains('auth-input')) {
            submitAuth();
        }
    }
});



window.onload = function() {
    const params = new URLSearchParams(window.location.search);
    const nameFromUrl = params.get('name');
    
    const overlay = document.getElementById('login-overlay');
    const gameCon = document.getElementById('game-container');
    const mapDisplay = document.getElementById('map-display');
    const gmConsole = document.getElementById('gm-console');

    if (nameFromUrl) {
        myName = nameFromUrl;

        // 1. 画面の表示切り替え
        if (overlay) overlay.style.display = 'none';
        if (gameCon) gameCon.style.display = 'flex';

        // 2. マップ初期化
        if (mapDisplay) mapDisplay.src = "/static/マップ画像昼.png";

        // 3. GM判定
        if (nameFromUrl === "gm_jinrouGM") {
            isGM = true;
            document.body.classList.add('gm-active');
            if (gmConsole) {
                // もう消されることはないので普通に表示するだけでOK
                gmConsole.style.display = 'block'; 
            }
        } else {
            isGM = false;
        }

        // 4. 初期化処理
        currentRoomName = "待機室";
        if (typeof updateDotPosition === 'function') updateDotPosition();
        if (typeof refreshButtons === 'function') refreshButtons();

        // 5. サーバーに参加を通知
        setTimeout(() => {
            console.log("サーバーに参加リクエストを送信:", myName);
            socket.emit('join_game', { username: myName });
        }, 500);
    }
};


// 役職とタイマーの受信イベント（これらも末尾に置いておく）
socket.on('role_update', function(data) { if (data.role) updateRoleUI(data.role); });
socket.on('role_assigned', function(data) { if (data.role) updateRoleUI(data.role); });

socket.on('timer_update', function(data) {
    const timeLeftElement = document.getElementById('time-left');
    if (timeLeftElement) {
        const min = Math.floor(data.remaining_time / 60);
        const sec = data.remaining_time % 60;
        timeLeftElement.innerText = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }
});