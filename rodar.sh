#!/bin/sh
# Mac/Linux: ./rodar.sh  -> abre o painel em http://localhost:8765; a prospecção é iniciada por lá
cd "$(dirname "$0")"
command -v python3 >/dev/null || { echo "Instale o Python 3: https://www.python.org/downloads/"; exit 1; }
echo "Painel em http://localhost:8765  (deixe esta janela aberta; Ctrl+C para encerrar)"
(sleep 1; open http://localhost:8765 2>/dev/null || xdg-open http://localhost:8765) >/dev/null 2>&1 &
SLEEP=""; command -v caffeinate >/dev/null && SLEEP="caffeinate -i"  # Mac não dorme enquanto o painel estiver aberto
exec $SLEEP python3 painel.py
