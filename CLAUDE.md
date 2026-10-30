# Prospecção: instruções para o Claude

Hub local de prospecção pelo WhatsApp:
- o **bot** encontra negócios (OpenStreetMap ou Google Places), qualifica cada um pelo perfil de venda e monta a mensagem;
- o **painel** (http://localhost:8765) organiza a fila de envio, o dashboard de quem respondeu e os perfis de venda;
- duas **rotinas agendadas** do app do Claude qualificam à noite e enviam de manhã.

Tudo roda no computador do usuário. Nenhum dado vai para servidor. Fale com o usuário em português do Brasil.
Nestas instruções, o "vendedor" é o usuário: a pessoa que vai prospectar.

## Setup: quando pedirem para instalar ou configurar
Siga na ordem, uma etapa por vez. Antes de cada etapa, diga em uma frase o que vai fazer. Só pergunte o que não dá para descobrir sozinho.

### 1. Conferir os requisitos
- Rode `python3 --version` (precisa ser 3.8 ou mais novo), `curl --version` e `git --version`. Sem Python, indique https://www.python.org/downloads/ e pare.
- **Sistema:**
  - No **macOS**, tudo funciona.
  - No Windows e no Linux, funcionam o painel e o bot (`rodar.bat` ou `./rodar.sh`). As rotinas automáticas e o painel subindo sozinho são só do Mac. Avise isso.
- **O que as rotinas usam:**
  - o app do Claude no computador, que tem as tarefas agendadas;
  - a extensão Claude in Chrome;
  - o WhatsApp Web.
- **A revisão do botão Iniciar prospecção** usa o Claude Code em linha de comando (`claude --version`). Sem ele, essa etapa é pulada sem erro.
- `python3 bot.py --test && python3 painel.py --test` precisa imprimir `ok` duas vezes.

### 2. Subir o painel
- **Mac:** pergunte se o painel deve subir sozinho ao ligar o Mac.
  - Se sim, rode `./instalar-painel.sh`. Ele cria um LaunchAgent. Se a permissão for negada, peça para o vendedor rodar o script no terminal.
  - Se não, rode `nohup python3 painel.py > painel.log 2>&1 &`.
- **Windows e Linux:** `rodar.bat` ou `./rodar.sh`, num terminal que fique aberto.
- Confira com `curl -s 127.0.0.1:8765/api/bot` e passe o link http://localhost:8765.

### 3. Dados do vendedor
Pergunte:
- o nome;
- como ele se apresenta (ex.: "consultor de sistemas");
- o site ou portfólio, se tiver.

Salve:
`curl -s -X POST 127.0.0.1:8765/api/config -H 'Content-Type: application/json' -d '{"perfil":{"nome":"…","funcao":"…","portfolio":"…"}}'`

### 4. Perfil de venda
O perfil padrão, "Landing pages", é só um exemplo: venda de sites para pequenos negócios. Monte o perfil da empresa numa conversa curta. Pergunte:
- o que a empresa vende e para quem (tipos de negócio);
- a região: as cidades, em ordem de prioridade;
- o que faz um lead ser bom ou ruim para esse produto;
- o tom da primeira mensagem e o convite (ex.: mostrar uma demonstração);
- o limite de mensagens por dia. O padrão é 30; para número novo, sugira 20.

Depois, monte o perfil:
- `GET /api/perfis` traz o perfil padrão, os critérios (`sinais`) e as `variaveis` do modelo de mensagem.
- Copie o padrão com um `id` novo (minúsculas, números, `-` ou `_`) e um `nome`. Ajuste:
  - **`prospeccao.nichos`:** ids de `GET /api/bot` → `nichos`.
    - Para tipo de negócio que não existe, crie: `POST /api/nichos {"acao":"criar","nicho":{"rotulo":"Imobiliária","busca":"imobiliária","segmento":"imobiliárias","ticket":15}}`.
    - O `ticket` vale 15 (alto), 10 (médio) ou 5 (baixo).
  - **`prospeccao.cidades`:** `[{"nome":"Cidade","feita":""}]`.
  - **`qualificacao.pontos`:** de −100 a 100. As faixas precisam respeitar `minimo ≤ morno ≤ quente`.
  - **`contato.mensagem`:**
    - O 1º parágrafo é curto, tem `{saudacao}` e vai sozinho.
    - Depois vem uma linha em branco e o resto.
    - Use as variáveis. Não prometa nada que o vendedor não disse.
  - **`contato.propostas`:** mensagens prontas para quem responder.
  - **`contato.followup`:** escreva o texto, mas deixe `"ativo": false`.
  - **`contato.reengajamento`:** até 3 modelos de mensagem para quem está no dashboard e parou de responder. O Claude confere o WhatsApp (lista e histórico) e monta a fila de reengajamento (`rotinas/reengajar.md`, ou o botão Atualizar da tela Reengajamento, que chama o Claude Code com `--chrome`). O envio é pelo vendedor, ou pelo Claude quando o vendedor pedir.
  - **`instrucoes` de cada etapa:** o que o vendedor disse em linguagem natural e que não cabe nos pontos.
- Salve com `POST /api/perfis {"acao":"salvar","perfil":{…}}`. A resposta traz em `previa` a mensagem pronta com um lead de exemplo.
- **Mostre a prévia ao vendedor e só siga com a aprovação dele.** Depois ative: `POST /api/perfis {"acao":"ativar","id":"…"}`.

### 5. Google Places (opcional)
- O OpenStreetMap é grátis, mas traz poucos celulares. O Google Places traz muito mais negócios, mas cobra por busca no Google Cloud.
- Se o vendedor quiser, explique como criar a chave: Google Cloud → ativar a Places API (New) → Credenciais → Criar chave.
- Peça para ele mesmo colar a chave em **Nova prospecção → Fonte de dados → Google Places**. **Nunca peça a chave no chat.**
- Depois, troque `prospeccao.fonte` do perfil para `google`.

### 6. WhatsApp Web
- Peça para abrir https://web.whatsapp.com no Chrome que tem a extensão Claude in Chrome.
- Ele lê o QR code com o celular do número que vai prospectar.
- Confira que a lista de conversas aparece.

### 7. Rotinas agendadas
- **Antes, explique os riscos:**
  - mensagem automática para desconhecidos pode fazer o WhatsApp bloquear o número;
  - quem pedir para não receber mais mensagens precisa ser respeitado (LGPD).
- Crie as tarefas de `rotinas/tarefas.md`, trocando `<PROJETO>` pelo caminho absoluto desta pasta (`pwd`).
- **A tarefa de disparo só pode ser criada se o vendedor autorizar, com as palavras dele, o envio automático de mensagens pelo número dele.** Sem essa autorização:
  - crie só a tarefa de qualificação;
  - o envio fica pelo painel, em Contato automático → Abrir conversas em sequência.
- Confirme os horários. O padrão é 20h de domingo a quinta e 10h de segunda a sexta.

### 8. Primeira prospecção e resumo
- Ofereça rodar a primeira cidade agora: `python3 bot.py --cidades "<Cidade>"`, em segundo plano. No OpenStreetMap, leva uns 5 minutos por cidade.
- Termine com um resumo:
  - o link do painel;
  - o perfil em uso;
  - as rotinas criadas, com os horários;
  - o que ficou pendente (chave do Google, WhatsApp, follow-up desligado).

## Regras deste projeto
- Nunca envie mensagem a lead fora das rotinas autorizadas, a não ser que o vendedor peça.
- Nunca responda leads. Quem responde é o vendedor.
- Lead marcado como "Nunca contatar" (descartado com esse motivo) não recebe mensagem de jeito nenhum.
- `leads.db`, `config.json`, `backups/` e os logs são dados da empresa: nunca commite nem envie para fora.
- Depois de mexer no código, rode `python3 bot.py --test && python3 painel.py --test`.

## Mapa rápido
- `bot.py`: prospecção, qualificação, mensagens e perfis de venda (`PERFIL_PADRAO`, `NICHOS`).
- `painel.py`: servidor local e API. A lista de rotas está no topo do arquivo.
- `static/`: a tela, sem build.
- `rotinas/`:
  - o passo a passo das rotinas (`qualificar.md`, `disparar.md`, `respostas.md`, `reengajar.md`);
  - os modelos das tarefas agendadas (`tarefas.md`).
- `instalar-painel.sh`: LaunchAgent do Mac (`--mostrar` só mostra, `--remover` desliga).
