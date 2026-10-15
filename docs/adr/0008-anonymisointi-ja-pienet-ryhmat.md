# ADR 0008: Anonymisointi ja pienet ryhmät

- Tila: hyväksytty (v0.1). Vartijan tarkistuslista on vielä avoin.
- Päivä: 2026-10-14

## Tausta

Ilman pitkäaikaista suostumusta henkilötietoja ei saa säilyttää oletuksena 12 kuukautta pidempään. Pelkkä nimen poisto ei riitä, jos sarja, seura ja aika tunnistavat ihmisen pienessä ryhmässä.

## Päätös

Raja on tapahtuman päivä plus `retention_months` (oletus 12). Ajo käynnistyy, kun kello on rajan jälkeen eikä viimeisin `long_term_storage`-suostumus ole myönnetty.

Poistetaan nimi, syntymäaika ja -vuosi, sähköposti, lappu, `club_raw` ja audit-lokin vapaatekstit, joissa nämä esiintyvät. `person`-rivi poistetaan. Ennen lapun tyhjennystä sijoitus jäädytetään tiheäksi `result_order`-arvoksi.

Julkinen suodatin (`k = privacy_min_group_size`, oletus 3) on yhdessä paikassa ja koskee CSV:tä, tulostetta ja julkista APIa:

- sarja × seura alle k: seuraa ei näytetä ("Anonyymi")
- sarja alle k: sarja yleistetään sukupuoliryhmäksi ja sarjan listassa aika piilotetaan
- julkaistut seuratilastot: alle k:n solut ja tarvittaessa seuraavaksi pienin yhdistetään riviksi "Muut seurat"

Näyttönimi on "Anonyymi (lyhenne)" tai "Anonyymi". Yksilöivistä huomautuksista jää "Siirretty lähtö" ilman siirron kestoa. Sisäiset tilastot pysyvät tarkoina.

## Seuraukset

- Ennen ajoa julkaistuja paperi- ja verkkokopioita järjestelmä ei voi poistaa. Tämä on Vartijan listan kohta 2.
- Varmuuskopioiden kiertoa ei ole vielä sidottu säilytysaikaan. Palautettu vanha kanta sisältää henkilötiedot, kunnes ajo ajetaan uudelleen.
