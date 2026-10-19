#!/bin/sh
# Mac/Linux: ./rodar.sh "Campinas,Sorocaba"   (sem argumento, pergunta)
cd "$(dirname "$0")"
command -v python3 >/dev/null || { echo "Instale o Python 3: https://www.python.org/downloads/"; exit 1; }
CIDADES="$1"
[ -z "$CIDADES" ] && printf "Cidades separadas por vírgula [Campinas]: " && read CIDADES
[ -z "$CIDADES" ] && CIDADES="Campinas"
echo "Rodando para: $CIDADES  (log em run.log, planilha em leads.csv; Ctrl+C para parar)"
SLEEP=""; command -v caffeinate >/dev/null && SLEEP="caffeinate -i"  # Mac não dorme enquanto roda
$SLEEP python3 -u bot.py --cidades "$CIDADES" --loop 2>&1 | tee -a run.log
