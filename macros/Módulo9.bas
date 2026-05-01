Attribute VB_Name = "Módulo9"
Public Sub ResetSecretCounter()
    On Error Resume Next
    ThisWorkbook.Names("SecretCounterClicks").RefersTo = "=0"
    On Error GoTo 0
    MsgBox "¡Contador reiniciado a cero!", vbInformation, "Reset Contador"
End Sub

