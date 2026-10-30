# Detectar respostas de leads no WhatsApp Web

Usado pelas rotinas das 10h (`disparar.md`) e das 20h (`qualificar.md`), com o WhatsApp Web já aberto e `#pane-side` visível.
Responda e reporte em português do Brasil.

## Regras que nunca mudam
- **Só leitura.** Nunca abra uma conversa: isso a marca como lida no celular do vendedor. Use só a lista lateral.
- **Nunca responda** ninguém. Quem responde os leads é o vendedor.
- Conversa que não bate com nenhum lead é pessoal: ignore e não cite no relatório.

## 1. Ler as conversas não lidas da lista lateral
```js
[...document.querySelectorAll('#pane-side [role="listitem"], #pane-side [role="row"]')].map(r=>{const t=r.innerText.split('\n').map(s=>s.trim()).filter(Boolean);const nl=r.querySelector('[aria-label*="não lida"],[aria-label*="unread"]');return nl?{titulo:t[0],previa:t.slice(1).filter(x=>!/^\d{1,2}:\d{2}$|^\d+$|^(ontem|hoje)$/i.test(x)).join(' | ')}:null}).filter(Boolean)
```
- Se vier vazio, mas aparecerem bolinhas verdes de não lidas na tela, o WhatsApp mudou o HTML. Adapte o seletor, sempre só lendo a lista.
- Role a lista (`#pane-side`) para baixo se houver mais conversas não lidas fora da tela.

## 2. Ligar cada conversa a um lead
- Leads já contatados: `GET http://127.0.0.1:8765/api/fila`, itens com `envio=='enviado'`. O campo `whatsapp` tem só os dígitos do número.
- O título da conversa é o número (ex.: "+55 43 99970-0112") ou o nome que a empresa usa no WhatsApp.
  - Se for número, compare os últimos 8 dígitos com os do `whatsapp` de cada lead.
  - Se for nome, compare com o `nome` do lead, sem acento e sem diferenciar maiúsculas.
- Sem correspondência clara, ignore a conversa.

## 3. Classificar a prévia
- **automatica:** menu de robô, "Olá! Obrigado por entrar em contato", horário de atendimento, "digite 1", mensagem de ausência.
- **recusa:** "não tenho interesse", "não, obrigado", "já tenho site", "não preciso" ou pedido para não mandar mais mensagens.
- **interesse:** qualquer outra resposta de uma pessoa, como "sim", "pode", "quanto custa?", "me manda" ou uma pergunta.
- Na dúvida entre interesse e recusa, use **interesse**. O vendedor decide depois.

## 4. Registrar
`POST http://127.0.0.1:8765/api/resposta {"id":"<id do lead>", "tipo":"interesse"|"recusa"|"automatica", "texto":"<prévia>"}`
- **interesse:** o lead vai para Respondeu e entra no dashboard.
- **recusa:** o lead vai para Perdido, com o motivo "Sem interesse".
- **automatica:** o painel só anota. O lead continua esperando resposta.
- Cada resposta fica anotada nas notas do lead. A mesma prévia registrada duas vezes é ignorada.

## 5. No relatório
- **Interessados:** nome e prévia. Lembre o vendedor de responder.
- **Recusas e respostas automáticas:** só os nomes.
