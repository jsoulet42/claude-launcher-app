#Requires -Version 7.0
<#
.SYNOPSIS
    Claude Launcher — Point d'entree CLI.
.DESCRIPTION
    Lance un workspace Windows Terminal multi-panneaux a partir d'un preset
    defini dans config.json.
.EXAMPLE
    ./launcher.ps1              # Utilise le preset par defaut
    ./launcher.ps1 daily        # Lance le preset "daily"
    ./launcher.ps1 focus -Project easysap   # Resout {{auto}} avec le projet easysap
    ./launcher.ps1 daily -WhatIf            # Affiche la commande sans lancer
    ./launcher.ps1 -Init                    # Cree un config.json par defaut
    ./launcher.ps1 -Restore                 # Restaure la derniere session
    ./launcher.ps1 -ListSessions            # Affiche les 10 dernieres sessions
    ./launcher.ps1 last                     # Relance le dernier preset utilise
    ./launcher.ps1 -History                 # Affiche les 10 derniers lancements
#>

param(
    [Parameter(Position = 0)]
    [string]$Preset,

    [string]$Project,

    [string]$ConfigPath = '.\config.json',

    [switch]$WhatIf,

    [switch]$Init,

    [switch]$Restore,

    [switch]$ListSessions,

    [switch]$History
)

# --- Logger (PREMIER import — avant tout autre module) ---
. "$PSScriptRoot\lib\TUI\Logger.ps1"
Initialize-Logger -LogDir (Join-Path $PSScriptRoot 'logs')
Write-Log -Level 'INFO' -Source 'Launcher' -Message "Claude Launcher started (args: $Preset)"

# --- Imports ---
. "$PSScriptRoot\lib\Git\GitInfo.ps1"
. "$PSScriptRoot\lib\Config\ConfigSchema.ps1"
. "$PSScriptRoot\lib\Config\ConfigLoader.ps1"
. "$PSScriptRoot\lib\Terminal\WtBuilder.ps1"
# Note: InitialCommands.ps1 est charge via WtBuilder.ps1 (dot-source en cascade)
. "$PSScriptRoot\lib\Core\HistoryTracker.ps1"
. "$PSScriptRoot\lib\Core\SessionManager.ps1"

# --- Fonctions internes ---

function Write-LauncherError {
    param([string]$Message)
    Write-Host "ERREUR: $Message" -ForegroundColor Red
}

function Write-LauncherSuccess {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Green
}

function Show-WorkspacePreview {
    param(
        [hashtable]$Preset,
        [hashtable]$Projects
    )

    $panelCount = $Preset.panels.Count
    Write-Host ""
    Write-Host "Workspace : $($Preset.name) ($panelCount panneaux)" -ForegroundColor Green

    for ($i = 0; $i -lt $Preset.panels.Count; $i++) {
        $panel = $Preset.panels[$i]
        $proj = $Projects[$panel.project]

        # Resoudre la commande effective
        $cmd = if ($panel.ContainsKey('command') -and -not [string]::IsNullOrWhiteSpace($panel.command)) {
            $panel.command
        } elseif ($proj.ContainsKey('default_command') -and -not [string]::IsNullOrWhiteSpace($proj.default_command)) {
            $proj.default_command
        } else {
            'claude'
        }

        # Tronquer le chemin si > 50 chars
        $path = $proj.path
        if ($path.Length -gt 50) {
            $path = $path.Substring(0, 20) + '...' + $path.Substring($path.Length - 27)
        }

        # Resoudre initial_command : panel → project → null
        $initCmd = $null
        if ($panel.ContainsKey('initial_command') -and -not [string]::IsNullOrWhiteSpace($panel.initial_command)) {
            $initCmd = $panel.initial_command
        } elseif ($proj.ContainsKey('initial_command') -and -not [string]::IsNullOrWhiteSpace($proj.initial_command)) {
            $initCmd = $proj.initial_command
        }

        $index = $i + 1
        $name = $proj.name.PadRight(12)
        $initSuffix = if ($initCmd) { " then: $initCmd" } else { '' }
        Write-Host "  [$index] $name | $($cmd.PadRight(10)) | $path$initSuffix"
    }

    Write-Host ""
}

