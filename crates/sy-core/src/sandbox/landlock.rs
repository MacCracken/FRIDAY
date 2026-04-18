//! Landlock detection and ABI version probing (Linux 5.13+).

use std::fs;
use std::path::Path;

/// Check if Landlock is available on this kernel.
pub fn is_available() -> bool {
    Path::new("/proc/sys/kernel/landlock_restrict_self").exists() || kernel_supports_landlock()
}

/// Get the Landlock ABI version (0 if unavailable).
pub fn abi_version() -> u32 {
    // Try reading the restrict_self proc entry
    if let Ok(content) = fs::read_to_string("/proc/sys/kernel/landlock_restrict_self")
        && let Some(v) = parse_abi_from_proc(&content)
    {
        return v;
    }

    // Fallback: check kernel version >= 5.13
    if kernel_supports_landlock() {
        1 // ABI v1 minimum
    } else {
        0
    }
}

/// Parse ABI version from /proc/sys/kernel/landlock_restrict_self content.
/// Returns Some(version) if > 0, None otherwise.
pub fn parse_abi_from_proc(content: &str) -> Option<u32> {
    let val: u32 = content.trim().parse().ok()?;
    if val > 0 { Some(val) } else { None }
}

/// Parse kernel version string and check if >= 5.13.
pub fn kernel_version_supports_landlock(release: &str) -> bool {
    let parts: Vec<u32> = release
        .trim()
        .split('.')
        .take(2)
        .filter_map(|s| s.split('-').next().and_then(|n| n.parse().ok()))
        .collect();

    if parts.len() >= 2 {
        (parts[0] > 5) || (parts[0] == 5 && parts[1] >= 13)
    } else {
        false
    }
}

fn kernel_supports_landlock() -> bool {
    if let Ok(release) = fs::read_to_string("/proc/sys/kernel/osrelease") {
        return kernel_version_supports_landlock(&release);
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_abi_valid() {
        assert_eq!(parse_abi_from_proc("1\n"), Some(1));
        assert_eq!(parse_abi_from_proc("3"), Some(3));
        assert_eq!(parse_abi_from_proc("  4  "), Some(4));
    }

    #[test]
    fn parse_abi_zero() {
        assert_eq!(parse_abi_from_proc("0"), None);
        assert_eq!(parse_abi_from_proc("0\n"), None);
    }

    #[test]
    fn parse_abi_invalid() {
        assert_eq!(parse_abi_from_proc(""), None);
        assert_eq!(parse_abi_from_proc("abc"), None);
    }

    #[test]
    fn kernel_version_boundary() {
        assert!(!kernel_version_supports_landlock("5.12.0"));
        assert!(kernel_version_supports_landlock("5.13.0"));
        assert!(kernel_version_supports_landlock("5.14.0"));
        assert!(kernel_version_supports_landlock("6.0.0"));
    }

    #[test]
    fn kernel_version_with_suffix() {
        assert!(kernel_version_supports_landlock("6.12.71-1-lts"));
        assert!(kernel_version_supports_landlock("5.15.0-generic"));
        assert!(!kernel_version_supports_landlock("4.19.0-amd64"));
    }

    #[test]
    fn kernel_version_edge_cases() {
        assert!(!kernel_version_supports_landlock(""));
        assert!(!kernel_version_supports_landlock("invalid"));
        assert!(!kernel_version_supports_landlock("5"));
    }

    #[test]
    fn is_available_does_not_panic() {
        let _ = is_available();
    }

    #[test]
    fn abi_version_does_not_panic() {
        let _ = abi_version();
    }
}
