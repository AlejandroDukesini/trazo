use tauri::Manager;

/// Envoltorio de escritorio de Trazo. Toda la interfaz y la lógica son las de la web;
/// aquí solo se añaden diálogos nativos de archivo y una única instancia de la aplicación.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Si se abre de nuevo, se enfoca la ventana existente.
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error al iniciar Trazo");
}
