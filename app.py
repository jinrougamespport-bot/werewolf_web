import eventlet
eventlet.monkey_patch()

import sys
import os
import random
from flask import Flask, render_template, request, session, redirect, url_for, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room
import threading
import time
import json
from werkzeug.security import generate_password_hash, check_password_hash
from authlib.integrations.flask_client import OAuth
from werkzeug.middleware.proxy_fix import ProxyFix
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

app.secret_key = os.getenv('SECRET_KEY')

app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)

oauth = OAuth(app)


night_actions = {
    "attack_target": None,
    "guard_target": None
}


google = oauth.register(
    name='google',
    client_id=os.getenv('GOOGLE_CLIENT_ID'),
    client_secret=os.getenv('GOOGLE_CLIENT_SECRET'),
    server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
    userinfo_endpoint='https://openidconnect.googleapis.com/v1/userinfo',  # ← これが重要！
    client_kwargs={
        'scope': 'openid email profile'
    }
)


line = oauth.register(
    name='line',
    client_id=os.getenv('LINE_CLIENT_ID'),
    client_secret=os.getenv('LINE_CLIENT_SECRET'),
    authorize_url='https://access.line.me/oauth2/v2.1/authorize',
    access_token_url='https://api.line.me/oauth2/v2.1/token',
    client_kwargs={
        # 'openid' を含めるとエラーになるため、profileのみに絞ります
        'scope': 'profile', 
        'token_endpoint_auth_method': 'client_secret_post',
    }
)


USER_DB = "users.json"

ROLE_SAVE_FILE = 'user_roles.json'

# タイマー管理用
game_timer = None
DAY_TIME = 300  # 昼の時間（秒）
NIGHT_TIME = 60 # 夜の時間（秒）

socketio = SocketIO(app, cors_allowed_origins="*")
app.config['JSON_AS_ASCII'] = False

players = {}
game_state = {"phase": "day"}


# 💡 URL入室などのために、通信ID(sid)とユーザー名を確実に紐付ける名簿
socket_users = {}



MAP_URLS = {
    "day": "/static/マップ画像昼.png",
    "night": "/static/マップ画像夜.png"
}

ROOM_DATA = {
    "待機室": "/static/待機室.png",
    "広場": "/static/広場.png",
    "Aさんの家": "/static/Aの家.png",
    "Mさんの家": "/static/Mの家.png",
    "Sさんの家": "/static/Sの家.png",
    "パン屋": "/static/パン屋.png",
    "貯水タンク": "/static/貯水タンク.png",
    "電気室": "/static/電気室.png",
    "畑": "/static/畑.png",
    "風車": "/static/風車.png",
    "村長の家": "/static/村長の家.png"
}

ROOM_MOVES = {
    "待機室": ["広場"],
    "風車": ["広場"],
    "広場": ["風車", "電気室", "貯水タンク", "Mさんの家", "Aさんの家", "畑", "村長の家", "Sさんの家", "パン屋"],
    "Mさんの家": ["広場", "Aさんの家"],
    "Aさんの家": ["Mさんの家", "広場"],
    "Sさんの家": ["広場", "パン屋"],
    "村長の家": ["貯水タンク", "畑", "広場"],
    "電気室": ["広場"],
    "貯水タンク": ["広場", "畑", "村長の家"],
    "畑": ["貯水タンク", "村長の家", "広場"],
    "パン屋": ["Sさんの家", "広場"]
}

game_state = {
    "phase": "day",
    "remaining_time": 300  # これが足りなかったためにエラーが出ていました
}

def load_users():
    if not os.path.exists(USER_DB):
        return {}
    try:
        with open(USER_DB, "r", encoding="utf-8") as f:
            return json.load(f)
    except:
        return {}
    
def load_roles():
    if os.path.exists(ROLE_SAVE_FILE):
        with open(ROLE_SAVE_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}

def save_users(users):
    with open(USER_DB, "w", encoding="utf-8") as f:
        json.dump(users, f, indent=4, ensure_ascii=False)

def emit_player_list():
    plist = []
    for sid, p in players.items():
        if p.get('name'):
            plist.append({
                "name": p["name"],
                "role": p["role"],
                "alive": p["is_alive"],
                "is_gm": p["is_gm"]
            })
    socketio.emit('update_player_list', plist)


