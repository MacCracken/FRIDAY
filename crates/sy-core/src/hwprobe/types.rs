//! Shared types for accelerator detection.
//!
//! These mirror the TypeScript types in `packages/core/src/ai/accelerator/types.ts`.

use serde::{Deserialize, Serialize};

/// A detected hardware accelerator device.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceleratorDevice {
    pub index: u32,
    pub name: String,
    pub vendor: String,
    pub family: String,
    /// Total device memory in MB (VRAM for GPUs, HBM for TPUs/ASICs).
    pub vram_total_mb: u64,
    pub vram_used_mb: u64,
    pub vram_free_mb: u64,
    pub utilization_percent: u32,
    pub temperature_celsius: Option<i32>,
    pub driver_version: String,
    pub compute_capability: Option<String>,
    pub cuda_available: bool,
    pub rocm_available: bool,
    pub tpu_available: bool,
}

impl AcceleratorDevice {
    /// Create a device with reasonable defaults — caller fills in specifics.
    pub fn new(name: &str, vendor: &str, family: &str) -> Self {
        Self {
            index: 0,
            name: name.to_string(),
            vendor: vendor.to_string(),
            family: family.to_string(),
            vram_total_mb: 0,
            vram_used_mb: 0,
            vram_free_mb: 0,
            utilization_percent: 0,
            temperature_celsius: None,
            driver_version: "unknown".to_string(),
            compute_capability: None,
            cuda_available: false,
            rocm_available: false,
            tpu_available: false,
        }
    }
}
