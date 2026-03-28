#Requires -Version 7.0
<#
.SYNOPSIS
    Module central git pour Claude Launcher.
.DESCRIPTION
    Centralise toutes les fonctions de lecture d'info git :
    branche, status, commits recents, detection mono-repo, titre dynamique.
    Source unique de verite — tous les autres modules appellent ces fonctions.
#>

function Get-GitBranchName {
    <#
    .SYNOPSIS
        Retourne le nom de la branche courante d'un repo git.
    .DESCRIPTION
        Strategie : git rev-parse --abbrev-ref HEAD (fiable, gere worktrees).
        Fallback : lecture .git/HEAD si git n'est pas dans le PATH.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [string]$Path
    )

    if (-not (Test-Path $Path)) {
        Write-Log -Level 'WARN' -Source 'GitInfo' -Message "Path does not exist: $Path"
        return 'unknown'
    }

    # Strategie principale : git rev-parse
    try {
        $gitResult = & git -C $Path rev-parse --abbrev-ref HEAD 2>&1
        if ($LASTEXITCODE -eq 0 -and $gitResult -isnot [System.Management.Automation.ErrorRecord]) {
            $branch = "$gitResult".Trim()
            if ($branch -eq 'HEAD') {
                Write-Log -Level 'INFO' -Source 'GitInfo' -Message "Detached HEAD for $Path"
                return '(detached)'
            }
            if (-not [string]::IsNullOrWhiteSpace($branch)) {
                Write-Log -Level 'INFO' -Source 'GitInfo' -Message "Branch resolved: $branch for $Path"
                return $branch
            }
        }
    } catch {
        Write-Log -Level 'WARN' -Source 'GitInfo' -Message "git rev-parse failed for $Path, trying fallback" -ErrorRecord $_
    }

    # Fallback : lecture .git/HEAD
    Write-Log -Level 'WARN' -Source 'GitInfo' -Message "Falling back to .git/HEAD read for $Path"
    $headPath = Join-Path $Path '.git' 'HEAD'
    if (-not (Test-Path $headPath)) {
        Write-Log -Level 'WARN' -Source 'GitInfo' -Message "No .git/HEAD found at $Path"
        return 'unknown'
    }

    try {
        $content = Get-Content -Path $headPath -Raw -Encoding UTF8
        if ([string]::IsNullOrWhiteSpace($content)) {
            return 'unknown'
        }

        $content = $content.Trim()

        # Format : "ref: refs/heads/branch-name"
        if ($content -match '^ref:\s+refs/heads/(.+)$') {
            $branch = $Matches[1].Trim()
            Write-Log -Level 'INFO' -Source 'GitInfo' -Message "Branch from .git/HEAD: $branch for $Path"
            return $branch
        }

        # Detached HEAD : 40-char hex SHA
        if ($content -match '^[0-9a-f]{40}$') {
            Write-Log -Level 'INFO' -Source 'GitInfo' -Message "Detached HEAD from .git/HEAD for $Path"
            return '(detached)'
        }

        return 'unknown'
    } catch {
        Write-Log -Level 'ERROR' -Source 'GitInfo' -Message "Failed to read .git/HEAD for $Path" -ErrorRecord $_
        return 'unknown'
    }
}

