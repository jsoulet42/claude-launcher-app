#Requires -Version 7.0
<#
.SYNOPSIS
    Moteur de suggestions intelligentes de presets pour Claude Launcher.
.DESCRIPTION
    Analyse l'historique des lancements, l'heure, et le contexte git
    pour scorer et trier les presets par pertinence.
    L'historique est gere par HistoryTracker.ps1 (logs/history.json).
#>

function Initialize-SmartPresets {
    [CmdletBinding()]
    param()

    Write-Log -Level 'INFO' -Source 'SmartPresets' -Message "SmartPresets initialized (history via HistoryTracker)"
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
