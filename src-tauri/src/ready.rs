//! Parse the one stdout line the Node sidecar prints when it is listening.

/// Loopback URL and data paths from a valid `ERT_READY` line.
#[derive(Debug, PartialEq, Eq)]
pub struct ReadyInfo {
    pub url: String,
    pub data_dir: String,
    pub db_path: String,
}

/// Accept a single `ERT_READY {json}` line whose `url` is `http://127.0.0.1:<port>`.
///
/// The same rules are covered by `packages/server/src/ready-line.ts`.
pub fn parse_ready_line(line: &str) -> Option<ReadyInfo> {
    let json = line.trim().strip_prefix("ERT_READY ")?.trim();
    if json.is_empty() {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(json).ok()?;
    let url = value.get("url")?.as_str()?;
    let data_dir = value.get("dataDir")?.as_str()?;
    let db_path = value.get("dbPath")?.as_str()?;
    if data_dir.is_empty() || db_path.is_empty() {
        return None;
    }
    Some(ReadyInfo {
        url: loopback_url(url)?,
        data_dir: data_dir.to_string(),
        db_path: db_path.to_string(),
    })
}

/// `http://127.0.0.1:<port>` with an optional trailing slash. No other host, path, or scheme.
fn loopback_url(raw: &str) -> Option<String> {
    let value = raw.trim();
    let rest = value.strip_prefix("http://127.0.0.1:")?;
    let (digits, tail) = match rest.find(|character: char| !character.is_ascii_digit()) {
        Some(index) => (&rest[..index], &rest[index..]),
        None => (rest, ""),
    };
    if digits.is_empty() || digits.len() > 5 || (digits.len() > 1 && digits.starts_with('0')) {
        return None;
    }
    if !(tail.is_empty() || tail == "/") {
        return None;
    }
    let port: u16 = digits.parse().ok()?;
    if port == 0 {
        return None;
    }
    Some(format!("http://127.0.0.1:{port}{tail}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(url: &str) -> String {
        format!(r#"ERT_READY {{"url":"{url}","dataDir":"/data","dbPath":"/data/ert.sqlite"}}"#)
    }

    #[test]
    fn parses_a_loopback_ready_line() {
        let ready = parse_ready_line(&line("http://127.0.0.1:43123")).expect("ready");
        assert_eq!(ready.url, "http://127.0.0.1:43123");
        assert_eq!(ready.data_dir, "/data");
        assert_eq!(ready.db_path, "/data/ert.sqlite");
        assert_eq!(
            parse_ready_line(&format!("  {}  ", line("http://127.0.0.1:1/")))
                .expect("slash")
                .url,
            "http://127.0.0.1:1/"
        );
    }

    #[test]
    fn rejects_missing_malformed_and_non_loopback_lines() {
        assert!(parse_ready_line("").is_none());
        assert!(parse_ready_line("listening on 8080").is_none());
        assert!(parse_ready_line("ERT_READY").is_none());
        assert!(parse_ready_line("ERT_READY ").is_none());
        assert!(parse_ready_line("ERT_READY {").is_none());
        assert!(parse_ready_line(r#"ERT_READY {"url":"http://127.0.0.1:1"}"#).is_none());
        assert!(parse_ready_line(
            r#"ERT_READY {"url":"http://127.0.0.1:1","dataDir":"","dbPath":"/tmp/ert.sqlite"}"#
        )
        .is_none());
        assert!(parse_ready_line(&format!("prefix {}", line("http://127.0.0.1:1"))).is_none());
        for url in [
            "http://localhost:8080",
            "http://0.0.0.0:8080",
            "https://127.0.0.1:8080",
            "http://127.0.0.1:0",
            "http://127.0.0.1:080",
            "http://127.0.0.1:8080/api",
            "http://127.0.0.1:8080?x=1",
            "http://user@127.0.0.1:8080",
        ] {
            assert!(parse_ready_line(&line(url)).is_none(), "{url}");
        }
    }
}
