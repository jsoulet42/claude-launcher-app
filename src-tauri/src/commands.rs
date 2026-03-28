use tracing::{info, warn};

use crate::config;
use crate::git;

// ---------------------------------------------------------------------------
// Template resolution
// ---------------------------------------------------------------------------

pub struct TemplateContext {
    pub project_name: Option<String>,
    pub branch: Option<String>,
    pub path: Option<String>,
    pub preset_name: Option<String>,
}

pub fn resolve_template(template: &str, context: &TemplateContext) -> String {
    let mut result = template.to_string();

    let replacements = [
        ("{{project}}", &context.project_name),
        ("{{branch}}", &context.branch),
        ("{{path}}", &context.path),
        ("{{preset}}", &context.preset_name),
    ];

    for (var, value) in &replacements {
        if result.contains(var) {
            match value {
                Some(v) => {
                    info!("Template: {} → {}", var, v);
                    result = result.replace(var, v);
                }
                None => {
                    warn!("Template variable {} has no value, replacing with empty string", var);
                    result = result.replace(var, "");
                }
            }
        }
    }

    result
}

// ---------------------------------------------------------------------------
// Tauri command
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn resolve_initial_commands(
    preset_slug: String,
    project_slugs: Vec<Option<String>>,
) -> Result<Vec<Option<String>>, String> {
    info!(
        "IPC: resolve_initial_commands called for preset '{}' with {} panels",
        preset_slug,
        project_slugs.len()
    );

    let cfg = config::load_config()?;

    let preset = cfg.presets.get(&preset_slug).ok_or_else(|| {
        format!("Preset '{}' introuvable dans la configuration", preset_slug)
    })?;

    let results: Vec<Option<String>> = preset
        .panels
        .iter()
        .enumerate()
        .map(|(i, panel)| {
            // Determine project slug for this panel
            let project_slug = if i < project_slugs.len() {
                project_slugs[i].as_deref()
            } else {
                None
            };

            // Resolve initial_command: panel > project > None
            let raw_command = panel
                .initial_command
                .as_deref()
                .or_else(|| {
                    project_slug.and_then(|slug| {
                        cfg.projects
                            .get(slug)
                            .and_then(|p| p.initial_command.as_deref())
                    })
                });

            match raw_command {
                Some(cmd) if !cmd.trim().is_empty() => {
                    // Build template context
                    let project = project_slug.and_then(|slug| cfg.projects.get(slug));
                    let project_path = project.map(|p| p.path.clone());

                    let branch = project_path
                        .as_deref()
                        .map(|p| git::get_git_branch(p.to_string()))
                        .filter(|b| !b.is_empty());

                    let context = TemplateContext {
                        project_name: project.map(|p| p.name.clone()),
                        branch,
                        path: project_path,
                        preset_name: Some(preset.name.clone()),
                    };

                    let resolved = resolve_template(cmd, &context);
                    info!("Panel {}: initial_command resolved → {:?}", i, resolved);
                    Some(resolved)
                }
                Some(_) => {
                    info!("Panel {}: initial_command is empty, skipping", i);
                    None
                }
                None => {
                    info!("Panel {}: no initial_command", i);
                    None
                }
            }
        })
        .collect();

    Ok(results)
}