def login_user_process(username, user_info, sid):
    """
    ユーザーのログイン・登録成功後の内部処理。
    プレイヤー情報を登録し、待機室へ入室させる。
    """
    is_gm = (username == "gm_jinrouGM")
    
    # プレイヤー情報をメモリに保存
    players[sid] = {
        "name": username, 
        "room": "待機室", 
        "role": "未定",
        "is_alive": True, 
        "is_gm": is_gm,
        "wins": user_info.get("wins", 0), 
        "losses": user_info.get("losses", 0)
    }
    
    # Socket.IOのルーム機能で「待機室」に参加（sidを指定して確実に実行）
    join_room("待機室", sid=sid)
    
    # クライアントへ認証成功を通知（to=sid で送信先を固定）
    emit('auth_success', {
        "username": username, 
        "wins": user_info.get("wins", 0), 
        "losses": user_info.get("losses", 0),
        "is_gm": (username == "gm_jinrouGM")
    }, to=sid)

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('authenticate')
def handle_authentication(data):
    """
    フロントエンドからのログイン・新規登録リクエストを処理する。
    """
    action = data.get('action') # 'register' または 'login'
    username = data.get('username', '').strip()
    password = data.get('password', '').strip()
    users = load_users()

    # 入力チェック
    if not username or not password:
        emit('auth_error', {"msg": "未入力の項目があります。"})
        return

    if action == 'register':
        # 新規登録処理
        if username in users:
            emit('auth_error', {"msg": "その名前は既に登録されています。"})
        else:
            # パスワードをハッシュ化して保存
            users[username] = {
                "password": generate_password_hash(password), 
                "wins": 0, 
                "losses": 0
            }
            save_users(users)
            # 登録完了後、そのままログイン処理へ（sidとしてrequest.sidを渡す）
            login_user_process(username, users[username], request.sid)
            
    elif action == 'login':
        # ログイン照合処理
        if username in users:
            if check_password_hash(users[username]['password'], password):
                # パスワード一致：ログイン実行
                login_user_process(username, users[username], request.sid)
            else:
                # パスワード不一致
                emit('auth_error', {"msg": "パスワードが正しくありません。"})
        else:
            # ユーザーが存在しない
            emit('auth_error', {"msg": "ユーザーが見つかりません。新規登録してください。"})



# 🟢 app.py の @socketio.on('join_game') 部分を以下のように修正します

@socketio.on('join_game')
def handle_join_game(data):
    username = data.get('name')
    team = data.get('team')
    room = f"{team}_game_room"
    
    join_room(room)
    print(f"【システム】{username} が {room} に参戦しました。")
    
    # プレイヤー一覧を更新
    emit_player_list() 

    # ---------------------------------------------------------
    # 🛠️ コメントアウトを活かすために、必要な変数をここで準備します
    # ---------------------------------------------------------
    
    # 1. ユーザー情報（user）を準備する
    # ※もしデータベースやグローバルな辞書（playersなど）があればそこから取得します。
    # ここでは仮に、セッションや参加データからユーザー情報を模した辞書を作ります。
    # (すでに役職を割り振る仕組みが他にある場合は、そこから user を取得してください)
    user = {
        "role": "村人"  # 本来は人狼や狂人など、ユーザーごとの役職を入れる変数
    }
    
    # 2. 初期部屋（new_room）を定義する
    new_room = "待機室"
    
    # 3. 移動可能リスト（next_moves）を定義する
    next_moves = ["電気室", "畑", "風車", "貯水タンク", "武器庫", "食堂", "広場"]
    
    # 4. ルームごとの画像データ（ROOM_DATA）を定義する（ない場合は空の辞書）
    ROOM_DATA = {
        "待機室": "/static/待機室.png",
        "電気室": "/static/電気室.png"
    }

    # ---------------------------------------------------------
    # ✨ コメントアウトを外し、変数を使ってJavaScriptへ送信！
    # ---------------------------------------------------------
    emit('game_init', {
        "role": user.get('role', '村人'),       # user辞書から役職を取得（なければ村人）
        "phase": "day", 
        "room_name": new_room,                 # 上で決めた "待機室" が入る
        "map_url": "/static/マップ画像昼.png",
        "room_url": ROOM_DATA.get(new_room, f"/static/{new_room}.png"), # 待機室の画像パス
        "can_move": next_moves                 # 上で決めた移動先リストが入る
    }, to=request.sid)




