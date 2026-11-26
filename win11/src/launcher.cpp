// 经典右键菜单的 GUI 启动器：创建 PowerShell 时不分配控制台，避免窗口闪现。
#include <windows.h>
#include <shellapi.h>
#include <string>
#include <vector>

// 按 Windows 命令行规则转义，保留路径中的空格、引号与结尾反斜杠。
static std::wstring Quote(const std::wstring& value) {
  std::wstring out = L"\"";
  size_t slashes = 0;
  for (wchar_t ch : value) {
    if (ch == L'\\') { ++slashes; continue; }
    if (ch == L'"') {
      out.append(slashes * 2 + 1, L'\\');
    } else {
      out.append(slashes, L'\\');
    }
    slashes = 0;
    out += ch;
  }
  out.append(slashes * 2, L'\\');
  return out + L'"';
}

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
  int argc = 0;
  LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &argc);
  if (!argv || argc != 2) { if (argv) LocalFree(argv); return 2; }
  std::wstring selection = argv[1];
  LocalFree(argv);
  // 注册表命令追加了 \\.，让根目录结尾的反斜杠不会吞掉闭引号。
  if (selection.size() >= 2 && selection.compare(selection.size() - 2, 2, L"\\.") == 0)
    selection.resize(selection.size() - 2);

  std::vector<wchar_t> module(32768);
  const DWORD length = GetModuleFileNameW(nullptr, module.data(), static_cast<DWORD>(module.size()));
  if (!length || length >= module.size()) return 3;
  const std::wstring path(module.data(), length);
  const size_t slash = path.find_last_of(L"\\/");
  if (slash == std::wstring::npos) return 3;
  const std::wstring script = path.substr(0, slash + 1) + L"launch.ps1";
  if (GetFileAttributesW(script.c_str()) == INVALID_FILE_ATTRIBUTES) return 4;

  wchar_t system[MAX_PATH] = {};
  const UINT count = GetSystemDirectoryW(system, MAX_PATH);
  if (!count || count >= MAX_PATH) return 5;
  const std::wstring exe = std::wstring(system) + L"\\WindowsPowerShell\\v1.0\\powershell.exe";
  std::wstring command = Quote(exe) +
      L" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File " +
      Quote(script) + L" " + Quote(selection);
  STARTUPINFOW startup = {};
  startup.cb = sizeof(startup);
  startup.dwFlags = STARTF_USESHOWWINDOW;
  startup.wShowWindow = SW_HIDE;
  PROCESS_INFORMATION process = {};
  if (!CreateProcessW(exe.c_str(), command.data(), nullptr, nullptr, FALSE,
                      CREATE_NO_WINDOW, nullptr, nullptr, &startup, &process)) return 6;
  CloseHandle(process.hThread);
  CloseHandle(process.hProcess);
  return 0;
}
