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

    # --- Contenu sidebar (apres body pour la reference) ---
    $projectList = $null
    if ($Config -and $Config.projects -and $Config.projects.Count -gt 0) {
        $projectList = New-ProjectListView -Config $Config -BodyView $body -Themes $Themes
        $sidebar.Add($projectList.ListView)
    } else {
        $sidebarLabel = [Terminal.Gui.Label]::new("(aucun projet)")
        $sidebarLabel.X = 1
        $sidebarLabel.Y = 1
        $sidebar.Add($sidebarLabel)
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

    $footerLabel = [Terminal.Gui.Label]::new(" [Tab] Naviguer  [Entree] Selectionner  [Q] Quitter  [?] Aide")
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
        Window      = $window
        Header      = $header
        Sidebar     = $sidebar
        Body        = $body
        Footer      = $footer
        ProjectList = $projectList
    }
}

function Register-TuiKeybindings {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [Terminal.Gui.Window]$Window
    )

    # Enregistrer les raccourcis clavier sur la fenetre principale
    # Note : on utilise KeyValue (int) au lieu de Key enum car PowerShell
    # ne gere pas les membres qui different uniquement par la casse (Q vs q).
    $Window.add_KeyPress({
        param($keyEvent)

        $keyValue = $keyEvent.KeyEvent.KeyValue

        # Q ou q → Quitter (Q=81, q=113)
        if ($keyValue -eq 81 -or $keyValue -eq 113) {
            [Terminal.Gui.Application]::RequestStop()
            $keyEvent.Handled = $true
        }

        # ? → Aide (?=63)
        if ($keyValue -eq 63) {
            $helpText = "`n" +
                "  Tab / Shift+Tab .. Naviguer entre zones`n" +
                "  Fleches .......... Naviguer dans les listes`n" +
                "  Entree ........... Selectionner / valider`n" +
                "  Echap ............ Retour / fermer dialog`n" +
                "  Q ................ Quitter`n" +
                "  ? ................ Cette aide`n"
            $buttons = [string[]]@("OK")
            [Terminal.Gui.MessageBox]::Query("Raccourcis", $helpText, $buttons) | Out-Null
            $keyEvent.Handled = $true
        }
    })
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
    $initialized = $false
    try {
        [Terminal.Gui.Application]::Init()
        $initialized = $true

        # 3. Appliquer le theme dark
        $themes = Set-TuiThemeDark

        # 4. Construire le layout
        $layout = New-TuiLayout -Themes $themes -Config $Config

        # 5. Enregistrer les keybindings
        Register-TuiKeybindings -Window $layout.Window

        # 6. Ajouter la fenetre et lancer la boucle
        [Terminal.Gui.Application]::Top.Add($layout.Window)
        [Terminal.Gui.Application]::Run()

    } finally {
        if ($initialized) {
            [Terminal.Gui.Application]::Shutdown()
            # Nettoyer le SynchronizationContext pour eviter les deadlocks
            [System.Threading.SynchronizationContext]::SetSynchronizationContext($null)
        }
    }
}
