/**
 * Telegram Bot API Wrapper
 * 
 * This module provides the TelegramBot class and related types.
 */

import { CommandHandler } from './commands';

export interface TelegramPhoto {
	file_id: string;
	file_unique_id: string;
	width: number;
	height: number;
	file_size?: number;
}

export interface TelegramUpdate {
	update_id: number;
	message?: {
		message_id: number;
		from: {
			id: number;
			is_bot: boolean;
			first_name: string;
			username?: string;
		};
		chat: {
			id: number;
			first_name?: string;
			username?: string;
			type: string;
		};
		date: number;
		text?: string;
		photo?: TelegramPhoto[];
		caption?: string;
	};
	callback_query?: TelegramCallbackQuery;
}

export interface TelegramMessage {
	chat_id: number;
	text: string;
	parse_mode?: string;
	reply_markup?: {
		inline_keyboard?: Array<Array<{
			text: string;
			callback_data: string;
		}>>;
	};
}

export interface TelegramCallbackQuery {
	id: string;
	from: {
		id: number;
		first_name: string;
		username?: string;
	};
	message?: {
		message_id: number;
		chat: {
			id: number;
		};
	};
	data?: string;
}

export class TelegramBot {
	private token: string;
	private apiUrl: string;

	constructor(token: string) {
		this.token = token;
		this.apiUrl = `https://api.telegram.org/bot${token}`;
	}

	async sendMessage(chatId: number, text: string, parseMode?: string, replyMarkup?: any): Promise<Response> {
		const message: TelegramMessage = {
			chat_id: chatId,
			text: text,
		};

		if (parseMode) {
			message.parse_mode = parseMode;
		}

		if (replyMarkup) {
			message.reply_markup = replyMarkup;
		}

		return fetch(`${this.apiUrl}/sendMessage`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(message),
		});
	}

	async editMessageText(chatId: number, messageId: number, text: string, parseMode?: string, replyMarkup?: any): Promise<Response> {
		const payload: any = {
			chat_id: chatId,
			message_id: messageId,
			text: text,
		};

		if (parseMode) {
			payload.parse_mode = parseMode;
		}

		if (replyMarkup) {
			payload.reply_markup = replyMarkup;
		}

		return fetch(`${this.apiUrl}/editMessageText`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(payload),
		});
	}

	async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<Response> {
		return fetch(`${this.apiUrl}/answerCallbackQuery`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				callback_query_id: callbackQueryId,
				text: text || '',
			}),
		});
	}

	async setWebhook(webhookUrl: string): Promise<Response> {
		return fetch(`${this.apiUrl}/setWebhook`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				url: webhookUrl,
			}),
		});
	}

	async deleteWebhook(): Promise<Response> {
		return fetch(`${this.apiUrl}/deleteWebhook`, {
			method: 'POST',
		});
	}

	async getWebhookInfo(): Promise<Response> {
		return fetch(`${this.apiUrl}/getWebhookInfo`);
	}

	async getFile(fileId: string): Promise<Response> {
		return fetch(`${this.apiUrl}/getFile`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				file_id: fileId,
			}),
		});
	}

	async downloadFile(filePath: string): Promise<Response> {
		return fetch(`https://api.telegram.org/file/bot${this.token}/${filePath}`);
	}
}

export async function handleTelegramUpdate(update: TelegramUpdate, bot: TelegramBot, database: D1Database, ai: Ai): Promise<void> {
	const commandHandler = new CommandHandler(bot, database, ai);

	try {
		// Handle callback queries (inline button clicks)
		if (update.callback_query) {
			const callbackQuery = update.callback_query;
			const chatId = callbackQuery.message?.chat.id;
			const messageId = callbackQuery.message?.message_id;
			const data = callbackQuery.data;
			const firstName = callbackQuery.from.first_name;
			const username = callbackQuery.from.username;

			if (!chatId || !messageId || !data) return;

			await commandHandler.handleCallbackQuery(chatId, messageId, data, callbackQuery.id, firstName, username);
			return;
		}

		// Handle regular messages
		if (!update.message) {
			return;
		}

		const message = update.message;
		const chatId = message.chat.id;
		const firstName = message.from.first_name;
		const username = message.from.username;

		// Handle photos with AI
		if (message.photo && message.photo.length > 0) {
			await commandHandler.handlePhotoMessage(chatId, message.photo, message.caption, firstName, username);
			return;
		}

		// Handle text messages
		if (!message.text) {
			return;
		}

		const text = message.text;

		// Check if user is in input mode (waiting for note/todo/expense input)
		const inputMode = await commandHandler.getUserInputMode(chatId);
		if (inputMode) {
			await commandHandler.handleUserInput(chatId, text, inputMode);
			return;
		}

		// Handle AI queries (text without commands)
		if (!text.startsWith('/')) {
			await commandHandler.handleAIQuery(chatId, text, firstName, username);
			return;
		}

		// Parse command and arguments
		const [command, ...args] = text.split(' ');
		const commandText = args.join(' ');

		// Route to appropriate command handler
		switch (command.toLowerCase()) {
			case '/start':
				await commandHandler.handleStart(chatId, firstName, username);
				break;

			case '/home':
				await commandHandler.handleHome(chatId, firstName, username);
				break;

			case '/note':
				await commandHandler.handleNoteCommand(chatId);
				break;

			case '/todo':
				await commandHandler.handleTodoCommand(chatId);
				break;

			case '/expense':
				await commandHandler.handleExpenseCommand(chatId);
				break;

			case '/summary':
				await commandHandler.handleSummary(chatId);
				break;

			case '/help':
				await commandHandler.handleHelp(chatId);
				break;

			case '/reminders':
				await commandHandler.handleReminders(chatId);
				break;

			default:
				await commandHandler.handleUnknownCommand(chatId, text);
				break;
		}
	} catch (error) {
		console.error('Error handling telegram update:', error);
		// Try to send error message to user
		try {
			const chatId = update.message?.chat.id || update.callback_query?.message?.chat.id;
			if (chatId) {
				await bot.sendMessage(chatId, '❌ Sorry, something went wrong. Please try again in a moment.');
			}
		} catch (sendError) {
			console.error('Error sending error message:', sendError);
		}
	}
}