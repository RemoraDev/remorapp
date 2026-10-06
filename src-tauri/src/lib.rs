use tauri::Manager;

// Windows deja el color de la barra de título nativa a criterio del
// tema del sistema -- en modo oscuro suele salir gris carbón, no el
// negro casi puro del resto de la app (--color-bg: #06070a), y se
// nota como una costura de color entre la barra y el contenido. Se
// fuerza a negro puro con la API de DWM (Windows 11), la única forma
// de tocar ese color sin sacar la barra nativa por completo (ver el
// comentario largo que tenía DesktopTitleBar.tsx sobre por qué se
// prefirió conservarla en vez de reimplementar mover/redimensionar a
// mano). Si la API no está disponible (Windows 10, por ejemplo) el
// resultado del intento simplemente se descarta -- la barra queda con
// el gris de siempre, no rompe nada.
#[cfg(target_os = "windows")]
fn pintar_titlebar_negro(window: &tauri::WebviewWindow) {
  use windows::Win32::Foundation::COLORREF;
  use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_CAPTION_COLOR};

  if let Ok(hwnd) = window.hwnd() {
    let color = COLORREF(0x00000000);
    unsafe {
      let _ = DwmSetWindowAttribute(
        hwnd,
        DWMWA_CAPTION_COLOR,
        &color as *const COLORREF as *const core::ffi::c_void,
        std::mem::size_of::<COLORREF>() as u32,
      );
    }
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // Una sola instancia a la vez: intentar abrir una segunda (ej. doble
    // click en el acceso directo con la app ya abierta) enfoca la
    // ventana existente en vez de abrir otra. Tiene que ser el PRIMER
    // plugin registrado (lo exige tauri-plugin-single-instance) para
    // poder cortar el arranque antes de que se cree nada más.
    //
    // Sin esto, dos instancias corriendo a la vez bloqueaban la
    // autoactualización: el instalador no puede reemplazar el .exe
    // mientras la otra instancia lo tiene abierto, así que la
    // actualización "se aplicaba" pero al reabrir seguía siendo la
    // versión vieja -- quedaba pidiendo actualizar en bucle.
    .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
      }
    }))
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

      #[cfg(target_os = "windows")]
      if let Some(window) = app.get_webview_window("main") {
        pintar_titlebar_negro(&window);
      }

      Ok(())
    })
    // Corrección: reporte de que la app seguía corriendo en segundo
    // plano después de cerrar la ventana (el proceso y sus procesos
    // hijos de WebView2 -- Crashpad, GPU, Network, Storage -- no
    // terminaban solos). No había ningún código acá que lo explicara
    // (sin tray, sin "minimizar en vez de cerrar", sin watchdog) -- el
    // cierre ya debería terminar el proceso solo con el comportamiento
    // por default de Tauri. Igual, por las dudas de que algo quede
    // colgado esperando (una conexión Realtime sin cerrar, un timer),
    // se fuerza la salida inmediata y explícita del proceso entero
    // apenas se cierra la ventana principal, en vez de confiar en que
    // el teardown implícito de WebView2 se complete solo.
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::CloseRequested { .. } = event {
        window.app_handle().exit(0);
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
