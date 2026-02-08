/**
 * SecureClaw Example Usage
 *
 * This demonstrates basic usage of SecureClaw.
 * Run with: npx tsx packages/core/src/example.ts
 */
import { createSecureClaw, TaskType } from './index.js';
async function main() {
    console.log('Starting SecureClaw example...\n');
    // Set required environment variables for testing
    process.env['SECURECLAW_SIGNING_KEY'] = 'test-signing-key-at-least-32-chars-long';
    process.env['SECURECLAW_TOKEN_SECRET'] = 'test-token-secret-at-least-32-chars';
    process.env['SECURECLAW_ENCRYPTION_KEY'] = 'test-encryption-key-32-chars-min';
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test-key'; // Placeholder
    try {
        // Create and initialize SecureClaw
        const secureClaw = await createSecureClaw({
            config: {
                overrides: {
                    core: {
                        environment: 'development',
                        logLevel: 'info',
                    },
                },
            },
        });
        console.log('SecureClaw initialized successfully!');
        console.log('State:', secureClaw.getState());
        // Register a simple task handler
        const echoHandler = {
            type: TaskType.QUERY,
            requiredPermissions: [{ resource: 'tasks', action: 'execute' }],
            execute: async (task) => {
                console.log(`Executing task: ${task.name}`);
                return { echo: 'Hello from SecureClaw!' };
            },
        };
        secureClaw.registerTaskHandler(echoHandler);
        console.log('\nTask handler registered.');
        // Submit a task
        console.log('\nSubmitting a test task...');
        const task = await secureClaw.submitTask({
            type: TaskType.QUERY,
            name: 'Test Echo Task',
            description: 'A simple test task',
            input: { message: 'Hello!' },
        }, {
            userId: 'test-user',
            role: 'admin',
            correlationId: undefined,
        });
        console.log('\nTask result:', task);
        // Get metrics
        const metrics = await secureClaw.getMetrics();
        console.log('\nMetrics snapshot:', JSON.stringify(metrics, null, 2));
        // Verify audit chain
        const verification = await secureClaw.verifyAuditChain();
        console.log('\nAudit chain verification:', verification);
        // Shutdown
        await secureClaw.shutdown();
        console.log('\nSecureClaw shutdown complete.');
    }
    catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}
main();
//# sourceMappingURL=example.js.map