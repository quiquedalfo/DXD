Attribute VB_Name = "Módulo6"
'========================================================
'  MÓDULO  :   Iconos de STAT  (toggle ON/OFF + contorno)
'========================================================
Option Explicit

'--- Colores --------------------------------------------
Private Const COL_ON As Long = &H66FF66        ' verde  #66FF66  (BGR ? &H0066FF66)
Private Const COL_OFF_LINE As Long = vbWhite   ' contorno cuando está apagado

'========================================================
'        Helpers para deducir bloque / stat
'========================================================
Private Function StatFromShape(shapeName As String) As String
    ' "ico_Fish_Brains"  ?  "Brains"
    StatFromShape = Split(shapeName, "_")(2)
End Function

Private Function BlockIndexFromShape(shapeName As String) As Long
    Select Case Split(shapeName, "_")(1)
        Case "Fish":     BlockIndexFromShape = 0
        Case "Joaking":  BlockIndexFromShape = 1
        Case "Jung":     BlockIndexFromShape = 2
        Case "Lorenzo":  BlockIndexFromShape = 3
        Case "Tito":     BlockIndexFromShape = 4
        Case Else:       BlockIndexFromShape = -1
    End Select
End Function

'========================================================
'      Macro única para ASIGNAR a *todos* los iconos
'========================================================
Sub SelectStatIcon()

    Dim ws As Worksheet: Set ws = ActiveSheet
    Dim shp As Shape:    Set shp = ws.Shapes(Application.Caller)
    
    Dim statName As String: statName = StatFromShape(shp.Name)
    Dim idx As Long: idx = BlockIndexFromShape(shp.Name)      ' 0..4
    If idx < 0 Then Exit Sub                                  ' nombre inesperado
    
    ' Prefijo para detectar “hermanos” del mismo PJ
    Dim pfx As String
    pfx = Split(shp.Name, "_")(0) & "_" & Split(shp.Name, "_")(1) & "_"
    
    ' ¿El icono clicado ya estaba activo?
    Dim isActive As Boolean
    isActive = (shp.Fill.Visible And shp.Fill.ForeColor.RGB = COL_ON)
    
    '------------------------------------------------------
    ' 1) Apagamos *todos* los iconos del bloque
    '     • contorno blanco
    '     • SIN relleno (.Visible = False)
    '------------------------------------------------------
    Dim s As Shape
    For Each s In ws.Shapes
        If Left$(s.Name, Len(pfx)) = pfx Then
            With s
                .Line.ForeColor.RGB = COL_OFF_LINE
                .Fill.Visible = msoFalse
            End With
        End If
    Next s
    
    ' Celda combinada con el Stat (fila 6, tres columnas)
    Dim colStart As Long: colStart = 1 + idx * 4              ' 1=A,5=E,9=I…
    Dim statRange As Range
    Set statRange = ws.Range(ws.Cells(6, colStart + 1), _
                              ws.Cells(6, colStart + 3))
    
    '------------------------------------------------------
    ' 2) Encendemos o apagamos el icono clicado
    '------------------------------------------------------
    If isActive Then
        ' --- toggle OFF ---
        statRange.ClearContents
        ' (el icono ya quedó apagado en el bucle anterior)
    Else
        ' --- toggle ON ---
        With shp
            .Fill.Visible = msoTrue
            .Fill.Solid
            .Fill.ForeColor.RGB = COL_ON
            .Line.ForeColor.RGB = COL_ON
        End With
        statRange.Value = statName
    End If

End Sub