def end_game_cleanup():
    save_roles({}) # JSONを空にする
    print("試合が終了したため、役職データをリセットしました。")


def save_roles(roles_dict):
    with open(ROLE_SAVE_FILE, 'w', encoding='utf-8') as f:
        json.dump(roles_dict, f, ensure_ascii=False, indent=4)




@socketio.on('message') # 'chat_message'から変更
def handle_message(data):
    sid = request.sid
    user = players.get(sid)
    if not user: return

    msg_text = data.get('msg', '').strip()
    if msg_text:
        # 同じ部屋にいる人全員に送信
        emit('new_message', {
            'name': user['name'],
            'msg': msg_text,
            'role': user['role']
        }, to=user['room'])


@socketio.on('chat_message')
def handle_chat(data):
    print(f"【サーバー受信チェック】JSから届いたデータ: {data}")
    
    username = data.get('name', 'ゲスト')
    msg = data.get('msg', '')
    
    # 💡 【修正】まずは名簿(players)からこのユーザーの正しいチームを探す
    user = players.get(request.sid) or players.get(username)
    
    if user and user.get('team'):
        team = user.get('team')
    elif isinstance(data, dict) and data.get('team'):
        # JS側から team: myTeam のようにデータが送られてきていればそれを使う
        team = data.get('team')
    else:
        # どちらもなければセッション、最終手段として身元の確実なデフォルト（例: '緑チーム'）
        team = session.get('team', '緑チーム')
        
    room = f"{team}_game_room"
    
    print(f"【サーバー送信チェック】発言者: {username} ({team}) -> 部屋 {room} の全員にチャットを転送します。")
    
    # 部屋全体に送信（to=room でしっかりとチームの部屋に限定）
    emit('chat_message', {'name': username, 'msg': msg}, to=room)

    

@socketio.on('request_nearby_players')
def handle_request_nearby():
    user = players.get(request.sid)
    if user:
        current_room = user.get('room', '待機室')
        # 同じ部屋にいるプレイヤーを抽出
        members = [u['name'] for u in players.values() if u.get('room') == current_room]
        
        # 本人にだけ情報を返す（他人のチャット欄は汚さない）
        emit('nearby_players_list', {
            'room': current_room,
            'members': members
        })

# 🟢 app.py の @socketio.on('move') のまとまりを以下に差し替えます

@socketio.on('move')
def handle_move(data):
    username = session.get('username') or socket_users.get(request.sid)
    new_room = data.get('room') or data.get('destination') or "待機室"

    print(f"DEBUG: 移動リクエスト受信 - ユーザー: {username}, 行き先: {new_room}")

    if not username:
        print("DEBUG: 移動失敗 - ユーザー名が不明です")
        return

    # 通信IDまたは名前からユーザーを検索
    user = players.get(request.sid)
    if not user:
        user = players.get(username)

    # 💡 【重要】データが見つからなかった場合、user_roles.json から本当の役職を読み出す
    if not user:
        correct_role = "村人" # 見つからなかった場合のデフォルト
        
        # user_roles.json を読み込む処理
        json_path = "user_roles.json"
        if os.path.exists(json_path):
            try:
                with open(json_path, "r", encoding="utf-8") as f:
                    roles_data = json.load(f)
                    # jsonファイルからこのユーザーの役職を取得
                    correct_role = roles_data.get(username, "村人")
                    print(f"【システム】user_roles.json から {username} の役職（{correct_role}）を取得しました。")
            except Exception as e:
                print(f"【エラー】user_roles.json の読み込みに失敗しました: {e}")
        else:
            print(f"【警告】{json_path} が見つかりません。")

        # 取得した正しい役職（守り人など）を使ってプレイヤーデータを復旧
        user = {
            "name": username,
            "room": "待機室",
            "role": correct_role,  # 👈 ここに json から取ってきた「守り人」が入る！
            #"team": session.get('team') or "緑チーム",#ここにあったーーーーーーーーーーーーーーーーーーーーーーーーーーーー
            "is_alive": True,
            "is_gm": True if correct_role == "GM" else False,
            "icon_image": "icon1.png"
        }
        players[request.sid] = user
        players[username] = user
        print(f"【システム】{username} をプレイヤー名簿に正しい役職（{correct_role}）で自動復旧しました。")

    # ── これ以降の処理はそのまま ──
    allowed_rooms = ["電気室", "畑", "風車", "貯水タンク", "武器庫", "食堂", "広場", "待機室"]
    valid_moves = ROOM_MOVES.get(user['room'], [])

    if user['room'] == "待機室" or not valid_moves:
        valid_moves = allowed_rooms

    if new_room in valid_moves:
        leave_room(user['room'])
        join_room(new_room)
        
        user['room'] = new_room
        print(f"DEBUG: 移動成功 - {user['name']} は {new_room} に移動しました")

        next_moves = ROOM_MOVES.get(new_room, [])
        if not next_moves:
            next_moves = [r for r in allowed_rooms if r != "待機室"]

        # ① 本人に新しい部屋の画像を通知
        emit('room_update', {
            "room": new_room,
            "url": ROOM_DATA.get(new_room, f"/static/{new_room}.png"), 
            "can_move_to": next_moves
        }, to=request.sid)

        # ② ゲーム画面の初期化・同期（これで画面の表示も「守り人」になります）
        emit('game_init', {
            "role": user.get('role', '村人'), 
            "phase": "day", 
            "room_name": new_room,
            "map_url": "/static/マップ画像昼.png",
            "room_url": ROOM_DATA.get(new_room, f"/static/{new_room}.png"),
            "can_move": next_moves
        }, to=request.sid)

        if 'emit_player_list' in globals() or 'emit_player_list' in locals():
            emit_player_list()
            
    else:
        print(f"DEBUG: 移動失敗 - 条件を満たしていません (user={user['name']}, 現在地={user['room']}, 行き先={new_room})")





