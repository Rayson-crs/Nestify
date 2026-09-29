use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    embed_webview2_loader();
    tauri_build::build();
}

fn embed_webview2_loader() {
    let target = env::var("TARGET").unwrap_or_default();
    if target != "x86_64-pc-windows-gnu" {
        return;
    }

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    let loader = manifest_dir.join("vendor/webview2/x64/WebView2Loader.dll");
    if !loader.is_file() {
        panic!("missing WebView2 loader: {}", loader.display());
    }

    let resource = out_dir.join("webview2loader.rc");
    let object = out_dir.join("webview2loader.o");
    let loader_path = loader.to_string_lossy().replace('\\', "\\\\");
    fs::write(
        &resource,
        format!("101 RCDATA \"{loader_path}\"\n"),
    )
    .expect("write webview2 resource script");

    let mingw = PathBuf::from(
        env::var("NESTIFY_MINGW_BIN").unwrap_or_else(|_| r"D:\application\mingw64\bin".to_string()),
    );
    let windres = mingw.join("windres.exe");
    let status = Command::new(&windres)
        .arg("-O")
        .arg("coff")
        .arg("-o")
        .arg(&object)
        .arg(&resource)
        .status()
        .unwrap_or_else(|error| panic!("failed to run {}: {error}", windres.display()));
    if !status.success() {
        panic!("windres failed to embed WebView2Loader.dll");
    }

    println!("cargo:rustc-link-arg={}", object.display());
    println!("cargo:rerun-if-changed={}", loader.display());
    println!("cargo:rerun-if-env-changed=NESTIFY_MINGW_BIN");
}
