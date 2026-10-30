#!/usr/bin/env python3
"""Painel local: python3 painel.py  ->  http://localhost:8765

Servidor só-stdlib. Front em static/ (index.html, app.css, app.js).
API:
  GET  /api/leads          -> {"leads", "etapas", "motivos"}  (leads do dashboard trazem "reengajar")
  POST /api/lead           <- {"id", "etapa"?, "notas"?, "motivo"?, "prototipo"?, "valor"?, "quadro"?: bool}  (só o que vier)
  GET  /api/bot            -> estado da prospecção (rodando, progresso, log) + nichos
  POST /api/bot/iniciar    <- {"cidades": [...], "nichos": [...], "fonte": "osm"|"google", "loop": bool}
  POST /api/bot/parar
  GET  /api/config         -> {"perfil", "tem_google_key"}
  POST /api/config         <- {"perfil": {...}, "google_key"?: str}
  GET  /api/fila           -> leads na fila de envio, com telefone e mensagem congelada
  POST /api/fila           <- {"ids": [...], "acao": "adicionar"|"remover"|"editar", "mensagem"? (editar, 1 id)}
  POST /api/fila/resultado <- {"id", "status": "enviado"|"falhou", "erro"?}  (chamado por quem envia)
  GET  /api/perfis         -> perfis de venda, o ativo, critérios, variáveis e prévia da mensagem de cada um
  POST /api/perfis         <- {"acao": "salvar", "perfil": {...}} | {"acao": "ativar"|"excluir", "id"}
  POST /api/nichos         <- {"acao": "criar", "nicho": {rotulo, busca, segmento, ticket}} | {"acao": "excluir", "id"}
  POST /api/resposta       <- {"id", "tipo": "interesse"|"recusa"|"automatica", "texto"}  (rotina viu a resposta no WhatsApp)
  GET  /api/followups      -> quem recebe o follow-up hoje, com a mensagem pronta
  POST /api/followups      <- {"id", "status": "enviado"|"falhou", "erro"?}
  POST /api/conversas      <- {"itens": [{"id", "quando": "14:32"|"Ontem"|"terça-feira"|"28/10/2026", "de": "eu"|"lead",
                               "lida"?: bool, "previa"?}]}  (o Claude leu a lista do WhatsApp Web)
  GET  /api/reengajar      -> leads do dashboard em andamento: última mensagem, fila de reengajamento e sugestão
  POST /api/reengajar      <- {"ids": [...], "acao": "adicionar"|"remover"|"editar", "mensagem"? (1 id)}
  POST /api/reengajar/resultado <- {"id", "status": "enviado"|"falhou", "erro"?}
"""
import atexit, json, mimetypes, os, re, sqlite3, subprocess, sys, threading, time
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import bot

RAIZ = bot.RAIZ
STATIC = os.path.join(RAIZ, "static")
BACKUPS = os.path.join(RAIZ, "backups")
LOG = os.path.join(RAIZ, "run.log")
PORTA = int(os.environ.get("PORTA", 8765))
ETAPAS = ["abordagem_pronta", "qualificado", "contatado", "respondeu", "prototipo", "proposta", "negociando", "fechado",
          "perdido", "descartado"]
RESPONDEU = ("respondeu", "prototipo", "proposta", "negociando", "fechado")  # etapas de quem já respondeu
ANDAMENTO = RESPONDEU[:-1]  # no dashboard e ainda sem desfecho
MOTIVOS = ["Já tem site e está satisfeito", "Sem interesse", "Sem orçamento agora", "Contato inválido",
           "Fechou com outro", "Não respondeu", "Nunca contatar"]  # "Nunca contatar": contato pessoal, pedido para sair...

# problema no diagnóstico -> (ícone Phosphor, por que importa)
PROBLEMAS = {
    "sem https": ("lock-open", "Navegador marca como “Não seguro” e espanta o cliente"),
    "não é mobile": ("device-mobile", "Quebra no celular, onde está a maioria das buscas"),
    "lento": ("hourglass", "Demora para abrir e a pessoa desiste"),
    "quase sem conteúdo": ("file-dashed", "Não explica os serviços nem convence"),
    "copyright": ("calendar-x", "Parece abandonado ou desatualizado"),
}


def argumento(diag):
    """-> {"dor": problema a explorar, "pitch": frase de venda, "problemas": [{icone, texto, porque}]}"""
    if diag == "sem site":
        return {"dor": "Não aparece no Google fora do Maps e passa menos credibilidade que o concorrente com site.",
                "pitch": "Presença profissional em poucos dias, sem mensalidade cara, com o cliente chegando direto no seu WhatsApp.",
                "problemas": [{"icone": "globe", "texto": "Sem site", "porque": "Invisível para quem pesquisa fora do Maps"}]}
    if "rede social" in diag:
        return {"dor": "Depende do Instagram: o algoritmo decide quem vê, não aparece no Google e não organiza serviços e preços.",
                "pitch": "Uma página sua, que aparece no Google e leva pro WhatsApp. O Instagram continua como vitrine.",
                "problemas": [{"icone": "instagram-logo", "texto": "Só rede social", "porque": "Alcance controlado pelo algoritmo"}]}
    if "fora do ar" in diag:
        return {"dor": "Quem procura encontra um erro e vai para o concorrente. Provável domínio ou hospedagem vencidos.",
                "pitch": "Hoje vocês estão perdendo clientes. Consigo colocar no ar rapidinho, já moderno e no celular.",
                "problemas": [{"icone": "link-break", "texto": diag[0].upper() + diag[1:], "porque": "Todo clique vira cliente perdido"}]}
    probs = [{"icone": ic, "texto": next(p[0].upper() + p[1:] for p in diag.split(", ") if p.startswith(k)), "porque": pq}
             for k, (ic, pq) in PROBLEMAS.items() if k in diag]
    if not probs:
        return {"dor": "Site aparentemente em ordem. Só vale abordar se o design parecer datado ao abrir.",
                "pitch": "", "problemas": []}
    return {"dor": "O site existe, mas está trabalhando contra o negócio.",
            "pitch": "Modernizo seu site: rápido, bonito no celular e com botão de WhatsApp em destaque.",
            "problemas": probs}


def limpar_funil(c, ct):
    """Tira do caminho quem não vai a lugar nenhum. Roda a cada leitura da lista, então vale também para o passado.
    - número que o WhatsApp recusou -> descartado (Contato inválido)
    - contatado pela fila há mais de `dias_sem_resposta` e ainda sem resposta marcada -> perdido (Não respondeu).
      Com o follow-up ligado, o prazo conta a partir dele, e só depois que ele saiu.
    `ct` é o "contato" do perfil em uso. ponytail: vale para todos os leads, mesmo os de outro perfil."""
    c.execute("""UPDATE leads SET etapa='descartado', motivo='Contato inválido' WHERE envio='falhou'
                 AND etapa IN ('abordagem_pronta', 'qualificado')
                 AND (envio_erro LIKE '%não está no WhatsApp%' OR envio_erro LIKE '%sem WhatsApp%')""")
    agora = datetime.now()
    c.execute("UPDATE leads SET etapa='perdido', motivo='Não respondeu', etapa_em=? WHERE etapa='contatado' AND envio='enviado' AND "
              + ("followup_em < ?" if ct["followup"]["ativo"] else "COALESCE(followup_em, envio_em) < ?"),
              (agora.isoformat(timespec="seconds"), (agora - timedelta(days=ct["dias_sem_resposta"])).isoformat(timespec="seconds")))


