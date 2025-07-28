/**
 * Life Desk Bot Commands
 * 
 * Implements the 4 essential commands: /note, /todo, /expense, /summary
 */

import { TelegramBot, TelegramPhoto } from './webhook';

// Cloudflare types
declare global {
	interface D1Database {
		prepare(query: string): D1PreparedStatement;
	}
	
	interface D1PreparedStatement {
		bind(...values: any[]): D1PreparedStatement;
		first(): Promise<any>;
		all(): Promise<{ results: any[] }>;
		run(): Promise<{ meta: { last_row_id?: number } }>;
	}
	
	interface Ai {
		run(model: string, options: any): Promise<any>;
	}
}

// Types for our data structures
export interface User {
	telegramId: number;
	firstName: string;
	username?: string;
	timezone?: string;
	timezoneOffset?: number;
	createdAt: number;
	lastActiveAt: number;
}

export interface Note {
	id: string;
	userId: number;
	content: string;
	createdAt: number;
	category?: 'link' | 'task' | 'idea' | 'general';
}

export interface Todo {
	id: string;
	userId: number;
	task: string;
	dueDate?: number;
	completed: boolean;
	createdAt: number;
	completedAt?: number;
}

export interface Expense {
	id: string;
	userId: number;
	amount: number;
	description: string;
	category?: string;
	createdAt: number;
}

// User input states
export interface UserInputState {
	id: string;
	userId: number;
	mode: 'note' | 'todo' | 'expense';
	createdAt: number;
}

// Freepik API types
export interface FreepikImageResponse {
	data: Array<{
		base64: string;
	}>;
	message?: string;
}



// D1 Database Service
class DatabaseService {
	private db: D1Database;

	constructor(db: D1Database) {
		this.db = db;
	}

	// User management
	async createUser(user: Omit<User, 'createdAt' | 'lastActiveAt'>): Promise<User> {
		const now = Date.now();
		const result = await this.db.prepare(`
			INSERT INTO users (telegram_id, first_name, username, timezone, timezone_offset, created_at, last_active_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`).bind(
			user.telegramId, 
			user.firstName, 
			user.username || null, 
			user.timezone || 'UTC', 
			user.timezoneOffset || 0, 
			now, 
			now
		).run();

		return {
			...user,
			timezone: user.timezone || 'UTC',
			timezoneOffset: user.timezoneOffset || 0,
			createdAt: now,
			lastActiveAt: now
		};
	}

	async getUser(telegramId: number): Promise<User | null> {
		const result = await this.db.prepare(`
			SELECT * FROM users WHERE telegram_id = ?
		`).bind(telegramId).first();

		if (!result) return null;

		return {
			telegramId: result.telegram_id as number,
			firstName: result.first_name as string,
			username: result.username as string | undefined,
			timezone: result.timezone as string | undefined,
			timezoneOffset: result.timezone_offset as number | undefined,
			createdAt: result.created_at as number,
			lastActiveAt: result.last_active_at as number
		};
	}
	
	async updateUserTimezone(telegramId: number, timezone: string, timezoneOffset: number): Promise<void> {
		await this.db.prepare(`
			UPDATE users SET timezone = ?, timezone_offset = ? WHERE telegram_id = ?
		`).bind(timezone, timezoneOffset, telegramId).run();
		
		console.log(`Updated timezone for user ${telegramId}: ${timezone} (offset: ${timezoneOffset})`);
	}

	async updateUserActivity(telegramId: number): Promise<void> {
		await this.db.prepare(`
			UPDATE users SET last_active_at = ? WHERE telegram_id = ?
		`).bind(Date.now(), telegramId).run();
	}

	// Notes
	async createNote(note: Omit<Note, 'id' | 'createdAt'>): Promise<Note> {
		const now = Date.now();
		const result = await this.db.prepare(`
			INSERT INTO notes (user_id, content, category, created_at)
			VALUES (?, ?, ?, ?)
		`).bind(note.userId, note.content, note.category || null, now).run();

		return {
			id: result.meta.last_row_id?.toString() || '0',
			...note,
			createdAt: now
		};
	}

	async searchNotes(userId: number, query: string): Promise<Note[]> {
		const results = await this.db.prepare(`
			SELECT * FROM notes 
			WHERE user_id = ? AND content LIKE ?
			ORDER BY created_at DESC
		`).bind(userId, `%${query}%`).all();

		return results.results.map(row => ({
			id: row.id?.toString() || '0',
			userId: row.user_id as number,
			content: row.content as string,
			category: row.category as Note['category'],
			createdAt: row.created_at as number
		}));
	}

	// Todos
	async createTodo(todo: Omit<Todo, 'id' | 'createdAt'>): Promise<Todo> {
		const now = Date.now();
		const result = await this.db.prepare(`
			INSERT INTO todos (user_id, task, due_date, completed, created_at)
			VALUES (?, ?, ?, ?, ?)
		`).bind(todo.userId, todo.task, todo.dueDate || null, false, now).run();

		return {
			id: result.meta.last_row_id?.toString() || '0',
			...todo,
			completed: false,
			createdAt: now
		};
	}

	async getUserTodos(userId: number, completed?: boolean): Promise<Todo[]> {
		let query = `SELECT * FROM todos WHERE user_id = ?`;
		const params: any[] = [userId];

		if (completed !== undefined) {
			query += ` AND completed = ?`;
			params.push(completed ? 1 : 0);
		}

		query += ` ORDER BY created_at DESC`;

		const results = await this.db.prepare(query).bind(...params).all();

		return results.results.map(row => ({
			id: row.id?.toString() || '0',
			userId: row.user_id as number,
			task: row.task as string,
			dueDate: row.due_date as number | undefined,
			completed: Boolean(row.completed),
			createdAt: row.created_at as number,
			completedAt: row.completed_at as number | undefined
		}));
	}

	async completeTodo(todoId: string): Promise<void> {
		await this.db.prepare(`
			UPDATE todos SET completed = true, completed_at = ? WHERE id = ?
		`).bind(Date.now(), parseInt(todoId)).run();
	}

	// Expenses
	async createExpense(expense: Omit<Expense, 'id' | 'createdAt'>): Promise<Expense> {
		const now = Date.now();
		const result = await this.db.prepare(`
			INSERT INTO expenses (user_id, amount, description, category, created_at)
			VALUES (?, ?, ?, ?, ?)
		`).bind(expense.userId, expense.amount, expense.description, expense.category || null, now).run();

		return {
			id: result.meta.last_row_id?.toString() || '0',
			...expense,
			createdAt: now
		};
	}

