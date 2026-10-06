param([long]$WindowHandle)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class RMTaskbarProperties {
  [StructLayout(LayoutKind.Sequential)] public struct PropertyKey { public Guid format; public uint id; }
  [StructLayout(LayoutKind.Explicit, Size=24)] public struct PropVariant {
    [FieldOffset(0)] public ushort type;
    [FieldOffset(8)] public IntPtr value;
  }
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore {
    [PreserveSig] int GetCount(out uint count);
    [PreserveSig] int GetAt(uint index, out PropertyKey key);
    [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
    [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
    [PreserveSig] int Commit();
  }
  [DllImport("shell32.dll", PreserveSig=true)] static extern int SHGetPropertyStoreForWindow(IntPtr window, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant value);
  public static string Keys(long window) {
    Guid iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"); IPropertyStore store;
    Marshal.ThrowExceptionForHR(SHGetPropertyStoreForWindow(new IntPtr(window), ref iid, out store));
    try {
      uint count; Marshal.ThrowExceptionForHR(store.GetCount(out count)); string result = "";
      for (uint i = 0; i < count; i++) { PropertyKey key; Marshal.ThrowExceptionForHR(store.GetAt(i, out key)); result += key.format + ":" + key.id + ";"; }
      return result;
    } finally { Marshal.ReleaseComObject(store); }
  }
  public static string Read(long window, uint id) {
    Guid iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"); IPropertyStore store;
    Marshal.ThrowExceptionForHR(SHGetPropertyStoreForWindow(new IntPtr(window), ref iid, out store));
    try {
      var key = new PropertyKey { format = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), id=id };
      PropVariant value; Marshal.ThrowExceptionForHR(store.GetValue(ref key, out value));
      try { return value.type == 31 ? Marshal.PtrToStringUni(value.value) : value.type == 8 ? Marshal.PtrToStringBSTR(value.value) : "VT:" + value.type; }
      finally { PropVariantClear(ref value); }
    } finally { Marshal.ReleaseComObject(store); }
  }
}
'@
[ordered]@{
  keys = [RMTaskbarProperties]::Keys($WindowHandle)
  relaunchCommand = [RMTaskbarProperties]::Read($WindowHandle, 2)
  relaunchIcon = [RMTaskbarProperties]::Read($WindowHandle, 3)
  relaunchDisplayName = [RMTaskbarProperties]::Read($WindowHandle, 4)
  appId = [RMTaskbarProperties]::Read($WindowHandle, 5)
} | ConvertTo-Json -Compress
