// Win11 新式右键菜单（IExplorerCommand）实现。
//
// 说明：Win11 的简洁右键菜单只认「打包的 IExplorerCommand 扩展」，
// 经典 shell\...\command 写法只会出现在「显示更多选项」里。
// 所以这里用原生 COM DLL 实现这个接口，再由一个 MSIX 包把它挂到
// Directory / Directory\Background / * 三种位置上。
//
// 界面上只显示文字（用户已确认新菜单不需要图标）。

#include <windows.h>
#include <shobjidl.h>
#include <shlwapi.h>

#include <new>
#include <string>

HMODULE g_hinst = nullptr;

namespace {

// ---- 诊断日志（临时，用于定位 Explorer 加载/调用问题）----
std::wstring LogPath() {
  wchar_t buf[MAX_PATH] = {0};
  DWORD n = GetEnvironmentVariableW(L"LOCALAPPDATA", buf, MAX_PATH);
  if (n == 0 || n >= MAX_PATH) n = GetEnvironmentVariableW(L"USERPROFILE", buf, MAX_PATH);
  if (n == 0 || n >= MAX_PATH) return L"C:\\Windows\\Temp\\dsh-open-with-command.log";
  std::wstring path(buf);
  path += L"\\dsh-open-with-command.log";
  return path;
}

// 只有设置了 DSH_OPEN_WITH_DEBUG=1 才写日志；平时不产生任何文件。
bool DebugEnabled() {
  static int cached = -1;
  if (cached < 0) {
    wchar_t buf[8] = {0};
    const DWORD n = GetEnvironmentVariableW(L"DSH_OPEN_WITH_DEBUG", buf, 8);
    cached = (n == 1 && buf[0] == L'1') ? 1 : 0;
  }
  return cached == 1;
}

void AppendLog(const std::wstring& text) {
  if (!DebugEnabled()) return;
  HANDLE h = CreateFileW(LogPath().c_str(), FILE_APPEND_DATA,
                         FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_ALWAYS,
                         FILE_ATTRIBUTE_NORMAL, nullptr);
  if (h == INVALID_HANDLE_VALUE) return;
  SYSTEMTIME st = {0};
  GetLocalTime(&st);
  wchar_t stamp[64] = {0};
  swprintf_s(stamp, 64, L"%02d:%02d:%02d.%03d ", st.wHour, st.wMinute, st.wSecond,
             st.wMilliseconds);
  std::wstring line = stamp + text + L"\r\n";
  DWORD written = 0;
  WriteFile(h, line.data(), static_cast<DWORD>(line.size() * sizeof(wchar_t)), &written, nullptr);
  CloseHandle(h);
}

const wchar_t* kMenuTitle = L"\u901a\u8fc7 dsh \u6253\u5f00";
const wchar_t* kMenuTooltip =
    L"\u5728 dsh \u91cc\u6253\u5f00\u8fd9\u4e2a\u6587\u4ef6\u5939\uff0c"
    L"\u5e76\u65b0\u5efa\u4e00\u4e2a\u4f1a\u8bdd";

// {B4C9C3E5-1F0B-4D62-9E37-3A5C1B8FA0D1}
const GUID kCmdClsid = {0xB4C9C3E5, 0x1F0B, 0x4D62, {0x9E, 0x37, 0x3A, 0x5C, 0x1B, 0x8F, 0xA0, 0xD1}};

// 启动器固定复制到 %USERPROFILE%\.dsh\dsh-open-with\launch.ps1
std::wstring LauncherPath() {
  wchar_t profile[MAX_PATH] = {0};
  DWORD n = GetEnvironmentVariableW(L"USERPROFILE", profile, MAX_PATH);
  if (n == 0 || n >= MAX_PATH) return std::wstring();
  std::wstring path(profile);
  path += L"\\.dsh\\dsh-open-with\\launch.ps1";
  return path;
}

std::wstring ParentFolderOf(const std::wstring& path) {
  DWORD attrs = GetFileAttributesW(path.c_str());
  if (attrs != INVALID_FILE_ATTRIBUTES && (attrs & FILE_ATTRIBUTE_DIRECTORY)) return path;
  size_t cut = path.find_last_of(L"\\/");
  if (cut == std::wstring::npos) return std::wstring();
  return path.substr(0, cut);
}

std::wstring ModuleDir() {
  wchar_t buf[MAX_PATH] = {0};
  DWORD n = GetModuleFileNameW(g_hinst, buf, MAX_PATH);
  if (n == 0 || n >= MAX_PATH) return std::wstring();
  std::wstring path(buf);
  const size_t slash = path.find_last_of(L'\\');
  if (slash == std::wstring::npos) return std::wstring();
  return path.substr(0, slash);
}

void LogHr(const wchar_t* what, HRESULT hr) {
  wchar_t buf[128] = {0};
  swprintf_s(buf, 128, L"%s hr=0x%08X", what, static_cast<unsigned>(hr));
  AppendLog(buf);
}

bool FolderFromShellItemArray(IShellItemArray* items, std::wstring* folder) {
  if (!items) {
    AppendLog(L"items=null");
    return false;
  }
  DWORD count = 0;
  HRESULT hr = items->GetCount(&count);
  if (FAILED(hr)) {
    LogHr(L"GetCount", hr);
    return false;
  }
  if (count == 0) {
    AppendLog(L"GetCount=0");
    return false;
  }
  IShellItem* item = nullptr;
  hr = items->GetItemAt(0, &item);
  if (FAILED(hr) || !item) {
    LogHr(L"GetItemAt", hr);
    return false;
  }
  LPWSTR raw = nullptr;
  hr = item->GetDisplayName(SIGDN_FILESYSPATH, &raw);
  LogHr(L"GetDisplayName(FILESYSPATH)", hr);
  if (FAILED(hr) || !raw) {
    raw = nullptr;
    hr = item->GetDisplayName(SIGDN_DESKTOPABSOLUTEPARSING, &raw);
    LogHr(L"GetDisplayName(DESKTOPABSOLUTEPARSING)", hr);
  }
  item->Release();
  if (FAILED(hr) || !raw) return false;
  std::wstring path(raw);
  CoTaskMemFree(raw);
  if (path.empty()) {
    AppendLog(L"path empty");
    return false;
  }
  *folder = ParentFolderOf(path);
  return !folder->empty();
}

void RunLauncher(const std::wstring& folder) {
  std::wstring launcher = LauncherPath();
  if (launcher.empty() || !PathFileExistsW(launcher.c_str())) {
    // 插件没装好时不要静默失败：把提示写进临时文件太吵，这里直接放弃。
    return;
  }
  std::wstring cmd = L"\"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\""
                     L" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" +
                     launcher + L"\" \"" + folder + L"\"";
  STARTUPINFOW si = {sizeof(si)};
  si.dwFlags = STARTF_USESHOWWINDOW;
  si.wShowWindow = SW_HIDE;
  PROCESS_INFORMATION pi = {0};
  std::wstring mutableCmd = cmd;
  if (CreateProcessW(nullptr, mutableCmd.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW, nullptr,
                     nullptr, &si, &pi)) {
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
  }
}

class Command final : public IExplorerCommand {
 public:
  Command() = default;

