/**
 * expand-task.js
 * Direct function implementation for expanding a task into subtasks
 */

import fs from 'fs';
import path from 'path';
import {
	callAIProvider,
	parseSubtasksFromText
} from '../../../../scripts/modules/ai-services.js';
import {
	disableSilentMode,
	enableSilentMode,
	readJSON,
	writeJSON
} from '../../../../scripts/modules/utils.js';

/**
 * Direct function wrapper for expanding a task into subtasks with error handling.
 *
 * @param {Object} args - Command arguments
 * @param {string} args.tasksJsonPath - Explicit path to the tasks.json file.
 * @param {string} args.id - The ID of the task to expand.
 * @param {number|string} [args.num] - Number of subtasks to generate.
 * @param {boolean} [args.research] - Enable Perplexity AI for research-backed subtask generation.
 * @param {string} [args.prompt] - Additional context to guide subtask generation.
 * @param {boolean} [args.force] - Force expansion even if subtasks exist.
 * @param {Object} log - Logger object
 * @param {Object} context - Context object containing session and reportProgress
 * @returns {Promise<Object>} - Task expansion result { success: boolean, data?: any, error?: { code: string, message: string }, fromCache: boolean }
 */
export async function expandTaskDirect(args, log, context = {}) {
	const { session } = context;
	// Destructure expected args
	const { tasksJsonPath, id, num, research, prompt, force } = args;

	// Log session root data for debugging
	log.info(
		`Session data in expandTaskDirect: ${JSON.stringify({
			hasSession: !!session,
			sessionKeys: session ? Object.keys(session) : [],
			roots: session?.roots,
			rootsStr: JSON.stringify(session?.roots)
		})}`
	);

	// Check if tasksJsonPath was provided
	if (!tasksJsonPath) {
		log.error('expandTaskDirect called without tasksJsonPath');
		return {
			success: false,
			error: {
				code: 'MISSING_ARGUMENT',
				message: 'tasksJsonPath is required'
			},
			fromCache: false
		};
	}

	// Use provided path
	const tasksPath = tasksJsonPath;

	log.info(`[expandTaskDirect] Using tasksPath: ${tasksPath}`);

	// Validate task ID
	const taskId = id ? parseInt(id, 10) : null;
	if (!taskId) {
		log.error('Task ID is required');
		return {
			success: false,
			error: {
				code: 'INPUT_VALIDATION_ERROR',
				message: 'Task ID is required'
			},
			fromCache: false
		};
	}

	// Process other parameters
	const numSubtasks = num ? parseInt(num, 10) : undefined;
	const useResearch = research === true;
	const additionalContext = prompt || '';
	const forceFlag = force === true;

	try {
		log.info(
			`[expandTaskDirect] Expanding task ${taskId} into ${numSubtasks || 'default'} subtasks. Research: ${useResearch}`
		);

		// Read tasks data
		log.info(`[expandTaskDirect] Attempting to read JSON from: ${tasksPath}`);
		const data = readJSON(tasksPath);
		log.info(
			`[expandTaskDirect] Result of readJSON: ${data ? 'Data read successfully' : 'readJSON returned null or undefined'}`
		);

		if (!data || !data.tasks) {
			log.error(
				`[expandTaskDirect] readJSON failed or returned invalid data for path: ${tasksPath}`
			);
			return {
				success: false,
				error: {
					code: 'INVALID_TASKS_FILE',
					message: `No valid tasks found in ${tasksPath}. readJSON returned: ${JSON.stringify(data)}`
				},
				fromCache: false
			};
		}

		// Find the specific task
		log.info(`[expandTaskDirect] Searching for task ID ${taskId} in data`);
		const task = data.tasks.find((t) => t.id === taskId);
		log.info(`[expandTaskDirect] Task found: ${task ? 'Yes' : 'No'}`);

		if (!task) {
			return {
				success: false,
				error: {
					code: 'TASK_NOT_FOUND',
					message: `Task with ID ${taskId} not found`
				},
				fromCache: false
			};
		}

		// Check if task is completed
		if (task.status === 'done' || task.status === 'completed') {
			return {
				success: false,
				error: {
					code: 'TASK_COMPLETED',
					message: `Task ${taskId} is already marked as ${task.status} and cannot be expanded`
				},
				fromCache: false
			};
		}

		// Check for existing subtasks and force flag
		const hasExistingSubtasks = task.subtasks && task.subtasks.length > 0;
		if (hasExistingSubtasks && !forceFlag) {
			log.info(
				`Task ${taskId} already has ${task.subtasks.length} subtasks. Use --force to overwrite.`
			);
			return {
				success: true,
				data: {
					message: `Task ${taskId} already has subtasks. Expansion skipped.`,
					task,
					subtasksAdded: 0,
					hasExistingSubtasks
				},
				fromCache: false
			};
		}

		// If force flag is set, clear existing subtasks
		if (hasExistingSubtasks && forceFlag) {
			log.info(
				`Force flag set. Clearing existing subtasks for task ${taskId}.`
			);
			task.subtasks = [];
		}

		// Keep a copy of the task before modification
		const originalTask = JSON.parse(JSON.stringify(task));

		// Tracking subtasks count before expansion
		const subtasksCountBefore = task.subtasks ? task.subtasks.length : 0;

		// Create a backup of the tasks.json file
		const backupPath = path.join(path.dirname(tasksPath), 'tasks.json.bak');
		fs.copyFileSync(tasksPath, backupPath);

		// Directly modify the data instead of calling the CLI function
		if (!task.subtasks) {
			task.subtasks = [];
		}

		// Save tasks.json with potentially empty subtasks array
		writeJSON(tasksPath, data);

		// Process the request
		try {
			// Enable silent mode to prevent console logs from interfering with JSON response
			enableSilentMode();

			const logWrapper = {
				info: (...args) => log.info(...args),
				warn: (...args) => log.warn(...args),
				error: (...args) => log.error(...args),
				debug: (...args) => log.debug && log.debug(...args)
			};

			// Prepare prompt for subtask generation
			const nextSubtaskId = (task.subtasks?.length || 0) + 1;
			// USE PROVIDED numSubtasks OR A DEFAULT (e.g., 5)
			const subtaskCount = numSubtasks || 5; // Use the provided number or default

			// Construct the prompt (simplified example, adapt from ai-services.js prompt helpers if needed)
			// Ensure to use subtaskCount variable here
			const systemPrompt = `You are an AI assistant helping with task breakdown. Break down the given task into ${subtaskCount} specific subtasks.\n\nSubtasks should:\n1. Be specific and actionable implementation steps\n2. Follow a logical sequence\n3. Each handle a distinct part of the parent task\n4. Include clear guidance on implementation approach\n5. Have appropriate dependency chains between subtasks (use numerical IDs starting from ${nextSubtaskId})\n6. Collectively cover all aspects of the parent task\n\nReturn exactly ${subtaskCount} subtasks with the following JSON structure:\n[\n  {\n    "id": ${nextSubtaskId},\n    "title": "First subtask title",\n    "description": "Detailed description",\n    "dependencies": [],\n    "details": "Implementation details"\n  },\n  ...\n]\n\nIMPORTANT: Respond ONLY with the JSON array, nothing else.`;

			const contextPrompt = additionalContext
				? `\n\nAdditional context: ${additionalContext}`
				: '';

			// Ensure to use subtaskCount variable here too
			const userPrompt = `Break down this task into ${subtaskCount} subtasks:\nTask ID: ${task.id}\nTitle: ${task.title}\nDescription: ${task.description}\nDetails: ${task.details || 'N/A'}${contextPrompt}`;

			// Combine prompts (system prompt might be handled differently by callAIProvider if refactored)
			// For now, sending combined prompt
			const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

			log.info(
				`Calling AI provider (Research: ${useResearch}) to generate subtasks...`
			);

			// Enable silent mode only around the AI call and parsing if needed
			// Note: callAIProvider itself might handle internal logging without needing this wrapper if designed well
			enableSilentMode();
			let generatedSubtasksText = '';
			try {
				generatedSubtasksText = await callAIProvider(fullPrompt, {
					useResearch,
					mcpContext: { log: logWrapper, session } // Pass wrapped logger and session
				});
			} catch (aiError) {
				log.error(`AI provider call failed: ${aiError.message}`);
				throw new Error(`AI Error: ${aiError.message}`); // Rethrow to be caught by outer block
			} finally {
				disableSilentMode();
			}

			// Parse the response using the imported function
			const newSubtasks = parseSubtasksFromText(
				generatedSubtasksText,
				nextSubtaskId,
				subtaskCount,
				task.id
			);

			// Check if parsing returned valid subtasks
			if (!newSubtasks || newSubtasks.length === 0) {
				throw new Error('AI did not return valid subtasks.');
			}

			// Update the task object in the `data` variable
			const taskIndex = data.tasks.findIndex((t) => t.id === taskId);
			if (taskIndex === -1) throw new Error('Task disappeared unexpectedly!'); // Safety check
			data.tasks[taskIndex].subtasks = [
				...(data.tasks[taskIndex].subtasks || []),
				...newSubtasks
			];
			const subtasksAdded = newSubtasks.length;

			// Write the updated `data` back to the file
			writeJSON(tasksPath, data);

			log.info(
				`Successfully expanded task ${taskId} with ${subtasksAdded} subtasks.`
			);

			// Remove backup file on success
			fs.unlinkSync(backupPath);

			return {
				success: true,
				data: {
					message: `Task ${taskId} expanded successfully with ${subtasksAdded} subtasks.`,
					task: originalTask, // Return original task state before expansion?
					newSubtasks: newSubtasks, // Return the newly added subtasks
					subtasksAdded: subtasksAdded,
					totalSubtasks: data.tasks[taskIndex].subtasks.length // Get total from updated data
				},
				fromCache: false
			};
		} catch (error) {
			// Make sure to restore normal logging even if there's an error
			disableSilentMode();

			log.error(`Error expanding task: ${error.message}`);
			return {
				success: false,
				error: {
					code: 'CORE_FUNCTION_ERROR',
					message: error.message || 'Failed to expand task'
				},
				fromCache: false
			};
		}
	} catch (error) {
		log.error(`Error expanding task: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'CORE_FUNCTION_ERROR',
				message: error.message || 'Failed to expand task'
			},
			fromCache: false
		};
	}
}
