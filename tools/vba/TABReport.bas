Attribute VB_Name = "TABReport"
Option Explicit

' ============================================================================
'  a2b TAB Report – report assembly macros (revision 02 layout)
'
'  Import once per template copy:  Alt+F11 > File > Import File... > TABReport.bas
'  and delete the old "SyncToCPageCounts" module (the ToC button calls the
'  routine of the same name in this module).
'
'  Public entry points (Alt+F8):
'    PrintReport        – hide unused units / rows, sync the ToC, export the
'                         whole report to one PDF (or send to the printer)
'    HideUnusedBlocks   – hide unit pages and outlet rows that hold no data
'    ShowAllBlocks      – undo HideUnusedBlocks
'    SyncToCPageCounts  – rewrite the "page n" cells on the ToC
'
'  Sheet layout assumed (revision 02):
'    RTUs / MAUs / ERVs / Fans : one unit = page 1 (52 rows, "System" in B)
'                                + page 2 (52 rows, "System (cont.)" in B)
'    VAVs                      : one terminal = 26 rows, two per page
'    Hoods                     : two hoods per page, "System" in B
'    Traverses                 : 6-row blocks, "Airflow Traverse Measurement"
' ============================================================================

Private Const FIRST_ROW As Long = 4
Private Const PAGE_ROWS As Long = 52

Private Function ReportSections() As Variant
    Dim m(0 To 13) As Variant
    m(0) = Array(10, Array("ToC"))
    m(1) = Array(13, Array("Narrative", "Summary - New", "Summary - (E)"))
    m(2) = Array(16, Array("Building Balance"))
    m(3) = Array(19, Array("RTUs"))
    m(4) = Array(22, Array("MAUs"))
    m(5) = Array(25, Array("ERVs"))
    m(6) = Array(28, Array("Fans", "VAVs"))
    m(7) = Array(31, Array("Hoods"))
    m(8) = Array(34, Array("Traverses"))
    m(9) = Array(37, Array("Certification", "NEBB Cert", "NEBB Frm Cert"))
    m(10) = Array(40, Array("Abbreviations"))
    m(11) = Array(43, Array("Calibration"))
    m(12) = Array(46, Array())                ' Mechanical Floorplan(s) – attached separately
    m(13) = Array(49, Array("Photos"))
    ReportSections = m
End Function

' ---------------------------------------------------------------------------
Private Function FindSheet(ByVal wb As Workbook, ByVal label As String) As Worksheet
    Dim s As Worksheet, target As String
    target = LCase$(Trim$(label))
    For Each s In wb.Worksheets
        If LCase$(Trim$(s.Name)) = target Then Set FindSheet = s: Exit Function
    Next s
    For Each s In wb.Worksheets
        If Left$(LCase$(Trim$(s.Name)), Len(target)) = target Then Set FindSheet = s: Exit Function
    Next s
    Set FindSheet = Nothing
End Function

Private Function CountPrintPages(ByVal sh As Worksheet) As Long
    If sh.Visible <> xlSheetVisible Then CountPrintPages = 0: Exit Function
    Dim saved As Object: Set saved = ActiveSheet
    Application.ScreenUpdating = False
    sh.Activate
    Dim pages As Long
    On Error Resume Next
    pages = ExecuteExcel4Macro("GET.DOCUMENT(50)")
    On Error GoTo 0
    If pages < 1 Then pages = 1
    If Not saved Is Nothing Then saved.Activate
    Application.ScreenUpdating = True
    CountPrintPages = pages
End Function

' True when any cell in rng holds a typed constant (formulas are ignored).
Private Function HasConstants(ByVal rng As Range) As Boolean
    Dim r As Range
    On Error Resume Next
    Set r = rng.SpecialCells(xlCellTypeConstants)
    On Error GoTo 0
    HasConstants = Not r Is Nothing
End Function

Private Function BlockAnchors(ByVal sh As Worksheet, ByVal label As String) As Collection
    Dim c As Collection: Set c = New Collection
    Dim r As Long, last As Long
    last = sh.Cells(sh.Rows.Count, "B").End(xlUp).Row
    For r = FIRST_ROW To last
        If sh.Cells(r, "B").Value = label Then c.Add r
    Next r
    Set BlockAnchors = c
End Function

' Hide outlet rows with no No./Area/velocity between a "No." header and the next Total/Subtotal.
' The first row of every table stays visible.
Private Sub HideEmptyTableRows(ByVal sh As Worksheet, ByVal firstRow As Long, ByVal lastRow As Long)
    Dim r As Long, inTable As Boolean, firstOfTable As Boolean
    For r = firstRow To lastRow
        If sh.Cells(r, "B").Value = "No." Then
            inTable = True: firstOfTable = True
        ElseIf Left$(CStr(sh.Cells(r, "C").Value), 5) = "Total" Or Left$(CStr(sh.Cells(r, "C").Value), 8) = "Subtotal" _
               Or Left$(CStr(sh.Cells(r, "B").Value), 7) = "Remarks" Then
            inTable = False
        ElseIf inTable Then
            If IsEmpty(sh.Cells(r, "B")) And IsEmpty(sh.Cells(r, "C")) And IsEmpty(sh.Cells(r, "I")) And IsEmpty(sh.Cells(r, "K")) Then
                If Not firstOfTable Then sh.Rows(r).Hidden = True
            End If
            firstOfTable = False
        End If
    Next r
