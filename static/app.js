// Painel de prospecção. Sem build, sem dependências: dados vêm da API do painel.py.

const ETAPA_NOME = {
  abordagem_pronta: "Pronto para abordar",
  qualificado: "Qualificado",
  contatado: "Contatado",
  respondeu: "Respondeu",
  prototipo: "Protótipo",
  proposta: "Proposta enviada",
  negociando: "Negociando",
  fechado: "Fechado",
  perdido: "Perdido",
  descartado: "Descartado",
};
const FORA_DO_FUNIL = ["descartado", "perdido"];
const TEMPS = [
  ["quente", "Quentes"],
  ["morno", "Mornos"],
  ["frio", "Frios"],
  ["", "Todos"],
];
const TEMP_NOME = { quente: "Quente", morno: "Morno", frio: "Frio" };
const COLUNAS = ["respondeu", "prototipo", "proposta", "negociando", "fechado"];  // dashboard; "perdido" aparece sob demanda
const PARA_QUADRO = ["contatado", ...COLUNAS];  // etapas em que aparece "Mandar para o dashboard"

const estado = {
  leads: [], etapas: [], motivos: [],
  temp: "quente", sel: null, view: "vazio",       // view: vazio | lead | run
  bot: null, perfil: {}, temKey: false,
  form: { cidades: [], nichos: [], fonte: "osm", loop: false },
  fila: { itens: [], enviados_hoje: 0 },
  marcados: new Set(), cf: { temp: "quente", nicho: "", cidade: "" },  // seleção da aba Contato automático
  pv: null, pvEdit: null, verPerdidos: false,  // perfis de venda (GET /api/perfis) · cópia em edição · dashboard
};
const $ = (s) => document.querySelector(s);
const pvAtivo = () => estado.pv?.perfis.find((p) => p.id === estado.pv.ativo);
const pvNome = (id) => estado.pv?.perfis.find((p) => p.id === id)?.nome || "Landing pages";
const variosPerfis = () => (estado.pv?.perfis.length || 0) > 1;
const limiteDia = () => pvAtivo()?.contato.limite_dia ?? 30;
const temInstrucoes = () => !!(pvAtivo()?.prospeccao.instrucoes.trim() || pvAtivo()?.qualificacao.instrucoes.trim());  // acima disso o WhatsApp tende a bloquear o número

// ---------- utilidades ----------
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const temperatura = (l) => l.temperatura;  // calculada no servidor (bot.QUENTE / bot.MORNO)
const TEL_TIPO = { whatsapp: "WhatsApp cadastrado", celular: "Celular · provável WhatsApp", fixo: "Fixo · sem WhatsApp" };
const nicho = (id) => estado.bot?.nichos.find((n) => n.id === id)?.rotulo || id.charAt(0).toUpperCase() + id.slice(1);
const urlSite = (s) => (!s ? "" : /^https?:\/\//i.test(s) ? s : "http://" + s);
const hostSite = (s) => s.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
const hoje = () => new Date().toLocaleDateString("sv");  // AAAA-MM-DD no fuso local
const diasDesde = (iso) => (iso ? Math.floor((Date.now() - new Date(iso)) / 864e5) : 0);
const dataCurta = (d) => d.slice(8, 10) + "/" + d.slice(5, 7);
// 1º valor em reais de um texto livre ("R$ 990 + R$ 80/mês" -> 990). ponytail: ignora mensalidade e moedas sem "R$"
const reais = (t) => { const m = (t || "").match(/R\$\s*([\d.]+(?:,\d{1,2})?)/); return m ? Number(m[1].replace(/\./g, "").replace(",", ".")) : 0; };
const brl = (n) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const duracao = (seg) => {
  const m = Math.round(seg / 60);
  return m < 1 ? "menos de 1 min" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};
function foneWhats(l) {
  let d = (l.telefone || "").replace(/\D/g, "");
  if (!d) return "";
  if (!d.startsWith("55")) d = "55" + d.replace(/^0+/, "");
  return d.length >= 12 ? d : "";
}

function toast(texto, icone = "check-circle") {
  const t = $("#toast");
  t.innerHTML = `<i class="ph-fill ph-${icone}"></i>${esc(texto)}`;
  t.classList.add("on");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove("on"), 2200);
}

const guardar = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

async function api(caminho, corpo) {
  const r = await fetch(caminho, corpo === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.erro || "Erro inesperado");
  return d;
}

// ---------- dados ----------
async function carregarLeads() {
  const d = await api("/api/leads");
  estado.leads = d.leads;
  estado.etapas = d.etapas;
  estado.motivos = d.motivos;
  preencherFiltros();
  renderLista();
}

async function salvarLead(l, mudancas) {
  await api("/api/lead", { id: l.id, etapa: l.etapa, notas: l.notas || "", motivo: l.motivo || "", ...mudancas });
  Object.assign(l, mudancas);
}

// ---------- sidebar ----------
function preencherFiltros() {
  const opcoes = (id, rotulo, valores, nomear = (v) => v) => {
    const el = $(id);
    const atual = el.value;
    el.innerHTML = `<option value="">${rotulo}</option>` +
      [...new Set(valores)].sort().map((v) => `<option value="${esc(v)}">${esc(nomear(v))}</option>`).join("");
    el.value = [...el.options].some((o) => o.value === atual) ? atual : "";
    el.parentElement.classList.toggle("ativo", !!el.value);
  };
  opcoes("#fNicho", "Nicho", estado.leads.map((l) => l.nicho), nicho);
  opcoes("#fCidade", "Cidade", estado.leads.map((l) => l.cidade));
  opcoes("#fEtapa", "Etapa", estado.leads.map((l) => l.etapa), (e) => ETAPA_NOME[e] || e);
}

function filtrados(ignorarTemp = false) {
  const q = $("#busca").value.trim().toLowerCase();
  const n = $("#fNicho").value, c = $("#fCidade").value, e = $("#fEtapa").value;
  return estado.leads.filter((l) =>
    (ignorarTemp || !estado.temp || temperatura(l) === estado.temp) &&
    (!n || l.nicho === n) && (!c || l.cidade === c) &&
    (e ? l.etapa === e : q || !FORA_DO_FUNIL.includes(l.etapa)) &&  // descartados e perdidos só no filtro de etapa ou na busca
    (!q || [l.nome, l.endereco, l.telefone, l.site].join(" ").toLowerCase().includes(q)));
}

function renderTabs() {
  const base = filtrados(true);
  const conta = { quente: 0, morno: 0, frio: 0, "": base.length };
  base.forEach((l) => conta[temperatura(l)]++);
  $("#tabs").innerHTML = TEMPS.map(([k, nome]) => `
    <button class="tab" role="tab" data-temp="${k}" aria-selected="${estado.temp === k}">
      ${k ? `<span class="dot ${k}"></span>` : ""}${nome}<span class="count">${conta[k]}</span>
    </button>`).join("");
}

function renderLista() {
  renderTabs();
  const lista = filtrados();
  $("#lista").innerHTML = lista.length
    ? lista.map((l) => `
      <li class="lead" role="option" data-id="${esc(l.id)}" aria-selected="${estado.view === "lead" && estado.sel === l.id}">
        <span class="nome">${esc(l.nome)}</span>
        <span class="meta">
          <span>${esc(nicho(l.nicho))} · ${esc(l.cidade)}</span>
          ${!["abordagem_pronta", "qualificado"].includes(l.etapa)
            ? `<span class="etapa-mini ${FORA_DO_FUNIL.includes(l.etapa) ? "fora" : ""}">${esc(ETAPA_NOME[l.etapa])}</span>` : ""}
        </span>
        <span class="score"><span class="dot ${temperatura(l)}"></span>${l.score}</span>
      </li>`).join("")
    : `<li class="vazio">${estado.leads.length ? "Nenhum lead com esses filtros" : "Nenhum lead ainda. Comece uma nova prospecção."}</li>`;
}

function renderStatusSidebar() {
  const b = estado.bot;
  const btn = $("#abrirRun");
  btn.classList.toggle("ativo", estado.view === "run");
  btn.classList.toggle("rodando", !!b?.rodando);
  $("#runStatus").textContent = !b ? "Defina cidades e nichos"
    : b.aguardando ? `Aguardando próxima rodada · ${b.novos} novos`
    : b.revisando ? `Claude revisando · ${b.novos} novos`
    : b.rodando ? `Buscando ${b.atual} de ${b.total} · ${b.novos} novos`
    : b.status === "concluido" ? `Concluída · ${b.novos} leads novos`
    : b.status === "parado" ? "Interrompida" : "Defina cidades e nichos";
  btn.querySelector(".run-ico i").className = b?.rodando && !b.aguardando ? "ph ph-circle-notch girando" : "ph ph-rocket-launch";

  const andamento = estado.leads.filter((l) => l.quadro_em && !["fechado", "perdido", "descartado"].includes(l.etapa)).length;
  $("#abrirQuadro").classList.toggle("ativo", estado.view === "quadro");
  const vencidos = estado.leads.filter((l) => l.quadro_em && !["fechado", "perdido", "descartado"].includes(l.etapa)
    && ((l.proximo_em && l.proximo_em <= hoje()) || l.reeng === "fila")).length;  // próximo passo vencido ou na fila de reengajamento
  $("#quadroStatus").textContent = !andamento ? "Leads que responderam"
    : `${andamento} em andamento` + (vencidos ? ` · ${vencidos} para hoje` : "");
  $("#abrirPerfis").classList.toggle("ativo", estado.view === "perfis");
  if (estado.pv) $("#perfilNome").textContent = pvAtivo()?.nome;

  const naFila = estado.fila.itens.filter((i) => i.envio === "fila").length;
  $("#abrirContato").classList.toggle("ativo", estado.view === "contato");
  $("#contatoStatus").textContent = naFila
    ? `${naFila} na fila · ${estado.fila.enviados_hoje} enviados hoje`
    : estado.fila.enviados_hoje ? `${estado.fila.enviados_hoje} enviados hoje` : "Monte a fila de envio";
}

