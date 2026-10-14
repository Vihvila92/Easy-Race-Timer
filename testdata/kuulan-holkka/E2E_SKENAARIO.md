# E2E-skenaario: Kuulan hölkkä (v0.1:n hyväksymistesti)

Fiktiivinen, mutta todellisuuteen perustuva kisa. Järjestäjä on Uuraisten Urheilijat ry, paikkana Uurainen ja päivänä la 12.6.2027 (fixture-päivä). Kisassa on 70 osallistujaa (67 ennakkoon ja 3 jälki-ilmoittautunutta), kaksi matkaa yhteislähdöillä ja 16 virallista sarjaa. Lisäksi 8 km:llä on sijoittamaton kuntosarja K8, jota käytetään vain siirretyn lähdön vaihtoehtona. Aikuisille ei ole lyhyttä matkaa.

## Tiedostot
| Tiedosto | Sisältö |
|---|---|
| `generate.py` | Deterministinen generaattori ja tulosten oraakkeli (siemen 20270612). Muutokset tehdään vain tähän, ja tiedostot generoidaan uudelleen. |
| `event.json` | Tapahtuma, matkat (R4 = 4 km klo 11.00, R8 = 8 km klo 11.30), sarjat ja niiden matkat, asetukset |
| `entries.csv` | Ennakkoilmoittautumiset CSV-muodossa (`;`, UTF-8), sarakkeet `seura` (nimi tai lyhenne) ja `seuran_lyhenne`. Testaa myös CSV-tuonnin. |
| `clubs-registry.json` | Seurarekisteri ennen kisaa (6 seuraa ja kaksoiskappale `Uuraisten Urh.`) |
| `race-day.json` | 100 toimenpidettä aikajärjestyksessä: seurojen tunnistusratkaisut ja yhdistäminen (klo 9), jälki-ilmoittautumiset seurahaun kera, lapun ja matkan vaihdot, statukset, lähdöt, 68 maalipainallusta, korjaukset, tasatulosten vahvistukset ja lukitus |
| `expected-categories.csv` | Odotettu sarja ja varoitukset kummallakin ikäperusteella (`birth_date` / `birth_year`) |
| `expected-results.csv` | Odotetut lopulliset tulokset (siirretty lähtö sijoitetaan, tasatulokset ratkaistu vahvistetulla maaliintulojärjestyksellä) |
| `expected-results.offset-unranked.csv` | Etuajassa lähtenyt näytetään sijoittamattomana |
| `expected-results.offset-open-category.csv` | Etuajassa lähtenyt siirretään kuntosarjaan K8 |
| `expected-clubs.csv` | Jokaisen CSV:n seura-arvon tunnistustapa ja lopullinen seura yhdistämisten jälkeen |
| `expected-club-stats.csv` | Seurakohtaiset osallistuja- ja maaliintulomäärät sekä julkaisumuoto (alle 3 hengen ryhmät yhdistetään riviin "Muut seurat") |
| `expected-results.anonymized.csv` | Julkinen tuloslista säilytysajan (12 kk) jälkeen: ilman pitkäaikaissuostumusta olevat anonymisoitu |
| `expected-tie-groups.csv` | Odotetut tasatulosryhmät (sama näyttöaika samalla matkalla), kirjausjärjestys ja vahvistettu järjestys |

Oraakkeli vertaa tulosaikoja `race-day.json`-leimoihin sellaisina kuin ne tiedostoon kirjoitetaan: ISO-aika katkaisee mikrosekunnit, eikä aikaa pyöristetä ennen katkaisua. Tulossarja tulee kisapäivän iästä (`suggest`), ei rakentamisen ikäämpäristä. Siksi lappu 123 on P6, ei P8. Näyttösekunnit ja tasatulosryhmät eivät tästä muutu; P6:n sijat ja erot kyllä, koska 123 (30:46) on sarjan kärki.

