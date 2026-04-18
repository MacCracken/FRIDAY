//! SecureYeoman Hardware Accelerator Detection
//!
//! Thin wrapper around [`ai_hwaccel`] that converts its type system to the
//! SY `AcceleratorDevice` format (camelCase JSON for the dashboard API).
//!
//! All detection is delegated to ai-hwaccel. This crate exists to:
//! 1. Convert `AcceleratorProfile` → `AcceleratorDevice` (camelCase JSON for TS)
//! 2. Provide family-filtered probing (`probe_family`)
//! 3. Re-export ai-hwaccel for direct use by sy-edge and desktop crates

pub mod types;

pub use ai_hwaccel;

use ai_hwaccel::{AcceleratorFamily, AcceleratorProfile, AcceleratorRegistry, AcceleratorType};
use types::AcceleratorDevice;

/// Run all hardware probes via ai-hwaccel. Returns SY-format device list.
pub fn probe_all() -> Vec<AcceleratorDevice> {
    let registry = AcceleratorRegistry::detect();
    let mut devices: Vec<AcceleratorDevice> = registry
        .available()
        .iter()
        .filter(|p| p.accelerator.family() != AcceleratorFamily::Cpu)
        .enumerate()
        .map(|(i, p)| profile_to_device(p, i as u32))
        .collect();

    // Re-index sequentially
    for (i, dev) in devices.iter_mut().enumerate() {
        dev.index = i as u32;
    }
    devices
}

/// Probe only devices matching a specific family.
pub fn probe_family(family: &str) -> Vec<AcceleratorDevice> {
    let af = match family {
        "gpu" => AcceleratorFamily::Gpu,
        "tpu" => AcceleratorFamily::Tpu,
        "npu" => AcceleratorFamily::Npu,
        "ai_asic" => AcceleratorFamily::AiAsic,
        _ => return Vec::new(),
    };

    let registry = AcceleratorRegistry::detect();
    let mut devices: Vec<AcceleratorDevice> = registry
        .by_family(af)
        .iter()
        .filter(|p| p.available)
        .enumerate()
        .map(|(i, p)| profile_to_device(p, i as u32))
        .collect();

    for (i, dev) in devices.iter_mut().enumerate() {
        dev.index = i as u32;
    }
    devices
}

/// Get the full ai-hwaccel registry for advanced queries (quantization, sharding).
pub fn detect_registry() -> AcceleratorRegistry {
    AcceleratorRegistry::detect()
}

