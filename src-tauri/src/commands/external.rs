use tauri::{AppHandle, Url};
use tauri_plugin_opener::OpenerExt;

fn parse_external_url(value: &str) -> Result<Url, &'static str> {
    if value.len() > 8192 || value.chars().any(char::is_control) {
        return Err("This link is not a valid web address.");
    }
    let url = Url::parse(value).map_err(|_| "This link is not a valid web address.")?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Only HTTP and HTTPS links can open in your browser.");
    }
    Ok(url)
}

#[tauri::command]
pub(crate) fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    let url = parse_external_url(&url).map_err(str::to_owned)?;
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|_| "Your default browser could not open this link.".into())
}

fn is_app_origin(url: &Url) -> bool {
    let production = url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && ((url.scheme() == "https" && url.host_str() == Some("tauri.localhost"))
            || (url.scheme() == "tauri" && url.host_str() == Some("localhost")));
    if production {
        return true;
    }
    cfg!(debug_assertions)
        && url.scheme() == "http"
        && matches!(url.host_str(), Some("localhost" | "127.0.0.1"))
        && url.port() == Some(5182)
        && url.username().is_empty()
        && url.password().is_none()
}

pub(crate) fn is_app_navigation(url: &Url) -> bool {
    url.path() == "/desktop.html" && is_app_origin(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_links_cannot_launch_files_or_other_protocol_handlers() {
        for value in [
            "file:///C:/secret.md",
            "javascript:alert(1)",
            "data:text/html,hi",
            "cmd:calc",
            "mailto:a@example.com",
            "https://name:secret@example.com",
            "https://example.com/\nfoo",
        ] {
            assert!(
                parse_external_url(value).is_err(),
                "unexpected accepted scheme"
            );
        }
        assert_eq!(
            parse_external_url("https://example.com/a?q=1#two")
                .unwrap()
                .as_str(),
            "https://example.com/a?q=1#two"
        );
        assert!(parse_external_url("http://example.com").is_ok());
    }

    #[test]
    fn navigation_cannot_replace_the_app_with_an_external_or_lookalike_origin() {
        for value in [
            "https://example.com/desktop.html",
            "https://tauri.localhost.evil.example/desktop.html",
            "https://tauri.localhost:9000/desktop.html",
            "https://user@tauri.localhost/desktop.html",
            "file:///C:/desktop.html",
            "https://tauri.localhost/assets/app.js",
        ] {
            assert!(!is_app_navigation(&Url::parse(value).unwrap()));
        }
        assert!(is_app_navigation(
            &Url::parse("https://tauri.localhost/desktop.html#section").unwrap()
        ));
    }
}
