# Easy Race Timer – määrittely (lopullinen v1, 14.10.2026)

Repo: github.com/Vihvila92/Easy-Race-Timer. Toteutus aloitetaan **alusta samaan repoon**: vanha koodi säilytetään tagissa `legacy-2025` ja poistetaan päähaarasta. Taustana repoarvio `REPO_ARVIO.md`.
Testidata ja hyväksymistesti ovat hakemistossa `testdata/kuulan-holkka/`, joka siirtyy repoon samaan polkuun (ks. kohta 11).

## 1. Tavoite ja rajaus

Tavoitteena on yksinkertainen ja luotettava ajanotto seurakisoille (10–500 osallistujaa). Ensimmäinen oikea käyttökohde ja v0.1:n hyväksymistesti on **Kuulan hölkkä** (Uurainen, Uuraisten Urheilijat ry, noin 70 osallistujaa, yhteislähtö, kaksi matkaa, 16 sarjaa). Lapset ja 16–17-vuotiaat juoksevat lyhyemmän matkan ja aikuiset pidemmän; aikuisille ei ole lyhyttä matkaa.

- **v0.1:** yksi kannettava tietokone toimii palvelimena, lähtökoneena ja maalikoneena. Verkkoa ei tarvita lainkaan.
- **Myöhemmin:** useita koneita ja mobiililaitteita (lähtö, maali, väliajat). Jokainen laite toimii täysin ilman verkkoa ja synkronoi myöhemmin.
- **Liiketoiminta:** ydin on avointa lähdekoodia (AGPL-3.0), ja seurat voivat ajaa sen itse ilmaiseksi. Maksullinen SaaS on seuran vuosimaksu (rajattomasti kisoja ja osallistujia), ja siihen kuuluvat pilvisynkronointi, verkon livetulokset, pitkäaikainen tallennus suostumuksella ja myöhemmin juoksijaportaali (kohta 10).

Periaatteet:
1. **Ajanottotapahtuma on pyhä.** Jokainen painallus tallennetaan heti eikä sitä koskaan poisteta. Korjaukset tehdään uusina tapahtumina (append-only + audit-loki).
2. **Tulokset lasketaan aina tapahtumista**, eikä niitä tallenneta käsin. Korjaus päivittää kaiken.
3. **Offline ensin.** Jokainen laite on oma tietovarastonsa ja toimii ilman verkkoa. Synkronointi on tapahtumalokien yhdistämistä, ja ristiriidat näytetään käyttäjälle eikä niitä ratkaista hiljaa.
4. **v0.1 on pieni ja paikallinen.** Yksi prosessi, yksi SQLite-tiedosto ja yksi kone. Ei kirjautumista (PIN suojaa ylläpidon), ei pilveä.
5. **Modulaarisuus ilman ylirakentamista.** Moduulirajat, laajennuspisteet ja pilvivalmis tietomalli (kohta 4) tehdään heti, mutta pilvipalvelut vasta kun niitä tarvitaan.

## 2. Mitä vanhasta otetaan mukaan

| Vanha osa | Käyttö uudessa |
|---|---|
| Käsitteet: kilpailu, sarja, kilpailija, osallistuminen + numerolappu, ajanottotapahtuma | Pohja tietomallille (kohta 6). *Kilpailija* jaetaan kahdeksi: **henkilö** (pysyvä) ja **osallistuminen** (kisakohtainen). Organisaatiotaulu ja RLS poistuvat, mutta `org_id`-sarake jää. |
| Rajoitteet: lappu > 0 ja uniikki matkalla; syntymävuosi 1900–nyt; henkilön identiteetti nimi + vuosi (kirjainkoko ei vaikuta) | Sellaisenaan. |
| zod-validointi + vakaat virhekoodit (`VALIDATION_ERROR`, `NOT_FOUND`, `ENTRY_EXISTS`) | Sama malli, `docs/api/ERROR_CODES.md` päivitetään. `ORG_HEADER_REQUIRED` poistuu. Uudet: `BIB_IN_USE`, `RACE_NOT_STARTED`, `EVENT_LOCKED`, `LOCK_BLOCKED`, `PIN_REQUIRED`, `NO_MATCHING_CATEGORY`, `TIE_UNCONFIRMED`, `CLUB_ABBREVIATION_TAKEN`, `CLUB_ABBREVIATION_CONFLICT`, `SYNC_CONFLICT`. |
| `timing_events.source`, kategorian `min_age`/`max_age`, `start_time_offset` | Laajennettuina tietomalliin. |
| Sekuntikellojen varmistus (StopwatchManager) ja NTP-tyyppinen synkronointi | Varakellot (7.7) ja kellojen synkronointi (7.5). |
| CI, CodeQL, Dependabot, CODEOWNERS, PR-pohja | Pidetään muokattuina. CI:ssä ei Postgres-palvelua; lisätään web-build, E2E ja lisenssitarkistus. |
| Dependabot-PR:t #28, #30, #32, #33, #36, #37, #38 | Suljetaan kommentilla "korvattu uudella pohjalla". |
| README:n lajit, kilpailutyypit ja ideat | Tiekartta (kohta 12). |

Ei oteta mukaan v1:een: Postgres + RLS + multi-tenancy (palaa SaaS-vaiheessa `storage`-rajapinnan takana), kolme käyttöönottomallia, JWT, `db.js`/`db.ts`/`db.cjs`, vanha 736-rivinen arkkitehtuuridokumentti (korvataan tällä tiedostolla ja ADR:illä) ja nykyinen oma LICENSE (korvataan AGPL-3.0:lla, kohta 10.2).

## 3. Tekninen pino

- **TypeScript-monorepo** (pnpm workspaces), paketit kohdan 4.1 mukaan.
- **Palvelin (kannettava):** Node 22 LTS, Fastify, **salattu SQLite** (SQLCipher, `better-sqlite3-multiple-ciphers`, AES-256, WAL, `synchronous=FULL`, `temp_store=MEMORY`), zod, pino. Käynnistyy yhdellä komennolla tai valmiista asennuspaketista (Windows/macOS/Linux). Käyttöliittymä avataan samalla koneella osoitteessa `http://localhost`, joka on selaimelle turvallinen konteksti, joten PWA ja service worker toimivat ilman sertifikaattia.
- **Web:** React + TypeScript + Vite, **PWA** (service worker, IndexedDB-paikallisvarasto). Ulkoasu HIG-henkinen: kosketusalueet ≥ 44 pt, maalinappi ≥ 30 % näytöstä, tumma ja vaalea teema. Kohde ES2019, joten vanhat Android/iOS-laitteet toimivat.
- **Mobiililaitteet (v0.2):** väliaikalaitteet ovat PWA:ita, joten tarvitaan HTTPS. Ratkaisu valitaan ADR:ssä v0.2:n alussa. Vaihtoehdot: (a) julkinen HTTPS-osoite, josta PWA asennetaan välimuistiin ja joka synkronoi kannettavalle tai pilveen; (b) paikallinen sertifikaatti oman domainin alla (`*.lan.easyracetimer.fi`, DNS osoittaa lähiverkkoon); (c) natiivikääre (Capacitor).
- **Natiivisovellukset (myöhemmin, SaaS, v1.x):** iOS (Swift/SwiftUI) ja Android (Kotlin/Jetpack Compose). Niillä saadaan paras suorituskyky ja tarkin ajanotto: monotoninen kello (`mach_continuous_time` / `SystemClock.elapsedRealtimeNanos`), alhainen kosketusviive, haptiikka, fyysiset painikkeet, taustasynkronointi sekä myöhemmin BLE/NFC. PWA riittää alkuun. API ja synkronointiprotokolla suunnitellaan alustariippumattomiksi (kohta 9.1), jotta natiivisovellukset voivat käyttää niitä suoraan ilman palvelinmuutoksia.
- **Synkronointi:** WebSocket lähiverkossa, tiedostovienti/-tuonti (`.ertx`) ilman verkkoa ja pilvivälitys (SaaS) mobiilinetin yli.
- **i18n:** fi ja en alusta asti. Kaikki tekstit avaimina, myös tulosteet, CSV-otsikot ja sarjanimet. Kieli valitaan laitekohtaisesti.
- **Testit:** Vitest (yksikkö- ja ominaisuuspohjaiset testit fast-checkillä), API-testit, Playwright E2E (Kuulan hölkkä).

## 4. Arkkitehtuuri ja moduulit

### 4.1 Modulaarinen monoliitti
Järjestelmä on yksi Node-prosessi, joka on jaettu moduuleihin. Moduulit kutsuvat toisiaan vain julkisen rajapinnan (`index.ts`) ja sisäisen tapahtumaväylän kautta, eivät koskaan toistensa tauluihin suoraan. Raja tarkistetaan CI:ssä (dependency-cruiser). SaaS-versio käyttää samoja moduuleja.

```
packages/
  core/            -- domain: tyypit, zod-skeemat, sarjan määritys, tuloslaskenta (puhdas TS, ei I/O:ta)
  people/          -- henkilöt, seurarekisteri (tunnistus, yhdistäminen), suostumukset, säilytys ja anonymisointi
  sports/          -- lajiprofiilit (laajennuspiste A)
  timing-sources/  -- ajanottotavat (laajennuspiste B)
  race-formats/    -- lähtö- ja kilpailumuodot (laajennuspiste C)
  exporters/       -- tulosten vienti (laajennuspiste D)
  storage/         -- Repository-rajapinnat + SQLite (laajennuspiste E); IndexedDB-toteutus mobiilille
  sync/            -- tapahtumalokien replikointi, kellojen synkronointi, siirtotavat (laajennuspiste F)
  i18n/            -- fi/en, jaettu webin ja tulosteiden kesken
  server/          -- HTTP/WS, kokoaa moduulit (composition root)
  web/             -- PWA, näkymät rooleittain
```
SaaS-operoinnin koodi (laskutus, seurojen provisiointi, infra, juoksijaportaali alkuvaiheessa) on erillisessä yksityisessä repossa `easy-race-timer-cloud`. Se käyttää ytimen laajennuspisteitä eikä muuta ydintä (kohta 10.2).