/// Convert an ai-hwaccel `AcceleratorProfile` to an SY `AcceleratorDevice`.
fn profile_to_device(profile: &AcceleratorProfile, index: u32) -> AcceleratorDevice {
    let mem_mb = profile.memory_bytes / (1024 * 1024);
    let _family = profile.accelerator.family();

    let (vendor, family_str, name, cuda, rocm, tpu) = match &profile.accelerator {
        AcceleratorType::CudaGpu { device_id } => (
            "nvidia",
            "gpu",
            format!("NVIDIA CUDA GPU {device_id}"),
            true,
            false,
            false,
        ),
        AcceleratorType::RocmGpu { device_id } => (
            "amd",
            "gpu",
            format!("AMD ROCm GPU {device_id}"),
            false,
            true,
            false,
        ),
        AcceleratorType::MetalGpu => (
            "apple",
            "gpu",
            "Apple Metal GPU".to_string(),
            false,
            false,
            false,
        ),
        AcceleratorType::VulkanGpu { device_id } => (
            "vulkan",
            "gpu",
            format!("Vulkan GPU {device_id}"),
            false,
            false,
            false,
        ),
        AcceleratorType::IntelNpu => ("intel", "npu", "Intel NPU".to_string(), false, false, false),
        AcceleratorType::AmdXdnaNpu { device_id } => (
            "amd",
            "npu",
            format!("AMD XDNA NPU {device_id}"),
            false,
            false,
            false,
        ),
        AcceleratorType::AppleNpu => (
            "apple",
            "npu",
            "Apple Neural Engine".to_string(),
            false,
            false,
            false,
        ),
        AcceleratorType::Tpu {
            version,
            chip_count,
            ..
        } => (
            "google",
            "tpu",
            format!("Google TPU {version} ({chip_count} chips)"),
            false,
            false,
            true,
        ),
        AcceleratorType::Gaudi { generation, .. } => (
            "habana",
            "ai_asic",
            format!("Intel {generation}"),
            false,
            false,
            false,
        ),
        AcceleratorType::AwsNeuron {
            chip_type,
            core_count,
            ..
        } => (
            "aws",
            "ai_asic",
            format!("AWS {chip_type} ({core_count} cores)"),
            false,
            false,
            false,
        ),
        AcceleratorType::QualcommAi100 { .. } => (
            "qualcomm",
            "ai_asic",
            "Qualcomm Cloud AI 100".to_string(),
            false,
            false,
            false,
        ),
        AcceleratorType::IntelOneApi { device_id } => (
            "intel",
            "gpu",
            format!("Intel oneAPI GPU {device_id}"),
            false,
            false,
            false,
        ),
        AcceleratorType::CerebrasWse { device_id } => (
            "cerebras",
            "ai_asic",
            format!("Cerebras WSE {device_id}"),
            false,
            false,
            false,
        ),
        AcceleratorType::GraphcoreIpu { device_id } => (
            "graphcore",
            "ai_asic",
            format!("Graphcore IPU {device_id}"),
            false,
            false,
            false,
        ),
        AcceleratorType::GroqLpu { device_id } => (
            "groq",
            "ai_asic",
            format!("Groq LPU {device_id}"),
            false,
            false,
            false,
        ),
        AcceleratorType::SamsungNpu { device_id } => (
            "samsung",
            "npu",
            format!("Samsung NPU {device_id}"),
            false,
            false,
            false,
        ),
        AcceleratorType::MediaTekApu { device_id } => (
            "mediatek",
            "npu",
            format!("MediaTek APU {device_id}"),
            false,
            false,
            false,
        ),
        AcceleratorType::Cpu => ("cpu", "cpu", "CPU".to_string(), false, false, false),
        _ => (
            "unknown",
            "gpu",
            format!("{:?}", profile.accelerator),
            false,
            false,
            false,
        ),
    };

    AcceleratorDevice {
        index,
        name,
        vendor: vendor.to_string(),
        family: family_str.to_string(),
        vram_total_mb: mem_mb,
        vram_used_mb: 0,
        vram_free_mb: mem_mb,
        utilization_percent: 0,
        temperature_celsius: None,
        driver_version: profile
            .driver_version
            .clone()
            .unwrap_or_else(|| "unknown".to_string()),
        compute_capability: profile.compute_capability.clone(),
        cuda_available: cuda,
        rocm_available: rocm,
        tpu_available: tpu,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probe_all_does_not_panic() {
        let devices = probe_all();
        for dev in &devices {
            assert!(!dev.name.is_empty());
            assert!(!dev.vendor.is_empty());
            assert!(!dev.family.is_empty());
        }
    }

    #[test]
    fn probe_family_gpu() {
        let _ = probe_family("gpu");
    }

    #[test]
    fn probe_family_unknown_returns_empty() {
        assert!(probe_family("quantum").is_empty());
    }

    #[test]
    fn probe_all_devices_indexed_sequentially() {
        let devices = probe_all();
        for (i, dev) in devices.iter().enumerate() {
            assert_eq!(
                dev.index, i as u32,
                "Device at position {i} has wrong index"
            );
        }
    }

    #[test]
    fn probe_family_tpu() {
        let _ = probe_family("tpu");
    }

    #[test]
    fn probe_family_npu() {
        let _ = probe_family("npu");
    }

    #[test]
    fn probe_family_ai_asic() {
        let _ = probe_family("ai_asic");
    }

    #[test]
    fn accelerator_device_new_defaults() {
        let dev = types::AcceleratorDevice::new("Test GPU", "nvidia", "gpu");
        assert_eq!(dev.name, "Test GPU");
        assert_eq!(dev.vendor, "nvidia");
        assert_eq!(dev.family, "gpu");
        assert_eq!(dev.index, 0);
        assert_eq!(dev.vram_total_mb, 0);
        assert!(!dev.cuda_available);
    }

    #[test]
    fn accelerator_device_serialization() {
        let dev = types::AcceleratorDevice::new("RTX 4090", "nvidia", "gpu");
        let json = serde_json::to_string(&dev).unwrap();
        assert!(json.contains("\"name\":\"RTX 4090\""));
        assert!(json.contains("vramTotalMb"));
        assert!(json.contains("cudaAvailable"));
        let parsed: types::AcceleratorDevice = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.name, "RTX 4090");
    }

    #[test]
    fn detect_registry_works() {
        let registry = detect_registry();
        // CPU always present
        assert!(!registry.all_profiles().is_empty());
    }

    #[test]
    fn profile_to_device_cuda() {
        let profile = AcceleratorProfile::cuda(0, 24 * 1024 * 1024 * 1024);
        let dev = profile_to_device(&profile, 0);
        assert_eq!(dev.vendor, "nvidia");
        assert_eq!(dev.family, "gpu");
        assert!(dev.cuda_available);
        assert!(!dev.rocm_available);
        assert_eq!(dev.vram_total_mb, 24 * 1024);
    }

    #[test]
    fn profile_to_device_tpu() {
        use ai_hwaccel::TpuVersion;
        let profile = AcceleratorProfile::tpu(0, 4, TpuVersion::V5p);
        let dev = profile_to_device(&profile, 0);
        assert_eq!(dev.vendor, "google");
        assert_eq!(dev.family, "tpu");
        assert!(dev.tpu_available);
        assert!(dev.name.contains("v5p"));
    }

    #[test]
    fn profile_to_device_gaudi() {
        use ai_hwaccel::GaudiGeneration;
        let profile = AcceleratorProfile::gaudi(0, GaudiGeneration::Gaudi3);
        let dev = profile_to_device(&profile, 0);
        assert_eq!(dev.vendor, "habana");
        assert_eq!(dev.family, "ai_asic");
        assert!(dev.name.contains("Gaudi3"));
    }
}
