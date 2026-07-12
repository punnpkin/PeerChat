import asyncio
import json
import logging
import os
import random
import signal
import websockets
from http import HTTPStatus
from pathlib import Path


# ===== Logging =====
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("peerchat")

STATIC_DIR = Path(__file__).parent / "static"
rooms = {}
# Track for logging
active_connections = 0


def generate_room_code():
    while True:
        code = "".join(str(random.randint(0, 9)) for _ in range(8))
        if code not in rooms:
            return code


async def handle_message(websocket, message):
    global active_connections
    try:
        msg = json.loads(message)
    except json.JSONDecodeError:
        log.warning("收到非 JSON 消息，已忽略")
        return

    msg_type = msg.get("type")
    nickname = msg.get("nickname", "")

    if msg_type == "create_room":
        code = generate_room_code()
        rooms[code] = {
            "clients": [websocket],
            "nicknames": [nickname],
        }
        websocket.room_code = code
        log.info("用户 %r 创建了会话 %s（当前活跃房间 %d）", nickname, code, len(rooms))
        await websocket.send(
            json.dumps(
                {
                    "type": "room_created",
                    "room_code": code,
                    "nickname": nickname,
                    "is_initiator": True,
                }
            )
        )
        return

    if msg_type == "join_room":
        code = msg.get("room_code", "").strip()
        if code not in rooms:
            log.warning("用户 %r 尝试加入不存在的房间 %s", nickname, code)
            await websocket.send(
                json.dumps({"type": "error", "message": "房间码不存在"})
            )
            return
        room = rooms[code]
        if len(room["clients"]) >= 2:
            log.warning("用户 %r 尝试加入已满的房间 %s", nickname, code)
            await websocket.send(
                json.dumps({"type": "error", "message": "房间已满"})
            )
            return

        websocket.room_code = code
        existing_ws = room["clients"][0]
        existing_nick = room["nicknames"][0]

        room["clients"].append(websocket)
        room["nicknames"].append(nickname)

        log.info("用户 %r 加入会话 %s（与 %r 配对）", nickname, code, existing_nick)
        await websocket.send(
            json.dumps(
                {
                    "type": "room_joined",
                    "room_code": code,
                    "peer_nickname": existing_nick,
                    "nickname": nickname,
                    "is_initiator": False,
                }
            )
        )
        await existing_ws.send(
            json.dumps(
                {
                    "type": "peer_joined",
                    "peer_nickname": nickname,
                    "room_code": code,
                }
            )
        )
        return

    if msg_type == "signal":
        code = msg.get("room_code", "")
        if code not in rooms:
            return
        room = rooms[code]
        for client in room["clients"]:
            if client != websocket:
                try:
                    await client.send(
                        json.dumps(
                            {"type": "signal", "data": msg.get("data")}
                        )
                    )
                except Exception:
                    pass
        return

    if msg_type == "leave":
        code = getattr(websocket, "room_code", None)
        nick = getattr(websocket, "nickname", "")
        if code and code in rooms:
            room = rooms[code]
            # 从房间中移除自己，确保后续 cleanup 不会再重复通知对方
            if websocket in room["clients"]:
                idx = room["clients"].index(websocket)
                room["clients"].pop(idx)
                room["nicknames"].pop(idx)
                log.info(
                    "用户 %r 主动离开会话 %s（剩余 %d 人）",
                    nick,
                    code,
                    len(room["clients"]),
                )
                # 通知剩余用户
                for client in list(room["clients"]):
                    try:
                        await client.send(
                            json.dumps({"type": "peer_left"})
                        )
                    except Exception:
                        pass
                if not room["clients"]:
                    rooms.pop(code, None)
                    log.info("会话 %s 已销毁，剩余活跃房间 %d", code, len(rooms))
        # 清除标记，避免 ws_handler 的 cleanup 再次处理
        websocket.room_code = None
        return


