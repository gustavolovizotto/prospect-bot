#!/usr/bin/env python3
"""Bot de prospecção de clientes para landing pages. Só stdlib.

Funil: 1) prospecção (OpenStreetMap ou Google Places) -> 2) qualificação (checa o site)
       -> 3) abordagem (mensagem pronta + link wa.me). Você revisa e envia de manhã.

Uso:
  ./rodar.sh   (Windows: rodar.bat)  -> abre o painel, de onde você inicia a prospecção
  python3 bot.py --cidades "Campinas" --nichos dentista   # direto pela linha de comando
  python3 bot.py --export            # gera leads.csv ordenado por score
"""
import argparse, csv, json, os, re, socket, sqlite3, subprocess, sys, time, unicodedata, urllib.parse
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
    # analise: JSON [{pontos, texto}] explicando o score · tel_tipo: whatsapp | celular | fixo | NULL
    for col in ("notas", "motivo", "envio", "envio_msg", "envio_em", "envio_erro", "analise", "tel_tipo"):
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
               "telefone": t.get("contact:whatsapp") or t.get("contact:mobile") or t.get("phone") or t.get("contact:phone"),
               "whatsapp": bool(t.get("contact:whatsapp")),
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
# Score = soma de critérios explicados (lead["analise"]). Quente: sem site + celular + nicho que paga.
QUENTE, MORNO, MINIMO = 70, 45, 40  # abaixo de MINIMO o bot descarta
TICKET = {"dentista": 15, "advogado": 15, "clinica": 15, "fisioterapia": 15, "veterinario": 15,
          "academia": 10, "contador": 10, "salao": 10, "oficina": 10, "restaurante": 5, "padaria": 5, "pet": 5}
# palavras (sem acento) que confirmam que um site encontrado na web é mesmo desse nicho
CHAVES = {"dentista": ("odonto", "dentist", "dentari", "implante", "ortodont"),
          "salao": ("salao", "cabelo", "beleza", "estetica", "manicure", "escova"),
          "academia": ("academia", "treino", "musculacao", "fitness", "crossfit"),
          "advogado": ("advoca", "advogad", "juridic", "direito"),
          "contador": ("contab", "contador", "fiscal"),
          "veterinario": ("veterin", "animais", "pet"),
          "fisioterapia": ("fisioter", "pilates", "reabilit"),
          "clinica": ("clinica", "medic", "consulta", "saude"),
          "oficina": ("oficina", "mecanic", "automotiv", "veicul"),
          "restaurante": ("restaurante", "cardapio", "delivery", "reserva"),
          "padaria": ("padaria", "confeitaria", "paes", "encomenda"),
          "pet": ("pet", "banho", "tosa", "racao")}
# ponytail: lista curta de redes; nomes repetidos 3+ vezes na base também contam como rede
REDES = ("cobasi", "petz", "petland", "sorridents", "odontocompany", "oralsin", "odonto excellence", "orthodontic",
         "smart fit", "smartfit", "bluefit", "selfit", "bio ritmo", "bodytech", "dr consulta", "amor saude", "amorsaude",
         "mcdonald", "burger king", "subway", "outback", "habib", "bob's", "spoleto", "giraffas", "china in box",
         "cacau show", "kopenhagen", "o boticario", "jacques janine", "espacolaser", "depyl action", "drogasil",
         "droga raia", "pague menos", "lavoisier", "fleury", "dasa", "sabin", "hermes pardini")
PUBLICO = re.compile(r"\b(ubs|usf|caps|upa|ama|posto de saude|unidade basica|prefeitura|secretaria|hospital municipal|"
                     r"centro de saude|policlinica|pronto atendimento municipal|senai|sesi|sesc)\b")
DIRETORIOS = ("google.", "bing.", "facebook.", "instagram.", "linkedin.", "youtube.", "tiktok.", "twitter.", "x.com",
              "wikipedia.", "doctoralia.", "boaconsulta.", "guiamais.", "apontador.", "telelistas.", "solutudo.",
              "cnpj", "econodata.", "ifood.", "tripadvisor.", "reclameaqui.", "jusbrasil.", "escavador.", "mercadolivre.",
              "agendarconsulta.", "eguias.", "guialocal", "encontra", "listamais.", "yelp.", "waze.", "maps.", "gov.br")