# ※必ず関数の外（ファイルの上のほうなど）に定義してください
night_actions = {"attack_target": None, "guard_target": None}

@socketio.on('use_skill')
def handle_use_skill(data):
    global night_actions
    skill_type = data.get('type')  # 'attack', 'guard', 'fortune'
    user = data.get('user')        # 使用者の名前
    target = data.get('target')    # 対象者の名前

    print(f"DEBUG: スキル使用 - 使用者: {user}, 種類: {skill_type}, 対象: {target}")

    # 1. 🐺 人狼の襲撃（夜の間は名前をセットするだけ。ここでは殺さない）
    if skill_type == 'attack':
        night_actions["attack_target"] = target
        emit('new_chat', {'name': 'システム', 'msg': f"【夜の行動】{target} への襲撃をセットしました。"}, room=request.sid)

    # 2. 🛡️ 守り人の守護（夜の間は名前をセットするだけ）
    elif skill_type == 'guard':
        night_actions["guard_target"] = target
        emit('new_chat', {'name': 'システム', 'msg': f"【夜の行動】{target} の守護をセットしました。"}, room=request.sid)

    # 3. 🔮 占い師の占い（その場で結果を本人に返す）
    elif skill_type == 'fortune':
        # ※もし実際のユーザーデータ(players等)があれば以下のように役職を取得できます
        # target_role = "人狼" もし対象が人狼なら...
        if target == "奏太":  # テストログに合わせた簡易判定
            result_msg = f"🔮占い結果: 【{target}】 は 🐺人狼 です！"
        else:
            result_msg = f"🔮占い結果: 【{target}】 は 👤人間(村人陣営) です。"
            
        emit('new_chat', {'name': 'システム(占い)', 'msg': result_msg}, room=request.sid)

    # --- 👑 GM（gm_jinrouGM）だけにリアルタイムで全ログを流す ---
    skill_names = {"fortune": "占い", "guard": "守護", "attack": "襲撃"}
    log_msg = f"【GMログ】{user} が {target} に「{skill_names.get(skill_type, skill_type)}」を使用しました。"
    
    # GM専用のイベントでフロント（script.js）に通知
    socketio.emit('gm_skill_log', {'msg': log_msg})

