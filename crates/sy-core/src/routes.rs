//! Route handlers — organized by domain.
//!
//! Each domain module (auth, brain, soul, etc.) will get its own submodule
//! as routes are migrated from TypeScript.

pub mod a2a;
pub mod agents;
pub mod alerts;
pub mod analytics;
pub mod audit;
pub mod auth;
pub mod backup;
pub mod brain;
pub mod chat;
pub mod edge;
pub mod event_bridge;
pub mod execution;
pub mod experiments;
pub mod extensions;
pub mod federation;
pub mod forge;
pub mod gateway;
pub mod github;
pub mod gmail;
pub mod google_calendar;
pub mod health;
pub mod ifran_proxy;
pub mod integrations;
pub mod jira;
pub mod linear;
pub mod marketplace;
pub mod mcp;
pub mod models;
pub mod notifications;
pub mod notion;
pub mod photisnadi;
pub mod proactive;
pub mod risk;
pub mod sandbox;
pub mod security;
pub mod soul;
pub mod spirit;
pub mod tasks;
pub mod tenants;
pub mod todoist;
pub mod trading;
pub mod training;
pub mod twitter;
pub mod workflow;
pub mod workspace;
pub mod ws_collab;
pub mod ws_metrics;
pub mod ws_video;

pub mod chaos;
pub mod dashboards;
pub mod desktop;
pub mod group_chat;
pub mod intent;
pub mod license;
pub mod observability;
pub mod outbound_webhooks;
pub mod provider_accounts;
pub mod responsible_ai;
pub mod risk_assessment;
pub mod scim;
pub mod shruti;
pub mod simulation;
pub mod webhook_transforms;

pub mod browser;
pub mod diagnostics;
pub mod ecosystem;
pub mod editor;
pub mod events;
pub mod personalities;
pub mod replay_jobs;
pub mod routing_rules;
pub mod terminal;
pub mod users;
pub mod voice;

pub mod admin_settings;

pub mod agent_replay;
pub mod autonomy;
pub mod capture;
pub mod comms;
pub mod compliance;
pub mod reports;
pub mod video_stream;
