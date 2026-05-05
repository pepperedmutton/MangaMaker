import { FormEvent, useEffect, useMemo, useState } from "react";
import { chatWithAgent, getAgentConfig, publishAgentDebugSnapshot } from "../agent/client";
import { getAgentContext } from "../agent/context";
import { createAgentDebugSnapshot, setLatestAgentDebugSnapshot } from "../agent/debug";
import { buildAgentHarness, executeAgentHarnessToolCall } from "../agent/harness";
import { executeCommandPlan, previewCommandPlan } from "../agent/tools";
import type {
  AgentChatMessage,
  AgentConfig,
  AgentCommandPlan,
  AgentContextSnapshot,
  AgentHarnessToolResult,
  AgentToolLogEntry,
} from "../agent/types";
import { AgentCommandPlan as AgentCommandPlanView } from "./AgentCommandPlan";
import { AgentMessageList } from "./AgentMessageList";
import { AgentToolLog } from "./AgentToolLog";

const createId = (prefix: string) => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const createMessage = (role: AgentChatMessage["role"], content: string): AgentChatMessage => ({
  id: createId("message"),
  role,
  content,
  createdAt: new Date().toISOString(),
});

const createLog = (
  label: string,
  status: AgentToolLogEntry["status"],
  detail?: string,
): AgentToolLogEntry => ({
  id: createId("tool"),
  label,
  status,
  detail,
  createdAt: new Date().toISOString(),
});

const summarizeSelection = (context: AgentContextSnapshot | null) => {
  if (!context?.selection) {
    return "None";
  }
  return `${context.selection.objectType}:${context.selection.objectId}`;
};

const sanitizePlan = (plan: AgentCommandPlan | null | undefined): AgentCommandPlan | null => {
  if (!plan || !Array.isArray(plan.commands) || plan.commands.length === 0) {
    return null;
  }
  return previewCommandPlan({
    summary: plan.summary || "Command plan",
    commands: plan.commands.map((command) => ({
      commandId: command.commandId,
      payload: command.payload ?? {},
      reason: command.reason,
    })),
  });
};

const MAX_AGENT_TOOL_ROUNDS = 2;

