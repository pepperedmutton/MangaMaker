import { describe, expect, it } from "vitest";
import {
  AGENT_DEFAULT_DOCUMENT_DEFINITIONS,
  agentDocumentFromMarkdown,
  agentDocumentManifestSchema,
  buildAgentDocumentMarkdown,
  createDefaultAgentRolesForDocuments,
  createAgentDocumentMeta,
  parseAgentDocumentMarkdown,
} from "../../src/agent/documentSchema";

describe("agent documents", () => {
  it("defines durable default role documents", () => {
    expect(AGENT_DEFAULT_DOCUMENT_DEFINITIONS.map((entry) => entry.id)).toEqual([
      "assistant-metadoc",
      "production-plan",
      "story-architecture",
      "storyboard-overview",
      "script-dialogue",
      "art-supervision",
      "continuity-check",
      "image-prompts",
    ]);
    expect(AGENT_DEFAULT_DOCUMENT_DEFINITIONS.every((entry) => entry.path.startsWith("docs/"))).toBe(true);
  });

  it("models roles as metadoc bindings and keeps documents role-optional", () => {
    const documents = AGENT_DEFAULT_DOCUMENT_DEFINITIONS.map((definition) =>
      createAgentDocumentMeta(definition, "2026-01-01T00:00:00.000Z"),
    );
    const roles = createDefaultAgentRolesForDocuments(documents);
    expect(roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "producer", metadocId: "production-plan" }),
        expect.objectContaining({ id: "director", metadocId: "story-architecture" }),
        expect.objectContaining({ id: "promptEngineer", metadocId: "image-prompts" }),
      ]),
    );
    expect(
      agentDocumentManifestSchema.parse({
        projectId: "project-1",
        updatedAt: "2026-01-01T00:00:00.000Z",
        documents: [{ ...documents[0], role: undefined }],
      }),
    ).toMatchObject({
      roleSetupVersion: 0,
      roles: [],
      documents: [expect.objectContaining({ id: "assistant-metadoc" })],
    });
  });

  it("round-trips Markdown frontmatter and content", () => {
    const productionPlan = AGENT_DEFAULT_DOCUMENT_DEFINITIONS.find((entry) => entry.id === "production-plan");
    expect(productionPlan).toBeTruthy();
    const meta = createAgentDocumentMeta(productionPlan!, "2026-01-01T00:00:00.000Z");
    const markdown = buildAgentDocumentMarkdown(
      {
        ...meta,
        relatedPageIds: ["page-1"],
        status: "ready",
      },
      "# Production Plan\n\nKeep this in Markdown.",
    );
    const parsed = parseAgentDocumentMarkdown(markdown);
    expect(parsed.frontmatter).toMatchObject({
      id: "production-plan",
      title: "Production Plan",
      status: "ready",
      relatedPageIds: ["page-1"],
    });
    expect(parsed.body).toContain("Keep this in Markdown.");

    expect(agentDocumentFromMarkdown(meta, markdown)).toMatchObject({
      id: "production-plan",
      relatedPageIds: ["page-1"],
      content: expect.stringContaining("Keep this in Markdown."),
    });
  });
});