	async getUserExpenses(userId: number, startDate?: number, endDate?: number): Promise<Expense[]> {
		let query = `SELECT * FROM expenses WHERE user_id = ?`;
		const params: any[] = [userId];

		if (startDate) {
			query += ` AND created_at >= ?`;
			params.push(startDate);
		}

		if (endDate) {
			query += ` AND created_at <= ?`;
			params.push(endDate);
		}

		query += ` ORDER BY created_at DESC`;

		const results = await this.db.prepare(query).bind(...params).all();

		return results.results.map(row => ({
			id: row.id?.toString() || '0',
			userId: row.user_id as number,
			amount: row.amount as number,
			description: row.description as string,
			category: row.category as string | undefined,
			createdAt: row.created_at as number
		}));
	}

	// Summary data
	async getWeeklySummary(userId: number): Promise<{
		notesCount: number;
		todosCompleted: number;
		todosTotal: number;
		totalSpent: number;
		lastWeekSpent: number;
		mostProductiveDay: string;
	}> {
		const weekStart = new Date();
		weekStart.setDate(weekStart.getDate() - weekStart.getDay());
		weekStart.setHours(0, 0, 0, 0);
		const weekStartTime = weekStart.getTime();

		const lastWeekStart = weekStartTime - (7 * 24 * 60 * 60 * 1000);

		// Get notes count
		const notesResult = await this.db.prepare(`
			SELECT COUNT(*) as count FROM notes 
			WHERE user_id = ? AND created_at >= ?
		`).bind(userId, weekStartTime).first();

		// Get todos stats
		const todosResult = await this.db.prepare(`
			SELECT 
				COUNT(*) as total,
				SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) as completed
			FROM todos 
			WHERE user_id = ? AND created_at >= ?
		`).bind(userId, weekStartTime).first();

		// Get expenses this week
		const expensesResult = await this.db.prepare(`
			SELECT SUM(amount) as total FROM expenses 
			WHERE user_id = ? AND created_at >= ?
		`).bind(userId, weekStartTime).first();

		// Get expenses last week
		const lastWeekExpensesResult = await this.db.prepare(`
			SELECT SUM(amount) as total FROM expenses 
			WHERE user_id = ? AND created_at >= ? AND created_at < ?
		`).bind(userId, lastWeekStart, weekStartTime).first();

		return {
			notesCount: (notesResult?.count as number) || 0,
			todosCompleted: (todosResult?.completed as number) || 0,
			todosTotal: (todosResult?.total as number) || 0,
			totalSpent: (expensesResult?.total as number) || 0,
			lastWeekSpent: (lastWeekExpensesResult?.total as number) || 0,
			mostProductiveDay: 'Monday' // TODO: Calculate based on actual data
		};
	}

	// User input state management
	async setUserInputState(userId: number, mode: 'note' | 'todo' | 'expense'): Promise<string> {
		const id = crypto.randomUUID();
		await this.db.prepare(`
			INSERT OR REPLACE INTO user_input_states (id, user_id, mode, created_at)
			VALUES (?, ?, ?, ?)
		`).bind(id, userId, mode, Date.now()).run();
		return id;
	}

	async getUserInputState(userId: number): Promise<UserInputState | null> {
		const result = await this.db.prepare(`
			SELECT * FROM user_input_states WHERE user_id = ?
		`).bind(userId).first();

		if (!result) return null;

		return {
			id: result.id as string,
			userId: result.user_id as number,
			mode: result.mode as 'note' | 'todo' | 'expense',
			createdAt: result.created_at as number
		};
	}

	async clearUserInputState(userId: number): Promise<void> {
		await this.db.prepare(`
			DELETE FROM user_input_states WHERE user_id = ?
		`).bind(userId).run();
	}



	// Get recent items for display
	async getRecentNotes(userId: number, limit: number = 5): Promise<Note[]> {
		const results = await this.db.prepare(`
			SELECT * FROM notes 
			WHERE user_id = ? 
			ORDER BY created_at DESC 
			LIMIT ?
		`).bind(userId, limit).all();

		return results.results.map(row => ({
			id: row.id?.toString() || '0',
			userId: row.user_id as number,
			content: row.content as string,
			category: row.category as Note['category'],
			createdAt: row.created_at as number
		}));
	}

	async getRecentTodos(userId: number, limit: number = 5): Promise<Todo[]> {
		const results = await this.db.prepare(`
			SELECT * FROM todos 
			WHERE user_id = ? 
			ORDER BY created_at DESC 
			LIMIT ?
		`).bind(userId, limit).all();

		return results.results.map(row => ({
			id: row.id?.toString() || '0',
			userId: row.user_id as number,
			task: row.task as string,
			dueDate: row.due_date as number | undefined,
			completed: Boolean(row.completed),
			createdAt: row.created_at as number,
			completedAt: row.completed_at as number | undefined
		}));
	}

	async getRecentExpenses(userId: number, limit: number = 5): Promise<Expense[]> {
		const results = await this.db.prepare(`
			SELECT * FROM expenses 
			WHERE user_id = ? 
			ORDER BY created_at DESC 
			LIMIT ?
		`).bind(userId, limit).all();

		return results.results.map(row => ({
			id: row.id?.toString() || '0',
			userId: row.user_id as number,
			amount: row.amount as number,
			description: row.description as string,
			category: row.category as string | undefined,
			createdAt: row.created_at as number
		}));
	}
}

// Utility functions
function parseDateFromText(text: string): number | undefined {
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	
	if (text.includes('tomorrow')) {
		return today.getTime() + 24 * 60 * 60 * 1000;
	}
	
	if (text.includes('friday')) {
		const friday = new Date(today);
		friday.setDate(today.getDate() + (5 - today.getDay() + 7) % 7);
		return friday.getTime();
	}
	
	if (text.includes('next week')) {
		return today.getTime() + 7 * 24 * 60 * 60 * 1000;
	}
	
	return undefined;
}

function parseExpense(text: string): { amount: number; description: string } | null {
	// Match patterns like "15 coffee" or "120 groceries"
	const match = text.match(/^(\d+(?:\.\d{2})?)\s+(.+)$/);
	if (match) {
		return {
			amount: parseFloat(match[1]),
			description: match[2].trim()
		};
	}
	return null;
}

function categorizeNote(content: string): Note['category'] {
	if (content.includes('http') || content.includes('www.')) {
		return 'link';
	}
	if (content.toLowerCase().includes('todo') || content.toLowerCase().includes('task')) {
		return 'task';
	}
	if (content.toLowerCase().includes('idea') || content.toLowerCase().includes('think')) {
		return 'idea';
	}
	return 'general';
}

