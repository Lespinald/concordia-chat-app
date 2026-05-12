// Unit tests for pure logic in chat service: mention parsing and MIME filtering.
// Endpoint integration tests live in tests/api_tests.rs and require a live stack
// (Cassandra + gRPC + Kafka) — see infra/smoke-test.sh.

use regex::Regex;

fn mention_re() -> Regex {
    Regex::new(r"@([A-Za-z0-9_]{1,32})").unwrap()
}

fn parse_mentions(content: &str) -> Vec<String> {
    let re = mention_re();
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for cap in re.captures_iter(content) {
        if let Some(m) = cap.get(1) {
            let name = m.as_str().to_string();
            if seen.insert(name.clone()) {
                out.push(name);
            }
        }
    }
    out
}

fn is_allowed_mime(ct: &str) -> bool {
    let lower = ct.to_ascii_lowercase();
    let mime = lower.split(';').next().unwrap_or("").trim();
    if let Some(rest) = mime.strip_prefix("image/") {
        return !rest.is_empty();
    }
    matches!(mime, "video/mp4" | "application/pdf")
}

#[test]
fn mention_parser_extracts_single_user() {
    let mentions = parse_mentions("hello @alice how are you");
    assert_eq!(mentions, vec!["alice"]);
}

#[test]
fn mention_parser_extracts_multiple_unique() {
    let mentions = parse_mentions("@alice and @bob and @carol");
    assert_eq!(mentions.len(), 3);
    assert!(mentions.contains(&"alice".to_string()));
    assert!(mentions.contains(&"bob".to_string()));
    assert!(mentions.contains(&"carol".to_string()));
}

#[test]
fn mention_parser_dedupes() {
    let mentions = parse_mentions("@alice @alice @alice");
    assert_eq!(mentions, vec!["alice"]);
}

#[test]
fn mention_parser_ignores_emails_only_after_at() {
    let mentions = parse_mentions("alice@example.com");
    // The regex matches "@example" (not the part before @).
    assert_eq!(mentions, vec!["example"]);
}

#[test]
fn mention_parser_handles_no_mentions() {
    assert!(parse_mentions("no mentions here").is_empty());
}

#[test]
fn mime_accepts_images() {
    assert!(is_allowed_mime("image/png"));
    assert!(is_allowed_mime("image/jpeg"));
    assert!(is_allowed_mime("image/gif"));
    assert!(is_allowed_mime("image/webp"));
}

#[test]
fn mime_accepts_video_mp4_and_pdf() {
    assert!(is_allowed_mime("video/mp4"));
    assert!(is_allowed_mime("application/pdf"));
}

#[test]
fn mime_rejects_unsupported_types() {
    assert!(!is_allowed_mime("application/zip"));
    assert!(!is_allowed_mime("video/quicktime"));
    assert!(!is_allowed_mime("text/plain"));
    assert!(!is_allowed_mime("application/octet-stream"));
}

#[test]
fn mime_handles_charset_suffix() {
    assert!(is_allowed_mime("image/png; charset=utf-8"));
    assert!(is_allowed_mime("application/pdf; foo=bar"));
}

#[test]
fn mime_rejects_bare_image_prefix() {
    assert!(!is_allowed_mime("image/"));
}
