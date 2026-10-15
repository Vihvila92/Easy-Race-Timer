# Synkronointiprotokolla v1

Versio kättelyssä: WebSocket-kysely `proto=1`, tiedostossa `manifest.format_version = 1`. Eri versio hylätään, sitä ei tulkita hiljaa.

v0.1 siirtää dataa vain `.ertx`-tiedostona ja paikallisena WebSocket-ilmoituksena. `POST /api/v1/sync/push` ja `GET /api/v1/sync/pull` tulevat v0.2:ssa samalla viestimuodolla.

## WebSocket

`GET /ws` (protokolla 1). Palvelin lähettää heti:

```json
{ "type": "device.status", "payload": { "proto": 1 } }
```

Muut tyypit:

| type | Milloin |
|---|---|
| `timing_event.created` | Maalipainallus tallentui |
| `correction.created` | Korjaus, yhdistäminen tai palautus |
| `results.updated` | Tulokset vanhenivat |
| `sync.conflict` | Varattu v0.2:lle |

## Maalitapahtuma

Asiakas luo tunnisteen ja ajan ennen lähetystä.

```json
{
  "id": "F031",
  "timeMs": 1781250000000,
  "bib": 127,
  "mode": "time_first",
  "deviceId": "lappari"
}
```

Palvelin tallentaa:

- `device_time_ms` sellaisenaan
- `seq_no` laitekohtaisesti kasvavana
- `time_ms` samaan aikajärjestelmään muunnettuna (v0.1:ssä sama kello)

Sama `id` on idempotentti. `(device_id, seq_no)` on yksilöllinen. Mitättömäksi merkitseminen ei poista riviä.

`mode` on `time_first` (aika ensin, lappu myöhemmin) tai `bib_first`.

## Korjaus

Korjaus on oma rivi: `target_type`, `target_id`, `action`, `old_value_json`, `new_value_json`, `reason`, `by_device_id`, `hlc`, `created_at`. Toimintoja ovat muun muassa `change_bib`, `set_status`, `assign_bib`, `void`, `restore`, `copy_time`, `confirm_tie`, `merge_clubs`, `lock`.

Muokattavissa domain-riveissä on `rev` ja HLC. HLC on laitteen looginen kello: seinäkello ja kasvava laskuri. Sitä käytetään myöhemmin rinnakkaisten muokkausten järjestämiseen.

## `.ertx`

Zip-paketti:

- `manifest.json`: `{ "format_version": 1, "app_version": "0.1.0", "schema_version": 1 }`
- `data.json`: taulujen rivit (`event`, `race`, `category`, `person`, `club`, `club_alias`, `consent`, `entry`, `timing_point`, `device`, `timing_event`, `correction`, `tie_resolution`, `schema_meta`)

Tuonti korvaa sallittujen taulujen sisällön vasta vahvistuksen jälkeen. `format_version` on 1, `schema_version` on enintään sovelluksen skeema, ja `app_version` on pakollinen. Tuntematon taulu tai sarake hylkää koko tuonnin. `pin_hash` ei kulje arkistossa eikä korvaa paikallista PINiä. Purku sallii vain `manifest.json` ja `data.json`, yhteensä enintään 50 MiB.

HTTP: `GET /api/v1/sync/export` palauttaa zipin. `POST /api/v1/sync/import` ottaa `{ "base64": "..." }`. Ilman `confirm: true` vastaus on esikatselu eikä kirjoita. Vahvistettu tuonti tekee ensin varmuuskopion ja kirjaa auditiin `import_ertx`.

## Mitä v0.2 lisää

Sama tapahtuma- ja korjausrunko kulkee LAN-WebSocketissa ja myöhemmin pilvessä. Kellojen näyte (`clockSample`) korjaa ajautumisen. Ristiriita palautetaan koodilla `SYNC_CONFLICT`, eikä kumpaakaan kirjoitusta pudoteta hiljaa.