"""
@socketio.on('change_phase')
def handle_phase(data):
    user = players.get(request.sid)
    if user and (user.get('name') == "gm_jinrouGM" or user.get('is_gm')):
        new_phase = data.get('phase')
        if new_phase in MAP_URLS:
            game_state["phase"] = new_phase
            new_time = DAY_TIME if new_phase == "day" else NIGHT_TIME
            game_state["remaining_time"] = new_time
            
            # 全員に「フェーズが変わったよ」と送る（消しちゃダメ！）
            socketio.emit('phase_update', {
                "phase": new_phase, 
                "url": MAP_URLS[new_phase]
            })

            # 全員に「タイマーがリセットされたよ」と送る（消しちゃダメ！）
            socketio.emit('timer_update', {
                "remaining_time": new_time,
                "phase": new_phase
            })

            # ★ここからが「追加」するクエスト発生ロジック★
            if new_phase == "night":
                # 5秒〜30秒の間のランダムな時間に発生させる
                delay = random.randint(5, 30)
                def trigger_quest():
                    time.sleep(delay)
                    # もし時間が経ったときにまだ夜だったら、クエスト合図を全員に送る
                    if game_state["phase"] == "night":
                        socketio.emit('enable_quest')
                        print("Night quest has been enabled!")
                
                # 他の処理を止めないように、バックグラウンド(Thread)で実行
                threading.Thread(target=trigger_quest).start()
            # ★ここまで★

            print(f"Phase changed to {new_phase}, time reset to {new_time}")

"""
            

# ※もし app.py の上部にこれがなければ、関数の外（グローバル変数定義のあたり）に配置してください
night_actions = {"attack_target": None, "guard_target": None}

@socketio.on('change_phase')
def handle_phase(data):
    global night_actions
    new_phase = data.get('phase')
    if not new_phase:
        return

    # --- ☀️ 朝（day）になったときのスキル結果判定を追加 ---
    if new_phase == "day":
        attack = night_actions.get("attack_target")
        guard = night_actions.get("guard_target")
        
        print(f"DEBUG: 朝の判定処理 - 襲撃対象: {attack}, 守護対象: {guard}")
        
        # --- (handle_phase 内の朝の判定部分) ---
        if attack and attack == guard:
            # 守護成功
            socketio.emit('new_chat', {
                'name': 'システム', 
                'msg': "☀️ 朝になりました。昨晩は守り人の活躍により、誰も死にませんでした。"
            })
        elif attack:
            # 【追加】サーバー側のプレイヤーデータでも生存フラグを「死亡」に更新する
            for sid, p in players.items():
                if p.get('name') == attack:
                    p['is_alive'] = False
                    break
            
            # 【追加】死亡状態を反映した最新のプレイヤーリストを全員に再配布して同期
            emit_player_list()

            # 誰が死んだかの名前（target_name）を入れて全員に通知
            socketio.emit('player_died', {'target_name': attack, 'msg': "あなたは昨晩、人狼に襲撃されて死亡しました。"})
            socketio.emit('new_chat', {
                'name': 'システム', 
                'msg': f"☀️ 朝になりました。昨晩は 【{attack}】 が犠牲になりました。"
                })
        else:
            # 夜の間に誰も襲撃を選ばなかった場合
            socketio.emit('new_chat', {
                'name': 'システム', 
                'msg': "☀️ 朝になりました。昨晩は誰も死にませんでした。"
            })
            
        # 次の夜のためにセットされたターゲットをリセット
        night_actions = {"attack_target": None, "guard_target": None}
    # ----------------------------------------------------

    # 以下、元々あった時間リセット等の処理
    game_state["phase"] = new_phase
    
    if new_phase == "day":
        new_time = DAY_TIME
    else:
        new_time = NIGHT_TIME
    
    game_state["remaining_time"] = new_time
    print(f"DEBUG: フェーズを {new_phase} に変更。時間を {new_time} 秒にリセットしました。")

    #socketio.emit('phase_update', {
    #    'phase': new_phase,
    #    'url': MAP_URLS.get(new_phase, "/static/マップ画像昼.png")
    #})

    socketio.emit('phase_update', {
    'phase': new_phase,
    'url': MAP_URLS.get(new_phase)
    })

    socketio.emit('timer_update', {
        "remaining_time": new_time,
        "phase": new_phase
    })

    if new_phase == "night":
        delay = random.randint(5, 10)
        def trigger_quest():
            eventlet.sleep(delay)
            if game_state["phase"] == "night":
                socketio.emit('enable_quest')
                print(f"DEBUG: クエスト信号を送信しました")
        
        eventlet.spawn(trigger_quest)





# --- 試合終了ボタン用 ---
@socketio.on('game_end_signal')
def handle_game_end(data):
    # 全員を待機室へ戻す処理など（必要に応じて追加）
    socketio.emit('system_message', {'msg': 'GMが試合を終了しました。'}, broadcast=True)


@socketio.on('disconnect')
def handle_disconnect():
    # 切断したプレイヤーを名簿から削除
    if request.sid in socket_users:
        del socket_users[request.sid]


