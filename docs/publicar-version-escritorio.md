# Publicar una versión nueva de RemorApp para escritorio

Este documento explica el proceso completo para publicar una actualización de la app de escritorio (Windows, generada con Tauri). La instalación y la actualización son automáticas para quien use RemorApp; este proceso **no lo es** para vos: hay que compilar, firmar y subir los archivos cada vez.

## Antes de la primera vez

1. Instalar Rust (una sola vez): descargar y correr `rustup-init.exe` desde https://rustup.rs/.
2. Instalar las herramientas de compilación de Visual Studio (una sola vez, requiere permisos de administrador):
   ```powershell
   winget install --id Microsoft.VisualStudio.2022.BuildTools --silent --override "--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
   ```
3. La clave privada de firma de actualizaciones ya está generada, en:
   ```
   C:\Users\SQuei\remorapp-tauri-secrets\remorapp-updater.key
   C:\Users\SQuei\remorapp-tauri-secrets\updater-key-password.txt
   ```
   **Hacé una copia de seguridad de esta carpeta en un lugar seguro (fuera de este disco).** Si la perdés, no vas a poder firmar más actualizaciones -- vas a tener que generar una clave nueva y todas las instalaciones existentes de RemorApp dejarán de poder autoactualizarse (tendrían que reinstalar RemorApp desde cero con la clave nueva). Esta carpeta NO está en el repositorio de git a propósito -- nunca la subas a GitHub ni la compartas.
4. (Opcional pero recomendado) Instalar GitHub CLI desde https://cli.github.com/ y correr `gh auth login` una vez -- permite que el script de publicación suba el release automáticamente.

## Cada vez que querés publicar una versión nueva

1. Subí el número de versión en **dos** archivos (tienen que quedar iguales):
   - `package.json` -> campo `"version"`
   - `src-tauri/tauri.conf.json` -> campo `"version"`

2. Abrí una terminal de PowerShell en la carpeta del proyecto y corré:
   ```powershell
   .\scripts\publicar-version-escritorio.ps1 -SubirAGitHub
   ```
   Esto compila la app, la firma, arma el manifiesto de actualización (`latest.json`), y crea el release en GitHub subiendo los dos archivos necesarios.

   Si no tenés `gh` instalado, corré el script sin `-SubirAGitHub` y subí los dos archivos que te indica al final a mano, desde:
   https://github.com/RemoraDev/remorapp/releases/new

   **Importante:** el instalador se tiene que subir siempre con el nombre exacto `RemorApp-Setup.exe` (el script ya lo renombra solo) -- si se sube con otro nombre, tanto el link de descarga de la página de Inicio como el propio autoactualizador dejan de encontrarlo.

3. Listo. La próxima vez que alguien abra la app de escritorio (o cada 4 horas si la deja abierta), va a ver un aviso de "Hay una versión nueva de RemorApp disponible" con un botón para actualizar.

## Cómo funciona la autoactualización (para referencia)

- La app revisa, al abrir y después cada 4 horas, el archivo `latest.json` publicado en la última GitHub Release.
- Si hay una versión más nueva, **no se instala sola**: aparece un aviso (toast) con un botón "Actualizar y reiniciar". Se eligió este comportamiento (con confirmación) en vez de silencioso porque instalar una actualización obliga a reiniciar la app, y eso no debería pasar sin avisar mientras alguien la está usando activamente (por ejemplo, en medio de una transmisión).
- Al confirmar, descarga el instalador, lo aplica, y reinicia la app sola.
- Todo esto usa `@tauri-apps/plugin-updater`, verificando la firma del archivo descargado contra la clave pública guardada en `src-tauri/tauri.conf.json` -- un archivo que no esté firmado con la clave privada correspondiente es rechazado, así que no alcanza con subir cualquier `.exe` con ese nombre a la Release.

## Generar instaladores para Mac o Linux

No se generaron en esta sesión -- el entorno usado para configurar y probar todo esto es Windows. Para generarlos hace falta compilar desde una Mac (para el instalador de Mac) y desde Linux (para el de Linux) respectivamente -- Tauri no hace compilación cruzada entre sistemas operativos. Si en algún momento se necesitan, lo más simple es un flujo de GitHub Actions que compile automáticamente en los tres sistemas operativos a la vez cuando se publica un tag de versión (`tauri-apps/tauri-action` está pensado exactamente para esto) -- queda pendiente para cuando haga falta.
