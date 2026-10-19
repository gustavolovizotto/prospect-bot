// Painel de prospecção. Sem build, sem dependências: dados vêm da API do painel.py.

const ETAPA_NOME = {
  abordagem_pronta: "Pronto para abordar",
  qualificado: "Qualificado",
  contatado: "Contatado",
  respondeu: "Respondeu",
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

const estado = {
  leads: [], etapas: [], motivos: [],
  temp: "quente", sel: null, view: "vazio",       // view: vazio | lead | run
  bot: null, perfil: {}, temKey: false,
  form: { cidades: [], nichos: [], fonte: "osm", loop: false },
  fila: { itens: [], enviados_hoje: 0 },
  marcados: new Set(), cf: { temp: "quente", nicho: "", cidade: "" },  // seleção da aba Contato automático
};
const LIMITE_DIA = 20;  // acima disso o WhatsApp tende a bloquear números que mandam para desconhecidos
const $ = (s) => document.querySelector(s);

// ---------- utilidades ----------
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const temperatura = (l) => l.temperatura;  // calculada no servidor (bot.QUENTE / bot.MORNO)
const TEL_TIPO = { whatsapp: "WhatsApp cadastrado", celular: "Celular · provável WhatsApp", fixo: "Fixo · sem WhatsApp" };
const nicho = (id) => estado.bot?.nichos.find((n) => n.id === id)?.rotulo || id.charAt(0).toUpperCase() + id.slice(1);
const urlSite = (s) => (!s ? "" : /^https?:\/\//i.test(s) ? s : "http://" + s);
const hostSite = (s) => s.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
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
  $("#total").textContent = `${d.leads.length} leads encontrados`;
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
    (!n || l.nicho === n) && (!c || l.cidade === c) && (!e || l.etapa === e) &&
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
    : b.rodando ? `Buscando ${b.atual} de ${b.total} · ${b.novos} novos`
    : b.status === "concluido" ? `Concluída · ${b.novos} leads novos`
    : b.status === "parado" ? "Interrompida" : "Defina cidades e nichos";
  btn.querySelector(".run-ico i").className = b?.rodando && !b.aguardando ? "ph ph-circle-notch girando" : "ph ph-rocket-launch";

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

        <section class="section">
          <h2><i class="ph ph-lightbulb"></i>Como negociar</h2>
          <p class="dor">${esc(a.dor)}</p>
          ${a.pitch ? `<p class="pitch">${esc(a.pitch)}</p>` : ""}
        </section>

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

        <section class="section">
          <h2><i class="ph ph-layout"></i>O que propor na landing</h2>
          <ul class="check">${l.proposta.map((p) => `<li><i class="ph ph-check"></i>${esc(p)}</li>`).join("")}</ul>
        </section>

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
        <div class="eyebrow">Prospecção</div>
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
              : `<span>Adicione ao menos uma cidade e um nicho</span>`}</div>
            <button type="button" class="btn accent grande" id="iniciar" ${buscas ? "" : "disabled"}><i class="ph ph-play"></i>Iniciar prospecção</button>
          </div>
        </fieldset>
      </div>

      <div>
        <section class="section">
          <h2><i class="ph ph-user-circle"></i>Seu perfil</h2>
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
    ${total > LIMITE_DIA ? `
    <div class="aviso"><i class="ph ph-warning"></i><span>${total} mensagens para hoje. Para não ter o número bloqueado,
      mantenha até ${LIMITE_DIA} por dia para contatos que não te conhecem.</span></div>` : ""}

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
        <div><strong>Pronto para enviar</strong><span>Cole no chat do Claude:</span></div>
        <code id="cmdTxt">Envie a fila de contato automático</code>
        <button class="btn" id="copiarCmd"><i class="ph ph-copy"></i>Copiar</button>
      </div>` : `<p class="ok-site">A fila está vazia. Selecione leads abaixo.</p>`}
    </section>

    <section class="section">
      <h2><i class="ph ph-list-checks"></i>Selecionar leads</h2>
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
  $("#copiarCmd")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText($("#cmdTxt").textContent);
    toast("Comando copiado");
  });
}

async function abrirContato() {
  estado.view = "contato";
  $(".app").classList.add("aberto");
  document.querySelectorAll(".lead").forEach((el) => el.setAttribute("aria-selected", "false"));
  try { await carregarFila(); } catch {}
  renderStatusSidebar();
  renderContato();
  $("#detalhe").scrollTop = 0;
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
$("#detalhe").addEventListener("click", (e) => {
  if (e.target.closest("[data-voltar]")) $(".app").classList.remove("aberto");
  if (e.target.closest("[data-abrir-run]")) abrirRun();
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
  if (!["ArrowDown", "ArrowUp"].includes(e.key) || e.target.matches("input, textarea, select")) return;
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
    const [cfg, b, fila] = await Promise.all([api("/api/config"), api("/api/bot"), api("/api/fila")]);
    estado.fila = fila;
    estado.perfil = cfg.perfil || {};
    estado.temKey = cfg.tem_google_key;
    estado.bot = b;
    estavaRodando = b.rodando;
    if (!estado.form.nichos.length) estado.form.nichos = b.nichos.map((n) => n.id);
    await carregarLeads();
    renderStatusSidebar();
    if (!estado.leads.length || b.rodando) abrirRun();
  } catch {
    $("#total").textContent = "Erro ao carregar. O painel.py está rodando?";
  }
  setTimeout(pollBot, 2000);
  // lista atualiza sozinha enquanto o bot encontra leads novos
  setInterval(() => { if (estado.bot?.rodando) carregarLeads().catch(() => {}); }, 15000);
})();