# ---------- reengajamento (leads do dashboard) ----------
# O Claude lê a lista de conversas do WhatsApp Web (sem abrir nenhuma) e registra a última mensagem de cada lead do
# dashboard. Quem está parado há `dias` entra na fila de reengajamento com uma mensagem sugerida (rotinas/reengajar.md).
SEMANA = ["segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado", "domingo"]


def quando_whats(rotulo, agora):
    """Horário da lista do WhatsApp ("14:32", "Ontem", "terça-feira", "28/10/2026") -> "AAAA-MM-DD[THH:MM]" ou None."""
    t, hoje = str(rotulo or "").strip().lower(), agora.date()
    if re.fullmatch(r"\d{1,2}:\d{2}", t):
        return f"{hoje}T{t.zfill(5)}"
    if t == "ontem":
        return str(hoje - timedelta(days=1))
    if t in SEMANA:  # na última semana a lista mostra o dia da semana
        return str(hoje - timedelta(days=(hoje.weekday() - SEMANA.index(t)) % 7 or 7))
    m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", t)
    try:
        return str(date(int(m[3]), int(m[2]), int(m[1]))) if m else None
    except ValueError:
        return None


def situacao(r, rg, perfil, agora):
    """Lead do dashboard -> {"parado": dias desde a última mensagem (None sem conferir), "pronto": pode entrar na
    fila, "sugestao": modelo da próxima mensagem do perfil (só quando a última mensagem é sua)}.
    Fica de fora quem tem o próximo passo marcado para depois de hoje (já está combinado) e quem já recebeu as
    3 tentativas sem responder (hora de mover para Perdido)."""
    parado = (agora.date() - date.fromisoformat(r["conversa_em"][:10])).days if r["conversa_em"] else None
    n, msgs = r["reengajamentos"] or 0, rg["mensagens"]
    modelos = [m for m in msgs if m.strip()]
    sugestao = bot.preencher(modelos[n], bot.variaveis(r, perfil)) if r["conversa_de"] == "eu" and n < len(modelos) else None
    pronto = (parado is not None and parado >= rg["dias"] and r["etapa"] in ANDAMENTO and r["reeng"] != "fila"
              and n < len(msgs) and bool(fone_whats(r["telefone"])) and (r["proximo_em"] or "") <= str(agora.date()))
    return {"parado": parado, "pronto": pronto, "sugestao": sugestao, "esgotado": n >= len(msgs)}


def reengajar_lista():
    cfg = bot.carregar_config()
    perfil, todos, agora = cfg.get("perfil", {}), bot.perfis_venda(cfg), datetime.now()
    with bot.db() as c:
        c.row_factory = sqlite3.Row
        rows = [dict(r) for r in c.execute(f"SELECT * FROM leads WHERE quadro_em IS NOT NULL AND etapa IN "
                                           f"({','.join('?' * len(ANDAMENTO))}) ORDER BY conversa_em", ANDAMENTO)]
    campos = ("id", "nome", "nicho", "cidade", "etapa", "notas", "prototipo", "valor", "proximo", "proximo_em",
              "conversa_em", "conversa_de", "conversa_lida", "conversa_previa", "conversa_conferida_em",
              "reeng", "reeng_msg", "reeng_em", "reengajamentos")
    itens = []
    for r in rows:
        rg = (todos.get(r["perfil_venda"]) or todos[bot.PADRAO])["contato"]["reengajamento"]
        itens.append({**{k: r[k] for k in campos}, "whatsapp": fone_whats(r["telefone"]), "dias": rg["dias"],
                      **situacao(r, rg, perfil, agora)})
    return {"itens": itens}


def registrar_conversas(d):
    itens = d.get("itens")
    if not isinstance(itens, list) or not itens:
        raise ValueError("Envie os itens lidos no WhatsApp.")
    agora = datetime.now()
    with bot.db() as c:
        for it in itens:
            it = it if isinstance(it, dict) else {}
            em = quando_whats(it.get("quando"), agora)
            if not em or it.get("de") not in ("eu", "lead") or not isinstance(it.get("id"), str):
                raise ValueError(f"Item inválido: {it}")
            r = c.execute("SELECT reeng_em FROM leads WHERE id=?", (it["id"],)).fetchone()
            if not r:
                raise ValueError(f"Lead não encontrado: {it['id']}")
            dele = it["de"] == "lead" and em > (r[0] or "")  # ele falou depois do último reengajamento: recomeça
            c.execute("""UPDATE leads SET conversa_em=?, conversa_de=?, conversa_lida=?, conversa_previa=?,
                         conversa_conferida_em=?, reengajamentos=CASE WHEN ? THEN 0 ELSE reengajamentos END,
                         reeng_msg=CASE WHEN ? AND reeng='fila' THEN NULL ELSE reeng_msg END,
                         reeng=CASE WHEN ? AND reeng='fila' THEN NULL ELSE reeng END WHERE id=?""",
                      (em, it["de"], "1" if it["de"] == "eu" and it.get("lida") else None,
                       str(it.get("previa") or "")[:300] or None, agora.isoformat(timespec="seconds"), dele, dele, dele, it["id"]))
    return reengajar_lista()


def mexer_reengajar(d):
    ids, acao = d.get("ids"), d.get("acao")
    if not isinstance(ids, list) or not ids or not all(isinstance(i, str) for i in ids):
        raise ValueError("Selecione ao menos um lead.")
    texto = str(d.get("mensagem") or "").strip()[:4000]
    with bot.db() as c:
        if acao == "remover":
            c.executemany("UPDATE leads SET reeng=NULL, reeng_msg=NULL WHERE id=? AND reeng='fila'", [(i,) for i in ids])
        elif acao == "editar":
            if len(ids) != 1 or not texto:
                raise ValueError("Escreva a mensagem.")
            if not c.execute("UPDATE leads SET reeng_msg=? WHERE id=? AND reeng='fila'", (texto, ids[0])).rowcount:
                raise ValueError("Lead não está na fila de reengajamento.")
        elif acao == "adicionar":
            if texto and len(ids) != 1:
                raise ValueError("Mensagem escrita vale para um lead por vez.")
            prontos = {x["id"]: x for x in reengajar_lista()["itens"] if x["pronto"]}
            agora = datetime.now().isoformat(timespec="seconds")
            for i in ids:  # só quem está parado há `dias`, com WhatsApp, fora da fila e com tentativas sobrando
                msg = i in prontos and (texto or prontos[i]["sugestao"])
                if msg:
                    c.execute("UPDATE leads SET reeng='fila', reeng_msg=?, reeng_em=? WHERE id=?", (msg, agora, i))
        else:
            raise ValueError("Ação inválida.")
    return reengajar_lista()


