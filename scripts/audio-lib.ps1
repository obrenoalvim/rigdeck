# COM interop com a Core Audio API do Windows (mmdeviceapi.h / endpointvolume.h /
# audiopolicy.h) -- nao existe cmdlet nativo pra volume master + volume por-app,
# so pra abrir esse caminho da pra falar direto com as interfaces COM.
#
# Toda a chamada as interfaces COM roda DENTRO do C# (classe AudioLib.Core, so
# metodos estaticos .NET normais) -- PowerShell nunca segura um objeto COM
# diretamente. Testado na maquina real: PowerShell NAO consegue chamar metodo
# de interface COM pura (IUnknown-only, sem IDispatch) mesmo depois de um
# QueryInterface manual valido -- toda chamada de metodo em variavel tipada
# como System.__ComObject cai em invocacao tardia (estilo Automation/IDispatch),
# e essas interfaces do Core Audio nao suportam IDispatch. Rodando por dentro do
# C# compilado isso nao acontece (chamada de vtable direta, resolvida em
# compilacao), entao o PowerShell so chama metodos estaticos .NET comuns
# (`[AudioLib.Core]::GetMasterVolume()` etc), nunca um `.Metodo()` num objeto COM.
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace AudioLib {
    internal enum EDataFlow { eRender = 0, eCapture = 1, eAll = 2 }
    internal enum ERole { eConsole = 0, eMultimedia = 1, eCommunications = 2 }

    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDeviceEnumerator {
        void EnumAudioEndpoints(EDataFlow dataFlow, int dwStateMask, out IntPtr ppDevices);
        void GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, [MarshalAs(UnmanagedType.Interface)] out IMMDevice ppEndpoint);
        void GetDevice([MarshalAs(UnmanagedType.LPWStr)] string pwstrId, [MarshalAs(UnmanagedType.Interface)] out IMMDevice ppDevice);
        void RegisterEndpointNotificationCallback(IntPtr pClient);
        void UnregisterEndpointNotificationCallback(IntPtr pClient);
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    internal class MMDeviceEnumeratorComObject { }

    [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDevice {
        void Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
        void OpenPropertyStore(int stgmAccess, out IntPtr ppProperties);
        void GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
        void GetState(out int pdwState);
    }

    [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioEndpointVolume {
        void RegisterControlChangeNotify(IntPtr pNotify);
        void UnregisterControlChangeNotify(IntPtr pNotify);
        void GetChannelCount(out int pnChannelCount);
        void SetMasterVolumeLevel(float fLevelDB, IntPtr pguidEventContext);
        void SetMasterVolumeLevelScalar(float fLevel, IntPtr pguidEventContext);
        void GetMasterVolumeLevel(out float pfLevelDB);
        void GetMasterVolumeLevelScalar(out float pfLevel);
        void SetChannelVolumeLevel(int nChannel, float fLevelDB, IntPtr pguidEventContext);
        void SetChannelVolumeLevelScalar(int nChannel, float fLevel, IntPtr pguidEventContext);
        void GetChannelVolumeLevel(int nChannel, out float pfLevelDB);
        void GetChannelVolumeLevelScalar(int nChannel, out float pfLevel);
        void SetMute(bool bMute, IntPtr pguidEventContext);
        void GetMute(out bool pbMute);
        void GetVolumeStepInfo(out int pnStep, out int pnStepCount);
        void VolumeStepUp(IntPtr pguidEventContext);
        void VolumeStepDown(IntPtr pguidEventContext);
        void QueryHardwareSupport(out int pdwHardwareSupportMask);
        void GetVolumeRange(out float pflVolumeMindB, out float pflVolumeMaxdB, out float pflVolumeIncrementdB);
    }

    [Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioSessionControl2 {
        void GetState(out int pRetVal);
        void GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
        void SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
        void GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
        void SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
        void GetGroupingParam(out Guid pRetVal);
        void SetGroupingParam(ref Guid Override, ref Guid EventContext);
        void RegisterAudioSessionNotification(IntPtr NewNotifications);
        void UnregisterAudioSessionNotification(IntPtr NewNotifications);
        void GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
        void GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
        void GetProcessId(out int pRetVal);
        [PreserveSig] int IsSystemSoundsSession();
        void SetDuckingPreference(bool optOut);
    }

    [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioSessionManager2 {
        void GetAudioSessionControl(IntPtr AudioSessionGuid, int Flags, [MarshalAs(UnmanagedType.Interface)] out object SessionControl);
        void GetSimpleAudioVolume(IntPtr AudioSessionGuid, int Flags, [MarshalAs(UnmanagedType.Interface)] out object AudioVolume);
        void GetSessionEnumerator([MarshalAs(UnmanagedType.Interface)] out IAudioSessionEnumerator SessionEnum);
        void RegisterSessionNotification(IntPtr SessionNotification);
        void UnregisterSessionNotification(IntPtr SessionNotification);
        void RegisterDuckNotification([MarshalAs(UnmanagedType.LPWStr)] string sessionID, IntPtr duckNotification);
        void UnregisterDuckNotification(IntPtr duckNotification);
    }

    [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioSessionEnumerator {
        void GetCount(out int SessionCount);
        void GetSession(int SessionCount, [MarshalAs(UnmanagedType.Interface)] out IAudioSessionControl2 Session);
    }

    [Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface ISimpleAudioVolume {
        void SetMasterVolume(float fLevel, IntPtr EventContext);
        void GetMasterVolume(out float pfLevel);
        void SetMute(bool bMute, IntPtr EventContext);
        void GetMute(out bool pbMute);
    }

    // Nivel de pico (0.0-1.0) pro VU meter -- o mesmo objeto que representa o
    // device (master) ou uma sessao (por-app) tambem suporta essa interface,
    // igual ISimpleAudioVolume: so um cast/QI em cima do que ja temos.
    [Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioMeterInformation {
        void GetPeakValue(out float pfPeak);
        void GetMeteringChannelCount(out int pnChannelCount);
        void GetChannelsPeakValues(int u32ChannelCount, IntPtr afPeakValues);
        void GetHardwareSupportMask(out int pdwHardwareSupportMask);
    }

    public class SessionInfo {
        public int Pid;
        public string ProcessName;
        public string ExePath;
        public int Volume;
        public bool Muted;
    }

    public class PeakInfo {
        public int Pid;
        public float Peak;
    }

    public static class Core {
        const int CLSCTX_ALL = 23;
        const int STATE_EXPIRED = 2;
        static readonly Guid IID_IAudioEndpointVolume = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
        static readonly Guid IID_IAudioSessionManager2 = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
        static readonly Guid IID_IAudioMeterInformation = new Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064");

        static IMMDevice GetDefaultDevice(EDataFlow flow) {
            var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
            IMMDevice device;
            enumerator.GetDefaultAudioEndpoint(flow, ERole.eMultimedia, out device);
            return device;
        }

        static IAudioEndpointVolume GetEndpointVolume(EDataFlow flow) {
            object obj;
            var iid = IID_IAudioEndpointVolume;
            GetDefaultDevice(flow).Activate(ref iid, CLSCTX_ALL, IntPtr.Zero, out obj);
            return (IAudioEndpointVolume)obj;
        }

        // pid + controle de cada sessao ativa (Inactive inclusive -- so pula
        // Expired e a sessao de sons do sistema), uma vez por processo.
        static List<KeyValuePair<int, IAudioSessionControl2>> EnumSessions() {
            object obj;
            var iid = IID_IAudioSessionManager2;
            GetDefaultDevice(EDataFlow.eRender).Activate(ref iid, CLSCTX_ALL, IntPtr.Zero, out obj);
            var mgr = (IAudioSessionManager2)obj;
            IAudioSessionEnumerator sessEnum;
            mgr.GetSessionEnumerator(out sessEnum);

            int count;
            sessEnum.GetCount(out count);
            var seen = new HashSet<int>();
            var result = new List<KeyValuePair<int, IAudioSessionControl2>>();
            for (int i = 0; i < count; i++) {
                try {
                    IAudioSessionControl2 ctl;
                    sessEnum.GetSession(i, out ctl);
                    if (ctl == null) continue;
                    int state;
                    ctl.GetState(out state);
                    if (state == STATE_EXPIRED) continue;
                    if (ctl.IsSystemSoundsSession() == 0) continue; // S_OK (0) = e a sessao de sons do sistema
                    int pid;
                    ctl.GetProcessId(out pid);
                    if (!seen.Add(pid)) continue;
                    result.Add(new KeyValuePair<int, IAudioSessionControl2>(pid, ctl));
                } catch { continue; }
            }
            return result;
        }

        public static float GetMasterVolume() {
            float v;
            GetEndpointVolume(EDataFlow.eRender).GetMasterVolumeLevelScalar(out v);
            return v;
        }

        public static void SetMasterVolume(float level) {
            GetEndpointVolume(EDataFlow.eRender).SetMasterVolumeLevelScalar(level, IntPtr.Zero);
        }

        public static bool GetMasterMute() {
            bool m;
            GetEndpointVolume(EDataFlow.eRender).GetMute(out m);
            return m;
        }

        public static void SetMasterMute(bool mute) {
            GetEndpointVolume(EDataFlow.eRender).SetMute(mute, IntPtr.Zero);
        }

        // Dispositivo de CAPTURA (microfone) em vez de render -- mesma
        // interface (IAudioEndpointVolume), so ativada no device de entrada.
        public static float GetMicVolume() {
            float v;
            GetEndpointVolume(EDataFlow.eCapture).GetMasterVolumeLevelScalar(out v);
            return v;
        }

        public static void SetMicVolume(float level) {
            GetEndpointVolume(EDataFlow.eCapture).SetMasterVolumeLevelScalar(level, IntPtr.Zero);
        }

        public static bool GetMicMute() {
            bool m;
            GetEndpointVolume(EDataFlow.eCapture).GetMute(out m);
            return m;
        }

        public static void SetMicMute(bool mute) {
            GetEndpointVolume(EDataFlow.eCapture).SetMute(mute, IntPtr.Zero);
        }

        public static float GetMicPeak() {
            object obj;
            var iid = IID_IAudioMeterInformation;
            GetDefaultDevice(EDataFlow.eCapture).Activate(ref iid, CLSCTX_ALL, IntPtr.Zero, out obj);
            float peak;
            ((IAudioMeterInformation)obj).GetPeakValue(out peak);
            return peak;
        }

        public static SessionInfo[] GetSessions() {
            var list = new List<SessionInfo>();
            foreach (var kv in EnumSessions()) {
                var simple = (ISimpleAudioVolume)kv.Value;
                float vol;
                simple.GetMasterVolume(out vol);
                bool muted;
                simple.GetMute(out muted);

                string name = "?";
                string exePath = null;
                try {
                    var proc = Process.GetProcessById(kv.Key);
                    name = proc.ProcessName;
                    exePath = proc.MainModule.FileName;
                    var desc = proc.MainModule.FileVersionInfo.FileDescription;
                    if (!string.IsNullOrEmpty(desc)) name = desc;
                } catch { }

                list.Add(new SessionInfo {
                    Pid = kv.Key,
                    ProcessName = name,
                    ExePath = exePath,
                    Volume = (int)Math.Round(vol * 100),
                    Muted = muted
                });
            }
            return list.ToArray();
        }

        public static void SetSessionVolume(int pid, float level) {
            foreach (var kv in EnumSessions()) {
                if (kv.Key != pid) continue;
                ((ISimpleAudioVolume)kv.Value).SetMasterVolume(level, IntPtr.Zero);
                return;
            }
            throw new Exception("sessao de audio nao encontrada pro processo " + pid);
        }

        public static void SetSessionMute(int pid, bool mute) {
            foreach (var kv in EnumSessions()) {
                if (kv.Key != pid) continue;
                ((ISimpleAudioVolume)kv.Value).SetMute(mute, IntPtr.Zero);
                return;
            }
            throw new Exception("sessao de audio nao encontrada pro processo " + pid);
        }

        public static float GetMasterPeak() {
            object obj;
            var iid = IID_IAudioMeterInformation;
            GetDefaultDevice(EDataFlow.eRender).Activate(ref iid, CLSCTX_ALL, IntPtr.Zero, out obj);
            float peak;
            ((IAudioMeterInformation)obj).GetPeakValue(out peak);
            return peak;
        }

        public static PeakInfo[] GetSessionPeaks() {
            var list = new List<PeakInfo>();
            foreach (var kv in EnumSessions()) {
                try {
                    float peak;
                    ((IAudioMeterInformation)kv.Value).GetPeakValue(out peak);
                    list.Add(new PeakInfo { Pid = kv.Key, Peak = peak });
                } catch { }
            }
            return list.ToArray();
        }
    }
}
"@ -ErrorAction Stop

function Get-AudioState {
    $sessions = @([AudioLib.Core]::GetSessions() | ForEach-Object {
        [PSCustomObject]@{
            pid         = $_.Pid
            processName = $_.ProcessName
            exePath     = $_.ExePath
            volume      = $_.Volume
            muted       = $_.Muted
        }
    })

    # Nem toda maquina tem microfone/dispositivo de captura padrao -- se
    # falhar, devolve "available=false" em vez de derrubar o /api/audio
    # inteiro (mesmo padrao "gracioso" do EQ/Voz quando a ferramenta externa
    # nao esta disponivel).
    try {
        $mic = [PSCustomObject]@{
            available = $true
            volume    = [math]::Round([AudioLib.Core]::GetMicVolume() * 100)
            muted     = [AudioLib.Core]::GetMicMute()
        }
    } catch {
        $mic = [PSCustomObject]@{ available = $false; volume = 0; muted = $false }
    }

    [PSCustomObject]@{
        master   = [PSCustomObject]@{
            volume = [math]::Round([AudioLib.Core]::GetMasterVolume() * 100)
            muted  = [AudioLib.Core]::GetMasterMute()
        }
        mic      = $mic
        sessions = $sessions
    }
}

function Set-AudioVolume {
    param(
        [Parameter(Mandatory = $true)][ValidateSet('master', 'mic', 'session')] [string]$Target,
        [int]$ProcessId = 0,
        [Nullable[int]]$Volume = $null,
        [Nullable[bool]]$Muted = $null
    )

    if ($Target -eq 'master') {
        if ($null -ne $Volume) { [AudioLib.Core]::SetMasterVolume([float]($Volume / 100.0)) }
        if ($null -ne $Muted) { [AudioLib.Core]::SetMasterMute($Muted) }
    } elseif ($Target -eq 'mic') {
        if ($null -ne $Volume) { [AudioLib.Core]::SetMicVolume([float]($Volume / 100.0)) }
        if ($null -ne $Muted) { [AudioLib.Core]::SetMicMute($Muted) }
    } else {
        if ($null -ne $Volume) { [AudioLib.Core]::SetSessionVolume($ProcessId, [float]($Volume / 100.0)) }
        if ($null -ne $Muted) { [AudioLib.Core]::SetSessionMute($ProcessId, $Muted) }
    }
}
