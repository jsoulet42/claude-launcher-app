#Requires -Version 7.0
<#
.SYNOPSIS
    Widget selection de preset pour la sidebar du TUI Claude Launcher.
.DESCRIPTION
    Affiche les presets configures avec preview ASCII du layout.
    Permet la navigation, le preview dans le body, et le lancement direct via Enter.
#>

function Get-LayoutAsciiPreview {
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [string]$LayoutSlug,

        [Parameter(Mandatory)]
        [hashtable]$Layout,

        [Parameter(Mandatory)]
        [array]$Panels,

        [Parameter(Mandatory)]
        [hashtable]$Projects
    )

    # Resoudre nom + commande pour chaque panneau
    $panelInfos = @()
    foreach ($panel in $Panels) {
        $projSlug = $panel.project
        $projName = if ($projSlug -eq '{{auto}}') {
            '(auto)'
        } elseif ($Projects.ContainsKey($projSlug)) {
            $Projects[$projSlug].name
        } else {
            $projSlug
        }

        # Resolution commande : panel.command → project.default_command → 'claude'
        $cmd = 'claude'
        if ($panel.ContainsKey('command') -and -not [string]::IsNullOrWhiteSpace($panel.command)) {
            $cmd = $panel.command
        } elseif ($projSlug -ne '{{auto}}' -and $Projects.ContainsKey($projSlug)) {
            $proj = $Projects[$projSlug]
            if ($proj.ContainsKey('default_command') -and -not [string]::IsNullOrWhiteSpace($proj.default_command)) {
                $cmd = $proj.default_command
            }
        }

        # Resolution initial_command : panel.initial_command → project.initial_command → null
        $initCmd = $null
        if ($panel.ContainsKey('initial_command') -and -not [string]::IsNullOrWhiteSpace($panel.initial_command)) {
            $initCmd = $panel.initial_command
        } elseif ($projSlug -ne '{{auto}}' -and $Projects.ContainsKey($projSlug)) {
            $proj2 = $Projects[$projSlug]
            if ($proj2.ContainsKey('initial_command') -and -not [string]::IsNullOrWhiteSpace($proj2.initial_command)) {
                $initCmd = $proj2.initial_command
            }
        }

        # Tronquer si trop long
        if ($projName.Length -gt 10) { $projName = $projName.Substring(0, 9) + '.' }
        if ($cmd.Length -gt 10) { $cmd = $cmd.Substring(0, 9) + '.' }
        if ($initCmd -and $initCmd.Length -gt 10) { $initCmd = $initCmd.Substring(0, 9) + '.' }

        $panelInfos += @{ Name = $projName; Cmd = $cmd; InitCmd = $initCmd }
    }

    $count = $panelInfos.Count
    if ($count -eq 0) { return "  (aucun panneau)" }

    # Largeur cellule fixe
    $cellW = 12

    switch -Wildcard ($LayoutSlug) {
        'single' {
            $p = $panelInfos[0]
            $name = $p.Name.PadRight($cellW - 2)
            $cmd  = $p.Cmd.PadRight($cellW - 2)
            $bar  = [string][char]0x2500 * $cellW
            return @(
                "  $([char]0x250C)$bar$([char]0x2510)"
                "  $([char]0x2502) $name $([char]0x2502)"
                "  $([char]0x2502) $cmd $([char]0x2502)"
                "  $([char]0x2514)$bar$([char]0x2518)"
            ) -join "`n"
        }
        'horizontal-*' {
            # N panneaux cote a cote
            $topLine    = "  $([char]0x250C)"
            $nameLine   = "  $([char]0x2502)"
            $cmdLine    = "  $([char]0x2502)"
            $bottomLine = "  $([char]0x2514)"

            for ($i = 0; $i -lt $count; $i++) {
                $p = $panelInfos[$i]
                $name = $p.Name.PadRight($cellW - 2)
                $cmd  = $p.Cmd.PadRight($cellW - 2)
                $bar  = [string][char]0x2500 * $cellW

                if ($i -gt 0) {
                    $topLine    += [char]0x252C
                    $nameLine   += [char]0x2502
                    $cmdLine    += [char]0x2502
                    $bottomLine += [char]0x2534
                }

                $topLine    += $bar
                $nameLine   += " $name "
                $cmdLine    += " $cmd "
                $bottomLine += $bar
            }

            $topLine    += [char]0x2510
            $nameLine   += [char]0x2502
            $cmdLine    += [char]0x2502
            $bottomLine += [char]0x2518

            return @($topLine, $nameLine, $cmdLine, $bottomLine) -join "`n"
        }
        'vertical-*' {
            # Panneaux empiles
            $lines = @()
            for ($i = 0; $i -lt $count; $i++) {
                $p = $panelInfos[$i]
                $name = $p.Name.PadRight($cellW - 2)
                $cmd  = $p.Cmd.PadRight($cellW - 2)
                $bar  = [string][char]0x2500 * $cellW

                if ($i -eq 0) {
                    $lines += "  $([char]0x250C)$bar$([char]0x2510)"
                } else {
                    $lines += "  $([char]0x251C)$bar$([char]0x2524)"
                }
                $lines += "  $([char]0x2502) $name $([char]0x2502)"
                $lines += "  $([char]0x2502) $cmd $([char]0x2502)"
            }
            $bar = [string][char]0x2500 * $cellW
            $lines += "  $([char]0x2514)$bar$([char]0x2518)"
            return $lines -join "`n"
        }
        'grid-2x2' {
            # 2x2 grid
            if ($count -lt 4) {
                while ($panelInfos.Count -lt 4) {
                    $panelInfos += @{ Name = '(vide)'; Cmd = '-' }
                }
            }
            $bar = [string][char]0x2500 * $cellW
            $lines = @()
            # Row 1
            $p0 = $panelInfos[0]; $p1 = $panelInfos[1]
            $lines += "  $([char]0x250C)$bar$([char]0x252C)$bar$([char]0x2510)"
            $lines += "  $([char]0x2502) $($p0.Name.PadRight($cellW-2)) $([char]0x2502) $($p1.Name.PadRight($cellW-2)) $([char]0x2502)"
            $lines += "  $([char]0x2502) $($p0.Cmd.PadRight($cellW-2)) $([char]0x2502) $($p1.Cmd.PadRight($cellW-2)) $([char]0x2502)"
            $lines += "  $([char]0x251C)$bar$([char]0x253C)$bar$([char]0x2524)"
            # Row 2
            $p2 = $panelInfos[2]; $p3 = $panelInfos[3]
            $lines += "  $([char]0x2502) $($p2.Name.PadRight($cellW-2)) $([char]0x2502) $($p3.Name.PadRight($cellW-2)) $([char]0x2502)"
            $lines += "  $([char]0x2502) $($p2.Cmd.PadRight($cellW-2)) $([char]0x2502) $($p3.Cmd.PadRight($cellW-2)) $([char]0x2502)"
            $lines += "  $([char]0x2514)$bar$([char]0x2534)$bar$([char]0x2518)"
            return $lines -join "`n"
        }
        'main-plus-sidebar' {
            # 70% principal + 30% sidebar
            $bigW = 18
            $smallW = $cellW
            $bigBar = [string][char]0x2500 * $bigW
            $smallBar = [string][char]0x2500 * $smallW

            $p0 = if ($count -ge 1) { $panelInfos[0] } else { @{ Name = '(vide)'; Cmd = '-' } }
            $p1 = if ($count -ge 2) { $panelInfos[1] } else { @{ Name = '(vide)'; Cmd = '-' } }

            $lines = @()
            $lines += "  $([char]0x250C)$bigBar$([char]0x252C)$smallBar$([char]0x2510)"
            $lines += "  $([char]0x2502) $($p0.Name.PadRight($bigW-2)) $([char]0x2502) $($p1.Name.PadRight($smallW-2)) $([char]0x2502)"
            $lines += "  $([char]0x2502) $($p0.Cmd.PadRight($bigW-2)) $([char]0x2502) $($p1.Cmd.PadRight($smallW-2)) $([char]0x2502)"
            $lines += "  $([char]0x2514)$bigBar$([char]0x2534)$smallBar$([char]0x2518)"
            return $lines -join "`n"
        }
        'main-plus-stack' {
            # 70% principal a gauche + 2 panneaux empiles a droite (30%)
            $bigW = 18
            $smallW = $cellW
            $bigBar = [string][char]0x2500 * $bigW
            $smallBar = [string][char]0x2500 * $smallW

            $p0 = if ($count -ge 1) { $panelInfos[0] } else { @{ Name = '(vide)'; Cmd = '-' } }
            $p1 = if ($count -ge 2) { $panelInfos[1] } else { @{ Name = '(vide)'; Cmd = '-' } }
            $p2 = if ($count -ge 3) { $panelInfos[2] } else { @{ Name = '(vide)'; Cmd = '-' } }

            $lines = @()
            $lines += "  $([char]0x250C)$bigBar$([char]0x252C)$smallBar$([char]0x2510)"
            $lines += "  $([char]0x2502) $($p0.Name.PadRight($bigW-2)) $([char]0x2502) $($p1.Name.PadRight($smallW-2)) $([char]0x2502)"
            $lines += "  $([char]0x2502) $($p0.Cmd.PadRight($bigW-2)) $([char]0x2502) $($p1.Cmd.PadRight($smallW-2)) $([char]0x2502)"
            $lines += "  $([char]0x2502) $(' ' * ($bigW-2)) $([char]0x251C)$smallBar$([char]0x2524)"
            $lines += "  $([char]0x2502) $(' ' * ($bigW-2)) $([char]0x2502) $($p2.Name.PadRight($smallW-2)) $([char]0x2502)"
            $lines += "  $([char]0x2502) $(' ' * ($bigW-2)) $([char]0x2502) $($p2.Cmd.PadRight($smallW-2)) $([char]0x2502)"
            $lines += "  $([char]0x2514)$bigBar$([char]0x2534)$smallBar$([char]0x2518)"
            return $lines -join "`n"
        }
        default {
            # Layout inconnu — afficher les panneaux en liste simple
            $lines = @("  Layout: $LayoutSlug")
            for ($i = 0; $i -lt $count; $i++) {
                $p = $panelInfos[$i]
                $lines += "  [$($i+1)] $($p.Name) $([char]0x2192) $($p.Cmd)"
            }
            return $lines -join "`n"
        }
    }
}