  // ---- IUnknown ----
  IFACEMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    if (riid == IID_IUnknown || riid == IID_IExplorerCommand) {
      *ppv = static_cast<IExplorerCommand*>(this);
      AddRef();
      return S_OK;
    }
    *ppv = nullptr;
    return E_NOINTERFACE;
  }
  IFACEMETHODIMP_(ULONG) AddRef() override { return ++refs_; }
  IFACEMETHODIMP_(ULONG) Release() override {
    ULONG left = --refs_;
    if (left == 0) delete this;
    return left;
  }

  // ---- IExplorerCommand ----
  IFACEMETHODIMP GetTitle(IShellItemArray*, LPWSTR* name) override {
    AppendLog(L"GetTitle");
    return SHStrDupW(kMenuTitle, name);
  }
  IFACEMETHODIMP GetIcon(IShellItemArray*, LPWSTR* icon) override {
    if (!icon) return E_POINTER;
    *icon = nullptr;
    std::wstring path = ModuleDir() + L"\\Assets\\dsh.ico";
    AppendLog(L"GetIcon " + path);
    if (!PathFileExistsW(path.c_str())) return E_NOTIMPL;
    return SHStrDupW(path.c_str(), icon);
  }
  IFACEMETHODIMP GetToolTip(IShellItemArray*, LPWSTR* tip) override {
    return SHStrDupW(kMenuTooltip, tip);
  }
  IFACEMETHODIMP GetCanonicalName(GUID* guid) override {
    if (!guid) return E_POINTER;
    *guid = kCmdClsid;
    return S_OK;
  }
  IFACEMETHODIMP GetState(IShellItemArray* items, BOOL, EXPCMDSTATE* state) override {
    if (!state) return E_POINTER;
    std::wstring folder;
    const bool ok = FolderFromShellItemArray(items, &folder);
    AppendLog(ok ? (L"GetState enabled " + folder) : std::wstring(L"GetState unresolved"));
    *state = ECS_ENABLED;
    return S_OK;
  }
  IFACEMETHODIMP Invoke(IShellItemArray* items, IBindCtx*) override {
    std::wstring folder;
    if (!FolderFromShellItemArray(items, &folder)) {
      AppendLog(L"Invoke: no folder");
      return E_FAIL;
    }
    AppendLog(L"Invoke folder=" + folder + L" launcher=" + LauncherPath());
    RunLauncher(folder);
    return S_OK;
  }
  IFACEMETHODIMP EnumSubCommands(IEnumExplorerCommand** out) override {
    if (!out) return E_POINTER;
    *out = nullptr;
    return E_NOTIMPL;
  }
  IFACEMETHODIMP GetFlags(EXPCMDFLAGS* flags) override {
    if (!flags) return E_POINTER;
    *flags = ECF_DEFAULT;
    return S_OK;
  }

