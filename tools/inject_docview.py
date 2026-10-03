#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
docView 实验文档预览 注入工具（固化版）

用途
----
为仿真页面（HTML）一键注入「实验文档预览层」，实现双向跳转：
  · 仿真工具栏 → [实验文档] 按钮（btnShowDoc）→ 打开文档
  · 文档预览层 → [返回实验] 按钮（btnReturnToSim）→ 回到仿真

注入内容（均幂等：已存在则跳过）
  1) <script src="<lib相对路径>/marked.min.js"></script>   （<head> 末尾）
  2) docView 预览层整块（含轻量 LaTeX 公式渲染，来自 tools/docview_template.html）
  3) 工具栏「实验文档」按钮（btnReset 之后）

备份
----
注入前自动把原文件备份为"同名 + _bak"：
  chief/dg6-1.html  →  chief/dg6-1_bak.html
（仅在确实需要写入时才备份；--no-backup 可关闭）

用法
----
  python tools/inject_docview.py chief/dg6-1.html
  python tools/inject_docview.py chief/dg6-1.html ethird/zdh2.html
  python tools/inject_docview.py --check chief/dg6-1.html      # 只检查，不修改
  python tools/inject_docview.py --no-backup chief/dg6-1.html  # 不生成 _bak
  python tools/inject_docview.py --force chief/dg6-1.html      # 已有注入也重新写入（仍会先备份）

