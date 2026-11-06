"""生成 MSIX 清单需要的 PNG 图标（不依赖 Pillow，纯标准库手写 PNG）。

图标画法和 plugin/icon.svg 一致：蓝色圆角方块 + 白色播放三角 + 白色下划线。
用法：python make-assets.py <输出目录>
"""

import struct
import sys
import zlib
from pathlib import Path


def rounded_rect_alpha(x, y, w, h, r):
    """返回 (x, y) 是否在圆角矩形内。"""
    if x < 0 or y < 0 or x >= w or y >= h:
        return False
    cx = min(max(x, r), w - 1 - r)
    cy = min(max(y, r), h - 1 - r)
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= r * r or (r <= x < w - r) or (r <= y < h - r)


def make_png(size, path):
    w = h = size
    bg = (0x2F, 0x6B, 0xFF)
    fg = (0xFF, 0xFF, 0xFF)
    r = max(2, round(size * 0.18))

    rows = []
    for y in range(h):
        row = bytearray()
        for x in range(w):
            inside = rounded_rect_alpha(x, y, w, h, r)
            if not inside:
                row += bytes((0, 0, 0, 0))
                continue
            color = bg
            # 播放三角：归一化坐标
            nx, ny = x / w, y / h
            if 0.24 <= nx <= 0.52 and 0.30 <= ny <= 0.66:
                left = 0.24
                right = 0.52
                half = (right - left) * 0.55
                mid = 0.48
                span = half * (1 - (nx - left) / (right - left))
                if abs(ny - mid) <= span * 0.5:
                    color = fg
            # 下划线
            if 0.24 <= nx <= 0.76 and 0.74 <= ny <= 0.84:
                color = fg
            row += bytes((*color, 255))
        rows.append(bytes(row))

    raw = b"".join(b"\x00" + row for row in rows)

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    Path(path).write_bytes(png)
    print(f"wrote {path} ({len(png)} bytes)")


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "package/Assets")
    out.mkdir(parents=True, exist_ok=True)
    for name, size in {
        "Square44x44Logo.png": 44,
        "Square150x150Logo.png": 150,
        "StoreLogo.png": 50,
    }.items():
        make_png(size, out / name)
