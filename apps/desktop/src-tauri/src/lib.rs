use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

struct Sidecar {
    child: Mutex<Option<Child>>,
    port: Mutex<Option<u16>>,
    shortcut: Mutex<Option<String>>,
}

static EVENTS_STARTED: AtomicBool = AtomicBool::new(false);

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(Sidecar {
            child: Mutex::new(None),
            port: Mutex::new(None),
            shortcut: Mutex::new(None),
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let sidecar = handle.state::<Sidecar>();
            let mut child = spawn_sidecar()?;
            let port = read_ready_port(&mut child)?;
            *sidecar.port.lock().expect("sidecar port") = Some(port);
            *sidecar.child.lock().expect("sidecar child") = Some(child);
            start_event_pump(handle.clone(), port);
            build_tray(&handle)?;
            apply_window_icon(&handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                if window.label() == "spotlight" {
                    if let tauri::WindowEvent::Focused(false) = event {
                        let _ = window.hide();
                    }
                }
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("window:close-requested", ());
            }
        })
        .invoke_handler(tauri::generate_handler![
            sidecar_call,
            window_minimize_to_tray,
            window_quit,
            window_open_spotlight,
            window_close_spotlight,
            window_resize_spotlight,
            dialog_pick_directory,
            dialog_pick_files,
            dialog_save_file,
            dialog_open_file,
            shell_reveal,
            shell_open_path,
            shell_open_external,
            clipboard_write_text,
            register_spotlight_shortcut
        ])
        .build(tauri::generate_context!())
        .expect("error while building Nestify")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                kill_sidecar(app);
            }
        });
}

fn project_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
}

fn app_root() -> PathBuf {
    if let Ok(root) = std::env::var("NESTIFY_APP_ROOT") {
        let path = PathBuf::from(root);
        if path.is_dir() {
            return path;
        }
    }
    if !cfg!(debug_assertions) {
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                if dir.join("node.exe").is_file() || dir.join("sidecar").is_dir() {
                    return dir.to_path_buf();
                }
            }
        }
    }
    project_root()
}

fn spawn_sidecar() -> Result<Child, String> {
    let root = app_root();
    let bundled_node = root.join("node.exe");
    let node = if bundled_node.is_file() {
        bundled_node
    } else {
        PathBuf::from(std::env::var("NESTIFY_NODE").unwrap_or_else(|_| "node".to_string()))
    };
    let script = if root.join("sidecar").join("main.ts").is_file() {
        root.join("sidecar").join("main.ts")
    } else {
        root.join("apps").join("desktop").join("sidecar").join("main.ts")
    };
    let config_dir = existing_dir(&[
        root.join("config"),
        root.join("apps").join("desktop").join("resources").join("config"),
        project_root().join("config"),
    ])
    .unwrap_or_else(|| root.join("config"));
    let worker_dir = existing_dir(&[
        root.join("dist-runtime"),
        root.join("apps").join("desktop").join("dist-runtime"),
    ])
    .unwrap_or_else(|| root.join("apps").join("desktop").join("dist-runtime"));
    let resource_dir = existing_dir(&[
        root.join("resources"),
        root.join("apps").join("desktop").join("resources"),
    ])
    .unwrap_or_else(|| root.join("apps").join("desktop").join("resources"));

    let mut command = Command::new(&node);
    command
        .arg("--experimental-strip-types")
        .arg(&script)
        .current_dir(&root)
        .env("NESTIFY_SIDECAR", "1")
        .env("NESTIFY_APP_ROOT", &root)
        .env("NESTIFY_CONFIG_DIR", config_dir)
        .env("NESTIFY_WORKER_DIR", worker_dir)
        .env("NESTIFY_RESOURCE_DIR", resource_dir)
        .env("NODE_PATH", root.join("node_modules"))
        .env("NESTIFY_APP_VERSION", env!("CARGO_PKG_VERSION"));
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("failed to start node sidecar: {error}"))
}

fn existing_dir(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|path| path.is_dir()).cloned()
}

