// 本地自测：不经过资源管理器，直接按 COM 的方式加载 DLL，
// 验证 GetTitle / GetState / Invoke 的行为。
//
// 跑法（在 win11 目录下）：
//   ./build/test-host.exe "E:\work\tools\右键文件夹在dsh中打开"
// Invoke 会真的调用 launch.ps1，所以测完可以看
// %USERPROFILE%\.dsh\dsh-open-with\pending.json 里写的是什么。

#include <windows.h>
#include <shobjidl.h>
#include <shlwapi.h>
#include <stdio.h>

#include <string>

typedef HRESULT(__stdcall* DllGetClassObjectFn)(REFCLSID, REFIID, void**);

// {B4C9C3E5-1F0B-4D62-9E37-3A5C1B8FA0D1}
static const GUID kCmdClsid = {0xB4C9C3E5, 0x1F0B, 0x4D62, {0x9E, 0x37, 0x3A, 0x5C, 0x1B, 0x8F, 0xA0, 0xD1}};

static void Print(const wchar_t* label, const std::wstring& value) {
  // 控制台/管道默认是 ANSI，中文会变乱码，统一转成 UTF-8 输出。
  int need = WideCharToMultiByte(CP_UTF8, 0, value.c_str(), -1, nullptr, 0, nullptr, nullptr);
  std::string utf8(need > 0 ? need - 1 : 0, '\0');
  if (need > 1) WideCharToMultiByte(CP_UTF8, 0, value.c_str(), -1, utf8.data(), need, nullptr, nullptr);
  printf("%s: %s\n", label ? std::string(label, label + wcslen(label)).c_str() : "", utf8.c_str());
}

int wmain(int argc, wchar_t** argv) {
  if (argc < 2) {
    wprintf(L"usage: test-host.exe <folder-or-file>\n");
    return 2;
  }
  CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

  HMODULE dll = LoadLibraryW(L"DshOpenWith.dll");
  if (!dll) {
    wprintf(L"FAIL cannot load DshOpenWith.dll (err %lu)\n", GetLastError());
    return 1;
  }
  auto getClassObject = reinterpret_cast<DllGetClassObjectFn>(GetProcAddress(dll, "DllGetClassObject"));
  if (!getClassObject) {
    wprintf(L"FAIL DllGetClassObject missing\n");
    return 1;
  }

  IClassFactory* factory = nullptr;
  HRESULT hr = getClassObject(kCmdClsid, IID_IClassFactory, reinterpret_cast<void**>(&factory));
  if (FAILED(hr) || !factory) {
    wprintf(L"FAIL DllGetClassObject hr=0x%08lX\n", hr);
    return 1;
  }
  IExplorerCommand* cmd = nullptr;
  hr = factory->CreateInstance(nullptr, IID_IExplorerCommand, reinterpret_cast<void**>(&cmd));
  factory->Release();
  if (FAILED(hr) || !cmd) {
    wprintf(L"FAIL CreateInstance hr=0x%08lX\n", hr);
    return 1;
  }

  LPWSTR title = nullptr;
  if (SUCCEEDED(cmd->GetTitle(nullptr, &title)) && title) {
    Print(L"PASS GetTitle", title);
    CoTaskMemFree(title);
  } else {
    wprintf(L"FAIL GetTitle\n");
  }

  GUID canonical = {0};
  wprintf(L"%s GetCanonicalName\n", SUCCEEDED(cmd->GetCanonicalName(&canonical)) ? L"PASS" : L"FAIL");

  IShellItem* item = nullptr;
  hr = SHCreateItemFromParsingName(argv[1], nullptr, IID_IShellItem, reinterpret_cast<void**>(&item));
  if (FAILED(hr) || !item) {
    wprintf(L"FAIL SHCreateItemFromParsingName hr=0x%08lX\n", hr);
    return 1;
  }
  IShellItemArray* items = nullptr;
  hr = SHCreateShellItemArrayFromShellItem(item, IID_IShellItemArray, reinterpret_cast<void**>(&items));
  item->Release();
  if (FAILED(hr) || !items) {
    wprintf(L"FAIL SHCreateShellItemArrayFromShellItem hr=0x%08lX\n", hr);
    return 1;
  }

  EXPCMDSTATE state = ECS_HIDDEN;
  if (SUCCEEDED(cmd->GetState(items, TRUE, &state))) {
    wprintf(L"%s GetState = %d (ECS_ENABLED=0 ECS_DISABLED=1 ECS_HIDDEN=2)\n",
            state == ECS_ENABLED ? L"PASS" : L"FAIL", static_cast<int>(state));
  } else {
    wprintf(L"FAIL GetState\n");
  }

  if (argc > 2 && wcscmp(argv[2], L"--no-invoke") == 0) {
    wprintf(L"SKIP Invoke\n");
  } else {
    hr = cmd->Invoke(items, nullptr);
    wprintf(L"%s Invoke hr=0x%08lX\n", SUCCEEDED(hr) ? L"PASS" : L"FAIL", hr);
  }

  items->Release();
  cmd->Release();
  FreeLibrary(dll);
  CoUninitialize();
  return 0;
}
