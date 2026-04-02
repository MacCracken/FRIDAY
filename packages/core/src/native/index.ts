/**
 * Native Module Loader — native module disabled.
 *
 * Ecosystem crates (bhava, szal, bote, dhvani, agnosai, majra) are called
 * directly via their individual TS stub modules. The NativeModule interface
 * is retained for reference; native is always null.
 */

export interface NativeModule {
  // Hashing
  sha256(data: Buffer): string;
  md5(data: Buffer): string;

  // HMAC
  hmacSha256(data: Buffer, key: Buffer): string;

  // Comparison
  secureCompare(a: Buffer, b: Buffer): boolean;

  // AES-256-GCM
  aes256GcmEncrypt(plaintext: Buffer, key: Buffer, iv: Buffer): Buffer;
  aes256GcmDecrypt(ciphertext: Buffer, key: Buffer, iv: Buffer): Buffer;

  // X25519
  x25519Keypair(): { privateKey: Buffer; publicKey: Buffer };
  x25519DiffieHellman(privateKey: Buffer, publicKey: Buffer): Buffer;

  // Ed25519
  ed25519Keypair(): { privateKey: Buffer; publicKey: Buffer };
  ed25519Sign(data: Buffer, privateKey: Buffer): Buffer;
  ed25519Verify(data: Buffer, signature: Buffer, publicKey: Buffer): boolean;

  // HKDF
  hkdfSha256(ikm: Buffer, salt: Buffer, info: Buffer, length: number): Buffer;

  // Random
  randomBytes(length: number): Buffer;

  // Hardware probing
  probeAccelerators(): string;
  probeAcceleratorsByFamily(family: string): string;

  // DLP classification
  classifyText(text: string): string;
  classifyTextBatch(texts: string[]): string;

  // Privacy engine (stateful, with custom patterns)
  privacyEngineCreate(engineId: string): void;
  privacyEngineAddPattern(engineId: string, name: string, pattern: string, level: string): void;
  privacyEngineClassify(engineId: string, text: string): string;
  privacyEngineClassifyBatch(engineId: string, texts: string[]): string;
  privacyEngineDestroy(engineId: string): boolean;

  // Bhava personality engine
  bhavaCreateProfile(name: string, traitsJson: string): string;
  bhavaComposeTraitPrompt(traitsJson: string): string;
  bhavaProfileCompatibility(aJson: string, bJson: string): number;
  bhavaProfileToMarkdown(name: string, traitsJson: string): string;
  bhavaProfileFromMarkdown(markdown: string): string;
  bhavaListPresets(): string;
  bhavaGetPreset(id: string): string;
  bhavaComposePreamble(): string;
  bhavaComposeIdentityPrompt(identityJson: string): string;
  bhavaCreateEmotionalState(): string;
  bhavaCreateEmotionalStateWithBaseline(traitsJson: string): string;
  bhavaDeriveBaseline(traitsJson: string): string;
  bhavaStimulate(stateJson: string, emotion: string, intensity: number): string;
  bhavaApplyDecay(stateJson: string): string;
  bhavaClassifyMood(stateJson: string): string;
  bhavaMoodDeviation(stateJson: string): number;
  bhavaComposeMoodPrompt(stateJson: string): string;
  bhavaActionTendency(stateJson: string): string;
  bhavaCreateSpirit(): string;
  bhavaSpiritFromData(passionsJson: string, inspirationsJson: string, painsJson: string): string;
  bhavaComposeSpiritPrompt(spiritJson: string): string;
  bhavaApplySentimentFeedback(text: string, stateJson: string, scale: number): string;
  bhavaFeedbackFromOutcome(stateJson: string, outcome: string): string;
  bhavaSelectReasoningStrategy(traitsJson: string): string;
  bhavaComposeReasoningPrompt(traitsJson: string): string;
  bhavaDeriveEq(traitsJson: string): string;
  bhavaComposeEqPrompt(traitsJson: string): string;
  bhavaComposeSystemPrompt(
    traitsJson: string,
    identityJson: string,
    stateJson: string,
    spiritText: string
  ): string;
  bhavaBuildMetadata(name: string, traitsJson: string, stateJson: string): string;

