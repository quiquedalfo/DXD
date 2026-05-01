Attribute VB_Name = "Módulo5"
'========================================================
'  MÓDULO  :   Estrellas Importantes
'========================================================
Option Explicit

'--- Cambia color y flag (0->1 ó 1->0) ------------------
Sub ToggleStar(shapeName As String, flagCell As Range)

    Dim wsIn As Worksheet
    Set wsIn = ThisWorkbook.Sheets("INPUT")
    
    Dim sh As Shape
    Set sh = wsIn.Shapes(shapeName)
    
    Dim flag As Long
    flag = CLng(flagCell.Value)     ' 0 = apagado, 1 = encendido
    
    If flag = 0 Then
        ' ENCENDER  (relleno dorado)
        sh.Fill.ForeColor.RGB = RGB(255, 215, 0)   ' gold
        flagCell.Value = 1
    Else
        ' APAGAR  (relleno negro)
        sh.Fill.ForeColor.RGB = RGB(0, 0, 0)
        flagCell.Value = 0
    End If
End Sub


'------------  Una macro por estrella  ------------------
Sub StarFish_Click()
    ToggleStar "StarFish", Sheets("TABLAS").Range("B27")
End Sub

Sub StarJoaking_Click()
    ToggleStar "StarJoaking", Sheets("TABLAS").Range("B28")
End Sub

Sub StarTito_Click()
    ToggleStar "StarTito", Sheets("TABLAS").Range("B29")
End Sub

Sub StarLorenzo_Click()
    ToggleStar "StarLorenzo", Sheets("TABLAS").Range("B30")
End Sub

Sub StarJung_Click()
    ToggleStar "StarJung", Sheets("TABLAS").Range("B31")
End Sub