## Sarjat ja matkat
- **4 km (R4):** T4, T6, T8, T10, T12, T14, T16 ja P4, P6, P8, P10, P12, P14, P16. Sarja `Xn` kattaa iät n ja n+1, eli 4, 6, 8, 10, 12, 14 ja 16 vuotta täyttäneet. 16–17-vuotiaat juoksevat 4 km.
- **8 km (R8):** N ja M (18 v täyttäneet). Jos 16–17-vuotias haluaa pidemmän matkan, hän ilmoittautuu 8 km:lle aikuisten sarjaan. Lisäksi sijoittamaton K8.
- Ikä lasketaan kisapäivän iän mukaan (`birth_date`), ja tämä on päätetty käytännöksi. Vuosi-ikä (`birth_year`) on tuettu asetuksena ja testataan vain sarjaehdotusten osalta.

## Reunatapaukset (numero = lopullinen lappu)
| Koodi | Tapaus | Lappu | Odotettu lopputulos |
|---|---|---|---|
| R1 | Alle nuorimman sarjan (3 v) | 101 | T4 ja varoitus ikärajasta (ikäperusteella syntymäpäivä) |
| R2 | Ikäperuste vaihtaa sarjaa | 123 | Syntymäpäivän mukaan P6, vuoden mukaan P8 |
| R3 | Täyttää 18 kisaa seuraavana päivänä, ilmoittautunut 4 km | 135 | Syntymäpäivän mukaan P16. Vuoden mukaan ikä on 18, ja sopiva sarja M on vain 8 km:llä, joten tulee `NO_MATCHING_CATEGORY`. |
| R4 | Täyttää 6 kisapäivänä | 120 | P6 molemmilla perusteilla |
| R5 | Vain syntymävuosi tiedossa | 216 | M. Syntymäpäivätilassa käytetään vuosi-ikää ja annetaan huomautus. |
| R6 | 17-vuotias ilmoittautunut 8 km:lle | 214 | N (aikuisten sarja), ei varoitusta |
| E1a | DNS ilmoitettu ennen lähtöä | 205 | DNS syyn kera |
| E1b | Ei saavu eikä ilmoita | 108 | Ilman tulosta. **Lukitus estyy**, kunnes kilpailutoimisto merkitsee DNS:n. |
| E2 | DNF | 221 | DNF syyn kera, ei sijaa |
| E3a | Lapun vaihto ennen lähtöä (109 → varalappu 150) | 150 | Tulos lapulla 150. Audit-lokissa näkyy 109 → 150. |
| E3b | Juoksijat vaihtoivat lappuja keskenään | 223, 224 | Maalikirjaukset korjataan ristiin, ja tulokset ovat oikeilla henkilöillä |
| E4a | Maaliintulo ilman numeroa | 127 | Aika kirjataan ilman lappua, ja lappu yhdistetään jälkikäteen |
| E4b | Vahinkotuplapainallus ilman numeroa | – | Mitätöidään syyn kera, eikä painallus näy tuloksissa |
| E5a | Täsmälleen sama aika (käsi kädessä, yksi painallus) | 226, 227 | Toiselle kopioidaan aika. Tasatulosnäkymässä vahvistetaan "Tasan – ei erotettavissa", jolloin sija jaetaan (M: 5., 5., seuraava 7.). |
| E5b | Sama näyttöaika 22:13, kirjausjärjestys 129 ennen 130 | 129, 130 | Järjestys käännetään raahaamalla: "130 oli rinnassa edellä". P12: 2. 130, 3. 129. |
| E5c | Satunnainen tasatulos 21:32 (126 ja 127; 127 tuli ilman numeroa) | 126, 127 | Kirjausjärjestys vahvistetaan **näppäimistöllä** (ei raahausta), P10: 127 ennen 126 |
| E5d | Vahvistamattomat tasatulokset | – | Tulokset näkyvät alustavina merkinnällä "Vahvistamaton järjestys", ja lukitus estyy (`tie:R4:21:32`, `tie:R4:22:13`, `tie:R8:41:07`) |
| E6a | Jälki-ilmoittautuminen ennen lähtöä | 160, 260 | Sarja ehdotetaan automaattisesti, ja tuloksiin tulee merkintä "Jälki-ilmoittautunut" |
| E6b | Jälki-ilmoittautuminen lähdön jälkeen, lähti 2 min myöhässä | 161 | Lähtöaikaa siirretään +2:00, ja aika lasketaan omasta lähdöstä. Merkintä näkyy tuloksissa. |
| E7 | Lähtee 30 min etuajassa (−30:00) | 228 | Oma aika 42:03 ja merkintä "Siirretty lähtö −30:00". Kolme varianttia: sijoitetaan / sijoittamaton / K8. |
| E8a | 17-vuotias vaihtaa 4 km → 8 km kisapäivänä (136 → 270) | 270 | Sarja M ehdotetaan automaattisesti, ja tuloksiin tulee merkintä "Vaihtoi matkaa 4 km → 8 km" |
| E8b | Aikuinen yrittää vaihtaa 8 km → 4 km | 210 | Estetään (`NO_MATCHING_CATEGORY`, aikuisille ei ole lyhyttä matkaa), ja juoksija pysyy 8 km:llä |
| E9 | Näppäilyvirhe (229 kirjattu muodossa 292) | 229 | Tuntematon lappu hyväksytään ja merkitään tarkistettavaksi, sitten korjataan |
| E10 | Sama juoksija kirjattu kahdesti (3 s väli) | 207 | Toinen kirjaus merkitään epäilyttäväksi ja mitätöidään |
| E11 | Muutos lukituksen jälkeen | – | Vastauksena `EVENT_LOCKED` |