GENERICAS = {"de", "da", "do", "das", "dos", "e", "a", "o", "em", "ltda", "me", "eireli", "dr", "dra", "clinica",
             "consultorio", "odontologia", "odontologica", "odonto", "dentista", "dental", "saude", "integrada",
             "radiologia", "salao", "beleza", "studio", "estudio", "espaco", "academia", "fitness", "advocacia",
             "advogados", "associados", "escritorio", "contabilidade", "contabil", "veterinaria", "veterinario", "vet",
             "pet", "shop", "petshop", "restaurante", "padaria", "confeitaria", "oficina", "mecanica", "auto",
             "center", "centro", "fisioterapia", "fisio", "medica", "medicina", "instituto", "grupo", "casa"}


def sem_acento(s):
    return unicodedata.normalize("NFKD", (s or "").lower()).encode("ascii", "ignore").decode()


def tipo_telefone(tel, whatsapp=False):
    """whatsapp (cadastrado como WhatsApp) | celular (11 dígitos com 9: quase sempre tem WhatsApp) | fixo | None"""
    d = re.sub(r"\D", "", tel or "")
    if d.startswith("55") and len(d) > 11:
        d = d[2:]
    d = d.lstrip("0")
    if len(d) == 11 and d[2] == "9":
        return "whatsapp" if whatsapp else "celular"
    if len(d) == 10:
        return "whatsapp" if whatsapp else "fixo"
    return None


def palavras(nome):
    todas = re.findall(r"[a-z0-9]+", sem_acento(nome_curto(nome)))
    return todas, [w for w in todas if w not in GENERICAS]


_ultima_busca = [0.0]