def resultado_reengajar(d):
    status = d.get("status")
    if status not in ("enviado", "falhou") or not isinstance(d.get("id"), str):
        raise ValueError("dados inválidos")
    agora = datetime.now()
    ts = agora.isoformat(timespec="seconds")
    with bot.db() as c:
        r = c.execute("SELECT reeng_msg, notas FROM leads WHERE id=? AND reeng='fila'", (d["id"],)).fetchone()
        if not r:
            raise ValueError("Lead não está na fila de reengajamento.")
        nota = f"{agora:%d/%m} reengajamento " + ("enviado" if status == "enviado" else f"não enviado: {str(d.get('erro') or 'erro')[:200]}")
        notas = (r[1] + "\n" if r[1] else "") + nota
        if status == "enviado":  # agora a última mensagem é sua
            c.execute("""UPDATE leads SET reeng='enviado', reeng_em=?, reengajamentos=COALESCE(reengajamentos, 0) + 1,
                         conversa_em=?, conversa_de='eu', conversa_lida=NULL, conversa_previa=?, notas=? WHERE id=?""",
                      (ts, ts[:16], r[0][:300], notas, d["id"]))
        else:
            c.execute("UPDATE leads SET reeng='falhou', reeng_em=?, notas=? WHERE id=?", (ts, notas, d["id"]))


def leads():
    if not os.path.exists(bot.DB):
        return []
    cfg = bot.carregar_config()
    perfil, todos, agora = cfg.get("perfil", {}), bot.perfis_venda(cfg), datetime.now()
    with bot.db() as c:
        limpar_funil(c, bot.perfil_venda(None, cfg)["contato"])
        c.row_factory = sqlite3.Row
        rows = [dict(r) for r in c.execute(
            "SELECT * FROM leads ORDER BY score DESC, (link_whatsapp IS NULL), avaliacoes DESC")]
    for r in rows:
        diag = r["diagnostico"] or ""
        pv = todos.get(r["perfil_venda"]) or todos[bot.PADRAO]
        landing = pv["id"] == bot.PADRAO  # "como negociar" e "o que propor" são da venda de landing pages
        r["perfil_venda"] = pv["id"]
        r["argumento"] = argumento(diag) if landing else {**argumento(diag), "dor": "", "pitch": ""}
        r["proposta"] = bot.nicho_info(r["nicho"])["proposta"] if landing else []
        if r["quadro_em"]:  # {prototipo} e {preco} ficam para a tela trocar pelo que você digitar
            v = {**bot.variaveis(r, perfil), "prototipo": "{prototipo}", "preco": "{preco}"}
            r["propostas"] = [{"titulo": x["titulo"], "texto": bot.preencher(x["texto"], v)} for x in pv["contato"]["propostas"]]
            r["reengajar"] = situacao(r, pv["contato"]["reengajamento"], perfil, agora)
        r["mensagem"] = bot.mensagem(r, perfil, pv=pv)  # sempre com seus dados atuais
        r["temperatura"] = bot.temperatura(r["score"] or 0, pv)
        r["analise"] = json.loads(r["analise"]) if r["analise"] else []
        r["contatavel"] = r["tel_tipo"] in ("whatsapp", "celular")
    return rows


# ---------- fila de contato automático ----------
def fone_whats(tel):
    """Mesmo critério do bot.link_whatsapp: só números com DDD viram destino."""
    d = re.sub(r"\D", "", tel or "")
    if d and not d.startswith("55"):
        d = "55" + d.lstrip("0")
    return d if len(d) >= 12 else ""


def fila():
    with bot.db() as c:
        c.row_factory = sqlite3.Row
        rows = [dict(r) for r in c.execute(
            "SELECT id, nome, nicho, cidade, telefone, score, envio, envio_msg, envio_em, envio_erro FROM leads "
            "WHERE envio IS NOT NULL ORDER BY envio='fila' DESC, envio_em DESC, score DESC")]
        dia = datetime.now().strftime("%Y-%m-%d")
        hoje = c.execute("SELECT (SELECT COUNT(*) FROM leads WHERE envio='enviado' AND envio_em >= ?) + "
                         "(SELECT COUNT(*) FROM leads WHERE followup_em >= ?)", (dia, dia)).fetchone()[0]
    for r in rows:
        r["whatsapp"] = fone_whats(r["telefone"])
    return {"itens": rows, "enviados_hoje": hoje}


def mexer_fila(d):
    ids = d.get("ids")
    if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids) or not ids:
        raise ValueError("Selecione ao menos um lead.")
    if d.get("acao") == "remover":
        with bot.db() as c:
            c.executemany("UPDATE leads SET envio=NULL, envio_msg=NULL WHERE id=? AND envio='fila'", [(i,) for i in ids])
        return
    if d.get("acao") == "editar":  # a rotina ajusta o texto congelado seguindo as instruções de contato do perfil
        texto = d.get("mensagem")
        abertura, _, resto = (texto or "").strip().partition("\n\n") if isinstance(texto, str) else ("", "", "")
        if len(ids) != 1 or not abertura or not resto.strip():
            raise ValueError("A mensagem precisa de uma saudação curta, uma linha em branco e o resto do texto.")
        with bot.db() as c:
            if not c.execute("UPDATE leads SET envio_msg=? WHERE id=? AND envio='fila'", (texto.strip()[:4000], ids[0])).rowcount:
                raise ValueError("Lead não está na fila.")
        return
    if d.get("acao") != "adicionar":
        raise ValueError("Ação inválida.")
    cfg = bot.carregar_config()
    perfil = cfg.get("perfil", {})
    if not (perfil.get("nome") or "").strip():
        raise ValueError("Preencha seu nome em Nova prospecção → Seu perfil antes de montar a fila.")
    with bot.db() as c:
        c.row_factory = sqlite3.Row
        for i in ids:
            r = c.execute("SELECT * FROM leads WHERE id=?", (i,)).fetchone()
            if not r or r["tel_tipo"] not in ("whatsapp", "celular") or r["envio"] in ("enviado", "fila") \
                    or r["etapa"] in ("descartado", "perdido"):
                continue  # descartado (inclui "Nunca contatar") não entra; quem já está na fila mantém o texto
            # congela a mensagem como está agora (seus dados, perfil de venda e saudação do momento)
            msg = bot.mensagem(dict(r), perfil, pv=bot.perfil_venda(r["perfil_venda"] or bot.PADRAO, cfg))
            c.execute("UPDATE leads SET envio='fila', envio_msg=?, envio_erro=NULL WHERE id=?", (msg, i))


