param(
    [Parameter(Mandatory=$true)][string]$Path
)

Add-Type -AssemblyName System.Drawing

try {
    if (-not (Test-Path $Path)) { exit 1 }
    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($Path)
    if (-not $icon) { exit 1 }
    $bmp = $icon.ToBitmap()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    [Convert]::ToBase64String($ms.ToArray())
} catch {
    exit 1
}