// Global session storage for image prompts (persists across requests)
const globalImagePromptSessions = new Map<number, number>(); // chatId -> timestamp

// Cleanup old sessions periodically
function cleanupOldImageSessions() {
	const now = Date.now();
	const tenMinutesAgo = now - 10 * 60 * 1000;
	
	for (const [chatId, timestamp] of globalImagePromptSessions.entries()) {
		if (timestamp < tenMinutesAgo) {
			globalImagePromptSessions.delete(chatId);
		}
	}
}

// Command handlers
export class CommandHandler {
	private bot: TelegramBot;
	private db: DatabaseService;
	private ai: Ai;
	private freepikApiKey: string;

	constructor(bot: TelegramBot, database: D1Database, ai: Ai, freepikApiKey: string) {
		this.bot = bot;
		this.db = new DatabaseService(database);
		this.ai = ai;
		this.freepikApiKey = freepikApiKey;
	}

	// Check if user is in input mode
	async getUserInputMode(userId: number): Promise<UserInputState | null> {
		return await this.db.getUserInputState(userId);
	}

	// Handle user input when in input mode
	async handleUserInput(chatId: number, text: string, inputState: UserInputState): Promise<void> {
		console.log('handleUserInput called with mode:', inputState.mode, 'text:', text);
		await this.db.updateUserActivity(chatId);

		switch (inputState.mode) {
			case 'note':
				await this.processNoteInput(chatId, text);
				break;
			case 'todo':
				await this.processTodoInput(chatId, text);
				break;
			case 'expense':
				await this.processExpenseInput(chatId, text);
				break;
		}

		// Clear input state
		console.log('Clearing input state for user:', chatId);
		await this.db.clearUserInputState(chatId);
	}

	// Handle callback queries (inline button clicks)
	async handleCallbackQuery(chatId: number, messageId: number, data: string, callbackQueryId: string, firstName: string, username?: string): Promise<void> {
		await this.bot.answerCallbackQuery(callbackQueryId);
		await this.db.updateUserActivity(chatId);

		const [action, ...params] = data.split(':');

		switch (action) {
			case 'create_note':
				await this.startNoteInput(chatId, messageId);
				break;
			case 'create_todo':
				await this.startTodoInput(chatId, messageId);
				break;
			case 'create_expense':
				await this.startExpenseInput(chatId, messageId);
				break;
			case 'create_image':
				await this.startImageInput(chatId, messageId);
				break;
			case 'complete_todo':
				const todoId = params[0];
				await this.completeTodoById(chatId, messageId, todoId);
				break;
			case 'refresh_notes':
				await this.refreshNotesList(chatId, messageId);
				break;
			case 'refresh_todos':
				await this.refreshTodosList(chatId, messageId);
				break;
			case 'refresh_expenses':
				await this.refreshExpensesList(chatId, messageId);
				break;
			case 'show_summary':
				await this.showSummaryInline(chatId, messageId);
				break;

			case 'back_home':
				await this.showHomeInline(chatId, messageId, firstName);
				break;
			case 'show_help':
				await this.showHelpInline(chatId, messageId);
				break;
		}
	}

	async handleStart(chatId: number, firstName: string, username?: string): Promise<void> {
		// Create or get user
		let user = await this.db.getUser(chatId);
		if (!user) {
			user = await this.db.createUser({
				telegramId: chatId,
				firstName,
				username
			});
		}

		await this.db.updateUserActivity(chatId);

		const welcomeMessage = `🎯 *Welcome to Life Desk, ${firstName}!*

Your next-gen productivity companion with beautiful interactive interface.

*Choose a command to get started:*`;

		const keyboard = {
			inline_keyboard: [
				[
					{ text: '📝 Notes', callback_data: 'refresh_notes' },
					{ text: '✅ Todos', callback_data: 'refresh_todos' }
				],
				[
					{ text: '💰 Expenses', callback_data: 'refresh_expenses' },
					{ text: '🎨 Generate Image', callback_data: 'create_image' }
				],
				[
					{ text: '📊 Summary', callback_data: 'show_summary' }
				]
			]
		};

		await this.bot.sendMessage(chatId, welcomeMessage, 'Markdown', keyboard);
	}

	async handleHome(chatId: number, firstName: string, username?: string): Promise<void> {
		await this.db.updateUserActivity(chatId);

		const homeMessage = `🏠 *Welcome back, ${firstName}!*

*Choose what you'd like to do:*`;

		const keyboard = {
			inline_keyboard: [
				[
					{ text: '📝 Notes', callback_data: 'refresh_notes' },
					{ text: '✅ Todos', callback_data: 'refresh_todos' }
				],
				[
					{ text: '💰 Expenses', callback_data: 'refresh_expenses' },
					{ text: '🎨 Generate Image', callback_data: 'create_image' }
				],
				[
					{ text: '📊 Summary', callback_data: 'show_summary' }
				]
			]
		};

		await this.bot.sendMessage(chatId, homeMessage, 'Markdown', keyboard);
	}

	// New interactive command handlers
	async handleNoteCommand(chatId: number): Promise<void> {
		await this.refreshNotesList(chatId);
	}

	async handleTodoCommand(chatId: number): Promise<void> {
		await this.refreshTodosList(chatId);
	}

	async handleExpenseCommand(chatId: number): Promise<void> {
		await this.refreshExpensesList(chatId);
	}

	async handleImageCommand(chatId: number, prompt?: string): Promise<void> {
		await this.db.updateUserActivity(chatId);
		
		if (!prompt) {
			// No prompt provided, ask for one and set session state
			console.log('Setting image prompt session for user:', chatId);
			globalImagePromptSessions.set(chatId, Date.now());
			console.log('Current image sessions:', Array.from(globalImagePromptSessions.keys()));
			const message = `🎨 *Generate AI Image*\n\n✍️ Describe the image you want to create:\n\n_Examples:_\n• A beautiful sunset over mountains with a lake\n• A cute cat wearing a wizard hat\n• Modern city skyline at night with neon lights\n\n💡 Be descriptive for best results!`;
			await this.bot.sendMessage(chatId, message, 'Markdown');
			return;
		}

		// Prompt provided, generate image
		await this.generateAndSendImage(chatId, prompt);
	}