function Test-MonoRepo {
    <#
    .SYNOPSIS
        Detecte si un chemin est un sous-dossier d'un repo git (mono-repo).
    .DESCRIPTION
        Compare git rev-parse --show-toplevel avec le chemin fourni.
        Si differents, c'est un mono-repo.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [string]$Path
    )

    $defaultResult = @{ IsMonoRepo = $false; RepoRoot = ''; SubPath = '' }

    if (-not (Test-Path $Path)) {
        Write-Log -Level 'WARN' -Source 'GitInfo' -Message "Test-MonoRepo: path does not exist: $Path"
        return $defaultResult
    }

    try {
        $toplevel = & git -C $Path rev-parse --show-toplevel 2>&1
        if ($LASTEXITCODE -ne 0 -or $toplevel -is [System.Management.Automation.ErrorRecord]) {
            Write-Log -Level 'WARN' -Source 'GitInfo' -Message "Test-MonoRepo: not a git repo: $Path"
            return $defaultResult
        }

        # Normaliser les deux chemins (resoudre ..\, supprimer trailing \)
        $normalizedPath = [System.IO.Path]::GetFullPath($Path).TrimEnd('\')
        $normalizedRoot = [System.IO.Path]::GetFullPath("$toplevel".Trim()).TrimEnd('\')

        if ($normalizedPath -ieq $normalizedRoot) {
            Write-Log -Level 'INFO' -Source 'GitInfo' -Message "Test-MonoRepo: standard repo at $Path"
            return @{
                IsMonoRepo = $false
                RepoRoot   = $normalizedRoot
                SubPath    = ''
            }
        }

        # Calculer le chemin relatif
        $subPath = $normalizedPath.Substring($normalizedRoot.Length).TrimStart('\')
        Write-Log -Level 'INFO' -Source 'GitInfo' -Message "Test-MonoRepo: mono-repo detected, root=$normalizedRoot, sub=$subPath"
        return @{
            IsMonoRepo = $true
            RepoRoot   = $normalizedRoot
            SubPath    = $subPath
        }
    } catch {
        Write-Log -Level 'ERROR' -Source 'GitInfo' -Message "Test-MonoRepo failed for $Path" -ErrorRecord $_
        return $defaultResult
    }
}

function Get-GitRecentCommits {
    <#
    .SYNOPSIS
        Retourne les N derniers commits d'un repo git.
    .DESCRIPTION
        Format : hash court | message | date relative.
        Si mono-repo (sous-dossier), scope les commits au dossier.
    #>
    [CmdletBinding()]
    [OutputType([hashtable[]])]
    param(
        [Parameter(Mandatory)]
        [string]$Path,

        [int]$Count = 3
    )

    if (-not (Test-Path $Path)) {
        Write-Log -Level 'WARN' -Source 'GitInfo' -Message "Get-GitRecentCommits: path does not exist: $Path"
        return @()
    }

    try {
        # Detecter si mono-repo pour scoper les commits
        $monoInfo = Test-MonoRepo -Path $Path
        $gitArgs = @('-C', $Path, 'log', "--format=%h|%s|%cr", "-n", "$Count")

        if ($monoInfo.IsMonoRepo -and $monoInfo.SubPath) {
            $gitArgs += '--'
            $gitArgs += $monoInfo.SubPath
        }

        $output = & git @gitArgs 2>&1
        if ($LASTEXITCODE -ne 0 -or $output -is [System.Management.Automation.ErrorRecord]) {
            Write-Log -Level 'WARN' -Source 'GitInfo' -Message "Get-GitRecentCommits: git log failed for $Path"
            return @()
        }

        $commits = @()
        $lines = "$output" -split "`n" | Where-Object { $_.Trim() -ne '' }
        foreach ($line in $lines) {
            $parts = $line.Split('|', 3)
            if ($parts.Count -ge 3) {
                $commits += @{
                    Hash    = $parts[0].Trim()
                    Message = $parts[1].Trim()
                    TimeAgo = $parts[2].Trim()
                }
            }
        }

        Write-Log -Level 'INFO' -Source 'GitInfo' -Message "Get-GitRecentCommits: $($commits.Count) commits for $Path"
        return $commits
    } catch {
        Write-Log -Level 'ERROR' -Source 'GitInfo' -Message "Get-GitRecentCommits failed for $Path" -ErrorRecord $_
        return @()
    }
}

function Get-ProjectGitInfo {
    <#
    .SYNOPSIS
        Retourne les infos git completes d'un projet.
    .DESCRIPTION
        Branche, dirty count, mono-repo, et optionnellement les derniers commits.
        Source unique de verite pour toute info git dans le launcher.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [string]$Path,

        [switch]$IncludeCommits
    )

    $defaultResult = @{
        Exists        = $false
        IsGit         = $false
        Branch        = ''
        DirtyCount    = 0
        IsDirty       = $false
        IsMonoRepo    = $false
        RepoRoot      = ''
        RecentCommits = @()
    }

    if (-not (Test-Path $Path)) {
        Write-Log -Level 'WARN' -Source 'GitInfo' -Message "Get-ProjectGitInfo: path does not exist: $Path"
        return $defaultResult
    }

    try {
        $isGitResult = & git -C $Path rev-parse --is-inside-work-tree 2>&1
        if ($isGitResult -is [System.Management.Automation.ErrorRecord] -or "$isGitResult".Trim() -ne 'true') {
            Write-Log -Level 'WARN' -Source 'GitInfo' -Message "Get-ProjectGitInfo: not a git repo: $Path"
            return @{
                Exists        = $true
                IsGit         = $false
                Branch        = ''
                DirtyCount    = 0
                IsDirty       = $false
                IsMonoRepo    = $false
                RepoRoot      = ''
                RecentCommits = @()
            }
        }

        # Branche
        $branch = Get-GitBranchName -Path $Path

        # Dirty count
        $dirtyCount = 0
        $porcelain = & git -C $Path status --porcelain 2>&1
        if ($porcelain -and $porcelain -isnot [System.Management.Automation.ErrorRecord]) {
            $dirtyCount = ("$porcelain" -split "`n" | Where-Object { $_.Trim() -ne '' }).Count
        }

        # Mono-repo
        $monoInfo = Test-MonoRepo -Path $Path

        # Commits (optionnel)
        $commits = @()
        if ($IncludeCommits) {
            $commits = Get-GitRecentCommits -Path $Path
        }

        Write-Log -Level 'INFO' -Source 'GitInfo' -Message "Get-ProjectGitInfo: $Path — branch=$branch, dirty=$dirtyCount, mono=$($monoInfo.IsMonoRepo)"

        return @{
            Exists        = $true
            IsGit         = $true
            Branch        = $branch
            DirtyCount    = $dirtyCount
            IsDirty       = ($dirtyCount -gt 0)
            IsMonoRepo    = $monoInfo.IsMonoRepo
            RepoRoot      = $monoInfo.RepoRoot
            RecentCommits = $commits
        }
    } catch {
        Write-Log -Level 'ERROR' -Source 'GitInfo' -Message "Get-ProjectGitInfo failed for $Path" -ErrorRecord $_
        return @{
            Exists        = $true
            IsGit         = $false
            Branch        = ''
            DirtyCount    = 0
            IsDirty       = $false
            IsMonoRepo    = $false
            RepoRoot      = ''
            RecentCommits = @()
        }
    }
}

function Get-GitDynamicTitle {
    <#
    .SYNOPSIS
        Construit le titre de panneau Windows Terminal avec branche.
    .DESCRIPTION
        Format : "{ProjectName} [{Branch}] — {Command}"
        Si branche inconnue ou vide : "{ProjectName} — {Command}"
        Si branche > 30 chars : tronquer a 27 + "..."
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [string]$ProjectName,

        [string]$Branch,

        [string]$Command
    )

    # Branche vide ou inconnue → pas d'affichage branche
    if ([string]::IsNullOrWhiteSpace($Branch) -or $Branch -eq 'unknown') {
        return "$ProjectName — $Command"
    }

    # Tronquer si > 30 chars (27 + "...")
    $displayBranch = $Branch
    if ($Branch.Length -gt 30) {
        $displayBranch = $Branch.Substring(0, 27) + '...'
    }

    return "$ProjectName [$displayBranch] — $Command"
}