def resultado_envio(d):
    status = d.get("status")
    if status not in ("enviado", "falhou") or not isinstance(d.get("id"), str):
        raise ValueError("dados inválidos")
    agora = datetime.now().isoformat(timespec="seconds")
    with bot.db() as c:
        n = c.execute("UPDATE leads SET envio=?, envio_em=?, envio_erro=? WHERE id=? AND envio='fila'",
                      (status, agora, str(d.get("erro") or "")[:300] or None, d["id"])).rowcount
        if n and status == "enviado":
            c.execute("UPDATE leads SET etapa='contatado' WHERE id=? AND etapa IN ('abordagem_pronta','qualificado')", (d["id"],))
    if not n:
        raise ValueError("Lead não está na fila.")


# ---------- processo do bot ----------
BOT = {"proc": None, "params": None, "inicio": None}


def estado_bot():
    p = BOT["proc"]
    rodando = bool(p and p.poll() is None)
    linhas = []
    if BOT["inicio"] and os.path.exists(LOG):
        with open(LOG, encoding="utf-8", errors="ignore") as f:
            linhas = f.read().splitlines()
    feitos = [m for m in (re.search(r"Buscando (\d+)/(\d+): (.+)", l) for l in linhas) if m]
    novos = sum(int(m.group(1)) for m in (re.search(r"\+(\d+) leads", l) for l in linhas) if m)
    ultimo = feitos[-1] if feitos else None
    marcos = [l for l in linhas if "Buscando" in l or "Revisando" in l or "Revisão do Claude" in l]
    revisando = rodando and bool(marcos) and "Revisando" in marcos[-1]
    return {
        "rodando": rodando,
        "status": "rodando" if rodando else ("concluido" if p and p.returncode == 0 else "parado" if p else "ocioso"),
        "aguardando": rodando and bool(linhas) and "dormindo" in linhas[-1],
        "params": BOT["params"],
        "inicio": BOT["inicio"],
        "atual": int(ultimo.group(1)) if ultimo else 0,
        "total": int(ultimo.group(2)) if ultimo else len((BOT["params"] or {}).get("cidades", [])) * len((BOT["params"] or {}).get("nichos", [])),
        "etapa": "Claude revisando os leads novos com as instruções do perfil" if revisando else ultimo.group(3) if ultimo else "",
        "revisando": revisando,
        "novos": novos,
        "avisos": sum("falhou" in l for l in linhas),
        "log": linhas[-40:],
        "nichos": [{"id": k, "rotulo": v["rotulo"], "extra": v.get("extra", False)} for k, v in bot.nichos().items()],
        "intervalo_horas": bot.INTERVALO_HORAS,
    }


def iniciar_bot(d):
    if BOT["proc"] and BOT["proc"].poll() is None:
        raise ValueError("A prospecção já está rodando.")
    cidades = [c.strip() for c in d.get("cidades", []) if isinstance(c, str) and c.strip()]
    nichos = [n for n in d.get("nichos", []) if n in bot.nichos()]
    if not cidades or any(re.search(r'["\\,]', c) or len(c) > 60 for c in cidades):
        raise ValueError("Informe ao menos uma cidade válida.")
    if not nichos:
        raise ValueError("Escolha ao menos um nicho.")
    env = {k: v for k, v in os.environ.items() if k != "GOOGLE_PLACES_KEY"}
    if d.get("fonte") == "google":
        key = bot.carregar_config().get("google_key")
        if not key:
            raise ValueError("Salve a chave do Google Places antes de usar essa fonte.")
        env["GOOGLE_PLACES_KEY"] = key
    cmd = [sys.executable, "-u", "-X", "utf8", os.path.join(RAIZ, "bot.py"), "--cidades", ",".join(cidades),
           "--nichos", ",".join(nichos), "--fonte", "google" if d.get("fonte") == "google" else "osm",
           "--perfil", bot.perfil_venda()["id"], "--revisar"] + (["--loop"] if d.get("loop") else [])
    saida = open(LOG, "w", encoding="utf-8")
    BOT.update(proc=subprocess.Popen(cmd, stdout=saida, stderr=subprocess.STDOUT, env=env, cwd=RAIZ),
               params={"cidades": cidades, "nichos": nichos, "fonte": d.get("fonte", "osm"), "loop": bool(d.get("loop"))},
               inicio=time.time())


def parar_bot():
    p = BOT["proc"]
    if p and p.poll() is None:
        p.terminate()
        try:
            p.wait(5)
        except subprocess.TimeoutExpired:
            p.kill()


atexit.register(parar_bot)


def salvar_config(d):
    cfg = bot.carregar_config()
    perfil = d.get("perfil")
    if isinstance(perfil, dict):
        cfg["perfil"] = {k: str(perfil.get(k, ""))[:200] for k in ("nome", "funcao", "portfolio")}
    if isinstance(d.get("google_key"), str):
        cfg["google_key"] = d["google_key"].strip()
    bot.gravar_config(cfg)


def salvar_lead(d):
    if not isinstance(d.get("id"), str) or d.get("etapa", ETAPAS[0]) not in ETAPAS:
        raise ValueError("dados inválidos")
    if d.get("proximo_em") and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(d["proximo_em"])):
        raise ValueError("Data inválida.")
    agora = datetime.now().isoformat(timespec="seconds")
    sets = [(f"{k}=?", (str(d[k] or "")[:4000] or None,))
            for k in ("notas", "motivo", "prototipo", "valor", "proximo", "proximo_em") if k in d]
    if "etapa" in d:  # etapa_em só muda quando a etapa muda (o UPDATE enxerga a etapa antiga)
        sets += [("etapa_em=CASE WHEN etapa IS ? THEN etapa_em ELSE ? END", (d["etapa"], agora)), ("etapa=?", (d["etapa"],))]
    if d.get("quadro") or d.get("etapa") in RESPONDEU:
        sets.append(("respondeu_em=COALESCE(respondeu_em, ?)", (agora,)))
    if "quadro" in d:  # entra no dashboard (guarda a data da 1ª vez) ou sai dele
        sets.append(("quadro_em=COALESCE(quadro_em, ?)", (agora,)) if d["quadro"] else ("quadro_em=NULL", ()))
    if not sets:
        raise ValueError("dados inválidos")
    with bot.db() as c:
        return c.execute(f"UPDATE leads SET {', '.join(x for x, _ in sets)} WHERE id=?",
                         (*[v for _, vs in sets for v in vs], d["id"])).rowcount