  // Bhava 2.0 — zodiac, regulation, stress, energy, flow, circadian, monitor, signal loop
  bhavaListZodiacSigns(): string;
  bhavaZodiacProfile(sign: string): string;
  bhavaZodiacInfo(sign: string): string;
  bhavaZodiacManifest(sign: string): string;
  bhavaCreateRegulatedMood(stateJson: string): string;
  bhavaRegulate(
    regulatedJson: string,
    strategy: string,
    targetEmotion: string,
    strength: number,
    effectiveness: number
  ): string;
  bhavaDefaultRegulationStrategy(traitsJson: string, dominantEmotion: string): string;
  bhavaSuppressionGap(regulatedJson: string): number;
  bhavaCreateStressState(traitsJson: string): string;
  bhavaStressTick(stressJson: string, stateJson: string): string;
  bhavaStressInfo(stressJson: string): string;
  bhavaCreateEnergyState(traitsJson: string): string;
  bhavaEnergyTick(energyJson: string, stateJson: string): string;
  bhavaEnergyInfo(energyJson: string): string;
  bhavaCreateFlowState(): string;
  bhavaFlowTick(flowJson: string, stateJson: string, energy: number, alertness: number): string;
  bhavaFlowInfo(flowJson: string): string;
  bhavaCreateCircadian(chronotype: string): string;
  bhavaCircadianAlertness(circadianJson: string): string;
  bhavaCircadianMoodModulation(circadianJson: string): string;
  bhavaCreateMonitor(scale: number): string;
  bhavaMonitorFeed(monitorJson: string, chunk: string): string;
  bhavaMonitorFlush(monitorJson: string): string;
  bhavaMonitorFeedAndApply(monitorJson: string, stateJson: string, chunk: string): string;
  bhavaSignalTick(compositeJson: string): string;

  // Majra pub/sub
  majraMatchesPattern(pattern: string, topic: string): boolean;
  majraPublish(topic: string, payloadJson: string): number;
  majraSubscribe(pattern: string, callback: (message: string) => void): void;
  majraUnsubscribeAll(pattern: string): void;
  majraPatternCount(): number;
  majraMessagesPublished(): number;
  majraCleanupDead(): number;
  // Direct channel (raw broadcast, ~73M msg/s)
  majraDirectPublish(payloadJson: string): number;
  majraDirectSubscribe(callback: (message: string) => void): void;
  majraDirectSubscriberCount(): number;
  majraDirectMessagesPublished(): number;

  // Hashed channel (hashed topic routing, ~16M msg/s)
  majraHashedPublish(topic: string, payloadJson: string): number;
  majraHashedSubscribe(topic: string, callback: (message: string) => void): void;
  majraHashedTopicCount(): number;
  majraHashedMessagesPublished(): number;
  majraHashedUnsubscribe(topic: string): void;

  majraRatelimitRegister(ruleName: string, windowMs: number, maxRequests: number): void;
  majraRatelimitCheck(ruleName: string, key: string): string;
  majraRatelimitEvict(ruleName: string, maxIdleMs: number): number;
  majraRatelimitStats(ruleName: string): string | null;
  majraRatelimitRemove(ruleName: string): boolean;
  majraHeartbeatRegister(id: string, metadataJson: string): void;
  majraHeartbeat(id: string): boolean;
  majraHeartbeatDeregister(id: string): boolean;
  majraHeartbeatUpdate(): string;
  majraHeartbeatGet(id: string): string | null;
  majraHeartbeatList(status: string): string;
  majraHeartbeatCount(): number;
  majraBarrierCreate(name: string, participantsJson: string): void;
  majraBarrierArrive(name: string, participant: string): string;
  majraBarrierForce(name: string, deadParticipant: string): string;
  majraBarrierComplete(name: string): string | null;
  majraBarrierCount(): number;
  majraQueueEnqueue(priority: string, payloadJson: string): string;
  majraQueueDequeue(): string | null;
  majraQueueComplete(jobId: string): boolean;
  majraQueueFail(jobId: string): boolean;
  majraQueueCancel(jobId: string): boolean;
  majraQueueGet(jobId: string): string | null;
  majraQueueRunningCount(): number;
  majraQueueJobCount(): number;

  // Szal workflow engine
  szalEvaluateCondition(expression: string, contextJson: string): boolean;
  szalValidateFlow(flowJson: string): string;
  szalCreateStep(configJson: string): string;
  szalBuildDagFlow(name: string, stepsJson: string): string;
  szalTopologicalSort(stepsJson: string): string;
  szalResolveTemplate(template: string, contextJson: string): string;

