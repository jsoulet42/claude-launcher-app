use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use tracing::{error, info, warn};
use walkdir::WalkDir;

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum StackType {
    DolibarrModule,
    Php,
    Node,
    Go,
    Rust,
    Dotnet,
    Python,
    Powershell,
    Unknown,
}

impl std::fmt::Display for StackType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            StackType::DolibarrModule => "dolibarr-module",
            StackType::Php => "php",
            StackType::Node => "node",
            StackType::Go => "go",
            StackType::Rust => "rust",
            StackType::Dotnet => "dotnet",
            StackType::Python => "python",
            StackType::Powershell => "powershell",
            StackType::Unknown => "unknown",
        };
        write!(f, "{}", s)
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ScannedProject {
    pub slug: String,
    pub name: String,
    pub path: String,
    pub color: String,
    pub default_command: String,
    pub source: String,
    pub stack_type: StackType,
    pub git_branch: String,
    pub icon: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct ScanOptions {
    pub directories: Vec<String>,
    pub max_depth: Option<usize>,
    pub existing_paths: Vec<String>,
}

// ---------------------------------------------------------------------------
// Excluded directories
// ---------------------------------------------------------------------------

const EXCLUDED_DIRS: &[&str] = &[
    "node_modules",
    "vendor",
    ".git",
    ".venv",
    "venv",
    "env",
    "dist",
    "build",
    "out",
    "__pycache__",
    ".claude",
    "target",
    ".next",
];

fn is_excluded(name: &str) -> bool {
    EXCLUDED_DIRS.contains(&name)
}

// ---------------------------------------------------------------------------
// Stack detection
// ---------------------------------------------------------------------------

fn detect_stack(path: &Path) -> StackType {
    // 1. Dolibarr module: core/modules/modXxx.class.php
    let core_modules = path.join("core").join("modules");
    if core_modules.is_dir() {
        if let Ok(entries) = fs::read_dir(&core_modules) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if name_str.starts_with("mod") && name_str.ends_with(".class.php") {
                    return StackType::DolibarrModule;
                }
            }
        }
    }

    // 2. PHP
    if path.join("composer.json").is_file() {
        return StackType::Php;
    }

    // 3. Node.js
    if path.join("package.json").is_file() {
        return StackType::Node;
    }

    // 4. Go
    if path.join("go.mod").is_file() {
        return StackType::Go;
    }

    // 5. Rust
    if path.join("Cargo.toml").is_file() {
        return StackType::Rust;
    }

    // 6. .NET (*.sln or *.csproj)
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.ends_with(".sln") || name_str.ends_with(".csproj") {
                return StackType::Dotnet;
            }
        }
    }

    // 7. Python
    if path.join("requirements.txt").is_file()
        || path.join("pyproject.toml").is_file()
        || path.join("setup.py").is_file()
    {
        return StackType::Python;
    }

    // 8. PowerShell (*.ps1 at root)
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.ends_with(".ps1") {
                return StackType::Powershell;
            }
        }
    }

    StackType::Unknown
}

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------

fn to_slug(name: &str) -> String {
    let mut slug: String = name
        .to_lowercase()
        .chars()
        .filter_map(|c| {
            if c.is_ascii_alphanumeric() {
                Some(c)
            } else if c == ' ' || c == '_' {
                Some('-')
            } else {
                // Drop non-alphanumeric chars (same as legacy: [^a-z0-9\-] removed)
                None
            }
        })
        .collect();

    // Collapse multiple dashes
    while slug.contains("--") {
        slug = slug.replace("--", "-");
    }

    slug = slug.trim_matches('-').to_string();

    if slug.is_empty() {
        "project".to_string()
    } else {
        slug
    }
}

// ---------------------------------------------------------------------------
// Git branch (lightweight)
// ---------------------------------------------------------------------------

fn get_branch_for_scan(path: &Path) -> String {
    match git2::Repository::open(path) {
        Ok(repo) => match repo.head() {
            Ok(head) => {
                if head.is_branch() {
                    head.shorthand().unwrap_or("unknown").to_string()
                } else {
                    // Detached HEAD
                    head.target()
                        .map(|oid| {
                            let s = oid.to_string();
                            if s.len() >= 7 { s[..7].to_string() } else { s }
                        })
                        .unwrap_or_else(|| "unknown".to_string())
                }
            }
            Err(_) => "unknown".to_string(),
        },
        Err(_) => "unknown".to_string(),
    }
}

// ---------------------------------------------------------------------------
// Core scan logic
// ---------------------------------------------------------------------------

fn scan_projects_internal(options: &ScanOptions) -> Vec<ScannedProject> {
    let max_depth = options.max_depth.unwrap_or(5);

    info!(
        "scanner: starting scan, {} directories, max_depth={}",
        options.directories.len(),
        max_depth
    );

    if options.directories.is_empty() {
        info!("scanner: no directories configured");
        return Vec::new();
    }

    // Build existing paths set for dedup
    let existing_paths: HashSet<String> = options
        .existing_paths
        .iter()
        .map(|p| normalize_path(p))
        .collect();

    let mut all_projects = Vec::new();

    for dir in &options.directories {
        let dir_path = Path::new(dir);
        if !dir_path.is_dir() {
            warn!("scanner: directory does not exist: {}", dir);
            continue;
        }

        info!("scanner: scanning {}", dir);
        let projects = scan_single_directory(dir_path, max_depth, &existing_paths);
        all_projects.extend(projects);
    }

    // Dedup slugs
    dedup_slugs(&mut all_projects);

    info!("scanner: scan complete, {} projects discovered", all_projects.len());
    all_projects
}

