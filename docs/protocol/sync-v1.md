# Synkronointiprotokolla v1

Versio kättelyssä: WebSocket-kysely `proto=1`, tiedostossa `manifest.format_version = 1`. Eri versio hylätään, sitä ei tulkita hiljaa.

v0.1 siirtää dataa vain `.ertx`-tiedostona ja paikallisena WebSocket-ilmoituksena. `POST /api/v1/sync/push` ja `GET /api/v1/sync/pull` tulevat v0.2:ssa samalla viestimuodolla.

## WebSocket

`GET /ws` (protocol 1). The handshake uses the same device token as the other protected routes (`Authorization: Bearer` or the `ert_session` cookie) and requires a loopback `Origin`. A missing or invalid token is rejected with 401. A missing or foreign `Origin` is rejected with 403, including when a valid token is sent.

After the handshake the server sends:

```json
{ "type": "device.status", "payload": { "proto": 1 } }
```

Other types are refresh notifications. The payload is an allowlist:

| type | payload | when |
|---|---|---|
| `timing_event.created` | `id`, plus `raceId` or `kind` (`start`) when known | A finish or a start was stored |
| `correction.created` | `action` | A correction was stored |
| `results.updated` | `raceId` when known | Results went stale |
| `sync.conflict` | | Reserved for v0.2 |

Names, bibs, entry ids, person ids, and correction reasons are not sent.

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

Tuonti korvaa sallittujen taulujen sisällön vasta vahvistuksen jälkeen. `format_version` on 1, `schema_version` on enintään sovelluksen skeema, ja `app_version` on pakollinen. Tuntematon taulu tai sarake hylkää koko tuonnin. `pin_hash` ei kulje arkistossa eikä korvaa paikallista PINiä. `entry.dsq_reason` on sisäinen kenttä eikä kuulu arkiston osallistujariveihin. Purku sallii vain `manifest.json` ja `data.json`, yhteensä enintään 50 MiB.

HTTP: `GET /api/v1/sync/export` palauttaa zipin. `POST /api/v1/sync/import` ottaa `{ "base64": "..." }`. Ilman `confirm: true` vastaus on esikatselu eikä kirjoita. Vahvistettu tuonti tekee ensin varmuuskopion ja kirjaa auditiin `import_ertx`.

## Mitä v0.2 lisää

v0.2:ssa sama tapahtuma- ja korjausrunko kulkee LAN-WebSocketissa ja myöhemmin pilvessä. v0.1:n `/ws` lähettää vain yllä rajatun ilmoituksen. Kellojen näyte (`clockSample`) korjaa ajautumisen. Ristiriita palautetaan koodilla `SYNC_CONFLICT`, eikä kumpaakaan kirjoitusta pudoteta hiljaa.
