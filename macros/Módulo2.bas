Attribute VB_Name = "Módulo2"
'========================================================
'  CopiarStatYCheck  (v4)
'  • Iconos ON  = relleno + contorno verde  (#66FF66)
'  • Iconos OFF = sin relleno + contorno blanco
'========================================================
Option Explicit

Private Const COL_ON_FILL  As Long = &H66FF66      ' verde 66 FF 66
Private Const COL_ON_LINE  As Long = &H66FF66
Private Const COL_OFF_LINE As Long = vbWhite       ' contorno blanco

Sub CopiarStatYCheck()

    Dim ws As Worksheet: Set ws = ThisWorkbook.Sheets("INPUT")
    
    '------------------------------------------------------
    ' 1) Detectar si hay un icono GLOBAL (ico_stat_*) activo
    '------------------------------------------------------
    Dim shp As Shape, selectedStat As String, hasStat As Boolean
    
    For Each shp In ws.Shapes
        If shp.Name Like "ico_stat_*" Then
            If shp.Fill.Visible And shp.Fill.ForeColor.RGB = COL_ON_FILL Then
                selectedStat = Mid$(shp.Name, 10)   ' «Brains», «Charm», etc.
                hasStat = True
                Exit For
            End If
        End If
    Next shp
    
    '------------------------------------------------------
    ' 2) Apagar TODOS los iconos (globales + individuales)
    '------------------------------------------------------
    For Each shp In ws.Shapes
        If shp.Name Like "ico_*" Then
            With shp
                .Fill.Visible = msoFalse
                .Line.ForeColor.RGB = COL_OFF_LINE
            End With
        End If
    Next shp
    
    '------------------------------------------------------
    ' 3) Leer el CHECK (X4)
    '------------------------------------------------------
    Dim checkVal As Variant: checkVal = ws.Range("X4").Value
    
    ' Rangos STAT y CHECK por personaje
    Dim statRng(4) As String, chkRng(4) As String, pj(4) As String
    statRng(0) = "B6:D6": chkRng(0) = "B8": pj(0) = "Fish"
    statRng(1) = "F6:H6": chkRng(1) = "F8": pj(1) = "Joaking"
    statRng(2) = "J6:L6": chkRng(2) = "J8": pj(2) = "Jung"
    statRng(3) = "N6:P6": chkRng(3) = "N8": pj(3) = "Lorenzo"
    statRng(4) = "R6:T6": chkRng(4) = "R8": pj(4) = "Tito"
    
    '------------------------------------------------------
    ' 4) Procesar los 5 bloques
    '------------------------------------------------------
    Dim i As Long, icoName As String
    
    For i = 0 To 4
    
        '— siempre copiamos el CHECK —
        ws.Range(chkRng(i)).Value = checkVal
        
        If hasStat Then
            '— copiar Stat —
            ws.Range(statRng(i)).Value = selectedStat
            
            '— encender icono individual —
            icoName = "ico_" & pj(i) & "_" & selectedStat   ' ej. ico_Fish_Brains
            On Error Resume Next
            With ws.Shapes(icoName)
                .Fill.Visible = msoTrue
                .Fill.Solid
                .Fill.ForeColor.RGB = COL_ON_FILL
                .Line.ForeColor.RGB = COL_ON_LINE
            End With
            On Error GoTo 0
            
        Else
            '— sin Stat global: vaciar Stat —
            ws.Range(statRng(i)).ClearContents
        End If
    Next i
    
    '------------------------------------------------------
    ' 5) Limpiar X4 y dejar globales apagados
    '------------------------------------------------------
    ws.Range("X4").ClearContents
    '  (los globales ya quedaron OFF en el paso 2)

End Sub

