/**
 * Life Desk Bot - Main Application
 * 
 * Ultra-essential productivity bot with 4 core commands:
 * /note, /todo, /expense, /summary
 */

import { Hono } from 'hono';
import { TelegramBot, TelegramUpdate, handleTelegramUpdate } from './webhook';

type Bindings = {
	BOT_TOKEN: string;
	DB: D1Database;
	AI: Ai;
	FREEPIK_API_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Middleware to check bot token
app.use('*', async (c, next) => {
	if (!c.env.BOT_TOKEN) {
		return c.text('Bot token not configured', 500);
	}
	await next();
});

// Home page - Life Desk status
app.get('/', (c) => {
	return c.html(`
		<html>
			<head>
				<title>Life Desk - Ultra-Essential Bot</title>
				<style>
					body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; background: #f8fafc; }
					.container { background: white; border-radius: 12px; padding: 30px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
					h1 { color: #1e293b; margin-bottom: 10px; }
					.subtitle { color: #64748b; font-size: 18px; margin-bottom: 30px; }
					.status { background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
					.commands { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin: 30px 0; }
					.command { background: #f1f5f9; padding: 20px; border-radius: 8px; border-left: 4px solid #3b82f6; }
					.command h3 { margin: 0 0 10px 0; color: #1e293b; }
					.command p { margin: 0; color: #64748b; font-size: 14px; }
					.management { background: #fef3c7; padding: 20px; border-radius: 8px; margin: 30px 0; }
					.management h3 { margin: 0 0 15px 0; color: #92400e; }
					.management a { display: inline-block; margin: 5px 10px 5px 0; padding: 8px 16px; background: #f59e0b; color: white; text-decoration: none; border-radius: 6px; font-size: 14px; }
					.management a:hover { background: #d97706; }
				</style>
			</head>
			<body>
				<div class="container">
					<h1>🎯 Life Desk</h1>
					<p class="subtitle">Ultra-essential productivity bot with 4 core commands</p>
					
					<div class="status">
						<strong>✅ Status:</strong> Bot is running and ready to boost your productivity!
					</div>

					<div class="commands">
						<div class="command">
							<h3>📝 /note</h3>
							<p>Universal capture - thoughts, ideas, reminders, references</p>
						</div>
						<div class="command">
							<h3>✅ /todo</h3>
							<p>Task management with natural language dates</p>
						</div>
						<div class="command">
							<h3>💰 /expense</h3>
							<p>Money tracking - simple amount + description</p>
						</div>
						<div class="command">
							<h3>🎯 /reminders</h3>
							<p>AI-powered smart reminders from your notes & todos</p>
						</div>
						<div class="command">
							<h3>📊 /summary</h3>
							<p>Weekly overview of your productivity and spending</p>
						</div>
					</div>

					<div class="management">
						<h3>🔧 Bot Management</h3>
						<a href="/set-webhook">Set Webhook</a>
						<a href="/webhook-info">Webhook Info</a>
						<a href="/delete-webhook">Delete Webhook</a>
						<a href="/db-stats">Database Stats</a>
						<a href="/test-image">Test Image Generation</a>

					</div>
				</div>
			</body>
		</html>
	`);
});

// Webhook endpoint - Handle Telegram updates
app.post('/webhook', async (c) => {
	try {
		const bot = new TelegramBot(c.env.BOT_TOKEN);
		const update: TelegramUpdate = await c.req.json();
		
		await handleTelegramUpdate(update, bot, c.env.DB, c.env.AI, c.env.FREEPIK_API_KEY);
		return c.text('OK');
	} catch (error) {
		console.error('Error processing webhook:', error);
		return c.text('Error processing webhook', 500);
	}
});

// Set webhook
app.get('/set-webhook', async (c) => {
	try {
		const bot = new TelegramBot(c.env.BOT_TOKEN);
		const webhookUrl = `${new URL(c.req.url).origin}/webhook`;
		
		const response = await bot.setWebhook(webhookUrl);
		const result = await response.json() as Record<string, any>;
		
		return c.json({
			success: true,
			webhook_url: webhookUrl,
			telegram_response: result
		});
	} catch (error) {
		return c.json({
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error'
		}, 500);
	}
});

// Get webhook info
app.get('/webhook-info', async (c) => {
	try {
		const bot = new TelegramBot(c.env.BOT_TOKEN);
		const response = await bot.getWebhookInfo();
		const result = await response.json() as Record<string, any>;
		
		return c.json(result);
	} catch (error) {
		return c.json({
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error'
		}, 500);
	}
});

// Delete webhook
app.get('/delete-webhook', async (c) => {
	try {
		const bot = new TelegramBot(c.env.BOT_TOKEN);
		const response = await bot.deleteWebhook();
		const result = await response.json() as Record<string, any>;
		
		return c.json(result);
	} catch (error) {
		return c.json({
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error'
		}, 500);
	}
});

// Database stats endpoint (for debugging)
app.get('/db-stats', async (c) => {
	try {
		const usersCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM users').first();
		const notesCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM notes').first();
		const todosCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM todos').first();
		const expensesCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM expenses').first();
		const remindersCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM reminders').first();

		return c.json({
			database: 'D1 SQLite',
			stats: {
				users: usersCount?.count || 0,
				notes: notesCount?.count || 0,
				todos: todosCount?.count || 0,
				expenses: expensesCount?.count || 0,
				reminders: remindersCount?.count || 0
			},
			status: 'Connected ✅'
		});
	} catch (error) {
		return c.json({
			success: false,
			error: error instanceof Error ? error.message : 'Database connection failed'
		}, 500);
	}
});

// Test image generation endpoint
app.get('/test-image', async (c) => {
	try {
		console.log('Testing Freepik API...');
		
		const FREEPIK_API_URL = `https://api.freepik.com/v1/ai/text-to-image`;
		const requestBody = {
			prompt: "A simple test image of a cat",
			styling: {
				style: "photo",
				color: "pastel",
				lightning: "cinematic",
				framing: "aerial-view",
			},
			image: {
				size: "social_story_9_16",
			},
		};

		const response = await fetch(FREEPIK_API_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-freepik-api-key": c.env.FREEPIK_API_KEY,
			},
			body: JSON.stringify(requestBody),
		});

		const data = await response.json();
		
		return c.json({
			status: response.status,
			statusText: response.statusText,
			apiKeyPresent: !!c.env.FREEPIK_API_KEY,
			apiKeyLength: c.env.FREEPIK_API_KEY?.length || 0,
			responseData: data
		});
	} catch (error) {
		return c.json({
			error: error instanceof Error ? error.message : 'Unknown error',
			stack: error instanceof Error ? error.stack : undefined
		}, 500);
	}
});

// 404 handler
app.notFound((c) => {
	return c.text('Not Found', 404);
});

// Scheduled handler for automatic reminder checking
export default {
	fetch: app.fetch,
	async scheduled(event: ScheduledEvent, env: { BOT_TOKEN: string; DB: D1Database; AI: Ai }, ctx: ExecutionContext): Promise<void> {
		try {
			const bot = new TelegramBot(env.BOT_TOKEN);
			const { CommandHandler } = await import('./commands');
			console.log('Scheduled reminder check skipped - feature removed');
		} catch (error) {
			console.error('Error in scheduled reminder check:', error);
		}
	}
};