fn read_ready_port(child: &mut Child) -> Result<u16, String> {
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "sidecar stdout is missing".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "sidecar stderr is missing".to_string())?;
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    loop {
        line.clear();
        let read = reader
            .read_line(&mut line)
            .map_err(|error| format!("failed to read sidecar ready line: {error}"))?;
        if read == 0 {
            drop(reader);
            let status = child
                .wait()
                .map_err(|error| format!("failed to wait for sidecar exit: {error}"))?;
            let mut diagnostics = String::new();
            let stderr_length = stderr
                .read_to_string(&mut diagnostics)
                .map_err(|error| format!("failed to read sidecar stderr: {error}"))?;
            if stderr_length > 0 {
                return Err(format!(
                    "sidecar exited before ready with {status}:\n{}",
                    diagnostics.trim_end()
                ));
            }
            return Err(format!("sidecar exited before ready with {status}"));
        }

        let line = line.trim().trim_start_matches('\u{feff}');
        if line.is_empty() {
            continue;
        }
        let Some(port) = line.strip_prefix("NESTIFY_SIDECAR_READY ") else {
            eprintln!("[nestify-sidecar] {line}");
            continue;
        };
        let port = port
            .parse::<u16>()
            .map_err(|error| format!("invalid sidecar port {port}: {error}"))?;
        std::thread::spawn(move || {
            let mut leftover = String::new();
            while reader.read_line(&mut leftover).unwrap_or(0) > 0 {
                leftover.clear();
            }
        });
        std::thread::spawn(move || {
            let mut diagnostics = BufReader::new(stderr);
            let mut line = String::new();
            while diagnostics.read_line(&mut line).unwrap_or(0) > 0 {
                eprintln!("[nestify-sidecar] {}", line.trim_end());
                line.clear();
            }
        });
        return Ok(port);
    }
}

fn start_event_pump(app: AppHandle, port: u16) {
    if EVENTS_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        let mut last_event_id = 0_u64;
        loop {
        if pump_events(&app, port, &mut last_event_id).is_err() {
            std::thread::sleep(Duration::from_secs(1));
        }
        }
    });
}

