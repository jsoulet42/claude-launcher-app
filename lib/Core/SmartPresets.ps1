#Requires -Version 7.0
<#
.SYNOPSIS
    Moteur de suggestions intelligentes de presets pour Claude Launcher.
.DESCRIPTION
    Analyse l'historique des lancements, l'heure, et le contexte git
    pour scorer et trier les presets par pertinence.
    Inclut un mini history tracker (logs/history.json).
#>

$script:HistoryFile = $null

function Initialize-SmartPresets {
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

        # Creer le fichier si inexistant
        if (-not (Test-Path $script:HistoryFile)) {
            Set-Content -Path $script:HistoryFile -Value '[]' -Encoding UTF8
            Write-Log -Level 'INFO' -Source 'SmartPresets' -Message "History file created: $($script:HistoryFile)"
        }

        Write-Log -Level 'INFO' -Source 'SmartPresets' -Message "SmartPresets initialized, history: $($script:HistoryFile)"
    } catch {
        Write-Log -Level 'WARN' -Source 'SmartPresets' -Message "Failed to initialize: $($_.Exception.Message)"
        $script:HistoryFile = $null
    }
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
        # ConvertFrom-Json -AsHashtable unwraps single-element arrays into a bare hashtable.
        # Force into array with @() to handle both cases uniformly.
        $entries = @($parsed)
        # Validate: each entry must be a hashtable with a 'timestamp' key
        if ($entries.Count -gt 0 -and $entries[0] -isnot [hashtable]) {
            Write-Log -Level 'WARN' -Source 'SmartPresets' -Message "History file corrupt (unexpected element type), resetting"
            Set-Content -Path $script:HistoryFile -Value '[]' -Encoding UTF8
            return @()
        }
        return $entries
    } catch {
        Write-Log -Level 'WARN' -Source 'SmartPresets' -Message "History file unreadable: $($_.Exception.Message)"
        try { Set-Content -Path $script:HistoryFile -Value '[]' -Encoding UTF8 } catch {
            Write-Log -Level 'WARN' -Source 'SmartPresets' -Message "Failed to reset history file: $($_.Exception.Message)"
        }
        return @()
    }
}

function Add-LaunchEntry {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$PresetSlug,

        [string]$ProjectSlug,

        [string]$GitBranch
    )

    if (-not $script:HistoryFile) {
        Write-Log -Level 'WARN' -Source 'SmartPresets' -Message "Cannot add entry: history not initialized"
        return
    }

    try {
        $existingEntries = Read-HistoryFile

        # Nouvelle entree
        $entry = @{
            timestamp = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss')
            preset    = $PresetSlug
            project   = if ($ProjectSlug) { $ProjectSlug } else { '' }
            branch    = if ($GitBranch) { $GitBranch } else { '' }
        }

        # Utiliser une List pour eviter la fusion hashtable de += sur un array a 1 element
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

        Write-Log -Level 'INFO' -Source 'SmartPresets' -Message "Historique: preset=$PresetSlug project=$ProjectSlug branch=$GitBranch"
    } catch {
        Write-Log -Level 'ERROR' -Source 'SmartPresets' -Message "Failed to add launch entry: $($_.Exception.Message)" -ErrorRecord $_
    }
}

function ConvertTo-SafeDateTime {
    [CmdletBinding()]
    [OutputType([datetime])]
    param(
        [Parameter(Mandatory)]
        $Value
    )
    # ConvertFrom-Json may return a DateTime object or an ISO string depending on context.
    if ($Value -is [datetime]) {
        return $Value
    }
    return [datetime]::ParseExact([string]$Value, 'yyyy-MM-ddTHH:mm:ss', $null)
}

function Get-LaunchHistory {
    [CmdletBinding()]
    [OutputType([array])]
    param(
        [int]$Limit = 0
    )

    $entries = Read-HistoryFile

    # Trier par timestamp desc
    $sorted = @($entries | Sort-Object { try { ConvertTo-SafeDateTime $_.timestamp } catch { [datetime]::MinValue } } -Descending)

    if ($Limit -gt 0 -and $sorted.Count -gt $Limit) {
        return @($sorted | Select-Object -First $Limit)
    }

    return $sorted
}

function Get-TimeSlot {
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [int]$Hour
    )

    if ($Hour -ge 6 -and $Hour -lt 12)  { return 'matin' }
    if ($Hour -ge 12 -and $Hour -lt 18) { return 'apres-midi' }
    if ($Hour -ge 18 -and $Hour -lt 22) { return 'soir' }
    return 'nuit'
}

