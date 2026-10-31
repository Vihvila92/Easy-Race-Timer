# Virhekoodit

Jokainen virhevastaus on JSON:

```json
{ "error": { "code": "BIB_IN_USE", "message": "Bib 150 is already used", "details": {} } }
```

`details` puuttuu, jos sitä ei ole. Viesti on koneelle suunnattu englanninkielinen selite. Käyttöliittymä näyttää koodin.

| Koodi | HTTP | Milloin |
|---|---|---|
| `VALIDATION_ERROR` | 422 | Runko, CSV-rivi tai puuttuva syy ei kelpaa. Myös toinen yhteislähtö ilman `confirm`. |
| `NOT_FOUND` | 404 | Tapahtumaa, matkaa, lappua, seuraa tai yhdistämistä ei löydy. |
| `ENTRY_EXISTS` | 409 | Sama nimi ja syntymävuosi on jo kannassa. |
| `BIB_IN_USE` | 409 | Lappu on jo käytössä samalla matkalla. |
| `RACE_NOT_STARTED` | 409 | Maali ennen lähtöä. |
| `EVENT_LOCKED` | 423 | Matka on lukittu. |
| `LOCK_BLOCKED` | 409 | Lukitus estyy. `details.blockers` luettelee syyt (`entry:<lappu>:no_result`, `time:<id>:unassigned`, `time:<id>:before_start`, `tie:<matka>:<näyttöaika>`). Rajapinta palauttaa tunnisteet. Tulokset-näkymä näyttää niistä käännetyn tekstin. |
| `PIN_REQUIRED` | 401 | PIN puuttuu tai on väärä. |
| `NO_MATCHING_CATEGORY` | 422 | Ikä ja sukupuoli eivät sovi millekään kohdematkan sarjalle. |
| `TIE_UNCONFIRMED` | 409 | Tasatulosta ei ole vahvistettu. |
| `CLUB_ABBREVIATION_TAKEN` | 409 | Aktiivisella seuralla on jo tämä lyhenne. |
| `CLUB_ABBREVIATION_CONFLICT` | 409 | Lyhenne osuu seuraan, jonka nimi ei täsmää. |
| `SYNC_CONFLICT` | 409 | Varattu v0.2:n ristiriidalle. |
| `BACKUP_FAILED` | 500 | Varmuuskopio epäonnistui. Migraatio, lukitus, tuonti tai säilytysajo ei jatka. |
| `UNLOCK_FAILED` | 401 | Salasana, palautusavain, GCM-tarkiste tai tiedoston eheys ei avannut tiedostoa, tai odotus on kesken. Vastaus ei kerro lokeroa. `retryAfterMs` on sallittu odotuksen aikana. |
| `RECOVERY_KEY_CHECKSUM` | 400 | Palautusavaimen tarkistussumma tai aakkosto ei täsmää. KDF:ää ei ajeta. |
| `KEY_PARAMS_REJECTED` | 400 | Avainlokeron KDF-parametrit ovat alle minimin, yli katon, tai lokeron tyyppi kieltää ne. |
| `FILE_HEADER_INVALID` | 400 | Avaintiedoston taika, versio, pituus, varatut tavut tai nonce-pituus on väärin. |
| `PASSWORD_TOO_SHORT` | 422 | Salasanassa on alle 10 merkkiä NFKC-muodon jälkeen. |
| `PASSWORD_TOO_LONG` | 422 | Salasanassa on yli 128 merkkiä tai yli 512 UTF-8-tavua. |
| `PASSWORD_COMMON` | 422 | Salasana on mukana toimitetulla yleisten salasanojen listalla. |
| `PASSWORD_MISMATCH` | 422 | Kaksi kirjoitettua salasanaa eroavat, tai kaksi ylläpitäjän salasanaa ovat samat. |

`ORG_HEADER_REQUIRED` poistettiin. v0.1:ssä organisaatio on aina `'local'`, eikä otsikkoa vaadita.