	// Display notes list with create button
	async refreshNotesList(chatId: number, messageId?: number): Promise<void> {
		const notes = await this.db.getRecentNotes(chatId, 5);
		
		let message = `📝 *Your Notes*\n\n`;
		
		if (notes.length === 0) {
			message += `_No notes yet. Create your first note!_\n\n`;
		} else {
			notes.forEach((note, index) => {
				const categoryEmoji = {
					'link': '🔗',
					'task': '✅',
					'idea': '💡',
					'general': '📝'
				};
				const emoji = categoryEmoji[note.category || 'general'];
				const date = new Date(note.createdAt).toLocaleDateString();
				message += `${emoji} ${note.content}\n_${date}_\n\n`;
			});
		}

		const keyboard = {
			inline_keyboard: [
				[{ text: '➕ Create New Note', callback_data: 'create_note' }],
				[{ text: '🔄 Refresh', callback_data: 'refresh_notes' }]
			]
		};

		if (messageId) {
			await this.bot.editMessageText(chatId, messageId, message, 'Markdown', keyboard);
		} else {
			await this.bot.sendMessage(chatId, message, 'Markdown', keyboard);
		}
	}

	// Display todos list with create button
	async refreshTodosList(chatId: number, messageId?: number): Promise<void> {
		const todos = await this.db.getRecentTodos(chatId, 5);
		
		let message = `✅ *Your Todos*\n\n`;
		
		if (todos.length === 0) {
			message += `_No todos yet. Create your first task!_\n\n`;
		} else {
			todos.forEach((todo, index) => {
				const status = todo.completed ? '✅' : '⏳';
				const dueText = todo.dueDate ? 
					`\n📅 _Due: ${new Date(todo.dueDate).toLocaleDateString()}_` : '';
				message += `${status} ${todo.task}${dueText}\n\n`;
			});
		}

		const keyboard = {
			inline_keyboard: [
				[{ text: '➕ Create New Todo', callback_data: 'create_todo' }],
				[{ text: '🔄 Refresh', callback_data: 'refresh_todos' }]
			]
		};

		// Add complete buttons for incomplete todos
		const incompleteTodos = todos.filter(todo => !todo.completed);
		if (incompleteTodos.length > 0) {
			keyboard.inline_keyboard.unshift(
				...incompleteTodos.slice(0, 3).map(todo => ([
					{ text: `✅ Complete: ${todo.task.substring(0, 20)}...`, callback_data: `complete_todo:${todo.id}` }
				]))
			);
		}

		if (messageId) {
			await this.bot.editMessageText(chatId, messageId, message, 'Markdown', keyboard);
		} else {
			await this.bot.sendMessage(chatId, message, 'Markdown', keyboard);
		}
	}

	// Display expenses list with create button
	async refreshExpensesList(chatId: number, messageId?: number): Promise<void> {
		const expenses = await this.db.getRecentExpenses(chatId, 5);
		
		// Calculate this week's total
		const weekStart = new Date();
		weekStart.setDate(weekStart.getDate() - weekStart.getDay());
		weekStart.setHours(0, 0, 0, 0);
		
		const weekExpenses = await this.db.getUserExpenses(chatId, weekStart.getTime());
		const weekTotal = weekExpenses.reduce((sum, exp) => sum + exp.amount, 0);
		
		let message = `💰 *Your Expenses*\n\n`;
		message += `📊 *This week: $${weekTotal.toFixed(2)}*\n\n`;
		
		if (expenses.length === 0) {
			message += `_No expenses yet. Start tracking your spending!_\n\n`;
		} else {
			expenses.forEach((expense, index) => {
				const date = new Date(expense.createdAt).toLocaleDateString();
				message += `💵 $${expense.amount} - ${expense.description}\n_${date}_\n\n`;
			});
		}

		const keyboard = {
			inline_keyboard: [
				[{ text: '➕ Add New Expense', callback_data: 'create_expense' }],
				[{ text: '🔄 Refresh', callback_data: 'refresh_expenses' }]
			]
		};

		if (messageId) {
			await this.bot.editMessageText(chatId, messageId, message, 'Markdown', keyboard);
		} else {
			await this.bot.sendMessage(chatId, message, 'Markdown', keyboard);
		}
	}

	// Start input modes
	async startNoteInput(chatId: number, messageId: number): Promise<void> {
		await this.db.setUserInputState(chatId, 'note');
		
		const message = `📝 *Create New Note*\n\n✍️ Send me your note content:\n\n_Examples:_\n• Buy milk on way home\n• Great restaurant: Tony's Pizza\n• Meeting notes: Project deadline Friday\n\n💡 I'll automatically categorize your notes for you!`;
		
		await this.bot.editMessageText(chatId, messageId, message, 'Markdown');
	}

	async startTodoInput(chatId: number, messageId: number): Promise<void> {
		await this.db.setUserInputState(chatId, 'todo');
		
		const message = `✅ *Create New Todo*\n\n✍️ Send me your task:\n\n_Examples:_\n• Call dentist tomorrow\n• Finish report due Friday\n• Buy birthday gift for mom\n\n💡 I'll automatically set due dates for you!`;
		
		await this.bot.editMessageText(chatId, messageId, message, 'Markdown');
	}

	async startExpenseInput(chatId: number, messageId: number): Promise<void> {
		await this.db.setUserInputState(chatId, 'expense');
		
		const message = `💰 *Add New Expense*\n\n✍️ Send me amount and description:\n\n_Examples:_\n• 15 coffee\n• 120 groceries\n• 50 dinner with Sarah\n\n💡 Just amount + description, that's it!`;
		
		await this.bot.editMessageText(chatId, messageId, message, 'Markdown');
	}

	async startImageInput(chatId: number, messageId: number): Promise<void> {
		// Set session state for image input
		console.log('Setting image prompt session for user (inline):', chatId);
		globalImagePromptSessions.set(chatId, Date.now());
		console.log('Current image sessions:', Array.from(globalImagePromptSessions.keys()));
		
		const message = `🎨 *Generate AI Image*\n\n✍️ Describe the image you want to create:\n\n_Examples:_\n• A beautiful sunset over mountains with a lake\n• A cute cat wearing a wizard hat\n• Modern city skyline at night with neon lights\n\n💡 Be descriptive for best results!`;
		
		await this.bot.editMessageText(chatId, messageId, message, 'Markdown');
	}

	// Process input
	async processNoteInput(chatId: number, text: string): Promise<void> {
		const note = await this.db.createNote({
			userId: chatId,
			content: text.trim(),
			category: categorizeNote(text)
		});

		const categoryEmoji = {
			'link': '🔗',
			'task': '✅', 
			'idea': '💡',
			'general': '📝'
		};

		const message = `${categoryEmoji[note.category || 'general']} *Note saved!*\n\n"${text}"\n\n✨ _Automatically categorized as ${note.category}_`;
		
		const keyboard = {
			inline_keyboard: [
				[{ text: '📝 View All Notes', callback_data: 'refresh_notes' }],
				[{ text: '➕ Add Another Note', callback_data: 'create_note' }]
			]
		};

		await this.bot.sendMessage(chatId, message, 'Markdown', keyboard);
	}

