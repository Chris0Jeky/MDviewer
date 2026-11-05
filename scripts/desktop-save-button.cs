// Test-harness-only bridge for Common Item Dialog controls hidden by framework UIA.
// The parent identifies the owned "Save export" dialog. Every native operation
// revalidates that dialog and its exact controls. Saved-file bytes remain the gate.
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
    [DllImport("user32.dll", ExactSpelling = true)] private static extern int GetWindowLongW(IntPtr window, int index);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", ExactSpelling = true)]
    private static extern IntPtr SendMessage(IntPtr window, uint message, UIntPtr wParam,
        IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
    [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern IntPtr SetText(IntPtr window, uint message, UIntPtr wParam,
        string text, uint flags, uint timeout, out UIntPtr result);
    [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern IntPtr GetText(IntPtr window, uint message, UIntPtr wParam,
        StringBuilder text, uint flags, uint timeout, out UIntPtr result);

    private const uint Flags = 0x0001 | 0x0002; // BLOCK | ABORTIFHUNG
    private const uint Timeout = 1500;

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

    private static void CheckFilename(IntPtr dialog, uint process, IntPtr edit) {
        IntPtr host = GetParent(edit);
        IntPtr sink = GetParent(host);
        CheckWindow(dialog, process, "#32770");
        CheckWindow(edit, process, "Edit");
        CheckWindow(host, process, "ComboBox");
        CheckWindow(sink, process, "FloatNotifySink");
        if (GetDlgCtrlID(edit) != 1001 || !IsChild(dialog, sink) || !IsChild(dialog, edit) ||
            GetParent(edit) != host || GetParent(host) != sink)
            throw new InvalidOperationException("The filename target is outside the verified dialog's native host.");
        int style = GetWindowLongW(edit, -16); // GWL_STYLE; ES_READONLY must be absent.
        if (style == 0 || (style & 0x0800) != 0)
            throw new InvalidOperationException("The filename Edit is read-only or its style is unavailable.");
    }

    public static IntPtr ValidateFilename(IntPtr dialog, uint process) {
        CheckWindow(dialog, process, "#32770");
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
        CheckFilename(dialog, process, matches[0]);
        return matches[0];
    }

    private static void VerifyText(IntPtr edit, string text) {
        UIntPtr outcome;
        // Extra capacity detects a longer value sharing the requested prefix.
        var readback = new StringBuilder(text.Length + 2);
        if (GetText(edit, 0x000D, new UIntPtr((uint)readback.Capacity), readback,
            Flags | 0x0020, Timeout, out outcome) == IntPtr.Zero ||
            outcome.ToUInt64() != (ulong)text.Length || !String.Equals(readback.ToString(), text, StringComparison.Ordinal))
            throw new InvalidOperationException("The filename Edit did not return the exact requested export path.");
    }

    public static IntPtr SetFilename(IntPtr dialog, uint process, string text) {
        if (String.IsNullOrEmpty(text) || text.Length > 32760 || text.IndexOf('\0') >= 0)
            throw new InvalidOperationException("The smoke export path is empty or exceeds the filename-field bound.");
        IntPtr edit = ValidateFilename(dialog, process);
        UIntPtr outcome;
        if (SetText(edit, 0x000C, UIntPtr.Zero, text, Flags | 0x0020, Timeout, out outcome) == IntPtr.Zero || outcome == UIntPtr.Zero)
            throw new InvalidOperationException("The verified filename Edit rejected WM_SETTEXT or timed out.");
        CheckFilename(dialog, process, edit);
        VerifyText(edit, text);
        // Readback alone does not establish that the shell filename model consumed
        // the edit. Notify only the verified ComboBox's own parent. This path
        // completed exact-byte Markdown saving in native run 39786113293.
        // https://learn.microsoft.com/windows/win32/controls/cbn-editchange
        IntPtr host = GetParent(edit);
        IntPtr sink = GetParent(host);
        int id = GetDlgCtrlID(host);
        if (id < 0 || id > 65535) throw new InvalidOperationException("The filename host ID is invalid.");
        uint command = ((uint)5 << 16) | (uint)id; // CBN_EDITCHANGE via WM_COMMAND
        if (SendMessage(sink, 0x0111, new UIntPtr(command), host, Flags, Timeout, out outcome) == IntPtr.Zero)
            throw new InvalidOperationException("The filename-change notification failed or timed out.");
        CheckFilename(dialog, process, edit);
        VerifyText(edit, text);
        return edit;
    }

    public static void Click(IntPtr dialog, uint process) {
        Validate(dialog, process);
        // BM_CLICK may fail on an inactive dialog. Activate only the owned target.
        SetForegroundWindow(dialog);
        if (GetForegroundWindow() != dialog)
            throw new InvalidOperationException("The verified Save dialog could not be activated.");
        IntPtr button = Validate(dialog, process);
        UIntPtr ignored;
        // BM_CLICK has no return value. Only dispatch completion is checked here;
        // dialog destruction is expected. Exact saved-file bytes are checked later.
        if (SendMessage(button, 0x00F5, UIntPtr.Zero, IntPtr.Zero, Flags, Timeout, out ignored) == IntPtr.Zero)
            throw new InvalidOperationException("Dispatch to the verified Save button failed or timed out.");
    }
}
