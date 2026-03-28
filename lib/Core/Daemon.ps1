#Requires -Version 7.0
<#
.SYNOPSIS
    Process daemon pour Claude Launcher.
.DESCRIPTION
    Surveille Windows Terminal en arriere-plan via polling.
    Detecte quand WT se ferme et met a jour l'etat dans daemon-state.json.
    Demarre automatiquement au lancement d'un workspace, s'arrete seul.
#>

$script:DaemonStateFile = $null

function Initialize-Daemon {
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

        $script:DaemonStateFile = Join-Path $SessionDir 'daemon-state.json'
        Write-Log -Level 'INFO' -Source 'Daemon' -Message "Daemon module initialized: $($script:DaemonStateFile)"
    } catch {
        Write-LogError -Source 'Daemon' -Message "Failed to initialize Daemon module" -ErrorRecord $_
        $script:DaemonStateFile = $null
    }
}

function Test-DaemonRunning {
    [CmdletBinding()]
    [OutputType([bool])]
    param()

    if (-not $script:DaemonStateFile -or -not (Test-Path $script:DaemonStateFile)) {
        return $false
    }

    try {
        $raw = Get-Content -Path $script:DaemonStateFile -Raw -Encoding UTF8
        if ([string]::IsNullOrWhiteSpace($raw)) {
            return $false
        }

        $state = $raw | ConvertFrom-Json -AsHashtable

        if ($state.status -ne 'watching') {
            return $false
        }

        # Verifier que le PID daemon existe encore
        $daemonProcess = Get-Process -Id $state.daemon_pid -ErrorAction SilentlyContinue
        if (-not $daemonProcess) {
            # Daemon mort — mettre a jour le state
            Write-Log -Level 'WARN' -Source 'Daemon' -Message "Daemon PID $($state.daemon_pid) no longer exists, marking stopped"
            $state.status = 'stopped'
            $state.stopped_at = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss')
            $state | ConvertTo-Json -Depth 3 | Set-Content -Path $script:DaemonStateFile -Encoding UTF8
            return $false
        }

        return $true
    } catch {
        Write-Log -Level 'WARN' -Source 'Daemon' -Message "Failed to check daemon state: $($_.Exception.Message)"
        return $false
    }
}

function Start-Daemon {
    [CmdletBinding()]
    [OutputType([int])]
    param(
        [Parameter(Mandatory)]
        [int]$WtPid,

        [string]$SessionFile = '',

        [int]$IntervalMs = 5000
    )

    if (-not $script:DaemonStateFile) {
        Write-Log -Level 'WARN' -Source 'Daemon' -Message "Cannot start daemon: module not initialized"
        return $null
    }

    # Verifier si un daemon tourne deja
    if (Test-DaemonRunning) {
        Write-Log -Level 'INFO' -Source 'Daemon' -Message "Daemon already running, skipping"
        return $null
    }

    # Verifier que le PID WT cible existe
    $wtProcess = Get-Process -Id $WtPid -ErrorAction SilentlyContinue
    if (-not $wtProcess) {
        Write-Log -Level 'WARN' -Source 'Daemon' -Message "WT PID $WtPid does not exist, cannot start daemon"
        return $null
    }

    # Valider l'intervalle
    if ($IntervalMs -lt 1000) { $IntervalMs = 5000 }
    if ($IntervalMs -gt 60000) { $IntervalMs = 60000 }

    # Resoudre le chemin absolu de Logger.ps1 pour le job
    $loggerPath = Join-Path $PSScriptRoot '..' 'TUI' 'Logger.ps1'
    $loggerPath = [System.IO.Path]::GetFullPath($loggerPath)
    $logDir = Split-Path (Split-Path $script:DaemonStateFile) -Parent
    $logDir = Join-Path $logDir 'logs'
    $logDir = [System.IO.Path]::GetFullPath($logDir)

    try {
        $job = Start-Job -ScriptBlock {
            param($WtPid, $StateFile, $IntervalMs, $LoggerPath, $LogDir)

            try {
                # Dot-source Logger dans le job (scope separee)
                . $LoggerPath
                Initialize-Logger -LogDir $LogDir

                Write-Log -Level 'INFO' -Source 'Daemon' -Message "Daemon job started, watching WT PID $WtPid (interval: ${IntervalMs}ms)"

                while ($true) {
                    $wtProcess = Get-Process -Id $WtPid -ErrorAction SilentlyContinue

                    if (-not $wtProcess) {
                        # WT ferme — mettre a jour state et sortir
                        try {
                            $raw = Get-Content -Path $StateFile -Raw -Encoding UTF8
                            $state = $raw | ConvertFrom-Json -AsHashtable
                            $state.status = 'stopped'
                            $state.stopped_at = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss')
                            $state | ConvertTo-Json -Depth 3 | Set-Content -Path $StateFile -Encoding UTF8
                        } catch {
                            Write-Log -Level 'ERROR' -Source 'Daemon' -Message "Failed to update state on WT close: $($_.Exception.Message)"
                        }
                        Write-Log -Level 'INFO' -Source 'Daemon' -Message "WT PID $WtPid closed, daemon stopping"
                        break
                    }

                    # Mettre a jour last_check
                    try {
                        $raw = Get-Content -Path $StateFile -Raw -Encoding UTF8
                        $state = $raw | ConvertFrom-Json -AsHashtable
                        $state.last_check = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss')
                        $state | ConvertTo-Json -Depth 3 | Set-Content -Path $StateFile -Encoding UTF8
                    } catch {
                        # Fichier corrompu — log et continuer la surveillance
                        Write-Log -Level 'WARN' -Source 'Daemon' -Message "Failed to update last_check: $($_.Exception.Message)"
                    }

                    Start-Sleep -Milliseconds $IntervalMs
                }
            } catch {
                try {
                    Write-Log -Level 'ERROR' -Source 'Daemon' -Message "Daemon job crashed: $($_.Exception.Message)"
                } catch {
                    # Ultime fallback — ne jamais crasher silencieusement
                }
            }
        } -ArgumentList $WtPid, $script:DaemonStateFile, $IntervalMs, $loggerPath, $logDir

        # Ecrire le state initial
        $daemonState = @{
            daemon_pid   = $job.Id
            wt_pid       = $WtPid
            status       = 'watching'
            started_at   = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss')
            last_check   = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss')
            stopped_at   = $null
            session_file = $SessionFile
            interval_ms  = $IntervalMs
        }

        $daemonState | ConvertTo-Json -Depth 3 | Set-Content -Path $script:DaemonStateFile -Encoding UTF8
        Write-Log -Level 'INFO' -Source 'Daemon' -Message "Daemon started (job $($job.Id)), watching WT PID $WtPid"

        return $job.Id
    } catch {
        Write-LogError -Source 'Daemon' -Message "Failed to start daemon" -ErrorRecord $_
        return $null
    }
}

