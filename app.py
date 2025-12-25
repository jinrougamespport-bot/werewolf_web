from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room, leave_room

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

players = {}
game_state = {"phase": "day"}

MAP_URLS = {
    "day": "/static/マップ画像昼テキスト付.png",
    "night": "https://i.imgur.com/6MtoLnG.png"
}

ROOM_DATA = {
    "待機室": "https://i.imgur.com/iewjbtq.png",
    "広場": "https://i.imgur.com/qt7x9D6.png",
    "Aの家": "https://i.imgur.com/VKhyXdr.png",
    "Mの家": "https://i.imgur.com/dcAZSjQ.png",
    "Sの家": "https://i.imgur.com/4m5cW8K.png",
    "パン屋": "https://i.imgur.com/rCTQaT3.png",
    "貯水タンク": "https://i.imgur.com/Wx8Hwbc.png",
    "電気室": "https://i.imgur.com/n4tHXqB.png",
    "畑": "https://i.imgur.com/gScqC7X.png",
    "風車": "https://i.imgur.com/a9aN91O.png"
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
    # 外部サーバーのポート番号に対応させるための設定
    import os
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, host='0.0.0.0', port=port)
