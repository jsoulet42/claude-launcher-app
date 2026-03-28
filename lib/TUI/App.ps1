#Requires -Version 7.0
<#
.SYNOPSIS
    Application TUI principale de Claude Launcher.
.DESCRIPTION
    Point d'entree du TUI Terminal.Gui : fenetre principale, layout 4 zones,
    keybindings et boucle d'evenements.
#>

function New-TuiLayout {
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [hashtable]$Themes,
        [hashtable]$Config
    )

    # --- Fenetre racine (sans bordure pour un look moderne) ---
    $window = [Terminal.Gui.Window]::new()
    $window.Title = ""
    $window.X = 0
    $window.Y = 0
    $window.Width = [Terminal.Gui.Dim]::Fill()
    $window.Height = [Terminal.Gui.Dim]::Fill()
    $window.Border.BorderStyle = [Terminal.Gui.BorderStyle]::None
    if ($Themes) {
        $window.ColorScheme = $Themes.Base
    }

    # --- Header (View simple sans cadre, fond colore) ---
    $header = [Terminal.Gui.View]::new()
    $header.X = 0
    $header.Y = 0
    $header.Width = [Terminal.Gui.Dim]::Fill()
    $header.Height = 1
    if ($Themes) {
        $header.ColorScheme = $Themes.Header
    }

    $headerLabel = [Terminal.Gui.Label]::new(" Claude Launcher v0.2")
    $headerLabel.X = 0
    $headerLabel.Y = 0
    $headerLabel.Width = [Terminal.Gui.Dim]::Fill()
    if ($Themes) {
        $headerLabel.ColorScheme = $Themes.Header
    }
    $header.Add($headerLabel)

    # --- Sidebar (FrameView avec cadre fin) ---
    $sidebar = [Terminal.Gui.FrameView]::new(" Projets ")
    $sidebar.X = 0
    $sidebar.Y = 1
    $sidebar.Width = [Terminal.Gui.Dim]::Percent(20)
    $sidebar.Height = [Terminal.Gui.Dim]::Fill(1)
    if ($Themes) {
        $sidebar.ColorScheme = $Themes.Sidebar
    }

    # --- Body (View sans cadre — zone principale ouverte) ---
    # Cree avant le contenu sidebar car ProjectListView a besoin de $body
    $body = [Terminal.Gui.View]::new()
    $body.X = [Terminal.Gui.Pos]::Right($sidebar)
    $body.Y = 1
    $body.Width = [Terminal.Gui.Dim]::Fill()
    $body.Height = [Terminal.Gui.Dim]::Fill(1)
    if ($Themes) {
        $body.ColorScheme = $Themes.Base
    }

    $bodyText = @"
  Bienvenue dans Claude Launcher

  Selectionnez un projet dans la sidebar
  ou appuyez sur ? pour voir les raccourcis.
