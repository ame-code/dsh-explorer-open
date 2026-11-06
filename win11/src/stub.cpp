// MSIX 清单要求有一个 `Windows.FullTrustApplication` 入口可执行文件。
// 本插件只用它的右键菜单扩展，这个 exe 永远不会被真正启动，仅为满足清单校验。
#include <windows.h>

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) { return 0; }
