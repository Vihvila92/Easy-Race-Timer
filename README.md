# Easy Race Timer

Nykyaikainen, web-pohjainen ajanotto-ohjelmisto suomalaisille urheiluseuroille ja kilpailujärjestäjille. Järjestelmä tukee useita urheilulajeja ja tarjoaa kolme eri käyttöönottomahdollisuutta organisaation tarpeiden mukaan.

## 🎯 Projektin Tavoitteet

- **Helppokäyttöisyys**: Intuitiivinen käyttöliittymä stressaavissa kilpailutilanteissa
- **Joustavuus**: Tukee yhden kilpailijan aikakisasta tuhansien kilpailijoiden tapahtumiin
- **Luotettavuus**: Kattava sekunttikellojen varmuusjärjestelmä teknisten ongelmien varalle
- **Saavutettavuus**: Toimii vanhoilla Android/iOS-laitteilla ja hitailla verkkoyhteyksillä
- **Kielituki**: Täysin kaksikielinen (suomi/englanti) käyttöliittymä

## 🏁 Tuetut Lajit ja Kilpailutyypit

### Monipuolinen lajituki

- **Yleisurheilu**: Juoksu, maraton, cross-country
- **Pyöräily**: Maantie, cyclocross, MTB
- **Triathlon**: Uinti-pyöräily-juoksu yhdistelmäkisat
- **Hiihto**: Maastohiihto, sprintit
- **Muut lajit**: Helposti lisättävissä uusia lajeja

### Kilpailutyypit

- **Joukkuelähdöt**: Kaikki lähtevät samaan aikaan
- **Yksilölliset lähtöajat**: Time trial -tyyppiset kisat
- **Monierä-kilpailut**: Usean päivän kisat
- **Viestit**: Joukkuekilpailut
- **Sarjakisat**: Usean kilpailun kokonaisuudet

## 🏗️ Järjestelmän Arkkitehtuuri

### Kolme käyttöönottomahdollisuutta

#### 1. Standalone (0 EUR/kk)

- **Käyttöönotto**: Docker Compose paikallisessa koneessa
- **Tietokanta**: Paikallinen PostgreSQL
- **Soveltuu**: Yksittäiset seurat, kehitys, demo
- **Rajoitukset**: Ei pilvi-ominaisuuksia, manuaalinen huolto

#### 2. Self-hosted Cloud (25-45 EUR/kk)

- **Käyttöönotto**: VPS-palvelin + Docker Compose
- **Tietokanta**: Hallinnoidut varmuuskopiot
- **Soveltuu**: Seurat jotka haluavat pilvi-edut mutta pitää datan omassa hallinnassa
- **Ominaisuudet**: SSL-sertifikaatit, automaattiset päivitykset

#### 3. Managed Cloud (Kubernetes)

- **Käyttöönotto**: Täysin hallinnoitu Kubernetes-ympäristö
- **Tietokanta**: Pilvipalvelun hallinnoima tietokanta
- **Soveltuu**: Suuret organisaatiot, korkeat saatavuusvaatimukset
- **Ominaisuudet**: 99.9% käytettävyys, automaattinen skaalaus, 24/7 tuki

### Teknologiavalinta

- **Backend**: Node.js 18+ LTS, Express.js, TypeScript
- **Frontend**: React 18+, TypeScript, Tailwind CSS
- **Tietokanta**: PostgreSQL 14+ Row-Level Security:llä
- **Reaaliaikaisuus**: Socket.io WebSocket-yhteydet
- **Autentikointi**: JWT-pohjaiset token-systeemit
- **Konttiteknologia**: Docker + Kubernetes

### Komponentit ja Toiminnallisuudet

#### Kilpailujen Hallinta

- **Kilpailujen luonti**: Helppo lomake kilpailujen perustamiseen
- **Sarjajaottelu**: Ikä-, sukupuoli- ja tasoperusteinen kategorisointi
- **Kilpailijarekisteri**: Keskitetty kilpailijarekisteri organisaatiolle
- **Ilmoittautuminen**: Kilpailijoiden ilmoittautuminen kisaan

#### Ajanotto-järjestelmä

- **Digitaalinen ajanotto**: Tarkat ajanotoet submilli-sekunnin tarkkuudella
- **Verkkosynchronisointi**: NTP-tyyppinen aikasynkronointi eri laitteiden välillä
- **Sekuntikellojen varmuusjärjestelmä**: Useamman sekuntikellon tuki eri käynnistysajoilla
- **Automaattinen muunnos**: Sekuntikello-ajoista kisa-aikoihin automaattinen muunnos

#### Tulosten Hallinta

