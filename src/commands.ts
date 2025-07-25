/**
 * Life Desk Bot Commands
 * 
 * Implements the 4 essential commands: /note, /todo, /expense, /summary
 */

import { TelegramBot, TelegramPhoto } from './webhook';

// Types for our data structures
export interface User {
	telegramId: number;
	firstName: string;
	username?: string;
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

export interface Reminder {
	id: number;
	userId: number;
	content: string;
	reminderTime: number;
	isSent: boolean;
	sourceType: 'note' | 'todo' | 'manual';
	sourceId?: string;
	createdAt: number;
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
			INSERT INTO users (telegram_id, first_name, username, created_at, last_active_at)
			VALUES (?, ?, ?, ?, ?)
		`).bind(user.telegramId, user.firstName, user.username || null, now, now).run();

		return {
			...user,
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
			createdAt: result.created_at as number,
			lastActiveAt: result.last_active_at as number
		};
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

	// Smart Reminders management
	async createReminder(userId: number, content: string, reminderTime: number, sourceType: 'note' | 'todo' | 'manual', sourceId?: string): Promise<number> {
		try {
			const result = await this.db.prepare(`
				INSERT INTO reminders (user_id, content, reminder_time, source_type, source_id, created_at)
				VALUES (?, ?, ?, ?, ?, ?)
			`).bind(userId, content, reminderTime, sourceType, sourceId || null, Date.now()).run();
			
			return result.meta.last_row_id as number;
		} catch (error) {
			console.error('Error creating reminder:', error);
			throw error;
		}
	}

	async getPendingReminders(): Promise<Reminder[]> {
		try {
			const now = Date.now();
			const result = await this.db.prepare(`
				SELECT * FROM reminders 
				WHERE is_sent = 0 AND reminder_time <= ?
				ORDER BY reminder_time ASC
			`).bind(now).all();
			
			if (!result.results) {
				return [];
			}
			
			return result.results.map(row => ({
				id: row.id as number,
				userId: row.user_id as number,
				content: row.content as string,
				reminderTime: row.reminder_time as number,
				isSent: Boolean(row.is_sent),
				sourceType: row.source_type as 'note' | 'todo' | 'manual',
				sourceId: row.source_id as string | undefined,
				createdAt: row.created_at as number
			}));
		} catch (error) {
			console.error('Error getting pending reminders:', error);
			return [];
		}
	}

	async markReminderSent(reminderId: number): Promise<void> {
		try {
			await this.db.prepare(`
				UPDATE reminders SET is_sent = 1 WHERE id = ?
			`).bind(reminderId).run();
		} catch (error) {
			console.error('Error marking reminder as sent:', error);
		}
	}

	async getUpcomingReminders(userId: number, limit: number = 5): Promise<Reminder[]> {
		try {
			const now = Date.now();
			const result = await this.db.prepare(`
				SELECT * FROM reminders 
				WHERE user_id = ? AND is_sent = 0 AND reminder_time > ?
				ORDER BY reminder_time ASC
				LIMIT ?
			`).bind(userId, now, limit).all();
			
			if (!result.results) {
				return [];
			}
			
			return result.results.map(row => ({
				id: row.id as number,
				userId: row.user_id as number,
				content: row.content as string,
				reminderTime: row.reminder_time as number,
				isSent: Boolean(row.is_sent),
				sourceType: row.source_type as 'note' | 'todo' | 'manual',
				sourceId: row.source_id as string | undefined,
				createdAt: row.created_at as number
			}));
		} catch (error) {
			console.error('Error getting upcoming reminders:', error);
			return [];
		}
	}

	async getUserReminders(userId: number, limit: number = 10): Promise<Reminder[]> {
		try {
			const result = await this.db.prepare(`
				SELECT * FROM reminders 
				WHERE user_id = ? AND is_sent = 0
				ORDER BY reminder_time ASC
				LIMIT ?
			`).bind(userId, limit).all();
			
			if (!result.results) {
				return [];
			}
			
			return result.results.map(row => ({
				id: row.id as number,
				userId: row.user_id as number,
				content: row.content as string,
				reminderTime: row.reminder_time as number,
				isSent: Boolean(row.is_sent),
				sourceType: row.source_type as 'note' | 'todo' | 'manual',
				sourceId: row.source_id as string | undefined,
				createdAt: row.created_at as number
			}));
		} catch (error) {
			console.error('Error getting user reminders:', error);
			return [];
		}
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

// Command handlers
export class CommandHandler {
	private bot: TelegramBot;
	private db: DatabaseService;
	private ai: Ai;

	constructor(bot: TelegramBot, database: D1Database, ai: Ai) {
		this.bot = bot;
		this.db = new DatabaseService(database);
		this.ai = ai;
	}

	// Check if user is in input mode
	async getUserInputMode(userId: number): Promise<UserInputState | null> {
		return await this.db.getUserInputState(userId);
	}

	// Handle user input when in input mode
	async handleUserInput(chatId: number, text: string, inputState: UserInputState): Promise<void> {
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
			case 'show_reminders':
				await this.showRemindersInline(chatId, messageId);
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
					{ text: '🎯 Reminders', callback_data: 'show_reminders' }
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
					{ text: '🎯 Reminders', callback_data: 'show_reminders' }
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
		
		const message = `📝 *Create New Note*\n\n✍️ Send me your note content:\n\n_Examples:_\n• Buy milk on way home\n• Great restaurant: Tony's Pizza\n• Meeting notes: Project deadline Friday\n\n🎯 *Add Reminders:* Use "Reminder at" keyword!\n• "Wake me up Reminder at 8am"\n• "Call mom Reminder at today 5:10 pm"\n• "Meeting Reminder at tomorrow 3pm"\n• "Birthday party Reminder at 12:2:2026 7pm"\n\n💡 I'll automatically categorize and set reminders for you!`;
		
		await this.bot.editMessageText(chatId, messageId, message, 'Markdown');
	}

	async startTodoInput(chatId: number, messageId: number): Promise<void> {
		await this.db.setUserInputState(chatId, 'todo');
		
		const message = `✅ *Create New Todo*\n\n✍️ Send me your task:\n\n_Examples:_\n• Call dentist tomorrow\n• Finish report due Friday\n• Buy birthday gift for mom\n\n🎯 *Add Reminders:* Use "Reminder at" keyword!\n• "Call dentist Reminder at tomorrow 9am"\n• "Submit report Reminder at today 6pm"\n• "Buy gift Reminder at 15:12:2025 2pm"\n\n💡 I'll automatically set reminders and due dates for you!`;
		