End Sub

' Two-page unit sheets: hide unused units, empty continuation pages and empty outlet rows.
Private Sub HideUnitSheet(ByVal sh As Worksheet)
    Dim anchors As Collection, i As Long, a As Long, q As Long, lastUsed As Long
    sh.Rows.Hidden = False
    Set anchors = BlockAnchors(sh, "System")
    lastUsed = 0
    For i = 1 To anchors.Count
        a = anchors(i)
        If Len(Trim$(CStr(sh.Cells(a, "D").Value))) > 0 Then lastUsed = i
    Next i
    If lastUsed = 0 Then lastUsed = 1
    For i = 1 To lastUsed
        a = anchors(i): q = a + PAGE_ROWS
        If Len(Trim$(CStr(sh.Cells(a, "D").Value))) = 0 Then
            sh.Rows(a & ":" & q + PAGE_ROWS - 1).Hidden = True
        Else
            ' continuation page: hide when it holds no typed data in columns B:M
            If Not HasConstants(sh.Range(sh.Cells(q + 2, "B"), sh.Cells(q + PAGE_ROWS - 1, "M"))) Then
                sh.Rows(q & ":" & q + PAGE_ROWS - 1).Hidden = True
            Else
                HideEmptyTableRows sh, q, q + PAGE_ROWS - 1
            End If
            HideEmptyTableRows sh, a, q - 1
        End If
    Next i
    If lastUsed < anchors.Count Then
        sh.Rows(anchors(lastUsed + 1) & ":" & anchors(anchors.Count) + 2 * PAGE_ROWS - 1).Hidden = True
    End If
    sh.PageSetup.PrintArea = "$A$1:$N$" & (anchors(lastUsed) + 2 * PAGE_ROWS - 1)
End Sub

' Fixed-height block sheets (VAVs 26 rows, Hoods): hide blocks without a designation.
Private Sub HideBlockSheet(ByVal sh As Worksheet, ByVal blockRows As Long, ByVal tables As Boolean)
    Dim anchors As Collection, i As Long, a As Long, lastUsed As Long
    sh.Rows.Hidden = False
    Set anchors = BlockAnchors(sh, "System")
    lastUsed = 0
    For i = 1 To anchors.Count
        If Len(Trim$(CStr(sh.Cells(anchors(i), "D").Value))) > 0 Then lastUsed = i
    Next i
    If lastUsed = 0 Then lastUsed = 1
    For i = 1 To lastUsed
        a = anchors(i)
        If Len(Trim$(CStr(sh.Cells(a, "D").Value))) = 0 Then
            sh.Rows(a & ":" & a + blockRows - 1).Hidden = True
        ElseIf tables Then
            HideEmptyTableRows sh, a, a + blockRows - 1
        End If
    Next i
    If lastUsed < anchors.Count Then sh.Rows(anchors(lastUsed + 1) & ":" & anchors(anchors.Count) + blockRows - 1).Hidden = True
    ' round the print area up to a whole page
    Dim lastRow As Long
    lastRow = anchors(lastUsed) + blockRows - 1
    sh.PageSetup.PrintArea = "$A$1:$N$" & lastRow
End Sub

Public Sub HideUnusedBlocks()
    Dim wb As Workbook: Set wb = ThisWorkbook
    Dim nm As Variant, sh As Worksheet, r As Long, last As Long
    Application.ScreenUpdating = False
    For Each nm In Array("RTUs", "MAUs", "ERVs", "Fans")
        Set sh = FindSheet(wb, CStr(nm))
        If Not sh Is Nothing Then HideUnitSheet sh
    Next nm
    Set sh = FindSheet(wb, "VAVs"): If Not sh Is Nothing Then HideBlockSheet sh, 26, True
    Set sh = FindSheet(wb, "Hoods")
    If Not sh Is Nothing Then
        sh.Rows.Hidden = False
        Dim anchors As Collection, i As Long, lastUsed As Long
        Set anchors = BlockAnchors(sh, "System")
        For i = 1 To anchors.Count
            If Len(Trim$(CStr(sh.Cells(anchors(i), "D").Value))) > 0 Then lastUsed = i
        Next i
        If lastUsed = 0 Then lastUsed = 1
        If lastUsed < anchors.Count Then
            ' hoods are two per page (anchors at 4, 25 | 53, 74 ...): hide from the next page boundary
            Dim nextPage As Long: nextPage = 53 + 49 * (lastUsed \ 2)
            If lastUsed Mod 2 = 0 Then sh.Rows(nextPage & ":" & sh.UsedRange.Rows.Count + sh.UsedRange.Row).Hidden = True _
                Else sh.Rows(anchors(lastUsed + 1) & ":" & sh.UsedRange.Rows.Count + sh.UsedRange.Row).Hidden = True
            sh.PageSetup.PrintArea = "$A$1:$N$" & IIf(lastUsed Mod 2 = 0, nextPage - 1, anchors(lastUsed + 1) - 1)
        End If
    End If
    Set sh = FindSheet(wb, "Traverses")
    If Not sh Is Nothing Then
        sh.Rows.Hidden = False
        last = sh.Cells(sh.Rows.Count, "B").End(xlUp).Row
        For r = FIRST_ROW To last
            If sh.Cells(r, "B").Value = "Airflow Traverse Measurement" Then
                If Len(Trim$(CStr(sh.Cells(r + 2, "B").Value))) = 0 Then sh.Rows(r & ":" & r + 5).Hidden = True
            End If
        Next r
    End If
    Set sh = FindSheet(wb, "Building Balance")
    If Not sh Is Nothing Then
        For r = 7 To 66
            sh.Rows(r).Hidden = (Len(Trim$(CStr(sh.Cells(r, "B").Value))) = 0 And Len(Trim$(CStr(sh.Cells(r, "H").Value))) = 0)
        Next r
    End If
    Application.ScreenUpdating = True
