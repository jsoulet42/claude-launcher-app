use std::path::Path;
use std::time::SystemTime;
use tracing::{error, info};

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize)]
pub struct GitInfo {
    pub exists: bool,
    pub is_git: bool,
    pub branch: String,
    pub dirty_count: usize,
    pub is_dirty: bool,
    pub is_mono_repo: bool,
    pub repo_root: String,
    pub recent_commits: Vec<CommitInfo>,
}

impl Default for GitInfo {
    fn default() -> Self {
        Self {
            exists: false,
            is_git: false,
            branch: String::new(),
            dirty_count: 0,
            is_dirty: false,
            is_mono_repo: false,
            repo_root: String::new(),
            recent_commits: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct CommitInfo {
    pub hash: String,
    pub message: String,
    pub time_ago: String,
}

// ---------------------------------------------------------------------------
// Internal functions
// ---------------------------------------------------------------------------

fn get_branch_name(repo: &git2::Repository) -> String {
    match repo.head() {
        Ok(head) => {
            if head.is_branch() {
                let branch = head.shorthand().unwrap_or("unknown").to_string();
                info!("git: branch={}", branch);
                branch
            } else {
                info!("git: branch=(detached)");
                "(detached)".to_string()
            }
        }
        Err(e) => {
            // Repo with no commits: HEAD is unborn
            info!("git: branch=unknown (head error: {})", e);
            "unknown".to_string()
        }
    }
}

fn get_dirty_count(repo: &git2::Repository) -> usize {
    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true);

    match repo.statuses(Some(&mut opts)) {
        Ok(statuses) => {
            let count = statuses
                .iter()
                .filter(|entry| {
                    let s = entry.status();
                    s != git2::Status::CURRENT && s != git2::Status::IGNORED
                })
                .count();
            info!("git: dirty_count={}", count);
            count
        }
        Err(e) => {
            error!("git: failed to get statuses: {}", e);
            0
        }
    }
}

/// Detect if the given path is a sub-folder of a git repo (mono-repo).
/// Returns (is_mono_repo, repo_root, sub_path).
fn detect_mono_repo(repo: &git2::Repository, path: &Path) -> (bool, String, String) {
    let workdir = match repo.workdir() {
        Some(w) => w,
        None => {
            // Bare repo — not a mono-repo
            return (false, String::new(), String::new());
        }
    };

    let canonical_path = match dunce::canonicalize(path) {
        Ok(p) => p,
        Err(_) => path.to_path_buf(),
    };
    let canonical_workdir = match dunce::canonicalize(workdir) {
        Ok(p) => p,
        Err(_) => workdir.to_path_buf(),
    };

    let repo_root = canonical_workdir.to_string_lossy().to_string();

    if canonical_path == canonical_workdir {
        info!("git: standard repo at {}", repo_root);
        return (false, repo_root, String::new());
    }

    // Check if path is under workdir
    if let Ok(sub) = canonical_path.strip_prefix(&canonical_workdir) {
        let sub_path = sub.to_string_lossy().to_string();
        info!(
            "git: mono-repo detected, root={}, sub={}",
            repo_root, sub_path
        );
        (true, repo_root, sub_path)
    } else {
        (false, repo_root, String::new())
    }
}

fn get_recent_commits(
    repo: &git2::Repository,
    path: &Path,
    count: usize,
) -> Vec<CommitInfo> {
    let head_id = match repo.head().and_then(|h| h.resolve().map(|r| r.target())) {
        Ok(Some(oid)) => oid,
        _ => {
            info!("git: 0 commits (no HEAD)");
            return Vec::new();
        }
    };

    let mut revwalk = match repo.revwalk() {
        Ok(rw) => rw,
        Err(e) => {
            error!("git: revwalk failed: {}", e);
            return Vec::new();
        }
    };

    if revwalk.push(head_id).is_err() {
        return Vec::new();
    }
    revwalk.set_sorting(git2::Sort::TIME).ok();

    let (is_mono, _, sub_path) = detect_mono_repo(repo, path);

    let mut commits = Vec::new();
    let max_walk = count * 10;
    let mut walked = 0;

    for oid_result in revwalk {
        if commits.len() >= count || walked >= max_walk {
            break;
        }
        walked += 1;

        let oid = match oid_result {
            Ok(o) => o,
            Err(_) => continue,
        };

        let commit = match repo.find_commit(oid) {
            Ok(c) => c,
            Err(_) => continue,
        };

        // Mono-repo scope: filter commits that touch the sub-path
        if is_mono && !sub_path.is_empty() {
            if !commit_touches_path(repo, &commit, &sub_path) {
                continue;
            }
        }

        let hash = commit.id().to_string();
        let hash_short = if hash.len() >= 7 {
            hash[..7].to_string()
        } else {
            hash
        };

        let message = commit
            .summary()
            .unwrap_or("")
            .to_string();

        let time_ago = format_relative_time(commit.time().seconds());

        commits.push(CommitInfo {
            hash: hash_short,
            message,
            time_ago,
        });
    }

    info!("git: {} commits for {}", commits.len(), path.display());
    commits
}

/// Check if a commit touches files under the given sub-path (forward-slash separated).
fn commit_touches_path(
    repo: &git2::Repository,
    commit: &git2::Commit,
    sub_path: &str,
) -> bool {
    let tree = match commit.tree() {
        Ok(t) => t,
        Err(_) => return false,
    };

    // Normalize sub_path to use forward slashes (git internal format)
    let normalized = sub_path.replace('\\', "/");
    let prefix = if normalized.ends_with('/') {
        normalized.clone()
    } else {
        format!("{}/", normalized)
    };

    // Compare with parent tree
    let parent_tree = commit
        .parent(0)
        .ok()
        .and_then(|p| p.tree().ok());

    let diff = match repo.diff_tree_to_tree(
        parent_tree.as_ref(),
        Some(&tree),
        None,
    ) {
        Ok(d) => d,
        Err(_) => return false,
    };

    diff.deltas().any(|delta| {
        let path_str = delta
            .new_file()
            .path()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        path_str.starts_with(&prefix) || path_str == normalized.trim_end_matches('/')
    })
}

fn format_relative_time(epoch_seconds: i64) -> String {
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let delta = (now - epoch_seconds).max(0);

    if delta < 60 {
        return "just now".to_string();
    }

    let minutes = delta / 60;
    if minutes < 60 {
        return if minutes == 1 {
            "1 minute ago".to_string()
        } else {
            format!("{} minutes ago", minutes)
        };
    }

    let hours = delta / 3600;
    if hours < 24 {
        return if hours == 1 {
            "1 hour ago".to_string()
        } else {
            format!("{} hours ago", hours)
        };
    }

    let days = delta / 86400;
    if days < 30 {
        return if days == 1 {
            "1 day ago".to_string()
        } else {
            format!("{} days ago", days)
        };
    }

    let months = delta / (86400 * 30);
    if months < 12 {
        return if months == 1 {
            "1 month ago".to_string()
        } else {
            format!("{} months ago", months)
        };
    }

    let years = delta / (86400 * 365);
    if years == 1 {
        "1 year ago".to_string()
    } else {
        format!("{} years ago", years)
    }
}

fn format_dynamic_title(project_name: &str, branch: &str, command: &str) -> String {
    if branch.is_empty() || branch == "unknown" {
        return format!("{} \u{2014} {}", project_name, command);
    }

    let display_branch = if branch.len() > 30 {
        format!("{}...", &branch[..27])
    } else {
        branch.to_string()
    };

    format!("{} [{}] \u{2014} {}", project_name, display_branch, command)
}

// ---------------------------------------------------------------------------
// Tauri IPC Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_git_info(path: String, include_commits: bool) -> GitInfo {
    info!("IPC: get_git_info called for {}", path);

    let p = Path::new(&path);
    if !p.exists() {
        info!("git: path does not exist: {}", path);
        return GitInfo::default();
    }

    let repo = match git2::Repository::discover(p) {
        Ok(r) => r,
        Err(e) => {
            info!("git: not a git repo: {} ({})", path, e);
            return GitInfo {
                exists: true,
                ..GitInfo::default()
            };
        }
    };

    let branch = get_branch_name(&repo);
    let dirty_count = get_dirty_count(&repo);
    let (is_mono_repo, repo_root, _sub_path) = detect_mono_repo(&repo, p);

    let recent_commits = if include_commits {
        get_recent_commits(&repo, p, 3)
    } else {
        Vec::new()
    };

    GitInfo {
        exists: true,
        is_git: true,
        branch,
        dirty_count,
        is_dirty: dirty_count > 0,
        is_mono_repo,
        repo_root,
        recent_commits,
    }
}

#[tauri::command]
pub fn get_git_branch(path: String) -> String {
    info!("IPC: get_git_branch called for {}", path);

    let p = Path::new(&path);
    match git2::Repository::discover(p) {
        Ok(repo) => get_branch_name(&repo),
        Err(_) => String::new(),
    }
}

#[tauri::command]
pub fn format_title(project_name: String, branch: String, command: String) -> String {
    info!("IPC: format_title called");
    format_dynamic_title(&project_name, &branch, &command)
}
