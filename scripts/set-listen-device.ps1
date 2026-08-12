# Liga/desliga "Listen to this device" (aba Listen das propriedades de um
# dispositivo de gravacao no Painel de Controle de Som) via COM, sem precisar
# abrir dialogo nenhum. Usado pra configurar o roteamento de audio do
# VB-Cable (mic real -> CABLE Input, CABLE Output -> saida padrao) de forma
# que o soundboard do rigdeck (que toca no dispositivo padrao) saia
# misturado com a voz do usuario pra quem estiver ouvindo (Discord/call).
#
# Mecanismo: IMMDevice.OpenPropertyStore(STGM_READWRITE) + IPropertyStore.SetValue
# na PROPERTYKEY {24DBB0FC-9311-4B3D-9CF0-18FF155639D4} -- pid 1 e o checkbox
# "Listen to this device" (VT_BOOL), pid 0 e o dispositivo de destino
# (VT_LPWSTR com o ID do dispositivo de saida, ou VT_EMPTY pra "dispositivo
# padrao"). Nao documentado oficialmente pela Microsoft, mas confirmado por
# multiplas fontes independentes (Stack Overflow, reverseengineering.SE,
# pycaw) com exemplos funcionais em C++/Python -- mesmo nivel de confianca
# que os outros COM interops desse projeto (Core Audio API tambem so tem doc
# C++, nada oficial pra scripting).
param(
    [Parameter(Mandatory = $true)][string]$CaptureDevice,
    [switch]$Disable,
    [string]$PlaybackTarget = ''
)
$Enable = -not $Disable

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace ListenLib {
    public enum EDataFlow { eRender = 0, eCapture = 1, eAll = 2 }
    internal enum ERole { eConsole = 0, eMultimedia = 1, eCommunications = 2 }

    [StructLayout(LayoutKind.Sequential)]
    internal struct PropertyKeyStruct {
        public Guid fmtid;
        public int pid;
    }

    [StructLayout(LayoutKind.Explicit)]
    internal struct PROPVARIANT {
        [FieldOffset(0)] public short vt;
        [FieldOffset(8)] public short boolVal;
        [FieldOffset(8)] public IntPtr pwszVal;
    }

    [Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IPropertyStore {
        void GetCount(out int cProps);
        void GetAt(int iProp, out PropertyKeyStruct pkey);
        void GetValue(ref PropertyKeyStruct key, out PROPVARIANT pv);
        void SetValue(ref PropertyKeyStruct key, ref PROPVARIANT pv);
        void Commit();
    }

    [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDevice {
        void Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
        void OpenPropertyStore(int stgmAccess, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore ppProperties);
        void GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
        void GetState(out int pdwState);
    }

    [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDeviceCollection {
        void GetCount(out int pcDevices);
        void Item(int nDevice, [MarshalAs(UnmanagedType.Interface)] out IMMDevice ppDevice);
    }

    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDeviceEnumerator {
        void EnumAudioEndpoints(EDataFlow dataFlow, int dwStateMask, [MarshalAs(UnmanagedType.Interface)] out IMMDeviceCollection ppDevices);
        void GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, [MarshalAs(UnmanagedType.Interface)] out IMMDevice ppEndpoint);
        void GetDevice([MarshalAs(UnmanagedType.LPWStr)] string pwstrId, [MarshalAs(UnmanagedType.Interface)] out IMMDevice ppDevice);
        void RegisterEndpointNotificationCallback(IntPtr pClient);
        void UnregisterEndpointNotificationCallback(IntPtr pClient);
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    internal class MMDeviceEnumeratorComObject { }

    public static class Core {
        const int STGM_READ = 0;
        const int STGM_READWRITE = 2;
        const int DEVICE_STATE_ACTIVE = 1;
        static readonly Guid PKEY_FriendlyName_fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0");
        const int PKEY_FriendlyName_pid = 14;
        static readonly Guid PKEY_Listen_fmtid = new Guid("24DBB0FC-9311-4B3D-9CF0-18FF155639D4");
        const short VT_EMPTY = 0;
        const short VT_BOOL = 11;
        const short VT_LPWSTR = 31;

        static List<IMMDevice> EnumDevices(EDataFlow flow) {
            var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
            IMMDeviceCollection collection;
            enumerator.EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE, out collection);
            int count;
            collection.GetCount(out count);
            var list = new List<IMMDevice>();
            for (int i = 0; i < count; i++) {
                IMMDevice dev;
                collection.Item(i, out dev);
                list.Add(dev);
            }
            return list;
        }

        static string GetFriendlyName(IMMDevice dev) {
            IPropertyStore store;
            dev.OpenPropertyStore(STGM_READ, out store);
            var key = new PropertyKeyStruct { fmtid = PKEY_FriendlyName_fmtid, pid = PKEY_FriendlyName_pid };
            PROPVARIANT pv;
            store.GetValue(ref key, out pv);
            return pv.vt == VT_LPWSTR ? Marshal.PtrToStringUni(pv.pwszVal) : "";
        }

        public static string[] ListDeviceNames(EDataFlow flow) {
            var names = new List<string>();
            foreach (var dev in EnumDevices(flow)) names.Add(GetFriendlyName(dev));
            return names.ToArray();
        }

        static IMMDevice FindByName(EDataFlow flow, string nameContains) {
            foreach (var dev in EnumDevices(flow)) {
                if (GetFriendlyName(dev).IndexOf(nameContains, StringComparison.OrdinalIgnoreCase) >= 0) return dev;
            }
            return null;
        }

        public static void SetListen(string captureDeviceNameContains, bool enable, string playbackTargetNameContains) {
            var dev = FindByName(EDataFlow.eCapture, captureDeviceNameContains);
            if (dev == null) throw new Exception("dispositivo de captura nao encontrado: " + captureDeviceNameContains);

            IPropertyStore store;
            dev.OpenPropertyStore(STGM_READWRITE, out store);

            // Ordem importa na pratica (confirmado testando: sem isso o valor
            // nao persistia) -- seta o dispositivo de destino ANTES de ligar o
            // checkbox, e chama Commit() explicito no final. A documentacao
            // encontrada dizia que Commit "parece nao ser necessario", mas
            // nessa maquina sem ele o SetValue nao lancava erro e mesmo assim
            // nao gravava nada (confirmado lendo de volta com GetValue).
            if (enable) {
                var targetKey = new PropertyKeyStruct { fmtid = PKEY_Listen_fmtid, pid = 0 };
                PROPVARIANT targetVal;
                IntPtr allocated = IntPtr.Zero;
                if (string.IsNullOrEmpty(playbackTargetNameContains)) {
                    targetVal = new PROPVARIANT { vt = VT_EMPTY };
                } else {
                    var targetDev = FindByName(EDataFlow.eRender, playbackTargetNameContains);
                    if (targetDev == null) throw new Exception("dispositivo de saida nao encontrado: " + playbackTargetNameContains);
                    string targetId;
                    targetDev.GetId(out targetId);
                    allocated = Marshal.StringToCoTaskMemUni(targetId);
                    targetVal = new PROPVARIANT { vt = VT_LPWSTR, pwszVal = allocated };
                }
                store.SetValue(ref targetKey, ref targetVal);
                if (allocated != IntPtr.Zero) Marshal.FreeCoTaskMem(allocated);
            }

            var checkboxKey = new PropertyKeyStruct { fmtid = PKEY_Listen_fmtid, pid = 1 };
            var checkboxVal = new PROPVARIANT { vt = VT_BOOL, boolVal = (short)(enable ? -1 : 0) };
            store.SetValue(ref checkboxKey, ref checkboxVal);

            store.Commit();
        }
    }
}
"@ -ErrorAction Stop

try {
    [ListenLib.Core]::SetListen($CaptureDevice, $Enable, $PlaybackTarget)
    Write-Output (@{ ok = $true } | ConvertTo-Json -Compress)
} catch {
    Write-Output (@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress)
}