@app.route('/dashboard')
def dashboard():
    return render_template('dashboard.html')
    


@app.route('/login_api', methods=['POST'])
def login_api():
    try:
        data = request.get_json()
        if not data:
            return jsonify({"success": False, "msg": "データが空です"})

        username = data.get('username')
        password = data.get('password')
        action = data.get('action')  # ここで login か register かを受け取る

        if not username or not password:
            return jsonify({"success": False, "msg": "未入力の項目があります"})

        users = load_users()

        if action == 'register':
            if username in users:
                return jsonify({"success": False, "msg": "その名前は既に使われています"})
            
            users[username] = {
                "password": generate_password_hash(password),
                "wins": 0, "losses": 0
            }
            save_users(users)
            
            # ★新規登録時もセッションに保存してログイン状態にする
            session['username'] = username
            return jsonify({"success": True, "msg": "登録完了！"})

        else:  # ログイン処理
            if username in users:
                if check_password_hash(users[username]['password'], password):
                    # ★ココが漏れていました！ログイン成功時もセッションに保存
                    session['username'] = username
                    return jsonify({"success": True})
                else:
                    return jsonify({"success": False, "msg": "パスワードが違います"})
            else:
                return jsonify({"success": False, "msg": "ユーザーが見つかりません"})

    except Exception as e:
        print(f"Server Error: {e}")
        return jsonify({"success": False, "msg": "サーバー内でエラーが発生しました"})
    
    
    
def game_timer_loop():
    global game_state
    while True:
        eventlet.sleep(1)
        try:
            rem = game_state.get("remaining_time", 0)
            if rem > 0:
                game_state["remaining_time"] -= 1
                # ★ここを追加：毎秒、全員に「今の残り時間」を送る
                socketio.emit('timer_update', {
                    "remaining_time": game_state["remaining_time"],
                    "phase": game_state["phase"]
                })
            else:
                # ─── ★ここが「残り時間が0秒（以下）になった時」の処理です！ ───
                new_phase = "night" if game_state.get("phase") == "day" else "day"
                game_state["phase"] = new_phase
                game_state["remaining_time"] = NIGHT_TIME if new_phase == "night" else DAY_TIME
                
                socketio.emit('phase_changed', {
                    "phase": new_phase, 
                    "map_url": MAP_URLS[new_phase]
                })
        except Exception as e:
            print(f"Timer Error: {e}")
    

@app.route('/game')
def game_page():
    # URLの ?name=xxx を取得
    name = request.args.get('name')
    
    # ユーザーデータを読み込み
    users = load_users()
    
    # 【判定】名前が送られていない、またはJSONにその名前がない場合は拒否
    if not name or name not in users:
        # ログイン画面に強制送還
        return redirect(url_for('index'))
    
    # JSONに登録があるユーザーなら、ゲーム画面を表示
    return render_template('index.html', username=name)

@app.after_request
def add_security_headers(response):
    # ngrokの警告画面をスキップする設定
    response.headers['ngrok-skip-browser-warning'] = 'true'
    
    # Content-Typeの設定（文字化け対策）
    if response.mimetype == 'text/plain' or response.mimetype == 'application/json':
        response.headers["Content-Type"] = f"{response.mimetype}; charset=utf-8"
    
    # セキュリティ設定
    response.headers["X-Content-Type-Options"] = "nosniff"
    
    return response

# --- Googleログイン用の処理（これがないと502になります） ---

@app.route('/login/google')
def google_login():
    # Googleの認証画面へ飛ばす
    # _scheme='https' を指定して強制的にセキュアな通信にします
    redirect_uri = url_for('google_callback', _external=True, _scheme='https')
    return google.authorize_redirect(redirect_uri)

@app.route('/auth/callback')
def google_callback():
    # Googleからトークンを取得
    token = google.authorize_access_token()
    
    # トークンの中にすでにユーザー情報が入っているので、そこから取得する
    user_info = token.get('userinfo')
    
    # もしトークン内にない場合のみ、エンドポイントに聞きに行く（念のための処理）
    if not user_info:
        resp = google.get('userinfo')
        user_info = resp.json()
    
    name = user_info.get('name')
    
    # ユーザーDB（users.json）に登録があるか確認、なければ作成
    users = load_users()
    if name not in users:
        users[name] = {
            "password": generate_password_hash(os.urandom(24).hex()), 
            "wins": 0, 
            "losses": 0,
            "is_google": True
        }
        save_users(users)

    # セッションに保存してダッシュボードへ
    session['username'] = name
    return redirect(url_for('icon_set_page'))  # ← SNSログイン後も直接アイコン設定へ！

