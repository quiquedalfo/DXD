Attribute VB_Name = "Módulo4"
Sub FlushFichas()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets("TABLAS")
    
    ' Este rango (B2:B6) es donde guardas las fichas de cada personaje.
    ' Ajusta si tu tabla está en otras celdas.
    ws.Range("B2:B6").Value = 0
    
    MsgBox "¡Todas las fichas se han seteado a 0!", vbInformation
End Sub

