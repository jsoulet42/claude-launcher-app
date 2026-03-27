#Requires -Version 7.0
<#
.SYNOPSIS
    Schema et valeurs par defaut pour le config.json de Claude Launcher.
.DESCRIPTION
    Fournit les layouts pre-definis, la creation de config initiale,
    et la fusion de valeurs par defaut.
#>

function Get-DefaultLayouts {
    [CmdletBinding()]
    [OutputType([hashtable])]
    param()

    return @{
        'single' = @{ splits = @() }
        'horizontal-2' = @{ splits = @('H') }
        'horizontal-3' = @{ splits = @('H', 'H') }
        'vertical-2' = @{ splits = @('V') }
        'grid-2x2' = @{ splits = @('H', 'focus-0', 'V', 'focus-1', 'V') }
        'main-plus-sidebar' = @{ splits = @('V(60%)') }
        'main-plus-stack' = @{ splits = @('V(60%)', 'H') }
    }
}

function Get-DefaultPreferences {
    [CmdletBinding()]
    [OutputType([hashtable])]
    param()

    return @{
        theme = 'dark'
        default_preset = $null
        auto_discover_projects = $false
        scan_directories = @()
        daemon = @{
            enabled = $true
            watch_interval_ms = 5000
            notify_on_wait = $true
        }
    }
}

function New-LauncherConfig {
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [string]$Path = '.\config.json'
    )

    $config = @{
        '$schema' = './config-schema.json'
        version = '1.0'
        preferences = Get-DefaultPreferences
        projects = @{}
        presets = @{}
        layouts = Get-DefaultLayouts
    }

    Save-LauncherConfig -Config $config -Path $Path
    Write-Host "Config creee : $Path" -ForegroundColor Green

    return $config
}

function Merge-ConfigDefaults {
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [hashtable]$Config
    )

    # Version
    if (-not $Config.ContainsKey('version')) {
        $Config.version = '1.0'
    }

    # Preferences
    $defaultPrefs = Get-DefaultPreferences
    if (-not $Config.ContainsKey('preferences')) {
        $Config.preferences = $defaultPrefs
    } else {
        foreach ($key in $defaultPrefs.Keys) {
            if (-not $Config.preferences.ContainsKey($key)) {
                $Config.preferences[$key] = $defaultPrefs[$key]
            }
        }
        # Valider enum theme
        $validThemes = @('dark', 'light', 'custom')
        if ($Config.preferences.ContainsKey('theme') -and $Config.preferences.theme -notin $validThemes) {
            $themeMsg = "Theme '$($Config.preferences.theme)' invalide. Valeurs acceptees : $($validThemes -join ', '). Utilisation de 'dark' par defaut."
            Write-Warning $themeMsg
            Write-Log -Level 'WARN' -Source 'ConfigSchema' -Message $themeMsg
            $Config.preferences.theme = 'dark'
        }
        # Daemon sub-object
        if ($Config.preferences.ContainsKey('daemon') -and $Config.preferences.daemon -is [hashtable]) {
            $defaultDaemon = $defaultPrefs.daemon
            foreach ($key in $defaultDaemon.Keys) {
                if (-not $Config.preferences.daemon.ContainsKey($key)) {
                    $Config.preferences.daemon[$key] = $defaultDaemon[$key]
                }
            }
        }
    }

    # Projects (no defaults needed, just ensure the key exists)
    if (-not $Config.ContainsKey('projects')) {
        $Config.projects = @{}
    }

    # Presets
    if (-not $Config.ContainsKey('presets')) {
        $Config.presets = @{}
    }

    # Layouts — merge with defaults (user layouts override, but defaults fill gaps)
    $defaultLayouts = Get-DefaultLayouts
    if (-not $Config.ContainsKey('layouts')) {
        $Config.layouts = $defaultLayouts
    } else {
        foreach ($key in $defaultLayouts.Keys) {
            if (-not $Config.layouts.ContainsKey($key)) {
                $Config.layouts[$key] = $defaultLayouts[$key]
            }
        }
    }

    # Per-project defaults
    foreach ($slug in @($Config.projects.Keys)) {
        $project = $Config.projects[$slug]
        if (-not $project.ContainsKey('color')) { $project.color = '#808080' }
        if (-not $project.ContainsKey('icon')) { $project.icon = [char]::ConvertFromUtf32(0x1F4C1) }
        if (-not $project.ContainsKey('default_command')) { $project.default_command = 'claude' }
        if (-not $project.ContainsKey('initial_command')) { $project.initial_command = $null }
    }

    return $Config
}

function Get-LayoutPanelCount {
    [CmdletBinding()]
    [OutputType([int])]
    param(
        [Parameter(Mandatory)]
        [hashtable]$Layout
    )

    $splits = $Layout.splits
    # Count only actual splits (H, V, H(xx%), V(xx%)), not focus-N commands
    $splitCount = ($splits | Where-Object { $_ -notmatch '^focus-' }).Count
    return $splitCount + 1
}