| Kerros | Moduulit | Saa riippua |
|---|---|---|
| Sovellus | `server`, `web` | kaikista alla olevista |
| Laajennukset | `sports`, `timing-sources`, `race-formats`, `exporters` | `core`, `i18n` |
| Infra | `storage`, `sync`, `people` | `core` |
| Ydin | `core` | ei mistään (toimii palvelimella ja selaimessa) |

Tuloslaskenta on puhdas funktio `computeResults(race, entries, events, corrections, settings, format, sport) → Result[]`. Sama koodi toimii palvelimella, mobiililaitteessa (offline-esikatselu) ja pilvessä.

### 4.2 Laajennuspisteet
Laajennus toteuttaa rajapinnan ja rekisteröidään `registry.register(...)`-kutsulla. v1:ssä laajennukset käännetään mukaan. Ulkoinen plugin-rajapinta (`apiVersion`) avataan aikaisintaan v1.x:ssä.

| Laajennuspiste | Rajapinta (tiivistetty) | v0.1 | Myöhemmin |
|---|---|---|---|
| **A. Laji** `SportProfile` | oletukset (pyöristys, lähtötapa, sarjapohjat), terminologia, `validateRace()` | juoksu | hiihto, pyöräily (maantie/CX/MTB), triathlon, suunnistus |
| **B. Ajanottotapa** `TimingSource` | `normalize(raw) → TimingEvent[]`, `clockModel` (synkronoitu / offset-kello / absoluuttinen) | kosketusnappi, käsisyöttö | varakello, CSV-tuonti, RFID/chip, valokenno |
| **C. Kilpailumuoto** `RaceFormat` | `startTimeFor(entry)`, `finishCriteria`, `rank()` | yhteislähtö + osallistujakohtainen lähtösiirto | yksilölähtö, viesti, kierrokset, monipäiväinen, cup-pisteet |
| **D. Vienti** `Exporter` | `export(results, locale) → Buffer` | tuloste (A4), CSV | PDF, Excel, liittojen formaatit, staattinen HTML-julkaisu |
| **E. Tallennus** `Repository` | `EventRepo`, `EntryRepo`, `TimingEventRepo` … + `UnitOfWork` | SQLite | IndexedDB (mobiili, v0.2), PostgreSQL (SaaS) |
| **F. Synkronoinnin siirtotapa** `SyncTransport` | `push(batch)`, `pull(since)`, `clockSample()` | tiedosto (`.ertx`, vain vienti ja tuonti) | LAN-WebSocket (v0.2), pilvivälitys (SaaS) |

Uuden lajin, ajanottotavan tai siirtotavan lisääminen tarkoittaa uutta moduulia ja sen rekisteröintiä. Ytimeen tai skeemaan ei tarvitse koskea. Lajikohtainen lisädata tallennetaan versioituun `settings_json`-kenttään.

### 4.3 Sisäinen tapahtumaväylä
Domain-tapahtumat (`TimingEventRecorded`, `CorrectionApplied`, `EntryChanged`, `ResultsInvalidated`, `ConsentChanged`) kulkevat in-process-väylän kautta. Tuloslaskenta, WebSocket, varmuuskopio ja synkronointi ovat tilaajia.

### 4.4 Pilvi- ja moniseuravalmius jo nyt (halvat valinnat)
- `org_id` jokaisessa juuritaulussa (v0.1: aina `'local'`). Repository-kerros lisää sen kyselyihin automaattisesti.
- ULID-tunnisteet: laitteet luovat niitä offline-tilassa törmäämättä, ja koneiden tai pilven datan voi yhdistää.
- Append-only-tapahtumat, `device_id` + `seq_no` jokaisessa tapahtumassa ja `rev` + HLC-aikaleima muokattavissa riveissä. Näiden avulla synkronointi toimii ilman keskitettyä palvelinta.
- Vain siirrettävää SQL:ää; ajat INTEGER-millisekunteina. Samat migraatiot ajetaan SQLiteen ja Postgresiin.
- `RequestContext { orgId, actor, role }` on valmiina. v0.1:ssä se täytetään PIN:n ja laitteen perusteella, SaaS:ssa käyttäjätilien (OIDC) perusteella.

## 5. Roolit ja näkymät

| Näkymä | Kuka | Toiminnot | Versio |
|---|---|---|---|
| **Kilpailutoimisto** (PIN) | Kilpailunjohtaja | Tapahtuma, matkat, sarjat, CSV-tuonti, laput, jälki-ilmoittautuminen, lähtösiirrot, statukset, lukitus | v0.1 |
| **Lähtö** | Lähettäjä | Matkan yhteislähtö, lähtöajan käsisyöttö | v0.1 |
| **Maali** | Maalikirjuri | Iso AIKA-nappi + lappunäppäimistö, jono aikoja ilman lappua | v0.1 |
| **Korjaukset** (PIN) | Tulospalvelu | Lapun yhdistäminen aikaan, mitätöinti, ajan kopiointi, audit-loki | v0.1 |
| **Tasatulokset** (PIN) | Maalikirjuri tai järjestäjä | Tasatulosryhmien järjestyksen vahvistus (7.8.1) | v0.1 |
| **Seurat** (PIN) | Kilpailunjohtaja | Seurarekisteri: haku lyhenteellä tai nimellä, lisäys, muokkaus, kaksoiskappale- ja lyhenneristiriitojen yhdistämisnäkymä (7.1.1) | v0.1 |
| **Tulokset** | Kaikki | Sarjat, yleiset tulokset, seura-sarake ja seurasuodatin, tuloste, CSV | v0.1 |
| **Väliaika** | Mobiililaite rastilla | Lappu ensin tai aika ensin, toimii offline | v0.2 |
| **Laitteet ja synkronointi** (PIN) | Tulospalvelu | Laitteiden tila, kellojen erot, yhdistäminen, ristiriidat | v0.2 |
| **Yleisönäyttö** | Iso näyttö | Viimeisimmät maaliintulot, kärkikolmikot | v0.2 |

## 6. Tietomalli

Kaikki id:t ovat ULID-tunnisteita. Juuritauluissa on `org_id`, ja muokattavissa tauluissa on `created_at`, `updated_at`, `rev` ja `hlc`. Ajat tallennetaan INTEGER-millisekunteina (UNIX epoch, ensisijaisen kellon aikajanalla, ks. 7.5).

```
person           -- HENKILÖ, kisasta riippumaton (vanha competitors)
  id, org_id, first_name, last_name, gender (F|M|X), birth_year,
  default_club_id(nullable),                             -- viimeksi edustettu seura, vain ehdotukseksi
  nationality, email(nullable), phone(nullable),
  guardian_name(nullable), guardian_email(nullable),     -- alaikäiset
  retention_until(nullable)                              -- laskettu: viimeisin kisa + säilytysaika, ellei suostumusta

club             -- SEURA, kertyvä rekisteri; osallistuminen viittaa tähän
  id, org_id (SaaS: null = jaettu hakemisto, ks. 10.1), abbreviation,  -- virallinen lyhenne = ensisijainen tunniste
  name, municipality(nullable), official_id(nullable),                 -- esim. liiton seuranumero
  status: active | pending | merged, merged_into_id(nullable), source: manual | import | directory
  UNIQUE(org_id, lower(abbreviation)) WHERE abbreviation IS NOT NULL AND status <> 'merged'

club_alias       -- vaihtoehtoiset kirjoitusasut, joilla seura tunnistetaan (syntyvät yhdistämisistä ja vahvistuksista)
  id, club_id, alias_normalized, kind: name | abbreviation | typo, created_from: merge | import_confirm | manual
  UNIQUE(org_id, alias_normalized)
  UNIQUE(org_id, lower(first_name), lower(last_name), birth_year)   -- duplikaattiehdotus, ei pakko

consent          -- SUOSTUMUSKIRJAUKSET, append-only (myönnetty / peruttu = uusi rivi)
  id, person_id, purpose: long_term_storage | runner_portal | results_publication_name | marketing,
  granted (bool), given_by: self | guardian, guardian_name(nullable),
  text_version, channel: registration_form | csv_import | kiosk | portal | email_link,
  recorded_by, recorded_at, evidence_json(nullable)
  -- voimassa oleva tila = uusin rivi (person_id, purpose)

event            -- tapahtuma, esim. "Kuulan hölkkä 2027"
  id, org_id, name, organizer, location, date_start, date_end, timezone, sport, locale_default,
  pin_hash, locked_at(nullable), settings_json:
    age_basis: birth_date | birth_year          -- sarjan määräytyminen (konfiguroitava)
    age_reference_date                           -- oletus: kisapäivä
    below_youngest_category: assign_with_warning | reject
    rounding: floor_1s | floor_0_1s | …
    tie_resolution: confirmed_order             -- sama näyttöaika -> sija vahvistetun maaliintulojärjestyksen mukaan
    offset_start_policy_default: ranked | unranked | open_category
    bib_ranges: { race_id: [from, to] }
    retention_months: 12                          -- säilytysaika ilman pitkäaikaissuostumusta (järjestäjän asetus)
    privacy_min_group_size: 3                     -- k: pienin julkaistava ryhmä (8, anonymisointi)

race             -- matka / lähtö (esim. 4 km, 8 km)
  id, event_id, name, distance_m, start_mode (RaceFormat-id), scheduled_start,
  open_category_id(nullable),                    -- kuntosarja matkan sisällä
  stage_no, laps, settings_json

category         -- sarja; JOKAINEN SARJA KUULUU TASAN YHDELLE MATKALLE (matka 1–n sarja)
  id, race_id, code (T10), name_fi, name_en, gender (F|M|null), min_age(nullable), max_age(nullable),
  ranked (bool),               -- false = kuntosarja / sijoittamaton
  auto_assign (bool),          -- kuntosarjat eivät tule automaattisesti
  start_offset_ms,             -- sarjan erillislähtö (myöhemmin aaltolähdöt)
  sort_order

entry            -- OSALLISTUMINEN: henkilö × matka
  id, race_id, person_id, category_id, category_source: auto | manual,
  bib, registered_at, late_registration (bool),
  club_id(nullable),                                  -- edustettu seura TÄSSÄ kisassa (voi vaihdella kisoittain)
  club_raw(nullable),                                 -- tuonnin alkuperäinen kirjoitusasu (audit; poistetaan anonymisoinnissa)
  display_name, birth_year_at_entry,                  -- tuloshetken tilannekuva
  gender_at_entry,                                    -- säilyy anonymisoinnissa (sarjatieto)
  anonymized_at(nullable),                            -- anonymisoitu: person_id = NULL, display_name/birth_year/bib/club_raw tyhjät
  start_offset_ms (±, oletus 0),                      -- osallistujakohtainen lähtösiirto
  start_offset_reason,
  offset_ranking: inherit | ranked | unranked | open_category,
  status: registered | started | finished | dns | dnf | dsq, status_reason,
  dsq_reason (sisäinen; vienti, tuloste ja .ertx eivät valitse sitä),
  consent_date (pakollinen; palvelin asettaa ilmoittautumishetkestä),
  team_id(nullable), leg_no(nullable)
  UNIQUE(race_id, bib), CHECK(bib > 0), UNIQUE(race_id, person_id)
  -- Seuran yhdistäminen siirtää club_id:n kohdeseuraan (kirjataan correction-tauluun, peruttavissa)

timing_point     -- id, race_id, kind: start | split | finish, name, order_no, distance_m

tie_resolution   -- tasatulosryhmän vahvistettu järjestys, append-only (uusi vahvistus korvaa edellisen)
  id, race_id, display_time_s,              -- ryhmän avain: matka + näyttöaika
  member_entry_ids_json,                    -- ryhmän jäsenet vahvistushetkellä (muutos -> ryhmä vahvistamaton)
  order_json,                               -- esim. [["e130"],["e129"]] tai [["e226","e227"]] (= jaettu sija)
  basis: finish_judge | organizer | photo | video, reason, confirmed_by_device_id, hlc, created_at

device           -- id, org_id, name, kind (TimingSource-id), role, is_primary_clock, operator_name

clock_sample     -- kellojen vertailut (7.5)
  id, device_id, reference_device_id, method: ntp_lan | ntp_internet | reference_tap | bib_match | manual,
  offset_ms, uncertainty_ms, rtt_ms(nullable), measured_at_device_ms

timing_event     -- APPEND-ONLY
  id, race_id, timing_point_id, device_id, seq_no, source (TimingSource-id),
  device_time_ms,          -- laitteen raaka-aika; tätä ei koskaan muuteta
  monotonic_ms,            -- laitteen monotoninen kello (ajautuminen ja hypyt)
  time_ms,                 -- ensisijaisen kellon aikajanalle korjattu (laskettu, uudelleenlaskettava)
  bib(nullable), entry_id(nullable), mode: time_first | bib_first, raw_json(nullable), created_at

correction       -- audit-loki, append-only
  id, target_type: timing_event | entry | race, target_id,
  action: assign_bib | copy_time | void | restore | change_bib | change_race | set_status | merge_clubs | set_entry_club |
          set_start_offset | lock | unlock,
  old_value_json, new_value_json, reason (pakollinen), by_device_id, hlc, created_at

sync_state       -- per laite: viimeisin vastaanotettu seq_no kultakin muulta laitteelta (versiovektori)
team, series, series_race, points_table      -- viestit ja cup (varattu, v0.3+)
schema_meta      -- schema_version, app_version, installation_id, file_id (sitoo tiedoston myöhempään avaintiedostoon)
```

