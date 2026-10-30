#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""山河纪 · 本地课件服务

用法：
    python serve.py
    python serve.py --port 8080 --no-open

浏览器会通过 HTTP 读取 assets/ 下的地形贴图与 geo.json，
因此请勿直接双击 index.html（file:// 会被浏览器拦截）。
"""
from __future__ import annotations

import argparse
import http.server
import socketserver
import threading
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def log_message(self, fmt, *args):
        print(f"  {self.address_string()}  {fmt % args}")


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    parser = argparse.ArgumentParser(description="启动山河纪三维历史课件本地服务")
    parser.add_argument("--port", type=int, default=8000, help="起始端口，默认 8000")
    parser.add_argument("--no-open", action="store_true", help="不自动打开浏览器")
    args = parser.parse_args()

    server = None
    port = args.port
    for candidate in range(args.port, args.port + 20):
        try:
            server = Server(("127.0.0.1", candidate), Handler)
            port = candidate
            break
        except OSError:
            continue

    if server is None:
        raise SystemExit(f"端口 {args.port}–{args.port + 19} 均被占用，请用 --port 指定其他端口。")

    url = f"http://127.0.0.1:{port}/"
    print()
    print("  山河纪 · 中国历史三维时空图谱")
    print("  --------------------------------------------------")
    print(f"  本地地址   {url}")
    print(f"  课件目录   {ROOT}")
    print("  停止服务   Ctrl + C")
    print()

    if not args.no_open:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  服务已停止。")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
