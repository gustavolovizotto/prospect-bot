#!/bin/sh
# Mac: faz o painel subir sozinho ao entrar no Mac e voltar se cair (LaunchAgent do macOS).
#   ./instalar-painel.sh            instala (ou reinstala) e já sobe o painel
#   ./instalar-painel.sh --mostrar  só mostra o arquivo que seria instalado
#   ./instalar-painel.sh --remover  desliga e remove
set -e
cd "$(dirname "$0")"
PASTA="$(pwd)"
ROTULO="com.prospeccao.painel"
DESTINO="$HOME/Library/LaunchAgents/$ROTULO.plist"
# O painel roda com ambiente limpo, então o PATH precisa achar o python3 e o claude (revisão do botão Iniciar prospecção).
CAMINHOS="$(dirname "$(command -v claude 2>/dev/null || echo "$HOME/.local/bin/claude")"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
PY="$(command -v python3)"

[ "$(uname)" = "Darwin" ] || { echo "Só para Mac. Em outros sistemas, use ./rodar.sh"; exit 1; }
[ -n "$PY" ] || { echo "Instale o Python 3: https://www.python.org/downloads/"; exit 1; }

if [ "$1" = "--remover" ]; then
  launchctl bootout "gui/$(id -u)/$ROTULO" 2>/dev/null || true
  rm -f "$DESTINO"
  echo "Removido. O painel não sobe mais sozinho."
  exit 0
fi

PLIST="<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\">
<dict>
  <key>Label</key><string>$ROTULO</string>
  <key>ProgramArguments</key>
  <array><string>$PY</string><string>-u</string><string>$PASTA/painel.py</string></array>
  <key>WorkingDirectory</key><string>$PASTA</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$CAMINHOS</string>
    <key>HOME</key><string>$HOME</string>
    <key>USER</key><string>$(id -un)</string>
    <key>LANG</key><string>pt_BR.UTF-8</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$PASTA/painel.log</string>
  <key>StandardErrorPath</key><string>$PASTA/painel.log</string>
</dict>
</plist>"

if [ "$1" = "--mostrar" ]; then
  printf '%s\n' "$PLIST"
  exit 0
fi

# Painel aberto à mão ocuparia a porta: o do LaunchAgent assume no lugar dele.
for pid in $(lsof -t -iTCP:8765 -sTCP:LISTEN 2>/dev/null); do kill "$pid"; done
mkdir -p "$HOME/Library/LaunchAgents"
launchctl bootout "gui/$(id -u)/$ROTULO" 2>/dev/null || true
printf '%s\n' "$PLIST" > "$DESTINO"
plutil -lint "$DESTINO" >/dev/null
launchctl bootstrap "gui/$(id -u)" "$DESTINO"
sleep 2
curl -s -m 3 -o /dev/null http://127.0.0.1:8765/api/bot && echo "Painel no ar em http://localhost:8765 e subindo sozinho ao entrar no Mac." \
  || echo "Instalado, mas o painel ainda não respondeu. Veja $PASTA/painel.log"