// ---------- detalhe do lead ----------
function renderLead(l) {
  const t = temperatura(l);
  const fone = foneWhats(l);
  const a = l.argumento;
  const fora = FORA_DO_FUNIL.includes(l.etapa);
  const maps = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(`${l.nome} ${l.endereco || ""} ${l.cidade}`);
  const google = "https://www.google.com/search?q=" + encodeURIComponent(`${l.nome} ${l.cidade}`);
  const site = urlSite(l.site);

  $("#detalhe").innerHTML = `
  <div class="wrap">
    <button class="btn voltar" data-voltar><i class="ph ph-arrow-left"></i>Leads</button>

    <div class="head">
      <div>
        <div class="eyebrow">${esc(nicho(l.nicho))} · ${esc(l.cidade)}</div>
        <h1>${esc(l.nome)}</h1>
        <div class="chips">
          <span class="chip ${t}"><span class="dot ${t}"></span>${TEMP_NOME[t]} · ${l.score}</span>
          ${l.avaliacoes ? `<span class="chip"><i class="ph-fill ph-star"></i>${l.avaliacoes} avaliações</span>` : ""}
          <span class="chip"><i class="ph ph-database"></i>${l.fonte === "google" ? "Google Places" : "OpenStreetMap"}</span>
          ${variosPerfis() ? `<span class="chip"><i class="ph ph-briefcase"></i>${esc(pvNome(l.perfil_venda))}</span>` : ""}
          ${l.quadro_em ? `<button class="chip chip-btn" data-abrir-quadro title="Abrir o dashboard"><i class="ph ph-kanban"></i>No dashboard</button>` : ""}
          ${l.followup_em ? `<span class="chip"><i class="ph ph-arrow-bend-up-right"></i>Follow-up em ${dataCurta(l.followup_em)}</span>` : ""}
          ${l.reengajamentos ? `<span class="chip"><i class="ph ph-arrow-counter-clockwise"></i>Reengajado ${l.reengajamentos}x</span>` : ""}
        </div>
      </div>
      <div class="etapa-box">
        <label for="etapa">Etapa do funil</label>
        <div class="select"><select id="etapa">
          ${estado.etapas.map((e) => `<option value="${e}" ${e === l.etapa ? "selected" : ""}>${ETAPA_NOME[e] || e}</option>`).join("")}
        </select><i class="ph ph-caret-down"></i></div>
      </div>
    </div>

    ${fora ? `
    <section class="motivo" id="motivoBox">
      <div class="motivo-head"><i class="ph ph-prohibit"></i>
        <strong>Por que foi ${l.etapa === "perdido" ? "perdido" : "descartado"}</strong></div>
      <div class="motivo-chips">${estado.motivos.map((m) =>
        `<button class="pill ${l.motivo === m ? "on" : ""}" data-motivo="${esc(m)}">${esc(m)}</button>`).join("")}</div>
      <textarea id="motivo" rows="2" placeholder="Descreva o motivo">${esc(l.motivo || "")}</textarea>
      <div class="salvo" id="motivoSalvo"></div>
    </section>` : ""}

    <div class="actions">
      ${!l.quadro_em && PARA_QUADRO.includes(l.etapa) ? `<button class="btn" id="paraQuadro"><i class="ph ph-kanban"></i>Mandar para o dashboard</button>` : ""}
      <a class="btn primary" id="wa" target="_blank" rel="noopener" ${fone ? "" : 'aria-disabled="true"'}><i class="ph ph-whatsapp-logo"></i>Abrir no WhatsApp</a>
      <a class="btn" ${l.telefone ? `href="tel:${esc(l.telefone.replace(/[^\d+]/g, ""))}"` : 'aria-disabled="true"'}><i class="ph ph-phone"></i>Ligar</a>
      <a class="btn" href="${maps}" target="_blank" rel="noopener"><i class="ph ph-map-pin"></i>Google Maps</a>
      <a class="btn" href="${google}" target="_blank" rel="noopener"><i class="ph ph-google-logo"></i>Pesquisar</a>
      ${site ? `<a class="btn" href="${esc(site)}" target="_blank" rel="noopener"><i class="ph ph-arrow-square-out"></i>Abrir site</a>` : ""}
    </div>

    <div class="cols">
      <div>
        ${l.analise.length ? `
        <section class="section">
          <h2><i class="ph ph-chart-bar"></i>Por que essa nota</h2>
          <ul class="pontos">${l.analise.map((x) => `
            <li><span class="pts ${x.pontos ? "" : "zero"}">${x.pontos ? "+" + x.pontos : "·"}</span>${esc(x.texto)}</li>`).join("")}
            <li class="total"><span class="pts">${l.score}</span>Total · ${TEMP_NOME[temperatura(l)]}</li>
          </ul>
        </section>` : ""}

        <section class="section">
          <h2><i class="ph ph-stethoscope"></i>Diagnóstico</h2>
          ${a.problemas.length ? `<ul class="problemas">${a.problemas.map((p) => `
            <li class="problema"><span class="ico"><i class="ph ph-${esc(p.icone)}"></i></span>
              <div><strong>${esc(p.texto)}</strong><span>${esc(p.porque)}</span></div></li>`).join("")}</ul>`
            : `<p class="ok-site">Nenhum problema técnico encontrado no site.</p>`}
        </section>

        ${a.dor ? `
        <section class="section">
          <h2><i class="ph ph-lightbulb"></i>Como negociar</h2>
          <p class="dor">${esc(a.dor)}</p>
          ${a.pitch ? `<p class="pitch">${esc(a.pitch)}</p>` : ""}
        </section>` : ""}

        <section class="section">
          <h2><i class="ph ph-chat-text"></i>Mensagem de abordagem</h2>
          ${estado.perfil.nome ? "" : `
          <div class="aviso"><i class="ph ph-info"></i>
            <span>Preencha seu nome no perfil para a mensagem sair assinada.</span>
            <button class="link" data-abrir-run>Abrir perfil</button></div>`}
          <div class="msg">
            <textarea id="msg" spellcheck="true">${esc(l.mensagem)}</textarea>
            <div class="msg-foot">
              <span class="info" id="chars"></span>
              <button class="btn" id="copiar"><i class="ph ph-copy"></i>Copiar</button>
            </div>
          </div>
        </section>
      </div>

      <div>
        <section class="section">
          <h2><i class="ph ph-storefront"></i>Contato</h2>
          <div class="card"><dl class="dl">
            <div><i class="ph ph-phone"></i><dt>Telefone</dt><dd>${l.telefone ? `${esc(l.telefone)}${l.tel_tipo ? `<span class="tel-tipo ${l.contatavel ? "ok" : ""}">${TEL_TIPO[l.tel_tipo]}</span>` : ""}` : '<span class="nada">Não informado</span>'}</dd></div>
            <div><i class="ph ph-map-pin"></i><dt>Endereço</dt><dd>${l.endereco ? esc(l.endereco) : '<span class="nada">Não informado</span>'}</dd></div>
            <div><i class="ph ph-globe"></i><dt>Site atual</dt><dd>${site ? `<a href="${esc(site)}" target="_blank" rel="noopener">${esc(hostSite(l.site))}</a>` : '<span class="nada">Não tem</span>'}</dd></div>
          </dl></div>
        </section>

        ${l.quadro_em ? `
        <section class="section">
          <h2><i class="ph ph-kanban"></i>Acompanhamento
            <span class="h2-acoes"><button class="link" id="tirarQuadro">Tirar do dashboard</button></span></h2>
          <div class="card">
            <label class="campo"><span>Link do protótipo</span><input id="prototipo" value="${esc(l.prototipo || "")}" placeholder="Ex.: cliente.pages.dev" inputmode="url"></label>
            <label class="campo"><span>Valor proposto</span><input id="valor" value="${esc(l.valor || "")}" placeholder="Ex.: R$ 1.500 + R$ 80/mês"></label>
            <div class="prox-linha">
              <label class="campo"><span>Próximo passo</span><input id="proximo" value="${esc(l.proximo || "")}" placeholder="Ex.: mandar o preço"></label>
              <label class="campo"><span>Quando</span><input type="date" id="proximoEm" value="${esc(l.proximo_em || "")}"></label>
            </div>
            <div class="salvo" id="quadroSalvo"></div>
          </div>
        </section>

        ${(l.propostas || []).length ? `
        <section class="section">
          <h2><i class="ph ph-chats"></i>Mensagens de proposta</h2>
          <div class="propostas">${l.propostas.map((p, i) => `
            <details class="proposta" ${i === 0 ? "open" : ""}>
              <summary>${esc(p.titulo || `Mensagem ${i + 1}`)}</summary>
              <pre class="fila-msg" data-proposta="${i}"></pre>
              <div class="proposta-acoes">
                <button class="btn" data-copiar-proposta="${i}"><i class="ph ph-copy"></i>Copiar</button>
                <a class="btn primary" data-wa-proposta="${i}" target="_blank" rel="noopener" ${fone ? "" : 'aria-disabled="true"'}><i class="ph ph-whatsapp-logo"></i>Abrir no WhatsApp</a>
              </div>
            </details>`).join("")}
          </div>
          <p class="hint">Os textos ficam em Perfis de venda → Contato e disparo. Revise antes de enviar.</p>
        </section>` : ""}` : ""}

        ${l.proposta.length ? `
        <section class="section">
          <h2><i class="ph ph-layout"></i>O que propor na landing</h2>
          <ul class="check">${l.proposta.map((p) => `<li><i class="ph ph-check"></i>${esc(p)}</li>`).join("")}</ul>
        </section>` : ""}

        <section class="section notas">
          <h2><i class="ph ph-note-pencil"></i>Notas da negociação</h2>
          <textarea id="notas" placeholder="O que respondeu, valor combinado, próximo passo…">${esc(l.notas || "")}</textarea>
          <div class="salvo" id="salvo"></div>
        </section>
      </div>
    </div>
  </div>`;

  ligarLead(l, fone);
}

// salva o campo `campo` sozinho 700ms depois de parar de digitar
function autoSalvar(el, status, l, campo) {
  let timer;
  el.addEventListener("input", () => {
    status.innerHTML = '<i class="ph ph-dots-three"></i>Editando…';
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        await salvarLead(l, { [campo]: el.value });
        status.innerHTML = '<i class="ph ph-check"></i>Salvo';
        if (campo === "motivo") document.querySelectorAll("[data-motivo]").forEach((b) => b.classList.toggle("on", b.dataset.motivo === el.value));
      } catch { status.innerHTML = '<i class="ph ph-warning-circle"></i>Erro ao salvar'; }
    }, 700);
  });
}

function ligarLead(l, fone) {
  const msg = $("#msg"), wa = $("#wa");
  const atualizar = () => {
    if (fone) wa.href = `https://wa.me/${fone}?text=${encodeURIComponent(msg.value)}`;
    $("#chars").textContent = `${msg.value.length} caracteres`;
  };
  atualizar();
  msg.addEventListener("input", atualizar);

  wa.addEventListener("click", async () => {
    if (["abordagem_pronta", "qualificado"].includes(l.etapa)) {
      await salvarLead(l, { etapa: "contatado" });
      $("#etapa").value = "contatado";
      renderLista();
      toast("Marcado como contatado");
    }
  });

  $("#copiar").addEventListener("click", async () => {
    await navigator.clipboard.writeText(msg.value);
    toast("Mensagem copiada");
  });

  $("#etapa").addEventListener("change", async (e) => {
    const etapa = e.target.value;
    const saiu = FORA_DO_FUNIL.includes(etapa) !== FORA_DO_FUNIL.includes(l.etapa);
    try {
      await salvarLead(l, { etapa, motivo: FORA_DO_FUNIL.includes(etapa) ? l.motivo : "" });
      renderLista();
      if (saiu) {
        renderLead(l);  // mostra/esconde o bloco de motivo
        if (FORA_DO_FUNIL.includes(etapa)) { $("#motivoBox").scrollIntoView({ block: "nearest" }); $("#motivo").focus(); }
      }
      toast(FORA_DO_FUNIL.includes(etapa) ? "Informe o motivo" : `Etapa: ${ETAPA_NOME[etapa]}`, FORA_DO_FUNIL.includes(etapa) ? "info" : "check-circle");
    } catch { toast("Erro ao salvar", "warning-circle"); }
  });

  $("#paraQuadro")?.addEventListener("click", async () => {
    try {
      await salvarLead(l, { quadro: true, etapa: COLUNAS.includes(l.etapa) ? l.etapa : "respondeu" });
      await carregarLeads();
      selecionar(l.id);
      toast("Lead no dashboard", "kanban");
    } catch { toast("Erro ao salvar", "warning-circle"); }
  });
  $("#tirarQuadro")?.addEventListener("click", async () => {
    try {
      await salvarLead(l, { quadro: false });
      l.quadro_em = null;
      renderStatusSidebar();
      renderLead(l);
      toast("Tirado do dashboard");
    } catch { toast("Erro ao salvar", "warning-circle"); }
  });
  if ($("#prototipo")) {
    autoSalvar($("#prototipo"), $("#quadroSalvo"), l, "prototipo");
    autoSalvar($("#valor"), $("#quadroSalvo"), l, "valor");
    autoSalvar($("#proximo"), $("#quadroSalvo"), l, "proximo");
    $("#proximoEm").addEventListener("change", async (e) => {
      try { await salvarLead(l, { proximo_em: e.target.value }); $("#quadroSalvo").innerHTML = '<i class="ph ph-check"></i>Salvo'; renderStatusSidebar(); }
      catch (err) { toast(err.message, "warning-circle"); }
    });
    // {prototipo} e {preco} acompanham o que você digita acima
    const textoProposta = (i) => l.propostas[i].texto
      .replaceAll("{prototipo}", $("#prototipo").value.trim() || "[link do protótipo]")
      .replaceAll("{preco}", $("#valor").value.trim() || "[valor]");
    const atualizarPropostas = () => document.querySelectorAll("[data-proposta]").forEach((pre) => {
      const i = +pre.dataset.proposta;
      pre.textContent = textoProposta(i);
      if (fone) document.querySelector(`[data-wa-proposta="${i}"]`).href = `https://wa.me/${fone}?text=${encodeURIComponent(textoProposta(i))}`;
    });
    atualizarPropostas();
    ["#prototipo", "#valor"].forEach((s) => $(s).addEventListener("input", atualizarPropostas));
    document.querySelectorAll("[data-copiar-proposta]").forEach((b) => b.addEventListener("click", async () => {
      await navigator.clipboard.writeText(textoProposta(+b.dataset.copiarProposta));
      toast("Mensagem copiada");
    }));
  }
  autoSalvar($("#notas"), $("#salvo"), l, "notas");
  if ($("#motivo")) {
    autoSalvar($("#motivo"), $("#motivoSalvo"), l, "motivo");
    document.querySelectorAll("[data-motivo]").forEach((b) => b.addEventListener("click", async () => {
      $("#motivo").value = b.dataset.motivo;
      await salvarLead(l, { motivo: b.dataset.motivo });
      document.querySelectorAll("[data-motivo]").forEach((x) => x.classList.toggle("on", x === b));
      $("#motivoSalvo").innerHTML = '<i class="ph ph-check"></i>Salvo';
    }));
  }
}

