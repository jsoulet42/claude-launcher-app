#Requires -Version 7.0
<#
.SYNOPSIS
    Flow de lancement de preset pour le TUI Claude Launcher.
.DESCRIPTION
    Gere le flow complet : selection preset → resolution {{auto}} → confirmation → lancement.
    Fonctionne via des Dialog modales Terminal.Gui (sous-boucles d'evenements).
#>

function Resolve-PresetAuto {
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [hashtable]$Preset,

        [Parameter(Mandatory)]
        [string]$ProjectSlug
    )

    # Deep-clone via JSON round-trip (les hashtables PS ne se copient pas en profondeur)
    $json = $Preset | ConvertTo-Json -Depth 10
    $clone = $json | ConvertFrom-Json -Depth 10 -AsHashtable

    for ($i = 0; $i -lt $clone.panels.Count; $i++) {
        if ($clone.panels[$i].project -eq '{{auto}}') {
            $clone.panels[$i].project = $ProjectSlug
        }
    }

    return $clone
}

function Select-ProjectForPreset {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [hashtable]$Config,

        [Parameter(Mandatory)]
        [Terminal.Gui.Window]$Window,

        [hashtable]$Themes
    )

    Write-Log -Level 'INFO' -Source 'LaunchFlow' -Message "Opening project selection dialog"

    $projects = $Config.projects
    if (-not $projects -or $projects.Count -eq 0) {
        Write-Log -Level 'WARN' -Source 'LaunchFlow' -Message "No projects configured, cannot select"
        $buttons = [string[]]@("OK")
        [Terminal.Gui.MessageBox]::ErrorQuery("Aucun projet", "`nAucun projet configure dans config.json.`nAjoutez des projets pour utiliser ce preset.", $buttons) | Out-Null
        return $null
    }

    # Construire la liste des projets avec infos git
    $projectArray = [System.Collections.Generic.List[hashtable]]::new()
    $displayLines = [System.Collections.Generic.List[string]]::new()

    $sortedSlugs = $projects.Keys | Sort-Object

    foreach ($slug in $sortedSlugs) {
        $proj = $projects[$slug]
        $gitInfo = Get-ProjectGitInfo -Path $proj.path

        $branchStr = if ($gitInfo.IsGit) {
            $dirty = if ($gitInfo.IsDirty) { " *" } else { "" }
            " ($($gitInfo.Branch)$dirty)"
        } else { "" }

        $projectArray.Add(@{ Slug = $slug; Project = $proj; GitInfo = $gitInfo })
        $displayLines.Add([string]"  $($proj.name)$branchStr")
    }

    Write-Log -Level 'DEBUG' -Source 'LaunchFlow' -Message "Project list: $($projectArray.Count) projects"

    # Creer le Dialog
    $dialogWidth = 50
    $dialogHeight = $projectArray.Count + 6
    if ($dialogHeight -gt 20) { $dialogHeight = 20 }

    $dialog = [Terminal.Gui.Dialog]::new("Choisir un projet", $dialogWidth, $dialogHeight)
    if ($Themes) { $dialog.ColorScheme = $Themes.Base }

    # ListView des projets
    $listView = [Terminal.Gui.ListView]::new()
    $listView.SetSource($displayLines)
    $listView.X = 1
    $listView.Y = 1
    $listView.Width = [Terminal.Gui.Dim]::Fill(1)
    $listView.Height = [Terminal.Gui.Dim]::Fill(3)
    $listView.AllowsMarking = $false
    if ($Themes) { $listView.ColorScheme = $Themes.Sidebar }

    # Hint en bas
    $hintLabel = [Terminal.Gui.Label]::new(" [Entree] Confirmer  [Echap] Annuler")
    $hintLabel.X = 1
    $hintLabel.Y = [Terminal.Gui.Pos]::AnchorEnd(2)
    if ($Themes) { $hintLabel.ColorScheme = $Themes.Footer }

    $dialog.Add($listView)
    $dialog.Add($hintLabel)

    # Etat de selection mutable
    $selectionState = @{ SelectedSlug = $null }

    # Capturer pour closures
    $capturedProjArray = $projectArray.ToArray()
    $capturedLV = $listView
    $capturedDialog = $dialog
    $capturedState = $selectionState
    $capturedLogFn = ${function:Write-Log}

    # Event : Enter sur un projet
    $listView.add_OpenSelectedItem((Protect-EventHandler -Source 'LaunchFlow' -Handler {
        param($sender, $e)
        $idx = [int]$capturedLV.SelectedItem
        if ($idx -lt 0 -or $idx -ge $capturedProjArray.Count) { return }

        $entry = $capturedProjArray[$idx]
        $capturedState.SelectedSlug = $entry.Slug
        & $capturedLogFn -Level 'INFO' -Source 'LaunchFlow' -Message "Project selected: $($entry.Slug)"
        [Terminal.Gui.Application]::RequestStop()
    }.GetNewClosure()))

    # Lancer la sous-boucle modale
    [Terminal.Gui.Application]::Run($dialog)

    if ($selectionState.SelectedSlug) {
        Write-Log -Level 'INFO' -Source 'LaunchFlow' -Message "Project confirmed: $($selectionState.SelectedSlug)"
        return $selectionState.SelectedSlug
    }

    Write-Log -Level 'INFO' -Source 'LaunchFlow' -Message "Project selection cancelled"
    return $null
}

