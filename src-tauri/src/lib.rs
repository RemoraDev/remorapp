#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // Autoactualización (ver src/lib/tauriUpdater.ts en el frontend):
    // este plugin solo expone la posibilidad de revisar/descargar/
    // instalar una versión nueva -- la lógica de CUÁNDO ofrecerla y
    // el aviso al usuario viven en React, no acá.
    .plugin(tauri_plugin_updater::Builder::new().build())
    // Necesario para reiniciar la app después de instalar una
    // actualización (relaunch()).
    .plugin(tauri_plugin_process::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