fn scan_single_directory(
    root: &Path,
    max_depth: usize,
    existing_paths: &HashSet<String>,
) -> Vec<ScannedProject> {
    let mut projects = Vec::new();
    // Track git project dirs to skip their children (unless Dolibarr exception)
    let mut git_project_roots: HashSet<std::path::PathBuf> = HashSet::new();
    // Track Dolibarr exception dirs where we should continue recursion
    let mut dolibarr_exceptions: HashSet<std::path::PathBuf> = HashSet::new();

    let walker = WalkDir::new(root)
        .max_depth(max_depth)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();

            // Never descend into excluded dirs
            if entry.depth() > 0 && is_excluded(&name) {
                return false;
            }

            true
        });

    for entry_result in walker {
        let entry = match entry_result {
            Ok(e) => e,
            Err(e) => {
                error!("scanner: access error: {}", e);
                continue;
            }
        };

        // Skip the root itself
        if entry.depth() == 0 {
            continue;
        }

        // Only process directories
        if !entry.file_type().is_dir() {
            continue;
        }

        let entry_path = entry.path();

        // Check if this entry is a child of a git project root (not a Dolibarr exception)
        let should_skip = git_project_roots.iter().any(|root| {
            entry_path.starts_with(root) && entry_path != root
        }) && !dolibarr_exceptions.iter().any(|exc| {
            entry_path.starts_with(exc)
        });

        if should_skip {
            continue;
        }

        // Canonicalize for dedup check
        let canonical = dunce::canonicalize(entry_path)
            .unwrap_or_else(|_| entry_path.to_path_buf());
        let normalized = normalize_path(&canonical.to_string_lossy());

        // Skip if already in config
        if existing_paths.contains(&normalized) {
            continue;
        }

        let has_git = entry_path.join(".git").is_dir();

        if has_git {
            let stack_type = detect_stack(entry_path);
            let branch = get_branch_for_scan(entry_path);
            let dir_name = entry
                .file_name()
                .to_string_lossy()
                .to_string();

            let project = ScannedProject {
                slug: to_slug(&dir_name),
                name: dir_name,
                path: canonical.to_string_lossy().to_string(),
                color: "#808080".to_string(),
                default_command: "claude".to_string(),
                source: "scanned".to_string(),
                stack_type: stack_type.clone(),
                git_branch: branch,
                icon: String::new(),
            };

            info!(
                "scanner: found project: {} ({}) at {}",
                project.name, project.stack_type, project.path
            );
            projects.push(project);

            // Register as git root to skip children
            git_project_roots.insert(entry_path.to_path_buf());

            // Dolibarr exception: if custom/ or modules/ exists, allow recursion
            if entry_path.join("custom").is_dir() || entry_path.join("modules").is_dir() {
                dolibarr_exceptions.insert(entry_path.to_path_buf());
            }
        } else {
            let stack_type = detect_stack(entry_path);
            if stack_type != StackType::Unknown {
                let dir_name = entry
                    .file_name()
                    .to_string_lossy()
                    .to_string();

                let project = ScannedProject {
                    slug: to_slug(&dir_name),
                    name: dir_name,
                    path: canonical.to_string_lossy().to_string(),
                    color: "#808080".to_string(),
                    default_command: "claude".to_string(),
                    source: "scanned".to_string(),
                    stack_type: stack_type.clone(),
                    git_branch: "unknown".to_string(),
                    icon: String::new(),
                };

                info!(
                    "scanner: found project (no git): {} ({}) at {}",
                    project.name, project.stack_type, project.path
                );
                projects.push(project);
            }
            // Continue recursion (walkdir handles it)
        }
    }

    projects
}

fn normalize_path(path: &str) -> String {
    let trimmed = path.trim_end_matches(['\\', '/']);
    #[cfg(windows)]
    {
        // Windows: case-insensitive FS, backslash natif
        trimmed.to_lowercase().replace('/', "\\")
    }
    #[cfg(not(windows))]
    {
        // Unix: case-sensitive FS, forward slash natif
        trimmed.replace('\\', "/")
    }
}

fn dedup_slugs(projects: &mut Vec<ScannedProject>) {
    let mut slug_counts: HashMap<String, usize> = HashMap::new();

    for project in projects.iter_mut() {
        let base_slug = project.slug.clone();
        let count = slug_counts.entry(base_slug.clone()).or_insert(0);
        *count += 1;

        if *count > 1 {
            project.slug = format!("{}-{}", base_slug, count);
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri IPC Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn scan_projects(options: ScanOptions) -> Result<Vec<ScannedProject>, String> {
    info!(
        "IPC: scan_projects called, {} directories",
        options.directories.len()
    );
    Ok(scan_projects_internal(&options))
}

#[tauri::command]
pub fn detect_project_stack(path: String) -> String {
    info!("IPC: detect_project_stack called for {}", path);
    let p = Path::new(&path);
    if !p.is_dir() {
        warn!("scanner: path is not a directory: {}", path);
        return StackType::Unknown.to_string();
    }
    detect_stack(p).to_string()
}
