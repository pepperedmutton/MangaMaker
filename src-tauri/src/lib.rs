use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

const PROJECTS_DIR_NAME: &str = "projects";
const PROJECT_META_FILE: &str = ".latest_project";
const PROJECT_JSON_FILE: &str = "project.json";
const PROJECT_ASSETS_DIR: &str = "assets";
const AGENT_CONVERSATION_CONTEXT_FILE: &str = "agent-conversation-context.json";
const LEGACY_AGENT_CHAT_HISTORY_FILE: &str = "agent-chat.json";
const DEFAULT_AGENT_CONVERSATION_ROLE_ID: &str = "assistant";
const AGENT_DOCS_DIR: &str = "docs";
const AGENT_DOCS_MANIFEST_FILE: &str = "manifest.json";
const AGENT_PRIME_DIRECTIVE_DOCUMENT_ID: &str = "prime-directive";
const AGENT_ROLE_METADOC_PROMPT: &str = "Use the active role metadoc as this role's prompt. Read project documents as needed, but write durable role output only in the role working directory.";
const KIMI_K2_6_CONTEXT_WINDOW_TOKENS: u32 = 262_144;
const MIN_AGENT_CONTEXT_WINDOW_TOKENS: u32 = 8_192;

fn default_agent_conversation_role_id() -> String {
    DEFAULT_AGENT_CONVERSATION_ROLE_ID.to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentConfig {
    enabled: bool,
    provider: String,
    model: Option<String>,
    model_capability: Option<String>,
    api_key_configured: bool,
    test_mode: bool,
    vision_enabled: bool,
    context_window_tokens: u32,
    context_window_max_tokens: Option<u32>,
    context_window_source: String,
    repetition_penalty: f64,
    reason: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentChatPayload {
    #[allow(dead_code)]
    messages: Option<Vec<serde_json::Value>>,
    #[allow(dead_code)]
    agent_context: Option<serde_json::Value>,
    #[allow(dead_code)]
    canvas_snapshot: Option<serde_json::Value>,
    #[allow(dead_code)]
    context_window_tokens: Option<u32>,
    #[allow(dead_code)]
    repetition_penalty: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentChatResponse {
    message: String,
    pending_command_plan: Option<serde_json::Value>,
    used_vision: bool,
    warning: Option<String>,
    vision_unavailable_reason: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentChatMessage {
    id: String,
    role: String,
    content: String,
    created_at: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentConversationContext {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    context_id: Option<String>,
    project_id: String,
    #[serde(default = "default_agent_conversation_role_id")]
    role_id: String,
    updated_at: String,
    messages: Vec<AgentChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    storage_path: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentConversationContextStore {
    project_id: String,
    updated_at: String,
    contexts: Vec<AgentConversationContext>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AgentDocumentMeta {
    id: String,
    title: String,
    role: Option<String>,
    status: String,
    path: String,
    related_page_ids: Vec<String>,
    updated_at: String,
    last_agent_run_id: Option<String>,
    summary: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AgentDocument {
    id: String,
    title: String,
    role: Option<String>,
    status: String,
    path: String,
    related_page_ids: Vec<String>,
    updated_at: String,
    last_agent_run_id: Option<String>,
    summary: Option<String>,
    content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentDocumentInput {
    id: Option<String>,
    title: Option<String>,
    role: Option<String>,
    status: Option<String>,
    path: Option<String>,
    related_page_ids: Option<Vec<String>>,
    last_agent_run_id: Option<String>,
    summary: Option<String>,
    expected_updated_at: Option<String>,
    content: String,
}

#[derive(Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
struct AgentRoleDefinition {
    id: String,
    name: String,
    title: String,
    metadoc_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    working_directory: Option<String>,
    default_autonomy: String,
    allowed_command_groups: Vec<String>,
    preferred_tools: Vec<String>,
    prompt: String,
    built_in: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentRoleInput {
    id: Option<String>,
    name: Option<String>,
    metadoc_id: Option<String>,
    working_directory: Option<String>,
    default_autonomy: Option<String>,
    allowed_command_groups: Option<Vec<String>>,
    preferred_tools: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AgentDocumentManifest {
    project_id: String,
    updated_at: String,
    #[serde(default)]
    role_setup_version: u32,
    documents: Vec<AgentDocumentMeta>,
    #[serde(default)]
    roles: Vec<AgentRoleDefinition>,
}

struct DefaultAgentDocumentDefinition {
    id: &'static str,
    title: &'static str,
    role: Option<&'static str>,
    path: &'static str,
    summary: &'static str,
    body: &'static str,
}

fn read_env_trimmed(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn parse_agent_context_window_tokens(value: Option<String>) -> Option<u32> {
    value
        .and_then(|entry| entry.parse::<u32>().ok())
        .map(|tokens| tokens.max(MIN_AGENT_CONTEXT_WINDOW_TOKENS))
}

fn agent_context_window_fields(model: Option<&str>, test_mode: bool) -> (u32, Option<u32>, String) {
    let env_tokens = parse_agent_context_window_tokens(
        read_env_trimmed("MANGAMAKER_AGENT_CONTEXT_WINDOW_TOKENS")
            .or_else(|| read_env_trimmed("MANGAMAKER_AGENT_CONTEXT_WINDOW")),
    );
    let model_max = if model == Some("moonshotai/kimi-k2.6") {
        Some(KIMI_K2_6_CONTEXT_WINDOW_TOKENS)
    } else {
        None
    };
    let (source, value) = if let Some(tokens) = env_tokens {
        ("env".to_string(), tokens)
    } else if let Some(tokens) = model_max {
        ("model".to_string(), tokens)
    } else if test_mode {
        ("test".to_string(), KIMI_K2_6_CONTEXT_WINDOW_TOKENS)
    } else {
        ("default".to_string(), KIMI_K2_6_CONTEXT_WINDOW_TOKENS)
    };
    let clamped = model_max
        .map(|max_tokens| value.min(max_tokens))
        .unwrap_or(value)
        .max(MIN_AGENT_CONTEXT_WINDOW_TOKENS);
    (clamped, model_max, source)
}

fn parse_agent_repetition_penalty() -> f64 {
    let parsed = read_env_trimmed("MANGAMAKER_AGENT_REPETITION_PENALTY")
        .and_then(|value| value.parse::<f64>().ok())
        .unwrap_or(1.05);
    parsed.clamp(1.0, 2.0)
}

fn current_agent_config() -> AgentConfig {
    let test_mode = std::env::var("MANGAMAKER_AGENT_TEST_MODE").ok().as_deref() == Some("1");
    let model = read_env_trimmed("MANGAMAKER_AGENT_MODEL");
    let api_key_configured = read_env_trimmed("OPENROUTER_API_KEY").is_some();
    let (context_window_tokens, context_window_max_tokens, context_window_source) =
        agent_context_window_fields(model.as_deref(), test_mode);
    let repetition_penalty = parse_agent_repetition_penalty();

    if test_mode {
        return AgentConfig {
            enabled: true,
            provider: "test".to_string(),
            model: Some(model.unwrap_or_else(|| "mangamaker-test-agent".to_string())),
            model_capability: Some("multimodal".to_string()),
            api_key_configured,
            test_mode: true,
            vision_enabled: true,
            context_window_tokens,
            context_window_max_tokens,
            context_window_source,
            repetition_penalty,
            reason: None,
        };
    }

    AgentConfig {
        enabled: false,
        provider: "unavailable".to_string(),
        model,
        model_capability: None,
        api_key_configured,
        test_mode: false,
        vision_enabled: false,
        context_window_tokens,
        context_window_max_tokens,
        context_window_source,
        repetition_penalty,
        reason: Some(
            "The desktop production Agent backend is not configured in this build. Use the Vite web backend or enable a native Agent proxy before chatting.".to_string(),
        ),
    }
}

fn sanitize_path_component(value: &str, fallback: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = sanitized.trim_matches('_').to_string();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed
    }
}

fn normalize_agent_role_metadoc_file_stem(role_name: &str, fallback: &str) -> String {
    let mut stem = role_name.trim().trim_end_matches(".md").to_string();
    let invalid_chars = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    stem = stem
        .chars()
        .map(|ch| {
            if invalid_chars.contains(&ch) || ch.is_control() {
                '-'
            } else {
                ch
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    stem = stem
        .trim_matches(|ch| ch == '-' || ch == '.' || ch == ' ')
        .to_string();
    if stem.is_empty() {
        stem = fallback.to_string();
    }
    let reserved = [
        "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7",
        "com8", "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8",
        "lpt9",
    ];
    if reserved.contains(&stem.to_lowercase().as_str()) {
        fallback.to_string()
    } else {
        stem
    }
}

fn create_agent_role_metadoc_path(role_name: &str, fallback: &str) -> String {
    format!(
        "{AGENT_DOCS_DIR}/roles/{}.md",
        normalize_agent_role_metadoc_file_stem(role_name, fallback)
    )
}

fn create_unique_agent_document_path_from_title(
    title: &str,
    directory: &str,
    documents: &[AgentDocumentMeta],
    ignore_document_id: Option<&str>,
    fallback: &str,
) -> String {
    let directory = directory
        .trim()
        .replace('\\', "/")
        .trim_start_matches('/')
        .to_string();
    let directory = if directory.starts_with(&format!("{AGENT_DOCS_DIR}/")) {
        directory
    } else if directory.is_empty() {
        format!("{AGENT_DOCS_DIR}/general")
    } else {
        format!("{AGENT_DOCS_DIR}/{directory}")
    };
    let stem = normalize_agent_role_metadoc_file_stem(title, fallback);
    let mut candidate = format!("{directory}/{stem}.md");
    let mut index = 2;
    while documents.iter().any(|document| {
        Some(document.id.as_str()) != ignore_document_id &&
            document.path.eq_ignore_ascii_case(&candidate)
    }) {
        candidate = format!("{directory}/{stem} {index}.md");
        index += 1;
    }
    candidate
}

fn create_agent_role_working_directory(role_id: &str, fallback: &str) -> String {
    format!(
        "{AGENT_DOCS_DIR}/work/{}",
        normalize_agent_role_metadoc_file_stem(role_id, fallback).replace(' ', "-")
    )
}

fn ensure_projects_root() -> Result<PathBuf, String> {
    let cwd = std::env::current_dir().map_err(|error| error.to_string())?;
    let root = cwd.join(PROJECTS_DIR_NAME);
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    Ok(root)
}

fn resolve_project_dir(root: &Path, project_id: &str) -> PathBuf {
    let project_folder = sanitize_path_component(project_id, "project");
    root.join(project_folder)
}

fn read_project_id(project_file: &Path) -> Option<String> {
    let raw = fs::read_to_string(project_file).ok()?;
    let json = serde_json::from_str::<serde_json::Value>(&raw).ok()?;
    json.get("id")
        .and_then(|entry| entry.as_str())
        .map(|entry| entry.to_string())
}

fn find_project_dir_by_id(root: &Path, project_id: &str) -> Option<PathBuf> {
    let legacy_dir = resolve_project_dir(root, project_id);
    if legacy_dir.exists() && legacy_dir.is_dir() {
        return Some(legacy_dir);
    }

    let entries = fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let project_file = path.join(PROJECT_JSON_FILE);
        if !project_file.exists() {
            continue;
        }
        if read_project_id(&project_file).as_deref() == Some(project_id) {
            return Some(path);
        }
    }

    None
}

fn public_project_relative_path(path: &Path) -> String {
    std::env::current_dir()
        .ok()
        .and_then(|cwd| path.strip_prefix(cwd).ok().map(|entry| entry.to_path_buf()))
        .unwrap_or_else(|| path.to_path_buf())
        .to_string_lossy()
        .replace('\\', "/")
}

fn now_millis_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn default_agent_documents() -> Vec<DefaultAgentDocumentDefinition> {
    vec![
        DefaultAgentDocumentDefinition {
            id: AGENT_PRIME_DIRECTIVE_DOCUMENT_ID,
            title: "Prime Directive",
            role: None,
            path: "docs/PrimeDirective.md",
            summary: "Project-level prime directive that defines the work type, target form, operating constraints, and all-Agent priorities.",
            body: "# Prime Directive\n\n## Project Form\n\nDefine what this project is. Examples: manga, CG set, illustrated light novel, storyboard pack, prompt book, or another concrete form.\n\n## Creator Intent\n\nState what the human creator wants this project to become, including audience, tone, format, and delivery target.\n\n## Agent Operating Directive\n\n- This document is project-level direction for every Agent role.\n- Agents must interpret role metadocs, page evidence, scripts, prompts, and ordinary documents through this directive.\n- If a role metadoc or chat instruction conflicts with this document, follow this document and report the conflict.\n- Role metadocs are role prompts and role definitions only. Agent work output belongs in that role's working directory.\n- Agents cannot rewrite this directive through Agent document tools.\n\n## Project-Specific Rules\n\n- Work type:\n- Must preserve:\n- Must avoid:\n- Definition of done:\n",
        },
        DefaultAgentDocumentDefinition {
            id: "assistant-metadoc",
            title: "Assistant Metadoc",
            role: Some("assistant"),
            path: "docs/roles/Assistant.md",
            summary: "General assistant role prompt/definition. Durable assistance output belongs under the assistant working directory.",
            body: "# Assistant Metadoc\n\n## Role\n\nAssist the human creator with project inspection, suggestions, manual edit guidance, and durable documentation updates.\n\n## Operating Rules\n\n- Read only the documents, pages, assets, and renders needed for the current request.\n- Do not treat conversation context as production state.\n- Record durable output under `docs/work/assistant/`.\n\n## Context Priority\n\nPinned context is the system prompt, `docs/PrimeDirective.md`, and this role prompt. Working output can be evicted from the model window and reread on demand.\n",
        },
        DefaultAgentDocumentDefinition {
            id: "production-plan",
            title: "Production Plan",
            role: Some("producer"),
            path: "docs/roles/Producer.md",
            summary: "Producer role prompt/definition. Producer output belongs under docs/work/producer/.",
            body: "# Production Plan\n\n## Role\n\nPlan production work, scope, acceptance criteria, unresolved decisions, and task order for the human creator.\n\n## Operating Rules\n\n- Treat this metadoc as role prompt and role definition only.\n- Put producer output under `docs/work/producer/`.\n- Do not modify comic pages directly.\n",
        },
        DefaultAgentDocumentDefinition {
            id: "story-architecture",
            title: "Story Architecture",
            role: Some("director"),
            path: "docs/roles/Director.md",
            summary: "Director role prompt/definition. Director output belongs under docs/work/director/.",
            body: "# Story Architecture\n\n## Role\n\nThe director supervises page intent, rhythm, shot order, reader attention, and whether execution serves the documented story plan.\n\n## Operating Rules\n\n- Treat this metadoc as role prompt and role definition only.\n- Put story architecture, direction decisions, and supervision notes under `docs/work/director/`.\n- Use page/render evidence only when it is needed for the current request.\n",
        },
        DefaultAgentDocumentDefinition {
            id: "storyboard-overview",
            title: "Storyboard Overview",
            role: Some("storyboardDesigner"),
            path: "docs/roles/Storyboard Designer.md",
            summary: "Storyboard designer role prompt/definition. Storyboard output belongs under docs/work/storyboardDesigner/.",
            body: "# Storyboard Overview\n\n## Role\n\nDesign page beats, panel structure, camera distance, composition, and reading flow.\n\n## Operating Rules\n\n- Treat this metadoc as role prompt and role definition only.\n- Put storyboard output under `docs/work/storyboardDesigner/`.\n- Record proposed page/panel edits in Markdown instead of executing them directly.\n",
        },
        DefaultAgentDocumentDefinition {
            id: "script-dialogue",
            title: "Script and Dialogue",
            role: Some("scriptDesigner"),
            path: "docs/roles/Script Designer.md",
            summary: "Script designer role prompt/definition. Script output belongs under docs/work/scriptDesigner/.",
            body: "# Script and Dialogue\n\n## Role\n\nDesign dialogue, captions, narration, tone, and text-placement notes.\n\n## Operating Rules\n\n- Treat this metadoc as role prompt and role definition only.\n- Put script and dialogue output under `docs/work/scriptDesigner/`.\n- Keep manga text concise and map wording to page/panel/object ids when available.\n",
        },
        DefaultAgentDocumentDefinition {
            id: "art-supervision",
            title: "Art Supervision",
            role: Some("artSupervisor"),
            path: "docs/roles/Art Supervisor.md",
            summary: "Art supervisor role prompt/definition. Art supervision output belongs under docs/work/artSupervisor/.",
            body: "# Art Supervision\n\n## Role\n\nReview visual style, rendering consistency, image assets, crops, composition, and art-direction risks.\n\n## Operating Rules\n\n- Treat this metadoc as role prompt and role definition only.\n- Put art supervision output under `docs/work/artSupervisor/`.\n- Compare resources with rendered pages only when the task needs visual evidence.\n",
        },
        DefaultAgentDocumentDefinition {
            id: "continuity-check",
            title: "Continuity Check",
            role: Some("continuitySupervisor"),
            path: "docs/roles/Continuity Supervisor.md",
            summary: "Continuity supervisor role prompt/definition. Continuity output belongs under docs/work/continuitySupervisor/.",
            body: "# Continuity Check\n\n## Role\n\nCheck page order, character state, props, dialogue continuity, reading order, and unresolved continuity issues.\n\n## Operating Rules\n\n- Treat this metadoc as role prompt and role definition only.\n- Put continuity output under `docs/work/continuitySupervisor/`.\n- Request bounded page samples unless the creator narrows the scope.\n",
        },
        DefaultAgentDocumentDefinition {
            id: "image-prompts",
            title: "Image Prompts",
            role: Some("promptEngineer"),
            path: "docs/roles/Prompt Engineer.md",
            summary: "Prompt engineer role prompt/definition. Prompt output belongs under docs/work/promptEngineer/.",
            body: "# Image Prompts\n\n## Role\n\nDesign image prompts, prompt rules, negative constraints, and page/panel prompt records.\n\n## Operating Rules\n\n- Treat this metadoc as role prompt and role definition only.\n- Put prompt rules and generated prompts under `docs/work/promptEngineer/`.\n- Keep prompts mapped to page or panel ids when possible.\n",
        },
    ]
}

fn stringify_agent_document_frontmatter(meta: &AgentDocumentMeta) -> String {
    let related_page_ids = serde_json::to_string(&meta.related_page_ids).unwrap_or_else(|_| "[]".to_string());
    let mut lines = vec![
        "---".to_string(),
        format!("id: {}", serde_json::to_string(&meta.id).unwrap_or_default()),
        format!("title: {}", serde_json::to_string(&meta.title).unwrap_or_default()),
        format!("status: {}", serde_json::to_string(&meta.status).unwrap_or_default()),
        format!("path: {}", serde_json::to_string(&meta.path).unwrap_or_default()),
        format!("relatedPageIds: {related_page_ids}"),
        format!("updatedAt: {}", serde_json::to_string(&meta.updated_at).unwrap_or_default()),
    ];
    if let Some(value) = &meta.role {
        lines.insert(3, format!("role: {}", serde_json::to_string(value).unwrap_or_default()));
    }
    if let Some(value) = &meta.last_agent_run_id {
        lines.push(format!("lastAgentRunId: {}", serde_json::to_string(value).unwrap_or_default()));
    }
    if let Some(value) = &meta.summary {
        lines.push(format!("summary: {}", serde_json::to_string(value).unwrap_or_default()));
    }
    lines.push("---".to_string());
    lines.join("\n")
}

fn build_agent_document_markdown(meta: &AgentDocumentMeta, body: &str) -> String {
    format!("{}\n{}\n", stringify_agent_document_frontmatter(meta), body.trim_start_matches('\n'))
}

fn create_agent_document_meta(definition: &DefaultAgentDocumentDefinition, updated_at: &str) -> AgentDocumentMeta {
    AgentDocumentMeta {
        id: definition.id.to_string(),
        title: definition.title.to_string(),
        role: definition.role.map(|value| value.to_string()),
        status: "draft".to_string(),
        path: definition.path.to_string(),
        related_page_ids: Vec::new(),
        updated_at: updated_at.to_string(),
        last_agent_run_id: None,
        summary: Some(definition.summary.to_string()),
    }
}

fn default_agent_roles_for_documents(documents: &[AgentDocumentMeta]) -> Vec<AgentRoleDefinition> {
    let has_doc = |document_id: &str| documents.iter().any(|document| document.id == document_id);
    let mut roles = Vec::new();
    let mut push_role = |id: &str,
                         name: &str,
                         title: &str,
                         metadoc_id: &str,
                         default_autonomy: &str,
                         allowed_command_groups: Vec<&str>,
                         preferred_tools: Vec<&str>,
                         prompt: &str| {
        if has_doc(metadoc_id) {
            roles.push(AgentRoleDefinition {
                id: id.to_string(),
                name: name.to_string(),
                title: title.to_string(),
                metadoc_id: metadoc_id.to_string(),
                working_directory: Some(create_agent_role_working_directory(id, id)),
                default_autonomy: default_autonomy.to_string(),
                allowed_command_groups: allowed_command_groups.into_iter().map(|entry| entry.to_string()).collect(),
                preferred_tools: preferred_tools.into_iter().map(|entry| entry.to_string()).collect(),
                prompt: prompt.to_string(),
                built_in: true,
            });
        }
    };
    push_role(
        "assistant",
        "Assistant",
        "Assistant",
        "assistant-metadoc",
        "confirmEveryMutation",
        vec!["read", "document", "safeCurrentPageEdit"],
        vec!["readDocument", "searchProject", "readPage", "listDocuments"],
        AGENT_ROLE_METADOC_PROMPT,
    );
    push_role(
        "producer",
        "Producer",
        "Producer",
        "production-plan",
        "adviseOnly",
        vec!["read", "document"],
        vec!["listDocuments", "readDocument", "writeDocument", "searchDocuments"],
        AGENT_ROLE_METADOC_PROMPT,
    );
    push_role(
        "director",
        "Director",
        "Director",
        "story-architecture",
        "confirmEveryMutation",
        vec!["read", "document", "safeCurrentPageEdit", "visualReview"],
        vec!["readDocument", "readPage", "renderPage", "writeDocument", "listCommandManifest"],
        AGENT_ROLE_METADOC_PROMPT,
    );
    push_role(
        "storyboardDesigner",
        "Storyboard Designer",
        "Storyboard Designer",
        "storyboard-overview",
        "autoSafeCurrentPage",
        vec!["read", "document", "safeCurrentPageEdit", "layout"],
        vec!["readDocument", "readPage", "renderPage", "writeDocument", "listCommandManifest"],
        AGENT_ROLE_METADOC_PROMPT,
    );
    push_role(
        "scriptDesigner",
        "Script Designer",
        "Script Designer",
        "script-dialogue",
        "autoSafeCurrentPage",
        vec!["read", "document", "safeCurrentPageEdit", "text"],
        vec!["readDocument", "readPage", "searchProject", "writeDocument", "listCommandManifest"],
        AGENT_ROLE_METADOC_PROMPT,
    );
    push_role(
        "artSupervisor",
        "Art Supervisor",
        "Art Supervisor",
        "art-supervision",
        "confirmEveryMutation",
        vec!["read", "document", "visualReview"],
        vec!["listImageAssets", "readPage", "renderPage", "writeDocument"],
        AGENT_ROLE_METADOC_PROMPT,
    );
    push_role(
        "continuitySupervisor",
        "Continuity Supervisor",
        "Continuity Supervisor",
        "continuity-check",
        "confirmEveryMutation",
        vec!["read", "document", "visualReview"],
        vec!["listPages", "readPages", "renderPages", "writeDocument", "searchDocuments"],
        AGENT_ROLE_METADOC_PROMPT,
    );
    push_role(
        "promptEngineer",
        "Prompt Engineer",
        "Prompt Engineer",
        "image-prompts",
        "adviseOnly",
        vec!["read", "document"],
        vec!["readDocument", "listImageAssets", "readPage", "writeDocument"],
        AGENT_ROLE_METADOC_PROMPT,
    );
    roles.sort_by(|left, right| left.name.cmp(&right.name));
    roles
}

fn normalize_agent_roles_for_documents(
    roles: Vec<AgentRoleDefinition>,
    documents: &[AgentDocumentMeta],
) -> Vec<AgentRoleDefinition> {
    let mut normalized = Vec::new();
    let mut role_ids: Vec<String> = Vec::new();
    let mut metadoc_ids: Vec<String> = Vec::new();
    for role in roles {
        if role_ids.iter().any(|role_id| role_id == &role.id) {
            continue;
        }
        if !documents.iter().any(|document| document.id == role.metadoc_id) {
            continue;
        }
        if metadoc_ids.iter().any(|metadoc_id| metadoc_id == &role.metadoc_id) {
            continue;
        }
        let mut normalized_role = role;
        normalized_role.title = normalized_role.name.clone();
        normalized_role.prompt = AGENT_ROLE_METADOC_PROMPT.to_string();
        if normalized_role.working_directory.is_none() {
            normalized_role.working_directory =
                Some(create_agent_role_working_directory(&normalized_role.id, &normalized_role.id));
        }
        role_ids.push(normalized_role.id.clone());
        metadoc_ids.push(normalized_role.metadoc_id.clone());
        normalized.push(normalized_role);
    }
    normalized.sort_by(|left, right| left.name.cmp(&right.name));
    normalized
}

fn resolve_project_dir_for_agent_docs(project_id: &str, create_project_dir: bool) -> Result<PathBuf, String> {
    let root = ensure_projects_root()?;
    let project_dir = find_project_dir_by_id(&root, project_id)
        .unwrap_or_else(|| resolve_project_dir(&root, project_id));
    if create_project_dir {
        fs::create_dir_all(&project_dir).map_err(|error| error.to_string())?;
    }
    Ok(project_dir)
}

fn normalize_agent_document_path(value: &str, fallback_id: &str) -> Result<String, String> {
    let raw = if value.trim().is_empty() {
        format!("{AGENT_DOCS_DIR}/{}.md", sanitize_path_component(fallback_id, "document"))
    } else {
        value.trim().replace('\\', "/").trim_start_matches('/').to_string()
    };
    let parts: Vec<&str> = raw.split('/').filter(|part| !part.is_empty() && *part != ".").collect();
    if parts.iter().any(|part| *part == "..") || parts.first() != Some(&AGENT_DOCS_DIR) || !raw.to_lowercase().ends_with(".md") {
        return Err("Agent document path must stay under docs/ and end with .md.".to_string());
    }
    Ok(parts.join("/"))
}

fn normalize_agent_document_directory_path(value: &str, fallback_path: &str) -> Result<String, String> {
    let trimmed = if value.trim().is_empty() {
        fallback_path.trim().replace('\\', "/").trim_start_matches('/').to_string()
    } else {
        value.trim().replace('\\', "/").trim_start_matches('/').to_string()
    };
    let raw = if trimmed.starts_with(&format!("{AGENT_DOCS_DIR}/")) || trimmed == AGENT_DOCS_DIR {
        trimmed
    } else {
        format!("{AGENT_DOCS_DIR}/{trimmed}")
    };
    let parts: Vec<&str> = raw.split('/').filter(|part| !part.is_empty() && *part != ".").collect();
    if parts.iter().any(|part| *part == "..") || parts.first() != Some(&AGENT_DOCS_DIR) {
        return Err("Agent role working directory must stay under docs/.".to_string());
    }
    if raw.to_lowercase().ends_with(".md") {
        return Err("Agent role working directory must be a directory path, not a Markdown file.".to_string());
    }
    Ok(parts.join("/"))
}

fn resolve_path_inside_project_dir(project_dir: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let candidate = project_dir.join(relative_path);
    if !candidate.starts_with(project_dir) {
        return Err("Resolved Agent document path escaped the project directory.".to_string());
    }
    Ok(candidate)
}

fn same_filesystem_path(left: &Path, right: &Path) -> bool {
    if cfg!(windows) {
        left.to_string_lossy().eq_ignore_ascii_case(&right.to_string_lossy())
    } else {
        left == right
    }
}

fn agent_document_body_from_markdown(raw: &str) -> String {
    if raw.starts_with("---\n") {
        if let Some(index) = raw.find("\n---") {
            return raw[index + 4..].trim_start_matches('\n').to_string();
        }
    }
    raw.to_string()
}

fn migrate_role_metadoc_document_paths(
    project_dir: &Path,
    mut documents: Vec<AgentDocumentMeta>,
    roles: &[AgentRoleDefinition],
    now: &str,
) -> Result<(Vec<AgentDocumentMeta>, bool), String> {
    let mut changed = false;
    for role in roles {
        let Some(index) = documents.iter().position(|document| document.id == role.metadoc_id) else {
            continue;
        };
        let expected_path = normalize_agent_document_path(
            &create_agent_role_metadoc_path(&role.name, &role.id),
            &documents[index].id,
        )?;
        if documents[index].path == expected_path {
            continue;
        }
        if documents
            .iter()
            .any(|document| document.id != documents[index].id && document.path.to_lowercase() == expected_path.to_lowercase())
        {
            return Err(format!(
                "Cannot rename metadoc for role \"{}\" to {}; that path is already used.",
                role.name, expected_path
            ));
        }

        let previous_path = normalize_agent_document_path(&documents[index].path, &documents[index].id)?;
        let previous_absolute_path = resolve_path_inside_project_dir(project_dir, &previous_path)?;
        let next_absolute_path = resolve_path_inside_project_dir(project_dir, &expected_path)?;
        let same_path = same_filesystem_path(&previous_absolute_path, &next_absolute_path);
        let previous_raw = fs::read_to_string(&previous_absolute_path).ok();
        let has_previous_file = previous_raw.is_some();
        let next_exists = !same_path && next_absolute_path.exists();
        if has_previous_file && next_exists {
            return Err(format!(
                "Cannot rename metadoc for role \"{}\" to {}; a file already exists at that path.",
                role.name, expected_path
            ));
        }

        let mut next_document = documents[index].clone();
        next_document.path = expected_path.clone();
        next_document.updated_at = now.to_string();
        let content = previous_raw
            .as_deref()
            .map(agent_document_body_from_markdown)
            .unwrap_or_default();
        if has_previous_file || !next_exists {
            if let Some(parent) = next_absolute_path.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            fs::write(&next_absolute_path, build_agent_document_markdown(&next_document, &content))
                .map_err(|error| error.to_string())?;
        }
        if !same_path && has_previous_file && previous_absolute_path.exists() {
            fs::remove_file(&previous_absolute_path).map_err(|error| error.to_string())?;
        }

        documents[index] = next_document;
        changed = true;
    }
    documents.sort_by(|left, right| left.path.cmp(&right.path));
    Ok((documents, changed))
}

fn resolve_agent_docs_manifest_file(project_id: &str, create_project_dir: bool) -> Result<PathBuf, String> {
    let project_dir = resolve_project_dir_for_agent_docs(project_id, create_project_dir)?;
    if create_project_dir {
        fs::create_dir_all(project_dir.join(AGENT_DOCS_DIR)).map_err(|error| error.to_string())?;
    }
    Ok(project_dir.join(AGENT_DOCS_DIR).join(AGENT_DOCS_MANIFEST_FILE))
}

fn read_raw_agent_document_manifest(project_id: &str) -> Result<Option<AgentDocumentManifest>, String> {
    let manifest_file = resolve_agent_docs_manifest_file(project_id, false)?;
    if !manifest_file.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&manifest_file).map_err(|error| error.to_string())?;
    serde_json::from_str::<AgentDocumentManifest>(&raw)
        .map(Some)
        .map_err(|error| error.to_string())
}

fn write_agent_document_manifest(manifest: &AgentDocumentManifest) -> Result<(), String> {
    let manifest_file = resolve_agent_docs_manifest_file(&manifest.project_id, true)?;
    let payload = serde_json::to_string_pretty(manifest).map_err(|error| error.to_string())?;
    fs::write(manifest_file, format!("{payload}\n")).map_err(|error| error.to_string())
}

fn ensure_project_documents(project_id: &str) -> Result<AgentDocumentManifest, String> {
    let now = now_millis_string();
    let project_dir = resolve_project_dir_for_agent_docs(project_id, true)?;
    fs::create_dir_all(project_dir.join(AGENT_DOCS_DIR)).map_err(|error| error.to_string())?;
    let existing = read_raw_agent_document_manifest(project_id).unwrap_or(None);
    let mut documents = existing.as_ref().map(|manifest| manifest.documents.clone()).unwrap_or_default();
    let mut changed = existing.is_none();

    for document in &mut documents {
        document.path = normalize_agent_document_path(&document.path, &document.id)?;
    }

    let default_definitions = default_agent_documents();
    if let Some(definition) = default_definitions
        .iter()
        .find(|definition| definition.id == AGENT_PRIME_DIRECTIVE_DOCUMENT_ID)
    {
        let existing_index = documents.iter().position(|document| document.id == definition.id);
        let meta = existing_index
            .map(|index| {
                let mut meta = documents[index].clone();
                meta.path = normalize_agent_document_path(&meta.path, &meta.id)?;
                Ok::<AgentDocumentMeta, String>(meta)
            })
            .transpose()?
            .unwrap_or_else(|| create_agent_document_meta(definition, &now));
        if existing_index.is_none() {
            documents.push(meta.clone());
            changed = true;
        }
        let document_path = resolve_path_inside_project_dir(
            &project_dir,
            &normalize_agent_document_path(&meta.path, &meta.id)?,
        )?;
        if !document_path.exists() {
            if let Some(parent) = document_path.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            fs::write(&document_path, build_agent_document_markdown(&meta, definition.body))
                .map_err(|error| error.to_string())?;
            changed = true;
        }
    }

    if existing.is_none() {
        for definition in default_definitions {
            if documents.iter().any(|document| document.id == definition.id) {
                continue;
            }
            let meta = create_agent_document_meta(&definition, &now);
            let document_path = resolve_path_inside_project_dir(&project_dir, &normalize_agent_document_path(&meta.path, &meta.id)?)?;
            if !document_path.exists() {
                if let Some(parent) = document_path.parent() {
                    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
                }
                fs::write(&document_path, build_agent_document_markdown(&meta, definition.body))
                    .map_err(|error| error.to_string())?;
            }
            documents.push(meta);
        }
    }
    documents.sort_by(|left, right| left.path.cmp(&right.path));
    let existing_roles = existing.as_ref().map(|manifest| manifest.roles.clone()).unwrap_or_default();
    let roles = if existing.as_ref().map(|manifest| manifest.role_setup_version).unwrap_or(0) > 0 {
        normalize_agent_roles_for_documents(existing_roles.clone(), &documents)
    } else {
        default_agent_roles_for_documents(&documents)
    };
    let (migrated_documents, path_migration_changed) =
        migrate_role_metadoc_document_paths(&project_dir, documents, &roles, &now)?;
    documents = migrated_documents;
    if path_migration_changed {
        changed = true;
    }
    if let Some(existing_manifest) = &existing {
        if existing_manifest.role_setup_version == 0 || existing_roles != roles {
            changed = true;
        }
    }
    let manifest = AgentDocumentManifest {
        project_id: project_id.to_string(),
        updated_at: existing.map(|entry| entry.updated_at).unwrap_or_else(|| now.clone()),
        role_setup_version: 1,
        documents,
        roles,
    };
    if changed {
        let updated = AgentDocumentManifest {
            project_id: manifest.project_id.clone(),
            updated_at: now,
            role_setup_version: 1,
            documents: manifest.documents.clone(),
            roles: manifest.roles.clone(),
        };
        write_agent_document_manifest(&updated)?;
        return Ok(updated);
    }
    Ok(manifest)
}

fn normalize_agent_document_lookup(value: &str) -> String {
    value
        .trim()
        .replace('\\', "/")
        .trim_start_matches('/')
        .split('/')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("/")
}

fn strip_markdown_extension(value: &str) -> String {
    if value.to_lowercase().ends_with(".md") {
        value[..value.len() - 3].to_string()
    } else {
        value.to_string()
    }
}

fn posix_basename(value: &str) -> &str {
    value.rsplit('/').next().unwrap_or(value)
}

fn describe_agent_document_lookup_options(manifest: &AgentDocumentManifest) -> String {
    let options = manifest
        .documents
        .iter()
        .take(12)
        .map(|document| format!("{} ({})", document.id, document.path))
        .collect::<Vec<_>>()
        .join(", ");
    if options.is_empty() {
        "".to_string()
    } else if manifest.documents.len() > 12 {
        format!(" Available documents: {options}, ...")
    } else {
        format!(" Available documents: {options}")
    }
}

fn resolve_agent_document_meta(
    manifest: &AgentDocumentManifest,
    document_lookup: &str,
) -> Result<AgentDocumentMeta, String> {
    let trimmed = document_lookup.trim();
    if trimmed.is_empty() {
        return Err(format!(
            "Agent document id/path/title is required.{}",
            describe_agent_document_lookup_options(manifest)
        ));
    }
    let normalized = normalize_agent_document_lookup(trimmed);
    let normalized_lower = normalized.to_lowercase();
    let normalized_without_docs_prefix = normalized_lower
        .strip_prefix(&format!("{AGENT_DOCS_DIR}/"))
        .unwrap_or(&normalized_lower)
        .to_string();
    let normalized_without_extension = strip_markdown_extension(&normalized_lower);
    let basename = posix_basename(&normalized_lower).to_string();
    let basename_without_extension = strip_markdown_extension(&basename);

    let score_document = |document: &AgentDocumentMeta| -> u8 {
        let id_lower = document.id.to_lowercase();
        let path_lower = normalize_agent_document_lookup(&document.path).to_lowercase();
        let path_without_docs_prefix = path_lower
            .strip_prefix(&format!("{AGENT_DOCS_DIR}/"))
            .unwrap_or(&path_lower)
            .to_string();
        let path_without_extension = strip_markdown_extension(&path_lower);
        let path_basename = posix_basename(&path_lower).to_string();
        let path_basename_without_extension = strip_markdown_extension(&path_basename);
        let title_lower = document.title.trim().to_lowercase();
        let title_without_extension = strip_markdown_extension(&title_lower);

        if document.id == trimmed {
            100
        } else if id_lower == normalized_lower {
            95
        } else if path_lower == normalized_lower {
            90
        } else if path_without_docs_prefix == normalized_without_docs_prefix {
            85
        } else if path_basename == basename && basename.contains('.') {
            80
        } else if path_without_extension == normalized_without_extension {
            75
        } else if path_basename_without_extension == basename_without_extension {
            70
        } else if title_lower == normalized_lower {
            65
        } else if title_without_extension == normalized_without_extension
            || title_without_extension == basename_without_extension
        {
            60
        } else {
            0
        }
    };

    let mut matches = manifest
        .documents
        .iter()
        .cloned()
        .map(|document| {
            let score = score_document(&document);
            (document, score)
        })
        .filter(|(_, score)| *score > 0)
        .collect::<Vec<_>>();
    matches.sort_by(|left, right| right.1.cmp(&left.1));

    if matches.is_empty() {
        return Err(format!(
            "Agent document not found: {document_lookup}.{}",
            describe_agent_document_lookup_options(manifest)
        ));
    }
    if matches.len() > 1 && matches[0].1 == matches[1].1 {
        let top_score = matches[0].1;
        let ambiguous = matches
            .iter()
            .filter(|(_, score)| *score == top_score)
            .map(|(document, _)| format!("{} ({})", document.id, document.path))
            .collect::<Vec<_>>()
            .join(", ");
        return Err(format!(
            "Agent document lookup is ambiguous: {document_lookup}. Use the document id. Matches: {ambiguous}"
        ));
    }
    Ok(matches.remove(0).0)
}

fn read_agent_document_file(project_id: &str, document_id: &str) -> Result<AgentDocument, String> {
    let manifest = ensure_project_documents(project_id)?;
    let meta = resolve_agent_document_meta(&manifest, document_id)?;
    let project_dir = resolve_project_dir_for_agent_docs(project_id, false)?;
    let document_path = resolve_path_inside_project_dir(&project_dir, &normalize_agent_document_path(&meta.path, &meta.id)?)?;
    let raw = fs::read_to_string(&document_path).unwrap_or_default();
    let content = if raw.starts_with("---\n") {
        if let Some(index) = raw.find("\n---") {
            raw[index + 4..].trim_start_matches('\n').to_string()
        } else {
            raw
        }
    } else {
        raw
    };
    Ok(AgentDocument {
        id: meta.id,
        title: meta.title,
        role: meta.role,
        status: meta.status,
        path: meta.path,
        related_page_ids: meta.related_page_ids,
        updated_at: meta.updated_at,
        last_agent_run_id: meta.last_agent_run_id,
        summary: meta.summary,
        content,
    })
}

fn write_agent_document_file(project_id: &str, document: AgentDocumentInput) -> Result<AgentDocument, String> {
    let manifest = ensure_project_documents(project_id)?;
    let now = now_millis_string();
    let id = document
        .id
        .as_ref()
        .map(|entry| entry.trim().to_string())
        .filter(|entry| !entry.is_empty())
        .ok_or_else(|| "Agent document id is required.".to_string())?;
    let existing = manifest.documents.iter().find(|entry| entry.id == id);
    if let Some(expected_updated_at) = document
        .expected_updated_at
        .as_ref()
        .map(|entry| entry.trim())
        .filter(|entry| !entry.is_empty())
    {
        if let Some(current_updated_at) = existing.map(|entry| entry.updated_at.as_str()) {
            if current_updated_at != expected_updated_at {
                return Err(format!(
                    "Agent document changed on disk since it was opened. Reopen {} before saving.",
                    id
                ));
            }
        }
    }
    let role = document
        .role
        .clone()
        .or_else(|| existing.and_then(|entry| entry.role.clone()));
    let title = document
        .title
        .clone()
        .or_else(|| existing.map(|entry| entry.title.clone()))
        .unwrap_or_else(|| id.clone());
    let default_path = create_unique_agent_document_path_from_title(
        &title,
        &format!(
            "{AGENT_DOCS_DIR}/{}",
            sanitize_path_component(role.as_deref().unwrap_or("general"), "role")
        ),
        &manifest.documents,
        Some(&id),
        &id,
    );
    let path_input = document
        .path
        .as_deref()
        .or_else(|| existing.map(|entry| entry.path.as_str()))
        .unwrap_or(&default_path);
    let meta = AgentDocumentMeta {
        id: id.clone(),
        title: if title.trim().is_empty() { id.clone() } else { title },
        role: role.clone(),
        status: document
            .status
            .clone()
            .or_else(|| existing.map(|entry| entry.status.clone()))
            .filter(|entry| !entry.trim().is_empty())
            .unwrap_or_else(|| "draft".to_string()),
        path: normalize_agent_document_path(path_input, &id)?,
        related_page_ids: document
            .related_page_ids
            .clone()
            .or_else(|| existing.map(|entry| entry.related_page_ids.clone()))
            .unwrap_or_default(),
        updated_at: now.clone(),
        last_agent_run_id: document
            .last_agent_run_id
            .clone()
            .or_else(|| existing.and_then(|entry| entry.last_agent_run_id.clone())),
        summary: document
            .summary
            .clone()
            .or_else(|| existing.and_then(|entry| entry.summary.clone())),
    };
    let project_dir = resolve_project_dir_for_agent_docs(project_id, true)?;
    let document_path = resolve_path_inside_project_dir(&project_dir, &meta.path)?;
    let previous_document_path = existing
        .map(|entry| normalize_agent_document_path(&entry.path, &entry.id))
        .transpose()?
        .map(|entry| resolve_path_inside_project_dir(&project_dir, &entry))
        .transpose()?;
    if let Some(parent) = document_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(&document_path, build_agent_document_markdown(&meta, &document.content))
        .map_err(|error| error.to_string())?;
    if let Some(previous_path) = previous_document_path {
        if !same_filesystem_path(&previous_path, &document_path) && previous_path.exists() {
            fs::remove_file(&previous_path).map_err(|error| error.to_string())?;
        }
    }

    let mut documents: Vec<AgentDocumentMeta> = manifest
        .documents
        .into_iter()
        .filter(|entry| entry.id != meta.id)
        .collect();
    documents.push(meta.clone());
    documents.sort_by(|left, right| left.path.cmp(&right.path));
    write_agent_document_manifest(&AgentDocumentManifest {
        project_id: project_id.to_string(),
        updated_at: now,
        role_setup_version: 1,
        roles: normalize_agent_roles_for_documents(manifest.roles, &documents),
        documents,
    })?;

    Ok(AgentDocument {
        id: meta.id,
        title: meta.title,
        role: meta.role,
        status: meta.status,
        path: meta.path,
        related_page_ids: meta.related_page_ids,
        updated_at: meta.updated_at,
        last_agent_run_id: meta.last_agent_run_id,
        summary: meta.summary,
        content: document.content,
    })
}

fn delete_agent_document_file(project_id: &str, document_id: &str) -> Result<AgentDocumentManifest, String> {
    let manifest = ensure_project_documents(project_id)?;
    let meta = resolve_agent_document_meta(&manifest, document_id)?;
    if meta.id == AGENT_PRIME_DIRECTIVE_DOCUMENT_ID {
        return Err("PrimeDirective.md is required for every project and cannot be deleted.".to_string());
    }
    let project_dir = resolve_project_dir_for_agent_docs(project_id, false)?;
    let document_path = resolve_path_inside_project_dir(
        &project_dir,
        &normalize_agent_document_path(&meta.path, &meta.id)?,
    )?;
    if document_path.exists() {
        fs::remove_file(&document_path).map_err(|error| error.to_string())?;
    }
    let mut documents: Vec<AgentDocumentMeta> = manifest
        .documents
        .into_iter()
        .filter(|entry| entry.id != meta.id)
        .collect();
    documents.sort_by(|left, right| left.path.cmp(&right.path));
    let next_manifest = AgentDocumentManifest {
        project_id: project_id.to_string(),
        updated_at: now_millis_string(),
        role_setup_version: 1,
        roles: normalize_agent_roles_for_documents(manifest.roles, &documents),
        documents,
    };
    write_agent_document_manifest(&next_manifest)?;
    Ok(next_manifest)
}

fn agent_role_working_directory(role: &AgentRoleDefinition) -> Result<String, String> {
    normalize_agent_document_directory_path(
        role.working_directory.as_deref().unwrap_or(""),
        &create_agent_role_working_directory(&role.id, &role.id),
    )
}

fn normalize_agent_working_directory_path(value: &str) -> Result<String, String> {
    if value.trim().is_empty() {
        return Err("Agent working directory path is required.".to_string());
    }
    normalize_agent_document_directory_path(value, "")
}

fn agent_directory_paths_equal(left: &str, right: &str) -> bool {
    left.eq_ignore_ascii_case(right)
}

fn agent_document_path_is_under_directory(document_path: &str, directory_path: &str) -> Result<bool, String> {
    let normalized_document_path = document_path.replace('\\', "/").trim_start_matches('/').to_string();
    let normalized_directory_path = normalize_agent_working_directory_path(directory_path)?;
    Ok(normalized_document_path
        .to_lowercase()
        .starts_with(&format!("{}/", normalized_directory_path.to_lowercase())))
}

fn replace_agent_directory_prefix(document_path: &str, from_directory: &str, to_directory: &str) -> String {
    let normalized_document_path = document_path.replace('\\', "/");
    let suffix = normalized_document_path
        .get(from_directory.len()..)
        .unwrap_or_default();
    format!("{to_directory}{suffix}")
}

fn rewrite_agent_document_at_path(
    project_dir: &Path,
    meta: &AgentDocumentMeta,
    previous_meta: Option<&AgentDocumentMeta>,
) -> Result<(), String> {
    let document_path = resolve_path_inside_project_dir(project_dir, &normalize_agent_document_path(&meta.path, &meta.id)?)?;
    let raw = fs::read_to_string(&document_path).unwrap_or_default();
    let content = if raw.is_empty() {
        String::new()
    } else {
        agent_document_body_from_markdown(&raw)
    };
    let _ = previous_meta;
    if let Some(parent) = document_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(&document_path, build_agent_document_markdown(meta, &content))
        .map_err(|error| error.to_string())
}

fn rename_agent_working_directory(
    project_id: &str,
    directory_path: &str,
    next_directory_path: &str,
) -> Result<AgentDocumentManifest, String> {
    let from_directory = normalize_agent_working_directory_path(directory_path)?;
    let to_directory = normalize_agent_working_directory_path(next_directory_path)?;
    if agent_directory_paths_equal(&from_directory, &to_directory) {
        return ensure_project_documents(project_id);
    }
    if to_directory.to_lowercase().starts_with(&format!("{}/", from_directory.to_lowercase())) ||
        from_directory.to_lowercase().starts_with(&format!("{}/", to_directory.to_lowercase()))
    {
        return Err("Agent working directory cannot be renamed into itself or one of its nested directories.".to_string());
    }

    let manifest = ensure_project_documents(project_id)?;
    let now = now_millis_string();
    let roles_to_move: Vec<AgentRoleDefinition> = manifest
        .roles
        .iter()
        .filter_map(|role| {
            agent_role_working_directory(role)
                .ok()
                .filter(|directory| agent_directory_paths_equal(directory, &from_directory))
                .map(|_| role.clone())
        })
        .collect();
    let documents_to_move: Vec<AgentDocumentMeta> = manifest
        .documents
        .iter()
        .filter_map(|document| {
            agent_document_path_is_under_directory(&document.path, &from_directory)
                .ok()
                .filter(|matches| *matches)
                .map(|_| document.clone())
        })
        .collect();
    let project_dir = resolve_project_dir_for_agent_docs(project_id, true)?;
    let from_absolute_path = resolve_path_inside_project_dir(&project_dir, &from_directory)?;
    let to_absolute_path = resolve_path_inside_project_dir(&project_dir, &to_directory)?;
    if roles_to_move.is_empty() && documents_to_move.is_empty() && !from_absolute_path.is_dir() {
        return Err(format!("Agent working directory not found: {from_directory}"));
    }

    let mut target_paths: Vec<(String, String)> = Vec::new();
    for document in &documents_to_move {
        target_paths.push((
            document.id.clone(),
            normalize_agent_document_path(
                &replace_agent_directory_prefix(&document.path, &from_directory, &to_directory),
                &document.id,
            )?,
        ));
    }
    for document in &manifest.documents {
        if target_paths.iter().any(|(id, _)| id == &document.id) {
            continue;
        }
        if target_paths
            .iter()
            .any(|(_, target_path)| target_path.eq_ignore_ascii_case(&document.path))
        {
            return Err(format!(
                "Cannot rename working directory to {to_directory}; document path already exists: {}",
                document.path
            ));
        }
    }

    if !same_filesystem_path(&from_absolute_path, &to_absolute_path) && from_absolute_path.is_dir() {
        if to_absolute_path.exists() {
            let target_entries = if to_absolute_path.is_dir() {
                fs::read_dir(&to_absolute_path)
                    .map_err(|error| error.to_string())?
                    .count()
            } else {
                1
            };
            if target_entries > 0 {
                return Err(format!(
                    "Cannot rename working directory to {to_directory}; target directory already exists."
                ));
            }
            fs::remove_dir_all(&to_absolute_path).map_err(|error| error.to_string())?;
        }
        if let Some(parent) = to_absolute_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::rename(&from_absolute_path, &to_absolute_path).map_err(|error| error.to_string())?;
    } else {
        fs::create_dir_all(&to_absolute_path).map_err(|error| error.to_string())?;
    }

    let mut next_documents = manifest.documents.clone();
    for (document_id, target_path) in &target_paths {
        if let Some(document) = next_documents.iter_mut().find(|entry| &entry.id == document_id) {
            document.path = target_path.clone();
            document.updated_at = now.clone();
        }
    }
    for document in &documents_to_move {
        if let Some(next_document) = next_documents.iter().find(|entry| entry.id == document.id) {
            rewrite_agent_document_at_path(&project_dir, next_document, Some(document))?;
        }
    }

    for role in &roles_to_move {
        let Some(index) = next_documents.iter().position(|document| document.id == role.metadoc_id) else {
            continue;
        };
        let metadoc_path = resolve_path_inside_project_dir(
            &project_dir,
            &normalize_agent_document_path(&next_documents[index].path, &next_documents[index].id)?,
        )?;
        let raw = fs::read_to_string(&metadoc_path).unwrap_or_default();
        if raw.is_empty() || !raw.contains(&from_directory) {
            continue;
        }
        let body = agent_document_body_from_markdown(&raw).replace(&from_directory, &to_directory);
        let mut next_metadoc = next_documents[index].clone();
        next_metadoc.updated_at = now.clone();
        next_documents[index] = next_metadoc.clone();
        fs::write(&metadoc_path, build_agent_document_markdown(&next_metadoc, &body))
            .map_err(|error| error.to_string())?;
    }

    next_documents.sort_by(|left, right| left.path.cmp(&right.path));
    let next_roles: Vec<AgentRoleDefinition> = manifest
        .roles
        .into_iter()
        .map(|mut role| {
            if agent_role_working_directory(&role)
                .map(|directory| agent_directory_paths_equal(&directory, &from_directory))
                .unwrap_or(false)
            {
                role.working_directory = Some(to_directory.clone());
            }
            role
        })
        .collect();
    let next_manifest = AgentDocumentManifest {
        project_id: project_id.to_string(),
        updated_at: now,
        role_setup_version: 1,
        roles: normalize_agent_roles_for_documents(next_roles, &next_documents),
        documents: next_documents,
    };
    write_agent_document_manifest(&next_manifest)?;
    Ok(next_manifest)
}

fn delete_agent_working_directory(project_id: &str, directory_path: &str) -> Result<AgentDocumentManifest, String> {
    let directory = normalize_agent_working_directory_path(directory_path)?;
    let manifest = ensure_project_documents(project_id)?;
    let roles_to_delete: Vec<AgentRoleDefinition> = manifest
        .roles
        .iter()
        .filter_map(|role| {
            agent_role_working_directory(role)
                .ok()
                .filter(|working_directory| agent_directory_paths_equal(working_directory, &directory))
                .map(|_| role.clone())
        })
        .collect();
    let documents_to_delete: Vec<AgentDocumentMeta> = manifest
        .documents
        .iter()
        .filter_map(|document| {
            agent_document_path_is_under_directory(&document.path, &directory)
                .ok()
                .filter(|matches| *matches)
                .map(|_| document.clone())
        })
        .collect();
    if documents_to_delete.iter().any(|document| document.id == AGENT_PRIME_DIRECTIVE_DOCUMENT_ID) {
        return Err("PrimeDirective.md cannot be deleted through working directory deletion.".to_string());
    }
    let project_dir = resolve_project_dir_for_agent_docs(project_id, false)?;
    let directory_path = resolve_path_inside_project_dir(&project_dir, &directory)?;
    if roles_to_delete.is_empty() && documents_to_delete.is_empty() && !directory_path.is_dir() {
        return Err(format!("Agent working directory not found: {directory}"));
    }
    if directory_path.exists() {
        fs::remove_dir_all(&directory_path).map_err(|error| error.to_string())?;
    }
    let deleted_document_ids: Vec<String> = documents_to_delete.into_iter().map(|document| document.id).collect();
    let deleted_role_ids: Vec<String> = roles_to_delete.into_iter().map(|role| role.id).collect();
    let mut documents: Vec<AgentDocumentMeta> = manifest
        .documents
        .into_iter()
        .filter(|document| !deleted_document_ids.iter().any(|id| id == &document.id))
        .collect();
    documents.sort_by(|left, right| left.path.cmp(&right.path));
    let roles = manifest
        .roles
        .into_iter()
        .filter(|role| !deleted_role_ids.iter().any(|id| id == &role.id))
        .collect();
    let next_manifest = AgentDocumentManifest {
        project_id: project_id.to_string(),
        updated_at: now_millis_string(),
        role_setup_version: 1,
        roles: normalize_agent_roles_for_documents(roles, &documents),
        documents,
    };
    write_agent_document_manifest(&next_manifest)?;
    Ok(next_manifest)
}

fn unique_agent_role_id(name: &str, roles: &[AgentRoleDefinition]) -> String {
    let base = sanitize_path_component(&name.to_lowercase(), "role");
    let mut candidate = base.clone();
    let mut index = 2;
    while roles.iter().any(|role| role.id == candidate) {
        candidate = format!("{base}-{index}");
        index += 1;
    }
    candidate
}

fn create_agent_role_binding(project_id: &str, role_input: AgentRoleInput) -> Result<AgentDocumentManifest, String> {
    let manifest = ensure_project_documents(project_id)?;
    let now = now_millis_string();
    let name = role_input
        .name
        .as_ref()
        .map(|entry| entry.trim().to_string())
        .filter(|entry| !entry.is_empty())
        .ok_or_else(|| "Agent role name is required.".to_string())?;
    let id = role_input
        .id
        .as_ref()
        .map(|entry| entry.trim().to_string())
        .filter(|entry| !entry.is_empty())
        .unwrap_or_else(|| unique_agent_role_id(&name, &manifest.roles));
    if manifest.roles.iter().any(|role| role.id == id) {
        return Err(format!("Agent role already exists: {id}"));
    }
    let metadoc_file_stem = normalize_agent_role_metadoc_file_stem(&name, &id).to_lowercase();
    if manifest.roles.iter().any(|role| {
        normalize_agent_role_metadoc_file_stem(&role.name, &role.id).to_lowercase() == metadoc_file_stem
    }) {
        return Err(format!("Agent role metadoc filename already exists for role name: {name}"));
    }
    let default_working_directory = create_agent_role_working_directory(&id, &id);
    let working_directory = normalize_agent_document_directory_path(
        role_input.working_directory.as_deref().unwrap_or(""),
        &default_working_directory,
    )?;

    let mut documents = manifest.documents.clone();
    let metadoc_id = if let Some(existing_metadoc_id) = role_input
        .metadoc_id
        .as_ref()
        .map(|entry| entry.trim().to_string())
        .filter(|entry| !entry.is_empty())
    {
        if !documents.iter().any(|document| document.id == existing_metadoc_id) {
            return Err(format!("Metadoc document not found: {existing_metadoc_id}"));
        }
        existing_metadoc_id
    } else {
        let metadoc_id = normalize_agent_role_metadoc_file_stem(&name, &id);
        let metadoc_path_input = create_agent_role_metadoc_path(&name, &id);
        let meta = AgentDocumentMeta {
            id: metadoc_id.clone(),
            title: name.clone(),
            role: Some(id.clone()),
            status: "draft".to_string(),
            path: normalize_agent_document_path(&metadoc_path_input, &metadoc_id)?,
            related_page_ids: Vec::new(),
            updated_at: now.clone(),
            last_agent_run_id: None,
            summary: Some(format!("Metadoc for {name}.")),
        };
        if documents.iter().any(|document| document.id == meta.id) {
            return Err(format!("Agent document already exists: {}", meta.id));
        }
        if documents.iter().any(|document| document.path.to_lowercase() == meta.path.to_lowercase()) {
            return Err(format!("Agent document path already exists: {}", meta.path));
        }
        let project_dir = resolve_project_dir_for_agent_docs(project_id, true)?;
        let document_path = resolve_path_inside_project_dir(&project_dir, &meta.path)?;
        if let Some(parent) = document_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let body = format!(
            "# {}\n\n## Role Prompt\n\nOperate as {} in this MangaMaker project.\n\n## Responsibilities\n\n- Define this role's working rules.\n- Treat this metadoc as role prompt and role definition only.\n- Record durable role output under `{}/`.\n\n## Context Priority\n\nPinned context is the system prompt, `docs/PrimeDirective.md`, and this role prompt. Working output can be evicted from the model window and reread on demand.\n",
            meta.title,
            name,
            working_directory
        );
        fs::write(&document_path, build_agent_document_markdown(&meta, &body))
            .map_err(|error| error.to_string())?;
        documents.push(meta);
        documents.sort_by(|left, right| left.path.cmp(&right.path));
        metadoc_id
    };

    if manifest.roles.iter().any(|role| role.metadoc_id == metadoc_id) {
        return Err(format!("Metadoc is already bound to a role: {metadoc_id}"));
    }
    let project_dir = resolve_project_dir_for_agent_docs(project_id, true)?;
    let working_directory_path = resolve_path_inside_project_dir(&project_dir, &working_directory)?;
    fs::create_dir_all(&working_directory_path).map_err(|error| error.to_string())?;
    let role = AgentRoleDefinition {
        id: id.clone(),
        name: name.clone(),
        title: name.clone(),
        metadoc_id,
        working_directory: Some(working_directory),
        default_autonomy: role_input.default_autonomy.unwrap_or_else(|| "adviseOnly".to_string()),
        allowed_command_groups: role_input.allowed_command_groups.unwrap_or_else(|| vec!["read".to_string(), "document".to_string()]),
        preferred_tools: role_input.preferred_tools.unwrap_or_else(|| vec![
            "listDocuments".to_string(),
            "readDocument".to_string(),
            "searchDocuments".to_string(),
            "writeDocument".to_string(),
        ]),
        prompt: AGENT_ROLE_METADOC_PROMPT.to_string(),
        built_in: false,
    };
    let mut roles = manifest.roles.clone();
    roles.push(role);
    let normalized_roles = normalize_agent_roles_for_documents(roles, &documents);
    let (documents, _) = migrate_role_metadoc_document_paths(&project_dir, documents, &normalized_roles, &now)?;
    let next_manifest = AgentDocumentManifest {
        project_id: project_id.to_string(),
        updated_at: now,
        role_setup_version: 1,
        roles: normalize_agent_roles_for_documents(normalized_roles, &documents),
        documents,
    };
    write_agent_document_manifest(&next_manifest)?;
    Ok(next_manifest)
}

fn delete_agent_role_binding(project_id: &str, role_id: &str) -> Result<AgentDocumentManifest, String> {
    let manifest = ensure_project_documents(project_id)?;
    if !manifest.roles.iter().any(|role| role.id == role_id) {
        return Err(format!("Agent role not found: {role_id}"));
    }
    let next_manifest = AgentDocumentManifest {
        project_id: project_id.to_string(),
        updated_at: now_millis_string(),
        role_setup_version: 1,
        roles: manifest.roles.into_iter().filter(|role| role.id != role_id).collect(),
        documents: manifest.documents,
    };
    write_agent_document_manifest(&next_manifest)?;
    Ok(next_manifest)
}

fn resolve_agent_conversation_context_file(
    project_id: &str,
    create_project_dir: bool,
    file_name: &str,
) -> Result<PathBuf, String> {
    let root = ensure_projects_root()?;
    let project_dir = find_project_dir_by_id(&root, project_id)
        .unwrap_or_else(|| resolve_project_dir(&root, project_id));
    if create_project_dir {
        fs::create_dir_all(&project_dir).map_err(|error| error.to_string())?;
    }
    Ok(project_dir.join(file_name))
}

fn normalize_agent_conversation_context(
    mut context: AgentConversationContext,
) -> Result<AgentConversationContext, String> {
    context.context_id = context
        .context_id
        .map(|entry| entry.trim().to_string())
        .filter(|entry| !entry.is_empty());
    if context.project_id.trim().is_empty() {
        return Err("Agent conversation context projectId must be a non-empty string.".to_string());
    }
    if context.role_id.trim().is_empty() {
        return Err("Agent conversation context roleId must be a non-empty string.".to_string());
    }
    if context.updated_at.trim().is_empty() {
        return Err("Agent conversation context updatedAt must be a non-empty string.".to_string());
    }
    for message in &context.messages {
        if message.id.trim().is_empty() {
            return Err("Agent conversation context message id must be a non-empty string.".to_string());
        }
        if message.role != "user" && message.role != "assistant" {
            return Err("Agent conversation context message role must be user or assistant.".to_string());
        }
        if message.created_at.trim().is_empty() {
            return Err("Agent conversation context message createdAt must be a non-empty string.".to_string());
        }
    }
    if context.messages.len() > 200 {
        context.messages = context.messages.split_off(context.messages.len() - 200);
    }
    Ok(context)
}

fn normalize_agent_conversation_context_store(
    value: serde_json::Value,
    project_id: &str,
) -> Result<AgentConversationContextStore, String> {
    let now = now_millis_string();
    let contexts_value = value
        .get("contexts")
        .and_then(|entry| entry.as_array())
        .cloned()
        .unwrap_or_else(|| vec![value.clone()]);
    let mut contexts: Vec<AgentConversationContext> = Vec::new();
    for entry in contexts_value {
        let mut context_value = entry;
        if let Some(object) = context_value.as_object_mut() {
            object
                .entry("projectId".to_string())
                .or_insert_with(|| serde_json::Value::String(project_id.to_string()));
            object
                .entry("roleId".to_string())
                .or_insert_with(|| serde_json::Value::String(DEFAULT_AGENT_CONVERSATION_ROLE_ID.to_string()));
        }
        let context = normalize_agent_conversation_context(
            serde_json::from_value::<AgentConversationContext>(context_value)
                .map_err(|error| error.to_string())?,
        )?;
        if context.project_id == project_id {
            if let Some(existing_index) = contexts.iter().position(|entry| entry.role_id == context.role_id) {
                contexts[existing_index] = context;
            } else {
                contexts.push(context);
            }
        }
    }
    contexts.sort_by(|left, right| left.role_id.cmp(&right.role_id));
    Ok(AgentConversationContextStore {
        project_id: project_id.to_string(),
        updated_at: value
            .get("updatedAt")
            .and_then(|entry| entry.as_str())
            .filter(|entry| !entry.trim().is_empty())
            .map(|entry| entry.to_string())
            .unwrap_or(now),
        contexts,
    })
}

fn read_agent_conversation_context_store_file(
    project_id: &str,
) -> Result<(PathBuf, AgentConversationContextStore), String> {
    let context_file = resolve_agent_conversation_context_file(
        project_id,
        false,
        AGENT_CONVERSATION_CONTEXT_FILE,
    )?;
    if context_file.exists() {
        let raw = fs::read_to_string(&context_file).map_err(|error| error.to_string())?;
        let value = serde_json::from_str::<serde_json::Value>(&raw).map_err(|error| error.to_string())?;
        return Ok((context_file, normalize_agent_conversation_context_store(value, project_id)?));
    }
    let legacy_file = resolve_agent_conversation_context_file(
        project_id,
        false,
        LEGACY_AGENT_CHAT_HISTORY_FILE,
    )?;
    if legacy_file.exists() {
        let raw = fs::read_to_string(&legacy_file).map_err(|error| error.to_string())?;
        let value = serde_json::from_str::<serde_json::Value>(&raw).map_err(|error| error.to_string())?;
        return Ok((legacy_file, normalize_agent_conversation_context_store(value, project_id)?));
    }
    Ok((
        context_file,
        AgentConversationContextStore {
            project_id: project_id.to_string(),
            updated_at: now_millis_string(),
            contexts: Vec::new(),
        },
    ))
}

fn write_agent_conversation_context_store_file(
    project_id: &str,
    mut store: AgentConversationContextStore,
) -> Result<(PathBuf, AgentConversationContextStore), String> {
    let context_file = resolve_agent_conversation_context_file(
        project_id,
        true,
        AGENT_CONVERSATION_CONTEXT_FILE,
    )?;
    store.project_id = project_id.to_string();
    store.updated_at = now_millis_string();
    store.contexts = store
        .contexts
        .into_iter()
        .map(normalize_agent_conversation_context)
        .collect::<Result<Vec<_>, _>>()?;
    store.contexts.sort_by(|left, right| left.role_id.cmp(&right.role_id));
    let payload = serde_json::to_string_pretty(&store).map_err(|error| error.to_string())?;
    fs::write(&context_file, format!("{payload}\n")).map_err(|error| error.to_string())?;
    let legacy_file = resolve_agent_conversation_context_file(
        project_id,
        false,
        LEGACY_AGENT_CHAT_HISTORY_FILE,
    )?;
    if legacy_file.exists() {
        let _ = fs::remove_file(legacy_file);
    }
    Ok((context_file, store))
}

fn find_latest_project_folder(root: &Path) -> Option<String> {
    let entries = fs::read_dir(root).ok()?;
    let mut latest_folder: Option<String> = None;
    let mut latest_millis = 0u128;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let project_file = path.join(PROJECT_JSON_FILE);
        if !project_file.exists() {
            continue;
        }
        let modified_millis = fs::metadata(&project_file)
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis())
            .unwrap_or(0);

        if modified_millis >= latest_millis {
            latest_millis = modified_millis;
            latest_folder = path
                .file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.to_string());
        }
    }

    latest_folder
}

fn sync_latest_project_meta(root: &Path) -> Result<(), String> {
    let meta_file = root.join(PROJECT_META_FILE);
    if let Some(folder) = find_latest_project_folder(root) {
        fs::write(meta_file, folder).map_err(|error| error.to_string())?;
        return Ok(());
    }

    if meta_file.exists() {
        fs::remove_file(meta_file).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn write_project_draft(project_id: String, project_json: String) -> Result<String, String> {
    let root = ensure_projects_root()?;
    let project_dir = resolve_project_dir(&root, &project_id);
    let assets_dir = project_dir.join(PROJECT_ASSETS_DIR);
    fs::create_dir_all(&assets_dir).map_err(|error| error.to_string())?;

    let project_file = project_dir.join(PROJECT_JSON_FILE);
    fs::write(&project_file, project_json).map_err(|error| error.to_string())?;

    let latest_project = sanitize_path_component(&project_id, "project");
    fs::write(root.join(PROJECT_META_FILE), latest_project).map_err(|error| error.to_string())?;

    Ok(project_file.to_string_lossy().into_owned())
}

#[tauri::command]
fn read_project_draft() -> Result<Option<String>, String> {
    let root = ensure_projects_root()?;
    let meta_file = root.join(PROJECT_META_FILE);
    if !meta_file.exists() {
        return Ok(None);
    }

    let latest_project = fs::read_to_string(meta_file).map_err(|error| error.to_string())?;
    let folder = sanitize_path_component(latest_project.trim(), "project");
    let project_file = root.join(folder).join(PROJECT_JSON_FILE);
    if !project_file.exists() {
        return Ok(None);
    }

    let json = fs::read_to_string(project_file).map_err(|error| error.to_string())?;
    Ok(Some(json))
}

#[tauri::command]
fn list_project_drafts() -> Result<Vec<String>, String> {
    let root = ensure_projects_root()?;
    let mut drafts_with_mtime: Vec<(u128, String)> = Vec::new();

    for entry in fs::read_dir(&root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let project_file = path.join(PROJECT_JSON_FILE);
        if !project_file.exists() {
            continue;
        }

        let json = fs::read_to_string(&project_file).map_err(|error| error.to_string())?;
        let modified_at = fs::metadata(&project_file)
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis())
            .unwrap_or(0);

        drafts_with_mtime.push((modified_at, json));
    }

    drafts_with_mtime.sort_by(|left, right| right.0.cmp(&left.0));
    Ok(drafts_with_mtime
        .into_iter()
        .map(|(_, project_json)| project_json)
        .collect())
}

#[tauri::command]
fn save_imported_image(
    project_id: String,
    original_file_name: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let root = ensure_projects_root()?;
    let project_dir = resolve_project_dir(&root, &project_id);
    let assets_dir = project_dir.join(PROJECT_ASSETS_DIR);
    fs::create_dir_all(&assets_dir).map_err(|error| error.to_string())?;

    let original_path = Path::new(&original_file_name);
    let stem = original_path
        .file_stem()
        .and_then(|value| value.to_str())
        .map(|value| sanitize_path_component(value, "image"))
        .unwrap_or_else(|| "image".to_string());
    let ext = original_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| sanitize_path_component(value, "bin").to_lowercase())
        .unwrap_or_else(|| "bin".to_string());

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let mut index = 0;
    let asset_path = loop {
        let suffix = if index == 0 {
            format!("{timestamp}")
        } else {
            format!("{timestamp}-{index}")
        };
        let candidate_name = format!("{stem}-{suffix}.{ext}");
        let candidate = assets_dir.join(candidate_name);
        if !candidate.exists() {
            break candidate;
        }
        index += 1;
    };

    fs::write(&asset_path, bytes).map_err(|error| error.to_string())?;
    Ok(asset_path.to_string_lossy().into_owned())
}

#[tauri::command]
fn delete_project_draft(project_id: String) -> Result<(), String> {
    let root = ensure_projects_root()?;
    if let Some(project_dir) = find_project_dir_by_id(&root, &project_id) {
        fs::remove_dir_all(project_dir).map_err(|error| error.to_string())?;
    }
    sync_latest_project_meta(&root)?;
    Ok(())
}

#[tauri::command]
fn read_agent_conversation_context(
    project_id: String,
    role_id: String,
) -> Result<Option<AgentConversationContext>, String> {
    let role_id = if role_id.trim().is_empty() {
        DEFAULT_AGENT_CONVERSATION_ROLE_ID.to_string()
    } else {
        role_id
    };
    let (context_file, store) = read_agent_conversation_context_store_file(&project_id)?;
    let Some(mut context) = store.contexts.into_iter().find(|entry| entry.role_id == role_id) else {
        return Ok(None);
    };
    context.storage_path = Some(public_project_relative_path(&context_file));
    Ok(Some(context))
}

#[tauri::command]
fn write_agent_conversation_context(
    context: AgentConversationContext,
) -> Result<AgentConversationContext, String> {
    let mut normalized = normalize_agent_conversation_context(context)?;
    let role_id = normalized.role_id.clone();
    normalized.storage_path = None;
    let (_, mut store) = read_agent_conversation_context_store_file(&normalized.project_id)?;
    store.contexts.retain(|entry| entry.role_id != role_id);
    store.contexts.push(normalized);
    let project_id = store.project_id.clone();
    let (context_file, written_store) = write_agent_conversation_context_store_file(&project_id, store)?;
    let mut normalized = written_store
        .contexts
        .into_iter()
        .find(|entry| entry.role_id == role_id)
        .ok_or_else(|| "Agent conversation context was not written.".to_string())?;
    normalized.storage_path = Some(public_project_relative_path(&context_file));
    Ok(normalized)
}

#[tauri::command]
fn delete_agent_conversation_context(project_id: String, role_id: String) -> Result<(), String> {
    let role_id = if role_id.trim().is_empty() {
        DEFAULT_AGENT_CONVERSATION_ROLE_ID.to_string()
    } else {
        role_id
    };
    let (_, mut store) = read_agent_conversation_context_store_file(&project_id)?;
    store.contexts.retain(|entry| entry.role_id != role_id);
    if store.contexts.is_empty() {
        for file_name in [AGENT_CONVERSATION_CONTEXT_FILE, LEGACY_AGENT_CHAT_HISTORY_FILE] {
            let context_file = resolve_agent_conversation_context_file(&project_id, false, file_name)?;
            if context_file.exists() {
                fs::remove_file(context_file).map_err(|error| error.to_string())?;
            }
        }
    } else {
        write_agent_conversation_context_store_file(&project_id, store)?;
    }
    Ok(())
}

#[tauri::command]
fn read_agent_chat_history(project_id: String) -> Result<Option<AgentConversationContext>, String> {
    read_agent_conversation_context(project_id, DEFAULT_AGENT_CONVERSATION_ROLE_ID.to_string())
}

#[tauri::command]
fn write_agent_chat_history(
    history: AgentConversationContext,
) -> Result<AgentConversationContext, String> {
    write_agent_conversation_context(history)
}

#[tauri::command]
fn delete_agent_chat_history(project_id: String) -> Result<(), String> {
    delete_agent_conversation_context(project_id, DEFAULT_AGENT_CONVERSATION_ROLE_ID.to_string())
}

#[tauri::command]
fn list_project_docs(project_id: String) -> Result<AgentDocumentManifest, String> {
    ensure_project_documents(&project_id)
}

#[tauri::command]
fn read_project_doc(project_id: String, document_id: String) -> Result<AgentDocument, String> {
    read_agent_document_file(&project_id, &document_id)
}

#[tauri::command]
fn write_project_doc(project_id: String, document: AgentDocumentInput) -> Result<AgentDocument, String> {
    write_agent_document_file(&project_id, document)
}

#[tauri::command]
fn delete_project_doc(project_id: String, document_id: String) -> Result<AgentDocumentManifest, String> {
    delete_agent_document_file(&project_id, &document_id)
}

#[tauri::command]
fn rename_project_working_directory(
    project_id: String,
    directory_path: String,
    next_directory_path: String,
) -> Result<AgentDocumentManifest, String> {
    rename_agent_working_directory(&project_id, &directory_path, &next_directory_path)
}

#[tauri::command]
fn delete_project_working_directory(
    project_id: String,
    directory_path: String,
) -> Result<AgentDocumentManifest, String> {
    delete_agent_working_directory(&project_id, &directory_path)
}

#[tauri::command]
fn create_project_role(project_id: String, role: AgentRoleInput) -> Result<AgentDocumentManifest, String> {
    create_agent_role_binding(&project_id, role)
}

#[tauri::command]
fn delete_project_role(project_id: String, role_id: String) -> Result<AgentDocumentManifest, String> {
    delete_agent_role_binding(&project_id, &role_id)
}

#[tauri::command]
fn get_agent_config() -> AgentConfig {
    current_agent_config()
}

#[tauri::command]
fn chat_agent(payload: AgentChatPayload) -> Result<AgentChatResponse, String> {
    let config = current_agent_config();
    if !config.enabled {
        return Err(config.reason.unwrap_or_else(|| "Agent backend is not configured.".to_string()));
    }

    let has_image = payload
        .canvas_snapshot
        .as_ref()
        .and_then(|snapshot| snapshot.get("dataUrl"))
        .and_then(|value| value.as_str())
        .map(|value| !value.is_empty())
        .unwrap_or(false);

    Ok(AgentChatResponse {
        message: "Desktop Agent test mode is available. Configure the web OpenRouter backend for model-backed responses.".to_string(),
        pending_command_plan: None,
        used_vision: has_image,
        warning: Some("Desktop test mode did not call a remote model.".to_string()),
        vision_unavailable_reason: None,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            write_project_draft,
            read_project_draft,
            list_project_drafts,
            save_imported_image,
            delete_project_draft,
            read_agent_conversation_context,
            write_agent_conversation_context,
            delete_agent_conversation_context,
            read_agent_chat_history,
            write_agent_chat_history,
            delete_agent_chat_history,
            list_project_docs,
            read_project_doc,
            write_project_doc,
            delete_project_doc,
            rename_project_working_directory,
            delete_project_working_directory,
            create_project_role,
            delete_project_role,
            get_agent_config,
            chat_agent
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