"@
    $bodyLabel = [Terminal.Gui.Label]::new($bodyText)
    $bodyLabel.X = 2
    $bodyLabel.Y = 2
    $body.Add($bodyLabel)

    # --- Contenu sidebar : ProjectList + PresetSelector (tab switching) ---
    $projectList = $null
    $presetSelector = $null
    # Note : l'etat de l'onglet actif est gere dans Register-TuiKeybindings via $tabState hashtable

    # Creer le widget ProjectList
    if ($Config -and $Config.projects -and $Config.projects.Count -gt 0) {
        $projectList = New-ProjectListView -Config $Config -BodyView $body -Themes $Themes
    }

    # Determiner le gitContext pour les suggestions intelligentes (via GitInfo.ps1)
    $gitCtx = $null
    $lastHistory = Get-LaunchHistory -Limit 1
    if ($lastHistory -and $lastHistory.Count -gt 0 -and $lastHistory[0].project) {
        $lastProjSlug = $lastHistory[0].project
        if ($Config.projects.ContainsKey($lastProjSlug)) {
            $projPath = $Config.projects[$lastProjSlug].path
            $gitInfo = Get-ProjectGitInfo -Path $projPath
            if ($gitInfo.IsGit) {
                $gitCtx = @{
                    ProjectSlug = $lastProjSlug
                    Branch      = $gitInfo.Branch
                    IsDirty     = $gitInfo.IsDirty
                    DirtyCount  = $gitInfo.DirtyCount
                }
            }
        }
    }

    # Creer le widget PresetSelector avec suggestions intelligentes
    $presetSelector = New-PresetSelectorView -Config $Config -BodyView $body -Themes $Themes -GitContext $gitCtx

    # Indicateur d'onglet en haut de la sidebar
    $tabLabel = [Terminal.Gui.Label]::new("[Projets] Presets")
    $tabLabel.X = 0
    $tabLabel.Y = 0
    $tabLabel.Width = [Terminal.Gui.Dim]::Fill()
    if ($Themes) { $tabLabel.ColorScheme = $Themes.Header }
    $sidebar.Add($tabLabel)

    # Afficher le ProjectList par defaut (sous le label d'onglet)
    if ($projectList) {
        $projectList.ListView.Y = 1
        $projectList.ListView.Height = [Terminal.Gui.Dim]::Fill()
        $sidebar.Add($projectList.ListView)
    } else {
        $sidebarLabel = [Terminal.Gui.Label]::new("(aucun projet)")
        $sidebarLabel.X = 1
        $sidebarLabel.Y = 1
        $sidebar.Add($sidebarLabel)
    }

    # Preparer le PresetSelector (Y=1 pour etre sous le label d'onglet)
    if ($presetSelector) {
        $presetSelector.ListView.Y = 1
        $presetSelector.ListView.Height = [Terminal.Gui.Dim]::Fill()
    }

    # --- Footer (View simple sans cadre, style barre de status) ---
    $footer = [Terminal.Gui.View]::new()
    $footer.X = 0
    $footer.Y = [Terminal.Gui.Pos]::AnchorEnd(1)
    $footer.Width = [Terminal.Gui.Dim]::Fill()
    $footer.Height = 1
    if ($Themes) {
        $footer.ColorScheme = $Themes.Footer
    }

    $footerLabel = [Terminal.Gui.Label]::new(" [F1] Projets/Presets  [F2] Scanner  [Suppr] Retirer  [Entree] Selectionner  [Q] Quitter  [?] Aide")
    $footerLabel.X = 0
    $footerLabel.Y = 0
    $footerLabel.Width = [Terminal.Gui.Dim]::Fill()
    if ($Themes) {
        $footerLabel.ColorScheme = $Themes.Footer
    }
    $footer.Add($footerLabel)

    # --- Assembler ---
    $window.Add($header)
    $window.Add($sidebar)
    $window.Add($body)
    $window.Add($footer)

    return @{
        Window         = $window
        Header         = $header
        Sidebar        = $sidebar
        Body           = $body
        Footer         = $footer
        ProjectList    = $projectList
        PresetSelector = $presetSelector
        TabLabel       = $tabLabel
    }
}