function Resolve-AutoPanels {
    param(
        [hashtable]$Preset,
        [string]$ProjectSlug
    )

    # Deep-clone via JSON round-trip
    $json = $Preset | ConvertTo-Json -Depth 10
    $clone = $json | ConvertFrom-Json -Depth 10 -AsHashtable

    for ($i = 0; $i -lt $clone.panels.Count; $i++) {
        if ($clone.panels[$i].project -eq '{{auto}}') {
            $clone.panels[$i].project = $ProjectSlug
        }
    }

    return $clone
}

# --- Main ---

# 0a. Mode ListSessions (avant chargement config)
if ($ListSessions) {
    try {
        Initialize-SessionManager -SessionDir (Join-Path $PSScriptRoot 'sessions')
        $sessions = Get-SessionList -Limit 10
        if ($sessions.Count -eq 0) {
            Write-Host "Aucune session sauvegardee." -ForegroundColor Yellow
            exit 0
        }
        Write-Host ""
        Write-Host "Sessions recentes :" -ForegroundColor Green
        Write-Host ""
        Write-Host "  #   Date                 Preset          Panneaux" -ForegroundColor Cyan
        Write-Host "  --- -------------------- --------------- --------" -ForegroundColor Cyan
        for ($i = 0; $i -lt $sessions.Count; $i++) {
            $s = $sessions[$i]
            $num = ($i + 1).ToString().PadLeft(3)
            $ts = $s.timestamp.PadRight(20)
            $pr = $s.preset.PadRight(15)
            Write-Host "  $num $ts $pr $($s.panelCount)"
        }
        Write-Host ""
        exit 0
    } catch {
        Write-LogError -Source 'Launcher' -Message "ListSessions failed" -ErrorRecord $_
        Write-LauncherError $_.Exception.Message
        exit 1
    }
}

# 0b. Mode History (avant chargement config)
if ($History) {
    try {
        Initialize-HistoryTracker -LogDir (Join-Path $PSScriptRoot 'logs')
        $entries = Get-LaunchHistory -Limit 10
        if ($entries.Count -eq 0) {
            Write-Host "Aucun lancement enregistre." -ForegroundColor Yellow
            exit 0
        }
        Write-Host ""
        Write-Host "Derniers lancements :" -ForegroundColor Green
        Write-Host ""
        Write-Host "  #   Date                 Preset          Projets" -ForegroundColor Cyan
        Write-Host "  --- -------------------- --------------- -------" -ForegroundColor Cyan
        for ($i = 0; $i -lt $entries.Count; $i++) {
            $e = $entries[$i]
            $num = ($i + 1).ToString().PadLeft(3)
            $ts = if ($e.timestamp -is [datetime]) { $e.timestamp.ToString('yyyy-MM-ddTHH:mm:ss') } else { $e.timestamp }
            $ts = $ts.PadRight(20)
            $pr = $e.preset.PadRight(15)
            $projs = if ($e.projects) { ($e.projects -join ', ') } else { '' }
            Write-Host "  $num $ts $pr $projs"
        }
        Write-Host ""
        exit 0
    } catch {
        Write-LogError -Source 'Launcher' -Message "History failed" -ErrorRecord $_
        Write-LauncherError $_.Exception.Message
        exit 1
    }
}

# 0c. Mode Init (avant chargement config)
if ($Init) {
    try {
        $null = New-LauncherConfig -Path $ConfigPath
        Write-Host "Editez ce fichier pour ajouter vos projets et presets."
        exit 0
    } catch {
        Write-LogError -Source 'Launcher' -Message "Init failed" -ErrorRecord $_
        Write-LauncherError $_.Exception.Message
        exit 1
    }
}

# 1. Charger config
$config = $null
try {
    $config = Import-LauncherConfig -Path $ConfigPath
} catch {
    Write-LogError -Source 'Launcher' -Message "Config load failed" -ErrorRecord $_
    Write-LauncherError $_.Exception.Message
    exit 1
}

