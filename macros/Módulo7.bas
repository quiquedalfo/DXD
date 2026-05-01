Attribute VB_Name = "Módulo7"
'========================================================
'  ToggleStatIcon – encender / apagar icono GLOBAL Stat
'  (asignar esta macro a cada shape llamado ico_stat_*)
'========================================================
Option Explicit

Private Const COL_ON  As Long = &H66FF66        ' verde 66 FF 66  (BGR ? &H0066FF66)
Private Const COL_OFF_LINE As Long = vbWhite    ' contorno cuando está apagado

Sub ToggleStatIcon()

    Dim ws As Worksheet: Set ws = ThisWorkbook.Sheets("INPUT")
    Dim shp As Shape:    Set shp = ws.Shapes(Application.Caller)
    
    '¿Estaba ya encendido?
    Dim isActive As Boolean
    isActive = (shp.Fill.Visible And shp.Fill.ForeColor.RGB = COL_ON)
    
    '----------------------------------------------------
    ' 1) Primero apagamos TODOS los iconos globales
    '    (los que cumplen ico_stat_*)
    '----------------------------------------------------
    Dim s As Shape
    For Each s In ws.Shapes
        If s.Name Like "ico_stat_*" Then
            With s
                .Line.ForeColor.RGB = COL_OFF_LINE   ' contorno blanco
                .Fill.Visible = msoFalse             ' sin relleno
            End With
        End If
    Next s
    
    '----------------------------------------------------
    ' 2) Si este icono estaba apagado ? lo encendemos
    '    Si ya estaba encendido ? queda todo apagado
    '----------------------------------------------------
    If Not isActive Then
        With shp
            .Fill.Visible = msoTrue
            .Fill.Solid
            .Fill.ForeColor.RGB = COL_ON            ' relleno verde
            .Line.ForeColor.RGB = COL_ON            ' contorno verde
        End With
        ' (Si quieres, aquí también podrías escribir el Stat
        '  seleccionado en V4 si sigues usando ese esquema)
    End If

End Sub

