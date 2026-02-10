/**
 * SecureYeoman Example Usage
 * 
 * This demonstrates basic usage of SecureYeoman.
 * Run with: npx tsx packages/core/src/example.ts
 */

import { createSecureYeoman, TaskType, type TaskHandler } from './index.js';

async function main() {
  console.log('Starting SecureYeoman example...\n');
  
  // Set required environment variables for testing
  process.env.SECUREYEOMAN_SIGNING_KEY = 'test-signing-key-at-least-32-chars-long';
  process.env.SECUREYEOMAN_TOKEN_SECRET = 'test-token-secret-at-least-32-chars';
  process.env.SECUREYEOMAN_ENCRYPTION_KEY = 'test-encryption-key-32-chars-min';
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'; // Placeholder
  
  try {
    // Create and initialize SecureYeoman
    const secureYeoman = await createSecureYeoman({
      config: {
        overrides: {
          core: {
            environment: 'development',
            logLevel: 'info',
          },
        },
      },
    });
    
    console.log('SecureYeoman initialized successfully!');
    console.log('State:', secureYeoman.getState());
    
    // Register a simple task handler
    const echoHandler: TaskHandler = {
      type: TaskType.QUERY,
      requiredPermissions: [{ resource: 'tasks', action: 'execute' }],
      execute: async (task) => {
        console.log(`Executing task: ${task.name}`);
        return { echo: 'Hello from SecureYeoman!' };
      },
    };
    
    secureYeoman.registerTaskHandler(echoHandler);
    console.log('\nTask handler registered.');
    
    // Submit a task
    console.log('\nSubmitting a test task...');
    const task = await secureYeoman.submitTask(
      {
        type: TaskType.QUERY,
        name: 'Test Echo Task',
        description: 'A simple test task',
        input: { message: 'Hello!' },
      },
      {
        userId: 'test-user',
        role: 'admin',
        correlationId: undefined,
      }
    );
    
    console.log('\nTask result:', task);
    
    // Get metrics
    const metrics = await secureYeoman.getMetrics();
    console.log('\nMetrics snapshot:', JSON.stringify(metrics, null, 2));
    
    // Verify audit chain
    const verification = await secureYeoman.verifyAuditChain();
    console.log('\nAudit chain verification:', verification);
    
    // Shutdown
    await secureYeoman.shutdown();
    console.log('\nSecureYeoman shutdown complete.');
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
