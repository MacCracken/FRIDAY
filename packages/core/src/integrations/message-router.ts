/**
 * MessageRouter — Routes inbound UnifiedMessages to the task executor
 * and sends responses back to the originating platform.
 *
 * Flow: Platform → Integration.onMessage → MessageRouter → TaskExecutor → response → Integration.sendMessage
 */

import type { UnifiedMessage } from '@friday/shared';
import { TaskType } from '@friday/shared';
import type { TaskExecutor, ExecutionContext } from '../task/executor.js';
import type { IntegrationManager } from './manager.js';
import type { IntegrationStorage } from './storage.js';
import type { SecureLogger } from '../logging/logger.js';

export interface MessageRouterDeps {
  logger: SecureLogger;
  taskExecutor: TaskExecutor;
  integrationManager: IntegrationManager;
  integrationStorage: IntegrationStorage;
}

export class MessageRouter {
  private readonly deps: MessageRouterDeps;

  constructor(deps: MessageRouterDeps) {
    this.deps = deps;
  }

  /**
   * Handle an inbound message from any platform.
   * This is the callback given to IntegrationDeps.onMessage.
   */
  async handleInbound(message: UnifiedMessage): Promise<void> {
    const { logger, taskExecutor, integrationManager, integrationStorage } = this.deps;

    logger.info(`Inbound message from ${message.platform}:${message.chatId} by ${message.senderName}`);

    // Store the inbound message
    integrationStorage.storeMessage({
      integrationId: message.integrationId,
      platform: message.platform,
      direction: 'inbound',
      senderId: message.senderId,
      senderName: message.senderName,
      chatId: message.chatId,
      text: message.text,
      attachments: message.attachments,
      replyToMessageId: message.replyToMessageId,
      platformMessageId: message.platformMessageId,
      metadata: message.metadata,
      timestamp: message.timestamp,
    });

    // Skip empty messages
    if (!message.text.trim()) {
      logger.debug('Skipping empty inbound message');
      return;
    }

    // Create execution context for the task
    const context: ExecutionContext = {
      userId: `${message.platform}:${message.senderId}`,
      role: 'operator', // platform users get operator role by default
      correlationId: message.id,
    };

    try {
      // Submit as a "query" task to the executor
      const task = await taskExecutor.submit(
        {
          type: TaskType.QUERY,
          name: `${message.platform} message from ${message.senderName}`,
          description: message.text,
          input: {
            text: message.text,
            platform: message.platform,
            chatId: message.chatId,
            senderId: message.senderId,
            senderName: message.senderName,
            attachments: message.attachments,
          },
        },
        context,
      );

      // Wait for the task to complete (the executor handles this)
      // For now, we respond with the task ID. The actual AI response
      // will be sent when the task completes via the task completion hook.
      logger.info(`Task created for inbound message: ${task.id}`);

      // If the task completed synchronously, send a response back
      if (task.status === 'completed' && task.result?.success) {
        await integrationManager.sendMessage(
          message.integrationId,
          message.chatId,
          `Task ${task.id} completed successfully.`,
          { taskId: task.id, replyToMessageId: message.platformMessageId },
        );
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to process inbound message: ${errorMsg}`);

      // Send error response back to the platform
      try {
        await integrationManager.sendMessage(
          message.integrationId,
          message.chatId,
          `Sorry, I encountered an error processing your message. Please try again.`,
          { error: errorMsg },
        );
      } catch (sendErr) {
        logger.error(`Failed to send error response: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`);
      }
    }
  }
}
