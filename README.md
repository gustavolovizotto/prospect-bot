# Bot de prospecção de landing pages

Encontra negócios locais e dá uma nota para cada um: sem site, site que é só Instagram, site fora do ar,
site lento ou que não funciona no celular. Depois prepara a abordagem: argumento de venda, o que propor
na landing page e uma mensagem profissional com link de WhatsApp. **Nada é enviado sozinho**: você revisa e clica.

## Rodar

```
git clone <este repo> && cd <pasta>
```

- **Mac/Linux:** `./rodar.sh`
- **Windows:** clique duas vezes em `rodar.bat` (se faltar o Python, o script instala pelo winget)

O painel abre em **http://localhost:8765**. Enquanto ele estiver aberto, o computador não dorme.

1. Em **Nova prospecção**, preencha **Seu perfil** (nome, como você se apresenta e portfólio). Esses dados entram nas mensagens.
2. Escolha as cidades, os nichos e a fonte de dados. Para deixar rodando à noite, ligue **Repetir a cada 2 horas** (o intervalo fica em `INTERVALO_HORAS`, no `bot.py`).
3. Clique em **Iniciar prospecção**. O progresso aparece ao vivo e os leads surgem na lista lateral.
4. Na lista, os leads ficam separados em quentes, mornos e frios. Cada lead mostra diagnóstico, como negociar,
   o que propor, a mensagem (editável), a etapa do funil, as notas e o motivo quando for descartado ou perdido.

## Fonte de dados

- **OpenStreetMap:** grátis e sem configuração, mas com cobertura menor no Brasil.
- **Google Places:** muito mais negócios. Crie uma chave em Google Cloud → Places API (New) e cole no painel.
  Ela fica salva só neste computador (`config.json`).

## Linha de comando (opcional)

- `python3 bot.py --cidades "Campinas,Sorocaba" --nichos dentista,pet --loop`
- `python3 bot.py --export` gera `leads.csv`
- `python3 bot.py --test` e `python3 painel.py --test` rodam os autotestes

## Estrutura

- `bot.py` faz prospecção, qualificação e mensagem, e grava em `leads.db` (SQLite). Para adicionar um nicho, basta uma entrada em `NICHOS`.
- `painel.py` é o servidor local: API dos leads, controle do bot (iniciar e parar) e perfil.
- `static/` é o front sem build: `index.html`, `app.css` (paleta em variáveis no topo) e `app.js`. Ícones: [Phosphor](https://phosphoricons.com).

`leads.db`, `leads.csv`, `run.log` e `config.json` ficam só na sua máquina (estão no `.gitignore`).
