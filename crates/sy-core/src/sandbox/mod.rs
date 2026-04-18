//! Sandbox enforcement — seccomp-bpf detection, cgroup v2, Landlock policy.
//!
//! Runs as subprocess for privilege isolation. Direct kernel interaction
//! via sysfs reads (no libseccomp dependency yet — planned for future with `libseccomp-sys`).

pub mod cgroup;
pub mod landlock;
pub mod seccomp;

use serde::{Deserialize, Serialize};

/// Overall sandbox capabilities detected on this system.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxCapabilities {
    pub seccomp_available: bool,
    pub seccomp_mode: String,
    pub landlock_available: bool,
    pub landlock_abi: u32,
    pub cgroup_v2: bool,
    pub namespaces_available: bool,
}

/// Detect all sandbox capabilities.
pub fn detect_capabilities() -> SandboxCapabilities {
    SandboxCapabilities {
        seccomp_available: seccomp::is_available(),
        seccomp_mode: seccomp::current_mode(),
        landlock_available: landlock::is_available(),
        landlock_abi: landlock::abi_version(),
        cgroup_v2: cgroup::is_v2(),
        namespaces_available: check_namespaces(),
    }
}

fn check_namespaces() -> bool {
    std::path::Path::new("/proc/self/ns/user").exists()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_does_not_panic() {
        let caps = detect_capabilities();
        assert!(!caps.seccomp_mode.is_empty());
    }

    #[test]
    fn capabilities_fields_populated() {
        let caps = detect_capabilities();
        // seccomp_mode should be one of known values
        assert!(
            ["disabled", "strict", "filter", "unsupported", "unknown"]
                .contains(&caps.seccomp_mode.as_str()),
            "Unexpected seccomp mode: {}",
            caps.seccomp_mode
        );
    }

    #[test]
    fn namespaces_detection() {
        let available = check_namespaces();
        // On Linux, /proc/self/ns/user should exist
        if cfg!(target_os = "linux") {
            assert!(available);
        }
    }

    #[test]
    fn seccomp_syscall_allowlist() {
        assert!(seccomp::is_syscall_allowed("read"));
        assert!(seccomp::is_syscall_allowed("write"));
        assert!(seccomp::is_syscall_allowed("open"));
        assert!(seccomp::is_syscall_allowed("mmap"));
        assert!(seccomp::is_syscall_allowed("futex"));
    }

    #[test]
    fn seccomp_syscall_blocklist() {
        assert!(!seccomp::is_syscall_allowed("ptrace"));
        assert!(!seccomp::is_syscall_allowed("mount"));
        assert!(!seccomp::is_syscall_allowed("reboot"));
        assert!(!seccomp::is_syscall_allowed("kexec_load"));
        assert!(!seccomp::is_syscall_allowed("sethostname"));
    }

    #[test]
    fn seccomp_unknown_syscall() {
        assert!(!seccomp::is_syscall_allowed("nonexistent_syscall"));
        assert!(!seccomp::is_syscall_allowed(""));
    }

    #[test]
    fn seccomp_lists_not_empty() {
        assert!(!seccomp::allowed_syscalls().is_empty());
        assert!(!seccomp::blocked_syscalls().is_empty());
        assert!(seccomp::allowed_syscalls().len() > 80);
        assert!(seccomp::blocked_syscalls().len() >= 14);
    }

    #[test]
    fn seccomp_no_overlap() {
        let allowed = seccomp::allowed_syscalls();
        let blocked = seccomp::blocked_syscalls();
        for b in blocked {
            assert!(
                !allowed.contains(b),
                "Syscall {b} is in both allowed and blocked lists"
            );
        }
    }

    #[test]
    fn seccomp_mode_detection() {
        let mode = seccomp::current_mode();
        assert!(!mode.is_empty());
        // Should return a valid mode string
        assert!(
            ["disabled", "strict", "filter", "unsupported", "unknown"].contains(&mode.as_str()),
        );
    }

    #[test]
    fn landlock_detection_does_not_panic() {
        let _ = landlock::is_available();
        let _ = landlock::abi_version();
    }

    #[test]
    fn cgroup_v2_detection() {
        let is_v2 = cgroup::is_v2();
        // Just verify it returns a bool without panicking
        let _ = is_v2;
    }

    #[test]
    fn cgroup_memory_reads() {
        // These may return None on non-cgroup systems, but shouldn't panic
        let _ = cgroup::memory_limit();
        let _ = cgroup::memory_current();
    }

    #[test]
    fn landlock_kernel_version_parsing() {
        assert!(landlock::kernel_version_supports_landlock("6.12.71-1-lts"));
        assert!(landlock::kernel_version_supports_landlock("5.13.0"));
        assert!(landlock::kernel_version_supports_landlock("5.15.0-generic"));
        assert!(landlock::kernel_version_supports_landlock("6.0.0"));
        assert!(!landlock::kernel_version_supports_landlock("5.12.0"));
        assert!(!landlock::kernel_version_supports_landlock("4.19.0"));
        assert!(!landlock::kernel_version_supports_landlock(""));
        assert!(!landlock::kernel_version_supports_landlock("invalid"));
    }

    #[test]
    fn capabilities_serialization() {
        let caps = detect_capabilities();
        let json = serde_json::to_string(&caps).unwrap();
        assert!(json.contains("seccomp_available"));
        assert!(json.contains("landlock_available"));
        assert!(json.contains("cgroup_v2"));
        let deserialized: SandboxCapabilities = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.seccomp_mode, caps.seccomp_mode);
    }
}
