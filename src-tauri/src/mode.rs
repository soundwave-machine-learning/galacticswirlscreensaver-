//! Windows screen saver command-line conventions.
//!
//! Windows launches a `.scr` with one of:
//!   `/s`              run the screen saver full screen
//!   `/p <HWND>`       render a preview inside the given window
//!   `/c` or `/c:<HWND>` show the configuration dialog (owned by HWND)
//!   (no arguments)    configuration, when invoked as a `.scr` file
//! Switches are case-insensitive, may use `-` instead of `/`, and the
//! HWND may follow a colon or be the next argument. `/a` (legacy
//! password change, Windows 9x) is accepted and ignored.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// Interactive app (Start Menu shortcut / the .exe).
    App,
    /// `/s` - full screen, exits on any input.
    Screensaver,
    /// `/p <HWND>` - live preview inside the Screen Saver Settings dialog.
    Preview(isize),
    /// `/c[:HWND]` - settings window.
    Config(Option<isize>),
    /// Recognised but intentionally a no-op (e.g. `/a`).
    Exit,
}

fn parse_hwnd(s: &str) -> Option<isize> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    // Windows passes the handle in decimal; accept 0x-prefixed hex too.
    if let Some(hex) = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")) {
        return isize::from_str_radix(hex, 16).ok().filter(|v| *v != 0);
    }
    s.parse::<i64>().ok().map(|v| v as isize).filter(|v| *v != 0)
}

pub fn parse<I, S>(args: I, invoked_as_scr: bool) -> Mode
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let args: Vec<String> = args.into_iter().map(|a| a.as_ref().to_string()).collect();
    let Some(first) = args.first() else {
        return if invoked_as_scr { Mode::Config(None) } else { Mode::App };
    };

    let trimmed = first.trim();
    let body = trimmed.trim_start_matches(['/', '-']);
    if body.len() == trimmed.len() {
        // Not a switch at all: behave like a double-click.
        return if invoked_as_scr { Mode::Config(None) } else { Mode::App };
    }
    let mut chars = body.chars();
    let switch = chars.next().map(|c| c.to_ascii_lowercase());
    let rest: String = chars.collect();
    let inline = rest.trim_start_matches(':');
    let value = if !inline.trim().is_empty() {
        parse_hwnd(inline)
    } else {
        args.get(1).and_then(|a| parse_hwnd(a))
    };

    match switch {
        Some('s') => Mode::Screensaver,
        Some('p') => match value {
            Some(hwnd) => Mode::Preview(hwnd),
            // A preview without a parent window has nowhere to draw.
            None => Mode::Exit,
        },
        Some('c') => Mode::Config(value),
        Some('a') => Mode::Exit,
        _ => {
            if invoked_as_scr {
                Mode::Config(None)
            } else {
                Mode::App
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_args() {
        assert_eq!(parse(Vec::<String>::new(), false), Mode::App);
        assert_eq!(parse(Vec::<String>::new(), true), Mode::Config(None));
    }

    #[test]
    fn fullscreen() {
        for a in ["/s", "/S", "-s", "-S", "/s:", " /s"] {
            assert_eq!(parse([a], true), Mode::Screensaver, "{a}");
        }
    }

    #[test]
    fn preview() {
        assert_eq!(parse(["/p", "1234"], true), Mode::Preview(1234));
        assert_eq!(parse(["/P:5678"], true), Mode::Preview(5678));
        assert_eq!(parse(["-p", "0x1A"], true), Mode::Preview(26));
        assert_eq!(parse(["/p"], true), Mode::Exit);
        assert_eq!(parse(["/p", "0"], true), Mode::Exit);
        assert_eq!(parse(["/p", "abc"], true), Mode::Exit);
    }

    #[test]
    fn config() {
        assert_eq!(parse(["/c"], true), Mode::Config(None));
        assert_eq!(parse(["/C:3344"], true), Mode::Config(Some(3344)));
        assert_eq!(parse(["/c", "77"], true), Mode::Config(Some(77)));
    }

    #[test]
    fn other() {
        assert_eq!(parse(["/a", "123"], true), Mode::Exit);
        assert_eq!(parse(["/x"], false), Mode::App);
        assert_eq!(parse(["/x"], true), Mode::Config(None));
        assert_eq!(parse(["somefile.txt"], true), Mode::Config(None));
    }
}