function Show-LaunchConfirmation {
    [CmdletBinding()]
    [OutputType([bool])]
    param(
        [Parameter(Mandatory)]
        [hashtable]$ResolvedPreset,

        [Parameter(Mandatory)]
        [string]$PresetSlug,

        [Parameter(Mandatory)]
        [hashtable]$Config,

        [Parameter(Mandatory)]
        [Terminal.Gui.Window]$Window,

        [hashtable]$Themes,

        [string]$ProjectSlug
    )

    Write-Log -Level 'INFO' -Source 'LaunchFlow' -Message "Showing launch confirmation for preset '$PresetSlug'"

    # Generer la preview ASCII
    $layoutSlug = $ResolvedPreset.layout
    $layout = $Config.layouts[$layoutSlug]
    $asciiPreview = if ($layout) {
        Get-LayoutAsciiPreview -LayoutSlug $layoutSlug -Layout $layout -Panels $ResolvedPreset.panels -Projects $Config.projects
    } else {
        "  (layout '$layoutSlug' introuvable)"
    }

    # Construire le contenu de la modale
    $lines = @()
    $lines += ""
    if ($ProjectSlug) {
        $projName = if ($Config.projects.ContainsKey($ProjectSlug)) { $Config.projects[$ProjectSlug].name } else { $ProjectSlug }
        $lines += "  Projet : $projName"
    }
    $lines += "  Layout : $layoutSlug ($($ResolvedPreset.panels.Count) panneaux)"
    $lines += ""
    $lines += $asciiPreview
    $lines += ""

    $content = $lines -join "`n"
    $title = "Lancer $($ResolvedPreset.name) ?"

    $buttons = [string[]]@("Lancer", "Annuler")
    $result = [Terminal.Gui.MessageBox]::Query($title, $content, $buttons)

    if ($result -eq 0) {
        Write-Log -Level 'INFO' -Source 'LaunchFlow' -Message "Launch confirmed for '$PresetSlug'"
        return $true
    }

    Write-Log -Level 'INFO' -Source 'LaunchFlow' -Message "Launch cancelled for '$PresetSlug'"
    return $false
}

