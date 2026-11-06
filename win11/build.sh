#!/usr/bin/env bash
# 编译 Win11 新式右键菜单用的原生组件，打包并签名 MSIX。
# 依赖：/d/mingw64 下的 g++ / windres；签名需要 makeappx / signtool（见 SDK_TOOLS）。
set -euo pipefail

cd "$(dirname "$0")"
GXX=${GXX:-/d/mingw64/cur/bin/g++}
WINDRES=${WINDRES:-/d/mingw64/cur/bin/windres}
SDK_TOOLS=${SDK_TOOLS:-build/sdk/bin/10.0.28000.0/x64}
CERT_SUBJECT=${CERT_SUBJECT:-CN=DshOpenWith}

mkdir -p build package/Assets

# 0. 把 MSIX 身份清单编成资源（1 24 = RT_MANIFEST/1）
"$WINDRES" -I src -i src/msix.rc -o build/msix.res.o --output-format=coff

# 1. 原生 COM DLL（Explorer 是 64 位，必须是 x64）
"$GXX" -shared -O2 -s \
  -static -static-libgcc -static-libstdc++ \
  -o build/DshOpenWith.dll src/dsh_open_with.cpp build/msix.res.o \
  -lole32 -lshlwapi -luuid

# 2. 清单要求的 FullTrust 入口（空壳，永远不会被启动）
"$GXX" -O2 -municode -s -o build/DshOpenWithStub.exe src/stub.cpp

# 3. 自测宿主（不经过资源管理器直接调 COM）
"$GXX" -O2 -municode -static-libgcc -static-libstdc++ \
  -o build/test-host.exe src/test-host.cpp \
  -lole32 -lshlwapi -lshell32 -luuid

# 4. 图标
"${PYTHON:-/c/Python314/python.exe}" make-assets.py package/Assets >/dev/null

# 5. 组装包目录
cp build/DshOpenWith.dll build/DshOpenWithStub.exe package/
cp assets/dsh.ico package/Assets/dsh.ico

# 6. 给 DLL 本身加 Authenticode 签名（证书已在当前用户 My 存储里）
THUMB=$(powershell.exe -NoProfile -Command "(Get-ChildItem Cert:\CurrentUser\My | Where-Object { \$_.Subject -eq '$CERT_SUBJECT' } | Sort-Object NotAfter -Descending | Select-Object -First 1).Thumbprint" | tr -d '\r\n ')
if [ -z "$THUMB" ]; then
  echo "警告：找不到 $CERT_SUBJECT 证书，跳过签名（只做未签名编译）" >&2
  echo "OK: package 目录已就绪（未打包 MSIX）"
  ls -la package
  exit 0
fi
"$SDK_TOOLS/signtool.exe" sign /sha1 "$THUMB" /fd SHA256 /a build/DshOpenWith.dll >/dev/null
"$SDK_TOOLS/signtool.exe" sign /sha1 "$THUMB" /fd SHA256 /a build/DshOpenWithStub.exe >/dev/null

# 7. 打 MSIX 并签名
STAGE="./build/stage.$(date +%s)"
mkdir -p "$STAGE"
cp package/AppxManifest.xml package/DshOpenWith.dll package/DshOpenWithStub.exe "$STAGE"/
cp -r package/Assets "$STAGE"/Assets
"$SDK_TOOLS/makeappx.exe" pack /o /d "$STAGE" /nv /p build/DshOpenWith.msix >/dev/null
"$SDK_TOOLS/signtool.exe" sign /sha1 "$THUMB" /fd SHA256 /a /tr http://timestamp.digicert.com /td SHA256 build/DshOpenWith.msix >/dev/null

# 8. 同步到插件目录（插件启用时从这里装包）
NATIVE_DIR=../native
mkdir -p "$NATIVE_DIR"
cp build/DshOpenWith.msix "$NATIVE_DIR/DshOpenWith.msix"
cp build/dsh-open-with.cer "$NATIVE_DIR/dsh-open-with.cer"
VERSION=$(grep -A3 '<Identity' package/AppxManifest.xml | grep -o 'Version="[^"]*"' | head -1 | sed 's/.*="//;s/"//')
echo "$VERSION" > "$NATIVE_DIR/version.txt"

echo "OK: package 目录与签名 MSIX 已就绪"
ls -la package build/DshOpenWith.msix
