//! Parse the one stdout line the Node sidecar prints when it is listening.

/// Loopback URL and data paths from a valid `ERT_READY` line.
///
/// `auth_code` is redacted in `Debug` output. Do not log `ReadyInfo`.
#[derive(PartialEq, Eq)]
pub struct ReadyInfo {
    pub url: String,
    pub data_dir: String,
    pub db_path: String,
    pub auth_code: String,
}

impl std::fmt::Debug for ReadyInfo {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ReadyInfo")
            .field("url", &self.url)
            .field("data_dir", &self.data_dir)
            .field("db_path", &self.db_path)
            .field("auth_code", &"[redacted]")
            .finish()
    }
}

/// Accept a single `ERT_READY {json}` line whose `url` is `http://127.0.0.1:<port>`.
///
/// The shell requires a 64-character lowercase hex `authCode`. The TypeScript
/// parser also accepts a developer line that omits it.
pub fn parse_ready_line(line: &str) -> Option<ReadyInfo> {
    let json = line.trim().strip_prefix("ERT_READY ")?.trim();
    if json.is_empty() {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(json).ok()?;
    let url = value.get("url")?.as_str()?;
    let data_dir = value.get("dataDir")?.as_str()?;
    let db_path = value.get("dbPath")?.as_str()?;
    let auth_code = value.get("authCode")?.as_str()?;
    if data_dir.is_empty() || db_path.is_empty() || !auth_code_ok(auth_code) {
        return None;
    }
    Some(ReadyInfo {
        url: loopback_url(url)?,
        data_dir: data_dir.to_string(),
        db_path: db_path.to_string(),
        auth_code: auth_code.to_string(),
    })
}

fn auth_code_ok(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

/// One-time navigation target. The launch token itself is not in this URL.
pub fn launch_navigation_url(ready: &ReadyInfo) -> String {
    format!(
        "{}/auth?code={}",
        ready.url.trim_end_matches('/'),
        ready.auth_code
    )
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

    const CODE: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    fn line(url: &str) -> String {
        format!(
            r#"ERT_READY {{"url":"{url}","dataDir":"/data","dbPath":"/data/ert.sqlite","authCode":"{CODE}"}}"#
        )
    }

    #[test]
    fn parses_a_loopback_ready_line() {
        let ready = parse_ready_line(&line("http://127.0.0.1:43123")).expect("ready");
        assert_eq!(ready.url, "http://127.0.0.1:43123");
        assert_eq!(ready.data_dir, "/data");
        assert_eq!(ready.db_path, "/data/ert.sqlite");
        assert_eq!(ready.auth_code, CODE);
        assert_eq!(
            parse_ready_line(&format!("  {}  ", line("http://127.0.0.1:1/")))
                .expect("slash")
                .url,
            "http://127.0.0.1:1/"
        );
        assert_eq!(
            launch_navigation_url(&ready),
            format!("http://127.0.0.1:43123/auth?code={CODE}")
        );
        assert!(!format!("{ready:?}").contains(CODE));
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
            r#"ERT_READY {"url":"http://127.0.0.1:1","dataDir":"/data","dbPath":"/data/ert.sqlite"}"#
        )
        .is_none());
        assert!(parse_ready_line(
            r#"ERT_READY {"url":"http://127.0.0.1:1","dataDir":"/data","dbPath":"/data/ert.sqlite","authCode":"ABCD"}"#
        )
        .is_none());
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
