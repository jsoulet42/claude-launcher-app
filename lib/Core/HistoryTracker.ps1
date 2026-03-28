#Requires -Version 7.0
<#
.SYNOPSIS
    Historique des lancements pour Claude Launcher.
.DESCRIPTION
    Centralise le tracking des lancements (logs/history.json).
    Enregistre tous les projets, branches git, preset et layout pour chaque lancement.
    Fournit Get-LastLaunch pour le mode "launcher.ps1 last".
#>

$script:HistoryFile = $null

function Initialize-HistoryTracker {
    [CmdletBinding()]
    param(
        [string]$LogDir
    )

    try {
        if ([string]::IsNullOrWhiteSpace($LogDir)) {
            $LogDir = Join-Path $PSScriptRoot '..\..' 'logs'
            $LogDir = [System.IO.Path]::GetFullPath($LogDir)
        }

        if (-not (Test-Path $LogDir)) {
            New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
        }

        $script:HistoryFile = Join-Path $LogDir 'history.json'

        if (-not (Test-Path $script:HistoryFile)) {
            Set-Content -Path $script:HistoryFile -Value '[]' -Encoding UTF8
            Write-Log -Level 'INFO' -Source 'HistoryTracker' -Message "History file created: $($script:HistoryFile)"
        }

        Write-Log -Level 'INFO' -Source 'HistoryTracker' -Message "HistoryTracker initialized: $($script:HistoryFile)"
    } catch {
        Write-Log -Level 'ERROR' -Source 'HistoryTracker' -Message "Failed to initialize: $($_.Exception.Message)" -ErrorRecord $_
        $script:HistoryFile = $null
    }
}

function ConvertTo-SafeDateTime {
    [CmdletBinding()]
    [OutputType([datetime])]
    param(
        [Parameter(Mandatory)]
        $Value
    )
    if ($Value -is [datetime]) {
        return $Value
    }
    return [datetime]::ParseExact([string]$Value, 'yyyy-MM-ddTHH:mm:ss', $null)
}

function Read-HistoryFile {
    [CmdletBinding()]
    [OutputType([array])]
    param()

    if (-not $script:HistoryFile -or -not (Test-Path $script:HistoryFile)) {
        return @()
    }

    try {
        $raw = Get-Content -Path $script:HistoryFile -Raw -Encoding UTF8
        if ([string]::IsNullOrWhiteSpace($raw)) {
            return @()
        }
        $parsed = $raw | ConvertFrom-Json -AsHashtable
        $entries = @($parsed)

        if ($entries.Count -gt 0 -and $entries[0] -isnot [hashtable]) {
            Write-Log -Level 'WARN' -Source 'HistoryTracker' -Message "History file corrupt (unexpected element type), resetting"
            Set-Content -Path $script:HistoryFile -Value '[]' -Encoding UTF8
            return @()
        }

        # Retrocompatibilite : migrer les entrees ancien format
        for ($i = 0; $i -lt $entries.Count; $i++) {
            $e = $entries[$i]
            if ($e.ContainsKey('project') -and -not $e.ContainsKey('projects')) {
                $slug = if ($e.project) { $e.project } else { '' }
                $branch = if ($e.ContainsKey('branch') -and $e.branch) { $e.branch } else { '' }
                $e['projects'] = @($slug)
                $e['branches'] = @{ $slug = $branch }
                if (-not $e.ContainsKey('layout')) { $e['layout'] = '' }
                $e.Remove('project')
                $e.Remove('branch')
            }
        }

        return $entries
    } catch {
        Write-Log -Level 'WARN' -Source 'HistoryTracker' -Message "History file unreadable: $($_.Exception.Message)"
        try { Set-Content -Path $script:HistoryFile -Value '[]' -Encoding UTF8 } catch {
            Write-Log -Level 'WARN' -Source 'HistoryTracker' -Message "Failed to reset history file: $($_.Exception.Message)"
        }
        return @()
    }
}

function Add-LaunchEntry {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$PresetSlug,

        [Parameter(Mandatory)]
        [string[]]$ProjectSlugs,

        [string]$Layout = '',

        [hashtable]$GitBranches = @{}
    )

    if (-not $script:HistoryFile) {
        Write-Log -Level 'WARN' -Source 'HistoryTracker' -Message "Cannot add entry: history not initialized"
        return
    }

    try {
        $existingEntries = Read-HistoryFile

        $entry = @{
            timestamp = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss')
            preset    = $PresetSlug
            layout    = $Layout
            projects  = @($ProjectSlugs)
            branches  = $GitBranches
        }

        $entries = [System.Collections.Generic.List[object]]::new()
        foreach ($e in $existingEntries) { $entries.Add($e) }
        $entries.Add($entry)

        # Rotation : supprimer les entrees > 30 jours
        $cutoffDate = (Get-Date).AddDays(-30)
        $entries = @($entries | Where-Object {
            try { (ConvertTo-SafeDateTime $_.timestamp) -ge $cutoffDate } catch { $false }
        })

        # Limite FIFO : max 500
        if ($entries.Count -gt 500) {
            $entries = @($entries | Select-Object -Last 500)
        }

        $json = $entries | ConvertTo-Json -Depth 5 -AsArray
        Set-Content -Path $script:HistoryFile -Value $json -Encoding UTF8

        $projList = $ProjectSlugs -join ','
        Write-Log -Level 'INFO' -Source 'HistoryTracker' -Message "Launch tracked: preset=$PresetSlug projects=$projList layout=$Layout"
    } catch {
        Write-Log -Level 'ERROR' -Source 'HistoryTracker' -Message "Failed to add launch entry: $($_.Exception.Message)" -ErrorRecord $_
    }
}

function Get-LaunchHistory {
    [CmdletBinding()]
    [OutputType([array])]
    param(
        [int]$Limit = 0
    )

    $entries = Read-HistoryFile

    $sorted = @($entries | Sort-Object { try { ConvertTo-SafeDateTime $_.timestamp } catch { [datetime]::MinValue } } -Descending)

    if ($Limit -gt 0 -and $sorted.Count -gt $Limit) {
        $result = [System.Collections.Generic.List[hashtable]]::new()
        foreach ($e in ($sorted | Select-Object -First $Limit)) { $result.Add($e) }
        return ,$result.ToArray()
    }

    Write-Log -Level 'DEBUG' -Source 'HistoryTracker' -Message "History read: $($sorted.Count) entries"
    return $sorted
}

function Get-LastLaunch {
    [CmdletBinding()]
    [OutputType([hashtable])]
    param()

    $entries = Read-HistoryFile
    if ($entries.Count -eq 0) {
        Write-Log -Level 'INFO' -Source 'HistoryTracker' -Message "No launch history found"
        return $null
    }

    $sorted = @($entries | Sort-Object { try { ConvertTo-SafeDateTime $_.timestamp } catch { [datetime]::MinValue } } -Descending)
    $last = $sorted[0]
    if ($last -and $last -is [hashtable]) {
        Write-Log -Level 'DEBUG' -Source 'HistoryTracker' -Message "Last launch: preset=$($last.preset)"
        return $last
    }

    Write-Log -Level 'INFO' -Source 'HistoryTracker' -Message "No launch history found"
    return $null
}
