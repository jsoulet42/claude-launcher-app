#Requires -Version 7.0
<#
.SYNOPSIS
    Systeme de logging centralise pour Claude Launcher.
.DESCRIPTION
    Capture toutes les erreurs (event handlers Terminal.Gui, git, reseau, config)
    dans logs/launcher.log. Le logger ne crashe JAMAIS l'application.
#>

$script:LogFile = $null

function Initialize-Logger {
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

        $script:LogFile = Join-Path $LogDir 'launcher.log'

        # Rotation simple : si > 1 MB, renommer en .old
        if (Test-Path $script:LogFile) {
            $size = (Get-Item $script:LogFile).Length
            if ($size -gt 1MB) {
                $oldPath = "$($script:LogFile).old"
                Move-Item -Path $script:LogFile -Destination $oldPath -Force
            }
        }

        # Ligne de separation de session
        $timestamp = Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'
        Add-Content -Path $script:LogFile -Value "========== Session started $timestamp ==========" -Encoding UTF8
    } catch {
        # Le logger ne doit JAMAIS crasher l'app
        $script:LogFile = $null
    }
}

function Write-Log {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateSet('DEBUG', 'INFO', 'WARN', 'ERROR')]
        [string]$Level,
        [Parameter(Mandatory)]
        [string]$Source,
        [Parameter(Mandatory)]
        [string]$Message,
        [System.Management.Automation.ErrorRecord]$ErrorRecord
    )

    if (-not $script:LogFile) { return }

    try {
        $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
        $levelPad = $Level.PadRight(5)
        $line = "[$timestamp] [$levelPad] [$Source] $Message"

        if ($ErrorRecord) {
            $line += "`n  Exception: $($ErrorRecord.Exception.Message)"
            if ($ErrorRecord.InvocationInfo.ScriptName) {
                $line += "`n  at $($ErrorRecord.InvocationInfo.ScriptName):$($ErrorRecord.InvocationInfo.ScriptLineNumber)"
            }
            if ($ErrorRecord.ScriptStackTrace) {
                $firstLine = ($ErrorRecord.ScriptStackTrace -split "`n")[0]
                $line += "`n  StackTrace: $firstLine"
            }
        }

        Add-Content -Path $script:LogFile -Value $line -Encoding UTF8
    } catch {
        # Ecriture echouee (fichier verrouille, disque plein) — ignorer silencieusement
    }
}

function Write-LogError {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Source,
        [Parameter(Mandatory)]
        [string]$Message,
        [System.Management.Automation.ErrorRecord]$ErrorRecord
    )
    Write-Log -Level 'ERROR' -Source $Source -Message $Message -ErrorRecord $ErrorRecord
}

function Protect-EventHandler {
    [CmdletBinding()]
    [OutputType([scriptblock])]
    param(
        [Parameter(Mandatory)]
        [string]$Source,
        [Parameter(Mandatory)]
        [scriptblock]$Handler
    )

    # Capturer les references pour la closure
    # IMPORTANT : les fonctions PowerShell ne sont PAS visibles depuis les
    # scriptblocks des event handlers Terminal.Gui (piege .GetNewClosure()).
    # On doit capturer la reference a Write-Log dans une variable locale.
    $capturedSource = $Source
    $capturedHandler = $Handler
    $capturedLogFn = ${function:Write-Log}

    return {
        try {
            & $capturedHandler @args
        } catch {
            try {
                $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
                & $capturedLogFn -Level 'ERROR' -Source $capturedSource -Message "Event handler error" -ErrorRecord $_
            } catch {
                # Ultime fallback — ne JAMAIS crasher
            }
        }
    }.GetNewClosure()
}
