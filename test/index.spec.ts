import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import app from '../src';

// Mock D1 database for testing
const mockDB = {
	prepare: () => ({
		bind: () => ({
			run: () => ({ meta: { last_row_id: 1 } }),
			first: () => null,
			all: () => ({ results: [] })
		})
	})
} as unknown as D1Database;

// Mock AI for testing
const mockAI = {
	run: () => Promise.resolve({ response: 'Mock AI response', description: 'Mock image description' })
} as unknown as Ai;

// Mock environment with test bot token
const testEnv = {
	...env,
	BOT_TOKEN: 'test_bot_token_123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ',
	DB: mockDB,
	AI: mockAI
};

describe('Life Desk Bot with Hono', () => {
	describe('Basic endpoints', () => {
		it('/ responds with status page', async () => {
			const request = new Request('http://example.com/');
			const ctx = createExecutionContext();
			const response = await app.fetch(request, testEnv, ctx);
			await waitOnExecutionContext(ctx);
			
			expect(response.status).toBe(200);
			expect(response.headers.get('content-type')).toContain('text/html');
			const text = await response.text();
			expect(text).toContain('Life Desk');
			expect(text).toContain('Ultra-essential productivity bot');
			expect(text).toContain('/note');
			expect(text).toContain('/todo');
			expect(text).toContain('/expense');
			expect(text).toContain('/summary');
		});

		it('returns 404 for unknown paths', async () => {
			const request = new Request('http://example.com/unknown');
			const ctx = createExecutionContext();
			const response = await app.fetch(request, testEnv, ctx);
			await waitOnExecutionContext(ctx);
			
			expect(response.status).toBe(404);
			expect(await response.text()).toBe('Not Found');
		});

		it('returns 500 when BOT_TOKEN is missing', async () => {
			const request = new Request('http://example.com/webhook', { method: 'POST' });
			const ctx = createExecutionContext();
			const response = await app.fetch(request, env, ctx); // Using env without BOT_TOKEN
			await waitOnExecutionContext(ctx);
			
			expect(response.status).toBe(500);
			expect(await response.text()).toBe('Bot token not configured');
		});
	});

	describe('Webhook endpoint', () => {
		it('/webhook responds with 404 for GET requests (Hono routing)', async () => {
			const request = new Request('http://example.com/webhook', { method: 'GET' });
			const ctx = createExecutionContext();
			const response = await app.fetch(request, testEnv, ctx);
			await waitOnExecutionContext(ctx);
			
			expect(response.status).toBe(404);
			expect(await response.text()).toBe('Not Found');
		});

		it('/webhook accepts POST requests with /note command', async () => {
			const mockUpdate = {
				update_id: 123,
				message: {
					message_id: 1,
					from: {
						id: 12345,
						is_bot: false,
						first_name: 'Test User',
						username: 'testuser'
					},
					chat: {
						id: 12345,
						first_name: 'Test User',
						type: 'private'
					},
					date: Date.now(),
					text: '/note Buy milk on way home'
				}
			};

			const request = new Request('http://example.com/webhook', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(mockUpdate)
			});
			
			const ctx = createExecutionContext();
			const response = await app.fetch(request, testEnv, ctx);
			await waitOnExecutionContext(ctx);
			
			expect(response.status).toBe(200);
			expect(await response.text()).toBe('OK');
		});
	});

	describe('Management endpoints', () => {
		it('/webhook-info returns webhook information', async () => {
			const request = new Request('http://example.com/webhook-info');
			const ctx = createExecutionContext();
			const response = await app.fetch(request, testEnv, ctx);
			await waitOnExecutionContext(ctx);
			
			expect(response.headers.get('content-type')).toContain('application/json');
			// Note: This will make an actual API call to Telegram in a real test
			// In a production environment, you might want to mock this
		});

		it('/set-webhook returns webhook setup information', async () => {
			const request = new Request('http://example.com/set-webhook');
			const ctx = createExecutionContext();
			const response = await app.fetch(request, testEnv, ctx);
			await waitOnExecutionContext(ctx);
			
			expect(response.headers.get('content-type')).toContain('application/json');
			const result = await response.json();
			expect(result).toHaveProperty('webhook_url');
		});

		it('/delete-webhook returns deletion result', async () => {
			const request = new Request('http://example.com/delete-webhook');
			const ctx = createExecutionContext();
			const response = await app.fetch(request, testEnv, ctx);
			await waitOnExecutionContext(ctx);
			
			expect(response.headers.get('content-type')).toContain('application/json');
		});
	});
});
