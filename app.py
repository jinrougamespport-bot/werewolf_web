import sys
from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room, leave_room
import os

app = Flask(__name__)
# Renderでの動作を安定させるための設定
socketio = SocketIO(app, cors_allowed_origins="*")
sys.stderr.reconfigure(line_buffering=True)
print("--- サーバーを起動しています ---", flush=True)

players = {}
game_state = {"phase": "day"}

# 画像パス（staticフォルダ内のファイル名と完全に一致させてください）
MAP_URLS = {
    "day": "/static/マップ画像昼テキスト付.png",
    "night": "/static/マップ画像夜テキスト付.png"
}

ROOM_DATA = {
    "待機室": "/static/待機室テキスト付.png",
    "広場": "/static/広場テキスト付.png",
    "Aの家": "/static/Aの家テキスト付.png",
    "Mの家": "/static/Mの家テキスト付.png",
    "Sの家": "/static/Sの家テキスト付.png",
    "パン屋": "/static/パン屋テキスト付.png",
    "貯水タンク": "/static/貯水タンクテキスト付.png",
    "電気室": "/static/電気室テキスト付.png",
    "畑": "/static/畑テキスト付.png",
    "風車": "/static/風車テキスト付.png"
}

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('join_game')
def handle_join(data):
    username = data.get('username', '名無し')
    players[request.sid] = {"name": username, "room": "待機室"}
    join_room("待機室")
    emit('phase_update', {"phase": game_state["phase"], "url": MAP_URLS[game_state["phase"]]})
    emit('room_update', {"room": "待機室", "url": ROOM_DATA["待機室"]})
    emit('system_message', f"【システム】{username}さんが入室しました", to="待機室", skip_sid=request.sid)

@socketio.on('move')
def handle_move(data):
    new_room = data.get('room')
    if new_room not in ROOM_DATA: return
    user = players.get(request.sid)
    if not user: return
    old_room = user['room']
    username = user['name']
    emit('system_message', f"【システム】{username}さんが去りました", to=old_room, skip_sid=request.sid)
    leave_room(old_room)
    join_room(new_room)
    user['room'] = new_room
    emit('room_update', {"room": new_room, "url": ROOM_DATA[new_room]})
    emit('system_message', f"【システム】{username}さんが同じ部屋に来ました。", to=new_room, skip_sid=request.sid)

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
    # Renderは環境変数PORTを指定してくるため、それに合わせます
    port = int(os.environ.get("PORT", 10000))
    socketio.run(app, host='0.0.0.0', port=port)