fn pump_events(app: &AppHandle, port: u16, last_event_id: &mut u64) -> Result<(), ()> {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).map_err(|_| ())?;
    stream.set_read_timeout(Some(Duration::from_secs(30))).ok();
    let mut request = format!(
        "GET /events HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n"
    );
    if *last_event_id > 0 {
        request.push_str(&format!("Last-Event-ID: {last_event_id}\r\n"));
    }
    request.push_str("\r\n");
    stream.write_all(request.as_bytes()).map_err(|_| ())?;
    let mut reader = BufReader::new(stream);

    let mut chunked = false;
    let mut status_ok = false;
    let mut line = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line).map_err(|_| ())? == 0 {
            return Err(());
        }
        let header = line.trim_end_matches(['\r', '\n']);
        if header.is_empty() {
            break;
        }
        let lower = header.to_ascii_lowercase();
        if lower.starts_with("http/") {
            status_ok = lower
                .split_whitespace()
                .nth(1)
                .map(|code| code == "200")
                .unwrap_or(false);
        } else if lower.starts_with("transfer-encoding:") && lower.contains("chunked") {
            chunked = true;
        }
    }
    if !status_ok {
        return Err(());
    }

    let mut data_lines: Vec<String> = Vec::new();
    let mut event_name = String::new();
    let mut event_id: Option<u64> = None;
    let mut pending_chunk: Vec<u8> = Vec::new();
    loop {
        line.clear();
        if reader.read_line(&mut line).map_err(|_| ())? == 0 {
            break;
        }
        if chunked {
            let size_text = line.trim().split(';').next().unwrap_or("").to_string();
            let size = usize::from_str_radix(&size_text, 16).map_err(|_| ())?;
            if size == 0 {
                let mut trailer = [0_u8; 2];
                reader.read_exact(&mut trailer).map_err(|_| ())?;
                if !pending_chunk.is_empty() {
                    let partial = String::from_utf8_lossy(&pending_chunk).into_owned();
                    pending_chunk.clear();
                    handle_sse_line(
                        app,
                        &format!("{partial}\n"),
                        &mut data_lines,
                        &mut event_name,
                        &mut event_id,
                        last_event_id,
                    );
                }
                break;
            }
            if size > 16 * 1024 * 1024 {
                return Err(());
            }
            let mut chunk = vec![0_u8; size];
            reader.read_exact(&mut chunk).map_err(|_| ())?;
            let mut crlf = [0_u8; 2];
            reader.read_exact(&mut crlf).map_err(|_| ())?;

            pending_chunk.extend_from_slice(&chunk);
            while let Some(offset) = pending_chunk.iter().position(|&byte| byte == b'\n') {
                let sse_line = pending_chunk[..=offset].to_vec();
                let end = offset + 1;
                let decoded = String::from_utf8_lossy(&sse_line).into_owned();
                pending_chunk.drain(..end);
                handle_sse_line(
                    app,
                    &decoded,
                    &mut data_lines,
                    &mut event_name,
                    &mut event_id,
                    last_event_id,
                );
            }
            continue;
        }
        handle_sse_line(
            app,
            &line,
            &mut data_lines,
            &mut event_name,
            &mut event_id,
            last_event_id,
        );
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn handle_sse_line(
    app: &AppHandle,
    line: &str,
    data_lines: &mut Vec<String>,
    event_name: &mut String,
    event_id: &mut Option<u64>,
    last_event_id: &mut u64,
) {
    let trimmed = line.trim_end_matches(['\r', '\n']);
    if trimmed.is_empty() {
        let data = data_lines.join("\n");
        data_lines.clear();
        let name = std::mem::take(event_name);
        let id = event_id.take();
        if !data.is_empty() && (name.is_empty() || name == "nestify-event") {
            if let Ok(value) = serde_json::from_str::<Value>(&data) {
                let seq = value.get("seq").and_then(Value::as_u64).or(id);
                if let Some(seq) = seq {
                    if seq > *last_event_id {
                        *last_event_id = seq;
                    }
                }
                let _ = app.emit("sidecar:event", value);
            }
        }
        return;
    }
    if trimmed.starts_with(':') {
        return;
    }
    let mut parts = trimmed.splitn(2, ':');
    let field = parts.next().unwrap_or("");
    let value = parts.next().unwrap_or("").strip_prefix(' ').unwrap_or("");
    if field == "data" {
        data_lines.push(value.to_string());
    } else if field == "event" {
        *event_name = value.to_string();
    } else if field == "id" {
        *event_id = value.parse::<u64>().ok();
    }
}

#[tauri::command]
async fn sidecar_call(
    state: State<'_, Sidecar>,
    method: String,
    params: Option<Value>,
) -> Result<Value, String> {
    let port = sidecar_port(&state)?;
    let body = rpc_body(&method, params);
    // A cancelled search can still be draining its worker. Cancellation must not
    // queue behind that request, or typing stays frozen until the old query ends.
    if method == "search.cancel" {
        return post_rpc_detached(port, body);
    }
    tokio::task::spawn_blocking(move || http_json(port, "POST", "/rpc", Some(body)))
        .await
        .map_err(|error| format!("sidecar task failed: {error}"))?
}

fn sidecar_port(state: &State<Sidecar>) -> Result<u16, String> {
    state
        .port
        .lock()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "sidecar is not ready".to_string())
}

fn rpc_body(method: &str, params: Option<Value>) -> String {
    json!({
        "id": 1,
        "method": method,
        "params": params.unwrap_or(Value::Null),
    })
    .to_string()
}

fn post_rpc_detached(port: u16, body: String) -> Result<Value, String> {
    std::thread::Builder::new()
        .name("nestify-search-cancel".into())
        .spawn(move || {
            let _ = http_json_timeout(port, "POST", "/rpc", Some(body), Duration::from_secs(2));
        })
        .map_err(|error| format!("failed to cancel search: {error}"))?;
    Ok(json!({"cancelled": true}))
}

fn http_json(port: u16, method: &str, path: &str, body: Option<String>) -> Result<Value, String> {
    http_json_timeout(port, method, path, body, Duration::from_secs(120))
}

fn http_json_timeout(
    port: u16,
    method: &str,
    path: &str,
    body: Option<String>,
    timeout: Duration,
) -> Result<Value, String> {
    let mut stream = TcpStream::connect(("127.0.0.1", port))
        .map_err(|error| format!("sidecar connection failed: {error}"))?;
    stream.set_read_timeout(Some(timeout)).ok();
    stream.set_write_timeout(Some(timeout)).ok();
    let body = body.unwrap_or_default();
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("sidecar write failed: {error}"))?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|error| format!("sidecar read failed: {error}"))?;
    let payload = response
        .split("\r\n\r\n")
        .nth(1)
        .ok_or_else(|| "sidecar returned an empty response".to_string())?;
    let value: Value = serde_json::from_str(payload.trim())
        .map_err(|error| format!("sidecar returned invalid JSON: {error}: {payload}"))?;
    if value.get("ok").and_then(Value::as_bool) == Some(false) {
        return Err(value
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("sidecar error")
            .to_string());
    }
    Ok(value.get("result").cloned().unwrap_or(Value::Null))
}