		await this.bot.editMessageText(chatId, messageId, message, 'Markdown');
	}

	async startExpenseInput(chatId: number, messageId: number): Promise<void> {
		await this.db.setUserInputState(chatId, 'expense');
		
		const message = `💰 *Add New Expense*\n\n✍️ Send me amount and description:\n\n_Examples:_\n• 15 coffee\n• 120 groceries\n• 50 dinner with Sarah\n\n💡 Just amount + description, that's it!`;
		
		await this.bot.editMessageText(chatId, messageId, message, 'Markdown');
	}

	// Process input
	async processNoteInput(chatId: number, text: string): Promise<void> {
		const note = await this.db.createNote({
			userId: chatId,
			content: text.trim(),
			category: categorizeNote(text)
		});

		// Check for reminder keywords in text
		let reminderMessage = '';
		try {
			const reminderDetection = this.parseReminderFromText(text);
			console.log('Reminder detection result:', reminderDetection);

			if (reminderDetection.hasReminder && reminderDetection.reminderTime && reminderDetection.cleanText) {
				console.log('Creating reminder:', {
					userId: chatId,
					content: reminderDetection.cleanText,
					reminderTime: reminderDetection.reminderTime,
					readableTime: new Date(reminderDetection.reminderTime).toLocaleString()
				});
				
				await this.db.createReminder(
					chatId, 
					reminderDetection.cleanText, 
					reminderDetection.reminderTime, 
					'note', 
					note.id
				);
				
				const timeDisplay = this.formatReminderTime(reminderDetection.reminderTime);
				reminderMessage = `\n\n🎯 *Reminder Set!*\n⏰ ${timeDisplay}\n💭 "${reminderDetection.cleanText}"`;
			} else {
				console.log('No reminder detected in text:', text);
			}
		} catch (error) {
			console.error('Error creating reminder for note:', error);
			// Continue without reminder - don't break the note creation
		}

		const categoryEmoji = {
			'link': '🔗',
			'task': '✅', 
			'idea': '💡',
			'general': '📝'
		};

		const message = `${categoryEmoji[note.category || 'general']} *Note saved!*\n\n"${text}"\n\n✨ _Automatically categorized as ${note.category}_${reminderMessage}`;
		
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

		// Check for reminder keywords in text
		let reminderMessage = '';
		try {
			const reminderDetection = this.parseReminderFromText(text);

			if (reminderDetection.hasReminder && reminderDetection.reminderTime && reminderDetection.cleanText) {
				await this.db.createReminder(
					chatId, 
					reminderDetection.cleanText, 
					reminderDetection.reminderTime, 
					'todo', 
					todo.id
				);
				
				const timeDisplay = this.formatReminderTime(reminderDetection.reminderTime);
				reminderMessage = `\n\n🎯 *Reminder Set!*\n⏰ ${timeDisplay}\n💭 "${reminderDetection.cleanText}"`;
			}
		} catch (error) {
			console.error('Error creating reminder for todo:', error);
			// Continue without reminder - don't break the todo creation
		}

		let message = `✅ *Todo created!*\n\n"${text}"`;
		
		if (dueDate) {
			const date = new Date(dueDate);
			message += `\n📅 _Due: ${date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}_`;
		}

		message += reminderMessage;

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
					{ text: '💰 Expenses', callback_data: 'refresh_expenses' }
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
					{ text: '💰 Expenses', callback_data: 'refresh_expenses' }
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
   • 🎯 Add "Reminder at" keyword for reminders

✅ */todo* - Smart task management  
   • Interactive todo list with completion buttons
   • Natural language dates ("tomorrow", "Friday")
   • One-tap task completion
   • 🎯 Add "Reminder at" keyword for reminders

💰 */expense* - Elegant expense tracking
   • Interactive expense logging
   • Weekly totals and insights
   • Simple format: amount + description

📊 */summary* - Beautiful weekly overview
   • Comprehensive productivity insights
   • Spending analysis and trends
   • Motivational feedback

💡 *Pro Features:*
• 🎯 Keyword-based reminders: "Reminder at tomorrow 8am"
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
📊 /summary - View weekly summary
🏠 /home - Main menu
❓ /help - Show help

*Or just send me any text for AI assistance!*`;

		await this.bot.sendMessage(chatId, response, 'Markdown');
	}

	async handleReminders(chatId: number): Promise<void> {
		await this.db.updateUserActivity(chatId);

		try {
			const reminders = await this.db.getUserReminders(chatId, 10);

		if (reminders.length === 0) {
			const response = `🎯 *Smart Reminders*

You don't have any pending reminders yet.

💡 *How it works:*
When you create notes or todos with time references like "tomorrow", "next week", or "at 3pm", I'll automatically set smart reminders for you!

*Examples:*
📝 "Call mom tomorrow" → Reminder set for tomorrow 9 AM
✅ "Meeting at 3pm" → Reminder set for today 3 PM
📝 "Buy groceries next week" → Reminder set for next week

*Try creating a note or todo with a time reference!*`;

			await this.bot.sendMessage(chatId, response, 'Markdown');
			return;
		}

		let response = `🎯 *Your Smart Reminders*\n\n`;

		reminders.forEach((reminder, index) => {
			const date = new Date(reminder.reminderTime);
			const sourceIcon = reminder.sourceType === 'note' ? '📝' : '✅';
			
			response += `${index + 1}. ${sourceIcon} *${reminder.content}*\n`;
			response += `   ⏰ ${date.toLocaleString()}\n`;
			response += `   📍 From ${reminder.sourceType}\n\n`;
		});

		response += `💡 _Smart reminders are automatically created when you add notes or todos with time references!_`;

		await this.bot.sendMessage(chatId, response, 'Markdown');
		} catch (error) {
			console.error('Error handling reminders:', error);
			
			const errorResponse = `🎯 *Smart Reminders*

Sorry, there was an issue loading your reminders. Please try again in a moment.

💡 *How it works:*
When you create notes or todos with time references like "tomorrow", "next week", or "at 3pm", I'll automatically set smart reminders for you!

*Try creating a note or todo with a time reference!*`;

			await this.bot.sendMessage(chatId, errorResponse, 'Markdown');
		}
	}

	async showRemindersInline(chatId: number, messageId: number): Promise<void> {
		try {
			const reminders = await this.db.getUserReminders(chatId, 10);

			if (reminders.length === 0) {
			const response = `🎯 *Smart Reminders*

You don't have any pending reminders yet.

💡 *How it works:*
When you create notes or todos with time references like "tomorrow", "next week", or "at 3pm", I'll automatically set smart reminders for you!

*Examples:*
📝 "Call mom tomorrow" → Reminder set for tomorrow 9 AM
✅ "Meeting at 3pm" → Reminder set for today 3 PM
📝 "Buy groceries next week" → Reminder set for next week

*Try creating a note or todo with a time reference!*`;

			const keyboard = {
				inline_keyboard: [
					[{ text: '🏠 Back to Home', callback_data: 'back_home' }]
				]
			};

			await this.bot.editMessageText(chatId, messageId, response, 'Markdown', keyboard);
			return;
		}

		let response = `🎯 *Your Smart Reminders*\n\n`;

		reminders.forEach((reminder, index) => {
			const date = new Date(reminder.reminderTime);
			const sourceIcon = reminder.sourceType === 'note' ? '📝' : '✅';
			
			response += `${index + 1}. ${sourceIcon} *${reminder.content}*\n`;
			response += `   ⏰ ${date.toLocaleString()}\n`;
			response += `   📍 From ${reminder.sourceType}\n\n`;
		});

		response += `💡 _Smart reminders are automatically created when you add notes or todos with time references!_`;

		const keyboard = {
			inline_keyboard: [
				[{ text: '🏠 Back to Home', callback_data: 'back_home' }]
			]
		};

		await this.bot.editMessageText(chatId, messageId, response, 'Markdown', keyboard);
		} catch (error) {
			console.error('Error showing reminders:', error);
			
			const errorResponse = `🎯 *Smart Reminders*

Sorry, there was an issue loading your reminders. Please try again in a moment.

💡 *How it works:*
When you create notes or todos with time references like "tomorrow", "next week", or "at 3pm", I'll automatically set smart reminders for you!`;

			const keyboard = {
				inline_keyboard: [
					[{ text: '🏠 Back to Home', callback_data: 'back_home' }]
				]
			};

			await this.bot.editMessageText(chatId, messageId, errorResponse, 'Markdown', keyboard);
		}
	}

	async showHomeInline(chatId: number, messageId: number, firstName: string): Promise<void> {
		// Get upcoming reminders for preview
		const upcomingReminders = await this.db.getUpcomingReminders(chatId, 3); // Get next 3 reminders
		
		let reminderPreview = '';
		if (upcomingReminders.length > 0) {
			reminderPreview = '\n\n🎯 *Upcoming Reminders:*\n';
			upcomingReminders.forEach(reminder => {
				const timeDisplay = this.formatReminderTime(reminder.reminderTime);
				reminderPreview += `• ${timeDisplay}: ${reminder.content}\n`;
			});
		}

		const homeMessage = `🏠 *Welcome back, ${firstName}!*

*Choose what you'd like to do:*${reminderPreview}`;

		const keyboard = {
			inline_keyboard: [
				[
					{ text: '📝 Notes', callback_data: 'refresh_notes' },
					{ text: '✅ Todos', callback_data: 'refresh_todos' }
				],
				[
					{ text: '💰 Expenses', callback_data: 'refresh_expenses' },
					{ text: '🎯 Reminders', callback_data: 'show_reminders' }
				],
				[
					{ text: '📊 Summary', callback_data: 'show_summary' }
				]
			]
		};

		await this.bot.editMessageText(chatId, messageId, homeMessage, 'Markdown', keyboard);
	}

	// Reminder checking system (called periodically)
	async checkAndSendReminders(): Promise<void> {
		try {
			console.log('Checking reminders at:', new Date().toLocaleString());
			const pendingReminders = await this.db.getPendingReminders();
			console.log('Found pending reminders:', pendingReminders.length);

			for (const reminder of pendingReminders) {
				console.log('Sending reminder:', reminder);
				const sourceIcon = reminder.sourceType === 'note' ? '📝' : '✅';
				const reminderMessage = `🎯 *Smart Reminder!*

${sourceIcon} *${reminder.content}*

⏰ _This was set from your ${reminder.sourceType}_

*Time to take action!* 🚀`;

				await this.bot.sendMessage(reminder.userId, reminderMessage, 'Markdown');
				await this.db.markReminderSent(reminder.id);
				console.log('Reminder sent and marked as sent:', reminder.id);
			}
		} catch (error) {
			console.error('Error checking reminders:', error);
		}
	}

	// Parse Reminder Keywords from Text
	parseReminderFromText(text: string): { hasReminder: boolean; reminderTime?: number; cleanText?: string } {
		try {
			console.log('Parsing reminder from text:', text);
			
			// Look for "Reminder at" or "Remainder at" keywords (case insensitive)
			const reminderRegex = /\s*(reminder|remainder)\s+at\s+(.+?)$/i;
			const match = text.match(reminderRegex);
			
			console.log('Regex match result:', match);
			
			if (!match) {
				console.log('No reminder keyword found');
				return { hasReminder: false };
			}
			
			const timeExpression = match[2].trim();
			const cleanText = text.replace(reminderRegex, '').trim();
			
			console.log('Time expression:', timeExpression);
			console.log('Clean text:', cleanText);
			
			// Parse the time expression
			const reminderTime = this.parseTimeExpression(timeExpression);
			
			console.log('Parsed reminder time:', reminderTime, 'Readable:', new Date(reminderTime).toLocaleString());
			
			return {
				hasReminder: true,
				reminderTime,
				cleanText
			};
		} catch (error) {
			console.error('Error parsing reminder from text:', error);
			return { hasReminder: false };
		}
	}

	// Smart Reminder AI Detection (keeping for backward compatibility)
	async detectReminderFromText(text: string): Promise<{ hasReminder: boolean; reminderTime?: number; reminderText?: string }> {
		try {
			const aiResponse = await this.ai.run('@cf/meta/llama-3.1-8b-instruct', {
				messages: [
					{
						role: 'system',
						content: `You are a smart reminder detection AI. Analyze text and detect if it contains time-based reminders.

RULES:
1. Look for time expressions like: "tomorrow", "next week", "in 2 hours", "at 3pm", "Monday", etc.
2. If you find a time reference, respond with JSON: {"hasReminder": true, "timeExpression": "the time phrase", "reminderText": "what to remind about"}
3. If no time reference, respond with JSON: {"hasReminder": false}
4. Be smart about context - "remember to call mom tomorrow" = reminder, "I called mom yesterday" = no reminder
5. Only detect FUTURE time references, not past ones

Examples:
"Buy milk tomorrow" → {"hasReminder": true, "timeExpression": "tomorrow", "reminderText": "Buy milk"}
"Meeting at 3pm" → {"hasReminder": true, "timeExpression": "at 3pm", "reminderText": "Meeting"}
"I went shopping yesterday" → {"hasReminder": false}
"Call John next week" → {"hasReminder": true, "timeExpression": "next week", "reminderText": "Call John"}`
					},
					{
						role: 'user',
						content: text
					}
				],
				max_tokens: 150
			});

			const response = aiResponse.response || '{"hasReminder": false}';
			
			// Try to parse JSON response
			try {
				const parsed = JSON.parse(response);
				if (parsed.hasReminder && parsed.timeExpression && parsed.reminderText) {
					// Convert time expression to timestamp (simplified)
					const reminderTime = this.parseTimeExpression(parsed.timeExpression);
					return {
						hasReminder: true,
						reminderTime,
						reminderText: parsed.reminderText
					};
				}
			} catch (e) {
				// If JSON parsing fails, fallback to simple detection
				console.log('AI JSON parse failed, using fallback');
			}

			return { hasReminder: false };
		} catch (error) {
			console.error('AI reminder detection error:', error);
			return { hasReminder: false };
		}
	}

	private formatReminderTime(timestamp: number): string {
		const reminderDate = new Date(timestamp);
		const now = new Date();
		
		// User-friendly time display
		if (reminderDate.toDateString() === now.toDateString()) {
			// Today
			return `Today at ${reminderDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
		} else if (reminderDate.toDateString() === new Date(now.getTime() + 24*60*60*1000).toDateString()) {
			// Tomorrow
			return `Tomorrow at ${reminderDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
		} else {
			// Other days
			return reminderDate.toLocaleDateString('en-US', { 
				weekday: 'long', 
				month: 'short', 
				day: 'numeric',
				hour: 'numeric',
				minute: '2-digit',
				hour12: true
			});
		}
	}

	private parseTimeExpression(timeExpression: string): number {
		const now = new Date();
		const expr = timeExpression.toLowerCase();

		// Specific date formats: "12:2:2026", "12/2/2026", "2026-12-2"
		const dateFormats = [
			/(\d{1,2}):(\d{1,2}):(\d{4})(?:\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/,  // 12:2:2026 8am
			/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/, // 12/2/2026 8am
			/(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/   // 2026-12-2 8am
		];

		for (const format of dateFormats) {
			const match = expr.match(format);
			if (match) {
				let month, day, year, hour = 9, minutes = 0; // Default to 9 AM
				
				if (format.source.includes(':')) {
					// Format: 12:2:2026
					month = parseInt(match[1]) - 1; // JS months are 0-indexed
					day = parseInt(match[2]);
					year = parseInt(match[3]);
				} else if (format.source.includes('/')) {
					// Format: 12/2/2026
					month = parseInt(match[1]) - 1;
					day = parseInt(match[2]);
					year = parseInt(match[3]);
				} else {
					// Format: 2026-12-2
					year = parseInt(match[1]);
					month = parseInt(match[2]) - 1;
					day = parseInt(match[3]);
				}
				
				// Parse time if provided
				if (match[4]) {
					hour = parseInt(match[4]);
					minutes = match[5] ? parseInt(match[5]) : 0;
					const ampm = match[6];
					
					if (ampm === 'pm' && hour !== 12) {
						hour += 12;
					} else if (ampm === 'am' && hour === 12) {
						hour = 0;
					}
				}
				
				const targetDate = new Date(year, month, day, hour, minutes, 0, 0);
				return targetDate.getTime();
			}
		}

		// Today with specific time: "today 5:10 pm"
		const todayMatch = expr.match(/today\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
		if (todayMatch) {
			let hour = parseInt(todayMatch[1]);
			const minutes = todayMatch[2] ? parseInt(todayMatch[2]) : 0;
			const ampm = todayMatch[3];
			
			if (ampm === 'pm' && hour !== 12) {
				hour += 12;
			} else if (ampm === 'am' && hour === 12) {
				hour = 0;
			}
			
			const targetTime = new Date(now);
			targetTime.setHours(hour, minutes, 0, 0);
			return targetTime.getTime();
		}

		// Tomorrow with specific time: "tomorrow 8am"
		const tomorrowMatch = expr.match(/tomorrow\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
		if (tomorrowMatch) {
			let hour = parseInt(tomorrowMatch[1]);
			const minutes = tomorrowMatch[2] ? parseInt(tomorrowMatch[2]) : 0;
			const ampm = tomorrowMatch[3];
			
			if (ampm === 'pm' && hour !== 12) {
				hour += 12;
			} else if (ampm === 'am' && hour === 12) {
				hour = 0;
			}
			
			const tomorrow = new Date(now);
			tomorrow.setDate(tomorrow.getDate() + 1);
			tomorrow.setHours(hour, minutes, 0, 0);
			return tomorrow.getTime();
		}

		// Tomorrow (default time)
		if (expr.includes('tomorrow')) {
			const tomorrow = new Date(now);
			tomorrow.setDate(tomorrow.getDate() + 1);
			tomorrow.setHours(9, 0, 0, 0); // Default to 9 AM
			return tomorrow.getTime();
		}

		// Next week
		if (expr.includes('next week')) {
			const nextWeek = new Date(now);
			nextWeek.setDate(nextWeek.getDate() + 7);
			nextWeek.setHours(9, 0, 0, 0);
			return nextWeek.getTime();
		}

		// In X hours
		const hoursMatch = expr.match(/in (\d+) hours?/);
		if (hoursMatch) {
			const hours = parseInt(hoursMatch[1]);
			return now.getTime() + (hours * 60 * 60 * 1000);
		}

		// In X minutes
		const minutesMatch = expr.match(/in (\d+) minutes?/);
		if (minutesMatch) {
			const minutes = parseInt(minutesMatch[1]);
			return now.getTime() + (minutes * 60 * 1000);
		}

		// Direct time formats: "5:21pm", "8am", "3:30pm", "at 5pm"
		const timeFormats = [
			/(?:at\s+)?(\d{1,2}):(\d{2})\s*(am|pm)/i,  // "5:21pm" or "at 5:21pm"
			/(?:at\s+)?(\d{1,2})\s*(am|pm)/i,          // "8am" or "at 8am"
			/(?:at\s+)?(\d{1,2}):(\d{2})/,             // "17:30" or "at 17:30"
			/(?:at\s+)?(\d{1,2})(?::(\d{2}))?/         // "5" or "5:30"
		];

		for (const format of timeFormats) {
			const timeMatch = expr.match(format);
			if (timeMatch) {
				let hour = parseInt(timeMatch[1]);
				const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
				const ampm = timeMatch[3];
				
				// Handle AM/PM
				if (ampm) {
					if (ampm.toLowerCase() === 'pm' && hour !== 12) {
						hour += 12;
					} else if (ampm.toLowerCase() === 'am' && hour === 12) {
						hour = 0;
					}
				} else if (!ampm && hour <= 12) {
					// If no AM/PM specified and hour is 1-12, assume PM for afternoon/evening
					const currentHour = now.getHours();
					if (hour <= 12 && currentHour >= 12) {
						hour += 12;
					}
				}
				
				const targetTime = new Date(now);
				targetTime.setHours(hour, minutes, 0, 0);
				
				// If time has passed today, set for tomorrow
				if (targetTime.getTime() <= now.getTime()) {
					targetTime.setDate(targetTime.getDate() + 1);
				}
				return targetTime.getTime();
			}
		}

		// Default: 1 hour from now
		return now.getTime() + (60 * 60 * 1000);
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
			const creatorResponse = `🎯 *This bot was created by Chico!*

He's an amazing developer who built this next-gen productivity assistant with beautiful interactive features and AI capabilities.

You can contact him directly on Telegram: @chicorota0 (ID: 5147071138)

Chico designed this bot to help people be more productive with smart notes, todos, expenses tracking, and AI-powered reminders! 🚀`;

			const keyboard = {
				inline_keyboard: [
					[
						{ 
							text: '👤 View Chico\'s Profile', 
							url: 'tg://user?id=5147071138'
						}
					],
					[
						{ 
							text: '💬 Contact Chico', 
							url: 'https://t.me/chicorota0'
						}
					]
				]
			};

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
						- This bot has smart reminders that automatically detect time references in notes/todos
						- When users say things like "no have", "no way", or similar short responses, they might be responding to reminder confirmations
						- Be understanding and don't over-analyze casual responses
						- If someone seems to be giving a short/casual response, acknowledge it naturally
						
						CREATOR INFO: If someone asks who created this bot, who made this, who is the developer, or similar questions, respond with:
						"🎯 This bot was created by Chico! He's an amazing developer who built this next-gen productivity assistant. You can contact him directly on Telegram: @chicorota0 (ID: 5147071138). Chico designed this bot to help people be more productive with beautiful interactive features and AI capabilities!"
						
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

			// Edit the processing message with the AI response
			const processingResponse = await processingMessage.json() as any;
			const messageId = processingResponse.result?.message_id;

			if (messageId) {
				await this.bot.editMessageText(
					chatId, 
					messageId, 
					`🤖 *AI Assistant*\n\n${response}`, 
					'Markdown'
				);
			} else {
				await this.bot.sendMessage(chatId, `🤖 *AI Assistant*\n\n${response}`, 'Markdown');
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
			// Get the largest photo
			const largestPhoto = photos.reduce((prev, current) => 
				(prev.file_size || 0) > (current.file_size || 0) ? prev : current
			);

			// Get file info from Telegram
			const fileResponse = await this.bot.getFile(largestPhoto.file_id);
			const fileData = await fileResponse.json() as any;
			
			if (!fileData.ok) {
				throw new Error('Failed to get file info');
			}

			// Download the image
			const imageResponse = await this.bot.downloadFile(fileData.result.file_path);
			const imageBuffer = await imageResponse.arrayBuffer();

			// Use Cloudflare AI for image-to-text
			const aiResponse = await this.ai.run('@cf/unum/uform-gen2-qwen-500m', {
				image: Array.from(new Uint8Array(imageBuffer)),
				prompt: caption || "What is in this image? Describe it in detail.",
				max_tokens: 512
			});

			const description = aiResponse.description || 'Could not analyze the image.';

			// Edit the processing message with the result
			const processingResponse = await processingMessage.json() as any;
			const messageId = processingResponse.result?.message_id;

			if (messageId) {
				let message = `🖼️ *Image Analysis*\n\n${description}`;
				if (caption) {
					message += `\n\n💬 _Your caption: "${caption}"_`;
				}

				await this.bot.editMessageText(
					chatId, 
					messageId, 
					message, 
					'Markdown'
				);
			} else {
				let message = `🖼️ *Image Analysis*\n\n${description}`;
				if (caption) {
					message += `\n\n💬 _Your caption: "${caption}"_`;
				}
				await this.bot.sendMessage(chatId, message, 'Markdown');
			}

		} catch (error) {
			console.error('Image AI Error:', error);
			
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