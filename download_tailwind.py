#!/usr/bin/env python3
"""
下载 Tailwind CSS Play CDN 到本地 static/tailwind.js。
使用场景：局域网 / 离线部署。只需在有网环境执行一次。

用法:
    python download_tailwind.py

之后再启动服务:
    python server.py
"""
import urllib.request
import urllib.error
from pathlib import Path

CDN_URL = "https://cdn.tailwindcss.com"
OUTPUT_PATH = Path(__file__).parent / "static" / "tailwind.js"

def main() -> None:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    print(f"正在下载: {CDN_URL}")

    req = urllib.request.Request(
        CDN_URL,
        headers={
            # 模拟浏览器，避免 403 Forbidden
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/122.0.0.0 Safari/537.36"
            ),
            "Accept": "text/javascript, application/javascript, */*;q=0.9",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
        },
        method="GET",
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()
    except urllib.error.HTTPError as e:
        print(f"HTTP 错误: {e.code} {e.reason}")
        _manual_hint()
        raise SystemExit(1)
    except (urllib.error.URLError, TimeoutError) as e:
        print(f"下载失败: {e}")
        _manual_hint()
        raise SystemExit(1)

    if not data:
        print("下载的内容为空，请检查网络。")
        raise SystemExit(1)

    OUTPUT_PATH.write_bytes(data)
    size_kb = len(data) / 1024
    print(f"完成: {OUTPUT_PATH}  ({size_kb:.1f} KB)")


def _manual_hint() -> None:
    print()
    print("=== 手动下载方式 ===")
    print("1) 在浏览器中打开 https://cdn.tailwindcss.com")
    print("2) 将页面中的全部 JS 内容（通常是一个自执行函数）复制到文件:")
    print(f"   {OUTPUT_PATH}")
    print("3) 再运行: python server.py")


if __name__ == "__main__":
    main()