### 6.1 Sarjan määräytyminen
- Ikä lasketaan asetuksen `age_basis` mukaan. `birth_date` = täydet vuodet viitepäivänä (oletus kisapäivä). `birth_year` = viitevuosi − syntymävuosi ("sinä vuonna täyttävät"). Jos syntymäpäivää ei tiedetä, käytetään vuosi-ikää ja annetaan huomautus.
- Tallennettuun henkilöön kirjoitetaan vain syntymävuosi. Täyttä päivämäärää saa käyttää muistissa tuonnin ja ilmoittautumisen ajan, mutta sitä ei kirjoiteta tiedostoon. `entry.consent_date` on pakollinen ja sen asettaa palvelin ilmoittautumishetkestä. `entry.dsq_reason` on sisäinen kenttä: vienti, tuloste ja `.ertx` eivät valitse sitä.
- Ehdotettu sarja on sarja, jonka sukupuoli täsmää ja jonka `min_age ≤ ikä ≤ max_age` ja jossa `auto_assign = true`. Kuulan hölkässä sarja `Xn` (4 km) kattaa iät n…n+1 (4, 6, …, 16 vuotta täyttäneet), ja N/M (8 km) ovat 18 vuotta täyttäneille. **16–17-vuotiaat juoksevat 4 km**. Jos he haluavat pidemmän matkan, he ilmoittautuvat 8 km:lle ja sijoittuvat aikuisten sarjaan N/M (N/M: `min_age = 16`, mutta ehdotus tehdään vain ilmoittautumisen matkalta, joten 4 km:lle ilmoittautunut 16–17-vuotias saa aina P/T16:n).
- Sarja haetaan ensin ilmoittautumisen matkalta. Vasta jos sieltä ei löydy, tarkistetaan muut matkat (ks. seuraava kohta).
- Alle nuorimman sarjan: oletuksena nuorin sarja ja varoitus.
- **Matkan ja sarjan yhteys:** sarja kuuluu yhdelle matkalle. Jos ikään sopiva sarja on eri matkalla kuin ilmoittautuminen, annetaan varoitus `NO_MATCHING_CATEGORY` ja järjestäjä valitsee: siirto toiselle matkalle tai käsin valittu sarja. **Kuulan hölkässä aikuisille ei ole lyhyttä matkaa**, joten aikuisen siirto 4 km:lle estetään, ja alle 16-vuotias 8 km:llä vaatii järjestäjän päätöksen.
- Käsin valittu sarja (`category_source = manual`) ei muutu automaattisesti. Jos ikäperuste vaihdetaan, uudet ehdotukset näytetään muutoslistana ennen hyväksymistä.

### 6.2 Seuran tunnistus (haku, tuonti, ilmoittautuminen)
Seuran **virallinen lyhenne on ensisijainen tunniste**: lähes kaikilla seuroilla on sellainen (esim. Uuraisten Urheilijat = UU). Lyhenne on yksilöllinen rekisterin sisällä, ja kirjainkoko ei vaikuta vertailuun. Haku ja tunnistus toimivat sekä lyhenteellä että nimellä tässä järjestyksessä:
1. **Lyhenne:** syöte (tai CSV:n `seuran_lyhenne`) on täsmälleen jonkin seuran lyhenne → tunnistus. Jos samalla rivillä annettu nimi ei vastaa seuran nimeä tai aliasta → `CLUB_ABBREVIATION_CONFLICT`, joka ratkaistaan yhdistämisnäkymässä.
2. **Nimi:** täsmälleen sama nimi normalisoituna (pienet kirjaimet, ylimääräiset välilyönnit pois).
3. **Alias:** aiemmin vahvistettu kirjoitusasu (esim. `Uuraisten Urh.` → UU).
4. **Samankaltainen:** sanojen alkuosat täsmäävät (`Jyväskylän Kenttäurh` → JKU) tai merkkijonot ovat lähes samat. Tämä on vain ehdotus, joka vaaditaan vahvistamaan. Vahvistus tallentaa aliaksen.
5. **Uusi seura:** ehdotetaan uutta seuraa (`pending`). Järjestäjä täydentää lyhenteen, ja jos lyhenne on varattu, tulee `CLUB_ABBREVIATION_TAKEN`.
Automaattinen täydennys ilmoittautumisessa näyttää osumat muodossa **lyhenne – koko nimi** (esim. "UU – Uuraisten Urheilijat"). Lyhenteen täsmäosuma näytetään ensimmäisenä, nimen alkuosuma toisena.

### 6.3 Lähtöaika ja tulosaika
`oma lähtö = matkan kirjattu yhteislähtö + sarjan start_offset_ms + entry.start_offset_ms`. Jos osallistujalle on kirjattu oma lähtötapahtuma lapulla, käytetään sitä. `tulosaika = ensimmäinen voimassa oleva maali-tapahtuma − oma lähtö`.

## 7. Toiminnalliset vaatimukset

### 7.1 Kisan valmistelu (v0.1)
- Tapahtuma → matkat → sarjat (pohja "Lasten ja aikuisten hölkkä": T/P4–16 lyhyellä matkalla + N/M pitkällä) → sarjojen kytkentä matkoihin.
- CSV-tuonti: sarakkeiden kohdistus, esikatselu, virheet ja varoitukset riveittäin, duplikaattihenkilöiden ehdotus. Mukana suostumussarakkeet (ks. `testdata/kuulan-holkka/entries.csv`). Myös käsin lisäys.
- **Seura tuonnissa:** sarakkeet `seura` (nimi tai lyhenne) ja vapaaehtoinen `seuran_lyhenne`. Esikatselussa näkyy jokaisen erilaisen seura-arvon tunnistustapa (6.2) ja rivimäärä. Järjestäjä vahvistaa ehdotukset, luo uudet seurat ja ratkaisee ristiriidat ennen tuontia. Seura on vapaaehtoinen.
- **Säilytysvalinta ilmoittautumisessa** (lomake, kioski ja CSV-sarake `pitkaaikainen_tallennus`): "Saako tietosi säilyttää kisan jälkeen?" Vaihtoehdot:
  - ○ *Ei (oletus):* "Nimesi, syntymäaikasi ja yhteystietosi poistetaan {retention_months} kk kuluttua. Tuloksesi, sarjasi ja seurasi jäävät tilastoihin nimettömänä."
  - ○ *Kyllä, säilytä pitkäaikaisesti:* "Tiedot säilyvät, kunnes perut luvan." Peruminen onnistuu sähköpostilinkillä, kilpailutoimistossa ja myöhemmin juoksijaportaalissa.
  - Valintaa ei ole esivalittu suostumukseksi (GDPR: aktiivinen suostumus). Alle 13-vuotiaan puolesta valitsee huoltaja, ja valinnan tekstiversio tallennetaan `consent`-tauluun.