- **Reaaliaikaiset tulokset**: Välittömät päivitykset WebSocket-yhteyksien kautta
- **Tulossarjat**: Kategoria- ja kokonaiskilpailujen tulokset
- **Tulosten vienti**: PDF, Excel ja virallisten liittojen formaatit
- **GDPR-yhteensopivuus**: Henkilötietojen hallinta EU-säädösten mukaisesti

#### Käyttöliittymät

- **Lähtökone**: Kilpailijoiden lähdön hallinnointi
- **Maalikone**: Maaliin tulon ajanotto
- **Tulospalvelu**: Yleisönäyttö ja tulosten julkaisu
- **Ylläpito**: Kilpailujen ja järjestelmän hallinnointi

## 🚀 Kehityksen Tila

### Suunnitteluvaihe (Valmis ✅)

- [x] Järjestelmäarkkitehtuuri määritelty
- [x] Teknologiavalinnat tehty
- [x] Tietokantasuunnittelu valmis
- [x] API-suunnittelu valmis
- [x] Multi-tenant arkkitehtuuri suunniteltu
- [x] Sekunttikellojen varmuusjärjestelmä suunniteltu
- [x] Kattava tekninen dokumentaatio

### Tulevat Kehitysvaiheet

#### Vaihe 1: Backend Core (v0.1)

- [ ] PostgreSQL tietokantaschema
- [ ] REST API perusrungot
- [ ] JWT-autentikointi
- [ ] Multi-tenant tietojen eristys
- [ ] WebSocket perustoiminnot

#### Vaihe 2: Frontend Core (v0.2)

- [ ] React-sovelluksen pohja
- [ ] Komponenttikirjasto (Tailwind + Shadcn/ui)
- [ ] Kilpailujen hallinnan käyttöliittymä
- [ ] Kilpailijarekisterin käyttöliittymä
- [ ] Kaksikielisyys (i18n)

#### Vaihe 3: Ajanotto (v0.3)

- [ ] Digitaalinen ajanotto-käyttöliittymä
- [ ] Reaaliaikaiset tulospäivitykset
- [ ] Aikasynkronointi-järjestelmä
- [ ] Perus tulosten laskenta

#### Vaihe 4: Manual Timing (v0.4)

- [ ] Sekunttikellojen rekisteröinti
- [ ] Automaattinen aikojen muunnos
- [ ] Paperilomakkeiden generointi
- [ ] Manuaalisten aikojen tuonti

#### Vaihe 5: Production Ready (v1.0)

- [ ] Docker-konttikonfiguraatio
- [ ] Tietoturva-auditointi
- [ ] Suorituskykytestaus
- [ ] GDPR-yhteensopivuuden varmistaminen
- [ ] Käyttöohjeiden kirjoittaminen

## 📁 Projektirakenne

```text
Easy-Race-Timer/
├── backend/                    # Node.js TypeScript API
│   ├── src/
│   │   ├── controllers/        # HTTP route handlers
│   │   ├── models/            # Tietokantamallit ja -skemat
│   │   ├── services/          # Liiketoimintalogiikka
│   │   ├── middleware/        # Multi-tenant, auth, validointi
│   │   ├── websocket/         # Socket.io WebSocket handlers
│   │   ├── migrations/        # Tietokannan migraatiot
│   │   └── types/             # TypeScript tyyppimääritykset
│   ├── tests/                 # Backend testit (Jest)
│   └── Dockerfile
├── frontend/                   # React TypeScript sovellus
│   ├── src/
│   │   ├── components/        # React komponentit
│   │   │   ├── competitions/  # Kilpailujen hallinta
│   │   │   ├── competitors/   # Kilpailijarekisteri
│   │   │   ├── timing/        # Ajanotto-käyttöliittymät
│   │   │   ├── results/       # Tulosnäytöt
│   │   │   ├── admin/         # Ylläpito
│   │   │   └── common/        # Yleiset komponentit
│   │   ├── hooks/             # Custom React hooks
│   │   ├── services/          # API-kutsut ja WebSocket
│   │   ├── auth/              # Autentikointi ja roolit
│   │   ├── i18n/              # Kaksikielisyys (FI/EN)
│   │   └── types/             # Frontend tyyppimääritykset
│   ├── tests/                 # Frontend testit (Vitest)
│   └── Dockerfile
├── database/                   # Tietokanta-asennukset
│   ├── schema/                # PostgreSQL schema
│   ├── migrations/            # Tietokannan versiointi
│   └── seeds/                 # Testidatat
├── deployment/                 # Käyttöönottokonfiguraatiot
│   ├── standalone/            # Docker Compose (kehitys/pienet)
│   ├── self-hosted-cloud/     # VPS deployment
│   └── managed-cloud/         # Kubernetes manifests
├── docs/                      # Dokumentaatio
│   ├── api/                   # API dokumentaatio
│   ├── user-guide/            # Käyttöohjeet (FI/EN)
│   └── development/           # Kehittäjädokumentaatio
├── tests/                     # E2E testit (Playwright)
├── TECHNICAL_ARCHITECTURE.md  # Tekninen arkkitehtuuridokumentaatio
├── README.md                  # Tämä tiedosto (Suomi)
└── README_EN.md              # Englanninkielinen README
```

