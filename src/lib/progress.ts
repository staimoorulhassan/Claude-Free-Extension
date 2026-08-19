/**
 * Progress tracking for long-running tasks.
 * 
 * Persists task progress to chrome.storage.local so the UI can show
 * which step the agent is on and how far along the plan it has progressed.
 */

import type { TaskProgress } from './types';
import { generateId } from './storage';

const PROGRESS_PREFIX = 'progress:';

function storageGet(keys: string[]): Promise<Record<string, unknown>> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return Promise.resolve({});
  }
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function storageSet(items: Record<string, unknown>): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return Promise.resolve();
  }
  return new Promise(resolve => chrome.storage.local.set(items, resolve));
}

function storageRemove(keys: string[]): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return Promise.resolve();
  }
  return new Promise(resolve => chrome.storage.local.remove(keys, resolve));
}

/**
 * Create a new progress tracker for a task.
 */
export async function createProgress(
  taskId: string,
  planSummary: string,
  totalSteps: number,
): Promise<TaskProgress> {
  const progress: TaskProgress = {
    taskId,
    currentStep: 0,
    totalSteps,
    currentStepDescription: 'Planning...',
    planSummary,
    stepHistory: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  
  await storageSet({ [PROGRESS_PREFIX + taskId]: progress });
  return progress;
}

/**
 * Update the current step of a task.
 */
export async function updateProgress(
  taskId: string,
  step: number,
  description: string,
): Promise<TaskProgress | null> {
  const progress = await getProgress(taskId);
  if (!progress) return null;
  
  // If moving to a new step, record the previous step's completion
  if (step > progress.currentStep && progress.currentStep > 0) {
    const prevStep = progress.stepHistory.find(h => h.step === progress.currentStep);
    if (prevStep && !prevStep.completedAt) {
      prevStep.completedAt = Date.now();
      prevStep.durationMs = prevStep.completedAt - (prevStep.completedAt - 1000); // Approximate
    }
  }
  
  progress.currentStep = step;
  progress.currentStepDescription = description;
  progress.updatedAt = Date.now();
  
  // Add to step history if not already there
  if (!progress.stepHistory.some(h => h.step === step)) {
    progress.stepHistory.push({
      step,
      description,
      completedAt: 0,
      durationMs: 0,
    });
  }
  
  await storageSet({ [PROGRESS_PREFIX + taskId]: progress });
  return progress;
}

/**
 * Mark the current step as completed.
 */
export async function completeStep(
  taskId: string,
  durationMs?: number,
): Promise<TaskProgress | null> {
  const progress = await getProgress(taskId);
  if (!progress) return null;
  
  const stepEntry = progress.stepHistory.find(h => h.step === progress.currentStep);
  if (stepEntry) {
    stepEntry.completedAt = Date.now();
    stepEntry.durationMs = durationMs ?? 0;
  }
  
  progress.updatedAt = Date.now();
  await storageSet({ [PROGRESS_PREFIX + taskId]: progress });
  return progress;
}

/**
 * Get progress for a task.
 */
export async function getProgress(taskId: string): Promise<TaskProgress | null> {
  const all = await storageGet([]);
  const key = PROGRESS_PREFIX + taskId;
  const value = all[key];
  return (value as TaskProgress) ?? null;
}

/**
 * Delete progress for a task.
 */
export async function deleteProgress(taskId: string): Promise<void> {
  await storageRemove([PROGRESS_PREFIX + taskId]);
}

/**
 * Build a progress context string for injection into the system prompt.
 * Informs the agent of the current plan and progress.
 */
export async function buildProgressContext(taskId: string): Promise<string> {
  const progress = await getProgress(taskId);
  if (!progress) return '';
  
  const elapsed = Date.now() - progress.createdAt;
  const elapsedMin = Math.round(elapsed / 60000);
  
  const lines = [
    `[TASK PROGRESS - Step ${progress.currentStep}/${progress.totalSteps} - ${elapsedMin} min elapsed]`,
    `Plan: ${progress.planSummary}`,
    `Current: ${progress.currentStepDescription}`,
  ];
  
  if (progress.stepHistory.length > 0) {
    const completed = progress.stepHistory.filter(h => h.completedAt > 0).length;
    lines.push(`Completed: ${completed}/${progress.stepHistory.length} steps`);
  }
  
  return lines.join('\n');
}

/**
 * Parse a plan from the agent's response and extract step count.
 * Returns { totalSteps, planSummary } or null if no plan detected.
 */
export function parsePlanFromText(text: string): { totalSteps: number; planSummary: string } | null {
  // Look for numbered steps
  const stepMatches = text.match(/(?:^|\n)\s*\d+[\.\)]\s+/g);
  if (stepMatches && stepMatches.length >= 2) {
    return {
      totalSteps: stepMatches.length,
      planSummary: text.slice(0, 300).replace(/\n/g, ' ').trim(),
    };
  }
  
  // Look for bullet points
  const bulletMatches = text.match(/(?:^|\n)\s*[-•]\s+/g);
  if (bulletMatches && bulletMatches.length >= 2) {
    return {
      totalSteps: bulletMatches.length,
      planSummary: text.slice(0, 300).replace(/\n/g, ' ').trim(),
    };
  }
  
  return null;
}
