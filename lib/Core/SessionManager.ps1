#Requires -Version 7.0
<#
.SYNOPSIS
    Gestionnaire de sessions pour Claude Launcher.
.DESCRIPTION
    Sauvegarde automatiquement chaque workspace lance dans sessions/.
    Permet de restaurer le dernier workspace ou de lister les sessions.
#>

$script:SessionDir = $null

function Initialize-SessionManager {
    [CmdletBinding()]
    param(
        [string]$SessionDir
    )

    try {
        if ([string]::IsNullOrWhiteSpace($SessionDir)) {
            $SessionDir = Join-Path $PSScriptRoot '..\..' 'sessions'
            $SessionDir = [System.IO.Path]::GetFullPath($SessionDir)
        }

        if (-not (Test-Path $SessionDir)) {
            New-Item -ItemType Directory -Path $SessionDir -Force | Out-Null
        }

        $script:SessionDir = $SessionDir
        Write-Log -Level 'INFO' -Source 'SessionManager' -Message "SessionManager initialized: $SessionDir"
    } catch {
        Write-LogError -Source 'SessionManager' -Message "Failed to initialize SessionManager" -ErrorRecord $_
        $script:SessionDir = $null
    }
}

function Save-Session {
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [string]$PresetName,

        [Parameter(Mandatory)]
        [hashtable]$Preset,

        [Parameter(Mandatory)]
        [hashtable]$Layout,

        [Parameter(Mandatory)]
        [hashtable]$Projects
    )

    if (-not $script:SessionDir) {
        Write-Log -Level 'WARN' -Source 'SessionManager' -Message "Cannot save session: SessionManager not initialized"
        return $null
    }

    try {
        $now = Get-Date
        $id = $now.ToString('yyyyMMdd-HHmmss')
        $timestamp = $now.ToString('yyyy-MM-ddTHH:mm:ss')

        $panels = @()
        foreach ($panel in $Preset.panels) {
            $slug = $panel.project
            $project = $Projects[$slug]

            if (-not $project) {
                Write-Log -Level 'WARN' -Source 'SessionManager' -Message "Skipping panel: project '$slug' not found in config"
                continue
            }

            # Resoudre la commande effective
            $command = if ($panel.ContainsKey('command') -and -not [string]::IsNullOrWhiteSpace($panel.command)) {
                $panel.command
            } elseif ($project.ContainsKey('default_command') -and -not [string]::IsNullOrWhiteSpace($project.default_command)) {
                $project.default_command
            } else {
                'claude'
            }

            # Resoudre initial_command
            $initialCommand = $null
            if ($panel.ContainsKey('initial_command') -and -not [string]::IsNullOrWhiteSpace($panel.initial_command)) {
                $initialCommand = $panel.initial_command
            } elseif ($project.ContainsKey('initial_command') -and -not [string]::IsNullOrWhiteSpace($project.initial_command)) {
                $initialCommand = $project.initial_command
            }

            # Branche git
            $branch = Get-GitBranchName -Path $project.path

            $panels += @{
                project         = $slug
                path            = $project.path
                command         = $command
                initial_command = $initialCommand
                branch          = $branch
            }
        }

        $session = @{
            id        = $id
            timestamp = $timestamp
            preset    = $PresetName
            layout    = $Preset.layout
            panels    = $panels
        }

        $fileName = "session-$id.json"
        $filePath = Join-Path $script:SessionDir $fileName

        $json = $session | ConvertTo-Json -Depth 5
        Set-Content -Path $filePath -Value $json -Encoding UTF8

        Write-Log -Level 'INFO' -Source 'SessionManager' -Message "Session saved: $fileName"
        Write-Log -Level 'DEBUG' -Source 'SessionManager' -Message "Session content: $json"

        # Rotation
        Remove-OldSessions -Keep 10

        return $filePath
    } catch {
        Write-LogError -Source 'SessionManager' -Message "Failed to save session" -ErrorRecord $_
        return $null
    }
}