function selecionar(id) {
  const l = estado.leads.find((x) => x.id === id);
  if (!l) return;
  estado.sel = id;
  estado.view = "lead";
  document.querySelectorAll(".lead").forEach((el) => el.setAttribute("aria-selected", el.dataset.id === id));
  document.querySelector(`.lead[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
  $(".app").classList.add("aberto");
  renderStatusSidebar();
  renderLead(l);
  $("#detalhe").scrollTop = 0;
}

// ---------- prospecção ----------
function estimativa() {
  const buscas = estado.form.cidades.length * estado.form.nichos.length;
  const porBusca = estado.form.fonte === "google" ? 40 : 90;  // segundos, inclui checar os sites e a pausa entre buscas
  return { buscas, tempo: buscas * porBusca };
}

function renderRun() {
  const f = estado.form, b = estado.bot, rodando = !!b?.rodando;
  const nichos = b?.nichos || [];
  const { buscas, tempo } = estimativa();
  $("#detalhe").innerHTML = `
  <div class="wrap">
    <button class="btn voltar" data-voltar><i class="ph ph-arrow-left"></i>Leads</button>
    <div class="head">
      <div>
        <div class="eyebrow">Prospecção · ${esc(pvAtivo()?.nome || "")}</div>
        <h1>Nova prospecção</h1>
        <p class="lead-txt">Escolha onde e em quais nichos procurar. O bot encontra os negócios, analisa o site de cada um e prepara a abordagem.</p>
      </div>
    </div>

    <div id="progresso"></div>

    <div class="cols">
      <div>
        <fieldset class="form" ${rodando ? "disabled" : ""}>
          <section class="section">
            <h2><i class="ph ph-map-trifold"></i>Cidades</h2>
            <div class="tags" id="tags">
              ${f.cidades.map((c, i) => `<span class="tag">${esc(c)}<button type="button" data-rm="${i}" aria-label="Remover ${esc(c)}"><i class="ph ph-x"></i></button></span>`).join("")}
              <input id="cidadeIn" placeholder="${f.cidades.length ? "Adicionar cidade" : "Ex.: Campinas"}" autocomplete="off">
            </div>
            <p class="hint">Pressione Enter para adicionar. Use o nome oficial do município.</p>
          </section>

          <section class="section">
            <h2><i class="ph ph-storefront"></i>Nichos
              <span class="h2-acoes"><button type="button" class="link" id="todos">Todos</button><button type="button" class="link" id="nenhum">Limpar</button></span></h2>
            <div class="nichos">${nichos.map((n) => `
              <button type="button" class="nicho ${f.nichos.includes(n.id) ? "on" : ""}" data-nicho="${n.id}" aria-pressed="${f.nichos.includes(n.id)}">
                <i class="ph ${f.nichos.includes(n.id) ? "ph-check-square" : "ph-square"}"></i>${esc(n.rotulo)}</button>`).join("")}
            </div>
          </section>

          <section class="section">
            <h2><i class="ph ph-database"></i>Fonte de dados</h2>
            <div class="fontes">
              <label class="fonte ${f.fonte === "osm" ? "on" : ""}"><input type="radio" name="fonte" value="osm" ${f.fonte === "osm" ? "checked" : ""}>
                <strong>OpenStreetMap</strong><span>Gratuito, sem configuração. Cobertura menor no Brasil.</span></label>
              <label class="fonte ${f.fonte === "google" ? "on" : ""}"><input type="radio" name="fonte" value="google" ${f.fonte === "google" ? "checked" : ""}>
                <strong>Google Places</strong><span>Muito mais negócios e avaliações. Requer chave de API.</span></label>
            </div>
            ${f.fonte === "google" ? `
            <div class="chave">
              <label class="campo"><span><i class="ph ph-key"></i>Chave do Google Places</span>
                <input type="password" id="chave" placeholder="${estado.temKey ? "Chave salva · cole outra para trocar" : "Cole sua chave aqui"}" autocomplete="off"></label>
              <button type="button" class="btn" id="salvarChave">Salvar chave</button>
            </div>` : ""}
          </section>

          <section class="section">
            <label class="switch">
              <input type="checkbox" id="loop" ${f.loop ? "checked" : ""}><span class="trilho"></span>
              <span><strong>Repetir a cada ${b?.intervalo_horas ?? 2} horas</strong><small>Ideal para deixar rodando durante a noite. Só leads novos são adicionados.</small></span>
            </label>
          </section>

          <div class="iniciar">
            <div class="resumo">${buscas ? `<strong>${buscas} ${buscas === 1 ? "busca" : "buscas"}</strong><span>Tempo estimado: ${duracao(tempo)}</span>`
              : `<span>Adicione ao menos uma cidade e um nicho</span>`}
              ${buscas && temInstrucoes() ? `<span class="resumo-claude"><i class="ph ph-sparkle"></i>No fim, o Claude revisa os leads novos com as instruções do perfil</span>` : ""}</div>
            <button type="button" class="btn accent grande" id="iniciar" ${buscas ? "" : "disabled"}><i class="ph ph-play"></i>Iniciar prospecção</button>
          </div>
        </fieldset>
      </div>

      <div>
        <section class="section">
          <h2><i class="ph ph-user-circle"></i>Seus dados</h2>
          <div class="card perfil">
            <p class="hint">Usado na apresentação e na assinatura das mensagens.</p>
            <label class="campo"><span>Nome</span><input id="pNome" value="${esc(estado.perfil.nome || "")}" placeholder="Seu nome"></label>
            <label class="campo"><span>Como você se apresenta</span><input id="pFuncao" value="${esc(estado.perfil.funcao || "")}" placeholder="desenvolvedor web"></label>
            <label class="campo"><span>Portfólio ou site</span><input id="pPortfolio" value="${esc(estado.perfil.portfolio || "")}" placeholder="seusite.com.br"></label>
            <div class="salvo" id="perfilSalvo"></div>
          </div>
        </section>
      </div>
    </div>
  </div>`;
  renderProgresso();
  ligarRun();
}

function renderProgresso() {
  const el = $("#progresso"), b = estado.bot;
  if (!el) return;
  if (!b || b.status === "ocioso") { el.innerHTML = ""; return; }
  const pct = b.total ? Math.round(((b.rodando && !b.aguardando ? b.atual - 1 : b.atual) / b.total) * 100) : 0;
  const decorrido = b.inicio ? duracao(Date.now() / 1000 - b.inicio) : "";
  const titulo = b.aguardando ? `Rodada concluída · próxima em até ${b.intervalo_horas} h`
    : b.revisando ? "Revisando com o Claude"
    : b.rodando ? `Buscando ${b.atual} de ${b.total}`
    : b.status === "concluido" ? "Prospecção concluída" : "Prospecção interrompida";
  const icone = b.rodando && !b.aguardando ? "ph-circle-notch girando" : b.aguardando ? "ph-clock" : b.status === "concluido" ? "ph-check-circle" : "ph-pause";
  const aberto = el.querySelector("details")?.open;
  el.innerHTML = `
  <div class="progresso ${b.rodando ? "rodando" : b.status}">
    <div class="prog-head">
      <i class="ph ${icone}"></i>
      <div class="prog-txt"><strong>${titulo}</strong><span>${b.rodando && !b.aguardando ? esc(b.etapa) : esc((b.params?.cidades || []).join(", "))}</span></div>
      ${b.rodando ? `<button class="btn" id="parar"><i class="ph ph-stop"></i>Parar</button>`
        : `<button class="btn" id="verLeads"><i class="ph ph-list-bullets"></i>Ver leads</button>`}
    </div>
    <div class="barra"><span style="width:${b.rodando ? pct : 100}%"></span></div>
    <div class="prog-stats">
      <span><strong>${b.novos}</strong> leads novos</span>
      <span><strong>${decorrido}</strong> decorrido</span>
      ${b.avisos ? `<span class="aviso-txt"><i class="ph ph-warning"></i>${b.avisos} ${b.avisos === 1 ? "nova tentativa" : "novas tentativas"} de conexão</span>` : ""}
    </div>
    <details ${aberto ? "open" : ""}><summary><i class="ph ph-terminal-window"></i>Log de execução</summary>
      <pre>${esc(b.log.join("\n")) || "Iniciando…"}</pre></details>
  </div>`;
  const pre = el.querySelector("pre");
  if (pre) pre.scrollTop = pre.scrollHeight;
  $("#parar")?.addEventListener("click", async () => {
    estado.bot = await api("/api/bot/parar", {});
    toast("Prospecção interrompida", "pause");
    atualizarBotUI(true);
  });
  $("#verLeads")?.addEventListener("click", () => { estado.temp = "quente"; renderLista(); $(".app").classList.remove("aberto"); });
}

function guardarForm() { guardar.set("form", JSON.stringify(estado.form)); }

function ligarRun() {
  const f = estado.form;
  const adicionar = (txt) => {
    txt.split(",").map((c) => c.trim()).filter(Boolean).forEach((c) => {
      if (!f.cidades.some((x) => x.toLowerCase() === c.toLowerCase())) f.cidades.push(c);
    });
    guardarForm();
    renderRun();
    $("#cidadeIn").focus();
  };
  const input = $("#cidadeIn");
  input.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === ",") && input.value.trim()) { e.preventDefault(); adicionar(input.value); }
    if (e.key === "Backspace" && !input.value && f.cidades.length) { f.cidades.pop(); guardarForm(); renderRun(); $("#cidadeIn").focus(); }
  });
  // adia o redesenho para não engolir um clique em "Iniciar" logo após digitar
  input.addEventListener("blur", () => setTimeout(() => { if (input.isConnected && input.value.trim()) adicionar(input.value); }, 200));
  $("#tags").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rm]");
    if (rm) { f.cidades.splice(+rm.dataset.rm, 1); guardarForm(); renderRun(); }
    else if (e.target === $("#tags")) input.focus();
  });

  document.querySelectorAll("[data-nicho]").forEach((b) => b.addEventListener("click", () => {
    const id = b.dataset.nicho;
    f.nichos = f.nichos.includes(id) ? f.nichos.filter((x) => x !== id) : [...f.nichos, id];
    guardarForm(); renderRun();
  }));
  $("#todos").addEventListener("click", () => { f.nichos = estado.bot.nichos.map((n) => n.id); guardarForm(); renderRun(); });
  $("#nenhum").addEventListener("click", () => { f.nichos = []; guardarForm(); renderRun(); });

  document.querySelectorAll('[name="fonte"]').forEach((r) => r.addEventListener("change", () => { f.fonte = r.value; guardarForm(); renderRun(); }));
  $("#loop").addEventListener("change", (e) => { f.loop = e.target.checked; guardarForm(); });

  $("#salvarChave")?.addEventListener("click", async () => {
    const v = $("#chave").value.trim();
    if (!v) return toast("Cole a chave antes de salvar", "warning-circle");
    await api("/api/config", { google_key: v });
    estado.temKey = true;
    toast("Chave salva neste computador");
    renderRun();
  });

  $("#iniciar").addEventListener("click", async () => {
    const pendente = $("#cidadeIn").value.trim();
    if (pendente) { $("#cidadeIn").value = ""; pendente.split(",").map((c) => c.trim()).filter(Boolean).forEach((c) => f.cidades.push(c)); guardarForm(); }
    try {
      estado.bot = await api("/api/bot/iniciar", f);
      toast("Prospecção iniciada", "rocket-launch");
      atualizarBotUI(true);
    } catch (e) { toast(e.message, "warning-circle"); }
  });

  // perfil salva sozinho
  let timer;
  ["#pNome", "#pFuncao", "#pPortfolio"].forEach((s) => $(s).addEventListener("input", () => {
    $("#perfilSalvo").innerHTML = '<i class="ph ph-dots-three"></i>Editando…';
    clearTimeout(timer);
    timer = setTimeout(async () => {
      estado.perfil = { nome: $("#pNome").value.trim(), funcao: $("#pFuncao").value.trim(), portfolio: $("#pPortfolio").value.trim() };
      try {
        await api("/api/config", { perfil: estado.perfil });
        $("#perfilSalvo").innerHTML = '<i class="ph ph-check"></i>Salvo · as mensagens já usam seu perfil';
        carregarLeads();
      } catch { $("#perfilSalvo").innerHTML = '<i class="ph ph-warning-circle"></i>Erro ao salvar'; }
    }, 700);
  }));
}

function abrirRun() {
  estado.view = "run";
  $(".app").classList.add("aberto");
  document.querySelectorAll(".lead").forEach((el) => el.setAttribute("aria-selected", "false"));
  renderStatusSidebar();
  renderRun();
  $("#detalhe").scrollTop = 0;
}

// atualiza sidebar e a tela de prospecção; `forcar` redesenha o formulário (ex.: travar/destravar)
let estavaRodando = false;
function atualizarBotUI(forcar = false) {
  const rodando = !!estado.bot?.rodando;
  renderStatusSidebar();
  if (estado.view === "run") {
    if (forcar || rodando !== estavaRodando) renderRun();
    else renderProgresso();
  }
  if (estavaRodando && !rodando) carregarLeads();
  estavaRodando = rodando;
}

async function pollBot() {
  try {
    estado.bot = await api("/api/bot");
    atualizarBotUI();
    const antes = JSON.stringify(estado.fila);
    await carregarFila();
    if (estado.view === "contato" && JSON.stringify(estado.fila) !== antes && !document.activeElement.matches("select")) {
      await carregarLeads();
      const y = $("#detalhe").scrollTop;
      renderContato();
      $("#detalhe").scrollTop = y;
    }
  } catch {}
  setTimeout(pollBot, estado.bot?.rodando || estado.view === "contato" ? 3000 : 10000);
}

// ---------- contato automático ----------
// só quem dá para chamar no WhatsApp (celular ou WhatsApp cadastrado) e ainda não foi abordado
const elegivel = (l) => l.contatavel && l.etapa === "abordagem_pronta" && !l.envio;

function candidatos() {
  const { temp, nicho: n, cidade: c } = estado.cf;
  return estado.leads.filter((l) => elegivel(l) && (!temp || temperatura(l) === temp) && (!n || l.nicho === n) && (!c || l.cidade === c));
}

async function carregarFila() {
  estado.fila = await api("/api/fila");
  renderStatusSidebar();
}

function renderContato() {
  const fila = estado.fila.itens.filter((i) => i.envio === "fila");
  const historico = estado.fila.itens.filter((i) => i.envio !== "fila").slice(0, 30);
  const lista = candidatos();
  const base = estado.leads.filter(elegivel);
  const conta = { quente: 0, morno: 0, frio: 0, "": base.length };
  base.forEach((l) => conta[temperatura(l)]++);
  const marcados = [...estado.marcados].filter((id) => base.some((l) => l.id === id));
  const total = estado.fila.enviados_hoje + fila.length;
  const opcoes = (valores, atual, rotulo, nomear = (v) => v) => `<option value="">${rotulo}</option>` +
    [...new Set(valores)].sort().map((v) => `<option value="${esc(v)}" ${v === atual ? "selected" : ""}>${esc(nomear(v))}</option>`).join("");

  $("#detalhe").innerHTML = `
  <div class="wrap">
    <button class="btn voltar" data-voltar><i class="ph ph-arrow-left"></i>Leads</button>
    <div class="head">
      <div>
        <div class="eyebrow">Contato automático</div>
        <h1>Fila de envio</h1>
        <p class="lead-txt">Selecione os leads e adicione à fila. Depois peça ao Claude no chat para enviar: ele mostra a lista,
          espera sua confirmação e envia um por um pelo WhatsApp Web, marcando cada lead como contatado.</p>
      </div>
    </div>

    ${!estado.perfil.nome ? `
    <div class="aviso"><i class="ph ph-info"></i><span>Preencha seu nome no perfil antes de montar a fila: ele vai na mensagem.</span>
      <button class="link" data-abrir-run>Abrir perfil</button></div>` : ""}
    ${total > limiteDia() ? `
    <div class="aviso"><i class="ph ph-warning"></i><span>${total} mensagens para hoje. Para não ter o número bloqueado,
      mantenha até ${limiteDia()} por dia para contatos que não te conhecem.</span></div>` : ""}

    <section class="section">
      <h2><i class="ph ph-queue"></i>Na fila <span class="count-h">${fila.length}</span>
        ${fila.length ? `<span class="h2-acoes"><button class="link" id="limparFila">Esvaziar fila</button></span>` : ""}</h2>
      ${fila.length ? `
      <ul class="fila">${fila.map((i) => `
        <li class="fila-item">
          <div class="fila-info"><strong>${esc(i.nome)}</strong><span>${esc(nicho(i.nicho))} · ${esc(i.cidade)} · ${esc(i.telefone)}</span></div>
          <details><summary>Mensagem</summary><pre class="fila-msg">${esc(i.envio_msg)}</pre></details>
          <button class="icon-btn" data-tirar="${esc(i.id)}" title="Tirar da fila" aria-label="Tirar ${esc(i.nome)} da fila"><i class="ph ph-x"></i></button>
        </li>`).join("")}
      </ul>
      <div class="comando">
        <div><strong>Pronto para enviar</strong>
          <span>Abre cada conversa no WhatsApp Web em duas etapas: primeiro a saudação, depois a proposta. Você aperta Enter lá; o painel não consegue enviar sozinho.</span></div>
        <button class="btn accent grande" id="iniciarSeq"><i class="ph ph-play-circle"></i>Abrir conversas em sequência</button>
      </div>
      <p class="hint">Envio automático (sem apertar Enter): peça ao Claude no chat <code id="cmdTxt">Envie a fila de contato automático</code>
        <button class="link" id="copiarCmd">copiar</button></p>` : `<p class="ok-site">A fila está vazia. Selecione leads abaixo.</p>`}
      ${(estado.followups || []).length ? `<p class="hint"><i class="ph ph-arrow-bend-up-right"></i> ${estado.followups.length}
        ${estado.followups.length === 1 ? "lead recebe" : "leads recebem"} follow-up na próxima rotina das 10h.</p>` : ""}
    </section>

    <section class="section">
      <h2><i class="ph ph-list-checks"></i>Selecionar leads</h2>
      ${(() => { const q = base.filter((l) => temperatura(l) === "quente").length;
        return `<div class="filtrar">
          <div><strong>Filtrar</strong><span>Coloca na fila todos os leads quentes com celular ou WhatsApp que ainda não foram contatados.</span></div>
          <button class="btn accent" id="filtrar" ${q ? "" : "disabled"}><i class="ph ph-funnel"></i>Filtrar${q ? ` (${q})` : ""}</button>
        </div>`; })()}
      <div class="sel-filtros">
        <div class="tabs mini">${TEMPS.map(([k, nome]) => `
          <button class="tab" data-ctemp="${k}" aria-selected="${estado.cf.temp === k}">${k ? `<span class="dot ${k}"></span>` : ""}${nome}<span class="count">${conta[k]}</span></button>`).join("")}
        </div>
        <label class="select"><select id="cNicho">${opcoes(base.map((l) => l.nicho), estado.cf.nicho, "Nicho", nicho)}</select><i class="ph ph-caret-down"></i></label>
        <label class="select"><select id="cCidade">${opcoes(base.map((l) => l.cidade), estado.cf.cidade, "Cidade")}</select><i class="ph ph-caret-down"></i></label>
      </div>
      ${lista.length ? `
      <div class="sel-lista">
        <label class="sel-todos"><input type="checkbox" id="marcarTodos" ${lista.every((l) => estado.marcados.has(l.id)) ? "checked" : ""}>
          <span>Selecionar os ${lista.length} visíveis</span></label>
        ${lista.map((l) => `
        <label class="sel-item">
          <input type="checkbox" data-marcar="${esc(l.id)}" ${estado.marcados.has(l.id) ? "checked" : ""}>
          <span class="sel-nome"><strong>${esc(l.nome)}</strong><span>${esc(nicho(l.nicho))} · ${esc(l.cidade)} · ${esc(l.diagnostico)} · ${esc(TEL_TIPO[l.tel_tipo])}</span></span>
          <span class="score"><span class="dot ${temperatura(l)}"></span>${l.score}</span>
        </label>`).join("")}
      </div>` : `<p class="ok-site">Nenhum lead com WhatsApp disponível nesse filtro.</p>`}
      ${(() => { const fora = estado.leads.filter((l) => !l.contatavel && ["abordagem_pronta", "qualificado"].includes(l.etapa)).length;
        return fora ? `<p class="hint"><i class="ph ph-info"></i> ${fora} leads qualificados não aparecem aqui por terem só telefone fixo ou nenhum telefone. Eles continuam na lista lateral.</p>` : ""; })()}
    </section>

    ${historico.length ? `
    <section class="section">
      <h2><i class="ph ph-clock"></i>Histórico de envios</h2>
      <ul class="fila">${historico.map((i) => `
        <li class="fila-item">
          <i class="ph-fill ${i.envio === "enviado" ? "ph-check-circle ok" : "ph-x-circle erro"}"></i>
          <div class="fila-info"><strong>${esc(i.nome)}</strong>
            <span>${i.envio === "enviado" ? "Enviado" : `Falhou: ${esc(i.envio_erro || "erro desconhecido")}`} · ${esc((i.envio_em || "").replace("T", " ").slice(0, 16))}</span></div>
        </li>`).join("")}
      </ul>
    </section>` : ""}
  </div>

  <div class="barra-acao ${marcados.length ? "on" : ""}">
    <span><strong>${marcados.length}</strong> ${marcados.length === 1 ? "lead selecionado" : "leads selecionados"}</span>
    <button class="btn" id="desmarcar">Limpar</button>
    <button class="btn accent" id="enfileirar"><i class="ph ph-plus"></i>Adicionar à fila</button>
  </div>`;
  ligarContato(lista, marcados);
}

function ligarContato(lista, marcados) {
  const rerender = () => renderContato();
  document.querySelectorAll("[data-ctemp]").forEach((b) => b.addEventListener("click", () => { estado.cf.temp = b.dataset.ctemp; rerender(); }));
  $("#cNicho").addEventListener("change", (e) => { estado.cf.nicho = e.target.value; rerender(); });
  $("#cCidade").addEventListener("change", (e) => { estado.cf.cidade = e.target.value; rerender(); });
  $("#marcarTodos")?.addEventListener("change", (e) => {
    lista.forEach((l) => (e.target.checked ? estado.marcados.add(l.id) : estado.marcados.delete(l.id)));
    rerender();
  });
  document.querySelectorAll("[data-marcar]").forEach((c) => c.addEventListener("change", () => {
    c.checked ? estado.marcados.add(c.dataset.marcar) : estado.marcados.delete(c.dataset.marcar);
    rerender();
  }));
  $("#desmarcar").addEventListener("click", () => { estado.marcados.clear(); rerender(); });
  $("#filtrar")?.addEventListener("click", async () => {
    const ids = estado.leads.filter((l) => elegivel(l) && temperatura(l) === "quente").map((l) => l.id);
    if (!ids.length) return;
    try {
      estado.fila = await api("/api/fila", { ids, acao: "adicionar" });
      await carregarLeads();
      const total = estado.fila.itens.filter((i) => i.envio === "fila").length + estado.fila.enviados_hoje;
      toast(`${ids.length} leads quentes na fila` + (total > limiteDia() ? ` · acima de ${limiteDia()} hoje, considere dividir em dias` : ""),
            total > limiteDia() ? "warning" : "check-circle");
      renderStatusSidebar();
      rerender();
    } catch (e) { toast(e.message, "warning-circle"); }
  });
  $("#enfileirar").addEventListener("click", async () => {
    try {
      estado.fila = await api("/api/fila", { ids: marcados, acao: "adicionar" });
      estado.marcados.clear();
      await carregarLeads();
      toast(`${marcados.length} ${marcados.length === 1 ? "lead adicionado" : "leads adicionados"} à fila`);
      renderStatusSidebar();
      rerender();
    } catch (e) { toast(e.message, "warning-circle"); }
  });
  const tirar = async (ids) => {
    estado.fila = await api("/api/fila", { ids, acao: "remover" });
    await carregarLeads();
    renderStatusSidebar();
    rerender();
  };
  document.querySelectorAll("[data-tirar]").forEach((b) => b.addEventListener("click", () => tirar([b.dataset.tirar])));
  $("#limparFila")?.addEventListener("click", () =>
    tirar(estado.fila.itens.filter((i) => i.envio === "fila").map((i) => i.id)).then(() => toast("Fila esvaziada")));
  $("#iniciarSeq")?.addEventListener("click", iniciarSequencia);
  $("#copiarCmd")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText($("#cmdTxt").textContent);
    toast("Comando copiado");
  });
}

// ---------- enviar em sequência ----------
// A página não consegue apertar "enviar" no WhatsApp (outro site): ela abre a conversa pronta numa aba fixa
// e você envia. Intervalo entre envios para o WhatsApp não tratar como disparo em massa.
const INTERVALO_ENVIO = 20;  // segundos
const ABA_WHATS = "whatsapp-envio";

async function iniciarSequencia() {
  const ids = estado.fila.itens.filter((i) => i.envio === "fila").map((i) => i.id);
  if (!ids.length) return;
  estado.seq = { ids, i: 0, passo: 0, okSaudacao: false, confirmado: false, espera: 0, esperaResp: 0, enviados: 0, pulados: 0 };
  renderSeq();
}

function itemSeq() {
  const q = estado.seq;
  return q && estado.fila.itens.find((x) => x.id === q.ids[q.i]);
}

// Mensagem em duas partes: a saudação vai sozinha primeiro. Muitos números têm chatbot que só
// responde o menu à primeira mensagem; a proposta chega depois, já fora do menu automático.
// O 1º parágrafo é a saudação (o perfil de venda garante isso); a do momento substitui a congelada.
function partes(msg) {
  const i = (msg || "").indexOf("\n\n");
  if (i < 0) return { saudacao: "Oi, tudo bem?", proposta: msg || "" };
  const h = new Date().getHours();
  const agora = h >= 5 && h < 12 ? "Bom dia" : h >= 12 && h < 18 ? "Boa tarde" : "Boa noite";
  return { saudacao: msg.slice(0, i).replace(/^(Bom dia|Boa tarde|Boa noite)/, agora), proposta: msg.slice(i + 2).trim() };
}

function renderSeq() {
  let el = $("#seq");
  const q = estado.seq;
  if (!q) { el?.remove(); return; }
  if (!el) { el = document.createElement("div"); el.id = "seq"; el.className = "seq-fundo"; document.body.append(el); }
  const it = itemSeq();
  const fim = q.i >= q.ids.length;
  const p = partes(it?.envio_msg);
  const passo = q.passo || 0;  // 0 abrir saudação · 1 saudação aberta · 2 proposta aberta
  const cls = (n) => (passo > n || (n === 1 && q.okSaudacao && !q.esperaResp) ? "feito" : passo === n ? "atual" : "");
  let acao;
  if (passo === 0) {
    acao = q.espera > 0
      ? `<button class="btn accent" disabled><i class="ph ph-timer"></i>Próximo em ${q.espera}s</button>`
      : `<button class="btn primary" data-abrir="saudacao"><i class="ph ph-whatsapp-logo"></i>Abrir saudação</button>`;
  } else if (passo === 1) {
    acao = `<button class="btn" data-abrir="saudacao"><i class="ph ph-arrow-square-out"></i>Abrir de novo</button>` + (
      !q.okSaudacao ? `<button class="btn accent" disabled><i class="ph ph-chat-circle-dots"></i>Abrir proposta</button>`
      : q.esperaResp > 0 ? `<button class="btn accent" disabled><i class="ph ph-timer"></i>Proposta em ${q.esperaResp}s</button>`
      : `<button class="btn primary" data-abrir="proposta"><i class="ph ph-whatsapp-logo"></i>Abrir proposta</button>`);
  } else {
    acao = `<button class="btn" data-abrir="proposta"><i class="ph ph-arrow-square-out"></i>Abrir de novo</button>
      <button class="btn accent" id="seqEnviei" ${q.confirmado ? "" : "disabled"}><i class="ph ph-check"></i>Enviei, próximo</button>`;
  }
  el.innerHTML = `
  <div class="seq" role="dialog" aria-modal="true" aria-labelledby="seqTitulo">
    <div class="seq-head">
      <div><div class="eyebrow">Abrir conversas em sequência</div>
        <strong id="seqTitulo">${fim ? "Fila concluída" : `${q.i + 1} de ${q.ids.length}`}</strong></div>
      <button class="icon-btn" id="seqFechar" aria-label="Encerrar envio"><i class="ph ph-x"></i></button>
    </div>
    <div class="barra"><span style="width:${Math.round((q.i / q.ids.length) * 100)}%"></span></div>
    ${fim ? `
    <div class="seq-fim">
      <i class="ph-fill ph-flag-checkered"></i>
      <p><strong>${q.enviados}</strong> ${q.enviados === 1 ? "lead contatado" : "leads contatados"}${q.pulados ? ` · <strong>${q.pulados}</strong> sem WhatsApp` : ""}</p>
      <button class="btn accent" id="seqOk">Concluir</button>
    </div>` : `
    <div class="seq-lead">
      <strong>${esc(it?.nome || "")}</strong>
      <span>${esc(nicho(it?.nicho || ""))} · ${esc(it?.cidade || "")} · ${esc(it?.telefone || "")}</span>
    </div>
    <div class="seq-saudacao ${passo >= 1 ? "usada" : ""}"><span>1ª mensagem</span>${esc(p.saudacao)}</div>
    <pre class="fila-msg seq-msg ${passo === 2 ? "" : "apagada"}">${esc(p.proposta)}</pre>
    <ol class="seq-passos">
      <li class="${cls(0)}">Abra e envie a saudação</li>
      <li class="${cls(1)}">Espere a resposta (ou o menu do robô)</li>
      <li class="${passo === 2 ? (q.confirmado ? "feito" : "atual") : ""}">Abra e envie a proposta</li>
    </ol>
    ${passo === 1 ? `
    <label class="seq-confirma"><input type="checkbox" id="seqOkSaudacao" ${q.okSaudacao ? "checked" : ""}>
      <span>Enviei a saudação</span></label>` : ""}
    ${passo === 2 ? `
    <label class="seq-confirma"><input type="checkbox" id="seqConfirma" ${q.confirmado ? "checked" : ""}>
      <span>A proposta apareceu na conversa</span></label>` : ""}
    <div class="seq-acoes">
      <button class="btn" id="seqPular" title="O WhatsApp avisou que o número não tem conta"><i class="ph ph-skip-forward"></i>Pular: sem WhatsApp</button>
      ${acao}
    </div>`}
  </div>`;
  ligarSeq();
}

function abrirConversa(qual) {
  const it = itemSeq();
  if (!it) return;
  const texto = partes(it.envio_msg)[qual];
  window.open(`https://web.whatsapp.com/send?phone=${it.whatsapp}&text=${encodeURIComponent(texto)}`, ABA_WHATS);  // mesma aba
  estado.seq.passo = qual === "saudacao" ? 1 : 2;
  renderSeq();
}

function contagem(q, campo) {
  clearInterval(q.timer);
  q.timer = setInterval(() => {
    q[campo]--;
    if (q[campo] <= 0) clearInterval(q.timer);
    if (estado.seq === q) renderSeq();
  }, 1000);
}

async function registrar(status) {
  const q = estado.seq, it = itemSeq();
  try {
    await api("/api/fila/resultado", { id: it.id, status, erro: status === "falhou" ? "Número sem WhatsApp" : "" });
  } catch (e) { toast(e.message, "warning-circle"); return; }
  status === "enviado" ? q.enviados++ : q.pulados++;
  Object.assign(q, { i: q.i + 1, passo: 0, okSaudacao: false, confirmado: false, esperaResp: 0 });
  q.espera = status === "enviado" && q.i < q.ids.length ? INTERVALO_ENVIO : 0;
  renderSeq();
  if (q.espera) contagem(q, "espera");
  carregarFila().then(() => estado.view === "contato" && renderContato()).catch(() => {});
}

function fecharSeq() {
  clearInterval(estado.seq?.timer);
  estado.seq = null;
  renderSeq();
  carregarLeads().then(() => estado.view === "contato" && renderContato()).catch(() => {});
}

function ligarSeq() {
  const q = estado.seq;
  $("#seqFechar")?.addEventListener("click", fecharSeq);
  $("#seqOk")?.addEventListener("click", fecharSeq);
  document.querySelectorAll("[data-abrir]").forEach((b) => b.addEventListener("click", () => abrirConversa(b.dataset.abrir)));
  $("#seqOkSaudacao")?.addEventListener("change", (e) => {
    q.okSaudacao = e.target.checked;
    q.esperaResp = q.okSaudacao ? (pvAtivo()?.contato.espera_s ?? 20) : 0;
    renderSeq();
    if (q.esperaResp) contagem(q, "esperaResp");
  });
  $("#seqConfirma")?.addEventListener("change", (e) => { q.confirmado = e.target.checked; renderSeq(); });
  $("#seqEnviei")?.addEventListener("click", () => q.confirmado && registrar("enviado"));
  $("#seqPular")?.addEventListener("click", () => {
    if (confirm("Marcar este lead como sem WhatsApp e pular?")) registrar("falhou");
  });
}

async function abrirContato() {
  estado.view = "contato";
  $(".app").classList.add("aberto");
  document.querySelectorAll(".lead").forEach((el) => el.setAttribute("aria-selected", "false"));
  try { await carregarFila(); estado.followups = (await api("/api/followups")).itens; } catch {}
  renderStatusSidebar();
  renderContato();
  $("#detalhe").scrollTop = 0;
}

// ---------- dashboard (kanban) ----------
// Leads que aceitaram o primeiro contato. A coluna é a etapa do funil; arrastar muda a etapa.
const colunaDe = (l) => (COLUNAS.includes(l.etapa) ? l.etapa : ["perdido", "descartado"].includes(l.etapa) ? "perdido" : "respondeu");

function cartao(l) {
  const fone = foneWhats(l);
  return `
  <article class="cartao" draggable="true" tabindex="0" data-id="${esc(l.id)}"
    aria-label="${esc(l.nome)}. Enter abre o lead; setas para os lados mudam a etapa.">
    <strong>${esc(l.nome)}</strong>
    <span class="cartao-meta">${esc(nicho(l.nicho))} · ${esc(l.cidade)}${variosPerfis() && l.perfil_venda !== estado.pv.ativo ? ` · ${esc(pvNome(l.perfil_venda))}` : ""}</span>
    ${l.proximo || l.proximo_em ? `
    <span class="cartao-prox ${l.proximo_em && l.proximo_em <= hoje() ? "vencido" : ""}"><i class="ph ph-calendar-blank"></i>${l.proximo_em ? dataCurta(l.proximo_em) + (l.proximo ? " · " : "") : ""}${esc(l.proximo || "")}</span>`
      : l.notas ? `<p class="cartao-nota">${esc(l.notas.split("\n").pop())}</p>` : ""}
    ${ANDAMENTO.includes(l.etapa) && l.conversa_em ? `<span class="cartao-parado ${l.conversa_de === "lead" ? "sua" : ""}">${l.reeng === "fila" ? "Na fila de reengajamento · " : ""}${ultimaMsg(l)}</span>` : ""}
    ${l.valor || l.prototipo || fone ? `
    <div class="cartao-pe">
      ${l.valor ? `<span class="cartao-valor">${esc(l.valor)}</span>` : ""}
      ${l.prototipo ? `<a class="icon-btn" href="${esc(urlSite(l.prototipo))}" target="_blank" rel="noopener" title="Abrir protótipo" aria-label="Abrir protótipo"><i class="ph ph-browser"></i></a>` : ""}
      ${fone ? `<a class="icon-btn" href="https://wa.me/${fone}" target="_blank" rel="noopener" title="Abrir conversa no WhatsApp" aria-label="Abrir conversa no WhatsApp"><i class="ph ph-whatsapp-logo"></i></a>` : ""}
    </div>` : ""}
  </article>`;
}

function renderQuadro() {
  const noQuadro = estado.leads.filter((l) => l.quadro_em);
  const perdidos = noQuadro.filter((l) => colunaDe(l) === "perdido").length;
  const cols = [...COLUNAS, ...(estado.verPerdidos && perdidos ? ["perdido"] : [])];
  $("#detalhe").innerHTML = `
  <div class="wrap largo">
    <button class="btn voltar" data-voltar><i class="ph ph-arrow-left"></i>Leads</button>
    <div class="head">
      <div>
        <div class="eyebrow">Acompanhamento</div>
        <h1>Dashboard</h1>
        <p class="lead-txt">Leads que aceitaram o primeiro contato. Arraste o card para mudar a etapa e clique nele para ver tudo do lead.</p>
      </div>
      ${perdidos ? `<button class="btn" id="verPerdidos" aria-pressed="${estado.verPerdidos}"><i class="ph ph-archive"></i>${estado.verPerdidos ? "Esconder perdidos" : `Perdidos (${perdidos})`}</button>` : ""}
    </div>
    ${renderNumeros()}
    ${renderReengajar(noQuadro)}
    ${noQuadro.length ? `
    <div class="quadro" style="--cols:${cols.length}">${cols.map((c) => {
      const ls = noQuadro.filter((l) => colunaDe(l) === c), soma = ls.reduce((t, l) => t + reais(l.valor), 0);
      return `
      <section class="coluna" data-coluna="${c}" aria-label="${ETAPA_NOME[c]}">
        <h2>${ETAPA_NOME[c]}<span class="count">${ls.length}</span>${soma ? `<span class="col-soma">${brl(soma)}</span>` : ""}</h2>
        <div class="cartoes">${ls.map(cartao).join("")}</div>
      </section>`;
    }).join("")}
    </div>` : `
    <div class="empty quadro-vazio">
      <i class="ph ph-kanban"></i>
      <p>Nenhum lead no dashboard ainda</p>
      <small>Quando um lead responder, abra ele e clique em <strong>Mandar para o dashboard</strong>.</small>
    </div>`}
    <section class="section resultados" id="resultados"></section>
  </div>`;
  renderResultados();
  ligarQuadro();
}

// ---------- reengajamento ----------
// O Claude confere no WhatsApp Web a última mensagem de cada lead do dashboard (conversa_*) e monta a fila com a
// mensagem sugerida (rotinas/reengajar.md). Aqui você revisa, edita e envia, como na fila de primeiro contato.
const ANDAMENTO = ["respondeu", "prototipo", "proposta", "negociando"];
const diasData = (d) => Math.round((new Date(hoje()) - new Date(d.slice(0, 10))) / 864e5);
const quando = (n) => (n <= 0 ? "hoje" : n === 1 ? "ontem" : `há ${n} dias`);
const dataHora = (iso) => `${dataCurta(iso)} ${iso.slice(11, 16)}`;
const ultimaMsg = (l) => !l.conversa_em ? "" : l.conversa_de === "eu"
  ? `Sua mensagem ${quando(diasData(l.conversa_em))}${l.conversa_lida ? " · visualizada" : ""}`
  : `Mensagem dele ${quando(diasData(l.conversa_em))} · a vez é sua`;
const linkWhats = (l) => `https://web.whatsapp.com/send?phone=${foneWhats(l)}&text=${encodeURIComponent(l.reeng_msg || "")}`;

function renderReengajar(noQuadro) {
  const ativos = noQuadro.filter((l) => ANDAMENTO.includes(l.etapa));
  if (!ativos.length) return "";
  const fila = ativos.filter((l) => l.reeng === "fila");
  const parados = ativos.filter((l) => l.reengajar?.pronto || (l.reengajar?.esgotado && l.reengajar.parado >= (pvAtivo()?.contato.reengajamento.dias ?? 3)));
  const conferido = ativos.map((l) => l.conversa_conferida_em).filter(Boolean).sort().pop();
  return `
  <section class="section reengajar" id="reengajar">
    <h2><i class="ph ph-arrow-counter-clockwise"></i>Fila de reengajamento <span class="count-h">${fila.length}</span>
      <span class="h2-acoes reeng-conferido">${conferido ? `WhatsApp conferido em ${dataHora(conferido)}` : "WhatsApp ainda não conferido"}</span></h2>
    ${fila.length ? `
    <div class="reeng-lista">${fila.map((l) => `
      <div class="reeng" data-id="${esc(l.id)}">
        <div class="reeng-topo">
          <button class="link reeng-nome" data-abrir>${esc(l.nome)}</button>
          <span class="reeng-meta">${ultimaMsg(l)}${l.reengajamentos ? ` · ${l.reengajamentos + 1}ª tentativa` : ""}</span>
        </div>
        <textarea class="area" rows="4" data-editar aria-label="Mensagem para ${esc(l.nome)}">${esc(l.reeng_msg)}</textarea>
        <div class="reeng-acoes">
          <button class="icon-btn" data-tirar title="Tirar da fila" aria-label="Tirar ${esc(l.nome)} da fila"><i class="ph ph-x"></i></button>
          <a class="btn primary" data-whats href="${esc(linkWhats(l))}" target="${ABA_WHATS}" rel="noopener"><i class="ph ph-whatsapp-logo"></i>Abrir no WhatsApp</a>
          <button class="btn accent" data-enviei><i class="ph ph-check"></i>Enviei</button>
        </div>
      </div>`).join("")}
    </div>` : `<p class="ok-site">Ninguém na fila agora.</p>`}
    ${parados.length ? `
    <div class="reeng-parados">${parados.map((l) => `
      <div class="reeng-linha" data-id="${esc(l.id)}">
        <button class="link reeng-nome" data-abrir>${esc(l.nome)}</button>
        <span class="reeng-meta">${ultimaMsg(l)}</span>
        ${l.reengajar.esgotado ? `<span class="reeng-meta">${l.reengajamentos} tentativas sem resposta</span><button class="btn" data-perdido><i class="ph ph-archive"></i>Mover para Perdido</button>`
          : l.reengajar.sugestao ? `<button class="btn" data-adicionar><i class="ph ph-plus"></i>Adicionar com a mensagem do perfil</button>` : ""}
      </div>`).join("")}
    </div>` : ""}
    <p class="hint">Para conferir o WhatsApp e montar a fila com mensagens sugeridas para cada conversa, peça ao Claude no chat
      <code id="cmdReeng">Monte a fila de reengajamento</code> <button class="link" id="copiarReeng">copiar</button>. A rotina das 20h também faz isso.
      Para ele enviar a fila: <code>Envie a fila de reengajamento</code>.</p>
  </section>`;
}

function ligarReengajar() {
  const sec = $("#reengajar");
  if (!sec) return;
  const lead = (el) => estado.leads.find((x) => x.id === el.closest("[data-id]").dataset.id);
  const feito = async (aviso) => { await carregarLeads(); renderQuadro(); renderStatusSidebar(); toast(aviso); };
  sec.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-abrir], [data-tirar], [data-enviei], [data-adicionar], [data-perdido]");
    if (!b) return;
    const l = lead(b);
    try {
      if ("abrir" in b.dataset) return selecionar(l.id);
      if ("tirar" in b.dataset) { await api("/api/reengajar", { ids: [l.id], acao: "remover" }); return feito(`${l.nome}: fora da fila`); }
      if ("adicionar" in b.dataset) { await api("/api/reengajar", { ids: [l.id], acao: "adicionar" }); return feito(`${l.nome}: na fila de reengajamento`); }
      if ("perdido" in b.dataset) { await salvarLead(l, { etapa: "perdido", motivo: "Não respondeu" }); return feito(`${l.nome}: movido para Perdido`); }
      await api("/api/reengajar/resultado", { id: l.id, status: "enviado" });
      feito(`${l.nome}: reengajamento registrado`);
    } catch (err) { toast(err.message, "warning-circle"); }
  });
  sec.querySelectorAll("[data-editar]").forEach((t) => {  // salva o texto 700ms depois de parar de digitar
    let timer;
    t.addEventListener("input", () => {
      const l = lead(t);
      l.reeng_msg = t.value;
      t.closest(".reeng").querySelector("[data-whats]").href = linkWhats(l);
      clearTimeout(timer);
      timer = setTimeout(() => api("/api/reengajar", { ids: [l.id], acao: "editar", mensagem: t.value }).catch((err) => toast(err.message, "warning-circle")), 700);
    });
  });
  $("#copiarReeng")?.addEventListener("click", async () => { await navigator.clipboard.writeText($("#cmdReeng").textContent); toast("Comando copiado"); });
}

