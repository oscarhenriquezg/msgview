#!/usr/bin/env bash
# Instalador de MSG Viewer para Linux (AppImage).
# Uso:  bash -c "$(curl -fsSL https://raw.githubusercontent.com/oscarhenriquezg/msgview/main/scripts/install.sh)"
#
# Descarga el último AppImage publicado en GitHub Releases, lo coloca en
# ~/.local/bin, le da permisos de ejecución y crea una entrada en el menú de
# aplicaciones. No requiere privilegios de root.
set -euo pipefail

REPO="oscarhenriquezg/msgview"
BIN_DIR="${HOME}/.local/bin"
APPS_DIR="${HOME}/.local/share/applications"
TARGET="${BIN_DIR}/MSGViewer.AppImage"

info() { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
err()  { printf '\033[1;31mError:\033[0m %s\n' "$1" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || err "curl no está instalado."

arch="$(uname -m)"
[ "$arch" = "x86_64" ] || err "Arquitectura no soportada: ${arch} (solo hay build x86_64)."

info "Buscando la última versión en GitHub…"
url="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
  | grep -oE 'https://[^"]*x86_64\.AppImage')"
[ -n "$url" ] || err "No se encontró un AppImage en el último release."

info "Descargando: ${url##*/}"
mkdir -p "$BIN_DIR" "$APPS_DIR"
curl -fL "$url" -o "$TARGET"
chmod +x "$TARGET"

info "Creando entrada en el menú de aplicaciones…"
cat > "${APPS_DIR}/msg-viewer.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=MSG Viewer
Exec=${TARGET} %f
Icon=msg-viewer
MimeType=application/vnd.ms-outlook;
Categories=Office;
Terminal=false
EOF
update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true

printf '\033[1;32m✓ MSG Viewer instalado.\033[0m\n'
echo "  Ejecutable: ${TARGET}"
case ":${PATH}:" in
  *":${BIN_DIR}:"*) echo "  Lánzalo con: MSGViewer.AppImage   (o desde el menú de apps)";;
  *) echo "  Añade ~/.local/bin al PATH, o lánzalo con: ${TARGET}";;
esac
echo "  Si ves un error de FUSE: instala libfuse2, o usa --appimage-extract-and-run"