fn build_tray(app: &AppHandle) -> Result<(), String> {
    let open = MenuItem::with_id(app, "open", "打开 Nestify", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let menu = Menu::with_items(app, &[&open, &quit]).map_err(|error| error.to_string())?;
    let icon = app.default_window_icon().cloned();
    let mut builder = TrayIconBuilder::with_id("nestify-tray")
        .tooltip("Nestify")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "quit" => {
                kill_sidecar(app);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = icon {
        builder = builder.icon(icon);
    }
    builder.build(app).map_err(|error| error.to_string())?;
    Ok(())
}

fn apply_window_icon(app: &AppHandle) {
    let Some(icon) = app.default_window_icon().cloned() else {
        return;
    };
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_icon(icon);
    }
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn window_minimize_to_tray(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn window_quit(app: AppHandle) {
    kill_sidecar(&app);
    app.exit(0);
}

fn spotlight_url() -> WebviewUrl {
    if cfg!(debug_assertions) {
        WebviewUrl::External("http://127.0.0.1:5173/spotlight.html".parse().expect("spotlight url"))
    } else {
        WebviewUrl::App("spotlight.html".into())
    }
}

fn apply_borderless(window: &tauri::WebviewWindow) {
    let _ = window.set_decorations(false);
    let _ = window.set_shadow(false);
    #[cfg(windows)]
    {
        let _ = clear_windows_caption(window);
    }
}

#[cfg(windows)]
fn clear_windows_caption(window: &tauri::WebviewWindow) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongW, SetWindowLongW, SetWindowPos, GWL_STYLE, SWP_FRAMECHANGED, SWP_NOACTIVATE,
        SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WS_CAPTION, WS_THICKFRAME,
    };
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let hwnd = hwnd.0 as windows_sys::Win32::Foundation::HWND;
    unsafe {
        let style = GetWindowLongW(hwnd, GWL_STYLE);
        SetWindowLongW(hwnd, GWL_STYLE, style & !(WS_CAPTION as i32 | WS_THICKFRAME as i32));
        SetWindowPos(
            hwnd,
            std::ptr::null_mut(),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        );
    }
}

fn spotlight_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window("spotlight") {
        apply_borderless(&window);
        return Ok(window);
    }
    let window = WebviewWindowBuilder::new(app, "spotlight", spotlight_url())
        .title("Nestify Spotlight")
        .inner_size(720.0, 520.0)
        .center()
        .visible(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .background_color(tauri::window::Color(0, 0, 0, 0))
        .build()
        .map_err(|error| error.to_string())?;
    apply_borderless(&window);
    Ok(window)
}

#[tauri::command]
fn window_open_spotlight(app: AppHandle) -> Result<(), String> {
    let window = spotlight_window(&app)?;
    position_spotlight(&window);
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    let _ = app.emit("ui:spotlight-open", ());
    Ok(())
}

fn position_spotlight(window: &tauri::WebviewWindow) {
    use tauri::Position;
    let cursor = window.cursor_position().ok();
    let monitor = cursor
        .as_ref()
        .and_then(|position| window.monitor_from_point(position.x, position.y).ok().flatten())
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return;
    };
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let width = 720.0 * scale;
    let height = 520.0 * scale;
    let left = area.position.x as f64 + (area.size.width as f64 - width) / 2.0;
    let max_top = area.position.y as f64 + area.size.height as f64 - height - 16.0;
    let preferred = area.position.y as f64 + area.size.height as f64 * 0.18;
    let top = preferred.min(max_top).max(area.position.y as f64 + 16.0);
    let _ = window.set_position(Position::Physical(tauri::PhysicalPosition {
        x: left.round() as i32,
        y: top.round() as i32,
    }));
}

