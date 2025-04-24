/**
 * ai-client-utils.js
 * Utility functions for initializing AI clients in MCP context
 */

import { Anthropic } from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

// Load environment variables for CLI mode
dotenv.config();

// Default model configuration from CLI environment
const DEFAULT_MODEL_CONFIG = {
	model: 'claude-3-7-sonnet-20250219',
	maxTokens: 64000,
	temperature: 0.2
};

/**
 * Get an Anthropic client instance initialized with MCP session environment variables
 * @param {Object} [session] - Session object from MCP containing environment variables
 * @param {Object} [log] - Logger object to use (defaults to console)
 * @returns {Anthropic} Anthropic client instance
 * @throws {Error} If API key is missing
 */
export function getAnthropicClientForMCP(session, log = console) {
	try {
		// Extract API key from session.env or fall back to environment variables
		const apiKey =
			session?.env?.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;

		if (!apiKey) {
			throw new Error(
				'ANTHROPIC_API_KEY not found in session environment or process.env'
			);
		}

		// Initialize and return a new Anthropic client
		return new Anthropic({
			apiKey,
			defaultHeaders: {
				'anthropic-beta': 'output-128k-2025-02-19' // Include header for increased token limit
			}
		});
	} catch (error) {
		log.error(`Failed to initialize Anthropic client: ${error.message}`);
		throw error;
	}
}

/**
 * Get a Google Gemini client instance initialized with MCP session environment variables
 * @param {Object} [session] - Session object from MCP containing environment variables
 * @param {Object} [log] - Logger object to use (defaults to console)
 * @returns {GoogleGenerativeAI} Google Gemini client instance
 * @throws {Error} If API key is missing
 */
export function getGoogleClientForMCP(session, log = console) {
	try {
		// Extract API key from session.env or fall back to environment variables
		const apiKey = session?.env?.GOOGLE_API_KEY || process.env.GOOGLE_API_KEY;

		if (!apiKey) {
			throw new Error(
				'GOOGLE_API_KEY not found in session environment or process.env'
			);
		}

		// Initialize and return a new Google client
		return new GoogleGenerativeAI(apiKey);
	} catch (error) {
		log.error(`Failed to initialize Google Gemini client: ${error.message}`);
		throw error;
	}
}

/**
 * Get a Perplexity client instance initialized with MCP session environment variables
 * @param {Object} [session] - Session object from MCP containing environment variables
 * @param {Object} [log] - Logger object to use (defaults to console)
 * @returns {OpenAI} OpenAI client configured for Perplexity API
 * @throws {Error} If API key is missing or OpenAI package can't be imported
 */
export async function getPerplexityClientForMCP(session, log = console) {
	try {
		// Extract API key from session.env or fall back to environment variables
		const apiKey =
			session?.env?.PERPLEXITY_API_KEY || process.env.PERPLEXITY_API_KEY;

		if (!apiKey) {
			throw new Error(
				'PERPLEXITY_API_KEY not found in session environment or process.env'
			);
		}

		// Dynamically import OpenAI (it may not be used in all contexts)
		const { default: OpenAI } = await import('openai');

		// Initialize and return a new OpenAI client configured for Perplexity
		return new OpenAI({
			apiKey,
			baseURL: 'https://api.perplexity.ai'
		});
	} catch (error) {
		log.error(`Failed to initialize Perplexity client: ${error.message}`);
		throw error;
	}
}

/**
 * Get model configuration from session environment or fall back to defaults
 * @param {Object} [session] - Session object from MCP containing environment variables
 * @param {Object} [defaults] - Default model configuration to use if not in session
 * @returns {Object} Model configuration with model, maxTokens, and temperature
 */
export function getModelConfig(session, defaults = DEFAULT_MODEL_CONFIG) {
	// Get values from session or fall back to defaults
	return {
		model: session?.env?.MODEL || defaults.model,
		maxTokens: parseInt(session?.env?.MAX_TOKENS || defaults.maxTokens),
		temperature: parseFloat(session?.env?.TEMPERATURE || defaults.temperature)
	};
}