 private:
  ~Command() = default;
  long refs_ = 1;
};

class Factory final : public IClassFactory {
 public:
  IFACEMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    if (riid == IID_IUnknown || riid == IID_IClassFactory) {
      *ppv = static_cast<IClassFactory*>(this);
      AddRef();
      return S_OK;
    }
    *ppv = nullptr;
    return E_NOINTERFACE;
  }
  IFACEMETHODIMP_(ULONG) AddRef() override { return 2; }
  IFACEMETHODIMP_(ULONG) Release() override { return 1; }
  IFACEMETHODIMP CreateInstance(IUnknown* outer, REFIID riid, void** ppv) override {
    if (outer) return CLASS_E_NOAGGREGATION;
    if (!ppv) return E_POINTER;
    auto* cmd = new (std::nothrow) Command();
    if (!cmd) return E_OUTOFMEMORY;
    HRESULT hr = cmd->QueryInterface(riid, ppv);
    cmd->Release();
    return hr;
  }
  IFACEMETHODIMP LockServer(BOOL) override { return S_OK; }
};

}  // namespace

extern "C" {

__declspec(dllexport) HRESULT __stdcall DllGetClassObject(REFCLSID clsid, REFIID riid, void** ppv) {
  if (!ppv) return E_POINTER;
  *ppv = nullptr;
  AppendLog(L"GetClassObject");
  if (!IsEqualCLSID(clsid, kCmdClsid)) return CLASS_E_CLASSNOTAVAILABLE;
  static Factory factory;
  return factory.QueryInterface(riid, ppv);
}

__declspec(dllexport) HRESULT __stdcall DllCanUnloadNow() { return S_FALSE; }

}  // extern "C"

BOOL WINAPI DllMain(HINSTANCE inst, DWORD reason, LPVOID) {
  if (reason == DLL_PROCESS_ATTACH) g_hinst = inst;
  return TRUE;
}