def registrar_resposta(d):
    """A rotina viu a resposta na lista de conversas do WhatsApp (só a prévia, sem abrir a conversa).
    interesse -> Respondeu, no dashboard · recusa -> Perdido (Sem interesse) · automatica -> só anota."""
    tipo, texto = d.get("tipo"), str(d.get("texto") or "").strip()[:500]
    if tipo not in ("interesse", "recusa", "automatica") or not isinstance(d.get("id"), str):
        raise ValueError("dados inválidos")
    agora = datetime.now()
    ts = agora.isoformat(timespec="seconds")
    with bot.db() as c:
        r = c.execute("SELECT etapa, motivo, notas FROM leads WHERE id=?", (d["id"],)).fetchone()
        if not r:
            raise ValueError("Lead não encontrado.")
        etapa, motivo, notas = r
        if texto and f"“{texto}”" in (notas or ""):  # as duas rotinas podem ver a mesma conversa não lida
            return etapa
        nota = f"{agora:%d/%m} {dict(interesse='respondeu', recusa='recusou', automatica='resposta automática')[tipo]}" + \
               (f": “{texto}”" if texto else "")
        c.execute("UPDATE leads SET notas=? WHERE id=?", ((notas + "\n" if notas else "") + nota, d["id"]))
        if tipo != "automatica":  # voltou a falar: a última mensagem é dele, a sequência recomeça e sai da fila
            c.execute("""UPDATE leads SET conversa_em=?, conversa_de='lead', conversa_lida=NULL, conversa_previa=?,
                         reengajamentos=0, reeng_msg=CASE WHEN reeng='fila' THEN NULL ELSE reeng_msg END,
                         reeng=CASE WHEN reeng='fila' THEN NULL ELSE reeng END WHERE id=?""", (ts[:16], texto or None, d["id"]))
        aguardando = etapa in ("abordagem_pronta", "qualificado", "contatado") or (etapa == "perdido" and motivo == "Não respondeu")
        if tipo == "interesse" and aguardando:
            etapa = "respondeu"
            c.execute("""UPDATE leads SET etapa='respondeu', motivo=NULL, etapa_em=?, quadro_em=COALESCE(quadro_em, ?),
                         respondeu_em=COALESCE(respondeu_em, ?) WHERE id=?""", (ts, ts, ts, d["id"]))
        elif tipo == "recusa" and aguardando:
            etapa = "perdido"
            c.execute("UPDATE leads SET etapa='perdido', motivo='Sem interesse', etapa_em=?, respondeu_em=COALESCE(respondeu_em, ?) "
                      "WHERE id=?", (ts, ts, d["id"]))
    return etapa


def followups():
    """Quem recebe o follow-up: contatado pela fila, sem resposta há `dias` e com o follow-up ligado no perfil dele."""
    cfg = bot.carregar_config()
    perfil, todos = cfg.get("perfil", {}), bot.perfis_venda(cfg)
    with bot.db() as c:
        c.row_factory = sqlite3.Row
        rows = [dict(r) for r in c.execute(
            "SELECT * FROM leads WHERE etapa='contatado' AND envio='enviado' AND followup_em IS NULL ORDER BY envio_em")]
    itens = []
    for r in rows:
        f = (todos.get(r["perfil_venda"]) or todos[bot.PADRAO])["contato"]["followup"]
        if f["ativo"] and fone_whats(r["telefone"]) and r["envio_em"] < (datetime.now() - timedelta(days=f["dias"])).isoformat():
            itens.append({"id": r["id"], "nome": r["nome"], "cidade": r["cidade"], "whatsapp": fone_whats(r["telefone"]),
                          "mensagem": bot.preencher(f["mensagem"], bot.variaveis(r, perfil))})
    return {"itens": itens}


def resultado_followup(d):
    if d.get("status") not in ("enviado", "falhou") or not isinstance(d.get("id"), str):
        raise ValueError("dados inválidos")
    agora = datetime.now()
    nota = f"{agora:%d/%m} follow-up não enviado: {str(d.get('erro') or 'erro')[:200]}" if d["status"] == "falhou" else None
    with bot.db() as c:  # falha também conta como feito, para não tentar todo dia
        n = c.execute("UPDATE leads SET followup_em=?, notas=CASE WHEN ? IS NULL THEN notas ELSE COALESCE(notas || char(10), '') || ? END "
                      "WHERE id=? AND etapa='contatado' AND followup_em IS NULL",
                      (agora.isoformat(timespec="seconds"), nota, nota, d["id"])).rowcount
    if not n:
        raise ValueError("Lead não está esperando follow-up.")


def mexer_nichos(d):
    with TRAVA:
        cfg = bot.carregar_config()
        extras = [x for x in cfg.get("nichos_extras", []) if x.get("id")]
        if d.get("acao") == "criar":
            n = d.get("nicho") if isinstance(d.get("nicho"), dict) else {}
            rotulo = str(n.get("rotulo") or "").strip()[:40]
            busca = re.sub(r"[^\w\s-]", "", str(n.get("busca") or rotulo)).strip()[:40]
            segmento = str(n.get("segmento") or "").strip()[:60]
            if len(rotulo) < 2 or len(busca) < 3:
                raise ValueError("Informe o nome do nicho e o termo de busca.")
            if not segmento:
                raise ValueError("Diga como chamar esses negócios no plural (ex.: imobiliárias).")
            id_ = "x_" + re.sub(r"[^a-z0-9]+", "_", bot.sem_acento(rotulo)).strip("_")
            if id_ in bot.nichos():
                raise ValueError("Já existe um nicho com esse nome.")
            extras.append({"id": id_, "rotulo": rotulo, "busca": busca, "segmento": segmento,
                           "ticket": n.get("ticket") if n.get("ticket") in (5, 10, 15) else 10})
        elif d.get("acao") == "excluir":
            extras = [x for x in extras if x["id"] != d.get("id")]
            for p in cfg.get("perfis_venda", []):
                p["prospeccao"]["nichos"] = [x for x in p["prospeccao"]["nichos"] if x != d.get("id")]
        else:
            raise ValueError("Ação inválida.")
        cfg["nichos_extras"] = extras
        bot.gravar_config(cfg)
    return estado_bot()


def backup(manter=14):
    """Uma cópia do banco por dia em backups/, guardando as últimas `manter`. A API de backup do SQLite é segura
    mesmo com o bot gravando."""
    if not os.path.exists(bot.DB):
        return
    os.makedirs(BACKUPS, exist_ok=True)
    destino = os.path.join(BACKUPS, f"leads-{datetime.now():%Y-%m-%d}.db")
    if not os.path.exists(destino):
        origem, copia = sqlite3.connect(bot.DB), sqlite3.connect(destino)
        try:
            origem.backup(copia)
        finally:
            origem.close()
            copia.close()
    for velho in sorted(f for f in os.listdir(BACKUPS) if f.startswith("leads-"))[:-manter]:
        os.remove(os.path.join(BACKUPS, velho))


def backups_diarios():
    while True:
        try:
            backup()
        except Exception as e:
            print(f"backup falhou: {e}", flush=True)
        time.sleep(3600)


# ---------- perfis de venda ----------
def inteiro(v, lo, hi, nome):
    try:
        n = int(v)
    except (TypeError, ValueError):
        raise ValueError(f"{nome}: use um número inteiro.")
    if not lo <= n <= hi:
        raise ValueError(f"{nome}: use um valor entre {lo} e {hi}.")
    return n