/**
 * Returns the best available AI model based on specified options
 * @param {Object} session - Session object from MCP containing environment variables
 * @param {Object} options - Options for model selection
 * @param {boolean} [options.requiresResearch=false] - Whether the operation requires research capabilities
 * @param {boolean} [options.claudeOverloaded=false] - Whether Claude is currently overloaded
 * @param {Object} [log] - Logger object to use (defaults to console)
 * @returns {Promise<Object>} Selected model info with type and client
 * @throws {Error} If no AI models are available
 */
export async function getBestAvailableAIModel(
	session,
	options = {},
	log = console
) {
	const { requiresResearch = false, claudeOverloaded = false } = options;
	// Determine primary provider from session or env
	const primaryProvider =
		(session?.env?.AI_PROVIDER || process.env.AI_PROVIDER)?.toUpperCase() ||
		'ANTHROPIC';

	// Test case: When research is needed but no Perplexity, use primary provider
	if (
		requiresResearch &&
		!(session?.env?.PERPLEXITY_API_KEY || process.env.PERPLEXITY_API_KEY)
	) {
		try {
			log.warn(
				`Perplexity not available for research, falling back to primary provider (${primaryProvider})`
			);
			if (primaryProvider === 'GOOGLE') {
				const client = getGoogleClientForMCP(session, log);
				const modelName =
					session?.env?.GEMINI_MODEL ||
					process.env.GEMINI_MODEL ||
					'gemini-2.5-pro-latest';
				return { type: 'google', client, modelName };
			} else {
				// Default to Anthropic
				const client = getAnthropicClientForMCP(session, log);
				const modelName =
					session?.env?.MODEL ||
					process.env.MODEL ||
					'claude-3-7-sonnet-20250219';
				return { type: 'claude', client, modelName };
			}
		} catch (error) {
			log.error(
				`Primary provider (${primaryProvider}) not available for research fallback: ${error.message}`
			);
			throw new Error('No AI models available for research');
		}
	}

	// Regular path: Perplexity for research when available
	if (
		requiresResearch &&
		(session?.env?.PERPLEXITY_API_KEY || process.env.PERPLEXITY_API_KEY)
	) {
		try {
			const client = await getPerplexityClientForMCP(session, log);
			return { type: 'perplexity', client };
		} catch (error) {
			log.warn(`Perplexity not available: ${error.message}`);
			// Fall through to primary provider as backup
		}
	}

	// Handle Claude overloaded scenario - fallback to Google if available, then Perplexity
	if (claudeOverloaded) {
		log.warn('Claude is overloaded. Attempting fallback...');
		// Try Google first
		if (
			primaryProvider === 'GOOGLE' ||
			session?.env?.GOOGLE_API_KEY ||
			process.env.GOOGLE_API_KEY
		) {
			try {
				log.info('Falling back to Google Gemini due to Claude overload.');
				const client = getGoogleClientForMCP(session, log);
				const modelName =
					session?.env?.GEMINI_MODEL ||
					process.env.GEMINI_MODEL ||
					'gemini-2.5-pro-latest';
				return { type: 'google', client, modelName };
			} catch (googleError) {
				log.warn(`Google fallback failed: ${googleError.message}`);
				// Continue to Perplexity fallback
			}
		}
		// Try Perplexity next
		if (session?.env?.PERPLEXITY_API_KEY || process.env.PERPLEXITY_API_KEY) {
			try {
				log.info('Falling back to Perplexity due to Claude overload.');
				const client = await getPerplexityClientForMCP(session, log);
				const modelName =
					session?.env?.PERPLEXITY_MODEL ||
					process.env.PERPLEXITY_MODEL ||
					'sonar-pro';
				return { type: 'perplexity', client, modelName }; // Include modelName for consistency
			} catch (perplexityError) {
				log.warn(`Perplexity fallback failed: ${perplexityError.message}`);
				// Fall through to using overloaded Claude as last resort
			}
		}
		// Last resort: Use overloaded Claude
		try {
			log.warn('All fallbacks failed. Attempting to use overloaded Claude.');
			const client = getAnthropicClientForMCP(session, log);
			const modelName =
				session?.env?.MODEL ||
				process.env.MODEL ||
				'claude-3-7-sonnet-2025-02-19';
			return { type: 'claude', client, modelName };
		} catch (claudeError) {
			log.error(`Overloaded Claude also failed: ${claudeError.message}`);
			throw new Error(
				'No AI models available, Claude overloaded and fallbacks failed.'
			);
		}
	}

	// Default case: Use the configured primary provider
	try {
		if (primaryProvider === 'GOOGLE') {
			const client = getGoogleClientForMCP(session, log);
			const modelName =
				session?.env?.GEMINI_MODEL ||
				process.env.GEMINI_MODEL ||
				'gemini-2.5-pro-latest';
			return { type: 'google', client, modelName };
		} else {
			// Default to Anthropic
			const client = getAnthropicClientForMCP(session, log);
			const modelName =
				session?.env?.MODEL ||
				process.env.MODEL ||
				'claude-3-7-sonnet-2025-02-19';
			return { type: 'claude', client, modelName };
		}
	} catch (primaryError) {
		log.error(
			`Failed to initialize primary provider (${primaryProvider}): ${primaryError.message}`
		);
		// If primary failed, try the *other* primary provider as a fallback
		try {
			if (
				primaryProvider === 'GOOGLE' &&
				(session?.env?.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY)
			) {
				log.warn('Google failed, attempting fallback to Anthropic.');
				const client = getAnthropicClientForMCP(session, log);
				const modelName =
					session?.env?.MODEL ||
					process.env.MODEL ||
					'claude-3-7-sonnet-2025-02-19';
				return { type: 'claude', client, modelName };
			} else if (
				primaryProvider === 'ANTHROPIC' &&
				(session?.env?.GOOGLE_API_KEY || process.env.GOOGLE_API_KEY)
			) {
				log.warn('Anthropic failed, attempting fallback to Google.');
				const client = getGoogleClientForMCP(session, log);
				const modelName =
					session?.env?.GEMINI_MODEL ||
					process.env.GEMINI_MODEL ||
					'gemini-2.5-pro-latest';
				return { type: 'google', client, modelName };
			}
		} catch (fallbackError) {
			log.error(`Fallback provider also failed: ${fallbackError.message}`);
		}
	}

	// If we got here, no models were successfully initialized
	throw new Error(
		'No primary AI models available. Please check your API keys and AI_PROVIDER setting.'
	);
}

/**
 * Handle Claude API errors with user-friendly messages
 * @param {Error} error - The error from Claude API
 * @returns {string} User-friendly error message
 */
export function handleClaudeError(error) {
	// Check if it's a structured error response
	if (error.type === 'error' && error.error) {
		switch (error.error.type) {
			case 'overloaded_error':
				return 'Claude is currently experiencing high demand and is overloaded. Please wait a few minutes and try again.';
			case 'rate_limit_error':
				return 'You have exceeded the rate limit. Please wait a few minutes before making more requests.';
			case 'invalid_request_error':
				return 'There was an issue with the request format. If this persists, please report it as a bug.';
			default:
				return `Claude API error: ${error.error.message}`;
		}
	}

	// Check for network/timeout errors
	if (error.message?.toLowerCase().includes('timeout')) {
		return 'The request to Claude timed out. Please try again.';
	}
	if (error.message?.toLowerCase().includes('network')) {
		return 'There was a network error connecting to Claude. Please check your internet connection and try again.';
	}

	// Default error message
	return `Error communicating with Claude: ${error.message}`;
}
