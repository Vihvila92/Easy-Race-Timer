#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Kuulan hölkkä -fixture (Easy Race Timer v0.1 -hyväksymistesti).

Deterministinen generaattori: tuottaa kisan konfiguraation, ilmoittautumis-CSV:n,
kisapäivän tapahtumaskriptin ja odotetut tulokset (oraakkeli). Aja:
    python3 generate.py            # kirjoittaa tiedostot tähän hakemistoon
Tiedostot ovat versionhallinnassa; generaattori ajetaan uudelleen vain, jos skenaario muuttuu.
Tulosaika on race-day.json:n millisekuntileimojen erotus (isoformat katkaisee mikrosekunnit).
Sarja tuloksissa tulee suggest()-funktiosta kisapäivän iällä, ei rakennusämpäristä (lappu 123 on P6).
Kaikki henkilöt ovat keksittyjä.
"""
import csv, json, random, datetime as dt, os, math
from copy import deepcopy

OUT = os.path.dirname(os.path.abspath(__file__))
rnd = random.Random(20270612)
EVENT_DATE = dt.date(2027, 6, 12)   # fiktiivinen päivä (la)
TZ = "+03:00"

# ---------------- konfiguraatio ----------------
KID_AGES = [4, 6, 8, 10, 12, 14, 16]
categories = []
for g, prefix, label_fi, label_en in [("F", "T", "Tytöt", "Girls"), ("M", "P", "Pojat", "Boys")]:
    for a in KID_AGES:
        categories.append({"id": f"{prefix}{a}", "race_id": "R4", "gender": g, "min_age": a,
                           "max_age": a + 1, "ranked": True,
                           "name": {"fi": f"{prefix}{a}", "en": f"{'G' if g=='F' else 'B'}{a}"},
                           "description": {"fi": f"{label_fi} {a}–{a+1} v", "en": f"{label_en} {a}–{a+1} y"}})
categories += [
    # Aikuisten sarjat: 18 v täyttäneet. 16–17-vuotiaat voivat valita 8 km:n, jolloin he kilpailevat aikuisten sarjassa.
    {"id": "N", "race_id": "R8", "gender": "F", "min_age": 16, "max_age": None, "ranked": True,
     "name": {"fi": "N", "en": "W"}, "description": {"fi": "Naiset (18 v; myös 16–17 v, jotka valitsevat 8 km)", "en": "Women (18+; also 16–17 choosing 8 km)"}},
    {"id": "M", "race_id": "R8", "gender": "M", "min_age": 16, "max_age": None, "ranked": True,
     "name": {"fi": "M", "en": "M"}, "description": {"fi": "Miehet (18 v; myös 16–17 v, jotka valitsevat 8 km)", "en": "Men (18+; also 16–17 choosing 8 km)"}},
    # Ei kuulu 16 viralliseen sarjaan: sijoittamaton kuntosarja 8 km:llä (siirretyn lähdön vaihtoehto).
    # Aikuisille ei ole lyhyttä matkaa, joten 4 km:llä ei ole kuntosarjaa.
    {"id": "K8", "race_id": "R8", "gender": None, "min_age": None, "max_age": None, "ranked": False,
     "auto_assign": False, "name": {"fi": "Kunto 8 km", "en": "Open 8 km"}, "description": {"fi": "Sijoittamaton", "en": "Unranked"}},
]
CAT = {c["id"]: c for c in categories}

event = {
    "id": "EV_KUULAN_HOLKKA_2027",
    "name": "Kuulan hölkkä 2027",
    "organizer": "Uuraisten Urheilijat ry",
    "location": "Uurainen",
    "date": EVENT_DATE.isoformat(),
    "timezone": "Europe/Helsinki",
    "sport": "run",
    "locale_default": "fi",
    "settings": {
        "age_basis": "birth_date",          # birth_date | birth_year
        "age_reference_date": EVENT_DATE.isoformat(),
        "below_youngest_category": "assign_with_warning",
        "rounding": "floor_1s",              # näyttö; sijoitus ms-tarkkuudella
        "tie_resolution": "confirmed_order", # sama näyttöaika -> sija vahvistetun maaliintulojärjestyksen mukaan
        "offset_start_policy_default": "ranked",  # ranked | unranked | open_category
        "bib_ranges": {"R4": [101, 199], "R8": [201, 299]},
    },
    "races": [
        {"id": "R4", "name": {"fi": "4 km", "en": "4 km"}, "distance_m": 4000, "start_mode": "mass",
         "scheduled_start": f"{EVENT_DATE}T11:00:00{TZ}", "open_category_id": None},
        {"id": "R8", "name": {"fi": "8 km", "en": "8 km"}, "distance_m": 8000, "start_mode": "mass",
         "scheduled_start": f"{EVENT_DATE}T11:30:00{TZ}", "open_category_id": "K8"},
    ],
    "categories": categories,
    "timing_points": [
        {"id": "TP_START", "kind": "start", "name": "Lähtö"},
        {"id": "TP_FINISH", "kind": "finish", "name": "Maali"},
    ],
    "devices": [{"id": "DEV_LAPTOP_1", "name": "Läppäri 1 (lähtö + maali)", "role": "primary"}],
}

# ---------------- henkilöt ----------------
FIRST_F = ["Aino","Eevi","Helmi","Ilona","Venla","Siiri","Lilja","Emma","Pihla","Oona","Kerttu","Veera","Iida","Sofia",
           "Elli","Minja","Saana","Hanna","Tiina","Sari","Johanna","Kaisa","Minna","Paula","Riikka","Satu","Heidi","Anu","Laura","Maija"]
FIRST_M = ["Eino","Väinö","Onni","Leo","Eeli","Toivo","Aatos","Niilo","Oiva","Veikko","Lauri","Elias","Akseli","Joel",
           "Mikko","Jussi","Timo","Antti","Pekka","Janne","Ville","Kari","Sami","Petri","Juha","Marko","Tuomas","Heikki","Olli","Jarmo"]
LAST = ["Mäkinen","Korhonen","Virtanen","Nieminen","Hämäläinen","Laine","Koskinen","Heikkinen","Järvinen","Lehtonen",
        "Kinnunen","Salonen","Turunen","Rantanen","Leppänen","Hiltunen","Kettunen","Peltonen","Ahonen","Pitkänen",
        "Tikkanen","Halonen","Kärkkäinen","Hyvönen","Manninen","Mustonen","Kauppinen","Väisänen","Räsänen","Kokkonen"]
# Vanha lista: säilytetään vain, jotta satunnaislukujono (ja siten ajat) pysyy ennallaan. Seurat määritetään alempana.
CLUBS = ["Uuraisten Urheilijat", "Uuraisten Urheilijat", "Uuraisten Urheilijat", "", "", "Jyväskylän Kenttäurheilijat", "Petäjäveden Petäjät"]

# ---------------- seurarekisteri ----------------
# Olemassa oleva rekisteri (kertynyt aiemmista kisoista). Lyhenne on ensisijainen tunniste ja yksilöllinen.
# Lyhenteet ovat realistisia Keski-Suomen seuralyhenteitä; SaPu ja Hanka varmistettu julkisista tulospalveluista,
# muut tarkistetaan liiton seurarekisteristä ennen kenttätestiä. official_id-arvot ovat fiktiivisiä.
CLUB_REGISTRY = [
    {"id": "CL_UU",   "abbreviation": "UU",   "name": "Uuraisten Urheilijat",        "municipality": "Uurainen",    "official_id": "TEST-0001"},
    {"id": "CL_JKU",  "abbreviation": "JKU",  "name": "Jyväskylän Kenttäurheilijat", "municipality": "Jyväskylä",   "official_id": "TEST-0002"},
    {"id": "CL_SAPU", "abbreviation": "SaPu", "name": "Saarijärven Pullistus",       "municipality": "Saarijärvi",  "official_id": ""},
    {"id": "CL_HANKA","abbreviation": "Hanka","name": "Hankasalmen Hanka",           "municipality": "Hankasalmi",  "official_id": ""},
    {"id": "CL_PEPE", "abbreviation": "PePe", "name": "Petäjäveden Petäjät",         "municipality": "Petäjävesi",  "official_id": ""},
    {"id": "CL_MUYR", "abbreviation": "MuYr", "name": "Muuramen Yritys",             "municipality": "Muurame",     "official_id": ""},
    # Kaksoiskappale (C1): luotu aiemmassa kisassa vahingossa, ei lyhennettä -> yhdistetään UU:hun.
    {"id": "CL_UU_DUP", "abbreviation": None, "name": "Uuraisten Urh.",              "municipality": "",            "official_id": ""},
]
# Ilmoittautujien seura-arvot sellaisina kuin ne tulevat seuran CSV:ssä: (seura, seuran_lyhenne, kpl)
CLUB_RAW = [
    ("Uuraisten Urheilijat", "", 15), ("UU", "", 3), ("", "UU", 1), ("Uuraisten Urh.", "", 2), ("uuraisten  urheilijat ", "", 1),
    ("Jyväskylän Kenttäurheilijat", "", 4), ("JKU", "", 2), ("Jyväskylän Kenttäurh", "", 1),
    ("SaPu", "", 2), ("Saarijärven Pullistus", "", 2), ("Hanka", "", 2), ("Hankasalmen Hanka", "", 1),
    ("PePe", "", 2), ("Petäjäveden Petäjät", "", 1), ("MuYr", "", 2), ("Muuramen Yritys", "", 1),
    ("Vaajakosken Terä", "VaTe", 1), ("Vaajakosken Teräs", "VaTe", 1), ("", "", 23),
]
used = set()
def name(g):
    while True:
        n = (rnd.choice(FIRST_F if g == "F" else FIRST_M), rnd.choice(LAST))
        if n not in used:
            used.add(n); return n

def bd_for_age(age):
    """Syntymäpäivä 1.1.–1.6. -> sama ikä molemmissa tiloissa."""
    y = EVENT_DATE.year - age
    return dt.date(y, rnd.randint(1, 5), rnd.randint(1, 28))

KID_COUNTS = {"T4":2,"T6":3,"T8":3,"T10":3,"T12":3,"T14":2,"T16":1,"P4":2,"P6":3,"P8":3,"P10":3,"P12":3,"P14":3,"P16":2}
persons = []
def add(cat, g, birth_date=None, birth_year=None, race="R4", **kw):
    fn, ln = name(g)
    p = {"first_name": fn, "last_name": ln, "gender": g, "birth_date": birth_date.isoformat() if birth_date else "",
         "birth_year": birth_year or (birth_date.year if birth_date else None), "_legacy_club_draw": rnd.choice(CLUBS),
         "race": race, "_cat": cat, **kw}
    persons.append(p); return p

for cid in [c for c in KID_COUNTS]:
    c = CAT[cid]
    for i in range(KID_COUNTS[cid]):
        age = c["min_age"] + (i % 2)
        bd = bd_for_age(age)
        # Rajatapaukset (ks. E2E-dokumentti, R1–R3)
        if cid == "T4" and i == 0: bd = dt.date(2023, 8, 1)      # R1: 3 v kisapäivänä, alle nuorimman sarjan
        if cid == "P8" and i == 0: bd = dt.date(2019, 12, 30)    # R2: syntymäpäivä-tila P6, vuosi-tila P8
        if cid == "P16" and i == 0: bd = dt.date(2009, 6, 13)    # R3: täyttää 18 seuraavana päivänä
        if cid == "P6" and i == 0: bd = dt.date(2021, 6, 12)     # R4: täyttää 6 kisapäivänä
        add(cid, c["gender"], bd)
for cid, n in [("N", 15), ("M", 16)]:
    g = CAT[cid]["gender"]
    for i in range(n):
        if cid == "M" and i == 0:
            add(cid, g, None, birth_year=1975, race="R8")       # R5: vain syntymävuosi tiedossa
        elif cid == "N" and i == 13:
            add(cid, g, dt.date(2010, 4, 20), race="R8")        # R6: 17-vuotias ilmoittautunut 8 km -> N
        else:
            add(cid, g, dt.date(rnd.randint(1958, 2005), rnd.randint(1, 12), rnd.randint(1, 28)), race="R8")

# seurojen raaka-arvot (oma satunnaislukugeneraattori, ei vaikuta aikoihin)
club_rng = random.Random(4100)
raw = [(a, b) for a, b, n in CLUB_RAW for _ in range(n)]
assert len(raw) == len(persons), (len(raw), len(persons))
club_rng.shuffle(raw)
for p, (cname, cabbr) in zip(persons, raw):
    p["club_raw"], p["club_abbr_raw"] = cname, cabbr
    p.pop("_legacy_club_draw", None)

# numerolaput
bib = {"R4": 101, "R8": 201}
for p in persons:
    p["bib"] = bib[p["race"]]; bib[p["race"]] += 1
# suostumukset (pitkäaikainen tallennus / SaaS-ominaisuus, tässä vain tallennus testataan)
for i, p in enumerate(persons):
    p["consent_long_term"] = "kyllä" if i % 3 == 0 else "ei"
    p["email"] = f"{p['first_name'].lower()}.{p['last_name'].lower()}@example.com".translate(str.maketrans("äöå", "aoa")) if p["race"] == "R8" or i % 4 == 0 else ""
    if p["race"] == "R4" and p["consent_long_term"] == "kyllä":
        p["consent_given_by"] = "huoltaja"

def by_cat(cid, idx): return [p for p in persons if p["_cat"] == cid][idx]
ROLE = {
    "bib_change": by_cat("T10", 0),       # E3a: lappu vaihdetaan varalappuun 150 ennen lähtöä
    "no_bib": by_cat("P10", 1),           # E4: maaliintulo ilman numeroa, yhdistetään jälkikäteen
    "dns_unresolved": by_cat("T8", 2),    # E1b: ei saavu, ei merkitä etukäteen -> estää lukituksen
    "near_tie_a": by_cat("P12", 0),       # E5b: sama näyttösekunti, eri ms
    "near_tie_b": by_cat("P12", 1),
    "dns": by_cat("N", 4),                # E1a: DNS ilmoitettu ennen lähtöä
    "dnf": by_cat("M", 5),                # E2: keskeyttää
    "swap_a": by_cat("M", 7),             # E3b: juoksijat vaihtoivat lappuja keskenään
    "swap_b": by_cat("M", 8),
    "exact_tie_a": by_cat("M", 10),       # E5a: käsi kädessä, yksi painallus kahdelle
    "exact_tie_b": by_cat("M", 11),
    "early_start": by_cat("M", 12),       # E7: lähtee 30 min etuajassa
    "typo": by_cat("M", 13),              # E9: lappu näppäilty väärin
    "duplicate": by_cat("N", 6),          # E10: kirjattu kahdesti
    "junior_to_adult": by_cat("P16", 1),  # E8a: 17-v vaihtaa 4 km -> 8 km kisapäivänä -> sarja M
    "adult_to_short": by_cat("N", 9),     # E8b: aikuinen yrittää vaihtaa 8 -> 4 km -> estetään (ei aikuisten sarjaa)
}

# jälki-ilmoittautujat (E6)
late = [
    dict(first_name="Ukko", last_name="Lahtinen", gender="M", birth_date="2019-03-14", birth_year=2019, club_query="", race="R4",
         _cat="P8", bib=160, consent_long_term="ei", email="", _late_at="10:42:10", _role="late_before"),
    dict(first_name="Sanni", last_name="Hirvonen", gender="F", birth_date="2016-02-02", birth_year=2016, club_query="UU",
         race="R4", _cat="T10", bib=161, consent_long_term="ei", email="", _late_at="11:01:30", _role="late_after"),
    dict(first_name="Merja", last_name="Toivanen", gender="F", birth_date="1981-09-09", birth_year=1981, club_query="muur", race="R8",
         _cat="N", bib=260, consent_long_term="kyllä", email="merja.toivanen@example.com", _late_at="11:12:45", _role="late_before"),
]

# ---------------- sarjan määritys (oraakkeli) ----------------
def age_of(p, basis):
    if basis == "birth_year" or not p.get("birth_date"):
        return EVENT_DATE.year - int(p["birth_year"]), ("" if basis == "birth_year" else "vain syntymävuosi -> vuosi-ikä")
    b = dt.date.fromisoformat(p["birth_date"])
    return EVENT_DATE.year - b.year - ((EVENT_DATE.month, EVENT_DATE.day) < (b.month, b.day)), ""

def suggest(p, basis, race):
    """1) sopiva sarja ilmoittautumisen matkalla, 2) alle nuorimman -> nuorin + varoitus,
    3) sopiva sarja vain toisella matkalla -> NO_MATCHING_CATEGORY (järjestäjä päättää)."""
    age, note = age_of(p, basis)
    cands = [c for c in categories if c.get("auto_assign", True) and c["gender"] == p["gender"]]
    fits = lambda c: c["min_age"] <= age and (c["max_age"] is None or age <= c["max_age"])
    warn = [note] if note else []
    in_race = [c for c in cands if c["race_id"] == race]
    hit = [c for c in in_race if fits(c)]
    if hit:
        return hit[0]["id"], age, warn
    youngest = min(in_race, key=lambda c: c["min_age"]) if in_race else None
    if youngest and age < youngest["min_age"] and not any(fits(c) for c in cands):
        return youngest["id"], age, warn + [f"ikä {age} alle nuorimman sarjan, sijoitettu {youngest['id']}"]
    other = [c for c in cands if fits(c)]
    if other:
        return "", age, warn + [f"NO_MATCHING_CATEGORY: ikään sopiva sarja {other[0]['id']} on matkalla {other[0]['race_id']}, ilmoittautunut {race}"]
    return "", age, warn + ["NO_MATCHING_CATEGORY: ei sopivaa sarjaa"]

# ---------------- seuran tunnistus (oraakkeli) ----------------
import difflib, re
def norm(x): return re.sub(r"\s+", " ", (x or "").strip().lower())
def token_prefix(a, b):
    ta, tb = norm(a).replace(".", "").split(), norm(b).replace(".", "").split()
    return len(ta) == len(tb) and ta != tb and all(y.startswith(x) for x, y in zip(ta, tb))
def similar(a, b): return token_prefix(a, b) or difflib.SequenceMatcher(None, norm(a), norm(b)).ratio() >= 0.9
def resolve_club(name, abbr, registry, proposals):
    """Palauttaa (match_type, club_id). Järjestys: lyhenne -> nimi -> alias -> samankaltainen -> uusi."""
    by_abbr = {norm(c["abbreviation"]): c for c in registry + proposals if c.get("abbreviation")}
    for key in [abbr, name]:
        c = by_abbr.get(norm(key)) if key else None
        if c:
            if name and norm(name) != norm(key) and norm(name) != norm(c["name"]) and norm(name) not in c.get("aliases", []):
                return "abbreviation_conflict", c["id"]
            return ("abbreviation", c["id"])
    for c in registry + proposals:
        if name and (norm(name) == norm(c["name"]) or norm(name) in c.get("aliases", [])):
            return ("name" if name == c["name"] else "normalized_name"), c["id"]
    if not name: return "none", ""
    sim = [c for c in registry if c.get("abbreviation") and similar(name, c["name"])]
    if sim: return "fuzzy_suggestion", sim[0]["id"]
    nid = "CL_NEW_" + re.sub(r"[^A-Z]", "", (abbr or name).upper())[:6]
    proposals.append({"id": nid, "abbreviation": abbr or None, "name": name, "aliases": []})
    return "new", nid

registry = deepcopy(CLUB_REGISTRY); proposals = []
club_rows, seen_raw = [], {}
for p in persons:
    key = (p["club_raw"], p["club_abbr_raw"])
    if key not in seen_raw:
        seen_raw[key] = resolve_club(*key, registry, proposals)
    p["_club_match"] = seen_raw[key]
# Ratkaisut, jotka järjestäjä tekee tuonnin esikatselussa ja yhdistämisnäkymässä:
CLUB_DECISIONS = [
    dict(type="confirm_club_suggestion", raw="Jyväskylän Kenttäurh", club="CL_JKU", add_alias=True,
         reason="Katkaistu nimi, sama seura"),
    dict(type="create_club", raw="Vaajakosken Terä", abbreviation="VaTe", name="Vaajakosken Terä", municipality="Jyväskylä"),
    dict(type="resolve_abbreviation_conflict", raw="Vaajakosken Teräs", abbreviation="VaTe", resolution="same_club",
         club="CL_NEW_VATE", add_alias=True, reason="Kirjoitusvirhe seuran nimessä, sama lyhenne"),
    dict(type="merge_clubs", source="CL_UU_DUP", target="CL_UU", add_alias=True,
         reason="Kaksoiskappale: 'Uuraisten Urh.' = Uuraisten Urheilijat (UU)"),
]
MERGE = {"CL_UU_DUP": "CL_UU"}
ALL_CLUBS = {c["id"]: c for c in registry + proposals}
def final_club(match):
    mt, cid = match
    return MERGE.get(cid, cid) if cid else ""
for p in persons:
    p["club_id"] = final_club(p["_club_match"])
for key, (mt, cid) in seen_raw.items():
    n = sum(1 for p in persons if (p["club_raw"], p["club_abbr_raw"]) == key)
    fc = MERGE.get(cid, cid) if cid else ""
    club_rows.append(dict(seura=key[0], seuran_lyhenne=key[1], riveja=n, tunnistus=mt, tuonnissa=cid,
                          lopullinen_lyhenne=(ALL_CLUBS[fc]["abbreviation"] if fc else ""),
                          lopullinen_nimi=(ALL_CLUBS[fc]["name"] if fc else "")))
# jälki-ilmoittautujien seurahaku (automaattinen täydennys)
def club_search(q):
    if not q: return ""
    hits = [c for c in registry if c.get("abbreviation") and (norm(c["abbreviation"]) == norm(q) or norm(c["name"]).startswith(norm(q)))]
    return hits[0]["id"] if hits else ""
CLUB_OF_QUERY = {L: club_search(L) for L in ["", "UU", "muur"]}

# ---------------- kisapäivän skripti ----------------
def t(hms, ms=0):
    h, m, s = map(int, hms.split(":"))
    return dt.datetime.combine(EVENT_DATE, dt.time(h, m, s, ms * 1000))
def iso(x): return x.isoformat(timespec="milliseconds") + TZ

START = {"R4": t("11:00:00", 412), "R8": t("11:30:01", 137)}
actions = []
def act(at, typ, **kw): actions.append({"at": iso(at), "type": typ, **kw})
for i, d in enumerate(CLUB_DECISIONS):   # valmistelu: tuonnin jälkeen, ennen kisapäivän toimistoa
    act(t("09:00:00") + dt.timedelta(minutes=i), d["type"], **{k: v for k, v in d.items() if k != "type"})

for L in late:
    if L["_role"] == "late_before":
        act(t(L["_late_at"]), "register_late", person={k: L[k] for k in ["first_name","last_name","gender","birth_date","email"]}, club_query=L["club_query"],
            expect_club=CLUB_OF_QUERY[L["club_query"]],
            race=L["race"], bib=L["bib"], consent_long_term=L["consent_long_term"])
act(t("10:30:00"), "change_bib", bib_from=ROLE["bib_change"]["bib"], bib_to=150, reason="Numerolappu kadonnut, annettu varalappu")
act(t("10:35:00"), "set_status", bib=ROLE["dns"]["bib"], status="dns", reason="Ilmoitti sairastumisesta")
act(t("10:48:00"), "change_race_rejected", bib=ROLE["adult_to_short"]["bib"], race="R4",
    expect_error="NO_MATCHING_CATEGORY", note="Aikuisille ei ole lyhyttä matkaa; juoksija pysyy 8 km:llä")
act(t("10:50:00"), "change_race", bib=ROLE["junior_to_adult"]["bib"], race="R8", bib_to=270,
    expect_category="M", reason="17-vuotias haluaa juosta pidemmän matkan -> aikuisten sarja 8 km")
act(t("10:55:00"), "set_start_offset", bib=ROLE["early_start"]["bib"], offset_ms=-30 * 60 * 1000,
    reason="Lähtee 4 km:n lähdön mukana 30 min etuajassa (aikataulusyy)")
act(START["R4"], "start", race="R4", device="DEV_LAPTOP_1")
L = late[1]
act(t(L["_late_at"]), "register_late", person={k: L[k] for k in ["first_name","last_name","gender","birth_date","email"]}, club_query=L["club_query"],
            expect_club=CLUB_OF_QUERY[L["club_query"]],
    race="R4", bib=L["bib"], consent_long_term="ei")
act(t("11:01:40"), "set_start_offset", bib=161, offset_ms=2 * 60 * 1000, reason="Myöhästyi lähdöstä, lähti 2 min myöhässä")
act(START["R8"], "start", race="R8", device="DEV_LAPTOP_1")

for L in late:
    L["club_id"] = CLUB_OF_QUERY[L["club_query"]]

# lopullinen kirjanpito: kuka juoksee mitäkin matkaa millä lapulla
roster = []
for p in persons + late:
    q = deepcopy(p)
    if q is not None and p is ROLE["bib_change"]: q["final_bib"] = 150
    elif p is ROLE["junior_to_adult"]: q["final_bib"] = 270; q["race"] = "R8"; q["_cat"] = "M"
    else: q["final_bib"] = p["bib"]
    q["_role"] = next((k for k, v in ROLE.items() if v is p), p.get("_role", ""))
    roster.append(q)

def run_time_s(q):
    if q["race"] == "R4":
        age = age_of(q, "birth_date")[0]
        base = {3: 44, 4: 42, 5: 38, 6: 34, 7: 31, 8: 28, 9: 26, 10: 24, 11: 23, 12: 21, 13: 20, 14: 19, 15: 18, 16: 17, 17: 16.5}[age]
        return (base + rnd.uniform(-2.5, 3.5)) * 60
    return rnd.uniform(32, 58) * 60

taps = []   # (time, bib_typed, tag)
for q in roster:
    r = q["_role"]
    if r in ("dns", "dns_unresolved", "dnf"): continue
    start = START[q["race"]]
    if r == "early_start": start = START["R8"] - dt.timedelta(minutes=30)
    if r == "late_after": start = START["R4"] + dt.timedelta(minutes=2)
    q["_finish"] = start + dt.timedelta(seconds=run_time_s(q), milliseconds=rnd.randint(0, 999))
# erityisajat
a, b = [next(x for x in roster if x["_role"] == k) for k in ("near_tie_a", "near_tie_b")]
a["_finish"] = START["R4"] + dt.timedelta(minutes=22, seconds=13, milliseconds=240)
b["_finish"] = START["R4"] + dt.timedelta(minutes=22, seconds=13, milliseconds=780)
a, b = [next(x for x in roster if x["_role"] == k) for k in ("exact_tie_a", "exact_tie_b")]
a["_finish"] = b["_finish"] = START["R8"] + dt.timedelta(minutes=41, seconds=7, milliseconds=505)
e = next(x for x in roster if x["_role"] == "early_start")
e["_finish"] = START["R8"] + dt.timedelta(minutes=12, seconds=3, milliseconds=290)   # oma aika ~42:03

# varmistetaan, ettei satunnaisia ms-tasatuloksia synny
seen = set()
for q in roster:
    if "_finish" in q and q["_role"] not in ("exact_tie_a", "exact_tie_b"):
        while q["_finish"] in seen: q["_finish"] += dt.timedelta(milliseconds=1)
        seen.add(q["_finish"])

sw_a, sw_b = [next(x for x in roster if x["_role"] == k) for k in ("swap_a", "swap_b")]
tap_id = 0
def tap(at, bib_typed, mode="time_first"):
    global tap_id; tap_id += 1
    tid = f"F{tap_id:03d}"
    act(at, "finish_tap", tap_id=tid, device="DEV_LAPTOP_1", bib=bib_typed, mode=mode)
    return tid
for q in sorted([x for x in roster if "_finish" in x], key=lambda x: (x["_finish"], x["final_bib"])):
    r = q["_role"]
    if r == "exact_tie_b": continue
    typed = q["final_bib"]
    if r == "swap_a": typed = sw_b["final_bib"]
    if r == "swap_b": typed = sw_a["final_bib"]
    if r == "typo": typed = int(str(typed)[0] + str(typed)[2] + str(typed)[1])   # esim. 229 -> 292
    mode = "bib_first" if q["race"] == "R8" and q["final_bib"] % 5 == 0 and r == "" else "time_first"
    tid = tap(q["_finish"], None if r == "no_bib" else typed, mode)
    q["_tap"] = tid
    if r == "no_bib":
        tid2 = tap(q["_finish"] + dt.timedelta(milliseconds=310), None)   # E4b: vahinkotuplapainallus
        q["_ghost"] = tid2
    if r == "duplicate":
        q["_dup"] = tap(q["_finish"] + dt.timedelta(seconds=3, milliseconds=120), typed)
    if r == "exact_tie_a":
        q["_copy"] = tid
    if r == "typo": q["_typed"] = typed

end = max(x["_finish"] for x in roster if "_finish" in x)
c0 = end + dt.timedelta(minutes=3)
k = 0
def corr(typ, **kw):
    global k; k += 1
    act(c0 + dt.timedelta(seconds=20 * k), typ, **kw)
q = next(x for x in roster if x["_role"] == "exact_tie_a"); qb = next(x for x in roster if x["_role"] == "exact_tie_b")
corr("copy_time", source_tap_id=q["_copy"], bib=qb["final_bib"], reason="Tulivat käsi kädessä, sama aika")
q = next(x for x in roster if x["_role"] == "no_bib")
corr("assign_bib", tap_id=q["_tap"], bib=q["final_bib"], reason="Numero ei näkynyt; tunnistettu maalikirjurin muistiinpanosta")
corr("void", tap_id=q["_ghost"], reason="Vahinkotuplapainallus")
q = next(x for x in roster if x["_role"] == "duplicate")
corr("void", tap_id=q["_dup"], reason="Sama juoksija kirjattu kahdesti")
q = next(x for x in roster if x["_role"] == "typo")
corr("assign_bib", tap_id=q["_tap"], bib=q["final_bib"], reason=f"Näppäilyvirhe {q['_typed']} -> {q['final_bib']}")
corr("assign_bib", tap_id=sw_a["_tap"], bib=sw_a["final_bib"], reason="Juoksijat vaihtoivat lappuja keskenään")
corr("assign_bib", tap_id=sw_b["_tap"], bib=sw_b["final_bib"], reason="Juoksijat vaihtoivat lappuja keskenään")
q = next(x for x in roster if x["_role"] == "dnf")
corr("set_status", bib=q["final_bib"], status="dnf", reason="Keskeytti 5 km kohdalla (ilmoitti maalissa)")
# --- tasatulosryhmät: sama näyttöaika (floor 1 s) samalla matkalla ---
def start_of(q):
    st = START[q["race"]]
    if q["_role"] == "early_start": st -= dt.timedelta(minutes=30)
    if q["_role"] == "late_after": st += dt.timedelta(minutes=2)
    return st
for q in roster:
    if "_finish" in q and q["_role"] != "dnf":
        # race-day.json stores millisecond timestamps (isoformat truncates).
        # Elapsed time is that stored difference, not a sub-millisecond rounding of the original timedelta.
        finish = dt.datetime.fromisoformat(iso(q["_finish"]))
        start = dt.datetime.fromisoformat(iso(start_of(q)))
        delta = finish - start
        q["_ms"] = delta.days * 86400000 + delta.seconds * 1000 + delta.microseconds // 1000
groups = {}
for q in roster:
    if "_ms" in q: groups.setdefault((q["race"], q["_ms"] // 1000), []).append(q)
tie_groups = {k: sorted(v, key=lambda x: (x["_ms"], x["final_bib"])) for k, v in groups.items() if len(v) > 1}
def fmt_s(sec): return f"{sec//3600}:{sec%3600//60:02d}:{sec%60:02d}" if sec >= 3600 else f"{sec//60}:{sec%60:02d}"
CONFIRM = {}   # (race, bib) -> sijaryhmän indeksi vahvistetussa järjestyksessä
tie_rows, confirm_actions = [], []
for (race, sec), members in sorted(tie_groups.items()):
    bibs = [m["final_bib"] for m in members]
    roles = {m["_role"] for m in members}
    if {"near_tie_a", "near_tie_b"} <= roles:
        order = [[b] for b in reversed(bibs)]
        reason = "Maalikirjurin havainto: myöhemmin kirjattu juoksija oli rinnassa edellä"
    elif {"exact_tie_a", "exact_tie_b"} <= roles:
        order = [bibs]
        reason = "Ei erotettavissa (tulivat käsi kädessä) -> jaettu sija"
    else:
        order = [[b] for b in bibs]
        reason = "Kirjausjärjestys vahvistettu"
    for i, grp in enumerate(order):
        for b in grp: CONFIRM[(race, b)] = i
    tie_rows.append(dict(race=race, display_time=fmt_s(sec), bibs_in_tap_order=" ".join(map(str, bibs)),
                         confirmed_order=" > ".join("=".join(map(str, g)) for g in order), reason=reason))
    confirm_actions.append(dict(race=race, display_time=fmt_s(sec), order=order, reason=reason))
q = next(x for x in roster if x["_role"] == "dns_unresolved")
for race in ("R4", "R8"):
    bl = [f"tie:{r}:{tr['display_time']}" for tr in tie_rows for r in [tr["race"]] if r == race]
    if race == "R4": bl = [f"entry:{q['final_bib']}:no_result"] + bl
    corr("check_lock_blocked", race=race, expect_blockers=bl)
for ca in confirm_actions:
    corr("confirm_tie_order", **ca)
corr("set_status", bib=q["final_bib"], status="dns", reason="Ei saapunut lähtöön (todettu jälkikäteen)")
corr("lock", race="R4"); corr("lock", race="R8")
corr("edit_after_lock_rejected", race="R8", expect_error="EVENT_LOCKED")
actions.sort(key=lambda a: a["at"])

# ---------------- odotetut tulokset (oraakkeli) ----------------
def fmt(ms):
    s = ms // 1000
    return f"{s//3600}:{s%3600//60:02d}:{s%60:02d}" if s >= 3600 else f"{s//60}:{s%60:02d}"

K_ANON = 3   # pienin julkaistava ryhmäkoko (k-anonymiteetti), asetus privacy.min_group_size

def results(offset_policy, anonymized=False):
    """anonymized=True: tilanne säilytysajan jälkeen (12 kk), julkinen tuloslista."""
    rows = []
    for race in ("R4", "R8"):
        entrants = [q for q in roster if q["race"] == race]
        for q in entrants:
            q = q
            r = q["_role"]
            st = {"dns": "DNS", "dns_unresolved": "DNS", "dnf": "DNF"}.get(r, "OK")
            # Race-day category follows age on the event date, not the construction bucket.
            suggested, _age, _warn = suggest(q, "birth_date", q["race"])
            cat = suggested or q["_cat"]
            offset = 0
            note = []
            if r == "early_start": offset = -30 * 60000; note.append("Siirretty lähtö −30:00")
            if r == "late_after": offset = 2 * 60000; note.append("Siirretty lähtö +2:00")
            if r == "late_after" or r == "late_before": note.append("Jälki-ilmoittautunut")
            if r == "junior_to_adult": note.append("Vaihtoi matkaa 4 km → 8 km")
            ranked = CAT[cat]["ranked"]
            if offset and r == "early_start":
                if offset_policy == "unranked": ranked = False; note.append("Sijoittamaton")
                if offset_policy == "open_category": cat = event["races"][1 if race == "R8" else 0]["open_category_id"]; ranked = False
            ms = None
            if st == "OK":
                ms = q["_ms"]
            q["_res"] = dict(race=race, category=cat, bib=q["final_bib"], name=f"{q['last_name']} {q['first_name']}",
                             club_abbr=(ALL_CLUBS[q["club_id"]]["abbreviation"] if q["club_id"] else ""),
                             club_name=(ALL_CLUBS[q["club_id"]]["name"] if q["club_id"] else ""), status=st, time_ms=ms, ranked=ranked, note="; ".join(note))
        for scope in ["overall"] + [c["id"] for c in categories if c["race_id"] == race]:
            grp = [q["_res"] for q in entrants if scope == "overall" or q["_res"]["category"] == scope]
            if not grp: continue
            # sija: näyttöaika (floor 1 s), sitten vahvistettu maaliintulojärjestys tasatulosryhmässä
            tie_key = lambda g: (g["time_ms"] // 1000, CONFIRM.get((race, g["bib"]), 0))
            ok = sorted([g for g in grp if g["status"] == "OK" and g["ranked"]], key=lambda g: (*tie_key(g), g["time_ms"], g["bib"]))
            unr = sorted([g for g in grp if g["status"] == "OK" and not g["ranked"]], key=lambda g: (g["time_ms"], g["bib"]))
            bad = sorted([g for g in grp if g["status"] != "OK"], key=lambda g: (g["status"], g["bib"]))
            prev_key, prev_rank = None, 0
            for i, g in enumerate(ok, 1):
                key = tie_key(g)
                rank = prev_rank if key == prev_key else i
                prev_key, prev_rank = key, rank
                lead = ok[0]["time_ms"]
                rows.append(dict(race=race, scope=scope, rank=rank, bib=g["bib"], name=g["name"], club_abbr=g["club_abbr"], club_name=g["club_name"], category=g["category"],
                                 time=fmt(g["time_ms"]), time_ms=g["time_ms"],
                                 behind=("" if i == 1 else "+" + fmt((g["time_ms"] // 1000 - lead // 1000) * 1000)), status="OK", note=g["note"]))
            for g in unr:
                rows.append(dict(race=race, scope=scope, rank="", bib=g["bib"], name=g["name"], club_abbr=g["club_abbr"], club_name=g["club_name"], category=g["category"],
                                 time=fmt(g["time_ms"]), time_ms=g["time_ms"], behind="", status="OK", note=g["note"] or "Sijoittamaton"))
            for g in bad:
                rows.append(dict(race=race, scope=scope, rank="", bib=g["bib"], name=g["name"], club_abbr=g["club_abbr"], club_name=g["club_name"], category=g["category"],
                                 time="", time_ms="", behind="", status=g["status"], note=g["note"]))
    if anonymized:
        rows = [anonymize_row(r) for r in rows]
    return rows

def anonymize_row(r):
    q = next(x for x in roster if x["race"] == r["race"] and x["final_bib"] == r["bib"])
    if q["consent_long_term"] == "kyllä":
        return r
    r = dict(r)
    res = q["_res"]
    same = [x for x in roster if x["race"] == r["race"] and x["_res"]["category"] == res["category"] and x["club_id"] == q["club_id"]]
    show_club = bool(q["club_id"]) and len(same) >= K_ANON
    r["name"] = f"Anonyymi ({r['club_abbr']})" if show_club else "Anonyymi"
    r["bib"] = ""
    if not show_club:
        r["club_abbr"] = r["club_name"] = ""
    notes = ["anonymisoitu"]
    if q["club_id"] and not show_club: notes.append("seura piilotettu (pieni ryhmä)")
    cat_size = sum(1 for x in roster if x["race"] == r["race"] and x["_res"]["category"] == res["category"])
    if cat_size < K_ANON:
        # Pieni sarja: sarja yleistetään sukupuoliryhmäksi (T/P/N/M ilman ikää); sarjan omassa listassa myös aika piilotetaan.
        r["category"] = re.sub(r"\d+$", "", res["category"]) or res["category"]
        notes.append("sarja yleistetty (pieni sarja)")
        if r["scope"] != "overall":
            r["time"] = r["time_ms"] = r["behind"] = ""
            notes.append("aika piilotettu (pieni sarja)")
    # Vain tuloksen tulkintaan vaikuttava merkintä säilyy (siirretty lähtö, ilman tarkkaa poikkeamaa);
    # yksilöivät merkinnät (jälki-ilmoittautuminen, matkan vaihto) poistetaan.
    kept = ["Siirretty lähtö"] if "Siirretty lähtö" in r["note"] else []
    r["note"] = "; ".join(kept + notes)
    return r

def club_stats():
    """Seuratilastot: sisäiset luvut ovat tarkat; julkaistuissa alle K_ANON:n solut yhdistetään 'Muut seurat' -riviin.
    Jos vain yksi seura jäisi piiloon, myös seuraavaksi pienin yhdistetään (komplementaarinen piilotus)."""
    out = []
    for race in ("R4", "R8"):
        ent = [q for q in roster if q["race"] == race]
        groups = {}
        for q in ent: groups.setdefault(q["club_id"] or "-", []).append(q)
        sizes = sorted(groups.items(), key=lambda kv: (len(kv[1]), kv[0]))
        small = {k for k, v in groups.items() if len(v) < K_ANON}
        if len(small) == 1:
            nxt = next(k for k, v in sizes if k not in small)
            small.add(nxt)
        muut = [q for k in small for q in groups[k]]
        for cid, qs in sorted(groups.items(), key=lambda kv: (-len(kv[1]), kv[0])):
            c = ALL_CLUBS.get(cid)
            fin = sum(1 for q in qs if q["_res"]["status"] == "OK")
            out.append(dict(race=race, club_abbr=(c["abbreviation"] if c else "(ei seuraa)"), club_name=(c["name"] if c else ""),
                            entrants=len(qs), finishers=fin,
                            published_as=("Muut seurat" if cid in small else (c["abbreviation"] if c else "(ei seuraa)"))))
        out.append(dict(race=race, club_abbr="Muut seurat", club_name=f"{len(small)} ryhmää", entrants=len(muut),
                        finishers=sum(1 for q in muut if q["_res"]["status"] == "OK"), published_as="Muut seurat"))
    return out

def write_csv(path, rows, fields):
    with open(os.path.join(OUT, path), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, delimiter=";"); w.writeheader(); w.writerows(rows)

# ---------------- kirjoitus ----------------
with open(os.path.join(OUT, "event.json"), "w", encoding="utf-8") as f:
    json.dump(event, f, ensure_ascii=False, indent=2)
write_csv("entries.csv",
          [dict(etunimi=p["first_name"], sukunimi=p["last_name"], sukupuoli={"F": "N", "M": "M"}[p["gender"]],
                syntymaaika=p["birth_date"], syntymavuosi=p["birth_year"], seura=p["club_raw"], seuran_lyhenne=p["club_abbr_raw"],
                matka={"R4": "4 km", "R8": "8 km"}[p["race"]], numero=p["bib"], sahkoposti=p["email"],
                pitkaaikainen_tallennus=p["consent_long_term"], suostumuksen_antaja=p.get("consent_given_by", ""))
           for p in persons],
          ["etunimi","sukunimi","sukupuoli","syntymaaika","syntymavuosi","seura","seuran_lyhenne","matka","numero","sahkoposti","pitkaaikainen_tallennus","suostumuksen_antaja"])
cat_rows = []
for p in persons + late:
    row = dict(numero=p["bib"], nimi=f"{p['last_name']} {p['first_name']}", matka=p["race"], syntymaaika=p["birth_date"], syntymavuosi=p["birth_year"])
    for basis in ("birth_date", "birth_year"):
        cid, age, warn = suggest(p, basis, p["race"])
        row[f"{basis}_ika"] = age; row[f"{basis}_sarja"] = cid or ""; row[f"{basis}_varoitukset"] = " | ".join(warn)
    cat_rows.append(row)
write_csv("expected-categories.csv", cat_rows, list(cat_rows[0].keys()))
with open(os.path.join(OUT, "race-day.json"), "w", encoding="utf-8") as f:
    json.dump({"event_id": event["id"], "description": "Kisapäivän toimenpiteet aikajärjestyksessä (E2E-skripti).",
               "actions": actions}, f, ensure_ascii=False, indent=2)
fields = ["race","scope","rank","bib","name","club_abbr","club_name","category","time","time_ms","behind","status","note"]
for suffix, op in [("", "ranked"), (".offset-unranked", "unranked"), (".offset-open-category", "open_category")]:
    write_csv(f"expected-results{suffix}.csv", results(op), fields)
write_csv("expected-results.anonymized.csv", results("ranked", anonymized=True), fields)
results("ranked")   # palauttaa _res-tilan oletussäännölle tilastoja varten
write_csv("expected-club-stats.csv", club_stats(), ["race", "club_abbr", "club_name", "entrants", "finishers", "published_as"])
write_csv("expected-clubs.csv", club_rows, ["seura", "seuran_lyhenne", "riveja", "tunnistus", "tuonnissa", "lopullinen_lyhenne", "lopullinen_nimi"])
with open(os.path.join(OUT, "clubs-registry.json"), "w", encoding="utf-8") as f:
    json.dump({"description": "Seurarekisteri ennen Kuulan hölkkää (kertynyt aiemmista kisoista). CL_UU_DUP on kaksoiskappale.",
               "clubs": CLUB_REGISTRY}, f, ensure_ascii=False, indent=2)
write_csv("expected-tie-groups.csv", tie_rows, ["race", "display_time", "bibs_in_tap_order", "confirmed_order", "reason"])

# yhteenveto dokumentaatioon
summary = {k: dict(bib=next(x for x in roster if x["_role"] == k)["final_bib"],
                   orig_bib=(v["bib"] if v else None)) for k, v in list(ROLE.items())}
summary["late_before"] = [160, 260]; summary["late_after"] = 161
n_taps = sum(1 for a in actions if a["type"] == "finish_tap")
print(json.dumps({"persons_preregistered": len(persons), "late": len(late), "total": len(persons) + len(late),
                  "finish_taps": n_taps, "actions": len(actions), "roles": summary}, ensure_ascii=False, indent=1))