End Sub

Public Sub ShowAllBlocks()
    Dim sh As Worksheet
    For Each sh In ThisWorkbook.Worksheets
        If sh.Visible = xlSheetVisible Then sh.Rows.Hidden = False
    Next sh
End Sub

' ---------------------------------------------------------------------------
Public Sub SyncToCPageCounts()
    Dim wb As Workbook: Set wb = ThisWorkbook
    Dim toc As Worksheet: Set toc = FindSheet(wb, "ToC")
    If toc Is Nothing Then MsgBox "Sheet 'ToC' not found.", vbExclamation: Exit Sub
    Dim savedCalc As Long: savedCalc = Application.Calculation
    Application.Calculation = xlCalculationManual
    Application.ScreenUpdating = False
    Dim cumulative As Long, sections As Variant, entry As Variant, sheetNames As Variant
    Dim i As Long, j As Long, sh As Worksheet, missing As String, startPage As Long
    Set sh = FindSheet(wb, "Cover Page")
    If Not sh Is Nothing Then cumulative = CountPrintPages(sh)
    sections = ReportSections()
    For i = LBound(sections) To UBound(sections)
        entry = sections(i): sheetNames = entry(1): startPage = cumulative + 1
        If IsArray(sheetNames) Then
            For j = LBound(sheetNames) To UBound(sheetNames)
                Set sh = FindSheet(wb, CStr(sheetNames(j)))
                If sh Is Nothing Then
                    missing = missing & "  - row " & entry(0) & ": " & sheetNames(j) & vbCrLf
                Else
                    cumulative = cumulative + CountPrintPages(sh)
                End If
            Next j
        End If
        toc.Range("K" & CLng(entry(0))).Value = "page " & startPage
    Next i
    Application.ScreenUpdating = True
    Application.Calculation = savedCalc
    Application.Calculate
    If Len(missing) > 0 Then MsgBox "ToC updated; sheets not found:" & vbCrLf & missing, vbInformation
End Sub

' ---------------------------------------------------------------------------
' The revision 02 sheet order is the reading order, so the whole workbook can
' be exported in one go: each unit's data and airflow are on the same page.
Public Sub PrintReport()
    Dim answer As VbMsgBoxResult
    answer = MsgBox("Hide unused units and rows, update the ToC, then export the report as one PDF?" & vbCrLf & _
                    "(No = send to printer, Cancel = abort)", vbYesNoCancel + vbQuestion, "Print TAB Report")
    If answer = vbCancel Then Exit Sub
    HideUnusedBlocks
    SyncToCPageCounts
    Dim wb As Workbook: Set wb = ThisWorkbook
    Dim names As Collection: Set names = New Collection
    Dim sh As Worksheet
    For Each sh In wb.Worksheets
        If sh.Visible = xlSheetVisible And Left$(sh.Name, 1) <> "{" Then names.Add sh.Name
    Next sh
    Dim arr() As String, i As Long
    ReDim arr(1 To names.Count)
    For i = 1 To names.Count: arr(i) = names(i): Next i
    wb.Worksheets(arr).Select
    If answer = vbYes Then
        Dim path As String
        path = Application.GetSaveAsFilename(InitialFileName:=wb.Path & "\TAB Report.pdf", FileFilter:="PDF (*.pdf), *.pdf")
        If path <> "False" Then
            ActiveSheet.ExportAsFixedFormat Type:=xlTypePDF, Filename:=path, Quality:=xlQualityStandard, _
                IncludeDocProperties:=True, IgnorePrintAreas:=False, OpenAfterPublish:=True
        End If
    Else
        ActiveSheet.PrintOut
    End If
    wb.Worksheets(1).Select
End Sub
