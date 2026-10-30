# Reengajamento: conferir o WhatsApp e montar a fila

Usado pela rotina das 20h (`qualificar.md`) e quando o vendedor pede no chat ("Monte a fila de reengajamento").
O botão **Atualizar** da tela Reengajamento faz o mesmo: o painel chama o Claude Code com o prompt `PROMPT_REENGAJAR` do `painel.py`, que segue estes passos e devolve JSON em vez de chamar a API. Mudou um, mude o outro.
Vale para os leads do dashboard em andamento (Respondeu, Protótipo, Proposta enviada, Negociando).
Responda e reporte em português do Brasil.

## Regras que nunca mudam
- **Só leitura.** Nunca digite nem envie nada ao conferir.
- **Conversa com mensagem não lida: não abra.** Abrir marca como lida no celular do vendedor. Use só a prévia da lista lateral (`#pane-side`). As outras conversas dos leads podem ser abertas para ler o histórico.
- **Montar a fila não envia nada.** Enviar só no passo 5, e só quando o vendedor pedir no chat.
- Conversa que não bate com nenhum lead é pessoal: ignore e não cite no relatório.

## 1. Quem conferir
`GET http://127.0.0.1:8765/api/reengajar` → `itens`. Cada item tem `whatsapp` (só dígitos), `nome`, `etapa`, `notas`, `prototipo`, `valor`, a última conversa registrada (`conversa_*`), a fila (`reeng`, `reeng_msg`) e:
- `parado`: dias desde a última mensagem (`null` se nunca conferido);
- `pronto`: pode entrar na fila (parado há `dias` ou mais, fora da fila, com tentativas sobrando e sem próximo passo marcado para depois de hoje);
- `sugestao`: o modelo do perfil para a próxima tentativa (só quando a última mensagem é do vendedor);
- `esgotado`: já recebeu as 3 tentativas sem responder.

## 2. Ler a lista do WhatsApp Web (Claude in Chrome)
- Carregue as ferramentas `mcp__claude-in-chrome__*` com ToolSearch, abra `https://web.whatsapp.com/` e espere `#pane-side`. Se aparecer QR code, pare e avise.
- Rode este `javascript_exec`. Ele rola a lista e devolve, para cada conversa, o título, o horário da última mensagem, a prévia, se a última mensagem é do vendedor (ícone de ✓), se foi lida (✓✓ azul) e se tem mensagem não lida (`nao_lida`):
  ```js
  const side=document.querySelector('#pane-side'),H=/^(\d{1,2}:\d{2}|ontem|(segunda|terça|quarta|quinta|sexta)-feira|sábado|domingo|\d{1,2}\/\d{1,2}\/\d{4})$/i,v=new Map();
  const ler=()=>document.querySelectorAll('#pane-side [role="listitem"], #pane-side [role="row"]').forEach(r=>{const ti=r.querySelector('[title]')?.getAttribute('title');if(!ti||v.has(ti))return;const l=r.innerText.split('\n').map(s=>s.trim()).filter(Boolean);const ic=[...r.querySelectorAll('svg title')].map(x=>x.textContent).join(' ');const t=[...r.querySelectorAll('[title]')].map(e=>e.getAttribute('title'));v.set(ti,{titulo:ti,quando:l.find(s=>H.test(s))||'',previa:(t[1]||'').replace(/[‪‬]/g,'').slice(0,300),de:/ic-(read|delivered|sent|check|pending|msg-time)/.test(ic)?'eu':'lead',lida:/ic-read/.test(ic),nao_lida:!!r.querySelector('[aria-label*="não lida"],[aria-label*="unread"]')})});
  side.scrollTop=0;await new Promise(s=>setTimeout(s,400));ler();for(let i=0;i<25&&side.scrollTop+side.clientHeight<side.scrollHeight-5;i++){side.scrollTop+=side.clientHeight*.8;await new Promise(s=>setTimeout(s,350));ler()}side.scrollTop=0;[...v.values()]
  ```
- Ligue cada lead a uma conversa:
  - pelo número: os **últimos 8 dígitos** do título têm que bater com os do `whatsapp` do lead. O WhatsApp às vezes mostra o celular sem o 9, como em "+55 43 9123-4567";
  - ou pelo nome do lead, sem acento e sem diferenciar maiúsculas.
- Lead sem conversa na lista: a conversa pode estar com o nome comercial dele. Se alguma conversa com não lida puder ser dele, não abra. Senão, abra pelo número como no passo 2b. Sem conversa nenhuma, não registre nada e diga no relatório.
- Se o ícone de ✓ sumir de todas as conversas, o WhatsApp mudou o HTML. Adapte o seletor, sempre só lendo a lista.

