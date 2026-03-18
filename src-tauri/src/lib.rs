use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const PROJECTS_DIR_NAME: &str = "projects";
const PROJECT_META_FILE: &str = ".latest_project";
const PROJECT_JSON_FILE: &str = "project.json";
const PROJECT_ASSETS_DIR: &str = "assets";

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            write_project_draft,
            read_project_draft,
            list_project_drafts,
            save_imported_image
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
