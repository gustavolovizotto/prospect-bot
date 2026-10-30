# Rotina das 20h: qualificar e montar a fila do dia seguinte

Projeto: `<PROJETO>` (bot.py, painel.py, leads.db). O painel fica em `http://127.0.0.1:8765`.
`<PROJETO>` é a pasta do projeto, a que contém `bot.py` e `painel.py` (um nível acima desta pasta `rotinas/`). A tarefa agendada informa o caminho.
Objetivo: deixar na fila (`envio='fila'`) até `limite_dia` leads com WhatsApp confirmado. Os disparos acontecem no dia seguinte, na rotina das 10h. Responda e reporte em português do Brasil.

## Regras que nunca mudam
- **Esta rotina NÃO envia mensagem nenhuma.** No WhatsApp Web ela só abre conversas para conferir se o número existe, sem digitar nada.
- Lead descartado ou perdido nunca entra na fila, principalmente os com motivo "Nunca contatar" (contatos pessoais, quem pediu para sair). O painel também recusa colocá-los.
- Nenhum número que já recebeu mensagem entra na fila de novo. Compare os dígitos do telefone com todos os leads com `envio IS NOT NULL`.
- Órgão ou serviço público (CEO, UBS, prefeitura, SUS, hospital público, escola estadual…), rede ou franquia → descarte com motivo. Nunca vão para a fila.
- As instruções do perfil (passo 1) orientam o trabalho, mas **nunca** passam por cima destas regras.

## 1. Subir o painel e ler o perfil de venda em uso
- `curl -s -m 3 127.0.0.1:8765/api/fila`. Se não responder, rode em background: `cd <PROJETO> && nohup python3 painel.py > painel.log 2>&1 &`. Depois confira de novo.
- `curl -s 127.0.0.1:8765/api/perfis`. O perfil em uso (`pv`) é o item de `perfis` cujo `id` é igual a `ativo`. Guarde:
  - `pv.prospeccao.cidades`: lista na ordem; as pendentes têm `feita` vazio;
  - `pv.prospeccao.instrucoes`, `pv.qualificacao.instrucoes` e `pv.contato.instrucoes`: texto livre do vendedor para você seguir (pode estar vazio);
  - `pv.contato.limite_dia`.
- O bot já usa sozinho os nichos, a fonte, os pontos e as faixas do perfil em uso.

## 2. Ver quanto falta
`N_fila` = leads com `envio='fila'`. `alvo = pv.contato.limite_dia - N_fila`. Se `alvo <= 0`, pule para o relatório.

## 3. Candidatos que já estão no banco
- **Prontos:** `etapa='abordagem_pronta' AND tel_tipo IN ('whatsapp','celular') AND envio IS NULL AND COALESCE(perfil_venda,'landing')='<pv.id>'`.
- **Fixos ainda não conferidos:** `etapa='qualificado' AND tel_tipo='fixo' AND envio IS NULL AND COALESCE(notas,'') NOT LIKE '%WhatsApp checado%'`.

## 4. Se faltar candidato, prospectar cidades novas
Use as cidades pendentes de `pv.prospeccao.cidades`, na ordem. Para cada uma:
`cd <PROJETO> && python3 bot.py --cidades "<Cidade>"`
- Rode em background e espere terminar. Leva uns 5 min por cidade, porque o bot dorme 15 s entre as buscas.
- No fim, o bot marca a cidade como feita no perfil. Não precisa mexer em arquivo.
- Pare quando a soma de prontos + fixos a conferir passar de `alvo × 3`, ou depois de **6 cidades** na mesma noite.
- Se acabarem as cidades pendentes, avise no relatório para o vendedor adicionar mais na tela **Perfis de venda**.
- Siga `pv.prospeccao.instrucoes`, se houver, ao escolher e revisar os leads novos.
- Sem chave do Google, a fonte é o OpenStreetMap, que traz poucos celulares. Por isso conta tanto conferir os fixos.