#[tauri::command]
fn window_close_spotlight(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("spotlight") {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn window_resize_spotlight(app: AppHandle, height: f64) -> Result<(), String> {
    let height = height.clamp(120.0, 520.0);
    if let Some(window) = app.get_webview_window("spotlight") {
        window
            .set_size(tauri::Size::Logical(tauri::LogicalSize { width: 720.0, height }))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn dialog_pick_directory(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder.map(|path| path.to_string()));
    });
    tokio::task::spawn_blocking(move || rx.recv().map_err(|error| error.to_string()))
        .await
        .map_err(|error| format!("directory dialog task failed: {error}"))?
}

#[derive(serde::Deserialize)]
struct FileFilter {
    name: String,
    extensions: Vec<String>,
}

#[tauri::command]
async fn dialog_pick_files(app: AppHandle, filters: Vec<FileFilter>) -> Result<Vec<String>, String> {
    #[cfg(windows)]
    {
        let _ = app;
        return windows_pick_files(filters).await;
    }
    #[cfg(not(windows))]
    {
        use tauri_plugin_dialog::DialogExt;
        let (tx, rx) = std::sync::mpsc::channel();
        let mut builder = app.dialog().file();
        for filter in &filters {
            let extensions: Vec<&str> = filter.extensions.iter().map(String::as_str).collect();
            builder = builder.add_filter(&filter.name, &extensions);
        }
        builder.pick_files(move |files| {
            let paths = files
                .unwrap_or_default()
                .into_iter()
                .map(|path| path.to_string())
                .collect();
            let _ = tx.send(paths);
        });
        rx.recv().map_err(|error| error.to_string())
    }
}

#[cfg(windows)]
async fn windows_pick_files(filters: Vec<FileFilter>) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || windows_pick_files_blocking(filters))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(windows)]
fn windows_pick_files_blocking(filters: Vec<FileFilter>) -> Result<Vec<String>, String> {
    use windows_sys::Win32::UI::Controls::Dialogs::{
        GetOpenFileNameW, OFN_ALLOWMULTISELECT, OFN_EXPLORER, OFN_FILEMUSTEXIST, OFN_HIDEREADONLY,
        OFN_NOCHANGEDIR, OPENFILENAMEW,
    };

    let mut filter = Vec::<u16>::new();
    for item in &filters {
        let pattern = item
            .extensions
            .iter()
            .map(|extension| extension.trim().trim_start_matches('.'))
            .filter(|extension| !extension.is_empty())
            .map(|extension| format!("*.{extension}"))
            .collect::<Vec<_>>()
            .join(";");
        if pattern.is_empty() {
            continue;
        }
        filter.extend(wide(&item.name));
        filter.extend(wide(&pattern));
    }
    filter.extend(wide("All files"));
    filter.extend(wide("*.*"));
    filter.push(0);

    let mut buffer = vec![0u16; 65_536];
    let title = wide("Select images and videos");
    let mut dialog: OPENFILENAMEW = unsafe { std::mem::zeroed() };
    dialog.lStructSize = std::mem::size_of::<OPENFILENAMEW>() as u32;
    dialog.lpstrFilter = filter.as_ptr();
    dialog.lpstrFile = buffer.as_mut_ptr();
    dialog.nMaxFile = buffer.len() as u32;
    dialog.lpstrTitle = title.as_ptr();
    dialog.Flags = OFN_EXPLORER
        | OFN_ALLOWMULTISELECT
        | OFN_FILEMUSTEXIST
        | OFN_HIDEREADONLY
        | OFN_NOCHANGEDIR;

    if unsafe { GetOpenFileNameW(&mut dialog) } == 0 {
        return Ok(Vec::new());
    }

    let parts = split_wide_strings(&buffer);
    if parts.len() <= 1 {
        return Ok(parts);
    }
    let directory = PathBuf::from(&parts[0]);
    Ok(parts
        .into_iter()
        .skip(1)
        .map(|name| directory.join(name).to_string_lossy().into_owned())
        .collect())
}

#[cfg(windows)]
fn split_wide_strings(buffer: &[u16]) -> Vec<String> {
    let mut parts = Vec::new();
    let mut start = 0usize;
    for (index, value) in buffer.iter().copied().enumerate() {
        if value != 0 {
            continue;
        }
        if index == start {
            break;
        }
        parts.push(String::from_utf16_lossy(&buffer[start..index]));
        start = index + 1;
    }
    parts
}

