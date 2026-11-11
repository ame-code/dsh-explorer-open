# 生成 README 里的效果对比图 docs/demo.png
# 依赖：ImageMagick 7（magick 在 PATH 上）+ 系统自带的微软雅黑 msyh.ttc
# 输入：docs/win11-context-menu.png（右键菜单）、docs/new-session-reference.png（新会话草稿）
# 输出：docs/demo.png
#
# 说明：两张截图先统一缩放到 520 高，再拼到深色画布上，用橙色框标出
# 「通过 dsh 打开」和「@prompt.md」，中间画箭头表示因果。
# 换了截图就要重新核对下面两个框的坐标（左边框、右边框），像素位置随图变化。

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$work = Join-Path $repo '.build-demo'
$font = 'C:/Windows/Fonts/msyh.ttc'
$enc = [System.Text.UTF8Encoding]::new($false)

New-Item -ItemType Directory -Force $work | Out-Null

function Write-Text($path, $text) {
  [System.IO.File]::WriteAllText($path, $text, $enc)
}

magick (Join-Path $repo 'docs\win11-context-menu.png') -filter Lanczos -resize x520 -bordercolor '#3a3d42' -border 1 (Join-Path $work 'left.png')
magick (Join-Path $repo 'docs\new-session-reference.png') -filter Lanczos -resize x520 -bordercolor '#3a3d42' -border 1 (Join-Path $work 'right.png')

$lw, $lh = (magick identify -format '%w %h' (Join-Path $work 'left.png')) -split ' '
$rw, $rh = (magick identify -format '%w %h' (Join-Path $work 'right.png')) -split ' '

$pad = 40
$labelH = 44
$headerH = 34
$gap = 96
$canvasW = $pad + [int]$lw + $gap + [int]$rw + $pad
$canvasH = $pad + $headerH + $labelH + [int]$lh + $pad

$leftX = $pad
$leftY = $pad + $headerH + $labelH
$rightX = $pad + [int]$lw + $gap
$rightY = $leftY

Write-Text (Join-Path $work 'header.txt') '由「通过 dsh 打开」直接带到新会话的文件引用'
Write-Text (Join-Path $work 'left.txt') '① 在文件上右键，选「通过 dsh 打开」'
Write-Text (Join-Path $work 'right.txt') '② 新会话打开，输入框里已带着 @prompt.md'

magick -size "${canvasW}x${canvasH}" xc:'#17181b' `
  (Join-Path $work 'left.png') -geometry "+${leftX}+${leftY}" -composite `
  (Join-Path $work 'right.png') -geometry "+${rightX}+${rightY}" -composite `
  -font $font -fill '#e8eaed' -pointsize 26 -annotate "+$pad+56" "@$(Join-Path $work 'header.txt')" `
  -fill '#9aa0a6' -pointsize 22 `
  -annotate "+${leftX}+$($leftY - 14)" "@$(Join-Path $work 'left.txt')" `
  -annotate "+${rightX}+$($rightY - 14)" "@$(Join-Path $work 'right.txt')" `
  -fill none -stroke '#f5a524' -strokewidth 3 `
  -draw "rectangle 74,520 302,559" `
  -draw "rectangle 556,406 722,446" `
  -stroke '#f5a524' -strokewidth 4 -draw "line 415,386 486,386" `
  -draw "polygon 486,378 500,386 486,394" `
  -depth 8 -strip (Join-Path $repo 'docs\demo.png')

Remove-Item $work -Recurse -Force
magick identify (Join-Path $repo 'docs\demo.png')
