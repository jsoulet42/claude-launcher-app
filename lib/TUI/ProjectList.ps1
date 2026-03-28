#Requires -Version 7.0
<#
.SYNOPSIS
    Widget liste des projets pour la sidebar du TUI Claude Launcher.
.DESCRIPTION
    Affiche les projets configures avec infos git (branche, status).
    Permet la navigation et la selection pour afficher les details dans le body.
#>

# Get-ProjectGitInfo est fourni par lib/Git/GitInfo.ps1 (charge par launcher.ps1)

function New-ProjectListView {
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [hashtable]$Config,
        [Parameter(Mandatory)]
        [Terminal.Gui.View]$BodyView,
        [hashtable]$Themes
    )

    if (-not $Config.projects -or $Config.projects.Count -eq 0) {
        $label = [Terminal.Gui.Label]::new("(aucun projet configure)")
        $label.X = 1
        $label.Y = 1
        return @{ ListView = $label; Projects = @() }
    }

    # Construire le tableau de projets trie par slug
    $projectsArray = [System.Collections.Generic.List[hashtable]]::new()
    $displayLines = [System.Collections.Generic.List[string]]::new()

    foreach ($slug in $Config.projects.Keys | Sort-Object) {
        $project = $Config.projects[$slug]
        $gitInfo = Get-ProjectGitInfo -Path $project.path

        $projectsArray.Add(@{
            Slug    = $slug
            Project = $project
            GitInfo = $gitInfo
        })

        if (-not $gitInfo.Exists) {
            $displayLines.Add([string]"$([char]0x26A0) $($project.name) (introuvable)")
        } elseif ($gitInfo.IsGit) {
            $statusChar = if ($gitInfo.IsDirty) { "$([char]0x2726) $($gitInfo.DirtyCount)" } else { [string][char]0x2713 }
            $displayLines.Add([string]"$([char]0x25CF) $($project.name)  $($gitInfo.Branch) $statusChar")
        } else {
            $displayLines.Add([string]"$([char]0x25CF) $($project.name)")
        }
    }

    # Creer le ListView
    $listView = [Terminal.Gui.ListView]::new()
    $listView.SetSource($displayLines)
    $listView.X = 0
    $listView.Y = 0
    $listView.Width = [Terminal.Gui.Dim]::Fill()
    $listView.Height = [Terminal.Gui.Dim]::Fill()
    $listView.AllowsMarking = $false

    if ($Themes) {
        $listView.ColorScheme = $Themes.Sidebar
    }

    # Variables capturees pour les closures
    # IMPORTANT : capturer Write-Log car les fonctions ne sont PAS visibles
    # depuis les scriptblocks .GetNewClosure() dans les event handlers Terminal.Gui
    $capturedBody = $BodyView
    $capturedProjArray = $projectsArray.ToArray()
    $capturedConfig = $Config
    $capturedLV = $listView
    $capturedLogFn = ${function:Write-Log}

    # Scriptblock inline pour mettre a jour le body
    # GetNewClosure() capture les variables locales du scope courant
    $updateBody = {
        $idx = [int]$capturedLV.SelectedItem
        if ($idx -lt 0 -or $idx -ge $capturedProjArray.Count) { return }

        $entry = $capturedProjArray[$idx]
        $proj = $entry.Project
        $gi = $entry.GitInfo
        $slug = $entry.Slug

        & $capturedLogFn -Level 'DEBUG' -Source 'ProjectList' -Message "Selected: $($proj.name)"

        $capturedBody.RemoveAll()

        $titleLabel = [Terminal.Gui.Label]::new("  $($proj.name)")
        $titleLabel.X = 0
        $titleLabel.Y = 1
        $capturedBody.Add($titleLabel)

        $lines = [System.Collections.Generic.List[string]]::new()
        $lines.Add("  Chemin   : $($proj.path)")
        $lines.Add("  Commande : $($proj.default_command)")

        if (-not $gi.Exists) {
            $lines.Add("")
            $lines.Add("  $([char]0x26A0) Chemin introuvable")
        } elseif ($gi.IsGit) {
            $lines.Add("  Branche  : $($gi.Branch)")
            if ($gi.IsDirty) {
                $lines.Add("  Status   : $($gi.DirtyCount) fichier(s) modifie(s)")
            } else {
                $lines.Add("  Status   : Propre")
            }
        }

        $infoLabel = [Terminal.Gui.Label]::new(($lines -join "`n"))
        $infoLabel.X = 0
        $infoLabel.Y = 3
        $capturedBody.Add($infoLabel)

        # Presets
        $presetLines = [System.Collections.Generic.List[string]]::new()
        foreach ($pKey in $capturedConfig.presets.Keys | Sort-Object) {
            $p = $capturedConfig.presets[$pKey]
            if ($p.panels) {
                foreach ($panel in $p.panels) {
                    if ($panel.project -eq $slug -or $panel.project -eq '{{auto}}') {
                        $desc = if ($p.description) { " ($($p.description))" } else { '' }
                        $presetLines.Add("    - $($p.name)$desc")
                        break
                    }
                }
            }
        }

        if ($presetLines.Count -gt 0) {
            $pY = 3 + $lines.Count + 2
            $ph = [Terminal.Gui.Label]::new("  Presets disponibles :")
            $ph.X = 0
            $ph.Y = $pY
            $capturedBody.Add($ph)

            $pl = [Terminal.Gui.Label]::new(($presetLines -join "`n"))
            $pl.X = 0
            $pl.Y = $pY + 1
            $capturedBody.Add($pl)
        }

        $capturedBody.SetNeedsDisplay()
    }.GetNewClosure()

    $listView.add_SelectedItemChanged((Protect-EventHandler -Source 'ProjectList' -Handler {
        param($sender, $e)
        & $updateBody
    }.GetNewClosure()))

    $listView.add_OpenSelectedItem((Protect-EventHandler -Source 'ProjectList' -Handler {
        param($sender, $e)
        & $updateBody
    }.GetNewClosure()))

    return @{
        ListView = $listView
        Projects = $capturedProjArray
    }
}
