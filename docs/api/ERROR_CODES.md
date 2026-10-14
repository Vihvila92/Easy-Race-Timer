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
| `LOCK_BLOCKED` | 409 | Lukitus estyy. `details.blockers` luettelee syyt (`entry:<lappu>:no_result`, `tie:<matka>:<näyttöaika>`). |
| `PIN_REQUIRED` | 401 | PIN puuttuu tai on väärä. |
| `NO_MATCHING_CATEGORY` | 422 | Ikä ja sukupuoli eivät sovi millekään kohdematkan sarjalle. |
| `TIE_UNCONFIRMED` | 409 | Tasatulosta ei ole vahvistettu. |
| `CLUB_ABBREVIATION_TAKEN` | 409 | Aktiivisella seuralla on jo tämä lyhenne. |
| `CLUB_ABBREVIATION_CONFLICT` | 409 | Lyhenne osuu seuraan, jonka nimi ei täsmää. |
| `SYNC_CONFLICT` | 409 | Varattu v0.2:n ristiriidalle. |

`ORG_HEADER_REQUIRED` poistettiin. v0.1:ssä organisaatio on aina `'local'`, eikä otsikkoa vaadita.
