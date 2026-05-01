Attribute VB_Name = "Módulo8"
'========================================================
'  SecretCounterClick – contador con frases y emoji random
'    + mensajes especiales en 25,50,75,100,150,200,250 y 300+ clicks
'    + contador persistente sin hojas nuevas
'========================================================
Option Explicit

Const COLLECT As String = _
      "¡Ey! ¡No me toques!|¿Intentas hackearme?|¡Que cosquillas!|" & _
      "¡Ajá! ¡Te vi!|Nada que ver aquí… sigue, sigue.|Soy solo un humilde contador.|" & _
      "¡Ouch! Eso dolió.|¡AAA! Me asustaste, humano.|Tengo miedo a las manos…|" & _
      "¿Es tu turno? Entonces tira los dados, no a mí.|Si te va mal, no me culpes…|" & _
      "Estoy contando fichas… ¡no me distraigas!|Shhh… estoy durmiendo.|" & _
      "¡Wow! Esa fue una tirada crítica… sobre mí.|Guardo secretos de tiradas; no hurguen.|" & _
      "¡No me tengas miedo, soy un contador!|Soy sensible al clic.|P-p-por favor, respeta mi espacio.|" & _
      "Game over para tus dedos si sigues tocando…|¡Apuesta al rojo… pero no a mí!|" & _
      "No soy comodín, soy contador.|Lanzar dados > Lanzarme clics.|¡Bingo! Acabas de molestarme.|" & _
      "¿Buscaminas? Aquí no hay minas, pero sí clics.|" & _
      "¡Deja de tocarme! No somos limítrofes.|¡QUIERO RE-TRUCO!|¡FALTA ENVIDO!|" & _
      "No soy ficha de Burako… ¡soy vital!|Em... quiero 23?|Aquí no hay D20, solo de clics.|" & _
      """Hit me!"" es para blackjack, no para mí.|Si sigues, gritaré ¡UNO!|¡Estas matándome!|" & _
      "¡Agh! Hundiste mi acorazado!|fichas fichas fichas fichas fichas fichas fichas fichas!!!|" & _
      "Te sobran acciones; a mí, nervios.|Los dados están calientes… ¿yo también?|" & _
      "Jaque a tu curiosidad.|Mi Nen: «Contar y Temblar».|" & _
      "Dados + café = madrugada feliz; clics + yo = trauma.|" & _
      "La casa siempre gana; el contador siempre sufre.|" & _
      "Pongo all-in mi paciencia… y la estoy perdiendo.|" & _
      "Si me tocas otra vez invocaré una maldición sobre ti.|Te lo advierto…|" & _
      "A veces es mejor no descubrir qué pasaría si…|Subo de nivel con tu respeto.|¡Ya basta!"

Public Sub SecretCounterClick()
    Dim nm          As Name
    Dim clickCount  As Long
    Dim frases      As Variant
    Dim idx         As Long
    Dim specials    As Variant
    Dim specialIdx  As Long

    ' — Obtener o crear el contador oculto —
    On Error Resume Next
    Set nm = ThisWorkbook.Names("SecretCounterClicks")
    On Error GoTo 0
    If nm Is Nothing Then
        Set nm = ThisWorkbook.Names.Add( _
            Name:="SecretCounterClicks", _
            RefersTo:="=0", _
            Visible:=False _
        )
    End If

    ' — Leer, incrementar y guardar el contador —
    clickCount = CLng(Evaluate(nm.RefersTo))
    clickCount = clickCount + 1
    nm.RefersTo = "=" & clickCount

    ' — Preparar frase aleatoria —
    Randomize
    frases = Split(COLLECT, "|")
    idx = Int(Rnd * (UBound(frases) + 1))

    ' — Tus frases especiales para los hitos —
    specials = Array( _
      "Eres persistente, toma una ficha.", _
      "¡Otra vez aquí? Toma una ficha.", _
      "Ya sé qué buscas, bien merecida te la has ganado.", _
      "¡100 clicks! Vaya adicción, ya sabes qué hacer.", _
      "¡150 clicks! Drogadicto del click.", _
      "Tu nen de las fichas es fuerte y molesto… recibes 2 fichas.", _
      "¡250 clicks! Eres una leyenda del clic. Estás sobrepasando los límites.", _
      "SUPER-CLICK" _
    )

    ' — Mostrar mensaje especial o aleatorio —
    If clickCount >= 25 And clickCount Mod 25 = 0 Then
        Select Case clickCount
            Case 25:  specialIdx = 0
            Case 50:  specialIdx = 1
            Case 75:  specialIdx = 2
            Case 100: specialIdx = 3
            Case 150: specialIdx = 4
            Case 200: specialIdx = 5
            Case 250: specialIdx = 6
            Case Else ' 300,400,… cada múltiplo de 100
                specialIdx = 7
        End Select
        MsgBox specials(specialIdx), vbOKOnly + vbExclamation, "Contador parlante"
    Else
        MsgBox frases(idx), vbOKOnly, "Contador parlante"
    End If

    ' — (Opcional) Debug en ventana inmediata —
    Debug.Print "Clicks totales: " & clickCount
End Sub


