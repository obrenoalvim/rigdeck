Add-Type -AssemblyName System.Windows.Forms

$screens = [System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
    [PSCustomObject]@{
        primary = $_.Primary
        x       = $_.Bounds.X
        y       = $_.Bounds.Y
        width   = $_.Bounds.Width
        height  = $_.Bounds.Height
    }
}

ConvertTo-Json -InputObject $screens -Compress
