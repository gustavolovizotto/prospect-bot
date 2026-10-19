// Painel de leads. Sem build, sem dependências: dados vêm de /api/leads (painel.py).

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
const TEMPS = [
  ["quente", "Quentes"],
  ["morno", "Mornos"],
  ["frio", "Frios"],
  ["", "Todos"],
];

const estado = { leads: [], etapas: [], temp: "quente", sel: null };
const $ = (s) => document.querySelector(s);

// ---------- utilidades ----------
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const temperatura = (l) => (l.score >= 80 ? "quente" : l.score >= 50 ? "morno" : "frio");
const TEMP_NOME = { quente: "Quente", morno: "Morno", frio: "Frio" };
const nicho = (n) => ({ salao: "Salão de beleza", veterinario: "Veterinário", pet: "Pet shop" })[n] || n.charAt(0).toUpperCase() + n.slice(1);
const urlSite = (s) => (!s ? "" : /^https?:\/\//i.test(s) ? s : "http://" + s);
const hostSite = (s) => s.replace(/^https?:\/\//i, "").replace(/\/$/, "");
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
  toast.t = setTimeout(() => t.classList.remove("on"), 1800);
}

const guardar = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

// ---------- dados ----------
async function carregar() {
  const r = await fetch("/api/leads");
  const d = await r.json();
  estado.leads = d.leads;
  estado.etapas = d.etapas;
  $("#total").textContent = `${d.leads.length} leads encontrados`;
  preencherFiltros();
  renderLista();
}

async function salvar(l, mudancas) {
  const corpo = { id: l.id, etapa: l.etapa, notas: l.notas || "", ...mudancas };
  const r = await fetch("/api/lead", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw new Error("falha ao salvar");
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
      <li class="lead" role="option" data-id="${esc(l.id)}" aria-selected="${estado.sel === l.id}">
        <span class="nome">${esc(l.nome)}</span>
        <span class="meta">
          <span>${esc(nicho(l.nicho))} · ${esc(l.cidade)}</span>
          ${!["abordagem_pronta", "qualificado", "descartado"].includes(l.etapa) ? `<span class="etapa-mini">${esc(ETAPA_NOME[l.etapa])}</span>` : ""}
        </span>
        <span class="score"><span class="dot ${temperatura(l)}"></span>${l.score}</span>
      </li>`).join("")
    : `<li class="vazio">${estado.leads.length ? "Nenhum lead com esses filtros" : "Nenhum lead ainda. Deixe o bot rodar."}</li>`;
}

// ---------- detalhe ----------
function renderDetalhe(l) {
  const t = temperatura(l);
  const fone = foneWhats(l);
  const a = l.argumento;
  const maps = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(`${l.nome} ${l.endereco || ""} ${l.cidade}`);
  const google = "https://www.google.com/search?q=" + encodeURIComponent(`${l.nome} ${l.cidade}`);
  const site = urlSite(l.site);

  $("#detalhe").innerHTML = `
  <div class="wrap">
    <button class="btn voltar" id="voltar"><i class="ph ph-arrow-left"></i>Leads</button>

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

    <div class="actions">
      <a class="btn primary" id="wa" target="_blank" rel="noopener" ${fone ? "" : 'aria-disabled="true"'}><i class="ph ph-whatsapp-logo"></i>Abrir no WhatsApp</a>
      <a class="btn" ${l.telefone ? `href="tel:${esc(l.telefone.replace(/[^\d+]/g, ""))}"` : 'aria-disabled="true"'}><i class="ph ph-phone"></i>Ligar</a>
      <a class="btn" href="${maps}" target="_blank" rel="noopener"><i class="ph ph-map-pin"></i>Google Maps</a>
      <a class="btn" href="${google}" target="_blank" rel="noopener"><i class="ph ph-google-logo"></i>Pesquisar</a>
      ${site ? `<a class="btn" href="${esc(site)}" target="_blank" rel="noopener"><i class="ph ph-arrow-square-out"></i>Abrir site</a>` : ""}
    </div>

    <div class="cols">
      <div>
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
            <div><i class="ph ph-phone"></i><dt>Telefone</dt><dd>${l.telefone ? esc(l.telefone) : '<span class="nada">Não informado</span>'}</dd></div>
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

  ligarDetalhe(l, fone);
  $("#detalhe").scrollTop = 0;
}

function ligarDetalhe(l, fone) {
  const msg = $("#msg"), wa = $("#wa");
  const atualizar = () => {
    if (fone) wa.href = `https://wa.me/${fone}?text=${encodeURIComponent(msg.value)}`;
    $("#chars").textContent = `${msg.value.length} caracteres`;
  };
  atualizar();
  msg.addEventListener("input", atualizar);

  wa.addEventListener("click", async () => {
    if (["abordagem_pronta", "qualificado"].includes(l.etapa)) {
      await salvar(l, { etapa: "contatado" });
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
    try {
      await salvar(l, { etapa: e.target.value });
      renderLista();
      toast(`Etapa: ${ETAPA_NOME[e.target.value]}`);
    } catch { toast("Erro ao salvar", "warning-circle"); }
  });

  // notas salvam sozinhas 700ms depois de parar de digitar
  const notas = $("#notas"), status = $("#salvo");
  let timer;
  notas.addEventListener("input", () => {
    status.innerHTML = '<i class="ph ph-dots-three"></i>Editando…';
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        await salvar(l, { notas: notas.value });
        status.innerHTML = '<i class="ph ph-check"></i>Salvo';
      } catch { status.innerHTML = '<i class="ph ph-warning-circle"></i>Erro ao salvar'; }
    }, 700);
  });

  $("#voltar").addEventListener("click", () => $(".app").classList.remove("aberto"));
}

function selecionar(id) {
  const l = estado.leads.find((x) => x.id === id);
  if (!l) return;
  estado.sel = id;
  document.querySelectorAll(".lead").forEach((el) => el.setAttribute("aria-selected", el.dataset.id === id));
  document.querySelector(`.lead[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
  $(".app").classList.add("aberto");
  renderDetalhe(l);
}

// ---------- tema ----------
function aplicarTema(t) {
  if (t) document.documentElement.dataset.theme = t;
  const escuro = t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  $("#tema").innerHTML = `<i class="ph ph-${escuro ? "sun" : "moon"}"></i>`;
}

// ---------- eventos ----------
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
  const i = ids.indexOf(estado.sel);
  const prox = e.key === "ArrowDown" ? Math.min(i + 1, ids.length - 1) : Math.max(i - 1, 0);
  selecionar(ids[i === -1 ? 0 : prox]);
});

// ---------- início ----------
estado.temp = guardar.get("temp") ?? "quente";
aplicarTema(guardar.get("tema"));
carregar().catch(() => ($("#total").textContent = "Erro ao carregar os leads"));
// o bot continua rodando: atualiza a lista a cada minuto sem mexer no lead aberto
setInterval(() => carregar().catch(() => {}), 60000);
