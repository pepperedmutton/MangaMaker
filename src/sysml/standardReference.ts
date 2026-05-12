export const SYSML_STANDARD_REFERENCE_VERSION =
  "SysML v2 textual notation, KerML foundation, and official Pilot 0.58.0 runtime";

export const SYSML_STANDARD_REFERENCE_TOPIC_IDS = [
  "language-foundation",
  "packages-imports-namespaces",
  "definitions-usages-specialization",
  "parts-structure-interfaces",
  "requirements-verification-traceability",
  "behavior-actions-states",
  "views-analysis-cases",
  "mangamaker-mbse-profile",
  "pilot-validation-workflow",
] as const;

export type SysmlStandardReferenceTopicId = typeof SYSML_STANDARD_REFERENCE_TOPIC_IDS[number];

export type SysmlStandardReferenceTopic = {
  id: SysmlStandardReferenceTopicId;
  title: string;
  purpose: string;
  guidance: string[];
  pilotNotes: string[];
};

export type SysmlStandardReferenceOverview = {
  version: string;
  standardRole: string;
  mandatoryRules: string[];
  topics: Array<Pick<SysmlStandardReferenceTopic, "id" | "title" | "purpose">>;
};

const topic = (entry: SysmlStandardReferenceTopic): SysmlStandardReferenceTopic => entry;