function Update-PresetPreview {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [Terminal.Gui.View]$BodyView,

        [Parameter(Mandatory)]
        [hashtable]$Preset,

        [Parameter(Mandatory)]
        [string]$Slug,

        [Parameter(Mandatory)]
        [hashtable]$Config,

        [hashtable]$Themes,

        [array]$Suggestions
    )

    $BodyView.RemoveAll()

    $panelCount = $Preset.panels.Count
    $layoutSlug = $Preset.layout
    $layout = $Config.layouts[$layoutSlug]

    # Titre
    $titleLabel = [Terminal.Gui.Label]::new("  $($Preset.name)")
    $titleLabel.X = 0
    $titleLabel.Y = 1
    if ($Themes) { $titleLabel.ColorScheme = $Themes.Base }
    $BodyView.Add($titleLabel)

    # Separateur
    $sep = "  " + ([string][char]0x2550 * 30)
    $sepLabel = [Terminal.Gui.Label]::new($sep)
    $sepLabel.X = 0
    $sepLabel.Y = 2
    $BodyView.Add($sepLabel)

    # Infos
    $infoLines = @()
    $infoLines += "  Layout: $layoutSlug ($panelCount panneaux)"
    if ($Preset.ContainsKey('description') -and $Preset.description) {
        $infoLines += "  Description: $($Preset.description)"
    }

    # Detecter {{auto}}
    $hasAuto = $false
    foreach ($panel in $Preset.panels) {
        if ($panel.project -eq '{{auto}}') { $hasAuto = $true; break }
    }
    if ($hasAuto) {
        $infoLines += "  $([char]0x26A0) Contient des projets (auto)"
    }

    $infoLabel = [Terminal.Gui.Label]::new(($infoLines -join "`n"))
    $infoLabel.X = 0
    $infoLabel.Y = 4
    $BodyView.Add($infoLabel)

    # Schema ASCII
    if ($layout) {
        $ascii = Get-LayoutAsciiPreview -LayoutSlug $layoutSlug -Layout $layout -Panels $Preset.panels -Projects $Config.projects
        $asciiLabel = [Terminal.Gui.Label]::new($ascii)
        $asciiLabel.X = 0
        $asciiLabel.Y = 4 + $infoLines.Count + 1
        $BodyView.Add($asciiLabel)

        # Afficher les commandes initiales si presentes
        $initCmdY = 4 + $infoLines.Count + 1 + ($ascii -split "`n").Count + 1
        $initCmdLines = @()
        for ($i = 0; $i -lt $Preset.panels.Count; $i++) {
            $panel = $Preset.panels[$i]
            $projSlug = $panel.project
            $initCmd = $null
            if ($panel.ContainsKey('initial_command') -and -not [string]::IsNullOrWhiteSpace($panel.initial_command)) {
                $initCmd = $panel.initial_command
            } elseif ($projSlug -ne '{{auto}}' -and $Config.projects.ContainsKey($projSlug)) {
                $proj = $Config.projects[$projSlug]
                if ($proj.ContainsKey('initial_command') -and -not [string]::IsNullOrWhiteSpace($proj.initial_command)) {
                    $initCmd = $proj.initial_command
                }
            }
            if ($initCmd) {
                $pName = if ($projSlug -ne '{{auto}}' -and $Config.projects.ContainsKey($projSlug)) { $Config.projects[$projSlug].name } else { $projSlug }
                $initCmdLines += "  $pName $([char]0x2192) then: $initCmd"
            }
        }
        if ($initCmdLines.Count -gt 0) {
            $initCmdText = ($initCmdLines -join "`n")
            $initCmdLabel = [Terminal.Gui.Label]::new($initCmdText)
            $initCmdLabel.X = 0
            $initCmdLabel.Y = $initCmdY
            $BodyView.Add($initCmdLabel)
            $initCmdY += $initCmdLines.Count + 1
        }

        # Hint lancement
        $hintY = $initCmdY
        $hintText = if ($hasAuto) {
            "  [Enter] Lancer (choix du projet requis)"
        } else {
            "  [Enter] Lancer ce preset"
        }
        $hintLabel = [Terminal.Gui.Label]::new($hintText)
        $hintLabel.X = 0
        $hintLabel.Y = $hintY
        $BodyView.Add($hintLabel)

        # Afficher le score de suggestion si disponible
        if ($Suggestions) {
            $suggestion = $Suggestions | Where-Object { $_.Slug -eq $Slug } | Select-Object -First 1
            if ($suggestion -and $suggestion.Score -gt 0) {
                $b = $suggestion.Breakdown
                $suggestionLines = @()
                $suggestionLines += "  $([string][char]0x2500 * 20) Suggestion $([string][char]0x2500 * 20)"
                $suggestionLines += "  Score : $($suggestion.Score)/100 (freq:$($b.Frequency) rec:$($b.Recency) heure:$($b.TimeOfDay) git:$($b.GitContext))"
                $suggestionLines += "  Raison : $($suggestion.Reason)"

                $suggestionLabel = [Terminal.Gui.Label]::new(($suggestionLines -join "`n"))
                $suggestionLabel.X = 0
                $suggestionLabel.Y = $hintY + 2
                $BodyView.Add($suggestionLabel)
            }
        }
    }

    $BodyView.SetNeedsDisplay()
}

