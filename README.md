# Bot de prospecção de landing pages

Encontra negócios locais e dá uma nota para cada um: sem site, site que é só Instagram,
site fora do ar, site lento ou que não funciona no celular. Depois escreve uma mensagem de abordagem
personalizada com link de WhatsApp pronto. **Ele não envia nada sozinho**: você revisa e clica.

## Rodar

```
git clone <este repo> && cd <pasta>
```

- **Mac/Linux:** `./rodar.sh "Campinas,Sorocaba"`
- **Windows:** clique duas vezes em `rodar.bat` (se faltar o Python, o script instala pelo winget)

Sem cidades na linha de comando, o script pergunta. Ele impede o computador de dormir e repete a busca a cada 6h.
Deixe o carregador ligado.

O script também abre o **painel em http://localhost:8765**. Nele os leads aparecem separados em quentes, mornos e frios,
e cada lead mostra contato, site atual e diagnóstico, argumento de venda, o que propor na landing page e a mensagem
(editável) com botão de WhatsApp, além da etapa do funil e de notas da negociação. Para abrir só o painel: `python3 painel.py`.

## Estrutura

- `bot.py` faz prospecção, qualificação e mensagem, e grava em `leads.db` (SQLite).
- `painel.py` é o servidor local: API em `/api/leads` e `/api/lead`, mais o argumento de venda e a proposta por nicho.
- `static/` é o front sem build: `index.html`, `app.css` (paleta em variáveis no topo) e `app.js`. Ícones: [Phosphor](https://phosphoricons.com).

Se preferir planilha, `leads.csv` tem os mesmos dados ordenados por prioridade.

## Opções

- `python3 bot.py --export` gera o `leads.csv` atualizado a qualquer momento.
- `--nichos dentista,academia` limita os nichos (a lista fica em `NICHOS`, no `bot.py`).
- `GOOGLE_PLACES_KEY=...` usa o Google Places, com muito mais leads, em vez do OpenStreetMap (grátis, mas com pouca cobertura no Brasil).
- `python3 bot.py --test` roda o autoteste.

`leads.db`, `leads.csv` e `run.log` ficam só na sua máquina (estão no `.gitignore`).
