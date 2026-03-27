#Requires -Version 7.0
<#
.SYNOPSIS
    Moteur de resolution des variables template dans les commandes initiales.
.DESCRIPTION
    Resout les variables {{project}}, {{branch}}, {{path}}, {{preset}} dans
    les initial_command des panneaux avant injection dans wt.exe.
#>

function Get-InitialCommandContext {
    <#
    .SYNOPSIS
        Construit le contexte de variables pour la resolution des templates.
    .DESCRIPTION
        Extrait project, branch, path, preset depuis les objets courants.
        Branch est resolue via git rev-parse dans le dossier du projet.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [hashtable]$Project,

        [Parameter(Mandatory)]
        [string]$ProjectSlug,

        [Parameter(Mandatory)]
        [hashtable]$Preset
    )

    # Nom du projet
    $projectName = if ($Project.ContainsKey('name') -and -not [string]::IsNullOrWhiteSpace($Project.name)) {
        $Project.name
    } else {
        $ProjectSlug
    }

    # Nom du preset
    $presetName = if ($Preset.ContainsKey('name') -and -not [string]::IsNullOrWhiteSpace($Preset.name)) {
        $Preset.name
    } else {
        'unknown'
    }

    # Branche git
    $branch = 'no-branch'
    $projectPath = $Project.path
    if ($projectPath -and (Test-Path -Path (Join-Path $projectPath '.git'))) {
        try {
            $gitResult = & git -C $projectPath rev-parse --abbrev-ref HEAD 2>$null
            if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($gitResult)) {
                $branch = $gitResult.Trim()
            }
        } catch {
            Write-Log -Level 'WARN' -Source 'InitialCommands' -Message "Git branch resolution failed for '$projectPath': $($_.Exception.Message)"
        }
    }

    if ($branch -eq 'no-branch') {
        Write-Log -Level 'WARN' -Source 'InitialCommands' -Message "Branch fallback 'no-branch' for project '$ProjectSlug' (path: $projectPath)"
    }

    $context = @{
        project = $projectName
        branch  = $branch
        path    = $projectPath
        preset  = $presetName
    }

    Write-Log -Level 'INFO' -Source 'InitialCommands' -Message "Context built: project=$projectName, branch=$branch, preset=$presetName"
    return $context
}

function Resolve-InitialCommand {
    <#
    .SYNOPSIS
        Resout les variables template {{...}} dans une commande initiale.
    .DESCRIPTION
        Remplace {{project}}, {{branch}}, {{path}}, {{preset}} par les valeurs
        du contexte. Variables inconnues restent telles quelles (pas d'erreur).
        Resolution case-insensitive.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [string]$Template,

        [Parameter(Mandatory)]
        [hashtable]$Context
    )

    Write-Log -Level 'INFO' -Source 'InitialCommands' -Message "Resolving template: '$Template'"

    $resolved = [regex]::Replace($Template, '\{\{(\w+)\}\}', {
        param($match)
        $key = $match.Groups[1].Value.ToLower()
        if ($Context.ContainsKey($key)) {
            $Context[$key]
        } else {
            Write-Log -Level 'DEBUG' -Source 'InitialCommands' -Message "Unknown variable '{{$key}}' — kept as-is"
            $match.Value
        }
    })

    Write-Log -Level 'INFO' -Source 'InitialCommands' -Message "Resolved to: '$resolved'"
    return $resolved
}
