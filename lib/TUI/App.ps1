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

    # Creer le widget PresetSelector
    $presetSelector = New-PresetSelectorView -Config $Config -BodyView $body -Themes $Themes

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

    $footerLabel = [Terminal.Gui.Label]::new(" [F1] Projets/Presets  [Entree] Selectionner  [Q] Quitter  [?] Aide")
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
        [hashtable]$Layout
    )

    # Capturer les references pour les closures du tab switching
    $capturedSidebar = $Layout.Sidebar
    $capturedProjectListLV = if ($Layout.ProjectList) { $Layout.ProjectList.ListView } else { $null }
    $capturedPresetSelectorLV = if ($Layout.PresetSelector) { $Layout.PresetSelector.ListView } else { $null }
    $capturedTabLabel = $Layout.TabLabel
    $capturedLogFn = ${function:Write-Log}
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

        # ? → Aide (?=63)
        if ($keyValue -eq 63) {
            $helpText = "`n" +
                "  F1 ............... Projets / Presets`n" +
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
        Register-TuiKeybindings -Window $layout.Window -Layout $layout

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
