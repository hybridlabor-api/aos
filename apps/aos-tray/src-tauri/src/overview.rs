//! Small parsers for the Home status cards that the other state modules do not cover.

/// `aos-gogate status` prints lines like `AOS go-gate, session <id>: mode off`. Returns the mode
/// word (letters and dashes only) of the first such line, or None when the output has no mode.
pub fn parse_gogate_mode(text: &str) -> Option<String> {
    for line in text.lines() {
        if let Some(i) = line.find("mode ") {
            let word: String = line[i + 5..].trim_start().chars().take_while(|c| c.is_ascii_alphabetic() || *c == '-').collect();
            if !word.is_empty() {
                return Some(word.to_ascii_lowercase());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_mode_word() {
        assert_eq!(parse_gogate_mode("AOS go-gate, session abc123: mode off\n").as_deref(), Some("off"));
        assert_eq!(parse_gogate_mode("x\nAOS go-gate: mode HARD (grants: none)").as_deref(), Some("hard"));
        assert_eq!(parse_gogate_mode("mode soft-ish; more").as_deref(), Some("soft-ish"));
    }

    #[test]
    fn no_mode_means_none() {
        assert_eq!(parse_gogate_mode(""), None);
        assert_eq!(parse_gogate_mode("nothing here"), None);
        assert_eq!(parse_gogate_mode("mode 123"), None);
    }
}
