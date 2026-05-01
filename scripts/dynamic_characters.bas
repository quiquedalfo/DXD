Option Explicit

' ========================================================
' Dynamic DXD/Kids on Bikes helpers
' Goal: variable number of characters without hardcoded names
' ========================================================
'
' Convention proposed:
' - TABLAS!A2:A?   => character names (variable length)
' - TABLAS!B2:B?   => fichas for each character
' - INPUT character block width = 4 columns
' - INPUT first block template starts at B:E
' - Shapes inside block use names with suffix _IDX (example: addFicha_1)
'
' IMPORTANT:
' 1) Keep your original workbook as backup before replacing macros.
' 2) Test on a copy because shapes/macros are tightly coupled.
'

Private Const SH_INPUT As String = "INPUT"
Private Const SH_TABLAS As String = "TABLAS"
Private Const FIRST_NAME_ROW As Long = 2
Private Const FIRST_BLOCK_COL As Long = 2  ' B
Private Const BLOCK_WIDTH As Long = 4      ' B:E, F:I, J:M ...


Public Sub AddFichaDyn()
    UpdateFichaByCaller 1
End Sub


Public Sub SubFichaDyn()
    UpdateFichaByCaller -1
End Sub


Private Sub UpdateFichaByCaller(ByVal delta As Long)
    Dim wsTb As Worksheet
    Set wsTb = ThisWorkbook.Sheets(SH_TABLAS)

    Dim callerName As String
    callerName = CStr(Application.Caller)

    Dim idx As Long
    idx = ExtractTrailingIndex(callerName)
    If idx <= 0 Then Exit Sub

    Dim rowTb As Long
    rowTb = FIRST_NAME_ROW + idx - 1

    Dim cur As Long
    cur = CLng(Val(wsTb.Cells(rowTb, 2).Value))

    If delta < 0 And cur <= 0 Then Exit Sub
    wsTb.Cells(rowTb, 2).Value = cur + delta
End Sub


Public Sub RebuildInputCharacters()
    Dim wsIn As Worksheet, wsTb As Worksheet
    Set wsIn = ThisWorkbook.Sheets(SH_INPUT)
    Set wsTb = ThisWorkbook.Sheets(SH_TABLAS)

    Dim n As Long
    n = CharacterCount()
    If n <= 0 Then
        MsgBox "No hay personajes en TABLAS!A2:A", vbExclamation
        Exit Sub
    End If

    Application.ScreenUpdating = False
    Application.EnableEvents = False

    On Error GoTo SafeExit

    ' 1) Limpiar bloques extra a la derecha (si existen)
    ClearBlocksAfter wsIn, n

    ' 2) Asegurar N bloques usando copia del bloque base B:E
    Dim i As Long
    For i = 2 To n
        CopyTemplateBlock wsIn, i
    Next i

    ' 3) Poner nombre del personaje en fila 5 de cada bloque
    For i = 1 To n
        Dim c0 As Long
        c0 = FIRST_BLOCK_COL + (i - 1) * BLOCK_WIDTH
        wsIn.Cells(5, c0).Value = wsTb.Cells(FIRST_NAME_ROW + i - 1, 1).Value
    Next i

SafeExit:
    Application.EnableEvents = True
    Application.ScreenUpdating = True

    If Err.Number <> 0 Then
        MsgBox "Error al reconstruir bloques: " & Err.Description, vbCritical
    End If
End Sub


Private Sub CopyTemplateBlock(ByVal ws As Worksheet, ByVal idx As Long)
    Dim src As Range, dst As Range
    Set src = ws.Range(ws.Cells(1, FIRST_BLOCK_COL), ws.Cells(47, FIRST_BLOCK_COL + BLOCK_WIDTH - 1))

    Dim colStart As Long
    colStart = FIRST_BLOCK_COL + (idx - 1) * BLOCK_WIDTH
    Set dst = ws.Range(ws.Cells(1, colStart), ws.Cells(47, colStart + BLOCK_WIDTH - 1))

    src.Copy
    dst.PasteSpecial xlPasteAll
    Application.CutCopyMode = False

    RelinkShapesForBlock ws, idx
End Sub


Private Sub RelinkShapesForBlock(ByVal ws As Worksheet, ByVal idx As Long)
    ' Renombra shapes del bloque para que Application.Caller tenga indice.
    ' Ejemplo esperado de nombres finales: addFicha_3, subFicha_3, ico_3_Brawn
    ' Ajusta este patron a tus shapes reales.

    Dim colStart As Long, colEnd As Long
    colStart = FIRST_BLOCK_COL + (idx - 1) * BLOCK_WIDTH
    colEnd = colStart + BLOCK_WIDTH - 1

    Dim shp As Shape
    For Each shp In ws.Shapes
        If Not Intersect(shp.TopLeftCell, ws.Range(ws.Cells(1, colStart), ws.Cells(47, colEnd))) Is Nothing Then
            If InStr(1, shp.Name, "addFicha", vbTextCompare) > 0 Then
                shp.Name = "addFicha_" & idx
                shp.OnAction = "AddFichaDyn"
            ElseIf InStr(1, shp.Name, "subFicha", vbTextCompare) > 0 Then
                shp.Name = "subFicha_" & idx
                shp.OnAction = "SubFichaDyn"
            End If
        End If
    Next shp
End Sub


Private Sub ClearBlocksAfter(ByVal ws As Worksheet, ByVal keepN As Long)
    Dim lastKeepCol As Long
    lastKeepCol = FIRST_BLOCK_COL + keepN * BLOCK_WIDTH - 1

    Dim hardRightCol As Long
    hardRightCol = ws.Cells(1, ws.Columns.Count).End(xlToLeft).Column

    If hardRightCol <= lastKeepCol Then Exit Sub

    ws.Range(ws.Cells(1, lastKeepCol + 1), ws.Cells(47, hardRightCol)).Clear
End Sub


Private Function CharacterCount() As Long
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets(SH_TABLAS)

    Dim r As Long, n As Long
    r = FIRST_NAME_ROW
    Do While Len(Trim$(CStr(ws.Cells(r, 1).Value))) > 0
        n = n + 1
        r = r + 1
    Loop

    CharacterCount = n
End Function


Private Function ExtractTrailingIndex(ByVal s As String) As Long
    Dim i As Long, t As String
    For i = Len(s) To 1 Step -1
        If Mid$(s, i, 1) Like "[0-9]" Then
            t = Mid$(s, i, 1) & t
        ElseIf Len(t) > 0 Then
            Exit For
        End If
    Next i

    If Len(t) = 0 Then
        ExtractTrailingIndex = 0
    Else
        ExtractTrailingIndex = CLng(t)
    End If
End Function
