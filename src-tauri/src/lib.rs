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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentConfig {
    enabled: bool,
    provider: String,
    model: Option<String>,
    api_key_configured: bool,
    test_mode: bool,
    vision_enabled: bool,
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

fn read_env_trimmed(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn current_agent_config() -> AgentConfig {
    let test_mode = std::env::var("MANGAMAKER_AGENT_TEST_MODE").ok().as_deref() == Some("1");
    let model = read_env_trimmed("MANGAMAKER_AGENT_MODEL");
    let api_key_configured = read_env_trimmed("OPENROUTER_API_KEY").is_some();

    if test_mode {
        return AgentConfig {
            enabled: true,
            provider: "test".to_string(),
            model: Some(model.unwrap_or_else(|| "mangamaker-test-agent".to_string())),
            api_key_configured,
            test_mode: true,
            vision_enabled: true,
            reason: None,
        };
    }

    AgentConfig {
        enabled: false,
        provider: "unavailable".to_string(),
        model,
        api_key_configured,
        test_mode: false,
        vision_enabled: false,
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
            get_agent_config,
            chat_agent
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