# 2. Mode Restore
if ($Restore) {
    try {
        Initialize-SessionManager -SessionDir (Join-Path $PSScriptRoot 'sessions')
        $lastSession = Get-LastSession
        if (-not $lastSession) {
            Write-LauncherError "Aucune session sauvegardee. Lancez d'abord un preset."
            exit 1
        }

        # Afficher preview
        Write-Host ""
        Write-Host "Restauration de la derniere session :" -ForegroundColor Green
        Write-Host "  Preset  : $($lastSession.preset)" -ForegroundColor Cyan
        $sessionDate = if ($lastSession.timestamp -is [datetime]) { $lastSession.timestamp.ToString('yyyy-MM-dd HH:mm:ss') } else { $lastSession.timestamp }
        Write-Host "  Date    : $sessionDate" -ForegroundColor Cyan
        Write-Host "  Panneaux: $($lastSession.panels.Count)" -ForegroundColor Cyan
        for ($i = 0; $i -lt $lastSession.panels.Count; $i++) {
            $p = $lastSession.panels[$i]
            $idx = $i + 1
            $branchInfo = if ($p.branch) { " ($($p.branch))" } else { '' }
            Write-Host "    [$idx] $($p.project)$branchInfo | $($p.command)"
        }
        Write-Host ""

        $wtCommand = Restore-Session -Session $lastSession -Config $config
        $wtArgs = $wtCommand -replace '^wt\.exe\s*', ''
        Start-Process wt.exe -ArgumentList $wtArgs
        Write-LauncherSuccess "Restauration en cours..."
        exit 0
    } catch {
        Write-LogError -Source 'Launcher' -Message "Restore failed" -ErrorRecord $_
        Write-LauncherError $_.Exception.Message
        exit 1
    }
}

# 3. Mode Last (relancer le dernier preset)
if ($Preset -eq 'last') {
    try {
        Initialize-HistoryTracker -LogDir (Join-Path $PSScriptRoot 'logs')
        $lastLaunch = Get-LastLaunch
        if (-not $lastLaunch) {
            Write-LauncherError "Aucun lancement enregistre. Lancez d'abord un preset."
            exit 1
        }

        $lastPresetName = $lastLaunch.preset
        if (-not $config.presets.ContainsKey($lastPresetName)) {
            Write-LauncherError "Le preset '$lastPresetName' n'existe plus dans config.json."
            exit 1
        }

        Write-Log -Level 'INFO' -Source 'Launcher' -Message "Mode last: relaunching preset '$lastPresetName'"

        # Reutiliser le flow normal en injectant le preset
        $Preset = $lastPresetName
    } catch {
        Write-LogError -Source 'Launcher' -Message "Last mode failed" -ErrorRecord $_
        Write-LauncherError $_.Exception.Message
        exit 1
    }
}

# 4. Mode TUI
if ($Preset -eq 'tui') {
    try {
        . "$PSScriptRoot\lib\TUI\DepsManager.ps1"
        . "$PSScriptRoot\lib\TUI\Theme.ps1"
        . "$PSScriptRoot\lib\TUI\ProjectList.ps1"
        . "$PSScriptRoot\lib\TUI\PresetSelector.ps1"
        . "$PSScriptRoot\lib\TUI\LaunchFlow.ps1"
        . "$PSScriptRoot\lib\Scanner\ProjectScanner.ps1"
        . "$PSScriptRoot\lib\Core\SmartPresets.ps1"
        . "$PSScriptRoot\lib\TUI\App.ps1"
        # Initialiser HistoryTracker + SmartPresets pour le TUI
        Initialize-HistoryTracker -LogDir (Join-Path $PSScriptRoot 'logs')
        Initialize-SmartPresets
        # Le lancement est gere en interne par Start-LaunchFlow (modales TUI).
        # Start-LauncherTui retourne $null quand l'utilisateur quitte (Q).
        Start-LauncherTui -Config $config | Out-Null
    } catch {
        Write-LogError -Source 'Launcher' -Message "TUI crashed" -ErrorRecord $_
        Write-Host "ERREUR TUI: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "Details dans logs/launcher.log" -ForegroundColor Yellow
    }
    exit 0
}

