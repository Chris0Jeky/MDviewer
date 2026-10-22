// Test-harness-only fallback for Common Item Dialog buttons hidden by framework UIA.
// Never infer a saved export from BM_CLICK: the caller verifies the resulting file.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class SmokeSaveButton {
    private delegate bool EnumWindow(IntPtr window, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumWindow callback, IntPtr data);
    [DllImport("user32.dll")] private static extern bool IsChild(IntPtr parent, IntPtr child);
    [DllImport("user32.dll")] private static extern IntPtr GetDlgItem(IntPtr parent, int id);
    [DllImport("user32.dll")] private static extern IntPtr GetParent(IntPtr window);
    [DllImport("user32.dll")] private static extern int GetDlgCtrlID(IntPtr window);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int GetClassNameW(IntPtr window, StringBuilder name, int count);
    [DllImport("user32.dll")] private static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", ExactSpelling = true)]
    private static extern IntPtr ClickMessage(IntPtr window, uint message, UIntPtr wParam,
        IntPtr lParam, uint flags, uint timeout, out UIntPtr result);

    private static string ClassName(IntPtr window) {
        var name = new StringBuilder(128);
        if (GetClassNameW(window, name, name.Capacity) == 0)
            throw new InvalidOperationException("The native control class is unavailable.");
        return name.ToString();
    }

    private static void CheckWindow(IntPtr window, uint expectedProcess, string expectedClass) {
        uint process;
        if (window == IntPtr.Zero || window == new IntPtr(0xffff) || expectedProcess == 0 ||
            GetWindowThreadProcessId(window, out process) == 0 || process != expectedProcess)
            throw new InvalidOperationException("The Save control is not owned by the smoke application.");
        if (!String.Equals(ClassName(window), expectedClass, StringComparison.Ordinal) ||
            !IsWindowEnabled(window) || !IsWindowVisible(window))
            throw new InvalidOperationException("The Save control's native class, visibility or enabled state did not match.");
    }

    public static IntPtr Validate(IntPtr dialog, uint process) {
        CheckWindow(dialog, process, "#32770");
        IntPtr button = GetDlgItem(dialog, 1);
        CheckWindow(button, process, "Button");
        if (GetParent(button) != dialog || GetDlgCtrlID(button) != 1)
            throw new InvalidOperationException("The Save button is not the verified dialog's direct ID 1 child.");
        return button;
    }

    private static void NotifyFilenameChange(IntPtr dialog, uint process) {
        // A native Edit's WM_SETTEXT/readback does not establish that the shell
        // filename model consumed that value. Notify the exact observed native
        // ComboBox parent using the documented CBN_EDITCHANGE/WM_COMMAND shape.
        // https://learn.microsoft.com/windows/win32/controls/cbn-editchange
        var matches = new List<IntPtr>();
        int count = 0;
        EnumWindow collect = delegate(IntPtr window, IntPtr unused) {
            if (++count > 256) return false;
            if (GetDlgCtrlID(window) == 1001 && IsWindowVisible(window) &&
                String.Equals(ClassName(window), "Edit", StringComparison.Ordinal)) matches.Add(window);
            return true;
        };
        EnumChildWindows(dialog, collect, IntPtr.Zero);
        if (count > 256 || matches.Count != 1)
            throw new InvalidOperationException("The dialog has no unique bounded filename Edit/1001.");
        IntPtr edit = matches[0];
        IntPtr host = GetParent(edit);
        IntPtr sink = GetParent(host);
        CheckWindow(dialog, process, "#32770");
        CheckWindow(edit, process, "Edit");
        CheckWindow(host, process, "ComboBox");
        CheckWindow(sink, process, "FloatNotifySink");
        if (!IsChild(dialog, sink) || !IsChild(dialog, edit) || GetParent(edit) != host || GetParent(host) != sink)
            throw new InvalidOperationException("The filename notification target is outside the verified dialog.");
        int id = GetDlgCtrlID(host);
        if (id < 0 || id > 65535) throw new InvalidOperationException("The filename host ID is invalid.");
        UIntPtr ignored;
        uint command = ((uint)5 << 16) | (uint)id; // CBN_EDITCHANGE
        if (ClickMessage(sink, 0x0111, new UIntPtr(command), host, 0x0001 | 0x0002, 1500, out ignored) == IntPtr.Zero)
            throw new InvalidOperationException("The filename-change notification failed or timed out.");
        Validate(dialog, process);
    }

    public static void Click(IntPtr dialog, uint process) {
        Validate(dialog, process);
        // BM_CLICK may fail on an inactive dialog. Activate only the verified
        // owned dialog, never an unrelated foreground window or keyboard target.
        SetForegroundWindow(dialog);
        if (GetForegroundWindow() != dialog)
            throw new InvalidOperationException("The verified Save dialog could not be activated.");
        NotifyFilenameChange(dialog, process);
        IntPtr button = Validate(dialog, process);
        UIntPtr ignored;
        // BM_CLICK has no return value. The API return only confirms that the
        // bounded message dispatch completed. The dialog can close during it,
        // so ERRORONEXIT must not turn that expected destruction into a failure.
        if (ClickMessage(button, 0x00F5, UIntPtr.Zero, IntPtr.Zero, 0x0001 | 0x0002, 1500, out ignored) == IntPtr.Zero)
            throw new InvalidOperationException("Dispatch to the verified Save button failed or timed out.");
    }
}
