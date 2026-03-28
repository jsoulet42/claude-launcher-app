#Requires -Version 7.0
<#
.SYNOPSIS
    Scan automatique de dossiers pour decouvrir des projets.
.DESCRIPTION
    Parcourt recursivement des dossiers configures pour detecter les projets
    (repos git, modules Dolibarr, projets Node/PHP/Python/Go, etc.).
    Retourne des hashtables au format compatible config.projects.
#>

# Dossiers a ne jamais scanner
$script:ExcludedDirs = @(
    'node_modules', 'vendor', '.git', '.venv', 'venv', 'env',
    'dist', 'build', 'out', '__pycache__', '.claude'
)

function ConvertTo-ProjectSlug {
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [string]$Name
    )

    $slug = $Name.ToLower()
    $slug = $slug -replace '\s+', '-'
    $slug = $slug -replace '[^a-z0-9\-]', ''
    $slug = $slug -replace '-+', '-'
    $slug = $slug.Trim('-')

    if ([string]::IsNullOrWhiteSpace($slug)) {
        $slug = 'project'
    }

    return $slug
}

# Get-GitBranchName est fourni par lib/Git/GitInfo.ps1 (charge par launcher.ps1)

function Get-ProjectStackType {
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [string]$Path
    )

    # Priorite de detection (premier match gagne)

    # 1. Dolibarr module : core/modules/modXxx.class.php
    $coreModulesDir = Join-Path $Path 'core' 'modules'
    if (Test-Path $coreModulesDir) {
        $modFiles = Get-ChildItem -Path $coreModulesDir -Filter 'mod*.class.php' -File -ErrorAction SilentlyContinue
        if ($modFiles) {
            return 'dolibarr-module'
        }
    }

    # 2. PHP (composer.json)
    if (Test-Path (Join-Path $Path 'composer.json')) {
        return 'php'
    }

    # 3. Node.js (package.json)
    if (Test-Path (Join-Path $Path 'package.json')) {
        return 'node'
    }

    # 4. Go (go.mod)
    if (Test-Path (Join-Path $Path 'go.mod')) {
        return 'go'
    }

    # 5. Rust (Cargo.toml)
    if (Test-Path (Join-Path $Path 'Cargo.toml')) {
        return 'rust'
    }

    # 6. .NET (*.sln ou *.csproj)
    $slnFiles = Get-ChildItem -Path $Path -Filter '*.sln' -File -ErrorAction SilentlyContinue
    $csprojFiles = Get-ChildItem -Path $Path -Filter '*.csproj' -File -ErrorAction SilentlyContinue
    if ($slnFiles -or $csprojFiles) {
        return 'dotnet'
    }

    # 7. Python (requirements.txt, pyproject.toml, setup.py)
    if ((Test-Path (Join-Path $Path 'requirements.txt')) -or
        (Test-Path (Join-Path $Path 'pyproject.toml')) -or
        (Test-Path (Join-Path $Path 'setup.py'))) {
        return 'python'
    }

    # 8. PowerShell (*.ps1 directement dans le dossier)
    $ps1Files = Get-ChildItem -Path $Path -Filter '*.ps1' -File -ErrorAction SilentlyContinue
    if ($ps1Files) {
        return 'powershell'
    }

    # 9. Aucun marqueur connu
    return 'unknown'
}

