"""打包 Zotero 插件 xpi。

用法: python build.py   （版本号取自 manifest.json）
输出: dist/RetainPDF-Translate-<version>.xpi
"""
import json
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
FILES = ["manifest.json", "bootstrap.js", "prefs.js", "prefs.xhtml", "icon.svg"]


def main():
    manifest = json.load(open(os.path.join(HERE, "manifest.json"), encoding="utf-8"))
    version = manifest["version"]
    out_dir = os.path.join(HERE, "dist")
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, f"RetainPDF-Translate-{version}.xpi")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in FILES:
            z.write(os.path.join(HERE, f), f)
    print(f"built: {out} ({os.path.getsize(out)} bytes)")


if __name__ == "__main__":
    main()