- Lappujen automaattinen jako matkan alueelta tai käsin; varalaput.
- Jälki-ilmoittautuminen ennen lähtöä ja lähdön jälkeen. Lähdön jälkeen ilmoittautunut saa lähtösiirron.

### 7.1.1 Seurarekisteri ja yhdistämisnäkymä (v0.1)
- Rekisteri kertyy kisa kisalta. Luettelossa näkyvät lyhenne, nimi, kunta, virallinen tunniste, aliakset ja osallistumisten määrä. Haku toimii lyhenteellä ja nimellä.
- **Kaksoiskappaleiden tunnistus** ehdottaa pareja: samankaltainen nimi (esim. `Uuraisten Urh.` ~ Uuraisten Urheilijat), sama virallinen tunniste tai toisen seuran lyhenne toisen aliaksena.
- **Yhdistämisnäkymä** (HIG: kaksi korttia rinnakkain ja kohdeseuran valinta segmenttivalitsimella). Siinä näkyvät erot (lyhenne, nimi, tunniste) ja siirtyvien osallistumisten määrä. "Yhdistä" siirtää osallistumiset kohdeseuraan, tekee lähteestä aliaksen ja merkitsee sen tilaan `merged`. Yhdistäminen kirjataan ja on peruttavissa.
- **Lyhenneristiriidat** ratkaistaan samassa näkymässä: joko "sama seura" (yhdistä, eri nimi aliakseksi) tai "eri seura" (toiselle annetaan eri lyhenne). Ristiriita syntyy tuonnissa, käsin lisäyksessä tai myöhemmin synkronoinnissa (kaksi laitetta luo offline-tilassa saman lyhenteen).
- Juoksija voi edustaa eri seuraa eri kisoissa (`entry.club_id`). `person.default_club_id` toimii vain ehdotuksena.
- **Tiekartalla:** seuratilastot (osallistujamäärät, sijoitukset, seurojen välinen kilpailu ja pisteet), v0.3 paikallisesti ja SaaS:ssa tapahtumien yli. Tilastoissa sovelletaan pienten ryhmien sääntöä (kohta 8).

### 7.2 Lähtö ja lähtösiirrot (v0.1)
- Matkakohtainen LÄHTÖ-nappi. Uudelleenpainallus vaatii vahvistuksen (ei tuplalähtöjä). Lähtöajan voi syöttää myös käsin.
- **Osallistujakohtainen lähtösiirto:** ± poikkeama suhteessa yhteislähtöön (esim. −30:00 etuajassa, +2:00 myöhässä) ja syy. Tulosaika lasketaan omasta todellisesta lähdöstä.
- **Tuloslistalla siirretty lähtö merkitään näkyvästi** (esim. "⏱ Siirretty lähtö −30:00" ja alaviite). Järjestäjä valitsee tapahtumatasolla oletuksen ja voi ohittaa sen osallistujakohtaisesti:
  - `ranked`: sijoitetaan normaalisti, merkintä näkyy.
  - `unranked`: näytetään sarjassa ilman sijaa, sijoitettujen jälkeen.
  - `open_category`: siirretään matkan kuntosarjaan (sijoittamaton).
- Yksilölähdöt eivät ole v0.1:ssä (mallissa valmiina, `RaceFormat`).

### 7.3 Maalikirjaus (v0.1)
- *Aika ensin* (iso nappi, lappu perään jonosta) ja *lappu ensin* (numero + Enter) toimivat yhtä aikaa.
- Painallus tallentuu paikallisesti alle 50 ms:ssa ennen mitään verkkoliikennettä.
- Mitään ei hylätä hiljaa. Tuntematon lappu, saman lapun tuplakirjaus ja lapuntonta aika hyväksytään ja merkitään tarkistettaviksi.
- Ajan kopiointi toiselle lapulle (kaksi juoksijaa samassa painalluksessa).

### 7.4 Korjaukset, statukset ja lukitus (v0.1)
- Lapun yhdistäminen aikaan, mitätöinti ja palautus, ajan kopiointi, lapun vaihto, matkan vaihto, DNS/DNF/DSQ. Jokaiseen vaaditaan syy, ja kaikki näkyy audit-lokissa.
- **Lukitus estyy** (`LOCK_BLOCKED`), jos matkalla on tunnistamattomia aikoja, osallistujia ilman tulosta ja ilman statusta tai **vahvistamattomia tasatulosryhmiä**. Estelistan jokainen rivi on linkki oikeaan näkymään. Lukittuun tapahtumaan muutokset vaativat avauksen (`EVENT_LOCKED`), ja avaus kirjataan.

### 7.5 Offline, synkronointi ja kellot
**Lähtökohta:** mobiilinetti on yleensä saatavilla mutta epävakaa. Lähdössä ja maalissa on tietokone (sama tai kaksi eri konetta), ja väliajat otetaan mobiililaitteella. **Jokainen laite toimii täysin ilman verkkoa** ja synkronoi myöhemmin.

- **Replikointi (v0.2):** jokaisella laitteella on täysi paikallinen varasto. Ajanottotapahtumat ovat vain lisättäviä, ja niiden tunniste on (`device_id`, `seq_no`), joten yhdistäminen on joukkojen yhdiste ilman ristiriitoja. Muokattavat rivit (osallistujat, laput) yhdistetään HLC-järjestyksessä kenttäkohtaisesti, viimeisin kirjoitus voittaa. **Liiketoimintaristiriidat**, kuten sama lappu kahdelle henkilölle eri koneilla, nostetaan ristiriitalistalle (`SYNC_CONFLICT`) ratkaistavaksi.
- **Siirtotavat:** lähiverkko tai puhelimen hotspot (WebSocket), tiedosto (USB, `.ertx`) ja SaaS-pilvivälitys mobiilinetin yli, joka toimii myös katkoksellisena (jonot ja uudelleenyritys).
- **Ensisijainen kello:** tapahtumalle valitaan yksi kello (oletuksena maalikone), jonka aikajanalle kaikki ajat muunnetaan. Raaka-aika (`device_time_ms`) säilyy aina, joten muunnoksen voi laskea uudelleen.
- **Kahden koneen lähtö ja maali vaatii kellojen synkronoinnin.** Kannettavien kellot ajautuvat tyypillisesti 10–50 ppm, eli 3 tunnissa jopa 0,5 s. Siksi:
  1. **Ennen erkanemista:** NTP-tyyppinen vertailu LAN:ssa tai hotspotissa (8 näytettä, pienimmän RTT:n näytteet, mediaani) tai *yhteinen synkronointipainallus* (molemmat koneet painavat samaan merkkiin).
  2. **Kisan aikana, kun yhteys on:** vertailu toistetaan minuutin välein. Jos internet on käytettävissä, kumpikin kone vertaa myös internet-aikaan (käyttöjärjestelmän NTP sekä mitattu ero).
  3. **Jälkeenpäin:** uusi vertailu, kun koneet ovat taas yhteydessä. Ajautuminen interpoloidaan lineaarisesti näytteiden välillä.
  4. **Varamenetelmät:** samat laput molemmilla koneilla (esim. maalikone ja varakone) → erojen mediaani; käsin syötetty ero.
  - Tavoite: koneiden välinen virhe ≤ 0,1 s. Jos epävarmuus on yli 0,2 s, tuloksiin tulee varoitus. Synkronoinnin laatu näytetään jatkuvasti.
- **v0.1:ssä** on yksi kone, joten synkronointia ei tarvita. Silti jo v0.1:ssä kaikki tapahtumat tallennetaan laite-id:n, juoksevan numeron, raaka-ajan ja monotonisen ajan kera, ja tapahtuman voi viedä ja tuoda `.ertx`-tiedostona (varmuuskopio ja koneen vaihto). Jos lähtö on eri paikassa, lähtöaika syötetään maalikoneelle käsin.

### 7.6 Väliajat (split): **v0.2**
Väliaikapiste toteutetaan v0.2:ssa, ei v0.1:ssä. Perusteet:
1. **Hyväksymistesti ei tarvitse sitä.** Kuulan hölkässä ei oteta väliaikoja, ja v0.1:n laajuus pidetään kisaan riittävänä.
2. **Väliajat tarvitsevat samat infrastruktuuripalat kuin kahden koneen kokoonpano:** mobiili-PWA:n, joka toimii täysin offline (HTTPS-ratkaisu, kohta 3), replikoinnin ja kellojen synkronoinnin. Ne kannattaa rakentaa ja testata yhtenä kokonaisuutena v0.2:ssa. Jos väliajat tuotaisiin v0.1:een, sen laajuus kaksinkertaistuisi ja kenttätesti viivästyisi.
3. **Tietomalli on valmis jo v0.1:ssä** (`timing_point.kind = split`, laite- ja kellokentät), joten v0.2 ei vaadi rikkovaa migraatiota.

v0.2:n väliaikalaite: puhelin synkronoidaan ja kello vertaillaan ennen rastille lähtöä. Kirjaukset tallentuvat IndexedDB:hen, ja synkronointi tapahtuu mobiilinetin, hotspotin tai paluun jälkeen LAN:n kautta. Kello vertaillaan uudelleen palatessa (ajautumiskorjaus). Tuloksissa näytetään väliajat ja väliaikasijat. Puuttuva väliaika ei estä tulosta.

### 7.7 Varakellot (v0.2)
Fyysisen sekuntikellon rekisteröinti: ajanottopiste, käyttäjä ja kellon käynnistyshetki kisa-aikana. Lukemat syötetään käsin tai CSV:nä, ja ne muunnetaan kisa-ajaksi. Vertailunäkymä näyttää digitaalisen ja varakellon ajan, ja yli 1 s:n erot korostetaan. Tulostettava varalomake.