def validar_perfil(p):
    """Perfil vindo da tela -> perfil limpo, ou ValueError com a mensagem para mostrar."""
    if not isinstance(p, dict) or not re.fullmatch(r"[a-z0-9_-]{1,40}", str(p.get("id") or "")):
        raise ValueError("Perfil inválido.")
    p = bot.completar(p)
    pr, q, ct = p["prospeccao"], p["qualificacao"], p["contato"]
    texto = lambda v, n=4000: str(v or "")[:n]
    nome = texto(p["nome"], 60).strip()
    if not nome:
        raise ValueError("Dê um nome ao perfil.")
    nichos = [n for n in pr["nichos"] if n in bot.nichos()] if isinstance(pr["nichos"], list) else []
    if not nichos:
        raise ValueError("Escolha ao menos um nicho.")
    cidades = []
    for cid in pr["cidades"] if isinstance(pr["cidades"], list) else []:
        cid = cid if isinstance(cid, dict) else {"nome": cid}
        nm = texto(cid.get("nome"), 60).strip()
        if nm and not re.search(r'["\\,]', nm) and all(bot.sem_acento(nm) != bot.sem_acento(x["nome"]) for x in cidades):
            cidades.append({"nome": nm, "feita": texto(cid.get("feita"), 10)})
    pontos = {k: inteiro(q["pontos"].get(k), -100, 100, f"Pontos de “{rot}”") for k, rot in bot.SINAIS.items()}
    faixas = {k: inteiro(q[k], 0, 100, rot) for k, rot in
              (("quente", "Quente a partir de"), ("morno", "Morno a partir de"), ("minimo", "Descartar abaixo de"))}
    if not faixas["minimo"] <= faixas["morno"] <= faixas["quente"]:
        raise ValueError("As faixas precisam crescer: descartar ≤ morno ≤ quente.")
    msg = texto(ct["mensagem"]).strip()
    abertura, _, resto = msg.partition("\n\n")
    if "{saudacao}" not in abertura or not resto.strip():
        raise ValueError("Comece a mensagem com um parágrafo curto que tenha {saudacao} e deixe uma linha em branco: "
                         "ele é enviado sozinho, antes do resto.")
    fu = ct["followup"]
    followup = {"ativo": fu["ativo"] is True, "dias": inteiro(fu["dias"], 1, 30, "Dias até o follow-up"),
                "mensagem": texto(fu["mensagem"], 2000).strip()}
    if followup["ativo"] and not followup["mensagem"]:
        raise ValueError("Escreva a mensagem de follow-up antes de ligar.")
    rg = ct["reengajamento"]
    reengajamento = {"dias": inteiro(rg["dias"], 1, 30, "Dias até reengajar"),  # sempre 3 caixas; vazia é pulada
                     "mensagens": [texto(m, 2000).strip() for m in ((rg["mensagens"] if isinstance(rg["mensagens"], list) else []) + [""] * 3)[:3]]}
    propostas = [{"titulo": texto(x.get("titulo"), 40).strip(), "texto": texto(x.get("texto"), 2000).strip()}
                 for x in (ct["propostas"] if isinstance(ct["propostas"], list) else [])[:8]
                 if isinstance(x, dict) and (str(x.get("titulo") or "").strip() or str(x.get("texto") or "").strip())]
    return {"id": p["id"], "nome": nome,
            "prospeccao": {"cidades": cidades, "nichos": nichos, "fonte": "google" if pr["fonte"] == "google" else "osm",
                           "instrucoes": texto(pr["instrucoes"])},
            "qualificacao": {"pontos": pontos, **faixas, "instrucoes": texto(q["instrucoes"])},
            "contato": {"mensagem": msg, "limite_dia": inteiro(ct["limite_dia"], 1, 60, "Limite por dia"),
                        "espera_s": inteiro(ct["espera_s"], 5, 120, "Espera entre as duas mensagens"),
                        "dias_sem_resposta": inteiro(ct["dias_sem_resposta"], 1, 60, "Dias sem resposta"),
                        "followup": followup, "reengajamento": reengajamento, "propostas": propostas,
                        "instrucoes": texto(ct["instrucoes"])}}


def perfis():
    cfg = bot.carregar_config()
    todos = bot.perfis_venda(cfg)
    prontos = []
    if os.path.exists(bot.DB):
        with bot.db() as c:
            c.row_factory = sqlite3.Row
            prontos = [dict(r) for r in c.execute("SELECT * FROM leads WHERE etapa='abordagem_pronta' ORDER BY score DESC LIMIT 200")]

    def amostra(p):  # um lead pronto de um nicho do perfil; sem nenhum, um exemplo com o 1º nicho e a 1ª cidade dele
        pr = p["prospeccao"]
        return next((r for r in prontos if r["nicho"] in pr["nichos"]), None) or {
            "nome": "Empresa Exemplo", "nicho": pr["nichos"][0], "diagnostico": "sem site",
            "cidade": pr["cidades"][0]["nome"] if pr["cidades"] else "sua cidade"}

    exemplos = {k: amostra(p) for k, p in todos.items()}
    return {"perfis": list(todos.values()), "ativo": bot.perfil_venda(None, cfg)["id"], "padrao": bot.PADRAO,
            "sinais": bot.SINAIS, "variaveis": bot.VARIAVEIS, "amostra": {k: a["nome"] for k, a in exemplos.items()},
            "previa": {k: bot.mensagem(exemplos[k], cfg.get("perfil", {}), pv=p) for k, p in todos.items()}}


TRAVA = threading.Lock()  # autosave da tela pode chegar enquanto o anterior ainda requalifica


def mexer_perfis(d):
    with TRAVA:
        cfg = bot.carregar_config()
        salvos, todos = [p for p in cfg.get("perfis_venda", []) if p.get("id")], bot.perfis_venda(cfg)
        ativo, acao, repontuar = bot.perfil_venda(None, cfg)["id"], d.get("acao"), None
        if acao == "salvar":
            p = validar_perfil(d.get("perfil"))
            cfg["perfis_venda"] = [p if x["id"] == p["id"] else x for x in salvos] + \
                                  ([] if any(x["id"] == p["id"] for x in salvos) else [p])
            if p["id"] == ativo and p["qualificacao"] != todos[ativo]["qualificacao"]:
                repontuar = p
        elif acao == "ativar":
            if d.get("id") not in todos:
                raise ValueError("Perfil não encontrado.")
            cfg["perfil_ativo"] = d["id"]
            repontuar = todos[d["id"]]
        elif acao == "excluir":
            if d.get("id") == bot.PADRAO:
                raise ValueError("O perfil padrão não pode ser excluído.")
            if d.get("id") == ativo:
                raise ValueError("Ative outro perfil antes de excluir este.")
            cfg["perfis_venda"] = [x for x in salvos if x["id"] != d.get("id")]
        else:
            raise ValueError("Ação inválida.")
        bot.gravar_config(cfg)
        n = None
        if repontuar:
            with bot.db() as c:
                n = bot.repontuar(c, repontuar)
    return {**perfis(), "requalificados": n}


