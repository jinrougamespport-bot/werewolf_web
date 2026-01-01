import sys
import os
import random
from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room, leave_room
import threading
import time

# タイマー管理用
game_timer = None
DAY_TIME = 300  # 昼の時間（秒） 5分
NIGHT_TIME = 60 # 夜の時間（秒） 1分

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

players = {}
game_state = {"phase": "day"}

MAP_URLS = {
    "day": "/static/マップ画像昼テキスト付.png",
    "night": "/static/マップ画像夜テキスト付.png"
}

ROOM_DATA = {
    "待機室": "/static/待機室テキスト付.png", "広場": "/static/広場テキスト付.png",
    "Aさんの家": "/static/Aさんの家テキスト付.png", "Mさんの家": "/static/Mさんの家テキスト付.png",
    "Sさんの家": "/static/Sさんの家テキスト付.png", "パン屋": "/static/パン屋テキスト付.png",
    "貯水タンク": "/static/貯水タンクテキスト付.png", "配電室": "/static/配電室テキスト付.png",
    "畑": "/static/畑テキスト付.png", "風車": "/static/風車テキスト付.png",
    "村長の家": "/static/待機室テキスト付.png"
}

ROOM_MOVES = {
    "待機室": ["広場"], "風車": ["広場"],
    "広場": ["風車", "配電室", "貯水タンク", "Mさんの家", "Aさんの家", "畑", "村長の家", "Sさんの家", "パン屋"],
    "Mさんの家": ["広場", "Aさんの家"], "Aさんの家": ["Mさんの家", "広場"],
    "Sさんの家": ["広場", "パン屋"], "村長の家": ["貯水タンク", "畑", "広場"],
    "配電室": ["広場"], "貯水タンク": ["広場", "畑", "村長の家"],
    "畑": ["貯水タンク", "村長の家", "広場"], "パン屋": ["Sさんの家", "広場"]
}

def emit_player_list():
    plist = [{"name": p["name"], "role": p["role"], "alive": p["is_alive"], "is_gm": p["is_gm"]} for p in players.values()]
    socketio.emit('update_player_list', plist)

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('join_game')
def handle_join(data):
    username = data.get('username', '名無し')
    is_gm = (username == "gm_jinrouGM")
    if is_gm:
        assigned_role, display_name = "GM", "ゲームマスター"
    else:
        assigned_role = random.choice(["人狼", "占い師", "守り人", "村人"])
        display_name = username

    players[request.sid] = {"name": display_name, "room": "待機室", "role": assigned_role, "is_alive": True, "is_gm": is_gm}
    join_room("待機室")
    emit('role_assigned', {"role": assigned_role, "is_gm": is_gm})
    emit('phase_update', {"phase": game_state["phase"], "url": MAP_URLS[game_state["phase"]]})
    emit('room_update', {"room": "待機室", "url": ROOM_DATA["待機室"], "can_move_to": ROOM_MOVES.get("待機室", [])})
    emit_player_list()
    
    # 最初のプレイヤーが参加した時にタイマーを開始
    global game_timer
    if game_timer is None:
        start_timer()

@socketio.on('move')
def handle_move(data):
    new_room, user = data.get('room'), players.get(request.sid)
    if user and new_room in ROOM_MOVES.get(user['room'], []):
        leave_room(user['room'])
        join_room(new_room)
        user['room'] = new_room
        emit('room_update', {"room": new_room, "url": ROOM_DATA.get(new_room, ""), "can_move_to": ROOM_MOVES.get(new_room, [])})

@socketio.on('chat_message')
def handle_chat(data):
    user = players.get(request.sid)
    if user: emit('new_chat', {'name': user['name'], 'msg': data['message']}, to=user['room'])

@socketio.on('change_phase')
def handle_phase(data):
    user = players.get(request.sid)
    if user and user.get('is_gm'):
        game_state["phase"] = data.get('phase')
        emit('phase_update', {
            "phase": game_state["phase"], 
            "url": MAP_URLS[game_state["phase"]]
        }, broadcast=True)
        # GMが手動で変えたらタイマーをリセット
        start_timer()

def auto_phase_change():
    """一定時間後にフェーズを自動で切り替える関数"""
    global game_timer
    time.sleep(DAY_TIME if game_state["phase"] == "day" else NIGHT_TIME)
    
    new_phase = "night" if game_state["phase"] == "day" else "day"
    game_state["phase"] = new_phase
    socketio.emit('phase_update', {
        "phase": game_state["phase"], 
        "url": MAP_URLS[game_state["phase"]]
    })
    
    start_timer()

def start_timer():
    """タイマーを開始・リセットする関数"""
    global game_timer
    # 簡易的なスレッド管理（本来は停止処理が必要ですが、デモ版として作成）
    game_timer = threading.Thread(target=auto_phase_change, daemon=True)
    game_timer.start()
@socketio.on('use_skill')
def handle_skill(data):
    user = players.get(request.sid)
    target_name = data.get('target')
    if not user: return

    # ターゲットの情報を取得
    target_player = next((p for p in players.values() if p['name'] == target_name), None)
    
    # 【安全策】ターゲットが不在、またはGMだった場合はスキルを発動させない
    if not target_player or target_player.get('is_gm'):
        return 

    # GMログ用のメッセージ作成
    log_msg = f"【能力】{user['name']}({user['role']}) -> {target_name} に「{data.get('skill')}」"
    
    # 全プレイヤーの中からGMを探してログを送信
    for sid, p in players.items():
        if p.get('is_gm'): 
            emit('new_chat', {'name': 'GMログ', 'msg': log_msg}, to=sid)
            
    # 占い師専用の処理
    if user['role'] == "占い師" and "占" in data.get('skill'):
        # ターゲットの役職を判定
        res = "人狼" if target_player['role'] == "人狼" else "人間"
        emit('new_chat', {
            'name': 'システム', 
            'msg': f"🔮占い結果：{target_name} は「{res}」です。"
        }, to=request.sid)
        
@socketio.on('disconnect')
def handle_disconnect():
    if request.sid in players:
        del players[request.sid]
        emit_player_list()

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=10000)