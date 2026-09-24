#include <windows.h>
#include <shlobj.h>
#include <stdio.h>
#include "version.h"

#ifndef NESTIFY_VERSION
#define NESTIFY_VERSION L"0.0.0"
#endif

static int ensure_directory(const wchar_t *path) {
    DWORD attributes = GetFileAttributesW(path);
    if (attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_DIRECTORY)) return 1;
    return CreateDirectoryW(path, NULL) || GetLastError() == ERROR_ALREADY_EXISTS;
}

static int write_resource(WORD id, const wchar_t *path) {
    HRSRC resource = FindResourceW(NULL, MAKEINTRESOURCEW(id), RT_RCDATA);
    if (!resource) return 0;
    DWORD size = SizeofResource(NULL, resource);
    HGLOBAL loaded = LoadResource(NULL, resource);
    const void *bytes = LockResource(loaded);
    if (!bytes || size == 0) return 0;

    HANDLE existing = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (existing != INVALID_HANDLE_VALUE) {
        LARGE_INTEGER existing_size;
        if (GetFileSizeEx(existing, &existing_size) && existing_size.QuadPart == (LONGLONG)size) {
            CloseHandle(existing);
            return 1;
        }
        CloseHandle(existing);
    }

    HANDLE file = CreateFileW(path, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) return 0;
    DWORD written_total = 0;
    const BYTE *cursor = (const BYTE *)bytes;
    while (written_total < size) {
        DWORD written = 0;
        DWORD chunk = size - written_total;
        if (!WriteFile(file, cursor + written_total, chunk, &written, NULL) || written == 0) {
            CloseHandle(file);
            return 0;
        }
        written_total += written;
    }
    CloseHandle(file);
    return 1;
}

static int marker_matches(const wchar_t *marker) {
    HANDLE file = CreateFileW(marker, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) return 0;
    wchar_t text[64] = {0};
    DWORD read = 0;
    ReadFile(file, text, sizeof(text) - sizeof(wchar_t), &read, NULL);
    CloseHandle(file);
    return wcscmp(text, NESTIFY_VERSION) == 0;
}

static void write_marker(const wchar_t *marker) {
    HANDLE file = CreateFileW(marker, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) return;
    DWORD written = 0;
    WriteFile(file, NESTIFY_VERSION, (DWORD)(wcslen(NESTIFY_VERSION) * sizeof(wchar_t)), &written, NULL);
    CloseHandle(file);
}

static int extract_zip(const wchar_t *zip_path, const wchar_t *destination) {
    wchar_t command[32768];
    _snwprintf(command, 32768, L"\"%s\\System32\\tar.exe\" -xf \"%s\" -C \"%s\"", _wgetenv(L"SystemRoot"), zip_path, destination);
    STARTUPINFOW startup;
    PROCESS_INFORMATION process;
    ZeroMemory(&startup, sizeof(startup));
    startup.cb = sizeof(startup);
    startup.dwFlags = STARTF_USESHOWWINDOW;
    startup.wShowWindow = SW_HIDE;
    ZeroMemory(&process, sizeof(process));
    if (!CreateProcessW(NULL, command, NULL, NULL, FALSE, CREATE_NO_WINDOW, NULL, NULL, &startup, &process)) return 0;
    WaitForSingleObject(process.hProcess, INFINITE);
    DWORD code = 1;
    GetExitCodeProcess(process.hProcess, &code);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    return code == 0;
}

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE previous, PWSTR command, int show) {
    (void)instance;
    (void)previous;
    (void)command;
    (void)show;

    wchar_t local_app_data[MAX_PATH];
    HRESULT folder = SHGetFolderPathW(NULL, CSIDL_LOCAL_APPDATA, NULL, SHGFP_TYPE_CURRENT, local_app_data);
    if (FAILED(folder) && GetEnvironmentVariableW(L"LOCALAPPDATA", local_app_data, MAX_PATH) == 0) {
        MessageBoxW(NULL, L"Nestify could not locate LocalAppData.", L"Nestify", MB_ICONERROR);
        return 1;
    }

    wchar_t nestify_dir[MAX_PATH];
    wchar_t runtime_dir[MAX_PATH];
    wchar_t version_dir[MAX_PATH];
    wchar_t zip_path[MAX_PATH];
    wchar_t marker[MAX_PATH];
    wchar_t exe_path[MAX_PATH];
    _snwprintf(nestify_dir, MAX_PATH, L"%s\\Nestify", local_app_data);
    _snwprintf(runtime_dir, MAX_PATH, L"%s\\runtime", nestify_dir);
    _snwprintf(version_dir, MAX_PATH, L"%s\\%s", runtime_dir, NESTIFY_VERSION);
    _snwprintf(zip_path, MAX_PATH, L"%s\\payload.zip", runtime_dir);
    _snwprintf(marker, MAX_PATH, L"%s\\.ready", version_dir);
    _snwprintf(exe_path, MAX_PATH, L"%s\\nestify.exe", version_dir);

    if (!ensure_directory(nestify_dir) || !ensure_directory(runtime_dir) || !ensure_directory(version_dir)) {
        MessageBoxW(NULL, L"Nestify failed to prepare its runtime directory.", L"Nestify", MB_ICONERROR);
        return 1;
    }

    if (!marker_matches(marker)) {
        if (!write_resource(101, zip_path) || !extract_zip(zip_path, version_dir) || GetFileAttributesW(exe_path) == INVALID_FILE_ATTRIBUTES) {
            MessageBoxW(NULL, L"Nestify failed to unpack its runtime.", L"Nestify", MB_ICONERROR);
            return 1;
        }
        DeleteFileW(zip_path);
        write_marker(marker);
    }

    if (GetFileAttributesW(exe_path) == INVALID_FILE_ATTRIBUTES) {
        MessageBoxW(NULL, L"Nestify runtime is incomplete.", L"Nestify", MB_ICONERROR);
        return 1;
    }

    STARTUPINFOW startup;
    PROCESS_INFORMATION process;
    ZeroMemory(&startup, sizeof(startup));
    startup.cb = sizeof(startup);
    ZeroMemory(&process, sizeof(process));
    if (!CreateProcessW(exe_path, NULL, NULL, NULL, FALSE, 0, NULL, version_dir, &startup, &process)) {
        MessageBoxW(NULL, L"Nestify failed to start.", L"Nestify", MB_ICONERROR);
        return 1;
    }
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    return 0;
}