  // Bote MCP service
  boteRegisterTool(toolJson: string): void;
  boteListTools(): string;
  boteGetTool(name: string): string | null;
  boteValidateParams(toolName: string, paramsJson: string): string;
  boteRemoveTool(name: string): boolean;
  boteToolCount(): number;
  boteParseJsonrpc(requestJson: string): string;
  boteJsonrpcSuccess(id: string, resultJson: string): string;
  boteJsonrpcError(id: string, code: number, message: string): string;

  // Audit chain
  auditChainCreate(chainId: string, signingKey: string): void;
  auditChainRecord(
    chainId: string,
    event: string,
    level: string,
    message: string,
    userId: string | null,
    taskId: string | null,
    metadataJson: string | null
  ): string;
  auditChainVerify(chainId: string): string;
  auditChainCount(chainId: string): number;
  auditChainLastHash(chainId: string): string;
  auditChainRotateKey(chainId: string, newKey: string): void;
  auditChainDestroy(chainId: string): boolean;

  // Sandbox capabilities
  sandboxDetectCapabilities(): string;
  sandboxIsSyscallAllowed(name: string): boolean;
  sandboxAllowedSyscalls(): string[];
  sandboxBlockedSyscalls(): string[];
  sandboxSeccompMode(): string;
  sandboxLandlockAvailable(): boolean;
  sandboxLandlockAbi(): number;
  sandboxCgroupV2(): boolean;
  sandboxCgroupMemoryLimit(): number | null;
  sandboxCgroupMemoryCurrent(): number | null;

  // TEE model weight sealing
  teeSeal(plaintext: Buffer, keySource: string): Buffer;
  teeUnseal(sealed: Buffer, keySourceOverride: string | null): Buffer;
  teeIsSealed(data: Buffer): boolean;
  teeClearKeyCache(): void;

  // AgnosAI orchestration engine
  agnosaiRunCrew(specJson: string): Promise<string>;
  agnosaiCancelCrew(crewId: string): Promise<void>;
  agnosaiValidateCrew(specJson: string): string;
  agnosaiScheduleTasks(tasksJson: string): string;
  agnosaiTopologicalSort(tasksJson: string): string;
  agnosaiRouteModel(taskType: string, complexity: string): string;
  agnosaiRankAgents(agentsJson: string, taskJson: string): string;
  agnosaiCreateAgentDef(profileJson: string): string;
  agnosaiListBuiltinTools(): string;
  agnosaiUcb1Select(armsJson: string): string;

  // Dhvani audio engine
  dhvaniVoiceProfileMale(): string;
  dhvaniVoiceProfileFemale(): string;
  dhvaniVoiceProfileFromJson(configJson: string): string;
  dhvaniG2pConvert(text: string, language?: string | null): string;
  dhvaniSynthesizeSpeech(
    text: string,
    voiceProfileJson?: string | null,
    sampleRate?: number | null
  ): Buffer;
  dhvaniSynthesizePhonemes(
    phonemeEventsJson: string,
    voiceProfileJson?: string | null,
    sampleRate?: number | null
  ): Buffer;
  dhvaniNoiseReduce(
    audio: Buffer,
    sampleRate: number,
    strength?: number | null,
    channels?: number | null
  ): Buffer;
  dhvaniResample(
    audio: Buffer,
    sourceRate: number,
    targetRate: number,
    channels?: number | null
  ): Buffer;
  dhvaniNormalize(
    audio: Buffer,
    sampleRate: number,
    targetPeak: number,
    channels?: number | null
  ): Buffer;
  dhvaniAnalyzeDynamics(audio: Buffer, sampleRate: number, channels?: number | null): string;
  dhvaniLoudnessLufs(audio: Buffer, sampleRate: number, channels?: number | null): number;
  dhvaniIsSilent(
    audio: Buffer,
    sampleRate: number,
    thresholdDb?: number | null,
    channels?: number | null
  ): boolean;
  dhvaniPcmToWav(audio: Buffer, sampleRate: number, channels?: number | null): Buffer;
  dhvaniSuggestGain(
    audio: Buffer,
    sampleRate: number,
    targetRms: number,
    channels?: number | null
  ): number;
}

/**
 * Native module — always null. Individual ecosystem crates export their own
 * stub modules (bhava, szal, bote, dhvani, agnosai, majra).
 */
export const native: NativeModule | null = null;

/**
 * Whether the native module is loaded and active.
 */
export const nativeAvailable = false;