# ---------- HTTP ----------
class H(BaseHTTPRequestHandler):
    def responder(self, corpo, tipo="application/json; charset=utf-8", status=200):
        b = corpo if isinstance(corpo, bytes) else (corpo if isinstance(corpo, str) else json.dumps(corpo, ensure_ascii=False)).encode()
        self.send_response(status)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(b)

    def erro(self, msg, status=400):
        self.responder({"erro": msg}, status=status)

    def corpo(self):
        return json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")

    def do_GET(self):
        if self.path == "/api/leads":
            return self.responder({"leads": leads(), "etapas": ETAPAS, "motivos": MOTIVOS})
        if self.path == "/api/bot":
            return self.responder(estado_bot())
        if self.path == "/api/fila":
            return self.responder(fila())
        if self.path == "/api/perfis":
            return self.responder(perfis())
        if self.path == "/api/followups":
            return self.responder(followups())
        if self.path == "/api/reengajar":
            return self.responder(reengajar_lista())
        if self.path == "/api/config":
            cfg = bot.carregar_config()
            return self.responder({"perfil": cfg.get("perfil", {}), "tem_google_key": bool(cfg.get("google_key"))})
        nome = "index.html" if self.path == "/" else self.path.lstrip("/").split("?")[0]
        arq = os.path.realpath(os.path.join(STATIC, nome))
        if not arq.startswith(STATIC + os.sep) or not os.path.isfile(arq):  # bloqueia ../
            return self.erro("não encontrado", 404)
        tipo = (mimetypes.guess_type(arq)[0] or "application/octet-stream") + "; charset=utf-8"
        with open(arq, "rb") as f:
            self.responder(f.read(), tipo)

    def do_POST(self):
        try:
            d = self.corpo()
            assert isinstance(d, dict)
        except Exception:
            return self.erro("JSON inválido")
        try:
            if self.path == "/api/lead":
                n = salvar_lead(d)
                return self.responder({"ok": bool(n)}, status=200 if n else 404)
            if self.path == "/api/perfis":
                return self.responder(mexer_perfis(d))
            if self.path == "/api/nichos":
                return self.responder(mexer_nichos(d))
            if self.path == "/api/resposta":
                return self.responder({"etapa": registrar_resposta(d)})
            if self.path == "/api/followups":
                resultado_followup(d)
                return self.responder({"ok": True})
            if self.path == "/api/bot/iniciar":
                iniciar_bot(d)
                return self.responder(estado_bot())
            if self.path == "/api/bot/parar":
                parar_bot()
                return self.responder(estado_bot())
            if self.path == "/api/config":
                salvar_config(d)
                return self.responder({"ok": True})
            if self.path == "/api/fila":
                mexer_fila(d)
                return self.responder(fila())
            if self.path == "/api/fila/resultado":
                resultado_envio(d)
                return self.responder({"ok": True})
            if self.path == "/api/conversas":
                return self.responder(registrar_conversas(d))
            if self.path == "/api/reengajar":
                return self.responder(mexer_reengajar(d))
            if self.path == "/api/reengajar/resultado":
                resultado_reengajar(d)
                return self.responder({"ok": True})
        except ValueError as e:
            return self.erro(str(e))
        self.erro("não encontrado", 404)

    def log_message(self, *a):
        pass