### 7.8 Tulokset (v0.1)
- Tulokset lasketaan reaaliajassa sarjoittain ja matkan yleisinä: sija, lappu, nimi, seura, sarja, aika, ero kärkeen ja merkinnät (siirretty lähtö, jälki-ilmoittautunut, matkan vaihto).
- **Seura-sarake:** kapeissa näkymissä (mobiili alle noin 600 px, maalinäkymä, yleisönäyttö, kapea tulostesarake) näytetään lyhenne, ja leveissä (työpöytä, A4-tuloste) koko nimi. Jos lyhennettä ei ole, näytetään koko nimi. Lyhenteen kohdalla on työkaluvihje tai pitkä painallus, joka näyttää koko nimen. **Suodatus seuran mukaan** (hakukenttä lyhenteellä tai nimellä, useita valintoja) sekä sarja- että yleisissä tuloksissa. CSV:ssä ovat sarakkeet `club_abbr` ja `club_name`.
- Järjestys: sijoitetut, sitten sijoittamattomat (kuntosarja tai `unranked`), sitten DNF, DNS ja DSQ.
- Näyttöaika pyöristetään alaspäin sekuntiin (asetus).
- **Tasatulokset ratkaistaan visuaalisella vahvistuksella.** Tasatulosryhmä muodostuu, kun samalla matkalla vähintään kahdella maaliin tulleella on sama näyttöaika. Sijat määräytyvät maalikirjurin tai järjestäjän vahvistaman maaliintulojärjestyksen mukaan, ei millisekuntien. Vahvistaja voi myös todeta, että juoksijoita ei voi erottaa ("Tasan"), jolloin sija jaetaan ja seuraava sija hyppää (5., 5., 7.).
- Ennen vahvistusta ryhmä näytetään kirjausjärjestyksessä merkinnällä "⚠ Vahvistamaton järjestys" (myös yleisönäytöllä ja tulosteessa), ja lukitus estyy (`TIE_UNCONFIRMED`). Sama vahvistettu järjestys pätee kaikissa näkymissä (sarja ja yleiset tulokset). Jos ryhmän jäsenet muuttuvat myöhemmin, esim. ajan korjauksen takia, ryhmä palaa vahvistamattomaksi.
- Vahvistus voi muuttaa järjestystä vain saman näyttöajan sisällä. Jos järjestys vaatii eri näyttöajan, kyse on ajan korjauksesta (7.4).

#### 7.8.1 Tasatulosten järjestysnäkymä (HIG-mukainen)
- **Löydettävyys:** sivupalkissa tai välilehtipalkissa "Tasatulokset" ja numeromerkki (esim. ③). Linkki näkyy myös lukituksen estelistassa ja maalinäkymän ilmoituksena ("2 tasatulosta odottaa vahvistusta"). Ilmoitus ei keskeytä maalikirjausta.
- **Rakenne:** yksi kortti (grouped inset list) jokaista ryhmää kohden. Otsikossa matka, näyttöaika ja tila (Vahvistamaton / ✓ Vahvistettu, kuka ja milloin). Rivillä sija (päivittyy reaaliajassa), lappu, nimi, sarja, toissijaisena tekstinä ms-aika ja kirjauslaite sekä oikealla raahauskahva (≡).
- **Järjestäminen:**
  - *Raahaus:* pitkä painallus tai kahvasta tarttuminen nostaa rivin (varjo ja kevyt haptinen palaute). Muut rivit väistyvät animoidusti, ja pudotus päivittää sijat heti.
  - *Saavutettava vaihtoehto:* jokaisella rivillä on ▲/▼-painikkeet (≥ 44 pt). Näppäimistöllä toimivat Tab, Välilyönti (nosta), ↑/↓ ja Enter (pudota). VoiceOver/TalkBack-toiminnot "Siirrä ylös/alas", ja ruudunlukija ilmoittaa uuden sijan.
  - *"Tasan":* kahden vierekkäisen rivin välissä on liitospainike, joka yhdistää rivit samaan sijaan (näkyy hakasulkeena). Sama painike erottaa ne.
- **Vahvistus:** peruste valitaan segmenttivalitsimella (Maalikirjurin havainto / Järjestäjä / Valokuva / Video) ja tarvittaessa lisätään vapaa teksti. Ensisijainen painike "Vahvista järjestys" on aktiivinen vasta, kun peruste on valittu. Vahvistuksen jälkeen näkyy "Kumoa"-ilmoitus 5 s ajan, ja vahvistus kirjataan audit-lokiin. Vahvistetun ryhmän voi avata uudelleen ("Muuta järjestystä"), mistä jää uusi kirjaus.
- **Mittarit:** kahden hengen ryhmän vahvistus onnistuu enintään kolmella toiminnolla (siirrä, valitse peruste, vahvista). Toimii sekä kosketuksella että hiirellä, tummassa ja vaaleassa teemassa ja fi/en-kielillä.
- Myöhemmin (v1.x) maalikameran kuva voidaan liittää ryhmään perusteeksi.
- **Tuloste** (A4, sarja per sivu, tyhjät sarjat piilotetaan) ja **CSV** (UTF-8 BOM, `;`). Julkisissa tuloksissa ei näytetä syntymäaikaa, vain sarja.

### 7.9 Livetulokset
- v0.2: lähiverkon laitteet ja yleisönäyttö (WebSocket).
- v0.4 (SaaS): **julkaisu verkkoon kisan aikana.** Kannettava lähettää tulosmuutoksia pilveen aina, kun mobiilinetti toimii (jono kestää katkokset), ja julkinen sivu päivittyy. Itse ylläpidetyssä versiossa voi viedä staattisen HTML/JSON-version omalle palvelimelle.

### 7.10 Myöhemmät kilpailumuodot (v0.3)
Yksilölähdöt ja lähtökello, viestit (joukkue, osuudet, vaihdot), kierroslaskenta (CX/MTB), monipäiväiset ja takaa-ajolähtö, triathlonin vaihtoalueet ja cup-sarjat (pistetaulukot, N parasta). Kaikki toteutetaan `RaceFormat`- ja `SportProfile`-laajennuksina.

### 7.11 Juoksijaportaali (SaaS, v1.x)
Juoksija kirjautuu sähköpostilinkillä tai OIDC:llä ja näkee omat tuloksensa ja suorituksensa kaikista SaaS-seurojen kisoista, joissa hänellä on voimassa oleva `runner_portal`-suostumus. Henkilöt yhdistetään seurojen välillä vain juoksijan itse vahvistamina (sähköpostin vahvistus), ei automaattisesti. Juoksija voi perua suostumuksensa portaalissa, ja peruminen käynnistää säilytyssäännön (kohta 8).

## 8. Ei-toiminnalliset vaatimukset
- **Luotettavuus:** WAL + `synchronous=FULL`. Automaattinen varmuuskopio 5 min välein, kisan lopussa ja ennen jokaista migraatiota. Prosessin kaatuminen ei saa hävittää yhtään kuitattua painallusta (testattu `kill -9`:llä).
- **Suorituskyky:** 500 osallistujaa, 10 painallusta sekunnissa 30 s ajan ilman menetyksiä, p95-vaste < 50 ms ja tulosten laskenta < 200 ms.
- **Offline:** v0.1 ei tarvitse verkkoa lainkaan. Myöhemmin jokainen laite toimii offline ja synkronoi.
- **Laitteisto:** v0.1:n palvelimeksi riittää tavallinen kannettava (Windows 10+, macOS 12+ tai Linux; 4 GB RAM). Akkukesto ja virransäästö ohjeistetaan (näyttö ei saa sammua kesken kisan, wake lock).
- **Saavutettavuus:** WCAG 2.1 AA ja kontrastit auringonvalossa. Kaikki ajanotto onnistuu myös pelkällä näppäimistöllä.
- **GDPR ja suostumukset:**
  - Kisan toteutus (ilmoittautuminen, ajanotto, tulosten julkaisu nimellä, sarjalla ja seuralla) perustuu järjestäjän oikeutettuun etuun tai sopimukseen. Tästä kerrotaan ilmoittautumisessa.
  - **Pitkäaikainen tallennus ja juoksijaportaali vaativat erillisen, vapaaehtoisen ja peruttavissa olevan suostumuksen** (`consent`), joka kirjataan tekstiversion, antajan (itse tai huoltaja) ja kanavan kera. Alle 13-vuotiaan suostumuksen antaa huoltaja.
  - **Anonymisointi säilytysajan jälkeen** (ei pitkäaikaissuostumusta; oletus 12 kk viimeisestä kisasta, `retention_months`). Ajetaan automaattisesti, paikallisessa versiossa käynnistyksen yhteydessä ja kerran vuorokaudessa:
    - **Poistetaan:** nimi, syntymäaika ja -vuosi, sähköposti, puhelin, huoltajan tiedot, lappu, CSV:n seuran alkuperäinen kirjoitusasu (`club_raw`) ja audit-lokin vapaatekstit, joissa voi olla nimiä (korvataan "[poistettu]"). `person`-rivi poistetaan kokonaan, ja `entry.person_id` asetetaan tyhjäksi. **Saman henkilön eri kisojen osallistumisia ei voi enää yhdistää toisiinsa.**
    - **Säilyy:** tulos (aika, sija, status), sarja, `gender_at_entry` ja seura (`club_id`), jotta tulosluettelot ja seuratilastot pysyvät oikeina. Cup-pisteet, jotka on laskettu ennen anonymisointia, jäädytetään.
    - **Näyttö:** "Anonyymi (UU)" tai seurattomalle "Anonyymi". Yksilöivät merkinnät ("Jälki-ilmoittautunut", "Vaihtoi matkaa", lähtösiirron suuruus) poistetaan. Jäljelle jää vain "Siirretty lähtö".
  - **Uudelleentunnistamisen esto pienissä ryhmissä** (k = `privacy_min_group_size`, oletus 3):
    - Jos anonymisoidun osallistujan ryhmässä *sarja × seura* on alle k osallistujaa, seuraa ei näytetä julkisessa listassa ("Anonyymi"). Seura säilyy silti sisäisissä tilastoissa.
    - Jos *sarjassa* on alle k osallistujaa, anonymisoidun rivin sarja yleistetään julkisesti sukupuoliryhmäksi (T16 → T), ja sarjan omassa listassa aika piilotetaan (sija säilyy).
    - **Julkaistut seuratilastot:** alle k:n solut yhdistetään riviin "Muut seurat". Jos piiloon jäisi vain yksi solu, myös seuraavaksi pienin yhdistetään (komplementaarinen piilotus, ettei piilotettua lukua voi laskea erotuksena). Sisäiset tilastot ovat aina tarkkoja.
    - Säännöt toteutetaan yhdessä `people`-moduulin julkaisusuodattimessa, jota kaikki viennit, tulosteet, API:n julkiset vastaukset ja livetulokset käyttävät. Säännöt ovat siis voimassa kaikissa näkymissä.
  - Peruminen pysäyttää pitkäaikaisen tallennuksen, ja anonymisointi tehdään 30 päivän kuluessa. Audit-loki säilyy pseudonymisoituna.
  - Rekisteröidyn oikeudet: tietojen vienti (JSON/CSV) ja poisto henkilökohtaisesti.