export const SYSML_STANDARD_REFERENCE_TOPICS: SysmlStandardReferenceTopic[] = [
  topic({
    id: "language-foundation",
    title: "Language Foundation",
    purpose: "SysML v2 is a formal systems-modeling language built on KerML. MangaMaker uses it as the durable engineering constraint model for manga production.",
    guidance: [
      "Treat the SysML model as formal project state, not prose chat. A valid model must parse and type-check under the official Pilot runtime.",
      "Use KerML/SysML textual notation intentionally: packages own model elements, definitions declare reusable types, usages instantiate or feature those types, and specialization refines semantics.",
      "Prefer a small, explicit model that validates over broad speculative syntax. If unsure, read an existing project SysML file or this reference topic before writing.",
      "Use doc comments to bind creative intent to formal model elements, but do not rely on doc comments alone for constraints that should be modeled as requirements, parts, or verification cases.",
    ],
    pilotNotes: [
      "The official Pilot validator is the source of truth for syntax and semantic acceptability in this project.",
      "A model is not complete merely because it is plausible English. After writeSysmlFile, call validateSysmlModel and report diagnostics if the Pilot rejects it.",
    ],
  }),
  topic({
    id: "packages-imports-namespaces",
    title: "Packages, Imports, and Namespaces",
    purpose: "SysML model files should be organized into packages with explicit imports and stable names.",
    guidance: [
      "Declare each file around one or more package blocks. Use stable package names that identify the manga project, domain library, sample, or verification model.",
      "Use private import for library namespaces and project domain packages unless the model intentionally re-exports names.",
      "Keep MangaMaker domain concepts in reusable domain packages, and project-specific pages, documents, roles, and requirements in project packages.",
      "Avoid duplicate visible element names in the same namespace. Prefer page-numbered and role-specific names that remain stable when prose changes.",
    ],
    pilotNotes: [
      "The Pilot resolves imports against the standard library and the validation file set supplied by MangaMaker.",
      "When validating one edited file that imports local project packages, validate the full project model unless you know the dependency closure is complete.",
    ],
  }),
  topic({
    id: "definitions-usages-specialization",
    title: "Definitions, Usages, and Specialization",
    purpose: "Agents must distinguish reusable definitions from project usages and use specialization deliberately.",
    guidance: [
      "Use definitions such as part def, requirement def, action def, state def, view def, or analysis case def for reusable types.",
      "Use usages such as part page001: ComicPage when modeling a concrete artifact in this MangaMaker project.",
      "Use :> to specialize a more general definition, for example a project requirement definition specializing the MangaMaker domain requirement type.",
      "Keep definitions reusable and usages concrete. Do not put page-specific content in a generic definition unless that type is meant to be reused by several pages.",
    ],
    pilotNotes: [
      "Specialization must target a visible, imported, valid model element. If the Pilot reports an unresolved name, read the package imports and domain file.",
      "When adding project usages, prefer types already defined in mangamaker-domain.sysml unless a new domain type is genuinely needed.",
    ],
  }),
  topic({
    id: "parts-structure-interfaces",
    title: "Parts, Structure, and Interfaces",
    purpose: "Comic products can be modeled as structured systems containing documents, pages, panels, text, bubbles, and image resources.",
    guidance: [
      "Represent the whole comic as a MangaProject usage. Represent production documents, pages, panels, text blocks, speech bubbles, and images as parts typed by MangaMaker domain definitions.",
      "Keep page identity above panel identity. A ComicPage may contain several StoryPanel parts; a panel never replaces a page.",
      "Use part structure to preserve traceability to MangaMaker artifacts: page ids, document paths, role metadocs, prompt collections, and rendered-review evidence.",
      "Introduce interface, port, item, or connection definitions only when the manga workflow truly needs flow or interaction modeling, such as asset handoff or approval state transfer.",
    ],
    pilotNotes: [
      "The default MangaMaker domain package supplies validated base definitions for common comic artifacts.",
      "When introducing new structure syntax, validate immediately; do not keep expanding a model after a structural diagnostic appears.",
    ],
  }),
  topic({
    id: "requirements-verification-traceability",
    title: "Requirements, Verification, and Traceability",
    purpose: "SysML requirements express binding production constraints and verification records for the manga as an engineered product.",
    guidance: [
      "Use requirement definitions for reusable requirement types and requirement usages or specialized definitions for project-specific constraints.",
      "Requirements should be testable or reviewable: page continuity, role output obligations, style constraints, panel intent, speech readability, and prompt provenance are good candidates.",
      "Trace requirements to the artifacts they constrain. For MangaMaker, that usually means project, document, page, panel, text, bubble, image asset, render review, or agent role.",
      "When a creator asks for engineering-grade control, update both the human-readable Markdown and the formal SysML requirement model where appropriate.",
    ],
    pilotNotes: [
      "If a satisfy, verify, or trace expression fails validation, preserve the requirement and report that trace linkage needs a syntax repair instead of claiming full validation.",
      "The Pilot can validate syntax and semantics; human review still decides whether a creative requirement is appropriate.",
    ],
  }),
  topic({
    id: "behavior-actions-states",
    title: "Behavior, Actions, and States",
    purpose: "Use behavior modeling when the comic production workflow or story mechanics need explicit ordering, state, or transitions.",
    guidance: [
      "Use actions or states to model production workflows, approval lifecycles, story beats, or transformations when a static part/requirement model is insufficient.",
      "Do not model every narrative sentence as a behavior. Reserve behavior models for constraints that affect sequencing, causality, review gates, or repeatable agent workflows.",
      "For MangaMaker agents, behavior models are useful for roles, tool use policies, verification flow, document lifecycle, and page production states.",
      "Keep behavior packages separate from page structure packages if that improves readability and validation isolation.",
    ],
    pilotNotes: [
      "Behavior syntax is more failure-prone than part and requirement syntax. Read this topic and validate a minimal behavior increment before extending it.",
      "When validation fails, reduce to a minimal action/state skeleton, validate, then re-add details.",
    ],
  }),
  topic({
    id: "views-analysis-cases",
    title: "Views and Analysis Cases",
    purpose: "Views and analysis cases describe how different roles inspect the manga engineering model.",
    guidance: [
      "Use views to define stakeholder-specific projections: producer, director, storyboard designer, script designer, art supervisor, continuity supervisor, and prompt engineer.",
      "Use analysis cases for structured checks such as pacing balance, visual continuity, requirement coverage, page-to-document traceability, and prompt consistency.",
      "Do not confuse a role's Markdown metadoc with a SysML view. The metadoc is human-readable working memory; the SysML view is a formal model element.",
      "A useful MangaMaker view should name the concern it serves and the model elements it must inspect.",
    ],
    pilotNotes: [
      "View and analysis packages from the standard library are available through Pilot imports, but project models should validate each added case.",
      "If an analysis case cannot be represented cleanly in SysML yet, record the analysis procedure in Markdown and model only the stable requirement or artifact relationships.",
    ],
  }),
  topic({
    id: "mangamaker-mbse-profile",
    title: "MangaMaker MBSE Profile",
    purpose: "MangaMaker applies SysML to comic production without replacing the human creator.",
    guidance: [
      "The human creator owns creative direction. SysML constrains and traces the product; it does not authorize the agent to become the author or final director.",
      "Map durable Markdown documents to ProductionDocument parts. Map role metadocs to AgentRole and ProductionDocument relationships where the project needs formal role accountability.",
      "Map pages to ComicPage parts, panels to StoryPanel parts, image resources to ImageResource parts, text to TextBlock parts, and speech bubbles to SpeechBubble parts.",
      "Use requirements for continuity, page intent, visual readability, role deliverables, prompt provenance, review gates, and other constraints the project must preserve.",
      "Keep SysML concise. The model should help agents decide what to inspect, edit, verify, and report; it should not duplicate the full raw comic assets.",
    ],
    pilotNotes: [
      "The default MangaMaker domain file is validated by the official Pilot and should be extended conservatively.",
      "If a MangaMaker concept is missing from the domain model, add a small typed definition and validate before using it throughout the project.",
    ],
  }),
  topic({
    id: "pilot-validation-workflow",
    title: "Pilot Validation Workflow",
    purpose: "Every SysML edit must close the loop through the official Pilot validator.",
    guidance: [
      "Before editing: readSysmlStandardOverview is already supplied, read the relevant reference topic if the task touches unfamiliar SysML semantics, then list and read only needed project model files.",
      "During editing: write complete file content with writeSysmlFile and a stable operationId. Do not invent partial patches in chat.",
      "After editing: run validateSysmlModel. Prefer full-project validation when imports or shared domain definitions are involved.",
      "After validation: report exactly what changed, which files were validated, whether Pilot accepted the model, and any diagnostics that remain.",
    ],
    pilotNotes: [
      "A write that succeeds but is not validated is only saved text, not a verified MBSE model update.",
      "If the validator is unavailable, report the unavailable reason and do not claim SysML conformance.",
    ],
  }),
];

