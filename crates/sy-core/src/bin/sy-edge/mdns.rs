//! mDNS service advertisement — advertises `_secureyeoman._tcp`.
//!
//! Note: Full mDNS requires the `mdns-sd` crate. This is a stub that logs
//! the intent — full implementation will use `mdns-sd` in a future iteration.

use crate::capabilities::EdgeCapabilities;

pub fn advertise(caps: &EdgeCapabilities, port: u16) {
    tracing::info!(
        node_id = %caps.node_id,
        port,
        service = "_secureyeoman._tcp",
        "mDNS advertisement started (stub)"
    );
    // TODO: Use mdns-sd crate for actual mDNS advertisement
    // let service = ServiceDaemon::new()?;
    // service.register("_secureyeoman._tcp.local.", &caps.hostname, port, &[
    //     &format!("nodeId={}", caps.node_id),
    //     &format!("arch={}", caps.arch),
    //     "mode=edge",
    // ])?;
}
