# ADR 0004: Offline-first, replikointi ja kellot

- Tila: hyväksytty v0.1:n osalta; LAN-replikointi on v0.2
- Päivä: 2026-10-14

## Tausta

Kisapaikalla ei ole verkkoa. Myöhemmin lähtö- ja maalikone sekä väliaikapuhelin toimivat kukin offline ja yhdistävät lokit jälkikäteen.

## Päätös

v0.1 ei tarvitse verkkoa. Selain kirjoittaa painalluksen IndexedDB-jonoon ennen POST-pyyntöä. Service worker välimuistittaa käyttöliittymän eikä koske `/api`- tai `/ws`-polkuihin.

Siirtotapa v0.1:ssä on tiedosto `.ertx` (zip: `manifest.json` + `data.json`, `format_version` 1). WebSocket `proto=1` lähettää tapahtumat `timing_event.created`, `correction.created`, `results.updated` ja `device.status` samalla koneella. `sync/push` ja `sync/pull` sekä kellojen ajautumiskorjaus tulevat v0.2:ssa. Viestin muoto on sama tiedostossa, HTTP:ssä ja WebSocketissa.

Tunnisteet ovat ULID- tai asiakkaan antamia tunnisteita. Kellot: `device_time_ms`, valinnainen `monotonic_ms`, `seq_no` ja HLC muokattavissa riveissä.

## Seuraukset

- E2E ei käytä `context.setOffline(true)`, koska Chromium estää sillä myös localhostin. Testi katkaisee muun kuin loopback-liikenteen.
- Kahden koneen kelloero ja ristiriidat (`SYNC_CONFLICT`) jäävät v0.2:een. Koodi on varattu.
