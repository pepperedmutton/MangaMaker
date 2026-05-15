import { describe, expect, it } from "vitest";
import {
  AGENT_DEFAULT_DOCUMENT_DEFINITIONS,
  agentDocumentFromMarkdown,
  agentDocumentManifestSchema,
  buildAgentDocumentMarkdown,
  createAgentRoleMetadocDocumentId,
  createAgentRoleMetadocPath,
  createUniqueAgentDocumentPathFromTitle,
  createDefaultAgentRolesForDocuments,
  createAgentDocumentMeta,
  normalizeAgentRoleMetadocFileStem,
  parseAgentDocumentMarkdown,
} from "../../src/agent/documentSchema";
import { AGENT_ROLE_METADOC_PROMPT } from "../../src/agent/roles";

describe("agent documents", () => {
  it("defines durable default role documents", () => {
    expect(AGENT_DEFAULT_DOCUMENT_DEFINITIONS.map((entry) => entry.id)).toEqual([
      "prime-directive",
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
    expect(AGENT_DEFAULT_DOCUMENT_DEFINITIONS[0]).toMatchObject({
      id: "prime-directive",
      path: "docs/PrimeDirective.md",
    });
    expect(AGENT_DEFAULT_DOCUMENT_DEFINITIONS[0]).not.toHaveProperty("role");
    expect(
      Object.fromEntries(
        AGENT_DEFAULT_DOCUMENT_DEFINITIONS
          .filter((entry) => entry.role)
          .map((entry) => [entry.role, entry.path]),
      ),
    ).toMatchObject({
      assistant: "docs/roles/Assistant.md",
      producer: "docs/roles/Producer.md",
      director: "docs/roles/Director.md",
      storyboardDesigner: "docs/roles/Storyboard Designer.md",
      scriptDesigner: "docs/roles/Script Designer.md",
      artSupervisor: "docs/roles/Art Supervisor.md",
      continuitySupervisor: "docs/roles/Continuity Supervisor.md",
      promptEngineer: "docs/roles/Prompt Engineer.md",
    });
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
    expect(roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "producer", workingDirectory: "docs/work/producer" }),
        expect.objectContaining({ id: "director", workingDirectory: "docs/work/director" }),
      ]),
    );
    expect(roles.every((role) => role.title === role.name)).toBe(true);
    expect(roles.every((role) => role.prompt === AGENT_ROLE_METADOC_PROMPT)).toBe(true);
    const assistantMetadoc = documents.find((document) => document.id === "assistant-metadoc");
    expect(assistantMetadoc).toBeTruthy();
    expect(
      agentDocumentManifestSchema.parse({
        projectId: "project-1",
        updatedAt: "2026-01-01T00:00:00.000Z",
        documents: [{ ...assistantMetadoc!, role: undefined }],
      }),
    ).toMatchObject({
      roleSetupVersion: 0,
      roles: [],
      documents: [expect.objectContaining({ id: "assistant-metadoc" })],
    });
  });

  it("keeps default metadocs as role prompts instead of work-output logs", () => {
    const assistantMetadoc = AGENT_DEFAULT_DOCUMENT_DEFINITIONS.find((entry) => entry.id === "assistant-metadoc");
    const producerMetadoc = AGENT_DEFAULT_DOCUMENT_DEFINITIONS.find((entry) => entry.id === "production-plan");

    expect(assistantMetadoc?.body).toContain("role prompt");
    expect(assistantMetadoc?.body).toContain("docs/work/assistant");
    expect(assistantMetadoc?.body).not.toContain("## Output Log");
    expect(producerMetadoc?.body).toContain("docs/work/producer");
    expect(producerMetadoc?.body).not.toContain("## Task Board");
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

  it("derives role metadoc file names directly from role names", () => {
    expect(normalizeAgentRoleMetadocFileStem("小说家")).toBe("小说家");
    expect(createAgentRoleMetadocDocumentId("小说家")).toBe("小说家");
    expect(createAgentRoleMetadocPath("小说家")).toBe("docs/roles/小说家.md");
    expect(createAgentRoleMetadocPath("Scene Supervisor")).toBe("docs/roles/Scene Supervisor.md");
    expect(createAgentRoleMetadocPath("bad/name:role", "role-1")).toBe("docs/roles/bad-name-role.md");
    expect(createAgentRoleMetadocPath("CON", "role-1")).toBe("docs/roles/role-1.md");
  });

  it("uses document titles for default Markdown file names", () => {
    expect(createUniqueAgentDocumentPathFromTitle("Scene Notes", "docs/script", [], null, "document")).toBe(
      "docs/script/Scene Notes.md",
    );
    expect(
      createUniqueAgentDocumentPathFromTitle("\u7b2c\u5341\u9875\u914d\u6587", "docs/work/novelist", [], null, "document"),
    ).toBe("docs/work/novelist/\u7b2c\u5341\u9875\u914d\u6587.md");
    expect(
      createUniqueAgentDocumentPathFromTitle(
        "Scene Notes",
        "docs/script",
        [{ id: "scene-notes", path: "docs/script/Scene Notes.md" }],
        null,
        "document",
      ),
    ).toBe("docs/script/Scene Notes 2.md");
  });
});