### Seurat (C) ja anonymisointi (A)
Seuran ensisijainen tunniste on virallinen lyhenne, joka on yksilöllinen. Haku ja tunnistus toimivat sekä lyhenteellä että nimellä. Kapeissa näkymissä näytetään lyhenne, leveissä koko nimi. Fixturen lyhenteet: UU, JKU, SaPu, Hanka, PePe, MuYr ja uutena VaTe. SaPu ja Hanka on varmistettu julkisista tulospalveluista, muut tarkistetaan liiton rekisteristä ennen kenttätestiä.

| Koodi | Tapaus | CSV-arvo | Odotettu |
|---|---|---|---|
| C1 | **Kaksoiskappale** rekisterissä | `Uuraisten Urh.` (2 riviä) | Tunnistuu kaksoiskappaleeseen nimellä, ja kaksoiskappaleiden tunnistus ehdottaa yhdistämistä UU:hun. Yhdistäminen siirtää 2 osallistumista UU:lle ja lisää nimen aliakseksi. |
| C2 | **Lyhenneristiriita** | `Vaajakosken Teräs` / `VaTe` | Sama lyhenne kuin uudella seuralla `Vaajakosken Terä`, mutta eri nimi, joten tulee `CLUB_ABBREVIATION_CONFLICT`. Yhdistämisnäkymässä ratkaisu on "sama seura", ja nimi lisätään aliakseksi. |
| C3 | Katkaistu nimi | `Jyväskylän Kenttäurh` | Ehdotus JKU, järjestäjä vahvistaa, ja nimi lisätään aliakseksi |
| C4 | Pelkkä lyhenne | `UU`, `JKU`, `SaPu`, `Hanka`, `PePe`, `MuYr`, tai vain `seuran_lyhenne` = `UU` | Tunnistus lyhenteellä (kirjainkoko ei vaikuta) |
| C5 | Kirjainkoko ja välilyönnit | `uuraisten  urheilijat ` | Tunnistus normalisoidulla nimellä |
| C6 | Uusi seura | `Vaajakosken Terä` / `VaTe` | Esikatselussa ehdotetaan uutta seuraa, ja järjestäjä luo sen (lyhenne VaTe, kunta Jyväskylä) |
| C7 | Ei seuraa | tyhjä (23 riviä) | Sallittu. Tuloksissa seura jää tyhjäksi, ja tilastoissa rivi on "(ei seuraa)". |
| C8 | Jälki-ilmoittautumisen haku | haku `UU`, haku `muur` | Automaattinen täydennys: UU (lyhenne) ja MuYr (nimen alku) |
| A1 | Anonymisointi säilytysajan jälkeen | `pitkaaikainen_tallennus` = `ei` | Kun testikello on 13.6.2028, säilytysajo poistaa nimen, syntymäajan, yhteystiedot ja lapun. Julkinen lista vastaa tiedostoa `expected-results.anonymized.csv`: "Anonyymi (UU)" tai "Anonyymi". |
| A2 | Pieni sarja × seura -ryhmä (alle 3) | esim. T16 (1 juoksija) | Seura piilotetaan anonymisoidulta riviltä. Sarja yleistetään (T16 → T), ja sarjan omassa listassa aika piilotetaan. |
| A3 | Seuratilastot anonymisoinnin jälkeen | – | Sisäiset luvut ovat samat kuin ennen anonymisointia (`expected-club-stats.csv`). Julkaistussa tilastossa alle 3 hengen ryhmät yhdistetään "Muut seurat" -riviin, ja jos piiloon jäisi vain yksi seura, mukaan otetaan myös seuraavaksi pienin. |
| A4 | Yksilöivät merkinnät | 161 (jälki-ilm. + siirretty lähtö) | Anonymisoidulta riviltä poistetaan "Jälki-ilmoittautunut" ja "Vaihtoi matkaa". Vain "Siirretty lähtö" jää, ilman poikkeaman suuruutta. |
| A5 | Suostumuksen antanut | `kyllä` | Tiedot säilyvät ennallaan |