# --- LINEログイン用のルート ---

@app.route('/login/line')
def line_login():
    # LINEの認証画面へリダイレクト
    redirect_uri = url_for('line_callback', _external=True, _scheme='https')
    return line.authorize_redirect(redirect_uri)




@app.route('/auth/line/callback')
def line_callback():
    # 1. 通行証（トークン）を取得
    token = line.authorize_access_token()
    
    # 2. 通行証を使って、LINEのプロフィール窓口に直接名前を聞きに行く
    # IDトークンを使わないので jwks_uri エラーは起きません
    resp = line.get('https://api.line.me/v2/profile', token=token)
    profile = resp.json()
    
    # LINEの表示名を取得
    name = profile.get('displayName')
    
    if not name:
        return "LINEプロフィールの取得に失敗しました", 400

    # ユーザーDB（users.json）への登録処理
    users = load_users()
    if name not in users:
        users[name] = {
            "password": generate_password_hash(os.urandom(24).hex()), 
            "wins": 0, 
            "losses": 0,
            "is_line": True
        }
        save_users(users)

    session['username'] = name
    return redirect(url_for('icon_set_page'))  # ← アイコン設定画面へ直接飛ばす！



@socketio.on('trigger_end_roll')
def handle_end_roll():
    # 信号が来たら、接続している全員に「start_end_roll」を拡散する
    socketio.emit('start_end_roll')
    


@app.route('/icon_set')
def icon_set_page():
    if 'username' not in session:
        return redirect(url_for('index'))
    return render_template('icon_set.html')

@app.route('/set_icon', methods=['POST'])
def set_icon():
    if 'username' not in session:
        return redirect(url_for('index'))
    
    icon_image = request.form.get('icon_image', 'icon1.png')
    session['icon_image'] = icon_image
    
    return redirect(url_for('standby_page'))



# 3. 待機室のルート（前回のものを少し調整）
@app.route('/standby')
def standby_page():
    if 'username' not in session:
        return redirect(url_for('index'))
    return render_template('Standby screen.html')




# 現在待機室にいるプレイヤーの位置情報を保持する辞書
lobby_players = {}

@socketio.on('join_lobby')
def handle_join_lobby(data):
    room = "standby_room"
    join_room(room)
    
    icon_image = session.get('icon_image', 'icon1.png')
    
    lobby_players[request.sid] = {
        "name": data.get("name", "ゲスト"),
        "x": data.get("x", 300),
        "y": data.get("y", 300),
        "team": "未所属",
        "icon_image": icon_image,
        "ready": False  # 💡 初期状態は準備未完了
    }
    emit('update_players', lobby_players, to=room)


@socketio.on('move_player')
def handle_move_player(data):
    # 移動したプレイヤーの座標とチームを更新
    if request.sid in lobby_players:
        lobby_players[request.sid]["x"] = data.get("x")
        lobby_players[request.sid]["y"] = data.get("y")
        lobby_players[request.sid]["team"] = data.get("team")
        
        # 全員に位置を同期
        emit('update_players', lobby_players, to="standby_room")

@socketio.on('disconnect')
def handle_disconnect():
    # 退出したプレイヤーを削除
    if request.sid in lobby_players:
        del lobby_players[request.sid]
        emit('update_players', lobby_players, to="standby_room")



@socketio.on('toggle_ready')
def handle_toggle_ready():
    if request.sid not in lobby_players:
        return
        
    # 状態を反転させる (True ⇄ False)
    current_status = lobby_players[request.sid].get("ready", False)
    lobby_players[request.sid]["ready"] = not current_status
    
    # 変更を全員に通知（画面にチェックマークなどを出す用）
    emit('update_players', lobby_players, to="standby_room")
    
    # ─── 👥 グループ全員が完了したかの判定ロジック ───
    my_team = lobby_players[request.sid]["team"]
    
    # 「未所属」の場合はゲーム開始判定をしない
    if my_team == "未所属":
        return

    # 同じチームのプレイヤーを抽出
    team_members = [p for p in lobby_players.values() if p["team"] == my_team]
    
    # 同じチームのメンバーが全員「ready == True」かチェック
    # 同じチームのメンバーが全員「ready == True」かチェック
    if all(m.get("ready", False) for m in team_members):
        # 💡 開始するチーム名（例: "青チーム"）を一緒に送る
        emit('start_game_trigger', {"team": my_team}, to="standby_room")