async def cleanup(websocket):
    global active_connections
    code = getattr(websocket, "room_code", None)
    active_connections = max(0, active_connections - 1)

    if not code:
        return
    # 竞态保护：服务器批量关闭时多个连接可能同时走到这里
    room = rooms.get(code)
    if not room:
        return
    if websocket in room["clients"]:
        idx = room["clients"].index(websocket)
        leaving_nick = room["nicknames"][idx]
        room["clients"].pop(idx)
        room["nicknames"].pop(idx)
        log.info("用户 %r 离开会话 %s（剩余 %d 人）", leaving_nick, code, len(room["clients"]))
    for client in room["clients"]:
        try:
            await client.send(json.dumps({"type": "peer_left"}))
        except Exception:
            pass
    if not room["clients"]:
        rooms.pop(code, None)
        log.info("会话 %s 已销毁，剩余活跃房间 %d", code, len(rooms))


async def ws_handler(websocket):
    global active_connections
    active_connections += 1
    log.info("新连接来自 %s（当前活跃连接 %d）", websocket.remote_address, active_connections)
    try:
        while True:
            try:
                message = await websocket.recv()
            except Exception:
                break
            await handle_message(websocket, message)
    finally:
        await cleanup(websocket)


async def http_handler(path, request_headers):
    if request_headers.get("Upgrade", "").lower() == "websocket":
        return None

    url_path = path.split("?", 1)[0]
    if url_path == "/" or url_path == "":
        file_path = STATIC_DIR / "index.html"
    else:
        file_path = STATIC_DIR / url_path.lstrip("/")

    try:
        file_path = file_path.resolve()
        if not str(file_path).startswith(str(STATIC_DIR.resolve())):
            return (HTTPStatus.FORBIDDEN, {}, b"Forbidden")
        if file_path.is_file():
            content = file_path.read_bytes()
            ext = file_path.suffix.lower()
            content_types = {
                ".html": "text/html; charset=utf-8",
                ".js": "application/javascript; charset=utf-8",
                ".css": "text/css; charset=utf-8",
                ".svg": "image/svg+xml",
                ".json": "application/json; charset=utf-8",
                ".png": "image/png",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".ico": "image/x-icon",
            }
            headers = [("Content-Type", content_types.get(ext, "application/octet-stream"))]
            return (HTTPStatus.OK, headers, content)
    except Exception as e:
        log.warning("静态文件请求失败 %s: %s", path, e)
    return (HTTPStatus.NOT_FOUND, {}, b"Not Found")


async def main():
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", 8000))

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()

    # === 全局信号处理器（跨平台/跨循环类型都能工作） ===
    # 1) 用一个同步标志位，signal.signal() 在任意线程/任意状态下都能置位
    # 2) 启动一个 0.1s 心跳任务轮询该标志位，保证即使服务器空转也能立即响应
    shutdown_requested = {"flag": False}

    def _trigger_shutdown(signum, frame):
        if shutdown_requested["flag"]:
            # 第二次 Ctrl+C：强制立即退出
            log.info("再次收到信号，强制退出")
            os._exit(1)
        shutdown_requested["flag"] = True
        log.info("收到退出信号，正在优雅关闭服务器...")

    signal.signal(signal.SIGINT, _trigger_shutdown)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _trigger_shutdown)

    async def _heartbeat():
        while not shutdown_requested["flag"]:
            await asyncio.sleep(0.1)
        stop.set()

    hb_task = asyncio.create_task(_heartbeat())

    log.info("PeerChat 服务启动: http://%s:%d", host, port)
    if not (STATIC_DIR / "tailwind.js").is_file():
        log.warning(
            "未找到 static/tailwind.js — 浏览器将从 CDN 加载 Tailwind。"
            " 内网部署请先执行: python download_tailwind.py"
        )

    async with websockets.serve(
        ws_handler, host, port, process_request=http_handler
    ) as server:
        try:
            await stop.wait()
        finally:
            # 主动关闭所有 WebSocket 连接
            try:
                server.close()
                await server.wait_closed()
            except Exception:
                pass

            # 清理残留房间中的连接
            for code, room in list(rooms.items()):
                for client in list(room["clients"]):
                    try:
                        await client.close()
                    except Exception:
                        pass
            rooms.clear()

            # 取消心跳任务
            hb_task.cancel()
            try:
                await hb_task
            except asyncio.CancelledError:
                pass

            log.info("服务器已优雅关闭，再见 👋")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        # Extra safety net
        log.info("KeyboardInterrupt，退出。")
    except Exception as e:
        log.error("服务器异常退出: %s", e)