function Register-TuiKeybindings {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [Terminal.Gui.Window]$Window,

        [Parameter(Mandatory)]
        [hashtable]$Layout,

        [hashtable]$Config
    )

    # Capturer les references pour les closures du tab switching
    $capturedSidebar = $Layout.Sidebar
    $capturedBody = $Layout.Body
    $capturedProjectListLV = if ($Layout.ProjectList) { $Layout.ProjectList.ListView } else { $null }
    $capturedPresetSelectorLV = if ($Layout.PresetSelector) { $Layout.PresetSelector.ListView } else { $null }
    $capturedTabLabel = $Layout.TabLabel
    $capturedLogFn = ${function:Write-Log}
    $capturedScanFn = ${function:Invoke-ProjectScan}
    $capturedSaveFn = ${function:Save-LauncherConfig}
    $capturedGetGitInfoFn = ${function:Get-ProjectGitInfo}
    $capturedConfig = $Config
    $capturedNoProjectLabel = $null
    # Etat mutable partage via hashtable (les variables $script: ne survivent pas a GetNewClosure)
    $tabState = @{ Active = 'projects' }

    # Si pas de ProjectList, garder le label "(aucun projet)" pour le re-afficher
    if (-not $capturedProjectListLV) {
        foreach ($subview in $capturedSidebar.Subviews) {
            if ($subview -is [Terminal.Gui.Label] -and $subview.Y -eq 1) {
                $capturedNoProjectLabel = $subview
                break
            }
        }
    }

    # Enregistrer les raccourcis clavier sur la fenetre principale
    # Note : on utilise KeyValue (int) au lieu de Key enum car PowerShell
    # ne gere pas les membres qui different uniquement par la casse (Q vs q).
    $Window.add_KeyPress((Protect-EventHandler -Source 'Keybindings' -Handler {
        param($keyEvent)

        $keyValue = $keyEvent.KeyEvent.KeyValue

        # Q ou q → Quitter (Q=81, q=113)
        if ($keyValue -eq 81 -or $keyValue -eq 113) {
            [Terminal.Gui.Application]::RequestStop()
            $keyEvent.Handled = $true
        }

        # F1 → Switch sidebar Projets ↔ Presets (F1=1048588)
        if ($keyValue -eq 1048588) {
            if ($tabState.Active -eq 'projects') {
                # Retirer ProjectList (ou label aucun projet), ajouter PresetSelector
                if ($capturedProjectListLV) {
                    $capturedSidebar.Remove($capturedProjectListLV)
                } elseif ($capturedNoProjectLabel) {
                    $capturedSidebar.Remove($capturedNoProjectLabel)
                }
                if ($capturedPresetSelectorLV) {
                    $capturedSidebar.Add($capturedPresetSelectorLV)
                }
                $capturedTabLabel.Text = "Projets [Presets]"
                $tabState.Active = 'presets'
                & $capturedLogFn -Level 'DEBUG' -Source 'App' -Message "Sidebar tab switch to 'presets'"
            } else {
                # Retirer PresetSelector, ajouter ProjectList
                if ($capturedPresetSelectorLV) {
                    $capturedSidebar.Remove($capturedPresetSelectorLV)
                }
                if ($capturedProjectListLV) {
                    $capturedSidebar.Add($capturedProjectListLV)
                } elseif ($capturedNoProjectLabel) {
                    $capturedSidebar.Add($capturedNoProjectLabel)
                }
                $capturedTabLabel.Text = "[Projets] Presets"
                $tabState.Active = 'projects'
                & $capturedLogFn -Level 'DEBUG' -Source 'App' -Message "Sidebar tab switch to 'projects'"
            }
            $capturedSidebar.SetNeedsDisplay()
            $keyEvent.Handled = $true
        }

        # F2 → Scanner les projets (F2=1048589)
        if ($keyValue -eq 1048589) {
            & $capturedLogFn -Level 'INFO' -Source 'App' -Message "F2 pressed: launching project scan"

            $scanDirs = @()
            if ($capturedConfig -and $capturedConfig.preferences -and $capturedConfig.preferences.scan_directories) {
                $scanDirs = @($capturedConfig.preferences.scan_directories)
            }

            if ($scanDirs.Count -eq 0) {
                $buttons = [string[]]@("OK")
                [Terminal.Gui.MessageBox]::Query("Scanner", "`nAucun dossier de scan configure.`nAjoutez scan_directories dans config.json :`n`n  ""scan_directories"": [""C:\\chemin\\vers\\projets""]`n", $buttons) | Out-Null
            } else {
                $scanned = & $capturedScanFn -Directories $scanDirs -MaxDepth 5 -ExistingProjects $capturedConfig.projects
                & $capturedLogFn -Level 'INFO' -Source 'App' -Message "Scan found $($scanned.Count) projects"

                $capturedBody.RemoveAll()

                if ($scanned.Count -eq 0) {
                    $noResultLabel = [Terminal.Gui.Label]::new("  Aucun nouveau projet detecte dans :`n  $($scanDirs -join "`n  ")")
                    $noResultLabel.X = 0
                    $noResultLabel.Y = 2
                    $capturedBody.Add($noResultLabel)
                } else {
                    $titleLabel = [Terminal.Gui.Label]::new("  Projets decouverts ($($scanned.Count)) — Entree pour ajouter")
                    $titleLabel.X = 0
                    $titleLabel.Y = 1
                    $capturedBody.Add($titleLabel)

                    # ListView interactif avec les projets scannes
                    $scanDisplayLines = [System.Collections.Generic.List[string]]::new()
                    foreach ($p in $scanned) {
                        $branchInfo = if ($p.git_branch -and $p.git_branch -ne 'unknown') { " ($($p.git_branch))" } else { '' }
                        $scanDisplayLines.Add([string]"[$($p.stack_type)] $($p.name)$branchInfo")
                    }

                    $scanListView = [Terminal.Gui.ListView]::new()
                    $scanListView.SetSource($scanDisplayLines)
                    $scanListView.X = 1
                    $scanListView.Y = 3
                    $scanListView.Width = [Terminal.Gui.Dim]::Fill(1)
                    $scanListView.Height = [Terminal.Gui.Dim]::Fill(2)
                    $scanListView.AllowsMarking = $false

                    # Detail du projet selectionne en bas
                    $scanDetailLabel = [Terminal.Gui.Label]::new("")
                    $scanDetailLabel.X = 1
                    $scanDetailLabel.Y = [Terminal.Gui.Pos]::AnchorEnd(2)
                    $scanDetailLabel.Width = [Terminal.Gui.Dim]::Fill(1)
                    $scanDetailLabel.Height = 2

                    # Captures pour les closures (re-capture car on est dans un GetNewClosure parent)
                    $capturedScanned = $scanned
                    $capturedScanLV = $scanListView
                    $capturedScanDetail = $scanDetailLabel
                    $capturedLogFn2 = $capturedLogFn
                    $capturedSaveFn2 = $capturedSaveFn
                    $capturedGetGitInfoFn2 = $capturedGetGitInfoFn
                    $capturedConfig2 = $capturedConfig
                    $capturedProjectListLV2 = $capturedProjectListLV
                    $capturedSidebar2 = $capturedSidebar

                    $scanListView.add_SelectedItemChanged({
                        try {
                            $idx = [int]$capturedScanLV.SelectedItem
                            if ($idx -ge 0 -and $idx -lt $capturedScanned.Count) {
                                $p = $capturedScanned[$idx]
                                $capturedScanDetail.Text = "  $($p.path)"
                            }
                        } catch {
                            try { & $capturedLogFn2 -Level 'ERROR' -Source 'Scanner' -Message "SelectedItemChanged error" -ErrorRecord $_ } catch {}
                        }
                    }.GetNewClosure())

                    $scanListView.add_OpenSelectedItem({
                        try {
                            $idx = [int]$capturedScanLV.SelectedItem
                            if ($idx -lt 0 -or $idx -ge $capturedScanned.Count) { return }
                            $p = $capturedScanned[$idx]

                            $confirmButtons = [string[]]@("Ajouter", "Annuler")
                            $result = [Terminal.Gui.MessageBox]::Query(
                                "Ajouter au config ?",
                                "`n  $($p.name)`n  $($p.path)`n  Stack: $($p.stack_type)`n",
                                $confirmButtons
                            )

                            if ($result -eq 0) {
                                # Ajouter le projet a la config en memoire
                                $capturedConfig2.projects[$p.slug] = @{
                                    name            = $p.name
                                    path            = $p.path
                                    color           = '#808080'
                                    default_command = 'claude'
                                }

                                # Sauvegarder config.json
                                try {
                                    & $capturedSaveFn2 -Config $capturedConfig2 -Path '.\config.json'
                                    & $capturedLogFn2 -Level 'INFO' -Source 'Scanner' -Message "Project added to config: $($p.name) ($($p.slug))"

                                    # Rafraichir la sidebar en live
                                    if ($capturedProjectListLV2) {
                                        $newLines = [System.Collections.Generic.List[string]]::new()
                                        foreach ($s in $capturedConfig2.projects.Keys | Sort-Object) {
                                            $pr = $capturedConfig2.projects[$s]
                                            $gi = & $capturedGetGitInfoFn2 -Path $pr.path
                                            if (-not $gi.Exists) {
                                                $newLines.Add([string]"$([char]0x26A0) $($pr.name) (introuvable)")
                                            } elseif ($gi.IsGit) {
                                                $sc = if ($gi.IsDirty) { "$([char]0x2726) $($gi.DirtyCount)" } else { [string][char]0x2713 }
                                                $newLines.Add([string]"$([char]0x25CF) $($pr.name)  $($gi.Branch) $sc")
                                            } else {
                                                $newLines.Add([string]"$([char]0x25CF) $($pr.name)")
                                            }
                                        }
                                        $capturedProjectListLV2.SetSource($newLines)
                                        $capturedSidebar2.SetNeedsDisplay()
                                    }

                                    $infoButtons = [string[]]@("OK")
                                    [Terminal.Gui.MessageBox]::Query("Ajoute !", "`n  $($p.name) ajoute a la config et a la sidebar.`n", $infoButtons) | Out-Null
                                } catch {
                                    & $capturedLogFn2 -Level 'ERROR' -Source 'Scanner' -Message "Failed to save config" -ErrorRecord $_
                                    $errButtons = [string[]]@("OK")
                                    [Terminal.Gui.MessageBox]::Query("Erreur", "`n  Impossible de sauvegarder config.json`n", $errButtons) | Out-Null
                                }
                            }
                        } catch {
                            try { & $capturedLogFn2 -Level 'ERROR' -Source 'Scanner' -Message "OpenSelectedItem error" -ErrorRecord $_ } catch {}
                        }
                    }.GetNewClosure())

                    $capturedBody.Add($scanListView)
                    $capturedBody.Add($scanDetailLabel)
                    $scanListView.SetFocus()
                }

                $capturedBody.SetNeedsDisplay()
            }

            $keyEvent.Handled = $true
        }

        # Delete/Backspace → Supprimer un projet de la sidebar (Delete=127, Backspace=8, Ctrl+D=4)
        if (($keyValue -eq 127 -or $keyValue -eq 8) -and $tabState.Active -eq 'projects' -and $capturedProjectListLV) {
            $idx = [int]$capturedProjectListLV.SelectedItem
            $sortedSlugs = @($capturedConfig.projects.Keys | Sort-Object)
            if ($idx -ge 0 -and $idx -lt $sortedSlugs.Count) {
                $slugToRemove = $sortedSlugs[$idx]
                $projToRemove = $capturedConfig.projects[$slugToRemove]
                $confirmButtons = [string[]]@("Supprimer", "Annuler")
                $result = [Terminal.Gui.MessageBox]::Query(
                    "Supprimer ?",
                    "`n  $($projToRemove.name)`n  $($projToRemove.path)`n`n  Retirer de config.json ?`n",
                    $confirmButtons
                )
                if ($result -eq 0) {
                    $capturedConfig.projects.Remove($slugToRemove)
                    try {
                        & $capturedSaveFn -Config $capturedConfig -Path '.\config.json'
                        & $capturedLogFn -Level 'INFO' -Source 'App' -Message "Project removed from config: $($projToRemove.name) ($slugToRemove)"

                        # Rafraichir la sidebar
                        $newLines = [System.Collections.Generic.List[string]]::new()
                        foreach ($s in $capturedConfig.projects.Keys | Sort-Object) {
                            $pr = $capturedConfig.projects[$s]
                            $gi = & $capturedGetGitInfoFn -Path $pr.path
                            if (-not $gi.Exists) {
                                $newLines.Add([string]"$([char]0x26A0) $($pr.name) (introuvable)")
                            } elseif ($gi.IsGit) {
                                $sc = if ($gi.IsDirty) { "$([char]0x2726) $($gi.DirtyCount)" } else { [string][char]0x2713 }
                                $newLines.Add([string]"$([char]0x25CF) $($pr.name)  $($gi.Branch) $sc")
                            } else {
                                $newLines.Add([string]"$([char]0x25CF) $($pr.name)")
                            }
                        }
                        $capturedProjectListLV.SetSource($newLines)
                        $capturedSidebar.SetNeedsDisplay()
                    } catch {
                        & $capturedLogFn -Level 'ERROR' -Source 'App' -Message "Failed to save config after removal" -ErrorRecord $_
                    }
                }
            }
            $keyEvent.Handled = $true
        }

        # ? → Aide (?=63)
        if ($keyValue -eq 63) {
            $helpText = "`n" +
                "  F1 ............... Projets / Presets`n" +
                "  F2 ............... Scanner les projets`n" +
                "  Suppr ............ Supprimer un projet`n" +
                "  Fleches .......... Naviguer dans les listes`n" +
                "  Entree ........... Selectionner / lancer`n" +
                "  Tab / Shift+Tab .. Naviguer entre zones`n" +
                "  Echap ............ Retour / fermer dialog`n" +
                "  Q ................ Quitter`n" +
                "  ? ................ Cette aide`n"
            $buttons = [string[]]@("OK")
            [Terminal.Gui.MessageBox]::Query("Raccourcis", $helpText, $buttons) | Out-Null
            $keyEvent.Handled = $true
        }
    }.GetNewClosure()))
}