- **Vartijan tarkistettavaksi (tietosuoja):**
  1. Pienten ryhmien sääntö (k = 3, sarja × seura, sarjan yleistys, ajan piilotus) ja komplementaarinen piilotus seuratilastoissa: riittääkö, vai tarvitaanko suurempi k tai ajan pyöristys?
  2. **Jäännösriski:** ennen anonymisointia julkaistut nimelliset tuloslistat (tulosteet, kopiot verkossa) voidaan yhdistää anonymisoituihin riveihin ajan perusteella. Järjestelmä ei voi poistaa ulkoisia kopioita. Ohjeistetaanko järjestäjiä korvaamaan oma julkinen arkisto anonymisoidulla?
  3. Säilyvä aika ja sija ovat näennäistunnisteita. Riittääkö sarjan oman listan ajan piilotus pienissä sarjoissa?
  4. Audit-lokin vapaatekstien siivous (nimet, syyt) ja pseudonymisointi: tarkistetaanko automaattisesti nimien varalta?
  5. Huoltajan suostumuksen ikäraja (13 v) ja suostumustekstien oikeusperuste juridisesti.
  6. SaaS: jaetun seurahakemiston ja juoksijaportaalin henkilöyhdistämisen tietosuoja.
  7. Varmuuskopiot: anonymisoinnin on ulotuttava varmuuskopioihin säilytysajan puitteissa (varmuuskopioiden kierto ≤ säilytysaika tai anonymisointi palautuksen yhteydessä).
- **Turvallisuus:** PIN ylläpitoon ja rajoitus väärille PIN-yrityksille. Palvelin kuuntelee oletuksena vain localhostia; lähiverkko avataan erikseen (v0.2). Ei avoimia portteja internetiin.

## 9. API (luonnos)
```
GET  /api/v1/health                     GET  /api/v1/time               (kellovertailu)
POST /api/v1/events  (+ /import)        GET  /api/v1/events/:id
POST /api/v1/races … /categories … /entries (+ /entries/import CSV, /entries/:id/start-offset)
POST /api/v1/races/:id/start
POST /api/v1/races/:id/timing-events    (batch, idempotentti id + device_id/seq_no)
POST /api/v1/corrections
GET  /api/v1/races/:id/tie-groups      POST /api/v1/races/:id/tie-groups/:display_time/confirm
POST /api/v1/races/:id/lock             (409 LOCK_BLOCKED + estelista)
GET  /api/v1/races/:id/results?category=&format=json|csv
GET  /api/v1/clubs?q=                   (haku lyhenteellä/nimellä)   POST /api/v1/clubs   POST /api/v1/clubs/:id/merge
GET  /api/v1/clubs/duplicates           POST /api/v1/entries/import/preview  (seurojen tunnistus ja ristiriidat)
POST /api/v1/persons/:id/consents       GET /api/v1/persons/:id/export   POST /api/v1/retention/run
POST /api/v1/sync/push  GET /api/v1/sync/pull?since=<versiovektori>   (v0.2)
WS   /ws?proto=1 -> timing_event.created, correction.created, results.updated, device.status, sync.conflict
POST /api/v1/test/clock                 (vain testitila: simuloitu kello E2E:lle)
```
Virheet: `{ error: { code, message, details? } }`.

### 9.1 Alustariippumattomuus (natiivisovellukset)
- **Sopimus ensin:** OpenAPI 3.1 (REST) ja AsyncAPI/JSON Schema (WebSocket ja synkronointi) generoidaan `core`:n zod-skeemoista ja julkaistaan repossa (`docs/api/openapi.yaml`, `docs/protocol/sync-v1.md`). Asiakkaat generoidaan sopimuksesta: TypeScript (web), Swift (swift-openapi-generator) ja Kotlin (openapi-generator).
- **Ei selainoletuksia:** pelkkä JSON HTTPS:n ja WebSocketin yli. Ei evästeistä riippuvaa tunnistusta: laitetunnisteena bearer-token (v0.1: PIN → laitetoken; SaaS: OIDC + PKCE, joka toimii myös natiivisovelluksissa). Ei HTML-vastauksia API:ssa.
- **Asiakas luo tunnisteet ja ajat:** ULID asiakkaalla, `device_time_ms` + `monotonic_ms` + `seq_no` jokaisessa tapahtumassa, idempotentit batch-lähetykset. Natiivisovellus voi täyttää kentät tarkemmalla monotonisella kellolla ilman protokollamuutosta.
- **Synkronointiprotokolla** on versioitu ja siirtotavasta riippumaton (sama viestimuoto WebSocketissa, HTTP-pollauksessa ja `.ertx`-tiedostossa).
- **Yhteensopivuustestit:** protokollan testivektorit (Kuulan hölkkä: tapahtumat → odotetut tulokset, kellonäytteet → odotetut korjaukset) julkaistaan JSON-muodossa. Jokaisen asiakkaan (web, iOS, Android) on läpäistävä ne CI:ssä. Viralliset tulokset lasketaan aina `core`:ssa (palvelin tai kannettava), joten natiivisovellusten ei tarvitse toistaa tuloslaskentaa.

## 10. Liiketoimintamalli ja sen vaikutukset arkkitehtuuriin

### 10.1 Malli
| | Itse ylläpidetty (ilmainen) | SaaS (seuran vuosimaksu) |
|---|---|---|
| Lisenssi | AGPL-3.0, kaikki ytimen ominaisuudet ilman rajoituksia | Sama ydin ja palvelu |
| Kisat ja osallistujat | Rajaton, ajetaan omalla koneella kisa kerrallaan | Rajaton |
| Synkronointi | Tiedosto ja LAN/hotspot | Lisäksi pilvivälitys mobiilinetin yli |
| Livetulokset verkossa | Staattinen vienti omalle palvelimelle | Julkinen livesivu kisan aikana |
| Tietojen säilytys | Järjestäjän oma | Pitkäaikainen arkisto suostumuksella, varmuuskopiot |
| Seurarekisteri | Paikallinen, kertyy kisoista; vienti ja tuonti | Jaettu seurahakemisto kaikkien seurojen kesken |
| Mobiili | PWA | PWA, myöhemmin natiivit iOS- ja Android-sovellukset (v1.x) |
| Juoksijaportaali | – | Kyllä (v1.x) |
| Tuki | Yhteisö | Seuralle |

**Jaettu seurahakemisto (SaaS):** seurat eivät ole henkilötietoja, joten niiden rekisteri jaetaan kaikkien SaaS-asiakkaiden kesken (`club.org_id = null`). Jokaisella seuralla voi lisäksi olla omia paikallisia seurojaan (`org_id` = asiakas). Hakemistossa lyhenne on yksilöllinen globaalisti. Lisäys ja muutos tehdään ehdotuksena, joka moderoidaan (ylläpitäjä tai luotettu seura), ja hakemiston voi alustaa liittojen julkisista seuraluetteloista (virallinen tunniste). Paikallinen seura voidaan liittää hakemiston seuraan, jolloin aliakset ja tilastot yhdistyvät. Paikallinen versio voi tuoda hakemiston kopiona (vain luku) ilman tiliä. Huom.: SaaS-asiakas eli *järjestäjäseura* (`org`) ja juoksijan *edustama seura* (`club`) ovat eri käsitteitä, mutta ne voidaan linkittää (`org.club_id`).

Paikallisessa versiossa ei ole lisenssiavaimia eikä ominaisuusrajoituksia. SaaS-oikeudet (`entitlements`) tarkistetaan vain pilvipalvelussa. Paikallinen sovellus voi kirjautua seuran SaaS-tiliin, jolloin pilviominaisuudet aktivoituvat. Ilman tiliä kaikki toimii ennallaan. **Kisan aikana ei koskaan lukita mitään** tilauksen vanhenemisen vuoksi, ja datan vienti toimii aina.

### 10.2 Lisensointi: suositus **AGPL-3.0-only** ytimelle
**Perustelut:**
1. **Estää kilpailevan suljetun SaaS-kopion.** AGPL:n kohta 13 velvoittaa jokaisen, joka tarjoaa muokattua versiota verkkopalveluna, antamaan lähdekoodin palvelun käyttäjille. Kilpailija ei siis voi ottaa koodia, sulkea sitä ja myydä sitä palveluna. Tavallinen GPL tai MIT ei tätä estä.
2. **Sopii malliin, jossa seurat ajavat ohjelmaa itse ilmaiseksi.** Oma käyttö, muokkaus ja ajaminen omalla koneella ovat täysin vapaita, eikä seuralle synny velvoitteita, ellei se tarjoa palvelua muille.
3. **Tekijänoikeuden haltija säilyttää liikkumavaran.** Valtteri omistaa koko koodin, ja ulkopuoliset kontribuutiot otetaan vastaan CLA:lla. Siksi hän voi ajaa omaa SaaS-palvelua yksityisillä lisäosilla ja myydä tarvittaessa erillisiä kaupallisia lisenssejä (kaksoislisensointi), esim. liitolle, joka haluaa suljetun integraation.
4. **OSI-hyväksytty lisenssi herättää luottamusta.** Seurat, liitot ja kehittäjät tuntevat sen, ja ajanoton eheys on tarkastettavissa. Nykyinen oma lisenssi on juridisesti epäselvä, ja sen ehto "ilmainen urheiluseuroille" on ristiriidassa SaaS-myynnin kanssa.
5. **`-only`** (ei `-or-later`): tulevista lisenssiversioista päättää tekijänoikeuden haltija.

