// Test-harness-only fallback for Common Item Dialog buttons hidden by framework UIA.
// Never infer a saved export from BM_CLICK: the caller verifies the resulting file.
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class SmokeSaveButton {
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

    private static void CheckWindow(IntPtr window, uint expectedProcess, string expectedClass) {
        uint process;
        if (window == IntPtr.Zero || window == new IntPtr(0xffff) || expectedProcess == 0 ||
            GetWindowThreadProcessId(window, out process) == 0 || process != expectedProcess)
            throw new InvalidOperationException("The Save control is not owned by the smoke application.");
        var name = new StringBuilder(128);
        if (GetClassNameW(window, name, name.Capacity) == 0 ||
            !String.Equals(name.ToString(), expectedClass, StringComparison.Ordinal) ||
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

    public static void Click(IntPtr dialog, uint process) {
        Validate(dialog, process);
        // BM_CLICK may fail on an inactive dialog. Activate only the verified
        // owned dialog, never an unrelated foreground window or keyboard target.
        SetForegroundWindow(dialog);
        if (GetForegroundWindow() != dialog)
            throw new InvalidOperationException("The verified Save dialog could not be activated.");
        IntPtr button = Validate(dialog, process);
        UIntPtr ignored;
        // BM_CLICK has no return value. The API return only confirms that the
        // bounded message dispatch completed. The dialog can close during it,
        // so ERRORONEXIT must not turn that expected destruction into a failure.
        if (ClickMessage(button, 0x00F5, UIntPtr.Zero, IntPtr.Zero, 0x0001 | 0x0002, 1500, out ignored) == IntPtr.Zero)
            throw new InvalidOperationException("Dispatch to the verified Save button failed or timed out.");
    }
}
