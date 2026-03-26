#Requires -Version 7.0
<#
.SYNOPSIS
    Charge, valide et retourne la configuration Claude Launcher.
.DESCRIPTION
    Lit config.json, valide la structure et les references croisees,
    applique les valeurs par defaut, et retourne un objet hashtable.
#>

# Import ConfigSchema
. "$PSScriptRoot\ConfigSchema.ps1"

function Import-LauncherConfig {
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [string]$Path = '.\config.json'
    )

    Write-Log -Level 'INFO' -Source 'Config' -Message "Loading config from $Path"

    # Si le fichier n'existe pas, creer un config par defaut
    if (-not (Test-Path $Path)) {
        Write-Log -Level 'WARN' -Source 'Config' -Message "Config file not found at $Path, creating default"
        Write-Host "Pas de config.json trouve. Creation d'une config par defaut..." -ForegroundColor Yellow
        return New-LauncherConfig -Path $Path
    }

    # Lire et parser le JSON
    $raw = $null
    try {
        $raw = Get-Content -Path $Path -Raw -Encoding UTF8
    } catch {
        Write-Log -Level 'ERROR' -Source 'Config' -Message "Cannot read config file: $Path" -ErrorRecord $_
        throw "Impossible de lire le fichier config : $Path`n$($_.Exception.Message)"
    }

    $config = $null
    try {
        $config = $raw | ConvertFrom-Json -Depth 10 -AsHashtable
    } catch {
        Write-Log -Level 'ERROR' -Source 'Config' -Message "Invalid JSON in $Path" -ErrorRecord $_
        throw "JSON invalide dans $Path`n$($_.Exception.Message)"
    }

    # Valider la version
    $version = $config['version']
    if (-not $version) {
        Write-Log -Level 'ERROR' -Source 'Config' -Message "Missing 'version' field in config.json"
        throw "Champ 'version' manquant dans config.json. Ajoutez : `"version`": `"1.0`""
    }
    if ($version -ne '1.0') {
        Write-Log -Level 'ERROR' -Source 'Config' -Message "Unsupported config version: $version"
        throw "Version de config '$version' non supportee. Version actuelle : 1.0"
    }

    # Appliquer les valeurs par defaut
    $config = Merge-ConfigDefaults -Config $config

    # Valider les projets
    $errors = @()
    $warnings = @()

    foreach ($slug in @($config.projects.Keys)) {
        # Valider le slug
        if ($slug -notmatch '^[a-z0-9]+(-[a-z0-9]+)*$') {
            $errors += "Le slug '$slug' est invalide. Format attendu : kebab-case (ex: 'easy-sap'). Pattern : ^[a-z0-9]+(-[a-z0-9]+)*$"
        }

        $project = $config.projects[$slug]

        # Champs requis
        if (-not $project.ContainsKey('name') -or [string]::IsNullOrWhiteSpace($project.name)) {
            $errors += "projects.$slug.name : champ requis manquant ou vide"
        }
        if (-not $project.ContainsKey('path') -or [string]::IsNullOrWhiteSpace($project.path)) {
            $errors += "projects.$slug.path : champ requis manquant ou vide"
        } else {
            # Valider le chemin Windows absolu
            if ($project.path -notmatch '^[A-Za-z]:[\\\/]') {
                $errors += "projects.$slug.path : '$($project.path)' n'est pas un chemin Windows absolu (doit commencer par X:\)"
            }
            # Verifier l'existence (warning seulement)
            elseif (-not (Test-Path $project.path)) {
                $warnings += "projects.$slug.path : le chemin '$($project.path)' n'existe pas"
            }
        }

        # Valider la couleur
        if ($project.ContainsKey('color') -and $project.color -and $project.color -notmatch '^#[0-9a-fA-F]{6}$') {
            $errors += "projects.$slug.color : '$($project.color)' n'est pas un code couleur valide (format: #rrggbb)"
        }
    }

    # Valider les layouts
    foreach ($slug in @($config.layouts.Keys)) {
        $layout = $config.layouts[$slug]
        if (-not $layout.ContainsKey('splits')) {
            $errors += "layouts.$slug.splits : champ requis manquant"
            continue
        }
        foreach ($split in $layout.splits) {
            if ($split -notmatch '^(H|V)(\([0-9]{1,2}%\))?$' -and $split -notmatch '^focus-[0-9]+$') {
                $errors += "layouts.$slug.splits : '$split' n'est pas un split valide. Formats acceptes : H, V, H(70%), V(30%), focus-N"
            }
        }
    }

    # Valider les presets (references croisees)
    foreach ($slug in @($config.presets.Keys)) {
        $preset = $config.presets[$slug]

        # Champs requis
        if (-not $preset.ContainsKey('name') -or [string]::IsNullOrWhiteSpace($preset.name)) {
            $errors += "presets.$slug.name : champ requis manquant ou vide"
        }
        if (-not $preset.ContainsKey('layout') -or [string]::IsNullOrWhiteSpace($preset.layout)) {
            $errors += "presets.$slug.layout : champ requis manquant ou vide"
        } elseif (-not $config.layouts.ContainsKey($preset.layout)) {
            $availableLayouts = ($config.layouts.Keys | Sort-Object) -join ', '
            $errors += "presets.$slug.layout : le layout '$($preset.layout)' n'existe pas. Layouts disponibles : $availableLayouts"
        }
        if (-not $preset.ContainsKey('panels') -or $preset.panels.Count -eq 0) {
            $errors += "presets.$slug.panels : au moins 1 panneau requis"
        }

        # Valider le nombre de panneaux vs layout
        if ($preset.ContainsKey('layout') -and $config.layouts.ContainsKey($preset.layout) -and $preset.ContainsKey('panels')) {
            $expectedPanels = Get-LayoutPanelCount -Layout $config.layouts[$preset.layout]
            $actualPanels = $preset.panels.Count
            if ($actualPanels -ne $expectedPanels) {
                $errors += "presets.$slug : a $actualPanels panneau(x) mais le layout '$($preset.layout)' en attend $expectedPanels"
            }
        }

        # Valider les references projet dans les panneaux
        if ($preset.ContainsKey('panels')) {
            for ($i = 0; $i -lt $preset.panels.Count; $i++) {
                $panel = $preset.panels[$i]
                if (-not $panel.ContainsKey('project') -or [string]::IsNullOrWhiteSpace($panel.project)) {
                    $errors += "presets.$slug.panels[$i].project : champ requis manquant"
                } elseif ($panel.project -ne '{{auto}}' -and -not $config.projects.ContainsKey($panel.project)) {
                    $errors += "presets.$slug.panels[$i].project : le projet '$($panel.project)' n'existe pas dans la section projects"
                }
            }
        }
    }

    # Valider default_preset
    if ($config.preferences.default_preset -and -not $config.presets.ContainsKey($config.preferences.default_preset)) {
        $errors += "preferences.default_preset : le preset '$($config.preferences.default_preset)' n'existe pas dans la section presets"
    }

    # Afficher les warnings
    foreach ($warning in $warnings) {
        Write-Warning $warning
        Write-Log -Level 'WARN' -Source 'Config' -Message $warning
    }

    # Erreurs bloquantes
    if ($errors.Count -gt 0) {
        $errorMsg = "Erreurs de validation dans config.json :`n"
        foreach ($err in $errors) {
            $errorMsg += "  - $err`n"
        }
        Write-Log -Level 'ERROR' -Source 'Config' -Message "Validation failed: $($errors.Count) errors"
        throw $errorMsg
    }

    Write-Log -Level 'INFO' -Source 'Config' -Message "Config loaded: $($config.projects.Count) projects, $($config.presets.Count) presets"
    return $config
}

function Save-LauncherConfig {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [hashtable]$Config,
        [string]$Path = '.\config.json'
    )

    # S'assurer que $schema et version sont en premier (via ordered)
    $ordered = [ordered]@{}
    if ($Config.ContainsKey('$schema')) { $ordered['$schema'] = $Config['$schema'] }
    $ordered['version'] = $Config['version']
    foreach ($key in $Config.Keys | Where-Object { $_ -notin @('$schema', 'version') } | Sort-Object) {
        $ordered[$key] = $Config[$key]
    }

    $json = $ordered | ConvertTo-Json -Depth 10
    # Ecrire en UTF-8 avec BOM pour compatibilite Windows
    [System.IO.File]::WriteAllText(
        (Resolve-Path $Path -ErrorAction SilentlyContinue)?.Path ?? $Path,
        $json,
        [System.Text.UTF8Encoding]::new($true)
    )
}
