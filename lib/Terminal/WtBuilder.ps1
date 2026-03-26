#Requires -Version 7.0
<#
.SYNOPSIS
    Moteur de construction des commandes wt.exe pour Claude Launcher.
.DESCRIPTION
    Traduit un preset (panneaux) + layout (splits) en commande wt.exe complete.
    Ne lance pas la commande — retourne la string prete a etre executee.
#>

# Import ConfigSchema pour Get-LayoutPanelCount
. "$PSScriptRoot\..\Config\ConfigSchema.ps1"

function Protect-WtArgument {
    <#
    .SYNOPSIS
        Echappe une string pour utilisation securisee dans une commande wt.exe.
    .DESCRIPTION
        1. Remplace les guillemets doubles par des backslash-guillemets : " -> \"
        2. Remplace les backticks par des doubles backticks : ` -> ``
        Retourne la string echappee SANS les guillemets englobants.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [string]$Value
    )

    $escaped = $Value -replace '"', '\"'
    $escaped = $escaped -replace '`', '``'
    if ($escaped -ne $Value) {
        Write-Log -Level 'DEBUG' -Source 'WtBuilder' -Message "Escaped WT argument: '$Value' -> '$escaped'"
    }
    return $escaped
}

function Build-WtPanel {
    <#
    .SYNOPSIS
        Construit le fragment de commande wt.exe pour un panneau.
    .DESCRIPTION
        Genere soit le premier panneau (new-tab implicite), soit un split-pane
        selon la presence de SplitDirection.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [hashtable]$Panel,

        [Parameter(Mandatory)]
        [hashtable]$Project,

        [string]$SplitDirection,

        [int]$FocusPane = -1
    )

    $slug = $Panel.project

    # --- Validation des entrees ---

    # Chemin obligatoire
    if ([string]::IsNullOrWhiteSpace($Project.path)) {
        Write-Log -Level 'ERROR' -Source 'WtBuilder' -Message "Invalid panel config: project '$slug' has no path"
        throw "Le projet '$slug' n'a pas de chemin (path) configure"
    }

    # Chemin absolu Windows
    if ($Project.path -notmatch '^[A-Za-z]:\\') {
        Write-Log -Level 'ERROR' -Source 'WtBuilder' -Message "Invalid panel config: project '$slug' path is not absolute: '$($Project.path)'"
        throw "Le projet '$slug' a un chemin invalide : '$($Project.path)'. Un chemin absolu Windows est requis (ex: C:\mon\projet)"
    }

    # Pas de traversal
    if ($Project.path -match '\.\.') {
        Write-Log -Level 'ERROR' -Source 'WtBuilder' -Message "Invalid panel config: project '$slug' path contains '..'"
        throw "Le projet '$slug' contient '..' dans son chemin. Les chemins doivent etre canoniques."
    }

    # --- Resolution de la commande ---
    $command = if ($Panel.ContainsKey('command') -and -not [string]::IsNullOrWhiteSpace($Panel.command)) {
        $Panel.command
    } elseif ($Project.ContainsKey('default_command') -and -not [string]::IsNullOrWhiteSpace($Project.default_command)) {
        $Project.default_command
    } else {
        'claude'
    }

    # --- Resolution de la commande initiale ---
    $initialCommand = $null
    if ($Panel.ContainsKey('initial_command') -and -not [string]::IsNullOrWhiteSpace($Panel.initial_command)) {
        $initialCommand = $Panel.initial_command
    } elseif ($Project.ContainsKey('initial_command') -and -not [string]::IsNullOrWhiteSpace($Project.initial_command)) {
        $initialCommand = $Project.initial_command
    }

    # --- Construction du titre ---
    $projectName = if ($Project.ContainsKey('name') -and -not [string]::IsNullOrWhiteSpace($Project.name)) {
        $Project.name
    } else {
        $slug
    }
    $titleRaw = "$projectName — $command"
    $titleEscaped = Protect-WtArgument -Value $titleRaw

    # --- Normalisation et echappement du chemin (/ -> \) ---
    $normalizedPath = Protect-WtArgument -Value ($Project.path -replace '/', '\')

    # --- Echappement de la commande ---
    $commandEscaped = Protect-WtArgument -Value $command

    # --- Construction du bloc pwsh ---
    if ($initialCommand) {
        $initialEscaped = Protect-WtArgument -Value $initialCommand
        $pwshBlock = "pwsh -NoExit -Command `"$commandEscaped; $initialEscaped`""
    } else {
        $pwshBlock = "pwsh -NoExit -Command `"$commandEscaped`""
    }

    # --- Construction du fragment ---
    if ([string]::IsNullOrWhiteSpace($SplitDirection)) {
        # Premier panneau (new-tab implicite)
        return "--title `"$titleEscaped`" -d `"$normalizedPath`" $pwshBlock"
    }

    # Panneau split — parser la direction et la taille
    $sizeFragment = ''
    $direction = ''

    if ($SplitDirection -match '^([HV])\(([0-9]{1,3})%\)$') {
        $direction = $Matches[1]
        $mainPercent = [int]$Matches[2]
        $newSize = (100 - $mainPercent) / 100.0
        $sizeFragment = "--size $newSize "
    } elseif ($SplitDirection -match '^[HV]$') {
        $direction = $SplitDirection
    } else {
        Write-Log -Level 'ERROR' -Source 'WtBuilder' -Message "Invalid split direction: '$SplitDirection'"
        throw "Le split '$SplitDirection' n'est pas reconnu. Formats acceptes : H, V, H(xx%), V(xx%), focus-N"
    }

    return "split-pane -$direction $sizeFragment--title `"$titleEscaped`" -d `"$normalizedPath`" $pwshBlock"
}