**Rajoitukset ja täydentävät keinot:** AGPL ei estä kilpailijaa ajamasta avointa kopiota palveluna. Varsinainen kilpailuetu tulee muualta: tavaramerkki ("Easy Race Timer" -nimi ja logo, rekisteröinti harkintaan), hostauksen laatu, juoksijaportaalin verkostovaikutus ja tuki. Osa yrityksistä välttää AGPL:ää, mutta seuroille sillä ei ole merkitystä.

**Mikä on avointa ja mikä suljettua:**
- *AGPL-ydin:* kaikki, mitä seura tarvitsee kisan ajamiseen, mukaan lukien monilaitesynkronointi LAN:ssa, väliajat, varakellot ja staattinen tulosjulkaisu.
- *Yksityinen `easy-race-timer-cloud`:* laskutus, seurojen provisiointi, pilvivälitys, julkinen livetulospalvelu, arkisto, juoksijaportaali ja infra. Nämä voidaan avata myöhemmin.

**Käytännön toimet:** LICENSE (AGPL-3.0-only), SPDX-otsikot tiedostoihin, CLA-botti PR:iin, "Lähdekoodi"-linkki käyttöliittymän alatunnisteeseen (AGPL §13), riippuvuuksien lisenssitarkistus CI:ssä (MIT, BSD, Apache-2.0, ISC ja LGPL sallittuja) sekä SBOM julkaisuihin.

### 10.3 Versiointi ja julkaisut
- SemVer, Conventional Commits ja release-please (automaattinen CHANGELOG).
- Erikseen versioidut sopimukset: REST `/api/v1`, WebSocket `proto`, **synkronointiprotokolla** (versio kättelyssä; eri versioiden laitteet saavat selkeän virheen, eivät hiljaista rikkoutumista) ja vientiformaatti `.ertx` (zip: `manifest.json` {format_version, app_version, schema_version} + data). Formaatti toimii varmuuskopiona, koneelta toiselle siirtona ja pilveen tuontina.
- **Päivitystä ei asenneta kisan aikana.** Kanavat `stable` ja `beta`. SaaS-palvelin tukee vähintään kahta edellistä paikallisen sovelluksen minor-versiota synkronoinnissa.
- Allekirjoitetut asennuspaketit ennen v1.0:aa.

### 10.4 Migraatiot ja data
- Numeroidut, vain eteenpäin kulkevat migraatiot ja `schema_meta.schema_version`. Ennen jokaista migraatiota otetaan automaattinen varmuuskopio. Jos tietokanta on uudempi kuin sovellus, käynnistys estetään ja käyttäjää neuvotaan päivittämään.
- Rikkovat muutokset tehdään laajenna → siirrä → supista -kaavalla kahdessa julkaisussa. Tämä on välttämätöntä SaaS:ssa, jossa eri versioiden paikalliset sovellukset synkronoivat samaan pilveen.
- **Migraatiotestit CI:ssä:** jokaisen julkaistun version Kuulan hölkkä -tietokanta päivitetään uusimpaan, ja tulosten pitää pysyä täsmälleen samoina (`expected-results.csv`).
- Sama migraatiosarja testataan SQLitellä ja (v0.4 alkaen) Postgresilla.
- Asiakas voi aina viedä datansa avoimessa muodossa (`.ertx`, CSV).

### 10.5 Muut kaupalliset huomiot
i18n alusta asti, brändäys konfiguraatiossa (seuran logo), telemetria vain opt-in ja anonyymi, diagnostiikkapaketti tukeen ilman henkilötietoja. SaaS:ia varten käyttöehdot, tietosuojaseloste ja DPA (seura on rekisterinpitäjä, palvelu käsittelijä; juoksijaportaalissa palvelu on osin rekisterinpitäjä).

## 11. Testaus ja hyväksymiskriteerit

### 11.1 Kuulan hölkkä -fixture (`testdata/kuulan-holkka/`)
- `generate.py` on deterministinen generaattori ja tulosten oraakkeli. Se tuottaa tiedostot `event.json` (2 matkaa, 16 sarjaa + 8 km:n kuntosarja K8, asetukset), `entries.csv` (67 ennakkoilmoittautunutta; seurat: UU, JKU, SaPu, Hanka, PePe, MuYr, uusi VaTe, 23 ilman seuraa), `clubs-registry.json` (6 seuraa + kaksoiskappale), `race-day.json` (100 toimenpidettä: seurojen ratkaisut, 68 maalipainallusta, 3 tasatulosvahvistusta), `expected-clubs.csv`, `expected-club-stats.csv`, `expected-results.anonymized.csv`, `expected-categories.csv` (molemmat ikäperusteet), `expected-tie-groups.csv` (3 ryhmää) ja odotetut tulokset kolmella siirretyn lähdön säännöllä.
- `E2E_SKENAARIO.md` kuvaa vaiheet ja reunatapaukset R1–R6, E1–E11, seurat C1–C8 ja anonymisointi A1–A5. `kuulan-holkka.spec.ts` on Playwright-luonnos.
- Data on fiktiivistä. Fixture-päivä on la 12.6.2027, matkat 4 km klo 11.00 (T/P4–16) ja 8 km klo 11.30 (N, M).

**Arvio riittävyydestä:** skenaario kattaa v0.1:n perusvirran ja kaikki pyydetyt reunatapaukset (DNF, DNS, numerolapun vaihto ja lappujen ristiinvaihto, maaliintulo ilman numeroa, kolme tasatulosryhmää (järjestyksen kääntö, kirjausjärjestyksen vahvistus ja jaettu sija) ja jälki-ilmoittautuminen ennen ja jälkeen lähdön). Lisäksi mukana ovat ikärajat ja ikäperusteen vaihto, 17-vuotias aikuisten sarjassa, matkan vaihto kumpaankin suuntaan (aikuisen siirto lyhyelle matkalle estetään), näppäilyvirhe, tuplakirjaus, kaatuminen kesken kisan ja lukituksen esto. **Skenaario ei yksin riitä**: 70 juoksijaa ei synnytä maaliruuhkaa, ja siinä on vain yksi kone. Siksi lisätään erillinen kuormitustesti (500 osallistujaa, 10 painallusta/s), v0.2:n kahden koneen skenaario, ominaisuuspohjaiset yksikkötestit tuloslaskennalle sekä kenraaliharjoitus oikeilla ihmisillä.

### 11.2 v0.1:n hyväksymiskriteerit (kaikkien täytyttävä)
| # | Kriteeri | Todennus |
|---|---|---|
| H1 | `entries.csv` tuodaan: 67 riviä, 0 virhettä. Sarjaehdotukset ja varoitukset vastaavat `expected-categories.csv`:tä molemmilla ikäperusteilla. Säilytysvalinta tallentuu `consent`-tauluun kaikille 67:lle. | E2E vaihe 2 |
| H2 | Koko `race-day.json` ajetaan oikean käyttöliittymän kautta yhdellä koneella, **verkko pois päältä**. | E2E vaihe 3 |
| H3 | Tulosten CSV on rivi riviltä sama kuin `expected-results.csv` ja kaksi muunnelmaa (siirretty lähtö `unranked` / `open_category`). | E2E vaihe 7 |
| H4 | `kill -9` kesken maalikirjausten ja uudelleenkäynnistys: 0 kadonnutta painallusta. | E2E vaihe 4 |
| H5 | Kaikki 14 korjausta ja statusmuutosta sekä 3 tasatulosvahvistusta näkyvät audit-lokissa syineen. Lukitus estyy, kunnes lappu 108 on käsitelty ja tasatulokset vahvistettu, ja muutos lukituksen jälkeen palauttaa `EVENT_LOCKED`. | E2E vaiheet 5–6 |
| H6 | Siirretty lähtö näkyy tulosteessa ja CSV:ssä (lappu 228 "−30:00", lappu 161 "+2:00"). | E2E vaihe 8 |
| H7 | A4-tulosteessa on kaikki 16 sarjaa, tyhjä K8 piilotettu, ääkköset oikein. CSV aukeaa Excelissä oikein. | E2E vaihe 8 + käsin |
| H8 | fi/en vaihtuu koko käyttöliittymässä ja tulosteissa. Käännöksiä ei puutu (CI-tarkistus). | E2E vaihe 10 + CI |
| H9 | Kuormitustesti: 500 osallistujaa, 10 painallusta/s 30 s ajan, p95 < 50 ms, 0 menetystä. | erillinen testi |
| H10 | Kenraaliharjoitus: kaksi ihmistä ajaa skenaarion paperilistalta ja tulokset vastaavat oraakkelia. Löydökset korjataan. | käsin |
| H11 | **Kenttäkäyttö:** oikea Kuulan hölkkä ajetaan ohjelmalla, ja rinnalla pidetään paperi- ja sekuntikellovarmistus. Tulokset julkaistaan ohjelmasta, ja erot varmistukseen ovat ≤ 1 s tai selitettyjä. | kisapäivä |
| H12 | **Tasatulosnäkymä:** fixturen 3 ryhmää (`expected-tie-groups.csv`) tunnistetaan automaattisesti. Ennen vahvistusta tuloksissa näkyy "Vahvistamaton järjestys", ja lukitus estyy. 22:13 käännetään raahaamalla, 21:32 vahvistetaan pelkällä näppäimistöllä ja 41:07 merkitään "Tasan". Sijat päivittyvät sarjassa ja yleisissä tuloksissa oraakkelin mukaisiksi, Kumoa palauttaa edellisen tilan, ja kahden hengen ryhmän vahvistus vaatii ≤ 3 toimintoa. Kenraaliharjoituksessa maalikirjuri vahvistaa ryhmän ilman ohjeita alle 30 sekunnissa. | E2E vaihe 6 + käsin |
| H13 | **Seurat:** jokaisen CSV-arvon tunnistus vastaa tiedostoa `expected-clubs.csv` (lyhenne, nimi, normalisoitu nimi, ehdotus, uusi, ristiriita). Kaksoiskappale `Uuraisten Urh.` ehdotetaan yhdistettäväksi UU:hun, ja yhdistäminen siirtää 2 osallistumista ja on peruttavissa. Lyhenneristiriita VaTe ratkaistaan yhdistämisnäkymässä. Toista seuraa ei voi tallentaa samalla lyhenteellä (`CLUB_ABBREVIATION_TAKEN`). Jälki-ilmoittautumisen automaattinen täydennys löytää haulla `UU` ja `muur` oikeat seurat. Tuloksissa näkyy leveässä näkymässä koko nimi ja kapeassa (375 px) lyhenne, ja seurasuodatin UU antaa 13 (4 km) ja 10 (8 km) osallistujaa. | E2E vaiheet 2 ja 9 |
| H14 | **Anonymisointi:** kun testikello on 13.6.2028, säilytysajo anonymisoi kaikki ilman pitkäaikaissuostumusta olevat. Julkinen tuloslista on rivi riviltä sama kuin `expected-results.anonymized.csv` ("Anonyymi (UU)" / "Anonyymi", pienissä ryhmissä seura piilotettu, pienissä sarjoissa sarja yleistetty ja aika piilotettu sarjan listassa). Sisäiset seuratilastot ovat samat kuin ennen ajoa, ja julkaistut vastaavat tiedostoa `expected-club-stats.csv` ("Muut seurat"). Tietokannasta, viennistä ja audit-lokista ei löydy yhtään anonymisoidun nimeä, syntymäaikaa, sähköpostia tai lappua, eikä osallistumisilla ole yhteistä henkilötunnistetta. Suostumuksen antaneiden tiedot säilyvät. Vartija on hyväksynyt kohdan 8 tarkistuslistan. | E2E vaihe 11 + Vartija |