# 5. Resoudre le preset
$presetName = $null
if (-not [string]::IsNullOrWhiteSpace($Preset)) {
    $presetName = $Preset
} elseif ($config.preferences.default_preset) {
    $presetName = $config.preferences.default_preset
} else {
    $available = ($config.presets.Keys | Sort-Object) -join ', '
    if ($available) {
        Write-LauncherError "Aucun preset par defaut configure.`nPresets disponibles : $available`nUtilisez : ./launcher.ps1 <preset>"
    } else {
        Write-LauncherError "Aucun preset configure dans config.json.`nEditez config.json pour ajouter des presets."
    }
    exit 1
}

if (-not $config.presets.ContainsKey($presetName)) {
    $available = ($config.presets.Keys | Sort-Object) -join ', '
    Write-LauncherError "Preset '$presetName' introuvable.`nPresets disponibles : $available"
    exit 1
}

$presetObj = $config.presets[$presetName]

# 6. Resoudre {{auto}}
$hasAuto = $presetObj.panels | Where-Object { $_.project -eq '{{auto}}' }

if ($hasAuto) {
    if ([string]::IsNullOrWhiteSpace($Project)) {
        Write-LauncherError "Le preset '$presetName' contient des panneaux {{auto}}.`nUtilisez : ./launcher.ps1 $presetName -Project <slug>"
        exit 1
    }

    if (-not $config.projects.ContainsKey($Project)) {
        $available = ($config.projects.Keys | Sort-Object) -join ', '
        Write-LauncherError "Projet '$Project' introuvable.`nProjets disponibles : $available"
        exit 1
    }

    $presetObj = Resolve-AutoPanels -Preset $presetObj -ProjectSlug $Project
}

# 7. Resoudre le layout
$layout = $config.layouts[$presetObj.layout]

# 8. Afficher le recap
Show-WorkspacePreview -Preset $presetObj -Projects $config.projects

# 9. Mode WhatIf
if ($WhatIf) {
    try {
        $cmd = Build-WtCommand -Preset $presetObj -Layout $layout -Projects $config.projects
        Write-Host "Commande wt.exe :" -ForegroundColor Yellow
        Write-Host "  $cmd"
        Write-Host ""
        Write-Host "(dry-run, pas de lancement)" -ForegroundColor Yellow
    } catch {
        Write-LogError -Source 'Launcher' -Message "WhatIf failed" -ErrorRecord $_
        Write-LauncherError $_.Exception.Message
        exit 1
    }
    exit 0
}

# 10. Construire, sauvegarder et lancer
try {
    $cmd = Build-WtCommand -Preset $presetObj -Layout $layout -Projects $config.projects

    # Sauvegarder la session juste avant le lancement
    Initialize-SessionManager -SessionDir (Join-Path $PSScriptRoot 'sessions')
    Save-Session -PresetName $presetName -Preset $presetObj -Layout $layout -Projects $config.projects

    # Tracker dans l'historique (HistoryTracker)
    Initialize-HistoryTracker -LogDir (Join-Path $PSScriptRoot 'logs')
    $projectSlugs = @($presetObj.panels | ForEach-Object { $_.project } | Where-Object { $_ -and $_ -ne '{{auto}}' } | Select-Object -Unique)
    $gitBranches = @{}
    foreach ($slug in $projectSlugs) {
        $proj = $config.projects[$slug]
        if ($proj) { $gitBranches[$slug] = Get-GitBranchName -Path $proj.path }
    }
    Add-LaunchEntry -PresetSlug $presetName -ProjectSlugs $projectSlugs -Layout $presetObj.layout -GitBranches $gitBranches

    $wtArgs = $cmd -replace '^wt\.exe\s*', ''
    Start-Process wt.exe -ArgumentList $wtArgs
    Write-LauncherSuccess "Lancement..."
    exit 0
} catch {
    Write-LogError -Source 'Launcher' -Message "Launch failed" -ErrorRecord $_
    Write-LauncherError $_.Exception.Message
    exit 1
}
