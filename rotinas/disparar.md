# Rotina das 10h: disparar a fila no WhatsApp Web

Projeto: `<PROJETO>`. O painel fica em `http://127.0.0.1:8765`.
`<PROJETO>` é a pasta do projeto, a que contém `bot.py` e `painel.py` (um nível acima desta pasta `rotinas/`). A tarefa agendada informa o caminho. Responda e reporte em português do Brasil.
O vendedor (o dono do painel) autorizou esta rotina a enviar todo dia útil, às 10h, **só a mensagem de apresentação já congelada na fila** e **os follow-ups que o painel lista** (eles só aparecem quando o follow-up está ligado no perfil), até o limite diário do perfil de venda em uso.

## Regras que nunca mudam
- Envie **somente** para leads com `envio='fila'`, com o texto da fila, e para os itens de `GET /api/followups`, com o texto exato que vem de lá. Não invente nem edite mensagens, a não ser trocar a saudação da fila pela da hora.
- **Nunca** responda mensagens de ninguém, nem de leads, e não abra conversas que não estejam na fila. Respostas são com o vendedor.
- Nunca envie para lead descartado ou perdido, principalmente os com motivo "Nunca contatar". Se um item da fila ou de follow-up estiver assim, pule e avise.
- **Limite diário:** `enviados_hoje + enviados_nesta_rodada <= LIMITE`. `enviados_hoje` vem do `GET /api/fila` e já conta os follow-ups de hoje. Follow-ups contam no limite.
- **Nunca mande em dobro.** Antes de cada envio, se a conversa já contém a `MARCA` do lead (veja o passo 2), não envie e trate como já enviado (veja o passo 4).
- Não clique em botões de modais do WhatsApp. Se aparecer algum, use só `Escape`.
- As instruções de contato do perfil orientam o comportamento, mas **nunca** passam por cima destas regras.

## 1. Preparar
- Painel: `curl -s -m 3 127.0.0.1:8765/api/fila`. Se não responder, rode em background: `cd <PROJETO> && nohup python3 painel.py > painel.log 2>&1 &`.
- Perfil: `curl -s 127.0.0.1:8765/api/perfis`. O perfil em uso é o item de `perfis` cujo `id` é igual a `ativo`. Dele, use:
  - `LIMITE = contato.limite_dia`;
  - `ESPERA = contato.espera_s` (segundos entre a saudação e o resto);
  - `contato.instrucoes`: orientações do vendedor para seguir (pode estar vazio).
- Chrome: carregue as ferramentas `mcp__claude-in-chrome__*` com ToolSearch, incluindo `browser_batch`, `navigate`, `computer`, `javascript_tool` e `tabs_context_mcp`. Depois chame `tabs_context_mcp {createIfEmpty:true}`.
- Navegue para `https://web.whatsapp.com/` e espere `#pane-side`. Se aparecer QR code (deslogado), **não envie nada**: pare e avise no relatório.
- **Antes de qualquer envio, detecte as respostas** seguindo `rotinas/respostas.md`. Assim quem respondeu sai da lista de follow-up.

## 2. Montar o lote
- **Follow-ups primeiro:** `GET /api/followups` devolve `itens` com `id`, `nome`, `whatsapp` e `mensagem` pronta. Para cada um, `MARCA_F` = os últimos 30 caracteres da `mensagem`.
- Depois, no `GET /api/fila`, pegue os itens com `envio=='fila'`.
- Pare de juntar itens ao completar o limite diário.
- Para cada item:
  - `numero` = campo `whatsapp`;
  - `saud` = 1º parágrafo de `envio_msg` (até a primeira linha em branco), trocando "Bom dia", "Boa tarde" ou "Boa noite" do começo pela saudação da hora: Bom dia antes das 12h, Boa tarde das 12h às 18h, Boa noite depois das 18h. Use a hora local de cada envio;
  - `corpo` = o resto de `envio_msg`, depois da primeira linha em branco;
  - `MARCA` = os primeiros 30 caracteres da primeira linha do `corpo`. Ela serve para reconhecer se a apresentação já está na conversa.