// ---------- métricas ----------
// Abordado = recebeu a apresentação pela fila. Respondeu = tem data de 1ª resposta (dashboard, resposta registrada ou recusa).
const abordados = () => estado.leads.filter((l) => l.envio === "enviado");
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

function renderNumeros() {
  const ab = abordados(), resp = ab.filter((l) => l.respondeu_em);
  const fechados = estado.leads.filter((l) => l.etapa === "fechado");
  const vendido = fechados.reduce((t, l) => t + reais(l.valor), 0);
  const andamento = estado.leads.filter((l) => l.quadro_em && !["fechado", "perdido", "descartado"].includes(l.etapa));
  const emJogo = andamento.reduce((t, l) => t + reais(l.valor), 0);
  const n = (rotulo, valor, sub) => `<div class="numero"><span>${rotulo}</span><strong>${valor}</strong>${sub ? `<small>${sub}</small>` : ""}</div>`;
  return `<div class="numeros">
    ${n("Abordados", ab.length, `${ab.filter((l) => diasDesde(l.envio_em) < 7).length} nos últimos 7 dias`)}
    ${n("Responderam", resp.length, `${pct(resp.length, ab.length)}% dos abordados`)}
    ${n("Em andamento", andamento.length, emJogo ? `${brl(emJogo)} em propostas` : "")}
    ${n("Fechados", fechados.length, vendido ? brl(vendido) : "")}
  </div>`;
}