function Stop-Daemon {
    [CmdletBinding()]
    param()

    if (-not $script:DaemonStateFile -or -not (Test-Path $script:DaemonStateFile)) {
        Write-Log -Level 'INFO' -Source 'Daemon' -Message "No daemon state file, nothing to stop"
        return
    }

    try {
        $raw = Get-Content -Path $script:DaemonStateFile -Raw -Encoding UTF8
        if ([string]::IsNullOrWhiteSpace($raw)) {
            return
        }

        $state = $raw | ConvertFrom-Json -AsHashtable

        if ($state.status -ne 'watching') {
            Write-Log -Level 'INFO' -Source 'Daemon' -Message "Daemon not watching (status: $($state.status)), nothing to stop"
            return
        }

        # Tenter d'arreter le job
        try {
            Stop-Job -Id $state.daemon_pid -ErrorAction SilentlyContinue
            Remove-Job -Id $state.daemon_pid -Force -ErrorAction SilentlyContinue
        } catch {
            Write-Log -Level 'WARN' -Source 'Daemon' -Message "Could not stop job $($state.daemon_pid): $($_.Exception.Message)"
        }

        # Mettre a jour le state
        $state.status = 'stopped'
        $state.stopped_at = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss')
        $state | ConvertTo-Json -Depth 3 | Set-Content -Path $script:DaemonStateFile -Encoding UTF8

        Write-Log -Level 'INFO' -Source 'Daemon' -Message "Daemon stopped manually"
    } catch {
        Write-LogError -Source 'Daemon' -Message "Failed to stop daemon" -ErrorRecord $_
    }
}

function Get-DaemonStatus {
    [CmdletBinding()]
    [OutputType([hashtable])]
    param()

    if (-not $script:DaemonStateFile -or -not (Test-Path $script:DaemonStateFile)) {
        return $null
    }

    try {
        $raw = Get-Content -Path $script:DaemonStateFile -Raw -Encoding UTF8
        if ([string]::IsNullOrWhiteSpace($raw)) {
            return $null
        }

        $state = $raw | ConvertFrom-Json -AsHashtable

        # Guard ConvertFrom-Json dates (piege connu)
        foreach ($key in @('started_at', 'last_check', 'stopped_at')) {
            if ($state.ContainsKey($key) -and $state[$key] -is [datetime]) {
                $state[$key] = $state[$key].ToString('yyyy-MM-ddTHH:mm:ss')
            }
        }

        return $state
    } catch {
        Write-Log -Level 'WARN' -Source 'Daemon' -Message "Failed to read daemon state: $($_.Exception.Message)"
        return $null
    }
}

function Find-WtPid {
    <#
    .SYNOPSIS
        Detecte le PID Windows Terminal apres un lancement.
    .DESCRIPTION
        Compare les PID WT avant/apres le lancement pour identifier le nouveau.
        Si WT fusionne dans une instance existante, retourne le PID existant.
    #>
    [CmdletBinding()]
    [OutputType([int])]
    param(
        [Parameter(Mandatory)]
        [int[]]$PidsBefore
    )

    $pidsAfter = @(Get-Process -Name WindowsTerminal -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)

    if ($pidsAfter.Count -eq 0) {
        Write-Log -Level 'WARN' -Source 'Daemon' -Message "No WindowsTerminal process found after launch"
        return 0
    }

    # Chercher un nouveau PID
    $newPids = @($pidsAfter | Where-Object { $_ -notin $PidsBefore })

    if ($newPids.Count -gt 0) {
        $wtPidFound = $newPids[0]
        Write-Log -Level 'INFO' -Source 'Daemon' -Message "New WT PID detected: $wtPidFound"
        return $wtPidFound
    }

    # Pas de nouveau PID — WT a fusionne dans l'instance existante
    # Prendre le plus recent par StartTime
    $wtProcs = Get-Process -Name WindowsTerminal -ErrorAction SilentlyContinue | Sort-Object StartTime -Descending
    if ($wtProcs) {
        $wtPidFound = $wtProcs[0].Id
        Write-Log -Level 'INFO' -Source 'Daemon' -Message "WT merged into existing instance, using PID: $wtPidFound"
        return $wtPidFound
    }

    return 0
}