function Build-WtCommand {
    <#
    .SYNOPSIS
        Construit la commande wt.exe complete a partir d'un preset et d'un layout.
    .DESCRIPTION
        Assemble tous les panneaux d'un preset en une seule commande wt.exe
        prete a etre executee via Start-Process.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [hashtable]$Preset,

        [Parameter(Mandatory)]
        [hashtable]$Layout,

        [Parameter(Mandatory)]
        [hashtable]$Projects
    )

    $panels = $Preset.panels
    Write-Log -Level 'INFO' -Source 'WtBuilder' -Message "Building WT command for preset '$($Preset.name)' ($($panels.Count) panels)"

    # --- Validation : {{auto}} non resolu ---
    for ($i = 0; $i -lt $panels.Count; $i++) {
        if ($panels[$i].project -eq '{{auto}}') {
            Write-Log -Level 'ERROR' -Source 'WtBuilder' -Message "Panel $i has unresolved {{auto}}"
            throw "Le panneau $i contient '{{auto}}' non resolu. Le caller doit resoudre les {{auto}} avant d'appeler Build-WtCommand"
        }
    }

    # --- Validation : nombre de panneaux vs layout ---
    $expectedCount = Get-LayoutPanelCount -Layout $Layout
    $actualCount = $panels.Count
    if ($actualCount -ne $expectedCount) {
        Write-Log -Level 'ERROR' -Source 'WtBuilder' -Message "Panel count mismatch: preset has $actualCount, layout expects $expectedCount"
        throw "Le preset attend $actualCount panneaux mais le layout en supporte $expectedCount"
    }

    # --- Validation : tous les projets existent ---
    for ($i = 0; $i -lt $panels.Count; $i++) {
        $slug = $panels[$i].project
        if (-not $Projects.ContainsKey($slug)) {
            Write-Log -Level 'ERROR' -Source 'WtBuilder' -Message "Panel $i references unknown project '$slug'"
            throw "Le panneau $i reference le projet '$slug' qui n'existe pas"
        }
    }

    # --- Construction du premier panneau ---
    $firstPanel = $panels[0]
    $firstProject = $Projects[$firstPanel.project]
    $fragments = @()
    $fragments += Build-WtPanel -Panel $firstPanel -Project $firstProject

    # --- Cas "single" : pas de splits ---
    $splits = if ($Layout.ContainsKey('splits')) { $Layout.splits } else { @() }
    if ($splits.Count -eq 0) {
        return "wt.exe $($fragments[0])"
    }

    # --- Panneaux suivants ---
    $panelIndex = 1  # Le premier panneau est deja traite

    foreach ($split in $splits) {
        if ($split -match '^focus-([0-9]+)$') {
            # Commande focus-pane
            $focusIndex = [int]$Matches[1]
            $fragments += "focus-pane -t $focusIndex"
        } else {
            # Split reel — consommer le panneau suivant
            if ($panelIndex -ge $panels.Count) {
                Write-Log -Level 'ERROR' -Source 'WtBuilder' -Message "No more panels for split '$split' (index $panelIndex >= $($panels.Count))"
                throw "Plus de panneaux disponibles pour le split '$split'"
            }

            $panel = $panels[$panelIndex]
            $project = $Projects[$panel.project]
            $fragment = Build-WtPanel -Panel $panel -Project $project -SplitDirection $split
            $fragments += $fragment
            $panelIndex++
        }
    }

    # --- Assemblage final ---
    $wtCommand = "wt.exe " + ($fragments -join ' ; ')
    Write-Log -Level 'DEBUG' -Source 'WtBuilder' -Message "WT command: $wtCommand"
    return $wtCommand
}