	async processTodoInput(chatId: number, text: string): Promise<void> {
		const dueDate = parseDateFromText(text.toLowerCase());
		
		const todo = await this.db.createTodo({
			userId: chatId,
			task: text.trim(),
			dueDate,
			completed: false
		});

		let message = `✅ *Todo created!*\n\n"${text}"`;
		
		if (dueDate) {
			const date = new Date(dueDate);
			message += `\n📅 _Due: ${date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}_`;
		}

		const keyboard = {
			inline_keyboard: [
				[{ text: '✅ View All Todos', callback_data: 'refresh_todos' }],
				[{ text: '➕ Add Another Todo', callback_data: 'create_todo' }]
			]
		};

		await this.bot.sendMessage(chatId, message, 'Markdown', keyboard);
	}

	async processExpenseInput(chatId: number, text: string): Promise<void> {
		const parsed = parseExpense(text.trim());
		
		if (!parsed) {
			const message = `❌ *Invalid format!*\n\nPlease use: amount + description\n\n_Examples:_\n• 15 coffee\n• 120 groceries\n• 50 dinner with Sarah`;
			
			const keyboard = {
				inline_keyboard: [
					[{ text: '🔄 Try Again', callback_data: 'create_expense' }]
				]
			};
			
			await this.bot.sendMessage(chatId, message, 'Markdown', keyboard);
			return;
		}

		const expense = await this.db.createExpense({
			userId: chatId,
			amount: parsed.amount,
			description: parsed.description
		});

		// Get this week's total
		const weekStart = new Date();
		weekStart.setDate(weekStart.getDate() - weekStart.getDay());
		weekStart.setHours(0, 0, 0, 0);
		
		const expenses = await this.db.getUserExpenses(chatId, weekStart.getTime());
		const weekTotal = expenses.reduce((sum, exp) => sum + exp.amount, 0);

		const message = `💰 *Expense logged!*\n\n$${parsed.amount} - ${parsed.description}\n\n📊 _This week: $${weekTotal.toFixed(2)}_`;
		
		const keyboard = {
			inline_keyboard: [
				[{ text: '💰 View All Expenses', callback_data: 'refresh_expenses' }],
				[{ text: '➕ Add Another Expense', callback_data: 'create_expense' }]
			]
		};

		await this.bot.sendMessage(chatId, message, 'Markdown', keyboard);
	}

	async processImageInput(chatId: number, prompt: string): Promise<void> {
		console.log('processImageInput called with:', { chatId, prompt });
		try {
			await this.generateAndSendImage(chatId, prompt);
			console.log('generateAndSendImage completed successfully');
		} catch (error) {
			console.error('Error in processImageInput:', error);
			throw error; // Re-throw to be caught by the main handler
		}
	}

	// Image prompt session methods
	async isWaitingForImagePrompt(chatId: number): Promise<boolean> {
		// Clean up old sessions first
		cleanupOldImageSessions();
		
		const sessionTime = globalImagePromptSessions.get(chatId);
		if (!sessionTime) {
			console.log('isWaitingForImagePrompt check for user', chatId, ': false (no session)');
			return false;
		}
		
		// Check if session is still valid (within 10 minutes)
		const isValid = Date.now() - sessionTime < 10 * 60 * 1000;
		if (!isValid) {
			globalImagePromptSessions.delete(chatId);
			console.log('isWaitingForImagePrompt check for user', chatId, ': false (expired)');
			return false;
		}
		
		console.log('isWaitingForImagePrompt check for user', chatId, ': true');
		console.log('All active sessions:', Array.from(globalImagePromptSessions.keys()));
		return true;
	}

	async handleImagePrompt(chatId: number, prompt: string): Promise<void> {
		// Clear the session state
		console.log('Clearing image prompt session for user:', chatId);
		globalImagePromptSessions.delete(chatId);
		
		// Generate the image
		await this.generateAndSendImage(chatId, prompt);
	}

	async generateAndSendImage(chatId: number, prompt: string): Promise<void> {
		let statusMessageId: number | null = null;
		
		try {
			console.log('Starting image generation for prompt:', prompt);
			console.log('API Key available:', this.freepikApiKey ? 'Yes' : 'No');
			
			// Send initial status message
			const statusResponse = await this.bot.sendMessage(chatId, '🎨 Generating your masterpiece...');
			const statusData = await statusResponse.json() as any;
			statusMessageId = statusData.result?.message_id;

			console.log('Making request to Freepik API with prompt:', prompt);

			// Make request to Freepik API with a timeout
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 180000); // 3 minute timeout

			const FREEPIK_API_URL = `https://api.freepik.com/v1/ai/text-to-image`;
			const requestBody = {
				prompt: prompt,
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

			console.log('Sending request to Freepik API with body:', JSON.stringify(requestBody));

			const response = await fetch(FREEPIK_API_URL, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-freepik-api-key": this.freepikApiKey,
				},
				body: JSON.stringify(requestBody),
				signal: controller.signal
			});

			clearTimeout(timeout);

			console.log('API Response status:', response.status, response.statusText);

			let data: FreepikImageResponse;
			try {
				data = await response.json() as FreepikImageResponse;
				console.log('API Response structure:', {
					hasData: !!data,
					hasDataArray: !!data?.data,
					arrayLength: data?.data?.length,
					firstItemKeys: data?.data?.[0] ? Object.keys(data.data[0]) : [],
					fullResponse: JSON.stringify(data).substring(0, 500) // First 500 chars for debugging
				});
			} catch (jsonError) {
				console.error('Failed to parse API response as JSON:', jsonError);
				const responseText = await response.text();
				console.error('Raw response:', responseText.substring(0, 1000));
				throw new Error('Invalid API response format');
			}

			if (!response.ok || !data || !data.data || data.data.length === 0) {
				console.error('API Error Response:', {
					status: response.status,
					statusText: response.statusText,
					data: data
				});
				throw new Error(data.message || 'Image generation failed');
			}

			const base64Image = data.data[0]?.base64;
			if (!base64Image) {
				console.error('Invalid API response format:', data);
				throw new Error('No image data in response');
			}

			console.log('Received base64 image data, length:', base64Image.length);

			// Convert base64 to Uint8Array
			let bytes: Uint8Array;
			try {
				// Try using atob first
				const binaryString = atob(base64Image);
				bytes = new Uint8Array(binaryString.length);
				for (let i = 0; i < binaryString.length; i++) {
					bytes[i] = binaryString.charCodeAt(i);
				}
				console.log('Converted base64 to Uint8Array using atob, length:', bytes.length);
			} catch (atobError) {
				console.error('atob failed:', atobError);
				throw new Error('Failed to decode base64 image data');
			}