const topicsById = new Map(SYSML_STANDARD_REFERENCE_TOPICS.map((entry) => [entry.id, entry]));

export const getSysmlStandardOverview = (): SysmlStandardReferenceOverview => ({
  version: SYSML_STANDARD_REFERENCE_VERSION,
  standardRole:
    "MangaMaker uses SysML v2 as a formal MBSE constraint model. Agents must use this harness reference plus the official Pilot validator instead of relying on chat memory alone.",
  mandatoryRules: [
    "Read only the SysML reference topics needed for the task; do not bulk-load unrelated model files.",
    "Use packages, imports, definitions, usages, specialization, parts, requirements, views, and verification concepts according to their SysML roles.",
    "Represent MangaMaker artifacts explicitly: project, documents, roles, pages, panels, text, bubbles, image resources, and review/validation evidence.",
    "Write SysML/KerML only through writeSysmlFile with an operationId.",
    "Validate every SysML edit with validateSysmlModel and never claim conformance without Pilot validation.",
  ],
  topics: SYSML_STANDARD_REFERENCE_TOPICS.map(({ id, title, purpose }) => ({ id, title, purpose })),
});

export const readSysmlStandardReferenceTopic = (
  topicId: SysmlStandardReferenceTopicId,
): SysmlStandardReferenceTopic => {
  const reference = topicsById.get(topicId);
  if (!reference) {
    throw new Error(`Unknown SysML standard reference topic: ${topicId}`);
  }
  return reference;
};

export const isSysmlStandardReferenceTopicId = (
  value: string,
): value is SysmlStandardReferenceTopicId =>
  SYSML_STANDARD_REFERENCE_TOPIC_IDS.includes(value as SysmlStandardReferenceTopicId);
