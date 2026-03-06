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

app.secret_key = 'random_secret_key' # セッション用に適当な文字列を設定
oauth = OAuth(app)


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

# Discordの設定追加
oauth.register(
    name='discord',
    client_id=os.getenv('DISCORD_CLIENT_ID'),
    client_secret=os.getenv('DISCORD_CLIENT_SECRET'),
    access_token_url='https://discord.com/api/oauth2/token',
    authorize_url='https://discord.com/api/oauth2/authorize',
    api_base_url='https://discord.com/api/',
    client_kwargs={'scope': 'identify email'}, # identifyでユーザー名やアイコンを取得
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

MAP_URLS = {
    "day": "/static/マップ画像昼.png",
    "night": "/static/マップ画像夜.png"
}

ROOM_DATA = {
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
    "村長の家": "/static/待機室.png"
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

@socketio.on('join_game')
def handle_join(data):
    username = data.get('username')
    sid = request.sid
    
    # JSONから役職を読み込み、なければ割り当てて保存
    saved_roles = load_roles()
    if username in saved_roles:
        assigned_role = saved_roles[username]
    else:
        # GM専用の名前でなければランダム
        if username == "gm_jinrouGM":
            assigned_role = "GM"
        else:
            assigned_role = random.choice(["村人", "人狼", "占い師", "守り人"])
        saved_roles[username] = assigned_role
        save_roles(saved_roles)


    players[sid] = {
        'name': username,
        'room': '待機室',
        'role': assigned_role,
        'is_alive': True,
        'is_gm': (assigned_role == "GM")
    }

    join_room("待機室")
    emit('role_update', {'role': assigned_role}, to=sid)
    emit('room_update', {
        "room": "待機室",
        "url": ROOM_DATA.get("待機室"),
        "can_move_to": ROOM_MOVES.get("待機室")
    }, to=sid)
    emit_player_list()




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


@socketio.on('chat_message') # JS側の socket.emit('chat_message') と合わせる
def handle_chat(data):
    user = players.get(request.sid)

    if user:
        name = user['name']
        msg = data.get('msg')
        room = user.get('room', '不明') # 現在の部屋名を取得

        # 名前に (部屋名) を付けて、誰がどこで話しているか分かりやすくする
        display_name = f"{name} ({room})"

        # 【修正ポイント】to=room を削除し、broadcast=True を追加
        emit('new_chat', {'name': display_name, 'msg': msg}, broadcast=True)

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

@socketio.on('move')
def handle_move(data):
    new_room = data.get('room')
    user = players.get(request.sid)
    
    print(f"DEBUG: 移動リクエスト受信 - ユーザー: {user}, 行き先: {new_room}")

    if user and new_room in ROOM_MOVES.get(user['room'], []):
        # 以前の部屋から退出して新しい部屋へ（Socket.IOのルーム機能）
        leave_room(user['room'])
        join_room(new_room)
        
        # ユーザー情報を更新
        user['room'] = new_room
        
        print(f"DEBUG: 移動成功 - {user['name']} は {new_room} に移動しました")

        # 本人に更新情報を送る (to=request.sid を追加)
        emit('room_update', {
            "room": new_room,
            "url": ROOM_DATA.get(new_room, f"/static/{new_room}.png"), # URLが空なら補完
            "can_move_to": ROOM_MOVES.get(new_room, [])
        }, to=request.sid)
    else:
        print(f"DEBUG: 移動失敗 - 条件を満たしていません (user={user})")

@socketio.on('use_skill')
def handle_skill(data):
    user = players.get(request.sid)
    target_name = data.get('target')
    skill_type = data.get('skill')
    if not user or not user['is_alive']: return

    target_sid = next((sid for sid, p in players.items() if p['name'] == target_name), None)
    if not target_sid: return

    # GMログ
    log_msg = f"【能力】{user['name']}({user['role']}) -> {target_name}: {skill_type}"
    for sid, p in players.items():
        if p.get('is_gm'):
            emit('new_chat', {'name': 'GMログ', 'msg': log_msg}, to=sid)

    if skill_type == "襲撃する":
        players[target_sid]['is_alive'] = False
        emit('player_died', {"msg": "人狼に襲撃されました。"}, to=target_sid)
        emit('new_chat', {'name': 'システム', 'msg': f"【速報】{target_name} さんが無残な姿で発見されました。"}, broadcast=True)
        emit_player_list()


@socketio.on('change_phase')
def handle_phase(data):
    user = players.get(request.sid)
    if user and (user.get('name') == "gm_jinrouGM" or user.get('is_gm')):
        new_phase = data.get('phase')
        if new_phase in MAP_URLS:
            game_state["phase"] = new_phase
            new_time = DAY_TIME if new_phase == "day" else NIGHT_TIME
            game_state["remaining_time"] = new_time
            
            # --- 修正ポイント： broadcast=True を消す ---
            # socketio.emit なら、これだけで全員に飛びます
            socketio.emit('phase_update', {
                "phase": new_phase, 
                "url": MAP_URLS[new_phase]
            })
            
            socketio.emit('timer_update', {
                "remaining_time": new_time,
                "phase": new_phase
            })
            # ------------------------------------------

            print(f"Phase changed to {new_phase}, time reset to {new_time}")


# --- 試合終了ボタン用 ---
@socketio.on('game_end_signal')
def handle_game_end(data):
    # 全員を待機室へ戻す処理など（必要に応じて追加）
    socketio.emit('system_message', {'msg': 'GMが試合を終了しました。'}, broadcast=True)


@socketio.on('disconnect')
def handle_disconnect():
    if request.sid in players:
        del players[request.sid]
        emit_player_list()

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
            return jsonify({"success": True, "msg": "登録完了！"})

        else:  # ログイン処理
            if username in users:
                if check_password_hash(users[username]['password'], password):
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
                # フェーズ切り替え（ここは今のままでOK）
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
    # 'dashboard_page' ではなく 'dashboard' に変更します
    return redirect(url_for('dashboard', name=name))

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
    return redirect(url_for('dashboard', name=name))




# ログイン用のルート
@app.route('/login/discord')
def login_discord():
    redirect_uri = url_for('auth_discord', _external=True)
    return oauth.discord.authorize_redirect(redirect_uri)

# コールバック（戻り先）のルート
@app.route('/auth/discord')
def auth_discord():
    token = oauth.discord.authorize_access_token()
    resp = oauth.discord.get('users/@me')
    user_info = resp.json()
    # ここで user_info['username'] などが取得できます
    # セッションへの保存処理などを書く
    return redirect('/')


if __name__ == '__main__':
    eventlet.spawn(game_timer_loop)
    socketio.run(app, host='0.0.0.0', port=10000, debug=True)