说明
----
· 页面的 <title> 必须与文档名一致（fetch('docs/' + <title> + '.md')）。
· 适用于二级目录页面（chief/、ethird/、third/ …）；marked 的相对路径会自动探测。
· 与本工具配套的模板文件：tools/docview_template.html（改模板无需改脚本）。
"""

import io
import os
import re
import shutil
import sys

# --- 控制台编码保护（Windows GBK 控制台）---
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.join(HERE, "docview_template.html")

# 注入成功的判据（验证用）
KEY_ITEMS = [
    ("marked 引用", "lib/marked.min.js"),
    ("docView 预览层", 'id="docView"'),
    ("公式渲染 texRender", "function texRender("),
    ("公式提取 extractFormulas", "extractFormulas(md, formulas)"),
    ("公式替换 renderFormulas", "renderFormulas(docContent, formulas)"),
    ("公式样式 .mblock", ".mblock{"),
    ("实验文档按钮", 'button id="btnShowDoc"'),
    ("返回实验按钮", "btnReturnToSim"),
    ("工具栏 btnReset", "btnReset"),
    ("任务选择 taskSelect", 'id="taskSelect"'),
]


def log(msg=""):
    sys.stdout.write(msg + "\n")


def read_text(path):
    return io.open(path, encoding="utf-8").read()


def write_text(path, text):
    io.open(path, "w", encoding="utf-8", newline="").write(text)


def detect_nl(text):
    """返回文件使用的换行符"""
    return "\r\n" if "\r\n" in text else "\n"


def lib_relative_path(page_path):
    """
    从页面所在目录向上查找含 lib/marked.min.js 的项目根，
    返回 marked.min.js 相对于页面目录的路径（POSIX 分隔符）。
    找不到时退回 '../lib/marked.min.js'。
    """
    page_dir = os.path.dirname(os.path.abspath(page_path))
    cur = page_dir
    while True:
        if os.path.isfile(os.path.join(cur, "lib", "marked.min.js")):
            rel = os.path.relpath(os.path.join(cur, "lib", "marked.min.js"), page_dir)
            return rel.replace("\\", "/")
        parent = os.path.dirname(cur)
        if parent == cur:
            return "../lib/marked.min.js"
        cur = parent


def load_template():
    if not os.path.isfile(TEMPLATE):
        raise SystemExit("缺少模板文件: %s" % TEMPLATE)
    return read_text(TEMPLATE).rstrip("\n")


def backup_path_of(page_path):
    """同名 + _bak 后缀：xxx.html -> xxx_bak.html"""
    root, ext = os.path.splitext(page_path)
    return root + "_bak" + (ext if ext else ".html")


def is_injected(text):
    return (
        'id="docView"' in text
        and "lib/marked.min.js" in text
        and 'button id="btnShowDoc"' in text
    )


def inject_into(text, tpl, nl, lib_rel):
    """返回注入后的文本（不改磁盘）"""
    # 1) marked 引用
    if "lib/marked.min.js" not in text:
        old = "/*$vite$:1*/</style>" + nl + "</head>"
        new = (
            "/*$vite$:1*/</style>"
            + nl
            + '<script src="%s"></script>' % lib_rel
            + nl
            + "</head>"
        )
        if old in text:
            text = text.replace(old, new, 1)
        else:
            # 兜底：直接插在 </head> 前
            text = text.replace(
                "</head>", '<script src="%s"></script>' % lib_rel + nl + "</head>", 1
            )

    # 2) docView 预览层
    if 'id="docView"' not in text:
        old = "<body>" + nl + nl + "    <!-- 顶部工具栏 -->"
        new = "<body>" + nl + nl + tpl + nl + nl + "    <!-- 顶部工具栏 -->"
        if old in text:
            text = text.replace(old, new, 1)
        elif "<body>" in text:
            text = text.replace("<body>", "<body>" + nl + nl + tpl, 1)

    # 3) 实验文档按钮
    if 'button id="btnShowDoc"' not in text:
        old = '<button id="btnReset" title="重置系统">重置系统</button>'
        new = (
            old + nl + nl + '        <button id="btnShowDoc" title="查看实验文档" '
            'style="display:none;">实验文档</button>'
        )
        if old in text:
            text = text.replace(old, new, 1)

    return text


def verify_text(text):
    return [(name, key in text) for name, key in KEY_ITEMS]


def process(page_path, check=False, backup=True, force=False):
    if not os.path.isfile(page_path):
        log("  [跳过] 文件不存在: %s" % page_path)
        return False

    original = read_text(page_path)
    name = os.path.basename(page_path)
    title_m = re.search(r"<title>([^<]*)</title>", original)
    title = title_m.group(1).strip() if title_m else "(无 title)"

    log("")
    log("* %s   <title>%s</title>" % (page_path, title))

    # --check：只报告
    if check:
        items = verify_text(original)
        bad = [n for n, ok in items if not ok]
        if is_injected(original):
            log("  状态: 已注入 [OK] (%d/%d 项)" % (len(items), len(items)))
        else:
            log("  状态: 未注入 [NG]  缺失: %s" % (", ".join(bad) if bad else "—"))
        return is_injected(original)

    if is_injected(original) and not force:
        log("  状态: 已注入，跳过（如需强制重写请加 --force）")
        return True

    # 备份（仅在需要写入时）
    bak = None
    if backup:
        bak = backup_path_of(page_path)
        shutil.copy2(page_path, bak)
        log("  备份: %s" % bak)

    tpl = load_template()
    nl = detect_nl(original)
    lib_rel = lib_relative_path(page_path)
    result = inject_into(original, tpl, nl, lib_rel)
    write_text(page_path, result)

    items = verify_text(result)
    bad = [n for n, ok in items if not ok]
    for n, ok in items:
        log("    %-26s %s" % (n, "OK" if ok else "MISSING"))
    if bad:
        log("  结果: 注入完成，但缺失 %s [NG]" % ", ".join(bad))
        return False
    log(
        "  结果: 注入成功 [OK]  (+%d 字符, 换行=%s, marked=%s)"
        % (len(result) - len(original), "CRLF" if nl == "\r\n" else "LF", lib_rel)
    )
    return True


def main(argv):
    args = argv[1:]
    check = "--check" in args
    backup = "--no-backup" not in args
    force = "--force" in args
    files = [a for a in args if not a.startswith("--")]

    if not files:
        log(__doc__ or "")
        return 2

    ok_all = True
    for f in files:
        ok_all = process(f, check=check, backup=backup, force=force) and ok_all

    log("")
    log("=== %s ===" % ("全部完成" if ok_all else "存在失败项"))
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