export const AgentSidebar = ({ onClose }: { onClose: () => void }) => {
  const [messages, setMessages] = useState<AgentChatMessage[]>([
    createMessage("assistant", "Ready. I can inspect the current project, offer suggestions, and prepare bounded command plans."),
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<AgentCommandPlan | null>(null);
  const [contextSnapshot, setContextSnapshot] = useState<AgentContextSnapshot | null>(null);
  const [toolLogs, setToolLogs] = useState<AgentToolLogEntry[]>([]);
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [lastWarning, setLastWarning] = useState<string | null>(null);

  useEffect(() => {
    const snapshot = createAgentDebugSnapshot({
      mounted: true,
      busy,
      messages,
      toolLogs,
      config,
      configError,
      lastWarning,
      pendingPlan,
      contextSnapshot,
    });
    setLatestAgentDebugSnapshot(snapshot);
    void publishAgentDebugSnapshot(snapshot);
  }, [busy, messages, toolLogs, config, configError, lastWarning, pendingPlan, contextSnapshot]);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([getAgentConfig(), getAgentContext()]).then(([configResult, contextResult]) => {
      if (!active) {
        return;
      }
      if (configResult.status === "fulfilled") {
        setConfig(configResult.value);
      } else {
        const message =
          configResult.reason instanceof Error ? configResult.reason.message : String(configResult.reason);
        setConfig({
          enabled: false,
          provider: "unavailable",
          model: null,
          apiKeyConfigured: false,
          testMode: false,
          visionEnabled: false,
          reason: message,
        });
        setConfigError(message);
      }
      if (contextResult.status === "fulfilled") {
        setContextSnapshot(contextResult.value);
      }
    });
    return () => {
      active = false;
      const snapshot = createAgentDebugSnapshot({
        mounted: false,
        busy: false,
        messages,
        toolLogs,
        config,
        configError,
        lastWarning,
        pendingPlan,
        contextSnapshot,
      });
      setLatestAgentDebugSnapshot(snapshot);
      void publishAgentDebugSnapshot(snapshot);
    };
  }, []);

  const contextSummary = useMemo(() => {
    if (!contextSnapshot) {
      return "Loading context...";
    }
    return `${contextSnapshot.project.title || "Untitled"} · ${contextSnapshot.project.pageCount} pages · ${contextSnapshot.imageAssets.length} images`;
  }, [contextSnapshot]);

  const configSummary = useMemo(() => {
    if (!config) {
      return "Checking Agent configuration...";
    }
    if (config.testMode) {
      return `Test mode · ${config.visionEnabled ? "vision enabled" : "vision unavailable"}`;
    }
    if (!config.enabled) {
      return config.reason ?? "Agent backend is not configured.";
    }
    return `OpenRouter · ${config.model ?? "model not set"} · ${
      config.visionEnabled ? "vision enabled" : "vision unavailable"
    }`;
  }, [config]);

  const appendLog = (log: AgentToolLogEntry) => {
    setToolLogs((current) => {
      const withoutSupersededPending = current.filter(
        (entry) => !(entry.label === log.label && entry.status === "pending"),
      );
      return [log, ...withoutSupersededPending].slice(0, 40);
    });
  };

  const appendMessage = (message: AgentChatMessage) => {
    setMessages((current) => [...current, message]);
  };

  const runPlan = async (plan: AgentCommandPlan, approved: boolean) => {
    setBusy(true);
    appendLog(createLog("executeCommandPlan", "pending", plan.summary));
    try {
      const result = await executeCommandPlan(plan, { approved });
      appendLog(
        createLog(
          "executeCommandPlan",
          "success",
          result.results.map((entry) => entry.commandId).join(", "),
        ),
      );
      setPendingPlan(null);
      const nextContext = await getAgentContext();
      setContextSnapshot(nextContext);
      appendMessage(createMessage("assistant", `Executed: ${result.results.map((entry) => entry.commandId).join(", ")}`));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(createLog("executeCommandPlan", "error", message));
      appendMessage(createMessage("assistant", message));
    } finally {
      setBusy(false);
    }
  };

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || busy) {
      return;
    }
    setInput("");
    setPendingPlan(null);
    setLastWarning(null);
    const userMessage = createMessage("user", trimmed);
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setBusy(true);
    appendLog(createLog("readContext", "pending"));
    try {
      if (!config?.enabled) {
        throw new Error(config?.reason ?? "Agent backend is not configured.");
      }
      const context = await getAgentContext();
      const harness = buildAgentHarness(context);
      setContextSnapshot(context);
      appendLog(
        createLog(
          "readContext",
          "success",
          `${context.project.pageCount} pages, ${context.pages.reduce(
            (count, page) => count + page.objects.length,
            0,
          )} objects, viewing ${context.currentPage?.name ?? "no page"}`,
        ),
      );
      appendLog(
        createLog(
          "agentHarness",
          "success",
          `${harness.tools.length} tools, ${harness.initialToolResults.length} initial reads`,
        ),
      );
      appendLog(createLog("agentChat", "pending", "Waiting for model response"));
      let dynamicToolResults: AgentHarnessToolResult[] = [];
      let payload = await chatWithAgent({
        messages: nextMessages.map(({ role, content }) => ({ role, content })),
        agentContext: context,
        harness,
        canvasSnapshot: context.canvasSnapshot,
      });
      for (let round = 0; round < MAX_AGENT_TOOL_ROUNDS && payload.requestedToolCalls?.length; round += 1) {
        const requestedCalls = payload.requestedToolCalls;
        appendLog(createLog("agentToolCalls", "pending", requestedCalls.map((call) => call.toolName).join(", ")));
        const toolResults: AgentHarnessToolResult[] = [];
        for (const call of requestedCalls) {
          appendLog(createLog(call.toolName, "pending", call.reason));
          const toolResult = await executeAgentHarnessToolCall(context, call);
          toolResults.push(toolResult);
          appendLog(createLog(call.toolName, "success", JSON.stringify(call.input)));
        }
        dynamicToolResults = [...dynamicToolResults, ...toolResults];
        appendLog(createLog("agentToolCalls", "success", `${toolResults.length} tool result(s)`));
        payload = await chatWithAgent({
          messages: nextMessages.map(({ role, content }) => ({ role, content })),
          agentContext: context,
          harness: buildAgentHarness(context, dynamicToolResults),
          canvasSnapshot: context.canvasSnapshot,
        });
      }
      if (payload.error) {
        throw new Error(payload.error);
      }
      if (payload.requestedToolCalls?.length) {
        throw new Error("Agent requested more tool calls than the current safety limit allows.");
      }
      appendLog(createLog("agentChat", "success", payload.usedVision === false ? "Responded without visual input" : "Model response received"));
      const warning = payload.warning ?? payload.visionUnavailableReason ?? null;
      if (warning) {
        setLastWarning(warning);
        appendLog(createLog("agentWarning", "error", warning));
      }
      appendMessage(createMessage("assistant", payload.message));
      for (const log of payload.toolLogs ?? []) {
        appendLog(log);
      }
      const plan = sanitizePlan(payload.pendingCommandPlan);
      if (!plan) {
        return;
      }
      setPendingPlan(plan);
      if (!plan.requiresConfirmation) {
        await runPlan(plan, true);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(createLog("agentChat", "error", message));
      appendMessage(createMessage("assistant", message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="right-sidebar agent-sidebar" aria-label="Agent sidebar">
      <section className="agent-header">
        <div>
          <p className="eyebrow">Agent</p>
          <h3>MangaMaker Agent</h3>
        </div>
        <button type="button" onClick={onClose} title="Close Agent">
          Inspector
        </button>
      </section>

      <section className="agent-config" aria-label="Agent configuration status">
        <h3>Configuration</h3>
        <p>{configSummary}</p>
        {configError ? <p className="agent-warning">{configError}</p> : null}
        {lastWarning ? <p className="agent-warning">{lastWarning}</p> : null}
      </section>

      <section className="agent-context" aria-label="Agent context summary">
        <h3>Context</h3>
        <p>{contextSummary}</p>
        <dl>
          <div>
            <dt>Selection</dt>
            <dd>{summarizeSelection(contextSnapshot)}</dd>
          </div>
          <div>
            <dt>Tool</dt>
            <dd>{contextSnapshot?.activeTool ?? "unknown"}</dd>
          </div>
          <div>
            <dt>Canvas</dt>
            <dd>
              {contextSnapshot?.canvasSnapshot.dataUrl
                ? `${contextSnapshot.canvasSnapshot.width}x${contextSnapshot.canvasSnapshot.height} (${contextSnapshot.canvasSnapshot.source ?? "unknown"})`
                : contextSnapshot?.canvasSnapshot.reason ?? "No snapshot"}
            </dd>
          </div>
        </dl>
        {contextSnapshot?.canvasSnapshot.dataUrl ? (
          <img
            className="agent-canvas-preview"
            src={contextSnapshot.canvasSnapshot.dataUrl}
            alt="Current canvas snapshot"
          />
        ) : null}
      </section>

      <AgentMessageList messages={messages} />

      <AgentCommandPlanView
        plan={pendingPlan}
        busy={busy}
        onConfirm={() => {
          if (pendingPlan) {
            void runPlan(pendingPlan, true);
          }
        }}
        onCancel={() => {
          setPendingPlan(null);
          appendLog(createLog("commandPlan", "success", "Cancelled"));
        }}
      />

      <AgentToolLog logs={toolLogs} />

      <form className="agent-input-row" onSubmit={sendMessage}>
        <textarea
          aria-label="Agent prompt"
          value={input}
          rows={3}
          placeholder={config?.enabled ? "Ask the agent..." : "Configure the Agent backend first."}
          onChange={(event) => setInput(event.currentTarget.value)}
          disabled={busy || config?.enabled !== true}
        />
        <button
          type="submit"
          className="primary-button"
          disabled={busy || config?.enabled !== true || input.trim().length === 0}
        >
          Send
        </button>
      </form>
    </aside>
  );
};
