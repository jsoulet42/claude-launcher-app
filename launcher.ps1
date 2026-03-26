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
#>

param(
    [Parameter(Position = 0)]
    [string]$Preset,

    [string]$Project,

    [string]$ConfigPath = '.\config.json',

    [switch]$WhatIf,

    [switch]$Init
)

# --- Imports ---
. "$PSScriptRoot\lib\Config\ConfigSchema.ps1"
. "$PSScriptRoot\lib\Config\ConfigLoader.ps1"
. "$PSScriptRoot\lib\Terminal\WtBuilder.ps1"

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

        $index = $i + 1
        $name = $proj.name.PadRight(12)
        Write-Host "  [$index] $name | $($cmd.PadRight(10)) | $path"
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

# 0. Mode Init (avant chargement config)
if ($Init) {
    try {
        $null = New-LauncherConfig -Path $ConfigPath
        Write-Host "Editez ce fichier pour ajouter vos projets et presets."
        exit 0
    } catch {
        Write-LauncherError $_.Exception.Message
        exit 1
    }
}

# 1. Charger config
$config = $null
try {
    $config = Import-LauncherConfig -Path $ConfigPath
} catch {
    Write-LauncherError $_.Exception.Message
    exit 1
}

# 2. Mode TUI
if ($Preset -eq 'tui') {
    . "$PSScriptRoot\lib\TUI\DepsManager.ps1"
    . "$PSScriptRoot\lib\TUI\Theme.ps1"
    . "$PSScriptRoot\lib\TUI\ProjectList.ps1"
    . "$PSScriptRoot\lib\TUI\App.ps1"
    Start-LauncherTui -Config $config
    exit 0
}

# 3. Resoudre le preset
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

# 4. Resoudre {{auto}}
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

# 5. Resoudre le layout
$layout = $config.layouts[$presetObj.layout]

# 6. Afficher le recap
Show-WorkspacePreview -Preset $presetObj -Projects $config.projects

# 7. Mode WhatIf
if ($WhatIf) {
    try {
        $cmd = Build-WtCommand -Preset $presetObj -Layout $layout -Projects $config.projects
        Write-Host "Commande wt.exe :" -ForegroundColor Yellow
        Write-Host "  $cmd"
        Write-Host ""
        Write-Host "(dry-run, pas de lancement)" -ForegroundColor Yellow
    } catch {
        Write-LauncherError $_.Exception.Message
        exit 1
    }
    exit 0
}

# 8. Construire et lancer
try {
    $cmd = Build-WtCommand -Preset $presetObj -Layout $layout -Projects $config.projects
    $wtArgs = $cmd -replace '^wt\.exe\s*', ''
    Start-Process wt.exe -ArgumentList $wtArgs
    Write-LauncherSuccess "Lancement..."
    exit 0
} catch {
    Write-LauncherError $_.Exception.Message
    exit 1
}