const GRUPOS = {
  nicho: ["Nicho", (l) => nicho(l.nicho)],
  cidade: ["Cidade", (l) => l.cidade],
  site: ["Site", (l) => { const d = l.diagnostico || "";
    return d === "sem site" ? "Sem site" : d.includes("rede social") ? "Só rede social" : d.includes("fora do ar") ? "Site fora do ar"
      : d === "site ok" ? "Site em ordem" : "Site com problemas"; }],
  perfil: ["Perfil", (l) => pvNome(l.perfil_venda)],
};

function renderResultados() {
  const el = $("#resultados");
  const ab = abordados();
  if (!el || !ab.length) return;
  const g = GRUPOS[estado.grupo] ? estado.grupo : "nicho";
  const linhas = {};
  ab.forEach((l) => { const k = GRUPOS[g][1](l) || "—"; (linhas[k] ||= [0, 0])[0]++; if (l.respondeu_em) linhas[k][1]++; });
  const ordem = Object.entries(linhas).sort((a, b) => b[1][0] - a[1][0]).slice(0, 12);
  el.innerHTML = `
    <h2><i class="ph ph-chart-bar"></i>Quem responde mais
      <span class="h2-acoes tabs mini" role="tablist">${Object.entries(GRUPOS).filter(([k]) => k !== "perfil" || variosPerfis()).map(([k, [rot]]) => `
        <button class="tab" role="tab" data-grupo="${k}" aria-selected="${k === g}">${rot}</button>`).join("")}</span></h2>
    <table class="tabela">
      <thead><tr><th>${GRUPOS[g][0]}</th><th>Abordados</th><th>Responderam</th><th>Taxa</th></tr></thead>
      <tbody>${ordem.map(([k, [a, r]]) => `
        <tr><td>${esc(k)}</td><td>${a}</td><td>${r}</td>
          <td><span class="taxa"><span class="taxa-barra"><span style="width:${pct(r, a)}%"></span></span>${pct(r, a)}%</span></td></tr>`).join("")}
      </tbody>
    </table>
    <p class="hint">Use para ajustar os pontos do perfil: dê mais peso ao que responde mais.</p>`;
  el.querySelectorAll("[data-grupo]").forEach((b) => b.addEventListener("click", () => { estado.grupo = b.dataset.grupo; renderResultados(); }));
}

