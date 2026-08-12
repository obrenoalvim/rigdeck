Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32FgWindow {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
"@

try {
    $hwnd = [Win32FgWindow]::GetForegroundWindow()
    if ($hwnd -eq [IntPtr]::Zero) {
        Write-Output (@{ ok = $true; processName = $null } | ConvertTo-Json -Compress)
        exit 0
    }
    [uint32]$procId = 0
    [Win32FgWindow]::GetWindowThreadProcessId($hwnd, [ref]$procId) | Out-Null
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    $name = if ($proc) { $proc.ProcessName } else { $null }

    # Caminho completo do exe, alem do nome curto -- pra jogos Steam o
    # "processo" salvo no preset costuma ser o installdir do manifesto
    # (ex: "Counter-Strike Global Offensive"), que raramente bate com o
    # nome real do processo (cs2.exe -> "cs2"), mas SEMPRE aparece como
    # pasta dentro do caminho do exe (...\steamapps\common\Counter-Strike
    # Global Offensive\game\bin\win64\cs2.exe). O front compara contra os
    # dois (nome exato OU substring do caminho) pra cobrir ambos os casos
    # sem precisar reescrever o scanner de jogos da Steam.
    $path = $null
    if ($proc) {
        try {
            $path = $proc.MainModule.FileName
        } catch {
            try {
                $path = (Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue).ExecutablePath
            } catch {}
        }
    }

    Write-Output (@{ ok = $true; processName = $name; path = $path } | ConvertTo-Json -Compress)
} catch {
    Write-Output (@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress)
}