function Invoke-PresetLaunch {
    [CmdletBinding()]
    [OutputType([bool])]
    param(
        [Parameter(Mandatory)]
        [hashtable]$ResolvedPreset,

        [Parameter(Mandatory)]
        [hashtable]$Config
    )

    Write-Log -Level 'INFO' -Source 'LaunchFlow' -Message "Launching preset '$($ResolvedPreset.name)'"

    try {
        # Resoudre le layout
        $layoutSlug = $ResolvedPreset.layout
        $layout = $Config.layouts[$layoutSlug]
        if (-not $layout) {
            Write-Log -Level 'ERROR' -Source 'LaunchFlow' -Message "Layout '$layoutSlug' introuvable dans config.layouts"
            return $false
        }

        # Construire la commande wt.exe
        $cmd = Build-WtCommand -Preset $ResolvedPreset -Layout $layout -Projects $Config.projects
        $wtArgs = $cmd -replace '^wt\.exe\s*', ''

        Write-Log -Level 'DEBUG' -Source 'LaunchFlow' -Message "wt.exe args: $wtArgs"

        # Lancer Windows Terminal
        Start-Process wt.exe -ArgumentList $wtArgs
        Write-Log -Level 'INFO' -Source 'LaunchFlow' -Message "Workspace launched successfully"
        return $true

    } catch {
        Write-Log -Level 'ERROR' -Source 'LaunchFlow' -Message "Launch failed: $($_.Exception.Message)" -ErrorRecord $_
        return $false
    }
}

function Start-LaunchFlow {
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [hashtable]$Config,

        [Parameter(Mandatory)]
        [hashtable]$PresetEntry,

        [Parameter(Mandatory)]
        [Terminal.Gui.Window]$Window,

        [hashtable]$Themes
    )

    $presetSlug = $PresetEntry.Slug
    $preset = $PresetEntry.Preset

    Write-Log -Level 'INFO' -Source 'LaunchFlow' -Message "Starting launch flow for preset '$presetSlug'"

    # Detecter si le preset contient des panneaux {{auto}}
    $hasAuto = $false
    foreach ($panel in $preset.panels) {
        if ($panel.project -eq '{{auto}}') { $hasAuto = $true; break }
    }

    $projectSlug = $null
    $resolvedPreset = $preset

    if ($hasAuto) {
        # Verifier qu'il y a des projets disponibles
        if (-not $Config.projects -or $Config.projects.Count -eq 0) {
            Write-Log -Level 'WARN' -Source 'LaunchFlow' -Message "No projects available for {{auto}} resolution"
            $buttons = [string[]]@("OK")
            [Terminal.Gui.MessageBox]::ErrorQuery("Aucun projet", "`nAucun projet configure.`nAjoutez des projets dans config.json.", $buttons) | Out-Null
            return @{ Action = 'cancelled'; PresetSlug = $presetSlug }
        }

        # Demander a l'utilisateur de choisir un projet
        $projectSlug = Select-ProjectForPreset -Config $Config -Window $Window -Themes $Themes
        if (-not $projectSlug) {
            Write-Log -Level 'INFO' -Source 'LaunchFlow' -Message "Flow cancelled at project selection"
            return @{ Action = 'cancelled'; PresetSlug = $presetSlug }
        }

        # Resoudre {{auto}} avec le projet choisi
        $resolvedPreset = Resolve-PresetAuto -Preset $preset -ProjectSlug $projectSlug
        Write-Log -Level 'INFO' -Source 'LaunchFlow' -Message "Preset resolved: {{auto}} -> '$projectSlug'"
    }

    # Modale de confirmation
    $confirmed = Show-LaunchConfirmation `
        -ResolvedPreset $resolvedPreset `
        -PresetSlug $presetSlug `
        -Config $Config `
        -Window $Window `
        -Themes $Themes `
        -ProjectSlug $projectSlug

    if (-not $confirmed) {
        return @{ Action = 'cancelled'; PresetSlug = $presetSlug }
    }

    # Lancer le workspace
    $success = Invoke-PresetLaunch -ResolvedPreset $resolvedPreset -Config $Config

    if (-not $success) {
        # Afficher une erreur a l'utilisateur
        $buttons = [string[]]@("OK")
        [Terminal.Gui.MessageBox]::ErrorQuery("Erreur", "`nImpossible de lancer le workspace.`nVerifiez que Windows Terminal est installe.`nDetails dans logs/launcher.log.", $buttons) | Out-Null
        return @{ Action = 'error'; PresetSlug = $presetSlug }
    }

    Write-Log -Level 'INFO' -Source 'LaunchFlow' -Message "Flow completed: preset '$presetSlug' launched successfully"
    return @{ Action = 'launched'; PresetSlug = $presetSlug; ProjectSlug = $projectSlug }
}