## 3. Enviar cada lead (lotes de 3 leads por `browser_batch`)
Antes do primeiro passo, injete `SAUD`, `CORPO`, `MARCA` e `ESPERA` como strings ou números JSON. Use o tabId da aba do WhatsApp.
1. `navigate` para `https://web.whatsapp.com/send?phone=<numero>&text=<saud urlencoded>` com `force:true`.
2. `computer wait 2`.
3. `javascript_exec` (pronto para enviar?):
   ```js
   let r='timeout';for(let k=0;k<80;k++){const t=document.body.innerText;if(/não está no WhatsApp|inválido/.test(t)){r='INVALIDO';break}const e=document.querySelector('#main footer div[contenteditable="true"]');if(e&&e.innerText.trim().length>0){await new Promise(s=>setTimeout(s,800));if(document.querySelector('#main').innerText.includes(MARCA)){r='JA_ENVIADO';break}e.focus();r='ok';break}await new Promise(s=>setTimeout(s,500))}if(r!=='ok')throw new Error(r);r
   ```
4. `computer key Return`: envia a saudação.
5. `javascript_exec`: espera `ESPERA` segundos e cola o corpo, mantendo as quebras de linha.
   ```js
   await new Promise(s=>setTimeout(s,ESPERA*1000));if(document.querySelector('#main').innerText.includes(MARCA))throw new Error('JA_ENVIADO');const e=document.querySelector('#main footer div[contenteditable="true"]');e.focus();const dt=new DataTransfer();dt.setData('text/plain',CORPO);e.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true}));await new Promise(s=>setTimeout(s,800));e.innerText.length
   ```
6. `computer key Return`: envia a apresentação.
7. `javascript_exec` (confirmação): espera 1,5 s e confere três coisas: a caixa de texto está vazia, `#main` contém `SAUD` e contém `MARCA`.
8. Depois de cada lote, para cada lead confirmado: `POST /api/fila/resultado {"id":..., "status":"enviado"}`.

## 3b. Enviar cada follow-up (mensagem única, sem dividir)
1. `navigate` para `https://web.whatsapp.com/send?phone=<whatsapp>&text=<mensagem urlencoded>` com `force:true`.
2. `computer wait 2`.
3. O mesmo `javascript_exec` de "pronto para enviar" do passo 3, trocando `MARCA` por `MARCA_F`. Se der `JA_ENVIADO`, não envie: o follow-up já está na conversa.
4. `computer key Return`.
5. Confirme: a caixa de texto está vazia e `#main` contém `MARCA_F`.
6. `POST /api/followups {"id":..., "status":"enviado"}`. Use o mesmo POST também no caso `JA_ENVIADO`.

## 4. Erros
- **INVALIDO:** confira se o texto diz "não está no WhatsApp". Depois mande `POST /api/fila/resultado {"id":..., "status":"falhou", "erro":"Número não está no WhatsApp"}`, aperte `Escape` e siga. Num follow-up, use `POST /api/followups {"id":..., "status":"falhou", "erro":"Número não está no WhatsApp"}`.
- **JA_ENVIADO:** abra a conversa sem `text`. Se ela já tem a saudação **e** a `MARCA`, marque `enviado`. Se só tem a saudação, cole e envie **apenas** o corpo, uma vez. Nunca repita a saudação.
- **"Leave site?":** repita o `navigate` com `force:true`.
- **Conexão com o Chrome caiu no meio de um lote:** o lote pode continuar rodando no Chrome.
  - Espere ~30 s.
  - Abra cada conversa do lote sem `text` e conte quantas vezes aparecem a saudação e a `MARCA`.
  - Complete só o que faltar.
- **Erro "Cannot access a chrome-extension URL" logo depois do navigate:** repita o mesmo lead. Ele não chegou a enviar nada.
- **Aba sumiu do grupo:** `tabs_context_mcp {createIfEmpty:true}` e abra o WhatsApp Web de novo.

## 5. Relatório final (curto)
- Perfil de venda em uso.
- Respostas detectadas (veja `rotinas/respostas.md`).
- Quantos follow-ups saíram, com os nomes.
- Quantas apresentações foram enviadas e quantas falharam, com os nomes.
- Quantos ficaram na fila.