def bing(q):
    """Hosts e caminhos dos resultados do Bing. Pode vir vazio ou com lixo: tudo é confirmado depois."""
    espera = 3 - (time.time() - _ultima_busca[0])
    if espera > 0:
        time.sleep(espera)
    _ultima_busca[0] = time.time()
    try:
        _, h, _ = http("https://www.bing.com/search?setlang=pt-BR&cc=BR&q=" + urllib.parse.quote(q), timeout=20,
                       headers={"Accept-Language": "pt-BR", "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) "
                                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"})
    except Exception:
        return []
    out = []
    for c in re.findall(r"<cite[^>]*>(.*?)</cite>", h, re.S):
        c = re.sub(r"<[^>]+>|^https?://", "", c).replace(" › ", "/").split(" ")[0]
        host, _, caminho = c.partition("/")
        out.append((host.lower().removeprefix("www."), caminho))
    return out


def site_e_da_empresa(url, cidade, nicho, forte):
    """Abre o site e confirma que é desse nicho (e, quando o domínio só bate em parte do nome, dessa cidade)."""
    try:
        final, html, _ = http(url, timeout=12)
    except Exception:
        return None
    h = sem_acento(html)
    if not any(k in h for k in CHAVES.get(nicho, ())):
        return None
    if not forte and sem_acento(cidade) not in h:
        return None
    return final


def buscar_site(nome, cidade, nicho):
    """Procura o site de um lead cadastrado sem site. -> (url, "site"|"social") ou (None, None)"""
    todas, dist = palavras(nome)
    cheio, nucleo = "".join(todas), "".join(dist)
    # 1) domínios óbvios: nome inteiro, nome sem palavras genéricas, primeira palavra distintiva
    cand = [(cheio, True)] + ([(nucleo, len(dist) > 1 or nucleo == cheio)] if len(nucleo) >= 4 else []) + \
           ([(dist[0], False)] if dist and len(dist[0]) >= 5 else [])
    vistos = set()
    for slug, forte in cand:
        for tld in (".com.br", ".com"):
            dom = slug + tld
            if dom in vistos or len(slug) < 4:
                continue
            vistos.add(dom)
            try:
                socket.getaddrinfo(dom, 443)
            except (OSError, UnicodeError):
                continue
            achou = site_e_da_empresa("https://" + dom, cidade, nicho, forte)
            if achou:
                return achou, "site"
    # 2) busca na web pelo nome entre aspas
    social = None
    for host, caminho in bing(f'"{nome_curto(nome)}" {cidade}'):
        rotulo = host.split(".")[0]
        if host.startswith("instagram.") and nucleo and nucleo[:6] in sem_acento(caminho).replace(".", "").replace("_", ""):
            social = social or f"https://instagram.com/{caminho.split('/')[0]}"
            continue
        if any(d in host for d in DIRETORIOS):
            continue
        forte = len(nucleo) >= 4 and nucleo in rotulo.replace("-", "")
        if forte or (dist and len(dist[0]) >= 5 and dist[0] in rotulo):
            achou = site_e_da_empresa("https://" + host, cidade, nicho, forte)
            if achou:
                return achou, "site"
    return (social, "social") if social else (None, None)


def diagnosticar_site(site):
    """-> (pontos de dor, diagnóstico)"""
    if any(x in site.lower() for x in SOCIAL):
        return 35, "só rede social como site"
    url = site if site.startswith("http") else "http://" + site
    try:
        final, html, dt = http(url, timeout=15)
    except Exception as e:
        e = str(e)
        motivo = ("domínio não existe" if "(6)" in e else "não responde" if "(28)" in e or "(7)" in e
                  else "certificado inválido" if "(60)" in e or "(35)" in e else e[:40])
        return 40, f"site fora do ar ({motivo})"
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
    return min(30, 10 * len(probs)), ", ".join(probs) or "site ok"


def desqualificar(nome, repetidos=0):
    n = sem_acento(nome)
    if PUBLICO.search(n):
        return "Órgão ou serviço público: não contrata site dessa forma."
    if any(r in n for r in REDES) or repetidos >= 3:
        return "Rede ou franquia: já tem site corporativo e decide o marketing fora da unidade."
    return None


def analisar(lead, repetidos=0, buscar=True):
    """Qualifica um lead. -> {score, diagnostico, analise, tel_tipo, site, desqualificado}"""
    fora = desqualificar(lead["nome"], repetidos)
    tel = tipo_telefone(lead.get("telefone"), lead.get("whatsapp"))
    if fora:
        return {"score": 0, "diagnostico": "desqualificado", "analise": [{"pontos": 0, "texto": fora}],
                "tel_tipo": tel, "site": lead.get("site"), "desqualificado": fora}
    a, site = [], lead.get("site")
    if not site and buscar:
        site, tipo = buscar_site(lead["nome"], lead.get("cidade", ""), lead.get("nicho"))
        if site:
            a.append({"pontos": 0, "texto": f"{'Perfil' if tipo == 'social' else 'Site'} encontrado na busca: "
                                            f"{re.sub(r'^https?://(www[.])?', '', site).rstrip('/')}"})
    if site:
        dor, diag = diagnosticar_site(site)
        a.append({"pontos": dor, "texto": {"site ok": "Site em ordem: pouca dor para resolver",
                                           "só rede social como site": "Só tem rede social, sem site próprio"}.get(
                                               diag, f"Site com problemas: {diag}" if "fora do ar" not in diag else diag.capitalize())})
    else:
        dor, diag = 40, "sem site"
        a.append({"pontos": 40, "texto": "Sem site: nada no cadastro" + (" nem na busca pela web" if buscar else "")})
    pts = {"whatsapp": 25, "celular": 25, "fixo": 5}.get(tel, 0)
    a.append({"pontos": pts, "texto": {"whatsapp": "WhatsApp cadastrado", "celular": "Celular: provavelmente tem WhatsApp",
                                       "fixo": "Só telefone fixo: WhatsApp improvável"}.get(tel, "Sem telefone válido")})
    t = TICKET.get(lead.get("nicho"), 5)
    a.append({"pontos": t, "texto": {15: "Nicho de ticket alto", 10: "Nicho de ticket médio"}.get(t, "Nicho de ticket baixo")})
    if lead.get("avaliacoes"):
        av = 10 if lead["avaliacoes"] >= 50 else 5 if lead["avaliacoes"] >= 10 else 0
        a.append({"pontos": av, "texto": f"{lead['avaliacoes']} avaliações no Google"})
    return {"score": min(100, sum(x["pontos"] for x in a)), "diagnostico": diag, "analise": a, "tel_tipo": tel,
            "site": site, "desqualificado": None}


def temperatura(score):
    return "quente" if score >= QUENTE else "morno" if score >= MORNO else "frio"


def etapa_auto(q):
    if q["desqualificado"] or q["score"] < MINIMO:
        return "descartado"
    return "abordagem_pronta" if q["tel_tipo"] in ("whatsapp", "celular") else "qualificado"


# ---------- 3) abordagem ----------
PROBLEMA_FRASE = {  # trecho do diagnóstico -> como falar disso com o cliente
    "sem https": "aparece como “Não seguro” no navegador",
    "não é mobile": "não se adapta bem à tela do celular",
    "lento": "demora para carregar",
    "quase sem conteúdo": "traz pouca informação sobre os serviços",
    "copyright": "passa a impressão de estar desatualizado",
}


def nome_curto(nome):
    """'Consultório X - Dra. Y | Lentes' -> 'Consultório X'; pula partes só genéricas ('Consultório Dentista - Dra. Y' -> 'Dra. Y')"""
    partes = [p.strip(" .") for p in re.split(r"\s+[-|–]\s+", nome or "") if p.strip(" .")]
    for p in partes:
        if any(w not in GENERICAS for w in re.findall(r"[a-z0-9]+", sem_acento(p))):
            return p
    return partes[0] if partes else nome


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
    if funcao.istitle():  # "Desenvolvedor Web" -> "desenvolvedor web" no meio da frase
        funcao = funcao.lower()

    if diag == "sem site":
        obs = f"Pesquisando por {nome}, vi que vocês ainda não têm um site próprio."
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


MOTIVOS_AUTO = ("O site atual está em ordem", "Site com problemas leves", "Pontuação baixa", "Órgão ou serviço público", "Rede ou franquia")


def motivo_auto(q):
    """Por que o bot descartou. Começa sempre com um de MOTIVOS_AUTO (assim a requalificação sabe que pode mexer)."""
    if q["desqualificado"]:
        return q["desqualificado"]
    if q["diagnostico"] == "site ok":
        return "O site atual está em ordem: tem HTTPS, funciona no celular, carrega rápido e tem conteúdo. Baixa chance de troca."
    return f"Pontuação baixa ({q['score']} de no mínimo {MINIMO}): " + "; ".join(
        x["texto"].lower() for x in q["analise"] if x["pontos"] < 20) + "."


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


def contar_nomes(c):
    """nome normalizado -> quantas vezes aparece (3+ = rede)"""
    cont = {}
    for (n,) in c.execute("SELECT nome FROM leads"):
        k = sem_acento(nome_curto(n))
        cont[k] = cont.get(k, 0) + 1
    return cont


def gravar_qualificacao(c, id_, lead, q, perfil, mexer_etapa=True):
    msg = mensagem({**lead, "diagnostico": q["diagnostico"], "site": q["site"]}, perfil)
    etapa = etapa_auto(q)
    c.execute("""UPDATE leads SET score=?, diagnostico=?, analise=?, tel_tipo=?, site=?, mensagem=?, link_whatsapp=?
                 WHERE id=?""", (q["score"], q["diagnostico"], json.dumps(q["analise"], ensure_ascii=False), q["tel_tipo"],
                                 q["site"], msg, link_whatsapp(lead.get("telefone"), msg) if q["tel_tipo"] else None, id_))
    if mexer_etapa:
        c.execute("UPDATE leads SET etapa=?, motivo=? WHERE id=?",
                  (etapa, motivo_auto(q) if etapa == "descartado" else None, id_))


def rodada(c, cidades, nichos):
    key = os.environ.get("GOOGLE_PLACES_KEY")
    perfil = carregar_config().get("perfil", {})
    nomes = contar_nomes(c)
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
                k = sem_acento(nome_curto(lead["nome"]))
                nomes[k] = nomes.get(k, 0) + 1
                lead.update(nicho=nicho, cidade=cidade)
                q = analisar(lead, nomes[k])
                c.execute("""INSERT INTO leads(id, nome, nicho, cidade, endereco, telefone, site, avaliacoes, fonte, criado)
                             VALUES(?,?,?,?,?,?,?,?,?,?)""",
                          (lead["id"], lead["nome"], nicho, cidade, lead["endereco"], lead["telefone"], lead["site"],
                           lead["avaliacoes"], lead["fonte"], datetime.now().isoformat()))
                gravar_qualificacao(c, lead["id"], lead, q, perfil)
                c.commit()
                novos += 1
            log(f"  +{novos} leads novos")
            time.sleep(5 if key else 15)  # ponytail: rate limit fixo; Overpass é público e compartilhado


def requalificar(c):
    """Reaplica a qualificação atual em todos os leads, sem buscar no mapa de novo.
    Etapas que você mudou à mão (contatado, negociando, descartes com seu motivo...) são preservadas."""
    c.row_factory = sqlite3.Row
    perfil = carregar_config().get("perfil", {})
    nomes = contar_nomes(c)
    rows = [dict(r) for r in c.execute("SELECT * FROM leads ORDER BY score DESC")]
    for i, r in enumerate(rows, 1):
        if i % 10 == 1:
            log(f"Requalificando {i}/{len(rows)}")
        q = analisar(r, nomes.get(sem_acento(nome_curto(r["nome"])), 0))
        auto = r["etapa"] in ("abordagem_pronta", "qualificado") or (
            r["etapa"] == "descartado" and (not r["motivo"] or r["motivo"].startswith(MOTIVOS_AUTO)))
        gravar_qualificacao(c, r["id"], r, q, perfil, mexer_etapa=auto and not r["envio"])
        c.commit()
    c.row_factory = None
    log("requalificação concluída: " + str(dict(c.execute("SELECT etapa, COUNT(*) FROM leads GROUP BY etapa").fetchall())))


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
    assert [tipo_telefone(t) for t in ("+55 19 99999-0000", "(19) 3342-5050", "123", None)] == ["celular", "fixo", None, None]
    assert tipo_telefone("19 3342-5050", whatsapp=True) == "whatsapp"
    assert desqualificar("UBS Jardim Aurélia") and desqualificar("Cobasi Cambuí") and desqualificar("Clínica X", 3)
    assert not desqualificar("Navarro Odontologia")
    quente = analisar({"nome": "X", "nicho": "dentista", "telefone": "19 99999-0000"}, buscar=False)
    assert quente["score"] == 80 and temperatura(quente["score"]) == "quente" and etapa_auto(quente) == "abordagem_pronta"
    fixo = analisar({"nome": "X", "nicho": "dentista", "telefone": "19 3342-5050"}, buscar=False)
    assert fixo["score"] == 60 and temperatura(60) == "morno" and etapa_auto(fixo) == "qualificado"
    sem_tel_baixo = analisar({"nome": "X", "nicho": "padaria"}, buscar=False)
    assert sem_tel_baixo["score"] == 45 and etapa_auto(sem_tel_baixo) == "qualificado"
    rede = analisar({"nome": "Petz", "nicho": "pet", "telefone": "11 99999-0000"}, buscar=False)
    assert etapa_auto(rede) == "descartado" and motivo_auto(rede).startswith(MOTIVOS_AUTO)
    assert sum(x["pontos"] for x in quente["analise"]) == quente["score"]
    assert nome_curto("Consultório X - Dra. Y | Lentes") == "Consultório X"
    assert nome_curto("Consultório Dentista - Dra. Debora Julietti - Lentes") == "Dra. Debora Julietti"
    assert nome_curto(".Venturini Advogados Associados") == "Venturini Advogados Associados"
    assert "sou desenvolvedor web e" in mensagem({"nome": "A", "nicho": "pet", "diagnostico": "sem site"}, {"funcao": "Desenvolvedor Web"})
    assert palavras("Navarro Odontologia") == (["navarro", "odontologia"], ["navarro"])
    assert juntar(["a"]) == "a" and juntar(["a", "b", "c"]) == "a, b e c"
    assert [saudacao(h) for h in (0, 5, 11, 12, 17, 18, 23)] == ["Boa noite", "Bom dia", "Bom dia", "Boa tarde", "Boa tarde", "Boa noite", "Boa noite"]
    m = mensagem({"nome": "Oralcamp", "nicho": "dentista", "diagnostico": "sem https, não é mobile", "site": "https://www.x.com.br/"},
                 {"nome": "Gustavo", "portfolio": "gustavo.dev"}, hora=9)
    assert m.startswith("Bom dia") and "Gustavo" in m and "(x.com.br)" in m and "“Não seguro” no navegador e não se adapta" in m, m
    assert "[seu nome]" in mensagem({"nome": "A", "nicho": "pet", "diagnostico": "sem site"})
    for k, n in NICHOS.items():  # toda entrada precisa dos campos usados na mensagem e na qualificação
        assert {"osm", "busca", "rotulo", "segmento", "publico", "escolha", "conversao", "itens", "proposta"} <= n.keys(), k
        assert k in TICKET and k in CHAVES, k
    print("ok")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--cidades", default="Campinas")
    ap.add_argument("--nichos", default=",".join(NICHOS))
    ap.add_argument("--loop", action="store_true", help=f"repete a cada {INTERVALO_HORAS}h, adicionando só leads novos")
    ap.add_argument("--export", action="store_true")
    ap.add_argument("--requalificar", action="store_true", help="reaplica a qualificação atual em todos os leads")
    ap.add_argument("--test", action="store_true")
    a = ap.parse_args()
    if a.test:
        sys.exit(demo())
    c = db()
    if a.requalificar:
        requalificar(c)
        sys.exit(0)
    if not a.export:
        while True:
            rodada(c, [x.strip() for x in a.cidades.split(",")], [x.strip() for x in a.nichos.split(",")])
            if not a.loop:
                break
            exportar(c)
            log(f"rodada completa, dormindo {INTERVALO_HORAS}h")  # o painel detecta "dormindo"
            time.sleep(INTERVALO_HORAS * 3600)
    exportar(c)
