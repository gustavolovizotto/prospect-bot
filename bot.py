#!/usr/bin/env python3
"""Bot de prospecção de clientes para landing pages. Só stdlib.

Funil: 1) prospecção (OpenStreetMap ou Google Places) -> 2) qualificação (checa o site)
       -> 3) abordagem (mensagem pronta + link wa.me). Você revisa e envia de manhã.

Uso:
  ./rodar.sh   (Windows: rodar.bat)  -> abre o painel, de onde você inicia a prospecção
  python3 bot.py --cidades "Campinas" --nichos dentista   # direto pela linha de comando
  python3 bot.py --export            # gera leads.csv ordenado por score
"""
import argparse, csv, json, os, re, sqlite3, subprocess, sys, time, urllib.parse
from datetime import datetime

UA = "lp-prospector/0.1 (prospeccao local)"
INTERVALO_HORAS = 2  # pausa entre rodadas no modo --loop
RAIZ = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(RAIZ, "leads.db")
CONFIG = os.path.join(RAIZ, "config.json")  # perfil do vendedor e chave do Google (local, fora do git)

# Tudo que o funil sabe sobre cada nicho. Para adicionar um nicho, basta uma entrada aqui.
#   osm: filtro Overpass · busca: termo no Google Places · rotulo: nome na tela
#   segmento: "desenvolvo sites para ___" · publico/escolha/conversao: frase de valor da mensagem
#   itens: o que o site mostra (mensagem) · proposta: seções sugeridas da landing (painel)
NICHOS = {
    "dentista": dict(osm='["amenity"="dentist"]', busca="dentista", rotulo="Dentista",
                     segmento="clínicas odontológicas", publico="pacientes", escolha="um dentista", conversao="consultas agendadas",
                     itens="os tratamentos, os convênios aceitos e o agendamento direto pelo WhatsApp",
                     proposta=["Tratamentos com fotos de antes e depois", "Convênios aceitos", "Agendamento pelo WhatsApp", "Avaliações do Google", "Mapa e horários"]),
    "salao": dict(osm='["shop"~"hairdresser|beauty"]', busca="salão de beleza", rotulo="Salão de beleza",
                  segmento="salões e estúdios de beleza", publico="clientes", escolha="um salão", conversao="horários marcados",
                  itens="os serviços, fotos dos trabalhos e o agendamento pelo WhatsApp",
                  proposta=["Galeria de trabalhos", "Serviços e preços", "Agendamento pelo WhatsApp", "Link do Instagram", "Horários"]),
    "academia": dict(osm='["leisure"="fitness_centre"]', busca="academia", rotulo="Academia",
                     segmento="academias e estúdios", publico="alunos", escolha="onde treinar", conversao="matrículas",
                     itens="os planos, a grade de aulas e um botão para agendar a aula experimental",
                     proposta=["Planos e preços", "Grade de aulas", "Fotos da estrutura", "Aula experimental grátis"]),
    "advogado": dict(osm='["office"="lawyer"]', busca="escritório de advocacia", rotulo="Advocacia",
                     segmento="escritórios de advocacia", publico="clientes", escolha="um advogado", conversao="consultas",
                     itens="as áreas de atuação, a apresentação do escritório e um canal de contato discreto",
                     proposta=["Áreas de atuação", "Sobre o advogado (OAB)", "Perguntas frequentes", "Contato discreto por formulário e WhatsApp"]),
    "contador": dict(osm='["office"="accountant"]', busca="contabilidade", rotulo="Contabilidade",
                     segmento="escritórios de contabilidade", publico="empresários", escolha="um contador", conversao="pedidos de orçamento",
                     itens="os serviços para MEI e empresas e um formulário de orçamento",
                     proposta=["Serviços para MEI e empresas", "Abertura de empresa", "Formulário de orçamento", "Depoimentos de clientes"]),
    "veterinario": dict(osm='["amenity"="veterinary"]', busca="clínica veterinária", rotulo="Veterinário",
                        segmento="clínicas veterinárias", publico="tutores", escolha="uma clínica para o pet", conversao="atendimentos agendados",
                        itens="as especialidades, o atendimento de emergência e o agendamento pelo WhatsApp",
                        proposta=["Serviços e especialidades", "Emergência em destaque", "Agendamento pelo WhatsApp", "Mapa"]),
    "fisioterapia": dict(osm='["healthcare"="physiotherapist"]', busca="fisioterapia", rotulo="Fisioterapia",
                         segmento="clínicas de fisioterapia", publico="pacientes", escolha="uma clínica", conversao="sessões agendadas",
                         itens="os tratamentos, os convênios e o agendamento pelo WhatsApp",
                         proposta=["Tratamentos", "Convênios", "Equipe", "Agendamento pelo WhatsApp", "Depoimentos"]),
    "clinica": dict(osm='["amenity"="clinic"]', busca="clínica", rotulo="Clínica",
                    segmento="clínicas", publico="pacientes", escolha="uma clínica", conversao="consultas agendadas",
                    itens="as especialidades, os convênios e o agendamento pelo WhatsApp",
                    proposta=["Especialidades e médicos", "Convênios", "Agendamento pelo WhatsApp", "Localização e horários"]),
    "oficina": dict(osm='["shop"="car_repair"]', busca="oficina mecânica", rotulo="Oficina mecânica",
                    segmento="oficinas mecânicas", publico="motoristas", escolha="uma oficina", conversao="pedidos de orçamento",
                    itens="os serviços, as marcas atendidas e o orçamento rápido pelo WhatsApp",
                    proposta=["Serviços e marcas atendidas", "Orçamento por WhatsApp com foto", "Mapa e horários"]),
    "restaurante": dict(osm='["amenity"="restaurant"]', busca="restaurante", rotulo="Restaurante",
                        segmento="restaurantes", publico="clientes", escolha="onde comer", conversao="pedidos e reservas",
                        itens="o cardápio com fotos, as reservas e o pedido pelo WhatsApp",
                        proposta=["Cardápio com fotos", "Pedido e delivery", "Reservas pelo WhatsApp", "Horários e mapa"]),
    "padaria": dict(osm='["shop"="bakery"]', busca="padaria", rotulo="Padaria",
                    segmento="padarias e confeitarias", publico="clientes", escolha="onde encomendar", conversao="encomendas",
                    itens="os produtos, as encomendas para festas e o pedido pelo WhatsApp",
                    proposta=["Produtos e encomendas para festa", "Pedido pelo WhatsApp", "Horários e mapa"]),
    "pet": dict(osm='["shop"="pet"]', busca="pet shop", rotulo="Pet shop",
                segmento="pet shops", publico="tutores", escolha="um pet shop", conversao="agendamentos de banho e tosa",
                itens="os serviços de banho e tosa, o leva e traz e o agendamento pelo WhatsApp",
                proposta=["Banho e tosa com agendamento", "Produtos", "Leva e traz", "WhatsApp e mapa"]),
}
SOCIAL = ("instagram.com", "facebook.com", "linktr.ee", "wa.me", "whatsapp.com", "tiktok.com", "linkedin.com")