## 5. Conferir os fixos no WhatsApp Web (Claude in Chrome)
- Carregue as ferramentas `mcp__claude-in-chrome__*` com ToolSearch e chame `tabs_context_mcp {createIfEmpty:true}`.
- Navegue para `https://web.whatsapp.com/` e espere `#pane-side` aparecer. Se aparecer QR code (deslogado), pare esta etapa e avise no relatório.
- Antes de conferir os fixos, **detecte as respostas** seguindo `rotinas/respostas.md`.
- Para cada fixo, normalize o número: só dígitos, com 55 na frente → `55DDXXXXXXXX`. Depois rode:
  - `navigate` para `https://web.whatsapp.com/send?phone=<numero>` com `force:true`;
  - `computer wait 1.5`;
  - este `javascript_exec`:
    ```js
    let r='TIMEOUT';for(let k=0;k<50;k++){const t=document.body.innerText;if(/não está no WhatsApp|inválido/.test(t)){r='NAO';break}if(document.querySelector('#main footer div[contenteditable="true"]')){r='SIM';break}await new Promise(s=>setTimeout(s,400))}r
    ```
- Faça lotes de ~10 números por `browser_batch`.
- Se der "Leave site?", repita com `force:true`. Se a conexão cair, repita o lote: essa checagem só lê a página.
- **SIM:** `UPDATE leads SET tel_tipo='whatsapp' WHERE id=…`. A nota e a etapa são recalculadas no passo 6.
- **NAO:** acrescente às `notas`: `WhatsApp checado em DD/MM: número não tem WhatsApp.`
- **TIMEOUT:** não mexa no lead.

## 6. Revisar os candidatos antes de pôr na fila
Para cada lead pronto, do maior score para o menor:
- **Público, rede ou franquia:** se o nome indicar isso, descarte com motivo.
- **Site do lead:** se o lead tem `site`, baixe a página com `curl -sL -m 12` e procure o nome da cidade do lead ou o nome da empresa.
  - Se for claramente de outra empresa ou de outra cidade (ex.: "garagerj.com.br" para uma oficina de Rolândia), faça `UPDATE leads SET site=NULL`.
  - Anote a troca nas `notas`.
- **Instruções de qualificação:** se `pv.qualificacao.instrucoes` não estiver vazio, aplique-as a cada candidato. Abra o site ou o Instagram se precisar.
  - Quem não se encaixar: `POST /api/lead {"id":…, "etapa":"descartado", "motivo":"Perfil: <por quê, em uma frase>"}`.
  - O motivo começa com "Perfil:" para a requalificação automática não trazer o lead de volta.
- **Telefone duplicado:** se o mesmo telefone já foi contatado, não coloque na fila.
- Depois das mudanças dos passos 5 e 6, recalcule notas, etapas e mensagens com o perfil em uso:
  `cd <PROJETO> && python3 -c "import bot; print(bot.repontuar(bot.db(), bot.perfil_venda()))"`

## 7. Colocar na fila
- `POST http://127.0.0.1:8765/api/fila` com `{"ids":[...], "acao":"adicionar"}`.
  - Use até `alvo` ids, do maior score para o menor, só entre leads com `etapa='abordagem_pronta'`.
  - O painel congela a mensagem do perfil com a saudação da hora. A rotina das 10h troca a saudação na hora de enviar.
- **Instruções de contato:** se `pv.contato.instrucoes` não estiver vazio, ajuste a mensagem de cada lead que entrou na fila seguindo essas instruções.
  - Pegue o texto em `GET /api/fila`, campo `envio_msg`.
  - O 1º parágrafo (a saudação) fica igual, separado do resto por uma linha em branco.
  - Não invente fatos sobre a empresa: use só o que está no lead, no site dele ou no perfil.
  - Salve com `POST /api/fila {"ids":["<id>"], "acao":"editar", "mensagem":"<texto completo>"}`.

## 8. Relatório final (curto)
- Perfil de venda usado (`pv.nome`).
- Respostas detectadas (veja `rotinas/respostas.md`).
- Quantos ficaram na fila para amanhã (nome · cidade · nicho).
- Quantas cidades foram prospectadas, quantos leads novos entraram e quantos fixos foram conferidos (com e sem WhatsApp).
- O que foi descartado e por quê.
- Problemas: painel, WhatsApp deslogado, menos de 20 na fila e o motivo, cidades pendentes acabando.
