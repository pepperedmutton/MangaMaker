import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getProjectFileClientId,
  loadProjectFromProjectsFolder,
  subscribeToProjectDraftUpdates,
} from "../../src/storage/projectFiles";

const originalFetch = globalThis.fetch;

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  closed = false;
  private readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((entry) => entry !== listener),
    );
  }

  close() {
    this.closed = true;
  }

  emit(type: string, payload: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(payload) } as MessageEvent);
    }
  }
}

describe("project file helpers", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    globalThis.fetch = originalFetch;
    FakeEventSource.instances = [];
    vi.restoreAllMocks();
  });

  it("reads a specific project draft when a project id is provided", async () => {
    (globalThis as { window?: unknown }).window = {};
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ project_json: "{\"id\":\"project 1\"}" }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const raw = await loadProjectFromProjectsFolder("project 1");

    expect(raw).toBe("{\"id\":\"project 1\"}");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/__mangamaker__/persistence/read_project_draft?project_id=project%201",
    );
  });

  it("ignores project draft events from the same browser client", () => {
    (globalThis as { window?: unknown }).window = {
      EventSource: FakeEventSource,
    };
    const received: unknown[] = [];

    const unsubscribe = subscribeToProjectDraftUpdates((event) => {
      received.push(event);
    });
    const source = FakeEventSource.instances[0];
    if (!source) {
      throw new Error("Expected EventSource to be created.");
    }

    source.emit("projectDraftWritten", {
      type: "projectDraftWritten",
      project_id: "p1",
      origin_client_id: getProjectFileClientId(),
    });
    source.emit("projectDraftWritten", {
      type: "projectDraftWritten",
      project_id: "p1",
      origin_client_id: "external-agent",
    });
    unsubscribe();

    expect(received).toEqual([
      {
        type: "projectDraftWritten",
        project_id: "p1",
        origin_client_id: "external-agent",
      },
    ]);
    expect(source.closed).toBe(true);
  });
});
