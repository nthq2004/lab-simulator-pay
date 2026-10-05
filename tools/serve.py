#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
本地静态预览服务器（固化版）

用途
----
在项目根目录启动一个本地 HTTP 服务，便于在浏览器中预览本仓库的仿真页面
（例如校验新页面、文档 md 与配图 svg 是否可正常访问）。

用法
----
  python tools/serve.py                 # 默认 127.0.0.1:3456
  python tools/serve.py 8000            # 指定端口
  python tools/serve.py 0.0.0.0 8000    # 指定地址与端口

说明
----
· 自动切换到仓库根目录（本脚本所在目录的上一级）作为网站根。
· 启动后打印可访问的首页地址；Ctrl+C 停止。
"""

import os
import sys
import functools
import http.server
import socketserver


def main(argv):
    host = "127.0.0.1"
    port = 3456
    args = [a for a in argv[1:] if a]
    if len(args) == 1:
        port = int(args[0])
    elif len(args) >= 2:
        host, port = args[0], int(args[1])

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(root)

    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=root)

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer((host, port), handler) as httpd:
        print(
            "Serving %s at http://%s:%d/  (Ctrl+C to stop)" % (root, host, port),
            flush=True,
        )
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped.")


if __name__ == "__main__":
    sys.exit(main(sys.argv))