			// Delete the status message
			if (statusMessageId) {
				try {
					await this.bot.deleteMessage(chatId, statusMessageId);
				} catch (error) {
					console.log('Failed to delete status message:', error);
				}
			}

			// Send the image using sendPhoto with form data
			const formData = new FormData();
			formData.append('chat_id', chatId.toString());
			formData.append('photo', new Blob([bytes], { type: 'image/png' }), 'generated_image.png');
			formData.append('caption', `🎨 Generated image for: "${prompt}"`);

			const photoResponse = await fetch(`https://api.telegram.org/bot${this.bot.botToken}/sendPhoto`, {
				method: 'POST',
				body: formData
			});

			if (!photoResponse.ok) {
				throw new Error('Failed to send image to Telegram');
			}

			console.log('Successfully sent image to Telegram');

		} catch (error) {
			console.error('Detailed error in generateAndSendImage:', {
				error: error instanceof Error ? {
					name: error.name,
					message: error.message,
					stack: error.stack
				} : error,
				prompt: prompt,
				apiKey: this.freepikApiKey ? 'Present (length: ' + this.freepikApiKey.length + ')' : 'Missing'
			});

			// Update the status message with error
			const errorMessage = error instanceof Error && error.name === 'AbortError' 
				? '⚠️ Image generation timed out. Please try again.'
				: '⚠️ Failed to generate image. Please try again later.';

			if (statusMessageId) {
				try {
					await this.bot.editMessageText(chatId, statusMessageId, errorMessage);
				} catch (editError) {
					console.log('Failed to edit status message:', editError);
					// Send new error message if editing fails
					await this.bot.sendMessage(chatId, errorMessage);
				}
			} else {
				await this.bot.sendMessage(chatId, errorMessage);
			}
		} finally {
			// Always clear the image prompt session state
			console.log('Clearing image prompt session in finally block for user:', chatId);
			globalImagePromptSessions.delete(chatId);
		}
	}

	// Complete todo
	async completeTodoById(chatId: number, messageId: number, todoId: string): Promise<void> {
		await this.db.completeTodo(todoId);
		
		const message = `✅ *Todo completed!*\n\n🎉 Great job! Keep up the momentum!`;
		
		const keyboard = {
			inline_keyboard: [
				[{ text: '✅ View All Todos', callback_data: 'refresh_todos' }]
			]
		};

		await this.bot.editMessageText(chatId, messageId, message, 'Markdown', keyboard);
	}



	async handleSummary(chatId: number): Promise<void> {
		await this.db.updateUserActivity(chatId);

		const summary = await this.db.getWeeklySummary(chatId);

		const completionRate = summary.todosTotal > 0 
			? Math.round((summary.todosCompleted / summary.todosTotal) * 100)
			: 0;

		const spendingChange = summary.lastWeekSpent > 0
			? ((summary.totalSpent - summary.lastWeekSpent) / summary.lastWeekSpent * 100).toFixed(1)
			: '0';

		const changeEmoji = parseFloat(spendingChange) > 0 ? '📈' : '📉';

		const summaryMessage = `📊 *Your Weekly Summary*

📝 *${summary.notesCount}* notes saved this week
✅ *${summary.todosCompleted}/${summary.todosTotal}* todos completed (${completionRate}%)
💰 *$${summary.totalSpent}* spent (${changeEmoji} ${spendingChange}% vs last week)
🎯 Most productive day: *${summary.mostProductiveDay}*

${completionRate >= 80 ? '🔥 Amazing productivity!' : completionRate >= 60 ? '👍 Good progress!' : '💪 Keep building momentum!'}

_Next summary: Every Sunday automatically_`;

		const keyboard = {
			inline_keyboard: [
				[
					{ text: '📝 Notes', callback_data: 'refresh_notes' },
					{ text: '✅ Todos', callback_data: 'refresh_todos' }
				],
				[
					{ text: '💰 Expenses', callback_data: 'refresh_expenses' },
					{ text: '🎨 Generate Image', callback_data: 'create_image' }
				]
			]
		};

		await this.bot.sendMessage(chatId, summaryMessage, 'Markdown', keyboard);
	}

	async handleHelp(chatId: number): Promise<void> {
		const helpMessage = `🎯 *Life Desk - Next-Gen Bot*

*Interactive Commands:*

📝 */note* - Beautiful note management
   • View your notes with inline buttons
   • Create new notes interactively
   • Auto-categorization (link, task, idea, general)

✅ */todo* - Smart task management  
   • Interactive todo list with completion buttons
   • Natural language dates ("tomorrow", "Friday")
   • One-tap task completion

💰 */expense* - Elegant expense tracking
   • Interactive expense logging
   • Weekly totals and insights
   • Simple format: amount + description

🎨 */image* - AI Image Generation
   • Generate beautiful images from text prompts
   • Powered by Freepik AI
   • High-quality artistic results

📊 */summary* - Beautiful weekly overview
   • Comprehensive productivity insights
   • Spending analysis and trends
   • Motivational feedback

💡 *Pro Features:*
• Beautiful inline keyboards for everything
• No typing commands - just tap buttons!
• Smart categorization and date parsing
• Real-time updates and feedback

Ready for next-gen productivity? 🚀`;

		const keyboard = {
			inline_keyboard: [
				[
					{ text: '📝 Try Notes', callback_data: 'refresh_notes' },
					{ text: '✅ Try Todos', callback_data: 'refresh_todos' }
				],
				[
					{ text: '💰 Try Expenses', callback_data: 'refresh_expenses' },
					{ text: '🎨 Generate Image', callback_data: 'create_image' }
				],
				[
					{ text: '📊 View Summary', callback_data: 'show_summary' }
				]
			]
		};

		await this.bot.sendMessage(chatId, helpMessage, 'Markdown', keyboard);
	}

	// Show summary inline (for callback)
	async showSummaryInline(chatId: number, messageId: number): Promise<void> {
		const summary = await this.db.getWeeklySummary(chatId);

		const completionRate = summary.todosTotal > 0 
			? Math.round((summary.todosCompleted / summary.todosTotal) * 100)
			: 0;

		const spendingChange = summary.lastWeekSpent > 0
			? ((summary.totalSpent - summary.lastWeekSpent) / summary.lastWeekSpent * 100).toFixed(1)
			: '0';

		const changeEmoji = parseFloat(spendingChange) > 0 ? '📈' : '📉';

		const summaryMessage = `📊 *Your Weekly Summary*

📝 *${summary.notesCount}* notes saved this week
✅ *${summary.todosCompleted}/${summary.todosTotal}* todos completed (${completionRate}%)
💰 *$${summary.totalSpent}* spent (${changeEmoji} ${spendingChange}% vs last week)
🎯 Most productive day: *${summary.mostProductiveDay}*

${completionRate >= 80 ? '🔥 Amazing productivity!' : completionRate >= 60 ? '👍 Good progress!' : '💪 Keep building momentum!'}

_Next summary: Every Sunday automatically_`;

		const keyboard = {
			inline_keyboard: [
				[
					{ text: '📝 Notes', callback_data: 'refresh_notes' },
					{ text: '✅ Todos', callback_data: 'refresh_todos' }
				],
				[
					{ text: '💰 Expenses', callback_data: 'refresh_expenses' },
					{ text: '🎨 Generate Image', callback_data: 'create_image' }
				]
			]
		};

		await this.bot.editMessageText(chatId, messageId, summaryMessage, 'Markdown', keyboard);
	}

	// Show help inline (for callback)
	async showHelpInline(chatId: number, messageId: number): Promise<void> {
		const helpMessage = `🎯 *Life Desk - Next-Gen Bot*

*Interactive Commands:*

📝 */note* - Beautiful note management
   • View your notes with inline buttons
   • Create new notes interactively
   • Auto-categorization (link, task, idea, general)

✅ */todo* - Smart task management  
   • Interactive todo list with completion buttons
   • Natural language dates ("tomorrow", "Friday")
   • One-tap task completion

💰 */expense* - Elegant expense tracking
   • Interactive expense logging
   • Weekly totals and insights
   • Simple format: amount + description

📊 */summary* - Beautiful weekly overview
   • Comprehensive productivity insights
   • Spending analysis and trends
   • Motivational feedback

💡 *Pro Features:*
• Beautiful inline keyboards for everything
• No typing commands - just tap buttons!
• Smart categorization and date parsing
• Real-time updates and feedback

Ready for next-gen productivity? 🚀`;

		const keyboard = {
			inline_keyboard: [
				[
					{ text: '📝 Try Notes', callback_data: 'refresh_notes' },
					{ text: '✅ Try Todos', callback_data: 'refresh_todos' }
				],
				[
					{ text: '💰 Try Expenses', callback_data: 'refresh_expenses' },
					{ text: '📊 View Summary', callback_data: 'show_summary' }
				]
			]
		};

		await this.bot.editMessageText(chatId, messageId, helpMessage, 'Markdown', keyboard);
	}

	async handleUnknownCommand(chatId: number, text: string): Promise<void> {
		const response = `🤔 *I didn't understand that command.*

*Available commands:*
📝 /note - Manage your notes
✅ /todo - Manage your tasks  
💰 /expense - Track expenses
🎨 /image - Generate AI images
📊 /summary - View weekly summary
🏠 /home - Main menu
❓ /help - Show help

*Or just send me any text for AI assistance!*`;

		await this.bot.sendMessage(chatId, response, 'Markdown');
	}





	async showHomeInline(chatId: number, messageId: number, firstName: string): Promise<void> {
		const homeMessage = `🏠 *Welcome back, ${firstName}!*

*Choose what you'd like to do:*`;

		const keyboard = {
			inline_keyboard: [
				[
					{ text: '📝 Notes', callback_data: 'refresh_notes' },
					{ text: '✅ Todos', callback_data: 'refresh_todos' }
				],
				[
					{ text: '💰 Expenses', callback_data: 'refresh_expenses' },
					{ text: '🎨 Generate Image', callback_data: 'create_image' }
				],
				[
					{ text: '📊 Summary', callback_data: 'show_summary' }
				]
			]
		};

		await this.bot.editMessageText(chatId, messageId, homeMessage, 'Markdown', keyboard);
	}

	// Timezone handling
	async handleTimezone(chatId: number, text: string): Promise<void> {
		await this.db.updateUserActivity(chatId);
		
		// If no timezone provided, show current timezone and instructions
		if (!text || text.trim() === '') {
			const user = await this.db.getUser(chatId);
			const currentTimezone = user?.timezone || 'UTC';
			const currentOffset = user?.timezoneOffset || 0;
			
			const message = `🕒 *Timezone Settings*

Your current timezone: *${currentTimezone}*
Offset from UTC: *${currentOffset} minutes*

To set your timezone, use:
\`/timezone [offset]\`

Examples:
\`/timezone -120\` (UTC-2:00)
\`/timezone 0\` (UTC)
\`/timezone 60\` (UTC+1:00)
\`/timezone 330\` (UTC+5:30)

Your timezone setting is saved for future use.`;

			await this.bot.sendMessage(chatId, message, 'Markdown');
			return;
		}
		
		// Try to parse the timezone offset
		try {
			const offset = parseInt(text.trim());
			if (isNaN(offset) || offset < -720 || offset > 840) {
				// Valid timezone offsets are between -12:00 and +14:00 hours
				await this.bot.sendMessage(chatId, 
					'❌ Invalid timezone offset. Please provide a number between -720 and 840 (representing minutes from UTC).',
					'Markdown'
				);
				return;
			}
			
			// Calculate timezone name
			const hours = Math.abs(Math.floor(offset / 60));
			const minutes = Math.abs(offset % 60);
			const sign = offset < 0 ? '-' : '+';
			const timezone = `UTC${sign}${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
			
			// Update user's timezone
			await this.db.updateUserTimezone(chatId, timezone, offset);
			
			// Confirm to user
			const message = `✅ *Timezone Updated*

Your timezone is now set to: *${timezone}*
Offset from UTC: *${offset} minutes*

Your timezone setting has been saved.`;

			await this.bot.sendMessage(chatId, message, 'Markdown');
			
		} catch (error) {
			console.error('Error setting timezone:', error);
			await this.bot.sendMessage(chatId, 
				'❌ Something went wrong setting your timezone. Please try again with a valid offset in minutes.',
				'Markdown'
			);
		}
	}
	
	// AI Features
	async handleAIQuery(chatId: number, text: string, firstName: string, username?: string): Promise<void> {
		await this.db.updateUserActivity(chatId);

		// Check if user is asking about the bot creator
		const creatorKeywords = ['who created', 'who made', 'who built', 'who developed', 'creator', 'developer', 'author', 'who is behind'];
		const isCreatorQuestion = creatorKeywords.some(keyword => 
			text.toLowerCase().includes(keyword) && (text.toLowerCase().includes('bot') || text.toLowerCase().includes('this'))
		);

		if (isCreatorQuestion) {
			const creatorResponse = `🎯 This bot was created by Chico!
He's an amazing developer who built this next-gen productivity assistant. Chico designed this bot to help people be more productive with beautiful interactive features and AI capabilities!`;

			const keyboard = {
				inline_keyboard: [
					[
						{
							text: '💬 Contact Chico', 
							url: 'https://t.me/chicorota0'
						},
						{
							text: '🏠 Home',
							callback_data: 'show_home'
						}
					],
					[
						{
							text: '📝 Notes',
							callback_data: 'refresh_notes'
						},
						{
							text: '✅ Tasks',
							callback_data: 'refresh_todos'
						}
					]
				]
			};

			console.log('Sending creator response with keyboard:', JSON.stringify(keyboard));
			await this.bot.sendMessage(chatId, creatorResponse, 'Markdown', keyboard);
			return;
		}

		// Send processing message
		const processingMessage = await this.bot.sendMessage(
			chatId, 
			'🤖 *AI is thinking...*\n\n⏳ _Your request is being processed, please wait a moment..._', 
			'Markdown'
		);

		try {
			// Use Cloudflare AI to generate response
			const aiResponse = await this.ai.run('@cf/meta/llama-3.1-8b-instruct', {
			messages: [
				{
					role: 'system',
					content: `You are a helpful AI assistant integrated into a productivity bot called Life Desk. 
					Keep responses concise, friendly, and helpful. 
					If the user asks about productivity, notes, todos, or expenses, guide them to use the bot's features.
					User's name is ${firstName}.
					
					IMPORTANT CONTEXT:
					- This bot helps with notes, todos, and expense tracking
					- When users give short responses like "no have", "no way", acknowledge them naturally
					- Be understanding and don't over-analyze casual responses
					
					CREATOR INFO: If someone asks who created this bot, who made this, who is the developer, or similar questions, respond with:
					"🎯 This bot was created by Chico! He's an amazing developer who built this next-gen productivity assistant. Chico designed this bot to help people be more productive with beautiful interactive features and AI capabilities!"
					
					Always mention Chico as the creator when asked about the bot's origin.`
				},
				{
					role: 'user',
					content: text
				}
			],
			max_tokens: 512
		});

		const response = aiResponse.response || 'Sorry, I could not process your request.';

		// Check if AI response contains creator information and add keyboard
		const isCreatorResponse = response.toLowerCase().includes('chico') && 
								 (response.toLowerCase().includes('created') || response.toLowerCase().includes('developer'));

		let keyboard = undefined;
		if (isCreatorResponse) {
			keyboard = {
				inline_keyboard: [
					[
						{
							text: '💬 Contact Chico', 
							url: 'https://t.me/chicorota0'
						},
						{
							text: '🏠 Home',
							callback_data: 'show_home'
						}
					],
					[
						{
							text: '📝 Notes',
							callback_data: 'refresh_notes'
						},
						{
							text: '✅ Tasks',
							callback_data: 'refresh_todos'
						}
					]
				]
			};
			console.log('AI response contains creator info, adding keyboard:', JSON.stringify(keyboard));
		}

		// Edit the processing message with the AI response
		const processingResponse = await processingMessage.json() as any;
		const messageId = processingResponse.result?.message_id;

		if (messageId) {
			await this.bot.editMessageText(
				chatId, 
				messageId, 
				`🤖 *AI Assistant*\n\n${response}`, 
				'Markdown',
				keyboard
			);
		} else {
			await this.bot.sendMessage(chatId, `🤖 *AI Assistant*\n\n${response}`, 'Markdown', keyboard);
		}

	} catch (error) {
		console.error('AI Error:', error);
		
		// Edit processing message with error
		const processingResponse = await processingMessage.json() as any;
		const messageId = processingResponse.result?.message_id;

		if (messageId) {
			await this.bot.editMessageText(
				chatId, 
				messageId, 
				'❌ *AI Error*\n\n_Sorry, I encountered an issue processing your request. Please try again._', 
				'Markdown'
			);
		}
	}
}

	async handlePhotoMessage(chatId: number, photos: TelegramPhoto[], caption?: string, firstName?: string, username?: string): Promise<void> {
		await this.db.updateUserActivity(chatId);

		// Send processing message
		const processingMessage = await this.bot.sendMessage(
			chatId, 
			'🖼️ *AI is analyzing your image...*\n\n⏳ _Processing image, please wait a moment..._', 
			'Markdown'
		);

		try {
			// Get the largest photo (best quality)
			const photo = photos[photos.length - 1];
			
			// Get file info from Telegram
			const fileResponse = await fetch(`https://api.telegram.org/bot${this.bot.botToken}/getFile?file_id=${photo.file_id}`);
			const fileData = await fileResponse.json() as any;
			
			if (!fileData.ok) {
				
				throw new Error('Failed to get file info');
			}
			
			// Download the image
			const imageUrl = `https://api.telegram.org/file/bot${this.bot.botToken}/${fileData.result.file_path}`;
			const imageResponse = await fetch(imageUrl);
			const imageBuffer = await imageResponse.arrayBuffer();
			
			// Convert to base64 for AI processing
			const uint8Array = new Uint8Array(imageBuffer);
			const base64Image = btoa(String.fromCharCode.apply(null, Array.from(uint8Array)));
			
			// Use Cloudflare AI to analyze the image
			const aiResponse = await this.ai.run('@cf/llava-hf/llava-1.5-7b-hf', {
				image: Array.from(new Uint8Array(imageBuffer)),
				prompt: caption ? 
					`Analyze this image and also consider this caption: "${caption}". Provide a detailed description of what you see.` :
					"Analyze this image and provide a detailed description of what you see.",
				max_tokens: 512
			});

			const description = aiResponse.description || 'I can see an image, but I cannot provide a detailed description at the moment.';

			// Edit the processing message with the AI response
			const processingResponse = await processingMessage.json() as any;
			const messageId = processingResponse.result?.message_id;

			if (messageId) {
				await this.bot.editMessageText(
					chatId, 
					messageId, 
					`🖼️ *Image Analysis*\n\n${description}`, 
					'Markdown'
				);
			} else {
				await this.bot.sendMessage(chatId, `🖼️ *Image Analysis*\n\n${description}`, 'Markdown');
			}

		} catch (error) {
			console.error('Image Analysis Error:', error);
			
			// Edit processing message with error
			const processingResponse = await processingMessage.json() as any;
			const messageId = processingResponse.result?.message_id;

			if (messageId) {
				await this.bot.editMessageText(
					chatId, 
					messageId, 
					'❌ *Image Analysis Error*\n\n_Sorry, I could not analyze your image. Please try again with a different image._', 
					'Markdown'
				);
			}
		}
	}
}