function Get-LastSession {
    [CmdletBinding()]
    [OutputType([hashtable])]
    param()

    if (-not $script:SessionDir) {
        Write-Log -Level 'WARN' -Source 'SessionManager' -Message "Cannot get last session: SessionManager not initialized"
        return $null
    }

    $files = Get-ChildItem -Path $script:SessionDir -Filter 'session-*.json' -File -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending

    if ($files.Count -eq 0) {
        Write-Log -Level 'WARN' -Source 'SessionManager' -Message "No sessions found in $($script:SessionDir)"
        return $null
    }

    $latestFile = $files[0]
    Write-Log -Level 'INFO' -Source 'SessionManager' -Message "Loading last session: $($latestFile.Name)"

    try {
        $raw = Get-Content -Path $latestFile.FullName -Raw -Encoding UTF8
        $session = $raw | ConvertFrom-Json -AsHashtable
        return $session
    } catch {
        Write-LogError -Source 'SessionManager' -Message "Failed to parse session file: $($latestFile.Name)" -ErrorRecord $_
        return $null
    }
}

function Get-SessionList {
    [CmdletBinding()]
    [OutputType([array])]
    param(
        [int]$Limit = 10
    )

    if (-not $script:SessionDir) {
        Write-Log -Level 'WARN' -Source 'SessionManager' -Message "Cannot list sessions: SessionManager not initialized"
        return @()
    }

    $files = Get-ChildItem -Path $script:SessionDir -Filter 'session-*.json' -File -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending |
        Select-Object -First $Limit

    $result = [System.Collections.Generic.List[hashtable]]::new()
    foreach ($file in $files) {
        try {
            $raw = Get-Content -Path $file.FullName -Raw -Encoding UTF8
            $session = $raw | ConvertFrom-Json -AsHashtable
            # ConvertFrom-Json peut parser les dates ISO en DateTime — forcer en string
            $ts = $session.timestamp
            if ($ts -is [datetime]) {
                $ts = $ts.ToString('yyyy-MM-ddTHH:mm:ss')
            }
            $result.Add(@{
                id         = [string]$session.id
                timestamp  = [string]$ts
                preset     = [string]$session.preset
                panelCount = $session.panels.Count
            })
        } catch {
            Write-Log -Level 'WARN' -Source 'SessionManager' -Message "Skipping corrupt session file: $($file.Name)"
        }
    }

    Write-Log -Level 'INFO' -Source 'SessionManager' -Message "Listed $($result.Count) sessions"
    return ,$result.ToArray()
}

function Restore-Session {
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [hashtable]$Session,

        [Parameter(Mandatory)]
        [hashtable]$Config
    )

    Write-Log -Level 'INFO' -Source 'SessionManager' -Message "Restoring session: $($Session.id) (preset: $($Session.preset))"

    try {
        # Reconstruire un preset virtuel a partir de la session
        $virtualPanels = @()
        foreach ($panel in $Session.panels) {
            $virtualPanels += @{
                project         = $panel.project
                command         = $panel.command
                initial_command = $panel.initial_command
            }
        }

        $virtualPreset = @{
            name        = "Restore: $($Session.preset)"
            layout      = $Session.layout
            panels      = $virtualPanels
        }

        # Recuperer le layout depuis la config
        if (-not $Config.layouts.ContainsKey($Session.layout)) {
            throw "Layout '$($Session.layout)' introuvable dans config.json"
        }
        $layout = $Config.layouts[$Session.layout]

        # Build-WtCommand utilisera Get-GitBranchName pour les titres (branches actuelles)
        $wtCommand = Build-WtCommand -Preset $virtualPreset -Layout $layout -Projects $Config.projects

        Write-Log -Level 'INFO' -Source 'SessionManager' -Message "Session restored, WT command ready"
        return $wtCommand
    } catch {
        Write-LogError -Source 'SessionManager' -Message "Failed to restore session" -ErrorRecord $_
        throw
    }
}

function Remove-OldSessions {
    [CmdletBinding()]
    param(
        [int]$Keep = 10
    )

    if (-not $script:SessionDir) {
        return
    }

    try {
        $files = Get-ChildItem -Path $script:SessionDir -Filter 'session-*.json' -File -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending

        if ($files.Count -le $Keep) {
            return
        }

        $toDelete = $files | Select-Object -Skip $Keep
        foreach ($file in $toDelete) {
            Remove-Item -Path $file.FullName -Force
            Write-Log -Level 'INFO' -Source 'SessionManager' -Message "Old session removed: $($file.Name)"
        }
    } catch {
        Write-LogError -Source 'SessionManager' -Message "Failed to clean old sessions" -ErrorRecord $_
    }
}