#[cfg(windows)]
fn wide(value: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(value).encode_wide().chain(std::iter::once(0)).collect()
}

#[tauri::command]
async fn dialog_save_file(
    app: AppHandle,
    title: String,
    default_path: String,
    extensions: Vec<String>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    let extension_refs: Vec<&str> = extensions.iter().map(String::as_str).collect();
    app.dialog()
        .file()
        .set_title(title)
        .set_file_name(default_path)
        .add_filter("YAML", &extension_refs)
        .save_file(move |path| {
            let _ = tx.send(path.map(|value| value.to_string()));
        });
    rx.recv().map_err(|error| error.to_string())
}

#[tauri::command]
async fn dialog_open_file(app: AppHandle, title: String, extensions: Vec<String>) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    let extension_refs: Vec<&str> = extensions.iter().map(String::as_str).collect();
    app.dialog()
        .file()
        .set_title(title)
        .add_filter("YAML", &extension_refs)
        .pick_file(move |path| {
            let _ = tx.send(path.map(|value| value.to_string()));
        });
    rx.recv().map_err(|error| error.to_string())
}

#[tauri::command]
fn shell_reveal(path: String) -> Result<(), String> {
    if cfg!(windows) {
        Command::new("explorer")
            .arg(format!("/select,{path}"))
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }
    Err("shell reveal is only implemented on Windows in this shell".to_string())
}

#[tauri::command]
fn shell_open_path(app: AppHandle, path: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("path is empty".to_string());
    }
    let metadata = std::fs::metadata(&path).map_err(|error| {
        format!("cannot access path {path}: {error}")
    })?;
    if !metadata.is_dir() {
        return Err(format!("path is not a directory: {path}"));
    }
    if cfg!(windows) {
        Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|error| format!("failed to open directory {path}: {error}"))?;
        return Ok(());
    }
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn shell_open_external(app: AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    if !allowed_external_url(&url) {
        return Err("不允许打开该链接".to_string());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| error.to_string())
}

fn allowed_external_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let host = rest
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("")
        .split('@')
        .next_back()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    host == "gitee.com" || host.ends_with(".gitee.com") || host == "github.com" || host.ends_with(".github.com")
}

#[tauri::command]
fn clipboard_write_text(app: AppHandle, text: String) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard().write_text(text).map_err(|error| error.to_string())
}

#[tauri::command]
fn register_spotlight_shortcut(app: AppHandle, state: State<Sidecar>, accelerator: String) -> Result<(), String> {
    let shortcut = parse_accelerator(&accelerator)?;
    if let Some(previous) = state.shortcut.lock().map_err(|error| error.to_string())?.clone() {
        if let Ok(parsed) = parse_accelerator(&previous) {
            let _ = app.global_shortcut().unregister(parsed);
        }
    }
    app.global_shortcut()
        .on_shortcut(shortcut, |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                let _ = window_open_spotlight(app.clone());
            }
        })
        .map_err(|error| error.to_string())?;
    *state.shortcut.lock().map_err(|error| error.to_string())? = Some(accelerator);
    Ok(())
}

fn parse_accelerator(input: &str) -> Result<Shortcut, String> {
    let mut modifiers = Vec::new();
    let mut key = None;
    for part in input.split('+').map(str::trim).filter(|part| !part.is_empty()) {
        match part.to_ascii_lowercase().as_str() {
            "control" | "ctrl" => modifiers.push("Ctrl"),
            "shift" => modifiers.push("Shift"),
            "alt" | "option" => modifiers.push("Alt"),
            "meta" | "win" | "windows" | "super" | "command" => modifiers.push("Super"),
            other => key = Some(other.to_string()),
        }
    }
    let key = key.ok_or_else(|| format!("invalid accelerator: {input}"))?;
    let mut parts = modifiers;
    parts.push(key.as_str());
    parts
        .join("+")
        .parse::<Shortcut>()
        .map_err(|error| format!("invalid accelerator {input}: {error}"))
}

fn kill_sidecar(app: &AppHandle) {
    let Some(state) = app.try_state::<Sidecar>() else {
        return;
    };
    if let Some(mut child) = state.child.lock().ok().and_then(|mut guard| guard.take()) {
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[allow(dead_code)]
fn _path_is_dir(path: &Path) -> bool {
    path.is_dir()
}
