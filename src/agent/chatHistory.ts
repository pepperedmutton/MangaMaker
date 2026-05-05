import { z } from "zod";
import type { AgentChatMessage } from "./types";

const HISTORY_KEY_PREFIX = "mangamaker:agent:chat:v1:";
const MAX_STORED_MESSAGES = 200;

const messageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  createdAt: z.string(),
});

const historySchema = z.object({
  projectId: z.string(),
  updatedAt: z.string(),
  messages: z.array(messageSchema),
});

const keyForProject = (projectId: string) => `${HISTORY_KEY_PREFIX}${projectId}`;

const getStorage = () => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const loadAgentChatHistory = (projectId: string): AgentChatMessage[] | null => {
  const storage = getStorage();
  if (!storage) {
    return null;
  }
  const raw = storage.getItem(keyForProject(projectId));
  if (!raw) {
    return null;
  }
  try {
    const parsed = historySchema.parse(JSON.parse(raw));
    return parsed.messages;
  } catch (error) {
    console.warn(`Failed to load Agent chat history for project ${projectId}:`, error);
    return null;
  }
};

export const saveAgentChatHistory = (projectId: string, messages: AgentChatMessage[]) => {
  const storage = getStorage();
  if (!storage) {
    return false;
  }
  try {
    const payload = historySchema.parse({
      projectId,
      updatedAt: new Date().toISOString(),
      messages: messages.slice(-MAX_STORED_MESSAGES),
    });
    storage.setItem(keyForProject(projectId), JSON.stringify(payload));
    return true;
  } catch (error) {
    console.warn(`Failed to save Agent chat history for project ${projectId}:`, error);
    return false;
  }
};

export const deleteAgentChatHistory = (projectId: string) => {
  const storage = getStorage();
  if (!storage) {
    return false;
  }
  try {
    storage.removeItem(keyForProject(projectId));
    return true;
  } catch (error) {
    console.warn(`Failed to delete Agent chat history for project ${projectId}:`, error);
    return false;
  }
};