async function moverCartao(id, coluna) {
  const l = estado.leads.find((x) => x.id === id);
  if (!l || colunaDe(l) === coluna) return;
  try {
    await salvarLead(l, { etapa: coluna });
    renderQuadro();
    document.querySelector(`.cartao[data-id="${CSS.escape(id)}"]`)?.focus();
    renderStatusSidebar();
    renderLista();
    toast(`${l.nome}: ${ETAPA_NOME[coluna]}`);
  } catch { toast("Erro ao salvar", "warning-circle"); }
}

function ligarQuadro() {
  $("#verPerdidos")?.addEventListener("click", () => { estado.verPerdidos = !estado.verPerdidos; renderQuadro(); });
  ligarReengajar();
  const q = $(".quadro");
  if (!q) return;
  q.addEventListener("click", (e) => {
    const c = e.target.closest(".cartao");
    if (c && !e.target.closest("a")) selecionar(c.dataset.id);
  });
  q.addEventListener("keydown", (e) => {
    const c = e.target.closest(".cartao");
    if (!c || e.target !== c) return;
    if (e.key === "Enter") return selecionar(c.dataset.id);
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    const cols = [...document.querySelectorAll(".coluna")].map((x) => x.dataset.coluna);
    const prox = cols[cols.indexOf(c.closest(".coluna").dataset.coluna) + (e.key === "ArrowRight" ? 1 : -1)];
    if (prox) moverCartao(c.dataset.id, prox);
  });
  q.addEventListener("dragstart", (e) => {
    const c = e.target.closest(".cartao");
    if (!c) return;
    e.dataTransfer.setData("text/plain", c.dataset.id);
    e.dataTransfer.effectAllowed = "move";
    c.classList.add("arrastando");
  });
  q.addEventListener("dragend", () => document.querySelectorAll(".arrastando, .coluna.alvo").forEach((x) => x.classList.remove("arrastando", "alvo")));
  q.addEventListener("dragover", (e) => {
    const col = e.target.closest(".coluna");
    if (!col) return;
    e.preventDefault();
    document.querySelectorAll(".coluna.alvo").forEach((x) => x !== col && x.classList.remove("alvo"));
    col.classList.add("alvo");
  });
  q.addEventListener("drop", (e) => {
    const col = e.target.closest(".coluna");
    if (!col) return;
    e.preventDefault();
    col.classList.remove("alvo");
    moverCartao(e.dataTransfer.getData("text/plain"), col.dataset.coluna);
  });
}

