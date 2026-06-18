#!/usr/bin/env bash
# Instalador de MSG Viewer para Linux y macOS.
# Uso:  bash -c "$(curl -fsSL https://raw.githubusercontent.com/oscarhenriquezg/msgview/main/scripts/install.sh)"
#
# Linux : descarga el AppImage (x86_64), lo deja en ~/.local/bin con permisos de
#         ejecución y crea una entrada en el menú de aplicaciones.
# macOS : descarga el .zip universal (arm64 + Intel), descomprime "MSG Viewer.app"
#         en ~/Applications y le quita la cuarentena (la app no está firmada).
# No requiere privilegios de root en ninguno de los dos.
set -euo pipefail

REPO="oscarhenriquezg/msgview"
API="https://api.github.com/repos/${REPO}/releases/latest"

info() { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
ok()   { printf '\033[1;32m%s\033[0m\n' "$1"; }
err()  { printf '\033[1;31mError:\033[0m %s\n' "$1" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || err "curl no está instalado."

# --- Detección de SO y arquitectura (patrón estilo Homebrew) ----------------
arch="$(uname -m)"
case "$(uname)" in
  Linux)  OS=linux ;;
  Darwin) OS=macos ;;
  *)      err "Solo se soporta Linux y macOS." ;;
esac

# Resuelve la URL de descarga del asset cuyo nombre casa con el patrón regex $1.
asset_url() {
  local pat="$1" url
  url="$(curl -fsSL "$API" | grep -oE "https://[^\"]*${pat}")" || true
  [ -n "$url" ] || err "No se encontró un asset que case con '${pat}' en el último release."
  printf '%s\n' "$url"
}

# --- FUSE2: los AppImage necesitan libfuse.so.2 (FUSE 2, no FUSE 3) ----------
has_fuse2() {
  ldconfig -p 2>/dev/null | grep -q 'libfuse\.so\.2' && return 0
  local p
  for p in /usr/lib/libfuse.so.2 /usr/lib/*/libfuse.so.2 /lib/*/libfuse.so.2 /lib64/libfuse.so.2; do
    [ -e "$p" ] && return 0
  done
  return 1
}

# Comando de instalación de FUSE2 según el gestor de paquetes de la distro.
fuse2_install_cmd() {
  if command -v apt-get >/dev/null 2>&1; then
    # Ubuntu 24.04+ renombró el paquete a libfuse2t64.
    echo 'sudo apt-get install -y libfuse2 || sudo apt-get install -y libfuse2t64'
  elif command -v dnf >/dev/null 2>&1; then
    echo 'sudo dnf install -y fuse fuse-libs'
  elif command -v pacman >/dev/null 2>&1; then
    echo 'sudo pacman -S --needed --noconfirm fuse2'
  elif command -v zypper >/dev/null 2>&1; then
    echo 'sudo zypper install -y libfuse2'
  fi
}

# Si falta FUSE2, lo ofrece (prompt en /dev/tty, porque en `curl | bash` el
# stdin es el propio script). Sin tty o sin gestor conocido: muestra el comando.
ensure_fuse2() {
  local appimage="$1"
  has_fuse2 && return 0
  local cmd; cmd="$(fuse2_install_cmd)"
  info "FUSE2 (libfuse.so.2) no está instalado; los AppImage lo necesitan para arrancar."
  if [ -z "$cmd" ]; then
    echo "  Instálalo con tu gestor (paquete libfuse2 / fuse-libs / fuse2),"
    echo "  o ejecuta sin FUSE:  ${appimage} --appimage-extract-and-run"
    return 0
  fi
  # Abrir /dev/tty de verdad (no solo comprobar -r): en `curl | bash` sin
  # terminal usable, esto falla y caemos a mostrar el comando.
  if { exec 3</dev/tty; } 2>/dev/null; then
    printf '  ¿Instalarlo ahora? Se ejecutará (pedirá tu contraseña de sudo):\n    %s\n  [s/N] ' "$cmd"
    local ans=''; read -r ans <&3 || ans=''
    exec 3<&-
    case "$ans" in
      s|S|y|Y)
        if eval "$cmd"; then ok "✓ FUSE2 instalado."
        else echo "  No se pudo instalar. Hazlo a mano, o usa: ${appimage} --appimage-extract-and-run"; fi ;;
      *) echo "  Saltado. Para instalarlo luego:  $cmd"
         echo "  (o ejecuta sin FUSE:  ${appimage} --appimage-extract-and-run)" ;;
    esac
  else
    echo "  Instálalo con:  $cmd"
    echo "  (o ejecuta sin FUSE:  ${appimage} --appimage-extract-and-run)"
  fi
}

install_linux() {
  [ "$arch" = "x86_64" ] || err "En Linux solo hay build x86_64 (detectado: ${arch})."
  local bin_dir="${HOME}/.local/bin" apps_dir="${HOME}/.local/share/applications"
  local target="${bin_dir}/MSGViewer.AppImage" url
  url="$(asset_url 'x86_64\.AppImage')"

  info "Descargando: ${url##*/}"
  mkdir -p "$bin_dir" "$apps_dir"
  curl -fL "$url" -o "$target"
  chmod +x "$target"

  info "Creando entrada en el menú de aplicaciones…"
  cat > "${apps_dir}/msg-viewer.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=MSG Viewer
Exec=${target} %f
Icon=msg-viewer
MimeType=application/vnd.ms-outlook;
Categories=Office;
Terminal=false
EOF
  update-desktop-database "$apps_dir" >/dev/null 2>&1 || true

  # Comprobar FUSE2 (requisito de los AppImage) y ofrecer instalarlo si falta.
  ensure_fuse2 "$target"

  ok "✓ MSG Viewer instalado."
  echo "  Ejecutable: ${target}"
  case ":${PATH}:" in
    *":${bin_dir}:"*) echo "  Lánzalo con: MSGViewer.AppImage   (o desde el menú de apps)";;
    *) echo "  Añade ~/.local/bin al PATH, o lánzalo con: ${target}";;
  esac
}

install_macos() {
  command -v unzip >/dev/null 2>&1 || err "unzip no está disponible."
  local apps_dir="${HOME}/Applications" app="MSG Viewer.app" url tmp
  url="$(asset_url 'mac\.zip')"   # .zip universal: sirve para arm64 e Intel

  info "Descargando: ${url##*/}"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  curl -fL "$url" -o "${tmp}/app.zip"

  info "Instalando en ${apps_dir}…"
  mkdir -p "$apps_dir"
  rm -rf "${apps_dir:?}/${app}"
  unzip -q "${tmp}/app.zip" -d "$apps_dir"
  # App sin firmar: quitar la cuarentena para que Gatekeeper no la bloquee.
  xattr -dr com.apple.quarantine "${apps_dir}/${app}" 2>/dev/null || true

  ok "✓ MSG Viewer instalado."
  echo "  App: ${apps_dir}/${app}"
  echo "  Ábrela desde Launchpad/Finder, o con: open \"${apps_dir}/${app}\""
}

case "$OS" in
  linux) install_linux ;;
  macos) install_macos ;;
esac
