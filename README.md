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

De manhã, abra **`leads.csv`** no Excel: está ordenado por prioridade, e a coluna `link_whatsapp` abre a conversa
com a mensagem já escrita.

## Opções

- `python3 bot.py --export` gera o `leads.csv` atualizado a qualquer momento.
- `--nichos dentista,academia` limita os nichos (a lista fica em `NICHOS`, no `bot.py`).
- `GOOGLE_PLACES_KEY=...` usa o Google Places, com muito mais leads, em vez do OpenStreetMap (grátis, mas com pouca cobertura no Brasil).
- `python3 bot.py --test` roda o autoteste.

`leads.db`, `leads.csv` e `run.log` ficam só na sua máquina (estão no `.gitignore`).