function abrirQuadro() {
  estado.view = "quadro";
  $(".app").classList.add("aberto");
  document.querySelectorAll(".lead").forEach((el) => el.setAttribute("aria-selected", "false"));
  renderStatusSidebar();
  renderQuadro();
  $("#detalhe").scrollTop = 0;
}

// ---------- perfis de venda ----------
// Edita uma cópia (estado.pvEdit) e salva sozinho 700ms depois da última mudança. Salvar o perfil em uso
// requalifica os leads não abordados quando os critérios mudam (o servidor responde quantos).
const clonar = (o) => JSON.parse(JSON.stringify(o));
let pvTimer = null;

async function abrirPerfis(id) {
  await pvSalvarAgora().catch((e) => toast(`Não salvo: ${e.message}`, "warning-circle"));
  estado.view = "perfis";
  $(".app").classList.add("aberto");
  document.querySelectorAll(".lead").forEach((el) => el.setAttribute("aria-selected", "false"));
  try { estado.pv = await api("/api/perfis"); } catch {}
  estado.pvEdit = clonar(estado.pv.perfis.find((p) => p.id === id) || pvAtivo());
  renderStatusSidebar();
  renderPerfis();
  $("#detalhe").scrollTop = 0;
}

function renderPerfis() {
  const d = estado.pv, p = estado.pvEdit, ativo = p.id === d.ativo;
  const num = (campo, v, min, max, passo = 1) =>
    `<input type="number" class="num" data-campo="${campo}" value="${esc(v)}" min="${min}" max="${max}" step="${passo}">`;
  const instrucoes = (campo, v, exemplo) => `
        <label class="campo"><span><i class="ph ph-sparkle"></i>Instruções para o Claude</span>
          <textarea class="area" data-campo="${campo}" rows="3" placeholder="${esc(exemplo)}">${esc(v)}</textarea></label>`;
  $("#detalhe").innerHTML = `
  <div class="wrap">
    <button class="btn voltar" data-voltar><i class="ph ph-arrow-left"></i>Leads</button>
    <div class="head">
      <div>
        <div class="eyebrow">Perfis de venda</div>
        <h1>O que vender e como abordar</h1>
        <p class="lead-txt">Cada perfil define como os leads são prospectados, qualificados e contatados. O bot e as rotinas das 20h e das 10h seguem o perfil em uso.</p>
      </div>
    </div>

    <div class="pv-barra">
      <div class="tabs" role="tablist" aria-label="Perfis">${d.perfis.map((x) => `
        <button class="tab" role="tab" data-pv="${esc(x.id)}" aria-selected="${x.id === p.id}">
          ${x.id === d.ativo ? '<span class="dot em-uso" title="Em uso"></span>' : ""}<span data-pv-nome="${esc(x.id)}">${esc(x.id === p.id ? p.nome : x.nome)}</span></button>`).join("")}
      </div>
      <button class="btn" id="pvNovo" title="Começa como cópia do perfil aberto"><i class="ph ph-plus"></i>Novo perfil</button>
    </div>

    <div class="card pv-topo">
      <label class="campo"><span>Nome do perfil</span><input id="pvNome" data-campo="nome" value="${esc(p.nome)}" maxlength="60"></label>
      ${ativo ? `<span class="pv-em-uso"><i class="ph-fill ph-check-circle"></i>Em uso</span>`
        : `<button class="btn accent" id="pvAtivar"><i class="ph ph-power"></i>Usar este perfil</button>`}
    </div>
    ${ativo ? "" : `<p class="hint">Ao usar este perfil, os leads ainda não abordados são requalificados com ele na hora. A fila já montada não muda.</p>`}

    <section class="section">
      <h2><span class="passo">1</span>Prospecção</h2>
      <div class="card pv-bloco">
        <div class="campo"><span>Cidades, na ordem em que a rotina das 20h busca</span>
          <div class="tags" id="pvCidades"></div>
          <p class="hint">Enter para adicionar. Depois de prospectada, a cidade ganha um ✓ e a rotina passa para a próxima.</p></div>
        <div class="campo"><span>Nichos</span>
          <div class="nichos">${(estado.bot?.nichos || []).map((n) => { const on = p.prospeccao.nichos.includes(n.id); return `
            <div class="nicho-item"><button type="button" class="nicho ${on ? "on" : ""}" data-pv-nicho="${n.id}" aria-pressed="${on}"><i class="ph ${on ? "ph-check-square" : "ph-square"}"></i>${esc(n.rotulo)}</button>${n.extra
              ? `<button type="button" class="icon-btn nicho-rm" data-rm-nicho="${n.id}" title="Excluir nicho" aria-label="Excluir o nicho ${esc(n.rotulo)}"><i class="ph ph-x"></i></button>` : ""}</div>`; }).join("")}
          </div>
          <details class="novo-nicho">
            <summary><i class="ph ph-plus"></i>Novo nicho</summary>
            <div class="novo-nicho-campos">
              <label class="campo"><span>Nome</span><input id="nnRotulo" placeholder="Ex.: Imobiliária" maxlength="40"></label>
              <label class="campo"><span>Termo de busca</span><input id="nnBusca" placeholder="Ex.: imobiliária" maxlength="40"></label>
              <label class="campo"><span>No plural, para a mensagem</span><input id="nnSegmento" placeholder="Ex.: imobiliárias" maxlength="60"></label>
              <label class="campo"><span>Ticket</span><span class="select"><select id="nnTicket">
                <option value="15">Alto</option><option value="10" selected>Médio</option><option value="5">Baixo</option></select><i class="ph ph-caret-down"></i></span></label>
              <button type="button" class="btn" id="nnCriar">Criar nicho</button>
            </div>
            <p class="hint">No Google Places o bot busca pelo termo. No OpenStreetMap, pelos negócios que têm o termo no nome.</p>
          </details></div>
        <div class="campo"><span>Fonte de dados</span>
          <div class="fontes">${[["osm", "OpenStreetMap", "Gratuito. Cobertura menor no Brasil."], ["google", "Google Places", "Mais negócios. Usa a chave salva em Nova prospecção."]].map(([v, r, t]) => `
            <label class="fonte ${p.prospeccao.fonte === v ? "on" : ""}"><input type="radio" name="pvFonte" value="${v}" ${p.prospeccao.fonte === v ? "checked" : ""}>
              <strong>${r}</strong><span>${t}</span></label>`).join("")}
          </div></div>
        ${instrucoes("prospeccao.instrucoes", p.prospeccao.instrucoes, "Ex.: prefira negócios com mais de um profissional; ignore quem atende só em domicílio.")}
      </div>
    </section>

    <section class="section">
      <h2><span class="passo">2</span>Qualificação</h2>
      <div class="card pv-bloco">
        <div class="campo"><span>Pontos por critério</span>
          <div class="criterios">${Object.entries(d.sinais).map(([k, rotulo]) => `
            <label class="criterio"><span>${esc(rotulo)}</span>${num(`qualificacao.pontos.${k}`, p.qualificacao.pontos[k], -100, 100, 5)}</label>`).join("")}
          </div>
          <p class="hint">A nota do lead é a soma, de 0 a 100. Use número negativo para tirar pontos.</p></div>
        <div class="campo"><span>Faixas da nota</span>
          <div class="faixas">
            <label class="faixa"><span class="dot quente"></span>Quente a partir de ${num("qualificacao.quente", p.qualificacao.quente, 0, 100, 5)}</label>
            <label class="faixa"><span class="dot morno"></span>Morno a partir de ${num("qualificacao.morno", p.qualificacao.morno, 0, 100, 5)}</label>
            <label class="faixa"><i class="ph ph-prohibit"></i>Descartar abaixo de ${num("qualificacao.minimo", p.qualificacao.minimo, 0, 100, 5)}</label>
          </div></div>
        ${instrucoes("qualificacao.instrucoes", p.qualificacao.instrucoes, "Ex.: descarte quem já mostra agendamento online no site; priorize clínicas com mais de 50 avaliações.")}
      </div>
    </section>

    <section class="section">
      <h2><span class="passo">3</span>Contato e disparo</h2>
      <div class="card pv-bloco">
        <div class="campo"><span>Mensagem de abordagem</span>
          <textarea class="area" id="pvMsg" data-campo="contato.mensagem" rows="11" spellcheck="true">${esc(p.contato.mensagem)}</textarea>
          <div class="vars">${Object.entries(d.variaveis).map(([k, desc]) =>
            `<button type="button" class="pill" data-var="${k}" title="${esc(desc)}">{${k}}</button>`).join("")}</div>
          <p class="hint">O primeiro parágrafo vai sozinho, antes do resto. Clique numa variável para inserir onde está o cursor.</p></div>
        <div class="campo"><span>Prévia com ${esc(d.amostra[p.id] || "um lead de exemplo")}</span><pre class="fila-msg previa" id="pvPrevia">${esc(d.previa[p.id] || "")}</pre></div>
        <div class="faixas">
          <label class="faixa">Até ${num("contato.limite_dia", p.contato.limite_dia, 1, 60)} mensagens por dia</label>
          <label class="faixa">Esperar ${num("contato.espera_s", p.contato.espera_s, 5, 120, 5)} s entre a saudação e o resto</label>
          <label class="faixa">Sem resposta em ${num("contato.dias_sem_resposta", p.contato.dias_sem_resposta, 1, 60)} dias, vira Perdido</label>
        </div>
        <div class="campo"><span>Follow-up</span>
          <div class="fu">
            <label class="switch"><input type="checkbox" data-campo="contato.followup.ativo" ${p.contato.followup.ativo ? "checked" : ""}><span class="trilho"></span>
              <span><strong>Mandar uma 2ª mensagem para quem não respondeu</strong>
                <small>Sai na rotina das 10h e conta no limite do dia. Com ele ligado, o prazo para virar Perdido conta a partir do follow-up.</small></span></label>
            <label class="faixa">Depois de ${num("contato.followup.dias", p.contato.followup.dias, 1, 30)} dias sem resposta</label>
            <textarea class="area" data-campo="contato.followup.mensagem" rows="4">${esc(p.contato.followup.mensagem)}</textarea>
          </div></div>
        <div class="campo"><span>Reengajamento no dashboard</span>
          <div class="fu">
            <p class="hint pv-hint-topo">O Claude confere no WhatsApp a última mensagem de cada lead do dashboard. Quem está parado entra na fila de reengajamento do dashboard, com uma mensagem sugerida a partir destes modelos e da conversa. Caixa vazia é pulada.</p>
            <label class="faixa">Depois de ${num("contato.reengajamento.dias", p.contato.reengajamento.dias, 1, 30)} dias parado</label>
            ${p.contato.reengajamento.mensagens.map((m, i) => `
            <label class="campo"><span>${i + 1}ª mensagem${i === 2 ? " · a última, de despedida" : ""}</span>
              <textarea class="area" data-campo="contato.reengajamento.mensagens.${i}" rows="3">${esc(m)}</textarea></label>`).join("")}
          </div></div>
        <div class="campo"><span>Mensagens de proposta</span>
          <p class="hint pv-hint-topo">Aparecem nos leads do dashboard, prontas para copiar ou abrir no WhatsApp. Use {prototipo} e {preco} para o link e o valor de cada lead.</p>
          <div id="pvPropostas" class="pv-propostas"></div>
          <button type="button" class="link" id="pvAddProposta"><i class="ph ph-plus"></i> Nova mensagem</button></div>
        ${instrucoes("contato.instrucoes", p.contato.instrucoes, "Ex.: tom mais direto; nunca falar de preço na primeira mensagem; citar o bairro quando souber.")}
      </div>
    </section>

    ${p.id !== d.padrao && !ativo ? `<p class="pv-excluir"><button class="link perigo" id="pvExcluir"><i class="ph ph-trash"></i>Excluir este perfil</button></p>` : ""}
    <div class="pv-salvo" id="pvSalvo" role="status" aria-live="polite"></div>
  </div>`;
  renderCidadesPv();
  renderPropostasPv();
  ligarPerfis();
}

function renderPropostasPv() {
  $("#pvPropostas").innerHTML = estado.pvEdit.contato.propostas.map((x, i) => `
    <div class="pv-proposta">
      <div class="pv-proposta-topo">
        <input class="pv-titulo" data-campo="contato.propostas.${i}.titulo" value="${esc(x.titulo)}" placeholder="Título" maxlength="40" aria-label="Título da mensagem">
        <button type="button" class="icon-btn" data-rm-proposta="${i}" title="Remover" aria-label="Remover a mensagem ${esc(x.titulo)}"><i class="ph ph-trash"></i></button>
      </div>
      <textarea class="area" data-campo="contato.propostas.${i}.texto" rows="5">${esc(x.texto)}</textarea>
    </div>`).join("");
}