## Ajo (Playwright, `e2e/kuulan-holkka.spec.ts`)
Ajetaan **verkko pois päältä** (`context.setOffline(true)` asiakkaalle, palvelin localhostissa). Kisan kello simuloidaan: testi syöttää `race-day.json`:n ajat palvelimen testikellolle (`POST /api/v1/test/clock`, käytössä vain testitilassa). Aikoja ei odoteta oikeasti.

1. **Valmistelu:** tuo `event.json` (tai luo tapahtuma käsin käyttöliittymästä: 2 matkaa ja 18 sarjaa). Tarkista sarjojen ja matkojen kytkentä.
2. **CSV-tuonti:** lataa ensin `clubs-registry.json`. `entries.csv` → 67 riviä, 0 virhettä. Sarjavaroitukset vastaavat tiedostoa `expected-categories.csv` (`birth_date`), ja seurojen tunnistus tiedostoa `expected-clubs.csv` (sarake `tunnistus`). Esikatselussa tehdään C3:n, C6:n ja C2:n ratkaisut, ja yhdistämisnäkymässä C1:n yhdistäminen (`race-day.json`, klo 9.00–9.03). Vaihda ikäperusteeksi `birth_year` ja tarkista, että ehdotukset vastaavat toista saraketta (R2, R3). Palauta peruste `birth_date`.
3. **Kisapäivä:** suorita `race-day.json`:n toimenpiteet näkymissä *Kilpailutoimisto*, *Lähtö* ja *Maali* oikeaa käyttöliittymää käyttäen. Maalikirjaukset tehdään toimenpiteen `mode`-kentän mukaan: `time_first` (iso nappi, lappu perään) tai `bib_first`.
4. **Kesken kisan:** maalipainallusten 30 ja 31 välissä palvelinprosessi tapetaan (`kill -9`) ja käynnistetään uudelleen, ja selain ladataan uudelleen. Yhtään painallusta ei saa kadota (offline-jono + WAL).
5. **Korjaukset:** tehdään korjausnäkymässä. Jokaiseen pyydetään syy, ja audit-lokiin tulee jokaisesta rivi (14 korjausta, 3 tasatulosvahvistusta ja 2 lukitusta).
6. **Tasatulokset ja lukitus:** lukitusyritys estyy. R4: 108 ilman tulosta + 2 tasatulosryhmää, R8: 1 ryhmä. Estelistan linkki avaa tasatulosnäkymän. Siellä 129/130 järjestetään raahaamalla, 126/127 vahvistetaan näppäimistöllä (Tab, ↑/↓, Enter) ja 226/227 merkitään "Tasan". Jokaiseen valitaan peruste. Ryhmät ja vahvistukset vastaavat tiedostoa `expected-tie-groups.csv`, ja jokainen vahvistus näkyy audit-lokissa. Kun 108 on merkitty DNS:ksi, molemmat matkat lukitaan. Muutosyritys palauttaa `EVENT_LOCKED`.
7. **Tulokset:** CSV-vienti (sarjat ja yleiset) on rivi riviltä sama kuin `expected-results.csv` (sarakkeet `race; scope; rank; bib; time; status`). Vaihda siirretyn lähdön sääntöä ja vertaa kahteen muuhun odotettuun tiedostoon.
8. **Tuloste:** A4-tulosteen esikatselussa on 16 virallista sarjaa. Tyhjää K8:aa ei näytetä. Siirretyn lähdön merkintä on näkyvissä, ja ääkköset näkyvät oikein.
9. **Seurat tuloksissa:** tulosnäkymässä on seura-sarake (leveässä näkymässä koko nimi, kapeassa, esim. 375 px leveällä mobiilinäkymällä tai yleisönäytöllä, lyhenne). Suodatus seuran mukaan (UU) näyttää R4:ssä 13 ja R8:ssa 10 osallistujaa (`expected-club-stats.csv`). CSV:ssä ovat sarakkeet `club_abbr` ja `club_name`.
10. **Kieli:** vaihda kieleksi en ja tarkista, että tulosteen otsikot ja sarjanimet vaihtuvat (N → W, T → G, P → B) ja että käännösavaimia ei puutu.
11. **Anonymisointi:** aseta testikello 13.6.2028 ja aja säilytysajo. Julkinen tuloslista on sama kuin `expected-results.anonymized.csv`, ja sisäiset seuratilastot pysyvät samoina. Tietokannasta ei löydy anonymisoitujen nimiä, syntymäaikoja eikä sähköposteja (haku `entries.csv`:n arvoilla). Audit-lokin vapaatekstikentät on siivottu, eikä osallistumisilla ole yhteistä henkilötunnistetta.