function New-PresetSelectorView {
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [hashtable]$Config,

        [Parameter(Mandatory)]
        [Terminal.Gui.View]$BodyView,

        [hashtable]$Themes,

        [hashtable]$GitContext
    )

    # Filtrer les presets valides
    $presetsArray = [System.Collections.Generic.List[hashtable]]::new()
    $displayLines = [System.Collections.Generic.List[string]]::new()
    $invalidCount = 0

    if (-not $Config.presets -or $Config.presets.Count -eq 0) {
        Write-Log -Level 'WARN' -Source 'PresetSelector' -Message "Aucun preset configure"
        $displayLines.Add([string]"(Aucun preset configure)")
        $listView = [Terminal.Gui.ListView]::new()
        $listView.SetSource($displayLines)
        $listView.X = 0; $listView.Y = 0
        $listView.Width = [Terminal.Gui.Dim]::Fill()
        $listView.Height = [Terminal.Gui.Dim]::Fill()
        $listView.AllowsMarking = $false
        if ($Themes) { $listView.ColorScheme = $Themes.Sidebar }
        return @{ ListView = $listView; Presets = @(); Suggestions = @() }
    }

    # Obtenir les suggestions intelligentes
    $suggestions = Get-PresetSuggestions -Config $Config -GitContext $GitContext

    # Construire un lookup slug → suggestion
    $suggestionMap = @{}
    foreach ($s in $suggestions) {
        $suggestionMap[$s.Slug] = $s
    }

    # Trier par score (ordre des suggestions)
    $sortedSlugs = @($suggestions | ForEach-Object { $_.Slug })

    # Ajouter les presets non-scores (nouveaux presets pas encore dans l'historique)
    foreach ($slug in $Config.presets.Keys) {
        if ($slug -notin $sortedSlugs) {
            $sortedSlugs += $slug
        }
    }

    foreach ($slug in $sortedSlugs) {
        $preset = $Config.presets[$slug]
        if (-not $preset) { continue }

        # Valider le layout
        if (-not $Config.layouts.ContainsKey($preset.layout)) {
            Write-Log -Level 'WARN' -Source 'PresetSelector' -Message "Preset '$slug' ignore: layout '$($preset.layout)' inexistant"
            $invalidCount++
            continue
        }

        # Valider les projets des panneaux
        $valid = $true
        foreach ($panel in $preset.panels) {
            if ($panel.project -ne '{{auto}}' -and -not $Config.projects.ContainsKey($panel.project)) {
                Write-Log -Level 'WARN' -Source 'PresetSelector' -Message "Preset '$slug' ignore: projet '$($panel.project)' introuvable"
                $valid = $false
                $invalidCount++
                break
            }
        }
        if (-not $valid) { continue }

        $presetsArray.Add(@{
            Slug   = $slug
            Preset = $preset
        })

        # Ligne d'affichage avec badge suggestion
        $suggestion = $suggestionMap[$slug]
        $prefix = if ($suggestion -and $suggestion.IsSuggested) { "$([char]0x2605) " } else { '  ' }
        $suffix = if ($suggestion -and $suggestion.IsSuggested) { ' [Suggere]' } else { '' }
        $displayLines.Add([string]"$prefix$($preset.name) ($($preset.panels.Count))$suffix")
    }

    Write-Log -Level 'INFO' -Source 'PresetSelector' -Message "PresetSelector: $($presetsArray.Count) presets charges, $invalidCount invalides ignores"

    # Cas tous invalides
    if ($presetsArray.Count -eq 0) {
        Write-Log -Level 'WARN' -Source 'PresetSelector' -Message "Aucun preset valide trouve"
        $displayLines.Clear()
        $displayLines.Add([string]"(Aucun preset valide)")
        $listView = [Terminal.Gui.ListView]::new()
        $listView.SetSource($displayLines)
        $listView.X = 0; $listView.Y = 0
        $listView.Width = [Terminal.Gui.Dim]::Fill()
        $listView.Height = [Terminal.Gui.Dim]::Fill()
        $listView.AllowsMarking = $false
        if ($Themes) { $listView.ColorScheme = $Themes.Sidebar }
        return @{ ListView = $listView; Presets = @() }
    }

    # Creer le ListView
    $listView = [Terminal.Gui.ListView]::new()
    $listView.SetSource($displayLines)
    $listView.X = 0
    $listView.Y = 0
    $listView.Width = [Terminal.Gui.Dim]::Fill()
    $listView.Height = [Terminal.Gui.Dim]::Fill()
    $listView.AllowsMarking = $false
    if ($Themes) { $listView.ColorScheme = $Themes.Sidebar }

    # Capturer variables pour closures
    $capturedBody = $BodyView
    $capturedPresetsArray = $presetsArray.ToArray()
    $capturedConfig = $Config
    $capturedLV = $listView
    $capturedThemes = $Themes
    $capturedSuggestions = $suggestions
    $capturedLogFn = ${function:Write-Log}
    $capturedUpdateFn = ${function:Update-PresetPreview}
    $capturedLaunchFlowFn = ${function:Start-LaunchFlow}

    # Scriptblock pour mettre a jour le preview dans le body
    $updateBody = {
        $idx = [int]$capturedLV.SelectedItem
        if ($idx -lt 0 -or $idx -ge $capturedPresetsArray.Count) { return }

        $entry = $capturedPresetsArray[$idx]
        & $capturedLogFn -Level 'DEBUG' -Source 'PresetSelector' -Message "Selected: $($entry.Slug)"
        & $capturedUpdateFn -BodyView $capturedBody -Preset $entry.Preset -Slug $entry.Slug -Config $capturedConfig -Themes $capturedThemes -Suggestions $capturedSuggestions
    }.GetNewClosure()

    # Event : changement de selection → update preview
    $listView.add_SelectedItemChanged((Protect-EventHandler -Source 'PresetSelector' -Handler {
        param($sender, $e)
        & $updateBody
    }.GetNewClosure()))

    # Capturer la fenetre pour le launch flow (sera set par New-TuiLayout via SetWindow)
    $capturedWindowRef = @{ Window = $null }

    # Event : Enter → lancer le preset via LaunchFlow
    $listView.add_OpenSelectedItem((Protect-EventHandler -Source 'PresetSelector' -Handler {
        param($sender, $e)
        $idx = [int]$capturedLV.SelectedItem
        if ($idx -lt 0 -or $idx -ge $capturedPresetsArray.Count) {
            & $capturedLogFn -Level 'DEBUG' -Source 'PresetSelector' -Message "Enter pressed on empty list"
            return
        }

        $entry = $capturedPresetsArray[$idx]
        & $capturedLogFn -Level 'INFO' -Source 'PresetSelector' -Message "Enter on preset '$($entry.Slug)', launching flow"

        # Appeler Start-LaunchFlow via modale (sous-boucle Terminal.Gui)
        $window = $capturedWindowRef.Window
        if (-not $window) {
            & $capturedLogFn -Level 'ERROR' -Source 'PresetSelector' -Message "Window reference not set, cannot launch flow"
            return
        }

        $result = & $capturedLaunchFlowFn -Config $capturedConfig -PresetEntry $entry -Window $window -Themes $capturedThemes
        & $capturedLogFn -Level 'INFO' -Source 'PresetSelector' -Message "Launch flow result: $($result.Action)"

        # Forcer un refresh de Terminal.Gui apres le lancement pour re-stabiliser la boucle d'events
        # Sans ca, le retour apres wt.exe peut corrompre l'etat du terminal
        try { [Terminal.Gui.Application]::Top.SetNeedsDisplay() } catch {}
    }.GetNewClosure()))

    return @{
        ListView    = $listView
        Presets     = $capturedPresetsArray
        WindowRef   = $capturedWindowRef
        Suggestions = $suggestions
    }
}
