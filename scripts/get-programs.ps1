# Junta 4 fontes, igual ferramentas tipo Playnite fazem:
#  - Atalhos do Menu Iniciar e da Area de Trabalho (apps em geral, jogos
#    instalados por repack/instalador que so criam atalho no Desktop)
#  - Manifestos do Epic Games Launcher (jogos Epic, ex: Fortnite)
#  - Manifestos do Steam (jogos Steam)
#
# ponytail: Google Play Games (Beta) guarda a lista de jogos instalados
# criptografada (app_library_encryption_key + store.db), sem manifesto
# legivel tipo Steam/Epic. Jogos instalados por ele aparecem aqui do
# mesmo jeito SE o GPG criar atalho no Desktop/Menu Iniciar (comportamento
# padrao dele). Sem isso, upgrade seria ler o store.db (SQLite) e
# descobrir o esquema de criptografia -- fora de escopo por ora.

$results = New-Object System.Collections.Generic.List[object]

# Palavras-chave pra classificar atalho solto (nao-Steam/Epic) como jogo --
# olha tanto a pasta do atalho quanto o caminho do .exe alvo, cobre outros
# launchers que possam aparecer (GOG, Ubisoft, EA, Battle.net, itch.io) sem
# precisar de integracao dedicada pra cada um, so pra esses o atalho ja
# existe no Menu Iniciar/Desktop do jeito normal.
$gameKeywords = 'jogos?|games?|steam|epic ?games|riot ?games|battle\.net|ea (games|desktop)|origin|ubisoft|gog galaxy|itch\.io|playstation|xbox'
# O launcher em si mora na mesma pasta que os jogos dele (ex: atalho do
# "Steam" fica em Steam\), entao bateria a mesma keyword -- exclui pelo
# nome exato pra nao marcar o launcher como "jogo".
$launcherNames = '^(Steam|Epic Games Launcher|Google Play Games( \(Beta\))?|Origin|EA (Desktop|App)|Battle\.net|Ubisoft Connect|GOG Galaxy)$'

# --- Menu Iniciar + Area de Trabalho ---
$shell = New-Object -ComObject WScript.Shell
$startMenus = @(
    "$env:ProgramData\Microsoft\Windows\Start Menu\Programs",
    "$env:AppData\Microsoft\Windows\Start Menu\Programs",
    "$env:USERPROFILE\Desktop",
    "C:\Users\Public\Desktop"
)
$shortcuts = foreach ($base in $startMenus) {
    if (Test-Path $base) {
        Get-ChildItem -Path $base -Filter *.lnk -Recurse -ErrorAction SilentlyContinue
    }
}
foreach ($item in $shortcuts) {
    try {
        $target = $shell.CreateShortcut($item.FullName).TargetPath
        $name = [System.IO.Path]::GetFileNameWithoutExtension($item.Name)
        if ($target -and $target -match '\.exe$' -and (Test-Path $target) -and $name -notmatch '^(Uninstall|Desinstalar)') {
            $looksLikeGame = ($item.FullName -match $gameKeywords) -or ($target -match $gameKeywords)
            $category = if ($looksLikeGame -and $name -notmatch $launcherNames) { 'game' } else { 'app' }
            $results.Add([PSCustomObject]@{ name = $name; target = $target; source = 'App'; category = $category })
        }
    } catch {}
}

# --- Epic Games ---
# Usa o protocolo com.epicgames.launcher:// com silent=true em vez do .exe direto --
# lancar o .exe do jogo (ex: FortniteBootstrapper.exe) faz ele abrir o Epic Games
# Launcher inteiro por baixo (login, checagem, etc), o que pode demorar minutos.
# O protocolo pula essa etapa e manda direto pro processo real do jogo.
$epicManifests = "$env:ProgramData\Epic\EpicGamesLauncher\Data\Manifests"
if (Test-Path $epicManifests) {
    Get-ChildItem -Path $epicManifests -Filter *.item -ErrorAction SilentlyContinue | ForEach-Object {
        try {
            $m = Get-Content $_.FullName -Raw | ConvertFrom-Json
            # AppCategories tem "games" pros jogos de verdade e outra coisa
            # (ex: "plugins", "unrealengine") pras ferramentas que o Epic
            # Games Launcher tambem instala (Unreal Engine, Epic Online
            # Services) -- sem esse filtro elas apareciam misturadas.
            $isGame = $m.AppCategories -and ($m.AppCategories -contains 'games')
            if ($m.DisplayName -and $m.CatalogNamespace -and $m.CatalogItemId -and $m.AppName -and $isGame) {
                $ns = [uri]::EscapeDataString($m.CatalogNamespace)
                $item = [uri]::EscapeDataString($m.CatalogItemId)
                $app = [uri]::EscapeDataString($m.AppName)
                $uri = "com.epicgames.launcher://apps/${ns}%3A${item}%3A${app}?action=launch&silent=true"
                $results.Add([PSCustomObject]@{ name = $m.DisplayName; target = $uri; source = 'Epic'; category = 'game' })
            }
        } catch {}
    }
}

# --- Steam ---
try {
    $steamPath = (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction SilentlyContinue).SteamPath
    if (-not $steamPath) {
        $steamPath = (Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Valve\Steam' -ErrorAction SilentlyContinue).InstallPath
    }
    if ($steamPath) {
        $steamPath = $steamPath -replace '/', '\'
        $libraryPaths = New-Object System.Collections.Generic.List[string]
        $libraryPaths.Add($steamPath)

        $vdf = Join-Path $steamPath 'steamapps\libraryfolders.vdf'
        if (Test-Path $vdf) {
            $content = Get-Content $vdf -Raw
            [regex]::Matches($content, '"path"\s+"([^"]+)"') | ForEach-Object {
                $p = $_.Groups[1].Value -replace '\\\\', '\'
                if ($libraryPaths -notcontains $p) { $libraryPaths.Add($p) }
            }
        }

        $ignoredAppIds = @('228980')  # Steamworks Common Redistributables (ruido universal)
        foreach ($lib in $libraryPaths) {
            $appsDir = Join-Path $lib 'steamapps'
            if (Test-Path $appsDir) {
                Get-ChildItem -Path $appsDir -Filter 'appmanifest_*.acf' -ErrorAction SilentlyContinue | ForEach-Object {
                    try {
                        $acf = Get-Content $_.FullName -Raw
                        $appid = if ($_.Name -match 'appmanifest_(\d+)\.acf') { $Matches[1] } else { $null }
                        $name = if ($acf -match '"name"\s+"([^"]+)"') { $Matches[1] } else { $null }
                        $installdir = if ($acf -match '"installdir"\s+"([^"]+)"') { $Matches[1] } else { $null }
                        if ($appid -and $name -and ($ignoredAppIds -notcontains $appid)) {
                            $results.Add([PSCustomObject]@{
                                name        = $name
                                target      = "steam://rungameid/$appid"
                                processName = $installdir
                                source      = 'Steam'
                                category    = 'game'
                            })
                        }
                    } catch {}
                }
            }
        }
    }
} catch {}

# Dedup por nome (case-insensitive), prioridade: Epic/Steam antes do Menu Iniciar
$seen = @{}
$deduped = foreach ($r in $results) {
    $key = $r.name.ToLower()
    if (-not $seen.ContainsKey($key)) {
        $seen[$key] = $true
        $r
    }
}

$deduped | Sort-Object name | ConvertTo-Json -Compress
