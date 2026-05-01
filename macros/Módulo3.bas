Attribute VB_Name = "Módulo3"
' ------------------------
'  FISH
' ------------------------
Sub AddFichaFish()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets("TABLAS")
    
    Dim currentVal As Long
    currentVal = ws.Range("B2").Value   ' Fichas de "Fish" (fila 2)
    ws.Range("B2").Value = currentVal + 1
End Sub

Sub SubFichaFish()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets("TABLAS")
    
    Dim currentVal As Long
    currentVal = ws.Range("B2").Value
    If currentVal > 0 Then
        ws.Range("B2").Value = currentVal - 1
    End If
End Sub


' ------------------------
'  JOAKING
' ------------------------
Sub AddFichaJoaking()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets("TABLAS")
    
    Dim currentVal As Long
    currentVal = ws.Range("B3").Value  ' Fichas de "Joaking" (fila 3)
    ws.Range("B3").Value = currentVal + 1
End Sub

Sub SubFichaJoaking()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets("TABLAS")
    
    Dim currentVal As Long
    currentVal = ws.Range("B3").Value
    If currentVal > 0 Then
        ws.Range("B3").Value = currentVal - 1
    End If
End Sub


' ------------------------
'  TITO
' ------------------------
Sub AddFichaTito()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets("TABLAS")
    
    Dim currentVal As Long
    currentVal = ws.Range("B4").Value  ' Fichas de "Tito" (fila 4)
    ws.Range("B4").Value = currentVal + 1
End Sub

Sub SubFichaTito()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets("TABLAS")
    
    Dim currentVal As Long
    currentVal = ws.Range("B4").Value
    If currentVal > 0 Then
        ws.Range("B4").Value = currentVal - 1
    End If
End Sub


' ------------------------
'  LORENZO
' ------------------------
Sub AddFichaLorenzo()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets("TABLAS")
    
    Dim currentVal As Long
    currentVal = ws.Range("B5").Value  ' Fichas de "Lorenzo" (fila 5)
    ws.Range("B5").Value = currentVal + 1
End Sub

Sub SubFichaLorenzo()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets("TABLAS")
    
    Dim currentVal As Long
    currentVal = ws.Range("B5").Value
    If currentVal > 0 Then
        ws.Range("B5").Value = currentVal - 1
    End If
End Sub


' ------------------------
'  JUNG
' ------------------------
Sub AddFichaJung()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets("TABLAS")
    
    Dim currentVal As Long
    currentVal = ws.Range("B6").Value  ' Fichas de "Jung" (fila 6)
    ws.Range("B6").Value = currentVal + 1
End Sub

Sub SubFichaJung()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets("TABLAS")
    
    Dim currentVal As Long
    currentVal = ws.Range("B6").Value
    If currentVal > 0 Then
        ws.Range("B6").Value = currentVal - 1
    End If
End Sub

