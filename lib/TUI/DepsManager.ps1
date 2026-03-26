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
        Write-Log -Level 'ERROR' -Source 'DepsManager' -Message "Path traversal detected: $depsDir"
        throw "Chemin deps invalide : tentative de path-traversal detectee."
    }

    $dllPaths = @()

    foreach ($dep in $script:Dependencies) {
        $dllPath = Join-Path $depsDir $dep.FileName

        Write-Log -Level 'INFO' -Source 'DepsManager' -Message "Checking $($dep.Name)..."

        # 2. Si le fichier existe deja, verifier le hash
        if (Test-Path $dllPath) {
            $actualHash = (Get-FileHash -Path $dllPath -Algorithm SHA256).Hash

            if ($actualHash -eq $dep.Hash) {
                Write-Verbose "$($dep.FileName) deja presente, hash verifie."
                Write-Log -Level 'DEBUG' -Source 'DepsManager' -Message "$($dep.Name) already installed (hash OK)"
                $dllPaths += $dllPath
                continue
            } else {
                Write-Warning "Hash $($dep.FileName) invalide (attendu: $($dep.Hash.Substring(0,16))..., obtenu: $($actualHash.Substring(0,16))...). Re-telechargement..."
                Write-Log -Level 'WARN' -Source 'DepsManager' -Message "Hash $($dep.FileName) invalide, re-telechargement"
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
            Write-Log -Level 'INFO' -Source 'DepsManager' -Message "Downloading $($dep.Name) from $($dep.NuGetUrl)"
            Invoke-WebRequest -Uri $dep.NuGetUrl -OutFile $nupkgPath -TimeoutSec 60 -UseBasicParsing

            if (-not (Test-Path $nupkgPath)) {
                Write-Log -Level 'ERROR' -Source 'DepsManager' -Message "Download failed: $($dep.Name) nupkg not found"
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
                Write-Log -Level 'ERROR' -Source 'DepsManager' -Message "$($dep.FileName) not found in NuGet package at $($dep.NuGetPath)"
                throw "$($dep.FileName) introuvable dans le package NuGet (chemin attendu : $($dep.NuGetPath))."
            }

            Copy-Item -Path $sourceDll -Destination $dllPath -Force

            # Verifier le hash SHA256
            $actualHash = (Get-FileHash -Path $dllPath -Algorithm SHA256).Hash

            if ($actualHash -ne $dep.Hash) {
                Remove-Item $dllPath -Force
                Write-Log -Level 'ERROR' -Source 'DepsManager' -Message "Hash verification failed for $($dep.FileName): expected $($dep.Hash), got $actualHash"
                throw "Hash $($dep.FileName) invalide. Telechargement potentiellement compromis. Hash attendu : $($dep.Hash), obtenu : $actualHash"
            }

            Write-Host "$($dep.Name) installe." -ForegroundColor Green
            Write-Log -Level 'INFO' -Source 'DepsManager' -Message "$($dep.Name) installed successfully"

        } catch {
            Write-LogError -Source 'DepsManager' -Message "Failed to download $($dep.Name)" -ErrorRecord $_
            throw
        } finally {
            try {
                if (Test-Path $nupkgPath) { Remove-Item $nupkgPath -Force -ErrorAction Stop }
            } catch {
                Write-Log -Level 'DEBUG' -Source 'DepsManager' -Message "Cleanup failed for $nupkgPath (non-blocking)"
            }
            try {
                if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force -ErrorAction Stop }
            } catch {
                Write-Log -Level 'DEBUG' -Source 'DepsManager' -Message "Cleanup failed for $extractDir (non-blocking)"
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