## 🎮 Käyttötapaukset

### Pieni seura: Standalone-käyttöönotto

Esimerkki: Uuraisten Urheilijat, 50 kilpailijaa

1. **Asennus**: Lataa Docker Compose -tiedosto ja käynnistä `docker-compose up`
2. **Kilpailun luonti**: Avaa selain -> luo uusi kilpailu
3. **Kilpailijoiden lisäys**: Syötä kilpailijat järjestelmään
4. **Ajanotto**: Yhdellä koneella sekä lähtö- että maaliajanotto
5. **Tulokset**: Automaattinen tulosten laskenta ja näyttö

**Kustannukset**: 0 EUR (paitsi oma laitteisto)

### Keskikokoinen seura: Self-hosted Cloud

Esimerkki: Jyväskylän Kenttäurheilijat, 300 kilpailijaa

1. **Asennus**: VPS-palvelin (€35/kk) + automaattinen Docker-asennus
2. **Multi-device käyttö**:
   - Lähtökone: Tablet lähtöviivalla
   - Maalikone: Kannettava maalissa
   - Tulospalvelu: Näyttö yleisölle
3. **Reaaliaikaiset tulokset**: Kaikki laitteet synkronoituna
4. **Varmuusjärjestelmä**: Sekunttikellot paperilomakkeilla

**Kustannukset**: €35/kk VPS + SSL-sertifikaatti

### Suuri organisaatio: Managed Cloud

Esimerkki: Suomen Urheiluliitto, useita kilpailuja samanaikaisesti

1. **Käyttöönotto**: Täysin hallinnoitu Kubernetes-ympäristö
2. **Skaalautuvuus**: Automaattinen kapasiteetin lisäys kovan kuormituksen aikana
3. **Monitorointi**: 24/7 järjestelmän seuranta ja hälyytykset
4. **Tuki**: Tekninen tuki kilpailupäivinä
5. **Integraatiot**: Liittojen tulostietokantaintegraatiot

## 🔧 Teknisiä Huomioita

### Luotettavuus ja Varmuusjärjestelmät

- **Sekunttikellojen tuki**: Useampi sekunttikello eri käynnistysajoilla
- **Automaattinen muunnos**: Sekunttikello-ajat muunnetaan automaattisesti kisa-aikoihin
- **Offline-toiminta**: Toimii ilman verkkoyhteyttä, synkronoi kun yhteys palautuu
- **Paperilomakkeet**: Automaattinen varmuuslomakkeiden generointi

### Suorituskyky ja Skalautuvuus

- **Vanhat laitteet**: Optimoitu Android 7+/iOS 12+ laitteille
- **Alhainen muistinkulutus**: Toimii 2GB RAM laitteilla
- **Nopea reagointi**: Sub-sekunnin ajanotto tarkkuudella
- **Samanaikaiskäyttäjät**: Tukee satoja samanaikaisia käyttäjiä

### Tietoturva ja Yksityisyys

- **GDPR-yhteensopivuus**: Täysi EU:n tietosuoja-asetuksen tuki
- **Multi-tenant eristys**: Organisaatioiden data täysin eristetty
- **Salaus**: HTTPS/WSS salatut yhteydet
- **Varmuuskopiointi**: Automaattiset, salatut varmuuskopiot

## 🌐 Kielituki

- **Suomi**: Ensisijainen kieli, täysi lokalisointi
- **Englanti**: Kansainvälinen käyttö
- **Dynaaminen vaihto**: Kieltä voi vaihtaa lennossa
- **API-dokumentaatio**: Englanti (kansainvälinen standardi)

## 📄 Dokumentaatio

- **[Tekninen arkkitehtuuri](TECHNICAL_ARCHITECTURE.md)**: Kattava tekninen suunnittelu
- **[English README](README_EN.md)**: International documentation
- **Käyttöohjeet**: Tulossa kun implementaatio etenee
- **API-dokumentaatio**: Tulossa backend-kehityksen mukana

## 🚧 Nykyinen Status

**Kehitysvaihe**: Suunnitteluvaihe valmis, implementaatio alkamassa

**Seuraavat askeleet**:

1. Backend PostgreSQL-schema ja API-rungot
2. React frontend pohja ja komponenttikirjasto
3. Ensimmäinen toimiva MVP ajanotto-ominaisuuksilla

