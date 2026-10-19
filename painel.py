#!/usr/bin/env python3
"""Painel local: python3 painel.py  ->  http://localhost:8765

Servidor só-stdlib. Front em static/ (index.html, app.css, app.js).
API:
  GET  /api/leads          -> {"leads", "etapas", "motivos"}
  POST /api/lead           <- {"id", "etapa", "notas", "motivo"}
  GET  /api/bot            -> estado da prospecção (rodando, progresso, log) + nichos
  POST /api/bot/iniciar    <- {"cidades": [...], "nichos": [...], "fonte": "osm"|"google", "loop": bool}
  POST /api/bot/parar
  GET  /api/config         -> {"perfil", "tem_google_key"}
  POST /api/config         <- {"perfil": {...}, "google_key"?: str}
"""
import atexit, json, mimetypes, os, re, sqlite3, subprocess, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import bot

RAIZ = bot.RAIZ
STATIC = os.path.join(RAIZ, "static")
LOG = os.path.join(RAIZ, "run.log")
PORTA = int(os.environ.get("PORTA", 8765))
ETAPAS = ["abordagem_pronta", "qualificado", "contatado", "respondeu", "negociando", "fechado", "perdido", "descartado"]
MOTIVOS = ["Já tem site e está satisfeito", "Sem interesse", "Sem orçamento agora", "Contato inválido",
           "Fechou com outro", "Não respondeu"]

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


def leads():
    if not os.path.exists(bot.DB):
        return []
    perfil = bot.carregar_config().get("perfil", {})
    with bot.db() as c:
        c.row_factory = sqlite3.Row
        rows = [dict(r) for r in c.execute(
            "SELECT * FROM leads ORDER BY score DESC, (link_whatsapp IS NULL), avaliacoes DESC")]
    for r in rows:
        diag = r["diagnostico"] or ""
        r["argumento"] = argumento(diag)
        r["proposta"] = bot.NICHOS.get(r["nicho"], {}).get("proposta", [])
        r["mensagem"] = bot.mensagem(r, perfil)  # sempre com o perfil atual
        if r["etapa"] == "descartado" and not r["motivo"]:  # leads antigos, de antes da coluna motivo
            r["motivo"] = bot.motivo_auto(diag, r["score"])
    return rows


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
    return {
        "rodando": rodando,
        "status": "rodando" if rodando else ("concluido" if p and p.returncode == 0 else "parado" if p else "ocioso"),
        "aguardando": rodando and bool(linhas) and "dormindo" in linhas[-1],
        "params": BOT["params"],
        "inicio": BOT["inicio"],
        "atual": int(ultimo.group(1)) if ultimo else 0,
        "total": int(ultimo.group(2)) if ultimo else len((BOT["params"] or {}).get("cidades", [])) * len((BOT["params"] or {}).get("nichos", [])),
        "etapa": ultimo.group(3) if ultimo else "",
        "novos": novos,
        "avisos": sum("falhou" in l for l in linhas),
        "log": linhas[-40:],
        "nichos": [{"id": k, "rotulo": v["rotulo"]} for k, v in bot.NICHOS.items()],
    }


def iniciar_bot(d):
    if BOT["proc"] and BOT["proc"].poll() is None:
        raise ValueError("A prospecção já está rodando.")
    cidades = [c.strip() for c in d.get("cidades", []) if isinstance(c, str) and c.strip()]
    nichos = [n for n in d.get("nichos", []) if n in bot.NICHOS]
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
    cmd = [sys.executable, "-u", "-X", "utf8", os.path.join(RAIZ, "bot.py"),
           "--cidades", ",".join(cidades), "--nichos", ",".join(nichos)] + (["--loop"] if d.get("loop") else [])
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
    with open(bot.CONFIG, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


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
                if d.get("etapa") not in ETAPAS or not isinstance(d.get("id"), str):
                    return self.erro("dados inválidos")
                with bot.db() as c:
                    n = c.execute("UPDATE leads SET etapa=?, notas=?, motivo=? WHERE id=?",
                                  (d["etapa"], str(d.get("notas") or ""), str(d.get("motivo") or "") or None, d["id"])).rowcount
                return self.responder({"ok": bool(n)}, status=200 if n else 404)
            if self.path == "/api/bot/iniciar":
                iniciar_bot(d)
                return self.responder(estado_bot())
            if self.path == "/api/bot/parar":
                parar_bot()
                return self.responder(estado_bot())
            if self.path == "/api/config":
                salvar_config(d)
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
    print("ok")


if __name__ == "__main__":
    if "--test" in sys.argv:
        sys.exit(demo())
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", PORTA), H)  # só localhost: os dados não saem da máquina
    except OSError:
        sys.exit(f"Porta {PORTA} ocupada: o painel já deve estar aberto em http://localhost:{PORTA}")
    print(f"Painel em http://localhost:{PORTA}  (Ctrl+C para parar)", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
