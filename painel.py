#!/usr/bin/env python3
"""Painel local dos leads: python3 painel.py  ->  http://localhost:8765

Servidor só-stdlib. O front fica em static/ (index.html, app.css, app.js).
API:
  GET  /api/leads  -> {"leads": [...], "etapas": [...]}
  POST /api/lead   <- {"id", "etapa", "notas"}
"""
import json, mimetypes, os, sqlite3, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

RAIZ = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(RAIZ, "leads.db")
STATIC = os.path.join(RAIZ, "static")
PORTA = int(os.environ.get("PORTA", 8765))
ETAPAS = ["abordagem_pronta", "qualificado", "contatado", "respondeu", "negociando", "fechado", "perdido", "descartado"]

# seções que fazem sentido na landing de cada nicho
PROPOSTA = {
    "dentista": ["Tratamentos com fotos de antes e depois", "Convênios aceitos", "Agendamento pelo WhatsApp", "Avaliações do Google", "Mapa e horários"],
    "salao": ["Galeria de trabalhos", "Serviços e preços", "Agendamento pelo WhatsApp", "Link do Instagram", "Horários"],
    "academia": ["Planos e preços", "Grade de aulas", "Fotos da estrutura", "Aula experimental grátis"],
    "advogado": ["Áreas de atuação", "Sobre o advogado (OAB)", "Perguntas frequentes", "Contato discreto por formulário e WhatsApp"],
    "contador": ["Serviços para MEI e empresas", "Abertura de empresa", "Formulário de orçamento", "Depoimentos de clientes"],
    "veterinario": ["Serviços e especialidades", "Emergência em destaque", "Agendamento pelo WhatsApp", "Mapa"],
    "fisioterapia": ["Tratamentos", "Convênios", "Equipe", "Agendamento pelo WhatsApp", "Depoimentos"],
    "clinica": ["Especialidades e médicos", "Convênios", "Agendamento pelo WhatsApp", "Localização e horários"],
    "oficina": ["Serviços e marcas atendidas", "Orçamento por WhatsApp com foto", "Mapa e horários"],
    "restaurante": ["Cardápio com fotos", "Pedido e delivery", "Reservas pelo WhatsApp", "Horários e mapa"],
    "padaria": ["Produtos e encomendas para festa", "Pedido pelo WhatsApp", "Horários e mapa"],
    "pet": ["Banho e tosa com agendamento", "Produtos", "Leva e traz", "WhatsApp e mapa"],
}

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


def db():
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    if "notas" not in [r[1] for r in c.execute("PRAGMA table_info(leads)")]:
        c.execute("ALTER TABLE leads ADD COLUMN notas TEXT")
    return c


def leads():
    if not os.path.exists(DB):
        return []
    with db() as c:
        rows = [dict(r) for r in c.execute(
            "SELECT * FROM leads ORDER BY score DESC, (link_whatsapp IS NULL), avaliacoes DESC")]
    for r in rows:
        r["argumento"] = argumento(r["diagnostico"] or "")
        r["proposta"] = PROPOSTA.get(r["nicho"], [])
    return rows


class H(BaseHTTPRequestHandler):
    def responder(self, corpo, tipo="application/json; charset=utf-8", status=200):
        b = corpo if isinstance(corpo, bytes) else corpo.encode()
        self.send_response(status)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path == "/api/leads":
            return self.responder(json.dumps({"leads": leads(), "etapas": ETAPAS}, ensure_ascii=False))
        nome = "index.html" if self.path == "/" else self.path.lstrip("/").split("?")[0]
        arq = os.path.realpath(os.path.join(STATIC, nome))
        if not arq.startswith(STATIC + os.sep) or not os.path.isfile(arq):  # bloqueia ../
            return self.responder('{"erro":"não encontrado"}', status=404)
        tipo = (mimetypes.guess_type(arq)[0] or "application/octet-stream") + "; charset=utf-8"
        with open(arq, "rb") as f:
            self.responder(f.read(), tipo)

    def do_POST(self):
        if self.path != "/api/lead":
            return self.responder('{"erro":"não encontrado"}', status=404)
        try:
            d = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            assert d.get("etapa") in ETAPAS and isinstance(d.get("notas", ""), str) and isinstance(d.get("id"), str)
        except Exception:
            return self.responder('{"erro":"dados inválidos"}', status=400)
        with db() as c:
            n = c.execute("UPDATE leads SET etapa=?, notas=? WHERE id=?", (d["etapa"], d.get("notas", ""), d["id"])).rowcount
        self.responder(json.dumps({"ok": bool(n)}), status=200 if n else 404)

    def log_message(self, *a):
        pass


def demo():
    a = argumento("sem https, não é mobile")
    assert [p["icone"] for p in a["problemas"]] == ["lock-open", "device-mobile"], a
    assert argumento("lento (6s)")["problemas"][0]["texto"] == "Lento (6s)"
    assert argumento("site ok")["problemas"] == []
    assert argumento("site fora do ar (domínio não existe)")["problemas"][0]["icone"] == "link-break"
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