function renderCidadesPv() {
  const cs = estado.pvEdit.prospeccao.cidades;
  $("#pvCidades").innerHTML = cs.map((c, i) => `
    <span class="tag ${c.feita ? "feita" : ""}" ${c.feita ? `title="Prospectada em ${esc(c.feita)}"` : ""}>${c.feita ? '<i class="ph ph-check"></i>' : ""}${esc(c.nome)}<button type="button" data-rm-cid="${i}" aria-label="Remover ${esc(c.nome)}"><i class="ph ph-x"></i></button></span>`).join("") +
    `<input id="pvCidadeIn" placeholder="${cs.length ? "Adicionar cidade" : "Ex.: Londrina"}" autocomplete="off">`;
}

function pvStatus(txt, icone, erro = false) {
  const el = $("#pvSalvo");
  if (!el) return;
  el.className = `pv-salvo on${erro ? " erro" : ""}`;
  el.innerHTML = `<i class="ph ph-${icone}"></i>${esc(txt)}`;
  clearTimeout(pvStatus.t);
  if (icone === "check") pvStatus.t = setTimeout(() => el.classList.remove("on"), 2500);
}

function pvAgendar() {
  pvStatus("Salvando…", "dots-three");
  clearTimeout(pvTimer);
  pvTimer = setTimeout(() => pvSalvar().catch(() => {}), 700);
}

async function pvSalvarAgora() {
  if (!pvTimer) return;
  clearTimeout(pvTimer);
  await pvSalvar();
}

async function pvSalvar() {
  pvTimer = null;
  const p = estado.pvEdit;
  try {
    const d = await api("/api/perfis", { acao: "salvar", perfil: p });
    estado.pv = d;
    renderStatusSidebar();
    if (d.requalificados) carregarLeads().catch(() => {});
    if (estado.view !== "perfis" || estado.pvEdit !== p) return;
    $("#pvPrevia").textContent = d.previa[p.id] || "";
    pvStatus(d.requalificados ? `Salvo · ${d.requalificados} leads requalificados` : "Salvo", "check");
  } catch (e) {
    pvStatus(e.message, "warning-circle", true);
    throw e;
  }
}

function ligarPerfis() {
  const p = estado.pvEdit;
  const wrap = $("#detalhe .wrap");
  wrap.addEventListener("input", (e) => {  // campos simples: data-campo="contato.mensagem"
    const el = e.target.closest("[data-campo]");
    if (!el) return;
    const ks = el.dataset.campo.split("."), ultimo = ks.pop();
    ks.reduce((o, k) => o[k], p)[ultimo] = el.type === "checkbox" ? el.checked : el.type === "number" && el.value !== "" ? Number(el.value) : el.value;
    if (el.id === "pvNome") document.querySelector(`[data-pv-nome="${CSS.escape(p.id)}"]`).textContent = el.value || "Sem nome";
    pvAgendar();
  });
  document.querySelectorAll("[data-pv]").forEach((b) => b.addEventListener("click", () => abrirPerfis(b.dataset.pv)));

  document.querySelectorAll("[data-pv-nicho]").forEach((b) => b.addEventListener("click", () => {
    const id = b.dataset.pvNicho, ns = p.prospeccao.nichos;
    p.prospeccao.nichos = ns.includes(id) ? ns.filter((x) => x !== id) : [...ns, id];
    const on = p.prospeccao.nichos.includes(id);
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on);
    b.querySelector("i").className = `ph ${on ? "ph-check-square" : "ph-square"}`;
    pvAgendar();
  }));
  document.querySelectorAll('[name="pvFonte"]').forEach((r) => r.addEventListener("change", () => {
    p.prospeccao.fonte = r.value;
    document.querySelectorAll('[name="pvFonte"]').forEach((x) => x.parentElement.classList.toggle("on", x.checked));
    pvAgendar();
  }));

  const cid = $("#pvCidades");
  const addCidade = (txt, foco) => {
    txt.split(",").map((c) => c.trim()).filter(Boolean).forEach((c) => {
      if (!p.prospeccao.cidades.some((x) => x.nome.toLowerCase() === c.toLowerCase())) p.prospeccao.cidades.push({ nome: c, feita: "" });
    });
    renderCidadesPv();
    if (foco) $("#pvCidadeIn").focus();
    pvAgendar();
  };
  cid.addEventListener("keydown", (e) => {
    const inp = e.target.closest("#pvCidadeIn");
    if (!inp) return;
    if ((e.key === "Enter" || e.key === ",") && inp.value.trim()) { e.preventDefault(); addCidade(inp.value, true); }
    if (e.key === "Backspace" && !inp.value && p.prospeccao.cidades.length) {
      p.prospeccao.cidades.pop();
      renderCidadesPv();
      $("#pvCidadeIn").focus();
      pvAgendar();
    }
  });
  cid.addEventListener("focusout", (e) => {
    const inp = e.target.closest("#pvCidadeIn");
    if (inp?.value.trim()) setTimeout(() => inp.isConnected && inp.value.trim() && addCidade(inp.value, false), 200);
  });
  cid.addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rm-cid]");
    if (rm) { p.prospeccao.cidades.splice(+rm.dataset.rmCid, 1); renderCidadesPv(); pvAgendar(); }
    else if (e.target === cid) $("#pvCidadeIn").focus();
  });

  $("#pvAddProposta").addEventListener("click", () => {
    p.contato.propostas.push({ titulo: "Nova mensagem", texto: "" });
    renderPropostasPv();
    document.querySelector(`[data-campo="contato.propostas.${p.contato.propostas.length - 1}.texto"]`).focus();
    pvAgendar();
  });
  $("#pvPropostas").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rm-proposta]");
    if (!rm) return;
    p.contato.propostas.splice(+rm.dataset.rmProposta, 1);
    renderPropostasPv();
    pvAgendar();
  });
  $("#nnCriar").addEventListener("click", async () => {
    const antes = new Set(estado.bot.nichos.map((n) => n.id));
    try {
      estado.bot = await api("/api/nichos", { acao: "criar", nicho: {
        rotulo: $("#nnRotulo").value, busca: $("#nnBusca").value, segmento: $("#nnSegmento").value, ticket: +$("#nnTicket").value } });
      const novo = estado.bot.nichos.find((n) => !antes.has(n.id));
      if (novo) p.prospeccao.nichos.push(novo.id);
      renderPerfis();
      pvAgendar();
      toast(`Nicho “${novo?.rotulo}” criado e marcado neste perfil`);
    } catch (e) { toast(e.message, "warning-circle"); }
  });
  document.querySelectorAll("[data-rm-nicho]").forEach((b) => b.addEventListener("click", async () => {
    const n = estado.bot.nichos.find((x) => x.id === b.dataset.rmNicho);
    if (!confirm(`Excluir o nicho “${n.rotulo}”? Os leads já encontrados continuam na lista.`)) return;
    try {
      await pvSalvarAgora();
      estado.bot = await api("/api/nichos", { acao: "excluir", id: n.id });
      abrirPerfis(p.id);
    } catch (e) { toast(e.message, "warning-circle"); }
  }));
  document.querySelectorAll("[data-var]").forEach((b) => b.addEventListener("click", () => {
    const t = $("#pvMsg");
    t.focus();
    t.setRangeText(`{${b.dataset.var}}`, t.selectionStart, t.selectionEnd, "end");
    t.dispatchEvent(new Event("input", { bubbles: true }));
  }));

  $("#pvAtivar")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await pvSalvarAgora();
      estado.pv = await api("/api/perfis", { acao: "ativar", id: p.id });
      Object.assign(estado.form, { nichos: [...p.prospeccao.nichos], fonte: p.prospeccao.fonte });
      guardarForm();
      await carregarLeads();
      toast(`Usando “${p.nome}”` + (estado.pv.requalificados ? ` · ${estado.pv.requalificados} leads requalificados` : ""));
      renderStatusSidebar();
      renderPerfis();
    } catch (err) {
      toast(err.message, "warning-circle");
      btn.disabled = false;
    }
  });
  $("#pvNovo").addEventListener("click", async () => {
    try {
      await pvSalvarAgora();
      const novo = { ...clonar(p), id: "p" + Date.now().toString(36), nome: "Novo perfil" };
      estado.pv = await api("/api/perfis", { acao: "salvar", perfil: novo });
      await abrirPerfis(novo.id);
      $("#pvNome").select();
      toast("Perfil criado como cópia. Dê um nome a ele.", "copy");
    } catch (e) { toast(e.message, "warning-circle"); }
  });
  $("#pvExcluir")?.addEventListener("click", async () => {
    if (!confirm(`Excluir o perfil “${p.nome}”?`)) return;
    clearTimeout(pvTimer);
    pvTimer = null;
    try {
      estado.pv = await api("/api/perfis", { acao: "excluir", id: p.id });
      toast("Perfil excluído");
      abrirPerfis(estado.pv.ativo);
    } catch (e) { toast(e.message, "warning-circle"); }
  });
}

// ---------- tema ----------
function aplicarTema(t) {
  if (t) document.documentElement.dataset.theme = t;
  const escuro = t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  $("#tema").innerHTML = `<i class="ph ph-${escuro ? "sun" : "moon"}"></i>`;
}

// ---------- eventos globais ----------
$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest(".tab");
  if (!b) return;
  estado.temp = b.dataset.temp;
  guardar.set("temp", estado.temp);
  renderLista();
});
$("#lista").addEventListener("click", (e) => {
  const li = e.target.closest(".lead");
  if (li) selecionar(li.dataset.id);
});
$("#busca").addEventListener("input", renderLista);
["#fNicho", "#fCidade", "#fEtapa"].forEach((s) =>
  $(s).addEventListener("change", (e) => {
    e.target.parentElement.classList.toggle("ativo", !!e.target.value);
    renderLista();
  }));
$("#abrirRun").addEventListener("click", abrirRun);
$("#abrirContato").addEventListener("click", abrirContato);
$("#abrirQuadro").addEventListener("click", abrirQuadro);
$("#abrirPerfis").addEventListener("click", () => abrirPerfis());
$("#detalhe").addEventListener("click", (e) => {
  if (e.target.closest("[data-voltar]")) $(".app").classList.remove("aberto");
  if (e.target.closest("[data-abrir-run]")) abrirRun();
  if (e.target.closest("[data-abrir-quadro]")) abrirQuadro();
});
$("#tema").addEventListener("click", () => {
  const escuro = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  const novo = escuro ? "light" : "dark";
  guardar.set("tema", novo);
  aplicarTema(novo);
});

// setas ↑/↓ navegam na lista (fora de campos de texto)
document.addEventListener("keydown", (e) => {
  if (estado.seq && e.key === "Escape") return fecharSeq();
  if (estado.seq || !["ArrowDown", "ArrowUp"].includes(e.key) || e.target.matches("input, textarea, select, .cartao")) return;
  e.preventDefault();
  const ids = filtrados().map((l) => l.id);
  if (!ids.length) return;
  const i = estado.view === "lead" ? ids.indexOf(estado.sel) : -1;
  const prox = e.key === "ArrowDown" ? Math.min(i + 1, ids.length - 1) : Math.max(i - 1, 0);
  selecionar(ids[i === -1 ? 0 : prox]);
});

// ---------- início ----------
(async function iniciar() {
  estado.temp = guardar.get("temp") ?? "quente";
  try { Object.assign(estado.form, JSON.parse(guardar.get("form") || "{}")); } catch {}
  aplicarTema(guardar.get("tema"));
  try {
    const [cfg, b, fila, pv] = await Promise.all([api("/api/config"), api("/api/bot"), api("/api/fila"), api("/api/perfis")]);
    estado.fila = fila;
    estado.pv = pv;
    estado.perfil = cfg.perfil || {};
    estado.temKey = cfg.tem_google_key;
    estado.bot = b;
    estavaRodando = b.rodando;
    if (!estado.form.nichos.length) estado.form.nichos = [...pvAtivo().prospeccao.nichos];
    await carregarLeads();
    renderStatusSidebar();
    if (!estado.leads.length || b.rodando) abrirRun();
  } catch {
    $("#lista").innerHTML = '<li class="vazio">Erro ao carregar. O painel.py está rodando?</li>';
  }
  setTimeout(pollBot, 2000);
  // lista atualiza sozinha enquanto o bot encontra leads novos
  setInterval(() => { if (estado.bot?.rodando) carregarLeads().catch(() => {}); }, 15000);
})();