## Riittääkö skenaario?
**Kattaa:** perusvirran valmistelusta tuloksiin, 16 sarjan ja kahden matkan konfiguraation, molemmat ikäperusteet, kaksi eri aikaan alkavaa yhteislähtöä, lähtöajan siirrot ja kaikki pyydetyt reunatapaukset (DNF, DNS, lapun vaihto, ilman numeroa tullut, tasatulokset, jälki-ilmoittautumiset). Lisäksi mukana ovat tasatulosten vahvistus kolmella tavalla (raahaus, näppäimistö, "tasan"), matkan vaihto kumpaankin suuntaan, näppäilyvirhe, tuplakirjaus, kaatumisesta palautuminen ja lukitus.

**Ei kata, joten testataan erikseen:**
- **Ruuhka:** 70 juoksijaa tulee maaliin harvakseltaan. Tehdään erillinen kuormitustesti, jossa on 500 osallistujaa ja 10 painallusta sekunnissa 30 sekunnin ajan. Mitataan p95-vaste alle 50 ms eikä yhtään painallusta saa kadota.
- **Kahden koneen ja mobiililaitteen synkronointi sekä väliajat:** nämä ovat v0.2:ssa, ja niille tehdään oma skenaario `kuulan-holkka-2kone` (sama data, lähtö ja maali eri koneilla, kellojen ero 1,7 s ja ajautuminen 30 ppm).
- **Oikea käyttäjä paineen alla:** kenraaliharjoitus, jossa kaksi ihmistä ajaa skenaarion paperisen lappulistan ja sekuntikellon avulla. Sen jälkeen ohjelmaa käytetään oikeassa Kuulan hölkässä, ja rinnalla pidetään paperi- ja kellovarmistus.
- **Yksikkötestit tuloslaskennalle:** ominaisuuspohjaiset testit (fast-check), joilla varmistetaan, että tapahtumien järjestys ei vaikuta tulokseen ja että korjaus ja sen peruminen palauttavat alkutilan.