### 11.3 Myöhempien versioiden hyväksymiskriteerit (tiivistetty)
- **v0.2:** skenaario `kuulan-holkka-2kone` (sama data, lähtö- ja maalikone erikseen, simuloitu kellojen ero 1,7 s ja ajautuminen 30 ppm 2 h ajan). Korjattujen aikojen virhe on ≤ 0,1 s. Väliaikapuhelin on offline 2 h ja synkronoi jälkeenpäin ilman menetyksiä tai tuplia. Lappuristiriita kahdella koneella näkyy ristiriitalistalla. LAN-katkos kesken kisan ei pysäytä yhtään laitetta.
- **v0.3:** kullekin uudelle kilpailumuodolle oma fixture ja oraakkeli (yksilölähtöinen hiihto, viesti, CX-kierrokset, kaksipäiväinen).
- **v0.3:** seuratilastot (osallistujat, sijoitukset, seurakilpailu) vastaavat oraakkelia, ja pienten ryhmien sääntö pätee kaikissa julkaistuissa tilastoissa.
- **v0.4 (SaaS-beta):** jaettu seurahakemisto (ehdotus → moderointi → käyttö toisessa seurassa, paikallisen seuran liittäminen hakemistoon), seurojen eristystestit (seura A ei näe seuran B dataa), suostumuksen myöntö ja peruminen sekä anonymisointiajo, livetulossivu päivittyy katkoksellisella yhteydellä (simuloitu 30 % pakettihäviö), pilottiseurana Uuraisten Urheilijat.
- **v1.x (natiivit):** iOS- ja Android-sovellukset läpäisevät protokollan testivektorit ja kahden koneen skenaarion. Kosketuksesta tallennukseen p95 < 20 ms.
- **v1.0:** migraatiotestit kaikista julkaistuista versioista, allekirjoitetut paketit, tietoturvakatselmointi, käyttöohjeet fi/en.

## 12. Tiekartta ja milestone-jako

| Milestone (GitHub) | Sisältö | Valmis kun |
|---|---|---|
| **M0 Pohja** | Tagi `legacy-2025`, haara `rewrite`, AGPL-3.0-only + CLA, monorepo-runko, CI (lint, moduulirajat, typecheck, test, build, lisenssit), ADR:t 0001–0006, fixture repoon, Dependabot-PR:t suljettu | CI vihreä tyhjällä rungolla |
| **M1 v0.1-alpha: Valmistelu** | Tietomalli ja migraatiot, `core`: sarjan määritys, tapahtuma/matkat/sarjat, CSV-tuonti, laput, henkilö ja suostumus sekä säilytysvalinta, seurarekisteri (tunnistus, automaattinen täydennys, yhdistämisnäkymä), jälki-ilmoittautuminen, fi/en, OpenAPI-sopimus | H1, H13 (tuonti) |
| **M2 v0.1-beta: Ajanotto ja tulokset** | Lähtö ja lähtösiirrot, maalikirjaus (molemmat tavat), korjaukset ja audit, statukset, lukitus, tuloslaskenta ja sijoitussäännöt, tasatulosten järjestysnäkymä, seura-sarake ja -suodatin, tuloste ja CSV, varmuuskopiot ja `.ertx`, kaatumisesta palautuminen, säilytysajo ja anonymisointi julkaisusuodattimineen | H2–H8, H12–H14 |
| **M3 v0.1: Kuulan hölkkä** | Kuormitustesti, asennuspaketti kannettavalle, pikaohje, kenraaliharjoitus, kenttäkäyttö | H9–H11 |
| **v0.2: Monta laitetta ja väliajat** | Mobiili-PWA ja HTTPS-ADR, IndexedDB-varasto, replikointi (LAN/hotspot/tiedosto), kellojen synkronointi ja ajautumiskorjaus, kahden koneen lähtö ja maali, väliajat, ristiriitanäkymä, varakellot, LAN-livetulokset, yleisönäyttö | 11.3 v0.2 |
| **v0.3: Lajit ja kilpailumuodot** | Yksilölähdöt ja lähtökello, viestit, kierrokset, monipäiväiset, triathlon, cup-sarjat; hiihto- ja pyöräilyprofiilit; seuratilastot ja seurakilpailu | 11.3 v0.3 |
| **v0.4: SaaS-beta** | Postgres-`storage`, asiakasseurat ja käyttäjätilit (OIDC), jaettu seurahakemisto, pilvivälitys, livetulokset verkkoon kisan aikana, pitkäaikainen arkisto suostumuksella, anonymisointiajot, laskutus (vuosimaksu), pilottiseura | 11.3 v0.4 |
| **v1.0: Julkaisu** | Vakaat rajapinnat, migraatiotestit, allekirjoitetut paketit, tietoturvakatselmointi, käyttöohjeet, SaaS yleisesti saatavilla | 11.3 v1.0 |
| **v1.x** | **Natiivit iOS- (Swift/SwiftUI) ja Android-sovellukset (Kotlin/Jetpack Compose)** SaaS-versioon (maali, lähtö, väliajat; tarkka monotoninen kello), juoksijaportaali, seuratilastot tapahtumien yli, avattu laajennusrajapinta, RFID/chip, liittojen formaatit, PDF/Excel | – |

## 13. Repon uudelleenaloitus: askeleet (M0)
1. Tagi `legacy-2025` nykyiseen `main`-haaraan.
2. Haara `rewrite`: poistetaan `backend/`, `database/`, `deployment/`, `frontend/` ja `TECHNICAL_ARCHITECTURE.md`. LICENSE vaihdetaan AGPL-3.0-only-lisenssiin. CONTRIBUTING päivitetään (CLA), CODE_OF_CONDUCT ja SECURITY pidetään, `.github/` muokataan.
3. `docs/MAARITTELY.md` (tämä), ADR:t `0001-sqlite-ja-kannettava`, `0002-append-only-ajanotto`, `0003-modulaarinen-monoliitti`, `0004-offline-first-replikointi-ja-kellot`, `0005-agpl-ja-saas-raja`, `0006-henkilo-osallistuminen-suostumus`, `0007-seurarekisteri-ja-lyhenne`, `0008-anonymisointi-ja-pienet-ryhmat`, `0009-alustariippumaton-api`, päivitetty `docs/api/ERROR_CODES.md`.
4. `testdata/kuulan-holkka/` repoon. E2E-luonnos polkuun `e2e/`.
5. Dependabot-PR:t #28, #30, #32, #33, #36, #37, #38 suljetaan. Milestonet M0–v1.0 ja M1–M3:n issuet luodaan.
6. README fi/en uusiksi: kuvaus, pikakäynnistys, tiekartta, lisenssi ja SaaS.

## 14. Avoimet kysymykset
1. **Kuulan hölkän todellinen päivämäärä, matkojen pituudet ja lähtöajat:** fixturessa la 12.6.2027, 4 km klo 11.00 ja 8 km klo 11.30. Fixture päivitetään ennen kenttätestiä.
2. **Alle 4-vuotiaat:** sijoitetaanko nuorimpaan sarjaan varoituksen kera (oletus) vai estetäänkö?
3. **SaaS:** vuosimaksun hintahaarukka, säilytysaika ilman suostumusta (ehdotus 12 kk) ja juridinen tarkistus suostumusteksteille. Rekisteröidäänkö tavaramerkki?
4. **Seuralyhenteet:** fixturen lyhenteet SaPu ja Hanka on varmistettu, UU on Valtterin antama, JKU, PePe, MuYr ja VaTe tarkistetaan liiton rekisteristä. Mistä jaetun hakemiston alkudata saadaan (SUL, Hiihtoliitto tai muu)?
5. Tietosuojan tarkistuslista (kohta 8) Vartijalle ennen v0.1:tä.
6. *Tekninen, ratkaistaan v0.2:n alussa:* mobiili-PWA:n HTTPS-ratkaisu (kohta 3).
