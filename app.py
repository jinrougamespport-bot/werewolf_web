import sys
import os
from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room, leave_room

# ログ出力設定
try:
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)
except:
    pass

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

players = {}
game_state = {"phase": "day"}

# 移動ルール（ご提示いただいたもの）
ROOM_MOVES = {
    "待機室": ["広場"], # 待機室からは広場へ
    "風車": ["広場"],
    "広場": ["風車", "配電室", "貯水タンク", "Mさんの家", "Aさんの家", "畑", "村長の家", "Sさんの家", "パン屋"],
    "Mさんの家": ["広場", "Aさんの家"],
    "Aさんの家": ["Mさんの家", "広場"],
    "Sさんの家": ["広場", "パン屋"],
    "村長の家": ["貯水タンク", "畑", "広場"],
    "配電室": ["広場"],
    "貯水タンク": ["広場", "畑", "村長の家"],
    "畑": ["貯水タンク", "村長の家", "広場"],
    "パン屋": ["Sさんの家", "広場"]
}

# 画像データ
MAP_URLS = {
    "day": "/static/マップ画像昼テキスト付.png",
    "night": "/static/マップ画像夜テキスト付.png"
}

ROOM_DATA = {
    "待機室": "/static/待機室テキスト付.png",
    "広場": "/static/広場テキスト付.png",
    "Aさんの家": "/static/Aさんの家テキスト付.png",
    "Mさんの家": "/static/Mさんの家テキスト付.png",
    "Sさんの家": "/static/Sさんの家テキスト付.png",
    "パン屋": "/static/パン屋テキスト付.png",
    "貯水タンク": "/static/貯水タンクテキスト付.png",
    "配電室": "/static/配電室テキスト付.png",
    "畑": "/static/畑テキスト付.png",
    "風車": "/static/風車テキスト付.png",
    "村長の家": "/static/待機室テキスト付.png" # 画像がない場合は待機室などで代用
}

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('join_game')
def handle_join(data):
    username = data.get('username', '名無し')
    players[request.sid] = {"name": username, "room": "待機室"}
    join_room("待機室")
    # 初期情報送信
    emit('phase_update', {"phase": game_state["phase"], "url": MAP_URLS[game_state["phase"]]})
    # 移動可能先を添えて送信
    emit('room_update', {
        "room": "待機室", 
        "url": ROOM_DATA["待機室"],
        "can_move_to": ROOM_MOVES.get("待機室", [])
    })

@socketio.on('move')
def handle_move(data):
    new_room = data.get('room')
    user = players.get(request.sid)
    if not user: return
    
    current_room = user['room']
    # 移動可能リストに入っているかチェック
    if new_room in ROOM_MOVES.get(current_room, []):
        leave_room(current_room)
        join_room(new_room)
        user['room'] = new_room
        emit('room_update', {
            "room": new_room, 
            "url": ROOM_DATA.get(new_room, "/static/待機室テキスト付.png"),
            "can_move_to": ROOM_MOVES.get(new_room, [])
        })

@socketio.on('chat_message')
def handle_chat(data):
    user = players.get(request.sid)
    if user:
        emit('new_chat', {'name': user['name'], 'msg': data['message']}, to=user['room'])

@socketio.on('change_phase')
def handle_phase(data):
    new_phase = data.get('phase')
    game_state["phase"] = new_phase
    emit('phase_update', {"phase": new_phase, "url": MAP_URLS[new_phase]}, broadcast=True)

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 10000))
    socketio.run(app, host='0.0.0.0', port=port)