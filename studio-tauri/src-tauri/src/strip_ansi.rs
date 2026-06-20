// Strip ANSI escape sequences (CSI + OSC + simple color codes) from a string.
pub fn strip_ansi(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if b == 0x1B {
            i += 1;
            if i >= bytes.len() { break; }
            match bytes[i] {
                b'[' => {
                    i += 1;
                    while i < bytes.len() {
                        let c = bytes[i];
                        if (0x40..=0x7E).contains(&c) { i += 1; break; }
                        i += 1;
                    }
                }
                b']' => {
                    i += 1;
                    while i < bytes.len() {
                        let c = bytes[i];
                        if c == 0x07 { i += 1; break; }
                        if c == 0x1B && i + 1 < bytes.len() && bytes[i + 1] == b'\\' { i += 2; break; }
                        i += 1;
                    }
                }
                _ => { i += 1; }
            }
            continue;
        }
        if b == b'\r' { i += 1; continue; }
        out.push(b as char);
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strips_csi_color() {
        let s = strip_ansi("\u{1b}[32mhello\u{1b}[39m world");
        assert_eq!(s, "hello world");
    }
    #[test]
    fn strips_osc_and_crlf() {
        let s = strip_ansi("\u{1b}]0;title\u{7}ok\r\nnext");
        assert_eq!(s, "ok\nnext");
    }
}
