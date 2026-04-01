/**
 * Simulation Store — PostgreSQL persistence for tick configs, mood state, and mood events.
 */

import { PgBaseStorage } from '../storage/pg-base.js';
import type {
  TickConfig,
  MoodState,
  MoodEvent,
  EntityLocation,
  SpatialZone,
  ProximityRule,
  ProximityEvent,
  EntityRelationship,
  RelationshipEvent,
  EntityGroup,
} from '@secureyeoman/shared';

function rowToTickConfig(row: Record<string, unknown>): TickConfig {
  return {
    id: row.id as string,
    personalityId: row.personality_id as string,
    mode: row.mode as TickConfig['mode'],
    tickIntervalMs: Number(row.tick_interval_ms ?? 1000),
    timeScale: Number(row.time_scale ?? 1.0),
    paused: (row.paused as boolean) ?? false,
    currentTick: Number(row.current_tick ?? 0),
    simTimeEpoch: Number(row.sim_time_epoch ?? 0),
    lastTickAt: row.last_tick_at != null ? Number(row.last_tick_at) : null,
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  };
}

function rowToMoodState(row: Record<string, unknown>): MoodState {
  return {
    id: row.id as string,
    personalityId: row.personality_id as string,
    valence: Number(row.valence ?? 0),
    arousal: Number(row.arousal ?? 0),
    dominance: Number(row.dominance ?? 0.5),
    label: (row.label as MoodState['label']) ?? 'neutral',
    decayRate: Number(row.decay_rate ?? 0.05),
    baselineValence: Number(row.baseline_valence ?? 0),
    baselineArousal: Number(row.baseline_arousal ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  };
}

function rowToMoodEvent(row: Record<string, unknown>): MoodEvent {
  return {
    id: row.id as string,
    personalityId: row.personality_id as string,
    eventType: row.event_type as string,
    valenceDelta: Number(row.valence_delta ?? 0),
    arousalDelta: Number(row.arousal_delta ?? 0),
    source: (row.source as string) ?? 'system',
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: Number(row.created_at ?? 0),
  };
}

function rowToEntityLocation(row: Record<string, unknown>): EntityLocation {
  return {
    id: row.id as string,
    personalityId: row.personality_id as string,
    entityId: row.entity_id as string,
    entityType: row.entity_type as string,
    zoneId: (row.zone_id as string) ?? '',
    x: Number(row.x ?? 0),
    y: Number(row.y ?? 0),
    z: Number(row.z ?? 0),
    heading: Number(row.heading ?? 0),
    speed: Number(row.speed ?? 0),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    updatedAt: Number(row.updated_at ?? 0),
  };
}

function rowToSpatialZone(row: Record<string, unknown>): SpatialZone {
  return {
    id: row.id as string,
    personalityId: row.personality_id as string,
    zoneId: row.zone_id as string,
    name: row.name as string,
    minX: Number(row.min_x ?? 0),
    minY: Number(row.min_y ?? 0),
    maxX: Number(row.max_x ?? 0),
    maxY: Number(row.max_y ?? 0),
    properties: (row.properties as Record<string, unknown>) ?? {},
    createdAt: Number(row.created_at ?? 0),
  };
}

function rowToProximityRule(row: Record<string, unknown>): ProximityRule {
  return {
    id: row.id as string,
    personalityId: row.personality_id as string,
    triggerType: row.trigger_type as ProximityRule['triggerType'],
    sourceEntityId: (row.source_entity_id as string) ?? null,
    targetEntityId: (row.target_entity_id as string) ?? null,
    targetZoneId: (row.target_zone_id as string) ?? null,
    radiusThreshold: Number(row.radius_threshold ?? 0),
    cooldownMs: Number(row.cooldown_ms ?? 0),
    moodEffect: (row.mood_effect as ProximityRule['moodEffect']) ?? null,
    enabled: (row.enabled as boolean) ?? true,
    createdAt: Number(row.created_at ?? 0),
  };
}

function rowToEntityRelationship(row: Record<string, unknown>): EntityRelationship {
  return {
    id: row.id as string,
    personalityId: row.personality_id as string,
    sourceEntityId: row.source_entity_id as string,
    targetEntityId: row.target_entity_id as string,
    type: (row.type as EntityRelationship['type']) ?? 'neutral',
    affinity: Number(row.affinity ?? 0),
    trust: Number(row.trust ?? 0.5),
    interactionCount: Number(row.interaction_count ?? 0),
    decayRate: Number(row.decay_rate ?? 0.01),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  };
}

function rowToRelationshipEvent(row: Record<string, unknown>): RelationshipEvent {
  return {
    id: row.id as string,
    personalityId: row.personality_id as string,
    sourceEntityId: row.source_entity_id as string,
    targetEntityId: row.target_entity_id as string,
    eventType: row.event_type as string,
    affinityDelta: Number(row.affinity_delta ?? 0),
    trustDelta: Number(row.trust_delta ?? 0),
    source: (row.source as string) ?? 'system',
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: Number(row.created_at ?? 0),
  };
}

function rowToEntityGroup(row: Record<string, unknown>): EntityGroup {
  return {
    id: row.id as string,
    personalityId: row.personality_id as string,
    groupId: row.group_id as string,
    name: row.name as string,
    members: (row.members as string[]) ?? [],
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: Number(row.created_at ?? 0),
  };
}

function rowToProximityEvent(row: Record<string, unknown>): ProximityEvent {
  return {
    id: row.id as string,
    personalityId: row.personality_id as string,
    ruleId: (row.rule_id as string) ?? null,
    triggerType: row.trigger_type as ProximityEvent['triggerType'],
    sourceEntityId: row.source_entity_id as string,
    targetEntityId: (row.target_entity_id as string) ?? null,
    targetZoneId: (row.target_zone_id as string) ?? null,
    distance: Number(row.distance ?? 0),
    tick: Number(row.tick ?? 0),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: Number(row.created_at ?? 0),
  };
}

export class SimulationStore extends PgBaseStorage {
  // ── Tick Configs ──────────────────────────────────────────────────

  async saveTickConfig(config: TickConfig): Promise<void> {
    await this.execute(
      `INSERT INTO simulation.tick_configs (
        id, personality_id, mode, tick_interval_ms, time_scale,
        paused, current_tick, sim_time_epoch, last_tick_at,
        created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (personality_id) DO UPDATE SET
        mode = EXCLUDED.mode,
        tick_interval_ms = EXCLUDED.tick_interval_ms,
        time_scale = EXCLUDED.time_scale,
        paused = EXCLUDED.paused,
        current_tick = EXCLUDED.current_tick,
        sim_time_epoch = EXCLUDED.sim_time_epoch,
        last_tick_at = EXCLUDED.last_tick_at,
        updated_at = EXCLUDED.updated_at`,
      [
        config.id,
        config.personalityId,
        config.mode,
        config.tickIntervalMs,
        config.timeScale,
        config.paused,
        config.currentTick,
        config.simTimeEpoch,
        config.lastTickAt,
        config.createdAt,
        config.updatedAt,
      ]
    );
  }

  async getTickConfig(personalityId: string): Promise<TickConfig | null> {
    const row = await this.queryOne(
      'SELECT * FROM simulation.tick_configs WHERE personality_id = $1',
      [personalityId]
    );
    return row ? rowToTickConfig(row) : null;
  }

  async updateTickState(personalityId: string, tick: number, simTime: number): Promise<void> {
    await this.execute(
      `UPDATE simulation.tick_configs
       SET current_tick = $1, sim_time_epoch = $2, last_tick_at = $3, updated_at = $3
       WHERE personality_id = $4`,
      [tick, simTime, Date.now(), personalityId]
    );
  }

  async deleteTickConfig(personalityId: string): Promise<boolean> {
    const count = await this.execute(
      'DELETE FROM simulation.tick_configs WHERE personality_id = $1',
      [personalityId]
    );
    return count > 0;
  }

  // ── Mood State ────────────────────────────────────────────────────

  async upsertMoodState(state: MoodState): Promise<void> {
    await this.execute(
      `INSERT INTO simulation.mood_states (
        id, personality_id, valence, arousal, dominance,
        label, decay_rate, baseline_valence, baseline_arousal, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (personality_id) DO UPDATE SET
        valence = EXCLUDED.valence,
        arousal = EXCLUDED.arousal,
        dominance = EXCLUDED.dominance,
        label = EXCLUDED.label,
        decay_rate = EXCLUDED.decay_rate,
        baseline_valence = EXCLUDED.baseline_valence,
        baseline_arousal = EXCLUDED.baseline_arousal,
        updated_at = EXCLUDED.updated_at`,
      [
        state.id,
        state.personalityId,
        state.valence,
        state.arousal,
        state.dominance,
        state.label,
        state.decayRate,
        state.baselineValence,
        state.baselineArousal,
        state.updatedAt,
      ]
    );
  }

  async getMoodState(personalityId: string): Promise<MoodState | null> {
    const row = await this.queryOne(
      'SELECT * FROM simulation.mood_states WHERE personality_id = $1',
      [personalityId]
    );
    return row ? rowToMoodState(row) : null;
  }

  async updateMoodValues(
    personalityId: string,
    valence: number,
    arousal: number,
    label: string
  ): Promise<void> {
    await this.execute(
      `UPDATE simulation.mood_states
       SET valence = $1, arousal = $2, label = $3, updated_at = $4
       WHERE personality_id = $5`,
      [valence, arousal, label, Date.now(), personalityId]
    );
  }

  // ── Composite State (bhava 2.0 signal loop) ──────────────────────

  async upsertCompositeState(
    personalityId: string,
    stateJson: string,
    stressJson: string | null,
    energyJson: string | null,
    flowJson: string | null,
    circadianJson: string | null
  ): Promise<void> {
    await this.execute(
      `INSERT INTO simulation.composite_states (
        personality_id, state_json, stress_json, energy_json,
        flow_json, circadian_json, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (personality_id) DO UPDATE SET
        state_json = EXCLUDED.state_json,
        stress_json = EXCLUDED.stress_json,
        energy_json = EXCLUDED.energy_json,
        flow_json = EXCLUDED.flow_json,
        circadian_json = EXCLUDED.circadian_json,
        updated_at = EXCLUDED.updated_at`,
      [personalityId, stateJson, stressJson, energyJson, flowJson, circadianJson, Date.now()]
    );
  }

  async getCompositeState(personalityId: string): Promise<{
    stateJson: string;
    stressJson: string | null;
    energyJson: string | null;
    flowJson: string | null;
    circadianJson: string | null;
  } | null> {
    const row = await this.queryOne(
      'SELECT * FROM simulation.composite_states WHERE personality_id = $1',
      [personalityId]
    );
    if (!row) return null;
    return {
      stateJson: row.state_json as string,
      stressJson: (row.stress_json as string) ?? null,
      energyJson: (row.energy_json as string) ?? null,
      flowJson: (row.flow_json as string) ?? null,
      circadianJson: (row.circadian_json as string) ?? null,
    };
  }

  // ── Mood Events ───────────────────────────────────────────────────

  async recordMoodEvent(event: MoodEvent): Promise<void> {
    await this.execute(
      `INSERT INTO simulation.mood_events (
        id, personality_id, event_type, valence_delta, arousal_delta,
        source, metadata, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        event.id,
        event.personalityId,
        event.eventType,
        event.valenceDelta,
        event.arousalDelta,
        event.source,
        JSON.stringify(event.metadata),
        event.createdAt,
      ]
    );
  }

  async listMoodEvents(
    personalityId: string,
    opts: { limit?: number; since?: number } = {}
  ): Promise<MoodEvent[]> {
    const limit = Math.min(opts.limit ?? 50, 200);
    if (opts.since) {
      const rows = await this.queryMany(
        `SELECT * FROM simulation.mood_events
         WHERE personality_id = $1 AND created_at >= $2
         ORDER BY created_at DESC LIMIT $3`,
        [personalityId, opts.since, limit]
      );
      return rows.map(rowToMoodEvent);
    }
    const rows = await this.queryMany(
      `SELECT * FROM simulation.mood_events
       WHERE personality_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [personalityId, limit]
    );
    return rows.map(rowToMoodEvent);
  }

  // ── Entity Locations ──────────────────────────────────────────────

  async upsertEntityLocation(loc: EntityLocation): Promise<void> {
    await this.execute(
      `INSERT INTO simulation.entity_locations (
        id, personality_id, entity_id, entity_type, zone_id,
        x, y, z, heading, speed, metadata, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (personality_id, entity_id) DO UPDATE SET
        entity_type = EXCLUDED.entity_type,
        zone_id = EXCLUDED.zone_id,
        x = EXCLUDED.x, y = EXCLUDED.y, z = EXCLUDED.z,
        heading = EXCLUDED.heading, speed = EXCLUDED.speed,
        metadata = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at`,
      [
        loc.id,
        loc.personalityId,
        loc.entityId,
        loc.entityType,
        loc.zoneId,
        loc.x,
        loc.y,
        loc.z,
        loc.heading,
        loc.speed,
        JSON.stringify(loc.metadata),
        loc.updatedAt,
      ]
    );
  }

  async getEntityLocation(personalityId: string, entityId: string): Promise<EntityLocation | null> {
    const row = await this.queryOne(
      'SELECT * FROM simulation.entity_locations WHERE personality_id = $1 AND entity_id = $2',
      [personalityId, entityId]
    );
    return row ? rowToEntityLocation(row) : null;
  }

  async listEntityLocations(
    personalityId: string,
    opts: { zoneId?: string; limit?: number } = {}
  ): Promise<EntityLocation[]> {
    const limit = Math.min(opts.limit ?? 200, 500);
    if (opts.zoneId) {
      const rows = await this.queryMany(
        `SELECT * FROM simulation.entity_locations
         WHERE personality_id = $1 AND zone_id = $2
         ORDER BY updated_at DESC LIMIT $3`,
        [personalityId, opts.zoneId, limit]
      );
      return rows.map(rowToEntityLocation);
    }
    const rows = await this.queryMany(
      `SELECT * FROM simulation.entity_locations
       WHERE personality_id = $1
       ORDER BY updated_at DESC LIMIT $2`,
      [personalityId, limit]
    );
    return rows.map(rowToEntityLocation);
  }

  async deleteEntityLocation(personalityId: string, entityId: string): Promise<boolean> {
    const count = await this.execute(
      'DELETE FROM simulation.entity_locations WHERE personality_id = $1 AND entity_id = $2',
      [personalityId, entityId]
    );
    return count > 0;
  }

  // ── Spatial Zones ─────────────────────────────────────────────────

  async upsertSpatialZone(zone: SpatialZone): Promise<void> {
    await this.execute(
      `INSERT INTO simulation.spatial_zones (
        id, personality_id, zone_id, name, min_x, min_y, max_x, max_y,
        properties, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (personality_id, zone_id) DO UPDATE SET
        name = EXCLUDED.name,
        min_x = EXCLUDED.min_x, min_y = EXCLUDED.min_y,
        max_x = EXCLUDED.max_x, max_y = EXCLUDED.max_y,
        properties = EXCLUDED.properties`,
      [
        zone.id,
        zone.personalityId,
        zone.zoneId,
        zone.name,
        zone.minX,
        zone.minY,
        zone.maxX,
        zone.maxY,
        JSON.stringify(zone.properties),
        zone.createdAt,
      ]
    );
  }

  async getSpatialZone(personalityId: string, zoneId: string): Promise<SpatialZone | null> {
    const row = await this.queryOne(
      'SELECT * FROM simulation.spatial_zones WHERE personality_id = $1 AND zone_id = $2',
      [personalityId, zoneId]
    );
    return row ? rowToSpatialZone(row) : null;
  }

  async listSpatialZones(personalityId: string): Promise<SpatialZone[]> {
    const rows = await this.queryMany(
      'SELECT * FROM simulation.spatial_zones WHERE personality_id = $1 ORDER BY created_at',
      [personalityId]
    );
    return rows.map(rowToSpatialZone);
  }

  async deleteSpatialZone(personalityId: string, zoneId: string): Promise<boolean> {
    const count = await this.execute(
      'DELETE FROM simulation.spatial_zones WHERE personality_id = $1 AND zone_id = $2',
      [personalityId, zoneId]
    );
    return count > 0;
  }

  // ── Proximity Rules ───────────────────────────────────────────────

  async saveProximityRule(rule: ProximityRule): Promise<void> {
    await this.execute(
      `INSERT INTO simulation.proximity_rules (
        id, personality_id, trigger_type, source_entity_id, target_entity_id,
        target_zone_id, radius_threshold, cooldown_ms, mood_effect, enabled, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (id) DO UPDATE SET
        trigger_type = EXCLUDED.trigger_type,
        source_entity_id = EXCLUDED.source_entity_id,
        target_entity_id = EXCLUDED.target_entity_id,
        target_zone_id = EXCLUDED.target_zone_id,
        radius_threshold = EXCLUDED.radius_threshold,
        cooldown_ms = EXCLUDED.cooldown_ms,
        mood_effect = EXCLUDED.mood_effect,
        enabled = EXCLUDED.enabled`,
      [
        rule.id,
        rule.personalityId,
        rule.triggerType,
        rule.sourceEntityId,
        rule.targetEntityId,
        rule.targetZoneId,
        rule.radiusThreshold,
        rule.cooldownMs,
        rule.moodEffect ? JSON.stringify(rule.moodEffect) : null,
        rule.enabled,
        rule.createdAt,
      ]
    );
  }

  async listProximityRules(
    personalityId: string,
    opts: { enabledOnly?: boolean } = {}
  ): Promise<ProximityRule[]> {
    const enabledFilter = opts.enabledOnly ? ' AND enabled = true' : '';
    const rows = await this.queryMany(
      `SELECT * FROM simulation.proximity_rules
       WHERE personality_id = $1${enabledFilter}
       ORDER BY created_at`,
      [personalityId]
    );
    return rows.map(rowToProximityRule);
  }

  async deleteProximityRule(id: string, personalityId?: string): Promise<boolean> {
    if (personalityId) {
      const count = await this.execute(
        'DELETE FROM simulation.proximity_rules WHERE id = $1 AND personality_id = $2',
        [id, personalityId]
      );
      return count > 0;
    }
    const count = await this.execute('DELETE FROM simulation.proximity_rules WHERE id = $1', [id]);
    return count > 0;
  }

  // ── Proximity Events ──────────────────────────────────────────────

  async recordProximityEvent(event: ProximityEvent): Promise<void> {
    await this.execute(
      `INSERT INTO simulation.proximity_events (
        id, personality_id, rule_id, trigger_type, source_entity_id,
        target_entity_id, target_zone_id, distance, tick, metadata, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        event.id,
        event.personalityId,
        event.ruleId,
        event.triggerType,
        event.sourceEntityId,
        event.targetEntityId,
        event.targetZoneId,
        event.distance,
        event.tick,
        JSON.stringify(event.metadata),
        event.createdAt,
      ]
    );
  }

  async listProximityEvents(
    personalityId: string,
    opts: { limit?: number; sinceTick?: number } = {}
  ): Promise<ProximityEvent[]> {
    const limit = Math.min(opts.limit ?? 50, 200);
    if (opts.sinceTick != null) {
      const rows = await this.queryMany(
        `SELECT * FROM simulation.proximity_events
         WHERE personality_id = $1 AND tick >= $2
         ORDER BY tick DESC, created_at DESC LIMIT $3`,
        [personalityId, opts.sinceTick, limit]
      );
      return rows.map(rowToProximityEvent);
    }
    const rows = await this.queryMany(
      `SELECT * FROM simulation.proximity_events
       WHERE personality_id = $1
       ORDER BY tick DESC, created_at DESC LIMIT $2`,
      [personalityId, limit]
    );
    return rows.map(rowToProximityEvent);
  }

  // ── Entity Relationships ────────────────────────────────────────────

  async upsertRelationship(rel: EntityRelationship): Promise<void> {
    await this.execute(
      `INSERT INTO simulation.entity_relationships (
        id, personality_id, source_entity_id, target_entity_id,
        type, affinity, trust, interaction_count, decay_rate,
        metadata, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (personality_id, source_entity_id, target_entity_id) DO UPDATE SET
        type = EXCLUDED.type,
        affinity = EXCLUDED.affinity,
        trust = EXCLUDED.trust,
        interaction_count = EXCLUDED.interaction_count,
        decay_rate = EXCLUDED.decay_rate,
        metadata = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at`,
      [
        rel.id,
        rel.personalityId,
        rel.sourceEntityId,
        rel.targetEntityId,
        rel.type,
        rel.affinity,
        rel.trust,
        rel.interactionCount,
        rel.decayRate,
        JSON.stringify(rel.metadata),
        rel.createdAt,
        rel.updatedAt,
      ]
    );
  }

  async getRelationship(
    personalityId: string,
    sourceEntityId: string,
    targetEntityId: string
  ): Promise<EntityRelationship | null> {
    const row = await this.queryOne(
      `SELECT * FROM simulation.entity_relationships
       WHERE personality_id = $1 AND source_entity_id = $2 AND target_entity_id = $3`,
      [personalityId, sourceEntityId, targetEntityId]
    );
    return row ? rowToEntityRelationship(row) : null;
  }

  async listRelationships(
    personalityId: string,
    opts: { entityId?: string; type?: string; minAffinity?: number; limit?: number } = {}
  ): Promise<EntityRelationship[]> {
    const limit = Math.min(opts.limit ?? 100, 500);
    const conditions: string[] = ['personality_id = $1'];
    const params: unknown[] = [personalityId];
    let idx = 2;

    if (opts.entityId) {
      conditions.push(`(source_entity_id = $${idx} OR target_entity_id = $${idx})`);
      params.push(opts.entityId);
      idx++;
    }
    if (opts.type) {
      conditions.push(`type = $${idx}`);
      params.push(opts.type);
      idx++;
    }
    if (opts.minAffinity != null) {
      conditions.push(`affinity >= $${idx}`);
      params.push(opts.minAffinity);
      idx++;
    }

    params.push(limit);
    const rows = await this.queryMany(
      `SELECT * FROM simulation.entity_relationships
       WHERE ${conditions.join(' AND ')}
       ORDER BY updated_at DESC LIMIT $${idx}`,
      params
    );
    return rows.map(rowToEntityRelationship);
  }

  async deleteRelationship(
    personalityId: string,
    sourceEntityId: string,
    targetEntityId: string
  ): Promise<boolean> {
    const count = await this.execute(
      `DELETE FROM simulation.entity_relationships
       WHERE personality_id = $1 AND source_entity_id = $2 AND target_entity_id = $3`,
      [personalityId, sourceEntityId, targetEntityId]
    );
    return count > 0;
  }

  async listAllRelationships(personalityId: string): Promise<EntityRelationship[]> {
    const rows = await this.queryMany(
      `SELECT * FROM simulation.entity_relationships WHERE personality_id = $1`,
      [personalityId]
    );
    return rows.map(rowToEntityRelationship);
  }

  // ── Relationship Events ─────────────────────────────────────────────

  async recordRelationshipEvent(event: RelationshipEvent): Promise<void> {
    await this.execute(
      `INSERT INTO simulation.relationship_events (
        id, personality_id, source_entity_id, target_entity_id,
        event_type, affinity_delta, trust_delta, source, metadata, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        event.id,
        event.personalityId,
        event.sourceEntityId,
        event.targetEntityId,
        event.eventType,
        event.affinityDelta,
        event.trustDelta,
        event.source,
        JSON.stringify(event.metadata),
        event.createdAt,
      ]
    );
  }

  async listRelationshipEvents(
    personalityId: string,
    opts: { entityId?: string; limit?: number; since?: number } = {}
  ): Promise<RelationshipEvent[]> {
    const limit = Math.min(opts.limit ?? 50, 200);
    const conditions: string[] = ['personality_id = $1'];
    const params: unknown[] = [personalityId];
    let idx = 2;

    if (opts.entityId) {
      conditions.push(`(source_entity_id = $${idx} OR target_entity_id = $${idx})`);
      params.push(opts.entityId);
      idx++;
    }
    if (opts.since != null) {
      conditions.push(`created_at >= $${idx}`);
      params.push(opts.since);
      idx++;
    }

    params.push(limit);
    const rows = await this.queryMany(
      `SELECT * FROM simulation.relationship_events
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC LIMIT $${idx}`,
      params
    );
    return rows.map(rowToRelationshipEvent);
  }

  // ── Entity Groups ──────────────────────────────────────────────────

  async upsertEntityGroup(group: EntityGroup): Promise<void> {
    await this.execute(
      `INSERT INTO simulation.entity_groups (
        id, personality_id, group_id, name, members, metadata, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (personality_id, group_id) DO UPDATE SET
        name = EXCLUDED.name,
        members = EXCLUDED.members,
        metadata = EXCLUDED.metadata`,
      [
        group.id,
        group.personalityId,
        group.groupId,
        group.name,
        group.members,
        JSON.stringify(group.metadata),
        group.createdAt,
      ]
    );
  }

  async listEntityGroups(personalityId: string): Promise<EntityGroup[]> {
    const rows = await this.queryMany(
      `SELECT * FROM simulation.entity_groups
       WHERE personality_id = $1
       ORDER BY created_at`,
      [personalityId]
    );
    return rows.map(rowToEntityGroup);
  }

  async getEntityGroup(personalityId: string, groupId: string): Promise<EntityGroup | null> {
    const row = await this.queryOne(
      `SELECT * FROM simulation.entity_groups
       WHERE personality_id = $1 AND group_id = $2`,
      [personalityId, groupId]
    );
    return row ? rowToEntityGroup(row) : null;
  }

  async deleteEntityGroup(personalityId: string, groupId: string): Promise<boolean> {
    const count = await this.execute(
      `DELETE FROM simulation.entity_groups
       WHERE personality_id = $1 AND group_id = $2`,
      [personalityId, groupId]
    );
    return count > 0;
  }
}
