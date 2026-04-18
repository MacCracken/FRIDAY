//! cgroup v2 detection and resource limit helpers.

use std::fs;
use std::path::Path;

/// Check if cgroup v2 (unified hierarchy) is active.
pub fn is_v2() -> bool {
    if let Ok(mounts) = fs::read_to_string("/proc/mounts") {
        return parse_mounts_for_cgroup2(&mounts);
    }
    // Fallback: check for cgroup.controllers file (only present in v2)
    Path::new("/sys/fs/cgroup/cgroup.controllers").exists()
}

/// Parse /proc/mounts content for cgroup2 presence.
pub fn parse_mounts_for_cgroup2(mounts: &str) -> bool {
    mounts
        .lines()
        .any(|line| line.contains("cgroup2") && line.contains("/sys/fs/cgroup"))
}

/// Read the current memory limit for this process's cgroup (bytes).
pub fn memory_limit() -> Option<u64> {
    fs::read_to_string("/sys/fs/cgroup/memory.max")
        .ok()
        .and_then(|s| parse_memory_max(&s))
}

/// Parse memory.max content. Returns None for "max" (unlimited).
pub fn parse_memory_max(content: &str) -> Option<u64> {
    let trimmed = content.trim();
    if trimmed == "max" {
        None
    } else {
        trimmed.parse().ok()
    }
}

/// Read current memory usage for this process's cgroup (bytes).
pub fn memory_current() -> Option<u64> {
    fs::read_to_string("/sys/fs/cgroup/memory.current")
        .ok()
        .and_then(|s| s.trim().parse().ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_mounts_with_cgroup2() {
        let mounts = "cgroup2 /sys/fs/cgroup cgroup2 rw,nosuid,nodev,noexec,relatime 0 0\n\
                       proc /proc proc rw,nosuid 0 0\n";
        assert!(parse_mounts_for_cgroup2(mounts));
    }

    #[test]
    fn parse_mounts_without_cgroup2() {
        let mounts = "tmpfs /sys/fs/cgroup tmpfs rw 0 0\n\
                       cgroup /sys/fs/cgroup/memory cgroup rw,memory 0 0\n";
        assert!(!parse_mounts_for_cgroup2(mounts));
    }

    #[test]
    fn parse_mounts_empty() {
        assert!(!parse_mounts_for_cgroup2(""));
    }

    #[test]
    fn parse_memory_max_unlimited() {
        assert_eq!(parse_memory_max("max\n"), None);
        assert_eq!(parse_memory_max("max"), None);
    }

    #[test]
    fn parse_memory_max_limited() {
        assert_eq!(parse_memory_max("1073741824\n"), Some(1_073_741_824));
        assert_eq!(parse_memory_max("536870912"), Some(536_870_912));
    }

    #[test]
    fn parse_memory_max_invalid() {
        assert_eq!(parse_memory_max("not_a_number"), None);
        assert_eq!(parse_memory_max(""), None);
    }

    #[test]
    fn is_v2_does_not_panic() {
        let _ = is_v2();
    }

    #[test]
    fn memory_limit_does_not_panic() {
        let _ = memory_limit();
    }

    #[test]
    fn memory_current_does_not_panic() {
        let _ = memory_current();
    }
}