function Start-LauncherTui {
    [CmdletBinding()]
    param(
        [hashtable]$Config
    )

    # Guard PowerShell 7+
    if ($PSVersionTable.PSVersion.Major -lt 7) {
        Write-Error "Claude Launcher TUI necessite PowerShell 7+. Lancez avec pwsh.exe au lieu de powershell.exe."
        return
    }

    # 1. Importer l'assembly Terminal.Gui
    Import-TuiAssembly

    # 2. Initialiser, construire, lancer avec try/finally
    # Initialiser le moteur de suggestions intelligentes
    Initialize-SmartPresets
    Write-Log -Level 'INFO' -Source 'App' -Message "TUI starting with $($Config.projects.Count) projects"
    $initialized = $false
    try {
        [Terminal.Gui.Application]::Init()
        $initialized = $true

        # 3. Appliquer le theme dark
        $themes = Set-TuiThemeDark

        # 4. Construire le layout
        $layout = New-TuiLayout -Themes $themes -Config $Config

        # 5. Injecter la reference Window dans PresetSelector pour le launch flow
        if ($layout.PresetSelector -and $layout.PresetSelector.WindowRef) {
            $layout.PresetSelector.WindowRef.Window = $layout.Window
            Write-Log -Level 'DEBUG' -Source 'App' -Message "Window reference injected into PresetSelector"
        }

        # 6. Enregistrer les keybindings (avec layout pour tab switching)
        Register-TuiKeybindings -Window $layout.Window -Layout $layout -Config $Config

        # 7. Ajouter la fenetre et lancer la boucle
        [Terminal.Gui.Application]::Top.Add($layout.Window)
        [Terminal.Gui.Application]::Run()

    } finally {
        if ($initialized) {
            [Terminal.Gui.Application]::Shutdown()
            # Nettoyer le SynchronizationContext pour eviter les deadlocks
            [System.Threading.SynchronizationContext]::SetSynchronizationContext($null)
        }
        Write-Log -Level 'INFO' -Source 'App' -Message "TUI shutdown"
    }

    # Le lancement est gere en interne via Start-LaunchFlow (modales).
    # Start-LauncherTui retourne $null quand l'utilisateur quitte (Q).
    Write-Log -Level 'INFO' -Source 'App' -Message "TUI exited normally"
    return $null
}