## 2b. Ler o histórico (só conversas sem não lida)
Para cada lead ligado a uma conversa **sem** mensagem não lida, `navigate` para `https://web.whatsapp.com/send?phone=<whatsapp>` (sem `text`) e rode:
```js
for(let k=0;k<40&&!document.querySelector('#main');k++)await new Promise(s=>setTimeout(s,500));await new Promise(s=>setTimeout(s,2500));
[...document.querySelectorAll('#main [role="row"]')].slice(-30).map(r=>{const t=r.innerText.trim().replace(/\n+/g,' ').slice(0,400);if(!r.querySelector('[data-testid="msg-container"]'))return '-- '+t+' --';const ic=[...r.querySelectorAll('svg title')].map(x=>x.textContent).join(' '),pre=r.querySelector('[data-pre-plain-text]')?.getAttribute('data-pre-plain-text')||'';return (/ic-(read|delivered|sent|check|pending|msg-time)|tail-out/.test(ic)?'eu':'lead')+' '+(pre.match(/\[[^\]]+\]/)?.[0]||'')+' '+t}).join('\n')
```
Cada linha traz quem falou ("eu" é o vendedor: a linha tem o ✓ de entregue ou lida), a data e o texto. Linhas "-- ... --" são separadores de data. "lead 0:18 1,0× 14:38" é um áudio: não suponha o conteúdo. Histórico vazio logo depois de conectar o WhatsApp é sincronização: espere e leia de novo. Use o histórico para saber em que pé está a conversa (proposta com preço, protótipo, pergunta sem resposta) e a data exata da última mensagem.

## 3. Registrar o que viu
`POST /api/conversas {"itens":[{"id":"<id do lead>","quando":"<horário como aparece na lista>","de":"eu"|"lead","lida":true|false,"previa":"<prévia>"}]}`
- `quando` vai como a lista mostra ("14:32", "Ontem", "terça-feira") ou como data ("28/10/2026"). O painel converte para data.
- Se o lead falou depois do último reengajamento, o painel tira ele da fila e recomeça a contagem de tentativas.
- A resposta é a mesma lista do passo 1, já atualizada.

## 4. Montar a fila com a mensagem sugerida
Para cada item com `pronto: true`, escreva uma mensagem curta, na voz do vendedor, que continue do ponto exato da conversa (o histórico do passo 2b; sem ele, a prévia):
- **A última mensagem é do vendedor** (`conversa_de: "eu"`): parta da `sugestao` do perfil e ajuste ao que foi mandado por último (`conversa_previa`). Por exemplo: a proposta com preço, o protótipo ou uma pergunta. Se ele visualizou (`conversa_lida`), não pergunte se ele viu: puxe a decisão com uma pergunta fácil de responder.
- **A última mensagem é do lead** (`conversa_de: "lead"`): o vendedor deixou o lead esperando. Escreva uma mensagem que retoma a conversa respondendo o que ele disse na prévia. Diga no relatório que a vez era do vendedor.
- Siga `contato.instrucoes` do perfil do lead (`GET /api/perfis`).
- **Não invente:** nada de preço, prazo, desconto ou promessa que não esteja na conversa, nas notas ou no perfil.
- Não use "Bom dia", "Boa tarde" ou "Boa noite", porque a mensagem pode sair em outro horário. Use "Oi, tudo bem?" ou comece pelo assunto.
- Salve: `POST /api/reengajar {"ids":["<id>"], "acao":"adicionar", "mensagem":"<texto>"}`. Sem `mensagem`, o painel usa a `sugestao` do perfil.
- `esgotado: true` com `parado` alto: não entra na fila. Sugira no relatório mover para Perdido.

## 5. Enviar a fila (só quando o vendedor pedir no chat)
- Mostre a lista (nome e mensagem) e espere a confirmação do vendedor no chat.
- Para cada item com `reeng: "fila"`, use o envio de mensagem única do `disparar.md` (passo 3b), com:
  - o texto de `reeng_msg`;
  - `MARCA` = os primeiros 30 caracteres da mensagem. Se der `JA_ENVIADO`, não envie de novo.
- Depois de confirmar o envio: `POST /api/reengajar/resultado {"id":..., "status":"enviado"}`. Se o número não estiver no WhatsApp, use `"status":"falhou"` com `"erro"`.

## 6. Relatório
- Leads conferidos: nome, última mensagem (de quem e quando) e se visualizou.
- Quem entrou na fila, com a mensagem sugerida.
- Leads em que a vez era do vendedor, leads esgotados e leads sem conversa encontrada.
