import sys
import os
import random
from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room, leave_room

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
    plist = [{"name": p["name"], "role": p["role"], "alive": p["is_alive"]} for p in players.values()]
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
        emit('phase_update', {"phase": game_state["phase"], "url": MAP_URLS[game_state["phase"]]}, broadcast=True)

@socketio.on('use_skill')
def handle_skill(data):
    user = players.get(request.sid)
    if not user: return
    log_msg = f"【能力】{user['name']}({user['role']}) -> {data.get('target')} に「{data.get('skill')}」"
    for sid, p in players.items():
        if p.get('is_gm'): emit('new_chat', {'name': 'GMログ', 'msg': log_msg}, to=sid)
    if user['role'] == "占い師" and "占" in data.get('skill'):
        target = next((p for p in players.values() if p['name'] == data.get('target')), None)
        if target:
            res = "人狼" if target['role'] == "人狼" else "人間"
            emit('new_chat', {'name': 'システム', 'msg': f"🔮占い結果：{target['name']} は「{res}」です。"}, to=request.sid)

@socketio.on('disconnect')
def handle_disconnect():
    if request.sid in players:
        del players[request.sid]
        emit_player_list()

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=10000)