def demo():
    a = argumento("sem https, não é mobile")
    assert [p["icone"] for p in a["problemas"]] == ["lock-open", "device-mobile"], a
    assert argumento("lento (6s)")["problemas"][0]["texto"] == "Lento (6s)"
    assert argumento("site ok")["problemas"] == []
    assert argumento("site fora do ar (domínio não existe)")["problemas"][0]["icone"] == "link-break"
    for ruim in ([], ["Campinas\""], ["a,b"]):
        try:
            iniciar_bot({"cidades": ruim, "nichos": ["dentista"]})
            raise AssertionError(ruim)
        except ValueError:
            pass
    assert fone_whats("(19) 3342-5050") == "551933425050" and fone_whats("123") == "" and fone_whats(None) == ""
    assert "Nunca contatar" in MOTIVOS
    ok = validar_perfil({"id": "sis", "nome": " Sistemas ", "prospeccao": {"cidades": ["Cambé", {"nome": "cambe"}, "a,b"]}})
    assert ok["nome"] == "Sistemas" and ok["prospeccao"]["cidades"] == [{"nome": "Cambé", "feita": ""}], ok
    assert ok["contato"]["reengajamento"]["dias"] == 3 and len(ok["contato"]["reengajamento"]["mensagens"]) == 3
    assert validar_perfil({"id": "x", "contato": {"reengajamento": {"mensagens": ["só uma"]}}}
                          )["contato"]["reengajamento"]["mensagens"] == ["só uma", "", ""]
    for ruim in ({"id": "A B"}, {"id": "x", "nome": ""}, {"id": "x", "prospeccao": {"nichos": ["xyz"]}},
                 {"id": "x", "qualificacao": {"quente": 30}}, {"id": "x", "qualificacao": {"pontos": {"fixo": "a"}}},
                 {"id": "x", "contato": {"mensagem": "Olá {empresa}\n\nresto"}}, {"id": "x", "contato": {"mensagem": "{saudacao}!"}},
                 {"id": "x", "contato": {"reengajamento": {"dias": 0}}}):
        try:
            validar_perfil(ruim)
            raise AssertionError(ruim)
        except ValueError:
            pass
    import tempfile
    bot.DB = os.path.join(tempfile.mkdtemp(), "t.db")
    with bot.db() as c:
        velho, novo = [(datetime.now() - timedelta(days=d)).isoformat() for d in (8, 2)]
        c.executemany("INSERT INTO leads(id, etapa, envio, envio_em, envio_erro) VALUES(?,?,?,?,?)", [
            ("a", "contatado", "enviado", velho, None), ("b", "contatado", "enviado", novo, None),
            ("c", "abordagem_pronta", "falhou", novo, "Número não está no WhatsApp"),
            ("d", "abordagem_pronta", "falhou", novo, "timeout"), ("e", "respondeu", "enviado", velho, None)])
        sem_fu = {"dias_sem_resposta": 7, "followup": {"ativo": False}}
        limpar_funil(c, sem_fu)
        assert dict(c.execute("SELECT id, etapa FROM leads").fetchall()) == {
            "a": "perdido", "b": "contatado", "c": "descartado", "d": "abordagem_pronta", "e": "respondeu"}
        c.execute("INSERT INTO leads(id, etapa, envio, envio_em) VALUES('f', 'contatado', 'enviado', ?)", (velho,))
        c.commit()
        limpar_funil(c, {"dias_sem_resposta": 7, "followup": {"ativo": True}})  # follow-up ainda não saiu: espera
        assert c.execute("SELECT etapa FROM leads WHERE id='f'").fetchone()[0] == "contatado"
    assert salvar_lead({"id": "b", "etapa": "prototipo", "proximo": "Ligar", "proximo_em": "2026-11-02"}) == 1
    with bot.db() as c:
        assert c.execute("SELECT etapa, proximo_em, respondeu_em IS NOT NULL, etapa_em IS NOT NULL FROM leads WHERE id='b'"
                         ).fetchone() == ("prototipo", "2026-11-02", 1, 1)
    for ruim in ({"id": "b", "proximo_em": "02/11"}, {"id": "b", "etapa": "xyz"}):
        try:
            salvar_lead(ruim)
            raise AssertionError(ruim)
        except ValueError:
            pass
    assert registrar_resposta({"id": "f", "tipo": "automatica", "texto": "Olá! Digite 1 para horários"}) == "contatado"
    assert registrar_resposta({"id": "f", "tipo": "interesse", "texto": "Quanto custa?"}) == "respondeu"
    assert registrar_resposta({"id": "f", "tipo": "interesse", "texto": "Quanto custa?"}) == "respondeu"  # repetida
    assert registrar_resposta({"id": "a", "tipo": "recusa", "texto": "Não tenho interesse"}) == "perdido"
    with bot.db() as c:
        notas, quadro = c.execute("SELECT notas, quadro_em IS NOT NULL FROM leads WHERE id='f'").fetchone()
        assert quadro and notas.count("Quanto custa?") == 1 and "resposta automática" in notas, notas
        assert c.execute("SELECT motivo FROM leads WHERE id='a'").fetchone()[0] == "Sem interesse"
    bot.carregar_config = lambda: {"perfis_venda": [bot.completar({"id": "landing", "contato": {"followup": {"ativo": True}}})]}
    with bot.db() as c:
        c.execute("INSERT INTO leads(id, nome, nicho, telefone, etapa, envio, envio_em) VALUES"
                  "('g', 'Clínica Sol', 'dentista', '43 99999-0000', 'contatado', 'enviado', ?)", (velho,))
        c.commit()
    fu = followups()["itens"]
    assert [x["id"] for x in fu] == ["g"] and "Clínica Sol" in fu[0]["mensagem"] and fu[0]["whatsapp"] == "5543999990000", fu
    resultado_followup({"id": "g", "status": "enviado"})
    assert followups()["itens"] == []
    # reengajamento: o Claude registra a última mensagem vista no WhatsApp; parado há `dias` entra na fila
    sex = datetime(2026, 10, 30, 15, 0)
    assert quando_whats("9:05", sex) == "2026-10-30T09:05" and quando_whats("Ontem", sex) == "2026-10-29"
    assert quando_whats("terça-feira", sex) == "2026-10-27" and quando_whats("sexta-feira", sex) == "2026-10-23"
    assert quando_whats("28/09/2026", sex) == "2026-09-28" and quando_whats("31/02/2026", sex) is None
    assert quando_whats("amanhã", sex) is None
    rg = {"dias": 3, "mensagens": ["Oi, {empresa}", "", "Última"]}
    bot.carregar_config = lambda: {"perfis_venda": [bot.completar({"id": "landing", "contato": {"reengajamento": rg}})]}
    with bot.db() as c:
        c.execute("INSERT INTO leads(id, nome, nicho, telefone, etapa, quadro_em) VALUES"
                  "('h', 'Pet Feliz', 'pet', '43 98888-0000', 'proposta', ?)", (velho,))
        c.commit()
    h = lambda: next(x for x in reengajar_lista()["itens"] if x["id"] == "h")
    atras = lambda n: (datetime.now() - timedelta(days=n)).strftime("%d/%m/%Y")
    assert h()["parado"] is None and not h()["pronto"]  # ainda não conferido no WhatsApp
    registrar_conversas({"itens": [{"id": "h", "quando": atras(4), "de": "eu", "lida": True, "previa": "Proposta"}]})
    x = h()
    assert x["parado"] == 4 and x["pronto"] and x["sugestao"] == "Oi, Pet Feliz" and x["conversa_lida"] == "1", x
    mexer_reengajar({"ids": ["h"], "acao": "adicionar"})
    assert h()["reeng"] == "fila" and h()["reeng_msg"] == "Oi, Pet Feliz" and not h()["pronto"]
    mexer_reengajar({"ids": ["h"], "acao": "editar", "mensagem": "Oi! Viu a proposta?"})
    resultado_reengajar({"id": "h", "status": "enviado"})
    x = h()
    assert (x["reeng"], x["reengajamentos"], x["conversa_de"], x["parado"], x["conversa_previa"]) == (
        "enviado", 1, "eu", 0, "Oi! Viu a proposta?") and "reengajamento enviado" in x["notas"], x
    registrar_conversas({"itens": [{"id": "h", "quando": atras(4), "de": "eu"}]})  # 4 dias sem resposta
    assert h()["pronto"] and h()["sugestao"] == "Última"  # a 2ª caixa está vazia
    mexer_reengajar({"ids": ["h"], "acao": "adicionar"})
    registrar_resposta({"id": "h", "tipo": "interesse", "texto": "Vou ver"})  # respondeu: sai da fila e recomeça
    x = h()
    assert (x["reeng"], x["reengajamentos"], x["conversa_de"], x["sugestao"]) == (None, 0, "lead", None), x
    registrar_conversas({"itens": [{"id": "h", "quando": atras(5), "de": "lead"}]})  # ele falou por último: a vez é sua
    mexer_reengajar({"ids": ["h"], "acao": "adicionar"})  # sem modelo para esse caso: só com mensagem escrita
    assert h()["pronto"] and h()["reeng"] is None
    mexer_reengajar({"ids": ["h"], "acao": "adicionar", "mensagem": "Desculpa a demora!"})
    assert h()["reeng_msg"] == "Desculpa a demora!"
    mexer_reengajar({"ids": ["h"], "acao": "remover"})
    salvar_lead({"id": "h", "proximo_em": (datetime.now() + timedelta(days=2)).strftime("%Y-%m-%d")})
    assert not h()["pronto"]  # combinado para depois
    salvar_lead({"id": "h", "proximo_em": ""})
    with bot.db() as c:
        c.execute("UPDATE leads SET reengajamentos=3 WHERE id='h'")
        c.commit()
    assert h()["esgotado"] and not h()["pronto"]
    for ruim in ({"itens": [{"id": "h", "quando": "amanhã", "de": "eu"}]}, {"itens": [{"id": "h", "quando": "Ontem", "de": "x"}]},
                 {"itens": []}, {"itens": [{"id": "zz", "quando": "Ontem", "de": "eu"}]}):
        try:
            registrar_conversas(ruim)
            raise AssertionError(ruim)
        except ValueError:
            pass
    global BACKUPS
    BACKUPS = os.path.join(os.path.dirname(bot.DB), "bk")
    backup(manter=1)
    assert len(os.listdir(BACKUPS)) == 1
    print("ok")


if __name__ == "__main__":
    if "--test" in sys.argv:
        sys.exit(demo())
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", PORTA), H)  # só localhost: os dados não saem da máquina
    except OSError:
        sys.exit(f"Porta {PORTA} ocupada: o painel já deve estar aberto em http://localhost:{PORTA}")
    print(f"Painel em http://localhost:{PORTA}  (Ctrl+C para parar)", flush=True)
    threading.Thread(target=backups_diarios, daemon=True).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