function Get-PresetSuggestions {
    [CmdletBinding()]
    [OutputType([array])]
    param(
        [Parameter(Mandatory)]
        [hashtable]$Config,

        [hashtable]$GitContext
    )

    # Guard : pas de presets
    if (-not $Config.presets -or $Config.presets.Count -eq 0) {
        Write-Log -Level 'INFO' -Source 'SmartPresets' -Message "Suggestions: no presets in config"
        return @()
    }

    $defaultPreset = if ($Config.preferences -and $Config.preferences.default_preset) { $Config.preferences.default_preset } else { '' }
    $history = Read-HistoryFile
    $now = Get-Date
    $currentSlot = Get-TimeSlot -Hour $now.Hour

    # Calculs communs pour la frequence
    $cutoff7d = $now.AddDays(-7)
    $history7d = @($history | Where-Object {
        try { (ConvertTo-SafeDateTime $_.timestamp) -ge $cutoff7d } catch { $false }
    })
    $total7d = $history7d.Count

    # Calculs communs pour le moment de la journee
    $cutoff30d = $now.AddDays(-30)
    $history30d = @($history | Where-Object {
        try { (ConvertTo-SafeDateTime $_.timestamp) -ge $cutoff30d } catch { $false }
    })
    $historyInSlot = @($history30d | Where-Object {
        try {
            $tsVal = ConvertTo-SafeDateTime $_.timestamp
            (Get-TimeSlot -Hour $tsVal.Hour) -eq $currentSlot
        } catch { $false }
    })
    $totalInSlot = $historyInSlot.Count

    $results = @()

    foreach ($slug in $Config.presets.Keys) {
        $preset = $Config.presets[$slug]
        $breakdown = @{
            Frequency = 0
            Recency   = 0
            TimeOfDay = 0
            GitContext = 0
        }

        # --- 1. Frequence (max 40) ---
        if ($total7d -gt 0) {
            $presetCount7d = @($history7d | Where-Object { $_.preset -eq $slug }).Count
            $ratio = $presetCount7d / $total7d
            $breakdown.Frequency = [math]::Round($ratio * 40, 0)
        }

        # --- 2. Recence (max 30) ---
        $lastEntry = $history | Where-Object { $_.preset -eq $slug } | Sort-Object { $_.timestamp } -Descending | Select-Object -First 1
        if ($lastEntry) {
            try {
                $lastTs = ConvertTo-SafeDateTime $lastEntry.timestamp
                $deltaHours = ($now - $lastTs).TotalHours
                $breakdown.Recency = if ($deltaHours -lt 1) { 30 }
                    elseif ($deltaHours -lt 4)  { 25 }
                    elseif ($deltaHours -lt 12) { 20 }
                    elseif ($deltaHours -lt 24) { 15 }
                    elseif ($deltaHours -lt 48) { 10 }
                    elseif ($deltaHours -lt 168) { 5 }
                    else { 0 }
            } catch {
                Write-Log -Level 'WARN' -Source 'SmartPresets' -Message "Failed to parse timestamp for recency: $($_.Exception.Message)"
            }
        }

        # --- 3. Moment de la journee (max 20) ---
        if ($totalInSlot -gt 0) {
            $presetInSlot = @($historyInSlot | Where-Object { $_.preset -eq $slug }).Count
            $ratio = $presetInSlot / $totalInSlot
            $breakdown.TimeOfDay = [math]::Round($ratio * 20, 0)
        }

        # --- 4. Contexte git (max 10) ---
        if ($GitContext) {
            if ($GitContext.IsDirty) {
                # Presets avec shell/log/dev dans les commandes → boost
                $hasShellCmd = $false
                foreach ($panel in $preset.panels) {
                    if ($panel.ContainsKey('command') -and $panel.command) {
                        $cmd = $panel.command.ToLower()
                        if ($cmd -match 'pwsh|shell|log|dev') {
                            $hasShellCmd = $true
                            break
                        }
                    }
                }
                $breakdown.GitContext = if ($hasShellCmd) { 10 } else { 3 }
            } else {
                # Projet clean → presets focus (1-2 panels) boostes
                $panelCount = $preset.panels.Count
                $breakdown.GitContext = if ($panelCount -le 2) { 7 } else { 3 }
            }
        }

        $score = $breakdown.Frequency + $breakdown.Recency + $breakdown.TimeOfDay + $breakdown.GitContext

        # Bonus premier lancement : si score = 0 et preset par defaut → +1
        if ($score -eq 0 -and $slug -eq $defaultPreset) {
            $score = 1
        }

        $reason = Get-SuggestionReason -Breakdown $breakdown -Slug $slug -History7d $history7d -CurrentSlot $currentSlot

        $results += @{
            Slug        = $slug
            Score       = $score
            Breakdown   = $breakdown
            Reason      = $reason
            IsSuggested = $false
        }
    }

    # Tri : score desc, puis defaut en premier a score egal, puis alphabetique
    $results = @($results | Sort-Object {
        $sortKey = '{0:D5}_{1}_{2}' -f (99999 - $_.Score), $(if ($_.Slug -eq $defaultPreset) { '0' } else { '1' }), $_.Slug
        $sortKey
    })

    # Marquer le premier comme suggere
    if ($results.Count -gt 0) {
        $results[0].IsSuggested = $true
    }

    $topSlug = if ($results.Count -gt 0) { $results[0].Slug } else { 'none' }
    $topScore = if ($results.Count -gt 0) { $results[0].Score } else { 0 }
    Write-Log -Level 'INFO' -Source 'SmartPresets' -Message "Suggestions: top=$topSlug score=$topScore ($($results.Count) presets scores)"

    return $results
}

function Get-SuggestionReason {
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [hashtable]$Breakdown,

        [Parameter(Mandatory)]
        [string]$Slug,

        [array]$History7d,

        [string]$CurrentSlot
    )

    $parts = @()

    if ($Breakdown.Frequency -gt 20) {
        $count = @($History7d | Where-Object { $_.preset -eq $Slug }).Count
        $parts += "Utilise ${count}x cette semaine"
    }

    if ($Breakdown.Recency -gt 20) {
        $parts += "Lance recemment"
    }

    if ($Breakdown.TimeOfDay -gt 10) {
        $slotLabel = switch ($CurrentSlot) {
            'matin'       { 'matin' }
            'apres-midi'  { 'apres-midi' }
            'soir'        { 'soir' }
            'nuit'        { 'nuit' }
            default       { $CurrentSlot }
        }
        $parts += "creneau $slotLabel"
    }

    if ($Breakdown.GitContext -gt 5) {
        $parts += "projet avec modifs en cours"
    }

    if ($parts.Count -eq 0) {
        return "Preset par defaut"
    }

    return $parts -join ', '
}