def db():
    c = sqlite3.connect(DB, timeout=15)  # bot e painel escrevem no mesmo arquivo
    c.execute("""CREATE TABLE IF NOT EXISTS leads(
        id TEXT PRIMARY KEY, nome TEXT, nicho TEXT, cidade TEXT, endereco TEXT, telefone TEXT,
        site TEXT, avaliacoes INTEGER, fonte TEXT, etapa TEXT DEFAULT 'prospectado',
        score INTEGER, diagnostico TEXT, mensagem TEXT, link_whatsapp TEXT, criado TEXT)""")
    cols = [r[1] for r in c.execute("PRAGMA table_info(leads)")]
    # envio: NULL | fila | enviado | falhou  (fila de contato automático pelo WhatsApp Web)
    for col in ("notas", "motivo", "envio", "envio_msg", "envio_em", "envio_erro"):
        if col not in cols:
            c.execute(f"ALTER TABLE leads ADD COLUMN {col} TEXT")
    return c


def carregar_config():
    try:
        with open(CONFIG, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def http(url, data=None, headers=None, timeout=30):
    """GET/POST via curl (o Python do macOS vem com LibreSSL 2.8 e falha TLS em vários sites).
    Retorna (url_final, corpo, segundos)."""
    cmd = ["curl", "-sSL", "--compressed", "-m", str(timeout), "-A", UA, "-o", "-",
           "-w", "\n%{http_code} %{url_effective} %{time_total}"]
    if os.name == "nt":  # curl do Windows (Schannel) recusa sites sem servidor de revogação acessível
        cmd.append("--ssl-no-revoke")
    for k, v in (headers or {}).items():
        cmd += ["-H", f"{k}: {v}"]
    if data is not None:
        cmd += ["--data-binary", "@-"]
    cmd.append(url)
    r = subprocess.run(cmd, input=data, capture_output=True, timeout=timeout + 10)
    if r.returncode:
        raise IOError(r.stderr.decode(errors="ignore").strip() or f"curl exit {r.returncode}")
    corpo, _, meta = r.stdout.rpartition(b"\n")
    code, final, dt = meta.decode().split(" ")
    if not code.startswith(("2", "3")):
        raise IOError(f"HTTP {code}")
    return final, corpo.decode("utf-8", "ignore"), float(dt)


def retry(fn, tentativas=4):
    for i in range(tentativas):
        try:
            return fn()
        except Exception as e:  # 429/504 do Overpass são comuns
            log(f"  falhou ({e}), tentando de novo em {30 * (i + 1)}s")
            time.sleep(30 * (i + 1))
    return None


# ---------- 1) prospecção ----------
def buscar_osm(cidade, nicho):
    # ponytail: casa qualquer área com esse nome (ex.: bairro "Campinas" em SC); filtrar por DDD se incomodar
    filtro = NICHOS[nicho]["osm"]
    cidade = cidade.replace('"', "").replace("\\", "")
    q = (f'[out:json][timeout:120];area["name"="{cidade}"]["boundary"="administrative"]->.a;'
         f'nwr{filtro}["name"](area.a);out tags center;')
    r = retry(lambda: json.loads(http("https://overpass-api.de/api/interpreter",
                                      urllib.parse.urlencode({"data": q}).encode(), timeout=180)[1]))
    for e in (r or {}).get("elements", []):
        t = e["tags"]
        end = " ".join(filter(None, [t.get("addr:street"), t.get("addr:housenumber"), t.get("addr:suburb")]))
        yield {"id": f"osm:{e['type']}{e['id']}", "nome": t["name"], "endereco": end,
               "telefone": t.get("contact:whatsapp") or t.get("phone") or t.get("contact:phone") or t.get("contact:mobile"),
               "site": t.get("website") or t.get("contact:website") or t.get("contact:instagram"),
               "avaliacoes": None, "fonte": "osm"}


def buscar_google(cidade, nicho, key):
    campos = ("places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,"
              "places.websiteUri,places.userRatingCount,places.businessStatus,nextPageToken")
    token = None
    for _ in range(3):  # API devolve no máx. 60 resultados (3 páginas de 20)
        body = {"textQuery": f"{NICHOS[nicho]['busca']} em {cidade}", "languageCode": "pt-BR"}
        if token:
            body["pageToken"] = token
        r = retry(lambda: json.loads(http("https://places.googleapis.com/v1/places:searchText",
                                         json.dumps(body).encode(),
                                         {"Content-Type": "application/json", "X-Goog-Api-Key": key,
                                          "X-Goog-FieldMask": campos})[1]))
        for p in (r or {}).get("places", []):
            if p.get("businessStatus", "OPERATIONAL") != "OPERATIONAL":
                continue
            yield {"id": f"g:{p['id']}", "nome": p["displayName"]["text"], "endereco": p.get("formattedAddress"),
                   "telefone": p.get("nationalPhoneNumber"), "site": p.get("websiteUri"),
                   "avaliacoes": p.get("userRatingCount"), "fonte": "google"}
        token = (r or {}).get("nextPageToken")
        if not token:
            break
        time.sleep(2)


# ---------- 2) qualificação ----------
def qualificar(site, avaliacoes):
    """Retorna (score 0-100, diagnóstico). Quanto maior, mais precisa de landing page."""
    if not site:
        s, d = 90, "sem site"
    elif any(x in site.lower() for x in SOCIAL):
        s, d = 85, "só rede social como site"
    else:
        url = site if site.startswith("http") else "http://" + site
        try:
            final, html, dt = http(url, timeout=15)
            html = html[:400_000].lower()
            probs = []
            if not final.startswith("https"):
                probs.append("sem https")
            if 'name="viewport"' not in html and "name=viewport" not in html:
                probs.append("não é mobile")
            if dt > 4:
                probs.append(f"lento ({dt:.0f}s)")
            if len(re.sub(r"<[^>]+>", "", html).split()) < 80:
                probs.append("quase sem conteúdo")
            m = re.search(r"©\s*(?:\d{4}\s*[-–]\s*)?(20[01]\d)", html)
            if m:
                probs.append(f"copyright {m.group(1)}")
            s, d = 20 + 15 * len(probs), ", ".join(probs) or "site ok"
        except Exception as e:
            e = str(e)
            motivo = ("domínio não existe" if "(6)" in e else "não responde" if "(28)" in e or "(7)" in e
                      else "certificado inválido" if "(60)" in e or "(35)" in e else e[:40])
            s, d = 80, f"site fora do ar ({motivo})"
    if avaliacoes:  # negócio com movimento = paga
        s += min(10, avaliacoes // 20)
    return min(s, 100), d


# ---------- 3) abordagem ----------
PROBLEMA_FRASE = {  # trecho do diagnóstico -> como falar disso com o cliente
    "sem https": "aparece como “Não seguro” no navegador",
    "não é mobile": "não se adapta bem à tela do celular",
    "lento": "demora para carregar",
    "quase sem conteúdo": "traz pouca informação sobre os serviços",
    "copyright": "passa a impressão de estar desatualizado",
}


def nome_curto(nome):
    """'Consultório X - Dra. Y | Lentes' -> 'Consultório X'"""
    return re.split(r"\s+[-|–]\s+", nome or "")[0].strip() or nome


def juntar(itens):
    return itens[0] if len(itens) == 1 else ", ".join(itens[:-1]) + " e " + itens[-1]


def saudacao(hora=None):
    h = datetime.now().hour if hora is None else hora
    return "Bom dia" if 5 <= h < 12 else "Boa tarde" if 12 <= h < 18 else "Boa noite"


def mensagem(lead, perfil=None, hora=None):
    """Mensagem de primeiro contato: apresentação, observação concreta, valor para o nicho, convite leve."""
    p = perfil or {}
    n = NICHOS.get(lead.get("nicho"), NICHOS["clinica"])
    diag = lead.get("diagnostico") or ""
    nome = nome_curto(lead.get("nome"))
    site = re.sub(r"^https?://(www\.)?|/$", "", lead.get("site") or "")
    seu_nome = (p.get("nome") or "").strip() or "[seu nome]"
    funcao = (p.get("funcao") or "").strip() or "desenvolvedor web"

    if diag == "sem site":
        obs = f"Pesquisando por {nome} no Google, vi que vocês ainda não têm um site próprio, apenas o perfil no mapa."
    elif "rede social" in diag:
        obs = ("Vi que hoje o principal canal online de vocês é a rede social. Ela é ótima para relacionamento, "
               "mas não aparece bem nas buscas do Google e depende do alcance que o algoritmo libera.")
    elif "fora do ar" in diag:
        obs = (f"Tentei acessar o site de vocês ({site}) e ele não está carregando. Enquanto isso, "
               "quem procura por vocês no Google encontra uma página de erro.")
    else:
        frases = [f for k, f in PROBLEMA_FRASE.items() if k in diag]
        obs = (f"Acessei o site de vocês ({site}) e notei que ele {juntar(frases)}, pontos que costumam afastar visitantes."
               if frases else
               f"Acessei o site de vocês ({site}) e vi que já existe uma boa base. Trabalho também com melhorias "
               "pontuais de conversão, como WhatsApp em destaque e páginas específicas por serviço.")

    valor = (f"Hoje a maioria dos {n['publico']} pesquisa no Google antes de escolher {n['escolha']}. "
             f"Um site objetivo, com {n['itens']}, ajuda a transformar essas buscas em {n['conversao']}.")
    assinatura = seu_nome + (f"\n{p['portfolio'].strip()}" if (p.get("portfolio") or "").strip() else "")

    return (f"{saudacao(hora)}, tudo bem? Meu nome é {seu_nome}, sou {funcao} e trabalho com sites para "
            f"{n['segmento']} aqui da região.\n\n{obs}\n\n{valor}\n\n"
            "Posso montar uma proposta enxuta para o caso de vocês e enviar por aqui, sem compromisso?\n\n"
            f"Se não for o momento, sem problema. Agradeço a atenção.\n{assinatura}")


def motivo_auto(diag, score):
    """Por que o bot descartou (score < 50)."""
    if diag == "site ok":
        return "O site atual está em ordem: tem HTTPS, funciona no celular, carrega rápido e tem conteúdo. Baixa chance de troca."
    return f"Site com problemas leves ({diag}). A dor não justifica uma abordagem agora (score {score})."


def link_whatsapp(tel, msg):
    d = re.sub(r"\D", "", tel or "")
    if not d:
        return None
    if not d.startswith("55"):
        d = "55" + d.lstrip("0")
    if len(d) < 12:
        return None
    return f"https://wa.me/{d}?text={urllib.parse.quote(msg)}"


# ---------- orquestração ----------
def log(msg):
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


def rodada(c, cidades, nichos):
    key = os.environ.get("GOOGLE_PLACES_KEY")
    perfil = carregar_config().get("perfil", {})
    total, i = len(cidades) * len(nichos), 0
    for cidade in cidades:
        for nicho in nichos:
            i += 1
            log(f"Buscando {i}/{total}: {cidade} · {NICHOS[nicho]['rotulo']} ({'Google' if key else 'OpenStreetMap'})")
            novos = 0
            achados = buscar_google(cidade, nicho, key) if key else buscar_osm(cidade, nicho)
            for lead in achados:
                if c.execute("SELECT 1 FROM leads WHERE id=?", (lead["id"],)).fetchone():
                    continue
                score, diag = qualificar(lead["site"], lead["avaliacoes"])
                lead.update(nicho=nicho, cidade=cidade, score=score, diagnostico=diag)
                msg = mensagem(lead, perfil)
                wa = link_whatsapp(lead["telefone"], msg)
                etapa = "abordagem_pronta" if wa and score >= 50 else ("qualificado" if score >= 50 else "descartado")
                c.execute("""INSERT INTO leads(id, nome, nicho, cidade, endereco, telefone, site, avaliacoes, fonte, etapa,
                             score, diagnostico, mensagem, link_whatsapp, criado, motivo)
                             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                          (lead["id"], lead["nome"], nicho, cidade, lead["endereco"], lead["telefone"], lead["site"],
                           lead["avaliacoes"], lead["fonte"], etapa, score, diag, msg, wa, datetime.now().isoformat(),
                           motivo_auto(diag, score) if etapa == "descartado" else None))
                c.commit()
                novos += 1
            log(f"  +{novos} leads novos")
            time.sleep(5 if key else 15)  # ponytail: rate limit fixo; Overpass é público e compartilhado


def exportar(c, path="leads.csv"):
    cur = c.execute("SELECT etapa,score,nome,nicho,cidade,telefone,site,diagnostico,avaliacoes,endereco,link_whatsapp,mensagem "
                    "FROM leads WHERE etapa!='descartado' ORDER BY (link_whatsapp IS NULL), score DESC")
    with open(path, "w", newline="", encoding="utf-8-sig") as f:  # utf-8-sig: Excel abre acentos certo
        w = csv.writer(f)
        w.writerow([d[0] for d in cur.description])
        w.writerows(cur)
    resumo = c.execute("SELECT etapa, COUNT(*) FROM leads GROUP BY etapa").fetchall()
    log(f"exportado {path}: {dict(resumo)}")


def demo():
    assert link_whatsapp("(19) 3342-5050", "oi") == "https://wa.me/551933425050?text=oi"
    assert link_whatsapp("+55 19 99999-0000", "a b").endswith("5519999990000?text=a%20b")
    assert link_whatsapp("123", "x") is None and link_whatsapp(None, "x") is None
    assert qualificar(None, None) == (90, "sem site")
    assert qualificar("https://instagram.com/x", 400)[0] == 95
    assert nome_curto("Consultório X - Dra. Y | Lentes") == "Consultório X"
    assert [saudacao(h) for h in (0, 5, 11, 12, 17, 18, 23)] == ["Boa noite", "Bom dia", "Bom dia", "Boa tarde", "Boa tarde", "Boa noite", "Boa noite"]
    assert juntar(["a"]) == "a" and juntar(["a", "b", "c"]) == "a, b e c"
    m = mensagem({"nome": "Oralcamp", "nicho": "dentista", "diagnostico": "sem https, não é mobile", "site": "https://www.x.com.br/"},
                 {"nome": "Gustavo", "portfolio": "gustavo.dev"}, hora=9)
    assert m.startswith("Bom dia") and "Gustavo" in m and "(x.com.br)" in m and "“Não seguro” no navegador e não se adapta" in m, m
    assert "[seu nome]" in mensagem({"nome": "A", "nicho": "pet", "diagnostico": "sem site"})
    for k, n in NICHOS.items():  # toda entrada precisa dos campos usados na mensagem
        assert {"osm", "busca", "rotulo", "segmento", "publico", "escolha", "conversao", "itens", "proposta"} <= n.keys(), k
    print("ok")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--cidades", default="Campinas")
    ap.add_argument("--nichos", default=",".join(NICHOS))
    ap.add_argument("--loop", action="store_true", help=f"repete a cada {INTERVALO_HORAS}h, adicionando só leads novos")
    ap.add_argument("--export", action="store_true")
    ap.add_argument("--test", action="store_true")
    a = ap.parse_args()
    if a.test:
        sys.exit(demo())
    c = db()
    if not a.export:
        while True:
            rodada(c, [x.strip() for x in a.cidades.split(",")], [x.strip() for x in a.nichos.split(",")])
            if not a.loop:
                break
            exportar(c)
            log(f"rodada completa, dormindo {INTERVALO_HORAS}h")  # o painel detecta "dormindo"
            time.sleep(INTERVALO_HORAS * 3600)
    exportar(c)
