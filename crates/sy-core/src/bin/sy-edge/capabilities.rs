//! Hardware capability detection for edge nodes.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EdgeCapabilities {
    pub node_id: String,
    pub hostname: String,
    pub arch: String,
    pub platform: String,
    pub total_memory_mb: u64,
    pub cpu_cores: usize,
    pub has_gpu: bool,
    pub has_tpu: bool,
    pub has_accelerator: bool,
    pub tags: Vec<String>,
}

pub fn detect() -> EdgeCapabilities {
    let hostname = gethostname::gethostname().to_string_lossy().to_string();
    let arch = std::env::consts::ARCH.to_string();
    let platform = std::env::consts::OS.to_string();

    let sys = sysinfo::System::new_all();
    let total_memory_mb = sys.total_memory() / (1024 * 1024);
    let cpu_cores = sys.cpus().len();

    let has_gpu = detect_gpu();
    let has_tpu = detect_tpu();
    let has_npu = detect_npu();
    let has_accelerator = has_gpu || has_tpu || has_npu;

    let node_id = generate_node_id(&hostname);

    let mut tags = Vec::new();
    match arch.as_str() {
        "aarch64" => tags.push("arm64".into()),
        "x86_64" => tags.push("x64".into()),
        "riscv64" => tags.push("riscv64".into()),
        _ => {}
    }
    if has_gpu {
        tags.push("gpu".into());
    }
    if has_tpu {
        tags.push("tpu".into());
    }
    if has_npu {
        tags.push("npu".into());
    }
    if total_memory_mb > 4096 {
        tags.push("high-memory".into());
    }
    if cpu_cores >= 4 {
        tags.push("multi-core".into());
    }
    if let Ok(custom) = std::env::var("SECUREYEOMAN_EDGE_TAGS") {
        for tag in custom.split(',') {
            let t = tag.trim();
            if !t.is_empty() {
                tags.push(t.to_string());
            }
        }
    }

    EdgeCapabilities {
        node_id,
        hostname,
        arch,
        platform,
        total_memory_mb,
        cpu_cores,
        has_gpu,
        has_tpu,
        has_accelerator,
        tags,
    }
}

fn generate_node_id(hostname: &str) -> String {
    // Stable ID from hostname + first non-loopback MAC
    let mac = get_mac_address().unwrap_or_default();
    let input = format!("{hostname}:{mac}");
    let hash = Sha256::digest(input.as_bytes());
    hex::encode(&hash[..8])
}

fn get_mac_address() -> Option<String> {
    // Read from /sys/class/net/*/address
    let net_dir = fs::read_dir("/sys/class/net").ok()?;
    for entry in net_dir.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str == "lo" {
            continue;
        }
        let addr_path = entry.path().join("address");
        if let Ok(mac) = fs::read_to_string(&addr_path) {
            let mac = mac.trim();
            if mac != "00:00:00:00:00:00" && !mac.is_empty() {
                return Some(mac.to_string());
            }
        }
    }
    None
}

fn detect_gpu() -> bool {
    std::path::Path::new("/dev/nvidia0").exists()
        || std::path::Path::new("/dev/dri/renderD128").exists()
}

fn detect_tpu() -> bool {
    let accel_dir = std::path::Path::new("/sys/class/accel");
    if !accel_dir.exists() {
        return false;
    }
    if let Ok(entries) = fs::read_dir(accel_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            if !name.to_string_lossy().starts_with("accel") {
                continue;
            }
            // Exclude AMD XDNA
            let driver = entry.path().join("device/driver");
            if let Ok(target) = fs::read_link(&driver)
                && target.to_string_lossy().contains("amdxdna")
            {
                continue;
            }
            return true;
        }
    }
    false
}

fn detect_npu() -> bool {
    if std::path::Path::new("/sys/class/misc/intel_npu").exists() {
        return true;
    }
    let accel_dir = std::path::Path::new("/sys/class/accel");
    if let Ok(entries) = fs::read_dir(accel_dir) {
        for entry in entries.flatten() {
            let driver = entry.path().join("device/driver");
            if let Ok(target) = fs::read_link(&driver)
                && target.to_string_lossy().contains("amdxdna")
            {
                return true;
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_returns_valid_capabilities() {
        let caps = detect();
        assert!(!caps.node_id.is_empty());
        assert!(!caps.hostname.is_empty());
        assert!(!caps.arch.is_empty());
        assert!(!caps.platform.is_empty());
        assert!(caps.total_memory_mb > 0);
        assert!(caps.cpu_cores > 0);
    }

    #[test]
    fn node_id_is_deterministic() {
        let id1 = detect().node_id;
        let id2 = detect().node_id;
        assert_eq!(id1, id2);
    }

    #[test]
    fn node_id_is_hex() {
        let id = detect().node_id;
        assert!(id.len() == 16);
        assert!(id.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn tags_include_architecture() {
        let caps = detect();
        let has_arch_tag = caps
            .tags
            .iter()
            .any(|t| t == "x64" || t == "arm64" || t == "riscv64");
        assert!(
            has_arch_tag,
            "Tags should include architecture: {:?}",
            caps.tags
        );
    }

    #[test]
    fn capabilities_serialization() {
        let caps = detect();
        let json = serde_json::to_string(&caps).unwrap();
        assert!(json.contains("nodeId"));
        assert!(json.contains("hostname"));
        assert!(json.contains("totalMemoryMb"));

        let parsed: EdgeCapabilities = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.node_id, caps.node_id);
        assert_eq!(parsed.hostname, caps.hostname);
    }

    #[test]
    fn custom_tags_from_env() {
        unsafe { std::env::set_var("SECUREYEOMAN_EDGE_TAGS", "custom-tag,another-tag") };
        let caps = detect();
        assert!(caps.tags.contains(&"custom-tag".to_string()));
        assert!(caps.tags.contains(&"another-tag".to_string()));
        unsafe { std::env::remove_var("SECUREYEOMAN_EDGE_TAGS") };
    }

    #[test]
    fn gpu_detection_is_bool() {
        // Just verify it doesn't panic
        let _ = detect_gpu();
    }

    #[test]
    fn tpu_detection_is_bool() {
        let _ = detect_tpu();
    }

    #[test]
    fn npu_detection_is_bool() {
        let _ = detect_npu();
    }

    #[test]
    fn hex_encode_works() {
        assert_eq!(hex::encode(&[0x00, 0xFF, 0xAB]), "00ffab");
        assert_eq!(hex::encode(&[]), "");
    }
}

/// Hex encoding helper (avoids pulling in hex crate for just this).
mod hex {
    pub fn encode(bytes: &[u8]) -> String {
        let mut s = String::with_capacity(bytes.len() * 2);
        for &b in bytes {
            s.push_str(&format!("{b:02x}"));
        }
        s
    }
}
