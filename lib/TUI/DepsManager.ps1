#Requires -Version 7.0
<#
.SYNOPSIS
    Gestion des dependances Terminal.Gui pour Claude Launcher.
.DESCRIPTION
    Telecharge, verifie et charge automatiquement les DLLs Terminal.Gui v1.19.0
    et NStack.Core v1.1.1 depuis NuGet. Les hash SHA256 sont verifies a chaque chargement.
#>

# Hash SHA256 des DLLs — verifies a chaque chargement pour garantir l'integrite.
$script:Dependencies = @(
    @{
        Name        = 'NStack'
        FileName    = 'NStack.dll'
        NuGetUrl    = 'https://www.nuget.org/api/v2/package/NStack.Core/1.1.1'
        NuGetPath   = 'lib/netstandard2.0/NStack.dll'
        Hash        = '6741B4DDD62FD34A8E688C50E0EE20FADE1B467A841C42ECD2B42C4760CD8EDC'
    }
    @{
        Name        = 'Terminal.Gui'
        FileName    = 'Terminal.Gui.dll'
        NuGetUrl    = 'https://www.nuget.org/api/v2/package/Terminal.Gui/1.19.0'
        NuGetPath   = 'lib/netstandard2.0/Terminal.Gui.dll'
        Hash        = '83E20409F11E4931E6B2BE46215C401E53340DCA3C73E724E82B7361B31B9807'
    }
)

function Install-TuiDependency {
    [CmdletBinding()]
    [OutputType([string[]])]
    param()

    # 1. Calculer le chemin cible de facon canonique
    $projectRoot = [System.IO.Path]::GetFullPath(
        [System.IO.Path]::Combine($PSScriptRoot, '..', '..')
    )
    $depsDir = Join-Path $projectRoot 'deps'

    # Anti path-traversal
    if (-not $depsDir.StartsWith($projectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Chemin deps invalide : tentative de path-traversal detectee."
    }

    $dllPaths = @()

    foreach ($dep in $script:Dependencies) {
        $dllPath = Join-Path $depsDir $dep.FileName

        # 2. Si le fichier existe deja, verifier le hash
        if (Test-Path $dllPath) {
            $actualHash = (Get-FileHash -Path $dllPath -Algorithm SHA256).Hash

            if ($actualHash -eq $dep.Hash) {
                Write-Verbose "$($dep.FileName) deja presente, hash verifie."
                $dllPaths += $dllPath
                continue
            } else {
                Write-Warning "Hash $($dep.FileName) invalide (attendu: $($dep.Hash.Substring(0,16))..., obtenu: $($actualHash.Substring(0,16))...). Re-telechargement..."
                Remove-Item $dllPath -Force
            }
        }

        # 3. Telecharger et installer
        Write-Host "$($dep.Name) n'est pas installe. Telechargement en cours..." -ForegroundColor Yellow

        if (-not (Test-Path $depsDir)) {
            New-Item -ItemType Directory -Path $depsDir -Force | Out-Null
        }

        $nupkgPath = Join-Path $depsDir "$($dep.Name.ToLower()).nupkg"
        $extractDir = Join-Path $depsDir "_extract_$($dep.Name.ToLower())"

        try {
            Invoke-WebRequest -Uri $dep.NuGetUrl -OutFile $nupkgPath -TimeoutSec 60 -UseBasicParsing

            if (-not (Test-Path $nupkgPath)) {
                throw "Le telechargement de $($dep.Name) a echoue : fichier nupkg introuvable."
            }

            if (Test-Path $extractDir) {
                Remove-Item $extractDir -Recurse -Force
            }
            Expand-Archive -Path $nupkgPath -DestinationPath $extractDir -Force

            # Localiser la DLL dans le package
            $nugetPathParts = $dep.NuGetPath -split '/'
            $sourceDll = Join-Path $extractDir ($nugetPathParts -join [System.IO.Path]::DirectorySeparatorChar)

            if (-not (Test-Path $sourceDll)) {
                throw "$($dep.FileName) introuvable dans le package NuGet (chemin attendu : $($dep.NuGetPath))."
            }

            Copy-Item -Path $sourceDll -Destination $dllPath -Force

            # Verifier le hash SHA256
            $actualHash = (Get-FileHash -Path $dllPath -Algorithm SHA256).Hash

            if ($actualHash -ne $dep.Hash) {
                Remove-Item $dllPath -Force
                throw "Hash $($dep.FileName) invalide. Telechargement potentiellement compromis. Hash attendu : $($dep.Hash), obtenu : $actualHash"
            }

            Write-Host "$($dep.Name) installe." -ForegroundColor Green

        } finally {
            if (Test-Path $nupkgPath) {
                Remove-Item $nupkgPath -Force -ErrorAction SilentlyContinue
            }
            if (Test-Path $extractDir) {
                Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue
            }
        }

        $dllPaths += $dllPath
    }

    return $dllPaths
}

function Import-TuiAssembly {
    [CmdletBinding()]
    [OutputType([void])]
    param()

    # 1. Obtenir les chemins DLLs (absolus, verifies)
    $dllPaths = Install-TuiDependency

    # 2. Charger chaque DLL dans l'ordre (NStack avant Terminal.Gui)
    foreach ($dllPath in $dllPaths) {
        $assemblyName = [System.IO.Path]::GetFileNameWithoutExtension($dllPath)

        $loaded = [System.AppDomain]::CurrentDomain.GetAssemblies() |
            Where-Object { $_.GetName().Name -eq $assemblyName }

        if ($loaded) {
            Write-Verbose "$assemblyName deja charge en memoire."
            continue
        }

        Add-Type -Path $dllPath
        Write-Verbose "$assemblyName charge."
    }
}
