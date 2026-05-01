Attribute VB_Name = "Módulo1"
'==============================================
'   ROLL  – con CONTEXTO, limpieza global,
'           ScreenUpdating OFF, reset de iconos
'           y LIMPIEZA DE SUB-TABLAS
'==============================================
Option Explicit

Private Const COL_ON_FILL  As Long = &H66FF66   ' verde
Private Const COL_OFF_LINE As Long = vbWhite    ' contorno blanco

Sub ROLL()

    '----------  Optimización velocidad ----------
    Dim oldCalc As XlCalculation
    With Application
        .ScreenUpdating = False
        .EnableEvents = False
        oldCalc = .Calculation
        .Calculation = xlCalculationManual
    End With
    
    On Error GoTo FIN
    
    '-------------- Hojas ------------------------
    Dim wsIn As Worksheet, wsOut As Worksheet, wsTab As Worksheet
    Set wsIn = ThisWorkbook.Sheets("INPUT")
    Set wsOut = ThisWorkbook.Sheets("IMPRESION")
    Set wsTab = ThisWorkbook.Sheets("TABLAS")
    
    '-------------- CONTEXTO ---------------------
    Dim contextVal As String: contextVal = wsIn.Range("V7").Value   ' V7:X8
    
    '-------------- ID consecutivo ---------------
    Dim newID As Long
    With wsOut
        newID = IIf(.Cells(.Rows.Count, "B").End(xlUp).Row < 2, _
                    1, .Cells(.Rows.Count, "B").End(xlUp).Value + 1)
    End With
    
    '-------------- Estrellas ---------------------
    Dim flagCells(0 To 4) As Range, shapeNames(0 To 4) As String
    Set flagCells(0) = wsTab.Range("B27"): shapeNames(0) = "StarFish"
    Set flagCells(1) = wsTab.Range("B28"): shapeNames(1) = "StarJoaking"
    Set flagCells(2) = wsTab.Range("B31"): shapeNames(2) = "StarJung"
    Set flagCells(3) = wsTab.Range("B30"): shapeNames(3) = "StarLorenzo"
    Set flagCells(4) = wsTab.Range("B29"): shapeNames(4) = "StarTito"
    
    '-------------- Variables ---------------------
    Dim errorMessages As String
    Dim i As Long, filaOut As Long
    Dim checkVal, dadoTirado
    
    '==============================================
    '      RECORRER LOS 5 BLOQUES
    '==============================================
    For i = 0 To 4
        
        Dim colStart As Long: colStart = 1 + i * 4        ' A-D, E-H, …
        
        checkVal = wsIn.Cells(8, colStart + 1).Value       ' CHECK  (fila 8)
        dadoTirado = wsIn.Cells(10, colStart + 1).Value    ' Dado   (fila 10)
        Dim commentVal As String: commentVal = wsIn.Cells(13, colStart + 1).Value
        
        '--- omitir bloque vacío --------------------------
        If Trim(checkVal) = "" And Trim(dadoTirado) = "" Then GoTo SiguienteBloque
        
        '--- inconsistencias ------------------------------
        If (Trim(checkVal) = "") Xor (Trim(dadoTirado) = "") Then
            Dim who As String
            who = IIf(wsIn.Cells(5, colStart + 1).Value <> "", _
                      " del personaje '" & wsIn.Cells(5, colStart + 1).Value & "'", _
                      " en el bloque #" & (i + 1))
            errorMessages = errorMessages & _
                IIf(checkVal = "", "Te falta el CHECK", "Te falta el DADO TIRADO") & _
                who & vbCrLf
            GoTo SiguienteBloque
        End If
        
        '-----------  NUEVA FILA EN IMPRESION  -----------
        filaOut = wsOut.Cells(wsOut.Rows.Count, "B").End(xlUp).Row + 1
        With wsOut
            .Cells(filaOut, "B").Value = newID
            .Cells(filaOut, "BG").Value = IIf(flagCells(i).Value = 1, ChrW(&H2605), "")
            .Cells(filaOut, "BH").Value = Now
            .Cells(filaOut, "BI").Value = commentVal
            .Cells(filaOut, "BJ").Value = contextVal
        End With
        
        '-----------  Datos principales -------------------
        Dim personaName As String: personaName = wsIn.Cells(5, colStart + 1).Value
        
        Dim pasaVal As String
        pasaVal = wsIn.Cells(7, colStart + 2).Value      ' C7
        If pasaVal = "" Then pasaVal = wsIn.Cells(8, colStart + 2).Value
        
        Dim fichVal As Variant: fichVal = wsIn.Cells(10, colStart + 2).Value
        
        With wsOut
            .Cells(filaOut, "C").Value = personaName
            .Cells(filaOut, "D").Value = wsIn.Cells(6, colStart + 1).Value
            .Cells(filaOut, "E").Value = wsIn.Cells(4, colStart + 1).Value
            .Cells(filaOut, "F").Value = wsIn.Cells(4, colStart + 2).Value
            .Cells(filaOut, "G").Value = wsIn.Cells(4, colStart + 3).Value
            .Cells(filaOut, "H").Value = checkVal
            .Cells(filaOut, "I").Value = dadoTirado
            .Cells(filaOut, "J").Value = pasaVal
            .Cells(filaOut, "K").Value = IIf(fichVal = "", 0, fichVal)
            .Cells(filaOut, "L").Value = wsIn.Cells(7, colStart + 3).Value
            .Cells(filaOut, "M").Value = wsIn.Cells(11, colStart + 1).Value
            .Cells(filaOut, "N").Value = wsIn.Cells(10, colStart + 3).Value
        End With
        
        '-----------  NO PASA ? TABLAS --------------------
        If InStr(UCase(pasaVal), "NO PASA") > 0 Then
            Dim tRow As Long
            For tRow = 2 To 6
                If wsTab.Cells(tRow, "A").Value = personaName Then
                    wsTab.Cells(tRow, "B").Value = wsTab.Cells(tRow, "B").Value + 1
                    Exit For
                End If
            Next tRow
        End If
        
        '-----------  Sub-tiradas (EXPLOTA) ---------------
        Dim totalFichasUsed As Double: totalFichasUsed = 0
        If IsNumeric(fichVal) Then totalFichasUsed = fichVal
        
        If UCase(wsIn.Cells(11, colStart + 1).Value) = "EXPLOTA" Then
            Dim r As Long, expCnt As Long
            For r = 15 To 46 Step 3
                Dim vD As Variant: vD = wsIn.Cells(r, colStart + 1).Value
                If vD = "" Then Exit For
                Dim vF As Variant: vF = wsIn.Cells(r, colStart + 2).Value
                Dim vM As Variant: vM = wsIn.Cells(r, colStart + 3).Value
                Dim vE As String:  vE = wsIn.Cells(r + 1, colStart + 1).Value
                wsOut.Cells(filaOut, 15 + expCnt * 4).Resize(1, 4).Value = _
                        Array(vD, vF, vM, vE)
                If IsNumeric(vF) Then totalFichasUsed = totalFichasUsed + vF
                expCnt = expCnt + 1
                If UCase(vE) = "NO EXPLOTA" Then Exit For
            Next r
        End If
        
        '-----------  Restar fichas ? TABLAS --------------
        Dim pRow As Long
        For pRow = 2 To 6
            If wsTab.Cells(pRow, "A").Value = personaName Then
                wsTab.Cells(pRow, "B").Value = wsTab.Cells(pRow, "B").Value - totalFichasUsed
                Exit For
            End If
        Next pRow
        
        '-----------  LIMPIAR SUB-TABLAS ------------------
        Dim rr As Long
        For rr = 15 To 45 Step 3              ' 15-18-21 … 45
            wsIn.Cells(rr, colStart + 1).ClearContents       ' valor dado
            wsIn.Cells(rr, colStart + 2).ClearContents       ' fichas usadas
            '   (col +3 = +MOD se mantiene)
            '   fila rr+1 (EXPLOTA/NO) también se mantiene
        Next rr
        
        '-----------  Apagar estrella  --------------------
        If flagCells(i).Value = 1 Then ToggleStar shapeNames(i), flagCells(i)
        
SiguienteBloque:
    Next i
    
    '===========  LIMPIEZA GLOBAL DE INPUT ===============
    With wsIn
        .Range("V7").MergeArea.ClearContents
        .Range("B13:D13,F13:H13,J13:L13,N13:P13,R13:T13").ClearContents
        .Range("B10:C10,F10:G10,J10:K10,N10:O10,R10:S10").ClearContents
        .Range("B8,F8,J8,N8,R8").ClearContents
        .Range("B6:D6,F6:H6,J6:L6,N6:P6,R6:T6").ClearContents
    End With
    
    '===========  APAGAR TODOS LOS ICONOS DE STAT =========
    Dim shp As Shape
    For Each shp In wsIn.Shapes
        If shp.Name Like "ico_*" Then
            With shp
                .Fill.Visible = msoFalse
                .Line.ForeColor.RGB = COL_OFF_LINE
            End With
        End If
    Next shp
    
    '===========  Mensajes  ===============================
    If errorMessages <> "" Then MsgBox errorMessages, vbExclamation, "Faltan Datos"

FIN:
    '----------  Reactivar aplicación  ----------
    With Application
        .Calculation = oldCalc
        .EnableEvents = True
        .ScreenUpdating = True
    End With
End Sub