function Invoke-ProjectScan {
    [CmdletBinding()]
    [OutputType([hashtable[]])]
    param(
        [string[]]$Directories = @(),

        [int]$MaxDepth = 5,

        [hashtable]$ExistingProjects = @{}
    )

    Write-Log -Level 'INFO' -Source 'Scanner' -Message "Starting project scan: $($Directories.Count) directories, max depth $MaxDepth"

    if (-not $Directories -or $Directories.Count -eq 0) {
        Write-Log -Level 'INFO' -Source 'Scanner' -Message "Aucun dossier de scan configure"
        return @()
    }

    # Construire un set des chemins existants pour dedup rapide
    $existingPaths = @{}
    foreach ($slug in $ExistingProjects.Keys) {
        $proj = $ExistingProjects[$slug]
        if ($proj.ContainsKey('path')) {
            $normalizedPath = $proj.path.TrimEnd('\', '/')
            $existingPaths[$normalizedPath.ToLower()] = $true
        }
    }

    $discovered = [System.Collections.Generic.List[hashtable]]::new()
    $slugCounts = @{}

    foreach ($dir in $Directories) {
        if (-not (Test-Path $dir -PathType Container)) {
            Write-Log -Level 'WARN' -Source 'Scanner' -Message "Scan directory does not exist: $dir"
            continue
        }

        Write-Log -Level 'INFO' -Source 'Scanner' -Message "Scanning: $dir"

        $projects = Scan-Directory -Path $dir -CurrentDepth 0 -MaxDepth $MaxDepth -ExistingPaths $existingPaths
        foreach ($p in $projects) {
            $discovered.Add($p)
        }
    }

    # Dedup slugs
    $result = @()
    foreach ($project in $discovered) {
        $baseSlug = $project.slug
        if ($slugCounts.ContainsKey($baseSlug)) {
            $slugCounts[$baseSlug]++
            $project.slug = "$baseSlug-$($slugCounts[$baseSlug])"
        } else {
            $slugCounts[$baseSlug] = 1
        }
        $result += $project
    }

    Write-Log -Level 'INFO' -Source 'Scanner' -Message "Scan complete: $($result.Count) projects discovered"
    return $result
}

function Scan-Directory {
    [CmdletBinding()]
    [OutputType([hashtable[]])]
    param(
        [Parameter(Mandatory)]
        [string]$Path,

        [int]$CurrentDepth,

        [int]$MaxDepth,

        [hashtable]$ExistingPaths
    )

    if ($CurrentDepth -gt $MaxDepth) {
        Write-Log -Level 'WARN' -Source 'Scanner' -Message "Max depth ($MaxDepth) reached at: $Path"
        return @()
    }

    $results = [System.Collections.Generic.List[hashtable]]::new()

    try {
        $subdirs = Get-ChildItem -Path $Path -Directory -ErrorAction Stop
    } catch {
        Write-Log -Level 'ERROR' -Source 'Scanner' -Message "Cannot access directory: $Path" -ErrorRecord $_
        return @()
    }

    foreach ($subdir in $subdirs) {
        $dirName = $subdir.Name

        # Exclure les dossiers interdits
        if ($dirName -in $script:ExcludedDirs) {
            continue
        }

        $fullPath = $subdir.FullName
        $normalizedPath = $fullPath.TrimEnd('\', '/').ToLower()

        # Deja dans la config ? On saute
        if ($ExistingPaths.ContainsKey($normalizedPath)) {
            continue
        }

        $hasGit = Test-Path (Join-Path $fullPath '.git') -PathType Container

        if ($hasGit) {
            # Projet git trouve
            $stackType = Get-ProjectStackType -Path $fullPath
            $branch = Get-GitBranchName -Path $fullPath

            $project = @{
                slug            = ConvertTo-ProjectSlug -Name $dirName
                name            = $dirName
                path            = $fullPath
                color           = '#808080'
                default_command = 'claude'
                source          = 'scanned'
                stack_type      = $stackType
                git_branch      = $branch
                icon            = ''
            }

            $results.Add($project)
            Write-Log -Level 'INFO' -Source 'Scanner' -Message "Found project: $dirName ($stackType) at $fullPath"

            # Exception Dolibarr : continuer si custom/ ou modules/ existe
            $hasCustom = Test-Path (Join-Path $fullPath 'custom') -PathType Container
            $hasModules = Test-Path (Join-Path $fullPath 'modules') -PathType Container

            if ($hasCustom -or $hasModules) {
                $subProjects = Scan-Directory -Path $fullPath -CurrentDepth ($CurrentDepth + 1) -MaxDepth $MaxDepth -ExistingPaths $ExistingPaths
                foreach ($sp in $subProjects) {
                    $results.Add($sp)
                }
            }
            # Sinon, ne pas descendre (le projet est trouve)
        } else {
            # Pas de .git — verifier les marqueurs secondaires
            $stackType = Get-ProjectStackType -Path $fullPath
            if ($stackType -ne 'unknown') {
                $project = @{
                    slug            = ConvertTo-ProjectSlug -Name $dirName
                    name            = $dirName
                    path            = $fullPath
                    color           = '#808080'
                    default_command = 'claude'
                    source          = 'scanned'
                    stack_type      = $stackType
                    git_branch      = 'unknown'
                    icon            = ''
                }

                $results.Add($project)
                Write-Log -Level 'INFO' -Source 'Scanner' -Message "Found project (no git): $dirName ($stackType) at $fullPath"
            }

            # Continuer la recursion dans tous les cas (pas de .git = pas de limite)
            $subProjects = Scan-Directory -Path $fullPath -CurrentDepth ($CurrentDepth + 1) -MaxDepth $MaxDepth -ExistingPaths $ExistingPaths
            foreach ($sp in $subProjects) {
                $results.Add($sp)
            }
        }
    }

    return [hashtable[]]@($results)
}
