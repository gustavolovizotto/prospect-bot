#!/usr/bin/env python3
"""Bot de prospecção de clientes para landing pages. Só stdlib.

Funil: 1) prospecção (OpenStreetMap ou Google Places) -> 2) qualificação (checa o site)
       -> 3) abordagem (mensagem pronta + link wa.me). Você revisa e envia de manhã.

Uso:
  ./rodar.sh "Campinas,Sorocaba"   (Windows: rodar.bat)
  python3 bot.py --export            # gera leads.csv ordenado por score
"""
import argparse, csv, json, os, re, sqlite3, subprocess, sys, time, urllib.parse
from datetime import datetime

UA = "lp-prospector/0.1 (prospeccao local)"
DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "leads.db")

# nicho -> (filtro OSM, termo de busca Google)
NICHOS = {
    "dentista": ('["amenity"="dentist"]', "dentista"),
    "salao": ('["shop"~"hairdresser|beauty"]', "salão de beleza"),
    "academia": ('["leisure"="fitness_centre"]', "academia"),
    "advogado": ('["office"="lawyer"]', "escritório de advocacia"),
    "contador": ('["office"="accountant"]', "contabilidade"),
    "veterinario": ('["amenity"="veterinary"]', "clínica veterinária"),
    "fisioterapia": ('["healthcare"="physiotherapist"]', "fisioterapia"),
    "clinica": ('["amenity"="clinic"]', "clínica"),
    "oficina": ('["shop"="car_repair"]', "oficina mecânica"),
    "restaurante": ('["amenity"="restaurant"]', "restaurante"),
    "padaria": ('["shop"="bakery"]', "padaria"),
    "pet": ('["shop"="pet"]', "pet shop"),
}
SOCIAL = ("instagram.com", "facebook.com", "linktr.ee", "wa.me", "whatsapp.com", "tiktok.com", "linkedin.com")


def db():
    c = sqlite3.connect(DB)
    c.execute("""CREATE TABLE IF NOT EXISTS leads(
        id TEXT PRIMARY KEY, nome TEXT, nicho TEXT, cidade TEXT, endereco TEXT, telefone TEXT,
        site TEXT, avaliacoes INTEGER, fonte TEXT, etapa TEXT DEFAULT 'prospectado',
        score INTEGER, diagnostico TEXT, mensagem TEXT, link_whatsapp TEXT, criado TEXT)""")
    return c


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
    filtro = NICHOS[nicho][0]
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
        body = {"textQuery": f"{NICHOS[nicho][1]} em {cidade}", "languageCode": "pt-BR"}
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
def mensagem(nome, diag):
    if diag == "sem site":
        gancho = f"vi a {nome} no mapa e reparei que vocês ainda não têm um site"
    elif "rede social" in diag:
        gancho = f"vi que a {nome} usa o Instagram como site principal"
    elif "fora do ar" in diag:
        gancho = f"tentei abrir o site da {nome} e ele não carregou"
    elif diag == "site ok":
        gancho = f"dei uma olhada no site da {nome}"
    else:
        gancho = f"dei uma olhada no site da {nome} e notei: {diag}"
    return (f"Olá! Tudo bem? {gancho[0].upper() + gancho[1:]}. "
            "Eu faço landing pages simples e rápidas (celular, WhatsApp, Google Maps, formulário) "
            "pra negócios locais trazerem mais clientes. Posso te mandar um modelo de como ficaria a de vocês, sem compromisso? "
            "Se não fizer sentido é só me avisar que não mando mais mensagem.")


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
    for cidade in cidades:
        for nicho in nichos:
            log(f"{cidade} / {nicho} via {'google' if key else 'osm'}")
            novos = 0
            achados = buscar_google(cidade, nicho, key) if key else buscar_osm(cidade, nicho)
            for lead in achados:
                if c.execute("SELECT 1 FROM leads WHERE id=?", (lead["id"],)).fetchone():
                    continue
                score, diag = qualificar(lead["site"], lead["avaliacoes"])
                msg = mensagem(lead["nome"], diag)
                wa = link_whatsapp(lead["telefone"], msg)
                etapa = "abordagem_pronta" if wa and score >= 50 else ("qualificado" if score >= 50 else "descartado")
                c.execute("INSERT INTO leads VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                          (lead["id"], lead["nome"], nicho, cidade, lead["endereco"], lead["telefone"], lead["site"],
                           lead["avaliacoes"], lead["fonte"], etapa, score, diag, msg, wa, datetime.now().isoformat()))
                c.commit()
                novos += 1
            log(f"  +{novos} leads")
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
    print("ok")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--cidades", default="Campinas")
    ap.add_argument("--nichos", default=",".join(NICHOS))
    ap.add_argument("--loop", action="store_true", help="repete a cada 6h (pega lugares novos/mudanças)")
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
            log("rodada completa, dormindo 6h")
            time.sleep(6 * 3600)
    exportar(c)
