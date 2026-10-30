# Prospecção pelo WhatsApp

Hub local de prospecção para pequenos e médios negócios:
- encontra empresas da sua região e dá uma nota para cada uma, conforme o que você vende;
- prepara a mensagem de abordagem e organiza a fila de envio;
- acompanha quem respondeu num dashboard.

Rotinas opcionais do app do Claude qualificam leads à noite e enviam de manhã. Tudo roda no seu computador.

## Instalar com o Claude

Peça ao seu Claude (app do Claude no computador ou Claude Code):

> Clone https://github.com/gustavolovizotto/prospect-bot, entre na pasta e faça o setup seguindo o CLAUDE.md.

Ele confere os requisitos, sobe o painel, pergunta o que sua empresa vende e monta o seu perfil de venda.
Depois cria as rotinas automáticas, mas a de envio só com a sua autorização.

### Requisitos
- **Python 3.8 ou mais novo** e **curl**. No Mac, os dois já vêm instalados ou chegam com as ferramentas de linha de comando.
- **Mac**, para as rotinas automáticas e para o painel subir sozinho. No Windows e no Linux funcionam o painel e o bot.
- **App do Claude** com tarefas agendadas, a extensão **Claude in Chrome** e o **WhatsApp Web** logado, para as rotinas.
- Opcional: **Claude Code** em linha de comando, para o botão Iniciar prospecção aplicar as instruções do perfil.
- Opcional: chave do **Google Places**, que traz muito mais negócios que o OpenStreetMap e cobra por busca.

### Antes de usar
- Mensagem automática para quem não te conhece pode levar o WhatsApp a **bloquear o seu número**.
  Comece com pouco (20 por dia) e use um número de trabalho.
- Respeite quem pedir para não receber mais mensagens (LGPD). Marque esses leads como **Nunca contatar**.
- Seus leads, perfis e chaves ficam só no seu computador: `leads.db`, `config.json` e `backups/` não vão para o git.

## Rodar sem o Claude

```
git clone https://github.com/gustavolovizotto/prospect-bot && cd prospect-bot
```

- **Mac/Linux:** `./rodar.sh`
- **Windows:** clique duas vezes em `rodar.bat` (se faltar o Python, o script instala pelo winget)

O painel abre em **http://localhost:8765**. Enquanto ele estiver aberto, o computador não dorme.

1. Em **Nova prospecção**, preencha **Seus dados** (nome, como você se apresenta e portfólio). Esses dados entram nas mensagens.
2. Escolha as cidades, os nichos e a fonte de dados. Para deixar rodando à noite, ligue **Repetir a cada 2 horas** (o intervalo fica em `INTERVALO_HORAS`, no `bot.py`).
3. Clique em **Iniciar prospecção**. O progresso aparece ao vivo e os leads surgem na lista lateral.
4. Na lista, os leads ficam separados em quentes, mornos e frios. Cada lead mostra diagnóstico, como negociar,
   o que propor, a mensagem (editável), a etapa do funil, as notas e o motivo quando for descartado ou perdido.
5. Quando um lead responder, abra ele e clique em **Mandar para o dashboard**. O **Dashboard** é um kanban
   (Respondeu → Protótipo → Proposta enviada → Negociando → Fechado): arraste os cards ou use ←/→ com o card em foco.
   Cada lead do dashboard guarda o link do protótipo, o valor proposto e o próximo passo com data.
   O card avisa quando o passo venceu ou quando o lead está parado há 5 dias ou mais, e cada coluna soma os valores.
   No topo ficam os números do funil e, embaixo, a taxa de resposta por nicho, cidade, situação do site e perfil.
   No lead, **Mensagens de proposta** traz os textos do perfil já com o link e o valor, para copiar ou abrir no WhatsApp.
6. O funil se limpa sozinho: número que o WhatsApp recusou vira **Descartado** ("Contato inválido"), e quem foi contatado
   pela fila e continua sem resposta depois dos dias definidos no perfil (padrão 7) vira **Perdido** ("Não respondeu").
   Descartados e perdidos saem da lista, mas aparecem no filtro **Etapa** e na busca.
7. As rotinas das 10h e das 20h leem a lista de conversas do WhatsApp Web (sem abrir nenhuma) e registram as respostas:
   interesse vai para o dashboard, recusa vira Perdido e resposta automática só fica anotada. Veja `rotinas/respostas.md`.

## Perfis de venda

Clique no nome do perfil, embaixo de "Prospecção", para abrir **Perfis de venda**. Cada perfil define:

- **Prospecção:** cidades (a rotina das 20h segue a ordem e marca as feitas), nichos e fonte.
- **Qualificação:** pontos de cada critério e as faixas quente, morno e descarte.
- **Contato e disparo:** o modelo da mensagem com `{variaveis}`, o limite por dia, a espera entre a saudação e o resto,
  em quantos dias sem resposta o lead vira Perdido, o **follow-up** (2ª mensagem, enviada pela rotina das 10h quando
  ligado) e as **mensagens de proposta** para quem está no dashboard.
- **Nichos próprios:** em Prospecção, **Novo nicho** cria um nicho com nome, termo de busca, plural e ticket.

Cada etapa tem um campo **Instruções para o Claude**, em texto livre, que as rotinas em `rotinas/` seguem.
Pelo botão **Iniciar prospecção**, no fim da busca o bot chama o Claude Code (`claude -p`, com o seu login) para aplicar
as instruções de prospecção e qualificação aos leads novos. Quem não se encaixa vai para descartado com o motivo "Perfil: …".
Sem instruções preenchidas, essa etapa não roda.
O perfil **Landing pages** é o padrão. **Novo perfil** começa como cópia do perfil aberto. Ao usar outro perfil,
os leads ainda não abordados são requalificados na hora; a fila e quem já foi contatado não mudam.

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
- `painel.py` é o servidor local: API dos leads, controle do bot (iniciar e parar), perfis, fila, respostas e follow-up.
- `rotinas/` tem o passo a passo das rotinas agendadas e os modelos das tarefas (`tarefas.md`).
- `CLAUDE.md` é o roteiro de setup e as regras para o Claude.
- `static/` é o front sem build: `index.html`, `app.css` (paleta em variáveis no topo) e `app.js`. Ícones: [Phosphor](https://phosphoricons.com).

`leads.db`, `leads.csv`, `run.log` e `config.json` ficam só na sua máquina (estão no `.gitignore`).

## Segurança dos dados

- O painel guarda uma cópia do banco por dia em `backups/`, mantendo as últimas 14.
- Mac: `./instalar-painel.sh` faz o painel subir sozinho ao entrar no Mac e voltar se cair.
  Para desligar, rode `./instalar-painel.sh --remover`.

## Licença

[MIT](LICENSE): use, altere e distribua à vontade, mantendo o aviso de copyright.
O software vem sem garantia. O uso com o WhatsApp e o cumprimento da LGPD são responsabilidade de quem usa.