**Osallistuminen**: Projektiin voi osallistua kun ensimmäinen MVP valmis

---

**Päivitetty:** 9. elokuuta 2025

**Dokumentaatio**: [Tekninen arkkitehtuuri](TECHNICAL_ARCHITECTURE.md) | [English](README_EN.md)
**Politiikat**: [Tietoturva](SECURITY.md) | [Code of Conduct](CODE_OF_CONDUCT.md)

## 👤 Roolipohjainen Käyttöliittymä

### Käyttäjäroolit

- **Admin**: Pääkäyttäjä, kaikki ominaisuudet käytössä
- **Start**: Lähtöaikojen otto ja kilpailijoiden hallinta
- **Finish**: Maaliin tulon ajanotto
- **Display**: Tulosten ja tietojen näyttö yleisölle
- **Timer**: Yleinen ajanotto-rooli (start + finish)

### Automaattinen näkymän valinta

1. **Kirjautuminen**: Käyttäjä syöttää tunnukset
2. **Roolin tunnistus**: Järjestelmä tunnistaa käyttäjän roolin
3. **Näkymän ohjaus**: Selain ohjautuu automaattisesti oikeaan näkymään
4. **Rajoitetut toiminnot**: Käyttäjä näkee vain oman roolinsa mukaiset toiminnot

### Joustavuus

- **Admin-käyttäjät**: Voivat valita haluamansa näkymän
- **Roolien vaihto**: Mahdollista vaihtaa roolia uudelleenkirjautumisella
- **Mobiilituki**: Kaikki näkymät toimivat myös mobiililaitteilla

## 🔧 Kehitysperiaatteet

1. **Don't Reinvent the Wheel**: Käytä valmiita komponentteja ja kirjastoja
2. **Modulaarisuus**: Komponentit eristetty ja uudelleenkäytettävä
3. **DRY Principle**: Minimoi koodin toistaminen
4. **Progressive Enhancement**: Aloita yksinkertaisesta, lisää ominaisuuksia vähitellen
5. **Future-Proof**: Pidä arkkitehtuuri avoimena tulevaisuuden laajennuksille

## 🌐 Kielituki ja Kansainvälistäminen

### Sisäänrakennetut kielet

- **Suomi (FI)**: Ensisijainen kieli ja kehityskieli
- **Englanti (EN)**: Kansainvälinen käyttö, sisäänrakennettuna

### Tekninen toteutus

- **React i18n**: Kansainvälistäminen React-komponenteissa
- **Backend i18n**: API-viestit ja virhetekstit molemmilla kielillä
- **Käyttäjän valinta**: Kieli valittavissa käyttöliittymästä
- **Dynaaminen vaihtaminen**: Kieltä voi vaihtaa lennossa

### Tulevaisuuden kielilaajennukset

- Käännökset yhteisön toimesta
- Lisäkielet tarpeen mukaan (Ruotsi, Saksa, jne.)
- Käännöstyökalujen integraatio

### Dokumentaation kielituki

- **README**: Suomi (ensisijainen) + Englanti (README_EN.md)
- **API-dokumentaatio**: Englanti (kansainvälinen standardi)
- **Käyttöohjeet**: Molemmat kielet
- **Koodikommentit**: Englanti (kehittäjäystävällisyys)

## 📝 Huomioita

- Tietokanta pysyy kevyenä, mutta järjestelmän tulee skaalautua isompiin kilpailuihin
- Nopeus on kriittistä - ei saa olla viivettä ajanoton aikana
- Offline-toiminta tärkeää (network-katkokset eivät saa vaikuttaa)
- Käyttöliittymän tulee olla intuitiivinen myös stressaavissa tilanteissa

## � Lisenssi

Tämä projekti on lisensoitu mukautetulla "Free Use License for Sports Organizations" -lisenssillä.

Yhteenveto:

- ✅ Ilmainen käyttö urheiluseuroille ja -järjestöille kilpailujen ajanottoon
- ✅ Saa periä normaalit osallistumismaksut kilpailijoilta
- ✅ Saa muokata ja ylläpitää omaa instanssia (self-hosting)
- ❌ Ei saa myydä palveluna tai jälleenmyydä ohjelmistoa
- ❌ Ei suljettuja, proprietaarisia johdannaisia
- ➡️ Kaupallisia palveluita varten ota yhteyttä: [valtteri@vehvilainen.cc](mailto:valtteri@vehvilainen.cc)

Täydet ehdot: katso tiedosto LICENSE.

Lisämateriaalit: [Tietoturvapolitiikka](SECURITY.md) · [Code of Conduct](CODE_OF_CONDUCT.md) · [Contributing](CONTRIBUTING.md)

## 🔄 Päivitystiedot

**Päivitetty:** 9. elokuuta 2025
