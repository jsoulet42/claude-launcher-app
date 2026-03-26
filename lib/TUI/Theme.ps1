#Requires -Version 7.0
<#
.SYNOPSIS
    Theme dark pour Claude Launcher TUI.
.DESCRIPTION
    Definit les color schemes pour l'interface Terminal.Gui.
    Doit etre appele APRES Application.Init().
#>

function New-TuiColorScheme {
    [CmdletBinding()]
    [OutputType([Terminal.Gui.ColorScheme])]
    param(
        [Parameter(Mandatory)]
        [string]$NormalFg,
        [Parameter(Mandatory)]
        [string]$NormalBg,
        [string]$FocusFg = 'Black',
        [string]$FocusBg = 'Cyan',
        [string]$HotNormalFg = 'BrightYellow',
        [string]$HotNormalBg = $NormalBg,
        [string]$HotFocusFg = 'BrightYellow',
        [string]$HotFocusBg = $FocusBg
    )

    $driver = [Terminal.Gui.Application]::Driver

    $scheme = [Terminal.Gui.ColorScheme]::new()
    $scheme.Normal    = $driver.MakeAttribute(
        [Terminal.Gui.Color]::$NormalFg,
        [Terminal.Gui.Color]::$NormalBg
    )
    $scheme.Focus     = $driver.MakeAttribute(
        [Terminal.Gui.Color]::$FocusFg,
        [Terminal.Gui.Color]::$FocusBg
    )
    $scheme.HotNormal = $driver.MakeAttribute(
        [Terminal.Gui.Color]::$HotNormalFg,
        [Terminal.Gui.Color]::$HotNormalBg
    )
    $scheme.HotFocus  = $driver.MakeAttribute(
        [Terminal.Gui.Color]::$HotFocusFg,
        [Terminal.Gui.Color]::$HotFocusBg
    )

    return $scheme
}

function Set-TuiThemeDark {
    [CmdletBinding()]
    param()

    # Scheme Base (fond noir, texte gris clair — sobre et moderne)
    $baseScheme = New-TuiColorScheme `
        -NormalFg 'Gray' -NormalBg 'Black' `
        -FocusFg 'White' -FocusBg 'DarkGray' `
        -HotNormalFg 'BrightCyan' -HotNormalBg 'Black' `
        -HotFocusFg 'BrightCyan' -HotFocusBg 'DarkGray'

    # Scheme Header (barre titre — accent cyan sur fond sombre)
    $headerScheme = New-TuiColorScheme `
        -NormalFg 'BrightCyan' -NormalBg 'DarkGray' `
        -FocusFg 'BrightCyan' -FocusBg 'DarkGray' `
        -HotNormalFg 'White' -HotNormalBg 'DarkGray' `
        -HotFocusFg 'White' -HotFocusBg 'DarkGray'

    # Scheme Footer (barre status — contraste inverse)
    $footerScheme = New-TuiColorScheme `
        -NormalFg 'Black' -NormalBg 'Gray' `
        -FocusFg 'Black' -FocusBg 'BrightCyan' `
        -HotNormalFg 'DarkGray' -HotNormalBg 'Gray' `
        -HotFocusFg 'Black' -HotFocusBg 'BrightCyan'

    # Scheme Sidebar (accent vert pour les projets)
    $sidebarScheme = New-TuiColorScheme `
        -NormalFg 'Gray' -NormalBg 'Black' `
        -FocusFg 'Black' -FocusBg 'BrightGreen' `
        -HotNormalFg 'BrightGreen' -HotNormalBg 'Black' `
        -HotFocusFg 'Black' -HotFocusBg 'BrightGreen'

    # Retourner les schemes pour utilisation dans le layout
    return @{
        Base    = $baseScheme
        Header  = $headerScheme
        Footer  = $footerScheme
        Sidebar = $sidebarScheme
    }
}
