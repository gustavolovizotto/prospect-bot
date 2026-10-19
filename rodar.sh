#!/bin/sh
# Mac/Linux: ./rodar.sh "Campinas,Sorocaba"   (sem argumento, pergunta)
cd "$(dirname "$0")"
command -v python3 >/dev/null || { echo "Instale o Python 3: https://www.python.org/downloads/"; exit 1; }
CIDADES="$1"
[ -z "$CIDADES" ] && printf "Cidades separadas por vírgula [Campinas]: " && read CIDADES
[ -z "$CIDADES" ] && CIDADES="Campinas"
echo "Rodando para: $CIDADES  (painel em http://localhost:8765, log em run.log; Ctrl+C para parar)"
python3 painel.py & PAINEL=$!; trap 'kill $PAINEL 2>/dev/null' EXIT
sleep 1; (open http://localhost:8765 || xdg-open http://localhost:8765) >/dev/null 2>&1
SLEEP=""; command -v caffeinate >/dev/null && SLEEP="caffeinate -i"  # Mac não dorme enquanto roda
$SLEEP python3 -u bot.py --cidades "$CIDADES" --loop 2>&1 | tee -a run.log