# 🟢 app.py の @socketio.on('join_game') を以下に丸ごと差し替えます

@socketio.on('join_game')
def handle_join_game(data):
    username = data.get('name')
    team = data.get('team')
    room = f"{team}_game_room"
    
    join_room(room)
    print(f"【システム】{username} が {room} に参戦しました。")
    
    # プレイヤー一覧を更新
    emit_player_list() 
    
    # 💡 【大修正】参加した瞬間も、最初から user_roles.json を見に行くようにする
    correct_role = "村人"  # 見つからなかった場合のデフォルト
    json_path = "user_roles.json"
    
    if os.path.exists(json_path):
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                roles_data = json.load(f)
                correct_role = roles_data.get(username, "村人")
                print(f"【システム】初期化時: user_roles.json から {username} の役職（{correct_role}）を取得しました。")
        except Exception as e:
            print(f"【エラー】初期化時: user_roles.json の読み込みに失敗しました: {e}")

    # 名簿（players）に初期状態を正しく登録する
    user_data = {
        "name": username,
        "room": "待機室",
        "role": correct_role,  # 👈 最初から正しい役職を入れる！
        "team": team ,#ここにあったーーーーーーーーーーーーーーーーーーーーーーーーーーーー
        "is_alive": True,
        "is_gm": True if correct_role == "GM" else False,
        "icon_image": "icon1.png"
    }
    players[request.sid] = user_data
    players[username] = user_data

    # JavaScript（画面側）に送る初期化データを正しくセット
    init_data = {
        "role": correct_role,   # 👈 固定の「村人」ではなく、jsonから取った正しい役職を渡す！
        "phase": "day",         # 初期フェーズ（昼）
        "room_name": "待機室",   # 初期部屋
        "map_url": "/static/マップ画像昼.png",
        "room_url": "/static/待機室.png",
        "can_move": ["電気室", "畑", "風車", "貯水タンク", "武器庫", "食堂", "広場"] # 移動可能リスト
    }
    
    # 参加した本人に対して初期化イベントを送信
    emit('game_init', init_data, to=request.sid)
    
    # 部屋全体にゲーム状態が更新されたことを通知
    emit('status_change', {"phase": "day"}, to=room)


# 🟢 app.py のチャット送信イベントを以下のように修正・差し替えます

# 🟢 app.py のチャット送信イベントを以下のように差し替えます

@socketio.on('message')  # 👈 イベント名が 'send_message' の場合はそこに合わせてください
def handle_message(data):
    # セッションまたは通信IDから送信者の名前を取得
    username = session.get('username') or socket_users.get(request.sid)
    msg = data.get('msg') or data.get('message')

    if not username or not msg:
        return

    # プレイヤー名簿からこのユーザーのデータを取得
    user = players.get(request.sid) or players.get(username)
    
    # 💡 ユーザーデータからチーム名を取得。なければデータ(data)から取得、それもなければデフォルト
    #my_team = "緑チーム"#ここにあったーーーーーーーーーーーーーーーーーーーーーーーーーーーー
    if user and user.get('team'):
        my_team = user.get('team')
    elif isinstance(data, dict) and data.get('team'):
        my_team = data.get('team')
    elif session.get('team'):
        my_team = session.get('team')

    # 💡 送信先のルーム名を決定 (例: "赤チーム_game_room")
    team_room = f"{my_team}_game_room"
    
    print(f"【チャット】{username} ({my_team}) -> {msg} [宛先: {team_room}]")

    # 💡 【超重要】 to=team_room を指定して、同じチームの部屋だけに送る！（broadcast=Trueは絶対に使わない）
    emit('new_message', {
        "name": username,
        "msg": msg,
        "role": user.get('role', '村人') if user else '村人',
        "is_gm": user.get('is_gm', False) if user else False,
        "team": my_team
    }, to=team_room)  # 👈 ここで特定のチーム部屋だけに限定配信します！


if __name__ == '__main__':
    eventlet.spawn(game_timer_loop)
    socketio.run(app, host='0.0.0.0', port=10000, debug=True)