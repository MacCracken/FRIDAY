//! seccomp-bpf detection and syscall policy.

use std::fs;

/// Allowed syscalls (matches TypeScript seccomp.ts — 87 entries).
const ALLOWED_SYSCALLS: &[&str] = &[
    "read",
    "write",
    "open",
    "close",
    "stat",
    "fstat",
    "lstat",
    "poll",
    "lseek",
    "mmap",
    "mprotect",
    "munmap",
    "brk",
    "ioctl",
    "access",
    "pipe",
    "select",
    "sched_yield",
    "mremap",
    "msync",
    "mincore",
    "madvise",
    "dup",
    "dup2",
    "pause",
    "nanosleep",
    "getpid",
    "sendfile",
    "socket",
    "connect",
    "accept",
    "sendto",
    "recvfrom",
    "sendmsg",
    "recvmsg",
    "shutdown",
    "bind",
    "listen",
    "getsockname",
    "getpeername",
    "setsockopt",
    "getsockopt",
    "clone",
    "fork",
    "vfork",
    "execve",
    "exit",
    "wait4",
    "uname",
    "fcntl",
    "flock",
    "fsync",
    "fdatasync",
    "truncate",
    "ftruncate",
    "getdents",
    "getcwd",
    "chdir",
    "rename",
    "mkdir",
    "rmdir",
    "link",
    "unlink",
    "symlink",
    "readlink",
    "chmod",
    "chown",
    "umask",
    "gettimeofday",
    "getrlimit",
    "getrusage",
    "sysinfo",
    "times",
    "getuid",
    "getgid",
    "geteuid",
    "getegid",
    "getppid",
    "getpgrp",
    "setsid",
    "setpgid",
    "sigaltstack",
    "rt_sigaction",
    "rt_sigprocmask",
    "rt_sigreturn",
    "clock_gettime",
    "clock_nanosleep",
    "exit_group",
    "epoll_create",
    "epoll_ctl",
    "epoll_wait",
    "futex",
    "set_tid_address",
];

/// Blocked syscalls (14 entries).
const BLOCKED_SYSCALLS: &[&str] = &[
    "ptrace",
    "mount",
    "umount2",
    "reboot",
    "kexec_load",
    "init_module",
    "delete_module",
    "pivot_root",
    "swapon",
    "swapoff",
    "acct",
    "settimeofday",
    "sethostname",
    "setdomainname",
];

/// Check if seccomp is available on this system.
pub fn is_available() -> bool {
    current_mode() != "unsupported"
}

/// Read the current seccomp mode from /proc/self/status.
pub fn current_mode() -> String {
    let status = match fs::read_to_string("/proc/self/status") {
        Ok(s) => s,
        Err(_) => return "unsupported".to_string(),
    };
    parse_seccomp_mode(&status)
}

/// Parse seccomp mode from /proc/self/status content.
pub fn parse_seccomp_mode(status_content: &str) -> String {
    for line in status_content.lines() {
        if let Some(val) = line.strip_prefix("Seccomp:") {
            return match val.trim() {
                "0" => "disabled".to_string(),
                "1" => "strict".to_string(),
                "2" => "filter".to_string(),
                _ => "unknown".to_string(),
            };
        }
    }
    "unsupported".to_string()
}

pub fn allowed_syscalls() -> &'static [&'static str] {
    ALLOWED_SYSCALLS
}

pub fn blocked_syscalls() -> &'static [&'static str] {
    BLOCKED_SYSCALLS
}

pub fn is_syscall_allowed(name: &str) -> bool {
    ALLOWED_SYSCALLS.contains(&name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_mode_disabled() {
        let status = "Name:\ttest\nSeccomp:\t0\nSeccomp_filters:\t0\n";
        assert_eq!(parse_seccomp_mode(status), "disabled");
    }

    #[test]
    fn parse_mode_strict() {
        let status = "Name:\ttest\nSeccomp:\t1\n";
        assert_eq!(parse_seccomp_mode(status), "strict");
    }

    #[test]
    fn parse_mode_filter() {
        let status = "Name:\ttest\nSeccomp:\t2\n";
        assert_eq!(parse_seccomp_mode(status), "filter");
    }

    #[test]
    fn parse_mode_unknown_value() {
        let status = "Seccomp:\t99\n";
        assert_eq!(parse_seccomp_mode(status), "unknown");
    }

    #[test]
    fn parse_mode_no_seccomp_line() {
        let status = "Name:\ttest\nPid:\t1234\n";
        assert_eq!(parse_seccomp_mode(status), "unsupported");
    }

    #[test]
    fn parse_mode_empty() {
        assert_eq!(parse_seccomp_mode(""), "unsupported");
    }
}
